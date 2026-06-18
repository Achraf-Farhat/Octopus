from datetime import timedelta
from app.core.security import create_token
from app.models.case import Case

def get_auth_headers(user_id):
    access_token = create_token(
        subject=str(user_id),
        expires_delta=timedelta(minutes=15),
        token_type="access"
    )
    return {"Authorization": f"Bearer {access_token}"}

def test_list_cases_empty(client, test_user):
    headers = get_auth_headers(test_user.id)
    response = client.get("/cases", headers=headers)
    assert response.status_code == 200
    assert response.json() == []

def test_create_case_success(client, test_user):
    headers = get_auth_headers(test_user.id)
    payload = {
        "title": "Suspicious Login Attempt",
        "severity": "high",
        "related_alerts": ["alert123"],
        "assigned_to": test_user.id,
        "playbook_execution_id": None,
        "ai_investigation": "Generated AI Summary"
    }
    response = client.post("/cases", json=payload, headers=headers)
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Suspicious Login Attempt"
    assert data["severity"] == "high"
    assert data["status"] == "new"

def test_get_case_detail_success(client, db, test_user):
    headers = get_auth_headers(test_user.id)
    case = Case(
        title="Test Case",
        severity="medium",
        status="new",
        created_by=test_user.id
    )
    db.add(case)
    db.commit()
    db.refresh(case)

    response = client.get(f"/cases/{case.id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["title"] == "Test Case"

def test_get_case_detail_not_found(client, test_user):
    headers = get_auth_headers(test_user.id)
    response = client.get("/cases/9999", headers=headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Case not found"

def test_update_case_status(client, db, test_user):
    headers = get_auth_headers(test_user.id)
    case = Case(
        title="Test Case to Update",
        severity="medium",
        status="new",
        created_by=test_user.id
    )
    db.add(case)
    db.commit()
    db.refresh(case)

    payload = {"status": "in_progress"}
    response = client.patch(f"/cases/{case.id}", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "in_progress"

def test_update_case_not_found(client, test_user):
    headers = get_auth_headers(test_user.id)
    payload = {"status": "in_progress"}
    response = client.patch("/cases/9999", json=payload, headers=headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Case not found"
