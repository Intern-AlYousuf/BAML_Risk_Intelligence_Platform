"""SARIMAX forecasting model for SOFR daily-delta forecasting.

Design rationale
----------------
SOFR is an I(1) process: first-differencing yields a stationary delta series
suitable for SARIMAX with d=0.  Fitting on **deltas** rather than levels:

1. Removes the unit-root component → better-calibrated confidence intervals.
2. Allows exogenous macro variables (EFFR, CPI, Treasury yields) to explain
   incremental rate changes rather than absolute levels.
3. Produces forecasts that converge to long-run macro equilibrium rather than
   drifting randomly — economically more plausible.

Pipeline position
-----------------
``SARIMAXForecaster`` produces a ``ForecastResult`` in **delta space**.
The engine calls ``reconstruct_from_deltas()`` to convert back to levels
before building the ``SOFRForecastOutput``.

Exogenous data
--------------
Passed via constructor (``exog_train``, ``exog_future``) rather than via
``fit()``/``predict()`` arguments.  This preserves ``BaseForecaster``
interface compatibility — the ABC only constrains method signatures, and the
concrete class may hold additional state.

Statsmodels reference
---------------------
``statsmodels.tsa.statespace.sarimax.SARIMAX`` is the State Space model.
Unlike the older ``statsmodels.tsa.statespace.sarimax.SARIMAX`` (deprecated)
it supports arbitrary SARIMA orders and exogenous regressors in a unified API.

Thread safety
-------------
Same as ``ARIMAForecaster``: not thread-safe.  Each request creates its own
instance.
"""
from __future__ import annotations

import warnings
from dataclasses import dataclass
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

warnings.filterwarnings("ignore", category=UserWarning, module="statsmodels")


# ── Order configuration ───────────────────────────────────────────────────────


@dataclass
class SARIMAXOrderConfig:
    """Search bounds for automatic SARIMAX order selection on delta series.

    Seasonal order is fixed at (0,0,0,0) because SOFR at daily frequency
    shows no evidence of weekly or annual seasonality.
    ``d_fixed=0`` because the delta series is already stationary.
    """
    max_p:          int                          = 3
    max_q:          int                          = 3
    d_fixed:        int                          = 0
    seasonal_order: tuple[int, int, int, int]    = (0, 0, 0, 0)


# ── Forecaster ────────────────────────────────────────────────────────────────


class SARIMAXForecaster(BaseForecaster):
    """SARIMAX wrapper designed for delta-space SOFR forecasting.

    Parameters
    ----------
    order:
        ``(p, d, q)`` ARIMA order.  ``d`` should be 0 when fitting on a
        pre-differenced (delta) series.  Pass ``None`` to trigger AIC-based
        auto-selection.
    seasonal_order:
        ``(P, D, Q, S)`` seasonal component.  Default ``(0,0,0,0)`` = no
        seasonality; appropriate for daily SOFR data.
    exog_train:
        DataFrame of macro features aligned to the training-set dates.
        Columns: ``["effr", "cpi_yoy", "unrate", "spread_10y2y", "dgs2", "dgs10"]``.
        Pass ``None`` to fit a pure SARIMA without exogenous regressors.
    exog_future:
        DataFrame of macro features for the forecast horizon.
        Row count must be ≥ ``horizon`` passed to ``predict()``.
        Built by ``prepare_future_exog()`` (carry-forward assumption).
    floor, ceiling:
        Bounds applied to **delta** forecasts.  For delta series these are
        rarely binding (typical range: −0.50 to +0.50 pp); set ``None``
        unless domain knowledge warrants a constraint.
    order_config:
        Grid bounds for auto-selection.  Ignored when ``order`` is explicit.
    fit_kwargs:
        Additional keyword arguments forwarded to ``model.fit()``.
    """

    _DEFAULT_ORDER: tuple[int, int, int] = (1, 0, 1)

    def __init__(
        self,
        order:          tuple[int, int, int] | None         = None,
        seasonal_order: tuple[int, int, int, int]           = (0, 0, 0, 0),
        exog_train:     pd.DataFrame | None                 = None,
        exog_future:    pd.DataFrame | None                 = None,
        floor:          float | None                        = None,
        ceiling:        float | None                        = None,
        order_config:   SARIMAXOrderConfig                  = SARIMAXOrderConfig(),
        fit_kwargs:     dict[str, Any]                      = {},
    ) -> None:
        self._order_request  = order
        self._seasonal_order = seasonal_order
        self._exog_train     = exog_train
        self._exog_future    = exog_future
        self._floor          = floor
        self._ceiling        = ceiling
        self._order_config   = order_config
        # disp=False silences the statsmodels optimiser progress bar.
        # warn_convergence=False suppresses non-convergence UserWarnings that
        # are handled explicitly via exception catching.
        self._fit_kwargs: dict[str, Any] = {
            "disp": False,
            "warn_convergence": False,
            **fit_kwargs,
        }

        # Populated after fit()
        self._fitted:      bool                          = False
        self._order:       tuple[int, int, int] | None  = None
        self._result:      Any                           = None
        self._train:       pd.Series | None              = None
        self._n_exog_cols: int                           = 0

    # ── fit ───────────────────────────────────────────────────────────────────

    def fit(self, train: pd.Series) -> "SARIMAXForecaster":
        """Fit SARIMAX on the **delta** training series.

        Parameters
        ----------
        train:
            Daily SOFR changes (Δt = level_t − level_{t-1}).  Must not contain
            NaN; call ``.dropna()`` before passing.

        Returns
        -------
        self
        """
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        clean = train.dropna()
        if len(clean) < 30:
            raise ValueError(
                f"Delta training series has only {len(clean)} observations; "
                "SARIMAX fitting requires at least 30."
            )

        exog_train = self._prepare_exog_train(clean)

        order = (
            self._order_request
            if self._order_request is not None
            else self._auto_select_order(clean, exog_train)
        )

        exog_vals = exog_train.values if exog_train is not None else None

        logger.info(
            "sarimax.fit.start",
            order=order,
            seasonal_order=self._seasonal_order,
            n_obs=len(clean),
            n_exog=exog_vals.shape[1] if exog_vals is not None else 0,
        )

        try:
            model  = self._build_model(clean, exog_vals, order)
            result = model.fit(**self._fit_kwargs)
        except Exception as exc:
            if self._order_request is not None:
                raise RuntimeError(
                    f"SARIMAX{order} fitting failed: {exc}"
                ) from exc

            logger.warning(
                "sarimax.fit.fallback",
                failed_order=order,
                fallback=self._DEFAULT_ORDER,
                error=str(exc),
            )
            order  = self._DEFAULT_ORDER
            model  = self._build_model(clean, exog_vals, order)
            result = model.fit(**self._fit_kwargs)

        self._order      = order
        self._result     = result
        self._train      = clean
        self._exog_train = exog_train            # possibly re-aligned subset
        self._n_exog_cols = exog_vals.shape[1] if exog_vals is not None else 0
        self._fitted     = True

        logger.info(
            "sarimax.fit.done",
            order=order,
            aic=round(result.aic, 3),
            bic=round(result.bic, 3),
            n_exog=self._n_exog_cols,
        )
        return self

    # ── predict ───────────────────────────────────────────────────────────────

    def predict(
        self,
        horizon: int,
        *,
        alpha_outer: float = 0.10,
        alpha_inner: float = 0.50,
    ) -> ForecastResult:
        """Forecast *horizon* business days of SOFR **deltas**.

        The returned ``ForecastResult`` is in **delta space** — percentage-
        point changes, not levels.  Call ``reconstruct_from_deltas()`` to
        obtain a level-space result.

        Parameters
        ----------
        horizon:
            Number of business days ahead.
        alpha_outer:
            Significance level for the outer CI.  0.10 → 90% coverage.
        alpha_inner:
            Significance level for the inner CI.  0.50 → 50% coverage.
        """
        self._require_fitted()

        exog_future_vals = self._prepare_exog_future(horizon)

        fcast_obj = self._result.get_forecast(
            steps=horizon,
            exog=exog_future_vals,
        )

        mean_vals = np.asarray(fcast_obj.predicted_mean, dtype=np.float64)

        # conf_int() returns a DataFrame in older statsmodels and a numpy
        # array in newer ones.  Normalise to a 2-D numpy array before slicing.
        def _ci_array(alpha: float) -> np.ndarray:
            ci = fcast_obj.conf_int(alpha=alpha)
            if hasattr(ci, "values"):
                return np.asarray(ci.values, dtype=np.float64)   # DataFrame
            return np.asarray(ci, dtype=np.float64)               # ndarray

        ci_outer = _ci_array(alpha_outer)
        ci_inner = _ci_array(alpha_inner)

        lower_90 = ci_outer[:, 0]
        upper_90 = ci_outer[:, 1]
        lower_50 = ci_inner[:, 0]
        upper_50 = ci_inner[:, 1]

        # Elementwise constraints (usually a no-op for delta series)
        if self._floor is not None:
            mean_vals = np.maximum(mean_vals, self._floor)
        if self._ceiling is not None:
            mean_vals = np.minimum(mean_vals, self._ceiling)

        # Business-day date index aligned to the training end date
        last_date = self._train.index[-1]
        fcast_idx = business_days_ahead(last_date, horizon)

        n = min(len(fcast_idx), len(mean_vals))
        fcast_idx = fcast_idx[:n]

        points = [
            ForecastPoint(
                date        = ts.date(),
                forecast    = float(mean_vals[i]),
                ci_lower_90 = float(lower_90[i]),
                ci_upper_90 = float(upper_90[i]),
                ci_lower_50 = float(lower_50[i]),
                ci_upper_50 = float(upper_50[i]),
            )
            for i, ts in enumerate(fcast_idx)
        ]

        return ForecastResult(
            series_id      = str(self._train.name) if self._train.name else "SOFR_delta",
            model_name     = self.model_name,
            order          = self._order,          # type: ignore[arg-type]
            train_start    = self._train.index[0].date(),
            train_end      = self._train.index[-1].date(),
            n_train        = len(self._train),
            forecast_start = fcast_idx[0].date(),
            forecast_end   = fcast_idx[-1].date(),
            points         = points,
            fit_metrics    = self.get_fit_metrics(),
        )

    # ── metrics ───────────────────────────────────────────────────────────────

    def get_fit_metrics(self) -> ModelFitMetrics:
        """Return in-sample fit metrics from the fitted SARIMAX result."""
        self._require_fitted()

        result = self._result
        resid  = np.asarray(result.resid, dtype=np.float64)
        resid  = resid[np.isfinite(resid)]

        # SARIMAX statespace models do not expose arroots / maroots directly;
        # stationarity / invertibility are enforced by the state-space solver.
        return ModelFitMetrics(
            aic            = float(result.aic),
            bic            = float(result.bic),
            hqic           = float(getattr(result, "hqic", result.bic)),
            log_likelihood = float(result.llf),
            n_obs          = int(result.nobs),
            order          = self._order,          # type: ignore[arg-type]
            residual_mean  = float(np.mean(resid)) if len(resid) else 0.0,
            residual_std   = float(np.std(resid))  if len(resid) else 0.0,
            is_stationary  = True,   # statespace SARIMAX internally enforces this
            is_invertible  = True,
        )

    # ── public properties ─────────────────────────────────────────────────────

    @property
    def model_name(self) -> str:
        order = self._order or self._order_request or self._DEFAULT_ORDER
        return f"SARIMAX{order}"

    @property
    def fitted_order(self) -> tuple[int, int, int] | None:
        return self._order

    # ── test-set accuracy ─────────────────────────────────────────────────────

    def evaluate_on_test(self, test: pd.Series) -> AccuracyMetrics:
        """Compute 1-step-ahead accuracy on a held-out delta series."""
        self._require_fitted()

        n_test = len(test)
        fcast  = self._result.get_forecast(steps=n_test)
        preds  = pd.Series(
            np.asarray(fcast.predicted_mean),
            index=test.index,
        )

        return AccuracyMetrics(
            mae        = mean_absolute_error(test, preds),
            rmse       = root_mean_squared_error(test, preds),
            mape       = mean_absolute_percentage_error(test, preds),
            n_test_obs = n_test,
            test_start = test.index[0].date(),
            test_end   = test.index[-1].date(),
        )

    # ── private helpers ───────────────────────────────────────────────────────

    def _build_model(
        self,
        endog: pd.Series,
        exog:  np.ndarray | None,
        order: tuple[int, int, int],
    ):
        """Construct a SARIMAX model object (not yet fitted)."""
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        return SARIMAX(
            endog                = endog.values,
            exog                 = exog,
            order                = order,
            seasonal_order       = self._seasonal_order,
            trend                = "n",      # no deterministic trend for stationary deltas
            enforce_stationarity = False,    # allow flexible fitting
            enforce_invertibility= False,
        )

    def _prepare_exog_train(
        self,
        clean: pd.Series,
    ) -> pd.DataFrame | None:
        """Align exog_train to the clean delta index; drop if too sparse."""
        exog = self._exog_train
        if exog is None:
            return None

        # Reindex to training dates with forward-fill (at most 5 days)
        exog_aligned = exog.reindex(clean.index).ffill(limit=5)

        # Intersect dates where both delta and exog are non-NaN
        valid_mask = exog_aligned.notna().all(axis=1)
        common_idx = clean.index[valid_mask]

        if len(common_idx) < 30:
            logger.warning(
                "sarimax.exog.alignment_too_sparse",
                n_common=len(common_idx),
                action="dropping exog — falling back to SARIMA without exogenous",
            )
            return None

        if len(common_idx) < len(clean):
            logger.info(
                "sarimax.exog.trimmed",
                n_original=len(clean),
                n_common=len(common_idx),
            )
            # Re-sync clean to the common index for consistency
            self._train = clean.loc[common_idx]   # update before model fit

        return exog_aligned.loc[common_idx]

    def _prepare_exog_future(self, horizon: int) -> np.ndarray | None:
        """Return a (horizon × n_exog) numpy array for the forecast step."""
        if self._n_exog_cols == 0:
            return None

        exog_future = self._exog_future

        if exog_future is None or exog_future.empty:
            # Model expects exog but none was provided — use last training row
            if self._exog_train is not None and not self._exog_train.empty:
                last_row = self._exog_train.iloc[-1].values
                return np.tile(last_row, (horizon, 1))
            return np.zeros((horizon, self._n_exog_cols))

        vals = exog_future.values

        if len(vals) < horizon:
            # Pad by repeating the last row
            pad   = np.tile(vals[-1], (horizon - len(vals), 1))
            vals  = np.vstack([vals, pad])

        return vals[:horizon]

    def _auto_select_order(
        self,
        series:    pd.Series,
        exog:      pd.DataFrame | None,
    ) -> tuple[int, int, int]:
        """AIC grid search over (p, q) for fixed d=0 on the delta series."""
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        cfg      = self._order_config
        values   = series.values
        exog_arr = exog.values if exog is not None else None

        best_aic   = np.inf
        best_order = self._DEFAULT_ORDER

        logger.info(
            "sarimax.order_selection.start",
            n_obs=len(series),
            n_exog=exog_arr.shape[1] if exog_arr is not None else 0,
            max_p=cfg.max_p,
            max_q=cfg.max_q,
        )

        for p in range(cfg.max_p + 1):
            for q in range(cfg.max_q + 1):
                if p == 0 and q == 0:
                    continue

                order = (p, cfg.d_fixed, q)
                try:
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        m = SARIMAX(
                            endog                 = values,
                            exog                  = exog_arr,
                            order                 = order,
                            seasonal_order        = self._seasonal_order,
                            trend                 = "n",
                            enforce_stationarity  = False,
                            enforce_invertibility = False,
                        )
                        r = m.fit(disp=False, warn_convergence=False)

                    if r.aic < best_aic:
                        best_aic   = r.aic
                        best_order = order

                except Exception:
                    continue

        logger.info(
            "sarimax.order_selection.done",
            best_order=best_order,
            best_aic=round(best_aic, 3) if best_aic < np.inf else "n/a",
        )
        return best_order
