from __future__ import annotations

import asyncio
from datetime import datetime
import re

from sqlalchemy.orm import Session

from app.models.playbook import Playbook
from app.models.playbook_execution import PlaybookExecution
from app.models.integration import Integration
from app.models.alert import Alert
from app.services.connector_runner import resolve_variables, run_connector_action


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
        self.db.add(execution)
        self.db.commit()

    async def execute(self, execution_id: int, alert_id: int | None = None, mock_payload: dict | None = None):
        execution = self.db.query(PlaybookExecution).filter(PlaybookExecution.id == execution_id).first()
        if not execution:
            return

        playbook = self.db.query(Playbook).filter(Playbook.id == execution.playbook_id).first()
        if not playbook:
            execution.status = "failed"
            self.log_event(execution, "Error: Playbook not found.", "error")
            return

        # Initialize context
        context = {
            "alert": {},
            "trigger": {},
            "vars": {},
            "vt_reputation": 0  # Default fallback values for demo/mock integrity
        }

        alert = None
        if alert_id:
            alert = self.db.query(Alert).filter(Alert.id == alert_id).first()
        else:
            alert = self.db.query(Alert).order_by(Alert.id.desc()).first()

        if not alert:
            execution.status = "failed"
            self.db.add(execution)
            self.db.commit()
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
        self.db.add(execution)
        self.db.commit()

        self.log_event(execution, f"Initialized playbook: '{playbook.name}'", "info")

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

    async def resume(self, execution_id: int, approved: bool):
        execution = self.db.query(PlaybookExecution).filter(PlaybookExecution.id == execution_id).first()
        if not execution or execution.status != "waiting_approval":
            return

        playbook = self.db.query(Playbook).filter(Playbook.id == execution.playbook_id).first()
        if not playbook:
            return

        log_data = execution.execution_log or {}
        active_node_id = log_data.get("suspended_node_id")
        context = log_data.get("context", {})

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
        self.db.add(execution)
        self.db.commit()

        self.log_event(execution, f"Processing step: '{node.get('label')}' ({node.get('type')})")
        await asyncio.sleep(1.2)  # brief delay for tracing visibility

        context = log_data.get("context", {})
        node_type = node.get("type")
        category = node.get("category")
        properties = node.get("properties", {})

        try:
            # 1. Logic Condition Nodes
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
                    self.db.add(execution)
                    self.db.commit()
                    self.log_event(execution, "Action suspended. Waiting for SOC analyst approval...", "warning")
                    return

            # 2. Integration Nodes (VirusTotal, AD, EDR)
            elif node_type == "integration":
                # Find connector configuration
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
                # Support VT scores mapping fallback
                if connector_type == "virustotal":
                    # Parse real VirusTotal attributes if matching structure
                    stats = result.get("data", {}).get("attributes", {}).get("last_analysis_stats", {})
                    malicious = stats.get("malicious", 0)
                    context["vt_reputation"] = malicious
                    self.log_event(execution, f"VT Lookup Result: Malicious score is {malicious}", "success")
                else:
                    self.log_event(execution, f"API Response successfully parsed and mapped downstream.", "success")

            # 3. Notification Actions
            elif node_type == "action":
                recipient = properties.get("channel") or properties.get("recipient") or "admin"
                msg_body = resolve_variables(properties.get("message") or properties.get("subject") or "Alert", context)
                self.log_event(execution, f"Triggered notification channel '{recipient}': {msg_body}", "success")

            # Mark node completed
            log_data["node_status"][node_id] = "completed"
            execution.execution_log = log_data
            self.db.add(execution)
            self.db.commit()

            # Continue downstream execution along all outgoing edges
            outgoing_edges = [e for e in edges if e.get("fromNodeId") == node_id]
            
            if not outgoing_edges:
                # Execution convergence point reached
                execution.status = "completed"
                execution.execution_log["active_node_id"] = None
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
            self.db.add(execution)
            self.db.commit()
            self.log_event(execution, f"Step execution failed: {err}", "error")
