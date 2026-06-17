from datetime import datetime

from pydantic import BaseModel


class CaseCreate(BaseModel):
    title: str
    severity: str
    related_alerts: list[str] | None = None
    assigned_to: int | None = None
    playbook_execution_id: int | None = None
    ai_investigation: str | None = None


class CaseUpdate(BaseModel):
    status: str | None = None
    assigned_to: int | None = None
    ai_investigation: str | None = None


class CaseRead(BaseModel):
    id: int
    title: str
    severity: str
    status: str
    related_alerts: list[str] | None = None
    created_by: int | None = None
    assigned_to: int | None = None
    playbook_execution_id: int | None = None
    ai_investigation: str | None = None
    alert_details: dict | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class BulkCasesPayload(BaseModel):
    case_ids: list[int]
