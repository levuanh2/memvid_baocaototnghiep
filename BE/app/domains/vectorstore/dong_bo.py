"""Đồng bộ index giữa NHIỀU tiến trình: web đọc, worker ghi.

Hai lỗ hổng lộ ra khi tách ingest sang worker riêng (phase 2026-09-05), cả hai đều
KHÔNG tồn tại ở chế độ một tiến trình:

**1. Index của web ôi đi mà không có lỗi nào.** `store._VS_CACHE` khoá theo
`mtime+size` của `index.faiss` trên đĩa CỤC BỘ. Worker ở container khác ghi trên đĩa
của nó rồi publish lên Supabase; đĩa của web không đổi ⇒ khoá cache không đổi ⇒ web
tiếp tục phục vụ bản cũ. `restore_luc_khoi_dong()` chỉ chạy lúc khởi động. Tài liệu vừa
ingest xong đơn giản là không tìm thấy, và không một dòng log nào nói có gì sai.

**2. Hai worker ghi đè nhau.** `_KHOA_INDEX` là `threading.Lock` — chỉ có nghĩa trong
MỘT tiến trình. Hai worker cùng đọc V1, mỗi bên append phần của mình rồi publish; con
trỏ cuối cùng chỉ giữ được một bên, bên kia mất vector nhưng `document_chunks` vẫn trỏ
vào những `embedding_id` không còn tồn tại.

Nguồn sự thật KHÔNG đổi: `index/<slug>/current.json` trên kho object. Ở đây chỉ thêm
một chỗ NHỚ xem tiến trình này đang cầm version nào (`.phien_ban` trong thư mục index)
và một khoá ghi dùng chung qua Redis — đúng cái Redis mà RQ đã cần.

Không bật gì thì không đổi gì: chưa bật persistence → mọi hàm ở đây là no-op; không có
`REDIS_URL` → khoá phân tán là no-op và `threading.Lock` ở chỗ gọi vẫn là bảo vệ duy
nhất (đúng và đủ cho một tiến trình, tức `QUEUE_ENABLED=false`).
"""

from __future__ import annotations

import json
import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Optional

TEN_PHIEN_BAN = ".phien_ban"

# Trạng thái TRONG TIẾN TRÌNH: lần cuối hỏi kho là bao giờ. Chỉ để khỏi hỏi lại quá dày;
# không phải nguồn sự thật, mất đi thì cùng lắm hỏi thừa một lần.
_lan_kiem_cuoi: dict = {"t": 0.0}
_khoa_kiem = threading.Lock()


class KhongLayDuocKhoa(RuntimeError):
    """Tiến trình khác đang ghi index. Thử lại được — KHÔNG phải hỏng dữ liệu."""


def _so(ten: str, mac_dinh: float) -> float:
    try:
        return float((os.getenv(ten) or "").strip() or mac_dinh)
    except ValueError:
        return mac_dinh


def ttl_kiem() -> float:
    """Bao lâu mới hỏi kho một lần ở đường ĐỌC. 0 = hỏi mỗi lần (chỉ dùng cho test)."""
    return _so("INDEX_SYNC_TTL_SEC", 60.0)


# ── Version đang cầm ──────────────────────────────────────────────────────
def _duong_dan_moc(thu_muc: Optional[Path] = None) -> Path:
    from app.domains.vectorstore import store as _store

    return Path(thu_muc or _store.INDEX_DIR) / TEN_PHIEN_BAN


def phien_ban_cuc_bo(thu_muc: Optional[Path] = None) -> Optional[str]:
    """Version của bộ artifact đang nằm trên đĩa, hoặc None nếu không biết.

    Không biết KHÁC với cũ: không biết thì lần đồng bộ đầu sẽ kéo về một lần cho chắc,
    còn hơn đoán rồi phục vụ nhầm bản.
    """
    try:
        ra = json.loads(_duong_dan_moc(thu_muc).read_text(encoding="utf-8"))
        v = str(ra.get("version") or "").strip()
        return v or None
    except Exception:
        return None


def ghi_phien_ban_cuc_bo(version: str, thu_muc: Optional[Path] = None) -> None:
    """Đánh dấu đĩa đang cầm version nào. Ghi SAU khi thăng cấp/publish xong.

    Mốc nằm TRONG thư mục index nên nó đi theo đúng bộ artifact ấy: `thang_cap` đổi tên
    cả thư mục, thay index là thay luôn mốc — không có cửa sổ nào mốc nói một đằng mà
    file nằm một nẻo. Ghi hỏng thì thôi (mất mốc = hỏi lại kho, không phải hỏng dữ liệu).
    """
    try:
        p = _duong_dan_moc(thu_muc)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"version": str(version),
                                 "ghi_luc": time.time()}), encoding="utf-8")
    except Exception:
        pass


def phien_ban_tu_xa(*, storage: Any = None, slug: Optional[str] = None) -> Optional[str]:
    """Version đang hoạt động theo kho. Chỉ tải `current.json` — vài trăm byte.

    Đây là phép kiểm RẺ, cố ý tách khỏi việc tải index: hỏi mỗi phút một lần thì tốn
    một request nhỏ, còn tải cả index mỗi query thì không ai chịu nổi.
    """
    from app.domains.vectorstore import persistence as _ps

    kho = storage if storage is not None else _ps.get_storage()
    slug = slug or _ps.identity_slug()
    than = kho.download(_ps.khoa_con_tro(slug))
    con_tro = json.loads(than.decode("utf-8"))
    v = str(con_tro.get("version") or "").strip()
    return v or None


# ── Đồng bộ ───────────────────────────────────────────────────────────────
def dong_bo(*, bat_buoc: bool = False, storage: Any = None,
            slug: Optional[str] = None) -> Dict[str, Any]:
    """Kéo bản mới nhất về NẾU kho có version khác cái đang cầm.

    `bat_buoc=False` (đường đọc): bỏ qua nếu vừa hỏi trong `INDEX_SYNC_TTL_SEC` giây.
    `bat_buoc=True` (đường ghi): luôn hỏi — worker PHẢI cầm bản mới nhất trước khi
    append, nếu không nó publish đè mất phần của worker kia.

    Hỏng thì GIỮ NGUYÊN index cục bộ đang chạy. Kho hỏng, mạng đứt, artifact từ xa
    không hợp lệ — không cái nào được phép biến thành truy hồi chết. `restore` thẩm định
    trong thư mục staging rồi mới thăng cấp, nên một bản từ xa hỏng không bao giờ chạm
    tới bản đang phục vụ.
    """
    from app.domains.vectorstore import persistence as _ps

    if not _ps.enabled():
        return {"da_dong_bo": False, "ly_do": "INDEX_PERSISTENCE_ENABLED chưa bật"}

    if not bat_buoc:
        ttl = ttl_kiem()
        with _khoa_kiem:
            if ttl > 0 and (time.time() - _lan_kiem_cuoi["t"]) < ttl:
                return {"da_dong_bo": False, "ly_do": "còn trong TTL"}
            _lan_kiem_cuoi["t"] = time.time()

    try:
        xa = phien_ban_tu_xa(storage=storage, slug=slug)
    except Exception as exc:  # noqa: BLE001
        # Kho không hỏi được KHÔNG được làm hỏng truy hồi. Bản cục bộ vẫn hợp lệ.
        print(f"[index_sync] không đọc được con trỏ: {type(exc).__name__}", flush=True)
        return {"da_dong_bo": False, "ly_do": f"lỗi đọc con trỏ: {type(exc).__name__}"}

    cb = phien_ban_cuc_bo()
    if xa is None or xa == cb:
        return {"da_dong_bo": False, "ly_do": "đã là bản mới nhất", "version": cb}

    try:
        ra = _ps.restore(storage=storage, slug=slug, ghi_de=True)
    except Exception as exc:  # noqa: BLE001
        # Gồm cả `RebuildValidationError`: bản từ xa không hợp lệ hoặc lệch danh tính.
        # KHÔNG đụng bản đang chạy — thà phục vụ bản cũ còn hơn không phục vụ được.
        print(f"[index_sync] khôi phục {xa} thất bại, giữ bản {cb}: "
              f"{type(exc).__name__}: {str(exc)[:200]}", flush=True)
        return {"da_dong_bo": False, "ly_do": f"khôi phục hỏng: {type(exc).__name__}",
                "version": cb, "version_tu_xa": xa}

    ghi_phien_ban_cuc_bo(xa)
    xoa_cache()
    print(f"[index_sync] đã nạp version {xa} (trước đó: {cb})", flush=True)
    return {"da_dong_bo": True, "version": xa, "version_cu": cb, **ra}


class KhongDongBoDuoc(RuntimeError):
    """Không xác nhận được rằng đĩa đang cầm bản mới nhất. Thử lại được."""


def dong_bo_truoc_khi_ghi(*, storage: Any = None, slug: Optional[str] = None) -> Dict[str, Any]:
    """Đường GHI: hoặc chắc chắn đang cầm bản mới nhất, hoặc NÉM.

    Khác `dong_bo` ở đúng một điểm, và điểm ấy là cả lý do hàm này tồn tại: đường ĐỌC
    hỏng thì phục vụ bản cũ (mất tính mới), đường GHI hỏng mà vẫn đi tiếp thì append
    lên bản cũ rồi publish đè — **xoá vector của lượt ingest khác**. Mất dữ liệu tệ hơn
    nhiều so với một lượt upload phải làm lại.

    Chưa có con trỏ trên kho = chưa ai publish bao giờ (cài mới). Đó KHÔNG phải lỗi:
    lượt ingest này sẽ là bản đầu tiên. Phân biệt bằng `exists()` chứ không bằng cách
    đoán mã lỗi của `download()` — timeout và 404 không được lẫn vào nhau ở đây.
    """
    from app.domains.vectorstore import persistence as _ps

    if not _ps.enabled():
        return {"da_dong_bo": False, "ly_do": "INDEX_PERSISTENCE_ENABLED chưa bật"}

    try:
        kho = storage if storage is not None else _ps.get_storage()
        ten_slug = slug or _ps.identity_slug()
        co_con_tro = bool(kho.exists(_ps.khoa_con_tro(ten_slug)))
    except _ps.PersistenceNotConfigured:
        # Bật persistence mà thiếu credential là CẤU HÌNH SAI, và `cong_bo_sau_ingest`
        # ở cuối đoạn tới hạn đã nói đúng câu đó rồi. Chặn sớm ở đây chỉ đổi thông điệp
        # thành một câu mơ hồ hơn ("thử lại đi") cho một lỗi thử lại không chữa được.
        return {"da_dong_bo": False, "ly_do": "kho object chưa cấu hình"}
    except Exception as exc:  # noqa: BLE001
        raise KhongDongBoDuoc(
            f"không hỏi được kho trước khi ghi index: {type(exc).__name__}") from None

    if not co_con_tro:
        return {"da_dong_bo": False, "ly_do": "kho chưa có bản nào — lượt này là bản đầu"}

    ra = dong_bo(bat_buoc=True, storage=kho, slug=ten_slug)
    if ra.get("da_dong_bo"):
        return ra
    if ra.get("ly_do") == "đã là bản mới nhất":
        return ra
    raise KhongDongBoDuoc(
        f"không kéo được bản mới nhất về trước khi ghi: {ra.get('ly_do')}")


def xoa_cache() -> None:
    """Vô hiệu cache vectorstore của tiến trình này.

    `_VS_CACHE` khoá theo mtime+size nên thay file trên đĩa thường đã đủ để nó tự hết
    hạn. "Thường" là chưa đủ: `thang_cap` đổi tên thư mục, và một bản tải về có thể ra
    đúng kích thước với mtime trùng ở độ phân giải xấu. Xoá thẳng thì không phải cược.
    """
    try:
        from app.domains.vectorstore import store as _store

        _store._VS_CACHE["key"] = None
        _store._VS_CACHE["vs"] = None
    except Exception:
        pass


def dat_lai_nhip_kiem() -> None:
    """Quên lần hỏi cuối. Dùng cho test và cho lượt đồng bộ ngay sau khi publish."""
    with _khoa_kiem:
        _lan_kiem_cuoi["t"] = 0.0


# ── Khoá ghi dùng chung giữa các tiến trình ───────────────────────────────
def _redis_url() -> str:
    return (os.getenv("REDIS_URL") or "").strip()


def khoa_phan_tan_kha_dung() -> bool:
    """Chỉ bật khoá phân tán ở chế độ THẬT SỰ nhiều tiến trình.

    Điều kiện là `QUEUE_ENABLED` **và** `REDIS_URL`, không phải chỉ `REDIS_URL`. Lý do
    cụ thể, đã va phải: `BE/.env` của máy dev có sẵn `REDIS_URL` cho cache ngữ nghĩa.
    Nếu chỉ nhìn biến ấy thì mọi lượt ingest trên máy dev và trong test đều đòi kết nối
    Redis, và không có Redis là ingest chết — 10 test đỏ ngay lần chạy đầu.

    Ngoài ra điều kiện này ĐÚNG về bản chất: rủi ro hai tiến trình cùng ghi chỉ tồn tại
    khi có worker RQ, tức khi `QUEUE_ENABLED=true`. Tắt queue thì chỉ một tiến trình
    ingest, và `threading.Lock` ở chỗ gọi là bảo vệ đủ và đúng.
    """
    from app.jobs.queue import queue_enabled

    return bool(_redis_url()) and queue_enabled()


def ten_khoa(slug: Optional[str] = None) -> str:
    """Mỗi không gian vector một khoá riêng: index của hai model khác nhau là hai file
    khác nhau, chặn lẫn nhau chỉ tổ làm chậm mà không bảo vệ gì thêm."""
    from app.domains.vectorstore import persistence as _ps

    try:
        return f"studymap:index:ghi:{slug or _ps.identity_slug()}"
    except Exception:
        return "studymap:index:ghi:unknown"


@contextmanager
def khoa_ghi_index(*, slug: Optional[str] = None, cho_giay: Optional[float] = None,
                   han_giay: Optional[float] = None):
    """Chỉ MỘT tiến trình được ở trong đoạn sửa index tại một thời điểm.

    Không có `REDIS_URL` → no-op có chủ đích. Ở cấu hình một tiến trình
    (`QUEUE_ENABLED=false`) thì `threading.Lock` ở chỗ gọi đã đủ và đúng; dựng thêm một
    hàng rào giả ở đây chỉ để "trông an toàn" là tệ hơn không có.

    Có `REDIS_URL` → khoá thật, có HẠN. Hạn là bắt buộc: một worker bị OOM giết giữa
    lúc giữ khoá mà khoá không tự hết hạn thì mọi lượt ingest sau đứng vĩnh viễn — đúng
    kiểu hỏng mà phase này đang đi dọn, chỉ đổi chỗ.

    Chờ quá `cho_giay` mà không lấy được → ném `KhongLayDuocKhoa`. Người gọi phải để
    lượt ingest thất bại rõ ràng, KHÔNG được đi tiếp: đi tiếp là ghi đè đúng thứ khoá
    này sinh ra để bảo vệ.
    """
    if not khoa_phan_tan_kha_dung():
        yield {"che_do": "trong-tien-trinh", "ly_do": "không có REDIS_URL"}
        return

    cho = cho_giay if cho_giay is not None else _so("INDEX_LOCK_WAIT_SEC", 30.0)
    han = han_giay if han_giay is not None else _so("INDEX_LOCK_TIMEOUT_SEC", 900.0)
    ten = ten_khoa(slug)

    # `acquire()` phải nằm TRONG try cùng với `from_url`: redis-py chỉ mở kết nối ở
    # lệnh đầu tiên, nên lỗi mạng rơi vào `acquire`, không rơi vào `from_url`. Để nó ra
    # ngoài là ngoại lệ thô lọt lên node và mất ngữ nghĩa "thử lại được".
    try:
        import redis as _redis

        conn = _redis.from_url(_redis_url())
        khoa = conn.lock(ten, timeout=han, blocking_timeout=cho)
        lay_duoc = bool(khoa.acquire())
    except Exception as exc:  # noqa: BLE001
        # Redis hỏng ở chế độ nhiều tiến trình = KHÔNG có gì bảo vệ index. Từ chối ghi
        # là lựa chọn duy nhất trung thực; chạy tiếp là cược vào việc worker kia đang rảnh.
        raise KhongLayDuocKhoa(
            f"không lấy được khoá ghi index: {type(exc).__name__}") from None

    if not lay_duoc:
        raise KhongLayDuocKhoa(
            f"tiến trình khác đang ghi index (chờ {cho:g}s không tới lượt)")
    try:
        yield {"che_do": "phan-tan", "ten": ten, "han_giay": han}
    finally:
        try:
            khoa.release()
        except Exception:
            # Hết hạn trước khi xong thì `release` ném. Không có gì để cứu ở đây, và
            # nuốt là đúng: ngoại lệ thật của thân `with` không được bị thay bằng nó.
            pass
