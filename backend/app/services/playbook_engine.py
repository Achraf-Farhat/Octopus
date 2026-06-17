from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import re
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models.playbook import Playbook
from app.models.playbook_execution import PlaybookExecution
from app.models.integration import Integration
from app.models.alert import Alert
from app.models.case import Case
from app.models.user import User
from app.services.connector_runner import resolve_variables, run_connector_action
from app.services.email_service import send_playbook_email
from app.services.ai_prompts import ai_investigation_playbook_prompt
from app.services.ollama_client import OllamaClient


def should_trigger_playbook(trigger_cond: str, alert: Alert) -> bool:
    """
    Evaluates whether an alert matches a playbook's trigger condition.
    Supports:
      - Severity level conditions: e.g. 'rule.level >= 10', 'severity >= 8'
      - Rule ID conditions: e.g. 'rule.id == 5710', 'rule_id == 5716'
    """
    if not trigger_cond:
        return False
    cond = trigger_cond.strip().replace(" ", "")
    
    # 1. Severity triggers: rule.level>=X or severity>=X
    severity_match = re.match(r"^(?:rule\.level|severity)(>=|>|==|<=|<)(\d+)$", cond, re.IGNORECASE)
    if severity_match:
        op, val_str = severity_match.groups()
        val = int(val_str)
        alert_sev = alert.severity or 0
        if op == ">=": return alert_sev >= val
        if op == ">": return alert_sev > val
        if op == "==": return alert_sev == val
        if op == "<=": return alert_sev <= val
        if op == "<": return alert_sev < val

    # 2. Rule ID triggers: rule.id==Y or rule_id==Y
    rule_match = re.match(r"^(?:rule\.id|rule_id|rule)==(\d+)$", cond, re.IGNORECASE)
    if rule_match:
        val = rule_match.group(1)
        return str(alert.rule_id) == str(val)

    return False


def evaluate_alerts_for_playbooks(alert_ids: list[int]):
    """
    Background worker task to evaluate playbooks against newly loaded alerts.
    """
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        playbooks = db.query(Playbook).filter(Playbook.enabled == True).all()
        alerts = db.query(Alert).filter(Alert.id.in_(alert_ids)).all()
        
        for alert in alerts:
            for playbook in playbooks:
                # Filter out alerts that arrived before the playbook was enabled
                if playbook.last_enabled_at and alert.timestamp:
                    a_tz = alert.timestamp.astimezone(timezone.utc) if alert.timestamp.tzinfo else alert.timestamp.replace(tzinfo=timezone.utc)
                    p_tz = playbook.last_enabled_at.astimezone(timezone.utc) if playbook.last_enabled_at.tzinfo else playbook.last_enabled_at.replace(tzinfo=timezone.utc)
                    if a_tz < p_tz:
                        continue  # Skip this alert, it is older than when the playbook was enabled
                
                if should_trigger_playbook(playbook.trigger_condition, alert):
                    # Trigger automatic background execution
                    execution = PlaybookExecution(
                        playbook_id=playbook.id,
                        executed_by=None,  # system triggered
                        status="pending",
                        execution_log={"logs": [], "node_status": {}, "active_node_id": None, "context": {}},
                    )
                    db.add(execution)
                    db.commit()
                    db.refresh(execution)
                    
                    # Run async execution in a new loop (runs in background thread pool)
                    engine = PlaybookEngine(db)
                    asyncio.run(engine.execute(execution.id, alert_id=alert.id))
    except Exception as e:
        print(f"Error evaluating playbook triggers: {e}")
    finally:
        db.close()


class PlaybookEngine:
    def __init__(self, db: Session):
        self.db = db

    def evaluate_condition(self, cond: str, context: dict) -> bool:
        resolved = str(resolve_variables(cond, context)).strip()
        
        # Support simple math comparisons like: 8 > 5
        match = re.match(r"^(\d+)\s*(>|<|==|!=)\s*(\d+)$", resolved)
        if match:
            val1, op, val2 = match.groups()
            v1, v2 = int(val1), int(val2)
            if op == ">": return v1 > v2
            if op == "<": return v1 < v2
            if op == "==": return v1 == v2
            if op == "!=": return v1 != v2
            
        # Support strings check like: "malicious" == "malicious"
        match_str = re.match(r'^"([^"]*)"\s*(==|!=)\s*"([^"]*)"$', resolved)
        if match_str:
            val1, op, val2 = match_str.groups()
            if op == "==": return val1 == val2
            if op == "!=": return val1 != val2

        if resolved.lower() in ("true", "1", "yes", "approved"):
            return True
        return False

    def log_event(self, execution: PlaybookExecution, text: str, log_type: str = "info"):
        timestamp = datetime.utcnow().isoformat() + "Z"
        log_entry = {"time": timestamp, "text": text, "type": log_type}
        
        log_data = execution.execution_log or {}
        if "logs" not in log_data:
            log_data["logs"] = []
        log_data["logs"].append(log_entry)
        execution.execution_log = log_data
        flag_modified(execution, "execution_log")
        self.db.add(execution)
        self.db.commit()

    async def execute(self, execution_id: int, alert_id: int | None = None, mock_payload: dict | None = None):
        from app.db.session import SessionLocal
        db = SessionLocal()
        self.db = db
        try:
            execution = db.query(PlaybookExecution).filter(PlaybookExecution.id == execution_id).first()
            if not execution:
                return

            playbook = db.query(Playbook).filter(Playbook.id == execution.playbook_id).first()
            if not playbook:
                execution.status = "failed"
                self.log_event(execution, "Error: Playbook not found.", "error")
                return

            # Initialize context
            context = {
                "alert": {},
                "trigger": {},
                "vars": {},
                "vt_reputation": 0
            }

            alert = None
            if alert_id:
                alert = db.query(Alert).filter(Alert.id == alert_id).first()
            else:
                alert = db.query(Alert).order_by(Alert.id.desc()).first()

            if not alert:
                execution.status = "failed"
                db.add(execution)
                db.commit()
                self.log_event(execution, "Error: No real alert found in the database. Playbook executions require a real alert event to process.", "error")
                return

            raw = alert.raw_data if isinstance(alert.raw_data, dict) else {}
            agent_name = raw.get("agent", {}).get("name") or raw.get("hostname") or "unknown-host"
            file_hash = raw.get("syscheck", {}).get("sha256_after") or raw.get("hash") or raw.get("sha256") or ""

            context["alert"] = {
                "id": alert.id,
                "wazuh_alert_id": alert.wazuh_alert_id,
                "src_ip": alert.src_ip or "0.0.0.0",
                "dst_ip": alert.dst_ip or "0.0.0.0",
                "severity": alert.severity or 0,
                "rule_id": alert.rule_id or "0",
                "hostname": agent_name,
                "file_hash": file_hash
            }

            execution.status = "running"
            log_data = execution.execution_log or {}
            log_data["context"] = context
            execution.execution_log = log_data
            flag_modified(execution, "execution_log")
            db.add(execution)
            db.commit()

            self.log_event(execution, f"Initialized playbook: '{playbook.name}'", "info")

            # Create new Case linked to this playbook execution run
            case = Case(
                title=f"Case: {playbook.name} on {agent_name}",
                severity=str(alert.severity or "medium"),
                status="new",
                related_alerts=[alert.wazuh_alert_id],
                created_by=execution.executed_by,
                assigned_to=None,
                playbook_execution_id=execution.id,
                ai_investigation=None
            )
            db.add(case)
            db.commit()
            db.refresh(case)
            self.log_event(execution, f"Created new Case #{case.id} linked to this execution.", "success")

            # Parse steps and graph layout
            canvas_nodes = []
            canvas_edges = []
            if playbook.steps and len(playbook.steps) > 0:
                canvas_nodes = playbook.steps[0].get("canvas_nodes", [])
                canvas_edges = playbook.steps[0].get("canvas_edges", [])

            trigger_node = next((n for n in canvas_nodes if n.get("type") == "trigger"), None)
            if not trigger_node:
                execution.status = "failed"
                self.log_event(execution, "Error: Playbook lacks a trigger node block.", "error")
                return

            # Start execution flow recursively from the trigger block
            await self._run_node(execution, trigger_node.get("id"), canvas_nodes, canvas_edges)
        finally:
            db.close()

    async def resume(self, execution_id: int, approved: bool):
        execution = self.db.query(PlaybookExecution).filter(PlaybookExecution.id == execution_id).first()
        if not execution or execution.status != "waiting_approval":
            return

        playbook = self.db.query(Playbook).filter(Playbook.id == execution.playbook_id).first()
        if not playbook:
            return

        log_data = execution.execution_log or {}
        active_node_id = log_data.get("suspended_node_id")

        canvas_nodes = playbook.steps[0].get("canvas_nodes", [])
        canvas_edges = playbook.steps[0].get("canvas_edges", [])

        node = next((n for n in canvas_nodes if n.get("id") == active_node_id), None)
        if not node:
            return

        # Resume execution
        self.log_event(execution, f"Analyst response received: {'APPROVED' if approved else 'REJECTED'}", "success" if approved else "warning")

        if approved:
            # Mark the node completed and move downstream
            execution.status = "running"
            log_data["node_status"] = log_data.get("node_status", {})
            log_data["node_status"][active_node_id] = "completed"
            execution.execution_log = log_data
            flag_modified(execution, "execution_log")
            self.db.add(execution)
            self.db.commit()

            outgoing_edges = [e for e in canvas_edges if e.get("fromNodeId") == active_node_id]
            for edge in outgoing_edges:
                next_node_id = edge.get("toNodeId")
                await self._run_node(execution, next_node_id, canvas_nodes, canvas_edges)
        else:
            # Fail path/terminate
            execution.status = "failed"
            log_data["node_status"] = log_data.get("node_status", {})
            log_data["node_status"][active_node_id] = "failed"
            execution.execution_log = log_data
            flag_modified(execution, "execution_log")
            self.db.add(execution)
            self.db.commit()
            self.log_event(execution, "Playbook terminated because analyst denied request.", "error")

    async def _run_node(self, execution: PlaybookExecution, node_id: str, nodes: list, edges: list):
        # Retrieve logs and active node statuses
        log_data = execution.execution_log or {}
        if "node_status" not in log_data:
            log_data["node_status"] = {}
        
        # Stop executing if workflow was aborted/failed
        if execution.status == "failed":
            return

        node = next((n for n in nodes if n.get("id") == node_id), None)
        if not node:
            return

        # Update active node ID
        log_data["active_node_id"] = node_id
        log_data["node_status"][node_id] = "running"
        execution.execution_log = log_data
        flag_modified(execution, "execution_log")
        self.db.add(execution)
        self.db.commit()

        self.log_event(execution, f"Processing step: '{node.get('label')}' ({node.get('type')})")
        await asyncio.sleep(1.2)  # brief delay for tracing visibility

        context = log_data.get("context", {})
        node_type = node.get("type")
        category = node.get("category")
        properties = node.get("properties", {})

        try:
            # 1. Logic Nodes
            if node_type == "logic":
                if "Condition" in node.get("label"):
                    condition_expr = properties.get("condition", "")
                    result = self.evaluate_condition(condition_expr, context)
                    
                    self.log_event(execution, f"Evaluated condition '{condition_expr}' -> Result: {result}")
                    log_data["node_status"][node_id] = "completed"
                    
                    # Search outgoing branches
                    branch_label = "True" if result else "False"
                    outgoing = [e for e in edges if e.get("fromNodeId") == node_id and e.get("label") == branch_label]
                    
                    # Fallback if labels not matching exactly
                    if not outgoing:
                        outgoing = [e for e in edges if e.get("fromNodeId") == node_id]

                    for edge in outgoing:
                        await self._run_node(execution, edge.get("toNodeId"), nodes, edges)
                    return

                elif "Approval" in node.get("label"):
                    # Human approval suspends execution
                    execution.status = "waiting_approval"
                    log_data["suspended_node_id"] = node_id
                    log_data["node_status"][node_id] = "waiting_approval"
                    execution.execution_log = log_data
                    flag_modified(execution, "execution_log")
                    self.db.add(execution)
                    self.db.commit()
                    self.log_event(execution, "Action suspended. Waiting for SOC analyst approval...", "warning")
                    
                    # Notify analysts matching the required role group
                    target_role = properties.get("role", "L2 Manager")
                    role_map = {
                        "L2 Manager": "L2",
                        "L3 Architect": "L3",
                        "SOC Admin": "Admin"
                    }
                    db_role = role_map.get(target_role, "L2")
                    analysts = self.db.query(User).filter(User.role == db_role).all()
                    
                    playbook = self.db.query(Playbook).filter(Playbook.id == execution.playbook_id).first()
                    p_name = playbook.name if playbook else "Security Playbook"
                    
                    for analyst in analysts:
                        subject = f"ACTION REQUIRED: Pending Approval Gate in Playbook '{p_name}'"
                        body = (
                            f"Dear {analyst.username},\n\n"
                            f"The playbook '{p_name}' execution #{execution.id} has reached a pending Approval Gate.\n"
                            f"Action Required: Approve or Reject the step '{node.get('label')}' on the case.\n\n"
                            f"Thank you,\nOctopus SOC Platform"
                        )
                        send_playbook_email(analyst.email, subject, body)
                        self.log_event(execution, f"Sent pending action approval notification email to {analyst.email}", "info")
                    return

            # 2. Integration Nodes (VirusTotal, AD, EDR)
            elif node_type == "integration":
                connector_type = category
                integration = self.db.query(Integration).filter(Integration.connector_type == connector_type).first()
                
                if not integration:
                    raise ValueError(f"No active integration found for connector type '{connector_type}'")

                self.log_event(execution, f"Executing live API request to {integration.name}...")
                
                # Make live HTTP API request
                result = await run_connector_action(
                    connector_type=connector_type,
                    config=integration.config,
                    action_id=properties.get("action", ""),
                    properties=properties,
                    context=context
                )
                
                # Save result in context
                context[node.get("label")] = result
                
                if connector_type == "virustotal":
                    stats = result.get("data", {}).get("attributes", {}).get("last_analysis_stats", {})
                    malicious = stats.get("malicious", 0)
                    context["vt_reputation"] = malicious
                    self.log_event(execution, f"VT Lookup Result: Malicious score is {malicious}", "success")
                else:
                    self.log_event(execution, f"API Response successfully parsed and mapped downstream.", "success")

            # 3. Notification and AI Investigation Actions
            elif node_type == "action":
                if "AI Investigation" in node.get("label"):
                    self.log_event(execution, "Starting AI Automated Investigation...", "info")
                    
                    # Fetch raw alert details
                    alert_id = context.get("alert", {}).get("id")
                    alert_obj = self.db.query(Alert).filter(Alert.id == alert_id).first() if alert_id else None
                    
                    if alert_obj:
                        raw_alert = str(alert_obj.raw_data)
                        desc = alert_obj.raw_data.get("rule", {}).get("description") or "Unknown Alert"
                        severity = alert_obj.severity or 0
                        src_ip = alert_obj.src_ip or "unknown"
                        agent_name = context.get("alert", {}).get("hostname") or "unknown"
                        
                        prompt = ai_investigation_playbook_prompt(desc, severity, src_ip, agent_name, raw_alert)
                        try:
                            report = await OllamaClient().chat(prompt)
                            report_text = report.strip()
                        except Exception as e:
                            report_text = f"AI investigation failed to execute: {str(e)}"
                    else:
                        report_text = "No alert data found in execution context for AI investigation."
                        
                    context["ai_investigation"] = report_text
                    
                    # Update Case record with report
                    case = self.db.query(Case).filter(Case.playbook_execution_id == execution.id).first()
                    if case:
                        case.ai_investigation = report_text
                        self.db.add(case)
                        self.db.commit()
                        self.log_event(execution, "AI Investigation report successfully generated and saved to Case details.", "success")
                    else:
                        self.log_event(execution, "AI Investigation report generated, but no active Case was found.", "warning")
                
                elif "Email" in node.get("label") or properties.get("recipient"):
                    rec_val = properties.get("recipient", "")
                    recipient_email = ""
                    
                    if rec_val.isdigit():
                        user = self.db.query(User).filter(User.id == int(rec_val)).first()
                        if user:
                            recipient_email = user.email
                    else:
                        recipient_email = resolve_variables(rec_val, context)
                        
                    if not recipient_email:
                        recipient_email = "admin@octopus.local"
                        
                    # Fetch raw alert details for email template
                    alert_id = context.get("alert", {}).get("id")
                    alert_obj = self.db.query(Alert).filter(Alert.id == alert_id).first() if alert_id else None
                    
                    rule_id = "unknown"
                    desc = "Security Alert"
                    timestamp_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
                    agent_name = context.get("alert", {}).get("hostname") or "unknown-host"
                    
                    if alert_obj:
                        rule_id = alert_obj.rule_id or "unknown"
                        raw_data = alert_obj.raw_data if isinstance(alert_obj.raw_data, dict) else {}
                        desc = raw_data.get("rule", {}).get("description") or "Unknown Alert"
                        if alert_obj.timestamp:
                            timestamp_str = alert_obj.timestamp.strftime("%Y-%m-%d %H:%M:%S UTC")
                    
                    # Generate AI Subject based on alert description
                    subj = f"Alert Triggered on {agent_name} (Rule {rule_id})"
                    try:
                        self.log_event(execution, "Generating AI email subject line...", "info")
                        subject_prompt = (
                            "You are an AI Security assistant. Generate a brief, single-sentence email subject line for a security alert. "
                            f"Alert Rule ID: {rule_id}. Description: {desc}. Host: {agent_name}. "
                            "Output ONLY the subject line text, and do NOT include quotes, prefixes, or any extra text."
                        )
                        ai_subj = await OllamaClient().chat(subject_prompt)
                        ai_subj = ai_subj.strip().strip('"').strip("'")
                        if ai_subj:
                            subj = ai_subj
                    except Exception as e:
                        self.log_event(execution, f"Could not generate AI subject, using fallback. Error: {e}", "warning")
                    
                    # Build premium HTML email body
                    include_ai = properties.get("include_ai_investigation", False)
                    ai_report_html = ""
                    if include_ai:
                        # Wait for up to 60 seconds for the AI Investigation node (if present on canvas) to populate context
                        has_ai_node = any("AI Investigation" in n.get("label", "") for n in nodes)
                        if has_ai_node and not context.get("ai_investigation"):
                            self.log_event(execution, "Waiting for AI Investigation block to complete processing...", "info")
                            wait_limit = 60
                            while not context.get("ai_investigation") and wait_limit > 0:
                                await asyncio.sleep(1)
                                wait_limit -= 1
                        
                        ai_report = context.get("ai_investigation")
                        if ai_report:
                            formatted_report = ai_report.replace("\n", "<br>")
                            ai_report_html = f"""
                            <div class="section-title">AI Automated Investigation Report</div>
                            <div class="ai-report">
                                {formatted_report}
                            </div>
                            """
                        else:
                            ai_report_html = """
                            <div class="section-title">AI Automated Investigation Report</div>
                            <div class="ai-report" style="color: #64748b; font-style: italic;">
                                AI Investigation was requested but no report content was found in execution context.
                            </div>
                            """
                    
                    body = f"""<html>
<head>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 24px; }}
    .card {{ background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }}
    .header {{ border-bottom: 2px solid #f1f5f9; padding-bottom: 16px; margin-bottom: 20px; }}
    .header h2 {{ margin: 0; color: #ef4444; font-size: 20px; }}
    .meta-table {{ width: 100%; border-collapse: collapse; margin-bottom: 20px; }}
    .meta-table td {{ padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }}
    .meta-label {{ font-weight: bold; color: #64748b; width: 130px; }}
    .meta-value {{ color: #0f172a; }}
    .section-title {{ font-size: 14px; font-weight: 700; text-transform: uppercase; color: #475569; letter-spacing: 0.05em; margin: 24px 0 12px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }}
    .ai-report {{ background-color: #faf5ff; border: 1px solid #f3e8ff; border-radius: 8px; padding: 16px; font-size: 13px; color: #581c87; line-height: 1.6; }}
    .footer {{ text-align: center; margin-top: 24px; font-size: 11px; color: #94a3b8; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2>Octopus SOAR Alert Notification</h2>
    </div>
    
    <table class="meta-table">
      <tr>
        <td class="meta-label">Alert Triggered</td>
        <td class="meta-value">Rule {rule_id} - {desc}</td>
      </tr>
      <tr>
        <td class="meta-label">Timestamp</td>
        <td class="meta-value">{timestamp_str}</td>
      </tr>
      <tr>
        <td class="meta-label">Host/Endpoint</td>
        <td class="meta-value">{agent_name}</td>
      </tr>
    </table>
    
    {ai_report_html}
    
    <div class="footer">
      This is an automated response generated by Octopus Security Orchestration, Automation, and Response (SOAR).
    </div>
  </div>
</body>
</html>"""
                    
                    send_playbook_email(recipient_email, subj, body)
                    self.log_event(execution, f"Sent email notification to {recipient_email} (Subject: {subj})", "success")
                    
                else:
                    recipient = properties.get("channel") or properties.get("recipient") or "admin"
                    msg_body = resolve_variables(properties.get("message") or properties.get("subject") or "Alert", context)
                    self.log_event(execution, f"Triggered notification channel '{recipient}': {msg_body}", "success")

            # Mark node completed
            log_data["node_status"][node_id] = "completed"
            execution.execution_log = log_data
            flag_modified(execution, "execution_log")
            self.db.add(execution)
            self.db.commit()

            # Continue downstream execution along all outgoing edges
            outgoing_edges = [e for e in edges if e.get("fromNodeId") == node_id]
            
            if not outgoing_edges:
                execution.status = "completed"
                execution.execution_log["active_node_id"] = None
                flag_modified(execution, "execution_log")
                self.db.add(execution)
                self.db.commit()
                self.log_event(execution, "Playbook reached convergence end. Finished execution successfully.", "success")
                return

            for edge in outgoing_edges:
                await self._run_node(execution, edge.get("toNodeId"), nodes, edges)

        except Exception as err:
            execution.status = "failed"
            log_data["node_status"][node_id] = "failed"
            execution.execution_log = log_data
            flag_modified(execution, "execution_log")
            self.db.add(execution)
            self.db.commit()
            self.log_event(execution, f"Step execution failed: {err}", "error")
