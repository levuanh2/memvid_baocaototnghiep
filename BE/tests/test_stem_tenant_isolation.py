"""V9.3 security — cross-tenant reads when two owners share a canonical `source_stem`.

Every stem-scoped path (list-indexed, chunk-text, query/RAG source resolution, summary and
mind-map source gates, delete-source) authorized through `owned_stems` /
`_source_owner_ok`, which treated a stem as an identity. With two documents of different
owners on one stem, `/list-indexed` returned both owners' chunk text to each of them and
`/chunk-text` allowed whichever owner the registry listed first.

Rule under test (protected mode): a stem is usable by U only when every document that
carries it (including soft-deleted ones, whose chunks stay in the index) belongs to U.
Anything else is refused. `/chunk-text` additionally trusts the chunk's own document
(`document_chunks.embedding_id` -> `documents.user_id`) when that row exists.
"""
from __future__ import annotations

import json
import uuid

import pytest


def _protect(main, monkeypatch, uid, on=True):
    monkeypatch.setattr(main, "_auth_protect_enabled", lambda: on)
    monkeypatch.setattr(main, "_current_user_id", lambda: uid)


@pytest.fixture()
def be(client):
    import app.main as main
    return main


def _registry(be, monkeypatch, rows):
    docs = {sid: {"filename": row["source_stem"] + ".pdf", **row} for sid, row in rows.items()}
    monkeypatch.setattr(be, "_load_source_registry", lambda: docs)


def _all_docs(be, monkeypatch, owners_by_stem):
    """Owners of every document row per stem, soft-deleted included (DB view)."""
    monkeypatch.setattr(be, "_all_document_stem_owners",
                        lambda: {k: set(v) for k, v in owners_by_stem.items()}, raising=False)


def _index(be, entries):
    meta = {str(i): {"source_stem": stem, "text": text} for i, (stem, text) in enumerate(entries)}
    be.INDEX_META_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    be.INDEX_META_JSON_PATH.write_text(json.dumps(meta), encoding="utf-8")


# ---- 1. two live owners on one stem -----------------------------------------

def test_shared_stem_is_owned_by_nobody(be, monkeypatch):
    _registry(be, monkeypatch, {
        "idA": {"source_stem": "slide", "user_id": "A"},
        "idB": {"source_stem": "slide", "user_id": "B"},
        "idA2": {"source_stem": "ghi_chu", "user_id": "A"},
    })
    _all_docs(be, monkeypatch, {})
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: True)
    assert be.owned_stems("A") == {"ghi_chu"}
    assert be.owned_stems("B") == set()
    assert be._source_owner_ok("slide", "A") is False
    assert be._source_owner_ok("slide", "B") is False
    # By document id too: the caller would go on to act on the shared stem.
    assert be._source_owner_ok("idA", "A") is False
    # A's own unambiguous document keeps working.
    assert be._source_owner_ok("ghi_chu", "A") is True
    assert be._source_owner_ok("idA2", "A") is True


# ---- 2/3. ownerless legacy row, soft-deleted foreign document ---------------

def test_ownerless_or_deleted_foreign_document_on_the_stem_refuses(be, monkeypatch):
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: True)
    # Legacy row without an owner shares A's stem: owner cannot be verified -> refuse.
    _registry(be, monkeypatch, {
        "idA": {"source_stem": "slide", "user_id": "A"},
        "idL": {"source_stem": "slide"},
    })
    _all_docs(be, monkeypatch, {})
    assert be._source_owner_ok("slide", "A") is False
    assert "slide" not in be.owned_stems("A")

    # B's soft-deleted document is no longer in the registry, but its chunks stay in the
    # index under the same stem.
    _registry(be, monkeypatch, {"idA": {"source_stem": "slide", "user_id": "A"}})
    _all_docs(be, monkeypatch, {"slide": {"A", "B"}})
    assert be._source_owner_ok("slide", "A") is False
    assert "slide" not in be.owned_stems("A")


# ---- 4. query/RAG, summary and mind-map source gates ------------------------

def test_query_and_generation_gates_refuse_a_shared_stem(be, monkeypatch):
    _registry(be, monkeypatch, {
        "idA": {"source_stem": "slide", "user_id": "A"},
        "idB": {"source_stem": "slide", "user_id": "B"},
        "idA2": {"source_stem": "ghi_chu", "user_id": "A"},
    })
    _all_docs(be, monkeypatch, {})
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: True)
    with be.app.app_context():
        resolved, err = be._resolve_owned_query_sources(["slide"], "A")
        assert resolved is None and err[1] == 403
        resolved, err = be._resolve_owned_query_sources([], "A")
        assert err is None and resolved == ["ghi_chu"]
        assert be._ensure_owned_sources(["slide"], "A")[1] == 403
        assert be._ensure_owned_sources(["ghi_chu"], "A") is None


# ---- 5. /list-indexed never mixes another owner's text ----------------------

def test_list_indexed_does_not_return_the_other_owners_text(be, client, monkeypatch):
    _registry(be, monkeypatch, {
        "idA": {"source_stem": "slide", "user_id": "A"},
        "idB": {"source_stem": "slide", "user_id": "B"},
        "idA2": {"source_stem": "ghi_chu", "user_id": "A"},
    })
    _all_docs(be, monkeypatch, {})
    _index(be, [("slide", "A-noi-dung-rieng"), ("slide", "B-bi-mat"), ("ghi_chu", "A-ghi-chu")])
    _protect(be, monkeypatch, "A")
    body = client.get("/list-indexed").get_json()
    raw = json.dumps(body, ensure_ascii=False)
    assert "B-bi-mat" not in raw
    assert {s["video_stem"] for s in body["sources"]} == {"ghi_chu"}
    _protect(be, monkeypatch, "B")
    raw = json.dumps(client.get("/list-indexed").get_json(), ensure_ascii=False)
    assert "A-noi-dung-rieng" not in raw and "A-ghi-chu" not in raw


# ---- 6. /chunk-text --------------------------------------------------------

def test_chunk_text_refuses_a_shared_stem_without_chunk_evidence(be, client, monkeypatch):
    from app.domains.vectorstore import chunk_text_store
    _registry(be, monkeypatch, {
        "idA": {"source_stem": "slide", "user_id": "A"},
        "idB": {"source_stem": "slide", "user_id": "B"},
    })
    _all_docs(be, monkeypatch, {})
    _index(be, [("slide", "A"), ("slide", "B")])
    monkeypatch.setattr(chunk_text_store, "get_text", lambda cid: f"text-{cid}")
    monkeypatch.setattr(be, "_chunk_db_owner", lambda cid: (False, None), raising=False)
    _protect(be, monkeypatch, "A")
    # Registry order no longer decides: neither chunk is served on an ambiguous stem.
    assert client.get("/chunk-text/1").status_code == 404
    assert client.get("/chunk-text/0").status_code == 404


def test_chunk_text_trusts_the_chunks_own_document(be, client, monkeypatch):
    from app.domains.vectorstore import chunk_text_store
    _registry(be, monkeypatch, {
        "idA": {"source_stem": "slide", "user_id": "A"},
        "idB": {"source_stem": "slide", "user_id": "B"},
    })
    _all_docs(be, monkeypatch, {})
    _index(be, [("slide", "A"), ("slide", "B")])
    monkeypatch.setattr(chunk_text_store, "get_text", lambda cid: f"text-{cid}")
    owners = {0: "A", 1: "B"}
    monkeypatch.setattr(be, "_chunk_db_owner", lambda cid: (True, owners.get(int(cid))), raising=False)
    _protect(be, monkeypatch, "A")
    assert client.get("/chunk-text/0").get_json()["text"] == "text-0"
    assert client.get("/chunk-text/1").status_code == 404
    _protect(be, monkeypatch, "B")
    assert client.get("/chunk-text/1").get_json()["text"] == "text-1"
    assert client.get("/chunk-text/0").status_code == 404


def test_chunk_text_db_owner_beats_an_exclusive_looking_stem(be, client, monkeypatch):
    """The registry shows only A on the stem (B's document was hard-deleted from it), but the
    chunk row still names B's document: the chunk's own evidence wins."""
    from app.domains.vectorstore import chunk_text_store
    _registry(be, monkeypatch, {"idA": {"source_stem": "slide", "user_id": "A"}})
    _all_docs(be, monkeypatch, {"slide": {"A"}})
    _index(be, [("slide", "A"), ("slide", "B")])
    monkeypatch.setattr(chunk_text_store, "get_text", lambda cid: f"text-{cid}")
    monkeypatch.setattr(be, "_chunk_db_owner", lambda cid: (True, "B") if int(cid) == 1 else (False, None), raising=False)
    _protect(be, monkeypatch, "A")
    assert client.get("/chunk-text/1").status_code == 404
    assert client.get("/chunk-text/0").get_json()["text"] == "text-0"  # no DB row: exclusive stem


# ---- 7. delete-source cannot reach the other owner's chunks -----------------

def test_delete_source_refuses_a_shared_stem(be, client, monkeypatch):
    _registry(be, monkeypatch, {
        "idA": {"source_stem": "slide", "user_id": "A"},
        "idB": {"source_stem": "slide", "user_id": "B"},
    })
    _all_docs(be, monkeypatch, {})
    _index(be, [("slide", "A"), ("slide", "B")])
    before = be.INDEX_META_JSON_PATH.read_text(encoding="utf-8")
    _protect(be, monkeypatch, "A")
    assert client.post("/delete-source", json={"video": "slide"}).status_code == 404
    assert be.INDEX_META_JSON_PATH.read_text(encoding="utf-8") == before


# ---- 8. open mode and valid isolated access unchanged -----------------------

def test_unambiguous_owners_and_open_mode_unchanged(be, client, monkeypatch):
    _registry(be, monkeypatch, {
        "idA": {"source_stem": "doc_a", "user_id": "A"},
        "idB": {"source_stem": "doc_b", "user_id": "B"},
    })
    _all_docs(be, monkeypatch, {"doc_a": {"A"}, "doc_b": {"B"}})
    _index(be, [("doc_a", "a"), ("doc_b", "b")])
    _protect(be, monkeypatch, "A")
    assert {s["video_stem"] for s in client.get("/list-indexed").get_json()["sources"]} == {"doc_a"}
    _protect(be, monkeypatch, "B")
    assert {s["video_stem"] for s in client.get("/list-indexed").get_json()["sources"]} == {"doc_b"}
    _protect(be, monkeypatch, None, on=False)
    assert {s["video_stem"] for s in client.get("/list-indexed").get_json()["sources"]} == {"doc_a", "doc_b"}


# ---- 9. the DB view itself (real local test database) -----------------------

@pytest.fixture()
def two_users():
    from app.db.models import User
    from app.domains.auth import users_store
    from tests._owner_db import owner_session_scope
    a = users_store.create_user(f"stem_a_{uuid.uuid4().hex[:8]}@example.com", "password123")["user_id"]
    b = users_store.create_user(f"stem_b_{uuid.uuid4().hex[:8]}@example.com", "password123")["user_id"]
    yield a, b
    with owner_session_scope() as s:
        for uid in (a, b):
            row = s.get(User, uid)
            if row is not None:
                s.delete(row)
    from app.domains.documents import repository as repo
    repo.invalidate_cache()


def test_stem_owners_view_includes_soft_deleted_documents(can_db_test, two_users):
    from app.domains.documents import repository as repo
    a, b = two_users
    stem_name = f"trung_{uuid.uuid4().hex[:6]}.pdf"
    da, db_ = str(uuid.uuid4()), str(uuid.uuid4())
    repo.create(document_id=da, filename=stem_name, file_type="pdf", file_path="/tmp/a", user_id=a)
    repo.create(document_id=db_, filename=stem_name, file_type="pdf", file_path="/tmp/b", user_id=b)
    repo.soft_delete(db_)
    owners = repo.stem_owners(use_cache=False)
    key = repo.canonical_source_stem(stem_name)
    assert owners[key] == {a, b}


def test_delete_by_id_refuses_to_purge_a_shared_stem(be, client, monkeypatch):
    """DELETE /sources/<id> checks the owner of ONE row, then purges index chunks, memory
    tree and mind maps by stem: on a shared stem that destroys the other owner's data, and
    skipping the purge would leave A's chunks readable by B once the stem is B's alone."""
    _registry(be, monkeypatch, {
        "idA": {"source_stem": "slide", "user_id": "A"},
        "idB": {"source_stem": "slide", "user_id": "B"},
    })
    _all_docs(be, monkeypatch, {})
    _index(be, [("slide", "A"), ("slide", "B")])
    before = be.INDEX_META_JSON_PATH.read_text(encoding="utf-8")
    _protect(be, monkeypatch, "A")
    r = client.delete("/sources/idA")
    assert r.status_code == 409
    assert r.get_json()["error"] == "shared_source_stem"
    assert be.INDEX_META_JSON_PATH.read_text(encoding="utf-8") == before
