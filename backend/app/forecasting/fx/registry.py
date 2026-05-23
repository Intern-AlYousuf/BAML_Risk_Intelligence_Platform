"""FX pair registry — static configuration for all supported currency pairs.

Each entry declares the display metadata and domain constraints used by the
forecasting engine and Monte Carlo simulation.  The floor/ceiling values are
institutional bounds that prevent unrealistic paths without distorting the
ARIMA point forecast.

Pair naming convention
----------------------
Internal IDs use the form ``<BASE><QUOTE>`` where the *level* represents the
number of QUOTE units per 1 BASE unit.  For clarity:

  NGNUSD  → Yahoo Finance "USDNGN=X"  (NGN per USD, ~1600)
  INRUSD  → Yahoo Finance "USDINR=X"  (INR per USD, ~84)
  EURINR  → Yahoo Finance "EURINR=X"  (INR per EUR, ~90)

The display_name field carries the human-readable label shown on dashboards.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FXPairConfig:
    """Immutable configuration for a single FX pair.

    Attributes
    ----------
    pair_id:
        Internal identifier used as the ``pair`` query parameter.
    display_name:
        Human-readable label, e.g. ``"USD/NGN"``.
    yahoo_symbol:
        Yahoo Finance ticker string for historical data download.
    floor:
        Hard lower bound applied to simulated and deterministic level paths.
        Prevents currency collapse scenarios from producing nonsensical rates.
    ceiling:
        Hard upper bound.  Should exceed any historically observed extreme.
    preferred_order:
        Explicit ARIMA(p,0,q) order for the log-return model.  ``None`` lets
        the engine auto-select via AIC.
    annualized_vol_cap:
        Soft cap on annualised volatility used to detect simulation blow-up.
        Not enforced as a hard constraint — logged as a warning only.
    target_terminal_rate:
        Optional directional drift target for the full forecast horizon.
        When set, a smooth geometric drift overlay is applied to both the
        deterministic ARIMA forecast and every Monte Carlo path so that the
        P50 terminal value converges toward this rate.  ``None`` disables
        the overlay (all other pairs remain unaffected).
    """
    pair_id:              str
    display_name:         str
    yahoo_symbol:         str
    floor:                float
    ceiling:              float
    preferred_order:      tuple[int, int, int] | None = None
    annualized_vol_cap:   float       = 0.50   # 50% ann. vol — sanity-check threshold
    target_terminal_rate: float | None = None  # drift overlay target (level, e.g. 101.0)


# ── Pair registry ─────────────────────────────────────────────────────────────
#
# To add a new pair, extend this dict with a FXPairConfig entry.
# The pair_id becomes the valid value for the ``pair`` query parameter.

FX_PAIR_REGISTRY: dict[str, FXPairConfig] = {
    "NGNUSD": FXPairConfig(
        pair_id           = "NGNUSD",
        display_name      = "USD/NGN",
        yahoo_symbol      = "USDNGN=X",
        floor             = 500.0,
        ceiling           = 2500.0,
        preferred_order   = (1, 0, 1),
        annualized_vol_cap = 1.00,   # NGN can be very volatile
    ),
    "INRUSD": FXPairConfig(
        pair_id               = "INRUSD",
        display_name          = "USD/INR",
        yahoo_symbol          = "USDINR=X",
        floor                 = 60.0,
        ceiling               = 120.0,
        preferred_order       = (1, 0, 1),
        annualized_vol_cap    = 0.30,
        target_terminal_rate  = 101.0,   # ~5.2% annualised drift over 12-month horizon
    ),
    "EURINR": FXPairConfig(
        pair_id           = "EURINR",
        display_name      = "EUR/INR",
        yahoo_symbol      = "EURINR=X",
        floor             = 70.0,
        ceiling           = 130.0,
        preferred_order   = (1, 0, 1),
        annualized_vol_cap = 0.30,
    ),
}


def get_pair_config(pair_id: str) -> FXPairConfig:
    """Return the FXPairConfig for *pair_id* or raise ``KeyError``."""
    try:
        return FX_PAIR_REGISTRY[pair_id.upper()]
    except KeyError:
        valid = ", ".join(sorted(FX_PAIR_REGISTRY))
        raise KeyError(
            f"FX pair '{pair_id}' is not registered.  "
            f"Valid pairs: {valid}"
        )
