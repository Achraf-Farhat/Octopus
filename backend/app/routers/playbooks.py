from fastapi import APIRouter, Depends, HTTPException, Request, status, BackgroundTasks
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user, require_roles
from app.models.playbook import Playbook
from app.models.playbook_execution import PlaybookExecution
from app.models.user import User
from app.schemas.playbook import PlaybookCreate, PlaybookExecutionRead, PlaybookRead
from app.services.audit import write_audit_log
from app.services.playbook_engine import PlaybookEngine

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


from pydantic import BaseModel

class PlaybookExecutePayload(BaseModel):
    alert_id: int | None = None


@router.post("/{playbook_id}/execute", response_model=PlaybookExecutionRead)
def execute_playbook(
    playbook_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    payload: PlaybookExecutePayload = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("L2")),
):
    playbook = db.query(Playbook).filter(Playbook.id == playbook_id).first()
    if not playbook:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Playbook not found")

    alert_id = payload.alert_id if payload else None

    execution = PlaybookExecution(
        playbook_id=playbook.id,
        executed_by=current_user.id,
        status="pending",
        execution_log={"logs": [], "node_status": {}, "active_node_id": None, "context": {}},
    )
    db.add(execution)
    db.commit()
    db.refresh(execution)

    # Trigger async execution in background tasks
    engine = PlaybookEngine(db)
    background_tasks.add_task(engine.execute, execution.id, alert_id=alert_id)

    write_audit_log(
        db,
        user_id=current_user.id,
        action="playbook.execute",
        resource_type="playbook",
        resource_id=str(playbook.id),
        details={"execution_id": execution.id, "alert_id": alert_id},
        ip_address=request.client.host if request.client else None,
    )

    return execution


@router.get("/executions/{execution_id}", response_model=PlaybookExecutionRead)
def get_execution_status(
    execution_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    execution = db.query(PlaybookExecution).filter(PlaybookExecution.id == execution_id).first()
    if not execution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Execution not found")
    return execution


# To avoid adding new class models, we can use simple post fields or dict
@router.post("/executions/{execution_id}/approve")
async def approve_playbook_execution(
    execution_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("L2")),
):
    execution = db.query(PlaybookExecution).filter(PlaybookExecution.id == execution_id).first()
    if not execution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Execution not found")
    
    approved = payload.get("approved", True)
    engine = PlaybookEngine(db)
    await engine.resume(execution_id, approved)
    
    return {"status": "success", "message": f"Execution resumed: approved={approved}"}
