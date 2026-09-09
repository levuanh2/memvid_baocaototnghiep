"""Bộ sưu tập + thao tác hàng loạt + xếp hạng (Phase 1B).

Cùng khuôn hai nhóm với `test_study_library_api.py`:

- **nhóm stub** chạy ở mọi máy — kiểm tra đầu vào, phạm vi quyền, hình dạng phản hồi
- **nhóm DB** (skip khi thiếu `TEST_DATABASE_URL`) — bất biến chỉ chứng minh được
  trên Postgres thật, quan trọng nhất: **xoá một bộ sưu tập KHÔNG xoá tài liệu nào**

Ràng buộc trung tâm của file này: bộ sưu tập là dọn dẹp, không phải xoá dữ liệu.
`ON DELETE SET NULL` là thứ giữ lời hứa đó, và test dưới là thứ giữ `SET NULL`.
"""

from __future__ import annotations

import io
import os
import uuid

import pytest

UID = "user-A"


# ══════════════════════════════════════════════ nhóm stub (không cần DB) ════

class BstGia:
    """Stub `bo_suu_tap`."""

    def __init__(self, rows=None):
        self.rows = dict(rows or {})
        self.da_xoa: list = []
        self.da_sua: list = []
        self.dem_liet_ke = 0

    @staticmethod
    def hang(cid="c1", name="Hệ điều hành", **kw):
        base = {"collection_id": cid, "name": name, "color": None, "icon": None,
                "sort_order": 0, "archived_at": None,
                "created_at": "2026-09-01T00:00:00Z", "document_count": 0}
        base.update(kw)
        return base

    def liet_ke(self, user_id):
        self.dem_liet_ke += 1
        return list(self.rows.values())

    def lay(self, collection_id, user_id=None):
        return dict(self.rows[collection_id]) if collection_id in self.rows else None

    def tao(self, *, user_id, name, color=None, icon=None, sort_order=None):
        cid = f"c{len(self.rows) + 1}"
        row = self.hang(cid, name, color=color, icon=icon,
                        sort_order=sort_order if sort_order is not None else len(self.rows))
        self.rows[cid] = row
        return dict(row)

    def cap_nhat(self, collection_id, **kw):
        if collection_id not in self.rows:
            return False
        self.da_sua.append((collection_id, kw))
        for k, v in kw.items():
            if k == "archived":
                self.rows[collection_id]["archived_at"] = "2026-09-09T00:00:00Z" if v else None
            else:
                self.rows[collection_id][k] = v
        return True

    def xoa(self, collection_id):
        if collection_id not in self.rows:
            return False
        self.da_xoa.append(collection_id)
        del self.rows[collection_id]
        return True


class DocsGia:
    def __init__(self, rows=None):
        self.rows = rows if rows is not None else {"d1": self.hang()}
        self.bulk: list = []
        self.bulk_xoa: list = []

    @staticmethod
    def hang(**kw):
        base = {"filename": "a.pdf", "source_stem": "a_pdf", "file_type": "pdf",
                "status": "ready", "spec_status": "completed", "progress": 1.0,
                "capabilities": {"chunk_query": True}, "page_count": 1,
                "char_count": 1000, "chunk_count": 3, "created_at": "2026-09-01T00:00:00Z",
                "user_id": UID, "display_name": None, "favorite": False, "pinned": False,
                "archived_at": None, "tags": [], "last_opened_at": None,
                "last_workspace": None, "collection_id": None, "open_count": 0}
        base.update(kw)
        return base

    def all_rows(self, *a, **k):
        return dict(self.rows)

    def get(self, document_id):
        return dict(self.rows[document_id]) if document_id in self.rows else None

    def set_library_fields(self, document_id, **kw):
        if document_id not in self.rows:
            return False
        if "collection_id" in kw:
            self.rows[document_id]["collection_id"] = kw["collection_id"]
        return True

    def touch_opened(self, document_id, workspace=None):
        return document_id in self.rows

    def languages_for(self, ids):
        return {}

    def ai_counts(self, user_id):
        return {"quizzes": {}, "reviews": {}, "studymaps": {}}

    def bulk_library_fields(self, ids, *, user_id=None, **kw):
        self.bulk.append((list(ids), user_id, kw))
        return len([i for i in ids if i in self.rows])

    def bulk_soft_delete(self, ids, *, user_id=None):
        self.bulk_xoa.append((list(ids), user_id))
        return len([i for i in ids if i in self.rows])


class KhoGia:
    def list_records(self, user_id=None, enforce_owner=False):
        return []


@pytest.fixture()
def be(client):
    import app.main as main
    return main


@pytest.fixture()
def moi_truong(be, monkeypatch):
    from app.domains.documents import bo_suu_tap as bst_mod
    from app.domains.documents import repository as docs_repo

    def cai_dat(collections=None, rows=None):
        bst = BstGia(collections)
        docs = DocsGia(rows)
        for ten in ("liet_ke", "lay", "tao", "cap_nhat", "xoa"):
            monkeypatch.setattr(bst_mod, ten, getattr(bst, ten))
        for ten in ("all_rows", "get", "set_library_fields", "touch_opened",
                    "languages_for", "ai_counts", "bulk_library_fields",
                    "bulk_soft_delete"):
            monkeypatch.setattr(docs_repo, ten, getattr(docs, ten))
        monkeypatch.setattr(be, "summary_store", KhoGia())
        monkeypatch.setattr(be, "mindmap_store", KhoGia())
        return bst, docs
    return cai_dat


# ── GET/POST /api/collections ───────────────────────────────────────────────

def test_liet_ke_bo_suu_tap(client, moi_truong):
    moi_truong(collections={"c1": BstGia.hang()})
    r = client.get("/api/collections")
    assert r.status_code == 200
    cs = r.get_json()["collections"]
    assert len(cs) == 1 and cs[0]["name"] == "Hệ điều hành"


def test_tao_bo_suu_tap(client, moi_truong):
    moi_truong()
    r = client.post("/api/collections", json={"name": "  Giải tích  ", "color": "blue"})
    assert r.status_code == 201
    b = r.get_json()
    assert b["name"] == "Giải tích"          # đã cắt trắng
    assert b["color"] == "blue"
    assert b["document_count"] == 0          # bộ sưu tập rỗng vẫn tồn tại


@pytest.mark.parametrize("ten", ["", "   ", None, 5, [], {}])
def test_tao_ten_khong_hop_le_bi_tu_choi(client, moi_truong, ten):
    moi_truong()
    assert client.post("/api/collections", json={"name": ten}).status_code == 400


def test_tao_ten_dai_qua_100_bi_tu_choi_dung_101_moi_hong(client, moi_truong):
    moi_truong()
    assert client.post("/api/collections", json={"name": "x" * 100}).status_code == 201
    assert client.post("/api/collections", json={"name": "x" * 101}).status_code == 400


def test_tao_mau_va_icon_qua_dai_bi_tu_choi(client, moi_truong):
    moi_truong()
    assert client.post("/api/collections",
                       json={"name": "A", "color": "x" * 21}).status_code == 400
    assert client.post("/api/collections",
                       json={"name": "A", "icon": "x" * 41}).status_code == 400


def test_tao_body_khong_phai_object(client, moi_truong):
    moi_truong()
    assert client.post("/api/collections", json=[1, 2]).status_code == 400


# ── PATCH/DELETE /api/collections/<id> ──────────────────────────────────────

def test_doi_ten_bo_suu_tap_khong_dung_toi_tai_lieu(client, moi_truong):
    """Tài liệu chỉ mang `collection_id`; tên nằm đúng một chỗ. Nên đổi tên là một
    lượt ghi, không phải N lượt — và không có bản sao nào để lệch."""
    bst, docs = moi_truong(collections={"c1": BstGia.hang()},
                           rows={"d1": DocsGia.hang(collection_id="c1")})
    r = client.patch("/api/collections/c1", json={"name": "Tên mới"})
    assert r.status_code == 200 and r.get_json()["name"] == "Tên mới"
    assert docs.rows["d1"]["collection_id"] == "c1"      # tài liệu không bị chạm


def test_patch_bo_suu_tap_tung_truong(client, moi_truong):
    moi_truong(collections={"c1": BstGia.hang()})
    b = client.patch("/api/collections/c1",
                     json={"color": "red", "icon": "BookOpen", "sort_order": 3}).get_json()
    assert (b["color"], b["icon"], b["sort_order"]) == ("red", "BookOpen", 3)


def test_patch_luu_tru_bo_suu_tap(client, moi_truong):
    moi_truong(collections={"c1": BstGia.hang()})
    assert client.patch("/api/collections/c1", json={"archived": True}
                        ).get_json()["archived_at"] is not None
    assert client.patch("/api/collections/c1", json={"archived": False}
                        ).get_json()["archived_at"] is None


@pytest.mark.parametrize("than,ma", [
    ({}, 400), ({"name": ""}, 400), ({"sort_order": "1"}, 400),
    ({"sort_order": True}, 400), ({"archived": "yes"}, 400), ({"color": 5}, 400),
])
def test_patch_bo_suu_tap_dau_vao_xau(client, moi_truong, than, ma):
    moi_truong(collections={"c1": BstGia.hang()})
    assert client.patch("/api/collections/c1", json=than).status_code == ma


def test_patch_bo_suu_tap_khong_ton_tai_la_404(client, moi_truong):
    moi_truong()
    assert client.patch("/api/collections/khong-co", json={"name": "X"}).status_code == 404


def test_xoa_bo_suu_tap(client, moi_truong):
    bst, _ = moi_truong(collections={"c1": BstGia.hang()})
    r = client.delete("/api/collections/c1")
    assert r.status_code == 200 and r.get_json()["deleted"] is True
    assert bst.da_xoa == ["c1"]


def test_xoa_bo_suu_tap_khong_ton_tai_la_404(client, moi_truong):
    moi_truong()
    assert client.delete("/api/collections/khong-co").status_code == 404


# ── gán bộ sưu tập cho tài liệu ─────────────────────────────────────────────

def test_gan_tai_lieu_vao_bo_suu_tap(client, moi_truong):
    _, docs = moi_truong(collections={"c1": BstGia.hang()})
    r = client.patch("/api/documents/d1", json={"collection_id": "c1"})
    assert r.status_code == 200
    assert docs.rows["d1"]["collection_id"] == "c1"


@pytest.mark.parametrize("gt", [None, ""])
def test_bo_tai_lieu_khoi_bo_suu_tap(client, moi_truong, gt):
    _, docs = moi_truong(collections={"c1": BstGia.hang()},
                         rows={"d1": DocsGia.hang(collection_id="c1")})
    assert client.patch("/api/documents/d1", json={"collection_id": gt}).status_code == 200
    assert docs.rows["d1"]["collection_id"] is None


def test_gan_bo_suu_tap_khong_ton_tai_bi_tu_choi(client, moi_truong):
    """400 "không tồn tại", KHÔNG phải 403: xác nhận id đó có thật là dựng oracle."""
    moi_truong()
    r = client.patch("/api/documents/d1", json={"collection_id": "khong-co"})
    assert r.status_code == 400
    assert "403" not in r.get_data(as_text=True)


def test_collection_id_sai_kieu_bi_tu_choi(client, moi_truong):
    moi_truong()
    assert client.patch("/api/documents/d1", json={"collection_id": 5}).status_code == 400


# ── /api/library kèm bộ sưu tập ─────────────────────────────────────────────

def test_library_kem_danh_sach_bo_suu_tap(client, moi_truong):
    bst, _ = moi_truong(collections={"c1": BstGia.hang()})
    b = client.get("/api/library").get_json()
    assert "collections" in b and len(b["collections"]) == 1
    assert bst.dem_liet_ke == 1              # một lượt, không phải theo từng tài liệu


def test_library_khong_nhung_ten_bo_suu_tap_vao_tung_tai_lieu(client, moi_truong):
    """Tài liệu mang KHOÁ, không mang tên. Nhúng tên là nhân bản dữ liệu, và bản
    nhúng lệch ngay lần đổi tên đầu tiên."""
    moi_truong(collections={"c1": BstGia.hang()},
               rows={"d1": DocsGia.hang(collection_id="c1")})
    d = client.get("/api/library").get_json()["documents"][0]
    assert d["collection_id"] == "c1"
    assert "collection_name" not in d
    assert "Hệ điều hành" not in str(d)


def test_library_khong_tra_mang_the_rieng(client, moi_truong):
    """Thẻ đã nằm trên từng tài liệu; trả thêm một mảng gộp là nhân bản dữ liệu."""
    moi_truong(rows={"d1": DocsGia.hang(tags=["AI"])})
    b = client.get("/api/library").get_json()
    assert set(b) == {"documents", "collections"}


def test_library_kho_bo_suu_tap_hong_van_tra_ve_thu_vien(client, be, moi_truong,
                                                          monkeypatch):
    moi_truong()
    from app.domains.documents import bo_suu_tap as bst_mod

    def no(*a, **k):
        raise RuntimeError("db down")
    monkeypatch.setattr(bst_mod, "liet_ke", no)

    r = client.get("/api/library")
    assert r.status_code == 200
    assert r.get_json()["collections"] == []
    assert len(r.get_json()["documents"]) == 1     # tài liệu vẫn hiện


# ── POST /api/documents/bulk ────────────────────────────────────────────────

@pytest.mark.parametrize("hanh_dong,mong", [
    ("pin", {"pinned": True}), ("unpin", {"pinned": False}),
    ("favorite", {"favorite": True}), ("unfavorite", {"favorite": False}),
    ("archive", {"archived": True}), ("unarchive", {"archived": False}),
])
def test_bulk_bat_tat_co(client, moi_truong, hanh_dong, mong):
    _, docs = moi_truong()
    r = client.post("/api/documents/bulk",
                    json={"document_ids": ["d1"], "action": hanh_dong})
    assert r.status_code == 200 and r.get_json()["updated"] == 1
    assert docs.bulk[-1][2] == mong


def test_bulk_chuyen_bo_suu_tap(client, moi_truong):
    _, docs = moi_truong(collections={"c1": BstGia.hang()})
    r = client.post("/api/documents/bulk", json={
        "document_ids": ["d1"], "action": "move_collection", "collection_id": "c1"})
    assert r.status_code == 200
    assert docs.bulk[-1][2] == {"collection_id": "c1"}


def test_bulk_bo_khoi_bo_suu_tap(client, moi_truong):
    _, docs = moi_truong()
    client.post("/api/documents/bulk", json={
        "document_ids": ["d1"], "action": "move_collection", "collection_id": None})
    assert docs.bulk[-1][2] == {"collection_id": None}


def test_bulk_chuyen_vao_bo_suu_tap_khong_ton_tai_bi_tu_choi(client, moi_truong):
    moi_truong()
    assert client.post("/api/documents/bulk", json={
        "document_ids": ["d1"], "action": "move_collection",
        "collection_id": "khong-co"}).status_code == 400


def test_bulk_them_va_bo_the(client, moi_truong):
    _, docs = moi_truong()
    client.post("/api/documents/bulk",
                json={"document_ids": ["d1"], "action": "add_tags", "tags": ["AI", "ai"]})
    assert docs.bulk[-1][2] == {"them_tags": ["AI"]}      # khử trùng, giữ cách viết đầu
    client.post("/api/documents/bulk",
                json={"document_ids": ["d1"], "action": "remove_tags", "tags": ["AI"]})
    assert docs.bulk[-1][2] == {"bo_tags": ["AI"]}


def test_bulk_the_rong_bi_tu_choi(client, moi_truong):
    moi_truong()
    for tags in ([], ["  "], None):
        assert client.post("/api/documents/bulk", json={
            "document_ids": ["d1"], "action": "add_tags", "tags": tags}).status_code == 400


def test_bulk_xoa_dung_cung_ngu_nghia_voi_xoa_mem_don_le(client, moi_truong):
    _, docs = moi_truong()
    r = client.post("/api/documents/bulk", json={"document_ids": ["d1"], "action": "delete"})
    assert r.status_code == 200 and r.get_json()["updated"] == 1
    assert docs.bulk_xoa == [(["d1"], None)]
    assert docs.bulk == []       # KHÔNG đi qua đường ghi siêu dữ liệu


@pytest.mark.parametrize("than", [
    {"document_ids": [], "action": "pin"},
    {"document_ids": "d1", "action": "pin"},
    {"document_ids": [1, 2], "action": "pin"},
    {"document_ids": ["d1"], "action": "khong-co"},
    {"document_ids": ["d1"]},
    {"action": "pin"},
])
def test_bulk_dau_vao_xau_bi_tu_choi(client, moi_truong, than):
    moi_truong()
    assert client.post("/api/documents/bulk", json=than).status_code == 400


def test_bulk_qua_200_bi_tu_choi_dung_200_thi_khong(client, moi_truong):
    moi_truong()
    ids = [f"d{i}" for i in range(200)]
    assert client.post("/api/documents/bulk",
                       json={"document_ids": ids, "action": "pin"}).status_code == 200
    assert client.post("/api/documents/bulk",
                       json={"document_ids": ids + ["x"], "action": "pin"}).status_code == 400


def test_bulk_id_cua_nguoi_khac_bi_bo_qua_lang_le(client, be, moi_truong, monkeypatch):
    """Bỏ qua, KHÔNG báo lỗi — báo lỗi là xác nhận id đó có thật. Số `updated` vẫn
    cho client biết có gì đó không áp dụng được."""
    _, docs = moi_truong(rows={"cua_toi": DocsGia.hang(user_id=UID)})
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: True)
    monkeypatch.setattr(be, "_current_user_id", lambda: UID)

    r = client.post("/api/documents/bulk",
                    json={"document_ids": ["cua_toi", "cua_nguoi_khac"], "action": "pin"})
    assert r.status_code == 200
    assert r.get_json()["updated"] == 1
    assert docs.bulk[-1][1] == UID          # phạm vi quyền đi XUỐNG truy vấn


def test_bulk_401_khi_bat_bao_ve_ma_khong_co_token(client, be, monkeypatch):
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: True)
    monkeypatch.setattr(be, "_current_user_id", lambda: None)
    assert client.post("/api/documents/bulk",
                       json={"document_ids": ["d1"], "action": "pin"}).status_code == 401


# ══════════════════════════════════════════ nhóm DB (cần Postgres thật) ════

def _can_db():
    from shared.env_loader import load_project_env
    load_project_env()
    return bool((os.getenv("TEST_DATABASE_URL") or "").strip())


db_only = pytest.mark.skipif(not _can_db(), reason="cần TEST_DATABASE_URL")


@pytest.fixture()
def owner():
    from app.db import session_scope
    from app.db.models import User
    from app.domains.auth import users_store

    u = users_store.create_user(f"bst_{uuid.uuid4().hex[:8]}@example.com", "password123")
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


def _upload(client, name="tai lieu bst.md"):
    return client.post("/api/documents/upload",
                       data={"file": (io.BytesIO(b"# C1\n\nnoi dung"), name)},
                       content_type="multipart/form-data")


@db_only
def test_db_xoa_bo_suu_tap_KHONG_xoa_tai_lieu(be, client, monkeypatch, owner):
    """BẤT BIẾN TRUNG TÂM của Phase 1B. Nếu khoá ngoại từng bị đổi sang CASCADE thì
    dòng dưới sẽ đỏ — trước khi một cú "xoá bộ sưu tập" cuốn theo cả tài liệu."""
    _protect(be, monkeypatch, owner)
    doc_id = _upload(client).get_json()["document_id"]
    cid = client.post("/api/collections", json={"name": "Tạm"}).get_json()["collection_id"]
    client.patch(f"/api/documents/{doc_id}", json={"collection_id": cid})

    assert client.delete(f"/api/collections/{cid}").status_code == 200

    from app.domains.documents import repository as docs_repo
    docs_repo.invalidate_cache()
    row = docs_repo.get(doc_id)
    assert row is not None, "xoá bộ sưu tập KHÔNG được xoá tài liệu"
    assert row["collection_id"] is None, "tài liệu phải về 'chưa phân loại'"
    assert row["status"] != "deleted"


@db_only
def test_db_open_count_tang_moi_lan_mo(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    doc_id = _upload(client).get_json()["document_id"]

    from app.domains.documents import repository as docs_repo
    assert docs_repo.get(doc_id)["open_count"] == 0
    for _ in range(3):
        client.post(f"/api/documents/{doc_id}/opened", json={"workspace": "summary"})
        docs_repo.invalidate_cache()
    assert docs_repo.get(doc_id)["open_count"] == 3


@db_only
def test_db_bulk_mot_phien_cho_nhieu_tai_lieu(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    ids = [_upload(client, f"tl {i}.md").get_json()["document_id"] for i in range(3)]

    r = client.post("/api/documents/bulk", json={"document_ids": ids, "action": "pin"})
    assert r.get_json()["updated"] == 3

    from app.domains.documents import repository as docs_repo
    docs_repo.invalidate_cache()
    assert all(docs_repo.get(i)["pinned"] for i in ids)


@db_only
def test_db_bulk_the_hop_nhat_khong_ghi_de(be, client, monkeypatch, owner):
    """Gắn thẻ hàng loạt phải CỘNG vào thẻ sẵn có. Ghi đè sẽ xoá thẻ riêng của từng
    tài liệu — thứ người dùng không hề yêu cầu."""
    _protect(be, monkeypatch, owner)
    doc_id = _upload(client).get_json()["document_id"]
    client.patch(f"/api/documents/{doc_id}", json={"tags": ["Riêng"]})

    client.post("/api/documents/bulk",
                json={"document_ids": [doc_id], "action": "add_tags", "tags": ["Chung"]})
    from app.domains.documents import repository as docs_repo
    docs_repo.invalidate_cache()
    assert set(docs_repo.get(doc_id)["tags"]) == {"Riêng", "Chung"}

    client.post("/api/documents/bulk",
                json={"document_ids": [doc_id], "action": "remove_tags", "tags": ["Chung"]})
    docs_repo.invalidate_cache()
    assert docs_repo.get(doc_id)["tags"] == ["Riêng"]


@db_only
def test_db_bo_suu_tap_rong_van_liet_ke_duoc(be, client, monkeypatch, owner):
    """`outerjoin`, không phải `join`: tạo xong một bộ sưu tập rồi thấy nó biến mất
    cho tới khi bỏ tài liệu vào là một lỗi rất dễ mắc."""
    _protect(be, monkeypatch, owner)
    client.post("/api/collections", json={"name": "Rỗng"})
    cs = client.get("/api/collections").get_json()["collections"]
    assert [c["name"] for c in cs] == ["Rỗng"]
    assert cs[0]["document_count"] == 0
