import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_and_retrieve_scenario(client: AsyncClient) -> None:
    payload = {
        "name": "Baseline Q1",
        "description": "Standard Q1 rate environment",
        "base_rate": 0.05,
        "stress_factor": 1.5,
        "horizon_days": 90,
    }
    create_resp = await client.post("/api/v1/scenarios/", json=payload)
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["name"] == payload["name"]
    assert created["status"] == "draft"

    get_resp = await client.get(f"/api/v1/scenarios/{created['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == created["id"]


@pytest.mark.asyncio
async def test_list_scenarios(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/scenarios/")
    assert resp.status_code == 200
    body = resp.json()
    assert "total" in body
    assert "items" in body


@pytest.mark.asyncio
async def test_get_nonexistent_scenario(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/scenarios/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404
