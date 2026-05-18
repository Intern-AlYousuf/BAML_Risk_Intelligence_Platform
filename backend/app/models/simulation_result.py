import uuid
from decimal import Decimal

from sqlalchemy import CheckConstraint, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDMixin, uuid_fk
from app.db.types import MONEY


class SimulationResult(UUIDMixin, TimestampMixin, Base):
    """Persisted outcome of a simulation job.

    Summary statistics are stored here; full simulation paths (thousands of
    floats per iteration) are stored externally (object storage / time-series
    DB) and referenced by `result_ref` in a future column.

    Note: SoftDelete is intentionally excluded — simulation results are
    immutable records; superseded results are archived by status, not deleted.
    """

    __tablename__ = "simulation_results"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','running','completed','failed')",
            name="simulation_status",
        ),
    )

    scenario_id: Mapped[uuid.UUID | None] = uuid_fk("scenarios.id", ondelete="SET NULL")

    simulation_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    iterations: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")

    # Summary statistics — stored as NUMERIC for reproducible comparisons.
    mean_value: Mapped[Decimal | None] = mapped_column(MONEY)
    std_dev: Mapped[Decimal | None] = mapped_column(MONEY)
    var_95: Mapped[Decimal | None] = mapped_column(MONEY)
    var_99: Mapped[Decimal | None] = mapped_column(MONEY)
    notes: Mapped[str | None] = mapped_column(Text)
