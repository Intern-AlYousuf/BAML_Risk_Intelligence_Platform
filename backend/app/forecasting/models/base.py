"""Abstract base class for all time-series forecasting models.

All concrete forecasters (ARIMA, Prophet, LSTM, ensemble) must implement
this interface so the forecasting service layer can swap models without
modifying calling code.

Protocol
--------
The fit/predict/metrics pattern mirrors scikit-learn's estimator convention,
adapted for time-series forecasters:

    forecaster = ConcreteForecaster(...)
    forecaster.fit(train_series)
    result = forecaster.predict(horizon_days=90)
    metrics = forecaster.get_fit_metrics()

Thread safety
-------------
Fitted forecasters are not thread-safe — the fitted model object holds state.
For concurrent requests, each request must instantiate and fit its own
forecaster instance.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

import pandas as pd

from app.forecasting.models.results import ForecastResult, ModelFitMetrics


class NotFittedError(RuntimeError):
    """Raised when predict() is called before fit()."""


class BaseForecaster(ABC):
    """Minimal contract for all forecasting models.

    Subclasses must implement ``fit``, ``predict``, and ``get_fit_metrics``.
    The ``is_fitted`` property is checked by the service layer before calling
    ``predict`` to produce a clear error rather than a cryptic AttributeError.
    """

    # ── Required abstract methods ─────────────────────────────────────────────

    @abstractmethod
    def fit(self, train: pd.Series) -> "BaseForecaster":
        """Fit the model on *train*.

        Parameters
        ----------
        train:
            pd.Series with DatetimeIndex in ascending order.  Values should be
            the cleaned level series (rates, prices) — not returns.  The
            forecaster is responsible for applying any required transformations
            (differencing, log transform) internally.

        Returns
        -------
        self
            Enables method chaining: ``forecaster.fit(train).predict(90)``.
        """
        ...

    @abstractmethod
    def predict(
        self,
        horizon: int,
        *,
        alpha_outer: float = 0.10,
        alpha_inner: float = 0.50,
    ) -> ForecastResult:
        """Generate a forecast for *horizon* business days ahead.

        Parameters
        ----------
        horizon:
            Number of business days to forecast.
        alpha_outer:
            Significance level for the outer confidence band.
            0.10 → 90% CI.
        alpha_inner:
            Significance level for the inner confidence band.
            0.50 → 50% CI.

        Returns
        -------
        ForecastResult
            Contains the full forecast path and both confidence bands.
        """
        ...

    @abstractmethod
    def get_fit_metrics(self) -> ModelFitMetrics:
        """Return in-sample fit quality metrics from the fitted model.

        Must be called after ``fit``; raises ``NotFittedError`` otherwise.
        """
        ...

    # ── Concrete helpers ──────────────────────────────────────────────────────

    @property
    def is_fitted(self) -> bool:
        """Return True after a successful ``fit`` call."""
        return getattr(self, "_fitted", False)

    @property
    def model_name(self) -> str:
        """Human-readable identifier for this model class."""
        return self.__class__.__name__

    def _require_fitted(self) -> None:
        """Raise ``NotFittedError`` if the model has not been fitted."""
        if not self.is_fitted:
            raise NotFittedError(
                f"{self.model_name} must be fitted before calling predict(). "
                "Call fit(train_series) first."
            )
