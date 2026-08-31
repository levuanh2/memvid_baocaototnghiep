"""Audit vòng 8 V8-5 — `sessions_store` không biết ai là chủ của một phiên.

Bảng `sessions` chỉ có `(session_id, updated_at, history_json)`. Ai gửi `session_id`
của người khác thì đọc được lịch sử chat của người đó, và ghi được vào đó.

Rào cản duy nhất là `session_id` = `uuid4()` sinh ở server — không dò được, phải lấy
qua chung trình duyệt / link chia sẻ / log proxy. Nhưng qua rào đó thì không còn lớp
nào chặn: chữ ký hàm không có chỗ để truyền chủ sở hữu.

`CONVERSATION_CONTEXT_ENABLED` đang TẮT (mặc định) nên chốt kiểm chủ ở
`main.py` nằm trong khối `if _conversation_enabled()` và không bao giờ chạy.
"""

import inspect
import sqlite3

import pytest


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app.domains.jobs import sessions_store
    return sessions_store


LUOT_CUA_A = [
    {"role": "user", "content": "Lương tháng 12 của tôi là bao nhiêu?"},
    {"role": "assistant", "content": "Theo tài liệu của bạn: 42.000.000 VND."},
]


def test_chu_ky_ham_phai_co_cho_truyen_chu_so_huu(store):
    """Khoá đúng thứ đang thiếu, không dùng inspect.getsource (bẫy dịch dòng)."""
    for ten in ("get_history", "append_messages"):
        tham_so = inspect.signature(getattr(store, ten)).parameters
        assert "user_id" in tham_so, f"{ten} không có chỗ truyền chủ sở hữu"


def test_nguoi_khac_khong_doc_duoc_lich_su(store):
    store.append_messages("S", LUOT_CUA_A, user_id="A")
    assert store.get_history("S", user_id="B") == []


def test_chinh_chu_van_doc_duoc(store):
    store.append_messages("S", LUOT_CUA_A, user_id="A")
    hist = store.get_history("S", user_id="A")
    assert [m["content"] for m in hist] == [m["content"] for m in LUOT_CUA_A]


def test_nguoi_khac_khong_ghi_de_duoc_vao_phien_cua_ai_do(store):
    """Chiều GHI: B hỏi trên session của A thì câu của B không được nằm trong đó."""
    store.append_messages("S", LUOT_CUA_A, user_id="A")
    store.append_messages("S", [{"role": "user", "content": "câu của B"}], user_id="B")

    hist = store.get_history("S", user_id="A")
    assert all("của B" not in m["content"] for m in hist), "lịch sử của A bị nhiễm"
    assert len(hist) == 2


def test_che_do_mo_khong_co_user_id_thi_hoat_dong_nhu_cu(store):
    """Tắt auth thì không có người dùng để tách — không được tự dựng rào."""
    store.append_messages("S", LUOT_CUA_A)
    assert len(store.get_history("S")) == 2


def test_hang_cu_khong_co_chu_thi_nguoi_da_dang_nhap_khong_doc_duoc(store):
    """Dữ liệu có sẵn trước khi thêm cột: chủ là NULL, không được coi là 'của mọi người'.

    TTL 24h (SESSION_TTL_HOURS) nên hàng cũ tự hết trong một ngày.
    """
    store.append_messages("S", LUOT_CUA_A)          # ghi kiểu cũ, không chủ
    assert store.get_history("S", user_id="A") == []
    assert len(store.get_history("S")) == 2          # chế độ mở vẫn đọc được


def test_mo_duoc_db_cu_chua_co_cot_user_id(store, tmp_path):
    """Migration phải chạy trên DB đã tồn tại, không nổ và không mất dữ liệu."""
    duong = tmp_path / "sessions.sqlite"
    con = sqlite3.connect(str(duong))
    con.execute("CREATE TABLE sessions (session_id TEXT PRIMARY KEY, "
                "updated_at REAL NOT NULL, history_json TEXT NOT NULL)")
    con.execute("INSERT INTO sessions VALUES ('S', 9999999999.0, "
                """'[{"role":"user","content":"cau cu"}]')""")
    con.commit()
    con.close()

    assert store.get_history("S")[0]["content"] == "cau cu"
    store.append_messages("S", [{"role": "assistant", "content": "cau moi"}])
    assert len(store.get_history("S")) == 2


def test_session_id_rong_van_tra_ve_rong(store):
    assert store.get_history("", user_id="A") == []
    store.append_messages("", LUOT_CUA_A, user_id="A")  # không được nổ


def test_graph_khong_con_duong_doc_lai_lich_su_khong_pham_vi():
    """`RetrieveFAISS` từng ghi đè `conversation_history` bằng một lần đọc thẳng
    `sessions_store`. State của graph KHÔNG mang `user_id` nên node đó không có cách
    nào tự giới hạn phạm vi — nó ghi đè đúng quyết định có phạm vi của tầng route.

    Khoá bằng chữ ký: graph không được nhận vào một hàm đọc lịch sử nữa.
    """
    from app.graphs.query_graph import build_query_graph
    assert "get_session_history" not in inspect.signature(build_query_graph).parameters
