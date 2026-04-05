from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.models.user import User


def ensure_bootstrap_admin(db: Session) -> None:
    if not settings.bootstrap_admin_username or not settings.bootstrap_admin_password or not settings.bootstrap_admin_email:
        return

    existing = db.query(User).filter(User.username == settings.bootstrap_admin_username).first()
    if existing:
        return

    user = User(
        username=settings.bootstrap_admin_username,
        email=settings.bootstrap_admin_email,
        password_hash=hash_password(settings.bootstrap_admin_password),
        role="Admin",
        is_active=True,
    )
    db.add(user)
    db.commit()
