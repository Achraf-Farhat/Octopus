import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    project_name: str = os.getenv("PROJECT_NAME", "Octopus")
    environment: str = os.getenv("ENVIRONMENT", "development")
    database_url: str = os.getenv("DATABASE_URL", "")
    redis_url: str = os.getenv("REDIS_URL", "")
    secret_key: str = os.getenv("SECRET_KEY", "")
    algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    access_token_expire_minutes: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
    refresh_token_expire_days: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
    bootstrap_admin_username: str = os.getenv("BOOTSTRAP_ADMIN_USERNAME", "")
    bootstrap_admin_email: str = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "")
    bootstrap_admin_password: str = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
    wazuh_api_url: str = os.getenv("WAZUH_API_URL", "")
    wazuh_user: str = os.getenv("WAZUH_USER", "")
    wazuh_password: str = os.getenv("WAZUH_PASSWORD", "")
    wazuh_verify_ssl: bool = os.getenv("WAZUH_VERIFY_SSL", "false").lower() == "true"
    wazuh_indexer_url: str = os.getenv("WAZUH_INDEXER_URL", "")
    wazuh_indexer_verify_ssl: bool = os.getenv("WAZUH_INDEXER_VERIFY_SSL", "true").lower() == "true"
    wazuh_indexer_username: str = os.getenv("WAZUH_INDEXER_USERNAME", "")
    wazuh_indexer_password: str = os.getenv("WAZUH_INDEXER_PASSWORD", "")
    wazuh_indexer_ca_cert: str = os.getenv("WAZUH_INDEXER_CA_CERT", "")
    wazuh_indexer_client_cert: str = os.getenv("WAZUH_INDEXER_CLIENT_CERT", "")
    wazuh_indexer_client_key: str = os.getenv("WAZUH_INDEXER_CLIENT_KEY", "")
    ollama_api_url: str = os.getenv("OLLAMA_API_URL", "")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "llama3.2:3b")


settings = Settings()
