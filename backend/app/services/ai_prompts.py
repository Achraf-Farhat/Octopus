def translate_to_query_prompt(user_query: str, now: str, mode: str = "auto") -> str:
    target_language = "auto (pick dql unless user explicitly asks for wql)" if mode == "auto" else mode
    return (
        "You are a Wazuh detection query expert. Convert the user request into a valid Wazuh/OpenSearch query_string filter.\n"
        f"Target mode: {target_language}\n"
        f"Current UTC time: {now}\n"
        f'User query: "{user_query}"\n\n'
        "Output STRICT JSON only with this exact schema:\n"
        '{"language":"dql|wql","query":"...","confidence":0.0,"time_range":"...","notes":"..."}\n\n'
        "Rules:\n"
        "- query must be a single-line Lucene/OpenSearch query_string expression (no markdown).\n"
        "- NEVER output SQL, KQL, JSON DSL, pseudocode, explanations, or code fences.\n"
        "- Use query_string syntax such as: rule.level:[10 TO *] AND rule.id:5716 AND @timestamp:[now-24h TO now].\n"
        "- For generic requests like 'last N alerts', use a conservative filter like @timestamp:[now-24h TO now]; result count is handled by API pagination.\n"
        "- confidence is a float between 0 and 1.\n"
        "- if user gives a time hint (today, last hour, etc.), include it in query and time_range.\n"
        "- prefer fielded filters (rule.id, rule.level, agent.name, agent.ip, data.srcip, location).\n"
        "- if uncertain, keep query conservative and explain briefly in notes.\n"
    )


def explain_alert_prompt(rule_description: str, severity: str, src_ip: str, mitre_technique: str, alert_data: str) -> str:
    return (
        "You are a SOC alert triage assistant. Analyze this alert for an analyst.\n"
        f"Rule: {rule_description}\n"
        f"Severity: {severity}\n"
        f"Source IP: {src_ip}\n"
        f"MITRE: {mitre_technique}\n"
        f"Data: {alert_data}\n\n"
        "Output STRICT JSON only with this exact schema:\n"
        '{"summary":"...","why_it_matters":"...","recommended_actions":["..."],"confidence":0.0,"severity_assessment":"low|medium|high|critical","notes":"..."}\n\n'
        "Rules:\n"
        "- summary: 1-3 short sentences, no markdown.\n"
        "- why_it_matters: focus on risk and potential impact.\n"
        "- recommended_actions: 3 to 5 concrete analyst steps.\n"
        "- confidence: float from 0 to 1.\n"
        "- severity_assessment must be one of: low, medium, high, critical.\n"
        "- if data is incomplete, keep response conservative and explain in notes."
    )


def generate_rule_prompt(user_request: str) -> str:
    return (
        f'Generate a Wazuh XML rule for: "{user_request}"\n'
        "Use rule IDs 100000-120000 for custom rules.\n"
        "Return ONLY valid XML, no markdown."
    )
