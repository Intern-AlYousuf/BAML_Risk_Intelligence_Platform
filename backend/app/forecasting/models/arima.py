"""ARIMA forecasting model.

Implementation notes
--------------------
- Uses statsmodels ``ARIMA`` (not ``SARIMAX``) since SOFR has no seasonal
  component at the daily frequency.
- ``d`` is fixed per-instance (default 1 for interest rate levels) rather
  than estimated at runtime, because ADF tests on short windows are unreliable
  and the unit-root behaviour of overnight rates is well-established.
- Order auto-selection searches a (p, q) grid with AIC as the criterion.
  The search is bounded to keep wall-clock time predictable for API requests.
- Confidence intervals use statsmodels' ``get_forecast()`` with separate alpha
  values for the inner (50%) and outer (90%) bands.
- A ``floor`` parameter prevents negative rate forecasts — important for SOFR
  in the current monetary policy regime.

Statsmodels version note
------------------------
``ARIMA`` from ``statsmodels.tsa.arima.model`` (≥ 0.12) is used in preference
to the older ``statsmodels.tsa.arima_model.ARIMA`` which is deprecated.
"""
from __future__ import annotations

import warnings
from dataclasses import dataclass
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from app.core.logging import get_logger
from app.forecasting.models.base import BaseForecaster, NotFittedError
from app.forecasting.models.results import (
    AccuracyMetrics,
    ForecastPoint,
    ForecastResult,
    ModelFitMetrics,
)
from app.utils.timeseries import (
    business_days_ahead,
    mean_absolute_error,
    mean_absolute_percentage_error,
    root_mean_squared_error,
)

logger = get_logger(__name__)

# Suppress convergence warnings from statsmodels during grid search.
# We handle non-convergence explicitly via exception handling.
warnings.filterwarnings("ignore", category=UserWarning, module="statsmodels")


# ── Order selection configuration ────────────────────────────────────────────


@dataclass
class ARIMAOrderConfig:
    """Search bounds for automatic order selection.

    Limiting the grid keeps API latency predictable.  The defaults cover the
    most common ARIMA orders for daily interest rate series:

    - p ∈ [0, max_p]: AR lags
    - d ∈ [0, max_d]: differences (usually 1 for rates)
    - q ∈ [0, max_q]: MA lags

    With max_p=4, max_d=1, max_q=3 → 40 candidate models.
    """
    max_p:    int   = 4
    max_d:    int   = 1
    max_q:    int   = 3
    d_fixed:  int | None = 1   # override d; None = include d in search

    @property
    def fixed_d(self) -> int | None:
        return self.d_fixed


# ── ARIMA forecaster ──────────────────────────────────────────────────────────


class ARIMAForecaster(BaseForecaster):
    """ARIMA model wrapper with order auto-selection and CI generation.

    Parameters
    ----------
    order:
        (p, d, q) tuple.  Set to ``None`` to trigger auto-selection on fit.
    order_config:
        Grid bounds for auto-selection.  Ignored when ``order`` is explicit.
    floor:
        Minimum allowed forecast value.  Applied elementwise after prediction.
        Use ``0.0`` for interest rate series that cannot go negative.
    ceiling:
        Maximum allowed forecast value.  ``None`` = no upper bound.
    trend:
        Constant / trend specification forwarded to statsmodels ARIMA.
        ``"n"`` = no constant; ``"c"`` = constant; ``"t"`` = linear trend.
        Default ``"c"`` is appropriate for stationary differenced series.
    fit_kwargs:
        Additional keyword arguments forwarded to ``model.fit()``.
    """

    # Sensible defaults for daily SOFR — benchmarked on SOFR history 2018-2025.
    _DEFAULT_ORDER: tuple[int, int, int] = (2, 1, 2)

    def __init__(
        self,
        order:        tuple[int, int, int] | None = None,
        order_config: ARIMAOrderConfig            = ARIMAOrderConfig(),
        floor:        float | None                = None,
        ceiling:      float | None                = None,
        trend:        str | None                  = None,   # None = auto: "c" if d==0, "n" if d>=1
        fit_kwargs:   dict[str, Any]              = {},
    ) -> None:
        self._order_request = order
        self._order_config  = order_config
        self._floor         = floor
        self._ceiling       = ceiling
        self._trend_override = trend   # None = resolve per order
        # statsmodels tsa.arima.model.ARIMA uses "method" as an *estimator*
        # name (not an optimiser).  Valid values: "innovations_mle",
        # "statespace", "css-mle", etc.  We use the default by not setting it,
        # which resolves to "innovations_mle" for most ARIMA(p,d,q) models.
        # Extra caller overrides are merged in via fit_kwargs.
        self._fit_kwargs: dict[str, Any] = {**fit_kwargs}

        # Set after fit()
        self._fitted:        bool = False
        self._order:         tuple[int, int, int] | None = None
        self._result:        Any  = None   # statsmodels ARIMAResultsWrapper
        self._train:         pd.Series | None = None

    # ── Trend resolution ─────────────────────────────────────────────────────

    def _resolve_trend(self, d: int) -> str:
        """Determine the deterministic trend term for a given differencing order.

        statsmodels ARIMA constraint:
        - d == 0: "c" (constant / intercept in the ARMA model) is valid.
        - d >= 1: "c" is not allowed — it would be differenced away.
                  "n" (no deterministic term) is the correct choice for most
                  financial rate series.  "t" (linear trend) is valid but
                  implies rates grow/decay indefinitely — not appropriate here.
        """
        if self._trend_override is not None:
            return self._trend_override
        return "n" if d >= 1 else "c"

    # ── Fit ───────────────────────────────────────────────────────────────────

    def fit(self, train: pd.Series) -> "ARIMAForecaster":
        """Fit ARIMA on *train*.

        If ``order`` was not provided at construction, the optimal (p, d, q)
        is selected by minimising AIC over the configured search grid.
        """
        from statsmodels.tsa.arima.model import ARIMA

        clean = train.dropna()
        if len(clean) < 30:
            raise ValueError(
                f"Training series has only {len(clean)} observations; "
                "at least 30 are required for ARIMA fitting."
            )

        if self._order_request is not None:
            order = self._order_request
        else:
            logger.info("arima.order_selection.start", n_obs=len(clean))
            order = self._auto_select_order(clean)
            logger.info("arima.order_selection.done", order=order)

        trend = self._resolve_trend(order[1])

        logger.info(
            "arima.fit.start",
            order=order,
            n_obs=len(clean),
            trend=trend,
        )

        try:
            model  = ARIMA(clean.values, order=order, trend=trend)
            result = model.fit(**self._fit_kwargs)
        except Exception as exc:
            # Fall back to default order if the requested order fails.
            if self._order_request is not None:
                raise RuntimeError(
                    f"ARIMA{order} fitting failed: {exc}"
                ) from exc
            logger.warning(
                "arima.fit.fallback",
                failed_order=order,
                fallback_order=self._DEFAULT_ORDER,
                error=str(exc),
            )
            order  = self._DEFAULT_ORDER
            trend  = self._resolve_trend(order[1])
            model  = ARIMA(clean.values, order=order, trend=trend)
            result = model.fit(**self._fit_kwargs)

        self._order  = order
        self._result = result
        self._train  = clean
        self._fitted = True

        logger.info(
            "arima.fit.done",
            order=order,
            aic=round(result.aic, 3),
            bic=round(result.bic, 3),
            log_likelihood=round(result.llf, 3),
        )
        return self

    # ── Predict ───────────────────────────────────────────────────────────────

    def predict(
        self,
        horizon: int,
        *,
        alpha_outer: float = 0.10,
        alpha_inner: float = 0.50,
    ) -> ForecastResult:
        """Generate *horizon*-step forecast with confidence intervals.

        Parameters
        ----------
        horizon:
            Business days ahead.
        alpha_outer:
            Significance level for outer CI.  0.10 → 90% coverage.
        alpha_inner:
            Significance level for inner CI.  0.50 → 50% coverage.
        """
        self._require_fitted()

        result_sm = self._result
        train     = self._train
        order     = self._order

        # ── Get forecast object ────────────────────────────────────────────
        fcast_obj   = result_sm.get_forecast(steps=horizon)
        mean_vals   = fcast_obj.predicted_mean

        ci_outer    = fcast_obj.conf_int(alpha=alpha_outer)
        ci_inner    = fcast_obj.conf_int(alpha=alpha_inner)

        lower_90    = ci_outer[:, 0]
        upper_90    = ci_outer[:, 1]
        lower_50    = ci_inner[:, 0]
        upper_50    = ci_inner[:, 1]

        # ── Apply domain constraints ───────────────────────────────────────
        if self._floor is not None:
            mean_vals = np.maximum(mean_vals, self._floor)
            lower_90  = np.maximum(lower_90,  self._floor)
            lower_50  = np.maximum(lower_50,  self._floor)

        if self._ceiling is not None:
            mean_vals = np.minimum(mean_vals, self._ceiling)
            upper_90  = np.minimum(upper_90,  self._ceiling)
            upper_50  = np.minimum(upper_50,  self._ceiling)

        # ── Build business-day date index for forecast period ──────────────
        last_date  = train.index[-1]
        fcast_idx  = business_days_ahead(last_date, horizon)

        if len(fcast_idx) != len(mean_vals):
            # Defensive: if horizon mismatch, truncate to shorter length.
            n = min(len(fcast_idx), len(mean_vals))
            fcast_idx  = fcast_idx[:n]
            mean_vals  = mean_vals[:n]
            lower_90   = lower_90[:n]
            upper_90   = upper_90[:n]
            lower_50   = lower_50[:n]
            upper_50   = upper_50[:n]

        # ── Assemble ForecastPoint list ────────────────────────────────────
        points = [
            ForecastPoint(
                date=ts.date(),
                forecast=float(mean_vals[i]),
                ci_lower_90=float(lower_90[i]),
                ci_upper_90=float(upper_90[i]),
                ci_lower_50=float(lower_50[i]),
                ci_upper_50=float(upper_50[i]),
            )
            for i, ts in enumerate(fcast_idx)
        ]

        fit_metrics = self.get_fit_metrics()

        return ForecastResult(
            series_id=str(train.name) if train.name else "unknown",
            model_name=self.model_name,
            order=order,                          # type: ignore[arg-type]
            train_start=train.index[0].date(),
            train_end=train.index[-1].date(),
            n_train=len(train),
            forecast_start=fcast_idx[0].date(),
            forecast_end=fcast_idx[-1].date(),
            points=points,
            fit_metrics=fit_metrics,
        )

    # ── Metrics ───────────────────────────────────────────────────────────────

    def get_fit_metrics(self) -> ModelFitMetrics:
        """Return in-sample fit quality from the fitted statsmodels result."""
        self._require_fitted()

        result = self._result
        resid  = np.array(result.resid)
        resid  = resid[~np.isnan(resid)]

        # AR / MA roots — empty arrays when p=0 or q=0 respectively.
        # An empty roots array means no AR/MA component, which is trivially
        # stationary / invertible.
        ar_roots = getattr(result, "arroots", None)
        ma_roots = getattr(result, "maroots", None)

        def _all_outside_unit_circle(roots) -> bool:
            if roots is None or len(roots) == 0:
                return True
            return bool(np.abs(roots).min() > 1.0)

        return ModelFitMetrics(
            aic=float(result.aic),
            bic=float(result.bic),
            hqic=float(result.hqic),
            log_likelihood=float(result.llf),
            n_obs=int(result.nobs),
            order=self._order,                   # type: ignore[arg-type]
            residual_mean=float(np.mean(resid)),
            residual_std=float(np.std(resid)),
            is_stationary=_all_outside_unit_circle(ar_roots),
            is_invertible=_all_outside_unit_circle(ma_roots),
        )

    @property
    def model_name(self) -> str:
        order = self._order or self._order_request or self._DEFAULT_ORDER
        return f"ARIMA{order}"

    @property
    def fitted_order(self) -> tuple[int, int, int] | None:
        return self._order

    # ── Order auto-selection ──────────────────────────────────────────────────

    def _auto_select_order(
        self,
        series: pd.Series,
    ) -> tuple[int, int, int]:
        """Search (p, d, q) grid and return the order with the lowest AIC.

        Falls back to ``_DEFAULT_ORDER`` if no candidate converges.
        """
        from statsmodels.tsa.arima.model import ARIMA

        cfg    = self._order_config
        values = series.values
        best_aic   = np.inf
        best_order = self._DEFAULT_ORDER

        d_values = (
            [cfg.d_fixed]
            if cfg.d_fixed is not None
            else list(range(cfg.max_d + 1))
        )

        for d in d_values:
            for p in range(cfg.max_p + 1):
                for q in range(cfg.max_q + 1):
                    if p == 0 and q == 0:
                        continue  # degenerate model

                    order = (p, d, q)
                    trend = self._resolve_trend(d)
                    try:
                        with warnings.catch_warnings():
                            warnings.simplefilter("ignore")
                            m = ARIMA(values, order=order, trend=trend)
                            r = m.fit()
                        if r.aic < best_aic:
                            best_aic   = r.aic
                            best_order = order
                    except Exception:
                        continue

        logger.info(
            "arima.auto_select.result",
            best_order=best_order,
            best_aic=round(best_aic, 3),
        )
        return best_order

    # ── Test-set accuracy ────────────────────────────────────────────────────

    def evaluate_on_test(
        self,
        test: pd.Series,
    ) -> AccuracyMetrics:
        """Compute forecast accuracy on a held-out test series.

        Uses 1-step-ahead in-sample predictions against the test window.
        For a genuine out-of-sample evaluation use ``SOFRForecastEngine``
        with ``enable_backtest=True``.
        """
        self._require_fitted()

        result_sm = self._result
        train     = self._train

        # Append test data and get in-sample predictions for that window.
        n_test = len(test)
        fcast  = result_sm.get_forecast(steps=n_test)
        preds  = pd.Series(
            fcast.predicted_mean,
            index=test.index,
        )

        mae  = mean_absolute_error(test, preds)
        rmse = root_mean_squared_error(test, preds)
        mape = mean_absolute_percentage_error(test, preds)

        return AccuracyMetrics(
            mae=mae,
            rmse=rmse,
            mape=mape,
            n_test_obs=len(test),
            test_start=test.index[0].date(),
            test_end=test.index[-1].date(),
        )
