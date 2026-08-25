"""Chọn thiết bị PyTorch: mặc định CPU, xin GPU mà không có thì lùi về — có kêu.

Vì sao có module này: `requirements.txt` ghim `torch==2.5.1+cpu` CÓ CHỦ Ý (ảnh
Docker không kéo CUDA toolkit). Nhưng máy phát triển có GPU, và chạy CPU đắt tới
mức đo được — NLI mDeBERTa **298 giây mỗi truy vấn**. `TORCH_DEVICE` mở đường
dùng GPU ở máy dev mà KHÔNG đổi hành vi mặc định ở đâu cả.
"""

from __future__ import annotations

import pytest

import shared.device as D
from shared.device import mo_ta, torch_device


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    monkeypatch.delenv("TORCH_DEVICE", raising=False)
    monkeypatch.setattr(D, "_da_canh_bao", False, raising=False)
    yield
    monkeypatch.setattr(D, "_da_canh_bao", False, raising=False)


def test_mac_dinh_la_cpu():
    """Không đặt biến thì phải y hệt hành vi cũ — đây là hợp đồng quan trọng nhất."""
    assert torch_device() == "cpu"


def test_dat_cpu_tuong_minh():
    import os

    os.environ["TORCH_DEVICE"] = "cpu"
    assert torch_device() == "cpu"


def test_khong_co_cuda_thi_lui_ve_cpu(monkeypatch, capsys):
    import types

    gia = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: False))
    monkeypatch.setitem(__import__("sys").modules, "torch", gia)
    monkeypatch.setenv("TORCH_DEVICE", "cuda")
    assert torch_device() == "cpu"
    assert "không thấy CUDA" in capsys.readouterr().out


def test_chi_keu_MOT_lan(monkeypatch, capsys):
    """Kêu mỗi lần gọi sẽ ngập log — nhưng im hẳn thì không ai biết vì sao chậm."""
    import types

    gia = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: False))
    monkeypatch.setitem(__import__("sys").modules, "torch", gia)
    monkeypatch.setenv("TORCH_DEVICE", "cuda")
    torch_device()
    capsys.readouterr()
    torch_device()
    assert capsys.readouterr().out == ""


def test_co_cuda_thi_dung_cuda(monkeypatch):
    import types

    gia = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True))
    monkeypatch.setitem(__import__("sys").modules, "torch", gia)
    monkeypatch.setenv("TORCH_DEVICE", "cuda")
    assert torch_device() == "cuda"


def test_auto_chon_cuda_khi_co(monkeypatch):
    import types

    gia = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True))
    monkeypatch.setitem(__import__("sys").modules, "torch", gia)
    monkeypatch.setenv("TORCH_DEVICE", "auto")
    assert torch_device() == "cuda"


def test_chi_dinh_GPU_cu_the(monkeypatch):
    import types

    gia = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True))
    monkeypatch.setitem(__import__("sys").modules, "torch", gia)
    monkeypatch.setenv("TORCH_DEVICE", "cuda:1")
    assert torch_device() == "cuda:1"


def test_torch_import_hong_van_tra_cpu(monkeypatch):
    """Không được ném vào đường khởi động chỉ vì torch có vấn đề."""
    import builtins

    that = builtins.__import__

    def gia_import(ten, *a, **kw):
        if ten == "torch":
            raise ImportError("gia lap")
        return that(ten, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", gia_import)
    monkeypatch.setenv("TORCH_DEVICE", "cuda")
    assert torch_device() == "cpu"


def test_mo_ta_khong_nem():
    assert isinstance(mo_ta(), str) and mo_ta()
