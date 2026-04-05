from fastapi import APIRouter
from sqlalchemy import text

import redis

from app.core.config import settings
from app.db.session import SessionLocal
from app.services.ollama_client import OllamaClient
from app.services.wazuh_client import WazuhClient

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    services = {"db": "unknown", "redis": "unknown", "ollama": "unknown", "wazuh": "unknown"}

    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        services["db"] = "ok"
    except Exception:
        services["db"] = "error"
    finally:
        db.close()

    try:
        redis.from_url(settings.redis_url).ping()
        services["redis"] = "ok"
    except Exception:
        services["redis"] = "error"

    try:
        client = WazuhClient()
        await client.health()
        services["wazuh"] = "ok"
    except Exception:
        services["wazuh"] = "error"

    try:
        ollama = OllamaClient()
        if settings.ollama_api_url:
            available = await ollama.is_available()
            if not available:
                services["ollama"] = "error"
            elif await ollama.has_model(settings.ollama_model):
                services["ollama"] = "ok"
            else:
                services["ollama"] = "model_missing"
        else:
            services["ollama"] = "not_configured"
    except Exception:
        services["ollama"] = "error"

    return {
        "status": "healthy",
        "services": services,
    }
