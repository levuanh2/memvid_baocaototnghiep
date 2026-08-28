"""Default model chỉ được nằm ở MỘT chỗ: `shared.config.DEFAULT_LOCAL_MODEL`.

Vì sao cần test này: model mặc định đã bị viết cứng ở 12 chỗ (`qwen2.5:14b` ×8,
`qwen3.5:9b` ×3, `qwen3.6:35b-a3b` ×2 — hai chỗ sau chưa từng được pull về máy). Chúng
không nổ hằng ngày vì các file `.env` đều đặt biến, nên một lần clone thiếu env là chạy
thẳng vào model 9.95 GB trên card 6.14 GiB. Đó đúng là thứ đã tốn của dự án hai buổi
(.playbook/known-issues 2026-08-26 và 2026-08-27).

Chỗ đã sửa một lần rồi tái phát: `main.py:1255` có sẵn comment "một nguồn sự thật
`_model_map` — hết stale default kiểu qwen3.5:9b hardcode". Comment không chặn được gì.
Test thì có.
"""

import glob
import os
import re

import pytest

from shared.config import DEFAULT_LOCAL_MODEL

# Model từng là default sai. Tên xuất hiện trong MÃ (không phải .env, không phải comment)
# nghĩa là có người viết cứng lại.
MODEL_NANG = ("qwen2.5:14b", "qwen3.5:9b", "qwen3.6:35b-a3b")

# vision/transcribe.py cần model VL riêng, không dùng chung DEFAULT_LOCAL_MODEL.
# Máy này chưa pull model VL nào — theo dõi riêng, không gộp vào luật dưới đây.
MIEN_TRU = {os.path.join("app", "domains", "vision", "transcribe.py")}


def _file_ma_nguon():
    for pattern in ("app/**/*.py", "services/**/*.py", "shared/**/*.py"):
        for f in glob.glob(pattern, recursive=True):
            if os.path.normpath(f) not in MIEN_TRU:
                yield f


def _dong_ma(text: str):
    """Bỏ dòng comment thuần — nhắc tên model trong comment là tài liệu, không phải bug."""
    for i, line in enumerate(text.split("\n"), 1):
        if not line.lstrip().startswith("#"):
            yield i, line


@pytest.mark.parametrize("ten_model", MODEL_NANG)
def test_khong_con_model_nang_viet_cung_trong_ma(ten_model):
    pham = []
    for f in _file_ma_nguon():
        text = open(f, encoding="utf-8", errors="ignore").read()
        for i, line in _dong_ma(text):
            if ten_model in line:
                pham.append(f"{f}:{i}  {line.strip()[:80]}")
    assert not pham, (
        f"'{ten_model}' bị viết cứng trở lại. Dùng shared.config.DEFAULT_LOCAL_MODEL:\n  "
        + "\n  ".join(pham)
    )


def test_moi_feature_deu_ve_dung_mot_default_khi_khong_co_env(monkeypatch):
    """Không env nào đặt → cả 4 feature phải ra CÙNG một model an toàn."""
    for k in ("SLM_MODEL", "SLM_MODEL_CHAT", "SLM_MODEL_SUMMARY", "MINDMAP_MODEL",
              "QUIZ_MODEL"):
        monkeypatch.delenv(k, raising=False)
    from app.clients.llm_factory import _model_map

    for feature in ("chat", "summary", "mindmap", "quiz"):
        assert _model_map(feature) == DEFAULT_LOCAL_MODEL, feature


def test_default_van_la_model_da_co_tren_may(monkeypatch):
    """Default phải là tag Ollama THẬT. `qwen3.6:35b-a3b` từng là default mà chưa
    bao giờ được pull — gọi vào là 404 model not found, không phải chậm."""
    assert re.fullmatch(r"[a-z0-9._-]+:[a-z0-9._-]+", DEFAULT_LOCAL_MODEL), DEFAULT_LOCAL_MODEL
    assert DEFAULT_LOCAL_MODEL not in MODEL_NANG
