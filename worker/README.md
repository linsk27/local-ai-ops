# Worker

The MVP worker runs from the backend image:

```bash
celery -A app.worker.celery_app worker --beat --loglevel=info
```

Celery Beat wakes the worker every minute. The worker only executes checks whose own `interval_seconds` has elapsed since the last result, so a 5-minute check is not run every minute.

The scheduled asset-sync hook is present as a placeholder for the next production hardening pass.
