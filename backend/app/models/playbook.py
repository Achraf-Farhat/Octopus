from datetime import datetime
from sqlalchemy import ForeignKey, Integer, JSON, String, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Playbook(Base):
    __tablename__ = "playbooks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    trigger_condition: Mapped[str | None] = mapped_column(String(255), nullable=True)
    steps: Mapped[list] = mapped_column(JSON, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
