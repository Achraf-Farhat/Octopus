from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    wazuh_alert_id: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    rule_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    severity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    src_ip: Mapped[str | None] = mapped_column(String(120), nullable=True)
    dst_ip: Mapped[str | None] = mapped_column(String(120), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    assigned_to: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(80), nullable=False, default="new")
