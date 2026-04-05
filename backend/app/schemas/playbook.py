from datetime import datetime

from pydantic import BaseModel


class PlaybookCreate(BaseModel):
    name: str
    trigger_condition: str | None = None
    steps: list[dict]


class PlaybookRead(BaseModel):
    id: int
    name: str
    trigger_condition: str | None = None
    steps: list[dict]
    created_by: int | None = None

    class Config:
        from_attributes = True


class PlaybookExecutionRead(BaseModel):
    id: int
    playbook_id: int
    executed_by: int | None = None
    status: str
    execution_log: dict | None = None
    created_at: datetime

    class Config:
        from_attributes = True
