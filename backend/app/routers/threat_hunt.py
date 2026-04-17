from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user
from app.models.threat_hunt_message import ThreatHuntMessage
from app.models.user import User
from app.schemas.threat_hunt import ThreatHuntMessageCreate, ThreatHuntMessageRead, ThreatHuntReply
from app.services.ai_prompts import threat_hunt_system_prompt
from app.services.audit import write_audit_log
from app.services.ollama_client import OllamaClient

router = APIRouter(prefix="/threat-hunt", tags=["threat-hunt"])


def _fallback_reply(message: str) -> str:
    return (
        "AI service is currently unavailable. Continue with these quick hunt pivots:\n"
        "1) Pivot on source IP and username across recent auth failure events.\n"
        "2) Correlate failed logins with successful logins from same source within 30 minutes.\n"
        "3) Check destination hosts for process creation and privilege escalation events after login attempts.\n"
        f"Original query: {message}"
    )


@router.get("/messages", response_model=list[ThreatHuntMessageRead])
def list_messages(
    session_id: str,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    safe_limit = max(1, min(limit, 200))
    return (
        db.query(ThreatHuntMessage)
        .filter(ThreatHuntMessage.user_id == current_user.id, ThreatHuntMessage.session_id == session_id)
        .order_by(ThreatHuntMessage.id.asc())
        .limit(safe_limit)
        .all()
    )


@router.post("/messages", response_model=ThreatHuntReply)
async def send_message(
    payload: ThreatHuntMessageCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = payload.message.strip()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message cannot be empty")

    active_session = payload.session_id or uuid4().hex

    user_message = ThreatHuntMessage(
        user_id=current_user.id,
        session_id=active_session,
        role="user",
        content=content,
    )
    db.add(user_message)
    db.commit()

    recent_messages = (
        db.query(ThreatHuntMessage)
        .filter(ThreatHuntMessage.user_id == current_user.id, ThreatHuntMessage.session_id == active_session)
        .order_by(ThreatHuntMessage.id.desc())
        .limit(12)
        .all()
    )
    recent_messages = list(reversed(recent_messages))

    # Build structured message history for /api/chat
    system = threat_hunt_system_prompt()
    chat_messages = [{"role": "system", "content": system}]
    for message in recent_messages:
        role = "assistant" if message.role == "assistant" else "user"
        chat_messages.append({"role": role, "content": message.content})

    try:
        reply = await OllamaClient().chat("", system=system, messages=chat_messages)
    except Exception:
        reply = _fallback_reply(content)

    assistant_message = ThreatHuntMessage(
        user_id=current_user.id,
        session_id=active_session,
        role="assistant",
        content=reply.strip() or "No response returned.",
    )
    db.add(assistant_message)
    db.commit()

    write_audit_log(
        db,
        user_id=current_user.id,
        action="threat_hunt.message",
        resource_type="threat_hunt_session",
        resource_id=active_session,
        details={"message_length": len(content)},
        ip_address=request.client.host if request.client else None,
    )

    return ThreatHuntReply(session_id=active_session, reply=assistant_message.content)
