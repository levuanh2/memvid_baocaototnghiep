import json

import pytest

from app.domains.usage import metering


def test_reservation_commit_is_idempotent_and_tracks_actual_usage(tmp_path, monkeypatch):
    monkeypatch.setenv("USAGE_DB_PATH", str(tmp_path / "usage.sqlite"))
    first = metering.reserve("user-1", feature="chat", operation="ask", tokens=500, idempotency_key="req-1")
    event = metering.commit_reservation(first["id"], input_tokens=120, output_tokens=80, provider="test", model="mock")
    again = metering.commit_reservation(first["id"], input_tokens=120, output_tokens=80, provider="test", model="mock")
    assert event["total_tokens"] == 200
    assert again["id"] == event["id"]
    summary = metering.get_summary("user-1")
    assert summary["used"] == 200
    assert summary["reserved"] == 0


def test_reservation_is_atomic_and_returns_quota_contract(tmp_path, monkeypatch):
    monkeypatch.setenv("USAGE_DB_PATH", str(tmp_path / "usage.sqlite"))
    monkeypatch.setenv("DEFAULT_USAGE_PLAN", "free")
    with pytest.raises(metering.QuotaExceeded) as exc:
        metering.reserve(
            "user-2",
            feature="chat",
            operation="ask",
            tokens=8_001,
            idempotency_key="req-too-large",
            enforce=True,
        )
    assert exc.value.payload["code"] == "quota_exceeded"
    assert exc.value.payload["feature"] == "chat"
    assert "reset_at" in exc.value.payload


def test_release_does_not_count_reserved_tokens(tmp_path, monkeypatch):
    monkeypatch.setenv("USAGE_DB_PATH", str(tmp_path / "usage.sqlite"))
    reservation = metering.reserve("user-3", feature="mindmap", operation="generate", tokens=100, idempotency_key="req-3")
    assert metering.get_summary("user-3")["reserved"] == 100
    assert metering.release_reservation(reservation["id"])
    assert metering.get_summary("user-3")["used"] == 0
    assert metering.get_summary("user-3")["reserved"] == 0


def test_actual_usage_over_reservation_is_recorded_and_terminal(tmp_path, monkeypatch):
    monkeypatch.setenv("USAGE_DB_PATH", str(tmp_path / "usage.sqlite"))
    reservation = metering.reserve("user-overage", feature="chat", operation="ask", tokens=10, idempotency_key="overage-1")
    event = metering.commit_reservation(reservation["id"], input_tokens=15, output_tokens=5, provider="test", model="mock")
    assert event["total_tokens"] == 20
    assert event["status"] == "overage"
    assert metering.get_summary("user-overage")["used"] == 20
    assert metering.get_summary("user-overage")["reserved"] == 0


def test_multiple_provider_attempts_are_idempotent_and_finalize_once(tmp_path, monkeypatch):
    monkeypatch.setenv("USAGE_DB_PATH", str(tmp_path / "usage.sqlite"))
    reservation = metering.reserve(
        "user-retry", feature="summary", operation="generate", tokens=100,
        idempotency_key="operation-1",
    )
    first = metering.commit_reservation(
        reservation["id"], attempt_id="attempt-1", close_reservation=False,
        input_tokens=20, output_tokens=10, usage_source="provider",
    )
    duplicate = metering.commit_reservation(
        reservation["id"], attempt_id="attempt-1", close_reservation=False,
        input_tokens=999, usage_source="provider",
    )
    second = metering.commit_reservation(
        reservation["id"], attempt_id="attempt-2", close_reservation=False,
        input_tokens=15, output_tokens=5, usage_source="provider",
    )
    assert duplicate["id"] == first["id"]
    assert second["id"] != first["id"]
    assert metering.get_summary("user-retry")["used"] == 50
    assert metering.get_summary("user-retry")["reserved"] == 50
    assert metering.finalize_reservation(reservation["id"])
    assert not metering.finalize_reservation(reservation["id"])
    assert metering.get_summary("user-retry")["reserved"] == 0


def test_release_is_idempotent_and_stale_reconciliation_is_terminal(tmp_path, monkeypatch):
    monkeypatch.setenv("USAGE_DB_PATH", str(tmp_path / "usage.sqlite"))
    reservation = metering.reserve("user-stale", feature="summary", operation="generate", tokens=10, idempotency_key="stale-1", lease_seconds=1)
    assert metering.release_reservation(reservation["id"])
    assert not metering.release_reservation(reservation["id"])


def test_historical_events_do_not_count_after_period_rollover(tmp_path, monkeypatch):
    monkeypatch.setenv("USAGE_DB_PATH", str(tmp_path / "usage.sqlite"))
    reservation = metering.reserve("user-rollover", feature="chat", operation="ask", tokens=10, idempotency_key="period-1")
    metering.commit_reservation(reservation["id"], input_tokens=10, provider="test", model="mock")
    with metering._sqlite_conn() as conn:
        for table in ("usage_entitlements", "usage_reservations", "usage_events"):
            conn.execute(
                f"UPDATE {table} SET period_start='1999-12-01T00:00:00+00:00', "
                "period_end='2000-01-01T00:00:00+00:00' WHERE user_id=?",
                ("user-rollover",),
            )
        conn.execute(
            "UPDATE usage_entitlements SET reset_at='2000-01-01T00:00:00+00:00' "
            "WHERE user_id=?",
            ("user-rollover",),
        )
        conn.commit()
    current = metering.get_summary("user-rollover")
    assert current["used"] == 0
    assert metering.list_events("user-rollover")[0]["total_tokens"] == 10


@pytest.mark.parametrize(("plan", "per_request"), [("free", 8_000), ("plus", 32_000), ("pro", 64_000)])
def test_entitlement_is_single_source_for_per_request_limit(tmp_path, monkeypatch, plan, per_request):
    monkeypatch.setenv("USAGE_DB_PATH", str(tmp_path / f"{plan}.sqlite"))
    monkeypatch.setenv("DEFAULT_USAGE_PLAN", plan)
    assert metering.get_summary(f"user-{plan}")["per_request_token_limit"] == per_request


def test_provider_normalization_preserves_official_totals_and_embedding_kind():
    assert metering.normalize_provider_usage({
        "prompt_tokens": "12", "completion_tokens": 7,
        "cached_input_tokens": 3, "total_tokens": 19,
    }) == {
        "input_tokens": 12, "output_tokens": 7, "cached_input_tokens": 3,
        "embedding_tokens": 0, "total_tokens": 19,
    }
    assert metering.normalize_provider_usage(
        {"prompt_tokens": 11, "total_tokens": 11}, kind="embedding",
    ) == {
        "input_tokens": 0, "output_tokens": 0, "cached_input_tokens": 0,
        "embedding_tokens": 11, "total_tokens": 11,
    }


def test_usage_metadata_never_persists_prompt_or_document_content(tmp_path, monkeypatch):
    monkeypatch.setenv("USAGE_DB_PATH", str(tmp_path / "usage-metadata.sqlite"))
    reservation = metering.reserve(
        "safe-metadata", feature="chat", operation="ask", tokens=10,
        idempotency_key="safe-1",
    )
    event = metering.commit_reservation(
        reservation["id"], input_tokens=1, close_reservation=False,
        metadata={
            "prompt": "secret question", "document": "private document",
            "provider_request_id": "provider-123", "stage": "answer",
        },
    )
    metadata = json.loads(event["metadata_json"])
    assert metadata == {"provider_request_id": "provider-123", "stage": "answer"}
