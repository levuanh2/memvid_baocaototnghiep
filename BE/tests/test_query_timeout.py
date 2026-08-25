"""`run_with_timeout` phải BỎ CHỜ đúng hạn.

Hồi quy cho một lỗi lặng: bản cũ dùng `with ThreadPoolExecutor(...) as ex:` rồi
gọi `.result(timeout=...)` bên trong. `__exit__` gọi `shutdown(wait=True)` nên nó
chặn tới khi worker chạy xong, TimeoutError mới tới được `except`. Mọi hạn giờ
trong query graph thành trang trí — đo được trên máy thật: `NLI_TIMEOUT_SEC=90`
mà node `VerifyContext` chạy 197 giây.
"""

from __future__ import annotations

import time

import pytest

from app.graphs.query_graph import run_with_timeout


def test_tra_ve_ket_qua_khi_kip_han():
    assert run_with_timeout(lambda: 42, 5) == 42


def test_bo_cho_dung_han_chu_khong_doi_viec_xong():
    """Điểm mấu chốt: hàm phải trả quyền điều khiển ở ~hạn giờ, KHÔNG phải ở lúc
    việc chậm kết thúc."""
    def cham():
        time.sleep(6)
        return "muon"

    t0 = time.perf_counter()
    with pytest.raises(TimeoutError):
        run_with_timeout(cham, 0.5)
    troi_qua = time.perf_counter() - t0

    # Bản cũ trả về ở ~6s. Nới rộng biên cho máy chậm nhưng vẫn tách bạch hai hành vi.
    assert troi_qua < 3.0, f"khong bo cho dung han: mat {troi_qua:.1f}s cho han 0.5s"


def test_loi_trong_fn_noi_nguyen_ra_ngoai():
    def no():
        raise ValueError("hong that")

    with pytest.raises(ValueError, match="hong that"):
        run_with_timeout(no, 5)


def test_propagate_ctx_van_chay_duoc():
    """Nhánh ctx_submit (dùng cho gọi LLM và memory tree) phải cho cùng kết quả."""
    assert run_with_timeout(lambda: "ok", 5, propagate_ctx=True) == "ok"


def test_contextvar_di_qua_duoc_pool():
    """Bộ đếm LLM per-job sống trong contextvar; mất nó là đếm sai."""
    import contextvars

    bien = contextvars.ContextVar("thu_nghiem", default="mac_dinh")
    bien.set("gia_tri_that")
    assert run_with_timeout(bien.get, 5, propagate_ctx=True) == "gia_tri_that"
