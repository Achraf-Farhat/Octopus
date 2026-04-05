from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "octopus",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks"],
)

celery_app.conf.beat_schedule = {
    "poll-wazuh-alerts": {
        "task": "app.tasks.poll_wazuh_alerts",
        "schedule": 30.0,
    }
}
