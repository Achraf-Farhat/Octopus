def translate_to_dql_prompt(user_query: str, now: str) -> str:
    return (
        "You are a Wazuh query expert. Translate this to DQL:\n"
        f'User: "{user_query}"\n'
        f"Current time: {now}\n"
        "Return ONLY the DQL query."
    )


def explain_alert_prompt(rule_description: str, severity: str, src_ip: str, mitre_technique: str, alert_data: str) -> str:
    return (
        "Explain this security alert in plain English:\n"
        f"Rule: {rule_description}\n"
        f"Severity: {severity}\n"
        f"Source IP: {src_ip}\n"
        f"MITRE: {mitre_technique}\n"
        f"Data: {alert_data}\n\n"
        "Provide: what happened, why it matters, 3-5 recommended actions."
    )


def generate_rule_prompt(user_request: str) -> str:
    return (
        f'Generate a Wazuh XML rule for: "{user_request}"\n'
        "Use rule IDs 100000-120000 for custom rules.\n"
        "Return ONLY valid XML, no markdown."
    )
