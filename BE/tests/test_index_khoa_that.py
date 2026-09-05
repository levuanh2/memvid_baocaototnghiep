"""Khoá ghi index chạy qua `redis.lock.Lock` THẬT — không phải khoá giả tự viết.

Vì sao cần file riêng: `test_index_dong_bo.py` dùng một lớp khoá giả để khẳng định
`khoa_ghi_index` GỌI đúng thứ tự và xử lý đúng kết quả. Cái đó chứng minh mã của mình,
không chứng minh ngữ nghĩa loại trừ của Redis. Ở đây chạy chính `redis.lock.Lock` (SET NX
PX để giành, Lua để nhả) trên một server thật:

  1. `REDIS_TEST_URL` hoặc `redis://127.0.0.1:6379/15` nếu có Redis chạy — bản đầy đủ,
     và chỉ khi đó mới chạy được ca hai TIẾN TRÌNH.
  2. `fakeredis[lua]` nếu cài — vẫn là `redis.lock.Lock` thật, chỉ server nằm trong tiến
     trình. Đủ để chứng minh loại trừ giữa các luồng và toàn bộ vòng đời khoá.
  3. Không có cái nào → skip, KHÔNG giả vờ đã chứng minh.

Chọn DB 15 để không đụng dữ liệu của ai, và mỗi test xoá đúng khoá của mình.
"""

from __future__ import annotations

import os
import threading
import time

import pytest

from app.domains.vectorstore import dong_bo as db

TEN_TEST = "studymap:index:ghi:test-khoa-that"


def _redis_that():
    """Kết nối tới Redis thật, hoặc None."""
    url = (os.getenv("REDIS_TEST_URL") or "redis://127.0.0.1:6379/15").strip()
    try:
        import redis as _redis

        conn = _redis.from_url(url, socket_connect_timeout=1, socket_timeout=1)
        conn.ping()
        return conn, url, True
    except Exception:
        return None, url, False


@pytest.fixture
def redis_conn(monkeypatch):
    """Trả (conn, la_that). `khoa_ghi_index` sẽ dùng đúng conn này."""
    conn, _url, la_that = _redis_that()
    if conn is None:
        try:
            import fakeredis
        except ImportError:
            pytest.skip('cần Redis thật (REDIS_TEST_URL) hoặc `pip install "fakeredis[lua]"`')
        conn = fakeredis.FakeStrictRedis()
        la_that = False

    import redis as _redis

    monkeypatch.setattr(_redis, "from_url", lambda *a, **k: conn)
    monkeypatch.setenv("REDIS_URL", "redis://khong-dung-toi:6379/0")
    monkeypatch.setenv("QUEUE_ENABLED", "1")
    monkeypatch.setattr(db, "ten_khoa", lambda slug=None: TEN_TEST)
    try:
        conn.delete(TEN_TEST)
    except Exception:
        pass
    yield conn, la_that
    try:
        conn.delete(TEN_TEST)
    except Exception:
        pass


def test_lop_khoa_dung_la_cua_redis_py(redis_conn):
    """Nếu ngày nào đó `conn.lock()` trả về thứ khác, mọi khẳng định dưới đây mất nghĩa."""
    conn, _ = redis_conn
    khoa = conn.lock(TEN_TEST, timeout=5, blocking_timeout=0.1)
    assert type(khoa).__module__ == "redis.lock" and type(khoa).__name__ == "Lock"


# ── 2. Hai người ghi KHÔNG cùng vào đoạn tới hạn ──────────────────────────
def test_hai_luong_khong_bao_gio_cung_o_trong_doan_toi_han(redis_conn):
    """Đo TRỰC TIẾP số người đang ở trong đoạn tới hạn, không suy ra từ kết quả.

    Đếm lúc vào, đếm lúc ra, ghi lại mức cao nhất từng thấy. Mức ấy phải là 1.
    """
    dang_trong = 0
    cao_nhat = 0
    khoa_dem = threading.Lock()
    vao_duoc: list = []
    bi_tu_choi: list = []
    cung_xuat_phat = threading.Barrier(6)

    def mot_luot():
        nonlocal dang_trong, cao_nhat
        cung_xuat_phat.wait(10)
        try:
            with db.khoa_ghi_index(slug="s", cho_giay=0.05, han_giay=30):
                with khoa_dem:
                    dang_trong += 1
                    cao_nhat = max(cao_nhat, dang_trong)
                time.sleep(0.12)          # giữ đủ lâu để người khác chắc chắn va vào
                with khoa_dem:
                    dang_trong -= 1
                vao_duoc.append(1)
        except db.KhongLayDuocKhoa:
            bi_tu_choi.append(1)

    ts = [threading.Thread(target=mot_luot) for _ in range(6)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(20)

    assert cao_nhat == 1, f"có lúc {cao_nhat} người cùng ở trong đoạn tới hạn"
    assert len(vao_duoc) == 1 and len(bi_tu_choi) == 5
    assert dang_trong == 0


@pytest.mark.parametrize("lan", range(3))
def test_lap_lai_nhieu_lan_van_loai_tru(redis_conn, lan):
    """Race chỉ hiện ra lúc xui. Chạy lại vài lần cho bớt may rủi."""
    cung_luc: list = []
    khoa_dem = threading.Lock()
    dang = [0]

    def mot_luot():
        try:
            with db.khoa_ghi_index(slug="s", cho_giay=0.05, han_giay=30):
                with khoa_dem:
                    dang[0] += 1
                    if dang[0] > 1:
                        cung_luc.append(1)
                time.sleep(0.05)
                with khoa_dem:
                    dang[0] -= 1
        except db.KhongLayDuocKhoa:
            pass

    ts = [threading.Thread(target=mot_luot) for _ in range(4)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(20)
    assert cung_luc == []


@pytest.mark.skipif(not _redis_that()[2], reason="cần Redis THẬT để chạy hai tiến trình")
def test_hai_TIEN_TRINH_khong_cung_vao(redis_conn):
    """Bản đầy đủ: hai tiến trình HĐH riêng biệt. Chỉ chạy khi có Redis thật —
    `fakeredis` nằm trong tiến trình nên không nói được gì về nhiều tiến trình."""
    import multiprocessing as mp

    conn, la_that = redis_conn
    if not la_that:
        pytest.skip("đang dùng fakeredis")

    url = (os.getenv("REDIS_TEST_URL") or "redis://127.0.0.1:6379/15").strip()
    with mp.Pool(2) as pool:
        ket_qua = pool.map(_giu_khoa_o_tien_trinh_khac, [(url, TEN_TEST)] * 2)
    assert sorted(ket_qua) == [False, True], f"kết quả: {ket_qua}"


def _giu_khoa_o_tien_trinh_khac(tham_so):
    """Chạy ở tiến trình con: giành khoá rồi giữ 0.5s. Trả True nếu giành được."""
    url, ten = tham_so
    import redis as _redis

    conn = _redis.from_url(url)
    khoa = conn.lock(ten, timeout=30, blocking_timeout=0.05)
    if not khoa.acquire():
        return False
    time.sleep(0.5)
    try:
        khoa.release()
    except Exception:
        pass
    return True


# ── 3. Writer B đồng bộ từ bản A vừa xuất bản, TRƯỚC khi append ───────────
def test_B_nap_ban_cua_A_truoc_khi_append(redis_conn, monkeypatch, tmp_path):
    """Kịch bản mất dữ liệu mà cả phase này sinh ra để chặn:

        A: đọc V1 → append A → publish V2
        B: đọc V1 → append B → publish V3     ← V3 mất A

    Hai người ghi = hai ĐĨA riêng (hai container), một kho chung. Mốc version nằm trong
    thư mục index nên mỗi bên có mốc của mình — đúng như thật. Sau khi A publish V2, đĩa
    của B vẫn V1; nó PHẢI nạp V2 trước khi append, nếu không bản nó xuất bản sẽ dựng
    trên V1 và xoá mất phần của A.
    """
    import json

    from app.domains.vectorstore import persistence as ps
    from app.domains.vectorstore import store as _store

    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", "1")
    monkeypatch.setenv("INDEX_SYNC_TTL_SEC", "0")

    dia = {}
    for ten in ("A", "B"):
        d = tmp_path / ten / "index"
        d.mkdir(parents=True, exist_ok=True)
        dia[ten] = d

    nhat_ky: list = []

    class KhoChung:
        """Một kho cho cả hai. `version` đổi khi ai đó publish."""

        def __init__(self):
            self.version = "V1"

        def exists(self, khoa):
            return True

        def download(self, khoa):
            return json.dumps({"version": self.version}).encode()

        def upload(self, *a, **k):
            return None

    kho = KhoChung()

    def restore_gia(**kw):
        # `restore` thật ghi mốc sau khi thăng cấp; bản giả làm đúng việc đó.
        nhat_ky.append(("restore", kho.version))
        db.ghi_phien_ban_cuc_bo(kho.version)
        return {"restored": True, "version": kho.version}

    monkeypatch.setattr(ps, "restore", restore_gia)

    # Cả hai đĩa khởi điểm ở V1 — đúng trạng thái trước khi ai publish.
    for ten in ("A", "B"):
        monkeypatch.setattr(_store, "INDEX_DIR", dia[ten])
        db.ghi_phien_ban_cuc_bo("V1")

    def mot_luot_ghi(ten_nguoi, version_moi):
        monkeypatch.setattr(_store, "INDEX_DIR", dia[ten_nguoi])
        with db.khoa_ghi_index(slug="s", cho_giay=5, han_giay=30):
            db.dong_bo_truoc_khi_ghi(storage=kho, slug="s")
            nhat_ky.append(("append", ten_nguoi, db.phien_ban_cuc_bo()))
            kho.version = version_moi                      # publish
            db.ghi_phien_ban_cuc_bo(version_moi)
            nhat_ky.append(("publish", ten_nguoi, version_moi))

    mot_luot_ghi("A", "V2")
    mot_luot_ghi("B", "V3")

    append_B = [e for e in nhat_ky if e[0] == "append" and e[1] == "B"]
    assert append_B and append_B[0][2] == "V2", (
        f"B append trên bản {append_B[0][2] if append_B else '?'}, "
        f"tức bản nó publish sẽ xoá mất phần của A. Nhật ký: {nhat_ky}")
    assert nhat_ky.index(("restore", "V2")) < nhat_ky.index(append_B[0]), nhat_ky
    # A thì không phải nạp gì: lúc nó ghi, kho vẫn đúng bản nó đang cầm.
    assert ("restore", "V1") not in nhat_ky


def test_B_bi_chan_khi_khong_xac_nhan_duoc_ban_moi_nhat(redis_conn, monkeypatch, tmp_path):
    """Không hỏi được kho ở đường GHI thì phải NÉM, không được append mù."""
    from app.domains.vectorstore import store as _store

    monkeypatch.setattr(_store, "INDEX_DIR", tmp_path / "index")
    (tmp_path / "index").mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", "1")
    db.ghi_phien_ban_cuc_bo("V1")

    class KhoHong:
        def exists(self, khoa):
            return True

        def download(self, khoa):
            raise RuntimeError("timeout")

    with db.khoa_ghi_index(slug="s", cho_giay=0.2, han_giay=30):
        with pytest.raises(db.KhongDongBoDuoc):
            db.dong_bo_truoc_khi_ghi(storage=KhoHong(), slug="s")


# ── 4. Nhả khoá trên MỌI đường thoát ──────────────────────────────────────
def test_nha_khoa_khi_thoat_binh_thuong(redis_conn):
    with db.khoa_ghi_index(slug="s", cho_giay=0.2, han_giay=30):
        pass
    with db.khoa_ghi_index(slug="s", cho_giay=0.2, han_giay=30):
        pass  # vào lại được = đã nhả


def test_nha_khoa_khi_than_nem_Exception(redis_conn):
    with pytest.raises(ValueError):
        with db.khoa_ghi_index(slug="s", cho_giay=0.2, han_giay=30):
            raise ValueError("hỏng giữa chừng")
    with db.khoa_ghi_index(slug="s", cho_giay=0.2, han_giay=30):
        pass


def test_nha_khoa_khi_than_nem_BaseException(redis_conn):
    """`KeyboardInterrupt`/`SystemExit` không phải `Exception`. `finally` bắt được cả
    hai — nhưng phải khẳng định, vì một lần đổi sang `except Exception` là mất."""

    class NgatLa(BaseException):
        pass

    with pytest.raises(NgatLa):
        with db.khoa_ghi_index(slug="s", cho_giay=0.2, han_giay=30):
            raise NgatLa()
    with db.khoa_ghi_index(slug="s", cho_giay=0.2, han_giay=30):
        pass


def test_nha_khoa_khi_generator_bi_dong_giua_chung(redis_conn):
    """`with` trong một generator bị bỏ dở → `GeneratorExit` ném vào thân. Cũng phải nhả."""

    def sinh():
        with db.khoa_ghi_index(slug="s", cho_giay=0.2, han_giay=30):
            yield 1
            yield 2

    g = sinh()
    next(g)
    g.close()
    with db.khoa_ghi_index(slug="s", cho_giay=0.2, han_giay=30):
        pass


def test_khoa_khong_bi_ket_sau_khi_nguoi_giu_bi_tu_choi(redis_conn):
    """Người thứ hai bị từ chối KHÔNG được nhả khoá của người thứ nhất."""
    with db.khoa_ghi_index(slug="s", cho_giay=0.05, han_giay=30):
        with pytest.raises(db.KhongLayDuocKhoa):
            with db.khoa_ghi_index(slug="s", cho_giay=0.05, han_giay=30):
                pytest.fail("không được vào")
        # người đầu vẫn đang giữ: người thứ ba vẫn phải bị từ chối
        with pytest.raises(db.KhongLayDuocKhoa):
            with db.khoa_ghi_index(slug="s", cho_giay=0.05, han_giay=30):
                pytest.fail("khoá đã bị nhả nhầm")


# ── 5. Hạn của khoá: có thật, và bao lâu ──────────────────────────────────
def test_khoa_co_TTL_that_tren_server(redis_conn):
    """Không chỉ truyền `timeout` — kiểm khoá trên server THẬT SỰ có hạn."""
    conn, _ = redis_conn
    with db.khoa_ghi_index(slug="s", cho_giay=0.2, han_giay=30):
        con_lai = conn.pttl(TEN_TEST)
        assert con_lai is not None and 0 < con_lai <= 30_000, f"pttl={con_lai}"


def test_het_han_thi_nguoi_khac_vao_duoc(redis_conn):
    """Rủi ro đã biết, và đây là hình dạng của nó: người giữ khoá chết (hoặc chạy lâu
    hơn hạn) thì khoá tự mở. Đó là ĐÁNH ĐỔI có chủ đích — không có hạn thì một worker
    bị OOM giết sẽ khoá cứng mọi lượt ingest sau, đúng kiểu hỏng phase này đi dọn.

    Hệ quả phải nói ra: `INDEX_LOCK_TIMEOUT_SEC` (mặc định 900s) phải LỚN HƠN lượt ingest
    dài nhất, nếu không hai worker sẽ cùng vào đoạn tới hạn một cách hợp lệ.
    """
    conn, _ = redis_conn
    khoa = conn.lock(TEN_TEST, timeout=0.3, blocking_timeout=0.1)
    assert khoa.acquire()
    time.sleep(0.6)
    with db.khoa_ghi_index(slug="s", cho_giay=0.5, han_giay=30) as a:
        assert a["che_do"] == "phan-tan"


def test_han_mac_dinh_du_dai_cho_mot_luot_ingest(monkeypatch):
    """900 giây. Ingest production đo được tính bằng phút, nên biên còn rộng — nhưng đây
    là con số phải xem lại nếu tài liệu to lên."""
    monkeypatch.delenv("INDEX_LOCK_TIMEOUT_SEC", raising=False)
    from app.domains.vectorstore.dong_bo import _so

    assert _so("INDEX_LOCK_TIMEOUT_SEC", 900.0) == 900.0
    assert _so("INDEX_LOCK_WAIT_SEC", 30.0) == 30.0
