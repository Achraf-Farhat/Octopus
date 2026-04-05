from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin

import httpx

from app.core.config import settings


@dataclass
class WazuhClient:
    base_url: str = settings.wazuh_api_url
    username: str = settings.wazuh_user
    password: str = settings.wazuh_password
    verify_ssl: bool = settings.wazuh_verify_ssl
    _token: str | None = None

    async def _get_alerts_from_indexer(self, dql_query: str | None = None, *, limit: int = 50, offset: int = 0) -> dict[str, Any]:
        if not settings.wazuh_indexer_url:
            raise RuntimeError("Wazuh Indexer URL is not configured")

        if settings.wazuh_indexer_verify_ssl:
            verify: bool | str = settings.wazuh_indexer_ca_cert or True
        else:
            verify = False

        cert: tuple[str, str] | None = None
        auth: tuple[str, str] | None = None
        if settings.wazuh_indexer_client_cert and settings.wazuh_indexer_client_key:
            cert = (settings.wazuh_indexer_client_cert, settings.wazuh_indexer_client_key)
        elif settings.wazuh_indexer_username and settings.wazuh_indexer_password:
            auth = (settings.wazuh_indexer_username, settings.wazuh_indexer_password)

        payload: dict[str, Any] = {
            "size": max(1, min(limit, 500)),
            "from": max(0, offset),
            "sort": [{"@timestamp": {"order": "desc"}}],
            "query": {"match_all": {}},
        }
        if dql_query:
            payload["query"] = {
                "query_string": {
                    "query": dql_query,
                    "default_field": "*",
                }
            }

        async with httpx.AsyncClient(verify=verify, cert=cert, auth=auth, timeout=30) as client:
            response = await client.post(
                urljoin(settings.wazuh_indexer_url.rstrip("/") + "/", "wazuh-alerts-*/_search"),
                json=payload,
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
            data = response.json()
            hits = data.get("hits", {})
            items: list[dict[str, Any]] = []
            for hit in hits.get("hits", []):
                source = hit.get("_source", {}) if isinstance(hit.get("_source", {}), dict) else {}
                items.append(
                    {
                        **source,
                        "_index": hit.get("_index"),
                        "_id": hit.get("_id"),
                        "_version": hit.get("_version"),
                        "_score": hit.get("_score"),
                        "_source": source,
                        "fields": hit.get("fields", {}),
                        "highlight": hit.get("highlight", {}),
                        "sort": hit.get("sort", []),
                    }
                )
            total_data = hits.get("total", 0)
            if isinstance(total_data, dict):
                total_value = total_data.get("value", 0)
            else:
                total_value = int(total_data or 0)

            return {
                "data": {
                    "items": items,
                    "total": total_value,
                    "source": "wazuh_indexer",
                },
                "error": 0,
            }

    def _auth_header(self) -> dict[str, str]:
        return {
            "Authorization": f"Basic {base64.b64encode(f'{self.username}:{self.password}'.encode()).decode()}",
            "Content-Type": "application/json",
        }

    def _require_config(self) -> None:
        if not self.base_url or not self.username or not self.password:
            raise RuntimeError("Wazuh API configuration is incomplete")

    async def _get_token(self) -> str:
        self._require_config()
        if self._token:
            return self._token

        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=20) as client:
            response = await client.post(urljoin(self.base_url.rstrip("/") + "/", "security/user/authenticate"), headers=self._auth_header())
            response.raise_for_status()
            data = response.json()
            token = data.get("data", {}).get("token") or data.get("token")
            if not token:
                raise RuntimeError("Wazuh API token not returned")
            self._token = token
            return token

    async def _request(self, method: str, path: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
        token = await self._get_token()
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=30) as client:
            response = await client.request(method, urljoin(self.base_url.rstrip("/") + "/", path.lstrip("/")), params=params, headers=headers)
            response.raise_for_status()
            return response.json()

    async def authenticate(self) -> dict[str, Any]:
        self._require_config()
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=20) as client:
            response = await client.post(urljoin(self.base_url.rstrip("/") + "/", "security/user/authenticate"), headers=self._auth_header())
            response.raise_for_status()
            return response.json()

    async def get_alerts(self, dql_query: str | None = None, *, limit: int = 50, offset: int = 0) -> dict[str, Any]:
        if settings.wazuh_indexer_url:
            try:
                return await self._get_alerts_from_indexer(dql_query=dql_query, limit=limit, offset=offset)
            except Exception:
                pass

        params = {"q": dql_query} if dql_query else None
        try:
            return await self._request("GET", "/alerts", params=params)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 404:
                raise

            fallback_params: dict[str, Any] = {"limit": max(1, min(limit, 500)), "offset": max(0, offset)}
            if dql_query:
                fallback_params["search"] = dql_query

            logs_payload = await self._request("GET", "/manager/logs", params=fallback_params)
            return {
                "data": {
                    "items": logs_payload.get("data", {}).get("affected_items", []),
                    "total": logs_payload.get("data", {}).get("total_affected_items", 0),
                    "source": "manager_logs_fallback",
                    "message": "Wazuh manager API does not expose /alerts; returned manager logs as fallback.",
                },
                "error": logs_payload.get("error", 0),
            }

    async def health(self) -> dict[str, Any]:
        return await self._request("GET", "/")
