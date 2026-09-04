"""Dựng lại index truy hồi từ PostgreSQL. CHẠY TAY, không có gì tự gọi file này.

    python -m scripts.dung_lai_index_tu_postgres --dry-run
    python -m scripts.dung_lai_index_tu_postgres --thuc-hien

`--dry-run` (mặc định) đọc chunk, đếm, in danh tính embedding đang cấu hình rồi DỪNG.
Không gọi embedding, không ghi file, không chạm DB — dùng để xem trước quy mô và giá
trước khi tiêu tiền gọi API.

`--thuc-hien` chạy đủ bốn giai đoạn: sinh vector → ghi staging → thẩm định → thăng cấp,
rồi ghi `embedding_id` xuống Postgres. Index đang phục vụ chỉ bị thay ở bước cuối, và
bản cũ được giữ lại dưới dạng `index_backup_<thời điểm>`.

Trước khi chạy thật, kiểm ba thứ:
  1. `embedding_identity()` in ra đúng provider/model/strategy bạn muốn index mang.
  2. `INDEX_DIR` trỏ vào chỗ dữ liệu sống được — trên Render free đó là đĩa PHÙ DU,
     dựng lại xong sẽ mất sau lần khởi động kế tiếp.
  3. Số chunk khớp với kỳ vọng (`--dry-run` in ra).
"""

from __future__ import annotations

import argparse
import sys
import time


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--thuc-hien", action="store_true",
                   help="chạy thật; thiếu cờ này thì chỉ xem trước")
    p.add_argument("--persist", action="store_true",
                   help="đẩy artifact lên kho object SAU khi thăng cấp cục bộ thành "
                        "công. Phải nêu TƯỜNG MINH — dựng lại index là việc cục bộ, "
                        "xuất bản nó cho mọi instance khác dùng là việc khác.")
    p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--keep-backup", type=int, default=3)
    args = p.parse_args()

    from app.clients.llm_factory import embedding_identity, fpt_embedding_enabled
    from app.domains.vectorstore import rebuild as rb
    from app.domains.vectorstore import store as _store

    dt = embedding_identity()
    print(f"INDEX_DIR         : {_store.INDEX_DIR}")
    print(f"Danh tính embedding: {dt}")
    if dt.get("embedding_provider") == "fake":
        print("\nDỪNG: đang dùng FakeEmbeddings (SKIP_MODEL_LOAD=1 và chưa bật FPT "
              "embedding). Index dựng ra sẽ vô nghĩa.", file=sys.stderr)
        return 2
    if not fpt_embedding_enabled():
        print("Lưu ý: FPT embedding CHƯA bật — index sẽ mang danh tính model cục bộ.")

    t0 = time.perf_counter()
    ban_ghi = rb.doc_chunks_tu_db()
    print(f"Chunk đọc từ Postgres: {len(ban_ghi)} ({time.perf_counter() - t0:.1f}s)")
    if not ban_ghi:
        print("Không có chunk nào — không đụng vào index hiện có.")
        return 0

    theo_doc: dict[str, int] = {}
    for b in ban_ghi:
        theo_doc[b["document_id"]] = theo_doc.get(b["document_id"], 0) + 1
    print(f"Tài liệu: {len(theo_doc)}")

    if not args.thuc_hien:
        print("\n(xem trước) Thêm --thuc-hien để dựng thật.")
        return 0

    def _tien_do(xong: int, tong: int) -> None:
        print(f"  embed {xong}/{tong}", flush=True)

    ra = rb.rebuild_index_tu_postgres(ban_ghi=ban_ghi, batch_size=args.batch_size,
                                      tien_do=_tien_do, keep_backup=args.keep_backup)
    print(f"\nKết quả: {ra}")
    if not ra.get("promoted"):
        return 1

    if args.persist:
        from app.domains.vectorstore import persistence as ps

        if not ps.enabled():
            print("\n--persist được nêu nhưng INDEX_PERSISTENCE_ENABLED chưa bật — "
                  "bỏ qua. Không bật ngầm hộ: đẩy index lên kho là thay đổi thứ mọi "
                  "instance khác sẽ tải về.", file=sys.stderr)
        else:
            print(f"\nĐẩy lên kho: {ps.publish_sau_rebuild()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
