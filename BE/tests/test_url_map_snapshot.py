"""Ảnh chụp bề mặt API — lưới an toàn cho đợt refactor kiến trúc.

Vì sao cần, dù đã có ~1030 test: bộ test hiện có phủ **tính năng** (gọi route này thì
nhận kết quả kia), không phủ **hình dạng API**. Đổi `/auth/login` thành
`/api/auth/login`, hay đổi `POST /query` thành `GET /query`, hay làm mất một route khi
tách Blueprint — phần lớn test cũ vẫn xanh vì chúng gọi qua `client.post(...)` với đường
dẫn đã sửa theo, hoặc đơn giản là không chạm route đó. Frontend thì gãy ngay.

Ảnh chụp nằm ở `tests/snapshots/url_map.json`, commit vào kho. Mọi thay đổi bề mặt API
đều hiện ra dưới dạng diff của file đó trong code review — đó mới là điểm chính, không
phải bản thân assert.

**Khi test này đỏ:**
- Cố ý đổi API  -> chạy `python -m tests.test_url_map_snapshot --ghi-lai`, xem kỹ diff,
  commit ảnh chụp mới CÙNG commit đổi API.
- Không cố ý    -> đã làm mất/đổi route trong lúc refactor. Sửa mã, đừng sửa ảnh chụp.

Cố ý KHÔNG khoá `endpoint`: tách Blueprint sẽ đổi tên endpoint (`quiz.generate` thay cho
`api_quizzes_generate`) mà KHÔNG đổi URL. Frontend gọi URL, không gọi tên endpoint. Khoá
tên endpoint sẽ biến một refactor an toàn thành một test đỏ vô nghĩa. Endpoint vẫn được
lưu trong ảnh chụp để đọc diff, và có một test riêng khoá tính duy nhất của nó.
"""

import json
import pathlib

import pytest

ANH_CHUP = pathlib.Path(__file__).parent / "snapshots" / "url_map.json"


def _hien_tai() -> list[dict]:
    import app.main as be

    rows = []
    for r in be.app.url_map.iter_rules():
        rows.append({
            "rule": str(r.rule),
            "methods": sorted(m for m in (r.methods or set())
                              if m not in ("HEAD", "OPTIONS")),
            "endpoint": r.endpoint,
        })
    rows.sort(key=lambda x: (x["rule"], x["endpoint"]))
    return rows


def _luu(rows: list[dict]) -> None:
    ANH_CHUP.parent.mkdir(parents=True, exist_ok=True)
    with ANH_CHUP.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")


def _theo_url(rows: list[dict]) -> dict[str, list[str]]:
    """{đường dẫn: [method]} — phần HỢP ĐỒNG với frontend, bỏ tên endpoint."""
    return {r["rule"]: r["methods"] for r in rows}


@pytest.fixture(scope="module")
def cu() -> list[dict]:
    if not ANH_CHUP.exists():
        pytest.fail(f"thiếu ảnh chụp {ANH_CHUP} — sinh lại bằng --ghi-lai")
    return json.loads(ANH_CHUP.read_text(encoding="utf-8"))


def test_khong_mat_route_nao(client, cu):
    thieu = sorted(set(_theo_url(cu)) - set(_theo_url(_hien_tai())))
    assert not thieu, f"{len(thieu)} route BIẾN MẤT khỏi app: {thieu}"


def test_khong_them_route_ngoai_y_muon(client, cu):
    them = sorted(set(_theo_url(_hien_tai())) - set(_theo_url(cu)))
    assert not them, (
        f"{len(them)} route MỚI chưa có trong ảnh chụp: {them}. Cố ý thì cập nhật "
        "ảnh chụp cùng commit.")


def test_method_cua_tung_route_khong_doi(client, cu):
    a, b = _theo_url(cu), _theo_url(_hien_tai())
    doi = {k: (a[k], b[k]) for k in set(a) & set(b) if a[k] != b[k]}
    assert not doi, f"method đổi trên {len(doi)} route: {doi}"


def test_tong_so_route_khop(client, cu):
    """99 = 98 route ứng dụng + 1 `/static/<path:filename>` built-in của Flask.

    +1 ngày 2026-09-04: `GET /api/config/status`.
    +2 ngày 2026-09-07: `POST` và `DELETE /auth/nks/grant` — chứng từ ghi ngắn hạn.
    +2 ngày 2026-09-07: `GET` và `PATCH /me/nks/profile` — đọc/ghi hồ sơ NKS.
    +1 ngày 2026-09-08: `PUT /me/nks/avatar` — đổi ảnh đại diện.
    +1 ngày 2026-09-08: `POST /me/nks/password` — đổi mật khẩu NKS.
    +1 ngày 2026-09-08: `POST /auth/logout-all` — thu hồi mọi phiên StudyMap.
    +3 ngày 2026-09-09 (Thư viện học tập, Phase 1A): `GET /api/library` (payload gộp,
      thay hàng chục lượt hỏi trạng thái), `PATCH /api/documents/<id>` (siêu dữ liệu
      thư viện), `POST /api/documents/<id>/opened` (mốc MỞ — route riêng để GET không
      có tác dụng phụ và để client không vá được timestamp).
    +5 ngày 2026-09-09 (Bộ sưu tập, Phase 1B): `GET` + `POST /api/collections`,
      `PATCH` + `DELETE /api/collections/<id>`, `POST /api/documents/bulk`. Đếm theo
      RULE của Flask nên `GET` và `POST` cùng một đường dẫn là hai dòng.
    +1 ngày 2026-09-09 (Phase 1C.2a): `GET /api/documents/<id>/questions` — câu hỏi
      gợi ý, LƯỜI và suy ra. Không sinh tóm tắt, không gọi embedding, không có LLM.
    +3 ngày 2026-09-21 (Guided Mind Map V3): `GET /mindmaps/<mindmap_id>/nodes/<node_id>/context`
      (persisted node context cho Shared Context Inspector), `GET /mindmaps/capability`
      (rollout flag + durable-store/worker health, fail-closed về V2), `POST
      /mindmaps/suggest-topics` (gợi ý chủ đề thật từ indexed chunks trước khi tạo).
    Con số ở đây CỐ Ý viết cứng — sửa nó là một dòng diff mà người review phải nhìn
    thấy, đúng mục đích của cả file này."""
    assert len(_hien_tai()) == len(cu) == 102


def test_khong_co_cap_duong_dan_method_trung(client):
    """Trùng ĐƯỜNG DẪN là bình thường (`GET` và `DELETE` cùng `/api/documents/<id>`).
    Trùng CẶP (đường dẫn, method) mới là lỗi — Flask cho route sau ghi đè route trước
    và route đầu biến mất trong im lặng."""
    from collections import Counter

    dem = Counter((r["rule"], m) for r in _hien_tai() for m in r["methods"])
    trung = {k: v for k, v in dem.items() if v > 1}
    assert not trung, f"cặp (đường dẫn, method) khai nhiều lần: {trung}"


def test_ghi_nhan_route_chi_co_OPTIONS(client):
    """`/summaries` có một handler `methods=['OPTIONS']` khai TAY, trong khi flask_cors
    đã tự lo preflight. Đây là hành vi ĐANG CÓ — khoá lại để nếu ai đó gỡ nó thì thấy,
    chứ không phải để bắt sửa. Chỉ một route như vậy; thêm cái thứ hai là đáng hỏi."""
    chi_options = sorted(r["rule"] for r in _hien_tai() if not r["methods"])
    assert chi_options == ["/summaries"], (
        f"tập route chỉ-OPTIONS đã đổi: {chi_options}")


def test_ten_endpoint_van_duy_nhat(client):
    """Không khoá TÊN endpoint (Blueprint sẽ đổi), nhưng trùng tên là lỗi thật:
    Flask ghi đè route đăng ký sau, và route đầu biến mất trong im lặng."""
    from collections import Counter

    dem = Counter(r["endpoint"] for r in _hien_tai())
    trung = {k: v for k, v in dem.items() if v > 1}
    assert not trung, f"tên endpoint trùng: {trung}"


if __name__ == "__main__":  # pragma: no cover
    import sys

    if "--ghi-lai" in sys.argv:
        import os

        os.environ.setdefault("SKIP_MODEL_LOAD", "1")
        rows = _hien_tai()
        _luu(rows)
        print(f"đã ghi lại ảnh chụp: {len(rows)} rule -> {ANH_CHUP}")
    else:
        print("dùng --ghi-lai để cập nhật ảnh chụp có chủ đích")
