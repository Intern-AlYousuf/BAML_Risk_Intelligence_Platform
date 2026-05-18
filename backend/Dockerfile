# ══════════════════════════════════════════════════════════════════════════════
#  BAML Risk Intelligence Platform — Backend Dockerfile
#  Multi-stage build:
#    builder  — install dependencies into an isolated virtualenv
#    runtime  — copy only the venv + source; run as non-root
#
#  The builder stage is never pushed to a registry.  The runtime image
#  contains no compilers, headers, or build tooling.
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: dependency builder ───────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build dependencies (not included in the final image)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Create an isolated virtualenv so we can copy it cleanly to the runtime stage
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python packages — cached as long as requirements.txt doesn't change
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Install only the runtime system library required by asyncpg / psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Copy the pre-built virtualenv — no compilers needed
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Non-root user — defence against container escape
RUN groupadd --gid 1001 appgroup \
 && useradd  --uid 1001 --gid appgroup --no-create-home appuser

WORKDIR /app

# Copy application source
COPY --chown=appuser:appgroup . .

# Make the entrypoint executable
RUN chmod +x /app/entrypoint.sh

USER appuser

# Backend listens on PORT (Railway injects this; default 8000)
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c \
        "import urllib.request; urllib.request.urlopen('http://localhost:${PORT:-8000}/api/v1/health/live')" \
        || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
