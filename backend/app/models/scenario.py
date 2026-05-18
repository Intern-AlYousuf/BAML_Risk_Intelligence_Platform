import uuid
from decimal import Decimal

from sqlalchemy import CheckConstraint, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import AuditMixin, Base, SoftDeleteMixin, TimestampMixin, UUIDMixin
from app.db.types import RATE, RATIO


class Scenario(UUIDMixin, TimestampMixin, AuditMixin, SoftDeleteMixin, Base):
    """A named risk scenario used as the root context for hedges and simulations.

    Financial parameters here are intentionally sparse — the full parameter
    set is implemented in the scenario service and calculation layer.
    """

    __tablename__ = "scenarios"
    __table_args__ = (
        CheckConstraint("status IN ('draft','active','archived')", name="scenario_status"),
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft")

    # Stored as NUMERIC for exact decimal arithmetic — not Float.
    base_rate: Mapped[Decimal | None] = mapped_column(RATE)
    stress_factor: Mapped[Decimal | None] = mapped_column(RATIO)
    horizon_days: Mapped[int | None] = mapped_column(Integer)
