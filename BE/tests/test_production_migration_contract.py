"""Hợp đồng môi trường của lệnh migration mà `render.yaml` sẽ gọi — chứng minh KHÔNG
chạm Supabase.

Mẹo tách "đích KHAI BÁO" khỏi "đích KẾT NỐI THẬT": libpq có hai tham số riêng,
`host=` (dùng để đặt tên/định danh) và `hostaddr=` (địa chỉ TCP thật). Nhờ đó URL

    postgresql+psycopg://…@fake-production-host.example:55432/postgres?hostaddr=127.0.0.1

có danh tính ('fake-production-host.example', 'postgres') — trông hệt production đối
với chốt — nhưng gói tin đi tới container test trên máy. Toàn bộ đường production
được chạy thật mà không một byte nào rời máy này.

KHÔNG có ca nào ở đây vô hiệu hoá chốt để "cho qua". Ca dương tính đi qua ĐÚNG chốt
mà production sẽ đi qua; nó pass vì hợp đồng được thoả, không phải vì được miễn.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

import pytest

BE = Path(__file__).resolve().parents[1]


def _test_db_port() -> int:
    """Cổng Postgres test THẬT — suy từ `TEST_DATABASE_URL`, không đoán/hardcode.

    CI (`ci.yml`) chạy Postgres làm service container ánh xạ cổng CHUẨN 5432 và
    đặt `TEST_DATABASE_URL` trỏ đúng vào đó. `scripts/setup_test_db.py` (dev cục
    bộ) CỐ Ý dùng 55432 để không đụng một Postgres khác đã chạy sẵn trên máy. Hai
    quy ước khác nhau, cùng đúng ở đúng môi trường của nó — file test này từng
    hardcode 55432, nên nó pass ở máy dev (đã chạy setup_test_db.py) nhưng ở CI
    lại đi dò đúng cổng không ai lắng nghe (5432 mới là cổng CI thật có), một kết
    nối bị từ chối/treo cho tới khi hết `timeout`. Đọc thẳng cổng từ biến môi
    trường mà `_co_db_test()` NGAY BÊN DƯỚI cũng đang dùng để quyết định có chạy
    hay skip — hai chỗ đó phải đồng bộ, không phải hai nguồn sự thật khác nhau.
    """
    raw = (os.getenv("TEST_DATABASE_URL") or "").strip()
    if not raw:
        return 55432   # không chạy tới đây thật: _co_db_test() đã skip cả module
    return urlsplit(raw).port or 55432


_TEST_PORT = _test_db_port()

FAKE_PROD_HOST = "fake-production-host.example"
FAKE_PROD_DB = "postgres"
#: Khai báo là production, đường đi thật là container test.
FAKE_PROD_URL = (f"postgresql://postgres:postgres@{FAKE_PROD_HOST}:{_TEST_PORT}/"
                 f"{FAKE_PROD_DB}?hostaddr=127.0.0.1")
TEST_URL = f"postgresql://postgres:postgres@localhost:{_TEST_PORT}/studymap_test"


def _co_db_test() -> bool:
    return bool((os.getenv("TEST_DATABASE_URL") or "").strip())


pytestmark = pytest.mark.skipif(
    not _co_db_test(), reason="cần TEST_DATABASE_URL (container test cục bộ)")


def chay(env_them: dict, *args) -> subprocess.CompletedProcess:
    """Gọi wrapper như một tiến trình thật — kiểm cả argparse, mã thoát lẫn chốt.

    Môi trường được DỰNG LẠI từ đầu, không kế thừa: nếu để lọt `DATABASE_URL` thật
    từ shell vào đây thì test có thể vô tình trỏ vào Supabase. Chỉ những khoá cần
    cho Python chạy mới được giữ.
    """
    env = {k: v for k, v in os.environ.items()
           if k in ("PATH", "SYSTEMROOT", "COMSPEC", "TEMP", "TMP", "PATHEXT",
                    "USERPROFILE", "HOMEDRIVE", "HOMEPATH")}
    env["PYTHONIOENCODING"] = "utf-8"
    env["SKIP_MODEL_LOAD"] = "1"
    env.update(env_them)
    # `.env` trên đĩa VẪN được `load_project_env()` đọc trong tiến trình con, nhưng
    # `override=False` nghĩa là os.environ THẮNG (docstring env_loader:12). Nên mọi
    # khoá `env_them` đặt ở đây đè được giá trị trong `.env`, và ca nào không đặt
    # `DATABASE_URL` thì nhận giá trị thật — vô hại, vì không ca nào vừa bật
    # ALEMBIC_ALLOW_PRODUCTION vừa để `DATABASE_URL` rơi về giá trị thật.
    # `encoding` tường minh: mặc định của Windows là cp1252, gặp chữ tiếng Việt trong
    # thông điệp lỗi là ném UnicodeDecodeError và test hỏng vì lý do không liên quan
    # gì tới thứ đang đo.
    return subprocess.run(
        [sys.executable, "-m", "scripts.run_migrations", *args],
        cwd=str(BE), env=env, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=300)


def _bi_tu_choi(r: subprocess.CompletedProcess) -> bool:
    return r.returncode != 0 and "DỪNG" in (r.stderr + r.stdout)


# ── Ca DƯƠNG TÍNH: hợp đồng production được thoả ─────────────────────────────
def test_duong_tinh_production_dung_hop_dong_thi_chay():
    """Đúng thứ `render.yaml` sẽ chạy — chỉ khác là gói tin đi tới container test."""
    r = chay({
        "ALEMBIC_ALLOW_PRODUCTION": "1",
        "ALEMBIC_PRODUCTION_HOST": FAKE_PROD_HOST,
        "ALEMBIC_PRODUCTION_DB": FAKE_PROD_DB,
        "DATABASE_URL": FAKE_PROD_URL,
    }, "--moi-truong", "production")
    assert r.returncode == 0, r.stderr
    assert "upgrade head: xong" in r.stdout
    assert FAKE_PROD_HOST in r.stdout            # đích in ra đúng cái đã khai
    # Không rò credential trong bất kỳ dòng nào.
    assert "postgres:postgres" not in (r.stdout + r.stderr)


def test_duong_tinh_kiem_tra_khong_chay_gi():
    r = chay({
        "ALEMBIC_ALLOW_PRODUCTION": "1",
        "ALEMBIC_PRODUCTION_HOST": FAKE_PROD_HOST,
        "ALEMBIC_PRODUCTION_DB": FAKE_PROD_DB,
        "DATABASE_URL": FAKE_PROD_URL,
    }, "--moi-truong", "production", "--kiem-tra")
    assert r.returncode == 0, r.stderr
    assert "chỉ kiểm tra" in r.stdout
    assert "xong" not in r.stdout


# ── 8 ĐỐI CHỨNG ÂM ───────────────────────────────────────────────────────────
def test_1_khong_co_ALEMBIC_ALLOW_PRODUCTION_thi_tu_choi():
    r = chay({
        "ALEMBIC_PRODUCTION_HOST": FAKE_PROD_HOST,
        "ALEMBIC_PRODUCTION_DB": FAKE_PROD_DB,
        "DATABASE_URL": FAKE_PROD_URL,
    }, "--moi-truong", "production")
    assert _bi_tu_choi(r)
    assert "ALEMBIC_ALLOW_PRODUCTION" in r.stderr


def test_2_thieu_production_host_thi_tu_choi():
    r = chay({
        "ALEMBIC_ALLOW_PRODUCTION": "1",
        "ALEMBIC_PRODUCTION_DB": FAKE_PROD_DB,
        "DATABASE_URL": FAKE_PROD_URL,
    }, "--moi-truong", "production")
    assert _bi_tu_choi(r)
    assert "ALEMBIC_PRODUCTION_HOST" in r.stderr


def test_3_thieu_production_db_thi_tu_choi():
    r = chay({
        "ALEMBIC_ALLOW_PRODUCTION": "1",
        "ALEMBIC_PRODUCTION_HOST": FAKE_PROD_HOST,
        "DATABASE_URL": FAKE_PROD_URL,
    }, "--moi-truong", "production")
    assert _bi_tu_choi(r)


def test_4_host_khai_bao_lech_thi_tu_choi():
    r = chay({
        "ALEMBIC_ALLOW_PRODUCTION": "1",
        "ALEMBIC_PRODUCTION_HOST": "mot-host-hoan-toan-khac.example",
        "ALEMBIC_PRODUCTION_DB": FAKE_PROD_DB,
        "DATABASE_URL": FAKE_PROD_URL,
    }, "--moi-truong", "production")
    assert _bi_tu_choi(r)
    assert "không khớp khai báo" in r.stderr


def test_5_db_khai_bao_lech_thi_tu_choi():
    r = chay({
        "ALEMBIC_ALLOW_PRODUCTION": "1",
        "ALEMBIC_PRODUCTION_HOST": FAKE_PROD_HOST,
        "ALEMBIC_PRODUCTION_DB": "mot_db_khac",
        "DATABASE_URL": FAKE_PROD_URL,
    }, "--moi-truong", "production")
    assert _bi_tu_choi(r)


def test_6_current_database_song_lech_thi_tu_choi():
    """Khai báo db `postgres` nhưng URL thật nối vào `studymap_test`.

    Chuỗi khai báo qua được vòng kiểm tĩnh; chỉ `SELECT current_database()` trên kết
    nối SỐNG mới lộ ra. Đây là ca chứng minh vòng kiểm thứ hai có giá trị thật.
    """
    lech = (f"postgresql://postgres:postgres@{FAKE_PROD_HOST}:{_TEST_PORT}/"
            f"postgres?hostaddr=127.0.0.1&dbname=studymap_test")
    r = chay({
        "ALEMBIC_ALLOW_PRODUCTION": "1",
        "ALEMBIC_PRODUCTION_HOST": FAKE_PROD_HOST,
        "ALEMBIC_PRODUCTION_DB": FAKE_PROD_DB,
        "DATABASE_URL": lech,
    }, "--moi-truong", "production")
    assert _bi_tu_choi(r) or "current_database" in (r.stderr + r.stdout)


def test_7_credential_hong_thi_tu_choi_an_toan():
    """URL rác: phải dừng sạch, không traceback lộ chuỗi kết nối."""
    r = chay({
        "ALEMBIC_ALLOW_PRODUCTION": "1",
        "ALEMBIC_PRODUCTION_HOST": FAKE_PROD_HOST,
        "ALEMBIC_PRODUCTION_DB": FAKE_PROD_DB,
        "DATABASE_URL": "khong-phai-mot-url",
    }, "--moi-truong", "production")
    assert r.returncode != 0
    assert "MAT_KHAU" not in (r.stdout + r.stderr)


def test_8_db_test_khi_khai_la_production_thi_tu_choi():
    """Yêu cầu 11: deploy production mà trỏ vào DB test cũng là hỏng — im lặng hơn."""
    r = chay({
        "ALEMBIC_ALLOW_PRODUCTION": "1",
        "ALEMBIC_PRODUCTION_HOST": "localhost",
        "ALEMBIC_PRODUCTION_DB": "studymap_test",
        "DATABASE_URL": TEST_URL,
    }, "--moi-truong", "production")
    assert _bi_tu_choi(r)
    assert "trông như database test" in r.stderr


# ── Chiều ngược lại: cờ production sót lại khi chạy test ─────────────────────
def test_co_production_sot_lai_khi_chay_test_thi_tu_choi():
    r = chay({
        "ALEMBIC_ALLOW_PRODUCTION": "1",
        "TEST_DATABASE_URL": TEST_URL,
        "DATABASE_URL": FAKE_PROD_URL,
    }, "--moi-truong", "test")
    assert _bi_tu_choi(r)
    assert "ALEMBIC_ALLOW_PRODUCTION" in r.stderr


def test_che_do_test_mac_dinh_van_chay_binh_thuong():
    r = chay({"TEST_DATABASE_URL": TEST_URL}, "--kiem-tra")
    assert r.returncode == 0, r.stderr
    assert "studymap_test" in r.stdout
    assert "postgres:postgres" not in r.stdout
