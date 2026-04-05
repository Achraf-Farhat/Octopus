from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401
from app.bootstrap import ensure_bootstrap_admin
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.routers.ai import router as ai_router
from app.routers.alerts import router as alerts_router
from app.routers.auth import router as auth_router
from app.routers.health import router as health_router
from app.routers.incidents import router as incidents_router
from app.routers.playbooks import router as playbooks_router
from app.routers.rules import router as rules_router
from app.routers.threat_hunt import router as threat_hunt_router
from app.routers.users import router as users_router

app = FastAPI(title="Octopus SOC Platform", version="0.1.0")

app.add_middleware(
	CORSMiddleware,
	allow_origins=["http://localhost:5000", "http://127.0.0.1:5000", "http://localhost:5173", "http://127.0.0.1:5173"],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router, prefix="/auth")
app.include_router(ai_router)
app.include_router(alerts_router)
app.include_router(users_router)
app.include_router(incidents_router)
app.include_router(rules_router)
app.include_router(playbooks_router)
app.include_router(threat_hunt_router)


@app.on_event("startup")
def startup_event() -> None:
	Base.metadata.create_all(bind=engine)
	db = SessionLocal()
	try:
		ensure_bootstrap_admin(db)
	finally:
		db.close()
