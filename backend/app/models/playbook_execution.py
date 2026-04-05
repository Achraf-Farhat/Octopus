from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PlaybookExecution(Base):
    __tablename__ = "playbook_executions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    playbook_id: Mapped[int] = mapped_column(ForeignKey("playbooks.id"), nullable=False)
    executed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(60), nullable=False, default="pending")
    execution_log: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
