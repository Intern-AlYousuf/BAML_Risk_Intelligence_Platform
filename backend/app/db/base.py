"""SQLAlchemy declarative base, shared metadata, and reusable model mixins.

Design contract
───────────────
Every ORM model in this codebase must:
  1. Inherit from Base (provides naming convention + __repr__)
  2. Include UUIDMixin or IntegerPKMixin (provides a primary key)
  3. Include TimestampMixin (provides created_at / updated_at)

Optional mixins:
  - SoftDeleteMixin  — for legally-retained financial records
  - AuditMixin       — for user-stamped audit trails

Helper utilities:
  - uuid_fk()  — factory for FK columns that point to UUID-keyed tables
  - tablename_for()  — snake_case table name derivation (explicit is preferred)
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, Integer, MetaData, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# ── Constraint naming convention ──────────────────────────────────────────────
# Alembic uses these tokens to generate stable, human-readable constraint names.
# Without them, PostgreSQL assigns opaque auto-names; autogenerate then emits
# spurious DROP/CREATE pairs on every revision because names don't match.
#
# Token reference: https://docs.sqlalchemy.org/en/20/core/constraints.html#configuring-a-naming-convention

NAMING_CONVENTION: dict[str, str] = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


# ── Declarative base ──────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    """Root declarative base shared by every ORM model.

    Responsibilities:
    - Carries the MetaData naming convention (required for Alembic autogenerate).
    - Provides `__repr__` and `to_dict()` as universal debugging utilities.

    Do not instantiate Base directly.
    """

    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    def __repr__(self) -> str:
        pk = getattr(self, "id", None)
        table = getattr(self.__class__, "__tablename__", type(self).__name__)
        return f"<{type(self).__name__} table={table} id={pk!r}>"

    def to_dict(self) -> dict[str, Any]:
        """Return a plain dict of all mapped column values.

        Intended for debugging, test assertions, and seed scripts only.
        Do not use to build API responses — schemas own that contract.
        """
        return {
            col.key: getattr(self, col.key)
            for col in self.__table__.columns
        }


# ── Primary key mixins ────────────────────────────────────────────────────────

class UUIDMixin:
    """UUID v4 primary key — the default for all domain entities.

    Rationale over BIGSERIAL:
    - No sequential-ID enumeration on public REST endpoints.
    - Client-side ID generation before the DB round-trip (optimistic inserts).
    - Safe cross-shard merge without collision risk (future partitioning).

    `sort_order=-10` ensures `id` is rendered first in DDL and migrations.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        sort_order=-10,
    )


class IntegerPKMixin:
    """Auto-increment integer primary key — for reference / lookup tables.

    Use this (instead of UUIDMixin) for small, stable tables whose rows are
    referenced heavily via FK joins (e.g. asset_classes, currencies, statuses).
    Integer FKs are narrower, faster to index, and cheaper to join.
    """

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
        sort_order=-10,
    )


# ── Audit timestamp mixin ─────────────────────────────────────────────────────

class TimestampMixin:
    """Immutable audit timestamps applied to every persisted entity.

    `server_default=func.now()` means the database populates these on INSERT,
    so they are trustworthy even for rows written outside the ORM (seed scripts,
    raw SQL, DB migrations).

    `onupdate=func.now()` keeps `updated_at` current on ORM-driven UPDATEs.
    Note: raw SQL UPDATE statements bypass `onupdate`; Alembic migrations must
    set `updated_at` explicitly when they modify existing rows.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        sort_order=98,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        sort_order=99,
    )


# ── Soft-delete mixin ─────────────────────────────────────────────────────────

class SoftDeleteMixin:
    """Logical deletion for legally-retained financial records.

    Apply to any entity that cannot be hard-deleted (scenarios, hedges,
    simulation results, audit logs).  Physical rows are never removed — instead
    `deleted_at` is set to the deletion timestamp.

    Usage in services:
        await session.execute(
            select(Scenario).where(Scenario.deleted_filter())
        )
        scenario.mark_deleted()   # sets deleted_at to now (UTC)
    """

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
        sort_order=100,
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

    def mark_deleted(self) -> None:
        """Set deleted_at to the current UTC timestamp.

        Call this from the service layer; do not flush manually — the session
        context manager will commit on clean exit.
        """
        self.deleted_at = datetime.now(timezone.utc)

    @classmethod
    def deleted_filter(cls):
        """Return a WHERE clause fragment that excludes soft-deleted rows.

        Example:
            stmt = select(Scenario).where(Scenario.deleted_filter())
        """
        return cls.deleted_at.is_(None)  # type: ignore[attr-defined]


# ── Audit author mixin ────────────────────────────────────────────────────────

class AuditMixin:
    """Who created / last modified the row.

    Populated by the service layer from the JWT `sub` claim before flush.
    Columns are nullable to support seed data and background jobs that run
    outside a user request context.
    """

    created_by: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        sort_order=96,
    )
    updated_by: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        sort_order=97,
    )


# ── Column factory helpers ────────────────────────────────────────────────────

def uuid_fk(
    target: str,
    *,
    nullable: bool = True,
    ondelete: str = "SET NULL",
    index: bool = True,
) -> Any:
    """Build a mapped_column for a UUID foreign key with minimal boilerplate.

    Args:
        target:   Dotted table.column reference, e.g. "scenarios.id".
        nullable: Whether NULL is permitted (True for optional relationships).
        ondelete: Referential action on parent deletion ("SET NULL" | "CASCADE"
                  | "RESTRICT").  Default is SET NULL so child rows survive
                  parent deletion — appropriate for financial audit records.
        index:    Create a B-tree index on this column (almost always wanted).

    Usage:
        class HedgeConfiguration(UUIDMixin, TimestampMixin, Base):
            scenario_id: Mapped[uuid.UUID | None] = uuid_fk("scenarios.id")
    """
    from sqlalchemy import ForeignKey  # local import avoids circular risk
    return mapped_column(
        UUID(as_uuid=True),
        ForeignKey(target, ondelete=ondelete),
        nullable=nullable,
        index=index,
    )


def tablename_for(class_name: str) -> str:
    """Convert a CamelCase class name to a snake_case table name.

    HedgeConfiguration → hedge_configurations
    MarketData         → market_data
    FXRate             → fx_rate

    Prefer setting __tablename__ explicitly on each model.  Use this helper
    in tests or tooling, not as an automatic __tablename__ override.
    """
    # Insert underscore before sequences of uppercase followed by lowercase
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", class_name)
    s = re.sub(r"([a-z\d])([A-Z])", r"\1_\2", s)
    return s.lower() + "s"
