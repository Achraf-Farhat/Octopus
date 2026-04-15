import json
import re
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.services.ai_prompts import explain_alert_prompt, generate_rule_prompt, translate_to_query_prompt
from app.services.ollama_client import OllamaClient

router = APIRouter(prefix="/ai", tags=["ai"])


async def _ensure_ollama_ready(client: OllamaClient) -> None:
    if not client.base_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OLLAMA_API_URL is not configured",
        )
    if not await client.is_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Ollama service is unavailable",
        )
    if not await client.has_model(client.model):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Ollama model '{client.model}' is missing. Pull it first.",
        )


class SearchRequest(BaseModel):
    query: str
    mode: Literal["auto", "dql", "wql"] = "auto"


class ExplainRequest(BaseModel):
    rule_description: str
    severity: str
    src_ip: str
    mitre_technique: str
    alert_data: str


class RuleRequest(BaseModel):
    request: str


def _extract_json_object(value: str) -> dict:
    text = (value or "").strip()
    if not text:
        raise ValueError("Empty AI translation output")

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError("No JSON object found in AI output")

    parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise ValueError("AI output JSON root must be an object")
    return parsed


def _sanitize_query(value: str) -> str:
    query = " ".join((value or "").strip().split())
    if not query:
        raise ValueError("Translated query is empty")
    if query.startswith("`"):
        query = query.strip("`").strip()
    sql_pattern = r"\b(select|from|where|join|group\s+by|order\s+by|limit|insert|update|delete)\b"
    if re.search(sql_pattern, query, flags=re.IGNORECASE):
        return "@timestamp:[now-24h TO now]"
    if len(query) > 1000:
        query = query[:1000]
    return query


def _normalize_language(value: str | None, mode: str) -> str:
    candidate = (value or "").strip().lower()
    if candidate in {"dql", "wql"}:
        return candidate
    if mode in {"dql", "wql"}:
        return mode
    return "dql"


def _validate_confidence(value: object) -> float:
    try:
        score = float(value)
    except Exception:
        return 0.5
    if score < 0:
        return 0.0
    if score > 1:
        return 1.0
    return score


def _sanitize_text(value: object, fallback: str = "") -> str:
    text = " ".join(str(value or "").strip().split())
    return text if text else fallback


def _normalize_time_range(value: object) -> str:
    if isinstance(value, dict):
        start = _sanitize_text(value.get("start"), "unspecified")
        end = _sanitize_text(value.get("end"), "unspecified")
        return f"{start} to {end}"
    return _sanitize_text(value, "unspecified")


def _normalize_severity_assessment(value: object) -> str:
    candidate = _sanitize_text(value, "medium").lower()
    if candidate in {"low", "medium", "high", "critical"}:
        return candidate
    return "medium"


def _normalize_actions(value: object) -> list[str]:
    if isinstance(value, list):
        raw_actions = [_sanitize_text(item) for item in value]
    elif isinstance(value, str):
        raw_actions = [_sanitize_text(part) for part in re.split(r"\n+|;", value)]
    else:
        raw_actions = []

    actions = [item for item in raw_actions if item]
    if not actions:
        return [
            "Validate the alert context against related events and assets.",
            "Investigate source and destination activity for suspicious behavior.",
            "Contain affected hosts or accounts if compromise is suspected.",
        ]
    return actions[:5]


@router.post("/translate-search")
async def translate_search(payload: SearchRequest):
    client = OllamaClient()
    await _ensure_ollama_ready(client)
    prompt = translate_to_query_prompt(payload.query, datetime.now(timezone.utc).isoformat(), mode=payload.mode)

    raw_output = await client.chat(prompt)
    parsed = _extract_json_object(raw_output)

    language = _normalize_language(parsed.get("language"), payload.mode)
    query = _sanitize_query(str(parsed.get("query") or payload.query))
    confidence = _validate_confidence(parsed.get("confidence"))
    time_range = _normalize_time_range(parsed.get("time_range"))
    notes = str(parsed.get("notes") or "")

    return {
        "input": payload.query,
        "mode": payload.mode,
        "language": language,
        "query": query,
        "confidence": confidence,
        "time_range": time_range,
        "notes": notes,
        "dql": query,
    }


@router.post("/explain-alert")
async def explain_alert(payload: ExplainRequest):
    client = OllamaClient()
    await _ensure_ollama_ready(client)
    prompt = explain_alert_prompt(
        payload.rule_description,
        payload.severity,
        payload.src_ip,
        payload.mitre_technique,
        payload.alert_data,
    )
    raw_output = await client.chat(prompt)

    try:
        parsed = _extract_json_object(raw_output)
    except Exception:
        fallback = _sanitize_text(raw_output, "No explanation returned.")
        return {
            "explanation": fallback,
            "summary": fallback,
            "why_it_matters": "Potential security impact requires analyst review.",
            "recommended_actions": [
                "Correlate with nearby alerts and host activity.",
                "Investigate source and target entities for anomalies.",
                "Escalate according to incident response policy if malicious indicators are confirmed.",
            ],
            "severity_assessment": "medium",
            "confidence": 0.4,
            "notes": "Fallback used because structured model output was unavailable.",
        }

    summary = _sanitize_text(parsed.get("summary"), "No explanation returned.")
    why_it_matters = _sanitize_text(parsed.get("why_it_matters"), "Potential security impact requires analyst review.")
    recommended_actions = _normalize_actions(parsed.get("recommended_actions"))
    severity_assessment = _normalize_severity_assessment(parsed.get("severity_assessment"))
    confidence = _validate_confidence(parsed.get("confidence"))
    notes = _sanitize_text(parsed.get("notes"), "")

    explanation = "\n\n".join(
        [
            summary,
            f"Why it matters: {why_it_matters}",
            "Recommended actions:\n" + "\n".join([f"- {action}" for action in recommended_actions]),
        ]
    )

    return {
        "explanation": explanation,
        "summary": summary,
        "why_it_matters": why_it_matters,
        "recommended_actions": recommended_actions,
        "severity_assessment": severity_assessment,
        "confidence": confidence,
        "notes": notes,
    }


@router.post("/generate-rule")
async def generate_rule(payload: RuleRequest):
    client = OllamaClient()
    await _ensure_ollama_ready(client)
    prompt = generate_rule_prompt(payload.request)
    return {"xml": await client.chat(prompt)}
