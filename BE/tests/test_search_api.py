"""Phase 3 — API tìm kiếm ngữ nghĩa (FR-05).

Retriever bị thay bằng bản giả: cái cần kiểm là **tra ngược** id FAISS sang
`chunk_id` UUID + `section_id` và bộ lọc quyền sở hữu, không phải chất lượng
xếp hạng của FAISS/BM25.
"""

from __future__ import annotations

import io
import os
import uuid

import pytest


@pytest.fixture(scope="module", autouse=True)
def _need_db():
    from shared.env_loader import load_project_env
    load_project_env()
    if not (os.getenv("DATABASE_URL") or "").strip():
        pytest.skip("cần DATABASE_URL (PostgreSQL) — xem BE/.env")


@pytest.fixture()
def be(client):
    import app.main as main
    return main


@pytest.fixture()
def owner():
    from app.domains.auth import users_store
    from app.db import session_scope
    from app.db.models import User

    u = users_store.create_user(f"search_{uuid.uuid4().hex[:8]}@example.com", "password123")
    yield u["user_id"]
    with session_scope() as s:
        row = s.get(User, u["user_id"])
        if row is not None:
            s.delete(row)
    from app.domains.documents import repository as docs_repo
    docs_repo.invalidate_cache()


def _protect(main, monkeypatch, uid):
    monkeypatch.setattr(main, "_auth_protect_enabled", lambda: True)
    monkeypatch.setattr(main, "_current_user_id", lambda: uid)


def _seed(client, name, embedding_ids):
    """Upload + ghi 1 section và các chunk mang embedding_id cho trước."""
    from app.domains.documents import repository as docs_repo
    from app.domains.documents.sections import build_sections

    r = client.post("/api/documents/upload",
                    data={"file": (io.BytesIO(b"# Chuong 1\n\nnoi dung"), name)},
                    content_type="multipart/form-data")
    assert r.status_code == 201, r.get_data(as_text=True)
    doc_id = r.get_json()["document_id"]
    sections, keys = build_sections(["Chuong 1"] * len(embedding_ids))
    key_to_id = docs_repo.replace_sections(doc_id, sections)
    docs_repo.replace_chunks(doc_id, [
        {"chunk_index": i, "text": f"noi dung {emb}", "heading": "Chuong 1",
         "section_id": key_to_id.get(keys[i]), "embedding_id": str(emb)}
        for i, emb in enumerate(embedding_ids)
    ])
    return doc_id


class _FakeRetriever:
    """Trả mọi chunk_id được cấu hình, điểm giảm dần theo thứ tự."""

    def __init__(self, ids):
        self.ids = ids
        self.last_sources = None

    def retrieve_scored(self, query, *, selected_sources=None, top_k=6, **kw):
        from app.domains.retrieval.hybrid import RetrievedChunk
        self.last_sources = selected_sources
        return [
            (RetrievedChunk(chunk_id=int(i), text=f"noi dung {i}", video_stem="x"),
             1.0 / (rank + 1))
            for rank, i in enumerate(self.ids[:top_k])
        ]


def _fake_retriever(monkeypatch, ids):
    from app.domains.retrieval import search as search_mod
    fake = _FakeRetriever(ids)
    monkeypatch.setattr(search_mod, "get_retriever", lambda path: fake)
    return fake


def test_search_returns_business_chunk_id_and_section(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    doc_id = _seed(client, "giao trinh.md", [201, 202])
    _fake_retriever(monkeypatch, [201, 202])

    body = client.post("/api/search", json={"query": "dao ham", "top_k": 5}).get_json()
    results = body["results"]
    assert len(results) == 2
    from app.domains.documents import repository as docs_repo
    want = {c["embedding_id"]: c for c in docs_repo.list_chunks(doc_id)}
    for r in results:
        assert r["document_id"] == doc_id
        assert r["chunk_id"] in {c["chunk_id"] for c in want.values()}
        assert r["section_id"] and r["text"]
    assert results[0]["score"] > results[1]["score"], "phải giữ thứ tự xếp hạng"
    # FR-05.4: chunk_id là UUID nghiệp vụ, không phải id FAISS
    assert all(str(r["chunk_id"]) not in ("201", "202") for r in results)


def test_search_excludes_other_users_chunks(be, client, monkeypatch, owner):
    """FR-05.5 — index FAISS dùng chung, bộ lọc phải chặn ở tầng tra ngược."""
    from app.domains.auth import users_store

    _protect(be, monkeypatch, owner)
    mine = _seed(client, "cua toi.md", [301])

    other = users_store.create_user(f"search_o_{uuid.uuid4().hex[:8]}@example.com", "password123")
    _protect(be, monkeypatch, other["user_id"])
    _seed(client, "cua nguoi khac.md", [302])

    _protect(be, monkeypatch, owner)
    _fake_retriever(monkeypatch, [301, 302])  # retriever trả CẢ HAI
    results = client.post("/api/search", json={"query": "gi do"}).get_json()["results"]
    assert [r["document_id"] for r in results] == [mine]


def test_search_missing_chunk_row_is_dropped_not_faked(be, client, monkeypatch, owner):
    """Chunk có trong FAISS nhưng chưa có trong Postgres → bỏ, không bịa chunk_id."""
    _protect(be, monkeypatch, owner)
    _seed(client, "co trong db.md", [401])
    _fake_retriever(monkeypatch, [401, 999999])

    results = client.post("/api/search", json={"query": "abc"}).get_json()["results"]
    assert len(results) == 1 and results[0]["chunk_index"] == 0


def test_document_scoped_search_limits_to_that_document(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    doc_a = _seed(client, "tai lieu a.md", [501])
    doc_b = _seed(client, "tai lieu b.md", [502])
    fake = _fake_retriever(monkeypatch, [501, 502])

    body = client.post(f"/api/documents/{doc_a}/search", json={"query": "x"}).get_json()
    assert body["document_id"] == doc_a
    assert [r["document_id"] for r in body["results"]] == [doc_a]
    # lọc ngay ở retriever theo source_stem, không chỉ lọc sau
    assert fake.last_sources and len(fake.last_sources) == 1
    assert doc_b not in [r["document_id"] for r in body["results"]]


def test_search_validates_input(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    doc_id = _seed(client, "hop le.md", [601])
    _fake_retriever(monkeypatch, [601])

    assert client.post("/api/search", json={"query": "   "}).status_code == 400
    assert client.post("/api/search", json={"query": "x", "top_k": "abc"}).status_code == 400
    assert client.post(f"/api/documents/{uuid.uuid4()}/search",
                       json={"query": "x"}).status_code == 404
    # top_k được kẹp, không cho quét cả index
    body = client.post("/api/search", json={"query": "x", "top_k": 9999}).get_json()
    assert body["results"] and len(body["results"]) <= 50
    assert doc_id
