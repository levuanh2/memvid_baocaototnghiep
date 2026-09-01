"""Kiểm sức khoẻ không gian vector của một index đã dựng — chặn thang đo chạy trên nền hỏng.

Vì sao cần: thang E0–E7 đã chạy trọn trên `R2_late`, một index mà mọi chunk gần như trùng
nhau (cosine cạnh nhau 0.9950). Không có gì kêu — FAISS vẫn trả về k láng giềng, metric
vẫn tính ra số, bảng kết quả vẫn trông hợp lệ. Chỉ khi thấy "BM25 thuần thắng mọi thứ"
mới có người dừng lại kiểm. Playbook ghi: đã suýt mất 15 giờ.

Số đo thật trên máy này (2026-09-01, cùng bộ 142 chunk cho R1/R2):

    index           n     cosine TB   canh nhau
    production     188      0.6622      0.7820
    R0_recursive   171      0.5091      0.5970
    R1_structure   142      0.5117      0.6246
    R2_late        142      0.9262      0.9950   <- sup

Ngưỡng đặt ở 0.90 cho "cạnh nhau": R0/R1/production đều dưới 0.79, R2 ở 0.9950. Khoảng
trống rộng nên ngưỡng không cần tinh chỉnh.

Đây là hàng rào, không phải bản sửa late chunking. Nó không làm index hết sụp; nó làm
việc sụp KÊU LÊN trước khi ai đó tiêu 15 giờ máy vào nó.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

# Trên ngưỡng này thì các chunk cạnh nhau gần như không phân biệt được với nhau.
NGUONG_CANH_NHAU = 0.90
# Trung bình toàn cục cao cũng là dấu hiệu, nhưng yếu hơn — index một chủ đề hẹp có thể
# tự nhiên cao. Chỉ dùng làm cảnh báo phụ.
NGUONG_TRUNG_BINH = 0.90


def do_suc_khoe(index_dir: Path, *, mau_toi_da: int = 500) -> Optional[dict]:
    """(cosine trung bình, cosine chunk cạnh nhau, n). None nếu không đọc được index."""
    import numpy as np

    duong = Path(index_dir) / "index.faiss"
    if not duong.exists():
        return None
    try:
        import faiss

        idx = faiss.read_index(str(duong))
        n = int(idx.ntotal)
        if n < 3:
            return None
        v = idx.reconstruct_n(0, min(n, mau_toi_da)).astype("float32")
    except Exception:
        return None   # index không phải IndexFlat, hoặc faiss lỗi — không đoán

    v /= np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)
    sim = v @ v.T
    m = sim.shape[0]
    tren = sim[np.triu_indices(m, k=1)]
    canh = np.array([float(sim[i, i + 1]) for i in range(m - 1)])
    return {"n": n, "mau": m, "trung_binh": float(tren.mean()),
            "canh_nhau": float(canh.mean())}


def sup_khong_gian(sk: Optional[dict]) -> bool:
    """Index này có sụp không. `None` (không đo được) KHÔNG phải là sụp."""
    if not sk:
        return False
    return sk["canh_nhau"] > NGUONG_CANH_NHAU or sk["trung_binh"] > NGUONG_TRUNG_BINH


def canh_bao(index_dir: Path) -> Optional[dict]:
    """Đo rồi in. Trả kết quả đo để caller tự quyết dừng hay chạy tiếp."""
    sk = do_suc_khoe(index_dir)
    if sk is None:
        print(f"[suc_khoe_index] khong do duoc: {index_dir}", flush=True)
        return None
    print(f"[suc_khoe_index] {index_dir}: n={sk['n']} "
          f"cosine_TB={sk['trung_binh']:.4f} canh_nhau={sk['canh_nhau']:.4f}", flush=True)
    if sup_khong_gian(sk):
        print("[suc_khoe_index] CANH BAO: khong gian vector SUP — cac chunk gan nhu "
              "trung nhau. Truy hoi dense tren index nay dang do NHIEU, va moi so lieu "
              "rut ra tu no deu vo nghia (doi chieu: R0/R1 canh_nhau ~0.60, R2_late "
              "0.9950). Xem .playbook 'Late chunking mean-pool'.", flush=True)
    return sk
