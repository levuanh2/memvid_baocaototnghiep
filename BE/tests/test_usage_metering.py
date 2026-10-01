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
        metering.reserve("user-2", feature="chat", operation="ask", tokens=8_001, idempotency_key="req-too-large")
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
