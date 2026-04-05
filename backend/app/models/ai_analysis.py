from sqlalchemy import ForeignKey, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AIAnalysis(Base):
    __tablename__ = "ai_analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id"), nullable=False, unique=True)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    risk_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recommended_actions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    threat_intel: Mapped[dict | None] = mapped_column(JSON, nullable=True)
