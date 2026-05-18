"""Forecasting package — public surface.

Import from here rather than from sub-modules to maintain a stable API.
"""
from app.forecasting.base import (
    AssetClass,
    DateRange,
    ForecastHorizon,
    ForecastInput,
    PreprocessingFlag,
    SeriesFrequency,
    SeriesMetadata,
)
from app.forecasting.data.registry import (
    SERIES_REGISTRY,
    SeriesConfig,
    get_series_config,
    list_series,
)
from app.forecasting.models.results import (
    AccuracyMetrics,
    BacktestResult,
    ForecastPoint,
    ForecastResult,
    ModelFitMetrics,
)

__all__ = [
    # Domain types
    "AssetClass",
    "DateRange",
    "ForecastHorizon",
    "ForecastInput",
    "PreprocessingFlag",
    "SeriesFrequency",
    "SeriesMetadata",
    # Registry
    "SERIES_REGISTRY",
    "SeriesConfig",
    "get_series_config",
    "list_series",
    # Model results
    "AccuracyMetrics",
    "BacktestResult",
    "ForecastPoint",
    "ForecastResult",
    "ModelFitMetrics",
]
