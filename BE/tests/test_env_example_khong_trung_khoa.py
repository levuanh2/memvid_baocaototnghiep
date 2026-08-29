"""`BE/.env.example` không được khai một khoá hai lần.

`AI_TIMEOUT_SEC` từng có hai dòng: 600 ở mục Ollama, 180 ở mục query graph. dotenv lấy
dòng SAU, nên 600 chưa bao giờ có hiệu lực — file cấu hình nói một đằng, tiến trình chạy
một nẻo, và người sửa dòng 600 không hiểu vì sao không có gì đổi. `.env` thật của mỗi máy
copy từ file này nên nhân bản luôn lỗi đó.
"""

from __future__ import annotations

import collections
from pathlib import Path

import pytest

_MAU = [Path(__file__).resolve().parents[1] / ".env.example",
        Path(__file__).resolve().parents[2] / ".env.example"]


@pytest.mark.parametrize("duong_dan", _MAU, ids=lambda p: p.parent.name)
def test_khong_khoa_nao_khai_hai_lan(duong_dan: Path):
    if not duong_dan.exists():
        pytest.skip(f"{duong_dan} không có trong kho")
    khoa = [d.split("=", 1)[0].strip()
            for d in duong_dan.read_text(encoding="utf-8").splitlines()
            if "=" in d and not d.lstrip().startswith("#")]
    trung = {k: n for k, n in collections.Counter(khoa).items() if n > 1}
    assert not trung, (
        f"{duong_dan.name} khai trùng khoá {trung} — dotenv lấy dòng CUỐI, "
        "các dòng trước im lặng không có tác dụng"
    )
