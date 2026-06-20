from fastapi import APIRouter, Depends, HTTPException, status
from app.deps import get_current_user
from app.services.wazuh_client import WazuhClient
from app.models.user import User
from typing import Any, Optional

router = APIRouter(prefix="/endpoints", tags=["endpoints"])

@router.get("")
async def list_endpoints(
    current_user: User = Depends(get_current_user)
):
    try:
        client = WazuhClient()
        resp = await client._request("GET", "/agents")
        return resp.get("data", {}).get("affected_items", [])
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch endpoints from Wazuh: {str(e)}"
        )

@router.get("/{agent_id}")
async def get_endpoint_details(
    agent_id: str,
    current_user: User = Depends(get_current_user)
):
    if not agent_id.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid agent ID format"
        )
    client = WazuhClient()
    details = {}
    
    # 1. Fetch general agent info
    try:
        agent_resp = await client._request("GET", f"/agents?agents_list={agent_id}")
        items = agent_resp.get("data", {}).get("affected_items", [])
        if not items:
            raise HTTPException(status_code=404, detail="Endpoint not found")
        details["general"] = items[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch agent info: {str(e)}")

    # 2. Fetch hardware info (optional)
    try:
        hw_resp = await client._request("GET", f"/syscollector/{agent_id}/hardware")
        hw_items = hw_resp.get("data", {}).get("affected_items", [])
        details["hardware"] = hw_items[0] if hw_items else None
    except Exception:
        details["hardware"] = None

    # 3. Fetch OS/kernel info (optional)
    try:
        os_resp = await client._request("GET", f"/syscollector/{agent_id}/os")
        os_items = os_resp.get("data", {}).get("affected_items", [])
        details["os"] = os_items[0] if os_items else None
    except Exception:
        details["os"] = None

    return details

@router.get("/{agent_id}/netiface")
async def get_endpoint_netiface(
    agent_id: str,
    current_user: User = Depends(get_current_user)
):
    if not agent_id.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid agent ID format"
        )
    try:
        client = WazuhClient()
        resp = await client._request("GET", f"/syscollector/{agent_id}/netiface")
        return resp.get("data", {}).get("affected_items", [])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch network interfaces: {str(e)}")

@router.get("/{agent_id}/processes")
async def get_endpoint_processes(
    agent_id: str,
    limit: int = 100,
    offset: int = 0,
    current_user: User = Depends(get_current_user)
):
    if not agent_id.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid agent ID format"
        )
    try:
        client = WazuhClient()
        resp = await client._request("GET", f"/syscollector/{agent_id}/processes", params={"limit": limit, "offset": offset})
        return {
            "items": resp.get("data", {}).get("affected_items", []),
            "total": resp.get("data", {}).get("total_affected_items", 0)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch running processes: {str(e)}")

@router.get("/{agent_id}/packages")
async def get_endpoint_packages(
    agent_id: str,
    limit: int = 100,
    offset: int = 0,
    current_user: User = Depends(get_current_user)
):
    if not agent_id.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid agent ID format"
        )
    try:
        client = WazuhClient()
        resp = await client._request("GET", f"/syscollector/{agent_id}/packages", params={"limit": limit, "offset": offset})
        return {
            "items": resp.get("data", {}).get("affected_items", []),
            "total": resp.get("data", {}).get("total_affected_items", 0)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch installed packages: {str(e)}")

