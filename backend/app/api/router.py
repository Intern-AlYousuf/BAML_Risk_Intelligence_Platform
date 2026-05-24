"""API router registry.

DEPLOYMENT MODE:
  Routes that depend on a live database (DATABASE_URL) are commented out.
  Re-enable them once DATABASE_URL is set on Render and the DB is provisioned.

  ACTIVE (no DB required):
    /api/v1/health/*      — liveness + readiness probes (DB-free version)
    /api/v1/sofr/*        — SOFR ARIMA + Monte Carlo (FRED API only)
    /api/v1/forecast/*    — Typed SOFR + FX Monte Carlo (FRED + Yahoo Finance)
    /api/v1/forecasting/* — Data series catalogue + preprocessing

  DISABLED (require DATABASE_URL):
    /api/v1/dashboard/*   — risk dashboard aggregation (DB-backed)
    /api/v1/scenarios/*   — scenario CRUD (DB-backed)
    /api/v1/hedges/*      — hedge configuration CRUD (DB-backed)
    /api/v1/instruments/* — market data catalogue (DB-backed)
    /api/v1/simulations/* — Monte Carlo job queue (DB-backed)
    /api/v1/fx/*          — live FX rates + exposure (DB-backed)
"""
from fastapi import APIRouter

# ── Active routes (no database dependency) ────────────────────────────────────
from app.api.routes import (
    forecast,      # GET /forecast/sofr, /forecast/sofr/monte-carlo, /forecast/fx/monte-carlo
    forecasting,   # GET /forecasting/* — series catalogue + history
    health,        # GET /health/live, /health/ready (DB-free)
    sofr,          # GET /sofr/forecast, /sofr/simulate, /sofr/diagnostics
)

# ── Disabled routes — uncomment each when DATABASE_URL is provisioned ─────────
#
# from app.api.routes import dashboard   # requires: DBSessionReadOnly
# from app.api.routes import scenarios   # requires: DBSession + DBSessionReadOnly
# from app.api.routes import hedges      # requires: DBSession + DBSessionReadOnly
# from app.api.routes import instruments # requires: DBSessionReadOnly + DB models
# from app.api.routes import simulations # requires: DBSession + DBSessionReadOnly
# from app.api.routes import fx          # requires: DBSessionReadOnly (GET), DBSession (POST)


# ── v1 router ─────────────────────────────────────────────────────────────────

v1_router = APIRouter()

# Infrastructure
v1_router.include_router(health.router)          # /health/live, /health/ready

# Predictive models — SOFR forecasting engine
v1_router.include_router(sofr.router)            # /sofr/*

# Typed forecast endpoints
v1_router.include_router(forecast.router)        # /forecast/*

# Data series catalogue + preprocessing
v1_router.include_router(forecasting.router)     # /forecasting/*

# ── Disabled routers — uncomment when database is ready ───────────────────────
# v1_router.include_router(dashboard.router)    # /dashboard/*
# v1_router.include_router(scenarios.router)    # /scenarios/*
# v1_router.include_router(hedges.router)       # /hedges/*
# v1_router.include_router(instruments.router)  # /instruments/*
# v1_router.include_router(simulations.router)  # /simulations/*
# v1_router.include_router(fx.router)           # /fx/*


# ── Top-level API router ──────────────────────────────────────────────────────

api_router = APIRouter()
api_router.include_router(v1_router)
