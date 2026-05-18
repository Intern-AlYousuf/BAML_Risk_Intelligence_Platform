"""Database package public API.

Import from here rather than from submodules:

    from app.db import Base, UUIDMixin, TimestampMixin
    from app.db import MONEY, RATE, RATIO
    from app.db import get_db, get_db_readonly
"""
from app.db.base import (
    NAMING_CONVENTION,
    AuditMixin,
    Base,
    IntegerPKMixin,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDMixin,
    tablename_for,
    uuid_fk,
)
from app.db.session import db_manager, get_db, get_db_readonly
from app.db.types import BPS, MONEY, RATE, RATIO, JSONB

__all__ = [
    # Base
    "Base",
    "NAMING_CONVENTION",
    # Mixins
    "UUIDMixin",
    "IntegerPKMixin",
    "TimestampMixin",
    "SoftDeleteMixin",
    "AuditMixin",
    # Helpers
    "uuid_fk",
    "tablename_for",
    # Session
    "db_manager",
    "get_db",
    "get_db_readonly",
    # Column types
    "MONEY",
    "RATE",
    "RATIO",
    "BPS",
    "JSONB",
]
