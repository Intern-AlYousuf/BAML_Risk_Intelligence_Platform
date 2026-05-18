"""API router registry.

All versioned routers are assembled here. The `/api/v1` prefix is applied
in `main.py` so a future `v2_router` can be added without touching domain
route files.

Domain grouping:
  Infrastructure  — health probes
  Core analytics  — scenarios, hedges, dashboard
  Market data     — instruments (catalog + OHLCV ingestion)
  Risk & hedging  — simulations
  FX              — rates, exposure, forward curves
  Forecasting     — SOFR / rate forecast endpoints (typed)
                    ML forecast jobs (feature-flagged, legacy)
"""
from fastapi import APIRouter

from app.api.routes import (
    dashboard,
    forecast,
    forecasting,
    fx,
    health,
    hedges,
    instruments,
    scenarios,
    simulations,
    sofr,
)

# ── v1 router ─────────────────────────────────────────────────────────────────

v1_router = APIRouter()

# Infrastructure
v1_router.include_router(health.router)

# Core analytics
v1_router.include_router(dashboard.router)
v1_router.include_router(scenarios.router)
v1_router.include_router(hedges.router)

# Market data
v1_router.include_router(instruments.router)

# Risk & simulation
v1_router.include_router(simulations.router)

# FX
v1_router.include_router(fx.router)

# Predictive models (feature-flagged)
v1_router.include_router(forecasting.router)

# SOFR forecasting engine (legacy untyped endpoints)
v1_router.include_router(sofr.router)

# Typed forecast endpoints — /api/v1/forecast/*
v1_router.include_router(forecast.router)


# ── Top-level API router ───────────────────────────────────────────────────────
# Aggregates all versioned routers. Add v2_router here when it is introduced.

api_router = APIRouter()
api_router.include_router(v1_router)
