"""Forecasting result types shared across all model implementations.

These are the output contracts consumed by the service layer and serialised
by the API.  Keeping them in a dedicated module prevents circular imports
between the model implementations and the schema layer.

Design notes
------------
- ``ForecastPoint`` is granular so the frontend can render any subset of the
  confidence bands independently.
- ``ModelFitMetrics`` records in-sample fit quality (AIC / BIC) separately
  from out-of-sample accuracy metrics (MAE / RMSE) to make the distinction
  explicit to callers.
- ``BacktestResult`` aggregates walk-forward evaluation across splits.  The
  per-split breakdown is preserved so callers can examine temporal degradation.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

import numpy as np
import pandas as pd


# ── Granular forecast output ──────────────────────────────────────────────────


@dataclass
class ForecastPoint:
    """Model output for a single forecast date.

    Confidence intervals follow the convention used by statsmodels:
    ``alpha`` is the *significance* level, so:

        alpha=0.10  →  90% CI  (5th–95th percentile)
        alpha=0.50  →  50% CI (25th–75th percentile)

    The ``ci_lower_50`` / ``ci_upper_50`` pair is the "inner band" shown on
    forecast charts; ``ci_lower_90`` / ``ci_upper_90`` is the "outer band".
    """
    date:        date
    forecast:    float
    ci_lower_90: float   # 5th percentile
    ci_upper_90: float   # 95th percentile
    ci_lower_50: float   # 25th percentile
    ci_upper_50: float   # 75th percentile

    def to_dict(self) -> dict[str, Any]:
        return {
            "date":        str(self.date),
            "forecast":    round(self.forecast, 4),
            "ci_lower_90": round(self.ci_lower_90, 4),
            "ci_upper_90": round(self.ci_upper_90, 4),
            "ci_lower_50": round(self.ci_lower_50, 4),
            "ci_upper_50": round(self.ci_upper_50, 4),
        }


# ── Model-fit diagnostics ─────────────────────────────────────────────────────


@dataclass
class ModelFitMetrics:
    """In-sample fit quality from the fitted model.

    Populated after ``model.fit()`` from the statsmodels result object.
    """
    aic:             float
    bic:             float
    hqic:            float
    log_likelihood:  float
    n_obs:           int
    order:           tuple[int, int, int]   # ARIMA (p, d, q)
    residual_mean:   float
    residual_std:    float
    is_stationary:   bool   # AR polynomial roots outside unit circle
    is_invertible:   bool   # MA polynomial roots outside unit circle

    def to_dict(self) -> dict[str, Any]:
        return {
            "aic":            round(self.aic, 4),
            "bic":            round(self.bic, 4),
            "hqic":           round(self.hqic, 4),
            "log_likelihood": round(self.log_likelihood, 4),
            "n_obs":          self.n_obs,
            "order":          list(self.order),
            "residual_mean":  round(self.residual_mean, 6),
            "residual_std":   round(self.residual_std, 6),
            "is_stationary":  self.is_stationary,
            "is_invertible":  self.is_invertible,
        }


# ── Out-of-sample accuracy metrics ───────────────────────────────────────────


@dataclass
class AccuracyMetrics:
    """Out-of-sample forecast accuracy on a held-out test set."""
    mae:        float    # Mean Absolute Error (raw rate units, e.g. bps)
    rmse:       float    # Root Mean Squared Error
    mape:       float    # Mean Absolute Percentage Error (%)
    n_test_obs: int
    test_start: date
    test_end:   date

    def to_dict(self) -> dict[str, Any]:
        return {
            "mae":        round(self.mae, 6),
            "rmse":       round(self.rmse, 6),
            "mape":       round(self.mape, 4),
            "n_test_obs": self.n_test_obs,
            "test_start": str(self.test_start),
            "test_end":   str(self.test_end),
        }


# ── Walk-forward backtest ─────────────────────────────────────────────────────


@dataclass
class BacktestSplit:
    """Metrics from a single walk-forward split."""
    split_index:  int
    cutoff:       date
    n_train:      int
    n_test:       int
    mae:          float
    rmse:         float
    mape:         float
    order_used:   tuple[int, int, int]

    def to_dict(self) -> dict[str, Any]:
        return {
            "split_index": self.split_index,
            "cutoff":      str(self.cutoff),
            "n_train":     self.n_train,
            "n_test":      self.n_test,
            "mae":         round(self.mae, 6),
            "rmse":        round(self.rmse, 6),
            "mape":        round(self.mape, 4),
            "order_used":  list(self.order_used),
        }


@dataclass
class BacktestResult:
    """Aggregated walk-forward backtest results.

    ``splits`` preserves per-split detail so temporal degradation can be
    examined (earlier vs. later splits usually have lower error).
    """
    series_id:    str
    order:        tuple[int, int, int]
    n_splits:     int
    horizon_days: int
    mae:          float   # mean across splits
    rmse:         float
    mape:         float
    splits:       list[BacktestSplit] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "series_id":    self.series_id,
            "order":        list(self.order),
            "n_splits":     self.n_splits,
            "horizon_days": self.horizon_days,
            "mae":          round(self.mae, 6),
            "rmse":         round(self.rmse, 6),
            "mape":         round(self.mape, 4),
            "splits":       [s.to_dict() for s in self.splits],
        }


# ── Primary forecast result ───────────────────────────────────────────────────


@dataclass
class ForecastResult:
    """Complete output from a single forecast run.

    Contains the future prediction path, both confidence bands, fit metrics,
    and optionally backtest accuracy if the engine was configured with
    ``enable_backtest=True``.
    """
    series_id:    str
    model_name:   str
    order:        tuple[int, int, int]

    # Fit window
    train_start:  date
    train_end:    date
    n_train:      int

    # Forecast window
    forecast_start: date
    forecast_end:   date
    points:         list[ForecastPoint]

    # Metrics
    fit_metrics:     ModelFitMetrics
    accuracy:        AccuracyMetrics | None = None
    backtest:        BacktestResult | None  = None

    # ── Convenience accessors ─────────────────────────────────────────────────

    @property
    def dates(self) -> list[date]:
        return [p.date for p in self.points]

    @property
    def forecast_values(self) -> list[float]:
        return [p.forecast for p in self.points]

    @property
    def upper_90(self) -> list[float]:
        return [p.ci_upper_90 for p in self.points]

    @property
    def lower_90(self) -> list[float]:
        return [p.ci_lower_90 for p in self.points]

    @property
    def upper_50(self) -> list[float]:
        return [p.ci_upper_50 for p in self.points]

    @property
    def lower_50(self) -> list[float]:
        return [p.ci_lower_50 for p in self.points]

    @property
    def n_forecast_points(self) -> int:
        return len(self.points)

    # ── Serialisation ─────────────────────────────────────────────────────────

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "series_id":      self.series_id,
            "model_name":     self.model_name,
            "order":          list(self.order),
            "train_start":    str(self.train_start),
            "train_end":      str(self.train_end),
            "n_train":        self.n_train,
            "forecast_start": str(self.forecast_start),
            "forecast_end":   str(self.forecast_end),
            "n_forecast":     self.n_forecast_points,
            "fit_metrics":    self.fit_metrics.to_dict(),
            "points":         [p.to_dict() for p in self.points],
        }
        if self.accuracy:
            d["accuracy"] = self.accuracy.to_dict()
        if self.backtest:
            d["backtest"] = self.backtest.to_dict()
        return d

    def to_dataframe(self) -> pd.DataFrame:
        """Return forecast points as a DataFrame for further analysis."""
        rows = [
            {
                "date":        p.date,
                "forecast":    p.forecast,
                "ci_lower_90": p.ci_lower_90,
                "ci_upper_90": p.ci_upper_90,
                "ci_lower_50": p.ci_lower_50,
                "ci_upper_50": p.ci_upper_50,
            }
            for p in self.points
        ]
        return pd.DataFrame(rows).set_index("date")
