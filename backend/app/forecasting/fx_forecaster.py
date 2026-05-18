"""FX forecasting engine placeholder.

Concrete implementations (ARIMA, LSTM, ensemble) will inherit from
FXForecasterBase and be selected at runtime by the forecasting service.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class ForecastResult:
    ticker: str
    horizon_days: int
    point_forecast: list[float]
    upper_band: list[float]
    lower_band: list[float]
    confidence: float


class FXForecasterBase(ABC):
    @abstractmethod
    def fit(self, historical_prices: list[float]) -> None: ...

    @abstractmethod
    def predict(self, horizon_days: int) -> ForecastResult: ...


class NaiveFXForecaster(FXForecasterBase):
    """Random-walk baseline — returns last observed price repeated."""

    def fit(self, historical_prices: list[float]) -> None:
        self._last_price = historical_prices[-1] if historical_prices else 0.0

    def predict(self, horizon_days: int) -> ForecastResult:
        raise NotImplementedError("NaiveFXForecaster.predict not yet implemented")
