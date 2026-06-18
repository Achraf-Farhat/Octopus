import pytest
from unittest.mock import AsyncMock, patch

def test_ensure_ollama_ready_no_url(client):
    with patch("app.services.ollama_client.OllamaClient.base_url", None):
        response = client.post("/ai/translate-search", json={"query": "test query"})
        assert response.status_code == 503
        assert "is not configured" in response.json()["detail"]

def test_ensure_ollama_ready_unavailable(client):
    with patch("app.services.ollama_client.OllamaClient.base_url", "http://localhost:11434"), \
         patch("app.services.ollama_client.OllamaClient.is_available", new_callable=AsyncMock) as mock_avail:
        mock_avail.return_value = False
        response = client.post("/ai/translate-search", json={"query": "test query"})
        assert response.status_code == 503
        assert "service is unavailable" in response.json()["detail"]

def test_ensure_ollama_ready_model_missing(client):
    with patch("app.services.ollama_client.OllamaClient.base_url", "http://localhost:11434"), \
         patch("app.services.ollama_client.OllamaClient.is_available", new_callable=AsyncMock) as mock_avail, \
         patch("app.services.ollama_client.OllamaClient.has_model", new_callable=AsyncMock) as mock_has_model:
        mock_avail.return_value = True
        mock_has_model.return_value = False
        response = client.post("/ai/translate-search", json={"query": "test query"})
        assert response.status_code == 503
        assert "model" in response.json()["detail"]

def test_translate_search_success(client):
    mock_response = """
    {
      "language": "dql",
      "query": "source.ip: 10.0.0.1",
      "confidence": 0.9,
      "time_range": {
        "label": "last 24 hours",
        "start": "2026-06-17T00:00:00Z",
        "end": "2026-06-18T00:00:00Z",
        "precision": "range"
      },
      "notes": "Translated successfully."
    }
    """
    with patch("app.services.ollama_client.OllamaClient.base_url", "http://localhost:11434"), \
         patch("app.services.ollama_client.OllamaClient.is_available", new_callable=AsyncMock) as mock_avail, \
         patch("app.services.ollama_client.OllamaClient.has_model", new_callable=AsyncMock) as mock_has_model, \
         patch("app.services.ollama_client.OllamaClient.chat", new_callable=AsyncMock) as mock_chat:
        
        mock_avail.return_value = True
        mock_has_model.return_value = True
        mock_chat.return_value = mock_response

        payload = {"query": "find SSH logins", "mode": "auto"}
        response = client.post("/ai/translate-search", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["language"] == "dql"
        assert data["query"] == "source.ip: 10.0.0.1"
        assert data["confidence"] == 0.9
        assert data["time_range"] == "last 24 hours"

def test_explain_alert_fallback(client):
    with patch("app.services.ollama_client.OllamaClient.base_url", "http://localhost:11434"), \
         patch("app.services.ollama_client.OllamaClient.is_available", new_callable=AsyncMock) as mock_avail, \
         patch("app.services.ollama_client.OllamaClient.has_model", new_callable=AsyncMock) as mock_has_model, \
         patch("app.services.ollama_client.OllamaClient.chat", new_callable=AsyncMock) as mock_chat:
        
        mock_avail.return_value = True
        mock_has_model.return_value = True
        mock_chat.side_effect = Exception("Ollama error")

        payload = {
            "rule_description": "Brute Force SSH",
            "severity": "high",
            "src_ip": "192.168.1.50",
            "mitre_technique": "T1110",
            "alert_data": "{}"
        }
        response = client.post("/ai/explain-alert", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "timed out" in data["explanation"]
        assert data["severity_assessment"] == "medium"
        assert data["confidence"] == 0.0
