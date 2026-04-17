from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

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
            async with httpx.AsyncClient(timeout=100) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
                return True
        except Exception:
            return False

    async def has_model(self, model_name: str | None = None) -> bool:
        self._assert_configured()
        expected = (model_name or self.model).lower()
        async with httpx.AsyncClient(timeout=1000) as client:
            response = await client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()
            data = response.json()
            models = data.get("models", [])
            names = {item.get("name", "").lower() for item in models}
            # Exact match first, then prefix match (handles tag variants like llama3.1:8b-instruct-q4_K_M)
            if expected in names:
                return True
            base = expected.split(":")[0]
            return any(n == expected or n.startswith(base + ":") for n in names)

    async def chat(
        self,
        prompt: str,
        system: Optional[str] = None,
        messages: Optional[list] = None,
    ) -> str:
        """
        Send a prompt to the model.

        - `messages` provided  → /api/chat with the full messages list as-is (used by threat hunt)
        - `system` provided    → /api/chat with system + user message roles (used by translate)
        - neither              → /api/generate legacy endpoint (explain-alert, rule-gen)
        """
        self._assert_configured()

        if messages is not None:
            return await self._chat_messages(system="", user="", messages=messages)
        if system is not None:
            return await self._chat_messages(system=system, user=prompt)
        return await self._generate(prompt)

    async def _chat_messages(self, system: str, user: str, messages: list | None = None) -> str:
        """Use /api/chat with explicit system + user message roles."""
        if messages is None:
            messages = [
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ]
        payload = {
            "model": self.model,
            "stream": False,
            "options": {
                "temperature": 0.1,   # low temperature = more deterministic / less hallucination
                "top_p": 0.9,
                "num_predict": 1024,
            },
            "messages": messages,
        }
        # llama3.1:8b on CPU can take 3-8 minutes — give it plenty of room
        async with httpx.AsyncClient(timeout=6000) as client:
            response = await client.post(f"{self.base_url}/api/chat", json=payload)
            response.raise_for_status()
            data = response.json()
            return data.get("message", {}).get("content", "")

    async def _generate(self, prompt: str) -> str:
        """Legacy /api/generate endpoint — used for longer free-form outputs."""
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.2,
                "top_p": 0.9,
            },
        }
        # llama3.1:8b on CPU can take 3-8 minutes — give it plenty of room
        async with httpx.AsyncClient(timeout=6000) as client:
            response = await client.post(f"{self.base_url}/api/generate", json=payload)
            response.raise_for_status()
            data = response.json()
            return data.get("response", "")
