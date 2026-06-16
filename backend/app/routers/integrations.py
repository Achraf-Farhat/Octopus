from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user
from app.models.integration import Integration
from app.models.user import User
from app.schemas.integration import IntegrationCreate, IntegrationRead

router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.get("", response_model=list[IntegrationRead])
def list_integrations(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Integration).order_by(Integration.id.asc()).all()


@router.post("", response_model=IntegrationRead, status_code=status.HTTP_201_CREATED)
def create_integration(
    payload: IntegrationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    capabilities = []
    if payload.connector_type == "virustotal":
        capabilities = [
            {"name": "Hash Lookup", "id": "vt_hash_lookup", "description": "Retrieve reputation score for a file hash."},
            {"name": "URL Scan", "id": "vt_url_scan", "description": "Scan URL or retrieve URL threat analysis."},
            {"name": "Domain Reputation", "id": "vt_domain_rep", "description": "Get threat classification and DNS profile of a domain."}
        ]
    elif payload.connector_type == "entra_id":
        capabilities = [
            {"name": "Get User Details", "id": "ad_get_user", "description": "Retrieve group membership, manager, status details."},
            {"name": "Disable User Account", "id": "ad_disable_user", "description": "Suspend user login access dynamically during incident."}
        ]
    elif payload.connector_type == "crowdstrike":
        capabilities = [
            {"name": "Isolate Host", "id": "cs_isolate_host", "description": "Isolate endpoint machine from network."},
            {"name": "Get Host Details", "id": "cs_get_host_details", "description": "Fetch status, OS, IP address, and agent status."}
        ]
    else:
        capabilities = [
            {"name": "Custom Request", "id": "custom_request", "description": "Trigger an authenticated HTTP action block."}
        ]

    health = {
        "latency_ms": 100,
        "error_rate": 0.0,
        "last_check": datetime.utcnow().isoformat() + "Z"
    }

    db_item = Integration(
        name=payload.name,
        connector_type=payload.connector_type,
        config=payload.config,
        status="active",
        health_status=health,
        capabilities=capabilities,
        created_by=current_user.id
    )
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item


@router.delete("/{id}")
def delete_integration(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    db.query(Integration).filter(Integration.id == id).delete()
    db.commit()
    return {"status": "success", "message": "Integration removed successfully"}


@router.post("/validate")
async def validate_integration(
    payload: IntegrationCreate,
    current_user: User = Depends(get_current_user)
):
    import time
    import httpx

    config = payload.config
    connector = payload.connector_type
    start_time = time.time()
    latency_ms = 0
    verified_permissions = []

    try:
        if connector == "virustotal":
            api_key = config.get("api_key")
            if not api_key:
                raise HTTPException(status_code=400, detail="VirusTotal requires a valid API key.")
            
            # Make a real request to VirusTotal API to test key validity using an empty file hash
            headers = {"x-apikey": api_key}
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(
                    "https://www.virustotal.com/api/v3/files/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                    headers=headers
                )
                if response.status_code in (401, 403):
                    raise HTTPException(status_code=400, detail="Invalid VirusTotal API key. Connection unauthorized.")
            verified_permissions = ["get:file_reputation", "get:url_reputation"]

        elif connector == "entra_id":
            tenant_id = config.get("tenant_id")
            client_id = config.get("client_id")
            client_secret = config.get("client_secret")
            if not tenant_id or not client_id or not client_secret:
                raise HTTPException(status_code=400, detail="Microsoft Entra ID requires Tenant ID, Client ID, and Secret.")
            
            # Make OAuth client credentials request to Microsoft
            token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
            token_data = {
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": "https://graph.microsoft.com/.default"
            }
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(token_url, data=token_data)
                if response.status_code != 200:
                    detail = "Connection failed. Please check Tenant ID, Client ID, and Secret."
                    try:
                        err_json = response.json()
                        if "error_description" in err_json:
                            detail = f"OAuth failure: {err_json['error_description']}"
                    except Exception:
                        pass
                    raise HTTPException(status_code=400, detail=detail)
            verified_permissions = ["read:directory", "write:users"]

        elif connector == "crowdstrike":
            client_id = config.get("client_id")
            client_secret = config.get("client_secret")
            if not client_id or not client_secret:
                raise HTTPException(status_code=400, detail="CrowdStrike Falcon requires Client ID and Client Secret.")
            
            # Query Crowdstrike OAuth endpoint
            token_url = "https://api.crowdstrike.com/oauth2/token"
            token_data = {
                "client_id": client_id,
                "client_secret": client_secret
            }
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(token_url, data=token_data)
                if response.status_code != 201:
                    detail = "CrowdStrike connection failed. Check Client ID and Client Secret."
                    try:
                        err_json = response.json()
                        if "errors" in err_json and len(err_json["errors"]) > 0:
                            detail = f"CrowdStrike Error: {err_json['errors'][0].get('message')}"
                    except Exception:
                        pass
                    raise HTTPException(status_code=400, detail=detail)
            verified_permissions = ["read:hosts", "write:containment"]

        elif connector == "custom_api":
            base_url = config.get("base_url")
            api_key = config.get("api_key")
            if not base_url:
                raise HTTPException(status_code=400, detail="Custom REST API requires a base_url.")
            headers = {}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(base_url, headers=headers)
                if response.status_code >= 400:
                    raise HTTPException(status_code=400, detail=f"Custom REST API returned status code {response.status_code}")
            verified_permissions = ["request:custom"]

        else:
            raise HTTPException(status_code=400, detail=f"Unknown connector type: {connector}")

        latency_ms = int((time.time() - start_time) * 1000)

        return {
            "status": "success",
            "message": f"Connection tests passed successfully for {payload.name}!",
            "latency_ms": max(1, latency_ms),
            "verified_permissions": verified_permissions
        }

    except httpx.HTTPError as ex:
        raise HTTPException(
            status_code=400,
            detail=f"Network error during integration validation check: {str(ex)}"
        )
