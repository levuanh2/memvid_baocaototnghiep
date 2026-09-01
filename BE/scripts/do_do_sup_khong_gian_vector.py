"""Đo xem không gian vector của index ĐANG CHẠY có bị sụp như index R2_late không.

Bối cảnh: known-issues "(CHẶN) Late chunking mean-pool trong khi bge-m3 dùng CLS" đo
được trên index đánh giá `R2_late`: chunk cạnh nhau giống nhau tới 0.9999, tương đồng
trong cùng tài liệu 0.967–0.995 (index nhúng thường: 0.53–0.68).

Câu hỏi mở còn lại: đó là lỗi của RIÊNG bộ đánh giá, hay index production cũng vậy?

- Lỗi "hai không gian" (tài liệu mean-pool vs truy vấn CLS) KHÔNG dính production:
  `LateChunkEncoder.embed_query` cũng mean-pool, nên hai bên cùng một không gian.
- Nhưng "sụp" là tính chất của CHÍNH các vector tài liệu: nếu mọi chunk gần như trùng
  nhau thì truy vấn nào cũng vô nghĩa, bất kể nhúng bằng gì.

Script chỉ ĐỌC. Không sửa index, không gọi model.

Chạy:  ./.venv/Scripts/python.exe scripts/do_do_sup_khong_gian_vector.py
"""

from __future__ import annotations

import argparse
import random
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mau", type=int, default=400,
                    help="số vector lấy mẫu để tính ma trận tương đồng")
    args = ap.parse_args()

    from shared.env_loader import load_project_env
    load_project_env()

    import numpy as np

    from app.domains.vectorstore.store import INDEX_DIR

    duong = INDEX_DIR / "index.faiss"
    if not duong.exists():
        print(f"KHONG CO INDEX: {duong}")
        return 2

    import faiss

    idx = faiss.read_index(str(duong))
    n = idx.ntotal
    print(f"index      : {duong}")
    print(f"so vector  : {n}   dim={idx.d}")
    if n < 2:
        print("chua du vector de do")
        return 0

    # IndexFlat* cho phep lay lai vector goc.
    try:
        vecs = idx.reconstruct_n(0, n).astype("float32")
    except Exception as exc:
        print(f"khong reconstruct duoc ({exc}) — index khong phai IndexFlat?")
        return 2

    if n > args.mau:
        random.seed(0)
        chon = sorted(random.sample(range(n), args.mau))
        vecs = vecs[chon]

    # cosine: chuan hoa roi nhan trong
    chuan = np.linalg.norm(vecs, axis=1, keepdims=True)
    chuan[chuan == 0] = 1.0
    v = vecs / chuan
    sim = v @ v.T
    m = sim.shape[0]
    tren = sim[np.triu_indices(m, k=1)]

    # chunk "canh nhau" = cac cap chi so lien tiep trong index (thu tu ingest)
    canh_nhau = np.array([float(sim[i, i + 1]) for i in range(m - 1)])

    print()
    print(f"mau        : {m} vector")
    print(f"cosine TB  : {tren.mean():.4f}")
    print(f"cosine p50 : {np.percentile(tren, 50):.4f}")
    print(f"cosine p95 : {np.percentile(tren, 95):.4f}")
    print(f"cosine max : {tren.max():.4f}")
    print(f"chunk canh nhau — TB {canh_nhau.mean():.4f}  max {canh_nhau.max():.4f}")
    print()
    print("Doi chieu known-issues:")
    print("  nhung thuong (R0/R1) : trong tai lieu 0.53-0.68 | cheo tai lieu 0.447")
    print("  late chunking (R2)   : trong tai lieu 0.967-0.995 | canh nhau 0.9999")
    print()
    if canh_nhau.mean() > 0.95 or tren.mean() > 0.90:
        print("KET LUAN: khong gian SUP — truy hoi dense tren index nay dang do nhieu.")
        print("          Anh huong ca APP dang chay, khong chi bo danh gia.")
    elif tren.mean() > 0.75:
        print("KET LUAN: co dau hieu sup mot phan. Can doi chieu them.")
    else:
        print("KET LUAN: khong gian con phan biet duoc. App khong dinh loi cua R2_late.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
