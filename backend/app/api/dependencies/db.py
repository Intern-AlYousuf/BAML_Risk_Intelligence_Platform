"""FastAPI dependency aliases for database sessions.

Import `DBSession` for endpoints that mutate state (POST, PATCH, DELETE).
Import `DBSessionReadOnly` for endpoints that only read (GET, HEAD).

Usage:
    from app.api.dependencies.db import DBSession, DBSessionReadOnly

    @router.get("/items")
    async def list_items(db: DBSessionReadOnly) -> list[ItemResponse]:
        return await ItemService(db).list()

    @router.post("/items")
    async def create_item(payload: ItemCreate, db: DBSession) -> ItemResponse:
        return await ItemService(db).create(payload)
"""
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db, get_db_readonly

# Read-write session — commits on success, rolls back on exception.
DBSession = Annotated[AsyncSession, Depends(get_db)]

# Read-only session — no commit overhead; safe for all query-only paths.
DBSessionReadOnly = Annotated[AsyncSession, Depends(get_db_readonly)]
