from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user
from app.models.alert import Alert
from app.models.search_history import SearchHistory
from app.models.user import User
from app.services.wazuh_client import WazuhClient

router = APIRouter(prefix="/alerts", tags=["alerts"])


def _parse_timestamp(value: str | None) -> datetime:
    if not value:
        return datetime.utcnow()
    try:
        normalized = value.replace("Z", "+00:00")
        if len(normalized) >= 5 and normalized[-5] in {"+", "-"} and normalized[-3] != ":":
            normalized = f"{normalized[:-2]}:{normalized[-2:]}"
        return datetime.fromisoformat(normalized)
    except Exception:
        return datetime.utcnow()


def _serialize_cached_alert(alert: Alert) -> dict:
    if isinstance(alert.raw_data, dict) and alert.raw_data:
        return alert.raw_data
    return {
        "id": alert.wazuh_alert_id,
        "@timestamp": alert.timestamp.isoformat() if alert.timestamp else None,
        "rule": {"id": alert.rule_id, "level": alert.severity},
        "data": {"srcip": alert.src_ip, "dstip": alert.dst_ip},
        "status": alert.status,
    }


def _bucket_severity(level: int | None) -> str | None:
    if level is None:
        return None
    if 0 <= level <= 6:
        return "low"
    if 7 <= level <= 11:
        return "medium"
    if 12 <= level <= 14:
        return "high"
    if level >= 15:
        return "critical"
    return None


def _cache_summary(interval: str, alerts: list[Alert]) -> dict:
    severity = {"low": 0, "medium": 0, "high": 0, "critical": 0}
    timeline_map: dict[str, int] = {}

    for alert in alerts:
        bucket = _bucket_severity(alert.severity if isinstance(alert.severity, int) else None)
        if bucket:
            severity[bucket] += 1

        if not alert.timestamp:
            continue
        dt = alert.timestamp
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
        timeline_map[key] = timeline_map.get(key, 0) + 1

    timeline = [{"timestamp": key, "count": timeline_map[key]} for key in sorted(timeline_map.keys())]
    return {"total": len(alerts), "severity": severity, "timeline": timeline}


@router.get("")
async def list_alerts(
    query: str | None = None,
    limit: int = 100,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    payload: dict = {}
    items: list = []
    external_error: str | None = None

    try:
        client = WazuhClient()
        safe_limit = max(1, min(limit, 500))
        safe_offset = max(0, offset)
        response = await client.get_alerts(dql_query=query, limit=safe_limit, offset=safe_offset)

        payload = response.get("data", {})
        items = payload.get("items", [])

        for item in items:
            wazuh_alert_id = (
                str(item.get("id"))
                if item.get("id") is not None
                else str(item.get("_id") or item.get("agent", {}).get("id") or item.get("@timestamp") or "")
            )
            if not wazuh_alert_id:
                continue

            existing = db.query(Alert).filter(Alert.wazuh_alert_id == wazuh_alert_id).first()
            if existing:
                continue

            db.add(
                Alert(
                    wazuh_alert_id=wazuh_alert_id,
                    timestamp=_parse_timestamp(item.get("@timestamp")),
                    rule_id=str(item.get("rule", {}).get("id")) if item.get("rule", {}).get("id") else None,
                    severity=item.get("rule", {}).get("level"),
                    src_ip=item.get("data", {}).get("srcip") or item.get("srcip"),
                    dst_ip=item.get("data", {}).get("dstip") or item.get("dstip"),
                    raw_data=item,
                    status="new",
                )
            )

    except RuntimeError as exc:
        external_error = str(exc)
    except Exception as exc:
        external_error = f"Wazuh API request failed: {exc}"

    if external_error:
        safe_limit = max(1, min(limit, 500))
        safe_offset = max(0, offset)
        cached_alerts = db.query(Alert).order_by(Alert.timestamp.desc()).offset(safe_offset).limit(safe_limit).all()
        cached_total = db.query(Alert).count()
        items = [_serialize_cached_alert(alert) for alert in cached_alerts]
        payload = {
            "items": items,
            "total": cached_total,
            "source": "cache",
            "message": external_error,
        }

    db.add(
        SearchHistory(
            user_id=current_user.id,
            query=query or "",
            dql_translation=query,
            result_count=int(payload.get("total") or len(items)),
        )
    )
    db.commit()
    return {
        "data": payload,
        "error": 0,
    }


@router.get("/summary")
async def alerts_summary(
    query: str | None = None,
    interval: str = "day",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    del current_user
    try:
        client = WazuhClient()
        response = await client.get_alerts_summary(dql_query=query, interval=interval)
        payload = response.get("data", {})
        return {"data": payload, "error": response.get("error", 0)}
    except RuntimeError as exc:
        message = str(exc)
    except Exception as exc:
        message = f"Wazuh API request failed: {exc}"

    cached_alerts = db.query(Alert).order_by(Alert.timestamp.desc()).limit(5000).all()
    summary = _cache_summary(interval, cached_alerts)
    summary["source"] = "cache"
    summary["message"] = message
    return {"data": summary, "error": 0}
