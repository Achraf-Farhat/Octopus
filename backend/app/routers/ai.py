from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.services.ai_prompts import explain_alert_prompt, generate_rule_prompt, translate_to_dql_prompt
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


class ExplainRequest(BaseModel):
    rule_description: str
    severity: str
    src_ip: str
    mitre_technique: str
    alert_data: str


class RuleRequest(BaseModel):
    request: str


@router.post("/translate-search")
async def translate_search(payload: SearchRequest):
    client = OllamaClient()
    await _ensure_ollama_ready(client)
    prompt = translate_to_dql_prompt(payload.query, datetime.now(timezone.utc).isoformat())
    return {"query": payload.query, "dql": await client.chat(prompt)}


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
    return {"explanation": await client.chat(prompt)}


@router.post("/generate-rule")
async def generate_rule(payload: RuleRequest):
    client = OllamaClient()
    await _ensure_ollama_ready(client)
    prompt = generate_rule_prompt(payload.request)
    return {"xml": await client.chat(prompt)}
