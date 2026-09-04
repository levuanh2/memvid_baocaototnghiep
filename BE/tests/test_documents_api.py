"""Phase 2 — API tài liệu StudyMap (FR-02, FR-03) trên bảng `documents`.

Chạy trên Postgres thật; thiếu DATABASE_URL thì skip. Mỗi test tự dọn tài liệu và
user nó tạo ra (cascade xoá luôn sections/chunks theo cây 6.2).
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
    if not (os.getenv("TEST_DATABASE_URL") or "").strip():
        pytest.skip("cần TEST_DATABASE_URL — xem `python -m scripts.setup_test_db --help`")


@pytest.fixture()
def be(client):
    import app.main as main
    return main


def _protect(main, monkeypatch, uid, on=True):
    monkeypatch.setattr(main, "_auth_protect_enabled", lambda: on)
    monkeypatch.setattr(main, "_current_user_id", lambda: uid)


@pytest.fixture()
def owner():
    """User thật (documents.user_id có FK) — xoá xong cascade sạch tài liệu."""
    from app.domains.auth import users_store
    from app.db import session_scope
    from app.db.models import User

    u = users_store.create_user(f"docs_{uuid.uuid4().hex[:8]}@example.com", "password123")
    yield u["user_id"]
    with session_scope() as s:
        row = s.get(User, u["user_id"])
        if row is not None:
            s.delete(row)
    from app.domains.documents import repository as docs_repo
    docs_repo.invalidate_cache()


def _upload(client, name="tai lieu.md", body=b"# Chuong 1\n\nnoi dung"):
    return client.post(
        "/api/documents/upload",
        data={"file": (io.BytesIO(body), name)},
        content_type="multipart/form-data",
    )


# ── upload + list ───────────────────────────────────────────────────────────

def test_upload_creates_document_row_and_lists_it(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner, on=True)

    r = _upload(client, name="bao cao.md")
    assert r.status_code == 201, r.get_data(as_text=True)
    doc = r.get_json()
    assert doc["document_id"]
    assert doc["title"] == "bao cao.md"
    assert doc["source_stem"] == "bao_cao_md"
    # Đặc tả 3.2.4: API chỉ được trả tập status của đặc tả. Trạng thái pipeline
    # (`index_ready`, `ready`) đi riêng — trả `ready` ở đây thì client theo tài liệu
    # không bao giờ nhận ra tài liệu đã xử lý xong.
    SPEC_STATUS = {"uploaded", "processing", "completed", "failed", "deleted"}
    assert doc["status"] in SPEC_STATUS, doc["status"]
    assert doc["ingest_status"] in ("processing", "index_ready", "ready")

    listed_one = client.get(f"/api/documents/{doc['document_id']}").get_json()
    assert listed_one["status"] in SPEC_STATUS

    listed = client.get("/api/documents").get_json()["documents"]
    assert doc["document_id"] in [d["document_id"] for d in listed]


def test_upload_requires_file(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner, on=True)
    r = client.post("/api/documents/upload", data={}, content_type="multipart/form-data")
    assert r.status_code == 400


# ── ownership: tài liệu người khác = 404, không phải 403 ────────────────────

def test_other_users_document_is_404_not_403(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner, on=True)
    doc_id = _upload(client).get_json()["document_id"]

    from app.domains.auth import users_store
    other = users_store.create_user(f"other_{uuid.uuid4().hex[:8]}@example.com", "password123")
    _protect(be, monkeypatch, other["user_id"], on=True)

    for path in (f"/api/documents/{doc_id}",
                 f"/api/documents/{doc_id}/sections",
                 f"/api/documents/{doc_id}/chunks"):
        assert client.get(path).status_code == 404, path
    assert client.delete(f"/api/documents/{doc_id}").status_code == 404
    assert doc_id not in [d["document_id"] for d in client.get("/api/documents").get_json()["documents"]]


def test_unknown_document_is_404(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner, on=True)
    assert client.get(f"/api/documents/{uuid.uuid4()}").status_code == 404


# ── sections / chunks ───────────────────────────────────────────────────────

def _seed_structure(document_id):
    """Ghi sections + chunks như node EmbedAndIndex làm."""
    from app.domains.documents import repository as docs_repo
    from app.domains.documents.sections import build_sections

    headings = ["Chuong 1 > 1.1 Khai niem", "Chuong 1 > 1.1 Khai niem", "Chuong 2"]
    texts = ["noi dung mot", "noi dung hai", "noi dung ba"]
    sections, keys = build_sections(headings)
    key_to_id = docs_repo.replace_sections(document_id, sections)
    docs_repo.replace_chunks(document_id, [
        {"chunk_index": i, "text": t, "heading": headings[i],
         "section_id": key_to_id.get(keys[i]), "embedding_id": str(100 + i)}
        for i, t in enumerate(texts)
    ])
    return key_to_id


def test_sections_and_chunks_are_linked(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner, on=True)
    doc_id = _upload(client).get_json()["document_id"]
    _seed_structure(doc_id)

    sections = client.get(f"/api/documents/{doc_id}/sections").get_json()["sections"]
    titles = [s["title"] for s in sections]
    assert titles == ["Chuong 1", "1.1 Khai niem", "Chuong 2"]
    by_title = {s["title"]: s for s in sections}
    assert by_title["1.1 Khai niem"]["parent_section_id"] == by_title["Chuong 1"]["section_id"]
    assert by_title["Chuong 2"]["parent_section_id"] is None
    assert by_title["1.1 Khai niem"]["level"] == 2

    body = client.get(f"/api/documents/{doc_id}/chunks").get_json()
    assert body["total"] == 3
    chunks = body["chunks"]
    assert [c["chunk_index"] for c in chunks] == [0, 1, 2]
    # mỗi chunk truy ngược được về section nguồn (FR-03.7) và về vector FAISS
    assert chunks[0]["section_id"] == by_title["1.1 Khai niem"]["section_id"]
    assert chunks[2]["section_id"] == by_title["Chuong 2"]["section_id"]
    assert [c["embedding_id"] for c in chunks] == ["100", "101", "102"]


def test_chunks_pagination(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner, on=True)
    doc_id = _upload(client).get_json()["document_id"]
    _seed_structure(doc_id)

    page = client.get(f"/api/documents/{doc_id}/chunks?limit=2&offset=1").get_json()
    assert page["total"] == 3 and page["limit"] == 2 and page["offset"] == 1
    assert [c["chunk_index"] for c in page["chunks"]] == [1, 2]

    assert client.get(f"/api/documents/{doc_id}/chunks?limit=abc").status_code == 400


def test_reingest_replaces_structure_instead_of_duplicating(be, client, monkeypatch, owner):
    """replace_* phải ghi đè — chạy lại ingest không được nhân đôi chunk."""
    _protect(be, monkeypatch, owner, on=True)
    doc_id = _upload(client).get_json()["document_id"]
    _seed_structure(doc_id)
    _seed_structure(doc_id)

    assert client.get(f"/api/documents/{doc_id}/chunks").get_json()["total"] == 3
    assert len(client.get(f"/api/documents/{doc_id}/sections").get_json()["sections"]) == 3


# ── xoá mềm ─────────────────────────────────────────────────────────────────

def test_soft_delete_hides_document_but_keeps_chunks(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner, on=True)
    doc_id = _upload(client).get_json()["document_id"]
    _seed_structure(doc_id)

    assert client.delete(f"/api/documents/{doc_id}").status_code == 200
    assert client.get(f"/api/documents/{doc_id}").status_code == 404
    assert doc_id not in [d["document_id"] for d in client.get("/api/documents").get_json()["documents"]]

    # Đặc tả 8.10: xoá mềm giữ nguyên dữ liệu con, chỉ ẩn ở tầng truy vấn.
    from app.domains.documents import repository as docs_repo
    assert docs_repo.count_chunks(doc_id) == 3


# ── file gốc: signed URL, không lộ storage path ─────────────────────────────

def test_document_payload_never_leaks_storage_path(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner, on=True)
    doc = _upload(client).get_json()
    assert "file_path" not in doc, "NFR-04.3: không expose raw file path"


def test_file_endpoint_returns_signed_url(be, client, monkeypatch, owner):
    from app.domains.documents import storage
    if not storage.is_configured():
        pytest.skip("Supabase Storage chưa cấu hình")

    _protect(be, monkeypatch, owner, on=True)
    doc_id = _upload(client).get_json()["document_id"]

    r = client.get(f"/api/documents/{doc_id}/file?ttl=120")
    # Storage có thể không nhận được file (mạng/bucket) → chấp nhận 404, nhưng
    # khi trả 200 thì phải là signed URL đúng dạng, không phải path thô.
    if r.status_code == 404:
        pytest.skip("file không có trên storage trong lần chạy này")
    assert r.status_code == 200
    body = r.get_json()
    assert body["expires_in"] == 120
    assert body["url"].startswith("http") and "/object/sign/" in body["url"]
