"""Cờ `USE_LC_*` chỉ được có MỘT nguồn sự thật, và mọi cờ anh em đọc cùng một kiểu.

Trước 2026-08-29 `USE_LC_VECTOR_STORE` có BA định nghĩa mặc định:

    shared/config.py:98        use_lc_vector_store: bool = True
    shared/env_loader.py:45    os.environ.setdefault("USE_LC_VECTOR_STORE", "1")
    vectorstore/store.py:65    os.getenv("USE_LC_VECTOR_STORE", "0")      <- NGƯỢC

`tests/conftest.py` đặt `MEMVID_DISABLE_LC_DEFAULTS=1` nên tầng giữa im lặng, và khi đó
`config` nói BẬT còn `store` nói TẮT cho cùng một câu hỏi. Cả 4 trường `use_lc_*` trong
config có **0 người đọc** — mã thật `os.getenv()` rải rác, đúng thứ docstring của chính
file đó tuyên bố đã dẹp. Đã gỡ 4 trường; `store._use_lc_vector_store()` là điểm đọc duy nhất.

Cùng lúc, hai cờ anh em ở `query_graph.py` đọc theo hai ngữ nghĩa ngược nhau:

    USE_LC_ENSEMBLE = ... not in ("0","false","no","off")   # "maybe" -> True
    USE_LC_QA_CHAIN = ... in  ("1","true","yes","on")       # "maybe" -> False
"""

from __future__ import annotations

import os

import pytest

import shared.config as shared_config
from app.domains.vectorstore.store import _use_lc_vector_store


def test_config_khong_con_truong_use_lc_chet():
    """Trường không ai đọc mà vẫn nằm trong config là cái bẫy, không phải tài liệu."""
    s = shared_config.get_settings()
    thua = [a for a in dir(s) if a.startswith("use_lc")]
    assert thua == [], (
        f"config lại mọc trường use_lc_*: {thua}. Mã thật đọc env trực tiếp "
        "(store._use_lc_vector_store, query_graph, ingest_graph) — hai nguồn thì một nguồn sẽ nói dối."
    )


@pytest.mark.parametrize("gia_tri,mong_doi", [
    ("1", True), ("true", True), ("YES", True), ("on", True),
    ("0", False), ("false", False), ("no", False), ("off", False),
    ("", False),          # rỗng = coi như tắt, không rơi về default
    ("maybe", False),     # giá trị rác -> an toàn là TẮT, không phải bật
])
def test_doc_co_theo_dung_mot_bang_truthy(monkeypatch, gia_tri, mong_doi):
    monkeypatch.setenv("USE_LC_VECTOR_STORE", gia_tri)
    assert _use_lc_vector_store() is mong_doi


def test_khong_dat_env_thi_ve_duong_legacy(monkeypatch):
    """Default "0" là CỐ Ý: đó là đường mà bộ test retrieval đang chạy, và cũng là đường
    có guard dim của `hybrid._load_faiss_index`. Đổi default = đổi đường test."""
    monkeypatch.delenv("USE_LC_VECTOR_STORE", raising=False)
    assert _use_lc_vector_store() is False


def test_hai_co_anh_em_doc_bang_CUNG_MOT_ham():
    """`USE_LC_ENSEMBLE` và `USE_LC_QA_CHAIN` phải đi qua cùng một hàm đọc.

    Đây là khẳng định CẤU TRÚC, cố ý: hai cờ được đọc trong thân
    `build_query_graph()`, dựng cả graph chỉ để so hai boolean thì phải nạp model +
    FAISS. Thứ cần khoá là "hai cờ dùng chung một bộ luật truthy", và điều đó đọc
    được từ mã nguồn mà không phải chạy graph.

    KHÔNG viết `assert truthy(x) == truthy(x)` — đó là hằng đúng, không đo gì cả.
    """
    import inspect

    import app.graphs.query_graph as qg

    src = inspect.getsource(qg)
    for co in ("USE_LC_ENSEMBLE", "USE_LC_QA_CHAIN"):
        assert f'_truthy(os.getenv("{co}"' in src, (
            f"{co} không đọc qua `_truthy` — hai cờ anh em lại lệch ngữ nghĩa. "
            "Trước 2026-08-29 ENSEMBLE dùng `not in (falsy)` còn QA_CHAIN dùng "
            "`in (truthy)`, nên giá trị rác cho hai câu trả lời ngược nhau."
        )
    assert 'not in ("0", "false", "no", "off")' not in src, "bảng truthy cũ quay lại"
