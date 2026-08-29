"""Đếm tài liệu ingest hỏng còn tồn đọng — CHỈ ĐO, không xoá gì.

Ingest lỗi -> `error_handler_node` đặt source `status="error"`; object trên Storage và
dòng `documents` GIỮ NGUYÊN. Giữ là đúng: muốn ingest lại thì phải còn file. Nhưng không
có gì đo xem đống đó lớn cỡ nào, nên cũng không ai quyết được là có cần dọn hay không.
Script này trả lời đúng câu đó, rồi thôi. (Audit vòng 6, P6.)

    BE/.venv/Scripts/python.exe -m scripts.dem_tai_lieu_loi
    BE/.venv/Scripts/python.exe -m scripts.dem_tai_lieu_loi --ngay 30

CHỮ `status` DỄ SAI: `ck_documents_status` chỉ nhận `uploaded|processing|completed|
failed|deleted`. Pipeline gọi trạng thái này là `error`, cột DB lưu `failed`
(`repository._STATUS_TO_DB`). Truy vấn `status = 'error'` trả 0 hàng và kết luận
"không có gì tồn đọng" — sai theo cách im lặng nhất.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ngay", type=int, default=7,
                    help="chỉ đếm tài liệu hỏng cũ hơn N ngày (mặc định 7)")
    args = ap.parse_args()

    from shared.env_loader import load_project_env
    load_project_env()

    from sqlalchemy import select

    from app.db import session_scope
    from app.db.models import Document

    moc = datetime.now(timezone.utc) - timedelta(days=args.ngay)
    with session_scope() as s:
        rows = s.execute(
            select(Document.user_id, Document.file_size, Document.updated_at,
                   Document.title, Document.error_message)
            .where(Document.status == "failed", Document.updated_at < moc)
            .order_by(Document.updated_at)
        ).all()

    if not rows:
        print(f"Không có tài liệu nào hỏng quá {args.ngay} ngày.")
        return 0

    tong_byte = sum(r.file_size or 0 for r in rows)
    print(f"{len(rows)} tài liệu hỏng cũ hơn {args.ngay} ngày "
          f"({tong_byte / 1e6:.1f} MB, cũ nhất {rows[0].updated_at:%Y-%m-%d}).")
    print("file_size NULL đếm là 0 — số MB là cận DƯỚI.")

    theo_user: dict[str, list] = {}
    for r in rows:
        theo_user.setdefault(r.user_id or "(không chủ)", []).append(r)
    print("\nuser_id                                 số  MB")
    for uid, rs in sorted(theo_user.items(), key=lambda kv: -len(kv[1])):
        print(f"{uid:<38} {len(rs):>4}  {sum(r.file_size or 0 for r in rs) / 1e6:>6.1f}")

    loi: dict[str, int] = {}
    for r in rows:
        dau = (r.error_message or "(không có error_message)").strip().splitlines()[0][:70]
        loi[dau] = loi.get(dau, 0) + 1
    print("\nlý do hỏng thường gặp:")
    for msg, n in sorted(loi.items(), key=lambda kv: -kv[1])[:10]:
        print(f"{n:>4}  {msg}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
