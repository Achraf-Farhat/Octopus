import os
import sys
import asyncio

# Load .env file
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

# Override database URL to point to localhost instead of container hostname
os.environ["DATABASE_URL"] = "postgresql+psycopg2://octopus:aEjETxP91uDkyGifrWRZnB0MgCv6j5k1@127.0.0.1:5432/octopus"

# Now we can import app modules safely
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.db.session import SessionLocal
from app.models.custom_rule import CustomRule
from app.services.wazuh_client import WazuhClient

async def main():
    db = SessionLocal()
    print("--- CUSTOM RULES IN DATABASE ---")
    try:
        rules = db.query(CustomRule).all()
        for r in rules:
            print(f"ID: {r.id}, Rule ID: {r.rule_id}, Status: {r.status}, Name: {r.name}")
            print("XML Content:")
            print(r.xml_content)
            print("-" * 40)
    except Exception as e:
        print(f"Error querying DB: {e}")
        
    print("\n--- OCTOPUS RULES FILE ON WAZUH MANAGER ---")
    try:
        client = WazuhClient()
        content = await client.get_rule_file("octopus_rules.xml")
        print("octopus_rules.xml content:")
        print(content)
    except Exception as e:
        print(f"Error getting octopus_rules.xml: {e}")

if __name__ == "__main__":
    asyncio.run(main())
