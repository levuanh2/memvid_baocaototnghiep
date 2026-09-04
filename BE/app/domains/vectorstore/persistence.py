"""Lưu bền và khôi phục index truy hồi — KHÔNG tự bật, KHÔNG tự dựng lại.

Vì sao cần: `INDEX_DIR` trên Render free nằm trên đĩa PHÙ DU. Dựng lại index xong thì
nó biến mất ở lần khởi động kế tiếp. `rebuild.py` giải quyết được "dựng từ Postgres",
nhưng dựng lại vài nghìn chunk mỗi lần instance restart là trả tiền API cho cùng một
việc lặp đi lặp lại. Module này thêm hai giai đoạn còn thiếu:

    E. LƯU BỀN    sau khi thăng cấp cục bộ → đẩy artifact lên kho object
    F. KHÔI PHỤC  lúc khởi động, nếu đĩa trống → kéo về, thẩm định, thăng cấp

KHÔNG CÓ THAO TÁC NGUYÊN TỬ NHIỀU OBJECT. Supabase Storage không có commit nhiều
object, cũng không có rename nguyên tử. Nên tính nguyên tử được dựng bằng tay:

    index/<slug>/<version>/index.faiss     ghi trước
    index/<slug>/<version>/index.json      ghi trước
    index/<slug>/<version>/manifest.json   ghi SAU CÙNG của một version
    index/<slug>/current.json              con trỏ, ghi SAU CÙNG của tất cả

`manifest.json` tồn tại là bằng chứng version ấy đã đủ file. `current.json` chỉ đổi
sau khi manifest đã ghi và đã đọc lại được. Nên một lần upload đứt giữa chừng để lại
một version mồ côi — vô hại, không ai trỏ tới — chứ không bao giờ để lại một
`current.json` trỏ vào artifact thiếu file.

Bản cũ trên kho KHÔNG bị xoá. Version cũ còn đó để lùi lại bằng tay.

Danh tính dùng LẠI `llm_factory.embedding_identity()` và `store.check_index_identity()`
— không dựng bộ kiểm thứ hai. Tải về mà lệch danh tính thì TỪ CHỐI, giữ nguyên index
cục bộ, không xoá gì trên kho, không tự dựng lại.

Mặc định TẮT (`INDEX_PERSISTENCE_ENABLED`). Thiếu cấu hình Supabase thì mọi đường ở
đây là no-op — ứng dụng phải khởi động được như chưa từng có module này.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.domains.vectorstore.rebuild import RebuildValidationError, thang_cap

# Bộ artifact CANONICAL — đúng thứ `FAISS.load_local` cần, cộng `index.json` là meta
# riêng của ứng dụng (BM25, ánh xạ chunk_id, danh tính không gian vector).
#
# `index.pkl` là BẮT BUỘC, không phải tuỳ chọn: thiếu nó thì `load_vectorstore()` trả
# None, truy hồi tụt xuống nhánh legacy, và lần ingest kế tiếp sẽ ĐÈ MẤT index. Một
# artifact thiếu `index.pkl` không phải "index kém đầy đủ", nó là một quả mìn.
#
# `chunks.sqlite` tuỳ chọn thật: `index.json` đã mang bản text inline.
FILE_BAT_BUOC = ("index.faiss", "index.pkl", "index.json")
FILE_TUY_CHON = ("chunks.sqlite",)

TEN_MANIFEST = "manifest.json"
TEN_CON_TRO = "current.json"
GOC_KHOA = "index"


class PersistenceError(RuntimeError):
    """Lưu bền hoặc khôi phục thất bại. Index cục bộ KHÔNG bị đụng tới."""


class PersistenceNotConfigured(PersistenceError):
    """Chưa bật, hoặc chưa có kho object. Không phải lỗi — là trạng thái."""


# ── Cấu hình ───────────────────────────────────────────────────────────────
def enabled() -> bool:
    """Mặc định TẮT. Bật rồi vẫn cần kho object cấu hình xong mới chạy."""
    return (os.getenv("INDEX_PERSISTENCE_ENABLED", "0") or "").strip().lower() in (
        "1", "true", "yes", "on")


def get_storage() -> Any:
    """Kho object mặc định: Supabase Storage đã có sẵn trong kho mã.

    KHÔNG dựng client Supabase thứ hai — `app/domains/documents/storage.py` đã có
    upload/download/exists, đọc credential từ env, và giữ khoá ngoài mọi thông báo lỗi.
    """
    from app.domains.documents import storage as _storage

    if not _storage.is_configured():
        raise PersistenceNotConfigured(
            "Kho object chưa cấu hình (thiếu SUPABASE_URL / SUPABASE_SECRET_KEY).")
    return _storage


# ── Danh tính và khoá từ xa ────────────────────────────────────────────────
def _an_toan(s: str) -> str:
    return "".join(c if (c.isalnum() or c in "._-") else "_" for c in str(s))[:120]


def identity_slug(danh_tinh: Optional[Dict[str, Any]] = None) -> str:
    """Tiền tố từ xa, TẤT ĐỊNH theo không gian vector.

    Hai không gian khác nhau nằm ở hai tiền tố khác nhau, nên không có cách nào một
    lần khôi phục lấy nhầm index của model khác — kể cả trước khi hàng rào danh tính
    kịp chạy. Đây là lớp phòng thủ THỨ HAI, không thay cho hàng rào ấy.

    CHỈ gồm provider + model + strategy, KHÔNG gồm số chiều hay version metadata. Lý
    do: lúc khôi phục chưa biết số chiều (phải tải index về mới biết), nên đưa nó vào
    slug thì hai bên tính ra hai tiền tố khác nhau và không bao giờ gặp được nhau. Số
    chiều là HỆ QUẢ của bộ ba kia, không phải một trục độc lập — và nó vẫn được kiểm
    lúc thẩm định, đối chiếu với cả metadata lẫn manifest.
    """
    if danh_tinh is None:
        from app.clients.llm_factory import embedding_identity

        danh_tinh = embedding_identity()
    return "__".join(_an_toan(danh_tinh.get(k) or "unknown") for k in (
        "embedding_provider", "embedding_model_name", "embedding_strategy"))


def khoa_con_tro(slug: str) -> str:
    return f"{GOC_KHOA}/{slug}/{TEN_CON_TRO}"


def khoa_version(slug: str, version: str, ten_file: str) -> str:
    return f"{GOC_KHOA}/{slug}/{version}/{ten_file}"


# ── Đọc artifact cục bộ ────────────────────────────────────────────────────
def _bam(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def doc_artifact(thu_muc: Path) -> Dict[str, bytes]:
    """Đọc bộ artifact từ một thư mục index. Thiếu file bắt buộc thì ném.

    KHÔNG đẩy `index.faiss` mà bỏ `index.json`: file thứ hai là thứ diễn giải file
    thứ nhất, thiếu nó thì vector không ánh xạ về chunk nào cả.
    """
    thu_muc = Path(thu_muc)
    ra: Dict[str, bytes] = {}
    thieu = [t for t in FILE_BAT_BUOC if not (thu_muc / t).exists()]
    if thieu:
        raise PersistenceError(f"thiếu file bắt buộc trong {thu_muc}: {thieu}")
    for ten in FILE_BAT_BUOC + FILE_TUY_CHON:
        p = thu_muc / ten
        if p.exists():
            ra[ten] = p.read_bytes()
    return ra


def _doc_meta(noi_dung: bytes) -> Dict[str, Any]:
    try:
        meta = json.loads(noi_dung.decode("utf-8"))
    except Exception as exc:
        raise PersistenceError(f"index.json không đọc được: {type(exc).__name__}") from None
    if not isinstance(meta, dict):
        raise PersistenceError("index.json không phải object")
    return meta


# ── E. Lưu bền ─────────────────────────────────────────────────────────────
def publish(thu_muc: Optional[Path] = None, *, storage: Any = None,
            slug: Optional[str] = None) -> Dict[str, Any]:
    """Đẩy artifact cục bộ lên kho rồi mới đổi con trỏ.

    Thứ tự KHÔNG được đổi: file → manifest → đọc lại kiểm → con trỏ. Đổi con trỏ
    trước là cách để một lần đứt mạng biến thành một con trỏ trỏ vào artifact thiếu
    file, và lần khôi phục sau đó sẽ mang về một index hỏng.
    """
    if storage is None:
        storage = get_storage()
    from app.domains.vectorstore import store as _store

    thu_muc = Path(thu_muc) if thu_muc is not None else Path(_store.INDEX_DIR)
    t0 = time.perf_counter()
    files = doc_artifact(thu_muc)
    meta = _doc_meta(files["index.json"])
    mm = meta.get("__meta__") or {}
    danh_tinh = {k: mm.get(k) for k in
                 ("embedding_provider", "embedding_model_name", "embedding_strategy")}
    dim = int(mm.get("embedding_dim") or 0)
    slug = slug or identity_slug(danh_tinh)

    tong = sum(len(v) for v in files.values())
    print(f"[index_persistence] upload started slug={slug} files={len(files)} "
          f"bytes={tong} provider={danh_tinh.get('embedding_provider')} "
          f"model={danh_tinh.get('embedding_model_name')} "
          f"strategy={danh_tinh.get('embedding_strategy')} dim={dim}", flush=True)

    manifest = {
        "version": "",
        "created_at": datetime.now().isoformat(),
        "identity": danh_tinh,
        "embedding_dim": dim,
        "num_chunks": mm.get("num_chunks"),
        "metadata_version": mm.get("version"),
        "files": [{"name": t, "size": len(files[t]), "sha256": _bam(files[t])}
                  for t in sorted(files)],
    }
    # Version mang dấu vân tay của NỘI DUNG: đẩy lại đúng bộ artifact ấy thì ra cùng
    # một version, không sinh rác mỗi lần chạy.
    van_tay = _bam(json.dumps(manifest["files"], sort_keys=True).encode())[:12]
    version = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{van_tay}"
    manifest["version"] = version

    for ten, data in files.items():
        storage.upload(khoa_version(slug, version, ten), data,
                       content_type="application/octet-stream")
    than_manifest = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
    storage.upload(khoa_version(slug, version, TEN_MANIFEST), than_manifest,
                   content_type="application/json")

    # Đọc LẠI trước khi đổi con trỏ. Upload trả 200 không có nghĩa là đọc lại được.
    kiem = storage.download(khoa_version(slug, version, TEN_MANIFEST))
    if _bam(kiem) != _bam(than_manifest):
        raise PersistenceError(
            f"manifest đọc lại khác manifest vừa ghi (version={version})")
    for f in manifest["files"]:
        if not storage.exists(khoa_version(slug, version, f["name"])):
            raise PersistenceError(
                f"artifact thiếu sau upload: {f['name']} (version={version})")

    con_tro = {"version": version, "updated_at": datetime.now().isoformat(),
               "identity": danh_tinh, "embedding_dim": dim}
    storage.upload(khoa_con_tro(slug),
                   json.dumps(con_tro, ensure_ascii=False, indent=2).encode("utf-8"),
                   content_type="application/json")

    giay = time.perf_counter() - t0
    print(f"[index_persistence] upload completed slug={slug} version={version} "
          f"bytes={tong} elapsed={giay:.2f}s", flush=True)
    return {"slug": slug, "version": version, "files": len(files), "bytes": tong,
            "elapsed_sec": round(giay, 2)}


# ── F. Khôi phục ───────────────────────────────────────────────────────────
def _tai_ve(storage: Any, slug: str, version: str, manifest: Dict[str, Any],
            dich: Path) -> None:
    """Tải từng file vào `dich`, kiểm sha256 từng cái.

    Kiểm băm chứ không chỉ kiểm kích thước: một lần tải đứt giữa chừng thường ra file
    NGẮN HƠN, nhưng một proxy trả trang lỗi có thể ra file dài đúng bằng thế.
    """
    if dich.exists():
        shutil.rmtree(dich)
    dich.mkdir(parents=True, exist_ok=True)
    for f in manifest.get("files") or []:
        ten = str(f.get("name") or "")
        if ten not in FILE_BAT_BUOC + FILE_TUY_CHON:
            raise RebuildValidationError(f"manifest có file lạ: {ten!r}")
        try:
            data = storage.download(khoa_version(slug, version, ten))
        except Exception as exc:
            # Kho ném gì là chuyện của kho (404, timeout, DNS…). Người gọi chỉ cần
            # biết "khôi phục hỏng" ở một kiểu bắt được, để đường khởi động không
            # phải đoán xem lỗi lạ nào đáng nuốt.
            raise PersistenceError(
                f"không tải được {ten} (version={version}): {type(exc).__name__}") from None
        if f.get("sha256") and _bam(data) != f["sha256"]:
            raise RebuildValidationError(f"{ten}: sha256 không khớp manifest")
        if f.get("size") is not None and len(data) != int(f["size"]):
            raise RebuildValidationError(
                f"{ten}: {len(data)} byte, manifest ghi {f['size']}")
        (dich / ten).write_bytes(data)
    thieu = [t for t in FILE_BAT_BUOC if not (dich / t).exists()]
    if thieu:
        raise RebuildValidationError(f"artifact tải về thiếu file bắt buộc: {thieu}")


def _tham_dinh_tai_ve(thu_muc: Path, manifest: Dict[str, Any]) -> None:
    """Artifact tải về là dữ liệu KHÔNG tin được cho tới khi mở ra xem.

    Dùng LẠI `store.check_index_identity` — không dựng bộ kiểm danh tính thứ hai, vì
    hai bộ kiểm nói khác nhau thì cái nào đúng cũng không cứu được.
    """
    import faiss

    from app.domains.vectorstore import store as _store

    meta = _doc_meta((thu_muc / "index.json").read_bytes())
    mm = meta.get("__meta__") or {}
    if str(mm.get("version") or "") not in ("1.1", "1.2"):
        raise RebuildValidationError(
            f"metadata version không hỗ trợ: {mm.get('version')!r}")

    try:
        idx = faiss.read_index(str(thu_muc / "index.faiss"))
    except Exception as exc:
        raise RebuildValidationError(
            f"index.faiss không mở được: {type(exc).__name__}") from None

    dim_meta = int(mm.get("embedding_dim") or 0)
    if dim_meta and idx.d != dim_meta:
        raise RebuildValidationError(
            f"index.faiss có {idx.d} chiều, metadata ghi {dim_meta}")
    dim_manifest = int(manifest.get("embedding_dim") or 0)
    if dim_manifest and idx.d != dim_manifest:
        raise RebuildValidationError(
            f"index.faiss có {idx.d} chiều, manifest ghi {dim_manifest}")

    lech = _store.check_index_identity(meta)
    if lech:
        raise RebuildValidationError(f"danh tính lệch cấu hình hiện tại ({lech})")

    _thu_nap_canonical(thu_muc, so_vector=idx.ntotal)


def _thu_nap_canonical(thu_muc: Path, *, so_vector: int) -> None:
    """NẠP THỬ bằng đúng loader production dùng, trước khi thăng cấp.

    `faiss.read_index` mở được `index.faiss` KHÔNG chứng minh artifact dùng được:
    `index.pkl` (docstore của LangChain) là một file riêng, và pickle hỏng chỉ lộ ra
    lúc `FAISS.load_local` giải mã nó. Bản đầu của hàm thẩm định dừng ở `read_index`,
    nên một `index.pkl` hỏng đi lọt qua, được thăng cấp, và chỉ hỏng về sau —
    `load_vectorstore()` trả None, truy hồi tụt xuống nhánh dự phòng, rồi lần ingest
    kế tiếp ĐÈ MẤT index. Test bắt được đúng ca này.

    Nạp thử ở thư mục STAGING, chưa thăng cấp — hỏng thì index đang phục vụ chưa bị
    đụng tới.
    """
    from langchain_community.vectorstores import FAISS

    from app.clients.llm_factory import get_embeddings

    try:
        vs = FAISS.load_local(str(thu_muc), get_embeddings(),
                              allow_dangerous_deserialization=True)
    except Exception as exc:
        raise RebuildValidationError(
            f"loader canonical không nạp được artifact: {type(exc).__name__}: "
            f"{str(exc)[:160]}") from None
    if vs.index.ntotal != so_vector:
        raise RebuildValidationError(
            f"loader canonical thấy {vs.index.ntotal} vector, index.faiss có {so_vector}")


def restore(*, thu_muc: Optional[Path] = None, storage: Any = None,
            slug: Optional[str] = None, ghi_de: bool = False) -> Dict[str, Any]:
    """Kéo artifact đang hoạt động về và thăng cấp thành index cục bộ.

    `ghi_de=False` (mặc định): đã có index cục bộ thì KHÔNG đụng tới. Index trên đĩa
    là thứ đang phục vụ; thay nó bằng một bản tải về chỉ vì kho có bản khác là quyết
    định của người vận hành, không phải của một hàm khởi động.
    """
    from app.domains.vectorstore import store as _store

    active = Path(thu_muc) if thu_muc is not None else Path(_store.INDEX_DIR)
    if not ghi_de and all((active / t).exists() for t in FILE_BAT_BUOC):
        return {"restored": False, "ly_do": "đã có index cục bộ hợp lệ"}

    if storage is None:
        storage = get_storage()
    slug = slug or identity_slug()
    t0 = time.perf_counter()
    print(f"[index_persistence] restore started slug={slug}", flush=True)

    try:
        than = storage.download(khoa_con_tro(slug))
    except Exception as exc:
        raise PersistenceError(
            f"không đọc được con trỏ {khoa_con_tro(slug)}: {type(exc).__name__}") from None
    try:
        con_tro = json.loads(than.decode("utf-8"))
        version = str(con_tro["version"])
    except Exception:
        raise PersistenceError(f"con trỏ hỏng: {than[:120]!r}") from None

    try:
        manifest = json.loads(
            storage.download(khoa_version(slug, version, TEN_MANIFEST)).decode("utf-8"))
    except Exception as exc:
        raise PersistenceError(
            f"không đọc được manifest version={version}: {type(exc).__name__}") from None
    if not isinstance(manifest, dict) or not manifest.get("files"):
        raise RebuildValidationError(f"manifest thiếu `files` (version={version})")

    staging = active.parent / f"{active.name}_restore"
    try:
        _tai_ve(storage, slug, version, manifest, staging)
        _tham_dinh_tai_ve(staging, manifest)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    backup = thang_cap(staging, active, keep=3)
    giay = time.perf_counter() - t0
    print(f"[index_persistence] restore completed slug={slug} version={version} "
          f"files={len(manifest['files'])} elapsed={giay:.2f}s", flush=True)
    return {"restored": True, "slug": slug, "version": version,
            "files": len(manifest["files"]), "backup": str(backup) if backup else None,
            "elapsed_sec": round(giay, 2)}


def restore_luc_khoi_dong() -> Dict[str, Any]:
    """Gọi ở startup. KHÔNG BAO GIỜ ném — thiếu kho không được làm app chết.

    Production hôm nay không có `SUPABASE_URL`/`SUPABASE_SECRET_KEY`, nên đường này
    phải im lặng bỏ qua chứ không phải bắt người ta cấu hình Supabase mới boot được.
    """
    if not enabled():
        print("[index_persistence] restore skipped: not enabled", flush=True)
        return {"restored": False, "ly_do": "INDEX_PERSISTENCE_ENABLED chưa bật"}
    try:
        ra = restore()
    except PersistenceNotConfigured as exc:
        print(f"[index_persistence] restore skipped: not configured ({exc})", flush=True)
        return {"restored": False, "ly_do": str(exc)}
    except RebuildValidationError as exc:
        print(f"[index_persistence] restore rejected: {exc}", flush=True)
        return {"restored": False, "ly_do": f"từ chối: {exc}"}
    except Exception as exc:
        print(f"[index_persistence] restore failed: {type(exc).__name__}: "
              f"{str(exc)[:200]}", flush=True)
        return {"restored": False, "ly_do": f"lỗi: {type(exc).__name__}"}
    if not ra.get("restored"):
        print(f"[index_persistence] restore skipped: {ra.get('ly_do')}", flush=True)
    return ra


def publish_sau_rebuild(thu_muc: Optional[Path] = None) -> Dict[str, Any]:
    """Bước cuối TUỲ CHỌN của rebuild. Tắt hoặc chưa cấu hình thì no-op, không ném.

    Dựng lại index thành công rồi mà upload hỏng thì index cục bộ vẫn dùng được —
    không được biến một lỗi mạng thành một lượt rebuild thất bại.
    """
    if not enabled():
        return {"published": False, "ly_do": "INDEX_PERSISTENCE_ENABLED chưa bật"}
    try:
        ra = publish(thu_muc)
    except PersistenceNotConfigured as exc:
        print(f"[index_persistence] upload skipped: not configured ({exc})", flush=True)
        return {"published": False, "ly_do": str(exc)}
    except Exception as exc:
        print(f"[index_persistence] upload failed: {type(exc).__name__}: "
              f"{str(exc)[:200]}", flush=True)
        return {"published": False, "ly_do": f"lỗi: {type(exc).__name__}"}
    return {"published": True, **ra}
