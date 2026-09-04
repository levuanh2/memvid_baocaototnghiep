"""Kiểm kê ngữ liệu production — CHỈ ĐỌC. Không sửa, không xoá, không gọi API nào.

    python -m scripts.audit_production_corpus
    python -m scripts.audit_production_corpus --eligibility

Script này KHÔNG: ghi DB, tạo bảng, xoá dòng, gọi embedding, gọi FPT, chạm FAISS,
chạm Supabase, in bí mật. Nó chạy đúng hai loại câu lệnh: `SELECT` và `COUNT`.

`--eligibility` đối chiếu với `config/production_index_allowlist.json` và cho biết
tài liệu nào ĐƯỢC PHÉP vào index production. Luật: không có bản ghi trong allowlist
thì KHÔNG được index. Vắng mặt không bao giờ là cho phép.
"""

from __future__ import annotations

import argparse

UNREVIEWED = "UNREVIEWED"   # chưa có bản ghi allowlist nào cho tài liệu này


def _lay_du_lieu():
    from sqlalchemy import func, select

    from app.db import session_scope
    from app.db.models import Document, DocumentChunk, User

    with session_scope() as s:
        rows = s.execute(
            select(Document.id, Document.title, Document.status, Document.user_id,
                   Document.created_at, Document.updated_at, User.email,
                   func.count(DocumentChunk.id),
                   Document.metadata_json["ingest_origin"].astext)
            .join(User, User.id == Document.user_id, isouter=True)
            .join(DocumentChunk, DocumentChunk.document_id == Document.id, isouter=True)
            .group_by(Document.id, Document.title, Document.status, Document.user_id,
                      Document.created_at, Document.updated_at, User.email,
                      Document.metadata_json["ingest_origin"].astext)
            .order_by(Document.created_at)
        ).all()
        tong_user = s.execute(select(func.count(User.id))).scalar() or 0
        tong_chunk = s.execute(select(func.count(DocumentChunk.id))).scalar() or 0
    return rows, tong_user, tong_chunk


def _in_kiem_ke(rows, tong_user, tong_chunk) -> None:
    print(f"{'document_id':38} {'filename':34} {'status':11} {'chunks':>6}  owner_email")
    print("-" * 118)
    theo_status: dict[str, int] = {}
    for did, ti, st, uid, dc, du, em, n, ng in rows:
        theo_status[str(st)] = theo_status.get(str(st), 0) + 1
        print(f"{str(did):38} {str(ti)[:34]:34} {str(st):11} {n:>6}  {em}")
    print()
    for did, ti, st, uid, dc, du, em, n, ng in rows:
        print(f"{str(did)[:8]}…  owner_id={uid}  tạo={str(dc)[:19]}  sửa={str(du)[:19]}")
    print()
    print(f"TỔNG   tài liệu: {len(rows)}   chunk: {tong_chunk}   user: {tong_user}")
    print(f"THEO STATUS: {theo_status}")
    print("Ghi chú: xoá mềm được biểu diễn bằng status='deleted' (không có cột deleted_at).")


def _in_eligibility(rows) -> int:
    from app.domains.vectorstore import allowlist as al

    try:
        danh_sach = al.tai()
    except al.AllowlistError as exc:
        print(f"DỪNG: {exc}")
        return 2

    print(f"{'filename':30} {'classification':22} {'ingest_origin':14} {'chunks':>6}  eligible")
    print("-" * 90)
    ban_ghi_gia = []
    for did, ti, st, uid, dc, du, em, n, ng in rows:
        ban = danh_sach.get(str(did))
        # Không có bản ghi allowlist = CHƯA AI DUYỆT. Đó là một trạng thái riêng, khác
        # với UNKNOWN (có bản ghi, ghi rõ là chưa có bằng chứng). Cả hai đều không
        # được index; phân biệt để người đọc biết cần thêm bản ghi hay thêm bằng chứng.
        pl = (ban or {}).get("classification", UNREVIEWED)
        ok = al.duoc_index(str(did), danh_sach, ingest_origin=ng)
        print(f"{str(ti)[:30]:30} {pl:22} {str(ng or '(trống)'):14} {n:>6}  "
              f"{'CÓ' if ok else 'không'}")
        ban_ghi_gia.extend([{"document_id": str(did), "ingest_origin": ng}] * n)

    print()
    for did, ti, st, uid, dc, du, em, n, ng in rows:
        ban = danh_sach.get(str(did))
        if ban and ban.get("evidence"):
            print(f"{str(ti)[:34]:34} → {ban['evidence']}")
            print()

    tt = al.tom_tat(ban_ghi_gia, danh_sach)
    print(f"ELIGIBLE_DOCUMENTS  : {tt['eligible_documents']}")
    print(f"ELIGIBLE_CHUNKS     : {tt['eligible_chunks']}")
    print(f"BLOCKED_DOCUMENTS   : {tt['blocked_documents']}")
    print(f"BLOCKED_CHUNKS      : {tt['blocked_chunks']}")
    print(f"AMBIGUOUS_DOCUMENTS : {tt['ambiguous_documents']}")
    print(f"AMBIGUOUS_CHUNKS    : {tt['ambiguous_chunks']}")
    print(f"UNKNOWN_DOCUMENTS   : {tt['unknown_documents']}")
    print(f"NGUỒN production    : {tt['nguon_production_documents']} tài liệu")
    print(f"NGUỒN khác          : {tt['nguon_khong_production_documents']} tài liệu "
          f"(dev/test/chưa có nhãn — KHÔNG được index)")
    print(f"KHÔNG CÓ BẢN GHI    : {tt['khong_co_ban_ghi_documents']} tài liệu / "
          f"{tt['khong_co_ban_ghi_chunks']} chunk (mặc định KHÔNG được index)")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--eligibility", action="store_true",
                   help="đối chiếu với allowlist và cho biết tài liệu nào được index")
    args = p.parse_args()

    rows, tong_user, tong_chunk = _lay_du_lieu()
    if args.eligibility:
        return _in_eligibility(rows)
    _in_kiem_ke(rows, tong_user, tong_chunk)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
