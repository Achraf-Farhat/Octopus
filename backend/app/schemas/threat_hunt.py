from datetime import datetime

from pydantic import BaseModel


class ThreatHuntMessageCreate(BaseModel):
    message: str
    session_id: str | None = None


class ThreatHuntMessageRead(BaseModel):
    id: int
    session_id: str
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class ThreatHuntReply(BaseModel):
    session_id: str
    reply: str
