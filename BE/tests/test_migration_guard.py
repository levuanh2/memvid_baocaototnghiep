"""Chốt chặn đích Alembic — khoá lại sự cố 2026-09-05.

Sự cố: một lệnh Alembic chạy NGOÀI pytest trỏ vào Supabase production và xoá/dựng lại
`documents.metadata_json`, mất nội dung cột trên 22 hàng thật. Cơ chế thật sự nguy
hiểm là `TEST_DATABASE_URL` KHÔNG có tác dụng ngoài pytest — đặt nó rồi vẫn ra
production. Test `test_C_*` dưới đây khoá đúng điều đó.

Tất cả test ở đây là logic thuần: KHÔNG kết nối database, KHÔNG chạy migration.
"""

from __future__ import annotations

import pytest

from shared.migration_guard import (
    CHE_DO_PRODUCTION,
    CHE_DO_TEST,
    MigrationTargetRejected,
    chon_dich,
    danh_tinh,
    kiem_tra_dich,
    sanitize,
)

TEST_URL = "postgresql://postgres:postgres@localhost:55432/studymap_test"
PROD_URL = "postgresql://u:p@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres"
#: Cùng database production, khác cổng (session pooler). Phải bị coi là MỘT đích.
PROD_URL_5432 = "postgresql://u:p@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres"


def _kt(url, che_do, **kw):
    kiem_tra_dich(url, che_do, **kw)


# ── A. đích test hợp lệ ──────────────────────────────────────────────────────
def test_A_test_db_hop_le_thi_cho_phep():
    env = {"TEST_DATABASE_URL": TEST_URL, "DATABASE_URL": PROD_URL}
    url, che_do = chon_dich(env)
    assert che_do == CHE_DO_TEST
    # So DANH TÍNH, không so chuỗi thô: `chon_dich` chuẩn hoá driver
    # (`postgresql://` → `postgresql+psycopg://`) vì psycopg2 không được cài.
    assert danh_tinh(url) == danh_tinh(TEST_URL) == ("localhost", "studymap_test")
    assert url.startswith("postgresql+psycopg://")
    _kt(url, che_do, live_db_name="studymap_test", env=env)   # không ném


# ── B. TEST_DATABASE_URL trỏ vào production ⇒ chặn ───────────────────────────
def test_B_test_url_tro_vao_production_bi_chan():
    env = {"TEST_DATABASE_URL": PROD_URL}
    url, che_do = chon_dich(env)
    with pytest.raises(MigrationTargetRejected) as ei:
        _kt(url, che_do, env=env)
    assert "host" in str(ei.value).lower()


def test_B2_ten_db_khong_co_hau_to_test_bi_chan():
    """Host đúng nhưng tên database sai ⇒ vẫn chặn. Hai điều kiện độc lập."""
    env = {"TEST_DATABASE_URL": "postgresql://u:p@localhost:5432/postgres"}
    url, che_do = chon_dich(env)
    with pytest.raises(MigrationTargetRejected) as ei:
        _kt(url, che_do, env=env)
    assert "_test" in str(ei.value)


# ── C. có cả hai ⇒ chọn TEST (đúng thứ sự cố đã làm sai) ─────────────────────
def test_C_co_ca_hai_thi_chon_test_khong_chon_production():
    env = {"DATABASE_URL": PROD_URL, "TEST_DATABASE_URL": TEST_URL}
    url, che_do = chon_dich(env)
    assert che_do == CHE_DO_TEST
    assert danh_tinh(url) == ("localhost", "studymap_test")
    assert danh_tinh(url) != danh_tinh(PROD_URL)


def test_C2_test_trung_danh_tinh_voi_production_bi_chan_du_khac_cong():
    """Bỏ qua cổng: 6543 và 5432 của Supabase là CÙNG một database."""
    env = {"DATABASE_URL": PROD_URL, "TEST_DATABASE_URL": PROD_URL_5432}
    url, che_do = chon_dich(env)
    with pytest.raises(MigrationTargetRejected):
        _kt(url, che_do, env=env)


# ── D. thiếu TEST_DATABASE_URL ⇒ chặn, KHÔNG rơi về DATABASE_URL ─────────────
def test_D_thieu_test_url_thi_chan_chu_khong_roi_ve_production():
    env = {"DATABASE_URL": PROD_URL}          # đúng môi trường lúc xảy ra sự cố
    with pytest.raises(MigrationTargetRejected) as ei:
        chon_dich(env)
    assert "TEST_DATABASE_URL" in str(ei.value)


def test_D2_moi_truong_rong_hoan_toan_cung_bi_chan():
    with pytest.raises(MigrationTargetRejected):
        chon_dich({})


# ── E. current_database() lệch ⇒ chặn ────────────────────────────────────────
def test_E_live_current_database_lech_thi_chan():
    env = {"TEST_DATABASE_URL": TEST_URL}
    with pytest.raises(MigrationTargetRejected) as ei:
        _kt(TEST_URL, CHE_DO_TEST, live_db_name="postgres", env=env)
    assert "current_database" in str(ei.value)


# ── F. production KHÔNG có cho phép tường minh ⇒ chặn ────────────────────────
def test_F_production_khong_duoc_cho_phep_ngam():
    """Không cờ ⇒ không bao giờ chọn production, kể cả khi chỉ có DATABASE_URL."""
    with pytest.raises(MigrationTargetRejected):
        chon_dich({"DATABASE_URL": PROD_URL})


def test_F2_chi_bat_co_thoi_van_chua_du():
    """Yêu cầu 3: một biến môi trường ĐƠN LẺ không được là toàn bộ hàng rào."""
    env = {"ALEMBIC_ALLOW_PRODUCTION": "1", "DATABASE_URL": PROD_URL}
    url, che_do = chon_dich(env)
    assert che_do == CHE_DO_PRODUCTION
    with pytest.raises(MigrationTargetRejected) as ei:
        _kt(url, che_do, env=env)
    assert "ALEMBIC_PRODUCTION_HOST" in str(ei.value)


def test_F3_bat_co_nhung_khai_bao_sai_dich_van_bi_chan():
    env = {"ALEMBIC_ALLOW_PRODUCTION": "1", "DATABASE_URL": PROD_URL,
           "ALEMBIC_PRODUCTION_HOST": "mot-host-khac.example.com",
           "ALEMBIC_PRODUCTION_DB": "postgres"}
    url, che_do = chon_dich(env)
    with pytest.raises(MigrationTargetRejected) as ei:
        _kt(url, che_do, env=env)
    assert "không khớp khai báo" in str(ei.value)


def test_F4_production_live_db_lech_khai_bao_bi_chan():
    env = {"ALEMBIC_ALLOW_PRODUCTION": "1", "DATABASE_URL": PROD_URL,
           "ALEMBIC_PRODUCTION_HOST": "aws-0-ap-northeast-2.pooler.supabase.com",
           "ALEMBIC_PRODUCTION_DB": "postgres"}
    with pytest.raises(MigrationTargetRejected) as ei:
        _kt(PROD_URL, CHE_DO_PRODUCTION, live_db_name="mot_db_khac", env=env)
    assert "current_database" in str(ei.value)


# ── G. production có cho phép + khai báo đúng + live khớp ⇒ cho phép ─────────
def test_G_production_du_dieu_kien_thi_cho_phep():
    env = {"ALEMBIC_ALLOW_PRODUCTION": "1", "DATABASE_URL": PROD_URL,
           "ALEMBIC_PRODUCTION_HOST": "aws-0-ap-northeast-2.pooler.supabase.com",
           "ALEMBIC_PRODUCTION_DB": "postgres"}
    url, che_do = chon_dich(env)
    assert che_do == CHE_DO_PRODUCTION
    _kt(url, che_do, live_db_name="postgres", env=env)        # không ném


# ── Không rò credential ──────────────────────────────────────────────────────
def test_thong_diep_loi_khong_bao_gio_chua_mat_khau():
    env = {"TEST_DATABASE_URL": "postgresql://nguoi_dung:MAT_KHAU_BI_MAT@evil.example.com:5432/x_test"}
    url, che_do = chon_dich(env)
    with pytest.raises(MigrationTargetRejected) as ei:
        _kt(url, che_do, env=env)
    msg = str(ei.value)
    assert "MAT_KHAU_BI_MAT" not in msg
    assert "nguoi_dung" not in msg


def test_sanitize_bo_credential():
    s = sanitize("postgresql://u:MAT_KHAU@h.example.com:6543/db")
    assert s == "h.example.com:6543/db"
    assert "MAT_KHAU" not in s and "u:" not in s
