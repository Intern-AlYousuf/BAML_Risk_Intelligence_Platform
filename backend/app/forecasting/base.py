"""Core domain types for the forecasting infrastructure.

This module defines the enums, value objects, and structural contracts shared
across all layers of the forecasting system (data, preprocessing, models, API).
Nothing in here should import from deeper layers — it is the foundation.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Any

import pandas as pd


# ── Enumerations ──────────────────────────────────────────────────────────────


class AssetClass(str, Enum):
    INTEREST_RATE = "interest_rate"
    FX            = "fx"
    COMMODITY     = "commodity"
    EQUITY        = "equity"
    CREDIT        = "credit"


class SeriesFrequency(str, Enum):
    DAILY    = "daily"
    WEEKLY   = "weekly"
    MONTHLY  = "monthly"
    ANNUAL   = "annual"


class DataSource(str, Enum):
    FRED      = "FRED"
    PLATFORM  = "platform"  # internal MarketData table
    BLOOMBERG = "bloomberg"
    MANUAL    = "manual"


class ForecastHorizon(int, Enum):
    """Named forecast horizons in calendar days.

    The int value is calendar days; the forecasting layer converts to
    business days before model execution.
    """
    DAYS_90  = 90
    DAYS_180 = 180
    DAYS_365 = 365
    DAYS_730 = 730

    @property
    def label(self) -> str:
        return {90: "3M", 180: "6M", 365: "12M", 730: "24M"}[self.value]


class PreprocessingFlag(str, Enum):
    """Indicates what transformations were applied to a series."""
    FORWARD_FILLED    = "forward_filled"
    OUTLIER_REMOVED   = "outlier_removed"
    CLIPPED           = "clipped"
    DIFFERENCED       = "differenced"
    LOG_TRANSFORMED   = "log_transformed"


# ── Value objects ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class DateRange:
    """Immutable date range with inclusive bounds."""
    start: date
    end: date

    def __post_init__(self) -> None:
        if self.start > self.end:
            raise ValueError(
                f"start ({self.start}) must not be later than end ({self.end})"
            )

    @property
    def calendar_days(self) -> int:
        return (self.end - self.start).days

    def __contains__(self, d: date) -> bool:
        return self.start <= d <= self.end


@dataclass(frozen=True)
class SeriesMetadata:
    """Immutable descriptor for a named time series."""
    series_id:   str
    name:        str
    asset_class: AssetClass
    frequency:   SeriesFrequency
    source:      DataSource
    units:       str           # e.g. "percent_annualized", "usd_per_unit"
    description: str = ""
    source_id:   str = ""      # vendor-specific ID (e.g. FRED series code)

    def __str__(self) -> str:
        return f"{self.series_id} ({self.source.value}) — {self.name}"


# ── Forecast contract types ───────────────────────────────────────────────────


@dataclass
class ForecastInput:
    """Preprocessed, model-ready time-series input.

    Produced by the preprocessing pipeline and consumed by forecasting models.
    Carries both the cleaned level series and derived features so that models
    do not need to recompute common transformations.
    """
    series_id:     str
    metadata:      SeriesMetadata
    date_range:    DateRange

    # Core series — all aligned to the same DatetimeIndex.
    levels:        pd.Series           # cleaned price/rate levels
    returns:       pd.Series           # simple period-over-period returns
    log_returns:   pd.Series           # log(p_t / p_{t-1})

    # Diagnostics populated by the preprocessing pipeline.
    n_raw:         int = 0             # points in the raw series
    n_clean:       int = 0             # points after cleaning
    n_gaps_filled: int = 0             # NaN values forward-filled
    n_outliers:    int = 0             # outliers capped/removed
    flags:         list[PreprocessingFlag] = field(default_factory=list)
    extra:         dict[str, Any]      = field(default_factory=dict)

    @property
    def is_sufficient(self) -> bool:
        """True when clean point count meets the platform minimum threshold."""
        from app.core.config import settings
        return self.n_clean >= settings.FORECAST_MIN_HISTORY_POINTS

    @property
    def summary(self) -> dict[str, Any]:
        return {
            "series_id":     self.series_id,
            "start":         str(self.date_range.start),
            "end":           str(self.date_range.end),
            "n_raw":         self.n_raw,
            "n_clean":       self.n_clean,
            "n_gaps_filled": self.n_gaps_filled,
            "n_outliers":    self.n_outliers,
            "flags":         [f.value for f in self.flags],
            "sufficient":    self.is_sufficient,
        }
