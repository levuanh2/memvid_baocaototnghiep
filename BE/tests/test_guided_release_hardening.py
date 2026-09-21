import json
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _store(monkeypatch, tmp_path):
    monkeypatch.setenv("JOBS_DB_PATH", str(tmp_path / "jobs.sqlite"))
    from app.domains.jobs import jobs_store
    jobs_store.init_db()
    return jobs_store


def test_guided_idempotency_same_payload_is_durable_and_conflict_is_explicit(monkeypatch, tmp_path):
    store = _store(monkeypatch, tmp_path)
    outcome, first = store.create_idempotent_job(
        "j-1", user_id="u-1", idempotency_key="key-1", request_fingerprint="fp-a",
        source_ids_json=json.dumps(["s-1"]), guided_config_json=json.dumps({"preset": "overview"}),
    )
    assert outcome == "created"
    same, existing = store.create_idempotent_job("j-2", user_id="u-1", idempotency_key="key-1", request_fingerprint="fp-a")
    assert same == "existing" and existing["job_id"] == first["job_id"]
    conflict, row = store.create_idempotent_job("j-3", user_id="u-1", idempotency_key="key-1", request_fingerprint="fp-b")
    assert conflict == "conflict" and row["job_id"] == first["job_id"]
    assert store.get_by_idempotency("u-2", "key-1") is None


def test_concurrent_same_key_creates_one_job(monkeypatch, tmp_path):
    store = _store(monkeypatch, tmp_path)
    results = []

    def create(index):
        results.append(store.create_idempotent_job(f"j-{index}", user_id="u-1", idempotency_key="same", request_fingerprint="fp")[0])

    threads = [threading.Thread(target=create, args=(i,)) for i in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(results) == ["created", "existing"]


def test_claim_and_expired_lease_recovery(monkeypatch, tmp_path):
    store = _store(monkeypatch, tmp_path)
    store.create_job("j-lease", "mindmap", status="pending", user_id="u-1")
    assert store.claim_job("j-lease", "worker-a", lease_seconds=900)
    assert not store.claim_job("j-lease", "worker-b", lease_seconds=900)
    old = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    store.update_job("j-lease", lease_expires_at=old)
    assert store.recover_expired_jobs() == 1
    assert store.get_job("j-lease")["status"] == "pending"
    assert store.claim_job("j-lease", "worker-b", lease_seconds=900)


def test_guided_job_metadata_survives_store_reload(monkeypatch, tmp_path):
    store = _store(monkeypatch, tmp_path)
    store.create_job("j-reload", "mindmap", user_id="u-1", source_ids_json='["s-1"]', guided_config_json='{"detail_level":"detailed"}', stage="queued")
    row = store.get_job("j-reload")
    assert row["source_ids"] == ["s-1"]
    assert row["guided_config"]["detail_level"] == "detailed"
    assert row["stage"] == "queued"


def test_rollout_flag_global_off_allows_only_qa_user(monkeypatch):
    from app import main
    monkeypatch.setenv("AUTH_PROTECT_APP_APIS", "true")
    monkeypatch.setenv("GUIDED_MINDMAP_V3_ENABLED", "false")
    monkeypatch.setenv("GUIDED_MINDMAP_V3_QA_USER_IDS", "qa-1, qa-2")
    assert main._guided_v3_enabled("qa-1") is True
    assert main._guided_v3_enabled("ordinary") is False
    assert main._guided_v3_enabled(None) is False


def test_rollout_flag_global_on_and_open_dev_compatibility(monkeypatch):
    from app import main
    monkeypatch.setenv("AUTH_PROTECT_APP_APIS", "true")
    monkeypatch.setenv("GUIDED_MINDMAP_V3_ENABLED", "true")
    monkeypatch.delenv("GUIDED_MINDMAP_V3_QA_USER_IDS", raising=False)
    assert main._guided_v3_enabled("ordinary") is True
    assert main._guided_v3_enabled(None) is False
    monkeypatch.setenv("AUTH_PROTECT_APP_APIS", "false")
    assert main._guided_v3_enabled(None) is True


def test_tracked_production_cors_is_exact_studymap_origin():
    render = (Path(__file__).parents[2] / "render.yaml").read_text(encoding="utf-8")
    assert "value: https://studymap.space" in render
    assert "value: *" not in render
    assert "value: http://localhost" not in render
