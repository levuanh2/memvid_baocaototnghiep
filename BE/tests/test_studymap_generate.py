"""Phase 3 — Study Map (FR-04).

Phần map thuần (mindmap → knowledge_*) chạy không cần DB; phần còn lại chạy trên
Postgres thật với pipeline giả (không gọi LLM).
"""

from __future__ import annotations

import io
import os
import uuid

import pytest

from app.domains.studymap.generator import build_graph


# ── mapping thuần: không DB, không LLM ──────────────────────────────────────

def test_build_graph_drops_broken_nodes_and_orders_parents_first():
    rows, edges = build_graph(
        [
            {"id": "r", "parent": None, "kind": "root", "title": "Goc", "order": 0},
            {"id": "a", "parent": "r", "kind": "section", "title": "Chuong 1", "order": 1},
            {"id": "b", "parent": "a", "kind": "idea", "title": "Khai niem", "order": 2},
            {"id": "c", "parent": "khong-ton-tai", "kind": "detail", "title": "Vi du", "order": 3},
            {"id": "d", "parent": "r", "kind": "idea", "title": "", "order": 4},
        ],
        [{"source": "b", "target": "c", "type": "leads_to"}],
        {},
    )
    # DFS: con của "Chuong 1" đứng ngay sau nó, "Vi du" (mồ côi → về root) xếp cuối
    assert [r["title"] for r in rows] == ["Goc", "Chuong 1", "Khai niem", "Vi du"]
    pos = {r["key"]: i for i, r in enumerate(rows)}
    for r in rows:
        assert r["title"].strip(), "FR-04.6: node phải có title"
        assert r["key"] != r["parent_key"], "không được tự trỏ parent"
        assert r["parent_key"] is None or pos[r["parent_key"]] < pos[r["key"]]
    by_key = {r["key"]: r for r in rows}
    assert by_key["c"]["parent_key"] == "r", "mồ côi phải về root"
    assert by_key["b"]["level"] == 3
    assert edges[0]["relation_type"] == "prerequisite"


def test_build_graph_maps_chunk_refs_to_uuid_and_majority_section():
    chunk_map = {
        "10": {"chunk_id": "u1", "section_id": "s1"},
        "11": {"chunk_id": "u2", "section_id": "s1"},
        "12": {"chunk_id": "u3", "section_id": "s2"},
    }
    rows, _ = build_graph(
        [{"id": "r", "parent": None, "kind": "root", "title": "Goc",
          "chunk_refs": ["10", "11", "12", "99"], "order": 0}],
        [], chunk_map,
    )
    assert rows[0]["chunk_ids"] == ["u1", "u2", "u3"], "id FAISS lạ bị bỏ, không bịa chunk_id"
    assert rows[0]["section_id"] == "s1"


def test_build_graph_rejects_edges_the_db_check_would_reject():
    rows, edges = build_graph(
        [{"id": "r", "parent": None, "kind": "root", "title": "Goc"},
         {"id": "a", "parent": "r", "kind": "idea", "title": "A"}],
        [{"source": "a", "target": "a", "type": "supports"},        # self-loop
         {"source": "a", "target": "khong-co", "type": "supports"},  # node lạ
         {"source": "a", "target": "r", "type": "kieu-la"}],         # type ngoài CHECK
        {},
    )
    assert len(rows) == 2
    assert [(e["source_key"], e["target_key"], e["relation_type"]) for e in edges] == [
        ("a", "r", "related")
    ]


# ── phần chạy trên DB thật ──────────────────────────────────────────────────

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

    u = users_store.create_user(f"smap_{uuid.uuid4().hex[:8]}@example.com", "password123")
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


class _FakePipeline:
    """Trả cây cố định — Study Map phải kiểm phần map + ghi DB, không kiểm LLM."""

    def skeleton(self, mm_input):
        return [{"id": "r", "parent": None, "kind": "root", "title": "Goc", "order": 0}], "headings"

    def enrich(self, mm_input, skeleton_nodes, progress_cb=None, cancel_cb=None):
        if progress_cb:
            progress_cb(50, "Enrich")
        return skeleton_nodes + [
            {"id": "a", "parent": "r", "kind": "section", "title": "Chuong 1",
             "note": "tom tat", "chunk_refs": ["100"], "order": 1},
            {"id": "b", "parent": "a", "kind": "idea", "title": "Khai niem",
             "chunk_refs": ["101", "102"], "order": 2},
            {"id": "c", "parent": "a", "kind": "detail", "title": "Vi du", "order": 3},
        ], False

    def relations(self, nodes, cancel_cb=None):
        # b và c là anh em — cạnh chéo giữa cha-con bị `validate_relations` bỏ
        # vì đã có trong cây.
        return [{"source": "b", "target": "c", "type": "supports", "label": "bo tro"}], False


def _seed_document(client, be, monkeypatch, name="giao trinh.md"):
    """Upload + ghi sections/chunks như node EmbedAndIndex, trả document_id."""
    from app.domains.documents import repository as docs_repo
    from app.domains.documents.sections import build_sections

    r = client.post("/api/documents/upload",
                    data={"file": (io.BytesIO(b"# Chuong 1\n\nnoi dung"), name)},
                    content_type="multipart/form-data")
    assert r.status_code == 201, r.get_data(as_text=True)
    doc_id = r.get_json()["document_id"]

    headings = ["Chuong 1", "Chuong 1 > 1.1 Khai niem", "Chuong 1 > 1.1 Khai niem"]
    sections, keys = build_sections(headings)
    key_to_id = docs_repo.replace_sections(doc_id, sections)
    docs_repo.replace_chunks(doc_id, [
        {"chunk_index": i, "text": f"noi dung {i}", "heading": headings[i],
         "section_id": key_to_id.get(keys[i]), "embedding_id": str(100 + i)}
        for i in range(3)
    ])

    # Pipeline giả không đọc mm_input, chỉ cần route đi qua được.
    #
    # Phase 1: thân `run_study_map_job` đã sang `app/application/study_map_generation.py`.
    # Nó `from ... import collect_mindmap_input` nên tên đó nằm trong globals của module
    # ĐÓ — patch `app.main` không còn tới được, và hàm thật sẽ chạy rồi đọc index.json
    # thật (FileNotFoundError). Patch tại nơi mã tra tên.
    import app.application.study_map_generation as study_map_uc

    monkeypatch.setattr(study_map_uc, "collect_mindmap_input",
                        lambda meta, stems: {"title": name, "sources": stems,
                                             "chunks": [{"key": "100", "text": "noi dung"}],
                                             "tree_sections": []})
    monkeypatch.setattr(study_map_uc, "_get_mindmap_pipeline", lambda: _FakePipeline())
    return doc_id


def _run_inline(monkeypatch):
    """Chạy job ngay trong request thay vì đẩy sang thread/RQ."""
    import app.jobs.queue as queue_mod

    def _sync(fn, args=(), queue=None, job_id=None, **kw):
        fn(*args)
        return {"mode": "sync"}

    monkeypatch.setattr(queue_mod, "enqueue_job", _sync)


def test_generate_builds_map_with_titles_chunks_and_no_self_parent(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    doc_id = _seed_document(client, be, monkeypatch)
    _run_inline(monkeypatch)

    r = client.post("/api/study-maps/generate", json={"document_id": doc_id})
    assert r.status_code == 202, r.get_data(as_text=True)
    job_id = r.get_json()["job_id"]

    job = client.get(f"/api/study-maps/jobs/{job_id}").get_json()
    assert job["status"] == "done", job
    map_id = job["result"]["map_id"]

    m = client.get(f"/api/study-maps/{map_id}").get_json()
    assert m["status"] == "completed" and m["document_id"] == doc_id
    assert "user_id" not in m
    nodes = m["nodes"]
    assert len(nodes) == 4
    ids = {n["node_id"] for n in nodes}
    for n in nodes:
        assert n["title"].strip(), "FR-04.6"
        assert n["node_id"] != n["parent_node_id"], "FR-04: node không tự trỏ parent"
        assert n["parent_node_id"] is None or n["parent_node_id"] in ids
    # FR-04.7: node lá phải truy được về chunk nguồn, và về section của chunk đó
    leaf = next(n for n in nodes if n["title"] == "Khai niem")
    assert len(leaf["chunk_ids"]) == 2
    assert leaf["section_id"], "node phải gắn section"

    assert len(m["edges"]) == 1
    e = m["edges"][0]
    assert e["relation_type"] == "supports" and e["source_node_id"] != e["target_node_id"]


def test_generate_is_cached_until_force(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    doc_id = _seed_document(client, be, monkeypatch)
    _run_inline(monkeypatch)

    first = client.post("/api/study-maps/generate", json={"document_id": doc_id}).get_json()
    map_id = client.get(f"/api/study-maps/jobs/{first['job_id']}").get_json()["result"]["map_id"]

    again = client.post("/api/study-maps/generate", json={"document_id": doc_id})
    assert again.status_code == 200 and again.get_json() == {
        "map_id": map_id, "status": "completed", "cached": True}

    forced = client.post("/api/study-maps/generate", json={"document_id": doc_id, "force": True})
    assert forced.status_code == 202
    new_id = client.get(f"/api/study-maps/jobs/{forced.get_json()['job_id']}").get_json()["result"]["map_id"]
    assert new_id != map_id, "force phải tạo map mới, không ghi đè map cũ"

    listed = client.get(f"/api/documents/{doc_id}/study-maps").get_json()["study_maps"]
    assert {m["map_id"] for m in listed} == {map_id, new_id}
    assert all(m["node_count"] == 4 for m in listed)


def test_study_map_of_other_user_is_404(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    doc_id = _seed_document(client, be, monkeypatch)
    _run_inline(monkeypatch)
    job = client.post("/api/study-maps/generate", json={"document_id": doc_id}).get_json()
    map_id = client.get(f"/api/study-maps/jobs/{job['job_id']}").get_json()["result"]["map_id"]

    from app.domains.auth import users_store
    other = users_store.create_user(f"smap_o_{uuid.uuid4().hex[:8]}@example.com", "password123")
    _protect(be, monkeypatch, other["user_id"])

    assert client.get(f"/api/study-maps/{map_id}").status_code == 404
    assert client.get(f"/api/study-maps/jobs/{job['job_id']}").status_code == 404
    assert client.get(f"/api/documents/{doc_id}/study-maps").status_code == 404
    assert client.post("/api/study-maps/generate", json={"document_id": doc_id}).status_code == 404


def test_generate_requires_document_id(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    assert client.post("/api/study-maps/generate", json={}).status_code == 400
    assert client.post("/api/study-maps/generate",
                       json={"document_id": str(uuid.uuid4())}).status_code == 404
    assert client.get(f"/api/study-maps/{uuid.uuid4()}").status_code == 404


def test_failed_job_marks_map_failed_not_stuck_processing(be, client, monkeypatch, owner):
    """Pipeline nổ giữa chừng thì map phải là `failed` — không kẹt `processing` mãi."""
    _protect(be, monkeypatch, owner)
    doc_id = _seed_document(client, be, monkeypatch)
    _run_inline(monkeypatch)

    class _Boom(_FakePipeline):
        def enrich(self, *a, **kw):
            raise RuntimeError("LLM chet")

    import app.application.study_map_generation as study_map_uc

    monkeypatch.setattr(study_map_uc, "_get_mindmap_pipeline", lambda: _Boom())
    job = client.post("/api/study-maps/generate", json={"document_id": doc_id}).get_json()
    status = client.get(f"/api/study-maps/jobs/{job['job_id']}").get_json()
    assert status["status"] == "error" and status["error"]

    maps = client.get(f"/api/documents/{doc_id}/study-maps").get_json()["study_maps"]
    assert [m["status"] for m in maps] == ["failed"]


# ── chế độ mở: AUTH_PROTECT_APP_APIS tắt → uid là None ──────────────────────
#
# Mọi test trên đều gọi `_protect(...)`, tức chỉ chạy nhánh CÓ đăng nhập. Nhánh còn
# lại (`_require_app_user` trả `(None, None)`) chưa test bao giờ, và nó vỡ hoàn toàn:
# `str(None)` ra chuỗi `"None"`, Postgres từ chối với
# `invalid input syntax for type uuid: "None"`. Hai chỗ vỡ, và chỗ vỡ TRƯỚC nằm ngay
# trong route nên `/api/study-maps/generate` trả 500 trước khi job kịp chạy.

def _open_mode(main, monkeypatch):
    monkeypatch.setattr(main, "_auth_protect_enabled", lambda: False)
    monkeypatch.setattr(main, "_current_user_id", lambda: None)


@pytest.fixture()
def don_map_theo_tai_lieu():
    """Xoá tài liệu đã tạo khi xong — map/node/edge đi theo qua CASCADE.

    Chế độ mở gắn mọi thứ vào user ẩn danh DÙNG CHUNG, nên không được xoá user như
    fixture `owner`; phải xoá đúng tài liệu của test này.
    """
    ids: list = []
    yield ids
    from app.db import session_scope
    from app.db.models import Document
    with session_scope() as s:
        for doc_id in ids:
            row = s.get(Document, doc_id)
            if row is not None:
                s.delete(row)
    from app.domains.documents import repository as docs_repo
    docs_repo.invalidate_cache()


def test_che_do_mo_van_tao_duoc_map(be, client, monkeypatch, don_map_theo_tai_lieu):
    _open_mode(be, monkeypatch)
    doc_id = _seed_document(client, be, monkeypatch)
    don_map_theo_tai_lieu.append(doc_id)
    _run_inline(monkeypatch)

    r = client.post("/api/study-maps/generate", json={"document_id": doc_id})
    assert r.status_code == 202, r.get_data(as_text=True)
    job = client.get(f"/api/study-maps/jobs/{r.get_json()['job_id']}").get_json()
    assert job["status"] == "done", job          # trước đây: error + lỗi psycopg thô
    map_id = job["result"]["map_id"]

    m = client.get(f"/api/study-maps/{map_id}").get_json()
    assert m["status"] == "completed" and len(m["nodes"]) == 4


def test_che_do_mo_van_dung_cache_va_force(be, client, monkeypatch, don_map_theo_tai_lieu):
    """`latest_completed(doc, None)` là chỗ vỡ TRƯỚC — nó chạy trong route."""
    _open_mode(be, monkeypatch)
    doc_id = _seed_document(client, be, monkeypatch)
    don_map_theo_tai_lieu.append(doc_id)
    _run_inline(monkeypatch)

    first = client.post("/api/study-maps/generate", json={"document_id": doc_id}).get_json()
    map_id = client.get(f"/api/study-maps/jobs/{first['job_id']}").get_json()["result"]["map_id"]

    again = client.post("/api/study-maps/generate", json={"document_id": doc_id})
    assert again.status_code == 200
    assert again.get_json() == {"map_id": map_id, "status": "completed", "cached": True}

    forced = client.post("/api/study-maps/generate", json={"document_id": doc_id, "force": True})
    assert forced.status_code == 202
