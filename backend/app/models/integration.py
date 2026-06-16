from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Integration(Base):
    __tablename__ = "integrations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    connector_type: Mapped[str] = mapped_column(String(50), nullable=False)  # virustotal, entra_id, etc.
    config: Mapped[dict] = mapped_column(JSON, nullable=False)  # auth keys, url, etc.
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="disconnected")  # active, disconnected, error
    health_status: Mapped[dict] = mapped_column(JSON, nullable=False)  # latency, last_success, last_check
    capabilities: Mapped[list] = mapped_column(JSON, nullable=False)  # exposed action blocks
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
