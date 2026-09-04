"""Kiểm tra kho object Supabase có dùng được không. CHỈ ghi/đọc/xoá một file probe.

    python -m scripts.verify_supabase_storage
    python -m scripts.verify_supabase_storage --ensure-bucket
    python -m scripts.verify_supabase_storage --ci      # thoát khác 0 khi chưa cấu hình

Đọc `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` từ môi trường.
KHÔNG in khoá, header, hay URL có token.

Probe nằm dưới `_index_persistence_probe/<uuid>.txt`, bị xoá ngay sau khi đọc lại.
Không chạm `index/`, không chạm file tài liệu, không chạm dữ liệu người dùng.

`--ensure-bucket` PHẢI nêu tường minh: tạo bucket trên production là thay đổi hạ
tầng, không phải tác dụng phụ của một lệnh kiểm tra.

Mặc định thoát 0 kể cả khi chưa cấu hình — lệnh này hay được gọi ở nơi Supabase là
tuỳ chọn. `--ci` đảo lại cho pipeline nào coi việc thiếu cấu hình là hỏng.
"""

from __future__ import annotations

import argparse


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ensure-bucket", action="store_true",
                   help="tạo bucket nếu chưa có (thay đổi hạ tầng — phải nêu rõ)")
    p.add_argument("--ci", action="store_true",
                   help="thoát khác 0 khi chưa cấu hình hoặc kiểm tra hỏng")
    args = p.parse_args()

    # `documents/storage.py` đọc thẳng `os.getenv` và KHÔNG tự nạp `.env` — nó vốn
    # chỉ chạy trong tiến trình app, nơi `llm_factory` đã nạp hộ. Chạy script này
    # trần thì không có ai nạp, và lệnh sẽ báo "chưa cấu hình" dù `.env` có đủ biến.
    try:
        from shared.env_loader import load_project_env

        load_project_env(override=False)
    except Exception:
        pass

    from app.domains.documents import storage_probe

    ra = storage_probe.kiem_tra_kho(ensure_bucket=args.ensure_bucket)
    storage_probe.in_bao_cao(ra)

    if not args.ci:
        return 0
    return 0 if ra.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
