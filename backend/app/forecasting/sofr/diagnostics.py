"""SOFR-specific model diagnostics.

Residual checking and pre-fit stationarity interpretation for the SOFR
forecasting engine.  These functions are called by the engine after fitting
and their results are surfaced in the API response for transparency.

Stationarity interpretation for SOFR
--------------------------------------
SOFR levels are I(1): they have a unit root because the Fed funds rate (which
anchors SOFR) follows a step-function driven by FOMC decisions.  First
differences are approximately stationary — a well-specified ARIMA(p, 1, q)
model should produce stationary, white-noise residuals.

If the ADF test on *residuals* rejects the null (p < 0.05), the residuals are
stationary, which is the desired outcome confirming good model fit.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from app.core.logging import get_logger
from app.utils.timeseries import StationarityResult, adf_test, compute_acf_pacf

logger = get_logger(__name__)


# ── Residual diagnostics result ───────────────────────────────────────────────


@dataclass
class ResidualDiagnostics:
    """Outcome of residual checking after model fitting.

    All tests use 5% significance unless noted.

    Attributes
    ----------
    n_residuals:
        Number of residuals examined.
    mean:
        Residual mean — should be close to 0 for an unbiased model.
    std:
        Residual standard deviation — proxy for model uncertainty.
    ljung_box_stat:
        Ljung-Box Q-statistic for serial autocorrelation.
    ljung_box_pvalue:
        p-value for Ljung-Box test.  > 0.05 → no significant autocorrelation.
    is_white_noise:
        True when Ljung-Box p-value > 0.05 (no detected autocorrelation).
    jarque_bera_stat:
        Jarque-Bera test statistic for normality.
    jarque_bera_pvalue:
        p-value for Jarque-Bera test.  < 0.05 → residuals are non-normal.
    is_normal:
        True when Jarque-Bera p-value ≥ 0.05.
    adf_stationarity:
        ADF test on residuals.  Stationary residuals confirm good model fit.
    interpretation:
        Human-readable summary for surfacing in API responses.
    """
    n_residuals:          int
    mean:                 float
    std:                  float
    ljung_box_stat:       float
    ljung_box_pvalue:     float
    is_white_noise:       bool
    jarque_bera_stat:     float
    jarque_bera_pvalue:   float
    is_normal:            bool
    adf_stationarity:     StationarityResult
    interpretation:       str

    def to_dict(self) -> dict[str, Any]:
        return {
            "n_residuals":       self.n_residuals,
            "mean":              round(self.mean, 6),
            "std":               round(self.std, 6),
            "ljung_box_stat":    round(self.ljung_box_stat, 4),
            "ljung_box_pvalue":  round(self.ljung_box_pvalue, 4),
            "is_white_noise":    self.is_white_noise,
            "jarque_bera_stat":  round(self.jarque_bera_stat, 4),
            "jarque_bera_pvalue": round(self.jarque_bera_pvalue, 4),
            "is_normal":         self.is_normal,
            "adf_p_value":       round(self.adf_stationarity.p_value, 4),
            "residuals_stationary": self.adf_stationarity.is_stationary,
            "interpretation":    self.interpretation,
        }


# ── Stationarity context for SOFR levels ─────────────────────────────────────


@dataclass
class SOFRStationarityCheck:
    """Pre-fit stationarity assessment of SOFR levels and first differences.

    Levels are expected to be I(1); first differences I(0).
    """
    levels_result:  StationarityResult
    diff1_result:   StationarityResult
    recommended_d:  int
    interpretation: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "levels": {
                "p_value":        round(self.levels_result.p_value, 4),
                "is_stationary":  self.levels_result.is_stationary,
                "test_statistic": round(self.levels_result.test_statistic, 4),
            },
            "first_difference": {
                "p_value":        round(self.diff1_result.p_value, 4),
                "is_stationary":  self.diff1_result.is_stationary,
                "test_statistic": round(self.diff1_result.test_statistic, 4),
            },
            "recommended_d":   self.recommended_d,
            "interpretation":  self.interpretation,
        }


# ── Public diagnostic functions ───────────────────────────────────────────────


def check_residuals(
    residuals:  pd.Series | np.ndarray,
    n_lags:     int = 10,
) -> ResidualDiagnostics:
    """Run residual diagnostics after model fitting.

    Parameters
    ----------
    residuals:
        Model residuals (fitted_values - actual).  NaN values are dropped.
    n_lags:
        Number of lags for Ljung-Box test.  10 is standard for daily series.
    """
    from statsmodels.stats.diagnostic import acorr_ljungbox
    from statsmodels.stats.stattools import jarque_bera

    if isinstance(residuals, pd.Series):
        resid = residuals.dropna().values
    else:
        resid = residuals[~np.isnan(residuals)]

    if len(resid) < 20:
        logger.warning("diagnostics.residuals.too_short", n=len(resid))

    # Ljung-Box: H0 = no autocorrelation up to n_lags
    lb_result  = acorr_ljungbox(resid, lags=[n_lags], return_df=True)
    lb_stat    = float(lb_result["lb_stat"].iloc[-1])
    lb_pvalue  = float(lb_result["lb_pvalue"].iloc[-1])

    # Jarque-Bera: H0 = residuals are normally distributed
    jb_stat, jb_pvalue, _, _ = jarque_bera(resid)

    # ADF on residuals: H0 = unit root (non-stationarity)
    resid_series = pd.Series(resid)
    adf          = adf_test(resid_series, significance_level=0.05)

    is_white_noise = lb_pvalue > 0.05
    is_normal      = jb_pvalue >= 0.05

    interpretation = _build_residual_interpretation(
        is_white_noise=is_white_noise,
        is_normal=is_normal,
        is_stationary=adf.is_stationary,
        mean=float(np.mean(resid)),
    )

    return ResidualDiagnostics(
        n_residuals=len(resid),
        mean=float(np.mean(resid)),
        std=float(np.std(resid)),
        ljung_box_stat=lb_stat,
        ljung_box_pvalue=lb_pvalue,
        is_white_noise=is_white_noise,
        jarque_bera_stat=float(jb_stat),
        jarque_bera_pvalue=float(jb_pvalue),
        is_normal=is_normal,
        adf_stationarity=adf,
        interpretation=interpretation,
    )


def check_sofr_stationarity(
    sofr_levels: pd.Series,
) -> SOFRStationarityCheck:
    """Assess stationarity of SOFR levels and first differences.

    Expected outcome: levels I(1), first differences I(0), recommended d=1.
    """
    levels_adf = adf_test(sofr_levels, significance_level=0.05)
    diff1       = sofr_levels.diff().dropna()
    diff1_adf  = adf_test(diff1, significance_level=0.05)

    if not levels_adf.is_stationary and diff1_adf.is_stationary:
        recommended_d = 1
        msg = (
            "SOFR levels are non-stationary (ADF p={:.3f}); "
            "first differences are stationary (ADF p={:.3f}). "
            "d=1 is confirmed — standard ARIMA(p,1,q) specification."
        ).format(levels_adf.p_value, diff1_adf.p_value)

    elif levels_adf.is_stationary:
        recommended_d = 0
        msg = (
            "SOFR levels appear stationary (ADF p={:.3f}) in this window — "
            "possibly a flat-rate regime.  d=0 may be appropriate, but d=1 "
            "is conservative and will not overfit."
        ).format(levels_adf.p_value)

    else:
        recommended_d = 1
        msg = (
            "Both levels and first differences show non-stationarity.  "
            "d=1 is applied as a conservative default.  Consider using a "
            "longer history or checking for structural breaks."
        )

    logger.info(
        "sofr.stationarity_check",
        levels_pvalue=round(levels_adf.p_value, 4),
        diff1_pvalue=round(diff1_adf.p_value, 4),
        recommended_d=recommended_d,
    )

    return SOFRStationarityCheck(
        levels_result=levels_adf,
        diff1_result=diff1_adf,
        recommended_d=recommended_d,
        interpretation=msg,
    )


# ── Private helpers ───────────────────────────────────────────────────────────


def _build_residual_interpretation(
    *,
    is_white_noise: bool,
    is_normal:      bool,
    is_stationary:  bool,
    mean:           float,
) -> str:
    """Produce a human-readable residual summary for the API response."""
    parts: list[str] = []

    if is_white_noise:
        parts.append("Residuals pass the Ljung-Box test — no significant autocorrelation detected.")
    else:
        parts.append(
            "Ljung-Box test detected residual autocorrelation — consider increasing AR or MA order."
        )

    if is_normal:
        parts.append("Residuals are approximately normally distributed (Jarque-Bera p ≥ 0.05).")
    else:
        parts.append(
            "Residuals are non-normal — fat tails expected for rate series. "
            "CI coverage may be slightly underestimated at the extremes."
        )

    if is_stationary:
        parts.append("Residuals are stationary, confirming adequate model fit.")
    else:
        parts.append(
            "Residuals show a unit root — the model may be under-differenced. "
            "Verify d parameter."
        )

    if abs(mean) > 0.01:
        parts.append(
            f"Non-zero residual mean ({mean:.4f}) suggests systematic bias — "
            "check for structural breaks or omitted trend."
        )

    return "  ".join(parts)
