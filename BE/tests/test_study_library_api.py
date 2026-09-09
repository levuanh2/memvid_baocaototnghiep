"""Route thư viện học tập (Phase 1A) — `/api/library`, `PATCH`, `/opened`.

Hai nhóm test, cố ý tách:

- **Nhóm stub** (chạy ở MỌI máy): khoá phần kiểm tra đầu vào, phạm vi quyền, hình
  dạng phản hồi và ràng buộc "không truy vấn theo từng tài liệu". Thay
  `repository` bằng stub nên không cần Postgres — và nhờ vậy nó thật sự chạy ở
  máy dev, chỗ mà `TEST_DATABASE_URL` thường không có.
- **Nhóm DB** (skip khi thiếu `TEST_DATABASE_URL`): những bất biến chỉ chứng minh
  được trên database thật — quan trọng nhất là tài liệu ĐÃ LƯU TRỮ vẫn `completed`,
  vẫn nằm trong `all_rows()`, vẫn trong `owned_stems()`. Nếu lưu trữ từng lỡ được
  cài bằng `status` thì đúng ba khẳng định đó sẽ đỏ, và tài liệu đã lưu trữ sẽ âm
  thầm biến mất khỏi RAG.
"""

from __future__ import annotations

import io
import os
import uuid

import pytest

UID = "user-A"


# ══════════════════════════════════════════════ nhóm stub (không cần DB) ════

class DocsGia:
    """Stub `repository` — chỉ những hàm mà ba route này gọi tới."""

    def __init__(self, rows=None):
        self.rows = rows if rows is not None else {"d1": self.hang()}
        self.ghi: list = []
        self.mo: list = []
        self.dem_all_rows = 0
        self.dem_languages = 0
        self.dem_ai_counts = 0

    @staticmethod
    def hang(**kw):
        base = {
            "filename": "bai giang.pdf", "source_stem": "bai_giang_pdf",
            "file_type": "pdf", "status": "ready", "spec_status": "completed",
            "progress": 1.0, "capabilities": {"chunk_query": True, "memory_query": True},
            "page_count": 4, "char_count": 4000, "chunk_count": 12,
            "created_at": "2026-09-01T00:00:00Z", "user_id": UID,
            "display_name": None, "favorite": False, "pinned": False,
            "archived_at": None, "tags": [], "last_opened_at": None, "last_workspace": None,
            "collection_id": None, "open_count": 0,
        }
        base.update(kw)
        return base

    def all_rows(self, *a, **k):
        self.dem_all_rows += 1
        return dict(self.rows)

    def get(self, document_id):
        return dict(self.rows[document_id]) if document_id in self.rows else None

    def set_library_fields(self, document_id, **kw):
        if document_id not in self.rows:
            return False
        self.ghi.append((document_id, kw))
        if "display_name" in kw:
            self.rows[document_id]["display_name"] = kw["display_name"]
        if "tags" in kw:
            self.rows[document_id]["tags"] = kw["tags"] or []
        for c in ("favorite", "pinned"):
            if c in kw:
                self.rows[document_id][c] = kw[c]
        if "archived" in kw:
            self.rows[document_id]["archived_at"] = (
                "2026-09-09T00:00:00Z" if kw["archived"] else None)
        return True

    def touch_opened(self, document_id, workspace=None):
        if document_id not in self.rows:
            return False
        self.mo.append((document_id, workspace))
        self.rows[document_id]["last_opened_at"] = "2026-09-09T12:00:00Z"
        if workspace:
            self.rows[document_id]["last_workspace"] = workspace
        return True

    def languages_for(self, ids):
        self.dem_languages += 1
        return {i: "vi" for i in ids}

    def ai_counts(self, user_id):
        self.dem_ai_counts += 1
        return {"quizzes": {"d1": {"quizzes": 2, "graded_attempts": 1,
                                   "latest_quiz_id": "q-1"}},
                "reviews": {"d1": {"count": 1, "latest_attempt_id": "a-1"}},
                "studymaps": {"d1": "completed"}}


class KhoGia:
    def __init__(self, records=None, no=False):
        self.records = records or []
        self.no = no
        self.lan_goi = 0

    def list_records(self, user_id=None, enforce_owner=False):
        self.lan_goi += 1
        if self.no:
            raise RuntimeError("kho phù du đã bị xoá")
        return list(self.records)


@pytest.fixture()
def be(client):
    import app.main as main
    return main


@pytest.fixture()
def moi_truong(be, monkeypatch):
    """Trả về (docs, summaries, mindmaps) và nối chúng vào app."""
    from app.domains.documents import repository as docs_repo

    def cai_dat(rows=None, summaries=None, mindmaps=None, kho_summary_no=False):
        docs = DocsGia(rows)
        for ten in ("all_rows", "get", "set_library_fields", "touch_opened",
                    "languages_for", "ai_counts"):
            monkeypatch.setattr(docs_repo, ten, getattr(docs, ten))
        sm = KhoGia(summaries, no=kho_summary_no)
        mm = KhoGia(mindmaps)
        monkeypatch.setattr(be, "summary_store", sm)
        monkeypatch.setattr(be, "mindmap_store", mm)
        return docs, sm, mm
    return cai_dat


def _summary(sources, **kw):
    rec = {"id": "s-1", "sources": list(sources), "overview": "Tổng quan A.",
           "sections": [{"id": "s0", "title": "Mở đầu", "order": 0,
                         "key_points": ["một", "hai", "ba", "bốn"], "summary": "dài"}],
           "entities": ["FIFO"], "created_at": "2026-09-02T00:00:00Z"}
    rec.update(kw)
    return rec


# ── GET /api/library ────────────────────────────────────────────────────────

def test_library_tra_ve_tai_lieu_kem_khoi_ai(client, moi_truong):
    moi_truong(summaries=[_summary(["bai_giang_pdf"])],
               mindmaps=[{"id": "m-1", "sources": ["bai_giang_pdf"]}])
    r = client.get("/api/library")
    assert r.status_code == 200

    docs = r.get_json()["documents"]
    assert len(docs) == 1
    d = docs[0]
    assert d["document_id"] == "d1"
    assert d["ai"]["summary"]["state"] == "ready"
    assert d["ai"]["summary"]["ai_overview"] == ["một", "hai", "ba"]
    assert d["ai"]["summary"]["preview"] == "Tổng quan A."
    assert d["ai"]["summary"]["entities"] == ["FIFO"]
    assert d["ai"]["mindmap"]["state"] == "ready"
    assert d["ai"]["studymap"]["state"] == "ready"
    assert d["ai"]["quiz"]["count"] == 2 and d["ai"]["quiz"]["graded_attempts"] == 1
    assert d["ai"]["quiz"]["latest_quiz_id"] == "q-1"
    assert d["ai"]["review"]["count"] == 1
    assert d["ai"]["review"]["latest_attempt_id"] == "a-1"
    assert d["ai"]["index"] == "ready" and d["ai"]["chat_ready"] == "ready"
    assert d["reading_minutes"] == 4 and d["language"] == "vi"


def test_library_khong_truy_van_theo_tung_tai_lieu(client, moi_truong):
    """RÀNG BUỘC chính của endpoint. 40 tài liệu vẫn phải là đúng một lượt cho mỗi
    nguồn — không phải 40 lượt. Đếm lời gọi là cách duy nhất khoá được điều đó."""
    rows = {f"d{i}": DocsGia.hang(filename=f"f{i}.pdf", source_stem=f"f{i}_pdf")
            for i in range(40)}
    docs, sm, mm = moi_truong(rows=rows)

    assert len(client.get("/api/library").get_json()["documents"]) == 40
    assert docs.dem_all_rows == 1
    assert docs.dem_languages == 1
    assert docs.dem_ai_counts == 1
    assert sm.lan_goi == 1 and mm.lan_goi == 1


def test_library_kho_phu_du_hong_van_tra_ve_thu_vien(client, moi_truong):
    """Kho tóm tắt nằm trong DATA_DIR và bị xoá mỗi lần deploy. Mất nó phải mất
    ĐÚNG phần tóm tắt — danh sách tài liệu là thứ trang này tồn tại để hiện."""
    moi_truong(kho_summary_no=True)
    r = client.get("/api/library")
    assert r.status_code == 200
    d = r.get_json()["documents"][0]
    assert d["ai"]["summary"]["state"] == "not_generated"
    assert d["ai"]["index"] == "ready"          # tín hiệu bền vững còn nguyên


def test_library_khong_bao_gio_tra_generating_cho_tom_tat_hay_so_do(client, moi_truong):
    moi_truong()
    d = client.get("/api/library").get_json()["documents"][0]
    assert d["ai"]["summary"]["state"] == "not_generated"
    assert d["ai"]["mindmap"]["state"] == "not_generated"


def test_library_khong_lo_toan_van_tom_tat(client, moi_truong):
    moi_truong(summaries=[_summary(["bai_giang_pdf"])])
    than = client.get("/api/library").get_data(as_text=True)
    assert "dài" not in than


def test_library_loc_theo_chu_so_huu(client, be, moi_truong, monkeypatch):
    rows = {"cua_toi": DocsGia.hang(user_id=UID),
            "cua_nguoi_khac": DocsGia.hang(user_id="user-B", filename="b.pdf",
                                           source_stem="b_pdf")}
    moi_truong(rows=rows)
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: True)
    monkeypatch.setattr(be, "_current_user_id", lambda: UID)

    docs = client.get("/api/library").get_json()["documents"]
    assert [d["document_id"] for d in docs] == ["cua_toi"]


def test_library_401_khi_bat_bao_ve_ma_khong_co_token(client, be, monkeypatch):
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: True)
    monkeypatch.setattr(be, "_current_user_id", lambda: None)
    assert client.get("/api/library").status_code == 401


# ── PATCH /api/documents/<id> ───────────────────────────────────────────────

def test_patch_doi_ten_hien_thi_khong_dung_toi_title(client, moi_truong):
    docs, _, _ = moi_truong()
    r = client.patch("/api/documents/d1", json={"display_name": "  Hệ điều hành  "})
    assert r.status_code == 200
    body = r.get_json()
    assert body["display_name"] == "Hệ điều hành"          # đã cắt trắng
    assert body["title"] == "bai giang.pdf"                # tên file nguyên vẹn
    assert body["source_stem"] == "bai_giang_pdf"


def test_patch_display_name_null_xoa_ten_da_dat(client, moi_truong):
    docs, _, _ = moi_truong()
    client.patch("/api/documents/d1", json={"display_name": "X"})
    r = client.patch("/api/documents/d1", json={"display_name": None})
    assert r.status_code == 200 and r.get_json()["display_name"] is None


@pytest.mark.parametrize("gt", ["", "   ", "\t\n"])
def test_patch_ten_rong_bi_tu_choi(client, moi_truong, gt):
    moi_truong()
    r = client.patch("/api/documents/d1", json={"display_name": gt})
    assert r.status_code == 400


def test_patch_ten_dai_qua_200_bi_tu_choi_dung_201_moi_hong(client, moi_truong):
    moi_truong()
    assert client.patch("/api/documents/d1", json={"display_name": "x" * 200}).status_code == 200
    assert client.patch("/api/documents/d1", json={"display_name": "x" * 201}).status_code == 400


def test_patch_ten_trung_nhau_van_cho_phep(client, moi_truong):
    """Hai bài giảng cùng tên là chuyện bình thường; ép duy nhất là bịa ra một
    ràng buộc mà người dùng không hề yêu cầu."""
    rows = {"d1": DocsGia.hang(), "d2": DocsGia.hang(filename="b.pdf", source_stem="b_pdf")}
    moi_truong(rows=rows)
    assert client.patch("/api/documents/d1", json={"display_name": "Trùng"}).status_code == 200
    assert client.patch("/api/documents/d2", json={"display_name": "Trùng"}).status_code == 200


@pytest.mark.parametrize("truong", ["favorite", "pinned", "archived"])
@pytest.mark.parametrize("xau", ["true", 1, 0, "yes", None, []])
def test_patch_co_phai_bool_nghiem_ngat(client, moi_truong, truong, xau):
    """Ép truthy ở đây thì chuỗi "false" bật cờ lên."""
    moi_truong()
    assert client.patch("/api/documents/d1", json={truong: xau}).status_code == 400


def test_patch_bat_tat_yeu_thich_va_ghim(client, moi_truong):
    moi_truong()
    b = client.patch("/api/documents/d1", json={"favorite": True, "pinned": True}).get_json()
    assert b["favorite"] is True and b["pinned"] is True
    b = client.patch("/api/documents/d1", json={"favorite": False}).get_json()
    assert b["favorite"] is False and b["pinned"] is True   # chỉ trường được gửi mới đổi


def test_patch_luu_tru_dat_moc_thoi_gian_o_may_chu(client, moi_truong):
    """`archived` là bool ở API; client KHÔNG BAO GIỜ gửi timestamp."""
    docs, _, _ = moi_truong()
    b = client.patch("/api/documents/d1", json={"archived": True}).get_json()
    assert b["archived_at"] is not None
    assert docs.ghi[-1][1] == {"archived": True}
    b = client.patch("/api/documents/d1", json={"archived": False}).get_json()
    assert b["archived_at"] is None


def test_patch_luu_tru_khong_dung_toi_status(client, moi_truong):
    """Bất biến trung tâm: lưu trữ chỉ ẩn khỏi giao diện. Đưa nó vào `status` là
    đẩy tài liệu ra khỏi `all_rows()` và khỏi RAG."""
    moi_truong()
    b = client.patch("/api/documents/d1", json={"archived": True}).get_json()
    assert b["status"] == "completed"
    assert b["ingest_status"] == "ready"


def test_patch_tags_cat_trang_bo_rong_khu_trung_giu_cach_viet_dau(client, moi_truong):
    moi_truong()
    b = client.patch("/api/documents/d1",
                     json={"tags": ["  AI ", "", "ai", "Exam", "   "]}).get_json()
    assert b["tags"] == ["AI", "Exam"]


def test_patch_tags_danh_sach_rong_xoa_het(client, moi_truong):
    moi_truong()
    client.patch("/api/documents/d1", json={"tags": ["AI"]})
    assert client.patch("/api/documents/d1", json={"tags": []}).get_json()["tags"] == []


@pytest.mark.parametrize("xau,ma", [
    ("AI", 400), ({"a": 1}, 400), ([1, 2], 400), ([None], 400),
    ([["lồng"]], 400), (["x" * 31], 400), ([f"t{i}" for i in range(21)], 400),
])
def test_patch_tags_dau_vao_xau_bi_tu_choi(client, moi_truong, xau, ma):
    moi_truong()
    assert client.patch("/api/documents/d1", json={"tags": xau}).status_code == ma


def test_patch_tags_dung_bien_bien(client, moi_truong):
    moi_truong()
    assert client.patch("/api/documents/d1",
                        json={"tags": ["x" * 30]}).status_code == 200
    assert client.patch("/api/documents/d1",
                        json={"tags": [f"t{i}" for i in range(20)]}).status_code == 200


def test_patch_body_rong_hoac_khong_phai_object_bi_tu_choi(client, moi_truong):
    moi_truong()
    assert client.patch("/api/documents/d1", json={}).status_code == 400
    assert client.patch("/api/documents/d1", json=[1, 2]).status_code == 400


def test_patch_khong_nhan_truong_la(client, moi_truong):
    """Gửi `study_category` (Phase 1B) hay `last_opened_at` chỉ là không-có-gì-để-ghi
    → 400, chứ KHÔNG âm thầm thành công."""
    moi_truong()
    assert client.patch("/api/documents/d1",
                        json={"study_category": "Lecture"}).status_code == 400
    assert client.patch("/api/documents/d1",
                        json={"last_opened_at": "2026-01-01"}).status_code == 400


def test_patch_tai_lieu_khong_ton_tai_la_404(client, moi_truong):
    moi_truong()
    assert client.patch("/api/documents/khong-co", json={"favorite": True}).status_code == 404


def test_patch_tai_lieu_cua_nguoi_khac_la_404_khong_phai_403(client, be, moi_truong,
                                                             monkeypatch):
    """403 xác nhận id đó có thật — đó là một oracle. 404 thì không."""
    rows = {"cua_nguoi_khac": DocsGia.hang(user_id="user-B")}
    moi_truong(rows=rows)
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: True)
    monkeypatch.setattr(be, "_current_user_id", lambda: UID)
    r = client.patch("/api/documents/cua_nguoi_khac", json={"favorite": True})
    assert r.status_code == 404


# ── POST /api/documents/<id>/opened ─────────────────────────────────────────

def test_opened_ghi_moc_va_be_mat(client, moi_truong):
    docs, _, _ = moi_truong()
    r = client.post("/api/documents/d1/opened", json={"workspace": "mindmap"})
    assert r.status_code == 200
    b = r.get_json()
    assert b["last_opened_at"] and b["last_workspace"] == "mindmap"
    assert docs.mo == [("d1", "mindmap")]


@pytest.mark.parametrize("ws", ["summary", "mindmap", "studymap", "quiz", "review", "chat"])
def test_opened_chap_nhan_moi_be_mat_hop_le(client, moi_truong, ws):
    moi_truong()
    assert client.post("/api/documents/d1/opened", json={"workspace": ws}).status_code == 200


def test_opened_chuan_hoa_hoa_thuong(client, moi_truong):
    docs, _, _ = moi_truong()
    client.post("/api/documents/d1/opened", json={"workspace": "  MindMap  "})
    assert docs.mo == [("d1", "mindmap")]


@pytest.mark.parametrize("ws", ["flashcards", "editor", "", "   ", 5, [], {}])
def test_opened_be_mat_khong_hop_le_bi_tu_choi(client, moi_truong, ws):
    moi_truong()
    assert client.post("/api/documents/d1/opened", json={"workspace": ws}).status_code == 400


def test_opened_khong_gui_workspace_thi_chi_doi_moc(client, moi_truong):
    docs, _, _ = moi_truong()
    r = client.post("/api/documents/d1/opened", json={})
    assert r.status_code == 200
    assert r.get_json()["last_opened_at"] is not None
    assert docs.mo == [("d1", None)]


def test_opened_khong_nhan_timestamp_tu_client(client, moi_truong):
    """Client vá được mốc thời gian là client giả mạo được thứ tự "mở gần đây"."""
    docs, _, _ = moi_truong()
    client.post("/api/documents/d1/opened",
                json={"workspace": "chat", "last_opened_at": "1999-01-01T00:00:00Z"})
    assert docs.mo == [("d1", "chat")]
    assert not client.get("/api/library").get_json()["documents"][0][
        "last_opened_at"].startswith("1999")


def test_opened_tai_lieu_cua_nguoi_khac_la_404(client, be, moi_truong, monkeypatch):
    moi_truong(rows={"khac": DocsGia.hang(user_id="user-B")})
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: True)
    monkeypatch.setattr(be, "_current_user_id", lambda: UID)
    assert client.post("/api/documents/khac/opened", json={}).status_code == 404


def test_get_van_khong_co_tac_dung_phu(client, moi_truong):
    """Nếu GET ghi mốc mở thì mỗi lần tải danh sách là một lần "vừa mở" MỌI tài
    liệu, và thứ tự "mở gần đây" mất sạch ý nghĩa."""
    docs, _, _ = moi_truong()
    client.get("/api/library")
    client.get("/api/documents")
    client.get("/api/documents/d1")
    assert docs.mo == []
    assert docs.ghi == []


# ── Hợp đồng của `_doc_public` ──────────────────────────────────────────────

def test_doc_public_giu_nguyen_moi_khoa_cu_va_them_bay_khoa_thu_vien(client, moi_truong):
    moi_truong()
    d = client.get("/api/documents/d1").get_json()
    cu = {"document_id", "title", "source_stem", "status", "ingest_status", "progress",
          "substatus", "capabilities", "page_count", "char_count", "chunk_count",
          "created_at", "error"}
    moi = {"display_name", "favorite", "pinned", "archived_at", "tags",
           "last_opened_at", "last_workspace"}
    # Phase 1B thêm đúng hai khoá. Test này CỐ Ý đỏ khi bề mặt đổi — nó vừa bắt
    # được lần thêm này, và phải bắt được lần sau.
    moi_1b = {"collection_id", "open_count"}
    assert cu <= set(d), f"mất khoá cũ: {cu - set(d)}"
    assert moi <= set(d), f"thiếu khoá thư viện: {moi - set(d)}"
    assert moi_1b <= set(d), f"thiếu khoá Phase 1B: {moi_1b - set(d)}"
    assert set(d) == cu | moi | moi_1b, f"khoá lạ: {set(d) - cu - moi - moi_1b}"


def test_api_documents_khong_kem_khoi_ai(client, moi_truong):
    """Khối `ai` cần hai lượt đọc kho phù du; chỉ `/api/library` đáng trả giá đó."""
    moi_truong()
    assert "ai" not in client.get("/api/documents").get_json()["documents"][0]
    assert "ai" not in client.get("/api/documents/d1").get_json()


# ══════════════════════════════════════════ nhóm DB (cần Postgres thật) ════

def _can_db():
    from shared.env_loader import load_project_env
    load_project_env()
    return bool((os.getenv("TEST_DATABASE_URL") or "").strip())


db_only = pytest.mark.skipif(
    not _can_db(), reason="cần TEST_DATABASE_URL — xem `python -m scripts.setup_test_db --help`")


@pytest.fixture()
def owner():
    from app.db import session_scope
    from app.db.models import User
    from app.domains.auth import users_store

    u = users_store.create_user(f"lib_{uuid.uuid4().hex[:8]}@example.com", "password123")
    yield u["user_id"]
    with session_scope() as s:
        row = s.get(User, u["user_id"])
        if row is not None:
            s.delete(row)
    from app.domains.documents import repository as docs_repo
    docs_repo.invalidate_cache()


def _protect(main, monkeypatch, uid, on=True):
    monkeypatch.setattr(main, "_auth_protect_enabled", lambda: on)
    monkeypatch.setattr(main, "_current_user_id", lambda: uid)


def _upload(client, name="tai lieu thu vien.md"):
    return client.post("/api/documents/upload",
                       data={"file": (io.BytesIO(b"# Chuong 1\n\nnoi dung"), name)},
                       content_type="multipart/form-data")


@db_only
def test_db_luu_tru_khong_lam_tai_lieu_bien_mat_khoi_rag(be, client, monkeypatch, owner):
    """BA khẳng định này là lý do `archived_at` là một cột riêng chứ không phải một
    giá trị của `status`. Nếu ai đó "đơn giản hoá" bằng cách dùng `status`, đúng ba
    dòng dưới sẽ đỏ — trước khi tài liệu đã lưu trữ âm thầm rời khỏi truy hồi."""
    _protect(be, monkeypatch, owner, on=True)
    doc_id = _upload(client).get_json()["document_id"]

    assert client.patch(f"/api/documents/{doc_id}",
                        json={"archived": True}).status_code == 200

    from app.domains.documents import repository as docs_repo
    docs_repo.invalidate_cache()
    row = docs_repo.get(doc_id)

    assert row is not None, "tài liệu đã lưu trữ vẫn phải đọc được"
    assert row["archived_at"] is not None
    assert docs_repo.all_rows().get(doc_id) is not None, "phải còn trong all_rows()"

    stem = row["source_stem"]
    assert stem in be.owned_stems(owner), "phải còn trong owned_stems() → còn trong RAG"

    got = client.get(f"/api/documents/{doc_id}").get_json()
    assert got["status"] == "completed" or got["status"] in ("uploaded", "processing")
    assert got["status"] != "deleted"


@db_only
def test_db_bay_cot_moi_deu_di_tron_ven_qua_database(be, client, monkeypatch, owner):
    """Đường ghi → database → đường đọc, cho CẢ BẢY cột. Một cột chỉ có đường ghi
    là một tính năng ma (bài học `deleted_at` trong .playbook)."""
    _protect(be, monkeypatch, owner, on=True)
    doc_id = _upload(client).get_json()["document_id"]

    client.patch(f"/api/documents/{doc_id}", json={
        "display_name": "Hệ điều hành", "favorite": True, "pinned": True,
        "archived": True, "tags": ["AI", "Exam"]})
    client.post(f"/api/documents/{doc_id}/opened", json={"workspace": "quiz"})

    from app.domains.documents import repository as docs_repo
    docs_repo.invalidate_cache()
    row = docs_repo.get(doc_id)

    assert row["display_name"] == "Hệ điều hành"
    assert row["favorite"] is True
    assert row["pinned"] is True
    assert row["archived_at"] is not None
    assert row["tags"] == ["AI", "Exam"]
    assert row["last_opened_at"] is not None
    assert row["last_workspace"] == "quiz"

    d = [x for x in client.get("/api/library").get_json()["documents"]
         if x["document_id"] == doc_id][0]
    assert d["display_name"] == "Hệ điều hành" and d["last_workspace"] == "quiz"


@db_only
def test_db_ingest_khong_ghi_de_sieu_du_lieu_nguoi_dung(be, client, monkeypatch, owner):
    """`update_status` chỉ đụng `metadata_json` và `status`. Nếu nó từng chạm cột
    người dùng thì tên vừa đặt sẽ bốc hơi khi ingest chạy xong."""
    _protect(be, monkeypatch, owner, on=True)
    doc_id = _upload(client).get_json()["document_id"]
    client.patch(f"/api/documents/{doc_id}", json={"display_name": "Giữ nguyên",
                                                   "tags": ["AI"]})

    from app.domains.documents import repository as docs_repo
    docs_repo.update_status(doc_id, "ready", progress=1.0,
                            capabilities={"chunk_query": True, "memory_query": True})
    docs_repo.invalidate_cache()

    row = docs_repo.get(doc_id)
    assert row["display_name"] == "Giữ nguyên"
    assert row["tags"] == ["AI"]


@db_only
def test_db_upload_201_giu_nguyen_hinh_dang_va_kem_truong_thu_vien(be, client,
                                                                   monkeypatch, owner):
    _protect(be, monkeypatch, owner, on=True)
    r = _upload(client)
    assert r.status_code == 201
    d = r.get_json()
    assert d["document_id"] and d["title"] == "tai lieu thu vien.md"
    # Tài liệu vừa tạo: chưa đổi tên, chưa gắn thẻ, chưa mở.
    assert d["display_name"] is None and d["tags"] == []
    assert d["favorite"] is False and d["pinned"] is False
    assert d["last_opened_at"] is None and d["archived_at"] is None
    assert "ai" not in d


@db_only
def test_db_ingest_uploaded_file_van_duoc_goi_dung_mot_lan(be, client, monkeypatch, owner):
    """Phase này không được đụng luồng upload. Đếm lời gọi là cách khoá điều đó."""
    _protect(be, monkeypatch, owner, on=True)
    goc = be._ingest_uploaded_file
    lan_goi = []

    def dem(file):
        lan_goi.append(file.filename)
        return goc(file)

    monkeypatch.setattr(be, "_ingest_uploaded_file", dem)
    assert _upload(client).status_code == 201
    assert len(lan_goi) == 1
