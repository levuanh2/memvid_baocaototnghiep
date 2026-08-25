"""Chọn thiết bị chạy model PyTorch — một nguồn sự thật cho mọi tầng.

Vì sao cần: `requirements.txt` ghim `torch==2.5.1+cpu` CÓ CHỦ Ý — ảnh Docker không
nên kéo theo CUDA toolkit, và máy chủ triển khai thường không có GPU. Nhưng máy
phát triển thì có, và ba model nặng (bge-m3, bge-reranker-v2-m3, mDeBERTa NLI)
chạy CPU đắt tới mức đo được: NLI **298 giây mỗi truy vấn**.

Mặc định `cpu` để không đổi hành vi ở đâu cả. Đặt `TORCH_DEVICE=cuda` trong
`BE/.env` của máy có GPU. `auto` thì tự dò.

Bốn chỗ trước đây tự ghim `"cpu"` hoặc bỏ trống — nay đều hỏi hàm này:
`llm_factory.get_embeddings`, `late_chunk`, `rerank`, `nli`.
"""

from __future__ import annotations

import os


def torch_device() -> str:
    """`cpu` | `cuda` | `cuda:N`. Không bao giờ ném — GPU vắng thì lùi về `cpu`."""
    yeu_cau = (os.getenv("TORCH_DEVICE") or "cpu").strip().lower()
    if yeu_cau == "cpu":
        return "cpu"

    try:
        import torch

        if not torch.cuda.is_available():
            # Xin cuda mà không có: kêu MỘT lần rồi chạy CPU. Im lặng lùi về CPU là
            # cách nhanh nhất để một lần chạy chậm gấp 30 lần mà không ai biết vì sao.
            _canh_bao_mot_lan(yeu_cau)
            return "cpu"
    except Exception:
        return "cpu"

    return "cuda" if yeu_cau == "auto" else yeu_cau


_da_canh_bao = False


def _canh_bao_mot_lan(yeu_cau: str) -> None:
    global _da_canh_bao
    if _da_canh_bao:
        return
    _da_canh_bao = True
    print(
        f"⚠️  [device] TORCH_DEVICE={yeu_cau!r} nhưng torch không thấy CUDA "
        f"(bản cài có thể là torch+cpu) — chạy trên CPU.",
        flush=True,
    )


def mo_ta() -> str:
    """Dòng in lúc khởi động: thiết bị nào, và torch có CUDA không."""
    d = torch_device()
    try:
        import torch

        build = torch.version.cuda or "cpu-only"
        ten = torch.cuda.get_device_name(0) if d.startswith("cuda") else "-"
        return f"{d} (torch {torch.__version__}, CUDA build {build}, GPU {ten})"
    except Exception:
        return d
