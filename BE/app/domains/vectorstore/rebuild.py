"""Dựng lại index truy hồi TỪ PostgreSQL — vòng đời an toàn, KHÔNG tự chạy.

Vì sao module này tồn tại: `document_chunks.text` trong Postgres là bản duy nhất của
ngữ liệu còn sống qua một lần restart. `INDEX_DIR` trên Render free nằm trên đĩa phù
du — index biến mất mỗi lần instance khởi động lại. Nên "dựng lại index" không phải
một thao tác cứu hộ hiếm gặp, nó là điều kiện để truy hồi tồn tại ở đó.

Bốn giai đoạn TÁCH BẠCH, đúng như tên gọi, vì trộn chúng lại là cách làm hỏng dữ liệu:

  A. SINH      — đọc chunk, gọi embedding, dựng vector
  B. GHI TẠM   — ghi vào thư mục staging, KHÔNG chạm index đang phục vụ
  C. THẨM ĐỊNH — đọc lại staging, so số chiều, số vector, danh tính
  D. THĂNG CẤP — chỉ khi (C) sạch: chuyển staging thành active, giữ bản cũ làm backup

Không bao giờ: xoá index hiện tại trước khi dựng xong; ghi đè một phần; trộn hai không
gian vector; tự chạy chỉ vì FPT embedding đã được cấu hình.

Đây là THƯ VIỆN. Không route nào gọi, không tiến trình khởi động nào gọi. Muốn chạy
thì gọi tường minh — `scripts/rebuild_index_tu_postgres.py`.

MỘT ĐIỀU PHẢI BIẾT TRƯỚC KHI DÙNG Ở PRODUCTION: `document_chunks.embedding_id` là cầu
nối giữa id FAISS và khoá nghiệp vụ; `semantic_search` tra ngược qua nó. Chunk chưa
từng được index có `embedding_id = NULL` (đúng tình trạng production hôm nay, vì
`SKIP_MODEL_LOAD=1` bỏ qua đường ghi index). Nên dựng lại index BẮT BUỘC kèm một lượt
ghi `embedding_id` xuống Postgres, nếu không thì index có vector mà không ai tra ngược
được. Lượt ghi đó chạy SAU khi thăng cấp thành công, và là thao tác ghi DB duy nhất
của module này — nó cập nhật một cột, không xoá gì.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple


class RebuildError(RuntimeError):
    """Dựng lại thất bại. Index đang phục vụ KHÔNG bị đụng tới."""


class RebuildValidationError(RebuildError):
    """Staging dựng xong nhưng không qua thẩm định — không thăng cấp."""


# ── A. Đọc ngữ liệu ────────────────────────────────────────────────────────
def doc_chunks_tu_db(
    *,
    liet_ke_tai_lieu: Optional[Callable[[], Dict[str, Dict[str, Any]]]] = None,
    liet_ke_chunk: Optional[Callable[..., List[Dict[str, Any]]]] = None,
    trang: int = 500,
) -> List[Dict[str, Any]]:
    """Trả về [{chunk_id, document_id, source_stem, text}] theo thứ tự tất định.

    Thứ tự phải tất định vì id FAISS được gán theo vị trí trong danh sách này: dựng
    lại hai lần trên cùng dữ liệu phải cho cùng ánh xạ, nếu không thì `embedding_id`
    đã ghi xuống DB ở lần trước trỏ sai chỗ.

    Hai callable được tiêm để test không cần Postgres — và cũng để module này không
    phụ thuộc cứng vào tầng repository.
    """
    if liet_ke_tai_lieu is None or liet_ke_chunk is None:
        from app.domains.documents import repository as _docs

        liet_ke_tai_lieu = liet_ke_tai_lieu or (lambda: _docs.all_rows(use_cache=False))
        liet_ke_chunk = liet_ke_chunk or _docs.list_chunks

    ra: List[Dict[str, Any]] = []
    rows = liet_ke_tai_lieu() or {}
    for did in sorted(rows):
        row = rows[did] or {}
        if str(row.get("status") or "").lower() == "deleted":
            continue
        stem = row.get("source_stem") or ""
        offset = 0
        while True:
            lo = liet_ke_chunk(did, limit=trang, offset=offset) or []
            for c in lo:
                text = (c.get("text") or "").strip()
                if not text:
                    # CHECK của Postgres đã cấm text rỗng; tới đây mà rỗng nghĩa là
                    # dữ liệu đã hỏng ở tầng dưới. Bỏ qua thì index thiếu chunk mà
                    # không ai biết.
                    raise RebuildError(
                        f"chunk {c.get('chunk_id')} của tài liệu {did} có text rỗng")
                ra.append({"chunk_id": str(c.get("chunk_id")), "document_id": str(did),
                           "source_stem": str(stem), "text": text})
            if len(lo) < trang:
                break
            offset += trang
    return ra


# ── A. Sinh vector ─────────────────────────────────────────────────────────
def sinh_vector(
    texts: Sequence[str],
    *,
    embed: Optional[Callable[[List[str]], List[List[float]]]] = None,
    batch_size: int = 64,
    tien_do: Optional[Callable[[int, int], None]] = None,
) -> List[List[float]]:
    """Embed theo lô. Ném nếu số vector trả về không khớp số văn bản gửi đi.

    Kiểm số lượng ở TỪNG LÔ chứ không chỉ ở cuối: lô thứ ba trả thiếu một vector mà
    lô sau trả thừa một thì tổng vẫn khớp, còn ánh xạ chunk↔vector thì lệch hẳn.
    """
    if embed is None:
        from app.clients.llm_factory import get_embeddings

        embed = get_embeddings().embed_documents

    ra: List[List[float]] = []
    tong = len(texts)
    for i in range(0, tong, max(1, batch_size)):
        lo = list(texts[i:i + max(1, batch_size)])
        vecs = embed(lo)
        if not isinstance(vecs, list) or len(vecs) != len(lo):
            raise RebuildError(
                f"lô tại {i}: gửi {len(lo)} văn bản, nhận "
                f"{len(vecs) if isinstance(vecs, list) else type(vecs).__name__} vector")
        ra.extend(vecs)
        if tien_do:
            tien_do(min(i + len(lo), tong), tong)
    return ra


def da_chuan_hoa(vecs: Sequence[Sequence[float]], *, sai_so: float = 1e-3) -> bool:
    """Vector có phải đơn vị (|v| = 1) không.

    Quan trọng vì index dùng `IndexFlatL2`: với vector đơn vị thì
    `|a-b|² = 2 - 2·cos(a,b)`, nên xếp hạng theo L2 TRÙNG xếp hạng theo cosine —
    đúng thứ phần còn lại của hệ thống giả định. Vector chưa chuẩn hoá vẫn dựng
    được index, chỉ là thứ tự trả về mang nghĩa khác, và khác một cách im lặng.

    Đo thật 2026-09-04: `Vietnamese_Embedding` của FPT trả |v| = 1.0 chính xác,
    khớp với đường cục bộ (`normalize_embeddings=True` / mean-pool có chuẩn hoá).
    Ghi kết quả vào metadata để lần sau provider đổi hành vi thì nhìn ra được.
    """
    import math

    for v in vecs:
        if abs(math.sqrt(sum(float(x) * float(x) for x in v)) - 1.0) > sai_so:
            return False
    return True


def kiem_vector(vecs: Sequence[Sequence[float]]) -> int:
    """Trả số chiều. Ném nếu rỗng, lệch chiều, hoặc chiều bằng 0."""
    if not vecs:
        raise RebuildError("không có vector nào để dựng index")
    dims = {len(v) for v in vecs}
    if len(dims) != 1:
        raise RebuildError(f"vector lệch số chiều: {sorted(dims)[:5]}")
    dim = dims.pop()
    if dim <= 0:
        raise RebuildError("vector 0 chiều")
    return dim


# ── B. Ghi staging ─────────────────────────────────────────────────────────
# Bộ artifact CANONICAL. Đây là thứ `append_chunks_to_lc_index` (đường ingest thật
# của ứng dụng) vẫn sinh ra, và là thứ `FAISS.load_local` đọc được.
FILE_CANONICAL = ("index.faiss", "index.pkl", "index.json")


def _ghi_staging(thu_muc: Path, ban_ghi: List[Dict[str, Any]],
                 vecs: Sequence[Sequence[float]], dim: int,
                 danh_tinh: Dict[str, Any], *, emb_obj: Any = None) -> None:
    """Ghi index ở ĐÚNG định dạng mà ứng dụng đọc — LangChain FAISS.

    Bản đầu của hàm này ghi `faiss.IndexIDMap` trần: đúng cho đường legacy, nhưng
    ứng dụng chạy `USE_LC_VECTOR_STORE=1` nên `load_vectorstore()` gọi
    `FAISS.load_local`, cần thêm `index.pkl`. Thiếu file ấy thì `load_vectorstore()`
    trả None và truy hồi rơi xuống nhánh legacy — chạy được, nên trông như ổn.

    Nó KHÔNG ổn, vì hai lý do:

    1. `FAISS.load_local` ghi `IndexFlatL2`, và `idx.search` trả về VỊ TRÍ trong
       index, không phải `chunk_id`. Nhánh legacy lại dùng số trả về ấy làm
       `chunk_id` để tra `_by_id`. Hai định dạng dùng CHUNG một tên file
       `index.faiss` mà nghĩa của số bên trong thì khác nhau — trùng khớp được chỉ
       vì rebuild đánh id 0..N-1 đúng theo thứ tự khoá trong `index.json`.
    2. Nguy hiểm hơn: lần ingest KẾ TIẾP gọi `append_chunks_to_lc_index`, hàm này
       gọi `load_vectorstore()`, nhận None (vì thiếu `index.pkl`), rồi dựng một
       vectorstore MỚI chỉ từ các chunk mới và `save_local` đè lên `index.faiss`.
       Toàn bộ vector vừa dựng lại biến mất, còn `index.json` vẫn liệt kê chúng.

    Nên rebuild sinh ĐÚNG định dạng canonical, không dựa vào nhánh dự phòng.
    `metadata` mang `chunk_id` = vị trí, khớp khoá `index.json` và khớp
    `document_chunks.embedding_id` sẽ ghi xuống Postgres.
    """
    from langchain_community.vectorstores import FAISS

    if thu_muc.exists():
        shutil.rmtree(thu_muc)
    thu_muc.mkdir(parents=True, exist_ok=True)

    if emb_obj is None:
        from app.clients.llm_factory import get_embeddings

        # Chỉ dùng để embed CÂU TRUY VẤN lúc đọc lại; `save_local` không ghi nó vào
        # pickle, nên đối tượng nào cũng được miễn khớp không gian vector khi truy vấn.
        emb_obj = get_embeddings()

    cap = [(b["text"], [float(x) for x in v]) for b, v in zip(ban_ghi, vecs)]
    metadatas = [{"chunk_id": i, "source_stem": b["source_stem"]}
                 for i, b in enumerate(ban_ghi)]
    vs = FAISS.from_embeddings(cap, emb_obj, metadatas=metadatas)
    vs.save_local(str(thu_muc))

    meta: Dict[str, Any] = {}
    for i, b in enumerate(ban_ghi):
        meta[str(i)] = {"source_stem": b["source_stem"], "text": b["text"],
                        "timestamp": datetime.now().isoformat()}
    meta["__meta__"] = {
        "version": "1.2",
        "created_at": datetime.now().isoformat(),
        "num_chunks": len(ban_ghi),
        "embedding_dim": dim,
        "vector_backend": "langchain_faiss",
        "rebuilt_from": "postgres.document_chunks",
        "vectors_normalized": da_chuan_hoa(vecs),
        **danh_tinh,
    }
    (thu_muc / "index.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


# ── C. Thẩm định ───────────────────────────────────────────────────────────
def tham_dinh_staging(thu_muc: Path, *, so_chunk: int, dim: int,
                      danh_tinh: Dict[str, Any]) -> None:
    """Đọc LẠI thứ vừa ghi. Tin vào biến trong bộ nhớ thì không phát hiện được một
    lần ghi hỏng nửa chừng."""
    import faiss

    thieu = [t for t in FILE_CANONICAL if not (thu_muc / t).exists()]
    if thieu:
        raise RebuildValidationError(f"staging thiếu file: {thieu} trong {thu_muc}")
    f = thu_muc / "index.faiss"
    m = thu_muc / "index.json"

    idx = faiss.read_index(str(f))
    if idx.d != dim:
        raise RebuildValidationError(f"staging có {idx.d} chiều, cần {dim}")
    if idx.ntotal != so_chunk:
        raise RebuildValidationError(
            f"staging có {idx.ntotal} vector, cần {so_chunk}")

    meta = json.loads(m.read_text(encoding="utf-8"))
    mm = meta.get("__meta__") or {}
    if int(mm.get("num_chunks") or -1) != so_chunk:
        raise RebuildValidationError(
            f"meta ghi num_chunks={mm.get('num_chunks')}, cần {so_chunk}")
    lech = [k for k, v in danh_tinh.items() if mm.get(k) != v]
    if lech:
        raise RebuildValidationError(f"meta lệch danh tính ở {lech}")


# ── D. Thăng cấp ───────────────────────────────────────────────────────────
def thang_cap(staging: Path, active: Path, *, keep: int = 3) -> Optional[Path]:
    """Đưa staging thành active. Trả về đường dẫn backup của bản cũ (None nếu chưa có).

    Bản cũ được ĐỔI TÊN, không xoá — nếu bước cuối hỏng thì còn đường lùi bằng tay.
    Đổi tên trong cùng một hệ thống file là thao tác nguyên tử ở mức thư mục: không có
    khoảnh khắc nào index vừa cũ vừa mới.
    """
    active = Path(active)
    staging = Path(staging)
    if not staging.exists():
        raise RebuildError(f"không có staging để thăng cấp: {staging}")

    backup: Optional[Path] = None
    if active.exists():
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup = active.parent / f"{active.name}_backup_{ts}"
        active.rename(backup)
    try:
        staging.rename(active)
    except Exception:
        # Trả lại nguyên trạng: thà không có index mới còn hơn mất index cũ.
        if backup is not None and not active.exists():
            backup.rename(active)
        raise

    if backup is not None and keep >= 0:
        try:
            from app.domains.vectorstore.store import cleanup_old_backups

            cleanup_old_backups(active, max_keep=keep)
        except Exception:
            pass
    return backup


# ── Ghi embedding_id ngược về Postgres ─────────────────────────────────────
def ghi_embedding_id(ban_ghi: List[Dict[str, Any]],
                     *, cap_nhat: Optional[Callable[[str, str], None]] = None) -> int:
    """Gán id FAISS (vị trí trong `ban_ghi`) vào `document_chunks.embedding_id`.

    Chạy SAU khi thăng cấp thành công. Trước đó thì DB sẽ trỏ vào một index chưa
    phục vụ. Cập nhật MỘT cột, không xoá gì, và chạy lại được: cùng dữ liệu vào thì
    cùng ánh xạ ra.
    """
    if cap_nhat is None:
        from app.domains.documents import repository as _docs

        cap_nhat = getattr(_docs, "set_chunk_embedding_id", None)
        if cap_nhat is None:
            raise RebuildError(
                "repository chưa có `set_chunk_embedding_id` — không ghi ngược được "
                "`embedding_id`, và thiếu nó thì `semantic_search` không tra ngược "
                "được kết quả FAISS về chunk.")
    n = 0
    for i, b in enumerate(ban_ghi):
        cap_nhat(b["chunk_id"], str(i))
        n += 1
    return n


# ── Điều phối ──────────────────────────────────────────────────────────────
def rebuild_index_tu_postgres(
    *,
    active_dir: Optional[Path] = None,
    batch_size: int = 64,
    embed: Optional[Callable[[List[str]], List[List[float]]]] = None,
    danh_tinh: Optional[Dict[str, Any]] = None,
    ban_ghi: Optional[List[Dict[str, Any]]] = None,
    cap_nhat_embedding_id: Optional[Callable[[str, str], None]] = None,
    ghi_db: bool = True,
    tien_do: Optional[Callable[[int, int], None]] = None,
    keep_backup: int = 3,
    allowlist: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """A → B → C → D. Ném thì index đang phục vụ vẫn nguyên vẹn.

    KHÔNG tự chạy ở bất kỳ đâu. Không có ngữ liệu thì KHÔNG đụng vào index hiện có —
    dựng lại thành index rỗng là cách xoá dữ liệu mà trông như thành công.

    MỌI chunk đi qua ALLOWLIST trước khi được embed — kể cả `ban_ghi` truyền sẵn.
    `doc_chunks_tu_db()` đọc TẤT CẢ tài liệu chưa xoá; nếu lọc chỉ nằm ở đó thì người
    gọi nào truyền `ban_ghi` của riêng mình sẽ lách được, và lách được nghĩa là hàng
    rào không tồn tại. Lọc ở ĐÂY vì đây là chỗ duy nhất mọi đường dựng lại đi qua.

    `allowlist=None` nghĩa là ĐỌC FILE THẬT và áp nó. Không có sentinel "bỏ qua kiểm
    tra": test phải khai tường minh tài liệu nào được phép, y như production.
    """
    from app.clients.llm_factory import embedding_identity
    from app.domains.vectorstore import allowlist as _al
    from app.domains.vectorstore import store as _store

    active = Path(active_dir) if active_dir is not None else Path(_store.INDEX_DIR)
    staging = active.parent / f"{active.name}_staging"
    dt = dict(danh_tinh) if danh_tinh is not None else embedding_identity()

    if ban_ghi is None:
        ban_ghi = doc_chunks_tu_db()
    tho = len(ban_ghi)
    ban_ghi = _al.loc_ban_ghi(ban_ghi, allowlist)
    if tho != len(ban_ghi):
        print(f"[allowlist] {tho} chunk đọc được, {len(ban_ghi)} chunk được phép index "
              f"({tho - len(ban_ghi)} bị chặn vì tài liệu chưa được allowlist)", flush=True)
    if not ban_ghi:
        return {"promoted": False, "chunks": 0, "dim": 0, "backup": None,
                "chunks_doc_duoc": tho,
                "ly_do": ("không có chunk nào ĐƯỢC PHÉP index — giữ nguyên index hiện có"
                          if tho else
                          "không có chunk nào trong Postgres — giữ nguyên index hiện có")}

    vecs = sinh_vector([b["text"] for b in ban_ghi], embed=embed,
                       batch_size=batch_size, tien_do=tien_do)
    dim = kiem_vector(vecs)

    _ghi_staging(staging, ban_ghi, vecs, dim, dt)
    try:
        tham_dinh_staging(staging, so_chunk=len(ban_ghi), dim=dim, danh_tinh=dt)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    backup = thang_cap(staging, active, keep=keep_backup)

    so_db = 0
    if ghi_db:
        so_db = ghi_embedding_id(ban_ghi, cap_nhat=cap_nhat_embedding_id)

    return {"promoted": True, "chunks": len(ban_ghi), "dim": dim,
            # Số chunk ĐỌC ĐƯỢC luôn được báo cùng số chunk ĐÃ INDEX. Chỉ báo số sau
            # thì một allowlist đặt sai khiến 3/189 chunk vào index vẫn trông như
            # thành công — hai con số cạnh nhau thì chênh lệch tự lộ ra.
            "chunks_doc_duoc": tho,
            "backup": str(backup) if backup else None,
            "embedding_id_da_ghi": so_db, "danh_tinh": dt}
