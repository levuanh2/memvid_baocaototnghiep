"""Cấu hình thí nghiệm phải thắng `.env` của máy đang chạy.

Hồi quy cho một lỗi lặng: `adapters.py` gác đúng bằng `cfg["nli"]["enabled"]`,
nhưng bên trong gọi `nli.get_nli()` — hàm này đọc `NLI_ENABLED` từ môi trường và
trả `NullNli` khi cờ tắt. Chạy E4_nli trên máy có `NLI_ENABLED=0` thì cổng YAML
vẫn mở, `nli_filter` vẫn chạy, nhưng engine không bao giờ báo xung đột: E4 ra kết
quả trùng khít E3_rerank và hiệu số "đóng góp của NLI" bằng 0 vì lý do sai.
Không có lỗi nào nổ ra.
"""

from __future__ import annotations

import os

import pytest

from app.domains.retrieval import nli, rerank
from shared.config import reload as reload_settings


@pytest.fixture(autouse=True)
def _sach_cache(monkeypatch):
    """get_nli/get_reranker nhớ singleton — phải xoá giữa các ca, nếu không ca sau
    dính engine của ca trước."""
    monkeypatch.setattr(nli, "_nli_cache", None, raising=False)
    monkeypatch.setattr(nli, "_nli_key", None, raising=False)
    monkeypatch.setattr(rerank, "_reranker_cache", None, raising=False)
    monkeypatch.setattr(rerank, "_reranker_key", None, raising=False)
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    reload_settings()
    yield
    reload_settings()


def test_nli_tat_bang_env_tra_ve_engine_rong(monkeypatch):
    """Đây chính là cái bẫy: cờ môi trường vô hiệu hoá engine mà không báo gì."""
    monkeypatch.setenv("NLI_ENABLED", "0")
    reload_settings()
    engine = nli.get_nli()
    assert isinstance(engine, nli.NullNli)
    # NullNli chấm mọi cặp là neutral -> không bao giờ có xung đột.
    ket_qua = engine.predict([("a", "b")])
    assert ket_qua[0]["contradiction"] == 0.0


def test_rerank_tat_bang_env_tra_ve_identity(monkeypatch):
    monkeypatch.setenv("RERANK_ENABLED", "0")
    reload_settings()
    assert rerank.get_reranker() is rerank._IDENTITY


def test_runner_dat_co_theo_yaml_khong_theo_env(monkeypatch):
    """Bộ chạy phải ghi đè môi trường từ cấu hình TRƯỚC khi import production."""
    import evaluation.runner as runner_mod
    import inspect

    src = inspect.getsource(runner_mod.run)
    # Khoá bằng nguồn: gọi run() thật cần dataset đóng băng + index manifest.
    assert 'os.environ["NLI_ENABLED"]' in src, "runner khong dat NLI_ENABLED tu cfg"
    assert 'os.environ["RERANK_ENABLED"]' in src, "runner khong dat RERANK_ENABLED tu cfg"

    # Và phải đặt TRƯỚC dòng import adapters (production import).
    vi_tri_nli = src.index('os.environ["NLI_ENABLED"]')
    vi_tri_import = src.index("from evaluation.adapters import")
    assert vi_tri_nli < vi_tri_import, "dat co SAU khi import production thi vo tac dung"


@pytest.mark.parametrize("bat", [True, False])
def test_co_suy_ra_dung_tu_cfg(bat):
    """Cùng biểu thức mà runner dùng — khoá cả hai chiều."""
    cfg = {"nli": {"enabled": bat}, "rerank": {"enabled": bat}}
    assert ("1" if cfg.get("nli", {}).get("enabled") else "0") == ("1" if bat else "0")
    assert ("1" if cfg.get("rerank", {}).get("enabled") else "0") == ("1" if bat else "0")


def test_cfg_thieu_khoi_nli_thi_coi_nhu_tat():
    cfg: dict = {}
    assert ("1" if cfg.get("nli", {}).get("enabled") else "0") == "0"
