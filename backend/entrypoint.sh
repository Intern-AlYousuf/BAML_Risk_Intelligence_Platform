#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
#  Backend container entrypoint
#
#  Runs before the CMD (uvicorn).  Applies Alembic migrations so the schema is
#  always up-to-date when the server starts.
#
#  RUN_MIGRATIONS=false  — skip migration step (useful in testing or when
#                          migrations are managed externally via a CI job)
# ──────────────────────────────────────────────────────────────────────────────
set -e

RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"

if [ "$RUN_MIGRATIONS" = "true" ]; then
    echo "[entrypoint] Applying Alembic migrations..."
    alembic upgrade head
    echo "[entrypoint] Migrations complete."
fi

echo "[entrypoint] Starting server: $*"
exec "$@"
