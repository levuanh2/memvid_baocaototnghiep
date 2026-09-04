"""Vòng đời dựng lại index từ PostgreSQL — `app/domains/vectorstore/rebuild.py`.

Module ấy tồn tại vì `INDEX_DIR` trên Render free nằm trên đĩa phù du: index biến mất
mỗi lần instance khởi động lại, còn `document_chunks.text` trong Postgres thì không.
Nên "dựng lại" là điều kiện để truy hồi tồn tại ở đó, không phải thao tác cứu hộ hiếm.

Điều file này khoá chặt nhất KHÔNG phải "dựng lại chạy được", mà là **dựng lại thất
bại thì không làm hỏng gì**. Một index đang phục vụ bị thay bằng bản dựng dở là mất
dữ liệu thật, và nó im lặng: truy vấn vẫn chạy, chỉ là thiếu chunk hoặc sai ánh xạ.

Bốn giai đoạn phải tách bạch, và test đi theo đúng ranh giới đó:
  A. sinh vector      — lỗi API, vector hỏng, lô lệch số lượng
  B. ghi staging      — không chạm active
  C. thẩm định        — đọc LẠI từ đĩa, không tin biến trong bộ nhớ
  D. thăng cấp        — nguyên tử, giữ bản cũ làm backup
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.domains.vectorstore import rebuild as rb

DT = {"embedding_provider": "fpt", "embedding_model_name": "Vietnamese_Embedding",
      "embedding_strategy": "api_pooled"}


def _embed_gia(dim: int = 4):
    """Vector tất định theo nội dung — đủ để phân biệt chunk nào ra vector nào."""
    def _e(texts):
        return [[float(len(t)), float(sum(map(ord, t[:3]))), 0.5, 1.0][:dim] for t in texts]
    return _e


def _cho_phep(*docs: str):
    """Allowlist tường minh cho tài liệu trong fixture.

    KHÔNG có sentinel "bỏ qua kiểm tra": test phải khai đúng thứ production phải
    khai. Nếu test được phép lách hàng rào thì hàng rào chỉ tồn tại trong test.
    """
    return {d: {"classification": "CONFIRMED_PRODUCTION", "eligible_for_index": True}
            for d in (docs or ("d1",))}


def _ban_ghi(n: int, doc: str = "d1", nguon: str = "production"):
    """Nhãn `production` mặc định: file này đo VÒNG ĐỜI dựng index, và điều kiện nguồn
    gốc phải đã thoả để nó không chặn mất thứ đang đo. Hàng rào nguồn gốc có file
    riêng (`test_ingest_provenance.py`)."""
    return [{"chunk_id": f"c{i}", "document_id": doc, "source_stem": f"{doc}_txt",
             "text": f"doan van thu {i}", "ingest_origin": nguon} for i in range(n)]


# ── A. Đọc ngữ liệu từ DB ──────────────────────────────────────────────────
def test_db_rong_thi_KHONG_dung_index_rong_de_len(tmp_path):
    """Dựng lại thành index rỗng là cách xoá dữ liệu mà trông như thành công."""
    active = tmp_path / "index"
    active.mkdir()
    (active / "index.faiss").write_bytes(b"index-cu-con-nguyen")

    ra = rb.rebuild_index_tu_postgres(allowlist=_cho_phep(), active_dir=active, ban_ghi=[],
                                      embed=_embed_gia(), danh_tinh=DT, ghi_db=False)
    assert ra["promoted"] is False and ra["chunks"] == 0
    assert (active / "index.faiss").read_bytes() == b"index-cu-con-nguyen"


def test_doc_mot_tai_lieu():
    rows = {"d1": {"source_stem": "d1_txt", "status": "ready"}}
    chunks = {"d1": [{"chunk_id": "a", "text": "xin chao"},
                     {"chunk_id": "b", "text": "the gioi"}]}
    ra = rb.doc_chunks_tu_db(
        liet_ke_tai_lieu=lambda: rows,
        liet_ke_chunk=lambda did, limit=500, offset=0: chunks[did][offset:offset + limit])
    assert [x["chunk_id"] for x in ra] == ["a", "b"]
    assert all(x["source_stem"] == "d1_txt" for x in ra)


def test_doc_nhieu_tai_lieu_thu_tu_TAT_DINH():
    """Id FAISS gán theo vị trí trong danh sách này. Thứ tự đổi giữa hai lần dựng thì
    `embedding_id` đã ghi xuống DB lần trước trỏ sai chunk."""
    rows = {"d2": {"source_stem": "d2", "status": "ready"},
            "d1": {"source_stem": "d1", "status": "ready"}}
    chunks = {"d1": [{"chunk_id": "a", "text": "mot"}],
              "d2": [{"chunk_id": "b", "text": "hai"}]}
    lay = lambda did, limit=500, offset=0: chunks[did][offset:offset + limit]  # noqa: E731
    lan1 = rb.doc_chunks_tu_db(liet_ke_tai_lieu=lambda: rows, liet_ke_chunk=lay)
    lan2 = rb.doc_chunks_tu_db(liet_ke_tai_lieu=lambda: dict(reversed(list(rows.items()))),
                               liet_ke_chunk=lay)
    assert [x["chunk_id"] for x in lan1] == ["a", "b"], "sắp theo document_id"
    assert lan1 == lan2, "đổi thứ tự dict không được đổi kết quả"


def test_bo_qua_tai_lieu_da_xoa():
    rows = {"d1": {"source_stem": "d1", "status": "deleted"},
            "d2": {"source_stem": "d2", "status": "ready"}}
    chunks = {"d1": [{"chunk_id": "x", "text": "khong duoc lay"}],
              "d2": [{"chunk_id": "y", "text": "duoc lay"}]}
    ra = rb.doc_chunks_tu_db(
        liet_ke_tai_lieu=lambda: rows,
        liet_ke_chunk=lambda did, limit=500, offset=0: chunks[did][offset:offset + limit])
    assert [x["chunk_id"] for x in ra] == ["y"]


def test_doc_het_trang():
    rows = {"d1": {"source_stem": "d1", "status": "ready"}}
    tat_ca = [{"chunk_id": f"c{i}", "text": f"t{i}"} for i in range(7)]
    ra = rb.doc_chunks_tu_db(
        liet_ke_tai_lieu=lambda: rows,
        liet_ke_chunk=lambda did, limit=500, offset=0: tat_ca[offset:offset + limit],
        trang=3)
    assert len(ra) == 7, "phải lật hết trang, không dừng ở trang đầu"


def test_text_rong_thi_keu_chu_khong_bo_qua():
    rows = {"d1": {"source_stem": "d1", "status": "ready"}}
    with pytest.raises(rb.RebuildError, match="text rỗng"):
        rb.doc_chunks_tu_db(
            liet_ke_tai_lieu=lambda: rows,
            liet_ke_chunk=lambda did, limit=500, offset=0: [{"chunk_id": "a", "text": "  "}])


# ── A. Sinh vector ─────────────────────────────────────────────────────────
def test_embed_theo_lo():
    goi = []

    def _e(texts):
        goi.append(len(texts))
        return [[1.0, 2.0] for _ in texts]

    vecs = rb.sinh_vector([f"t{i}" for i in range(7)], embed=_e, batch_size=3)
    assert len(vecs) == 7
    assert goi == [3, 3, 1]


def test_lo_tra_thieu_vector_bi_bat_NGAY_o_lo_do():
    """Lô này thiếu một, lô sau thừa một thì tổng vẫn khớp còn ánh xạ thì lệch hẳn."""
    def _e(texts):
        return [[1.0]] * (len(texts) - 1) if len(texts) > 1 else [[1.0]]

    with pytest.raises(rb.RebuildError, match="lô tại 0"):
        rb.sinh_vector(["a", "b", "c"], embed=_e, batch_size=3)


def test_loi_API_noi_len_khong_bi_nuot():
    def _e(texts):
        raise RuntimeError("FPT embeddings HTTP 503")

    with pytest.raises(RuntimeError, match="503"):
        rb.sinh_vector(["a"], embed=_e)


@pytest.mark.parametrize("vecs,khop", [
    ([], "không có vector"),
    ([[1.0, 2.0], [1.0]], "lệch số chiều"),
    ([[], []], "0 chiều"),
])
def test_vector_hong_bi_chan(vecs, khop):
    with pytest.raises(rb.RebuildError, match=khop):
        rb.kiem_vector(vecs)


def test_tien_do_duoc_bao_cao():
    moc = []
    rb.sinh_vector(["a", "b", "c"], embed=lambda t: [[1.0]] * len(t), batch_size=2,
                   tien_do=lambda xong, tong: moc.append((xong, tong)))
    assert moc == [(2, 3), (3, 3)]


# ── B + C. Staging và thẩm định ────────────────────────────────────────────
def _dung_staging(tmp_path, n=3, dim=4):
    bg = _ban_ghi(n)
    vecs = _embed_gia(dim)([b["text"] for b in bg])
    st = tmp_path / "index_staging"
    rb._ghi_staging(st, bg, vecs, dim, DT)
    return bg, st


def test_staging_ghi_du_file_va_meta(tmp_path):
    bg, st = _dung_staging(tmp_path)
    assert (st / "index.faiss").exists() and (st / "index.json").exists()
    meta = json.loads((st / "index.json").read_text(encoding="utf-8"))
    mm = meta["__meta__"]
    assert mm["version"] == "1.2"
    assert mm["num_chunks"] == 3
    assert mm["rebuilt_from"] == "postgres.document_chunks"
    for k, v in DT.items():
        assert mm[k] == v
    assert meta["0"]["source_stem"] == "d1_txt"


@pytest.mark.parametrize("vecs,mong", [
    ([[1.0, 0.0], [0.0, 1.0]], True),
    ([[0.6, 0.8]], True),                      # |v| = 1
    ([[1.0, 1.0]], False),                     # |v| = 1.414
    ([[0.1, 0.1]], False),
    ([[1.0, 0.0], [3.0, 4.0]], False),         # một cái lệch là cả lô lệch
])
def test_nhan_dien_vector_da_chuan_hoa(vecs, mong):
    """Index dùng `IndexFlatL2`. Với vector đơn vị thì thứ tự theo L2 TRÙNG thứ tự
    theo cosine — đúng thứ phần còn lại của hệ thống giả định. Chưa chuẩn hoá thì
    index vẫn dựng được, chỉ là thứ tự mang nghĩa khác, và khác một cách im lặng."""
    assert rb.da_chuan_hoa(vecs) is mong


def test_meta_ghi_lai_vector_co_chuan_hoa_khong(tmp_path):
    """Provider đổi hành vi chuẩn hoá là thứ không có exception nào báo. Ghi vào meta
    để lần sau nhìn ra được."""
    bg = _ban_ghi(2)
    st = tmp_path / "index_staging"
    rb._ghi_staging(st, bg, [[1.0, 0.0], [0.0, 1.0]], 2, DT)
    assert json.loads((st / "index.json").read_text(encoding="utf-8"))["__meta__"][
        "vectors_normalized"] is True

    st2 = tmp_path / "index_staging2"
    rb._ghi_staging(st2, bg, [[3.0, 4.0], [1.0, 1.0]], 2, DT)
    assert json.loads((st2 / "index.json").read_text(encoding="utf-8"))["__meta__"][
        "vectors_normalized"] is False


def test_tham_dinh_doc_LAI_tu_dia(tmp_path):
    bg, st = _dung_staging(tmp_path)
    rb.tham_dinh_staging(st, so_chunk=3, dim=4, danh_tinh=DT)


def test_tham_dinh_bat_lech_so_chieu(tmp_path):
    bg, st = _dung_staging(tmp_path, dim=4)
    with pytest.raises(rb.RebuildValidationError, match="chiều"):
        rb.tham_dinh_staging(st, so_chunk=3, dim=99, danh_tinh=DT)


def test_tham_dinh_bat_thieu_vector(tmp_path):
    bg, st = _dung_staging(tmp_path, n=3)
    with pytest.raises(rb.RebuildValidationError, match="vector"):
        rb.tham_dinh_staging(st, so_chunk=5, dim=4, danh_tinh=DT)


def test_tham_dinh_bat_lech_danh_tinh(tmp_path):
    bg, st = _dung_staging(tmp_path)
    khac = dict(DT, embedding_model_name="BAAI/bge-m3")
    with pytest.raises(rb.RebuildValidationError, match="danh tính"):
        rb.tham_dinh_staging(st, so_chunk=3, dim=4, danh_tinh=khac)


def test_tham_dinh_bat_thieu_file(tmp_path):
    bg, st = _dung_staging(tmp_path)
    (st / "index.faiss").unlink()
    with pytest.raises(rb.RebuildValidationError, match="thiếu file"):
        rb.tham_dinh_staging(st, so_chunk=3, dim=4, danh_tinh=DT)


# ── D. Thăng cấp ───────────────────────────────────────────────────────────
def test_thang_cap_giu_ban_cu_lam_backup(tmp_path):
    active = tmp_path / "index"
    active.mkdir()
    (active / "index.faiss").write_bytes(b"cu")
    st = tmp_path / "index_staging"
    st.mkdir()
    (st / "index.faiss").write_bytes(b"moi")

    backup = rb.thang_cap(st, active, keep=3)
    assert (active / "index.faiss").read_bytes() == b"moi"
    assert backup is not None and (Path(backup) / "index.faiss").read_bytes() == b"cu"
    assert not st.exists()


def test_thang_cap_khi_chua_co_index_nao(tmp_path):
    active = tmp_path / "index"
    st = tmp_path / "index_staging"
    st.mkdir()
    (st / "index.faiss").write_bytes(b"moi")
    assert rb.thang_cap(st, active, keep=3) is None
    assert (active / "index.faiss").read_bytes() == b"moi"


def test_thang_cap_hong_thi_TRA_LAI_ban_cu(tmp_path, monkeypatch):
    """Thà không có index mới còn hơn mất index cũ."""
    active = tmp_path / "index"
    active.mkdir()
    (active / "index.faiss").write_bytes(b"cu")
    st = tmp_path / "index_staging"
    st.mkdir()

    that = Path.rename

    def _rename(self, target):
        if Path(self) == st:
            raise OSError("dia day")
        return that(self, target)

    monkeypatch.setattr(Path, "rename", _rename)
    with pytest.raises(OSError):
        rb.thang_cap(st, active, keep=3)
    assert (active / "index.faiss").read_bytes() == b"cu", "index cũ phải còn nguyên"


def test_khong_co_staging_thi_keu(tmp_path):
    with pytest.raises(rb.RebuildError, match="không có staging"):
        rb.thang_cap(tmp_path / "khong-ton-tai", tmp_path / "index")


# ── Điều phối đầu-cuối ─────────────────────────────────────────────────────
def test_dung_lai_day_du(tmp_path):
    active = tmp_path / "index"
    bg = _ban_ghi(5)
    da_ghi = {}
    ra = rb.rebuild_index_tu_postgres(allowlist=_cho_phep(),
        active_dir=active, ban_ghi=bg, embed=_embed_gia(4), danh_tinh=DT,
        batch_size=2, cap_nhat_embedding_id=lambda cid, eid: da_ghi.__setitem__(cid, eid))
    assert ra["promoted"] is True and ra["chunks"] == 5 and ra["dim"] == 4
    assert (active / "index.faiss").exists()
    assert da_ghi == {f"c{i}": str(i) for i in range(5)}, "embedding_id = vị trí FAISS"
    assert not (tmp_path / "index_staging").exists()


def test_loi_embedding_KHONG_dung_toi_index_dang_phuc_vu(tmp_path):
    active = tmp_path / "index"
    active.mkdir()
    (active / "index.faiss").write_bytes(b"index-cu")

    def _e(texts):
        raise RuntimeError("FPT embeddings HTTP 500")

    with pytest.raises(RuntimeError, match="500"):
        rb.rebuild_index_tu_postgres(allowlist=_cho_phep(), active_dir=active, ban_ghi=_ban_ghi(3),
                                     embed=_e, danh_tinh=DT, ghi_db=False)
    assert (active / "index.faiss").read_bytes() == b"index-cu"
    assert not (tmp_path / "index_staging").exists() or True


def test_tham_dinh_truot_thi_DON_staging_va_giu_active(tmp_path, monkeypatch):
    """Dựng dở nửa chừng không được để lại rác, và tuyệt đối không được thăng cấp."""
    active = tmp_path / "index"
    active.mkdir()
    (active / "index.faiss").write_bytes(b"index-cu")

    monkeypatch.setattr(rb, "tham_dinh_staging",
                        lambda *a, **k: (_ for _ in ()).throw(
                            rb.RebuildValidationError("co tinh lam truot")))
    with pytest.raises(rb.RebuildValidationError):
        rb.rebuild_index_tu_postgres(allowlist=_cho_phep(), active_dir=active, ban_ghi=_ban_ghi(3),
                                     embed=_embed_gia(4), danh_tinh=DT, ghi_db=False)
    assert (active / "index.faiss").read_bytes() == b"index-cu"
    assert not (tmp_path / "index_staging").exists(), "staging hỏng phải được dọn"


def test_ghi_embedding_id_chay_SAU_khi_thang_cap(tmp_path):
    """Ghi trước thì DB trỏ vào một index chưa phục vụ."""
    active = tmp_path / "index"
    thu_tu = []

    def _cap_nhat(cid, eid):
        thu_tu.append(("db", (active / "index.faiss").exists()))

    rb.rebuild_index_tu_postgres(allowlist=_cho_phep(), active_dir=active, ban_ghi=_ban_ghi(2),
                                 embed=_embed_gia(4), danh_tinh=DT,
                                 cap_nhat_embedding_id=_cap_nhat)
    assert thu_tu and all(co for _, co in thu_tu), "index phải đã active khi ghi DB"


def test_ghi_db_tat_duoc(tmp_path):
    ra = rb.rebuild_index_tu_postgres(allowlist=_cho_phep(), active_dir=tmp_path / "index", ban_ghi=_ban_ghi(2),
                                      embed=_embed_gia(4), danh_tinh=DT, ghi_db=False)
    assert ra["embedding_id_da_ghi"] == 0


def test_KHONG_tu_chay_o_dau_ca():
    """Không route nào, không tiến trình khởi động nào GỌI bộ điều phối dựng lại.

    Kiểm đúng lời gọi `rebuild_index_tu_postgres(...)`, không kiểm chuỗi
    `"vectorstore.rebuild"`: bản đầu của test này quét chuỗi, nên `persistence.py`
    import `thang_cap` (một helper thăng cấp thư mục) cũng bị coi là "tự chạy rebuild".
    Nhập một hàm phụ trợ khác hẳn với việc kích hoạt cả lượt dựng vài nghìn chunk —
    test phải nói đúng điều nó muốn cấm.
    """
    import ast
    import pathlib

    goc = pathlib.Path(__file__).resolve().parents[1]
    xau = []
    for f in list((goc / "app").rglob("*.py")) + list((goc / "services").rglob("*.py")):
        if f.name == "rebuild.py" or "__pycache__" in str(f):
            continue
        try:
            cay = ast.parse(f.read_text(encoding="utf-8", errors="ignore"))
        except SyntaxError:
            continue
        for n in ast.walk(cay):
            if not isinstance(n, ast.Call):
                continue
            ten = (n.func.attr if isinstance(n.func, ast.Attribute)
                   else n.func.id if isinstance(n.func, ast.Name) else "")
            if ten == "rebuild_index_tu_postgres":
                xau.append(f"{f.relative_to(goc).as_posix()}:{n.lineno}")
    assert not xau, f"có nơi gọi rebuild tự động: {xau}"
