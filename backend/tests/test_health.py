import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_liveness(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health/live")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "alive"
    assert "version" in data
    assert "timestamp" in data


@pytest.mark.asyncio
async def test_readiness_returns_json(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health/ready")
    # 200 (db ok in test) or 503 (no db in CI) — both are valid JSON
    assert response.status_code in (200, 503)
    data = response.json()
    assert "status" in data
    assert "checks" in data
    assert "database" in data["checks"]


@pytest.mark.asyncio
async def test_request_id_header_present(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health/live")
    assert "x-request-id" in response.headers


@pytest.mark.asyncio
async def test_process_time_header_present(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health/live")
    assert "x-process-time-ms" in response.headers
