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

def test_delete_case_success(client, db, test_user):
    headers = get_auth_headers(test_user.id)
    case = Case(
        title="To delete",
        severity="low",
        status="new",
        created_by=test_user.id
    )
    db.add(case)
    db.commit()
    db.refresh(case)

    response = client.delete(f"/cases/{case.id}", headers=headers)
    assert response.status_code == 204

    # Assert deleted
    stored = db.query(Case).filter(Case.id == case.id).first()
    assert stored is None

def test_delete_case_not_found(client, test_user):
    headers = get_auth_headers(test_user.id)
    response = client.delete("/cases/9999", headers=headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Case not found"

def test_bulk_close_cases(client, db, test_user):
    headers = get_auth_headers(test_user.id)
    case1 = Case(title="Case 1", severity="medium", status="new", created_by=test_user.id)
    case2 = Case(title="Case 2", severity="medium", status="new", created_by=test_user.id)
    db.add(case1)
    db.add(case2)
    db.commit()

    payload = {"case_ids": [case1.id, case2.id]}
    response = client.post("/cases/bulk-close", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    assert "Closed 2 cases" in response.json()["message"]

    db.refresh(case1)
    db.refresh(case2)
    assert case1.status == "closed"
    assert case2.status == "closed"

def test_bulk_close_empty(client, test_user):
    headers = get_auth_headers(test_user.id)
    payload = {"case_ids": []}
    response = client.post("/cases/bulk-close", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json()["message"] == "No cases to update"

def test_bulk_delete_cases(client, db, test_user):
    headers = get_auth_headers(test_user.id)
    case1 = Case(title="Case 1", severity="medium", status="new", created_by=test_user.id)
    case2 = Case(title="Case 2", severity="medium", status="new", created_by=test_user.id)
    db.add(case1)
    db.add(case2)
    db.commit()

    case1_id = case1.id
    case2_id = case2.id

    payload = {"case_ids": [case1_id, case2_id]}
    response = client.post("/cases/bulk-delete", json=payload, headers=headers)
    assert response.status_code == 204

    # Assert deleted from db
    c1 = db.query(Case).filter(Case.id == case1_id).first()
    c2 = db.query(Case).filter(Case.id == case2_id).first()
    assert c1 is None
    assert c2 is None

def test_bulk_delete_empty(client, test_user):
    headers = get_auth_headers(test_user.id)
    payload = {"case_ids": []}
    response = client.post("/cases/bulk-delete", json=payload, headers=headers)
    assert response.status_code == 204
