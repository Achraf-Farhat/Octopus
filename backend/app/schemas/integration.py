from datetime import datetime
from pydantic import BaseModel


class IntegrationCreate(BaseModel):
    name: str
    connector_type: str
    config: dict
    status: str = "active"
    health_status: dict = {}
    capabilities: list[dict] = []


class IntegrationRead(BaseModel):
    id: int
    name: str
    connector_type: str
    config: dict
    status: str
    health_status: dict
    capabilities: list[dict]
    created_by: int | None = None
    created_at: datetime

    class Config:
        from_attributes = True
