import uuid
from decimal import Decimal

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import AuditMixin, Base, SoftDeleteMixin, TimestampMixin, UUIDMixin, uuid_fk
from app.db.types import MONEY, RATE, RATIO


class HedgeConfiguration(UUIDMixin, TimestampMixin, AuditMixin, SoftDeleteMixin, Base):
    """Instrument configuration for a hedging strategy within a scenario.

    Linked to a Scenario via an optional FK — SET NULL on parent deletion
    so hedge records survive scenario archival (audit requirement).
    """

    __tablename__ = "hedge_configurations"

    # uuid_fk() handles UUID(as_uuid=True) + ForeignKey + index in one call.
    scenario_id: Mapped[uuid.UUID | None] = uuid_fk("scenarios.id", ondelete="SET NULL")

    instrument_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)

    # NUMERIC types — exact decimal arithmetic for all financial quantities.
    notional: Mapped[Decimal | None] = mapped_column(MONEY)
    strike: Mapped[Decimal | None] = mapped_column(RATE)
    maturity_days: Mapped[int | None] = mapped_column(Integer)
    hedge_ratio: Mapped[Decimal | None] = mapped_column(RATIO)
