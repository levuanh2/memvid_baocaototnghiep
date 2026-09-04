"""Không tài liệu nào vào index production trừ khi được allowlist TƯỜNG MINH.

Đây là hàng rào cuối trước khi ngữ liệu production thành vector. Bối cảnh: trong 11
tài liệu production, 5 tài liệu (184/189 chunk — 97%) KHÔNG phân loại được bằng bằng
chứng trực tiếp. Với tỉ lệ đó, một danh sách CHẶN sẽ để lọt mọi thứ chưa nghĩ ra, còn
danh sách CHO PHÉP thì chặn mọi thứ chưa nghĩ ra. Khác biệt giữa "an toàn" và "may".

Điều file này khoá: đúng MỘT tổ hợp cho phép index, và mọi con đường khác — kể cả
những con đường trông rất giống "chắc là được" — đều không.
"""

from __future__ import annotations

import json

import pytest

from app.domains.vectorstore import allowlist as al
from app.domains.vectorstore import rebuild as rb

DID = "11111111-2222-3333-4444-555555555555"


def _ban(pl: str, ok: bool) -> dict:
    return {"classification": pl, "eligible_for_index": ok}


# ── Chỉ một tổ hợp cho phép ────────────────────────────────────────────────
def test_CONFIRMED_PRODUCTION_va_eligible_true_va_nguon_production_moi_duoc_index():
    """Từ 2026-09-04 có ĐIỀU KIỆN THỨ BA: nhãn `ingest_origin` do server ghi lúc tạo
    hàng. Hai điều kiện dưới đây là quyết định của con người trong một file; điều kiện
    thứ ba là sự thật do máy ghi. Xem `test_ingest_provenance.py`."""
    assert al.duoc_index(DID, {DID: _ban(al.CONFIRMED_PRODUCTION, True)},
                         ingest_origin="production") is True
    assert al.duoc_index(DID, {DID: _ban(al.CONFIRMED_PRODUCTION, True)}) is False


@pytest.mark.parametrize("pl,ok", [
    (al.AMBIGUOUS, False),
    (al.AMBIGUOUS, True),            # phân loại mơ hồ thì cờ bật cũng không đủ
    (al.UNKNOWN, False),
    (al.UNKNOWN, True),
    (al.CONFIRMED_TEST, False),
    (al.CONFIRMED_TEST, True),
    (al.CONFIRMED_PRODUCTION, False),  # là thật nhưng CHƯA cho phép index
])
def test_moi_to_hop_khac_deu_KHONG_duoc_index(pl, ok):
    # Nguồn `production` để test này đo đúng chiều PHÂN LOẠI, không đỏ nhờ ăn may ở
    # điều kiện nguồn gốc.
    assert al.duoc_index(DID, {DID: _ban(pl, ok)}, ingest_origin="production") is False


def test_khong_co_ban_ghi_thi_KHONG_duoc_index():
    """Vắng mặt KHÔNG BAO GIỜ là cho phép. Đây là khác biệt cốt lõi giữa allowlist và
    blocklist, và là lý do cả cơ chế này tồn tại."""
    assert al.duoc_index(DID, {}) is False
    assert al.duoc_index(DID, {"tai-lieu-khac": _ban(al.CONFIRMED_PRODUCTION, True)}) is False


def test_phan_loai_va_duoc_index_la_HAI_chuyen():
    """`CONFIRMED_PRODUCTION` + `eligible=false` là trạng thái HỢP LỆ. Mã không được
    coi "không phải test" là "an toàn để index"."""
    ds = {DID: _ban(al.CONFIRMED_PRODUCTION, False)}
    assert ds[DID]["classification"] == al.CONFIRMED_PRODUCTION
    assert al.duoc_index(DID, ds) is False


@pytest.mark.parametrize("gia_tri", [None, "true", 1, "yes", "", 0])
def test_eligible_phai_dung_kieu_bool(gia_tri):
    """`"false"` là chuỗi và chuỗi rỗng thì falsy, chuỗi khác thì truthy — đúng loại
    nhầm lẫn biến một dòng cấu hình thành một tài liệu được index."""
    ds = {DID: {"classification": al.CONFIRMED_PRODUCTION, "eligible_for_index": gia_tri}}
    assert al.duoc_index(DID, ds) is False


# ── Không suy diễn eligibility từ bất cứ thuộc tính nào khác ───────────────
@pytest.mark.parametrize("ban_ghi", [
    {"chunk_count": 132},                          # có nhiều chunk
    {"filename": "Bai giang dao ham.pptx"},        # tên trông chính đáng
    {"owner_email": "sinhvien@truong.edu.vn"},     # email trông chính đáng
    {"status": "completed"},                       # ingest xong
    {"classification": al.CONFIRMED_PRODUCTION},   # thiếu cờ eligible
    {"eligible_for_index": True},                  # thiếu phân loại
])
def test_KHONG_suy_dien_eligibility_tu_thuoc_tinh_khac(ban_ghi):
    assert al.duoc_index(DID, {DID: ban_ghi}) is False


# ── Lọc bản ghi ────────────────────────────────────────────────────────────
def _chunks(doc: str, n: int, nguon: str = "production"):
    """Mặc định mang nhãn `production`: các test dưới đây kiểm hàng rào ALLOWLIST, nên
    điều kiện nguồn gốc phải đã thoả để nó không che mất thứ đang được đo. Hàng rào
    nguồn gốc có file test riêng (`test_ingest_provenance.py`)."""
    return [{"chunk_id": f"{doc}-{i}", "document_id": doc, "source_stem": doc,
             "text": f"doan {i}", "ingest_origin": nguon} for i in range(n)]


def test_loc_giu_dung_tai_lieu_duoc_phep():
    bg = _chunks("cho-phep", 3) + _chunks("chan", 5)
    ds = {"cho-phep": _ban(al.CONFIRMED_PRODUCTION, True),
          "chan": _ban(al.AMBIGUOUS, False)}
    ra = al.loc_ban_ghi(bg, ds)
    assert len(ra) == 3
    assert {b["document_id"] for b in ra} == {"cho-phep"}


def test_loc_bo_het_khi_allowlist_rong():
    assert al.loc_ban_ghi(_chunks("d1", 4), {}) == []


def test_tom_tat_dem_dung():
    bg = _chunks("ok", 2) + _chunks("mo-ho", 7) + _chunks("la", 1)
    ds = {"ok": _ban(al.CONFIRMED_PRODUCTION, True),
          "mo-ho": _ban(al.AMBIGUOUS, False)}
    tt = al.tom_tat(bg, ds)
    assert tt["eligible_documents"] == 1 and tt["eligible_chunks"] == 2
    assert tt["blocked_documents"] == 2 and tt["blocked_chunks"] == 8
    assert tt["ambiguous_documents"] == 1 and tt["ambiguous_chunks"] == 7
    assert tt["khong_co_ban_ghi_documents"] == 1 and tt["khong_co_ban_ghi_chunks"] == 1


# ── Đọc file ───────────────────────────────────────────────────────────────
def test_thieu_file_thi_KHONG_AI_duoc_index(tmp_path):
    """Thiếu file là "chưa ai quyết định gì", và câu trả lời đúng cho chuyện đó là
    "không index gì cả" — chứ không phải "index tất"."""
    assert al.tai(tmp_path / "khong-ton-tai.json") == {}
    assert al.duoc_index(DID, al.tai(tmp_path / "khong-ton-tai.json")) is False


def _ghi(tmp_path, goc) -> "object":
    p = tmp_path / "al.json"
    p.write_text(json.dumps(goc, ensure_ascii=False), encoding="utf-8")
    return p


def test_file_hong_thi_NEM_khong_suy_dien(tmp_path):
    p = tmp_path / "al.json"
    p.write_text("khong-phai-json", encoding="utf-8")
    with pytest.raises(al.AllowlistError):
        al.tai(p)


def test_thieu_khoa_documents_thi_nem(tmp_path):
    with pytest.raises(al.AllowlistError, match="documents"):
        al.tai(_ghi(tmp_path, {"version": "1"}))


def test_phan_loai_la_thi_NEM_chu_khong_doan(tmp_path):
    """Một lỗi gõ (`CONFIRMED_PRODUCTON`) mà được đoán hộ là cách nó biến thành một
    tài liệu được index."""
    goc = {"documents": {DID: {"classification": "CONFIRMED_PRODUCTON",
                               "eligible_for_index": True}}}
    with pytest.raises(al.AllowlistError, match="classification"):
        al.tai(_ghi(tmp_path, goc))


def test_thieu_co_eligible_thi_nem(tmp_path):
    goc = {"documents": {DID: {"classification": al.CONFIRMED_PRODUCTION}}}
    with pytest.raises(al.AllowlistError, match="eligible_for_index"):
        al.tai(_ghi(tmp_path, goc))


# ── File allowlist THẬT của kho ────────────────────────────────────────────
def test_allowlist_that_doc_duoc_va_hop_le():
    ds = al.tai()
    assert len(ds) == 12, f"kho có 12 tài liệu, allowlist khai {len(ds)}"


TAI_LIEU_PRODUCTION_DAU_TIEN = "7a70a7d0-a678-4fcb-b983-9df66b49cbba"


def test_dung_MOT_tai_lieu_duoc_duyet_va_dung_no(capsys):
    """Bản trước khẳng định danh sách duyệt RỖNG, và ghi rõ nó sẽ đỏ khi có mục đầu
    tiên. Ngày 2026-09-04 mục đó xuất hiện: tài liệu production đầu tiên, nạp qua
    studymap-api-keq6.onrender.com. Test đổi sang khoá đúng MỘT id — thêm mục thứ hai
    vẫn phải đỏ, vì việc ấy phải được nhìn thấy chứ không được lặng lẽ."""
    ds = al.tai()
    cho_phep = [d for d in ds if al.duoc_index(d, ds, ingest_origin="production")]
    assert cho_phep == [TAI_LIEU_PRODUCTION_DAU_TIEN], cho_phep


def test_khong_co_nhan_nguon_thi_KHONG_ai_duoc_duyet():
    """Kể cả tài liệu đã duyệt: bỏ nhãn nguồn đi thì nó cũng không vào được index."""
    ds = al.tai()
    assert [d for d in ds if al.duoc_index(d, ds)] == []


BON_TAI_LIEU_MO_HO = {
    "960c1b5b-bbee-4593-86b3-3f4fc9fb3b17": "2-day24-ragas-guardrails.pdf",
    "7d5a3721-37c4-4984-87f6-a413733b92c2": "Bai giang dao ham.pptx",
    "77ba91f4-153f-4da6-bf29-b0afc0e8a9de": "Day08- RAG Pipeline.docx",
    "065c3cb0-a069-4e00-b0d4-b9412cee4895": "[VinUn_20k] Đào tạo hội nhập.pptx",
}


@pytest.mark.parametrize("did,ten", sorted(BON_TAI_LIEU_MO_HO.items()))
def test_bon_tai_lieu_mo_ho_KHONG_the_vao_index(did, ten):
    ds = al.tai()
    assert did in ds, f"{ten} phải có bản ghi (kể cả khi là AMBIGUOUS)"
    assert ds[did]["classification"] == al.AMBIGUOUS, ten
    assert al.duoc_index(did, ds) is False, ten


def test_thu_don_tam_da_truy_ra_nguon_goc():
    """Điều tra 2026-09-04: commit 56a276f ghi nguyên văn bước smoke 'upload .html mới',
    và hàng này là .html duy nhất tạo 2 phút trước commit đó. Đủ chuỗi nhân quả."""
    ds = al.tai()
    ban = ds["a7fa7ace-8656-4bca-b276-7db0875ccce1"]
    assert ban["classification"] == al.CONFIRMED_TEST
    assert al.duoc_index("a7fa7ace-8656-4bca-b276-7db0875ccce1", ds) is False


def test_khong_hang_nao_do_production_nap():
    """Kết quả cứng nhất của vòng điều tra: `input_path` do server ghi, và cả 11 hàng
    đều trỏ máy trạm Windows hoặc tmp_path của pytest. Render chạy Linux. Test này đỏ
    khi có người khai một hàng là dữ liệu production mà không sửa `ingested_from`."""
    for did, ban in al.tai().items():
        assert ban.get("ingested_from"), f"{did} thiếu ingested_from"
        if ban["classification"] == al.CONFIRMED_PRODUCTION:
            # Chỉ tài liệu nạp QUA RENDER mới được mang phân loại này. `input_path`
            # của nó là đường POSIX của container, không phải ổ E: của máy trạm.
            assert "render" in ban["ingested_from"].lower(), did
            assert did == TAI_LIEU_PRODUCTION_DAU_TIEN, did


def test_moi_ban_ghi_that_deu_co_bang_chung():
    """Một quyết định không kèm bằng chứng thì không kiểm lại được, và người sau sẽ
    phải tin lời người trước."""
    for did, ban in al.tai().items():
        assert (ban.get("evidence") or "").strip(), f"{did} thiếu evidence"
        assert (ban.get("decided_at") or "").strip(), f"{did} thiếu decided_at"


# ── Đường dựng lại phải đi qua allowlist ───────────────────────────────────
def test_rebuild_KHONG_index_khi_chua_duoc_cho_phep(tmp_path):
    """Kể cả khi `ban_ghi` được truyền thẳng vào. Nếu lọc chỉ nằm ở `doc_chunks_tu_db`
    thì người gọi nào truyền danh sách của mình sẽ lách được — mà lách được nghĩa là
    hàng rào không tồn tại."""
    active = tmp_path / "index"
    active.mkdir()
    (active / "index.faiss").write_bytes(b"index-cu")

    ra = rb.rebuild_index_tu_postgres(
        active_dir=active, ban_ghi=_chunks("chua-duoc-phep", 5),
        embed=lambda t: [[1.0, 0.0, 0.0, 0.0]] * len(t),
        danh_tinh={"embedding_provider": "fpt",
                   "embedding_model_name": "Vietnamese_Embedding",
                   "embedding_strategy": "api_pooled"},
        allowlist={}, ghi_db=False)
    assert ra["promoted"] is False
    assert ra["chunks"] == 0 and ra["chunks_doc_duoc"] == 5
    assert "ĐƯỢC PHÉP" in ra["ly_do"]
    assert (active / "index.faiss").read_bytes() == b"index-cu"


def test_rebuild_KHONG_goi_embedding_cho_chunk_bi_chan(tmp_path):
    """Chặn phải xảy ra TRƯỚC khi tiêu tiền API, không phải sau."""
    def _no(texts):
        raise AssertionError("không được gọi embedding cho chunk bị chặn")

    ra = rb.rebuild_index_tu_postgres(
        active_dir=tmp_path / "index", ban_ghi=_chunks("chan", 3), embed=_no,
        danh_tinh={"embedding_provider": "fpt", "embedding_model_name": "x",
                   "embedding_strategy": "api_pooled"},
        allowlist={}, ghi_db=False)
    assert ra["promoted"] is False


def test_rebuild_chi_index_phan_duoc_cho_phep(tmp_path):
    """Trộn hai tài liệu, chỉ một được phép — index phải chỉ có chunk của cái đó."""
    bg = _chunks("ok", 2) + _chunks("chan", 4)
    ra = rb.rebuild_index_tu_postgres(
        active_dir=tmp_path / "index", ban_ghi=bg,
        embed=lambda t: [[1.0, 0.0, 0.0, 0.0]] * len(t),
        danh_tinh={"embedding_provider": "fpt",
                   "embedding_model_name": "Vietnamese_Embedding",
                   "embedding_strategy": "api_pooled"},
        allowlist={"ok": _ban(al.CONFIRMED_PRODUCTION, True),
                   "chan": _ban(al.AMBIGUOUS, False)},
        ghi_db=False)
    assert ra["promoted"] is True
    assert ra["chunks"] == 2 and ra["chunks_doc_duoc"] == 6

    meta = json.loads(((tmp_path / "index") / "index.json").read_text(encoding="utf-8"))
    assert meta["__meta__"]["num_chunks"] == 2
    assert {v["source_stem"] for k, v in meta.items() if k.isdigit()} == {"ok"}


def test_rebuild_KHONG_co_sentinel_bo_qua_kiem_tra():
    """`allowlist=None` phải nghĩa là ĐỌC FILE THẬT, không phải "cho qua hết". Một
    sentinel bỏ qua kiểm tra là cái công tắc mà một ngày nào đó ai đó bật cho tiện."""
    import inspect

    nguon = inspect.getsource(rb.rebuild_index_tu_postgres)
    assert "loc_ban_ghi(ban_ghi, allowlist)" in nguon
    # `loc_ban_ghi` với allowlist=None tự đọc file thật — không có nhánh nào bỏ qua.
    assert "if allowlist is None:\n        return ban_ghi" not in nguon
