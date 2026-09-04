"""Vòng đời index đầu-cuối: dựng → thẩm định → đẩy lên → khôi phục → NẠP → TRUY HỒI.

Mọi test khác trong bộ này dừng ở "file tồn tại" hoặc "manifest đúng". File này không.
Nó chạy tiếp qua chính cái loader mà production dùng và lấy ra chunk thật, vì đúng chỗ
đó là chỗ hai định dạng index từng lệch nhau mà không ai thấy:

`FAISS.load_local` ghi `IndexFlatL2`, `idx.search` trả về VỊ TRÍ trong index. Nhánh
legacy lại đọc cùng file `index.faiss` ấy và dùng số trả về làm `chunk_id`. Hai định
dạng, một tên file, và nghĩa của con số bên trong khác nhau — trùng khớp được chỉ vì
rebuild đánh id 0..N-1 đúng theo thứ tự khoá `index.json`. Một test chỉ kiểm sự tồn
tại của file sẽ xanh trong cả hai trường hợp.

Nên ở đây: khôi phục xong thì HỎI, và so câu trả lời với chunk đã nạp vào.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from langchain_core.embeddings import Embeddings

from app.domains.vectorstore import persistence as ps
from app.domains.vectorstore import rebuild as rb
from app.domains.vectorstore import store as st

DT = {"embedding_provider": "fpt", "embedding_model_name": "Vietnamese_Embedding",
      "embedding_strategy": "api_pooled"}

# Ba đoạn văn, ba trục toạ độ khác nhau — hỏi trục nào thì đoạn ấy phải lên đầu.
DOAN = [
    ("Quang hop tao ra khi oxy.", [1.0, 0.0, 0.0, 0.0]),
    ("Ha Noi la thu do Viet Nam.", [0.0, 1.0, 0.0, 0.0]),
    ("Diep luc to hap thu anh sang.", [0.0, 0.0, 1.0, 0.0]),
]


class EmbGia(Embeddings):
    """Embedding tất định: text đã biết -> vector đã biết, còn lại -> trục thứ tư.

    Không gọi mạng, không nạp model — test vòng đời không được phụ thuộc vào một API
    ngoài, và cũng không được tốn tiền embedding thật.
    """

    _BANG = {t: v for t, v in DOAN}

    def embed_documents(self, texts):
        return [self._BANG.get(t, [0.0, 0.0, 0.0, 1.0]) for t in texts]

    def embed_query(self, text):
        return self._BANG.get(text, [0.0, 0.0, 0.0, 1.0])


class KhoGia:
    def __init__(self):
        self.data: dict[str, bytes] = {}
        self.log: list[str] = []

    def upload(self, path, data, *, content_type=None):
        self.log.append(f"upload {path}")
        self.data[path] = bytes(data)
        return path

    def download(self, path):
        self.log.append(f"download {path}")
        if path not in self.data:
            raise RuntimeError(f"404 {path}")
        return self.data[path]

    def exists(self, path):
        self.log.append(f"exists {path}")
        return path in self.data


@pytest.fixture()
def moi_truong(monkeypatch):
    """Bật FPT embedding ở mức CẤU HÌNH (để danh tính là fpt/api_pooled và
    `_skip_faiss_in_ci` không chặn), nhưng thay đối tượng embedding bằng bản giả —
    không một lời gọi API nào."""
    monkeypatch.setenv("FPT_AI_API_KEY", "sk-khoa-gia-chi-dung-trong-test")
    monkeypatch.setenv("FPT_AI_EMBEDDING_MODEL", "Vietnamese_Embedding")
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
    monkeypatch.setenv("USE_LC_VECTOR_STORE", "1")
    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", "1")
    monkeypatch.setattr(st, "get_embeddings", lambda: EmbGia())
    st._VS_CACHE["key"] = None
    st._VS_CACHE["vs"] = None
    yield
    st._VS_CACHE["key"] = None
    st._VS_CACHE["vs"] = None


def _ban_ghi():
    return [{"chunk_id": f"c{i}", "document_id": "d1", "source_stem": "d1_txt",
             "text": t} for i, (t, _) in enumerate(DOAN)]


def _dung(thu_muc: Path) -> Path:
    rb._ghi_staging(thu_muc, _ban_ghi(), [v for _, v in DOAN], 4, DT, emb_obj=EmbGia())
    return thu_muc


# ── CASE A — BUILD ─────────────────────────────────────────────────────────
def test_A_build_ra_dung_bo_artifact_canonical(moi_truong, tmp_path):
    d = _dung(tmp_path / "index")
    assert sorted(p.name for p in d.iterdir()) == ["index.faiss", "index.json", "index.pkl"]

    mm = json.loads((d / "index.json").read_text(encoding="utf-8"))["__meta__"]
    assert mm["version"] == "1.2"
    assert mm["embedding_dim"] == 4
    assert mm["num_chunks"] == 3
    assert mm["vector_backend"] == "langchain_faiss", (
        "rebuild phải khai đúng định dạng nó vừa ghi, không phải faiss_idmap nữa")
    assert {k: mm[k] for k in DT} == DT

    import faiss
    idx = faiss.read_index(str(d / "index.faiss"))
    assert idx.d == 4 and idx.ntotal == 3


def test_A_tham_dinh_doi_du_ba_file(moi_truong, tmp_path):
    d = _dung(tmp_path / "index")
    rb.tham_dinh_staging(d, so_chunk=3, dim=4, danh_tinh=DT)
    (d / "index.pkl").unlink()
    with pytest.raises(rb.RebuildValidationError, match="index.pkl"):
        rb.tham_dinh_staging(d, so_chunk=3, dim=4, danh_tinh=DT)


# ── CASE B — PERSIST ───────────────────────────────────────────────────────
def test_B_day_len_dung_thu_tu_va_du_artifact(moi_truong, tmp_path):
    kho = KhoGia()
    ra = ps.publish(_dung(tmp_path / "index"), storage=kho)

    upload = [x.split(" ", 1)[1] for x in kho.log if x.startswith("upload ")]
    assert len(upload) == 5, "3 artifact + manifest + con trỏ"
    assert upload[-1].endswith("current.json")
    assert upload[-2].endswith("manifest.json")
    assert {Path(p).name for p in upload[:3]} == {"index.faiss", "index.pkl", "index.json"}

    mf = json.loads(kho.data[ps.khoa_version(ra["slug"], ra["version"], "manifest.json")])
    assert {f["name"] for f in mf["files"]} == {"index.faiss", "index.pkl", "index.json"}
    assert ra["slug"] == "fpt__Vietnamese_Embedding__api_pooled", "đường dẫn tất định"
    assert "sk-" not in json.dumps(mf), "manifest không được mang khoá"


# ── CASE C + D — RESTORE RỒI TRUY HỒI THẬT ─────────────────────────────────
def _khoi_phuc_vao(tmp_path, kho, monkeypatch) -> Path:
    dich = tmp_path / "moi" / "index"
    monkeypatch.setattr(st, "INDEX_DIR", dich)
    monkeypatch.setattr(st, "INDEX_PATH", str(dich / "index.faiss"))
    monkeypatch.setattr(st, "META_PATH", str(dich / "index.json"))
    ra = ps.restore(thu_muc=dich, storage=kho)
    assert ra["restored"] is True
    return dich


def test_C_khoi_phuc_vao_moi_truong_trong(moi_truong, tmp_path, monkeypatch):
    kho = KhoGia()
    goc = _dung(tmp_path / "goc")
    ps.publish(goc, storage=kho)

    dich = _khoi_phuc_vao(tmp_path, kho, monkeypatch)
    for ten in ("index.faiss", "index.pkl", "index.json"):
        assert (dich / ten).read_bytes() == (goc / ten).read_bytes(), f"{ten} lệch byte"


def test_D_sau_khi_khoi_phuc_thi_LOADER_CANONICAL_nap_duoc(moi_truong, tmp_path, monkeypatch):
    """`FAISS.load_local` — chính hàm production gọi — phải nạp được artifact tải về.

    Đây là điều bản trước KHÔNG làm được: rebuild ghi `IndexIDMap` trần, thiếu
    `index.pkl`, nên `load_vectorstore()` trả None và truy hồi tụt xuống nhánh dự phòng.
    """
    kho = KhoGia()
    ps.publish(_dung(tmp_path / "goc"), storage=kho)
    _khoi_phuc_vao(tmp_path, kho, monkeypatch)

    vs = st.load_vectorstore(use_cache=False)
    assert vs is not None, "loader canonical phải nạp được, không được rơi về fallback"
    assert vs.index.ntotal == 3


@pytest.mark.parametrize("cau_hoi,mong", [
    ("Quang hop tao ra khi oxy.", "Quang hop tao ra khi oxy."),
    ("Ha Noi la thu do Viet Nam.", "Ha Noi la thu do Viet Nam."),
    ("Diep luc to hap thu anh sang.", "Diep luc to hap thu anh sang."),
])
def test_D_khoi_phuc_roi_TRUY_HOI_ra_dung_doan(moi_truong, tmp_path, monkeypatch,
                                               cau_hoi, mong):
    """restore → load → retrieve, đầu-cuối. Không chỉ kiểm file tồn tại."""
    kho = KhoGia()
    ps.publish(_dung(tmp_path / "goc"), storage=kho)
    _khoi_phuc_vao(tmp_path, kho, monkeypatch)

    vs = st.load_vectorstore(use_cache=False)
    cap = vs.similarity_search_with_score(cau_hoi, k=3)
    assert cap[0][0].page_content == mong


def test_D_chunk_id_song_sot_qua_ca_vong_lap(moi_truong, tmp_path, monkeypatch):
    """`chunk_id` trong metadata là cầu nối về `index.json` và về
    `document_chunks.embedding_id`. Mất nó thì truy hồi trả về đoạn văn không tra
    ngược được, và đó đúng là kiểu hỏng im lặng."""
    kho = KhoGia()
    ps.publish(_dung(tmp_path / "goc"), storage=kho)
    dich = _khoi_phuc_vao(tmp_path, kho, monkeypatch)

    vs = st.load_vectorstore(use_cache=False)
    d, _ = vs.similarity_search_with_score("Diep luc to hap thu anh sang.", k=1)[0]
    cid = d.metadata["chunk_id"]
    assert cid == 2
    assert d.metadata["source_stem"] == "d1_txt"

    meta = json.loads((dich / "index.json").read_text(encoding="utf-8"))
    assert meta[str(cid)]["text"] == "Diep luc to hap thu anh sang.", (
        "chunk_id phải trỏ đúng bản ghi trong index.json")


def test_D_HybridRetriever_di_duong_LC_va_tra_dung_chunk(moi_truong, tmp_path, monkeypatch):
    """Đi qua đúng lớp mà `/query` dùng, không phải gọi thẳng vectorstore."""
    from app.domains.retrieval.hybrid import HybridRetriever

    kho = KhoGia()
    ps.publish(_dung(tmp_path / "goc"), storage=kho)
    dich = _khoi_phuc_vao(tmp_path, kho, monkeypatch)

    r = HybridRetriever(index_path=dich / "index.faiss", meta_path=dich / "index.json")
    hits = r.retrieve_faiss_only("Quang hop tao ra khi oxy.", top_k=2)
    assert hits, "nhánh LC phải trả về kết quả sau khi khôi phục"
    assert hits[0].text == "Quang hop tao ra khi oxy."
    assert hits[0].chunk_id == 0
    assert hits[0].video_stem == "d1_txt"


# ── CASE E — ĐƯỜNG NHANH ───────────────────────────────────────────────────
def test_E_co_index_cuc_bo_thi_KHONG_goi_kho(moi_truong, tmp_path):
    kho = KhoGia()
    ps.publish(_dung(tmp_path / "goc"), storage=kho)
    kho.log.clear()

    dich = _dung(tmp_path / "index")
    assert ps.restore(thu_muc=dich, storage=kho)["restored"] is False
    assert kho.log == [], f"không được gọi kho lần nào, đã gọi: {kho.log}"


# ── CASE F — ARTIFACT HỎNG, INDEX CỤC BỘ PHẢI SỐNG ─────────────────────────
def _pha(kho: KhoGia, ten: str, moi: bytes) -> None:
    for k in list(kho.data):
        if k.endswith("/" + ten):
            kho.data[k] = moi


def test_F_pkl_hong_thi_TU_CHOI_va_giu_index_cu(moi_truong, tmp_path, monkeypatch):
    """Pickle hỏng chỉ lộ ra lúc `FAISS.load_local` giải mã. Thẩm định phải chạm tới
    đó, không được dừng ở 'file có tồn tại'."""
    kho = KhoGia()
    ps.publish(_dung(tmp_path / "goc"), storage=kho)
    hong = b"khong-phai-pickle"
    _pha(kho, "index.pkl", hong)
    for k in list(kho.data):
        if k.endswith("manifest.json"):
            mf = json.loads(kho.data[k])
            for f in mf["files"]:
                if f["name"] == "index.pkl":
                    f["sha256"] = ps._bam(hong)
                    f["size"] = len(hong)
            kho.data[k] = json.dumps(mf).encode()

    dich = _dung(tmp_path / "index")
    truoc = (dich / "index.faiss").read_bytes()
    monkeypatch.setattr(st, "INDEX_DIR", dich)
    with pytest.raises(rb.RebuildValidationError):
        ps.restore(thu_muc=dich, storage=kho, ghi_de=True)
    assert (dich / "index.faiss").read_bytes() == truoc, "index cũ phải còn nguyên"
    assert not (tmp_path / "index_restore").exists()


def test_F_manifest_khai_file_khong_ton_tai(moi_truong, tmp_path):
    kho = KhoGia()
    ps.publish(_dung(tmp_path / "goc"), storage=kho)
    for k in list(kho.data):
        if k.endswith("/index.pkl"):
            del kho.data[k]
    with pytest.raises(ps.PersistenceError, match="index.pkl"):
        ps.restore(thu_muc=tmp_path / "moi" / "index", storage=kho)


def test_F_manifest_thieu_artifact_bat_buoc(moi_truong, tmp_path):
    kho = KhoGia()
    ps.publish(_dung(tmp_path / "goc"), storage=kho)
    for k in list(kho.data):
        if k.endswith("manifest.json"):
            mf = json.loads(kho.data[k])
            mf["files"] = [f for f in mf["files"] if f["name"] != "index.pkl"]
            kho.data[k] = json.dumps(mf).encode()
    with pytest.raises(rb.RebuildValidationError, match="thiếu file bắt buộc"):
        ps.restore(thu_muc=tmp_path / "moi" / "index", storage=kho)


# ── Định dạng canonical phải là MỘT ────────────────────────────────────────
def test_ingest_va_rebuild_ghi_CUNG_mot_dinh_dang(moi_truong, tmp_path, monkeypatch):
    """Hai đường ghi index của ứng dụng phải sinh cùng một bộ file. Trước phase này
    `append_chunks_to_lc_index` ghi {faiss, pkl} còn rebuild ghi {faiss} — cùng tên
    file, khác nội dung, và không ai đối chiếu."""
    dich = tmp_path / "ingest"
    monkeypatch.setattr(st, "INDEX_DIR", dich)
    monkeypatch.setattr(st, "INDEX_PATH", str(dich / "index.faiss"))
    monkeypatch.setattr(st, "META_PATH", str(dich / "index.json"))
    st.append_chunks_to_lc_index([t for t, _ in DOAN], source_name="d1_txt",
                                 embeddings=[v for _, v in DOAN])

    tu_ingest = {p.name for p in dich.iterdir() if p.suffix in (".faiss", ".pkl", ".json")}
    tu_rebuild = {p.name for p in _dung(tmp_path / "rebuild").iterdir()}
    assert tu_ingest == tu_rebuild == {"index.faiss", "index.pkl", "index.json"}


# ── Tương thích ngược với index LEGACY (định dạng cũ, không có index.pkl) ──
def _dung_legacy(thu_muc: Path) -> Path:
    """Định dạng CŨ: `faiss.IndexIDMap` trần + `index.json`, KHÔNG có `index.pkl`.
    Đây là thứ `rebuild.py` sinh ra trước phase này, và có thể còn tồn tại trên đĩa."""
    import faiss
    import numpy as np

    thu_muc.mkdir(parents=True, exist_ok=True)
    idx = faiss.IndexIDMap(faiss.IndexFlatL2(4))
    idx.add_with_ids(np.array([v for _, v in DOAN], dtype="float32"),
                     np.arange(len(DOAN), dtype="int64"))
    faiss.write_index(idx, str(thu_muc / "index.faiss"))
    meta = {str(i): {"source_stem": "d1_txt", "text": t} for i, (t, _) in enumerate(DOAN)}
    meta["__meta__"] = {"version": "1.1", "num_chunks": 3, "embedding_dim": 4,
                        "embedding_model_name": "BAAI/bge-m3", "pooling": "mean_late"}
    (thu_muc / "index.json").write_text(json.dumps(meta, ensure_ascii=False),
                                        encoding="utf-8")
    return thu_muc


def test_legacy_KHONG_bi_xoa_hay_migrate_ngam(moi_truong, tmp_path):
    """Không tự chuyển đổi, không tự xoá. Chỉ từ chối dùng nó ở chỗ cần canonical."""
    d = _dung_legacy(tmp_path / "cu")
    truoc = sorted(p.name for p in d.iterdir())
    with pytest.raises(ps.PersistenceError, match="index.pkl"):
        ps.doc_artifact(d)
    assert sorted(p.name for p in d.iterdir()) == truoc, "file legacy phải còn nguyên"


def test_legacy_KHONG_len_duoc_kho_canonical(moi_truong, tmp_path):
    """Đẩy một index thiếu `index.pkl` lên kho là gài mìn cho mọi instance khôi phục
    nó: `load_vectorstore()` sẽ trả None và lần ingest kế tiếp đè mất index."""
    kho = KhoGia()
    with pytest.raises(ps.PersistenceError, match="index.pkl"):
        ps.publish(_dung_legacy(tmp_path / "cu"), storage=kho)
    assert kho.data == {}, "không được đẩy lên nửa chừng"


def test_legacy_tren_dia_thi_loader_canonical_tra_None(moi_truong, tmp_path, monkeypatch):
    """Hành vi cũ giữ nguyên: thiếu `index.pkl` thì `load_vectorstore` trả None."""
    d = _dung_legacy(tmp_path / "cu")
    monkeypatch.setattr(st, "INDEX_DIR", d)
    assert st.load_vectorstore(use_cache=False) is None


def test_ingest_TU_CHOI_ghi_de_len_index_khong_nap_duoc(moi_truong, tmp_path, monkeypatch):
    """Lỗ hổng mất dữ liệu nghiêm trọng nhất phase này bịt được.

    Trước đây: `append_chunks_to_lc_index` gọi `load_vectorstore()`, nhận None (vì
    thiếu `index.pkl` hoặc lệch danh tính), rồi dựng vectorstore MỚI chỉ từ chunk
    đang thêm và `save_local` đè lên `index.faiss`. Toàn bộ vector cũ biến mất, còn
    `index.json` vẫn liệt kê chúng — mất dữ liệu, không một lỗi nào."""
    d = _dung_legacy(tmp_path / "cu")
    truoc = (d / "index.faiss").read_bytes()
    monkeypatch.setattr(st, "INDEX_DIR", d)
    monkeypatch.setattr(st, "INDEX_PATH", str(d / "index.faiss"))
    monkeypatch.setattr(st, "META_PATH", str(d / "index.json"))

    with pytest.raises(st.IndexIdentityMismatch, match="ĐÈ MẤT"):
        st.append_chunks_to_lc_index(["doan moi"], source_name="d2_txt",
                                     embeddings=[[0.0, 0.0, 0.0, 1.0]])
    assert (d / "index.faiss").read_bytes() == truoc, "index cũ phải còn nguyên byte"


def test_append_to_index_KHONG_rot_xuong_legacy_khi_bi_tu_choi(moi_truong, tmp_path,
                                                               monkeypatch):
    """`append_to_index` bọc lời gọi LC trong try/except. Nếu nuốt cả lời từ chối này
    thì nhánh legacy đọc CÙNG file ấy, thấy không phải IndexIDMap, rồi dựng một cái
    rỗng đè lên — đúng cái mất dữ liệu vừa ngăn, chỉ theo đường khác."""
    d = _dung_legacy(tmp_path / "cu")
    truoc = (d / "index.faiss").read_bytes()
    monkeypatch.setattr(st, "INDEX_DIR", d)
    monkeypatch.setattr(st, "INDEX_PATH", str(d / "index.faiss"))
    monkeypatch.setattr(st, "META_PATH", str(d / "index.json"))

    with pytest.raises(st.IndexIdentityMismatch):
        st.append_to_index(["doan moi"], source_name="d2_txt",
                           embeddings=[[0.0, 0.0, 0.0, 1.0]])
    assert (d / "index.faiss").read_bytes() == truoc
