"""Shared response primitives used across every domain router.

Import from here rather than re-defining envelope types per domain.
"""
from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class NotImplementedResponse(BaseModel):
    """Typed placeholder returned by routes pending implementation.

    Carries enough context for a consumer to know what the endpoint will
    eventually provide, without hard-coding an opaque {"status": "placeholder"}.
    """

    feature: str = Field(..., description="Human-readable name of the pending feature")
    status: str = Field(default="not_implemented")
    expected_in_version: str | None = Field(
        default=None,
        description="Milestone version when full implementation ships",
    )


class PaginationMeta(BaseModel):
    """Pagination envelope metadata returned with every paginated list."""

    total: int = Field(..., ge=0, description="Total records matching the filter")
    offset: int = Field(..., ge=0)
    limit: int = Field(..., ge=1)
    has_next: bool
    has_prev: bool

    @classmethod
    def from_query(cls, total: int, offset: int, limit: int) -> "PaginationMeta":
        return cls(
            total=total,
            offset=offset,
            limit=limit,
            has_next=(offset + limit) < total,
            has_prev=offset > 0,
        )


class PaginatedResponse(BaseModel, Generic[T]):
    """Generic paginated list response wrapper."""

    data: list[T]
    meta: PaginationMeta
