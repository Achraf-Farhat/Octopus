from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
from app.main import app

client = TestClient(app)

def test_health_check():
    # Mocking database connection, redis ping, wazuh health, and ollama checks to run unit tests offline
    with patch("app.routers.health.SessionLocal") as mock_session, \
         patch("redis.from_url") as mock_redis_from_url, \
         patch("app.routers.health.WazuhClient") as mock_wazuh_client, \
         patch("app.routers.health.OllamaClient") as mock_ollama_client:
        
        # Mock DB
        mock_db_instance = mock_session.return_value
        mock_db_instance.execute.return_value = None
        
        # Mock Redis
        mock_redis_instance = mock_redis_from_url.return_value
        mock_redis_instance.ping.return_value = True
        
        # Mock Wazuh
        mock_wazuh_instance = mock_wazuh_client.return_value
        mock_wazuh_instance.health = AsyncMock(return_value={"status": "ok"})
        
        # Mock Ollama
        mock_ollama_instance = mock_ollama_client.return_value
        mock_ollama_instance.is_available = AsyncMock(return_value=True)
        mock_ollama_instance.has_model = AsyncMock(return_value=True)
        
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"
        assert response.json()["services"]["db"] == "ok"
        assert response.json()["services"]["redis"] == "ok"
        assert response.json()["services"]["wazuh"] == "ok"

def test_health_check_failures():
    # Mocking exceptions for DB, Redis, Wazuh, and Ollama to test the error paths
    with patch("app.routers.health.SessionLocal") as mock_session, \
         patch("redis.from_url") as mock_redis_from_url, \
         patch("app.routers.health.WazuhClient") as mock_wazuh_client, \
         patch("app.routers.health.OllamaClient") as mock_ollama_client:
        
        # Database failure
        mock_db_instance = mock_session.return_value
        mock_db_instance.execute.side_effect = Exception("DB error")
        
        # Redis failure
        mock_redis_instance = mock_redis_from_url.return_value
        mock_redis_instance.ping.side_effect = Exception("Redis error")
        
        # Wazuh failure
        mock_wazuh_instance = mock_wazuh_client.return_value
        mock_wazuh_instance.health = AsyncMock(side_effect=Exception("Wazuh error"))
        
        # Ollama failure
        mock_ollama_instance = mock_ollama_client.return_value
        mock_ollama_instance.is_available = AsyncMock(side_effect=Exception("Ollama error"))
        
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["services"]["db"] == "error"
        assert data["services"]["redis"] == "error"
        assert data["services"]["wazuh"] == "error"
        assert data["services"]["ollama"] == "error"
