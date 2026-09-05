"""Index dùng chung giữa nhiều tiến trình: web phải thấy bản mới, worker không đè nhau.

Hai lỗ hổng mà phase tách ingest sang worker riêng để lại, cả hai chỉ xuất hiện khi có
từ hai tiến trình:

1. **Web phục vụ index ôi.** `_VS_CACHE` khoá theo `mtime+size` của đĩa CỤC BỘ. Worker
   ở container khác publish lên Supabase mà không chạm đĩa của web ⇒ cache không bao
   giờ hết hạn ⇒ tài liệu vừa ingest không tìm thấy, không một lỗi nào.
2. **Hai worker ghi đè nhau.** `threading.Lock` không có nghĩa giữa hai tiến trình.

Các test dưới đây kiểm HÀNH VI (gọi hàm thật, kho và Redis là bản giả), không đọc chuỗi.
Không cần credential thật, không cần Redis thật.
"""

from __future__ import annotations

import json
import threading
import time

import pytest

from app.domains.vectorstore import dong_bo as db

# Giá trị MÔI TRƯỜNG lúc collect — trước khi fixture nào kịp đặt gì. Đây mới là thứ
# nói được `BE/.env` có rò vào bộ test hay không.
import os as _os  # noqa: E402

_QUEUE_ENV_LUC_COLLECT = _os.getenv("QUEUE_ENABLED")


# ── Kho object giả ────────────────────────────────────────────────────────
class KhoGia:
    """Đủ ba phương thức mà persistence dùng: download / exists / upload."""

    def __init__(self, version="V2", hong=False, thieu_con_tro=False):
        self.version = version
        self.hong = hong
        self.thieu_con_tro = thieu_con_tro
        self.so_lan_doc = 0

    def download(self, khoa):
        self.so_lan_doc += 1
        if self.hong:
            raise RuntimeError("supabase 503")
        if khoa.endswith("current.json"):
            if self.thieu_con_tro:
                raise RuntimeError("404 not found")
            return json.dumps({"version": self.version}).encode()
        raise RuntimeError(f"không mong đợi: {khoa}")

    def exists(self, khoa):
        if self.hong:
            raise RuntimeError("supabase 503")
        return not self.thieu_con_tro

    def upload(self, *a, **k):
        return None


@pytest.fixture(autouse=True)
def _moi_truong_sach(monkeypatch, tmp_path):
    """Mỗi test một thư mục index riêng, TTL tắt, không Redis."""
    from app.domains.vectorstore import store as _store

    monkeypatch.setattr(_store, "INDEX_DIR", tmp_path / "index")
    (tmp_path / "index").mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("INDEX_SYNC_TTL_SEC", "0")
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("QUEUE_ENABLED", "false")
    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", "1")
    db.dat_lai_nhip_kiem()
    yield


def _khoi_phuc_gia(monkeypatch, *, no=None):
    """Thay `persistence.restore` — test không tải index thật."""
    from app.domains.vectorstore import persistence as ps

    da_goi: list = []

    def gia(**kw):
        da_goi.append(kw)
        if no is not None:
            raise no
        return {"restored": True, "version": "V2", "files": 3}

    monkeypatch.setattr(ps, "restore", gia)
    return da_goi


# ── PART A — web thấy bản mới ─────────────────────────────────────────────
def test_kho_co_V2_ma_dia_dang_V1_thi_nap_V2(monkeypatch):
    kho = KhoGia(version="V2")
    da_goi = _khoi_phuc_gia(monkeypatch)
    db.ghi_phien_ban_cuc_bo("V1")

    ra = db.dong_bo(storage=kho, slug="s")

    assert ra["da_dong_bo"] is True and ra["version"] == "V2"
    assert da_goi and da_goi[0]["ghi_de"] is True, "phải ghi đè, không thì restore bỏ qua"
    assert db.phien_ban_cuc_bo() == "V2", "mốc cục bộ phải theo bản vừa nạp"


def test_dang_la_ban_moi_nhat_thi_KHONG_tai_gi(monkeypatch):
    kho = KhoGia(version="V2")
    da_goi = _khoi_phuc_gia(monkeypatch)
    db.ghi_phien_ban_cuc_bo("V2")

    ra = db.dong_bo(storage=kho, slug="s")

    assert ra["da_dong_bo"] is False and ra["ly_do"] == "đã là bản mới nhất"
    assert da_goi == [], "không được tải lại index khi version không đổi"


def test_hoi_kho_hong_thi_GIU_ban_cuc_bo(monkeypatch):
    """Supabase chập chờn KHÔNG được làm chết truy hồi."""
    kho = KhoGia(hong=True)
    da_goi = _khoi_phuc_gia(monkeypatch)
    db.ghi_phien_ban_cuc_bo("V1")

    ra = db.dong_bo(storage=kho, slug="s")

    assert ra["da_dong_bo"] is False and "con trỏ" in ra["ly_do"]
    assert da_goi == []
    assert db.phien_ban_cuc_bo() == "V1", "mốc cục bộ không được đụng"


def test_ban_tu_xa_khong_hop_le_thi_KHONG_pha_ban_dang_chay(monkeypatch):
    """`restore` thẩm định ở staging rồi mới thăng cấp; ở đây khẳng định hệ quả: hỏng
    thẩm định thì mốc vẫn là V1 và không có ngoại lệ nào thoát ra đường đọc."""
    from app.domains.vectorstore.rebuild import RebuildValidationError

    kho = KhoGia(version="V2")
    _khoi_phuc_gia(monkeypatch, no=RebuildValidationError("danh tính lệch cấu hình"))
    db.ghi_phien_ban_cuc_bo("V1")

    ra = db.dong_bo(storage=kho, slug="s")

    assert ra["da_dong_bo"] is False and "khôi phục hỏng" in ra["ly_do"]
    assert ra["version"] == "V1" and ra["version_tu_xa"] == "V2"
    assert db.phien_ban_cuc_bo() == "V1"


def test_nap_xong_thi_cache_vectorstore_bi_xoa(monkeypatch):
    from app.domains.vectorstore import store as _store

    _store._VS_CACHE["key"] = ("cu",)
    _store._VS_CACHE["vs"] = object()
    _khoi_phuc_gia(monkeypatch)
    db.ghi_phien_ban_cuc_bo("V1")

    db.dong_bo(storage=KhoGia(version="V2"), slug="s")

    assert _store._VS_CACHE["key"] is None and _store._VS_CACHE["vs"] is None


def test_TTL_chan_bot_luot_hoi_kho(monkeypatch):
    """Không được hỏi kho mỗi query. TTL > 0 thì lượt thứ hai phải bị chặn."""
    monkeypatch.setenv("INDEX_SYNC_TTL_SEC", "300")
    db.dat_lai_nhip_kiem()
    kho = KhoGia(version="V1")
    db.ghi_phien_ban_cuc_bo("V1")

    db.dong_bo(storage=kho, slug="s")
    db.dong_bo(storage=kho, slug="s")
    db.dong_bo(storage=kho, slug="s")

    assert kho.so_lan_doc == 1, f"hỏi kho {kho.so_lan_doc} lần trong TTL"


def test_bat_buoc_bo_qua_TTL(monkeypatch):
    """Đường GHI không được dùng câu trả lời cũ trong TTL."""
    monkeypatch.setenv("INDEX_SYNC_TTL_SEC", "300")
    db.dat_lai_nhip_kiem()
    kho = KhoGia(version="V1")
    db.ghi_phien_ban_cuc_bo("V1")

    db.dong_bo(storage=kho, slug="s")
    db.dong_bo(storage=kho, slug="s", bat_buoc=True)

    assert kho.so_lan_doc == 2


def test_chua_bat_persistence_thi_KHONG_cham_mang(monkeypatch):
    """Máy dev và CI: không kho, không mạng, không đổi hành vi."""
    monkeypatch.delenv("INDEX_PERSISTENCE_ENABLED", raising=False)
    kho = KhoGia()
    ra = db.dong_bo(storage=kho, slug="s")
    assert ra["da_dong_bo"] is False and kho.so_lan_doc == 0


def test_duong_doc_cua_store_co_goi_dong_bo(monkeypatch, tmp_path):
    """`load_vectorstore(use_cache=True)` là đường retrieval — nó phải hỏi. Đường ghi
    (`use_cache=False`) thì KHÔNG: người ghi tự đồng bộ trong khoá của mình."""
    from app.domains.vectorstore import store as _store

    goi: list = []
    monkeypatch.setattr(db, "dong_bo", lambda **k: goi.append(k) or {})
    monkeypatch.setattr(_store, "_skip_faiss_in_ci", lambda: False)

    _store.load_vectorstore(use_cache=True)
    assert len(goi) == 1, "đường đọc phải kiểm version"

    _store.load_vectorstore(use_cache=False)
    assert len(goi) == 1, "đường ghi không được tự kéo index dưới chân mình"


def test_dong_bo_hong_KHONG_lam_chet_duong_doc(monkeypatch):
    """Ngoại lệ lạ từ lớp đồng bộ không được thoát ra `load_vectorstore`."""
    from app.domains.vectorstore import store as _store

    monkeypatch.setattr(db, "dong_bo", lambda **k: (_ for _ in ()).throw(
        RuntimeError("lỗi lạ")))
    monkeypatch.setattr(_store, "_skip_faiss_in_ci", lambda: False)
    assert _store.load_vectorstore(use_cache=True) is None  # không có index -> None


# ── PART A' — đường GHI nghiêm ngặt hơn đường đọc ─────────────────────────
def test_ghi_ma_khong_dong_bo_duoc_thi_NEM(monkeypatch):
    """Đọc hỏng thì phục vụ bản cũ. GHI hỏng mà đi tiếp là append lên bản cũ rồi
    publish đè — xoá vector của lượt ingest khác."""
    _khoi_phuc_gia(monkeypatch)
    db.ghi_phien_ban_cuc_bo("V1")

    class KhoLoiTaiVe(KhoGia):
        def download(self, khoa):
            raise RuntimeError("timeout")

    with pytest.raises(db.KhongDongBoDuoc):
        db.dong_bo_truoc_khi_ghi(storage=KhoLoiTaiVe(), slug="s")


def test_kho_chua_co_ban_nao_thi_ghi_binh_thuong(monkeypatch):
    """Cài mới: chưa ai publish. Lượt ingest này là bản đầu tiên — không được chặn."""
    ra = db.dong_bo_truoc_khi_ghi(storage=KhoGia(thieu_con_tro=True), slug="s")
    assert ra["da_dong_bo"] is False and "bản đầu" in ra["ly_do"]


def test_ghi_thi_keo_ban_moi_nhat_ve_truoc(monkeypatch):
    da_goi = _khoi_phuc_gia(monkeypatch)
    db.ghi_phien_ban_cuc_bo("V1")
    ra = db.dong_bo_truoc_khi_ghi(storage=KhoGia(version="V2"), slug="s")
    assert ra["da_dong_bo"] is True and da_goi[0]["ghi_de"] is True


# ── PART B — khoá ghi giữa các tiến trình ─────────────────────────────────
class KhoaGia:
    """Bắt chước `redis.lock.Lock`: chỉ một người giữ được tại một thời điểm."""

    _dang_giu: set = set()

    def __init__(self, ten, timeout=None, blocking_timeout=None):
        self.ten = ten
        self.han = timeout
        self.cho = blocking_timeout
        self.cua_toi = False

    def acquire(self):
        if self.ten in KhoaGia._dang_giu:
            return False
        KhoaGia._dang_giu.add(self.ten)
        self.cua_toi = True
        return True

    def release(self):
        if self.cua_toi:
            KhoaGia._dang_giu.discard(self.ten)
            self.cua_toi = False


class RedisGia:
    def __init__(self):
        self.tham_so: dict = {}

    def lock(self, ten, timeout=None, blocking_timeout=None):
        self.tham_so = {"ten": ten, "timeout": timeout, "blocking_timeout": blocking_timeout}
        return KhoaGia(ten, timeout, blocking_timeout)


@pytest.fixture
def redis_gia(monkeypatch):
    import sys
    import types

    KhoaGia._dang_giu.clear()
    r = RedisGia()
    gia = types.ModuleType("redis")
    gia.from_url = lambda url: r
    monkeypatch.setitem(sys.modules, "redis", gia)
    monkeypatch.setenv("REDIS_URL", "redis://x:6379/0")
    monkeypatch.setenv("QUEUE_ENABLED", "1")
    yield r
    KhoaGia._dang_giu.clear()


def test_hai_tien_trinh_KHONG_cung_vao_doan_sua_index(redis_gia):
    """Khẳng định trung tâm của PART B."""
    with db.khoa_ghi_index(slug="s") as a:
        assert a["che_do"] == "phan-tan"
        with pytest.raises(db.KhongLayDuocKhoa):
            with db.khoa_ghi_index(slug="s"):
                pytest.fail("hai tiến trình cùng vào được đoạn sửa index")
    # Ra khỏi `with` là nhả — người kế tiếp vào được.
    with db.khoa_ghi_index(slug="s") as b:
        assert b["che_do"] == "phan-tan"


def test_khoa_co_HAN_de_worker_chet_khong_ket_vinh_vien(redis_gia):
    with db.khoa_ghi_index(slug="s"):
        pass
    assert redis_gia.tham_so["timeout"] and redis_gia.tham_so["timeout"] > 0
    assert redis_gia.tham_so["blocking_timeout"] is not None


def test_moi_khong_gian_vector_mot_khoa_rieng(redis_gia):
    with db.khoa_ghi_index(slug="fpt__A__api"):
        with db.khoa_ghi_index(slug="fpt__B__api") as b:
            assert b["che_do"] == "phan-tan", "index khác nhau không được chặn nhau"


def test_redis_hong_o_che_do_nhieu_tien_trinh_thi_TU_CHOI_ghi(monkeypatch):
    """Redis chết = không còn gì bảo vệ index. Chạy tiếp là cược vào việc worker kia
    đang rảnh."""
    import sys
    import types

    gia = types.ModuleType("redis")
    gia.from_url = lambda url: (_ for _ in ()).throw(RuntimeError("connection refused"))
    monkeypatch.setitem(sys.modules, "redis", gia)
    monkeypatch.setenv("REDIS_URL", "redis://x:6379/0")
    monkeypatch.setenv("QUEUE_ENABLED", "1")

    with pytest.raises(db.KhongLayDuocKhoa):
        with db.khoa_ghi_index(slug="s"):
            pytest.fail("đã ghi index khi không có khoá nào bảo vệ")


def test_khong_co_REDIS_URL_thi_no_op(monkeypatch):
    """`QUEUE_ENABLED=false`: một tiến trình, `threading.Lock` ở chỗ gọi là đủ và đúng.
    Dựng một hàng rào giả ở đây chỉ để trông an toàn thì tệ hơn không có."""
    monkeypatch.delenv("REDIS_URL", raising=False)
    with db.khoa_ghi_index(slug="s") as a:
        assert a["che_do"] == "trong-tien-trinh"
        with db.khoa_ghi_index(slug="s") as b:
            assert b["che_do"] == "trong-tien-trinh"


def test_khoa_duoc_nha_ca_khi_than_with_nem(redis_gia):
    with pytest.raises(ValueError):
        with db.khoa_ghi_index(slug="s"):
            raise ValueError("hỏng giữa chừng")
    with db.khoa_ghi_index(slug="s") as a:
        assert a["che_do"] == "phan-tan", "khoá không được kẹt sau một lượt hỏng"


def test_khoa_that_su_tuan_tu_hoa_hai_luong(redis_gia):
    """Chạy THẬT hai luồng qua đúng context manager. Bên thua phải ném, không được
    lọt vào đoạn tới hạn."""
    trong: list = []
    loi: list = []
    bat_dau = threading.Event()

    def mot_luot():
        bat_dau.wait()
        try:
            with db.khoa_ghi_index(slug="s"):
                trong.append(1)
                time.sleep(0.05)
        except db.KhongLayDuocKhoa:
            loi.append(1)

    ts = [threading.Thread(target=mot_luot) for _ in range(2)]
    for t in ts:
        t.start()
    bat_dau.set()
    for t in ts:
        t.join(5)

    assert len(trong) == 1 and len(loi) == 1


# ── PART C — đoạn tới hạn trong ingest bao đủ bốn việc ────────────────────
def test_ingest_bao_ca_dong_bo_append_ghi_DB_va_xuat_ban():
    """Đọc bằng AST: bốn lời gọi phải nằm trong THÂN của `with`, và `with` phải giữ CẢ
    hai khoá. Đoạn tới hạn hẹp hơn là đủ chỗ cho hai worker mất vector của nhau."""
    import ast
    import inspect

    from app.graphs import ingest_graph as ig

    src = inspect.getsource(ig.build_ingest_graph)
    i = src.index("def embed_index_node")
    j = src.index("def memory_tree_node", i)
    than = src[i:j]
    cay = ast.parse("def _x():\n" + "\n".join("    " + d for d in than.splitlines()[1:]))

    def _ten(n):
        f = n.func
        return f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")

    trong_with: set = set()
    khoa_cua_with: set = set()
    for n in ast.walk(cay):
        if isinstance(n, ast.With):
            for m in n.items:
                khoa_cua_with.add(_ten(m.context_expr)
                                  if isinstance(m.context_expr, ast.Call)
                                  else getattr(m.context_expr, "id", ""))
            for c in ast.walk(n):
                if isinstance(c, ast.Call):
                    trong_with.add(_ten(c))

    assert "_KHOA_INDEX" in khoa_cua_with, "thiếu khoá trong-tiến-trình"
    assert "khoa_ghi_index" in khoa_cua_with, "thiếu khoá giữa các tiến trình"
    for ten in ("dong_bo_truoc_khi_ghi", "append_to_index",
                "_persist_sections_and_chunks", "cong_bo_sau_ingest"):
        assert ten in trong_with, f"{ten} nằm ngoài đoạn tới hạn"


def test_dong_bo_chay_TRUOC_append():
    """Thứ tự là bản chất: đồng bộ sau khi append thì đã append lên bản cũ mất rồi."""
    import inspect

    from app.graphs import ingest_graph as ig

    src = inspect.getsource(ig.build_ingest_graph)
    i = src.index("def embed_index_node")
    than = src[i:src.index("def memory_tree_node", i)]
    assert than.index("dong_bo_truoc_khi_ghi") < than.index("append_to_index(")


# ── PART D/E — những hợp đồng cũ không được đụng ──────────────────────────
def test_phan_loai_loi_khong_doi():
    from shared.interfaces import errors as loi

    assert loi.ma_loi(loi.EmbeddingProviderAuthFailed("x")) == loi.EMBEDDING_PROVIDER_AUTH_FAILED
    assert loi.ma_loi(loi.EmbeddingProviderUnavailable("x")) == loi.EMBEDDING_PROVIDER_UNAVAILABLE
    assert loi.ma_loi(loi.EmbeddingRequestFailed("x")) == loi.EMBEDDING_REQUEST_FAILED
    assert "rebuild" in loi.thong_diep(loi.INDEX_INCOMPATIBLE).lower()
    assert "rebuild" not in loi.thong_diep(loi.EMBEDDING_PROVIDER_AUTH_FAILED).lower()


def test_hai_ngu_nghia_xuat_ban_khong_doi(monkeypatch):
    from app.domains.vectorstore import persistence as ps

    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", "1")
    monkeypatch.setattr(ps, "publish", lambda *a, **k: (_ for _ in ()).throw(
        RuntimeError("bucket 500")))
    with pytest.raises(ps.PublishFailed):
        ps.cong_bo_sau_ingest()
    assert ps.publish_sau_rebuild()["published"] is False   # rebuild vẫn nuốt


def test_dinh_dang_kho_ben_khong_doi():
    """Mốc version là file ẩn CẠNH artifact, không phải một file mới trong bộ artifact —
    `publish` chỉ đẩy đúng bộ cũ."""
    from app.domains.vectorstore import persistence as ps

    assert ps.FILE_BAT_BUOC == ("index.faiss", "index.pkl", "index.json")
    assert ps.FILE_TUY_CHON == ("chunks.sqlite",)
    assert db.TEN_PHIEN_BAN not in ps.FILE_BAT_BUOC + ps.FILE_TUY_CHON
def test_co_REDIS_URL_ma_TAT_queue_thi_van_no_op(monkeypatch):
    """Regression đã va phải: `BE/.env` của máy dev có sẵn `REDIS_URL` cho cache ngữ
    nghĩa. Nhìn mỗi biến đó là mọi lượt ingest trên máy dev đòi Redis, không có Redis
    là ingest chết. Rủi ro nhiều tiến trình chỉ tồn tại khi có worker RQ."""
    monkeypatch.setenv("REDIS_URL", "redis://co-that:6379/0")
    monkeypatch.setenv("QUEUE_ENABLED", "false")
    assert db.khoa_phan_tan_kha_dung() is False
    with db.khoa_ghi_index(slug="s") as a:
        assert a["che_do"] == "trong-tien-trinh"


def test_conftest_trung_hoa_QUEUE_ENABLED():
    """Lần thứ ba của cùng một lớp lỗi (sau `DATABASE_URL` và `FPT_AI_API_KEY`): cấu
    hình trong `BE/.env` của một người quyết định kết quả test của mọi người. Từ khi
    ingest có khoá ghi phân tán, `QUEUE_ENABLED=true` + không có Redis = 10 test đỏ."""
    assert not (_QUEUE_ENV_LUC_COLLECT or "").strip(), (
        "QUEUE_ENABLED rò từ BE/.env vào bộ test")


# ── Chứng minh bổ sung cho phase rà soát ─────────────────────────────────
def test_duong_doc_KHONG_cham_kho_khi_persistence_TAT(monkeypatch):
    """Không phải "không tải index" — mà là KHÔNG DỰNG NỔI client kho.

    Máy dev và CI không có Supabase. Nếu đường đọc chạm tới `get_storage()` thì mỗi
    query sẽ nuốt một ngoại lệ — im lặng nhưng vẫn là chi phí, và là một sợi dây phụ
    thuộc không ai muốn có. Bẫy thẳng vào hàm ấy.
    """
    from app.domains.vectorstore import persistence as ps
    from app.domains.vectorstore import store as _store

    monkeypatch.delenv("INDEX_PERSISTENCE_ENABLED", raising=False)
    monkeypatch.setattr(ps, "get_storage", lambda: pytest.fail(
        "đường đọc chạm vào kho object dù persistence đang TẮT"))
    monkeypatch.setattr(_store, "_skip_faiss_in_ci", lambda: False)

    _store.load_vectorstore(use_cache=True)      # không được nổ
    assert db.dong_bo()["da_dong_bo"] is False


def test_duong_doc_KHONG_cham_Redis(monkeypatch):
    """Đọc không cần khoá. Nếu đường đọc lỡ đụng Redis thì mọi query phụ thuộc Redis."""
    import sys
    import types

    from app.domains.vectorstore import store as _store

    gia = types.ModuleType("redis")
    gia.from_url = lambda *a, **k: pytest.fail("đường đọc chạm vào Redis")
    monkeypatch.setitem(sys.modules, "redis", gia)
    monkeypatch.setenv("REDIS_URL", "redis://x:6379/0")
    monkeypatch.setenv("QUEUE_ENABLED", "1")
    monkeypatch.setattr(_store, "_skip_faiss_in_ci", lambda: False)

    _store.load_vectorstore(use_cache=True)


def test_cache_CHI_bi_xoa_sau_mot_lan_restore_thanh_cong(monkeypatch):
    """Mặt còn lại của `test_nap_xong_thi_cache_vectorstore_bi_xoa`.

    Xoá cache khi restore HỎNG là tự bắn vào chân: bản cục bộ vẫn hợp lệ và vẫn đang
    phục vụ, xoá cache chỉ buộc mọi query kế tiếp deserialize lại toàn bộ docstore —
    đúng thứ cache sinh ra để tránh — cho một lượt đồng bộ đã thất bại.
    """
    from app.domains.vectorstore import store as _store

    khoa_cu, vs_cu = ("khoa-cu",), object()

    # (a) hỏi kho hỏng
    _store._VS_CACHE["key"], _store._VS_CACHE["vs"] = khoa_cu, vs_cu
    db.ghi_phien_ban_cuc_bo("V1")
    db.dong_bo(storage=KhoGia(hong=True), slug="s")
    assert _store._VS_CACHE["key"] is khoa_cu and _store._VS_CACHE["vs"] is vs_cu

    # (b) tải về được nhưng thẩm định trượt
    from app.domains.vectorstore.rebuild import RebuildValidationError

    _khoi_phuc_gia(monkeypatch, no=RebuildValidationError("danh tính lệch"))
    _store._VS_CACHE["key"], _store._VS_CACHE["vs"] = khoa_cu, vs_cu
    db.dong_bo(storage=KhoGia(version="V2"), slug="s")
    assert _store._VS_CACHE["key"] is khoa_cu and _store._VS_CACHE["vs"] is vs_cu

    # (c) restore thành công -> mới được xoá
    _khoi_phuc_gia(monkeypatch)
    db.dong_bo(storage=KhoGia(version="V3"), slug="s")
    assert _store._VS_CACHE["key"] is None and _store._VS_CACHE["vs"] is None


def test_dong_bo_KHONG_goi_nguoc_lai_duong_doc(monkeypatch):
    """Chống đệ quy: `dong_bo` -> `restore` -> `load_vectorstore(use_cache=True)` ->
    `dong_bo` -> … Hôm nay `_thu_nap_canonical` gọi thẳng `FAISS.load_local` nên không
    có vòng nào; test này khoá lại điều đó trước khi ai đó "dọn dẹp" nó thành lời gọi
    `load_vectorstore` cho gọn."""
    import ast
    import inspect

    from app.domains.vectorstore import persistence as ps

    cay = ast.parse(inspect.getsource(ps._thu_nap_canonical))
    ten_goi = {n.func.attr if isinstance(n.func, ast.Attribute) else getattr(n.func, "id", "")
               for n in ast.walk(cay) if isinstance(n, ast.Call)}
    assert "load_vectorstore" not in ten_goi


def test_khoa_TTL_khong_giu_trong_luc_goi_mang(monkeypatch):
    """`_khoa_kiem` chỉ bao phép đọc/ghi một con số. Giữ nó qua một lời gọi mạng là
    biến mọi query thành hàng đợi nối đuôi sau một request Supabase chậm."""
    import ast
    import inspect

    cay = ast.parse(inspect.getsource(db.dong_bo))
    for n in ast.walk(cay):
        if isinstance(n, ast.With) and any(
                getattr(m.context_expr, "id", "") == "_khoa_kiem" for m in n.items):
            trong = {c.func.attr if isinstance(c.func, ast.Attribute)
                     else getattr(c.func, "id", "")
                     for c in ast.walk(n) if isinstance(c, ast.Call)}
            assert not (trong & {"phien_ban_tu_xa", "restore", "download"}), trong
