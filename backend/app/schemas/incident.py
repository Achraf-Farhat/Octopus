from datetime import datetime

from pydantic import BaseModel


class IncidentCreate(BaseModel):
    title: str
    severity: str
    related_alerts: list[str] | None = None
    assigned_to: int | None = None


class IncidentUpdate(BaseModel):
    status: str | None = None
    assigned_to: int | None = None


class IncidentRead(BaseModel):
    id: int
    title: str
    severity: str
    status: str
    related_alerts: list[str] | None = None
    created_by: int | None = None
    assigned_to: int | None = None
    created_at: datetime

    class Config:
        from_attributes = True
