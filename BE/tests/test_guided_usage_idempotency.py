"""PostgreSQL regression coverage for Guided idempotency + usage reservations."""
from __future__ import annotations

import hashlib
import json
import multiprocessing
import os
import uuid

import pytest
from sqlalchemy import text

from app.domains.jobs import guided_store
from app.domains.usage import metering


TEST_DSN = (os.getenv("TEST_DATABASE_URL") or "").strip()
pytestmark = pytest.mark.skipif(
    not TEST_DSN.startswith(("postgres://", "postgresql://")),
    reason="TEST_DATABASE_URL must point to a disposable PostgreSQL database",
)

USER_ID = "guided-usage-user"
SOURCE = "guided_usage_source"
BASE_HASH = "a" * 64
PAYLOAD = {
    "sources": [SOURCE],
    "preset": "overview",
    "detail_level": "balanced",
}


def _intent_and_fingerprint(payload: dict) -> tuple[dict, str]:
    from app.domains.mindmap.guided import normalize_intent

    intent = normalize_intent(payload)
    fingerprint = hashlib.sha256(json.dumps(
        {"sources": [SOURCE], "intent": intent, "force": bool(payload.get("force"))},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
    return intent, fingerprint


def _insert_historical_job(key: str, *, status: str, fingerprint: str | None = None) -> dict:
    intent, expected_fingerprint = _intent_and_fingerprint(PAYLOAD)
    outcome, row = guided_store.create_idempotent_job(
        str(uuid.uuid4()),
        user_id=USER_ID,
        idempotency_key=key,
        request_fingerprint=fingerprint or expected_fingerprint,
        source_ids_json=json.dumps([SOURCE]),
        guided_config_json=json.dumps(intent),
    )
    assert outcome == "created"
    if status != "queued":
        updates = {"status": status, "stage": status}
        if status == "done":
            updates["result"] = {"id": "historical-map", "nodes": []}
        guided_store.update_job(row["job_id"], **updates)
    historical = guided_store.get_job(row["job_id"], user_id=USER_ID)
    assert historical["usage_reservation_id"] is None
    return historical


def _counts() -> dict[str, int]:
    from app import db

    with db.session_scope() as session:
        row = session.execute(text("""
            SELECT
              count(*) FILTER (WHERE status='reserved') AS reserved_rows,
              count(*) FILTER (WHERE status='released') AS released_rows,
              count(*) AS reservation_rows,
              COALESCE(sum(reserved_tokens) FILTER (WHERE status='reserved'), 0) AS reserved_tokens
            FROM usage_reservations WHERE user_id=:uid
        """), {"uid": USER_ID}).mappings().one()
        events = session.execute(text(
            "SELECT count(*) FROM usage_events WHERE user_id=:uid"
        ), {"uid": USER_ID}).scalar_one()
        jobs = session.execute(text(
            "SELECT count(*) FROM guided_mindmap_jobs WHERE user_id=:uid"
        ), {"uid": USER_ID}).scalar_one()
    return {
        "reserved_rows": int(row["reserved_rows"]),
        "released_rows": int(row["released_rows"]),
        "reservation_rows": int(row["reservation_rows"]),
        "reserved_tokens": int(row["reserved_tokens"]),
        "events": int(events),
        "jobs": int(jobs),
        "used_tokens": int(metering.get_summary(USER_ID)["used"]),
    }


def _assert_no_consumption(*, reservations: int) -> None:
    counts = _counts()
    assert counts["reserved_rows"] == 0, counts
    assert counts["reserved_tokens"] == 0, counts
    assert counts["events"] == 0, counts
    assert counts["used_tokens"] == 0, counts
    assert counts["reservation_rows"] == reservations, counts


@pytest.fixture(autouse=True)
def _postgres_tables(monkeypatch):
    monkeypatch.delenv("USAGE_DB_PATH", raising=False)
    monkeypatch.setenv("GUIDED_JOB_STORE_BACKEND", "postgres")
    monkeypatch.setenv("JOBS_DATABASE_URL", TEST_DSN)
    monkeypatch.setenv("USAGE_ENFORCEMENT_ENABLED", "0")
    guided_store.reset_engine()
    from app import db

    db.reset_engine()
    with db.session_scope() as session:
        session.execute(text(
            "TRUNCATE usage_events, usage_reservations, usage_entitlements, "
            "guided_mindmap_jobs, guided_mindmap_worker_heartbeats CASCADE"
        ))
    yield
    guided_store.reset_engine()
    db.reset_engine()


@pytest.fixture()
def guided_route(client, monkeypatch):
    import app.main as main
    from app.domains.mindmap import guided as guided_domain
    from app.domains.mindmap import store as mindmap_store

    monkeypatch.setattr(main, "_auth_protect_enabled", lambda: True)
    monkeypatch.setattr(main, "_current_user_id", lambda: USER_ID)
    monkeypatch.setattr(main, "owned_stems", lambda uid: {SOURCE})
    monkeypatch.setattr(main, "_ensure_ready_sources", lambda sources: None)
    monkeypatch.setattr(
        main,
        "_guided_capability",
        lambda uid: {"guided_mindmap_v3": True, "reason": None, "fallback": "v2"},
    )
    monkeypatch.setattr(
        main, "_mindmap_input_and_hash",
        lambda sources: ({"chunks": [{"text": "grounded"}]}, BASE_HASH),
    )
    monkeypatch.setattr(guided_domain, "suggest_topics", lambda mm: [])
    monkeypatch.setattr(mindmap_store, "get_by_hash", lambda *a, **k: None)
    monkeypatch.setattr(
        main, "_start_mindmap_job",
        lambda *a, **k: k.get("job_id") or str(uuid.uuid4()),
    )
    return client


def _post(client, key: str, payload: dict | None = None):
    body = dict(PAYLOAD if payload is None else payload)
    body["idempotency_key"] = key
    return client.post("/generate-mindmap", json=body)


def test_historical_completed_job_does_not_leave_or_charge_a_reservation(guided_route):
    key = "historical-completed"
    historical = _insert_historical_job(key, status="done")
    assert _counts()["reservation_rows"] == 0

    response = _post(guided_route, key)

    assert response.status_code == 200
    assert response.get_json()["job_id"] == historical["job_id"]
    _assert_no_consumption(reservations=1)


@pytest.mark.parametrize("status", ["queued", "running"])
def test_historical_inflight_job_without_usage_context_stays_unmetered(guided_route, status):
    key = f"historical-{status}"
    historical = _insert_historical_job(key, status=status)

    response = _post(guided_route, key)

    assert response.status_code == 202
    assert response.get_json()["job_id"] == historical["job_id"]
    assert guided_store.get_job(historical["job_id"], user_id=USER_ID)["usage_reservation_id"] is None
    _assert_no_consumption(reservations=1)


def test_idempotency_conflict_does_not_increase_reserved_or_used(guided_route):
    key = "historical-conflict"
    _insert_historical_job(key, status="queued", fingerprint="different-fingerprint")

    response = _post(guided_route, key)

    assert response.status_code == 409
    assert response.get_json()["error_code"] == "idempotency_conflict"
    _assert_no_consumption(reservations=1)


def test_repeated_identical_request_keeps_one_legitimate_attached_reservation(guided_route):
    key = "repeat-identical"

    first = _post(guided_route, key)
    second = _post(guided_route, key)

    assert first.status_code == second.status_code == 202
    assert first.get_json()["job_id"] == second.get_json()["job_id"]
    job = guided_store.get_job(first.get_json()["job_id"], user_id=USER_ID)
    counts = _counts()
    assert job["usage_reservation_id"] is not None
    assert counts == {
        "reserved_rows": 1,
        "released_rows": 0,
        "reservation_rows": 1,
        "reserved_tokens": 8_000,
        "events": 0,
        "jobs": 1,
        "used_tokens": 0,
    }


def _route_worker(dsn: str, key: str, start, results) -> None:
    os.environ["TEST_DATABASE_URL"] = dsn
    os.environ["JOBS_DATABASE_URL"] = dsn
    os.environ["GUIDED_JOB_STORE_BACKEND"] = "postgres"
    os.environ["USAGE_ENFORCEMENT_ENABLED"] = "0"
    os.environ["SKIP_MODEL_LOAD"] = "1"
    os.environ.pop("USAGE_DB_PATH", None)
    try:
        import app.main as main
        from app.domains.jobs import guided_store as child_store
        from app.domains.mindmap import guided as guided_domain
        from app.domains.mindmap import store as mindmap_store

        child_store.reset_engine()
        main._auth_protect_enabled = lambda: True
        main._current_user_id = lambda: USER_ID
        main.owned_stems = lambda uid: {SOURCE}
        main._ensure_ready_sources = lambda sources: None
        main._guided_capability = lambda uid: {
            "guided_mindmap_v3": True, "reason": None, "fallback": "v2",
        }
        main._mindmap_input_and_hash = lambda sources: (
            {"chunks": [{"text": "grounded"}]}, BASE_HASH,
        )
        main._start_mindmap_job = lambda *a, **k: k.get("job_id")
        guided_domain.suggest_topics = lambda mm: []
        mindmap_store.get_by_hash = lambda *a, **k: None
        start.wait(10)
        with main.app.test_client() as child_client:
            response = _post(child_client, key)
            results.put((response.status_code, response.get_json()))
    except Exception as exc:  # pragma: no cover - surfaced by parent assertion
        results.put(("error", repr(exc)))


def test_two_process_identical_route_submissions_create_one_job_and_reservation():
    ctx = multiprocessing.get_context("spawn")
    start = ctx.Event()
    results = ctx.Queue()
    key = "concurrent-identical"
    processes = [
        ctx.Process(target=_route_worker, args=(TEST_DSN, key, start, results))
        for _ in range(2)
    ]
    for process in processes:
        process.start()
    start.set()
    responses = [results.get(timeout=30) for _ in processes]
    for process in processes:
        process.join(timeout=15)
        assert not process.is_alive(), "guided route worker leaked"
        assert process.exitcode == 0

    assert [row[0] for row in responses] == [202, 202]
    assert len({row[1]["job_id"] for row in responses}) == 1
    counts = _counts()
    assert counts["jobs"] == 1
    assert counts["reservation_rows"] == 1
    assert counts["reserved_rows"] == 1
    assert counts["reserved_tokens"] == 8_000
    assert counts["events"] == counts["used_tokens"] == 0
    job = guided_store.get_job(responses[0][1]["job_id"], user_id=USER_ID)
    assert job["usage_reservation_id"] is not None


def test_existing_cached_map_returns_zero_usage_without_reservation(guided_route, monkeypatch):
    from app.domains.mindmap import store as mindmap_store

    cached = {"id": "cached-map", "nodes": [], "content_hash": "cached"}
    monkeypatch.setattr(mindmap_store, "get_by_hash", lambda *a, **k: cached)

    response = _post(guided_route, "cache-hit")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["cached"] is True
    assert payload["usage"]["total_tokens"] == 0
    assert _counts() == {
        "reserved_rows": 0,
        "released_rows": 0,
        "reservation_rows": 0,
        "reserved_tokens": 0,
        "events": 0,
        "jobs": 0,
        "used_tokens": 0,
    }
