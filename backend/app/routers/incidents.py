from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user, require_roles
from app.models.incident import Incident
from app.models.user import User
from app.schemas.incident import IncidentCreate, IncidentRead, IncidentUpdate
from app.services.audit import write_audit_log

router = APIRouter(prefix="/incidents", tags=["incidents"])


@router.get("", response_model=list[IncidentRead])
def list_incidents(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Incident).order_by(Incident.id.desc()).all()


@router.post("", response_model=IncidentRead, status_code=status.HTTP_201_CREATED)
def create_incident(
    payload: IncidentCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("L2")),
):
    incident = Incident(
        title=payload.title,
        severity=payload.severity,
        status="open",
        related_alerts=payload.related_alerts,
        created_by=current_user.id,
        assigned_to=payload.assigned_to,
    )
    db.add(incident)
    db.commit()
    db.refresh(incident)

    write_audit_log(
        db,
        user_id=current_user.id,
        action="incident.create",
        resource_type="incident",
        resource_id=str(incident.id),
        details={"title": incident.title, "severity": incident.severity},
        ip_address=request.client.host if request.client else None,
    )

    return incident


@router.patch("/{incident_id}", response_model=IncidentRead)
def update_incident(
    incident_id: int,
    payload: IncidentUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("L2")),
):
    incident = db.query(Incident).filter(Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")

    if payload.status is not None:
        incident.status = payload.status
    if payload.assigned_to is not None:
        assignee = db.query(User).filter(User.id == payload.assigned_to).first()
        if not assignee:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee not found")
        incident.assigned_to = payload.assigned_to

    db.add(incident)
    db.commit()
    db.refresh(incident)

    write_audit_log(
        db,
        user_id=current_user.id,
        action="incident.update",
        resource_type="incident",
        resource_id=str(incident.id),
        details={"status": incident.status, "assigned_to": incident.assigned_to},
        ip_address=request.client.host if request.client else None,
    )

    return incident
