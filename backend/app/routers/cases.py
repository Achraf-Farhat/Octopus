from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user, require_roles
from app.models.case import Case
from app.models.alert import Alert
from app.models.user import User
from app.schemas.case import CaseCreate, CaseRead, CaseUpdate, BulkCasesPayload
from app.services.audit import write_audit_log

router = APIRouter(prefix="/cases", tags=["cases"])


@router.get("", response_model=list[CaseRead])
def list_cases(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cases = db.query(Case).order_by(Case.id.desc()).all()
    for case in cases:
        alert_details = None
        if case.related_alerts and len(case.related_alerts) > 0:
            wazuh_id = case.related_alerts[0]
            alert = db.query(Alert).filter(Alert.wazuh_alert_id == wazuh_id).first()
            if alert:
                alert_details = alert.raw_data
        case.alert_details = alert_details
    return cases


@router.get("/{case_id}", response_model=CaseRead)
def get_case(case_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
        
    alert_details = None
    if case.related_alerts and len(case.related_alerts) > 0:
        wazuh_id = case.related_alerts[0]
        alert = db.query(Alert).filter(Alert.wazuh_alert_id == wazuh_id).first()
        if alert:
            alert_details = alert.raw_data
    case.alert_details = alert_details
    return case


@router.post("", response_model=CaseRead, status_code=status.HTTP_201_CREATED)
def create_case(
    payload: CaseCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("L2")),
):
    case = Case(
        title=payload.title,
        severity=payload.severity,
        status="new",
        related_alerts=payload.related_alerts,
        created_by=current_user.id,
        assigned_to=payload.assigned_to,
        playbook_execution_id=payload.playbook_execution_id,
        ai_investigation=payload.ai_investigation,
    )
    db.add(case)
    db.commit()
    db.refresh(case)

    write_audit_log(
        db,
        user_id=current_user.id,
        action="case.create",
        resource_type="case",
        resource_id=str(case.id),
        details={"title": case.title, "severity": case.severity},
        ip_address=request.client.host if request.client else None,
    )

    return case


@router.patch("/{case_id}", response_model=CaseRead)
def update_case(
    case_id: int,
    payload: CaseUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("L2")),
):
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")

    if payload.status is not None:
        case.status = payload.status
    if payload.assigned_to is not None:
        if payload.assigned_to == 0 or payload.assigned_to is None:
            case.assigned_to = None
        else:
            assignee = db.query(User).filter(User.id == payload.assigned_to).first()
            if not assignee:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee not found")
            case.assigned_to = payload.assigned_to
    if payload.ai_investigation is not None:
        case.ai_investigation = payload.ai_investigation

    db.add(case)
    db.commit()
    db.refresh(case)

    write_audit_log(
        db,
        user_id=current_user.id,
        action="case.update",
        resource_type="case",
        resource_id=str(case.id),
        details={"status": case.status, "assigned_to": case.assigned_to},
        ip_address=request.client.host if request.client else None,
    )

    return case


@router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_case(
    case_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("L2")),
):
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
        
    db.delete(case)
    db.commit()

    write_audit_log(
        db,
        user_id=current_user.id,
        action="case.delete",
        resource_type="case",
        resource_id=str(case_id),
        details={"title": case.title},
        ip_address=request.client.host if request.client else None,
    )


@router.post("/bulk-close")
def bulk_close_cases(
    payload: BulkCasesPayload,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("L2")),
):
    if not payload.case_ids:
        return {"status": "success", "message": "No cases to update"}
        
    db.query(Case).filter(Case.id.in_(payload.case_ids)).update({Case.status: "closed"}, synchronize_session=False)
    db.commit()

    write_audit_log(
        db,
        user_id=current_user.id,
        action="case.bulk_close",
        resource_type="case",
        resource_id="multiple",
        details={"case_ids": payload.case_ids},
        ip_address=request.client.host if request.client else None,
    )
    return {"status": "success", "message": f"Closed {len(payload.case_ids)} cases"}


@router.post("/bulk-delete", status_code=status.HTTP_204_NO_CONTENT)
def bulk_delete_cases(
    payload: BulkCasesPayload,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("L2")),
):
    if not payload.case_ids:
        return
        
    db.query(Case).filter(Case.id.in_(payload.case_ids)).delete(synchronize_session=False)
    db.commit()

    write_audit_log(
        db,
        user_id=current_user.id,
        action="case.bulk_delete",
        resource_type="case",
        resource_id="multiple",
        details={"case_ids": payload.case_ids},
        ip_address=request.client.host if request.client else None,
    )
