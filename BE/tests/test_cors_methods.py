"""Preflight phải cho phép đúng những method mà route thật sự dùng.

Đo được 2026-09-01 trong log BE thật:

    OPTIONS /api/attempts/<id>/answers  200   x4
    PATCH   /api/attempts/<id>/answers        x0

`CORS(..., methods=[...])` thiếu `PATCH` và `PUT`. Preflight vẫn trả **200** nên nhìn log
BE thì tưởng ổn — nhưng trình duyệt đọc `Access-Control-Allow-Methods`, không thấy method
mình cần, và **chặn request thật trước khi gửi**. `fetch` ném `TypeError`, giao diện dịch
thành "Không kết nối được máy chủ" trong khi máy chủ vẫn sống nguyên.

Hai tính năng chết hoàn toàn qua trình duyệt:
  - `PATCH /api/attempts/<id>/answers` — lưu nháp đáp án (mọi lần chọn đáp án đều hỏng)
  - `PUT /mindmaps/<id>` — lưu mindmap đã sửa
"""

import pytest

ORIGIN = "http://localhost:5173"


def _cho_phep(client, path: str, method: str) -> str:
    r = client.options(path, headers={
        "Origin": ORIGIN,
        "Access-Control-Request-Method": method,
    })
    return r.headers.get("Access-Control-Allow-Methods", "") or ""


@pytest.mark.parametrize("path,method", [
    ("/api/attempts/x/answers", "PATCH"),
    ("/mindmaps/x", "PUT"),
])
def test_preflight_cho_phep_method_route_dang_dung(client, path, method):
    ds = _cho_phep(client, path, method)
    assert method in ds, f"{method} {path} bị chặn ở preflight. Allow-Methods = {ds!r}"


def test_moi_method_trong_url_map_deu_qua_duoc_preflight(client):
    """Khoá hợp đồng bằng HÀNH VI, không bằng đọc mã nguồn.

    Duyệt `url_map` — nguồn sự thật lúc chạy — rồi tự hỏi preflight cho từng method.
    Thêm route `PATCH`/`PUT` mới mà quên cập nhật CORS sẽ đỏ ngay ở đây.
    """
    import app.main as be

    dung = set()
    for rule in be.app.url_map.iter_rules():
        dung |= {m for m in (rule.methods or set())
                 if m not in ("HEAD", "OPTIONS")}

    ds = _cho_phep(client, "/api/attempts/x/answers", "PATCH")
    thieu = sorted(m for m in dung if m not in ds)
    assert not thieu, (
        f"route dùng {thieu} nhưng preflight không cho phép. Allow-Methods = {ds!r}")


def test_preflight_khong_mo_rong_qua_muc(client):
    """Chỉ thêm đúng method đang cần — đừng nới thành dấu sao."""
    ds = _cho_phep(client, "/api/attempts/x/answers", "PATCH")
    assert "*" not in ds, f"CORS không được mở toàn bộ method: {ds!r}"
