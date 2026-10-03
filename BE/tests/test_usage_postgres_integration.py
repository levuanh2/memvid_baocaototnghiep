"""PostgreSQL-only integration and multi-process proofs for usage metering."""
from __future__ import annotations

import multiprocessing
import os
import time
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from app.domains.usage import metering


TEST_DSN = (os.getenv("TEST_DATABASE_URL") or "").strip()
pytestmark = pytest.mark.skipif(
    not TEST_DSN.startswith(("postgres://", "postgresql://")),
    reason="TEST_DATABASE_URL must point to a disposable PostgreSQL database",
)


def _reserve_worker(
    user_id: str,
    key: str,
    tokens: int,
    start: multiprocessing.synchronize.Event,
    results: multiprocessing.queues.Queue,
) -> None:
    os.environ.pop("USAGE_DB_PATH", None)
    start.wait(10)
    try:
        row = metering.reserve(
            user_id,
            feature="chat",
            operation="ask",
            tokens=tokens,
            idempotency_key=key,
            enforce=True,
        )
        results.put(("ok", row["id"]))
    except metering.QuotaExceeded:
        results.put(("quota", None))
    except Exception as exc:  # pragma: no cover - surfaced in parent assertion
        results.put(("error", repr(exc)))


def _commit_worker(
    reservation_id: str,
    start: multiprocessing.synchronize.Event,
    results: multiprocessing.queues.Queue,
) -> None:
    os.environ.pop("USAGE_DB_PATH", None)
    start.wait(10)
    try:
        event = metering.commit_reservation(
            reservation_id,
            input_tokens=40,
            output_tokens=10,
            total_tokens=50,
            provider="integration",
            model="mock",
            usage_source="provider",
        )
        results.put(("ok", event["id"]))
    except Exception as exc:  # pragma: no cover - surfaced in parent assertion
        results.put(("error", repr(exc)))


def _claim_and_commit_worker(
    reservation_id: str,
    wait_seconds: float,
    results: multiprocessing.queues.Queue,
) -> None:
    os.environ.pop("USAGE_DB_PATH", None)
    time.sleep(wait_seconds)
    claimed = metering.claim_reservation(
        reservation_id, lease_owner="worker-after-restart", lease_seconds=30,
    )
    if not claimed:
        results.put(("not_claimed", None))
        return
    event = metering.commit_reservation(
        reservation_id,
        input_tokens=7,
        output_tokens=3,
        provider="integration",
        model="mock",
        usage_source="provider",
    )
    results.put(("committed", event["id"]))


@pytest.fixture(autouse=True)
def _clean_usage_tables(monkeypatch):
    monkeypatch.delenv("USAGE_DB_PATH", raising=False)
    from app import db

    db.reset_engine()
    with db.session_scope() as session:
        session.execute(text(
            "TRUNCATE usage_events, usage_reservations, usage_entitlements CASCADE"
        ))
    yield
    db.reset_engine()


def _run_pair(target, args_a: tuple, args_b: tuple) -> list[tuple[str, str | None]]:
    ctx = multiprocessing.get_context("spawn")
    start = ctx.Event()
    results = ctx.Queue()
    processes = [
        ctx.Process(target=target, args=(*args_a, start, results)),
        ctx.Process(target=target, args=(*args_b, start, results)),
    ]
    for process in processes:
        process.start()
    start.set()
    rows = [results.get(timeout=20) for _ in processes]
    for process in processes:
        process.join(timeout=10)
        assert not process.is_alive(), "usage worker process leaked"
        assert process.exitcode == 0
    return rows


def test_postgres_entitlements_reserve_commit_release_and_overage():
    assert metering.get_summary("free-user")["per_request_token_limit"] == 8_000
    assert metering.upsert_entitlement("plus-user", "plus")["per_request_token_limit"] == 32_000
    assert metering.upsert_entitlement("pro-user", "pro")["per_request_token_limit"] == 64_000

    committed = metering.reserve(
        "free-user", feature="chat", operation="ask", tokens=20,
        idempotency_key="commit",
    )
    event = metering.commit_reservation(
        committed["id"], input_tokens=20, output_tokens=5, total_tokens=25,
        provider="integration", model="mock", usage_source="provider",
    )
    assert event["status"] == "overage"
    assert metering.get_summary("free-user")["used"] == 25

    released = metering.reserve(
        "free-user", feature="summary", operation="generate", tokens=10,
        idempotency_key="release",
    )
    assert metering.release_reservation(released["id"])
    assert not metering.release_reservation(released["id"])
    assert metering.get_summary("free-user")["reserved"] == 0


def test_two_processes_cannot_over_reserve_monthly_limit():
    metering.upsert_entitlement("race-limit", "free")
    with metering._pg() as session:
        session.execute(text(
            "UPDATE usage_entitlements SET monthly_token_limit=100, "
            "per_request_token_limit=100 WHERE user_id='race-limit'"
        ))
    rows = _run_pair(
        _reserve_worker,
        ("race-limit", "attempt-a", 100),
        ("race-limit", "attempt-b", 100),
    )
    assert sorted(row[0] for row in rows) == ["ok", "quota"]
    summary = metering.get_summary("race-limit")
    assert summary["reserved"] == 100
    assert summary["used"] == 0


def test_two_processes_same_idempotency_key_get_one_reservation():
    rows = _run_pair(
        _reserve_worker,
        ("race-idempotency", "same-attempt", 10),
        ("race-idempotency", "same-attempt", 10),
    )
    assert [row[0] for row in rows] == ["ok", "ok"]
    assert rows[0][1] == rows[1][1]
    with metering._pg() as session:
        count = session.execute(text(
            "SELECT count(*) FROM usage_reservations WHERE user_id='race-idempotency'"
        )).scalar_one()
    assert count == 1


def test_two_processes_commit_once_without_double_counting():
    reservation = metering.reserve(
        "race-commit", feature="chat", operation="ask", tokens=50,
        idempotency_key="one-event",
    )
    rows = _run_pair(
        _commit_worker,
        (reservation["id"],),
        (reservation["id"],),
    )
    assert [row[0] for row in rows] == ["ok", "ok"]
    assert rows[0][1] == rows[1][1]
    assert metering.get_summary("race-commit")["used"] == 50


def test_process_restart_respects_lease_then_finishes_from_postgres():
    reservation = metering.reserve(
        "restart-user", feature="summary", operation="generate", tokens=10,
        idempotency_key="restart-attempt", lease_seconds=1,
        lease_owner="worker-before-restart",
    )
    assert not metering.claim_reservation(
        reservation["id"], lease_owner="worker-too-early", lease_seconds=30,
    )

    ctx = multiprocessing.get_context("spawn")
    results = ctx.Queue()
    process = ctx.Process(
        target=_claim_and_commit_worker,
        args=(reservation["id"], 1.2, results),
    )
    process.start()
    outcome = results.get(timeout=20)
    process.join(timeout=10)
    assert not process.is_alive() and process.exitcode == 0
    assert outcome[0] == "committed"
    assert metering.get_summary("restart-user")["used"] == 10
    assert metering.reconcile_stale_reservations() == 0


def test_expiry_reconciliation_is_terminal_and_deterministic():
    reservation = metering.reserve(
        "expired-user", feature="mindmap", operation="generate", tokens=12,
        idempotency_key="expires", lease_seconds=1, lease_owner="dead-worker",
    )
    time.sleep(1.1)
    assert metering.reconcile_stale_reservations() == 1
    assert metering.reconcile_stale_reservations() == 0
    row = metering.get_reservation(reservation["id"])
    assert row["status"] == "expired"
    assert row["expired_at"] is not None and row["terminal_at"] is not None
    assert row["released_at"] is None
    assert metering.get_summary("expired-user")["reserved"] == 0


def test_monthly_rollover_keeps_history_but_excludes_it_from_current_quota():
    reservation = metering.reserve(
        "rollover-user", feature="chat", operation="ask", tokens=15,
        idempotency_key="old-period",
    )
    metering.commit_reservation(
        reservation["id"], input_tokens=10, output_tokens=5,
        provider="integration", model="mock", usage_source="provider",
    )
    with metering._pg() as session:
        old_start = datetime(2023, 12, 1, tzinfo=timezone.utc)
        old_end = datetime(2024, 1, 1, tzinfo=timezone.utc)
        for table in ("usage_events", "usage_reservations"):
            session.execute(
                text(f"UPDATE {table} SET period_start=:start, period_end=:end "
                     "WHERE user_id='rollover-user'"),
                {"start": old_start, "end": old_end},
            )
        session.execute(text(
            "UPDATE usage_entitlements SET period_start=:start, period_end=:end, "
            "reset_at=:end WHERE user_id='rollover-user'"
        ), {"start": old_start, "end": old_end})
    assert metering.get_summary("rollover-user")["used"] == 0
    assert metering.list_events("rollover-user")[0]["total_tokens"] == 15


@pytest.mark.parametrize(
    ("instant", "start", "end"),
    [
        (datetime(2024, 2, 29, 12, tzinfo=timezone.utc), (2024, 2, 1), (2024, 3, 1)),
        (datetime(2024, 12, 31, 23, tzinfo=timezone.utc), (2024, 12, 1), (2025, 1, 1)),
    ],
)
def test_utc_period_boundaries_cover_leap_year_and_year_rollover(instant, start, end):
    actual_start, actual_end = metering._period(instant)
    assert (actual_start.year, actual_start.month, actual_start.day) == start
    assert (actual_end.year, actual_end.month, actual_end.day) == end


def test_recent_events_are_owned_and_bounded():
    for index in range(3):
        reservation = metering.reserve(
            "owner-a", feature="chat", operation="ask", tokens=1,
            idempotency_key=f"event-{index}",
        )
        metering.commit_reservation(
            reservation["id"], input_tokens=1, usage_source="provider",
        )
    other = metering.reserve(
        "owner-b", feature="chat", operation="ask", tokens=1,
        idempotency_key="private-event",
    )
    private_event = metering.commit_reservation(
        other["id"], input_tokens=1, usage_source="provider",
    )
    events = metering.list_events("owner-a", limit=2)
    assert len(events) == 2
    assert private_event["id"] not in {event["id"] for event in events}
    assert all("user_id" not in event for event in events)


def test_malformed_reserve_rolls_back_without_partial_rows():
    with pytest.raises((TypeError, ValueError)):
        metering.reserve(
            "rollback-user", feature="chat", operation="ask", tokens="not-a-number",
            idempotency_key="malformed",
        )
    with metering._pg() as session:
        reservations = session.execute(text(
            "SELECT count(*) FROM usage_reservations WHERE user_id='rollback-user'"
        )).scalar_one()
        entitlements = session.execute(text(
            "SELECT count(*) FROM usage_entitlements WHERE user_id='rollback-user'"
        )).scalar_one()
    assert reservations == 0
    assert entitlements == 0
