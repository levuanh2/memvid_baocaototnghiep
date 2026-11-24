"""V9.3 security, independent review of #209 (P1/P2): stale per-process ownership caches
and racing same-name uploads, on the real local test database.

P1: `all_rows()` / `stem_owners()` cache per process for a few seconds and `invalidate_cache()`
only clears the calling process. A worker whose snapshot predates another worker's create must
not authorize a stem that has become shared.

P2: upload naming read the owner view, then created the row later with no reservation; two
owners uploading the same name at once could both get one stem (and both be locked out), and an
unreadable owner view let the upload go ahead blind.
"""
from __future__ import annotations

import io
import threading
import time
import uuid

import pytest


def _protect(main, monkeypatch, uid, on=True):
    monkeypatch.setattr(main, "_auth_protect_enabled", lambda: on)
    monkeypatch.setattr(main, "_current_user_id", lambda: uid)


@pytest.fixture()
def be(client):
    import app.main as main
    return main


@pytest.fixture()
def two_users():
    from app.db.models import User
    from app.domains.auth import users_store
    from tests._owner_db import owner_session_scope
    a = users_store.create_user(f"cw_a_{uuid.uuid4().hex[:8]}@example.com", "password123")["user_id"]
    b = users_store.create_user(f"cw_b_{uuid.uuid4().hex[:8]}@example.com", "password123")["user_id"]
    yield a, b
    with owner_session_scope() as s:
        for uid in (a, b):
            row = s.get(User, uid)
            if row is not None:
                s.delete(row)
    from app.domains.documents import repository as repo
    repo.invalidate_cache()


def _create(repo, name, uid):
    did = str(uuid.uuid4())
    repo.create(document_id=did, filename=name, file_type="pdf", file_path=f"/tmp/{did}", user_id=uid)
    return did


# ---- P1: another worker's stale snapshot ------------------------------------

def test_protected_ownership_ignores_a_stale_cached_snapshot(be, can_db_test, two_users, monkeypatch):
    from app.domains.documents import repository as repo
    a, b = two_users
    name = f"chung_{uuid.uuid4().hex[:6]}.pdf"
    stem = repo.canonical_source_stem(name)
    _create(repo, name, a)
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: True)
    assert be._source_owner_ok(stem, a) is True

    # This worker's snapshot, taken while only A carried the stem.
    stale_rows, stale_map = repo.all_rows(use_cache=False), repo.stem_owners(use_cache=False)
    # Another worker creates B's document on the same stem; only that worker's cache is cleared.
    _create(repo, name, b)
    with repo._cache_lock:
        repo._cache.update(rows=stale_rows, t=time.time())
        repo._stem_cache.update(map=stale_map, t=time.time())

    assert be._source_owner_ok(stem, a) is False, "authorized from a stale per-process snapshot"
    assert stem not in be.owned_stems(a)


# ---- P2: blind or racing upload naming ---------------------------------------

def test_upload_naming_fails_closed_when_the_owner_view_is_unreadable(be, monkeypatch):
    monkeypatch.setattr(be, "_all_document_stem_owners", lambda *a, **k: None)
    with pytest.raises(be.StemOwnershipUnavailable):
        be._unique_display_filename("slide.pdf", {})


def test_upload_route_answers_503_and_creates_nothing_when_ownership_is_unknown(be, client, monkeypatch):
    from app.domains.documents import repository as repo
    monkeypatch.setattr(be, "_all_document_stem_owners", lambda *a, **k: None)
    before = len(repo.all_rows(use_cache=False))
    r = client.post("/upload-file", data={"file": (io.BytesIO(b"noi dung"), "ten_moi.txt")},
                    content_type="multipart/form-data")
    assert r.status_code == 503
    assert r.get_json()["error"] == "ownership_unavailable"
    assert len(repo.all_rows(use_cache=False)) == before


def test_concurrent_same_name_uploads_from_two_owners_get_distinct_stems(be, can_db_test, two_users, monkeypatch):
    """Both uploads read the owner view before either creates its row (the view is slowed
    down to force that interleaving). Without a reservation both pick the same name."""
    from app.domains.documents import repository as repo
    a, b = two_users
    name = f"dong_thoi_{uuid.uuid4().hex[:6]}.pdf"
    real = be._all_document_stem_owners

    def slow_view(*a, **k):
        view = real(*a, **k)
        time.sleep(0.4)
        return view

    monkeypatch.setattr(be, "_all_document_stem_owners", slow_view)
    chosen, errors = {}, []

    def upload(uid):
        releases = []
        try:
            fn = be._choose_and_lock_display_filename(name, releases)
            _create(repo, fn, uid)
            chosen[uid] = fn
        except Exception as exc:  # pragma: no cover - surfaced below
            errors.append(exc)
        finally:
            for release in reversed(releases):
                release()

    threads = [threading.Thread(target=upload, args=(uid,)) for uid in (a, b)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert not errors, errors
    assert repo.canonical_source_stem(chosen[a]) != repo.canonical_source_stem(chosen[b])


def test_stem_lock_is_exclusive_across_connections(can_db_test):
    from app.domains.documents import repository as repo
    stem = f"khoa_{uuid.uuid4().hex[:6]}"
    release = repo.acquire_stem_lock(stem)
    try:
        with pytest.raises(repo.StemLockTimeout):
            repo.acquire_stem_lock(stem, timeout_s=0.5)
    finally:
        release()
    repo.acquire_stem_lock(stem, timeout_s=0.5)()  # free again


# ---- delete paths hold the stem lock while they re-check and purge ----------

def test_delete_routes_purge_only_while_holding_the_stem_lock(be, client, monkeypatch):
    import json as _json
    from app.domains.documents import repository as repo
    held = []
    monkeypatch.setattr(repo, "acquire_stem_lock", lambda stem, **kw: (held.append(stem), lambda: None)[1])
    docs = {"idA": {"source_stem": "rieng_a", "filename": "rieng_a.pdf", "user_id": "A"}}
    monkeypatch.setattr(be, "_load_source_registry", lambda: docs)
    monkeypatch.setattr(be, "_all_document_stem_owners", lambda *a, **k: {"rieng_a": {"A"}})
    be.INDEX_META_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    be.INDEX_META_JSON_PATH.write_text(_json.dumps({"0": {"source_stem": "rieng_a", "text": "a"}}), encoding="utf-8")
    _protect(be, monkeypatch, "A")
    client.post("/delete-source", json={"video": "rieng_a"})
    assert "rieng_a" in held


# ---- the lock covers naming and the row, never the slow storage upload -------

def test_storage_upload_runs_after_the_stem_lock_is_released(be, can_db_test, monkeypatch):
    """Side review of #209: holding the stem lock through the object-storage upload made a
    second same-name upload wait (and time out with 503) behind a large file."""
    from werkzeug.datastructures import FileStorage
    from app.domains.documents import repository as repo
    from app.domains.documents import storage
    held = {"n": 0}
    seen_during_upload = []

    def fake_lock(stem, **kw):
        held["n"] += 1
        def release():
            held["n"] -= 1
        return release

    monkeypatch.setattr(repo, "acquire_stem_lock", fake_lock)
    monkeypatch.setattr(storage, "is_configured", lambda: True)
    monkeypatch.setattr(storage, "ensure_bucket", lambda: None)
    monkeypatch.setattr(storage, "upload", lambda obj, data: seen_during_upload.append(held["n"]))
    monkeypatch.setattr(be, "_trigger_background_ingest", lambda *a, **k: None)
    sid = str(uuid.uuid4())
    f = FileStorage(stream=io.BytesIO(b"noi dung"), filename=f"lon_{uuid.uuid4().hex[:6]}.txt")
    info = be._ingest_uploaded_file_reserved(f, source_id=sid, uid=None, usage_context=None)
    try:
        assert seen_during_upload == [0], "storage upload ran while a stem lock was held"
        assert repo.get(sid)["file_path"] == storage.object_path("anonymous", sid, info["filename"])
    finally:
        repo.hard_delete(sid)


def test_durable_storage_failure_leaves_no_document_row(be, can_db_test, monkeypatch):
    from werkzeug.datastructures import FileStorage
    from app.domains.documents import repository as repo
    from app.domains.documents import storage, provenance
    monkeypatch.setattr(storage, "is_configured", lambda: True)
    monkeypatch.setattr(storage, "ensure_bucket", lambda: None)
    def boom(obj, data):
        raise RuntimeError("storage down")
    monkeypatch.setattr(storage, "upload", boom)
    monkeypatch.setattr(provenance, "la_production", lambda *_: True)
    sid = str(uuid.uuid4())
    f = FileStorage(stream=io.BytesIO(b"noi dung"), filename=f"ben_{uuid.uuid4().hex[:6]}.txt")
    with pytest.raises(be.DurableStorageRequired):
        be._ingest_uploaded_file_reserved(f, source_id=sid, uid=None, usage_context=None)
    assert repo.get(sid) is None
