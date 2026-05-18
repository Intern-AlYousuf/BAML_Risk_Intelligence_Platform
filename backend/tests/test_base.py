"""Tests for the declarative base, mixins, and type system.

These tests verify structural contracts — column presence, type assignments,
naming conventions, and mixin behaviour — without touching real DB connections.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import (
    AuditMixin,
    Base,
    IntegerPKMixin,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDMixin,
    tablename_for,
    uuid_fk,
)
from app.db.types import BPS, MONEY, RATE, RATIO
from app.models.hedge_configuration import HedgeConfiguration
from app.models.market_data import MarketData
from app.models.scenario import Scenario
from app.models.simulation_result import SimulationResult


# ── Naming convention ─────────────────────────────────────────────────────────

def test_metadata_has_naming_convention() -> None:
    assert "ix" in Base.metadata.naming_convention
    assert "uq" in Base.metadata.naming_convention
    assert "fk" in Base.metadata.naming_convention
    assert "pk" in Base.metadata.naming_convention
    assert "ck" in Base.metadata.naming_convention


# ── tablename_for helper ──────────────────────────────────────────────────────

@pytest.mark.parametrize("class_name,expected", [
    ("Scenario",            "scenarios"),
    ("MarketData",          "market_datas"),   # note: explicit names are preferred
    ("HedgeConfiguration",  "hedge_configurations"),
    ("SimulationResult",    "simulation_results"),
])
def test_tablename_for(class_name: str, expected: str) -> None:
    assert tablename_for(class_name) == expected


# ── UUIDMixin ─────────────────────────────────────────────────────────────────

def test_scenario_has_uuid_pk() -> None:
    col = inspect(Scenario).mapper.columns["id"]
    assert col.primary_key is True


def test_scenario_id_defaults_to_uuid4() -> None:
    s = Scenario.__new__(Scenario)
    s.id = uuid.uuid4()
    assert isinstance(s.id, uuid.UUID)


# ── IntegerPKMixin ────────────────────────────────────────────────────────────

def test_integer_pk_mixin_column_type() -> None:
    from sqlalchemy import Integer

    class _RefTable(IntegerPKMixin, TimestampMixin, Base):
        __tablename__ = "_test_ref_table"
        __table_args__ = {"extend_existing": True}

    col = inspect(_RefTable).mapper.columns["id"]
    assert isinstance(col.type, Integer)
    assert col.primary_key is True


# ── TimestampMixin ────────────────────────────────────────────────────────────

def test_scenario_has_timestamp_columns() -> None:
    cols = {c.key for c in inspect(Scenario).mapper.columns}
    assert "created_at" in cols
    assert "updated_at" in cols


# ── SoftDeleteMixin ───────────────────────────────────────────────────────────

def test_scenario_has_deleted_at_column() -> None:
    cols = {c.key for c in inspect(Scenario).mapper.columns}
    assert "deleted_at" in cols


def test_mark_deleted_sets_timestamp() -> None:
    s = Scenario.__new__(Scenario)
    s.deleted_at = None
    assert s.is_deleted is False

    s.mark_deleted()
    assert s.is_deleted is True
    assert isinstance(s.deleted_at, datetime)
    # Must be timezone-aware
    assert s.deleted_at.tzinfo is not None


def test_deleted_filter_returns_clause() -> None:
    clause = Scenario.deleted_filter()
    assert clause is not None


# ── AuditMixin ────────────────────────────────────────────────────────────────

def test_scenario_has_audit_columns() -> None:
    cols = {c.key for c in inspect(Scenario).mapper.columns}
    assert "created_by" in cols
    assert "updated_by" in cols


# ── Base.__repr__ ─────────────────────────────────────────────────────────────

def test_repr_includes_class_name_and_id() -> None:
    s = Scenario.__new__(Scenario)
    s.id = uuid.UUID("12345678-1234-5678-1234-567812345678")
    r = repr(s)
    assert "Scenario" in r
    assert "12345678" in r


# ── Base.to_dict ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_to_dict_returns_column_keys(db_session: AsyncSession) -> None:
    s = Scenario(name="Test", status="draft")
    db_session.add(s)
    await db_session.flush()

    d = s.to_dict()
    assert "id" in d
    assert "name" in d
    assert "created_at" in d
    assert d["name"] == "Test"


# ── uuid_fk helper ────────────────────────────────────────────────────────────

def test_hedge_scenario_id_is_indexed() -> None:
    col = inspect(HedgeConfiguration).mapper.columns["scenario_id"]
    assert col.index is True


def test_simulation_scenario_id_is_nullable() -> None:
    col = inspect(SimulationResult).mapper.columns["scenario_id"]
    assert col.nullable is True


# ── Domain column types ───────────────────────────────────────────────────────

def test_scenario_base_rate_uses_numeric() -> None:
    from sqlalchemy import Numeric
    col = inspect(Scenario).mapper.columns["base_rate"]
    assert isinstance(col.type, Numeric)


def test_hedge_notional_uses_numeric() -> None:
    from sqlalchemy import Numeric
    col = inspect(HedgeConfiguration).mapper.columns["notional"]
    assert isinstance(col.type, Numeric)


def test_market_data_close_price_uses_numeric() -> None:
    from sqlalchemy import Numeric
    col = inspect(MarketData).mapper.columns["close_price"]
    assert isinstance(col.type, Numeric)


def test_money_type_precision() -> None:
    assert MONEY.precision == 28
    assert MONEY.scale == 6
    assert MONEY.asdecimal is True


def test_rate_type_precision() -> None:
    assert RATE.precision == 18
    assert RATE.scale == 8


def test_ratio_type_precision() -> None:
    assert RATIO.precision == 10
    assert RATIO.scale == 6


# ── CheckConstraint presence ──────────────────────────────────────────────────

def test_scenario_has_status_check_constraint() -> None:
    constraints = {c.name for c in Scenario.__table__.constraints}
    assert "scenario_status" in constraints


def test_simulation_result_has_status_check_constraint() -> None:
    constraints = {c.name for c in SimulationResult.__table__.constraints}
    assert "simulation_status" in constraints


# ── Market data unique constraint ─────────────────────────────────────────────

def test_market_data_unique_constraint_exists() -> None:
    constraint_names = {c.name for c in MarketData.__table__.constraints}
    assert "uq_market_data_ticker_date_source" in constraint_names
