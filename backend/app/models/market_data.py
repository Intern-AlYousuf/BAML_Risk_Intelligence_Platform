from datetime import date
from decimal import Decimal

from sqlalchemy import Date, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDMixin
from app.db.types import MONEY


class MarketData(UUIDMixin, TimestampMixin, Base):
    """A single OHLCV data point for a financial instrument on a given date.

    The unique constraint on (ticker, data_date, source) prevents duplicate
    ingestion from the same data vendor.

    Note: the constraint is named explicitly here (bypassing the naming
    convention) because it spans three columns — the convention token
    %(column_0_name)s only captures the first column.  The explicit name
    'uq_market_data_ticker_date_source' is stable and documented here.
    """

    __tablename__ = "market_data"
    __table_args__ = (
        UniqueConstraint(
            "ticker", "data_date", "source",
            name="uq_market_data_ticker_date_source",
        ),
    )

    ticker: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    asset_class: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    data_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(100), nullable=False)

    # Prices stored as NUMERIC — exact decimal required for corporate actions,
    # adjusted close comparisons, and P&L attribution calculations.
    open_price: Mapped[Decimal | None] = mapped_column(MONEY)
    high_price: Mapped[Decimal | None] = mapped_column(MONEY)
    low_price: Mapped[Decimal | None] = mapped_column(MONEY)
    close_price: Mapped[Decimal | None] = mapped_column(MONEY)
    volume: Mapped[Decimal | None] = mapped_column(MONEY)
