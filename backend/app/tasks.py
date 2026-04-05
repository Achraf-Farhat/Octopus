from app.celery_app import celery_app


@celery_app.task(name="app.tasks.poll_wazuh_alerts")
def poll_wazuh_alerts():
    return {"status": "queued"}
