"""Đếm ngữ liệu và ước lượng khối lượng embedding. KHÔNG gọi API embedding lần nào.

    python -m scripts.kiem_ke_ngu_lieu
    python -m scripts.kiem_ke_ngu_lieu --gia-moi-trieu-token 0.02
    python -m scripts.kiem_ke_ngu_lieu --giay-moi-request 0.4

Chỉ ĐỌC Postgres, dùng đúng luật lọc của `rebuild.doc_chunks_tu_db` (tài liệu
`status != deleted`, mọi chunk của chúng). Không ghi gì, không đụng index.

Số token là ƯỚC LƯỢNG có khoảng, không phải con số chính xác: marketplace không công
bố tokenizer của `Vietnamese_Embedding`, nên phía client không tính đúng được.

Không truyền `--gia-moi-trieu-token` thì phần chi phí ghi "chưa xác minh" thay vì bịa
ra một con số trông giống thật.
"""

from __future__ import annotations

import argparse
import time


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--gia-moi-trieu-token", type=float, default=None,
                   help="ghi đè đơn giá / 1 triệu token. Bỏ trống thì tự đọc từ "
                        "`GET /v1/models` của FPT — nguồn chính thức duy nhất, vì "
                        "trang marketplace công khai không hiện giá.")
    p.add_argument("--giay-moi-request", type=float, default=None,
                   help="độ trễ đo được từ một lượt smoke thật, để phóng chiếu thời gian")
    args = p.parse_args()

    from app.clients.llm_factory import embedding_identity
    from app.domains.vectorstore import corpus_audit as ca
    from app.domains.vectorstore.rebuild import doc_chunks_tu_db

    print(f"Danh tính embedding hiện tại: {embedding_identity()}")
    t0 = time.perf_counter()
    ban_ghi = doc_chunks_tu_db()
    print(f"Đọc Postgres: {len(ban_ghi)} chunk trong {time.perf_counter() - t0:.1f}s\n")

    gia = args.gia_moi_trieu_token
    if gia is None:
        gia = ca.gia_tu_marketplace()
        print(f"Đơn giá đọc từ FPT /v1/models: "
              f"{gia if gia is not None else 'không đọc được'} / 1 triệu token prompt")
    r = ca.bao_cao(ban_ghi, gia_moi_trieu_token=gia,
                   giay_moi_request=args.giay_moi_request)

    n = r["ngu_lieu"]
    print("NGỮ LIỆU (đo được)")
    print(f"  chunk đủ điều kiện       : {n['chunks']}")
    print(f"  tài liệu                 : {n['documents']}")
    print(f"  tổng ký tự               : {n['tong_ky_tu']:,}")
    print(f"  ký tự/chunk (tb/min/max) : {n['ky_tu_trung_binh']} / "
          f"{n['ky_tu_ngan_nhat']} / {n['ky_tu_dai_nhat']}")
    print(f"  chunk/tài liệu (tb/min/max): {n['chunk_moi_doc_trung_binh']} / "
          f"{n['chunk_moi_doc_it_nhat']} / {n['chunk_moi_doc_nhieu_nhat']}")
    print(f"  chunk có thể vượt ctx 8000: {n['chunk_vuot_ctx_uoc_luong']}")

    t = r["token_uoc_luong"]
    print(f"\nTOKEN (ƯỚC LƯỢNG, khoảng): {t['thap']:,} – {t['cao']:,}")

    print("\nKẾ HOẠCH REQUEST")
    for k in r["ke_hoach_request"]:
        dong = f"  batch {k['batch_size']:>3} -> {k['so_request']:>6} request"
        if "thoi_gian" in r:
            tg = r["thoi_gian"][k["batch_size"]]
            dong += f"  ~{tg['phut_co_thu_lai']} phút (đã cộng 10% thử lại)"
        print(dong)

    print("\nCHI PHÍ")
    for nhan, khoa in (("thấp", "chi_phi_thap"), ("cao", "chi_phi_cao")):
        c = r[khoa]
        if not c["pricing_verified"]:
            print(f"  {nhan}: {c['ghi_chu']}")
            break
        print(f"  {nhan}: {c['chi_phi']} (đơn vị tiền tệ KHÔNG được API khai báo)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
