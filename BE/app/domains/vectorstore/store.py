"""
Index FAISS + index.json — LangChain LC store (USE_LC_VECTOR_STORE) + legacy faiss-cpu.
Thay thế hoàn toàn faiss_utils.py + phần LC trước đây tách file.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import faiss
import numpy as np
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document

from app.clients.llm_factory import (
    DEFAULT_EMBEDDING_MODEL_NAME,
    embedding_identity,
    fpt_embedding_enabled,
    get_embedding_model,
    get_embeddings,
)
from app.domains.vectorstore.embedding_utils import normalize_embeddings_array
try:
    from shared.env_loader import load_project_env
    load_project_env(override=False)
except Exception:
    pass

logger = logging.getLogger(__name__)

from shared.paths import BE_ROOT
DATA_ROOT = Path(os.environ.get("DATA_DIR", str(BE_ROOT)))
INDEX_DIR = Path(os.environ.get("INDEX_DIR", str(DATA_ROOT / "index")))


def _optional_prefix_embedding_list(text: str) -> Optional[List[float]]:
    """Embed text[:512] lưu vào meta index.json — LEGACY, mặc định TẮT (PR#6).

    Đây là lần embed THỨ HAI mỗi chunk (vector chính đã vào FAISS) và phình
    index.json. Consumer duy nhất còn lại là helper legacy
    services/mindmap/worker.collect_chunks_for_sources (None-safe, chỉ test gọi);
    pipeline mindmap thật (input_collector + skeleton TF-IDF) không đọc field này.
    Cần lại hành vi cũ → STORE_PREFIX_EMBEDDINGS=1."""
    if (os.getenv("STORE_PREFIX_EMBEDDINGS", "0") or "").strip().lower() not in ("1", "true", "yes", "on"):
        return None
    model = get_embedding_model()
    if model is None:
        return None
    prefix = (text or "")[:512].strip()
    if not prefix:
        return None
    arr = model.encode([prefix], convert_to_numpy=True, show_progress_bar=False)
    return np.asarray(arr[0], dtype=float).tolist()
INDEX_PATH = str(INDEX_DIR / "index.faiss")
META_PATH = str(INDEX_DIR / "index.json")
os.makedirs(str(INDEX_DIR), exist_ok=True)
MODEL_NAME = os.environ.get("EMBEDDING_MODEL_NAME", DEFAULT_EMBEDDING_MODEL_NAME)


def _use_lc_vector_store() -> bool:
    """ĐIỂM ĐỌC DUY NHẤT của `USE_LC_VECTOR_STORE`. Mọi nhánh LC-vs-legacy đi qua đây.

    Default "0" là CỐ Ý và khác với `env_loader` (setdefault "1"): env_loader chạy cho
    tiến trình app thật, còn khi nó bị tắt bằng `MEMVID_DISABLE_LC_DEFAULTS=1` (chính
    `tests/conftest.py` đặt) thì đường LEGACY mới là đường mặc định — đó là đường mà bộ
    test cố ý chạy, và cũng là đường có guard dim của `hybrid._load_faiss_index`.

    `shared/config.py` từng có `use_lc_vector_store: bool = True` song song với dòng này —
    hai tầng trả lời ngược nhau cho cùng một câu hỏi. Trường đó đã bị gỡ 2026-08-29 vì
    0 người đọc. Đổi default ở đây thì đổi luôn đường mà toàn bộ test retrieval đang chạy.
    """
    return (os.getenv("USE_LC_VECTOR_STORE", "0") or "").strip().lower() in ("1", "true", "yes", "on")


def cleanup_old_backups(index_dir: Path, max_keep: int = 3) -> None:
    try:
        max_keep = int(max_keep)
    except Exception:
        max_keep = 3
    max_keep = max(0, max_keep)

    parent = Path(index_dir).resolve().parent
    prefix = f"{Path(index_dir).name}_backup_"

    backups: list[Path] = []
    for p in parent.iterdir():
        if p.is_dir() and p.name.startswith(prefix):
            backups.append(p)

    backups.sort(key=lambda p: p.name, reverse=True)
    to_delete = backups if max_keep == 0 else backups[max_keep:]

    for p in to_delete:
        try:
            shutil.rmtree(p, ignore_errors=True)
        except Exception:
            pass


def save_index_with_backup(index: Any, index_dir: Path, keep: int = 3) -> None:
    index_dir = Path(index_dir).resolve()
    parent = index_dir.parent
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = parent / f"{index_dir.name}_backup_{ts}"

    if index_dir.exists() and index_dir.is_dir():

        def _ignore(_dir: str, names: list[str]) -> set[str]:
            ignored = []
            for n in names:
                if n.startswith(f"{index_dir.name}_backup_"):
                    ignored.append(n)
            return set(ignored)

        try:
            shutil.copytree(index_dir, backup_dir, ignore=_ignore)
        except Exception:
            pass

    cleanup_old_backups(index_dir, max_keep=keep)

    faiss_path = str(index_dir / "index.faiss")
    faiss.write_index(index, faiss_path)


def _skip_faiss_in_ci() -> bool:
    """`SKIP_MODEL_LOAD=1` nghĩa là 'đừng nạp weight vào tiến trình này'. Embedding
    qua HTTP không nạp gì, nên cờ đó không áp — nếu áp thì bật FPT embedding xong
    index vẫn không bao giờ được ghi ở đúng nơi cần nó nhất."""
    return os.getenv("SKIP_MODEL_LOAD") == "1" and not fpt_embedding_enabled()


def _require_embedding_model():
    model = get_embedding_model(MODEL_NAME)
    if model is None:
        raise RuntimeError("Embedding model not available (CI mode)")
    return model


def _load_meta() -> Dict[str, Dict]:
    if os.path.exists(META_PATH):
        with open(META_PATH, encoding="utf-8") as f:
            meta = json.load(f)
            if isinstance(meta, dict) and "__meta__" not in meta:
                num_chunks = sum(1 for k in meta.keys() if isinstance(k, str) and k.isdigit())
                meta["__meta__"] = {
                    "version": "1.0",
                    "created_at": datetime.now().isoformat(),
                    "num_chunks": num_chunks,
                }
                try:
                    _save_meta(meta)
                except Exception:
                    # ponytail: fail-open cố ý. Đây là ghi MIGRATION (thêm __meta__ cho
                    # index cũ); dict trong bộ nhớ đã có __meta__ nên lần load sau thử
                    # lại. Không mất dữ liệu, không cần kêu.
                    pass
            return meta
    return {}


def load_meta() -> Dict[str, Dict]:
    """Đọc THUẦN index.json (chunk_id -> {text, source_stem, ...}) cho các
    consumer ngoài (memory_tree, retrieval) — seam VectorStore.load_meta().

    Khác _load_meta() nội bộ: KHÔNG tự thêm khoá __meta__ và KHÔNG ghi lại file
    (tránh side-effect khi chỉ đọc). Hành vi khớp memory_tree._load_index_meta cũ.
    """
    p = Path(META_PATH)
    if not p.exists():
        return {}
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        print(f"⚠️ Không thể đọc index metadata: {exc}")
        return {}


def _save_meta(meta: dict) -> None:
    os.makedirs(os.path.dirname(META_PATH), exist_ok=True)
    tmp_path = Path(META_PATH).with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    tmp_path.replace(META_PATH)


def _normalize_source_id(name: str) -> str:
    from unicodedata import normalize

    name = (name or "").strip()
    if not name:
        return ""
    if "/" in name or "\\" in name:
        name = os.path.basename(name)
    if "." in name:
        name = os.path.splitext(name)[0]
    cleaned = normalize("NFKD", name).replace("\u00a0", " ")
    import re

    cleaned = re.sub(r"_\d{8}_\d{6}$", "", cleaned)
    return cleaned.strip().lower()


def _get_current_embedding_dim() -> int:
    """Lấy embedding dimension thực tế từ model hiện tại (tránh hard-code)."""
    model = _require_embedding_model()
    dummy = model.encode(["dimension_check"], convert_to_numpy=True, show_progress_bar=False)
    return int(dummy.shape[1])


INDEX_IDENTITY_KEYS = ("embedding_provider", "embedding_model_name", "embedding_strategy")


class IndexIdentityMismatch(RuntimeError):
    """Index được dựng bằng một không gian vector khác với cái đang cấu hình."""


def index_identity(meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Danh tính đã GHI trong `__meta__`. Thiếu khoá nào thì để None."""
    if meta is None:
        meta = load_meta()
    m = meta.get("__meta__") if isinstance(meta, dict) else None
    if not isinstance(m, dict):
        return {k: None for k in INDEX_IDENTITY_KEYS}
    return {k: m.get(k) for k in INDEX_IDENTITY_KEYS}


def check_index_identity(meta: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """Trả về mô tả chỗ lệch, hoặc None nếu dùng được.

    Vì sao không so số chiều là đủ: `BAAI/bge-m3` và `Vietnamese_Embedding` — bản
    fine-tune từ chính nó trên marketplace — ĐỀU 1024 chiều. Hàng rào cũ
    (`_load_index`) chỉ so `idx.d`, nên đổi sang model kia thì index cũ nạp trót
    lọt, truy vấn chạy bình thường, và kết quả là rác. Không một dòng log nào.

    Chiến lược pool cũng đổi không gian vector dù cùng model: `mean_late` và
    `encode` trên cùng bge-m3 cho hai không gian khác nhau (.playbook 2026-09-01).

    Index CŨ (`version` 1.0/1.1) không ghi provider/strategy. Không suy đoán hộ:
    thiếu thông tin thì cho qua, chỉ so những khoá thực sự có. Khoá duy nhất mà
    index 1.1 luôn có là `embedding_model_name`, và riêng nó đã bắt được ca
    bge-m3 -> Vietnamese_Embedding.
    """
    hien_tai = embedding_identity()
    da_ghi = index_identity(meta)
    if not any(da_ghi.values()):
        # Index 1.0 không ghi gì để so. Với provider CỤC BỘ thì cho qua: không có
        # thông tin, mà chặn hết thì mọi cài đặt cũ chết oan.
        #
        # Với `fpt` thì KHÔNG cho qua, và đây không phải phỏng đoán: provider ấy chưa
        # tồn tại trong mã cho tới hôm nay, nên một index không mang danh tính chắc
        # chắn KHÔNG được dựng bằng nó. Đây là ca "thiếu metadata" mà vẫn kết luận
        # được, thay vì mặc định coi là tương thích.
        if hien_tai.get("embedding_provider") == "fpt":
            return ("index không ghi danh tính (version cũ) nên không thể do provider "
                    "'fpt' dựng — provider này mới có")
        return None
    lech = [f"{k}: index={da_ghi[k]!r} != cấu hình={hien_tai.get(k)!r}"
            for k in INDEX_IDENTITY_KEYS
            if da_ghi.get(k) is not None and da_ghi[k] != hien_tai.get(k)]
    if not lech:
        return None
    return "; ".join(lech)


def _load_index(dim: int):
    """
    Load hoặc tạo FAISS index với dimension validation.
    Nếu index cũ có dim khác, xóa và tạo mới.
    """
    if os.path.exists(INDEX_PATH):
        try:
            idx = faiss.read_index(INDEX_PATH)
            actual_dim = idx.d
            print(f"[vector_store] _load_index: index.d={actual_dim} requested_dim={dim} ntotal={idx.ntotal}")
            if actual_dim != dim:
                print(
                    f"[INDEX] Dimension mismatch: index có {actual_dim}, model yêu cầu {dim}. "
                    f"Xóa index cũ và tạo mới."
                )
                try:
                    os.remove(INDEX_PATH)
                except OSError:
                    pass
                base = faiss.IndexFlatL2(dim)
                return faiss.IndexIDMap(base)
            if not isinstance(idx, faiss.IndexIDMap):
                base = faiss.IndexFlatL2(dim)
                new_idx = faiss.IndexIDMap(base)
                xb = idx.reconstruct_n(0, idx.ntotal)
                ids = np.arange(idx.ntotal, dtype="int64")
                new_idx.add_with_ids(xb, ids)
                return new_idx
            return idx
        except Exception as exc:
            logger.warning("[vector_store] Cannot read existing index: %s. Creating new.", exc)
            try:
                os.remove(INDEX_PATH)
            except OSError:
                pass

    base = faiss.IndexFlatL2(dim)
    return faiss.IndexIDMap(base)


# ----- LC helpers -----
def _backup_dir_before_write(index_dir: Path, keep: int = 3) -> None:
    index_dir = Path(index_dir).resolve()
    parent = index_dir.parent
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = parent / f"{index_dir.name}_backup_{ts}"
    prefix = f"{index_dir.name}_backup_"

    if index_dir.exists() and index_dir.is_dir():

        def _ignore(_dir: str, names: list[str]) -> set[str]:
            ignored = []
            for n in names:
                if n.startswith(prefix):
                    ignored.append(n)
            return set(ignored)

        try:
            shutil.copytree(index_dir, backup_dir, ignore=_ignore)
        except Exception:
            pass

    cleanup_old_backups(index_dir, max_keep=keep)


# PR#7: cache LC vectorstore per-process cho HOT PATH retrieval — FAISS.load_local
# deserialize toàn bộ docstore pickle MỖI query. Key = mtime+size của index.faiss
# + index.pkl → append/delete/rebuild (đều save_local ghi lại file) tự vô hiệu ở
# lần đọc kế. Writer (append/remove) PHẢI load fresh (use_cache=False, mặc định):
# họ mutate instance rồi save — mutate bản cache đang được query dùng là race.
_VS_CACHE: dict = {"key": None, "vs": None}


def _vs_cache_key() -> Optional[tuple]:
    try:
        f = (INDEX_DIR / "index.faiss").stat()
        p = (INDEX_DIR / "index.pkl").stat()
    except OSError:
        return None
    # Danh tính embedding nằm TRONG khoá cache. Nếu không, đổi cấu hình embedding
    # giữa chừng sẽ trả về đúng cái vectorstore đã cache trước đó — hàng rào bên
    # dưới không bao giờ chạy vì cache đã trả lời trước. Đọc env, không chạm đĩa.
    return (f.st_mtime_ns, f.st_size, p.st_mtime_ns, p.st_size,
            tuple(sorted(embedding_identity().items())))


def load_vectorstore(use_cache: bool = False) -> Optional[FAISS]:
    if _skip_faiss_in_ci():
        return None
    faiss_file = INDEX_DIR / "index.faiss"
    if not faiss_file.exists():
        return None
    pkl = INDEX_DIR / "index.pkl"
    if not pkl.exists():
        return None
    key = _vs_cache_key() if use_cache else None
    if use_cache and key is not None and _VS_CACHE["key"] == key and _VS_CACHE["vs"] is not None:
        return _VS_CACHE["vs"]
    lech = check_index_identity()
    if lech:
        # KHÔNG xoá, KHÔNG dựng lại: index là dữ liệu, và việc dựng lại là quyết
        # định của người vận hành. Chỉ từ chối dùng nó và nói rõ vì sao — truy hồi
        # rỗng là kết quả trung thực, truy hồi bằng vector của model khác thì không.
        print(f"[INDEX] Từ chối nạp: không gian vector lệch ({lech}). Dựng lại index bằng cấu hình hiện tại rồi thử lại.", flush=True)
        return None
    try:
        vs = FAISS.load_local(str(INDEX_DIR), get_embeddings(), allow_dangerous_deserialization=True)
    except Exception:
        return None
    if use_cache and key is not None:
        _VS_CACHE["key"] = key
        _VS_CACHE["vs"] = vs
    return vs


def append_chunks_to_lc_index(
    chunks: List[str],
    source_name: str = "",
    custom_metadata: Optional[List[Dict[str, Any]]] = None,
    batch_size: int = 32,
    embeddings: Optional[Any] = None,
) -> List[int]:
    if embeddings is None and _skip_faiss_in_ci():
        print("[vector_store] Skipped append (CI mode)")
        return []
    if not chunks:
        return []

    meta = _load_meta()
    existing_ids: List[int] = []
    for k in (meta or {}).keys():
        if isinstance(k, str) and k.isdigit():
            existing_ids.append(int(k))
    next_id = max(existing_ids) + 1 if existing_ids else 0
    ids = list(range(next_id, next_id + len(chunks)))

    now = datetime.now().isoformat()
    docs: List[Document] = []
    for i, chunk in enumerate(chunks):
        cid = ids[i]
        md: Dict[str, Any] = {"chunk_id": cid, "source_stem": source_name}
        if custom_metadata and i < len(custom_metadata):
            for kk, vv in (custom_metadata[i] or {}).items():
                md[kk] = vv
        docs.append(Document(page_content=chunk, metadata=md))

    emb = get_embeddings()
    os.makedirs(str(INDEX_DIR), exist_ok=True)

    # `load_vectorstore()` trả None cho BA lý do khác hẳn nhau: chưa có index (bình
    # thường), thiếu `index.pkl`, và lệch danh tính không gian vector. Hai lý do sau
    # mà vẫn đi tiếp thì `FAISS.from_*` dựng một vectorstore MỚI chỉ từ chunk đang
    # thêm, rồi `save_local` ĐÈ LÊN `index.faiss` đang có — mọi vector cũ biến mất
    # trong khi `index.json` vẫn liệt kê chúng. Mất dữ liệu, không một lỗi nào.
    #
    # Nên: có file index trên đĩa mà không nạp được thì DỪNG. Đường ingest cũng phải
    # đi qua hàng rào danh tính, y như đường legacy — trước đây nó lách được vì
    # `append_to_index` rẽ sang đây TRƯỚC khi tới chỗ kiểm.
    if (INDEX_DIR / "index.faiss").exists() and load_vectorstore() is None:
        lech = check_index_identity()
        raise IndexIdentityMismatch(
            f"Có index trên đĩa nhưng không nạp được"
            f"{f' ({lech})' if lech else ' (thiếu index.pkl hoặc file hỏng)'}. "
            f"Ghi thêm vào lúc này sẽ ĐÈ MẤT index hiện có — dựng lại index trước."
        )

    if embeddings is not None:
        # LATE CHUNKING: dùng vector precomputed; `emb` chỉ để embed query lúc truy vấn.
        vecs = np.asarray(embeddings, dtype="float32")
        if vecs.shape[0] != len(chunks):
            raise ValueError(
                f"embeddings count {vecs.shape[0]} != chunks {len(chunks)}"
            )
        text_embeddings = list(zip(chunks, [v.tolist() for v in vecs]))
        metadatas = [d.metadata for d in docs]
        vs_existing = load_vectorstore()
        if vs_existing is None:
            vs = FAISS.from_embeddings(text_embeddings, emb, metadatas=metadatas)
        else:
            vs = vs_existing
            vs.add_embeddings(text_embeddings, metadatas=metadatas)
    else:
        vs_existing = load_vectorstore()
        if vs_existing is None:
            vs = FAISS.from_documents(docs, emb)
        else:
            vs = vs_existing
            vs.add_documents(docs)

    # PR#6: KHÔNG full-dir backup mỗi append — backup chưa từng có đường restore
    # tự động, chỉ là snapshot thủ công, mà copytree cả index dir mỗi lần append
    # là chi phí lớn nhất của ingest. Backup GIỮ ở thao tác phá huỷ
    # (remove_chunks_*/rebuild_*).
    vs.save_local(str(INDEX_DIR))

    text_items = []
    for i, chunk in enumerate(chunks):
        cid = ids[i]
        meta_entry: Dict[str, Any] = {
            "source_stem": source_name,
            "timestamp": now,
        }
        if custom_metadata and i < len(custom_metadata):
            meta_entry.update(custom_metadata[i])

        meta_entry["text"] = chunk
        text_items.append((cid, chunk))

        emb_vec = _optional_prefix_embedding_list(chunk)
        if emb_vec is not None:
            meta_entry["embedding"] = emb_vec
        meta[str(cid)] = meta_entry

    if text_items:
        import app.domains.vectorstore.chunk_text_store as chunk_text_store
        chunk_text_store.put_many(text_items)


    num_chunks = sum(1 for k in meta.keys() if isinstance(k, str) and k.isdigit())
    model_name = MODEL_NAME
    if embeddings is not None:
        emb_dim = int(np.asarray(embeddings).shape[1])
    else:
        try:
            # Dùng lại `emb` (get_embeddings module-level) — KHÔNG re-import trong hàm,
            # vì `from ... import get_embeddings` ở đây sẽ shadow biến module-level →
            # `emb = get_embeddings()` phía trên ném UnboundLocalError (lỗi đã gặp).
            dummy = emb.embed_query("dim_check")
            emb_dim = len(dummy)
        except Exception:
            emb_dim = 0
    meta["__meta__"] = {
        "version": "1.2",
        "created_at": meta.get("__meta__", {}).get("created_at") or now,
        "num_chunks": num_chunks,
        "embedding_dim": emb_dim,
        "vector_backend": "langchain_faiss",
        "pooling": "mean_late" if embeddings is not None else "encode",
        **embedding_identity(),
    }
    _save_meta(meta)
    print(f"[vector_store] added {len(chunks)} chunks source={source_name!r} (total={num_chunks}, model={model_name})")
    return ids


def rebuild_lc_index_from_meta(meta: Dict[str, Any]) -> None:
    if _skip_faiss_in_ci():
        return

    pairs: List[tuple[int, Dict[str, Any]]] = []
    for k, v in meta.items():
        if not isinstance(k, str) or not k.isdigit():
            continue
        if not isinstance(v, dict):
            continue
        pairs.append((int(k), v))

    if not pairs:
        for fn in ("index.faiss", "index.pkl"):
            p = INDEX_DIR / fn
            if p.exists():
                try:
                    p.unlink()
                except Exception:
                    pass
        if os.path.exists(INDEX_PATH):
            try:
                os.remove(INDEX_PATH)
            except Exception:
                pass
        return

    pairs.sort(key=lambda x: x[0])
    docs: List[Document] = []
    from app.domains.vectorstore import chunk_text_store
    for cid, v in pairs:
        t = chunk_text_store.get_text(cid) or v.get("text") or ""
        docs.append(
            Document(
                page_content=t,
                metadata={
                    "chunk_id": cid,
                    "source_stem": v.get("source_stem") or "",
                },
            )
        )

    emb = get_embeddings()
    vs = FAISS.from_documents(docs, emb)
    keep = int(os.environ.get("FAISS_BACKUP_KEEP", "3"))
    _backup_dir_before_write(INDEX_DIR, keep=keep)
    vs.save_local(str(INDEX_DIR))

    num_chunks = len(pairs)
    emb_dim = 0
    try:
        dummy = emb.embed_query("dim_check")
        emb_dim = len(dummy)
    except Exception as e:
        # emb_dim giữ 0 và được ghi thẳng vào __meta__. Đọc lại thấy dim=0 thì không
        # phân biệt được "chưa đo" với "model 0 chiều" — nên phải kêu, không nuốt im.
        print(f"embedding_dim_probe_failed err={e}", flush=True)
    meta["__meta__"] = {
        "version": "1.2",
        "created_at": meta.get("__meta__", {}).get("created_at") or datetime.now().isoformat(),
        "num_chunks": num_chunks,
        "embedding_model_name": MODEL_NAME,
        "embedding_dim": emb_dim,
        "vector_backend": "langchain_faiss",
        **embedding_identity(),
    }
    _save_meta(meta)
    print(f"[vector_store] rebuilt LC FAISS vectors={num_chunks} (model={MODEL_NAME})")


def similarity_search_lc(query: str, k: int = 5) -> List[str]:
    vs = load_vectorstore(use_cache=True)  # hot path đọc-only → dùng cache
    if vs is None:
        return []
    docs = vs.similarity_search(query, k=k)
    return [(d.page_content or "").strip() for d in docs if (d.page_content or "").strip()]


def remove_chunks_from_lc_index(chunk_ids: list[int]) -> int:
    if _skip_faiss_in_ci():
        return 0
    if not chunk_ids:
        return 0

    vs = load_vectorstore()
    if vs is None:
        return 0

    wanted = {int(cid) for cid in chunk_ids}
    docstore_ids: list[str] = []
    doc_dict = getattr(vs.docstore, "_dict", {}) or {}
    for docstore_id, doc in doc_dict.items():
        md = getattr(doc, "metadata", {}) or {}
        try:
            cid = int(md.get("chunk_id"))
        except Exception:
            continue
        if cid in wanted:
            docstore_ids.append(str(docstore_id))

    if not docstore_ids:
        return 0

    ok = vs.delete(ids=docstore_ids)
    if ok is False:
        raise RuntimeError("LangChain FAISS.delete returned False")

    keep = int(os.environ.get("FAISS_BACKUP_KEEP", "3"))
    _backup_dir_before_write(INDEX_DIR, keep=keep)
    vs.save_local(str(INDEX_DIR))
    return len(docstore_ids)


def remove_chunks_from_raw_index(chunk_ids: list[int]) -> int:
    if _skip_faiss_in_ci():
        return 0

    ids = [int(cid) for cid in chunk_ids]
    if not ids or not os.path.exists(INDEX_PATH):
        return 0

    idx = faiss.read_index(INDEX_PATH)
    removed = idx.remove_ids(np.array(ids, dtype="int64"))
    keep = int(os.environ.get("FAISS_BACKUP_KEEP", "3"))
    save_index_with_backup(idx, INDEX_DIR, keep=keep)
    return int(removed)


def _save_meta_with_updated_num_chunks(meta: Dict[str, Dict]) -> None:
    meta_to_save = dict(meta)
    old_meta = meta.get("__meta__", {}) if isinstance(meta.get("__meta__"), dict) else {}
    num_chunks = sum(1 for k in meta_to_save.keys() if isinstance(k, str) and k.isdigit())
    meta_to_save["__meta__"] = {
        **old_meta,
        "num_chunks": num_chunks,
        "created_at": old_meta.get("created_at") or datetime.now().isoformat(),
    }
    _save_meta(meta_to_save)


# ----- Public API (thay faiss_utils) -----
def append_to_index(
    chunks: List[str],
    source_name: str = "",
    custom_metadata: List[Dict] = None,
    batch_size: int = 32,
    embeddings: Optional[Any] = None,
) -> List[int]:
    """Thêm chunk vào index. Trả về danh sách chunk_id trong FAISS theo THỨ TỰ
    `chunks` — Postgres lưu id này ở `document_chunks.embedding_id` để nối khoá
    nghiệp vụ (UUID) với chỉ mục tìm kiếm (int).

    `embeddings` (LATE CHUNKING): mảng (n_chunks, dim) ĐÃ mean-pool sẵn ở chunk_node.
    Khi có, BỎ QUA encode lại (vector late-chunk không tái tạo được từ text chunk).
    Vì không cần model, đường này vẫn chạy dưới SKIP_MODEL_LOAD.
    """
    if not chunks:
        return []

    if embeddings is None and _skip_faiss_in_ci():
        print("[vector_store] Skipped append_to_index (CI mode)")
        return []

    if _use_lc_vector_store():
        try:
            return append_chunks_to_lc_index(chunks, source_name, custom_metadata, batch_size, embeddings)
        except IndexIdentityMismatch:
            # KHÔNG rơi xuống legacy. Đường LC vừa từ chối ghi vì có index trên đĩa
            # mà không nạp được; nhánh legacy sẽ đọc CÙNG file ấy, thấy nó không phải
            # `IndexIDMap`, rồi dựng một IndexIDMap rỗng đè lên — đúng cái mất dữ
            # liệu mà lời từ chối kia vừa ngăn, chỉ theo một đường khác.
            raise
        except Exception as exc:
            print(f"[vector_store] LangChain vector store failed, fallback legacy FAISS: {exc}")

    if embeddings is not None:
        embeds = np.asarray(embeddings, dtype="float32")
    else:
        model = _require_embedding_model()
        all_embeds = []
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i : i + batch_size]
            batch_embeds = model.encode(
                batch,
                convert_to_numpy=True,
                batch_size=batch_size,
                show_progress_bar=False,
            ).astype("float32")
            print(f"[vector_store] batch {i//batch_size}: type={type(batch_embeds)}, shape={getattr(batch_embeds, 'shape', None)}")
            all_embeds.append(batch_embeds)
        embeds = np.vstack(all_embeds) if len(all_embeds) > 1 else all_embeds[0]

    # Validate embeddings trước khi add vào index
    try:
        embeds = normalize_embeddings_array(
            embeds,
            expected_count=len(chunks),
            context="append_to_index",
        )
    except ValueError as e:
        print(f"[vector_store] ERROR: embedding validation failed: {e}")
        raise

    dim = embeds.shape[1]
    print(f"[vector_store] append_to_index: model={MODEL_NAME} chunks={len(chunks)} embeds_shape={embeds.shape}")

    meta = _load_meta()

    existing_ids: List[int] = []
    for k in (meta or {}).keys():
        if isinstance(k, str) and k.isdigit():
            existing_ids.append(int(k))
    next_id = max(existing_ids) + 1 if existing_ids else 0
    ids = np.arange(next_id, next_id + len(chunks), dtype="int64")

    lech = check_index_identity(meta)
    if lech:
        # Ghi thêm vector của model MỚI vào index của model CŨ là cách trộn hai
        # không gian vào một file, và không có đường lùi nào sau đó.
        raise IndexIdentityMismatch(
            f"Index hiện có được dựng bằng không gian vector khác ({lech}). Dựng lại index trước khi ghi thêm."
        )

    idx = _load_index(dim)
    idx.add_with_ids(embeds, ids)
    # PR#6: append ghi thẳng, không full-dir backup (xem append_chunks_to_lc_index).
    faiss.write_index(idx, INDEX_PATH)

    now = datetime.now().isoformat()
    text_items = []
    for i, chunk in enumerate(chunks):
        cid = int(ids[i])
        meta_entry = {
            "source_stem": source_name,
            "timestamp": now,
        }
        if custom_metadata and i < len(custom_metadata):
            meta_entry.update(custom_metadata[i])

        meta_entry["text"] = chunk
        text_items.append((cid, chunk))

        emb_vec = _optional_prefix_embedding_list(chunk)
        if emb_vec is not None:
            meta_entry["embedding"] = emb_vec

        meta[str(cid)] = meta_entry

    if text_items:
        import app.domains.vectorstore.chunk_text_store as chunk_text_store
        chunk_text_store.put_many(text_items)


    num_chunks = sum(1 for k in meta.keys() if isinstance(k, str) and k.isdigit())
    meta["__meta__"] = {
        "version": "1.2",
        "created_at": meta.get("__meta__", {}).get("created_at") or now,
        "num_chunks": num_chunks,
        "embedding_model_name": MODEL_NAME,
        "embedding_dim": dim,
        # mean_late: vector late-chunk (mean-pool theo span); encode: tự encode 1 vector/chunk.
        "pooling": "mean_late" if embeddings is not None else "encode",
        **embedding_identity(),
    }
    _save_meta(meta)
    print(f"[INDEX] added {len(chunks)} chunks source={source_name!r} (total={num_chunks}, model={MODEL_NAME}, dim={dim})")
    return [int(i) for i in ids]


def search_index(query: str, k: int = 5) -> List[str]:
    if _skip_faiss_in_ci():
        print("[vector_store] Skipped search_index (CI mode)")
        return []

    if _use_lc_vector_store():
        try:
            if load_vectorstore(use_cache=True) is not None:
                return similarity_search_lc(query, k)
        except Exception as exc:
            print(f"[vector_store] LC search failed, fallback legacy: {exc}")

    if not os.path.exists(INDEX_PATH):
        return []

    model = _require_embedding_model()
    qv = model.encode([query], convert_to_numpy=True).astype("float32")
    
    # Validate query vector shape
    if qv.ndim == 1:
        qv = qv.reshape(1, -1)
    if qv.ndim != 2 or qv.shape[0] != 1:
        logger.warning("[vector_store] Invalid query vector shape: %s", qv.shape)
        return []
    
    try:
        idx = faiss.read_index(INDEX_PATH)
    except Exception as exc:
        logger.error("[vector_store] Cannot read FAISS index: %s", exc)
        return []
    
    # Validate dimension match
    if qv.shape[1] != idx.d:
        logger.warning(
            "[vector_store] Query dim=%d != index dim=%d. Cannot search.",
            qv.shape[1], idx.d
        )
        return []
    
    _, I = idx.search(qv, k)

    meta = _load_meta()
    results = []
    for iid in I[0]:
        if iid == -1:
            continue
        key = str(int(iid))
        if key in meta:
            from app.domains.vectorstore import chunk_text_store
            t = chunk_text_store.get_text(int(key))
            if t:
                results.append(t)
    return results


def delete_source_from_index(source_name: str):
    meta = _load_meta()
    chunk_ids: List[int] = []
    keep_meta: Dict[str, Dict] = {}

    for k, v in meta.items():
        if not isinstance(v, dict):
            keep_meta[k] = v
            continue
        if isinstance(k, str) and k.isdigit() and v.get("source_stem") == source_name:
            chunk_ids.append(int(k))
            continue
        keep_meta[k] = v

    if not chunk_ids:
        return

    try:
        if _use_lc_vector_store():
            remove_chunks_from_lc_index(chunk_ids)
        else:
            remove_chunks_from_raw_index(chunk_ids)
        _save_meta_with_updated_num_chunks(keep_meta)
    except Exception:
        _save_meta_with_updated_num_chunks(keep_meta)
        rebuild_chunk_index(keep_meta)


def delete_chunks_by_source(source_id: str) -> int:
    meta = _load_meta()
    if not meta:
        return 0

    target = _normalize_source_id(source_id)
    keep_meta: Dict[str, Dict] = {}
    deleted = 0
    chunk_ids: List[int] = []

    for k, v in meta.items():
        if not isinstance(v, dict):
            keep_meta[k] = v
            continue
        src_raw = v.get("source_id") or v.get("source_stem") or ""
        src_norm = _normalize_source_id(src_raw)
        if isinstance(k, str) and k.isdigit() and src_norm == target:
            deleted += 1
            chunk_ids.append(int(k))
            continue
        keep_meta[k] = v

    if deleted == 0:
        return 0

    try:
        if _use_lc_vector_store():
            remove_chunks_from_lc_index(chunk_ids)
        else:
            remove_chunks_from_raw_index(chunk_ids)
        _save_meta_with_updated_num_chunks(keep_meta)
    except Exception:
        _save_meta_with_updated_num_chunks(keep_meta)
        rebuild_chunk_index(keep_meta)

    return deleted


def rebuild_chunk_index(existing_meta: Dict[str, Dict] | None = None) -> None:
    if _skip_faiss_in_ci():
        print("[vector_store] Skipped rebuild_chunk_index (CI mode)")
        return

    meta = existing_meta if existing_meta is not None else _load_meta()

    if not meta:
        if os.path.exists(INDEX_PATH):
            os.remove(INDEX_PATH)
        pkl = INDEX_DIR / "index.pkl"
        if pkl.exists():
            try:
                pkl.unlink()
            except Exception:
                pass
        return

    from app.domains.vectorstore import chunk_text_store
    texts: List[str] = []
    ids: List[int] = []
    for k, v in meta.items():
        try:
            if not isinstance(k, str) or not k.isdigit():
                continue
            t = chunk_text_store.get_text(int(k)) or v.get("text") or ""
            ids.append(int(k))
            texts.append(t)
        except ValueError:
            continue

    if not texts or not ids:
        if os.path.exists(INDEX_PATH):
            os.remove(INDEX_PATH)
        pkl = INDEX_DIR / "index.pkl"
        if pkl.exists():
            try:
                pkl.unlink()
            except Exception:
                pass
        try:
            meta["__meta__"] = {
                "version": "1.0",
                "created_at": meta.get("__meta__", {}).get("created_at") or datetime.now().isoformat(),
                "num_chunks": 0,
            }
            _save_meta(meta)
        except Exception:
            pass
        return

    if _use_lc_vector_store():
        try:
            rebuild_lc_index_from_meta(meta)
            return
        except Exception as exc:
            print(f"[vector_store] LC rebuild failed, fallback legacy: {exc}")

    model = _require_embedding_model()

    batch_size = 32
    all_embeds = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        batch_embeds = model.encode(
            batch,
            convert_to_numpy=True,
            batch_size=batch_size,
            show_progress_bar=False,
        ).astype("float32")
        print(f"[vector_store] rebuild batch {i//batch_size}: shape={getattr(batch_embeds, 'shape', None)}")
        all_embeds.append(batch_embeds)

    embeds = np.vstack(all_embeds) if len(all_embeds) > 1 else all_embeds[0]
    dim = embeds.shape[1]
    print(f"[vector_store] rebuild_chunk_index: model={MODEL_NAME} texts={len(texts)} embeds_shape={embeds.shape}")

    base = faiss.IndexFlatL2(dim)
    idx = faiss.IndexIDMap(base)
    idx.add_with_ids(embeds, np.array(ids, dtype="int64"))
    keep = int(os.environ.get("FAISS_BACKUP_KEEP", "3"))
    save_index_with_backup(idx, INDEX_DIR, keep=keep)

    num_chunks = len(ids)
    meta["__meta__"] = {
        "version": "1.2",
        "created_at": meta.get("__meta__", {}).get("created_at") or datetime.now().isoformat(),
        "num_chunks": num_chunks,
        "embedding_model_name": MODEL_NAME,
        "embedding_dim": dim,
        **embedding_identity(),
    }
    _save_meta(meta)
    print(f"[INDEX] rebuilt FAISS vectors={num_chunks} (model={MODEL_NAME}, dim={dim})")
