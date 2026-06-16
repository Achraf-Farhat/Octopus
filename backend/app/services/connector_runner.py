from __future__ import annotations

import re
import httpx


def resolve_variables(text: object, context: dict) -> object:
    if not isinstance(text, str):
        return text

    pattern = r"\{\{\s*(.*?)\s*\}\}"
    matches = re.findall(pattern, text)
    
    resolved_text = text
    for match in matches:
        parts = match.split(".")
        cur = context
        for p in parts:
            if isinstance(cur, dict) and p in cur:
                cur = cur[p]
            elif hasattr(cur, p):
                cur = getattr(cur, p)
            else:
                cur = None
                break
        
        target_placeholder = f"{{{{{match}}}}}"
        if cur is not None:
            resolved_text = resolved_text.replace(target_placeholder, str(cur))
        else:
            resolved_text = resolved_text.replace(target_placeholder, "")
            
    return resolved_text


async def run_connector_action(connector_type: str, config: dict, action_id: str, properties: dict, context: dict) -> dict:
    api_key = config.get("api_key")
    client_id = config.get("client_id")
    client_secret = config.get("client_secret")
    tenant_id = config.get("tenant_id")
    base_url = config.get("base_url")

    # Resolve target parameter (input parameter mapping)
    target = properties.get("target_field") or properties.get("hostname") or ""
    resolved_target = str(resolve_variables(target, context))

    # 1. VirusTotal Connector API
    if connector_type == "virustotal":
        if not api_key:
            raise ValueError("VirusTotal integration is missing an API key.")
        headers = {"x-apikey": api_key}
        async with httpx.AsyncClient(timeout=15) as client:
            if action_id == "vt_hash_lookup":
                url = f"https://www.virustotal.com/api/v3/files/{resolved_target}"
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return response.json()
            elif action_id == "vt_url_scan":
                url = "https://www.virustotal.com/api/v3/urls"
                response = await client.post(url, headers=headers, data={"url": resolved_target})
                response.raise_for_status()
                return response.json()
            elif action_id == "vt_domain_rep":
                url = f"https://www.virustotal.com/api/v3/domains/{resolved_target}"
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return response.json()
            else:
                raise ValueError(f"Unknown VirusTotal action: {action_id}")

    # 2. Microsoft Entra ID (Active Directory) Connector
    elif connector_type == "entra_id":
        if not tenant_id or not client_id or not client_secret:
            raise ValueError("Microsoft Entra ID requires tenant_id, client_id, and client_secret.")
        
        # Authenticate / Exchange token
        token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
        token_data = {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "https://graph.microsoft.com/.default"
        }
        async with httpx.AsyncClient(timeout=15) as client:
            token_resp = await client.post(token_url, data=token_data)
            token_resp.raise_for_status()
            access_token = token_resp.json().get("access_token")
            headers = {"Authorization": f"Bearer {access_token}"}

            if action_id == "ad_get_user":
                url = f"https://graph.microsoft.com/v1.0/users/{resolved_target}"
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return response.json()
            elif action_id == "ad_disable_user":
                url = f"https://graph.microsoft.com/v1.0/users/{resolved_target}"
                response = await client.patch(url, headers=headers, json={"accountEnabled": False})
                return {"status": "disabled", "status_code": response.status_code}
            else:
                raise ValueError(f"Unknown Entra ID action: {action_id}")

    # 3. CrowdStrike Falcon EDR Connector
    elif connector_type == "crowdstrike":
        if not client_id or not client_secret:
            raise ValueError("CrowdStrike Falcon requires client_id and client_secret.")
            
        token_url = "https://api.crowdstrike.com/oauth2/token"
        token_data = {
            "client_id": client_id,
            "client_secret": client_secret
        }
        async with httpx.AsyncClient(timeout=15) as client:
            token_resp = await client.post(token_url, data=token_data)
            token_resp.raise_for_status()
            access_token = token_resp.json().get("access_token")
            headers = {"Authorization": f"Bearer {access_token}"}

            if action_id == "cs_isolate_host":
                url = "https://api.crowdstrike.com/devices/entities/contain/v1"
                response = await client.post(url, headers=headers, json={"ids": [resolved_target]})
                response.raise_for_status()
                return response.json()
            elif action_id == "cs_get_host_details":
                url = f"https://api.crowdstrike.com/devices/entities/devices/v1?ids={resolved_target}"
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return response.json()
            else:
                raise ValueError(f"Unknown CrowdStrike Falcon action: {action_id}")

    # 4. Custom REST API Connector
    elif connector_type == "custom_api":
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
            
        async with httpx.AsyncClient(timeout=15) as client:
            url = resolved_target or base_url
            if not url:
                raise ValueError("Custom REST API requires a base_url or target url parameter.")
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return response.json()

    raise ValueError(f"Unknown connector connector_type: {connector_type}")
