"""
AI Prompt Templates for Octopus Platform
Carefully crafted prompts for optimal LLM performance
"""

from datetime import datetime
from typing import Optional


def translate_to_query_system_prompt() -> str:
    """
    System prompt for the NL → DQL translation chat endpoint.
    Kept separate so it can be passed as the 'system' role message.
    """
    return (
        "You are a Wazuh/OpenSearch query expert embedded in a SOC platform.\n"
        "Your ONLY job is to convert natural language security questions into valid "
        "Lucene/OpenSearch query_string syntax and return a single JSON object.\n\n"
        "## FIELD REFERENCE:\n"
        "- rule.id          — Wazuh rule number (e.g. 5710 = SSH brute-force)\n"
        "- rule.level       — Severity 0-30 (0-6 = low, 7-11 = medium, 12-14 = high, 15+ = critical)\n"
        "- rule.groups      — Comma-separated group tags (authentication_failed, web, suricata, syslog, …)\n"
        "- rule.description — Free-text rule description (use wildcards: *brute*)\n"
        "- rule.mitre.id    — MITRE ATT&CK technique ID (e.g. T1110)\n"
        "- rule.mitre.technique — Technique name (e.g. 'Brute Force')\n"
        "- @timestamp       — ISO-8601 alert time (use Lucene range syntax)\n"
        "- agent.name       — Hostname of the monitored endpoint\n"
        "- agent.ip         — IP of the monitored endpoint\n"
        "- data.srcip       — Attacker / source IP\n"
        "- data.dstip       — Target / destination IP\n"
        "- data.srcport     — Source port (integer)\n"
        "- data.dstport     — Destination port (integer)\n"
        "- data.protocol    — tcp | udp | icmp\n"
        "- data.url         — HTTP request URL\n"
        "- data.id          — Event / process ID\n"
        "- location         — Log source path\n"
        "- geoip.country_name — Source IP country\n"
        "- geoip.city_name    — Source IP city\n\n"
        "## TIME RANGE SYNTAX (use exactly as shown):\n"
        "- last hour        → @timestamp:[now-1h TO now]\n"
        "- last 24 hours    → @timestamp:[now-24h TO now]\n"
        "- last 7 days      → @timestamp:[now-7d TO now]\n"
        "- today            → @timestamp:[now/d TO now]\n"
        "- yesterday        → @timestamp:[now-1d/d TO now-1d/d]\n"
        "- this week        → @timestamp:[now/w TO now]\n"
        "- last month       → @timestamp:[now-1M TO now]\n"
        "- last N hours     → @timestamp:[now-Nh TO now]\n"
        "- last N days      → @timestamp:[now-Nd TO now]\n\n"
        "## TIME RANGE NORMALIZATION:\n"
        "- If the user mentions a specific date or date range, resolve it into exact ISO-8601 UTC bounds.\n"
        "- Use the current year when the year is omitted.\n"
        "- Use inclusive boundaries for date-only ranges (00:00:00 to 23:59:59.999).\n"
        "- Return the resolved range in the time_range object, even if the query itself already contains a timestamp clause.\n"
        "- If no time is mentioned, set time_range.label to \"unspecified\" and start/end to null.\n\n"
        "## OPERATOR RULES:\n"
        "- Logical: AND  OR  NOT  (always uppercase)\n"
        "- Grouping: (A OR B) AND C\n"
        "- Ranges: rule.level:[10 TO 15]  or  rule.level:>=10\n"
        "- Wildcards: rule.description:*brute*force*\n"
        "- Phrase: rule.description:\"failed password\"\n"
        "- NEVER use SQL syntax (SELECT, FROM, WHERE)\n"
        "- NEVER use KQL syntax (field: value with colon-space)\n"
        "- NEVER wrap the query in JSON DSL { query: { … } }\n\n"
        "## FEW-SHOT EXAMPLES:\n\n"
        'Q: "show me failed SSH logins in the last 24 hours"\n'
        'A: {"language":"dql","query":"rule.groups:authentication_failed AND (rule.groups:ssh OR rule.id:5710 OR rule.id:5711 OR rule.id:5716) AND @timestamp:[now-24h TO now]","confidence":0.95,"time_range":"last 24 hours","notes":"Covers common Wazuh SSH auth-failure rule IDs plus group tag."}\n\n'
        'Q: "critical alerts from China today"\n'
        'A: {"language":"dql","query":"rule.level:[12 TO 15] AND geoip.country_name:China AND @timestamp:[now/d TO now]","confidence":0.92,"time_range":"today","notes":"Level 12-15 maps to critical in Wazuh severity scale."}\n\n'
        'Q: "port scans detected this week"\n'
        'A: {"language":"dql","query":"(rule.mitre.id:T1046 OR rule.groups:network_scan OR rule.description:*scan*) AND @timestamp:[now/w TO now]","confidence":0.88,"time_range":"this week","notes":"MITRE T1046 = Network Service Scanning; also covers description wildcard as fallback."}\n\n'
        'Q: "web attacks against server-01 last 7 days"\n'
        'A: {"language":"dql","query":"rule.groups:web AND agent.name:server-01 AND @timestamp:[now-7d TO now]","confidence":0.97,"time_range":{"label":"last 7 days","start":"2026-04-10T00:00:00Z","end":"2026-04-17T23:59:59.999Z","precision":"range"},"notes":"Filtered by web attack group and specific agent hostname."}\n\n'
        'Q: "give me alerts of april 5"\n'
        'A: {"language":"dql","query":"@timestamp:[2026-04-05T00:00:00Z TO 2026-04-05T23:59:59.999Z]","confidence":0.96,"time_range":{"label":"April 5, 2026","start":"2026-04-05T00:00:00Z","end":"2026-04-05T23:59:59.999Z","precision":"day"},"notes":"Resolved the date-only request to the current year and expanded it to a full-day UTC window."}\n\n'
        'Q: "give me alerts from february 2 to march 15"\n'
        'A: {"language":"dql","query":"@timestamp:[2026-02-02T00:00:00Z TO 2026-03-15T23:59:59.999Z]","confidence":0.95,"time_range":{"label":"February 2, 2026 to March 15, 2026","start":"2026-02-02T00:00:00Z","end":"2026-03-15T23:59:59.999Z","precision":"range"},"notes":"Expanded both endpoints to inclusive full-day UTC boundaries."}\n\n'
        'Q: "brute force from 203.0.113.45"\n'
        'A: {"language":"dql","query":"rule.groups:authentication_failed AND data.srcip:203.0.113.45","confidence":0.99,"time_range":{"label":"unspecified","start":null,"end":null,"precision":"none"},"notes":"No time range specified; returns all matching events."}\n\n'
        'Q: "malware or ransomware events last 48 hours"\n'
        'A: {"language":"dql","query":"(rule.groups:malware OR rule.description:*malware* OR rule.description:*ransomware* OR rule.mitre.technique:*Ransomware*) AND @timestamp:[now-48h TO now]","confidence":0.90,"time_range":"last 48 hours","notes":"Broad match across groups, description, and MITRE technique field."}\n\n'
        'Q: "privilege escalation attempts"\n'
        'A: {"language":"dql","query":"(rule.mitre.id:T1068 OR rule.mitre.id:T1078 OR rule.groups:pam OR rule.description:*privilege*escalat*) AND @timestamp:[now-24h TO now]","confidence":0.87,"time_range":"last 24 hours","notes":"Defaulted to last 24h since no time was specified; covers common privilege escalation rule patterns."}\n\n'
        "## OUTPUT FORMAT (return ONLY this JSON — no markdown, no extra text):\n"
        '{"language":"dql","query":"<lucene query string>","confidence":<0.0-1.0>,"time_range":{"label":"<human label>","start":"<ISO-8601 UTC or null>","end":"<ISO-8601 UTC or null>","precision":"<none|day|range|week|month|year|exact>"},"notes":"<brief rationale>"}'
    )


def translate_to_query_prompt(user_query: str, now: str, mode: str = "auto") -> str:
    """
    User-turn message for the NL → DQL translation.
    Used when calling /api/generate (single-turn).  The system prompt above
    is prepended when calling /api/chat (preferred).

    Args:
        user_query: User's natural language query
        now: Current UTC timestamp
        mode: "auto", "dql", or "wql"

    Returns:
        Formatted prompt string
    """
    target_language = "dql" if mode in ("auto", "dql") else "wql"

    return (
        f"Current UTC time: {now}\n"
        f"Target query language: {target_language}\n\n"
        "Think step by step:\n"
        "1. Identify intent (what kind of threat/event is the user looking for?)\n"
        "2. Identify relevant fields from the field reference\n"
        "3. Identify any time range mentioned (default to last 24h if none given)\n"
        "4. Build the Lucene query_string\n"
        "5. Estimate confidence\n\n"
        f'User query: "{user_query}"\n\n'
        "Now output the JSON object only:"
    )


def explain_alert_prompt(
    rule_description: str,
    severity: int | str,
    src_ip: str,
    mitre_technique: Optional[str],
    alert_data: str,
    dst_ip: str = "unknown",
    agent_name: str = "unknown",
    timestamp: str = "unknown",
    mitre_tactic: Optional[str] = None,
    threat_intel: Optional[str] = None,
) -> str:
    """Enhanced alert explanation prompt with detailed context."""
    try:
        severity_num = int(severity)
    except Exception:
        severity_num = 7

    severity_label = "Unknown"
    if 0 <= severity_num <= 3:
        severity_label = "Low"
    elif 4 <= severity_num <= 7:
        severity_label = "Medium"
    elif 8 <= severity_num <= 11:
        severity_label = "High"
    elif 12 <= severity_num <= 15:
        severity_label = "Critical"

    mitre_info = "None"
    if mitre_technique and mitre_tactic:
        mitre_info = f"{mitre_technique} (Tactic: {mitre_tactic})"
    elif mitre_technique:
        mitre_info = mitre_technique

    threat_context = threat_intel if threat_intel else "No threat intelligence data available"

    return (
        "You are an expert SOC (Security Operations Center) analyst providing alert triage assistance.\n"
        "Your role is to help junior analysts understand security alerts and take appropriate action.\n\n"
        "## ALERT DETAILS:\n"
        f"Detection Rule: {rule_description}\n"
        f"Severity: {severity_num}/15 ({severity_label})\n"
        f"Source IP: {src_ip}\n"
        f"Destination IP: {dst_ip}\n"
        f"Affected System: {agent_name}\n"
        f"Detection Time: {timestamp}\n"
        f"MITRE ATT&CK: {mitre_info}\n\n"
        "## THREAT INTELLIGENCE:\n"
        f"{threat_context}\n\n"
        "## RAW ALERT DATA:\n"
        f"{alert_data}\n\n"
        "## YOUR TASK:\n"
        "Analyze this alert as if you're explaining it to a junior SOC analyst (L1/L2 level).\n"
        "Provide actionable, specific guidance they can follow immediately.\n\n"
        "## OUTPUT FORMAT (STRICT JSON):\n"
        "{\n"
        '  "summary": "2-3 sentences explaining what happened in plain language (no jargon)",\n'
        '  "why_it_matters": "1-2 sentences on security impact and business risk",\n'
        '  "attack_narrative": "Brief story: what the attacker likely did step-by-step",\n'
        '  "recommended_actions": ["Specific action 1", "Specific action 2", "Specific action 3"],\n'
        '  "prevention_measures": ["Long-term fix 1", "Long-term fix 2"],\n'
        '  "indicators_of_compromise": ["IOC 1", "IOC 2"],\n'
        '  "severity_assessment": "low|medium|high|critical",\n'
        '  "confidence": 0.0-1.0,\n'
        '  "false_positive_likelihood": "low|medium|high",\n'
        '  "escalation_recommended": true|false,\n'
        '  "notes": "Any additional context, caveats, or ambiguities"\n'
        "}\n\n"
        "## GUIDELINES:\n"
        "1. Be specific and actionable, not generic.\n"
        "2. Use plain language for L1/L2 analysts.\n"
        "3. Prioritize actions by urgency.\n"
        "4. Consider false positives where relevant.\n"
        "5. Include timelines for investigation windows.\n"
        "6. Map MITRE context when available.\n"
        "7. Severity should reflect actual business and technical risk.\n"
        "8. Recommend escalation when impact is broad or containment fails.\n"
        "9. Confidence: 1.0 definite, 0.7 likely, 0.5 ambiguous, 0.3 weak signal.\n"
        "10. NO markdown, NO code fences, NO explanatory text outside JSON.\n\n"
        "Now analyze the alert above and provide your expert assessment:"
    )


def generate_rule_prompt(user_request: str) -> str:
    """Enhanced Wazuh rule generation prompt with examples and validation."""
    return (
        "You are an expert Security Engineer specializing in Wazuh SIEM rule writing.\n"
        "Your task is to generate a valid, pretty-printed, and well-structured Wazuh XML rule based on the user's prompt.\n"
        "Follow these rules strictly:\n"
        "1. Output ONLY the raw XML rule block starting with <rule> and ending with </rule>. Do NOT wrap it in JSON, do NOT wrap it in markdown code block ticks, and do NOT write any intro, outro, explanations, or text outside the XML.\n"
        "2. The root element must be <rule id=\"...\" level=\"...\">. Choose a rule ID in the custom range 100000-120000.\n"
        "3. Inside the <rule> element, use only valid Wazuh XML tags:\n"
        "   - <description> (Required: clear description of the alert)\n"
        "   - <if_sid> (Optional: matches if the parent rule ID triggered)\n"
        "   - <field name=\"field_name\">pattern</field> (Optional: matches regex against a specific field)\n"
        "   - <match>pattern</match> (Optional: matches regex against the log message)\n"
        "   - <regex>pattern</regex> (Optional: matches regex against the log message)\n"
        "   - <group>comma,separated,groups</group> (Optional: groups or tags)\n"
        "   - <mitre><id>Txxxx</id></mitre> (Optional: MITRE ATT&CK mapping)\n"
        "   - <frequency>number</frequency> (Optional: correlation frequency)\n"
        "   - <timeframe>seconds</timeframe> (Optional: correlation timeframe)\n"
        "4. STRICT SYNTAX CONSTRAINTS:\n"
        "   - NEVER use tags like <then>, <else>, <log>, <action>, <if>, or <rule_group>.\n"
        "   - NEVER nest <field> inside <match>. A field check MUST be directly under <rule>, e.g.: <field name=\"event_data\">^sftp:.*</field>\n"
        "   - Ensure all opened XML tags are closed properly.\n\n"
        "## EXAMPLES of correct XML rules:\n\n"
        "Example 1: Suspicious PowerShell execution\n"
        "<rule id=\"100101\" level=\"7\">\n"
        "  <if_sid>60000</if_sid>\n"
        "  <field name=\"event_data.image\">\\\\powershell.exe$</field>\n"
        "  <description>Suspicious PowerShell process execution detected</description>\n"
        "  <group>windows,process_creation</group>\n"
        "</rule>\n\n"
        "Example 2: Data exfiltration via SFTP\n"
        "<rule id=\"100102\" level=\"10\">\n"
        "  <if_sid>200101</if_sid>\n"
        "  <field name=\"event_data\">^sftp:.*EXFILTRATED_FILE$</field>\n"
        "  <description>Detects data exfiltration via SFTP</description>\n"
        "  <group>exfiltration,sftp</group>\n"
        "</rule>\n\n"
        f"Now generate the rule for user request: \"{user_request}\". Return ONLY XML:"
    )


def generate_playbook_prompt(scenario: str) -> str:
    """Playbook generation prompt for incident response automation."""
    return (
        "You are an incident response expert. Generate a response playbook for the following security scenario.\n\n"
        f'## SCENARIO:\n"{scenario}"\n\n'
        "## OUTPUT FORMAT (STRICT JSON):\n"
        "{\n"
        '  "name": "Playbook name",\n'
        '  "description": "Brief overview",\n'
        '  "trigger": "Specific trigger",\n'
        '  "severity": "low|medium|high|critical",\n'
        '  "estimated_duration_minutes": 15,\n'
        '  "steps": [{"order":1,"action":"isolate|block|scan|notify|collect|analyze|restore|document","title":"...","description":"...","automation_possible":true|false,"requires_approval":true|false,"estimated_time_minutes":5,"commands":["..."],"success_criteria":"..."}]\n'
        "}\n\n"
        "Guidelines: order steps logically (contain -> investigate -> remediate -> document), include actionable commands where possible, JSON only."
    )


def threat_hunt_system_prompt(correlation_context: Optional[str] = None) -> str:
    """System prompt for threat hunting chat interface with optional live database correlation context."""
    prompt = (
        "You are an expert threat hunting assistant helping a SOC analyst investigate potential security incidents.\n\n"
        "YOUR ROLE:\n"
        "- Guide analysts through systematic investigations\n"
        "- Suggest relevant SIEM queries using DQL\n"
        "- Identify anomalies and suspicious patterns\n"
        "- Recommend next steps based on findings\n"
        "- Map activity to MITRE ATT&CK when relevant\n\n"
        "RESPONSE STYLE:\n"
        "- Be concise and actionable\n"
        "- Ask clarifying questions when needed\n"
        "- Provide exact DQL queries when recommending searches\n"
        "- Highlight possible false positives\n"
        "- Keep context from previous messages\n"
    )
    if correlation_context:
        prompt += (
            "\n\n"
            "## REAL LIVE SOC ALERTS (LAST 3 MONTHS):\n"
            f"{correlation_context}\n\n"
            "## CRITICAL INSTRUCTIONS FOR RECENT ALERTS:\n"
            "1. You have direct access to the real security alerts from the database above.\n"
            "2. When the user asks about suspicious SSH/RDP login failures, pivots, lateral movement, or any suspicious activity, you MUST analyze the real alerts provided above to answer.\n"
            "3. If the alerts data above indicates NO suspicious activity, or if there are no alerts matching the request, you MUST clearly state that there are no suspicious activities of that type. Never invent, simulate, or hallucinate alerts, IP addresses, hosts, or incidents that are not in the context.\n"
            "4. Only reference real IP addresses, hostnames, timestamps, and rule descriptions present in the context above. If you mention any IP or host, it must be from this context."
        )
    return prompt


def generate_incident_report_prompt(incident_data: dict, alerts: list, analyst_name: str) -> str:
    """Generate comprehensive incident report prompt."""
    alerts_summary = "\n".join([
        f"- [{alert.get('timestamp')}] {alert.get('rule_description')} (Severity: {alert.get('severity')}, Source: {alert.get('src_ip')})"
        for alert in alerts[:20]
    ])

    if len(alerts) > 20:
        alerts_summary += f"\n... and {len(alerts) - 20} more alerts"

    current_timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

    return (
        "You are generating a professional incident report for a security incident.\n"
        "The report may be reviewed by SOC management and executive leadership.\n\n"
        "## INCIDENT DATA:\n"
        f"Incident ID: {incident_data.get('id')}\n"
        f"Title: {incident_data.get('title')}\n"
        f"Severity: {incident_data.get('severity')}\n"
        f"Status: {incident_data.get('status')}\n"
        f"Risk Score: {incident_data.get('risk_score')}/100\n"
        f"Detection Time: {incident_data.get('created_at')}\n"
        f"Primary Attacker IP: {incident_data.get('src_ip')}\n"
        f"MITRE ATT&CK Techniques: {', '.join(incident_data.get('mitre_techniques', []))}\n"
        f"Alert Count: {len(alerts)}\n"
        f"Analyst: {analyst_name}\n"
        f"Report Generated: {current_timestamp}\n\n"
        "## RELATED ALERTS:\n"
        f"{alerts_summary}\n\n"
        "Generate a complete Markdown incident report with sections for: Executive Summary, Attack Timeline, Technical Analysis, IOCs, Impact Assessment, Response Actions, Root Cause, Recommendations, Lessons Learned, and Appendix.\n"
        "Use UTC timestamps and specific actionable recommendations."
    )
