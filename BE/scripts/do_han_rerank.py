"""Đo thời gian rerank theo số ứng viên và độ dài chunk — CHỈ ĐO, không sửa gì.

Bối cảnh: known-issues "(CẦN ĐỂ Ý) Hạn rerank 10s sát mép". Đo cũ với chunk tổng hợp
979 ký tự: 20 ứng viên mất 12.95s, vượt `RERANK_TIMEOUT_SEC=10` nên rơi về thứ tự gốc —
tốn trọn 10 giây mà không đổi gì. Chunk thật hiện tại ngắn hơn (~316 ký tự) nên còn lọt.
Ba đường (giảm `RERANK_CANDIDATE_K`, nâng hạn, cắt ngắn text) chưa quyết được vì THIẾU
SỐ trên chunk THẬT của kho này.

Script lấy chunk THẬT từ index đang chạy, không dùng văn bản tổng hợp — số đo trên văn
bản bịa ra chỉ nói về văn bản bịa ra.

    ./.venv/Scripts/python.exe -m scripts.do_han_rerank
    ./.venv/Scripts/python.exe -m scripts.do_han_rerank --lap 3
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time


def _lay_chunk_that(gioi_han: int = 40) -> list[str]:
    """Chunk thật từ chunks.sqlite / index metadata. Rỗng thì trả []."""
    import sqlite3

    try:
        from app.domains.vectorstore import chunk_text_store

        con = sqlite3.connect(chunk_text_store._db_path())
        try:
            rows = con.execute(
                "SELECT text FROM chunks WHERE text IS NOT NULL AND length(text) > 0 "
                "ORDER BY chunk_id LIMIT ?", (gioi_han,)).fetchall()
        finally:
            con.close()
        return [r[0] for r in rows if str(r[0] or "").strip()]
    except Exception as exc:
        print(f"(khong lay duoc chunk that: {exc})")
        return []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lap", type=int, default=2, help="so lan lap moi phep do")
    ap.add_argument("--truy-van", default="tích phân từng phần được dùng khi nào")
    args = ap.parse_args()

    from shared.env_loader import load_project_env
    load_project_env()

    import os

    os.environ.pop("SKIP_MODEL_LOAD", None)

    from app.domains.retrieval import rerank
    from shared.config import get_settings

    s = get_settings()
    print(f"model      : {s.rerank_model}")
    print(f"candidate_k: {s.rerank_candidate_k}   timeout: {s.rerank_timeout_sec}s")

    rr = rerank.get_reranker()
    if type(rr).__name__ == "IdentityReranker":
        print("RERANK dang TAT (IdentityReranker) — bat RERANK_ENABLED=1 roi do lai.")
        return 2

    chunks = _lay_chunk_that()
    if not chunks:
        print("Khong co chunk that trong index — khong do duoc tren du lieu that.")
        return 2

    do_dai = [len(c) for c in chunks]
    print(f"chunk that : {len(chunks)} doan | do dai TB {statistics.mean(do_dai):.0f} "
          f"ky tu, p95 {sorted(do_dai)[int(len(do_dai) * 0.95) - 1]}, max {max(do_dai)}")

    # warm: lan dau tra gia nap model, khong tinh vao so do
    t0 = time.perf_counter()
    rr.rerank(args.truy_van, chunks[:2])
    print(f"nap + warm : {time.perf_counter() - t0:.2f}s (khong tinh vao bang duoi)")
    print()

    print(f"{'k':>4} {'p50 (s)':>9} {'max (s)':>9}  ket luan")
    ket = {}
    for k in (5, 10, 15, 20, 30):
        if k > len(chunks):
            break
        mau = chunks[:k]
        lan = []
        for _ in range(max(1, args.lap)):
            t = time.perf_counter()
            rr.rerank(args.truy_van, mau)
            lan.append(time.perf_counter() - t)
        p50 = statistics.median(lan)
        ket[k] = p50
        cb = "OK" if p50 < s.rerank_timeout_sec * 0.6 else (
            "SAT MEP" if p50 < s.rerank_timeout_sec else "VUOT HAN")
        print(f"{k:>4} {p50:>9.2f} {max(lan):>9.2f}  {cb}")

    print()
    hien = ket.get(s.rerank_candidate_k)
    if hien is not None:
        ty = hien / s.rerank_timeout_sec
        print(f"Voi RERANK_CANDIDATE_K={s.rerank_candidate_k} hien tai: "
              f"{hien:.2f}s = {ty * 100:.0f}% cua han {s.rerank_timeout_sec}s")
        if ty >= 1.0:
            print("  -> DANG VUOT HAN: moi truy van tra 10s roi bo ket qua rerank.")
        elif ty >= 0.6:
            print("  -> Bien an toan mong. Tai lieu co doan dai hon la cham han.")
        else:
            print("  -> Con bien an toan.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
