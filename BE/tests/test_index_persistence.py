"""Lưu bền + khôi phục index — `app/domains/vectorstore/persistence.py`.

Kho object KHÔNG có commit nhiều object và KHÔNG có rename nguyên tử. Nên tính nguyên
tử ở đây được dựng bằng tay: file → manifest → đọc lại kiểm → con trỏ. Thứ tự ấy là
toàn bộ tài sản an toàn của module, nên phần lớn file này kiểm nó chứ không kiểm
đường thành công.

Ba tính chất phải giữ, mỗi cái tương ứng một cách hỏng dữ liệu thật:

1. Upload đứt giữa chừng để lại một version MỒ CÔI, không bao giờ để lại một con trỏ
   trỏ vào artifact thiếu file. Con trỏ hỏng thì mọi lần khôi phục sau đều mang về
   một index hỏng, và không ai biết cho tới lúc truy vấn trả rác.
2. Khôi phục thất bại KHÔNG được đụng vào index cục bộ đang phục vụ. Thà không khôi
   phục còn hơn thay bản đang chạy bằng một bản dựng dở.
3. Thiếu cấu hình Supabase KHÔNG được làm app chết. Production hôm nay đúng là thiếu.

Test dùng kho trong bộ nhớ, không cần credential thật — đó cũng là lý do có Protocol
`ObjectStorage` thay vì gọi thẳng module Supabase.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.domains.vectorstore import persistence as ps
from app.domains.vectorstore import rebuild as rb

DT = {"embedding_provider": "fpt", "embedding_model_name": "Vietnamese_Embedding",
      "embedding_strategy": "api_pooled"}


class KhoGia:
    """Kho object trong bộ nhớ. Khớp Protocol `ObjectStorage` bằng cấu trúc."""

    def __init__(self, *, hong_tu: int | None = None, loi=None):
        self.data: dict[str, bytes] = {}
        self.log: list[tuple[str, str]] = []
        self._hong_tu = hong_tu          # upload thứ N trở đi thì ném
        self._loi = loi or RuntimeError("kho hong")

    def upload(self, path, data, *, content_type=None):
        self.log.append(("upload", path))
        so_upload = sum(1 for k, _ in self.log if k == "upload")
        if self._hong_tu is not None and so_upload > self._hong_tu:
            raise self._loi
        self.data[path] = bytes(data)
        return path

    def download(self, path):
        self.log.append(("download", path))
        if path not in self.data:
            raise RuntimeError(f"404 {path}")
        return self.data[path]

    def exists(self, path):
        self.log.append(("exists", path))
        return path in self.data


def _dung_index(thu_muc: Path, *, n=3, dim=4, danh_tinh=None, them_sqlite=False,
                meta_version="1.2"):
    """Dựng bộ artifact CANONICAL thật (faiss + pkl + json) bằng chính đường của
    rebuild — không dựng file giả, vì test phải chạy trên đúng thứ production sinh ra."""
    bg = [{"chunk_id": f"c{i}", "document_id": "d1", "source_stem": "d1_txt",
           "text": f"doan {i}"} for i in range(n)]
    vecs = [[1.0] + [0.0] * (dim - 1) for _ in range(n)]
    rb._ghi_staging(thu_muc, bg, vecs, dim, danh_tinh or DT)
    if meta_version != "1.2":
        m = json.loads((thu_muc / "index.json").read_text(encoding="utf-8"))
        m["__meta__"]["version"] = meta_version
        (thu_muc / "index.json").write_text(json.dumps(m, ensure_ascii=False),
                                            encoding="utf-8")
    if them_sqlite:
        (thu_muc / "chunks.sqlite").write_bytes(b"sqlite-gia")
    return thu_muc


@pytest.fixture()
def cau_hinh(monkeypatch):
    """Danh tính hiện tại = DT, để hàng rào danh tính cho qua."""
    monkeypatch.setenv("FPT_AI_API_KEY", "sk-khoa-gia-chi-dung-trong-test")
    monkeypatch.setenv("FPT_AI_EMBEDDING_MODEL", "Vietnamese_Embedding")
    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", "1")
    yield


# ── Cổng bật/tắt ───────────────────────────────────────────────────────────
def test_mac_dinh_TAT(monkeypatch):
    monkeypatch.delenv("INDEX_PERSISTENCE_ENABLED", raising=False)
    assert ps.enabled() is False


@pytest.mark.parametrize("v,mong", [("1", True), ("true", True), ("ON", True),
                                    ("0", False), ("no", False), ("", False)])
def test_co_bat_tat(monkeypatch, v, mong):
    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", v)
    assert ps.enabled() is mong


def test_thieu_supabase_thi_KHONG_lam_app_chet(monkeypatch, tmp_path):
    """Production hôm nay đúng là thiếu. Boot phải qua được.

    `INDEX_DIR` phải trỏ vào thư mục TRỐNG: `restore` kiểm index cục bộ TRƯỚC khi
    chạm kho (đúng thứ tự cho đường khởi động — có index rồi thì đừng gọi mạng), nên
    trỏ vào thư mục đã có index sẽ thoát sớm và ca "thiếu cấu hình" không bao giờ
    chạy tới."""
    from app.domains.vectorstore import store as _store

    monkeypatch.setattr(_store, "INDEX_DIR", tmp_path / "trong")
    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", "1")
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "")
    ra = ps.restore_luc_khoi_dong()
    assert ra["restored"] is False and "chưa cấu hình" in ra["ly_do"]


def test_co_index_cuc_bo_thi_khoi_dong_KHONG_cham_mang(monkeypatch, tmp_path):
    """Đường khởi động nhanh: có index rồi thì không gọi kho, kể cả khi đã bật."""
    from app.domains.vectorstore import store as _store

    _dung_index(tmp_path / "index")
    monkeypatch.setattr(_store, "INDEX_DIR", tmp_path / "index")
    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", "1")
    monkeypatch.setattr(ps, "get_storage",
                        lambda: pytest.fail("đã có index cục bộ thì không được gọi kho"))
    assert ps.restore_luc_khoi_dong()["restored"] is False


def test_chua_bat_thi_khoi_dong_khong_cham_mang(monkeypatch):
    monkeypatch.delenv("INDEX_PERSISTENCE_ENABLED", raising=False)

    def _no():
        raise AssertionError("chưa bật thì không được dựng client kho")

    monkeypatch.setattr(ps, "get_storage", _no)
    assert ps.restore_luc_khoi_dong()["restored"] is False


def test_publish_sau_rebuild_no_op_khi_tat(monkeypatch):
    monkeypatch.delenv("INDEX_PERSISTENCE_ENABLED", raising=False)
    monkeypatch.setattr(ps, "publish", lambda *a, **k: pytest.fail("không được đẩy"))
    assert ps.publish_sau_rebuild()["published"] is False


# ── Slug danh tính ─────────────────────────────────────────────────────────
def test_slug_tat_dinh_va_tach_khong_gian_vector():
    a = ps.identity_slug(DT)
    assert a == ps.identity_slug(dict(DT)), "cùng danh tính -> cùng slug"
    khac = ps.identity_slug(dict(DT, embedding_model_name="BAAI/bge-m3"))
    assert khac != a, "model khác -> tiền tố khác"
    assert "/" not in khac, "phải an toàn để làm khoá object"


def test_slug_KHONG_phu_thuoc_so_chieu(cau_hinh):
    """Lúc khôi phục chưa biết số chiều — đưa nó vào slug thì hai bên không bao giờ
    gặp nhau. Đây là lỗi đã mắc và đã sửa, giữ test để không mắc lại."""
    import inspect
    assert "dim" not in inspect.signature(ps.identity_slug).parameters


def test_chien_luoc_khac_thi_slug_khac():
    assert ps.identity_slug(dict(DT, embedding_strategy="mean_late")) != ps.identity_slug(DT)


# ── Đọc artifact cục bộ ────────────────────────────────────────────────────
def test_thieu_index_json_thi_KHONG_day_len(tmp_path):
    """`index.json` là thứ diễn giải `index.faiss`. Đẩy mỗi file đầu là đẩy rác."""
    d = _dung_index(tmp_path / "index")
    (d / "index.json").unlink()
    with pytest.raises(ps.PersistenceError, match="index.json"):
        ps.doc_artifact(d)


def test_thieu_index_faiss_thi_KHONG_day_len(tmp_path):
    d = _dung_index(tmp_path / "index")
    (d / "index.faiss").unlink()
    with pytest.raises(ps.PersistenceError, match="index.faiss"):
        ps.doc_artifact(d)


def test_file_tuy_chon_duoc_day_khi_co(tmp_path):
    d = _dung_index(tmp_path / "index", them_sqlite=True)
    assert set(ps.doc_artifact(d)) == {"index.faiss", "index.pkl", "index.json",
                                       "chunks.sqlite"}


def test_thieu_index_pkl_thi_KHONG_day_len(tmp_path):
    """`index.pkl` là BẮT BUỘC, không phải tuỳ chọn: thiếu nó thì
    `load_vectorstore()` trả None và lần ingest kế tiếp ĐÈ MẤT index."""
    d = _dung_index(tmp_path / "index")
    (d / "index.pkl").unlink()
    with pytest.raises(ps.PersistenceError, match="index.pkl"):
        ps.doc_artifact(d)


# ── Upload: thứ tự và tính nguyên tử ───────────────────────────────────────
def test_thu_tu_upload_con_tro_SAU_CUNG(tmp_path, cau_hinh):
    kho = KhoGia()
    d = _dung_index(tmp_path / "index")
    ra = ps.publish(d, storage=kho)

    upload = [p for k, p in kho.log if k == "upload"]
    assert upload[-1].endswith("current.json"), "con trỏ phải là thứ ghi sau cùng"
    assert upload[-2].endswith("manifest.json"), "manifest ghi sau artifact"
    assert ra["files"] == 3 and ra["version"]


def test_upload_dut_giua_chung_KHONG_de_lai_con_tro(tmp_path, cau_hinh):
    """Version mồ côi thì vô hại; con trỏ trỏ vào artifact thiếu file thì không."""
    kho = KhoGia(hong_tu=1)          # file đầu qua, file thứ hai ném
    d = _dung_index(tmp_path / "index")
    with pytest.raises(RuntimeError):
        ps.publish(d, storage=kho)
    assert not any(k.endswith("current.json") for k in kho.data), (
        "không được có con trỏ khi artifact chưa đủ")


def test_manifest_hong_sau_khi_ghi_thi_KHONG_doi_con_tro(tmp_path, cau_hinh, monkeypatch):
    """Upload trả 200 không có nghĩa là đọc lại được."""
    kho = KhoGia()
    that = kho.download

    def _doc_sai(path):
        if path.endswith("manifest.json"):
            return b'{"files": []}'          # khác thứ vừa ghi
        return that(path)

    monkeypatch.setattr(kho, "download", _doc_sai)
    d = _dung_index(tmp_path / "index")
    with pytest.raises(ps.PersistenceError, match="đọc lại khác"):
        ps.publish(d, storage=kho)
    assert not any(k.endswith("current.json") for k in kho.data)


def test_artifact_bien_mat_sau_upload_thi_KHONG_doi_con_tro(tmp_path, cau_hinh):
    kho = KhoGia()
    d = _dung_index(tmp_path / "index")
    that_exists = kho.exists
    kho.exists = lambda p: False if p.endswith("index.faiss") else that_exists(p)
    with pytest.raises(ps.PersistenceError, match="thiếu sau upload"):
        ps.publish(d, storage=kho)
    assert not any(k.endswith("current.json") for k in kho.data)


def test_manifest_ghi_du_bam_va_kich_thuoc(tmp_path, cau_hinh):
    kho = KhoGia()
    d = _dung_index(tmp_path / "index")
    ra = ps.publish(d, storage=kho)
    mf = json.loads(kho.data[ps.khoa_version(ra["slug"], ra["version"], "manifest.json")])
    assert {f["name"] for f in mf["files"]} == {"index.faiss", "index.pkl", "index.json"}
    assert all(f["sha256"] and f["size"] > 0 for f in mf["files"])
    assert mf["identity"] == DT
    assert mf["embedding_dim"] == 4


def test_day_lai_cung_noi_dung_ra_cung_van_tay(tmp_path, cau_hinh):
    """Version mang dấu vân tay của nội dung — đẩy lại đúng bộ ấy không sinh rác mới."""
    d = _dung_index(tmp_path / "index")
    v1 = ps.publish(d, storage=KhoGia())["version"]
    v2 = ps.publish(d, storage=KhoGia())["version"]
    assert v1.split("_")[-1] == v2.split("_")[-1]


# ── Khôi phục: đường thành công ────────────────────────────────────────────
def test_vong_doi_day_du_upload_roi_restore(tmp_path, cau_hinh):
    kho = KhoGia()
    goc = _dung_index(tmp_path / "goc", them_sqlite=True)
    ps.publish(goc, storage=kho)

    dich = tmp_path / "index"
    ra = ps.restore(thu_muc=dich, storage=kho)
    assert ra["restored"] is True and ra["files"] == 4
    for ten in ("index.faiss", "index.pkl", "index.json", "chunks.sqlite"):
        assert (dich / ten).read_bytes() == (goc / ten).read_bytes(), (
            f"{ten}: byte tải về phải trùng khít byte đã đẩy")
    m = json.loads((dich / "index.json").read_text(encoding="utf-8"))["__meta__"]
    assert {k: m[k] for k in DT} == DT, "danh tính phải sống sót qua vòng lặp"


def test_da_co_index_cuc_bo_thi_KHONG_dung_toi(tmp_path, cau_hinh):
    """Index trên đĩa là thứ đang phục vụ. Thay nó là quyết định của người vận hành."""
    kho = KhoGia()
    ps.publish(_dung_index(tmp_path / "goc"), storage=kho)
    dich = _dung_index(tmp_path / "index", n=9)
    truoc = (dich / "index.json").read_bytes()

    ra = ps.restore(thu_muc=dich, storage=kho)
    assert ra["restored"] is False
    assert (dich / "index.json").read_bytes() == truoc


def test_ghi_de_khi_duoc_yeu_cau_tuong_minh(tmp_path, cau_hinh):
    kho = KhoGia()
    ps.publish(_dung_index(tmp_path / "goc", n=3), storage=kho)
    dich = _dung_index(tmp_path / "index", n=9)
    assert ps.restore(thu_muc=dich, storage=kho, ghi_de=True)["restored"] is True
    assert json.loads((dich / "index.json").read_text(encoding="utf-8"))[
        "__meta__"]["num_chunks"] == 3


# ── Khôi phục: mọi cách hỏng ───────────────────────────────────────────────
def _kho_co_index(tmp_path, **kw):
    kho = KhoGia()
    ps.publish(_dung_index(tmp_path / "goc", **kw), storage=kho)
    return kho


def test_khong_co_con_tro_thi_bao_ro(tmp_path, cau_hinh):
    with pytest.raises(ps.PersistenceError, match="con trỏ"):
        ps.restore(thu_muc=tmp_path / "index", storage=KhoGia())


def test_con_tro_hong(tmp_path, cau_hinh):
    kho = _kho_co_index(tmp_path)
    kho.data[ps.khoa_con_tro(ps.identity_slug())] = b"khong-phai-json"
    with pytest.raises(ps.PersistenceError, match="con trỏ hỏng"):
        ps.restore(thu_muc=tmp_path / "index", storage=kho)


def test_manifest_mat(tmp_path, cau_hinh):
    kho = _kho_co_index(tmp_path)
    for k in list(kho.data):
        if k.endswith("manifest.json"):
            del kho.data[k]
    with pytest.raises(ps.PersistenceError, match="manifest"):
        ps.restore(thu_muc=tmp_path / "index", storage=kho)


def test_manifest_khong_co_files(tmp_path, cau_hinh):
    kho = _kho_co_index(tmp_path)
    for k in list(kho.data):
        if k.endswith("manifest.json"):
            kho.data[k] = b'{"files": []}'
    with pytest.raises(rb.RebuildValidationError, match="thiếu `files`"):
        ps.restore(thu_muc=tmp_path / "index", storage=kho)


def test_thieu_index_faiss_tren_kho(tmp_path, cau_hinh):
    kho = _kho_co_index(tmp_path)
    for k in list(kho.data):
        if k.endswith("/index.faiss"):
            del kho.data[k]
    with pytest.raises(ps.PersistenceError):
        ps.restore(thu_muc=tmp_path / "index", storage=kho)


def test_tai_ve_dut_giua_chung_bi_bat_bang_sha256(tmp_path, cau_hinh):
    """Tải đứt thường ra file NGẮN hơn; proxy trả trang lỗi có thể ra file dài đúng
    bằng thế. Kiểm băm bắt được cả hai."""
    kho = _kho_co_index(tmp_path)
    for k in list(kho.data):
        if k.endswith("/index.json"):
            kho.data[k] = kho.data[k][:-5] + b"xxxxx"
    with pytest.raises(rb.RebuildValidationError, match="sha256"):
        ps.restore(thu_muc=tmp_path / "index", storage=kho)


def test_faiss_hong_bi_bat_khi_mo(tmp_path, cau_hinh, monkeypatch):
    kho = _kho_co_index(tmp_path)
    for k in list(kho.data):
        if k.endswith("/index.faiss"):
            hong = b"khong-phai-faiss" * 4
            kho.data[k] = hong
            mfk = k.rsplit("/", 1)[0] + "/manifest.json"
            mf = json.loads(kho.data[mfk])
            for f in mf["files"]:
                if f["name"] == "index.faiss":
                    f["sha256"] = ps._bam(hong)
                    f["size"] = len(hong)
            kho.data[mfk] = json.dumps(mf).encode()
    with pytest.raises(rb.RebuildValidationError, match="index.faiss không mở được"):
        ps.restore(thu_muc=tmp_path / "index", storage=kho)


def test_metadata_version_khong_ho_tro(tmp_path, cau_hinh):
    kho = KhoGia()
    ps.publish(_dung_index(tmp_path / "goc", meta_version="9.9"), storage=kho)
    with pytest.raises(rb.RebuildValidationError, match="version không hỗ trợ"):
        ps.restore(thu_muc=tmp_path / "index", storage=kho)


@pytest.mark.parametrize("khoa,gia_tri", [
    ("embedding_model_name", "BAAI/bge-m3"),
    ("embedding_provider", "local"),
    ("embedding_strategy", "mean_late"),
])
def test_lech_danh_tinh_thi_TU_CHOI(tmp_path, cau_hinh, khoa, gia_tri):
    """Dùng LẠI hàng rào của store, không dựng bộ kiểm thứ hai. Slug khác nhau nên
    ca này chỉ xảy ra khi ai đó trỏ slug bằng tay — vẫn phải chặn."""
    kho = KhoGia()
    khac = dict(DT, **{khoa: gia_tri})
    ps.publish(_dung_index(tmp_path / "goc", danh_tinh=khac), storage=kho,
               slug=ps.identity_slug())
    with pytest.raises(rb.RebuildValidationError, match="danh tính lệch"):
        ps.restore(thu_muc=tmp_path / "index", storage=kho)


def test_so_chieu_lech_manifest_thi_TU_CHOI(tmp_path, cau_hinh):
    kho = _kho_co_index(tmp_path, dim=4)
    for k in list(kho.data):
        if k.endswith("manifest.json"):
            mf = json.loads(kho.data[k])
            mf["embedding_dim"] = 1024
            kho.data[k] = json.dumps(mf).encode()
    with pytest.raises(rb.RebuildValidationError, match="chiều"):
        ps.restore(thu_muc=tmp_path / "index", storage=kho)


def test_manifest_co_file_la_thi_TU_CHOI(tmp_path, cau_hinh):
    """Tên file từ manifest đi thẳng vào đường ghi đĩa. Không nhận tên ngoài danh sách."""
    kho = _kho_co_index(tmp_path)
    for k in list(kho.data):
        if k.endswith("manifest.json"):
            mf = json.loads(kho.data[k])
            mf["files"].append({"name": "../../thoat-ra-ngoai", "size": 1, "sha256": ""})
            kho.data[k] = json.dumps(mf).encode()
    with pytest.raises(rb.RebuildValidationError, match="file lạ"):
        ps.restore(thu_muc=tmp_path / "index", storage=kho)


@pytest.mark.parametrize("hong", [
    RuntimeError("kho khong voi toi"),
    TimeoutError("het gio"),
])
def test_kho_khong_voi_toi_thi_KHONG_dung_index_cuc_bo(tmp_path, cau_hinh, hong):
    dich = _dung_index(tmp_path / "index", n=7)
    truoc = (dich / "index.json").read_bytes()

    class _Hong(KhoGia):
        def download(self, path):
            raise hong

    with pytest.raises(ps.PersistenceError):
        ps.restore(thu_muc=dich, storage=_Hong(), ghi_de=True)
    assert (dich / "index.json").read_bytes() == truoc


def test_khoi_phuc_that_bai_giu_nguyen_index_cuc_bo_va_don_staging(tmp_path, cau_hinh):
    kho = _kho_co_index(tmp_path)
    for k in list(kho.data):
        if k.endswith("/index.json"):
            kho.data[k] = b"hong"          # sha256 sẽ lệch
    dich = _dung_index(tmp_path / "index", n=7)
    truoc = (dich / "index.faiss").read_bytes()

    with pytest.raises(rb.RebuildValidationError):
        ps.restore(thu_muc=dich, storage=kho, ghi_de=True)
    assert (dich / "index.faiss").read_bytes() == truoc
    assert not (tmp_path / "index_restore").exists(), "staging hỏng phải được dọn"


# ── Startup nuốt mọi lỗi ───────────────────────────────────────────────────
@pytest.mark.parametrize("loi", [
    rb.RebuildValidationError("lech danh tinh"),
    ps.PersistenceError("kho hong"),
    RuntimeError("gi do khac"),
    ValueError("gi do khac nua"),
])
def test_khoi_dong_KHONG_BAO_GIO_nem(monkeypatch, loi):
    """Một lỗi ở đây không được làm chết cả tiến trình app."""
    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", "1")
    monkeypatch.setattr(ps, "restore", lambda **k: (_ for _ in ()).throw(loi))
    ra = ps.restore_luc_khoi_dong()
    assert ra["restored"] is False and ra["ly_do"]


def test_khoi_dong_thanh_cong_tra_ve_version(tmp_path, cau_hinh, monkeypatch):
    kho = _kho_co_index(tmp_path)
    monkeypatch.setattr(ps, "get_storage", lambda: kho)
    from app.domains.vectorstore import store as _store
    monkeypatch.setattr(_store, "INDEX_DIR", tmp_path / "index")
    ra = ps.restore_luc_khoi_dong()
    assert ra["restored"] is True and ra["version"]


# ── Adapter Supabase: `exists` ─────────────────────────────────────────────
class _R:
    def __init__(self, code, text=""):
        self.status_code = code
        self.text = text


@pytest.mark.parametrize("ma,mong", [(200, True), (206, True), (404, False), (400, False)])
def test_exists_tra_loi_co_khong(monkeypatch, ma, mong):
    from app.domains.documents import storage as st

    monkeypatch.setenv("SUPABASE_URL", "https://vi-du.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb-bi-mat")
    ghi = {}

    def _head(url, headers=None, timeout=None):
        ghi.update(url=url, headers=headers)
        return _R(ma)

    monkeypatch.setattr(st.requests, "head", _head)
    assert st.exists("index/a/b.faiss") is mong
    assert "/object/" in ghi["url"], "phải hỏi object, không phải bucket"


def test_exists_dung_HEAD_khong_keo_ca_file(monkeypatch):
    """Người gọi chỉ cần có/không. Kéo file vài chục MB về để trả lời là quá đắt."""
    from app.domains.documents import storage as st

    monkeypatch.setenv("SUPABASE_URL", "https://vi-du.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb-bi-mat")
    monkeypatch.setattr(st.requests, "get",
                        lambda *a, **k: pytest.fail("exists không được dùng GET"))
    monkeypatch.setattr(st.requests, "head", lambda *a, **k: _R(200))
    assert st.exists("x") is True


def test_exists_loi_that_thi_NEM_chu_khong_tra_False(monkeypatch):
    """Trả False khi không với tới kho sẽ biến 'mất mạng' thành 'chưa đẩy lên' — hai
    chuyện khác hẳn, và cái nhầm ấy làm `publish` tưởng artifact thiếu file."""
    from app.domains.documents import storage as st

    monkeypatch.setenv("SUPABASE_URL", "https://vi-du.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb-bi-mat")
    monkeypatch.setattr(st.requests, "head", lambda *a, **k: _R(500, "server hong"))
    with pytest.raises(st.StorageError):
        st.exists("x")


# ── Nối vào startup và CLI ─────────────────────────────────────────────────
def test_main_goi_restore_luc_khoi_dong():
    """Móc ở startup phải TỒN TẠI — không có nó thì cả tầng lưu bền là mã chết."""
    import ast
    import pathlib

    src = (pathlib.Path(__file__).resolve().parents[1] / "app" / "main.py").read_text(
        encoding="utf-8")
    goi = [n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Call)
           and isinstance(n.func, ast.Attribute) and n.func.attr == "restore_luc_khoi_dong"]
    assert len(goi) == 1, "app/main.py phải gọi restore_luc_khoi_dong đúng một lần"


def test_CLI_khong_tu_day_len_khi_thieu_co_persist():
    """Dựng lại index là việc cục bộ; xuất bản nó cho mọi instance khác là việc khác.
    Không được ngầm."""
    import pathlib

    src = (pathlib.Path(__file__).resolve().parents[1] / "scripts"
           / "dung_lai_index_tu_postgres.py").read_text(encoding="utf-8")
    assert "--persist" in src
    i = src.find("publish_sau_rebuild")
    assert i > 0
    assert "args.persist" in src[:i], "đẩy lên phải nằm sau kiểm cờ --persist"


def test_dry_run_KHONG_goi_embedding():
    """`--dry-run` (mặc định) chỉ đếm — không được tiêu một đồng API nào.

    Đọc bằng AST chứ không phải `str.find`. Bản cũ so vị trí chuỗi
    `"rebuild_index_tu_postgres"` với chuỗi `"(xem trước)"`, nên một dòng CHÚ THÍCH
    nhắc tên hàm đó cũng đủ làm test đỏ — đã xảy ra thật ngày 2026-09-04. Cùng lớp
    lỗi với `test_KHONG_tu_chay_o_dau_ca` đã chuyển sang AST trước đó: thứ cần
    khẳng định là LỜI GỌI, không phải sự xuất hiện của một cái tên.
    """
    import ast
    import pathlib

    src = (pathlib.Path(__file__).resolve().parents[1] / "scripts"
           / "dung_lai_index_tu_postgres.py").read_text(encoding="utf-8")
    cay = ast.parse(src)
    ham = next(n for n in ast.walk(cay)
               if isinstance(n, ast.FunctionDef) and n.name == "main")

    def _ten(node):
        f = node.func
        return f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")

    dong_goi = [n.lineno for n in ast.walk(ham)
                if isinstance(n, ast.Call) and _ten(n) == "rebuild_index_tu_postgres"]
    assert dong_goi, "main() phải gọi rebuild_index_tu_postgres ở nhánh --thuc-hien"

    # Nhánh xem trước: `if not args.thuc_hien:` ... `return`
    dong_thoat = [n.lineno
                  for nhanh in ast.walk(ham) if isinstance(nhanh, ast.If)
                  for n in ast.walk(nhanh) if isinstance(n, ast.Return)
                  and "thuc_hien" in ast.dump(nhanh.test)]
    assert dong_thoat, "không tìm thấy nhánh thoát của --dry-run"
    assert min(dong_thoat) < min(dong_goi), (
        "nhánh xem trước phải return TRƯỚC lời gọi dựng lại")


# ── Không rò bí mật ────────────────────────────────────────────────────────
def test_khong_ro_bi_mat_ra_log_hay_loi(tmp_path, cau_hinh, monkeypatch, capsys):
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb-bi-mat-khong-duoc-ro")
    monkeypatch.setenv("SUPABASE_URL", "https://vi-du.supabase.co")
    kho = KhoGia()
    ps.publish(_dung_index(tmp_path / "index"), storage=kho)
    ra = capsys.readouterr().out
    assert "sb-bi-mat-khong-duoc-ro" not in ra
    assert "Bearer" not in ra and "apikey" not in ra
    assert "[index_persistence] upload started" in ra
    assert "[index_persistence] upload completed" in ra
