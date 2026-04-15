from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
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

    @staticmethod
    def _build_indexer_query(dql_query: str | None) -> dict[str, Any]:
        if dql_query:
            return {
                "query_string": {
                    "query": dql_query,
                    "default_field": "*",
                }
            }
        return {"match_all": {}}

    @staticmethod
    def _normalize_interval(interval: str | None) -> str:
        allowed = {"hour", "day", "week", "month", "year"}
        candidate = (interval or "day").strip().lower()
        return candidate if candidate in allowed else "day"

    @staticmethod
    def _aggregate_items_summary(items: list[dict[str, Any]], total: int, *, interval: str) -> dict[str, Any]:
        severity = {"low": 0, "medium": 0, "high": 0, "critical": 0}
        timeline: dict[str, int] = {}

        for item in items:
            try:
                level = int(item.get("rule", {}).get("level"))
            except Exception:
                level = None

            if level is not None:
                if 0 <= level <= 6:
                    severity["low"] += 1
                elif 7 <= level <= 11:
                    severity["medium"] += 1
                elif 12 <= level <= 14:
                    severity["high"] += 1
                elif level >= 15:
                    severity["critical"] += 1

            timestamp = item.get("@timestamp") or item.get("timestamp")
            if not timestamp:
                continue
            try:
                dt = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00")).astimezone(timezone.utc)
            except Exception:
                continue

            if interval == "hour":
                key = dt.strftime("%Y-%m-%dT%H:00:00Z")
            elif interval == "week":
                week_start = dt - timedelta(days=dt.weekday())
                key = week_start.strftime("%Y-%m-%dT00:00:00Z")
            elif interval == "month":
                key = dt.strftime("%Y-%m-01T00:00:00Z")
            elif interval == "year":
                key = dt.strftime("%Y-01-01T00:00:00Z")
            else:
                key = dt.strftime("%Y-%m-%dT00:00:00Z")

            timeline[key] = timeline.get(key, 0) + 1

        timeline_points = [{"timestamp": key, "count": timeline[key]} for key in sorted(timeline.keys())]
        return {
            "total": int(total),
            "severity": severity,
            "timeline": timeline_points,
        }

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
            "query": self._build_indexer_query(dql_query),
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

    async def _get_alerts_summary_from_indexer(self, dql_query: str | None = None, *, interval: str = "day") -> dict[str, Any]:
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

        calendar_interval = self._normalize_interval(interval)
        payload: dict[str, Any] = {
            "size": 0,
            "track_total_hits": True,
            "query": self._build_indexer_query(dql_query),
            "aggs": {
                "severity_ranges": {
                    "range": {
                        "field": "rule.level",
                        "ranges": [
                            {"key": "low", "from": 0, "to": 7},
                            {"key": "medium", "from": 7, "to": 12},
                            {"key": "high", "from": 12, "to": 15},
                            {"key": "critical", "from": 15},
                        ],
                    }
                },
                "alerts_over_time": {
                    "date_histogram": {
                        "field": "@timestamp",
                        "calendar_interval": calendar_interval,
                        "min_doc_count": 0,
                    }
                },
            },
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
        total_data = hits.get("total", 0)
        if isinstance(total_data, dict):
            total_value = int(total_data.get("value", 0))
        else:
            total_value = int(total_data or 0)

        buckets = data.get("aggregations", {}).get("severity_ranges", {}).get("buckets", [])
        severity = {"low": 0, "medium": 0, "high": 0, "critical": 0}
        for bucket in buckets:
            key = str(bucket.get("key", "")).lower()
            if key in severity:
                severity[key] = int(bucket.get("doc_count", 0))

        timeline_buckets = data.get("aggregations", {}).get("alerts_over_time", {}).get("buckets", [])
        timeline = [
            {
                "timestamp": bucket.get("key_as_string"),
                "count": int(bucket.get("doc_count", 0)),
            }
            for bucket in timeline_buckets
            if bucket.get("key_as_string")
        ]

        return {
            "data": {
                "total": total_value,
                "severity": severity,
                "timeline": timeline,
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

            try:
                logs_payload = await self._request("GET", "/manager/logs", params=fallback_params)
                fallback_message = "Wazuh manager API does not expose /alerts; returned manager logs as fallback."
            except httpx.HTTPStatusError as fallback_exc:
                if fallback_exc.response.status_code != 400 or "search" not in fallback_params:
                    raise
                fallback_params.pop("search", None)
                logs_payload = await self._request("GET", "/manager/logs", params=fallback_params)
                fallback_message = (
                    "Wazuh manager API does not expose /alerts and rejected query filtering on /manager/logs; "
                    "returned unfiltered manager logs fallback."
                )

            return {
                "data": {
                    "items": logs_payload.get("data", {}).get("affected_items", []),
                    "total": logs_payload.get("data", {}).get("total_affected_items", 0),
                    "source": "manager_logs_fallback",
                    "message": fallback_message,
                },
                "error": logs_payload.get("error", 0),
            }

    async def get_alerts_summary(self, dql_query: str | None = None, *, interval: str = "day") -> dict[str, Any]:
        normalized_interval = self._normalize_interval(interval)
        if settings.wazuh_indexer_url:
            try:
                return await self._get_alerts_summary_from_indexer(dql_query=dql_query, interval=normalized_interval)
            except Exception:
                pass

        fallback = await self.get_alerts(dql_query=dql_query, limit=500, offset=0)
        data = fallback.get("data", {})
        items = data.get("items", []) if isinstance(data.get("items", []), list) else []
        total = int(data.get("total") or len(items))
        summary = self._aggregate_items_summary(items, total, interval=normalized_interval)
        summary["source"] = data.get("source", "fallback")
        if data.get("message"):
            summary["message"] = data.get("message")
        return {"data": summary, "error": fallback.get("error", 0)}

    async def health(self) -> dict[str, Any]:
        return await self._request("GET", "/")
