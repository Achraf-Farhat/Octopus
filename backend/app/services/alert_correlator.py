from datetime import datetime, timedelta, timezone
from collections import defaultdict
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.models.alert import Alert

def normalize_to_utc_naive(dt: datetime) -> datetime:
    if not dt:
        return datetime.utcnow()
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt

def get_correlation_context(db: Session, timeframe_days: int = 90) -> str:
    """
    Queries alerts from the last timeframe_days and correlates them to identify:
    1. Failed logon attempts (SSH, RDP, etc.).
    2. Successful brute force pivots (failed logins followed by a success from the same source IP).
    3. Multi-host pivoting or scanning (same source IP triggering alerts on multiple endpoints).
    4. General high severity anomalies.
    
    Returns a Markdown-formatted summary context for the LLM.
    """
    start_date = datetime.utcnow() - timedelta(days=timeframe_days)
    
    # Query alerts in the timeframe. Limit to 2000 to keep context window manageable.
    alerts = (
        db.query(Alert)
        .filter(Alert.timestamp >= start_date)
        .order_by(Alert.timestamp.desc())
        .limit(2000)
        .all()
    )
    
    if not alerts:
        return "No alerts found in the database for the last 3 months. There is no active suspicious activity."

    total_alerts = len(alerts)
    
    auth_failures = []
    auth_successes = []
    other_suspicious = []
    
    for alert in alerts:
        raw = alert.raw_data if isinstance(alert.raw_data, dict) else {}
        rule_desc = raw.get("rule", {}).get("description", "")
        rule_groups = raw.get("rule", {}).get("groups", [])
        agent_name = raw.get("agent", {}).get("name") or raw.get("hostname") or "unknown-host"
        
        is_auth_fail = False
        is_auth_success = False
        
        # Determine authentication status
        if (
            "authentication_failed" in rule_groups 
            or "invalid_login" in rule_groups 
            or any(k in rule_desc.lower() for k in ["failed password", "authentication failed", "failed login", "login failed", "unauthorized logon"])
        ):
            is_auth_fail = True
        elif (
            "authentication_success" in rule_groups 
            or any(k in rule_desc.lower() for k in ["successful password", "authentication success", "successful login", "login successful", "successful logon"])
        ):
            is_auth_success = True
            
        alert_info = {
            "id": alert.wazuh_alert_id,
            "timestamp": normalize_to_utc_naive(alert.timestamp),
            "rule_id": alert.rule_id,
            "rule_description": rule_desc,
            "severity": alert.severity or 0,
            "src_ip": alert.src_ip or "0.0.0.0",
            "dst_ip": alert.dst_ip or "0.0.0.0",
            "agent_name": agent_name,
        }
        
        # Don't track localhost or empty IPs as external sources
        if alert_info["src_ip"] in ("127.0.0.1", "::1", "0.0.0.0", ""):
            # Try to see if we can resolve srcip from raw data
            srcip = raw.get("data", {}).get("srcip") or raw.get("srcip")
            if srcip and srcip not in ("127.0.0.1", "::1", "0.0.0.0", ""):
                alert_info["src_ip"] = srcip
        
        if is_auth_fail:
            auth_failures.append(alert_info)
        elif is_auth_success:
            auth_successes.append(alert_info)
        elif (alert.severity or 0) >= 8 or any(
            k in rule_desc.lower() 
            for k in ["malware", "trojan", "ransomware", "exploit", "shell", "privilege escalation", "scan", "flood", "ddos"]
        ):
            other_suspicious.append(alert_info)

    # A. Suspicious Logon / Brute Force Correlation
    # Group failures by (src_ip, agent_name)
    fail_groups = defaultdict(list)
    for f in auth_failures:
        if f["src_ip"] and f["src_ip"] != "0.0.0.0":
            key = (f["src_ip"], f["agent_name"])
            fail_groups[key].append(f)
            
    suspicious_auth_activities = []
    for (src_ip, agent), fails in fail_groups.items():
        num_fails = len(fails)
        rule_descs = list(set(f["rule_description"] for f in fails))
        
        # Check if there was a successful login from this IP on this agent shortly after or during failures
        matching_success = []
        first_fail_time = min(f["timestamp"] for f in fails)
        last_fail_time = max(f["timestamp"] for f in fails)
        
        for s in auth_successes:
            if s["src_ip"] == src_ip and s["agent_name"] == agent:
                # Success happened after first failure and within 4 hours of the last failure
                if first_fail_time <= s["timestamp"] <= (last_fail_time + timedelta(hours=4)):
                    matching_success.append(s)
                    
        if num_fails >= 3:
            status = "POTENTIAL BRUTE FORCE ATTACK"
            if matching_success:
                status = "CRITICAL: SUSPICION OF BRUTE FORCE SUCCESS (PIVOT)"
            
            suspicious_auth_activities.append({
                "src_ip": src_ip,
                "agent_name": agent,
                "fail_count": num_fails,
                "first_fail": first_fail_time.isoformat() + "Z",
                "last_fail": last_fail_time.isoformat() + "Z",
                "status": status,
                "descriptions": rule_descs,
                "success_event": matching_success[0] if matching_success else None
            })

    # B. Pivoting / Lateral Movement / Scanning Detection
    # Source IPs triggering alerts across multiple endpoints
    src_ip_agents = defaultdict(set)
    src_ip_alerts = defaultdict(list)
    for a in alerts:
        if a.src_ip and a.src_ip not in ("0.0.0.0", "127.0.0.1", ""):
            raw = a.raw_data if isinstance(a.raw_data, dict) else {}
            agent_name = raw.get("agent", {}).get("name") or raw.get("hostname") or "unknown-host"
            src_ip_agents[a.src_ip].add(agent_name)
            src_ip_alerts[a.src_ip].append(a)
            
    suspicious_pivots = []
    for src_ip, agents in src_ip_agents.items():
        if len(agents) >= 2:
            descriptions = list(set(
                a.raw_data.get("rule", {}).get("description") 
                for a in src_ip_alerts[src_ip] 
                if isinstance(a.raw_data, dict) and a.raw_data.get("rule", {}).get("description")
            ))
            suspicious_pivots.append({
                "src_ip": src_ip,
                "agents_touched": list(agents),
                "total_alerts": len(src_ip_alerts[src_ip]),
                "alert_types": descriptions
            })
            
    # C. High Severity anomalies
    recent_anomalies = []
    for o in other_suspicious[:15]:
        recent_anomalies.append({
            "timestamp": o["timestamp"].isoformat() + "Z",
            "rule_id": o["rule_id"],
            "description": o["rule_description"],
            "severity": o["severity"],
            "src_ip": o["src_ip"],
            "dst_ip": o["dst_ip"],
            "agent_name": o["agent_name"]
        })
        
    # Format the markdown output
    lines = [
        f"### live soc database alerts analysis summary (last {timeframe_days} days)",
        f"Total alerts in database for this timeframe: {total_alerts}\n"
    ]
    
    # 1. Suspicious authentication
    lines.append("#### [SUSPICIOUS AUTHENTICATION ACTIVITY]")
    if suspicious_auth_activities:
        for sa in suspicious_auth_activities:
            lines.append(f"- **Source IP**: `{sa['src_ip']}` -> **Target Host**: `{sa['agent_name']}`")
            lines.append(f"  - Status: **{sa['status']}**")
            lines.append(f"  - Failed logon count: **{sa['fail_count']}** (Timeframe: {sa['first_fail']} to {sa['last_fail']})")
            lines.append(f"  - Rules Triggered: {', '.join([f'`{d}`' for d in sa['descriptions']])}")
            if sa['success_event']:
                lines.append(f"  - **Succeeded Logon**: `{sa['success_event']['rule_description']}` at `{sa['success_event']['timestamp'].isoformat()}Z`")
    else:
        lines.append("- No suspicious authentication failures or brute force patterns detected in the last 3 months.")
        
    lines.append("")
    
    # 2. Suspicious pivots
    lines.append("#### [SUSPICIOUS PIVOTS / SCANNING / LATERAL MOVEMENT]")
    if suspicious_pivots:
        for sp in suspicious_pivots:
            lines.append(f"- **Source IP**: `{sp['src_ip']}` has triggered alerts across multiple distinct hosts:")
            lines.append(f"  - Target Agents: {', '.join([f'`{a}`' for a in sp['agents_touched']])}")
            lines.append(f"  - Total Alert Count: {sp['total_alerts']}")
            lines.append(f"  - Rules Triggered: {', '.join([f'`{t}`' for t in sp['alert_types']])}")
    else:
        lines.append("- No cross-host scanning or lateral movement pivots detected in the last 3 months.")
        
    lines.append("")
    
    # 3. High severity anomalies
    lines.append("#### [HIGH SEVERITY ANOMALIES & OTHER DETECTIONS]")
    if recent_anomalies:
        for ra in recent_anomalies:
            src_str = f" from `{ra['src_ip']}`" if ra['src_ip'] and ra['src_ip'] != "0.0.0.0" else ""
            dst_str = f" to `{ra['dst_ip']}`" if ra['dst_ip'] and ra['dst_ip'] != "0.0.0.0" else ""
            lines.append(f"- **[{ra['timestamp']}]** [Severity {ra['severity']}] (Rule {ra['rule_id']}) on `{ra['agent_name']}`: {ra['description']}{src_str}{dst_str}")
    else:
        lines.append("- No high severity alerts (level >= 8) or security policy violations detected in the last 3 months.")
        
    return "\n".join(lines)
