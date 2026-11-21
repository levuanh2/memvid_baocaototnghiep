"""The archive contract marker and the behaviour it promises (issue #18, Codex task50).

`scripts/rollback.sh` treats a target tree as archive-aware only if it carries
`BE/shared/archive_contract.py` with `ARCHIVE_CONTRACT_VERSION = 1`. These tests run on
every SHA that carries it, so the marker cannot outlive the behaviour on a CI-green SHA.
"""
from __future__ import annotations

from pathlib import Path

from tests.test_review_plan_archive import (  # noqa: F401  (fixtures)
    GUIDE_2, _fake_guide, _need_db, _plan, _protect, be, owner, planned)


def test_the_marker_line_is_exactly_what_rollback_sh_reads():
    text = (Path(__file__).resolve().parents[1] / "shared" / "archive_contract.py").read_text(
        encoding="utf-8")
    assert "ARCHIVE_CONTRACT_VERSION = 1" in text.splitlines()


def test_regeneration_locks_the_plan_archives_and_never_deletes_it(client, planned,
                                                                   monkeypatch):
    """The SQL the real regeneration sends: the plan row is locked before its topics are
    archived, and no plan or topic is deleted."""
    from sqlalchemy import event

    from app.db import get_engine

    sent = []
    engine = get_engine()

    def _record(conn, cursor, statement, *a):
        sent.append(" ".join(statement.split()).upper())

    event.listen(engine, "before_cursor_execute", _record)
    try:
        _fake_guide(monkeypatch, GUIDE_2)
        _plan(client, planned["attempt_id"], force=True)
    finally:
        event.remove(engine, "before_cursor_execute", _record)
    lock = next(i for i, s in enumerate(sent)
                if s.startswith("SELECT") and "FROM REVIEW_PLANS" in s and "FOR UPDATE" in s)
    archive = next(i for i, s in enumerate(sent)
                   if s.startswith("UPDATE REVIEW_PLAN_ITEMS SET ARCHIVED_AT"))
    assert lock < archive, "the plan row must be locked before archiving"
    assert not any(s.startswith("DELETE FROM REVIEW_PLAN") for s in sent)
