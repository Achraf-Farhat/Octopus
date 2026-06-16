import asyncio
from app.db.session import SessionLocal
from app.models.custom_rule import CustomRule
from app.services.wazuh_client import WazuhClient

async def main():
    print("--- Database Rules ---")
    db = SessionLocal()
    rules = db.query(CustomRule).all()
    for r in rules:
        print(f"DB Rule ID: {r.id}, Wazuh Rule ID: {r.rule_id}")
    
    print("\n--- Wazuh API Rules (limit 5) ---")
    client = WazuhClient()
    try:
        wazuh_resp = await client.get_wazuh_rules(limit=5)
        for item in wazuh_resp.get("data", {}).get("affected_items", []):
            print(f"Wazuh Rule ID: {item.get('id')}, Description: {item.get('description')}")
            
        print("\n--- Wazuh API get_wazuh_rule('1') ---")
        wazuh_rule_1 = await client.get_wazuh_rule('1')
        print(wazuh_rule_1)
    except Exception as e:
        print(f"Error calling Wazuh API: {e}")

asyncio.run(main())
