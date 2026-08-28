"""Neo BE_ROOT theo vị trí file, không theo thư mục làm việc.

Vấn đề gốc: nhiều module tính đường dẫn mặc định bằng `Path(__file__).parent`. File chui
sâu vào `app/domains/...` là mặc định lệch. `BE_ROOT` luôn đúng vì file này luôn nằm ở
`BE/shared/paths.py`.

Từng có `default_data_dir()` ở đây, xoá 2026-08-28: 0 caller. Ba module tự viết lại
`Path(os.environ.get("DATA_DIR", str(BE_ROOT)))` tại chỗ (`cache/llm_cache.py:180`,
`conversation/store.py:31`, `jobs/jobs_store.py:21`) thay vì gọi helper. Muốn gom về một
chỗ thì phải sửa cả ba, không phải để lại một hàm không ai gọi.
"""

from __future__ import annotations

from pathlib import Path

# shared/paths.py -> parent = BE/shared, parent.parent = BE
BE_ROOT = Path(__file__).resolve().parent.parent


