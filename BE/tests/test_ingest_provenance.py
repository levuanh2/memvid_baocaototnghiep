"""Nhãn `ingest_origin`: ai ghi nó, ai KHÔNG ghi được nó, và nó chặn được gì.

Nhãn này là điều kiện thứ ba để một tài liệu vào index production, cạnh hai quyết định
của con người trong `production_index_allowlist.json`. Hai điều kiện kia nằm trong một
file người ta sửa được; điều kiện này do máy ghi lúc tạo hàng. Nếu client đặt được nó
thì cả ba điều kiện sụp cùng lúc — nên phần lớn test ở đây là về chuyện đó.

Không test nào ở file này chạm database — kể cả database test. Session Postgres duy
nhất bị đụng tới là một session GIẢ trong `test_create_tu_ghi_nhan_...`, để chạy được
hàm `create()` thật mà không cần Postgres.
"""

from __future__ import annotations

import contextlib
import inspect
import json

import pytest

from app.domains.documents import provenance as prov
from app.domains.vectorstore import allowlist as al


# ── Hàm quyết định nguồn ───────────────────────────────────────────────────
def test_mac_dinh_KHONG_phai_production(monkeypatch):
    """Không cấu hình gì thì không phải production. Đây là mặc định đóng."""
    monkeypatch.delenv(prov.BIEN_MOI_TRUONG, raising=False)
    monkeypatch.setattr("app.db.dang_chay_pytest", lambda: False)
    assert prov.nguon_ingest() == prov.NGUON_LOCAL


def test_cau_hinh_dung_chuoi_thi_ra_production(monkeypatch):
    monkeypatch.setenv(prov.BIEN_MOI_TRUONG, "production")
    monkeypatch.setattr("app.db.dang_chay_pytest", lambda: False)
    assert prov.nguon_ingest() == prov.NGUON_PRODUCTION


@pytest.mark.parametrize("gia_tri", ["prod", "PRODUCTION ", "", "  ", "1", "true",
                                     "production!", "producton"])
def test_gia_tri_gan_dung_KHONG_thanh_production(monkeypatch, gia_tri):
    """`PRODUCTION ` có khoảng trắng thì strip+lower vẫn khớp — nên nó PHẢI khớp.
    Mọi biến thể khác không khớp: đoán hộ một lỗi gõ là cách một tài liệu thử nghiệm
    lọt vào index production."""
    monkeypatch.setenv(prov.BIEN_MOI_TRUONG, gia_tri)
    monkeypatch.setattr("app.db.dang_chay_pytest", lambda: False)
    mong_doi = (prov.NGUON_PRODUCTION if gia_tri.strip().lower() == "production"
                else prov.NGUON_LOCAL)
    assert prov.nguon_ingest() == mong_doi


def test_pytest_THANG_cau_hinh_production(monkeypatch):
    """Ca quan trọng nhất của hàm này.

    Một biến `INGEST_ORIGIN=production` còn sót trong shell, hay một `.env` bê nhầm
    từ production về, sẽ khiến MỌI tài liệu do bộ test sinh ra mang nhãn production —
    tức đủ điều kiện vào index. Cờ pytest phải thắng, và nó được kiểm ở đây bằng
    chính bộ test đang chạy chứ không phải bằng một cờ giả.
    """
    monkeypatch.setenv(prov.BIEN_MOI_TRUONG, "production")
    assert prov.nguon_ingest() == prov.NGUON_TEST


def test_la_production_chi_nhan_dung_mot_gia_tri():
    assert prov.la_production("production") is True
    for x in (None, "", "local", "test", 1, True, {"ingest_origin": "production"}, ["production"]):
        assert prov.la_production(x) is False, x


# ── Client KHÔNG chèn được nhãn ────────────────────────────────────────────
def test_create_KHONG_nhan_nguon_lam_tham_so():
    """Cấu trúc, không phải văn bản: nếu `create()` có tham số nhận nguồn thì sớm muộn
    một route sẽ chuyền vào đó giá trị lấy từ request. Không có tham số thì không có
    đường."""
    from app.domains.documents import repository as _docs

    tham_so = set(inspect.signature(_docs.create).parameters)
    assert not {t for t in tham_so if "origin" in t.lower() or "nguon" in t.lower()}


def test_route_upload_KHONG_chuyen_gi_ve_nguon_xuong_repository(monkeypatch, tmp_path):
    """Ranh giới ứng dụng THẬT: một request HTTP mang đủ kiểu nhãn giả — form field,
    JSON, header, query string — rồi bắt lấy đúng kwargs mà route truyền xuống
    `repository.create`. Không kwargs nào được mang nguồn."""
    import io as _io

    import app.main as be

    ghi_lai: dict = {}

    def create_gia(**kw):
        ghi_lai.update(kw)
        return {"filename": kw.get("filename"), "status": "processing",
                "source_stem": "x", "progress": 0.0, "created_at": "2026-01-01T00:00:00"}

    from app.domains.documents import repository as _docs
    monkeypatch.setattr(_docs, "create", create_gia)
    monkeypatch.setattr(be, "_trigger_background_ingest", lambda *a, **k: None)
    monkeypatch.setattr(be, "INPUT_DIR", str(tmp_path))
    monkeypatch.setattr(be, "_current_user_id", lambda: None)
    monkeypatch.setattr(be, "_require_app_user", lambda: (None, None))

    c = be.app.test_client()
    r = c.post(
        "/upload-file?ingest_origin=production",
        data={"file": (_io.BytesIO(b"# xin chao"), "tai-lieu.md"),
              "ingest_origin": "production",
              "metadata_json": '{"ingest_origin": "production"}',
              "ingest_source": "render"},
        headers={"X-Ingest-Origin": "production"},
        content_type="multipart/form-data")

    assert r.status_code == 200, r.get_data(as_text=True)[:200]
    assert ghi_lai, "route không gọi tới repository.create"
    for k, v in ghi_lai.items():
        assert "production" != v, f"{k} mang giá trị production từ request"
        assert "origin" not in k.lower()


def test_create_tu_ghi_nhan_va_duoi_pytest_thi_ra_test(monkeypatch):
    """Chạy THẬT `repository.create()` với một session giả — không Postgres, không
    mock hàm nguồn. Dưới pytest, nhãn phải là `test`, kể cả khi env nói production."""
    from app.db.models import Document
    from app.domains.documents import repository as _docs

    monkeypatch.setenv(prov.BIEN_MOI_TRUONG, "production")
    da_them: list[Document] = []

    class KetQuaRong:
        def scalar_one_or_none(self): return None

    class SessionGia:
        def add(self, obj): da_them.append(obj)
        def flush(self): pass
        def refresh(self, obj): pass
        # `_row()` hỏi user ẩn danh để quyết định có che `user_id` đi không.
        def execute(self, *a, **k): return KetQuaRong()

    @contextlib.contextmanager
    def scope_gia():
        yield SessionGia()

    monkeypatch.setattr(_docs, "session_scope", scope_gia)
    monkeypatch.setattr(_docs, "invalidate_cache", lambda: None)

    row = _docs.create(document_id="d-1", filename="a.md", file_type="md",
                       file_path="k/a.md", user_id="u-1", input_path="/tmp/a.md")

    assert len(da_them) == 1
    assert da_them[0].metadata_json["ingest_origin"] == prov.NGUON_TEST
    assert row["ingest_origin"] == prov.NGUON_TEST


# ── Nhãn chặn được gì ở allowlist ──────────────────────────────────────────
DUOC_DUYET = {"d": {"classification": al.CONFIRMED_PRODUCTION, "eligible_for_index": True}}


@pytest.mark.parametrize("nguon,mong_doi", [
    ("production", True),
    ("test", False),
    ("local", False),
    (None, False),
    ("", False),
    ("Production", False),   # nhãn trong DB không được chuẩn hoá lại lúc đọc
])
def test_eligibility_doi_hoi_nguon_production(nguon, mong_doi):
    assert al.duoc_index("d", DUOC_DUYET, ingest_origin=nguon) is mong_doi


def test_khong_truyen_nguon_thi_bi_chan():
    """Người gọi quên truyền = không biết nguồn = không được index. Mặc định đóng
    phải đúng cả với lỗi của người gọi, không chỉ với dữ liệu xấu."""
    assert al.duoc_index("d", DUOC_DUYET) is False


def test_nguon_production_KHONG_tu_no_du_de_index():
    """Chiều ngược lại của hàng rào: nhãn đúng nhưng chưa ai duyệt thì vẫn không vào.
    Ba điều kiện là VÀ, không phải HOẶC."""
    for ds in ({},
               {"d": {"classification": al.AMBIGUOUS, "eligible_for_index": False}},
               {"d": {"classification": al.CONFIRMED_TEST, "eligible_for_index": True}},
               {"d": {"classification": al.CONFIRMED_PRODUCTION, "eligible_for_index": False}}):
        assert al.duoc_index("d", ds, ingest_origin="production") is False, ds


def test_loc_ban_ghi_doc_nguon_tu_chinh_ban_ghi():
    ban_ghi = [{"document_id": "d", "text": "a", "ingest_origin": "production"},
               {"document_id": "d", "text": "b", "ingest_origin": "local"},
               {"document_id": "d", "text": "c"}]
    giu = al.loc_ban_ghi(ban_ghi, DUOC_DUYET)
    assert [b["text"] for b in giu] == ["a"]


# ── Ngữ liệu đang có KHÔNG được động tới ───────────────────────────────────
def test_11_tai_lieu_hien_tai_van_KHONG_the_vao_index():
    """Allowlist THẬT của kho + bản ghi không mang nhãn (đúng như 11 hàng trong DB,
    tất cả tạo trước khi có trường này). Kết quả phải là rỗng.

    Test này đỏ nếu có người vừa gắn nhãn production cho tài liệu cũ vừa duyệt nó —
    hai việc mà phase này CẤM làm."""
    ds = al.tai()
    MOI = "f01ac8c1-830e-45e1-a802-7713c20982c3"
    ban_ghi = [{"document_id": did, "text": "x"} for did in ds if did != MOI]
    assert al.loc_ban_ghi(ban_ghi, ds) == []
    assert al.tom_tat(ban_ghi, ds)["eligible_chunks"] == 0


def test_allowlist_that_chi_duyet_tai_lieu_production():
    """Từ 2026-09-04 có đúng MỘT mục được duyệt — tài liệu production đầu tiên. Mọi
    tài liệu khác vẫn bị chặn kể cả khi giả định nhãn nguồn là production."""
    ds = al.tai()
    assert len(ds) == 13
    duyet = [d for d in ds if al.duoc_index(d, ds, ingest_origin="production")]
    assert duyet == ["f01ac8c1-830e-45e1-a802-7713c20982c3"], duyet


def test_rebuild_mang_nguon_tu_hang_tai_lieu_xuong_chunk():
    """Nếu `doc_chunks_tu_db` đánh rơi nhãn thì mọi thứ vẫn CHẠY — chỉ là không tài
    liệu nào vào index được nữa, im lặng. Khoá lại đường đi của nhãn."""
    from app.domains.vectorstore import rebuild as rb

    rows = {"d1": {"source_stem": "s1", "status": "ready", "ingest_origin": "production"},
            "d2": {"source_stem": "s2", "status": "ready", "ingest_origin": "local"},
            "d3": {"source_stem": "s3", "status": "ready"}}
    ra = rb.doc_chunks_tu_db(
        liet_ke_tai_lieu=lambda: rows,
        liet_ke_chunk=lambda did, limit, offset: (
            [{"chunk_id": f"{did}-c", "text": "noi dung"}] if offset == 0 else []))
    assert {b["document_id"]: b["ingest_origin"] for b in ra} == {
        "d1": "production", "d2": "local", "d3": None}


# ── Endpoint khai báo cấu hình ─────────────────────────────────────────────
def _config_status(monkeypatch, **env):
    import app.main as be

    for k, v in env.items():
        if v is None:
            monkeypatch.delenv(k, raising=False)
        else:
            monkeypatch.setenv(k, v)
    r = be.app.test_client().get("/api/config/status")
    assert r.status_code == 200
    return r.get_json()


def test_config_status_khai_dung_nhan_nguon(monkeypatch):
    """Endpoint này tồn tại để trả lời "production ĐANG chạy cấu hình gì" bằng đo,
    không bằng đoán. Dưới pytest nó phải khai `test` — cùng một hàm, cùng một luật."""
    assert _config_status(monkeypatch, INGEST_ORIGIN="production")["ingest_origin"] == "test"


def test_config_status_phan_anh_embedding_bat_tat(monkeypatch):
    tat = _config_status(monkeypatch, FPT_AI_EMBEDDING_MODEL=None)
    assert tat["embedding"]["enabled"] is False

    bat = _config_status(monkeypatch, FPT_AI_EMBEDDING_MODEL="Vietnamese_Embedding",
                         FPT_AI_API_KEY="khoa-gia-cho-test")
    assert bat["embedding"]["enabled"] is True
    assert bat["embedding"]["embedding_provider"] == "fpt"
    assert bat["embedding"]["embedding_model_name"] == "Vietnamese_Embedding"
    assert bat["embedding"]["embedding_strategy"] == "api_pooled"


def test_config_status_KHONG_lo_gia_tri_khoa(monkeypatch):
    """Chỉ CÓ hay KHÔNG. Một endpoint không xác thực mà in khoá ra là cách nhanh nhất
    biến tiện ích vận hành thành lỗ bảo mật."""
    khoa = "fpt-khoa-that-khong-duoc-lo-9a8b7c6d"
    body = _config_status(monkeypatch, FPT_AI_API_KEY=khoa)
    assert body["fpt_api_key_present"] is True
    assert khoa not in json.dumps(body)
    for v in json.dumps(body).split('"'):
        assert khoa[:12] not in v


def test_config_status_khai_kho_object_da_cau_hinh_chua(monkeypatch):
    """Bật persistence mà thiếu credential Supabase thì khôi phục lúc khởi động im lặng
    bỏ qua, và bản gốc người dùng tải lên cũng nằm lại trên đĩa phù du. Từ ngoài không
    nhìn ra được — đo 2026-09-04 mới lộ. Endpoint phải khai thẳng."""
    thieu = _config_status(monkeypatch, SUPABASE_URL=None, SUPABASE_SECRET_KEY=None)
    assert thieu["supabase_storage_configured"] is False

    du = _config_status(monkeypatch, SUPABASE_URL="https://vi-du.supabase.co",
                        SUPABASE_SECRET_KEY="khoa-gia-cho-test")
    assert du["supabase_storage_configured"] is True
