"""Supabase Storage — nơi lưu file tài liệu gốc.

Dùng REST API trực tiếp qua `requests` (đã là dependency) thay vì thêm SDK:
4 thao tác đơn giản, không đáng thêm một dep nữa.

Bucket để PRIVATE. Frontend không bao giờ nhận storage path thô (NFR-04.3) — chỉ
nhận signed URL do Flask ký bằng SUPABASE_SECRET_KEY, hết hạn sau `ttl` giây.

Path quy ước: `{user_id}/{document_id}/{filename}` — tách quyền theo user ngay ở
cấu trúc thư mục, dễ rà soát bằng mắt trên dashboard.
"""

from __future__ import annotations

import contextlib
import mimetypes
import os
from pathlib import PurePosixPath
from typing import Optional

import requests

DEFAULT_TIMEOUT = 60


class StorageNotConfigured(RuntimeError):
    """Thiếu SUPABASE_URL / SUPABASE_SECRET_KEY."""


class StorageError(RuntimeError):
    """Supabase Storage trả lỗi."""


def _base_url() -> str:
    url = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    if not url:
        raise StorageNotConfigured("SUPABASE_URL chưa được đặt.")
    return url + "/storage/v1"


def _secret() -> str:
    key = (os.getenv("SUPABASE_SECRET_KEY") or "").strip()
    if not key:
        raise StorageNotConfigured("SUPABASE_SECRET_KEY chưa được đặt.")
    return key


def bucket() -> str:
    return (os.getenv("SUPABASE_STORAGE_BUCKET") or "documents").strip() or "documents"


def is_configured() -> bool:
    return bool((os.getenv("SUPABASE_URL") or "").strip()
                and (os.getenv("SUPABASE_SECRET_KEY") or "").strip())


def _headers(extra: Optional[dict] = None) -> dict:
    k = _secret()
    h = {"Authorization": f"Bearer {k}", "apikey": k}
    if extra:
        h.update(extra)
    return h


def _raise(resp: requests.Response, what: str) -> None:
    # Không log body của response lỗi kèm header — tránh lộ token trong log.
    raise StorageError(f"{what} thất bại: HTTP {resp.status_code} {resp.text[:200]}")


_SAFE_KEY_CHARS = set(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
)


def _safe_key_part(name: str) -> str:
    """Supabase từ chối key có khoảng trắng, ngoặc, dấu tiếng Việt (InvalidKey).

    Bỏ dấu về ASCII rồi fold mọi ký tự lạ thành '_'. Tên hiển thị vẫn giữ nguyên
    trong `documents.title`; đây chỉ là khoá lưu trữ.
    """
    import unicodedata
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    out = "".join(ch if ch in _SAFE_KEY_CHARS else "_" for ch in ascii_name).strip("._-")
    return out or "file"


def object_path(user_id: str, document_id: str, filename: str) -> str:
    """Path trong bucket. Chỉ lấy basename để chặn path traversal."""
    name = PurePosixPath(str(filename).replace("\\", "/")).name or "file"
    return f"{_safe_key_part(str(user_id))}/{_safe_key_part(str(document_id))}/{_safe_key_part(name)}"


def ensure_bucket() -> None:
    """Tạo bucket private nếu chưa có. Idempotent."""
    name = bucket()
    r = requests.get(f"{_base_url()}/bucket/{name}", headers=_headers(), timeout=DEFAULT_TIMEOUT)
    if r.status_code == 200:
        return
    r = requests.post(
        f"{_base_url()}/bucket",
        headers=_headers({"Content-Type": "application/json"}),
        json={"id": name, "name": name, "public": False},
        timeout=DEFAULT_TIMEOUT,
    )
    if r.status_code not in (200, 201, 409):
        _raise(r, "tạo bucket")


def upload(path: str, data: bytes, *, content_type: Optional[str] = None,
           upsert: bool = True) -> str:
    """Đẩy bytes lên bucket, trả về storage path đã lưu."""
    ct = content_type or mimetypes.guess_type(path)[0] or "application/octet-stream"
    r = requests.post(
        f"{_base_url()}/object/{bucket()}/{path}",
        headers=_headers({"Content-Type": ct, "x-upsert": "true" if upsert else "false"}),
        data=data,
        timeout=DEFAULT_TIMEOUT,
    )
    if r.status_code not in (200, 201):
        _raise(r, "upload")
    return path


def download(path: str) -> bytes:
    r = requests.get(
        f"{_base_url()}/object/{bucket()}/{path}",
        headers=_headers(),
        timeout=DEFAULT_TIMEOUT,
    )
    if r.status_code != 200:
        _raise(r, "download")
    return r.content


@contextlib.contextmanager
def fetch_to_temp(path: str, *, suffix: str = ""):
    """Kéo file từ bucket về một đường dẫn TẠM, dọn sạch khi ra khỏi khối `with`.

    Đây là lưới an toàn cho việc bỏ lưu bản gốc dưới local: pipeline nào cần đọc
    lại file (ingest lại, trích xuất lại bằng bộ đọc mới) thì lấy từ Storage thay
    vì trông chờ `input_docs/`.

        with storage.fetch_to_temp(row["file_path"], suffix=".pdf") as p:
            docs = load_document(p)

    Dọn trong `finally` nên hỏng giữa chừng cũng không để lại rác. Xoá được hay
    không đều không ném — file tạm sót lại là phiền, không phải lỗi.
    """
    import tempfile

    data = download(path)
    fd, tmp = tempfile.mkstemp(suffix=suffix or os.path.splitext(path)[1])
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        yield tmp
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def signed_url(path: str, ttl: int = 3600) -> str:
    """URL tạm để FE mở file gốc. KHÔNG bao giờ trả storage path thô ra API."""
    r = requests.post(
        f"{_base_url()}/object/sign/{bucket()}/{path}",
        headers=_headers({"Content-Type": "application/json"}),
        json={"expiresIn": int(ttl)},
        timeout=DEFAULT_TIMEOUT,
    )
    if r.status_code != 200:
        _raise(r, "ký URL")
    signed = (r.json() or {}).get("signedURL") or ""
    if not signed:
        raise StorageError("Supabase không trả signedURL")
    return _base_url().rsplit("/storage/v1", 1)[0] + "/storage/v1" + signed


def delete(path: str) -> bool:
    """Xoá object. Trả False khi không xoá được (best-effort, không ném)."""
    try:
        r = requests.delete(
            f"{_base_url()}/object/{bucket()}/{path}",
            headers=_headers(),
            timeout=DEFAULT_TIMEOUT,
        )
        return r.status_code in (200, 204, 404)
    except Exception:
        return False
