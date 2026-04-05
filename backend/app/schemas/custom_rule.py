from datetime import datetime

from pydantic import BaseModel


class CustomRuleCreate(BaseModel):
    rule_id: str
    name: str
    xml_content: str


class CustomRuleRead(BaseModel):
    id: int
    rule_id: str
    name: str
    xml_content: str
    created_by: int | None = None
    status: str
    deployed_at: datetime | None = None

    class Config:
        from_attributes = True
