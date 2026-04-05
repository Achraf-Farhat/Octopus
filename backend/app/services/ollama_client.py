from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.core.config import settings


@dataclass
class OllamaClient:
    base_url: str = settings.ollama_api_url
    model: str = settings.ollama_model

    def _assert_configured(self) -> None:
        if not self.base_url:
            raise RuntimeError("Ollama API URL is not configured")

    async def is_available(self) -> bool:
        if not self.base_url:
            return False
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
                return True
        except Exception:
            return False

    async def has_model(self, model_name: str | None = None) -> bool:
        self._assert_configured()
        expected = model_name or self.model
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()
            data = response.json()
            models = data.get("models", [])
            names = {item.get("name", "") for item in models}
            return expected in names

    async def chat(self, prompt: str) -> str:
        self._assert_configured()
        payload = {"model": self.model, "prompt": prompt, "stream": False}
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(f"{self.base_url}/api/generate", json=payload)
            response.raise_for_status()
            data = response.json()
            return data.get("response", "")
