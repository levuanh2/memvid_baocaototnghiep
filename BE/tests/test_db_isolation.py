"""Pytest KHÔNG được chạm database production. Đây là hàng rào, không phải tính năng.

Trước 2026-09-04, mọi lượt `pytest` cục bộ chạy thẳng vào database PRODUCTION:

  - `tests/conftest.py` không hề ghi đè `DATABASE_URL`
  - `app/db.database_url()` đọc thẳng `os.getenv("DATABASE_URL")`
  - `BE/.env` có `DATABASE_URL` trỏ vào Supabase production
  - fixture tạo user/tài liệu THẬT ở đó
  - bước dọn dẹp của conftest chạy `sa_delete(Document)` — xoá CỨNG

Bằng chứng tìm ra hôm 2026-09-04: 8 user mới nhất trong database production đều là
fixture pytest (`search_o_*`, `owner_*`, `quiz_o_*`…), tạo lúc 03:18–03:38 UTC, đúng
khoảng một lượt chạy suite đầy đủ.

Thứ che mắt lâu nhất: `BE/.env` dùng cổng 6543 còn production dùng 5432, nên hai URL
TRÔNG khác nhau. Chúng là cùng một database — Supabase mở nó ở cả hai cổng. Vì thế
hàm nhận diện đích ở đây CỐ Ý bỏ qua cổng.
"""

from __future__ import annotations

import sys

import pytest

from app import db as appdb

PROD = "postgresql://postgres.abcdefgh:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres"
PROD_KHAC_CONG = PROD.replace(":5432/", ":6543/")
TEST_RIENG = "postgresql://postgres:postgres@localhost:55432/studymap_test"


# ── Nhận diện đang chạy pytest ─────────────────────────────────────────────
def test_dang_chay_pytest_nhan_dien_dung():
    assert appdb.dang_chay_pytest() is True
    assert "pytest" in sys.modules


def test_nhan_dien_khong_dua_vao_bien_env_do_conftest_dat():
    """Conftest chạy SAU khi pytest đã import vài thứ. Một cờ do conftest đặt để lại
    cửa sổ mà một import sớm mở kết nối trước khi cờ kịp có."""
    import inspect

    nguon = inspect.getsource(appdb.dang_chay_pytest)
    assert "sys.modules" in nguon


# ── Không có TEST_DATABASE_URL thì HỎNG, không rơi về production ───────────
def test_thieu_TEST_DATABASE_URL_thi_nem(monkeypatch):
    monkeypatch.delenv("TEST_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", PROD)
    with pytest.raises(appdb.DatabaseNotConfigured, match="TEST_DATABASE_URL"):
        appdb.database_url()


def test_thong_bao_loi_noi_ro_KHONG_duoc_dung_DATABASE_URL(monkeypatch):
    """Người đọc phải hiểu ngay vì sao, chứ không đi đặt DATABASE_URL cho xong."""
    monkeypatch.delenv("TEST_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", PROD)
    with pytest.raises(appdb.DatabaseNotConfigured) as e:
        appdb.database_url()
    t = str(e.value)
    assert "production" in t and "setup_test_db" in t


def test_TEST_DATABASE_URL_rong_cung_bi_coi_la_thieu(monkeypatch):
    monkeypatch.setenv("TEST_DATABASE_URL", "   ")
    monkeypatch.setenv("DATABASE_URL", PROD)
    with pytest.raises(appdb.DatabaseNotConfigured):
        appdb.database_url()


def test_co_TEST_DATABASE_URL_thi_dung_no_KHONG_dung_DATABASE_URL(monkeypatch):
    monkeypatch.setenv("TEST_DATABASE_URL", TEST_RIENG)
    monkeypatch.setenv("DATABASE_URL", PROD)
    ra = appdb.database_url()
    assert "localhost:55432" in ra and "studymap_test" in ra
    assert "supabase.com" not in ra


def test_khong_co_DATABASE_URL_van_chay_duoc(monkeypatch):
    """CI cố ý không đặt `DATABASE_URL` ở bước pytest — không được đòi nó."""
    monkeypatch.setenv("TEST_DATABASE_URL", TEST_RIENG)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert "studymap_test" in appdb.database_url()


# ── Cùng đích thì từ chối, kể cả khi khác cổng ─────────────────────────────
def test_cung_database_khac_cong_VAN_bi_chan(monkeypatch):
    """Đây là ca đã che mắt suốt nhiều tuần: 5432 và 6543 là hai cổng vào CÙNG một
    database Supabase, nên so chuỗi URL thì thấy khác, còn thực tế thì không."""
    monkeypatch.setenv("DATABASE_URL", PROD)
    monkeypatch.setenv("TEST_DATABASE_URL", PROD_KHAC_CONG)
    with pytest.raises(appdb.DatabaseNotConfigured, match="CÙNG database"):
        appdb.database_url()


def test_cung_database_y_het_thi_bi_chan(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", PROD)
    monkeypatch.setenv("TEST_DATABASE_URL", PROD)
    with pytest.raises(appdb.DatabaseNotConfigured, match="CÙNG database"):
        appdb.database_url()


def test_khac_host_thi_cho_qua(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", PROD)
    monkeypatch.setenv("TEST_DATABASE_URL", TEST_RIENG)
    assert "studymap_test" in appdb.database_url()


def test_cung_host_khac_ten_database_thi_cho_qua(monkeypatch):
    """Hai database khác nhau trên cùng một máy chủ là chuyện bình thường."""
    monkeypatch.setenv("DATABASE_URL", PROD)
    monkeypatch.setenv("TEST_DATABASE_URL", PROD.replace("/postgres", "/studymap_test"))
    assert "studymap_test" in appdb.database_url()


@pytest.mark.parametrize("a,b,giong", [
    (PROD, PROD_KHAC_CONG, True),                              # chỉ khác cổng
    # User khác nhau vẫn là CÙNG database. Đưa user vào danh tính thì hai tài
    # khoản trỏ cùng một chỗ bị coi là hai đích, và hàng rào im lặng không nổ.
    (PROD, PROD.replace("postgres.abcdefgh:pw", "nguoi_khac:pw2"), True),
    (PROD, PROD.replace("aws-0-ap-northeast-2", "aws-1-eu-west-1"), False),
    (PROD, PROD.replace("/postgres", "/khac"), False),
    (PROD, TEST_RIENG, False),
])
def test_danh_tinh_dich_chi_gom_host_va_ten_database(a, b, giong):
    assert (appdb._danh_tinh_dich(a) == appdb._danh_tinh_dich(b)) is giong


# ── Đường không-pytest giữ nguyên hành vi cũ ───────────────────────────────
def test_ngoai_pytest_van_dung_DATABASE_URL(monkeypatch):
    """App thật, alembic, và các script không chạy dưới pytest — chúng phải tiếp tục
    đọc `DATABASE_URL` y như trước."""
    monkeypatch.setattr(appdb, "dang_chay_pytest", lambda: False)
    monkeypatch.setenv("DATABASE_URL", PROD)
    monkeypatch.delenv("TEST_DATABASE_URL", raising=False)
    assert "supabase.com" in appdb.database_url()


def test_ngoai_pytest_BO_QUA_TEST_DATABASE_URL(monkeypatch):
    """Chiều ngược lại của hàng rào, và nó quan trọng ngang chiều xuôi: production
    không được vớt `TEST_DATABASE_URL` khi biến đó tình cờ có mặt (một file `.env`
    bê nhầm, một biến còn sót trong shell). Gunicorn trên Render đọc `DATABASE_URL`,
    chấm hết."""
    monkeypatch.setattr(appdb, "dang_chay_pytest", lambda: False)
    monkeypatch.setenv("DATABASE_URL", PROD)
    monkeypatch.setenv("TEST_DATABASE_URL", TEST_RIENG)
    ra = appdb.database_url()
    assert "supabase.com" in ra
    assert "studymap_test" not in ra


def test_hai_du_an_supabase_khac_nhau_bi_coi_la_MOT_dich():
    """GIỚI HẠN ĐÃ BIẾT, và nó fail-closed nên giữ nguyên.

    Pooler của Supabase dùng CHUNG một hostname cho mọi dự án trong cùng vùng, và
    tên database luôn là `postgres`. Thứ phân biệt dự án nằm trong USERNAME
    (`postgres.<project_ref>`) — mà `_danh_tinh_dich` cố ý bỏ username đi.

    Hệ quả: hai dự án Supabase HOÀN TOÀN KHÁC NHAU bị coi là cùng một đích, nên
    dùng một dự án Supabase riêng làm TEST_DATABASE_URL sẽ bị chặn. Đó là phía
    an toàn của sai số: chặn nhầm thì mất công, cho qua nhầm thì mất dữ liệu.
    KHÔNG được "sửa" bằng cách đưa username vào danh tính — làm thế là mở lại đúng
    cái lỗ hai tài khoản cùng trỏ một database. Cách đúng là dùng Postgres cục bộ
    hoặc container CI cho test (xem `scripts/setup_test_db.py`)."""
    du_an_a = PROD
    du_an_b = PROD.replace("postgres.abcdefgh", "postgres.zyxwvuts")
    assert appdb._danh_tinh_dich(du_an_a) == appdb._danh_tinh_dich(du_an_b)


def test_ngoai_pytest_thieu_DATABASE_URL_van_nem_nhu_cu(monkeypatch):
    monkeypatch.setattr(appdb, "dang_chay_pytest", lambda: False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(appdb.DatabaseNotConfigured, match="DATABASE_URL chưa được đặt"):
        appdb.database_url()


def test_van_doi_driver_psycopg(monkeypatch):
    """`postgresql://` mặc định là psycopg2 (chưa cài) — luật cũ không được mất."""
    monkeypatch.setenv("TEST_DATABASE_URL", TEST_RIENG)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert appdb.database_url().startswith("postgresql+psycopg://")


# ── Hàng rào của script bootstrap ──────────────────────────────────────────
def test_setup_test_db_tu_choi_khi_thieu_bien(monkeypatch):
    from scripts.setup_test_db import kiem_hang_rao

    monkeypatch.delenv("TEST_DATABASE_URL", raising=False)
    ok, msg = kiem_hang_rao()
    assert ok is False and "TEST_DATABASE_URL" in msg


def test_setup_test_db_tu_choi_khi_cung_dich(monkeypatch):
    from scripts.setup_test_db import kiem_hang_rao

    monkeypatch.setenv("DATABASE_URL", PROD)
    monkeypatch.setenv("TEST_DATABASE_URL", PROD_KHAC_CONG)
    ok, msg = kiem_hang_rao()
    assert ok is False and "CÙNG database" in msg


def test_setup_test_db_khong_lo_mat_khau(monkeypatch):
    from scripts.setup_test_db import kiem_hang_rao

    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("TEST_DATABASE_URL",
                       "postgresql://nguoi:MAT-KHAU-BI-MAT@localhost:55432/studymap_test")
    ok, msg = kiem_hang_rao()
    assert ok is True
    assert "MAT-KHAU-BI-MAT" not in msg and "nguoi" not in msg
    assert "localhost:55432/studymap_test" in msg


# ── CI phải cấp TEST_DATABASE_URL ──────────────────────────────────────────
def test_ci_cap_TEST_DATABASE_URL_va_khong_de_DATABASE_URL_o_muc_job():
    """Bước `pytest` trong CI không được có `DATABASE_URL` trong môi trường — không
    có gì để rơi về thì không có đường nào rơi."""
    import pathlib

    goc = pathlib.Path(__file__).resolve().parents[2]
    ci = (goc / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    khoi_job = ci.split("steps:", 1)[0]
    assert "TEST_DATABASE_URL:" in khoi_job, "CI phải cấp TEST_DATABASE_URL ở mức job"
    assert "\n      DATABASE_URL:" not in khoi_job, (
        "DATABASE_URL không được ở mức job — chỉ đặt cho bước migration và smoke boot")
