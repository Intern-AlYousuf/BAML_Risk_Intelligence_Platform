"""Composable time-series preprocessing pipeline.

The pipeline takes a raw pd.Series from a loader and produces a
``ForecastInput`` ready for model consumption.  Each step is a named,
optionally-skippable transformation that logs what it did.

Design
------
Pipelines are assembled via class methods (``for_sofr``, ``for_fx_rate``) so
that asset-class-specific defaults are co-located with the pipeline logic and
not scattered across callers.

Usage
-----
    pipeline = PreprocessingPipeline.for_sofr()
    result   = pipeline.run(raw_series, series_id="SOFR")
    print(result.summary)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import pandas as pd

from app.core.logging import get_logger
from app.forecasting.base import (
    AssetClass,
    DateRange,
    ForecastInput,
    PreprocessingFlag,
    SeriesMetadata,
)
from app.forecasting.data.preprocessing import cleaners, transforms

logger = get_logger(__name__)


# ── Pipeline step ─────────────────────────────────────────────────────────────


@dataclass
class PipelineStep:
    """A named, toggleable transformation step.

    Parameters
    ----------
    name:
        Human-readable identifier shown in logs.
    fn:
        Callable ``(pd.Series) -> pd.Series``.  For steps that also return an
        integer count (e.g. outlier detection), wrap them so only the series
        is returned — counts are captured separately by the pipeline runner.
    enabled:
        Set to False to skip the step without removing it from the config.
    """
    name:    str
    fn:      Callable[[pd.Series], pd.Series]
    enabled: bool = True


# ── Pipeline ──────────────────────────────────────────────────────────────────


class PreprocessingPipeline:
    """Orchestrates cleaning and feature extraction for a raw time series.

    Parameters
    ----------
    metadata:
        Static descriptor for the series being processed.
    steps:
        Ordered list of cleaning steps to apply to the raw series.
    min_points:
        Minimum non-NaN observations required after cleaning. Raises
        ``ValueError`` if not met.
    zscore_threshold:
        Z-score cutoff for outlier detection.  Higher = more permissive.
    max_fill_gap:
        Maximum consecutive business days to forward-fill.
    floor, ceiling:
        Hard domain bounds applied after outlier removal (e.g. floor=0 for
        rates in normal regimes, floor=None for spread series).
    """

    def __init__(
        self,
        metadata:         SeriesMetadata,
        *,
        min_points:       int   = 60,
        zscore_threshold: float = 4.5,
        max_fill_gap:     int   = 5,
        floor:            float | None = None,
        ceiling:          float | None = None,
    ) -> None:
        self._meta             = metadata
        self._min_points       = min_points
        self._zscore_threshold = zscore_threshold
        self._max_fill_gap     = max_fill_gap
        self._floor            = floor
        self._ceiling          = ceiling

    # ── Factory methods ───────────────────────────────────────────────────────

    @classmethod
    def for_sofr(cls, metadata: SeriesMetadata) -> "PreprocessingPipeline":
        """Standard pipeline for overnight rate series (SOFR, EFFR).

        SOFR cannot be negative (under current conventions) so floor=0 is
        applied.  The rate also cannot realistically exceed 25%, so ceiling=25
        guards against data errors.
        """
        return cls(
            metadata=metadata,
            min_points=60,
            zscore_threshold=4.5,
            max_fill_gap=5,
            floor=0.0,
            ceiling=25.0,
        )

    @classmethod
    def for_fx_rate(cls, metadata: SeriesMetadata) -> "PreprocessingPipeline":
        """Standard pipeline for FX spot rate series (USD/INR, etc.).

        Spot rates are positive but can be volatile; a wider z-score threshold
        avoids removing genuine large moves (e.g. crisis devaluations).
        """
        return cls(
            metadata=metadata,
            min_points=60,
            zscore_threshold=5.0,
            max_fill_gap=3,
            floor=0.0,
            ceiling=None,
        )

    @classmethod
    def for_asset_class(
        cls,
        asset_class: AssetClass,
        metadata: SeriesMetadata,
    ) -> "PreprocessingPipeline":
        """Dispatch to the appropriate factory based on asset class."""
        if asset_class == AssetClass.INTEREST_RATE:
            return cls.for_sofr(metadata)
        if asset_class == AssetClass.FX:
            return cls.for_fx_rate(metadata)
        # Default: permissive settings for unknown asset classes.
        return cls(metadata=metadata)

    # ── Core run method ───────────────────────────────────────────────────────

    def run(
        self,
        raw: pd.Series,
        *,
        series_id: str | None = None,
    ) -> ForecastInput:
        """Execute the pipeline on *raw* and return a ``ForecastInput``.

        Parameters
        ----------
        raw:
            The series as returned by a loader.  Must have a DatetimeIndex.
        series_id:
            Override the series name used in logging.  Defaults to ``raw.name``.
        """
        sid = series_id or str(raw.name) or self._meta.series_id
        n_raw = len(raw)

        logger.info(
            "pipeline.run.start",
            series_id=sid,
            n_raw=n_raw,
        )

        flags:           list[PreprocessingFlag] = []
        n_gaps_filled:   int = 0
        n_outliers:      int = 0
        n_clipped:       int = 0

        # ── Step 1: reindex to full business-day calendar ──────────────────
        work = cleaners.reindex_to_business_days(raw)

        # ── Step 2: forward-fill short gaps (weekends absorbed above; this
        #            targets genuine data latency / holiday clusters) ────────
        work, filled = cleaners.forward_fill_gaps(work, max_consecutive=self._max_fill_gap)
        if filled:
            n_gaps_filled += filled
            flags.append(PreprocessingFlag.FORWARD_FILLED)

        # ── Step 3: domain range clipping (before outlier removal) ─────────
        if self._floor is not None or self._ceiling is not None:
            work, nc = cleaners.clip_to_valid_range(
                work, floor=self._floor, ceiling=self._ceiling
            )
            if nc:
                n_clipped += nc
                flags.append(PreprocessingFlag.CLIPPED)

        # ── Step 4: outlier detection / removal ────────────────────────────
        work, no = cleaners.remove_outliers_zscore(
            work, threshold=self._zscore_threshold
        )
        if no:
            n_outliers += no
            flags.append(PreprocessingFlag.OUTLIER_REMOVED)

        # ── Step 5: strip leading / trailing NaN ───────────────────────────
        work = cleaners.drop_leading_trailing_nans(work)

        # ── Step 6: quality gate ───────────────────────────────────────────
        cleaners.validate_minimum_length(work, self._min_points, sid)

        n_clean = int(work.notna().sum())

        # ── Step 7: derive return series for model consumption ─────────────
        ret     = transforms.simple_returns(work)
        log_ret = transforms.log_returns(work)

        # ── Build date range from cleaned series ───────────────────────────
        if work.empty:
            date_range = DateRange(start=raw.index.min().date(), end=raw.index.max().date())
        else:
            date_range = DateRange(
                start=work.index.min().date(),
                end=work.index.max().date(),
            )

        result = ForecastInput(
            series_id=sid,
            metadata=self._meta,
            date_range=date_range,
            levels=work,
            returns=ret,
            log_returns=log_ret,
            n_raw=n_raw,
            n_clean=n_clean,
            n_gaps_filled=n_gaps_filled,
            n_outliers=n_outliers,
            flags=flags,
        )

        logger.info(
            "pipeline.run.complete",
            series_id=sid,
            n_raw=n_raw,
            n_clean=n_clean,
            n_gaps_filled=n_gaps_filled,
            n_outliers=n_outliers,
            flags=[f.value for f in flags],
            sufficient=result.is_sufficient,
        )

        return result
