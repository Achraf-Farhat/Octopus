from datetime import datetime, timedelta, timezone
from app.core.security import create_token
from app.models.refresh_token import RefreshToken

def test_login_success(client, test_user):
    payload = {
        "username": "testuser",
        "password": "testpassword"
    }
    response = client.post("/auth/login", json=payload)
    assert response.status_code == 200
    assert "access_token" in response.json()
    assert "refresh_token" in response.json()

def test_login_invalid_password(client, test_user):
    payload = {
        "username": "testuser",
        "password": "wrongpassword"
    }
    response = client.post("/auth/login", json=payload)
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"

def test_login_invalid_username(client):
    payload = {
        "username": "nonexistent",
        "password": "testpassword"
    }
    response = client.post("/auth/login", json=payload)
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"

def test_refresh_token_success(client, db, test_user):
    refresh_token = create_token(
        subject=str(test_user.id),
        expires_delta=timedelta(days=7),
        token_type="refresh"
    )
    db.add(
        RefreshToken(
            user_id=test_user.id,
            token=refresh_token,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7)
        )
    )
    db.commit()

    payload = {"refresh_token": refresh_token}
    response = client.post("/auth/refresh", json=payload)
    assert response.status_code == 200
    assert "access_token" in response.json()

def test_refresh_token_expired_or_revoked(client, test_user):
    refresh_token = create_token(
        subject=str(test_user.id),
        expires_delta=timedelta(days=7),
        token_type="refresh"
    )
    payload = {"refresh_token": refresh_token}
    response = client.post("/auth/refresh", json=payload)
    assert response.status_code == 401
    assert response.json()["detail"] == "Refresh token expired or revoked"

def test_refresh_token_invalid_signature(client):
    payload = {"refresh_token": "invalidtoken"}
    response = client.post("/auth/refresh", json=payload)
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid refresh token"

def test_read_me_success(client, test_user):
    access_token = create_token(
        subject=str(test_user.id),
        expires_delta=timedelta(minutes=15),
        token_type="access"
    )
    headers = {"Authorization": f"Bearer {access_token}"}
    response = client.get("/auth/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["username"] == "testuser"
    assert response.json()["email"] == "testuser@example.com"

def test_read_me_unauthorized(client):
    response = client.get("/auth/me")
    assert response.status_code == 401

def test_logout_success(client, db, test_user):
    refresh_token = create_token(
        subject=str(test_user.id),
        expires_delta=timedelta(days=7),
        token_type="refresh"
    )
    db.add(
        RefreshToken(
            user_id=test_user.id,
            token=refresh_token,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7)
        )
    )
    db.commit()

    # Logged out by authenticating and passing refresh token
    access_token = create_token(
        subject=str(test_user.id),
        expires_delta=timedelta(minutes=15),
        token_type="access"
    )
    headers = {"Authorization": f"Bearer {access_token}"}
    payload = {"refresh_token": refresh_token}
    response = client.post("/auth/logout", json=payload, headers=headers)
    assert response.status_code == 204

    # Assert token was deleted
    stored = db.query(RefreshToken).filter(RefreshToken.token == refresh_token).first()
    assert stored is None

def test_change_password_success(client, test_user):
    access_token = create_token(
        subject=str(test_user.id),
        expires_delta=timedelta(minutes=15),
        token_type="access"
    )
    headers = {"Authorization": f"Bearer {access_token}"}
    payload = {
        "current_password": "testpassword",
        "new_password": "newsecurepassword"
    }
    response = client.post("/auth/change-password", json=payload, headers=headers)
    assert response.status_code == 204

    # Test login with new password
    login_payload = {
        "username": "testuser",
        "password": "newsecurepassword"
    }
    login_response = client.post("/auth/login", json=login_payload)
    assert login_response.status_code == 200

def test_change_password_incorrect_current(client, test_user):
    access_token = create_token(
        subject=str(test_user.id),
        expires_delta=timedelta(minutes=15),
        token_type="access"
    )
    headers = {"Authorization": f"Bearer {access_token}"}
    payload = {
        "current_password": "wrongcurrentpassword",
        "new_password": "newsecurepassword"
    }
    response = client.post("/auth/change-password", json=payload, headers=headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "Current password is incorrect"

def test_change_password_same_new(client, test_user):
    access_token = create_token(
        subject=str(test_user.id),
        expires_delta=timedelta(minutes=15),
        token_type="access"
    )
    headers = {"Authorization": f"Bearer {access_token}"}
    payload = {
        "current_password": "testpassword",
        "new_password": "testpassword"
    }
    response = client.post("/auth/change-password", json=payload, headers=headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "New password must be different"
