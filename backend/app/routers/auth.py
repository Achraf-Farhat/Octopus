from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_token, decode_token, verify_password
from app.db.session import get_db
from app.deps import get_current_user
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.schemas.auth import LoginRequest, RefreshRequest, Token
from app.schemas.user import UserRead
from app.services.audit import write_audit_log

router = APIRouter(tags=["auth"])


@router.post("/login", response_model=Token)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    access_token = create_token(
        subject=str(user.id),
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
        token_type="access",
    )
    refresh_token = create_token(
        subject=str(user.id),
        expires_delta=timedelta(days=settings.refresh_token_expire_days),
        token_type="refresh",
    )

    db.add(
        RefreshToken(
            user_id=user.id,
            token=refresh_token,
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
        )
    )
    db.commit()

    write_audit_log(
        db,
        user_id=user.id,
        action="auth.login",
        resource_type="user",
        resource_id=str(user.id),
        details={"username": user.username},
        ip_address=request.client.host if request.client else None,
    )

    return Token(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=Token)
def refresh_tokens(payload: RefreshRequest, request: Request, db: Session = Depends(get_db)):
    try:
        decoded = decode_token(payload.refresh_token)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token") from exc

    if decoded.get("typ") != "refresh" or not decoded.get("sub"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    stored = db.query(RefreshToken).filter(RefreshToken.token == payload.refresh_token).first()
    if not stored or stored.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired or revoked")

    user = db.query(User).filter(User.id == int(decoded["sub"]), User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not available")

    db.delete(stored)

    access_token = create_token(
        subject=str(user.id),
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
        token_type="access",
    )
    refresh_token = create_token(
        subject=str(user.id),
        expires_delta=timedelta(days=settings.refresh_token_expire_days),
        token_type="refresh",
    )
    db.add(
        RefreshToken(
            user_id=user.id,
            token=refresh_token,
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
        )
    )
    db.commit()

    write_audit_log(
        db,
        user_id=user.id,
        action="auth.refresh",
        resource_type="user",
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
    )

    return Token(access_token=access_token, refresh_token=refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(payload: RefreshRequest, request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stored = db.query(RefreshToken).filter(RefreshToken.token == payload.refresh_token, RefreshToken.user_id == current_user.id).first()
    if stored:
        db.delete(stored)
        db.commit()

    write_audit_log(
        db,
        user_id=current_user.id,
        action="auth.logout",
        resource_type="user",
        resource_id=str(current_user.id),
        ip_address=request.client.host if request.client else None,
    )
    return None


@router.get("/me", response_model=UserRead)
def read_me(current_user: User = Depends(get_current_user)):
    return current_user
