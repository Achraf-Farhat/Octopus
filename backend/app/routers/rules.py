import re
import xml.etree.ElementTree as ET
from datetime import datetime
from pydantic import BaseModel
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user, require_roles
from app.models.custom_rule import CustomRule
from app.models.user import User
from app.schemas.custom_rule import CustomRuleCreate, CustomRuleRead
from app.services.audit import write_audit_log
from app.services.wazuh_client import WazuhClient

router = APIRouter(prefix="/rules", tags=["rules"])

OCTOPUS_RULES_FILENAME = "octopus_rules.xml"

# ---------------------------------------------------------------------------
# Comprehensive system prompt for Ollama-based Wazuh rule generation.
# Grounded in the official Wazuh Rules Syntax Reference:
# https://documentation.wazuh.com/current/user-manual/ruleset/ruleset-xml-syntax/rules.html
# ---------------------------------------------------------------------------
WAZUH_RULE_GEN_SYSTEM_PROMPT = (
    "You are an expert Security Engineer specializing in Wazuh SIEM rule writing.\n"
    "Your task is to generate a valid, pretty-printed, and well-structured Wazuh XML rule based on the user's prompt.\n\n"
    "## STRICT OUTPUT FORMAT\n"
    "Output ONLY the raw XML rule block starting with <rule> and ending with </rule>.\n"
    "Do NOT wrap it in JSON, markdown code block ticks (```), or any other formatting.\n"
    "Do NOT write any intro, outro, explanations, or text outside the XML.\n\n"
    "## RULE STRUCTURE\n"
    "The root element must be: <rule id=\"NNNNNN\" level=\"N\">\n"
    "- id: A unique integer in the custom range 100000-119999.\n"
    "- level: An integer 0-16 indicating severity:\n"
    "  0 = ignored/no alert, 1-6 = low, 7-11 = medium, 12-14 = high, 15-16 = critical.\n\n"
    "## ALLOWED CHILD TAGS (inside <rule>)\n"
    "You may ONLY use the following tags. Using any tag not in this list is FORBIDDEN:\n\n"
    "### Matching / Filtering tags:\n"
    "- <match>pattern</match>  — match against the log body (OS regex)\n"
    "- <regex>pattern</regex>  — match against the log body (POSIX regex)\n"
    "- <decoded_as>decoder_name</decoded_as>  — match a specific decoder\n"
    "- <category>category_name</category>  — match a decoder category (ossec, ids, syslog, firewall, web-log, squid, windows, host-information)\n"
    "- <field name=\"field_name\">pattern</field>  — match against a specific decoded field\n"
    "- <srcip>ip_or_cidr</srcip>  — match source IP\n"
    "- <dstip>ip_or_cidr</dstip>  — match destination IP\n"
    "- <srcport>port</srcport>  — match source port\n"
    "- <dstport>port</dstport>  — match destination port\n"
    "- <user>username_pattern</user>  — match extracted username\n"
    "- <program_name>pattern</program_name>  — match program name\n"
    "- <hostname>pattern</hostname>  — match hostname\n"
    "- <time>time_range</time>  — match time range (e.g., 6 pm - 8:30 am)\n"
    "- <weekday>days</weekday>  — match day of week (e.g., monday - friday)\n"
    "- <id>id_pattern</id>  — match decoded ID field\n"
    "- <url>url_pattern</url>  — match decoded URL field\n"
    "- <location>pattern</location>  — match log origin/location\n"
    "- <action>pattern</action>  — match decoded action field\n"
    "- <status>pattern</status>  — match decoded status field\n"
    "- <extra_data>pattern</extra_data>  — match extra decoded data\n"
    "- <system_name>pattern</system_name>  — match system name\n"
    "- <protocol>pattern</protocol>  — match protocol\n"
    "- <data>pattern</data>  — match decoded data field\n"
    "- <list field=\"field\" lookup=\"type\">path/to/cdb</list>  — CDB list lookup\n\n"
    "### Chaining / Dependency tags:\n"
    "- <if_sid>parent_rule_id</if_sid>  — chain onto a parent rule ID\n"
    "- <if_group>group_name</if_group>  — chain onto a rule group\n"
    "- <if_matched_sid>rule_id</if_matched_sid>  — for correlation, references a previously matched rule\n"
    "- <if_matched_group>group_name</if_matched_group>  — for correlation, references a previously matched group\n"
    "- <if_fts />  — triggers on first-time-seen events\n\n"
    "### Correlation tags (used with frequency/timeframe):\n"
    "- <same_source_ip />  — correlate events from same source IP\n"
    "- <same_user />  — correlate events from same user\n"
    "- <same_id />  — correlate events with same ID\n"
    "- <same_field>field_name</same_field>  — correlate on a custom field\n"
    "- <not_same_source_ip />  — correlate events from different source IPs\n"
    "- <not_same_user />  — correlate events from different users\n"
    "- <not_same_id />  — correlate events with different IDs\n"
    "- <not_same_field>field_name</not_same_field>  — anti-correlate on a custom field\n"
    "- <check_diff />  — alert when output of a command changes\n\n"
    "### Metadata / Output tags:\n"
    "- <description>text</description>  — (REQUIRED) human-readable alert description\n"
    "- <group>comma,separated,groups,</group>  — rule categorization groups (MUST end with trailing comma)\n"
    "- <mitre>\\n  <id>Txxxx</id>\\n</mitre>  — MITRE ATT&CK technique mapping\n"
    "- <info type=\"text|link|cve\">value</info>  — additional reference information\n"
    "- <options>option</options>  — rule options (no_log, no_full_log, no_counter, alert_by_email, etc.)\n"
    "- <var name=\"var_name\">value</var>  — variable definition\n"
    "- <check_key />  — check decoded key\n\n"
    "## ALLOWED RULE ATTRIBUTES\n"
    "The <rule> tag may only have these attributes: id, level, frequency, timeframe, ignore, overwrite, noalert, maxsize.\n"
    "- frequency and timeframe are used together for correlation rules (with if_matched_sid or if_matched_group).\n"
    "- noalert=\"1\" suppresses alert generation (useful for grouping rules at level 0).\n\n"
    "## FORBIDDEN TAGS — NEVER USE THESE\n"
    "The following tags DO NOT EXIST in Wazuh rule syntax. Never generate them:\n"
    "<then>, <else>, <log>, <if>, <rule_group>, <alert>, <output>, <command>, <response>,\n"
    "<condition>, <filter>, <trigger>, <severity>, <priority>, <source>, <destination>,\n"
    "<event>, <type>, <name>, <value>, <message>, <detect>, <block>, <allow>, <deny>\n\n"
    "## STRUCTURAL CONSTRAINTS\n"
    "1. All opened XML tags must be properly closed.\n"
    "2. <field> tags must be DIRECT children of <rule>, never nested inside <match> or other tags.\n"
    "3. <description> is MANDATORY — every rule must have one.\n"
    "4. Group names inside <group> should end with a trailing comma (Wazuh convention): <group>authentication_failed,pci_dss_10.2.4,</group>\n"
    "5. Self-closing tags like <same_source_ip /> must use proper XML self-closing syntax.\n"
    "6. For correlation rules, use frequency/timeframe as ATTRIBUTES on <rule>, not child tags, when combined with if_matched_sid.\n"
    "   However, <frequency> and <timeframe> as child tags are also valid when used for rate-based rules.\n"
    "7. The <mitre> tag must contain one or more <id> child elements, each with a technique ID (e.g., T1110).\n\n"
    "## EXAMPLES OF CORRECT XML RULES\n\n"
    "Example 1 — Simple if_sid chaining (SSH brute force from specific IP):\n"
    "<rule id=\"100101\" level=\"5\">\n"
    "  <if_sid>5716</if_sid>\n"
    "  <srcip>1.1.1.1</srcip>\n"
    "  <description>sshd: authentication failed from IP 1.1.1.1.</description>\n"
    "  <group>authentication_failed,pci_dss_10.2.4,pci_dss_10.2.5,</group>\n"
    "</rule>\n\n"
    "Example 2 — Field-based matching (Suspicious PowerShell via Sysmon):\n"
    "<rule id=\"100102\" level=\"7\">\n"
    "  <if_sid>61603</if_sid>\n"
    "  <field name=\"win.eventdata.image\">\\\\powershell.exe$</field>\n"
    "  <description>Suspicious PowerShell process execution detected.</description>\n"
    "  <mitre>\n"
    "    <id>T1059.001</id>\n"
    "  </mitre>\n"
    "  <group>windows,process_creation,</group>\n"
    "</rule>\n\n"
    "Example 3 — Frequency/correlation rule (multiple SSH failures):\n"
    "<rule id=\"100103\" level=\"10\" frequency=\"5\" timeframe=\"120\">\n"
    "  <if_matched_sid>5716</if_matched_sid>\n"
    "  <same_source_ip />\n"
    "  <description>Multiple SSH authentication failures from same source — possible brute force.</description>\n"
    "  <mitre>\n"
    "    <id>T1110</id>\n"
    "  </mitre>\n"
    "  <group>authentication_failures,brute_force,</group>\n"
    "</rule>\n\n"
    "Example 4 — Decoder-based grouping rule (level 0, noalert):\n"
    "<rule id=\"100104\" level=\"0\">\n"
    "  <decoded_as>sshd</decoded_as>\n"
    "  <description>Grouping of custom SSHD rules.</description>\n"
    "  <group>sshd,custom_grouping,</group>\n"
    "</rule>\n\n"
    "Example 5 — Match and regex pattern (web attack SQL injection):\n"
    "<rule id=\"100105\" level=\"12\">\n"
    "  <if_group>web</if_group>\n"
    "  <url>select%20|union%20|insert%20|update%20|delete%20</url>\n"
    "  <description>SQL injection attempt detected in URL.</description>\n"
    "  <mitre>\n"
    "    <id>T1190</id>\n"
    "  </mitre>\n"
    "  <group>web,attack,sql_injection,</group>\n"
    "</rule>\n\n"
    "Example 6 — Linux audit rule (unauthorized file access):\n"
    "<rule id=\"100106\" level=\"8\">\n"
    "  <if_sid>80700</if_sid>\n"
    "  <field name=\"audit.key\">etc_modification</field>\n"
    "  <description>Critical configuration file modification detected via auditd.</description>\n"
    "  <mitre>\n"
    "    <id>T1565</id>\n"
    "  </mitre>\n"
    "  <group>audit,config_change,</group>\n"
    "</rule>\n\n"
    "Example 7 — Match pattern with program_name (sudo abuse):\n"
    "<rule id=\"100107\" level=\"9\">\n"
    "  <if_sid>5402</if_sid>\n"
    "  <match>NOT in sudoers</match>\n"
    "  <description>User attempted sudo without sudoers entry — privilege escalation attempt.</description>\n"
    "  <mitre>\n"
    "    <id>T1548</id>\n"
    "  </mitre>\n"
    "  <group>syslog,sudo,privilege_escalation,</group>\n"
    "</rule>\n\n"
    "Example 8 — Windows event with multiple MITRE IDs:\n"
    "<rule id=\"100108\" level=\"14\">\n"
    "  <if_sid>60106</if_sid>\n"
    "  <field name=\"win.system.eventID\">^4720$</field>\n"
    "  <description>New Windows user account created — potential persistence mechanism.</description>\n"
    "  <mitre>\n"
    "    <id>T1136.001</id>\n"
    "    <id>T1078</id>\n"
    "  </mitre>\n"
    "  <group>windows,account_creation,</group>\n"
    "</rule>\n\n"
    "Example 9 — Data exfiltration via SFTP using field match:\n"
    "<rule id=\"100109\" level=\"10\">\n"
    "  <if_sid>5715</if_sid>\n"
    "  <match>sftp-server: close</match>\n"
    "  <regex>bytes read \\d{6,}</regex>\n"
    "  <description>Large file download via SFTP — possible data exfiltration.</description>\n"
    "  <mitre>\n"
    "    <id>T1048</id>\n"
    "  </mitre>\n"
    "  <group>syslog,sftp,exfiltration,</group>\n"
    "</rule>\n\n"
    "Example 10 — Firewall rule with time restriction:\n"
    "<rule id=\"100110\" level=\"6\">\n"
    "  <if_group>firewall</if_group>\n"
    "  <action>drop</action>\n"
    "  <time>10 pm - 6 am</time>\n"
    "  <description>Firewall drop event outside business hours.</description>\n"
    "  <group>firewall,off_hours,</group>\n"
    "</rule>\n"
)


# --- Schemas ---

class XMLValidateRequest(BaseModel):
    xml_content: str


class RuleGenerateRequest(BaseModel):
    prompt: str


class AIAssistantRequest(BaseModel):
    action: str  # "explain", "improve", "optimize", "convert", "analyze"
    xml_content: str
    prompt: Optional[str] = None


# --- Helper Functions ---

def parse_xml_rule(xml_content: str) -> dict[str, Any]:
    """Parses a custom rule XML string to extract level, description, and groups."""
    data = {"level": 0, "description": "", "groups": []}
    try:
        root = ET.fromstring(xml_content)
        data["level"] = int(root.get("level", 0))
        desc = root.find("description")
        if desc is not None and desc.text:
            data["description"] = desc.text.strip()
        
        # Read groups from rule attributes or child elements
        groups_attr = root.get("groups")
        if groups_attr:
            data["groups"].extend([g.strip() for g in groups_attr.split(",") if g.strip()])
        
        for grp in root.findall("group"):
            if grp.text:
                data["groups"].extend([g.strip() for g in grp.text.split(",") if g.strip()])
                
        # deduplicate groups
        data["groups"] = list(set(data["groups"]))
    except Exception:
        # Fallback to regex in case of draft/malformed XML
        level_match = re.search(r'level=["\'](\d+)["\']', xml_content)
        if level_match:
            data["level"] = int(level_match.group(1))
        desc_match = re.search(r"<description>(.*?)</description>", xml_content, re.DOTALL)
        if desc_match:
            data["description"] = desc_match.group(1).strip()
        groups_match = re.findall(r"<group>(.*?)</group>", xml_content)
        for g in groups_match:
            data["groups"].extend([item.strip() for item in g.split(",") if item.strip()])
            
    return data


def extract_rule_xml(file_content: str, rule_id: str) -> Optional[str]:
    """Parses a rule file XML and returns the XML element for a specific rule ID."""
    try:
        root = ET.fromstring(file_content)
        for rule in root.findall(".//rule"):
            if rule.get("id") == rule_id:
                return ET.tostring(rule, encoding="utf-8").decode("utf-8")
    except Exception:
        # Fallback to string regex matching if XML parser fails on complex file
        pattern = rf'(<rule\s+[^>]*id="{rule_id}"[^>]*>.*?</rule>)'
        match = re.search(pattern, file_content, re.DOTALL)
        if match:
            return match.group(1)
    return None


def wazuh_rule_to_xml(rule_data: dict[str, Any]) -> str:
    """Dynamically translates Wazuh manager API rule details JSON back to valid, indented XML."""
    rule_id = rule_data.get("id")
    level = rule_data.get("level", 0)
    description = rule_data.get("description", "")
    groups = rule_data.get("groups", [])
    
    details = rule_data.get("details", {})
    if not details or not isinstance(details, dict):
        exclude = {"id", "level", "description", "groups", "filename", "firedtimes", "rule_path", "mitre", "relative_path", "status"}
        details = {k: v for k, v in rule_data.items() if k not in exclude}

    groups_attr = f' groups="{",".join(groups)}"' if groups else ''
    xml = f'<rule id="{rule_id}" level="{level}"{groups_attr}>\n'
    
    def format_tag(tag_name: str, tag_val: Any) -> str:
        tag_xml = ""
        if isinstance(tag_val, list):
            for item in tag_val:
                tag_xml += format_tag(tag_name, item)
        elif isinstance(tag_val, dict):
            attrs = []
            content = ""
            for k, v in tag_val.items():
                if k in ("content", "$"):
                    content = str(v)
                else:
                    attrs.append(f'{k}="{v}"')
            attrs_str = f" { ' '.join(attrs) }" if attrs else ""
            tag_xml += f'  <{tag_name}{attrs_str}>{content}</{tag_name}>\n'
        else:
            tag_xml += f'  <{tag_name}>{tag_val}</{tag_name}>\n'
        return tag_xml

    for key, val in details.items():
        if val is None or val == "":
            continue
        if key in ("relative_path", "status", "filename", "rule_path"):
            continue
        xml += format_tag(key, val)
        
    mitre = rule_data.get("mitre", {})
    if mitre and isinstance(mitre, dict):
        mitre_ids = mitre.get("id", [])
        if isinstance(mitre_ids, list):
            for m_id in mitre_ids:
                xml += f'  <mitre>\n    <id>{m_id}</id>\n  </mitre>\n'
        elif mitre_ids:
            xml += f'  <mitre>\n    <id>{mitre_ids}</id>\n  </mitre>\n'

    if description:
        xml += f'  <description>{description}</description>\n'
        
    xml += '</rule>'
    return xml


def pretty_print_xml(xml_string: str) -> str:
    """Parses a Wazuh XML rule string and returns it beautifully indented and structured."""
    try:
        # Strip any leading/trailing whitespace
        xml_string = xml_string.strip()
        if not xml_string:
            return ""
        # Find the <rule> tag to start parsing
        rule_match = re.search(r'(<rule\s+[^>]*>.*?</rule>)', xml_string, re.DOTALL)
        if rule_match:
            xml_string = rule_match.group(1)
            
        root = ET.fromstring(xml_string)
        
        # Strip tail/text whitespace before indenting to prevent duplicate lines or weird spacings
        for elem in root.iter():
            if elem.text:
                elem.text = elem.text.strip()
            if elem.tail:
                elem.tail = elem.tail.strip()
                
        # Recursive indentation helper
        def indent(elem, level=0):
            i = "\n" + level * "  "
            if len(elem):
                if not elem.text or not elem.text.strip():
                    elem.text = i + "  "
                if not elem.tail or not elem.tail.strip():
                    elem.tail = i
                for child in elem:
                    indent(child, level + 1)
                if not child.tail or not child.tail.strip():
                    child.tail = i
            else:
                if level and (not elem.tail or not elem.tail.strip()):
                    elem.tail = i
                    
        indent(root)
        
        # ET.tostring doesn't add XML declaration, which is perfect for snippets
        return ET.tostring(root, encoding="utf-8").decode("utf-8").strip()
    except Exception:
        # Fallback in case of parsing errors: clean up spacing slightly with regex
        return xml_string



def _extract_group_key(xml_content: str) -> str:
    """Extracts the group names from a rule's XML content to build the <group> wrapper key.

    Inspects both the 'groups' attribute on the <rule> tag and <group> child elements.
    Returns a comma-separated, deduplicated, sorted group string ending with a trailing comma
    following Wazuh convention.  Falls back to 'local,custom,' if no groups are found.
    """
    groups: set[str] = set()
    try:
        root = ET.fromstring(xml_content)
        # Check groups attribute on <rule>
        groups_attr = root.get("groups")
        if groups_attr:
            groups.update(g.strip().rstrip(",") for g in groups_attr.split(",") if g.strip().rstrip(","))
        # Check <group> child elements
        for grp in root.findall("group"):
            if grp.text:
                groups.update(g.strip().rstrip(",") for g in grp.text.split(",") if g.strip().rstrip(","))
    except Exception:
        # Fallback to regex
        groups_attr_match = re.search(r'groups="([^"]*)"', xml_content)
        if groups_attr_match:
            groups.update(g.strip().rstrip(",") for g in groups_attr_match.group(1).split(",") if g.strip().rstrip(","))
        group_tag_matches = re.findall(r"<group>(.*?)</group>", xml_content)
        for g_text in group_tag_matches:
            groups.update(g.strip().rstrip(",") for g in g_text.split(",") if g.strip().rstrip(","))

    if not groups:
        return "local,custom,"
    return ",".join(sorted(groups)) + ","


def _build_octopus_rules_xml(rules: list) -> str:
    """Compiles a list of CustomRule objects into a valid Wazuh rule file XML string.

    Rules are grouped dynamically by their parsed group names. Each distinct group set
    gets its own <group name="..."> wrapper in the output file.
    """
    if not rules:
        return (
            "<!-- Octopus Platform - Custom Rules -->\n"
            "<!-- Auto-generated file. Do not edit manually. -->\n\n"
            '<group name="local,custom,">\n'
            "</group>\n"
        )

    # Bucket rules by their group key
    buckets: dict[str, list[str]] = {}
    for r in rules:
        key = _extract_group_key(r.xml_content)
        buckets.setdefault(key, []).append(r.xml_content)

    # Build the final XML file content
    parts: list[str] = [
        "<!-- Octopus Platform - Custom Rules -->",
        "<!-- Auto-generated file. Do not edit manually. -->",
        "",
    ]
    for group_key in sorted(buckets.keys()):
        parts.append(f'<group name="{group_key}">')
        for xml_content in buckets[group_key]:
            # Indent each rule block inside the group
            indented = "\n".join("  " + line if line.strip() else "" for line in xml_content.strip().splitlines())
            parts.append(indented)
            parts.append("")  # blank line between rules
        parts.append("</group>")
        parts.append("")  # blank line between groups

    return "\n".join(parts)


# --- Endpoints ---

@router.get("")
async def list_rules(
    status_filter: Optional[str] = None,  # "draft", "deployed", "custom", "default", "all"
    level_filter: Optional[str] = None,
    group_filter: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 10000,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rules = []

    # 1. Fetch custom rules from local DB
    db_query = db.query(CustomRule)
    if status_filter == "draft":
        db_query = db_query.filter(CustomRule.status == "draft")
    elif status_filter == "deployed":
        db_query = db_query.filter(CustomRule.status == "deployed")

    db_custom_rules = db_query.all()
    
    # Process custom rules
    custom_rules_list = []
    for r in db_custom_rules:
        parsed = parse_xml_rule(r.xml_content)
        rule_item = {
            "id": r.id,
            "rule_id": r.rule_id,
            "name": r.name,
            "level": parsed["level"],
            "description": parsed["description"] or r.name,
            "groups": parsed["groups"] or ["local"],
            "status": r.status,
            "deployed_at": r.deployed_at,
            "filename": OCTOPUS_RULES_FILENAME
        }
        custom_rules_list.append(rule_item)

    # 2. Fetch default rules from Wazuh (if not filtering strictly by draft)
    wazuh_rules_list = []
    if status_filter not in ["draft"]:
        try:
            client = WazuhClient()
            # Fetch default rules from Wazuh API. High limit or let query parameters handle it.
            wazuh_limit = 500
            wazuh_offset = 0
            has_more = True
            
            while len(wazuh_rules_list) < 10000 and has_more:
                wazuh_resp = await client.get_wazuh_rules(
                    limit=wazuh_limit, 
                    offset=wazuh_offset,
                    search=search if search and search.isdigit() else None
                )
                affected_items = wazuh_resp.get("data", {}).get("affected_items", [])
                
                for item in affected_items:
                    r_id = str(item.get("id"))
                    # If this ID is present in our DB custom rules, we prioritize DB representation
                    if any(cr["rule_id"] == r_id for cr in custom_rules_list):
                        continue
                    
                    wazuh_rules_list.append({
                        "id": None,
                        "rule_id": r_id,
                        "name": item.get("description", f"Wazuh Rule {r_id}"),
                        "level": int(item.get("level", 0)),
                        "description": item.get("description", ""),
                        "groups": item.get("groups", []),
                        "status": "default",
                        "deployed_at": None,
                        "filename": item.get("filename", "")
                    })
                
                has_more = len(affected_items) == wazuh_limit
                wazuh_offset += wazuh_limit
                
        except Exception:
            # If Wazuh is offline, we fallback to only return custom rules
            pass

    # Merge rules
    if status_filter == "default":
        rules = wazuh_rules_list
    elif status_filter == "custom":
        rules = custom_rules_list
    else:
        rules = custom_rules_list + wazuh_rules_list

    # Apply python-side filtering (search, level, group) for unified results
    filtered_rules = []
    for r in rules:
        # Search match
        if search:
            search_lower = search.lower()
            match_id = search_lower in r["rule_id"]
            match_desc = search_lower in r["description"].lower()
            match_name = search_lower in r["name"].lower()
            if not (match_id or match_desc or match_name):
                continue

        # Level match
        if level_filter:
            if str(r["level"]) != str(level_filter):
                continue

        # Group match
        if group_filter:
            if group_filter.lower() not in [g.lower() for g in r["groups"]]:
                continue

        filtered_rules.append(r)

    # Sort results: Custom rules first, then by ID
    filtered_rules.sort(key=lambda x: (x["status"] == "default", x["rule_id"]))

    # Apply offset & limit
    paginated_rules = filtered_rules[offset:offset + limit]

    return paginated_rules


@router.get("/{rule_id}")
async def get_rule(
    rule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 1. Check if it exists as a custom rule in our DB
    db_rule = db.query(CustomRule).filter(CustomRule.rule_id == rule_id).first()

    if db_rule:
        parsed = parse_xml_rule(db_rule.xml_content)
        return {
            "id": db_rule.id,
            "rule_id": db_rule.rule_id,
            "name": db_rule.name,
            "xml_content": db_rule.xml_content,
            "status": db_rule.status,
            "deployed_at": db_rule.deployed_at,
            "level": parsed["level"],
            "description": parsed["description"] or db_rule.name,
            "groups": parsed["groups"] or ["local"],
            "filename": OCTOPUS_RULES_FILENAME
        }

    # 2. Fetch default rule from Wazuh Manager
    try:
        client = WazuhClient()
        wazuh_rule = await client.get_wazuh_rule(rule_id)
        affected_items = wazuh_rule.get("data", {}).get("affected_items", [])
        if not affected_items:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Rule {rule_id} not found in Wazuh manager."
            )
        rule_data = affected_items[0]
        filename = rule_data.get("filename")
        
        if filename:
            try:
                file_content = await client.get_rule_file(filename)
                xml_content = extract_rule_xml(file_content, rule_id) or wazuh_rule_to_xml(rule_data)
            except Exception:
                xml_content = wazuh_rule_to_xml(rule_data)
        else:
            xml_content = wazuh_rule_to_xml(rule_data)

        return {
            "id": None,
            "rule_id": str(rule_data.get("id")),
            "name": rule_data.get("description", f"Wazuh Rule {rule_id}"),
            "xml_content": xml_content,
            "status": "default",
            "deployed_at": None,
            "level": int(rule_data.get("level", 0)),
            "description": rule_data.get("description", ""),
            "groups": rule_data.get("groups", []),
            "filename": filename
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail=f"Rule {rule_id} not found in database or Wazuh manager. {str(exc)}"
        )


@router.post("", response_model=CustomRuleRead, status_code=status.HTTP_201_CREATED)
def create_rule(
    payload: CustomRuleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Manager")),
):
    existing = db.query(CustomRule).filter(CustomRule.rule_id == payload.rule_id).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rule ID already exists")

    rule = CustomRule(
        rule_id=payload.rule_id,
        name=payload.name,
        xml_content=payload.xml_content,
        created_by=current_user.id,
        status="draft",
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)

    write_audit_log(
        db,
        user_id=current_user.id,
        action="rule.create",
        resource_type="custom_rule",
        resource_id=str(rule.id),
        details={"rule_id": rule.rule_id, "name": rule.name},
        ip_address=request.client.host if request.client else None,
    )

    return rule


@router.put("/{id}", response_model=CustomRuleRead)
def update_rule(
    id: int,
    payload: CustomRuleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Manager")),
):
    rule = db.query(CustomRule).filter(CustomRule.id == id).first()
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")

    if payload.rule_id != rule.rule_id:
        existing = db.query(CustomRule).filter(CustomRule.rule_id == payload.rule_id).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rule ID already exists")

    rule.rule_id = payload.rule_id
    rule.name = payload.name
    rule.xml_content = payload.xml_content
    rule.status = "draft"  # Updates bring rule back to draft status
    db.add(rule)
    db.commit()
    db.refresh(rule)

    write_audit_log(
        db,
        user_id=current_user.id,
        action="rule.update",
        resource_type="custom_rule",
        resource_id=str(rule.id),
        details={"rule_id": rule.rule_id, "name": rule.name},
        ip_address=request.client.host if request.client else None,
    )

    return rule


@router.delete("/{id}")
def delete_rule(
    id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Manager")),
):
    rule = db.query(CustomRule).filter(CustomRule.id == id).first()
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")

    rule_id = rule.rule_id
    db.delete(rule)
    db.commit()

    write_audit_log(
        db,
        user_id=current_user.id,
        action="rule.delete",
        resource_type="custom_rule",
        resource_id=str(id),
        details={"rule_id": rule_id},
        ip_address=request.client.host if request.client else None,
    )

    return {"status": "ok", "message": f"Rule {rule_id} deleted successfully"}


@router.post("/validate")
def validate_rule(payload: XMLValidateRequest):
    errors = []
    warnings = []

    try:
        # Parse XML (wrapped to support rule snippets)
        root = ET.fromstring(f"<wrapper>{payload.xml_content}</wrapper>")
        
        # Look for <rule> elements
        rules = root.findall(".//rule")
        if not rules:
            errors.append("XML content is missing the root <rule> tag.")
        else:
            for r in rules:
                rid = r.get("id")
                level = r.get("level")
                
                # Rule ID validation
                if not rid:
                    errors.append("The <rule> tag is missing the required 'id' attribute.")
                else:
                    if not rid.isdigit():
                        errors.append(f"Rule ID '{rid}' must be a numeric integer.")
                    else:
                        id_val = int(rid)
                        if not (100000 <= id_val <= 120000):
                            warnings.append(f"Rule ID '{rid}' is outside the recommended custom rule range (100000 - 120000).")
                
                # Rule Level validation
                if not level:
                    errors.append("The <rule> tag is missing the required 'level' attribute.")
                else:
                    if not level.isdigit() or not (0 <= int(level) <= 16):
                        errors.append(f"Rule level '{level}' must be a valid integer severity score between 0 and 16.")

                # Description validation
                desc = r.find("description")
                if desc is None or not desc.text or not desc.text.strip():
                    errors.append("The rule is missing the required <description> child tag.")

                # Wazuh element tag validation
                valid_tags = {
                    "description", "if_sid", "if_matched_sid", "if_group", 
                    "if_matched_group", "if_fts", "decoded_as", "category", 
                    "field", "match", "regex", "check_diff", "check_key", 
                    "same_source_ip", "same_user", "same_id", "frequency", 
                    "timeframe", "info", "options", "mitre", "var", "group"
                }
                for child in r:
                    if child.tag not in valid_tags:
                        warnings.append(f"Unknown or non-standard tag '<{child.tag}>' used inside <rule>.")

    except ET.ParseError as e:
        errors.append(f"XML parse error (syntax issues): {str(e)}")
    except Exception as e:
        errors.append(f"System validation error: {str(e)}")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings
    }


@router.post("/generate")
async def generate_rule(
    payload: RuleGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Manager"))
):
    from app.services.ollama_client import OllamaClient
    
    ollama = OllamaClient()
    if not await ollama.is_available():
        raise HTTPException(status_code=503, detail="Local Ollama AI service is not running or available.")

    system_prompt = WAZUH_RULE_GEN_SYSTEM_PROMPT
    
    user_prompt = f"Generate a Wazuh XML rule for: {payload.prompt}"

    try:
        response_text = await ollama.chat(prompt=user_prompt, system=system_prompt)
        
        # Clean markdown wraps if the model outputted them
        cleaned = response_text.strip()
        if cleaned.startswith("```xml"):
            cleaned = cleaned[6:]
        elif cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        # Extract only the <rule ...> ... </rule> block
        rule_match = re.search(r'(<rule\s+[^>]*>.*?</rule>)', cleaned, re.DOTALL)
        if rule_match:
            xml_string = rule_match.group(1)
        else:
            xml_string = cleaned

        # Pretty-print the XML structure
        formatted_xml = pretty_print_xml(xml_string)

        # Parse XML to extract fields for UI mapping
        try:
            root = ET.fromstring(formatted_xml)
            rule_id = root.get("id", "100500")
            level = int(root.get("level", "5"))
            
            desc_node = root.find("description")
            description = desc_node.text.strip() if (desc_node is not None and desc_node.text) else "Custom AI Generated Rule"
            
            groups = []
            group_node = root.find("group")
            if group_node is not None and group_node.text:
                groups = [g.strip() for g in group_node.text.split(",") if g.strip()]
            
            groups_attr = root.get("groups")
            if groups_attr:
                groups.extend([g.strip() for g in groups_attr.split(",") if g.strip()])
                
            if not groups:
                groups = ["local"]
            groups = list(set(groups))
            
            name = description if len(description) < 50 else description[:47] + "..."
            
            # --- Check for rule ID collisions and reassign if needed ---
            existing_ids = {r.rule_id for r in db.query(CustomRule.rule_id).all()}
            if rule_id in existing_ids:
                # Find next available ID in the custom range
                candidate = max(int(rid) for rid in existing_ids if rid.isdigit() and 100000 <= int(rid) <= 119999) + 1 if any(rid.isdigit() and 100000 <= int(rid) <= 119999 for rid in existing_ids) else 100001
                while str(candidate) in existing_ids and candidate <= 119999:
                    candidate += 1
                new_id = str(candidate)
                # Rewrite the XML with the new ID
                formatted_xml = re.sub(r'id="[^"]*"', f'id="{new_id}"', formatted_xml, count=1)
                rule_id = new_id

            return {
                "rule_id": rule_id,
                "name": name,
                "xml_content": formatted_xml,
                "description": description,
                "level": level,
                "groups": groups
            }
        except Exception:
            # Fallback if XML parsing fails on draft
            id_match = re.search(r'id=["\'](\d+)["\']', cleaned)
            level_match = re.search(r'level=["\'](\d+)["\']', cleaned)
            desc_match = re.search(r"<description>(.*?)</description>", cleaned, re.DOTALL)
            group_match = re.search(r"<group>(.*?)</group>", cleaned, re.DOTALL)
            
            rule_id = id_match.group(1) if id_match else "100500"
            level = int(level_match.group(1)) if level_match else 5
            description = desc_match.group(1).strip() if desc_match else "Custom AI Generated Rule"
            groups = [g.strip() for g in group_match.group(1).split(",")] if group_match else ["local"]
            
            # Collision check in fallback path too
            existing_ids = {r.rule_id for r in db.query(CustomRule.rule_id).all()}
            if rule_id in existing_ids:
                candidate = max(int(rid) for rid in existing_ids if rid.isdigit() and 100000 <= int(rid) <= 119999) + 1 if any(rid.isdigit() and 100000 <= int(rid) <= 119999 for rid in existing_ids) else 100001
                while str(candidate) in existing_ids and candidate <= 119999:
                    candidate += 1
                new_id = str(candidate)
                cleaned = re.sub(r'id=["\'][^"\']*["\']', f'id="{new_id}"', cleaned, count=1)
                rule_id = new_id

            return {
                "rule_id": rule_id,
                "name": description[:50],
                "xml_content": cleaned,
                "description": description,
                "level": level,
                "groups": groups
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ollama generation failed: {str(e)}")


@router.post("/assistant")
async def rule_assistant(
    payload: AIAssistantRequest,
    current_user: User = Depends(require_roles("Manager"))
):
    from app.services.ollama_client import OllamaClient

    ollama = OllamaClient()
    if not await ollama.is_available():
        raise HTTPException(status_code=503, detail="Local Ollama AI service is not running or available.")

    system_prompt = (
        "You are an AI Security Analyst assisting with Wazuh SIEM rules. "
        "Analyze the provided rule XML and respond with clear, concise, actionable security insights. "
        "Just answer directly using markdown formatting."
    )

    if payload.action == "explain":
        prompt = f"Explain what this Wazuh rule does, its detection criteria, and immediate security responses:\n\n{payload.xml_content}"
    elif payload.action in ["improve", "optimize"]:
        prompt = f"Review this Wazuh rule for performance, syntax, and detection accuracy. Offer an optimized XML block and explain your reasoning:\n\n{payload.xml_content}"
    elif payload.action == "convert":
        prompt = f"Convert this detection logic request into a valid Wazuh XML rule block:\n\n{payload.prompt or 'Detect exfiltration'}\n\nRule template reference:\n{payload.xml_content}"
    elif payload.action == "analyze":
        prompt = f"Check this rule for missing fields, syntax errors, and suggest appropriate severity levels and groups:\n\n{payload.xml_content}"
    else:
        prompt = f"Review this rule:\n\n{payload.xml_content}\n\nUser request: {payload.prompt or ''}"

    try:
        response_text = await ollama.chat(prompt=prompt, system=system_prompt)
        return {"response": response_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ollama assistant failed: {str(e)}")


@router.post("/{rule_id}/deploy", response_model=CustomRuleRead)
async def deploy_rule(
    rule_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("Admin")),
):
    # Find targeted rule
    rule = db.query(CustomRule).filter(CustomRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")

    old_status = rule.status
    old_deployed_at = rule.deployed_at

    # Temporarily commit deploy status
    rule.status = "deployed"
    rule.deployed_at = datetime.utcnow()
    db.add(rule)
    db.commit()
    db.refresh(rule)

    try:
        # Re-compile all deployed custom rules into a single XML file with dynamic grouping
        deployed_rules = db.query(CustomRule).filter(CustomRule.status == "deployed").all()
        xml_content = _build_octopus_rules_xml(deployed_rules)

        client = WazuhClient()
        
        # Upload XML ruleset to manager
        await client.upload_rule_file(OCTOPUS_RULES_FILENAME, xml_content)
        
        # Check validation
        val_resp = await client.validate_configuration()
        error_code = val_resp.get("error", 0)
        data = val_resp.get("data", {})
        validation_status = data.get("status", "ok")

        if error_code != 0 or validation_status == "invalid":
            details = data.get("details", "Wazuh ruleset syntax or configuration check failed")
            
            # Rollback database status
            rule.status = old_status
            rule.deployed_at = old_deployed_at
            db.add(rule)
            db.commit()

            # Restore previous valid config file on Wazuh manager
            safe_rules = db.query(CustomRule).filter((CustomRule.status == "deployed") & (CustomRule.id != rule_id)).all()
            safe_xml_content = _build_octopus_rules_xml(safe_rules)
            await client.upload_rule_file(OCTOPUS_RULES_FILENAME, safe_xml_content)

            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Wazuh configuration validation failed. Reload aborted. Details: {details}"
            )

        # Trigger restart of Wazuh Manager service
        await client.restart_manager()

    except HTTPException:
        raise
    except Exception as e:
        # Rollback on system exception
        rule.status = old_status
        rule.deployed_at = old_deployed_at
        db.add(rule)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Deployment process hit an exception: {str(e)}"
        )

    write_audit_log(
        db,
        user_id=current_user.id,
        action="rule.deploy",
        resource_type="custom_rule",
        resource_id=str(rule.id),
        details={"rule_id": rule.rule_id},
        ip_address=request.client.host if request.client else None,
    )

    return rule
