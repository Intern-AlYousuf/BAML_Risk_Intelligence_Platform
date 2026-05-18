"""Integration-level route tests.

Each test verifies that the endpoint is reachable (registered and returns a
non-5xx response) and that the response shape is correct.  No business-logic
assertions — those belong in domain-specific test files.

All tests run against the SQLite in-memory DB via the conftest fixtures.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient


# ── Health ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_liveness(client: AsyncClient) -> None:
    r = await client.get("/api/v1/health/live")
    assert r.status_code == 200
    assert r.json()["status"] == "alive"


@pytest.mark.asyncio
async def test_readiness(client: AsyncClient) -> None:
    r = await client.get("/api/v1/health/ready")
    # SQLite in-memory — health check may return 503 if pool not wired; both are valid JSON
    assert r.status_code in (200, 503)
    assert "checks" in r.json()


# ── Dashboard ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dashboard_summary(client: AsyncClient) -> None:
    r = await client.get("/api/v1/dashboard/summary")
    assert r.status_code == 200
    body = r.json()
    assert "total_scenarios" in body
    assert "as_of" in body


@pytest.mark.asyncio
async def test_dashboard_risk_metrics(client: AsyncClient) -> None:
    r = await client.get("/api/v1/dashboard/risk-metrics")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_dashboard_exposure(client: AsyncClient) -> None:
    r = await client.get("/api/v1/dashboard/exposure")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_dashboard_alerts(client: AsyncClient) -> None:
    r = await client.get("/api/v1/dashboard/alerts")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_dashboard_performance(client: AsyncClient) -> None:
    r = await client.get("/api/v1/dashboard/performance")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ── Scenarios ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_scenarios_empty(client: AsyncClient) -> None:
    r = await client.get("/api/v1/scenarios/")
    assert r.status_code == 200
    body = r.json()
    assert "items" in body
    assert "total" in body


@pytest.mark.asyncio
async def test_create_scenario(client: AsyncClient) -> None:
    payload = {"name": "Test Scenario", "base_rate": "0.05", "horizon_days": 90}
    r = await client.post("/api/v1/scenarios/", json=payload)
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Test Scenario"
    assert body["status"] == "draft"


@pytest.mark.asyncio
async def test_get_scenario_not_found(client: AsyncClient) -> None:
    r = await client.get("/api/v1/scenarios/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


# ── Hedges ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_hedges_empty(client: AsyncClient) -> None:
    r = await client.get("/api/v1/hedges/")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_create_hedge(client: AsyncClient) -> None:
    payload = {
        "instrument_type": "FX Forward",
        "notional": "1000000.00",
        "hedge_ratio": "0.75",
    }
    r = await client.post("/api/v1/hedges/", json=payload)
    assert r.status_code == 201
    body = r.json()
    assert body["instrument_type"] == "FX Forward"


@pytest.mark.asyncio
async def test_get_hedge_not_found(client: AsyncClient) -> None:
    r = await client.get("/api/v1/hedges/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


# ── FX ────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_fx_rates_empty(client: AsyncClient) -> None:
    r = await client.get("/api/v1/fx/rates")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_get_fx_rate_not_found(client: AsyncClient) -> None:
    r = await client.get("/api/v1/fx/rates/EURUSD")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_fx_exposure_summary(client: AsyncClient) -> None:
    r = await client.get("/api/v1/fx/exposure")
    assert r.status_code == 200
    body = r.json()
    assert "base_currency" in body
    assert "exposures" in body


@pytest.mark.asyncio
async def test_fx_stress_test_feature_disabled(client: AsyncClient) -> None:
    payload = {"currency_pairs": ["EURUSD"], "shock_bps": "100"}
    r = await client.post("/api/v1/fx/stress-test", json=payload)
    # ENABLE_MONTE_CARLO=false in test env → 503
    assert r.status_code == 503


# ── Instruments ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_instruments_empty(client: AsyncClient) -> None:
    r = await client.get("/api/v1/instruments/")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_get_instrument_not_found(client: AsyncClient) -> None:
    r = await client.get("/api/v1/instruments/AAPL")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_list_commodities_empty(client: AsyncClient) -> None:
    r = await client.get("/api/v1/instruments/commodities")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_ingest_market_data(client: AsyncClient) -> None:
    payload = {
        "ticker": "AAPL",
        "asset_class": "equity",
        "data_date": "2024-01-15",
        "source": "test",
        "close_price": "185.50",
    }
    r = await client.post("/api/v1/instruments/market-data", json=payload)
    assert r.status_code == 201
    assert r.json()["ticker"] == "AAPL"


@pytest.mark.asyncio
async def test_query_market_data(client: AsyncClient) -> None:
    r = await client.get("/api/v1/instruments/market-data?ticker=AAPL&limit=10")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ── Simulations ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_submit_simulation(client: AsyncClient) -> None:
    payload = {"simulation_type": "historical", "iterations": 1000}
    r = await client.post("/api/v1/simulations/", json=payload)
    assert r.status_code == 202
    assert r.json()["status"] == "pending"


@pytest.mark.asyncio
async def test_submit_monte_carlo_feature_disabled(client: AsyncClient) -> None:
    payload = {"simulation_type": "monte_carlo", "iterations": 10000}
    r = await client.post("/api/v1/simulations/", json=payload)
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_get_simulation_not_found(client: AsyncClient) -> None:
    r = await client.get("/api/v1/simulations/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


# ── Forecasting ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_forecasting_disabled_by_default(client: AsyncClient) -> None:
    payload = {"ticker": "EURUSD", "horizon_days": 30}
    r = await client.post("/api/v1/forecasting/run", json=payload)
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_forecast_models_disabled_by_default(client: AsyncClient) -> None:
    r = await client.get("/api/v1/forecasting/models")
    assert r.status_code == 503
