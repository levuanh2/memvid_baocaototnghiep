"""Supervised PostgreSQL worker for Guided Mind Map V3."""
from __future__ import annotations

import os
import signal
import threading
import time
import uuid

from app.domains.jobs import guided_store


def _enabled(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def run_once(worker_id: str | None = None) -> bool:
    worker_id = worker_id or f"mindmap-worker:{uuid.uuid4().hex[:12]}"
    job = guided_store.claim_next_job(worker_id, int(os.getenv("GUIDED_JOB_LEASE_SECONDS", "900")))
    if not job:
        return False
    job_id = str(job["job_id"])
    beat_stop = threading.Event()
    ttl = int(os.getenv("GUIDED_WORKER_HEARTBEAT_TTL_SEC", "90"))
    lease = int(os.getenv("GUIDED_JOB_LEASE_SECONDS", "900"))

    def _beat_job():
        while not beat_stop.wait(max(1.0, min(ttl, lease) / 3)):
            try:
                guided_store.record_worker_heartbeat(worker_id, ttl)
                from datetime import datetime, timedelta, timezone
                guided_store.update_job(job_id, heartbeat=True,
                                        lease_expires_at=datetime.now(timezone.utc) + timedelta(seconds=lease))
            except Exception:
                pass

    heartbeat_thread = threading.Thread(target=_beat_job, name="guided-job-heartbeat", daemon=True)
    heartbeat_thread.start()
    try:
        # Imports happen only in the worker process, never in a Gunicorn request
        # worker. The input is rebuilt from source IDs, not copied into the job.
        from app import main
        source_names = job.get("source_ids") or []
        mm_input, content_hash = main._mindmap_input_and_hash(source_names)
        intent = job.get("guided_config") or None
        if intent:
            from app.domains.mindmap.guided import intent_hash, suggest_topics
            topics = suggest_topics(mm_input)
            mm_input = {**mm_input, "generation_intent": intent, "guided_topics": topics}
            content_hash = intent_hash(content_hash, intent)
        # `force` is set at request time (app/main.py's /generate-mindmap) and
        # persisted on the job row precisely so this reuse check can honour it
        # -- without it, a forced regeneration request still silently replayed
        # whatever the content_hash last resolved to (2026-09-23 finding).
        if not job.get("force"):
            existing = main.mindmap_store.get_by_hash(content_hash, user_id=job.get("user_id"), enforce_owner=True)
            if existing:
                guided_store.update_job(job_id, status="done", stage="done", result_map_id=existing.get("id"), result=existing)
                return True
        main.run_mindmap_job(job_id, source_names, mm_input, content_hash,
                             job.get("user_id"), already_claimed=True)
        return True
    except Exception as exc:
        attempts = int(job.get("attempts") or 1)
        maximum = int(os.getenv("GUIDED_JOB_MAX_ATTEMPTS", "3"))
        if attempts >= maximum:
            guided_store.update_job(job_id, status="failed", stage="failed",
                                    error_code="worker_retry_exhausted",
                                    error_message=str(exc)[:2000])
        else:
            delay = min(300, 2 ** max(0, attempts - 1))
            from datetime import datetime, timedelta, timezone
            guided_store.update_job(job_id, status="queued", stage="queued",
                                    error_code="worker_retryable",
                                    error_message=str(exc)[:2000],
                                    not_before=datetime.now(timezone.utc) + timedelta(seconds=delay))
        return False
    finally:
        beat_stop.set()


def main_loop() -> None:
    if os.getenv("PROCESS_ROLE", "").strip().lower() != "mindmap-worker":
        raise SystemExit("PROCESS_ROLE must be mindmap-worker")
    if not guided_store.use_postgres():
        raise SystemExit("Guided worker requires PostgreSQL durable store")
    stop = threading.Event()
    worker_id = f"mindmap-worker:{uuid.uuid4().hex[:12]}"

    def _stop(*_args):
        stop.set()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    ttl = int(os.getenv("GUIDED_WORKER_HEARTBEAT_TTL_SEC", "90"))
    poll = float(os.getenv("GUIDED_WORKER_POLL_SECONDS", "2"))
    while not stop.is_set():
        guided_store.record_worker_heartbeat(worker_id, ttl)
        ran = run_once(worker_id)
        if not ran:
            stop.wait(poll)


if __name__ == "__main__":
    main_loop()
