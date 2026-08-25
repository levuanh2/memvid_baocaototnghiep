"""Dọn bản gốc còn sót trong `input_docs/` — chỉ xoá file ĐÃ xác nhận có trên Storage.

Bản gốc sống trên Supabase Storage; `input_docs/` chỉ là chỗ đặt tạm cho pipeline
ingest. Từ nay `_don_file_tam` xoá ngay sau ingest, nhưng file upload TRƯỚC thay
đổi đó vẫn còn nằm lại.

Mặc định CHỈ XEM, không xoá gì. Thêm `--xoa` mới thực sự xoá.

    BE/.venv/Scripts/python.exe -m scripts.don_input_docs
    BE/.venv/Scripts/python.exe -m scripts.don_input_docs --xoa

Quy tắc an toàn:
  - chỉ đụng file nằm trong INPUT_DIR (chặn tuyệt đối `data/input_docs/` ở gốc
    repo — đó là corpus của bộ ablation, xoá nhầm là hỏng dữ liệu nghiên cứu);
  - mỗi file phải khớp một dòng `documents` có `file_path` KHÁC đường dẫn local;
  - **tải lại từ Storage và so kích thước** trước khi xoá — không tin mỗi cột DB;
  - file không đối chiếu được thì báo ra và GIỮ NGUYÊN.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--xoa", action="store_true", help="thực sự xoá (mặc định chỉ xem)")
    args = ap.parse_args()

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from shared.env_loader import load_project_env

    load_project_env()

    from app.domains.documents import repository as docs
    from app.domains.documents import storage
    from shared.paths import BE_ROOT

    # Suy ra y hệt `main.py:147` nhưng KHÔNG import main — import nó sẽ dựng cả
    # graph, nạp model và chạy luồng warmup, chỉ để biết một đường dẫn.
    goc = Path(
        os.environ.get("INPUT_DOCS_DIR")
        or (Path(os.environ.get("DATA_DIR") or BE_ROOT) / "input_docs")
    ).resolve()
    print(f"INPUT_DIR : {goc}")
    if not goc.is_dir():
        print("Không có thư mục — không phải dọn gì.")
        return 0
    if not storage.is_configured():
        print("Storage CHƯA cấu hình — bản local là kho lưu duy nhất. Dừng, không xoá gì.")
        return 1

    # Hai bảng tra. `input_path` là đường chính xác nhất, NHƯNG nó có thể trỏ vào
    # DATA_DIR cũ (đã từng trỏ nhầm sang một dự án khác — xem .playbook). Nên đối
    # chiếu thêm theo TÊN FILE. Việc này an toàn vì chốt thật không phải là khớp
    # đường dẫn mà là **tải lại từ Storage rồi so kích thước** ở dưới.
    theo_local: dict[str, dict] = {}
    theo_ten: dict[str, dict] = {}
    for did, row in (docs.all_rows() or {}).items():
        r = {**row, "document_id": did}
        ip = (row.get("input_path") or "").strip()
        if ip:
            theo_local[str(Path(ip).resolve())] = r
            theo_ten.setdefault(Path(ip).name, r)
        ten = (row.get("filename") or "").strip()
        if ten:
            theo_ten.setdefault(ten, r)

    tong = xoa_duoc = giu = 0
    byte_thu = 0
    for f in sorted(goc.rglob("*")):
        if not f.is_file():
            continue
        tong += 1
        row = theo_local.get(str(f.resolve())) or theo_ten.get(f.name)
        ly_do = None
        if row is None:
            ly_do = "không có dòng documents nào khớp (đường dẫn lẫn tên)"
        else:
            tren_storage = (row.get("file_path") or "").strip()
            if not tren_storage or str(Path(tren_storage).resolve()) == str(f.resolve()):
                ly_do = "file_path trùng đường local — local đang là kho lưu"
            else:
                try:
                    data = storage.download(tren_storage)
                except Exception as exc:
                    ly_do = f"không tải lại được từ Storage: {str(exc)[:60]}"
                else:
                    if len(data) != f.stat().st_size:
                        ly_do = f"kích thước lệch (Storage {len(data)} vs local {f.stat().st_size})"

        if ly_do:
            giu += 1
            print(f"  GIỮ  {f.name}  — {ly_do}")
            continue

        xoa_duoc += 1
        byte_thu += f.stat().st_size
        if args.xoa:
            f.unlink()
            print(f"  XOÁ  {f.name}")
        else:
            print(f"  (sẽ xoá) {f.name}")

    print()
    print(f"tổng {tong} file | xoá được {xoa_duoc} ({byte_thu/1024/1024:.1f} MB) | giữ {giu}")
    if not args.xoa and xoa_duoc:
        print("Chạy lại với --xoa để thực sự xoá.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
