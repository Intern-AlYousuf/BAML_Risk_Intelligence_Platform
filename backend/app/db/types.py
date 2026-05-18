"""Domain-specific SQLAlchemy column types for the BAML Risk platform.

Why not Float?
──────────────
IEEE 754 floating-point arithmetic cannot represent most decimal fractions
exactly.  For a financial platform, 0.1 + 0.2 != 0.3 is a showstopper —
rounding errors compound across thousands of scenario calculations.

`NUMERIC` / `DECIMAL` stores exact decimal values in the database and maps
to Python's `decimal.Decimal`, which supports arbitrary-precision arithmetic.
All financial figures in this codebase must use one of the types below.

Type selection guide
────────────────────
  DecimalMoney   — monetary notional amounts, prices, P&L (±1 quadrillion, 6dp)
  DecimalRate    — interest rates, FX spot/forward rates (up to 8 decimal places)
  DecimalRatio   — dimensionless ratios: hedge ratio, delta, weight (4dp, 0–1+)
  DecimalBPS     — basis points and spreads expressed as decimals (6dp)
  JSONBType      — structured payloads: simulation paths, risk vectors
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import Numeric
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import mapped_column
from typing import Any


# ── Numeric precision constants ───────────────────────────────────────────────

# Total digits / decimal places chosen to avoid PostgreSQL's 131072-digit limit
# while providing ample headroom for institutional-scale notionals.

_MONEY_PRECISION = 28      # total significant digits
_MONEY_SCALE = 6           # decimal places  (e.g. 1_000_000_000.123456)

_RATE_PRECISION = 18       # sufficient for 8dp rates with 10-digit integer part
_RATE_SCALE = 8            # e.g. 0.05123456 (5.123456%)

_RATIO_PRECISION = 10      # e.g. 0.9999
_RATIO_SCALE = 6           # hedge ratio, delta, weight

_BPS_PRECISION = 14
_BPS_SCALE = 6             # e.g. 0.012345 = 123.45 bps


# ── Reusable SQLAlchemy Numeric types ─────────────────────────────────────────

class MoneyType(Numeric):
    """Exact-precision type for monetary notional amounts and prices.

    Maps to NUMERIC(28, 6) in PostgreSQL.
    Python type: decimal.Decimal

    Use for: notional, strike, close_price, P&L, portfolio value.
    """
    def __init__(self) -> None:
        super().__init__(precision=_MONEY_PRECISION, scale=_MONEY_SCALE, asdecimal=True)


class RateType(Numeric):
    """Exact-precision type for interest rates and FX rates.

    Maps to NUMERIC(18, 8) in PostgreSQL.
    Python type: decimal.Decimal

    Use for: base_rate, spot_rate, forward_rate, yield, discount_factor.
    """
    def __init__(self) -> None:
        super().__init__(precision=_RATE_PRECISION, scale=_RATE_SCALE, asdecimal=True)


class RatioType(Numeric):
    """Exact-precision type for dimensionless ratios.

    Maps to NUMERIC(10, 6) in PostgreSQL.
    Python type: decimal.Decimal

    Use for: hedge_ratio, delta, gamma, weight, utilisation.
    Range: typically 0.0 to 1.0 (though leverage ratios may exceed 1).
    """
    def __init__(self) -> None:
        super().__init__(precision=_RATIO_PRECISION, scale=_RATIO_SCALE, asdecimal=True)


class BPSType(Numeric):
    """Exact-precision type for basis-point spreads stored as decimals.

    Maps to NUMERIC(14, 6) in PostgreSQL.
    Python type: decimal.Decimal

    Convention: store in decimal form (0.0100 = 100 bps = 1%).
    Use for: credit spreads, bid-ask spreads, OAS.
    """
    def __init__(self) -> None:
        super().__init__(precision=_BPS_PRECISION, scale=_BPS_SCALE, asdecimal=True)


# ── Singleton instances (import and use directly) ─────────────────────────────
# Using instances avoids constructing a new type object per column definition.

MONEY = MoneyType()
RATE = RateType()
RATIO = RatioType()
BPS = BPSType()


# ── JSONB re-export ───────────────────────────────────────────────────────────
# Import JSONB from this module rather than directly from dialects so all
# type imports stay under app.db.types and are easy to swap for other dialects.

__all__ = [
    "MONEY",
    "RATE",
    "RATIO",
    "BPS",
    "MoneyType",
    "RateType",
    "RatioType",
    "BPSType",
    "JSONB",
    "Decimal",
]
