from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user, require_roles
from app.models.playbook import Playbook
from app.models.playbook_execution import PlaybookExecution
from app.models.user import User
from app.schemas.playbook import PlaybookCreate, PlaybookExecutionRead, PlaybookRead
from app.services.audit import write_audit_log

router = APIRouter(prefix="/playbooks", tags=["playbooks"])


@router.get("", response_model=list[PlaybookRead])
def list_playbooks(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Playbook).order_by(Playbook.id.desc()).all()


@router.post("", response_model=PlaybookRead, status_code=status.HTTP_201_CREATED)
def create_playbook(
    payload: PlaybookCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Manager")),
):
    playbook = Playbook(
        name=payload.name,
        trigger_condition=payload.trigger_condition,
        steps=payload.steps,
        created_by=current_user.id,
    )
    db.add(playbook)
    db.commit()
    db.refresh(playbook)

    write_audit_log(
        db,
        user_id=current_user.id,
        action="playbook.create",
        resource_type="playbook",
        resource_id=str(playbook.id),
        details={"name": playbook.name},
        ip_address=request.client.host if request.client else None,
    )

    return playbook


@router.post("/{playbook_id}/execute", response_model=PlaybookExecutionRead)
def execute_playbook(
    playbook_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("L2")),
):
    playbook = db.query(Playbook).filter(Playbook.id == playbook_id).first()
    if not playbook:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Playbook not found")

    execution = PlaybookExecution(
        playbook_id=playbook.id,
        executed_by=current_user.id,
        status="completed",
        execution_log={"steps": len(playbook.steps), "result": "Executed manually"},
    )
    db.add(execution)
    db.commit()
    db.refresh(execution)

    write_audit_log(
        db,
        user_id=current_user.id,
        action="playbook.execute",
        resource_type="playbook",
        resource_id=str(playbook.id),
        details={"execution_id": execution.id},
        ip_address=request.client.host if request.client else None,
    )

    return execution
