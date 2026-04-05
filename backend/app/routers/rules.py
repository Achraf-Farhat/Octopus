from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user, require_roles
from app.models.custom_rule import CustomRule
from app.models.user import User
from app.schemas.custom_rule import CustomRuleCreate, CustomRuleRead
from app.services.audit import write_audit_log

router = APIRouter(prefix="/rules", tags=["rules"])


@router.get("", response_model=list[CustomRuleRead])
def list_rules(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(CustomRule).order_by(CustomRule.id.desc()).all()


@router.post("", response_model=CustomRuleRead, status_code=status.HTTP_201_CREATED)
def create_rule(
    payload: CustomRuleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Manager")),
):
    existing = db.query(CustomRule).filter(CustomRule.rule_id == payload.rule_id).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rule ID already exists")

    rule = CustomRule(
        rule_id=payload.rule_id,
        name=payload.name,
        xml_content=payload.xml_content,
        created_by=current_user.id,
        status="draft",
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)

    write_audit_log(
        db,
        user_id=current_user.id,
        action="rule.create",
        resource_type="custom_rule",
        resource_id=str(rule.id),
        details={"rule_id": rule.rule_id, "name": rule.name},
        ip_address=request.client.host if request.client else None,
    )

    return rule


@router.post("/{rule_id}/deploy", response_model=CustomRuleRead)
def deploy_rule(
    rule_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin")),
):
    rule = db.query(CustomRule).filter(CustomRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")

    rule.status = "deployed"
    rule.deployed_at = datetime.utcnow()
    db.add(rule)
    db.commit()
    db.refresh(rule)

    write_audit_log(
        db,
        user_id=current_user.id,
        action="rule.deploy",
        resource_type="custom_rule",
        resource_id=str(rule.id),
        details={"rule_id": rule.rule_id},
        ip_address=request.client.host if request.client else None,
    )

    return rule
