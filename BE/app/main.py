import os
from pathlib import Path
from typing import Any

# Load .env early so all modules see env vars (Windows/dev friendly).
try:
    from shared.env_loader import load_project_env
    load_project_env(override=False)
except Exception:
    pass


def _jobs_update_dispatch(job_id: str, **kwargs: Any) -> None:
    """Keep Guided progress in Postgres; legacy jobs stay on SQLite."""
    try:
        from app.domains.jobs import guided_store
        if guided_store.use_postgres() and guided_store.get_job(job_id) is not None:
            guided_store.update_job(job_id, **kwargs)
            return
    except Exception:
        pass
    if _jobs_update_job is not None:
        _jobs_update_job(job_id, **kwargs)

import json
import hashlib
import re
import uuid
import contextlib
import threading
import time
import logging
import signal
import sys
from collections import OrderedDict
from datetime import datetime, timezone
from typing import List, Dict, Optional, Tuple, Any
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS

from app.domains.ingest.ingest_utils import extract_text, split_text
from app.domains.vectorstore.store import (
    append_to_index,
    delete_source_from_index,
    delete_chunks_by_source,
    rebuild_chunk_index,
    MODEL_NAME,
)
from app.clients.llm_factory import summarize_results
from app.domains.cache import llm_cache
# Phép chiếu thư viện — thuần, không DB/HTTP. Import ở đầu file (không lười) vì
# `_doc_public` gọi nó ở mọi phản hồi tài liệu.
from app.domains.documents import bo_suu_tap as _bo_suu_tap
from app.domains.documents import thu_vien as _thu_vien
# Tang tri thuc NAM TREN thu_vien va import nguoc xuong no, nen `thu_vien`
# tuyet doi khong duoc import lai `tri_thuc` — vong import. Viec lap rap vi
# vay xay ra o day, dung huong phu thuoc.
from app.domains.documents import cau_hoi_goi_y as _cau_hoi
from app.domains.documents import tri_thuc as _tri_thuc
from shared.config import DEFAULT_LOCAL_MODEL
# Chỉ dùng cho local Ollama (Gemini sẽ bỏ qua model).
SLM_MODEL = os.environ.get("SLM_MODEL_CHAT", os.environ.get("SLM_MODEL", DEFAULT_LOCAL_MODEL))
from app.domains.mindmap import store as mindmap_store
from app.domains.mindmap.input_collector import collect_mindmap_input
from app.domains.jobs import export_jobs
from services.mindmap.pipeline import schema as mindmap_schema
from app.domains.summary import store as summary_store
from services.summary.pipeline import schema as summary_schema
from app.domains.memory.tree import (
    build_memory_tree_for_sources,
    query_with_memory_tree,
    delete_memory_tree_by_source,
    rebuild_memory_index,
    _normalize_video_stem,
)
app = Flask(__name__)

# Chặn upload quá khổ NGAY Ở TẦNG WSGI: không có mốc này Flask nhận không giới
# hạn, file vài GB vẫn ghi hết vào đĩa rồi mới nghẹn ở bước sau. Werkzeug ném
# RequestEntityTooLarge (413) trước khi thân request được đọc xong.
MAX_UPLOAD_MB = max(1, int(os.getenv('MAX_UPLOAD_MB', '100')))
app.config['MAX_CONTENT_LENGTH'] = MAX_UPLOAD_MB * 1024 * 1024

# Ảnh dán vào khung chat đi đường riêng, mốc thấp hơn nhiều: nó phải nằm gọn
# trong RAM để mã hoá base64 gửi sang Ollama, không phải file lưu trữ.
VISION_MAX_IMAGE_MB = max(1, int(os.getenv('VISION_MAX_IMAGE_MB', '8')))


@app.errorhandler(413)
def _too_large(_err):
    """Trả JSON thay vì trang HTML mặc định — FE chỉ đọc JSON."""
    return jsonify({
        'error': f'File vượt giới hạn {MAX_UPLOAD_MB}MB',
        'max_upload_mb': MAX_UPLOAD_MB,
    }), 413

# Init SQLite job store (idempotent). Chưa thay logic endpoint ở bước này.
try:
    from app.domains.jobs.jobs_store import init_db as _jobs_init_db, migrate_from_dict as _jobs_migrate_from_dict, mark_interrupted_jobs as _jobs_mark_interrupted
    _jobs_init_db()
except Exception:
    _jobs_migrate_from_dict = None
    _jobs_mark_interrupted = None

# Conversation Context Layer store (idempotent; feature-flagged at the call sites).
try:
    from app.domains.conversation.store import init_db as _conv_init_db
    _conv_init_db()
except Exception:
    _conv_init_db = None

# Debug log AI mode (không in ra API key thật)
print("=== AI MODE ===")
print("OLLAMA_HOST:", os.getenv("OLLAMA_HOST"))
print("GEMINI_API_KEY:", "SET" if os.getenv("GEMINI_API_KEY") else "MISSING")

# DATA_DIR quyết định index FAISS, cây nhớ, node log, checkpoint và hội thoại nằm
# ở đâu. Trỏ sai thì KHÔNG có lỗi nào nổ: app chạy bình thường, chỉ là đọc/ghi vào
# thư mục khác. Đã từng trỏ sang một dự án khác suốt nhiều tháng mà không ai biết,
# và chỉ lộ ra khi đi tìm node log không thấy đâu. In ra mỗi lần khởi động, kêu to
# khi nó nằm ngoài cây BE.
try:
    from shared.paths import BE_ROOT as _be_root

    _data_dir = Path(os.getenv("DATA_DIR") or _be_root).resolve()
    print("DATA_DIR:", _data_dir)
    if _data_dir != Path(_be_root).resolve():
        print(f"⚠️  [DATA_DIR] nằm NGOÀI {Path(_be_root).resolve()} — index, cây nhớ và "
              f"node log sẽ đọc/ghi ở đó, không phải trong repo này.")
except Exception as _exc:
    print("DATA_DIR: không xác định được —", _exc)

# Thiết bị chạy model PyTorch. In ra vì chênh lệch CPU/GPU ở đây là 30 lần
# (NLI đo được 298 giây/truy vấn trên CPU), mà trỏ sai không gây lỗi nào.
try:
    from shared.device import mo_ta as _mo_ta_thiet_bi

    print("TORCH_DEVICE:", _mo_ta_thiet_bi())
except Exception as _exc:
    print("TORCH_DEVICE: không xác định được —", _exc)

# CORS:
# - Mặc định giữ hành vi hiện tại (cho phép tất cả origins) để không phá flow/FE.
# - Khi deploy (Railway + Vercel) nên set CORS_ORIGINS để allowlist domain Vercel.
_cors_origins_raw = (os.environ.get("CORS_ORIGINS") or "*").strip()
if _cors_origins_raw == "*":
    _cors_origins: str | list[str] = "*"
else:
    _cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]

CORS(
    app,
    resources={r"/*": {"origins": _cors_origins}},
    # PATCH và PUT THIẾU ở đây cho tới 2026-09-01, và cách nó hỏng rất khó thấy:
    # preflight vẫn trả 200 nên log BE ghi "OPTIONS ... 200" trông như bình thường,
    # nhưng trình duyệt đọc `Access-Control-Allow-Methods`, không thấy method mình cần,
    # rồi CHẶN request thật trước khi gửi. `fetch` ném TypeError và giao diện báo
    # "Không kết nối được máy chủ" trong khi máy chủ vẫn sống nguyên.
    # Đo được trong log thật: 4 lần OPTIONS /api/attempts/<id>/answers, 0 lần PATCH.
    # Hai tính năng chết hoàn toàn qua trình duyệt: lưu nháp đáp án (PATCH) và lưu
    # mindmap đã sửa (PUT /mindmaps/<id>).
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    # "Authorization" for Bearer-token auth (no cookie credentials in this phase).
    allow_headers=["Content-Type", "Authorization"],
)


from shared.paths import BE_ROOT
BASE_DIR = BE_ROOT

DATA_DIR_DEFAULT = str(BASE_DIR)
DATA_DIR = Path(os.environ.get("DATA_DIR", DATA_DIR_DEFAULT))
INPUT_DOCS_DIR = Path(os.environ.get("INPUT_DOCS_DIR", str(DATA_DIR / "input_docs")))
INDEX_DIR = Path(os.environ.get("INDEX_DIR", str(DATA_DIR / "index")))
MEMORY_DIR = Path(os.environ.get("MEMORY_DIR", str(DATA_DIR / "memory")))

INPUT_DIR = str(INPUT_DOCS_DIR)
INDEX_META_JSON_PATH = INDEX_DIR / "index.json"
INDEX_FAISS_PATH = INDEX_DIR / "index.faiss"

# Thư mục lưu các artefact trí nhớ tầng cao (mindmap, summary, memory tree, ...)
MINDMAPS_PATH = MEMORY_DIR / 'mindmaps.json'
SUMMARIES_PATH = MEMORY_DIR / 'summaries.json'

os.makedirs(INPUT_DIR, exist_ok=True)
os.makedirs(MEMORY_DIR, exist_ok=True)
os.makedirs(INDEX_DIR, exist_ok=True)

# LangGraph ingest pipeline (Bước 2) sẽ được khởi tạo sau khi các helper (vd: _update_source_status) sẵn sàng.
INGEST_GRAPH = None
QUERY_GRAPH = None
SUMMARY_GRAPH = None
MINDMAP_GRAPH = None
QUERY_GRAPH_BUILD_ERROR: Optional[str] = None

_jobs_update_job = None
_jobs_create_job = None
_jobs_get_job = None
try:
    from app.domains.jobs.jobs_store import (
        update_job as _jobs_update_job,
        create_job as _jobs_create_job,
        get_job as _jobs_get_job,
    )
except Exception:
    pass


def _reconcile_jobs_safe():
    """Phase 5: queue-aware orphan reconciliation. QUEUE_ENABLED=false -> mark all
    active interrupted (today's behaviour); true -> only mark jobs absent from RQ
    registries (never kills a live worker job); RQ down -> touch nothing."""
    try:
        from app.jobs.queue import reconcile_interrupted
        reconcile_interrupted()
    except Exception:
        # fall back to the legacy single-process behaviour if the queue module fails
        try:
            if _jobs_mark_interrupted is not None:
                _jobs_mark_interrupted()
        except Exception:
            pass


_jobs_maintenance_last = 0.0
_jobs_maintenance_lock = threading.Lock()


def _run_jobs_maintenance(force: bool = False) -> None:
    """Retention + stuck-job sweep — rate-limited (JOB_SWEEP_INTERVAL_SECONDS=300)
    để piggyback rẻ trên status endpoint thay vì background thread (pattern
    _cleanup_old_query_jobs). Best-effort tuyệt đối: không bao giờ raise vào route."""
    global _jobs_maintenance_last
    try:
        interval = int((os.environ.get("JOB_SWEEP_INTERVAL_SECONDS") or "").strip() or 300)
    except ValueError:
        interval = 300
    now = time.time()
    with _jobs_maintenance_lock:
        if not force and (now - _jobs_maintenance_last) < interval:
            return
        _jobs_maintenance_last = now
    try:
        from app.domains.jobs.jobs_store import sweep_stuck_jobs, cleanup_terminal_jobs
        swept = sweep_stuck_jobs()
        # Sổ cái Postgres phải theo được cả bốn đường kết thúc KHÔNG đi qua `close_job`
        # (sweep / mark_interrupted / reconcile / request_cancel) — nếu không nó tồn
        # đọng hàng `running` vĩnh viễn. Chạy TRƯỚC prune: prune xoá hàng SQLite là mất
        # luôn thứ để đối chiếu.
        try:
            from app.domains.jobs import ledger as _ledger_sync
            _ledger_sync.dong_theo_jobs_store()
        except Exception:
            pass
        pruned = cleanup_terminal_jobs()
        from app.graphs.logger import cleanup_old_node_logs
        logs = cleanup_old_node_logs()
        # Export jobs are the only job type that write a FILE to disk;
        # cleanup_terminal_jobs() above only prunes the DB ROW, so without
        # this an export job's output would outlive its own job record
        # forever — see .playbook/known-issues.md's Section 7 audit entry.
        from app.domains.jobs import export_jobs as _export_jobs
        exported_files_pruned = _export_jobs.cleanup_terminal_export_files()
        if swept or pruned or logs or exported_files_pruned:
            print(f"jobs_maintenance swept={swept} pruned={pruned} logs={logs} export_files_pruned={exported_files_pruned}", flush=True)
    except Exception:
        pass


def _handle_sigterm(*_args):
    # best-effort: mark orphaned jobs interrupted (queue-aware) để tránh trạng thái mồ côi
    try:
        _reconcile_jobs_safe()
    finally:
        sys.exit(0)


signal.signal(signal.SIGTERM, _handle_sigterm)
signal.signal(signal.SIGINT, _handle_sigterm)

# Lightweight in-memory query cache (phù hợp offline, giảm gọi Ollama)
QUERY_CACHE_MAX_SIZE = int(os.environ.get("QUERY_CACHE_MAX_SIZE", "200"))
QUERY_CACHE_TTL_SEC = int(os.environ.get("CACHE_TTL_SEC", os.environ.get("QUERY_CACHE_TTL_SEC", "1800")))
_query_cache: "OrderedDict[str, dict]" = OrderedDict()
_query_cache_lock = threading.Lock()

# File lock để chặn rebuild đồng thời giữa nhiều gunicorn workers

# In-memory async job manager (giữ offline, nhẹ)
jobs: Dict[str, Dict[str, Any]] = {}
jobs_lock = threading.Lock()
JOB_TTL_MINUTES = int(os.environ.get("JOB_TTL_MINUTES", "30"))

# Migrate legacy in-memory jobs dict sang SQLite (idempotent, best-effort)
try:
    if _jobs_migrate_from_dict is not None:
        _jobs_migrate_from_dict(jobs, job_type="rebuild")
except Exception:
    pass

# Query async job store (separate from rebuild jobs)
query_jobs: Dict[str, Dict[str, Any]] = {}
query_jobs_lock = threading.Lock()
QUERY_JOB_TTL_MINUTES = int(os.environ.get("QUERY_JOB_TTL_MINUTES", "30"))
QUERY_JOB_TIMEOUT_SEC = int(os.environ.get("QUERY_JOB_TIMEOUT_SEC", str(5 * 60)))
QUERY_MAX_CONCURRENT = int(os.environ.get("QUERY_MAX_CONCURRENT", "4"))
_query_semaphore = threading.Semaphore(max(1, QUERY_MAX_CONCURRENT))

# Migrate legacy in-memory query_jobs dict sang SQLite (idempotent)
try:
    if _jobs_migrate_from_dict is not None:
        _jobs_migrate_from_dict(query_jobs, job_type="query")
except Exception:
    pass

def _cleanup_old_query_jobs() -> None:
    if QUERY_JOB_TTL_MINUTES <= 0:
        # The upload route owns the reservation until a durable job exists.
        # Raising lets it release the full budget instead of returning 202
        # with a reservation that no worker can ever finish.
        raise IngestQueueRequired("Ingest LangGraph unavailable")
    cutoff = time.time() - (QUERY_JOB_TTL_MINUTES * 60)
    with query_jobs_lock:
        expired = [
            jid for jid, j in query_jobs.items()
            if isinstance(j.get("created_at"), (int, float)) and j["created_at"] < cutoff
        ]
        for jid in expired:
            query_jobs.pop(jid, None)

def _make_query_cache_key(q: str, selected_sources: list, use_memory_tree: bool,
                          filters: dict | None = None, cache_scope: str = "public") -> str:
    # Normalize list để key ổn định theo thứ tự chọn
    # LƯU Ý: llm_cache.semantic_lookup/store PARSE JSON này (keys: q/sources/
    # use_memory_tree/category/language/cache_scope) — đổi format ở đây phải xem lại
    # app/domains/cache/llm_cache.py::_parse_cache_key (lệch = miss im lặng).
    # Phase E: cache_scope scopes the key per user under enforcement ("public" flag off /
    # old keys). The `sources` here are ALREADY the Phase-C resolved owned stems (or the
    # no-owned sentinel) — never the raw client selection — so a protected key can't be
    # forged with someone else's document set.
    sources_norm = selected_sources or []
    sources_norm = [str(s) for s in sources_norm if s is not None]
    sources_norm = sorted(sources_norm)
    f = filters or {}
    return json.dumps(
        {
            "q": (q or "").strip(),
            "sources": sources_norm,
            "use_memory_tree": bool(use_memory_tree),
            "category": (f.get("category") or None),
            "language": (f.get("language") or None),
            "cache_scope": str(cache_scope or "public"),
        },
        ensure_ascii=False,
        sort_keys=True
    )

def _get_cached_query(
    cache_key: str, *, usage_context=None,
    usage_attempt_id: str = "query-cache-judge:0",
) -> Optional[dict]:
    now = time.time()
    with _query_cache_lock:
        entry = _query_cache.get(cache_key)
        if entry:
            if now - entry["ts"] > QUERY_CACHE_TTL_SEC:
                _query_cache.pop(cache_key, None)
            else:
                _query_cache.move_to_end(cache_key)
                return entry["value"]
    # L2: semantic cache Redis (cross-worker, exact + cosine) — fail-open, None nếu miss/Redis chết.
    return llm_cache.semantic_lookup(
        cache_key,
        usage_context=usage_context,
        usage_attempt_id=usage_attempt_id,
    )

def _set_cached_query(cache_key: str, value: dict) -> None:
    # INVARIANT: answer rỗng không được vào L1 lẫn L2 — hit sau sẽ trả "Không có phản hồi."
    _p = value.get("payload") if isinstance(value, dict) else None
    if not (isinstance(_p, dict) and str(_p.get("answer") or "").strip()):
        llm_cache.METRICS["write_skipped_empty"] += 1
        return
    with _query_cache_lock:
        if cache_key in _query_cache:
            _query_cache.move_to_end(cache_key)
        _query_cache[cache_key] = {"ts": time.time(), "value": value}
        while len(_query_cache) > QUERY_CACHE_MAX_SIZE:
            _query_cache.popitem(last=False)
    # L2: ghi semantic cache (chỉ khi classify_risk cho phép) — fire-and-forget, fail-open.
    llm_cache.semantic_store(cache_key, value)


# ============================================================================
# Phase 3 — Single-flight / request coalescing (DR-3 D3)
# ----------------------------------------------------------------------------
# A storm of identical/equivalent questions with a COLD cache would each spawn a
# full RAG/LLM job (Phase 2 caps concurrency but does NOT coalesce). Single-flight
# elects ONE leader per (bucket + no-diacritics query) via a Redis SETNX lock;
# followers wait briefly and return the leader's cached answer. OPTIMIZATION ONLY:
# any Redis/lock miss/timeout/empty result → fail open to the normal path. It can
# never block or empty an answer. Runs in the BACKEND process, at job submit.
# ============================================================================
from app.clients import redis_client as _redis_client  # noqa: E402

_SF_RELEASE_LUA = (
    "if redis.call('get', KEYS[1]) == ARGV[1] then "
    "return redis.call('del', KEYS[1]) else return 0 end"
)

# Phase 0 observability: MirroredCounter = dict như cũ + mirror INCRBY lên Redis
# (fail-open) để /stats đọc được tổng cross-worker.
from app.clients.redis_client import MirroredCounter as _MirroredCounter

_SF_METRICS: Dict[str, int] = _MirroredCounter("sf", {
    "leader": 0, "follower": 0, "follower_hit": 0, "timeout": 0,
    "fail_open": 0, "bypass_unsafe": 0, "bypass_followup": 0, "bypass_disabled": 0,
    "redis_error_fail_open": 0, "dup_avoided": 0, "release_ok": 0, "release_fail": 0,
    # PR#4: follower nhả admission slot khi ngủ chờ leader / bị từ chối re-admit
    # lúc fail-open (slot đã bị request khác lấy trong lúc chờ).
    "follower_slot_released": 0, "follower_readmit_rejected": 0,
})


def _num_env(name: str, default: float) -> float:
    """Đọc một biến môi trường số, lùi về `default` nếu thiếu/hỏng. Dùng chung
    cho single-flight và overload — hai hệ thống trước đây định nghĩa RIÊNG
    hai bản y hệt nhau (`_sf_num`/`_ovl_num`); gộp một chỗ, giữ nguyên cả hai
    tên gọi cũ làm hàm bọc mỏng để không phải sửa các nơi đang gọi chúng."""
    try:
        return float((os.getenv(name) or "").strip() or default)
    except ValueError:
        return default


def _bool_env(name: str, default: bool) -> bool:
    """Đọc một biến môi trường boolean — cùng lý do gộp như `_num_env`. Hành vi
    đã CHẠY THẬT để đối chiếu với công thức cũ của `_sf_enabled`/`_ovl_bool`
    ở mọi trường hợp (thiếu biến, biến rỗng, giá trị lạ, giá trị false-like)
    — cùng kết quả ở tất cả. `pytest` đầy đủ không chạy được cục bộ trong
    phiên này (venv lệch phiên bản langchain so với requirements.txt, không
    liên quan tới thay đổi này), nhưng import trực tiếp `app.main` + gọi hàm
    vẫn chạy được (QUERY_GRAPH tự bắt lỗi import của nó, không chặn phần còn
    lại của module) — dùng đường đó để xác minh, không phải suy luận suông."""
    v = (os.getenv(name) or "").strip().lower()
    if not v:
        return default
    return v not in ("0", "false", "no", "off")


def _log_event(prefix: str, event: str, **kv: object) -> None:
    """In một dòng log `<prefix> <event> k=v ...` — cùng lý do gộp như trên."""
    parts = " ".join(f"{k}={v}" for k, v in kv.items())
    print(f"{prefix} {event} {parts}".rstrip(), flush=True)


def _sf_enabled() -> bool:
    return _bool_env("SINGLE_FLIGHT_ENABLED", True)


def _sf_num(name: str, default: float) -> float:
    return _num_env(name, default)


def _sf_log(event: str, **kv: object) -> None:
    _log_event("singleflight", event, **kv)


def _sf_nonempty(cached: Optional[dict]) -> bool:
    if not isinstance(cached, dict):
        return False
    p = cached.get("payload")
    return isinstance(p, dict) and bool(str(p.get("answer") or "").strip())


def _finalize_from_cache(jid: str, session_id: str, question: str, cached: dict,
                         *, source_ids: Optional[list] = None,
                         source_context_hash: Optional[str] = None,
                         user_id: Optional[str] = None, enforce_owner: bool = False) -> None:
    """Mark a follower job done using the leader's cached result. Atomic done+result
    (mirrors _finalize_query_job) — never sets done without the payload."""
    payload = cached.get("payload") if isinstance(cached, dict) else None
    payload = dict(payload) if isinstance(payload, dict) else {}
    status = int(cached.get("status") or 200) if isinstance(cached, dict) else 200
    result_obj = {"payload": payload, "status": status}
    with query_jobs_lock:
        if jid in query_jobs:
            query_jobs[jid]["status"] = "done"
            query_jobs[jid]["result"] = result_obj
    if _jobs_update_job:
        try:
            _jobs_update_job(jid, status="done", progress=100,
                             current_node="SingleFlightFollower", result=result_obj)
        except Exception:
            pass
    try:
        if payload.get("answer"):
            from app.domains.jobs.sessions_store import append_messages as _ss_append
            _ss_append(session_id, [
                {"role": "user", "content": question},
                {"role": "assistant", "content": str(payload.get("answer"))},
            ], user_id=user_id)
    except Exception:
        pass

    # Conversation Context Layer: record the follower's turn in its own session (flag-gated).
    try:
        if payload.get("answer"):
            cited = [c.get("chunk_id") for c in (payload.get("chunks") or []) if isinstance(c, dict) and c.get("chunk_id")]
            _save_conversation_turns(
                session_id, question, str(payload.get("answer")),
                source_ids=source_ids, source_context_hash=source_context_hash, cited_chunk_ids=cited or None,
                user_id=user_id, enforce_owner=enforce_owner,
            )
    except Exception:
        pass


def _single_flight_try(jid: str, question: str, sources: list, use_mem: bool,
                       category: Optional[str], language: Optional[str],
                       session_id: str, *, user_id: Optional[str] = None,
                       enforce_owner: bool = False, cache_scope: str = "public",
                       release_for_wait=None) -> dict:
    """Decide leader/follower/bypass for one query job. Returns:
      {"served": True}                    -> follower finalized from cache (skip graph)
      {"served": False, "lock": (k, tok)} -> leader (run graph, release lock after)
      {"served": False, "lock": None}     -> bypass or fail-open (run graph, no lock)
    Fail-open on ANY Redis/lock issue — never raises into the answer path.

    PR#4: release_for_wait (optional callable) được gọi ĐÚNG MỘT LẦN ngay trước
    khi follower vào vòng ngủ chờ leader — caller dùng để nhả query-admission
    slot (follower ngủ không được đốt slot của query thật). Leader/bypass/warm-hit
    KHÔNG gọi (các đường đó hoặc chạy graph ngay hoặc trả kết quả ngay).
    """
    if not _sf_enabled():
        _SF_METRICS["bypass_disabled"] += 1
        _sf_log("singleflight_disabled")
        return {"served": False, "lock": None}

    # Unsafe/private → never coalesce (respect cache risk policy).
    cacheable, risk = llm_cache.classify_risk(question)
    if not cacheable:
        _SF_METRICS["bypass_unsafe"] += 1
        _sf_log("singleflight_bypass_unsafe", risk=risk)
        return {"served": False, "lock": None}

    # Follow-up (context-specific) → don't coalesce (mirror cache_lookup behaviour).
    try:
        history = _get_session_history_safe(session_id, 8, user_id=user_id)
    except Exception:
        history = []
    if history and not llm_cache.is_standalone_question(question):
        _SF_METRICS["bypass_followup"] += 1
        return {"served": False, "lock": None}

    r = _redis_client.get_redis()
    if r is None:
        _SF_METRICS["redis_error_fail_open"] += 1
        _sf_log("singleflight_redis_error_fail_open", reason="unavailable")
        return {"served": False, "lock": None}

    # Phase E: user-scoped keys — A and B never coalesce or share a bucket under enforcement.
    sf_key = llm_cache.single_flight_key(question, sources, language, category, use_mem, cache_scope)
    if not sf_key:
        _SF_METRICS["bypass_unsafe"] += 1
        return {"served": False, "lock": None}
    try:
        _sf_sch = llm_cache.source_context_hash(sources, language, category, use_mem, cache_scope)
    except Exception:
        _sf_sch = None
    cache_key = _make_query_cache_key(question, sources, use_mem,
                                      {"category": category, "language": language}, cache_scope)

    # Warm cache already? Serve immediately, no lock needed.
    cached = _get_cached_query(cache_key)
    if _sf_nonempty(cached):
        _SF_METRICS["follower_hit"] += 1
        _SF_METRICS["dup_avoided"] += 1
        _sf_log("singleflight_follower_cache_hit", kind="warm")
        _finalize_from_cache(jid, session_id, question, cached, source_ids=sources, source_context_hash=_sf_sch, user_id=user_id, enforce_owner=enforce_owner)
        return {"served": True}

    token = uuid.uuid4().hex
    try:
        got = bool(r.set(sf_key, token, nx=True, ex=int(_sf_num("SINGLE_FLIGHT_LOCK_TTL_SECONDS", 180))))
    except Exception as exc:
        _redis_client.mark_unavailable()
        _SF_METRICS["redis_error_fail_open"] += 1
        _sf_log("singleflight_redis_error_fail_open", err=str(exc)[:80])
        return {"served": False, "lock": None}

    if got:
        _SF_METRICS["leader"] += 1
        _sf_log("singleflight_leader_acquired", key=sf_key[-24:])
        return {"served": False, "lock": (sf_key, token)}

    # Follower: poll for the leader's cached answer.
    _SF_METRICS["follower"] += 1
    _sf_log("singleflight_follower_waiting", key=sf_key[-24:])
    if release_for_wait is not None:
        try:
            release_for_wait()  # nhả admission slot TRƯỚC khi ngủ (PR#4)
        except Exception:
            pass
    poll = max(0.05, _sf_num("SINGLE_FLIGHT_POLL_INTERVAL_SECONDS", 0.5))
    deadline = time.time() + _sf_num("SINGLE_FLIGHT_WAIT_SECONDS", 120)
    while time.time() < deadline:
        time.sleep(poll)
        cached = _get_cached_query(cache_key)
        if _sf_nonempty(cached):
            _SF_METRICS["follower_hit"] += 1
            _SF_METRICS["dup_avoided"] += 1
            _sf_log("singleflight_follower_cache_hit", kind="leader")
            _finalize_from_cache(jid, session_id, question, cached, source_ids=sources, source_context_hash=_sf_sch, user_id=user_id, enforce_owner=enforce_owner)
            return {"served": True}
        # Leader vanished (errored/released) without a cached answer → fail open early,
        # but re-check cache once to close the write-then-release race.
        try:
            still_locked = bool(r.exists(sf_key))
        except Exception:
            _redis_client.mark_unavailable()
            break
        if not still_locked:
            cached = _get_cached_query(cache_key)
            if _sf_nonempty(cached):
                _SF_METRICS["follower_hit"] += 1
                _SF_METRICS["dup_avoided"] += 1
                _sf_log("singleflight_follower_cache_hit", kind="leader_race")
                _finalize_from_cache(jid, session_id, question, cached, source_ids=sources, source_context_hash=_sf_sch, user_id=user_id, enforce_owner=enforce_owner)
                return {"served": True}
            break

    _SF_METRICS["timeout"] += 1
    _SF_METRICS["fail_open"] += 1
    _sf_log("singleflight_follower_timeout_fail_open", key=sf_key[-24:])
    return {"served": False, "lock": None}


def _single_flight_release(key: str, token: str) -> None:
    """Release the leader lock (token compare-delete). Fail-open, never raises."""
    r = _redis_client.get_redis()
    if r is None:
        return
    try:
        r.eval(_SF_RELEASE_LUA, 1, key, token)
        _SF_METRICS["release_ok"] += 1
        _sf_log("singleflight_lock_release_success", key=key[-24:])
    except Exception as exc:
        _SF_METRICS["release_fail"] += 1
        _sf_log("singleflight_lock_release_failed", err=str(exc)[:80])


# ============================================================================
# Phase 4 — Ingress overload protection (DR-3: rate limit + readiness + shed)
# ----------------------------------------------------------------------------
# Redis token-bucket rate limit on /query, a /ready endpoint (503 when a load
# balancer should back off), and structured admission-full responses. All
# OPTIONAL and fail-open: rate limit is OFF by default and Redis errors never
# block traffic in dev. Never touches the answer path or single-flight/gateway.
# ============================================================================

# Token bucket: refill `rate` tokens/sec up to `cap`; spend 1 per request.
# KEYS[1]=bucket, ARGV=rate, cap, now, ttl. Returns {allowed(0/1), retry_after_s}.
_RL_LUA = """
local rate=tonumber(ARGV[1]); local cap=tonumber(ARGV[2])
local now=tonumber(ARGV[3]); local ttl=tonumber(ARGV[4])
local d=redis.call('HMGET',KEYS[1],'tokens','ts')
local tokens=tonumber(d[1]); local ts=tonumber(d[2])
if tokens==nil then tokens=cap; ts=now end
tokens=math.min(cap, tokens + math.max(0, now-ts)*rate)
local allowed=0; local retry=0
if tokens>=1 then tokens=tokens-1; allowed=1
else retry=math.ceil((1-tokens)/rate) end
redis.call('HMSET',KEYS[1],'tokens',tokens,'ts',now)
redis.call('EXPIRE',KEYS[1],ttl)
return {allowed, retry}
"""

_OVERLOAD_METRICS: Dict[str, int] = _MirroredCounter("overload", {
    "rate_limit_allowed": 0, "rate_limit_rejected": 0, "rate_limit_redis_error": 0,
    "admission_rejected": 0,
})


def _ovl_log(event: str, **kv: object) -> None:
    _log_event("overload", event, **kv)


def _ovl_bool(name: str, default: bool) -> bool:
    return _bool_env(name, default)


def _ovl_num(name: str, default: float) -> float:
    return _num_env(name, default)


def _client_ip() -> str:
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.remote_addr or "unknown"


def _rl_scope_id(session_id: str) -> str:
    scope = (os.getenv("RATE_LIMIT_SCOPE", "ip") or "ip").strip().lower()
    if scope in ("session", "user") and session_id:
        return f"sess:{session_id}"
    return f"ip:{_client_ip()}"


def _rate_limit_check(scope_id: str) -> tuple[bool, int]:
    """(allowed, retry_after_seconds). Fail-open unless RATE_LIMIT_REQUIRE_REDIS."""
    if not _ovl_bool("RATE_LIMIT_ENABLED", False):
        return True, 0
    require_redis = _ovl_bool("RATE_LIMIT_REQUIRE_REDIS", False)
    r = _redis_client.get_redis()
    if r is None:
        _OVERLOAD_METRICS["rate_limit_redis_error"] += 1
        if require_redis:
            return False, int(_ovl_num("RATE_LIMIT_WINDOW_SECONDS", 60))
        _ovl_log("rate_limit_redis_error_fail_open", reason="unavailable")
        return True, 0
    rate = _ovl_num("RATE_LIMIT_RPS", 1)
    cap = _ovl_num("RATE_LIMIT_BURST", 5)
    ttl = int(_ovl_num("RATE_LIMIT_WINDOW_SECONDS", 60))
    key = f"rl:{llm_cache._ENV}:{scope_id}"
    try:
        allowed, retry = r.eval(_RL_LUA, 1, key, rate, cap, time.time(), ttl)
    except Exception as exc:
        _redis_client.mark_unavailable()
        _OVERLOAD_METRICS["rate_limit_redis_error"] += 1
        if require_redis:
            return False, ttl
        _ovl_log("rate_limit_redis_error_fail_open", err=str(exc)[:60])
        return True, 0
    if int(allowed) == 1:
        _OVERLOAD_METRICS["rate_limit_allowed"] += 1
        _ovl_log("rate_limit_allowed", scope=scope_id[:48])
        return True, 0
    _OVERLOAD_METRICS["rate_limit_rejected"] += 1
    _ovl_log("rate_limit_rejected", scope=scope_id[:48], retry=int(retry))
    return False, int(retry)


def _rate_limited_response(retry_after: int):
    _ovl_log("overload_response_sent", kind="rate_limit", retry=retry_after)
    resp = jsonify({
        "error": "rate_limited",
        "message": "Too many requests. Please retry later.",
        "retry_after_seconds": int(retry_after),
    })
    resp.status_code = 429
    resp.headers["Retry-After"] = str(int(retry_after))
    return resp


def _admission_rejected_response():
    _OVERLOAD_METRICS["admission_rejected"] += 1
    retry = int(_ovl_num("ADMISSION_RETRY_AFTER_SECONDS", 5))
    _ovl_log("admission_rejected")
    _ovl_log("overload_response_sent", kind="admission", retry=retry)
    resp = jsonify({
        "error": "admission_rejected",
        "message": "Server is at capacity, please retry shortly.",
        "retry_after_seconds": retry,
    })
    resp.status_code = 429
    resp.headers["Retry-After"] = str(retry)
    return resp


def _admission_available() -> Optional[int]:
    """Best-effort free permits on this worker's admission semaphore (private attr)."""
    try:
        return int(getattr(_query_semaphore, "_value"))
    except Exception:
        return None


def _queue_stats_safe() -> dict:
    """Phase 5: RQ queue depth for /stats and /ready. Never raises."""
    try:
        from app.jobs.queue import queue_stats
        return queue_stats()
    except Exception as exc:  # noqa: BLE001
        return {"enabled": False, "error": str(exc)[:80]}


def _queue_depth_max() -> int:
    try:
        return int(os.getenv("QUEUE_DEPTH_MAX", "20"))
    except ValueError:
        return 20


def _readiness() -> tuple[bool, dict]:
    """Is this worker ready to accept meaningful traffic? Distinct from liveness."""
    redis_url = (os.getenv("REDIS_URL") or "").strip()
    r = _redis_client.get_redis()
    if r is None:
        redis_state = "down" if redis_url else "disabled"
    else:
        try:
            r.ping()
            redis_state = "ok"
        except Exception:
            _redis_client.mark_unavailable()
            redis_state = "down"
    avail = _admission_available()
    reasons = []
    if QUERY_GRAPH is None:
        reasons.append("graph_not_ready")
    if isinstance(avail, int) and avail <= 0:
        reasons.append("admission_saturated")
    if redis_state == "down" and _ovl_bool("RATE_LIMIT_REQUIRE_REDIS", False):
        reasons.append("redis_required_down")
    # Phase 5: shed when the RQ queue is backed up (only when queue mode is on).
    # Does NOT gate /query — the interactive path stays available regardless of backlog.
    qs = _queue_stats_safe()
    queue_depth = qs.get("queued_count")
    if qs.get("enabled") and isinstance(queue_depth, int) and queue_depth > _queue_depth_max():
        reasons.append("queue_full")
    # 2026-09-23: SKIP_MODEL_LOAD=1 leaked into the shared production .env and
    # silently no-op'd every LLM-gated stage (Guided V3 Stage 0/Enrich/Relations,
    # legacy V2's outline fallback, Summary, Memory Tree) for an unknown window —
    # no exception, no crash, `/health` even said `"mode":"ci"`. It's a
    # deliberate test/CI-only flag with no business being true on a process
    # PROCESS_ROLE marks as serving real traffic. Fail readiness loudly instead
    # of silently degrading every AI feature to a stub again.
    from app.domains.jobs.guided_store import _production_role
    if _production_role() and os.environ.get("SKIP_MODEL_LOAD") == "1":
        reasons.append("skip_model_load_in_production")
    ready = not reasons
    detail = {
        "status": "ready" if ready else "not_ready",
        "redis": redis_state,
        "llm_gateway": "unknown",  # future work: cheap gRPC health probe
        "query_graph_ready": QUERY_GRAPH is not None,
        "admission_available": avail if avail is not None else "unknown",
        "queue_enabled": bool(qs.get("enabled")),
        "queue_depth": queue_depth,
    }
    if reasons:
        detail["reason"] = ",".join(reasons)
    return ready, detail


@app.get('/ready')
def ready():
    ok, detail = _readiness()
    if ok:
        _ovl_log("readiness_check_ok")
        return jsonify(detail), 200
    _ovl_log("readiness_check_failed", reason=detail.get("reason"))
    return jsonify(detail), 503


@app.get('/')
def home():
    return 'MemvidX API is running.'

@app.get('/health')
def health():
    skip_model_load = os.environ.get("SKIP_MODEL_LOAD") == "1"
    payload: Dict[str, Any] = {
        "status": "ok",
        "mode": "ci" if skip_model_load else "normal",
        "query_graph_ready": QUERY_GRAPH is not None,
        "ingest_graph_ready": INGEST_GRAPH is not None,
    }
    err = globals().get("QUERY_GRAPH_BUILD_ERROR")
    if err:
        payload["query_graph_error"] = err[:800]
    # 2026-09-23: SKIP_MODEL_LOAD=1 leaked into the shared production .env for
    # an unknown window and silently stubbed out every LLM-gated feature with
    # no crash. `/health` said "ok" the whole time -- keep it 200 here (Docker's
    # healthcheck + scripts/health.sh gate deploys on this exact endpoint, and
    # this guard has not been through that gating path yet), but make the
    # misconfiguration impossible to miss. /ready fails closed on this same
    # condition for callers that do act on non-200.
    if skip_model_load:
        from app.domains.jobs.guided_store import _production_role
        if _production_role():
            payload["warning"] = ("SKIP_MODEL_LOAD=1 is active on a production-role process "
                                  "(PROCESS_ROLE/AUTH_PROTECT_APP_APIS) -- every LLM-gated "
                                  "feature is silently running in stub/no-op mode.")
    return jsonify(payload), 200


# -------------------------
# 🔐 Auth MVP (Bearer token) — register / login / logout / me
# Additive; existing app APIs stay OPEN in this phase (no @require_auth applied).
# -------------------------
@app.post('/auth/register')
def auth_register():
    from app.domains.auth import gioi_han as _gh
    from app.domains.auth import service as _auth
    from app.domains.auth import tokens as _tokens
    from app.domains.auth import users_store as _users

    # Trần theo IP, không theo email: email ở đây là thứ người gọi tự chọn, nên khoá
    # theo nó là để họ tự đặt khoá mới mỗi lần thử. IP là thứ duy nhất họ không đổi
    # được miễn phí.
    khoa_ip = f"register:ip:{_client_ip()}"
    duoc, cho = _gh.cho_phep(khoa_ip)
    if not duoc:
        return _rate_limited_response(cho)

    data = request.json or {}
    email = data.get("email") or ""
    password = data.get("password") or ""
    display_name = data.get("display_name")
    if not _auth.valid_email(email):
        return jsonify({"error": "invalid_email"}), 400
    if not _auth.valid_password(password):
        return jsonify({"error": "weak_password", "message": "Mật khẩu cần ít nhất 8 ký tự."}), 400
    try:
        user = _users.create_user(email, password, display_name)
    except _users.EmailExistsError:
        # Email đã tồn tại LÀ một lần thất bại đáng đếm: lặp lại nó chính là phép dò
        # xem địa chỉ nào đã đăng ký.
        _gh.ghi_that_bai(khoa_ip)
        return jsonify({"error": "email_exists"}), 409
    _gh.xoa(khoa_ip)
    token = _tokens.make_token(user)
    ho_so = _auth.public_user(user)
    ho_so["provider"] = "local"          # đăng ký luôn tạo tài khoản local
    return jsonify({"token": token, "user": ho_so}), 201


def _khoa_dinh_danh(tien_to: str, dinh_danh: str) -> str:
    """Khoá bộ đếm theo định danh người dùng gõ.

    CẮT NGẮN và hạ chữ thường vì `gioi_han` chặn SỐ LƯỢNG khoá chứ không chặn ĐỘ DÀI
    khoá: một định danh 10 KB gửi lặp lại sẽ nở bộ nhớ dù số khoá vẫn dưới trần.
    Hạ chữ thường để "A@b.c" và "a@b.c" đếm chung — nếu không thì đổi kiểu chữ là
    lách được trần.
    """
    return f"{tien_to}:{(dinh_danh or '').strip().lower()[:120]}"


#: Tên provider ngoài, lấy từ lõi thay vì gõ lại chuỗi ở tầng route.
from app.application.auth import NKS as _app_auth_NKS


#: Lỗi đăng nhập → (mã HTTP, mã lỗi máy đọc được). `invalid_credentials`/401 giữ
#: NGUYÊN như trước khi có provider: frontend đang map đúng chuỗi đó sang câu tiếng
#: Việt, đổi là vỡ màn hình đăng nhập.
_LOI_DANG_NHAP = {
    "InvalidCredentials": (401, "invalid_credentials"),
    "InvalidProvider": (400, "invalid_provider"),
    "ProviderNotEnabled": (400, "provider_not_enabled"),
    "ProviderUnavailable": (503, "provider_unavailable"),
    "ProviderProtocolError": (502, "provider_protocol_error"),
    "IdentityNotLinked": (409, "identity_not_linked"),
}


@app.post('/auth/login')
def auth_login():
    from app.application import auth as _app_auth
    from app.domains.auth import service as _auth
    from app.domains.auth import tokens as _tokens
    data = request.json or {}
    # Định danh: `email` là trường cũ và vẫn là trường CHÍNH. `username` chấp nhận
    # thêm vì NKS định danh người dùng bằng username, không phải email — nhưng nó chỉ
    # là đường dự phòng, KHÔNG bắt buộc cho local (yêu cầu: local không cần trường
    # riêng của provider nào).
    email = data.get("email") or data.get("username") or ""
    password = data.get("password") or ""
    # `provider` là TUỲ CHỌN. Vắng mặt = "local" = đúng hành vi cũ, nên frontend
    # hiện tại (chỉ gửi {email, password}) không phải sửa gì.
    provider = (data.get("provider") or _app_auth.LOCAL)
    # Reuse the Phase-4 token-bucket limiter (off by default; fail-open).
    allowed, retry_after = _rate_limit_check(f"login:{_client_ip()}")
    if not allowed:
        return _rate_limited_response(retry_after)

    # Trần Redis-free, LUÔN bật. Cái ở trên chạy trên Redis, mà production đặt
    # `REDIS_URL=""` và không bật `RATE_LIMIT_ENABLED`, nên nó fail-open — nghĩa là
    # trước bản này `/auth/login` KHÔNG có trần nào. Với `provider=nks` đó là một máy
    # dò mật khẩu không cần đăng nhập, nhắm vào hệ thống của người khác.
    #
    # Hai khoá: IP chặn một nguồn quét nhiều tài khoản; định danh chặn nhiều nguồn
    # cùng dò MỘT tài khoản. Thiếu khoá định danh thì một botnet chia đều theo IP sẽ
    # đi qua trần mà không chạm vào nó.
    from app.domains.auth import gioi_han as _gh
    khoa_ip = f"login:ip:{_client_ip()}"
    khoa_dinh_danh = _khoa_dinh_danh("login:identifier", email)
    for k in (khoa_ip, khoa_dinh_danh):
        duoc, cho = _gh.cho_phep(k)
        if not duoc:
            return _rate_limited_response(cho)

    try:
        user = _app_auth.dang_nhap(email, password, provider)
    except _app_auth.AuthError as exc:
        # Generic error for bad credentials — no user enumeration.
        ma_http, ma_loi = _LOI_DANG_NHAP.get(type(exc).__name__, (401, "invalid_credentials"))
        if ma_http == 401:
            # CHỈ đếm lỗi credential. Provider sập (503) hay cấu hình sai (400) không
            # phải lỗi của người đang gõ; tính vào trần sẽ khoá người dùng thật vì một
            # sự cố họ không gây ra.
            _gh.ghi_that_bai(khoa_ip)
            _gh.ghi_that_bai(khoa_dinh_danh)
        return jsonify({"error": ma_loi}), ma_http

    _gh.xoa(khoa_ip)
    _gh.xoa(khoa_dinh_danh)
    token = _tokens.make_token(user)
    # `provider` đi kèm ngay từ phản hồi đăng nhập, không đợi `/auth/me`: nếu thiếu,
    # giao diện sẽ ẩn hết phần dành cho NKS cho tới lần tải trang kế tiếp. Giá trị lấy
    # từ đường xác thực VỪA chạy, không phải từ thứ client khai.
    ho_so = _auth.public_user(user)
    ho_so["provider"] = (provider or _app_auth.LOCAL).strip().lower()
    return jsonify({"token": token, "user": ho_so}), 200


@app.post('/auth/logout')
def auth_logout():
    # Stateless: the client drops the token. (No token_version bump = not logout-all.)
    # Nhưng chứng từ ghi NKS thì có trạng thái ở máy chủ, nên nó phải chết ở đây —
    # nếu không, một token NKS còn sống thêm tối đa 10 phút sau khi người dùng đã
    # chủ động đăng xuất. Token StudyMap hỏng/hết hạn ⇒ không biết là ai ⇒ không dọn
    # được gì, và hạn tuyệt đối của chứng từ vẫn là hàng rào cuối.
    from app.domains.auth import grants as _grants
    from app.domains.auth import service as _auth
    user = _auth.current_user_from_request()
    if user is not None:
        _grants.xoa_cua_user(str(user["user_id"]))
    return jsonify({"ok": True}), 200


#: Lỗi khi cấp chứng từ ghi → (mã HTTP, mã lỗi). `GrantKhongKhopDanhTinh` cố ý dùng
#: CHUNG mã với sai mật khẩu: phân biệt hai ca đó là nói cho người gọi biết một tài
#: khoản NKS nào đó có tồn tại và đã liên kết với ai.
_LOI_GRANT = {
    "InvalidCredentials": (401, "invalid_credentials"),
    "GrantKhongKhopDanhTinh": (401, "invalid_credentials"),
    "InvalidProvider": (400, "invalid_provider"),
    "ProviderNotEnabled": (400, "provider_not_enabled"),
    "ProviderUnavailable": (503, "provider_unavailable"),
    "ProviderProtocolError": (502, "provider_protocol_error"),
}


@app.post('/auth/nks/grant')
def auth_nks_grant_tao():
    """Đổi mật khẩu provider ngoài lấy chứng từ ghi ngắn hạn (10 phút, chỉ trong RAM).

    KHÔNG bao giờ trả chứng chỉ của provider ra ngoài. Thứ đi ra là một `grant_id`
    ngẫu nhiên 256 bit, vô nghĩa nếu không kèm token StudyMap của đúng chủ nhân.
    """
    from app.application import auth as _app_auth
    from app.domains.auth import gioi_han as _gh
    from app.domains.auth import service as _auth

    # Không dùng `_require_app_user`: nó trả (None, None) khi AUTH_PROTECT_APP_APIS
    # tắt. Đường này cầm mật khẩu của một hệ thống khác — không có chế độ mở.
    user = _auth.current_user_from_request()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401
    uid = str(user["user_id"])

    data = request.json or {}
    identifier = data.get("identifier") or data.get("username") or ""
    password = data.get("password") or ""

    # Trần theo NGƯỜI DÙNG và theo IP: người dùng chặn dò mật khẩu của một tài khoản,
    # IP chặn quét nhiều tài khoản từ một chỗ.
    khoa_user, khoa_ip = f"grant:u:{uid}", f"grant:ip:{_client_ip()}"
    for k in (khoa_user, khoa_ip):
        duoc, cho = _gh.cho_phep(k)
        if not duoc:
            return _rate_limited_response(cho)

    try:
        grant_id, het_han = _app_auth.mo_grant_ghi(uid, identifier, password)
    except _app_auth.AuthError as exc:
        ma_http, ma_loi = _LOI_GRANT.get(type(exc).__name__, (401, "invalid_credentials"))
        if ma_http == 401:
            # Chỉ đếm lỗi CREDENTIAL. NKS sập không phải lỗi của người đang gõ, và
            # tính vào trần sẽ khoá luôn người dùng thật vì sự cố phía provider.
            _gh.ghi_that_bai(khoa_user)
            _gh.ghi_that_bai(khoa_ip)
        return jsonify({"error": ma_loi}), ma_http

    _gh.xoa(khoa_user)
    _gh.xoa(khoa_ip)
    return jsonify({"grant_id": grant_id, "expires_at": int(het_han)}), 201


@app.delete('/auth/nks/grant')
def auth_nks_grant_xoa():
    """Chủ nhân tự thu hồi chứng từ. Idempotent, và không đụng được của người khác."""
    from app.domains.auth import grants as _grants
    from app.domains.auth import service as _auth

    user = _auth.current_user_from_request()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401

    data = request.json if request.is_json else None
    grant_id = (data or {}).get("grant_id") or ""
    uid = str(user["user_id"])
    # Không có `grant_id` ⇒ thu hồi tất cả của chính mình. Không bao giờ nói cho
    # người gọi biết có thật sự tồn tại chứng từ nào hay không.
    if grant_id:
        _grants.xoa(str(grant_id), uid)
    else:
        _grants.xoa_cua_user(uid)
    return jsonify({"ok": True}), 200


@app.post('/auth/logout-all')
def auth_logout_all():
    """Đăng xuất khỏi MỌI thiết bị: tăng `token_version` ⇒ mọi token đang phát chết.

    Vì sao cần một endpoint riêng thay vì sửa `/auth/logout`: `/auth/logout` là đường
    đi hàng ngày và phải giữ nguyên nghĩa "rời khỏi trình duyệt NÀY" — đá luôn điện
    thoại của người dùng mỗi lần họ đóng tab trên máy tính là một hành vi không ai xin.

    Vì sao cần TỒN TẠI: trước endpoint này, `bump_token_version` chỉ có ĐÚNG MỘT nơi
    gọi — luồng đổi mật khẩu NKS. Nghĩa là người dùng local bị lộ token không có cách
    nào thu hồi nó: đăng xuất không đụng tới `token_version`, `/auth/refresh` cấp lại
    token mới vô hạn từ một token còn hạn, và không có luồng đổi mật khẩu local nào.
    Token rò rỉ là token vĩnh viễn, trừ khi sửa tay trong database.

    `/auth/refresh` KHÔNG phải sửa gì: nó đã đối chiếu `tv` với hàng users ở mỗi lần
    gọi, nên sau khi tăng thì mọi token cũ — kể cả token vừa dùng để gọi chính endpoint
    này — không refresh được nữa. Đó là ý đồ.

    Idempotent theo nghĩa dùng được: gọi lại chỉ tăng tiếp và vẫn trả 200. Không có
    trạng thái nào để hỏng, và người dùng bấm hai lần không gặp lỗi.
    """
    from app.domains.auth import grants as _grants
    from app.domains.auth import service as _auth
    from app.domains.auth import users_store as _users

    user = _auth.current_user_from_request()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401
    uid = str(user["user_id"])

    # Chứng từ ghi chết TRƯỚC: nó giữ một access token của provider ngoài, và một lần
    # "đăng xuất mọi nơi" mà để lại credential đó thì chưa thu hồi được gì cả. Dùng
    # đúng hàm mà `/auth/logout` vẫn dùng — không có ngữ nghĩa chứng từ nào bị đổi.
    _grants.xoa_cua_user(uid)
    _users.bump_token_version(uid)
    return jsonify({"ok": True, "revoked_all": True}), 200


@app.post('/auth/refresh')
def auth_refresh():
    """Đổi token còn hạn lấy token mới (đặc tả 12.1 `POST /api/auth/refresh`).

    Stateless: không có refresh-token riêng, chỉ cấp lại access token khi token
    hiện tại còn hợp lệ VÀ token_version còn khớp. Token đã thu hồi (logout-all)
    không refresh được.
    """
    from app.domains.auth import service as _auth
    from app.domains.auth import tokens as _tokens
    user = _auth.current_user_from_request()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401
    from app.domains.auth import identities_store as _idents
    ho_so = _auth.public_user(user)
    lien_ket = _idents.find_by_user(_app_auth_NKS, str(user["user_id"]))
    ho_so["provider"] = lien_ket["provider"] if lien_ket else "local"
    return jsonify({"token": _tokens.make_token(user), "user": ho_so}), 200


@app.get('/auth/me')
def auth_me():
    """Người dùng của phiên hiện tại, KÈM provider ngoài đã liên kết (nếu có).

    `provider` phải đi cùng ở đây vì giao diện dùng nó để quyết định hiển thị: chỉ
    người dùng NKS mới có mật khẩu NKS để đổi và hồ sơ NKS để sửa. Không có trường
    này thì `dungHoSo()` luôn thấy `undefined`, và mọi phần dành cho NKS — nút "Chỉnh
    sửa", mục "Đổi mật khẩu" — bị ẩn với TẤT CẢ mọi người, kể cả người dùng NKS.

    Suy ra từ bảng `identities`, KHÔNG lấy từ thứ client tự khai: đây là dữ liệu chỉ
    máy chủ mới biết chắc, và nó quyết định người dùng thấy được đường ghi nào.

    Một truy vấn thêm cho mỗi lần gọi, đi qua `ix_identities_user_id`. Không có thì
    không có cách nào để trang biết được điều này sau khi tải lại.
    """
    from app.domains.auth import identities_store as _idents
    from app.domains.auth import service as _auth
    user = _auth.current_user_from_request()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401

    ho_so = _auth.public_user(user)
    lien_ket = _idents.find_by_user(_app_auth_NKS, str(user["user_id"]))
    ho_so["provider"] = lien_ket["provider"] if lien_ket else "local"
    return jsonify({"user": ho_so}), 200


#: Lỗi hồ sơ → (mã HTTP, mã lỗi). `grant_required` là mã FE dựa vào để bật lại hộp
#: thoại xác minh — và để GIỮ NGUYÊN những gì người dùng đang gõ dở.
_LOI_HO_SO = {
    "GrantKhongHopLe": (409, "grant_required"),
    "AnhQuaLon": (413, "image_too_large"),
    "AnhKhongHopLe": (400, "invalid_image"),
    "TruongKhongSuaDuoc": (400, "invalid_field"),
    "InvalidProvider": (400, "invalid_provider"),
    "ProviderNotEnabled": (400, "provider_not_enabled"),
    "ProviderUnavailable": (503, "provider_unavailable"),
    "ProviderProtocolError": (502, "provider_protocol_error"),
}


def _grant_id_tu_request() -> str:
    """Chứng từ đi ở HEADER, không phải trong URL: query string nằm trong log truy cập
    của proxy, còn header thì không."""
    return (request.headers.get("X-Grant-Id") or "").strip()


def _ho_so_response(fn):
    from app.application import profile as _profile

    user = _auth_service().current_user_from_request()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401
    grant_id = _grant_id_tu_request()
    if not grant_id:
        return jsonify({"error": "grant_required"}), 409
    try:
        ho_so = fn(str(user["user_id"]), grant_id)
    except _profile.AuthError as exc:
        ma_http, ma_loi = _LOI_HO_SO.get(type(exc).__name__, (502, "provider_protocol_error"))
        return jsonify({"error": ma_loi}), ma_http
    # `to_dict` là danh sách trắng: phản hồi thật của provider có 56 trường, trong đó
    # có token kích hoạt và ảnh giấy tờ tuỳ thân. Không bao giờ chuyển tiếp cả object.
    return jsonify({"profile": ho_so.to_dict()}), 200


def _auth_service():
    from app.domains.auth import service as _auth

    return _auth


@app.get('/me/nks/profile')
def me_nks_profile_doc():
    """Hồ sơ hiện tại ở provider ngoài. Cần chứng từ ghi còn hạn."""
    from app.application import profile as _profile

    return _ho_so_response(lambda uid, gid: _profile.doc_ho_so(uid, gid))


@app.patch('/me/nks/profile')
def me_nks_profile_ghi():
    """Ghi các trường được phép, rồi trả về hồ sơ ĐỌC LẠI từ provider.

    Provider chỉ trả một boolean khi ghi, nên bản hồ sơ đi ra đây luôn là bản vừa đọc
    lại — không phải thứ vừa gửi lên.
    """
    from app.application import profile as _profile

    thay_doi = request.json if request.is_json else None
    if not isinstance(thay_doi, dict):
        return jsonify({"error": "invalid_field"}), 400
    return _ho_so_response(lambda uid, gid: _profile.cap_nhat_ho_so(uid, gid, thay_doi))


@app.put('/me/nks/avatar')
def me_nks_avatar_ghi():
    """Đổi ảnh đại diện: chuẩn hoá ảnh → ghi sang provider → đọc lại → trả hồ sơ mới.

    Nhận multipart. Trần byte của ẢNH được chặn ở ĐÂY, không phải ở
    `MAX_CONTENT_LENGTH`: mốc đó là 100 MB dùng chung cho upload tài liệu, rộng gấp
    ~50 lần trần ảnh nên nó chỉ chặn được ca cực đoan. Hàng rào thật là `read(trần+1)`
    ngay dưới — đo dữ liệu THẬT, không tin `Content-Length` client khai — rồi
    `chuan_hoa` chặn lần nữa trên chính byte đó.
    """
    from app.application import profile as _profile
    from app.domains.media import anh_dai_dien as _anh

    user = _auth_service().current_user_from_request()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401
    grant_id = _grant_id_tu_request()
    if not grant_id:
        return jsonify({"error": "grant_required"}), 409

    tep = request.files.get("avatar")
    if tep is None:
        return jsonify({"error": "invalid_image"}), 400

    # Đọc TỐI ĐA trần + 1 byte. Đọc thêm đúng một byte là đủ để biết "còn nữa" mà
    # không kéo cả file khổng lồ vào RAM chỉ để rồi từ chối nó.
    raw = tep.read(_anh.GIOI_HAN_BYTE + 1)
    if len(raw) > _anh.GIOI_HAN_BYTE:
        return jsonify({"error": "image_too_large"}), 413

    try:
        ho_so = _profile.cap_nhat_anh_dai_dien(str(user["user_id"]), grant_id, raw)
    except (_anh.AnhQuaLon, _anh.AnhKhongHopLe) as exc:
        # Thông điệp của các lớp này chỉ mang con số/tên định dạng, không mang nội
        # dung ảnh — nhưng vẫn KHÔNG trả `str(exc)` ra ngoài, chỉ trả mã.
        ma_http, ma_loi = _LOI_HO_SO.get(type(exc).__name__, (400, "invalid_image"))
        return jsonify({"error": ma_loi}), ma_http
    except _profile.AuthError as exc:
        ma_http, ma_loi = _LOI_HO_SO.get(type(exc).__name__, (502, "provider_protocol_error"))
        return jsonify({"error": ma_loi}), ma_http
    return jsonify({"profile": ho_so.to_dict()}), 200


#: Lỗi đổi mật khẩu → (mã HTTP, mã lỗi). `InvalidCredentials` và
#: `KhongPhaiNguoiDungProvider` cố ý DÙNG CHUNG mã: phân biệt chúng là nói cho người
#: gọi biết một tài khoản NKS nào đó có tồn tại và đã liên kết với ai.
_LOI_MAT_KHAU = {
    "MatKhauKhongHopLe": (400, "invalid_password"),
    "InvalidCredentials": (401, "invalid_credentials"),
    "KhongPhaiNguoiDungProvider": (401, "invalid_credentials"),
    "InvalidProvider": (400, "invalid_provider"),
    "ProviderNotEnabled": (400, "provider_not_enabled"),
    "ProviderUnavailable": (503, "provider_unavailable"),
    "ProviderProtocolError": (502, "provider_protocol_error"),
}


@app.post('/me/nks/password')
def me_nks_password_doi():
    """Đổi mật khẩu NKS. KHÔNG dùng chứng từ ghi — tự đăng nhập bằng mật khẩu cũ.

    Thành công ⇒ mọi token StudyMap của người này bị vô hiệu (`token_version` tăng),
    nên FE phải dọn phiên và đưa về màn hình đăng nhập.
    """
    from app.application import mat_khau as _mk
    from app.domains.auth import gioi_han as _gh

    user = _auth_service().current_user_from_request()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401
    uid = str(user["user_id"])

    data = request.json if request.is_json else None
    if not isinstance(data, dict):
        return jsonify({"error": "invalid_password"}), 400

    # Cùng bộ đếm Redis-free với đường cấp chứng từ, khoá riêng: đây là một endpoint
    # nhận mật khẩu của HỆ THỐNG KHÁC, không có trần thì nó là máy dò mật khẩu.
    khoa_user, khoa_ip = f"pass:u:{uid}", f"pass:ip:{_client_ip()}"
    for k in (khoa_user, khoa_ip):
        duoc, cho = _gh.cho_phep(k)
        if not duoc:
            return _rate_limited_response(cho)

    try:
        _mk.doi_mat_khau(
            uid,
            data.get("identifier") or "",
            data.get("old_password") or "",
            data.get("password") or "",
            data.get("password_confirmation") or "",
        )
    except _mk.MatKhauKhongHopLe as exc:
        # Thông điệp này CHỈ nói về hình dạng dữ liệu ("xác nhận không khớp"), không
        # tiết lộ gì về tài khoản — nên trả ra được, và trả ra thì hữu ích hơn nhiều.
        return jsonify({"error": "invalid_password", "message": str(exc)}), 400
    except _mk.AuthError as exc:
        ma_http, ma_loi = _LOI_MAT_KHAU.get(type(exc).__name__, (502, "provider_protocol_error"))
        if ma_http == 401:
            # CHỈ đếm lỗi credential. NKS sập không phải lỗi của người đang gõ, và
            # tính vào trần sẽ khoá người dùng thật vì sự cố phía provider.
            _gh.ghi_that_bai(khoa_user)
            _gh.ghi_that_bai(khoa_ip)
        return jsonify({"error": ma_loi}), ma_http

    _gh.xoa(khoa_user)
    _gh.xoa(khoa_ip)
    # `reauth_required` là hợp đồng với FE: dọn token + state rồi về trang đăng nhập.
    return jsonify({"ok": True, "reauth_required": True}), 200


@app.get('/stats')
def stats():
    # Phase D: /stats exposes GLOBAL, cross-user metrics (index size, cache/queue/
    # single-flight counters) — internal/admin surface. No admin role exists yet, so the
    # MVP rule is authenticated-only when protected; true admin-only gating is future work.
    _uid, err = _require_app_user()
    if err:
        return err
    # index meta: key là chunk_id (số dạng string). Các key không phải số được coi là metadata nội bộ.
    num_chunks = 0
    video_stems: set[str] = set()

    try:
        if INDEX_META_JSON_PATH.exists():
            with open(INDEX_META_JSON_PATH, encoding="utf-8") as f:
                meta = json.load(f)
        else:
            meta = {}
    except Exception as exc:
        print(f"[STATS] Failed to read index meta: {exc}")
        meta = {}

    for k, m in (meta or {}).items():
        if not isinstance(k, str) or not k.isdigit():
            continue
        num_chunks += 1
        src_raw = (m.get("source_stem") or "").strip() if isinstance(m, dict) else ""
        if src_raw:
            stem = _normalize_video_stem(src_raw)
            if stem:
                video_stems.add(stem)

    # num_documents ~ số lượng source stem có trong index
    num_documents = len(video_stems)

    return jsonify({
        "num_documents": num_documents,
        "num_chunks": num_chunks,
        # Counter per-worker (gunicorn); aggregate thật xem redis-cli INFO stats.
        "cache": llm_cache.stats(),
        # Phase 3 single-flight counters (per-worker). duplicate_llm_calls_avoided ~= dup_avoided.
        "single_flight": {**_SF_METRICS, "enabled": _sf_enabled()},
        # Phase 4 overload/circuit view (per-worker). LLM busy/timeout lives in gateway logs (future).
        "overload": {
            **_OVERLOAD_METRICS,
            "rate_limit_enabled": _ovl_bool("RATE_LIMIT_ENABLED", False),
            "admission_available": _admission_available(),
            "admission_capacity": QUERY_MAX_CONCURRENT,
        },
        # Phase 5 RQ queue depth (fail-open; zeros when QUEUE_ENABLED=false or Redis down).
        "queue": _queue_stats_safe(),
        # Phase 0 observability: LLM invocations (per-worker; cache hit không đếm).
        "llm": {"calls_local": _llm_calls_total_safe()},
        # Cross-worker totals mirrored via Redis INCRBY; None khi Redis vắng/hỏng
        # (fail-open — client rơi về các counter local per-worker phía trên).
        "aggregate": _metric_totals_safe(),
    }), 200


def _llm_calls_total_safe() -> int:
    try:
        from app.graphs.logger import llm_calls_total
        return llm_calls_total()
    except Exception:
        return 0


def _metric_totals_safe():
    try:
        from app.clients.redis_client import metric_totals
        return metric_totals({
            "sf": list(_SF_METRICS.keys()),
            "overload": list(_OVERLOAD_METRICS.keys()),
            "cache": list(llm_cache.METRICS.keys()),
            "llm": ["calls"],
        })
    except Exception:
        return None


@app.get('/jobs/<job_id>/timeline')
def job_timeline(job_id: str):
    """Phase 0 observability — timeline read-only cho MỘT job từ logs.sqlite
    node_logs. Cùng contract auth/owner với /summary-status: job lạ và job của
    user khác đều 404 (no existence oracle). Logs DB hỏng/vắng → events []."""
    uid, err = _require_app_user()
    if err:
        return err
    try:
        return jsonify(jobs_uc.dong_thoi_gian(
            job_id, uid, bat_buoc_chu_so_huu=_auth_protect_enabled())), 200
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


# -------------------------
# 📋 Source Registry (tracking upload status)
# -------------------------
def _load_source_registry() -> Dict[str, Dict]:
    """Bảng `documents` (Postgres) — thay `index/source_registry.json` từ Phase 2.

    Giữ nguyên tên + shape trả về để mọi call site cũ (owned_stems, ownership
    check, /list-indexed, delete) không phải viết lại. Lỗi DB → {} (fail-open y
    như bản JSON cũ khi file hỏng).
    """
    try:
        from app.domains.documents import repository as _docs
        return _docs.all_rows()
    except Exception as exc:
        print(f"⚠️ Không đọc được bảng documents: {exc}")
        return {}


def _auth_protect_enabled() -> bool:
    return (os.getenv("AUTH_PROTECT_APP_APIS", "false") or "").strip().lower() in ("1", "true", "yes", "on")


def _current_user_id() -> Optional[str]:
    """Resolve the caller's user_id from the Bearer token, or None. Fail-safe:
    any error → None (never raises into a route)."""
    try:
        from app.domains.auth import service as _auth
        user = _auth.current_user_from_request()
        return user.get("user_id") if user else None
    except Exception:
        return None


def _require_app_user():
    """Auth gate for protected app routes. Returns (user_id, error_response).

    Flag OFF → (None, None): allow, open/backward-compatible.
    Flag ON  → (user_id, None) for a valid token, else (None, 401 response).
    The ownership resolution here is deliberately OUTSIDE any fail-open block —
    an auth failure denies (fail-closed), it never downgrades to open."""
    if not _auth_protect_enabled():
        return None, None
    uid = _current_user_id()
    if not uid:
        return None, (jsonify({"error": "unauthorized"}), 401)
    return uid, None


def _require_usage_user():
    """Usage is never fail-open: quota and ledger responses require ownership."""
    uid = _current_user_id()
    if not uid:
        return None, (jsonify({"error": "unauthorized"}), 401)
    return str(uid), None


def _reserve_usage_context(
    user_id: Optional[str],
    *,
    feature: str,
    operation: str,
    idempotency_key: str,
    request_id: Optional[str] = None,
    job_id: Optional[str] = None,
    lease_owner: Optional[str] = None,
):
    """Reserve one user operation and return its explicit, serializable context."""
    if not user_id:
        return None
    from app.domains.usage import UsageReservationContext, get_summary, reserve
    capability = get_summary(str(user_id))
    reservation = reserve(
        str(user_id),
        feature=feature,
        operation=operation,
        tokens=int(capability["per_request_token_limit"]),
        idempotency_key=idempotency_key,
        request_id=request_id,
        job_id=job_id,
        lease_owner=lease_owner,
    )
    return UsageReservationContext.from_reservation(reservation)


def _quota_error_response(exc):
    return jsonify(exc.payload), 429


def _zero_cache_hit_usage() -> dict:
    """Safe display contract for a cache hit that consumed no provider tokens."""
    return {
        "input_tokens": 0,
        "output_tokens": 0,
        "embedding_tokens": 0,
        "cached_input_tokens": 0,
        "total_tokens": 0,
        "usage_source": "system",
        "estimated": False,
        "cache_hit": True,
        "attempt_count": 0,
        "status": "cache_hit",
    }


def _finish_usage_context(context, *, status: str, job_id: Optional[str] = None):
    """Close a reservation and persist only its safe aggregate on a job."""
    if context is None:
        return None
    from app.domains.usage import finalize_reservation, get_operation_usage
    finalize_reservation(context.reservation_id, status=status)
    usage = get_operation_usage(context.reservation_id, user_id=context.user_id)
    if job_id and _jobs_update_job:
        try:
            _jobs_update_job(
                job_id,
                usage_summary_json=json.dumps(usage or {}, ensure_ascii=False),
            )
        except Exception:
            pass
    if job_id:
        try:
            with query_jobs_lock:
                if job_id in query_jobs:
                    query_jobs[job_id]["usage_summary"] = usage
        except Exception:
            pass
    return usage


@app.get("/usage/me")
def usage_me():
    uid, error = _require_usage_user()
    if error:
        return error
    from app.domains.usage.metering import get_summary
    return jsonify(get_summary(uid)), 200


@app.get("/usage/me/events")
def usage_me_events():
    uid, error = _require_usage_user()
    if error:
        return error
    from app.domains.usage.metering import list_events
    raw_limit = request.args.get("limit", "25")
    try:
        limit = int(raw_limit)
        if limit < 1:
            raise ValueError
        events = list_events(uid, limit, cursor=request.args.get("cursor"))
    except ValueError:
        return jsonify({"error": "invalid pagination"}), 400
    return jsonify({"events": events}), 200


@app.get("/usage/me/breakdown")
def usage_me_breakdown():
    uid, error = _require_usage_user()
    if error:
        return error
    from app.domains.usage.metering import get_summary
    summary = get_summary(uid)
    return jsonify({"plan": summary["plan"], "breakdown": summary["breakdown"], "reset_at": summary["reset_at"]}), 200


@app.get("/billing/capability")
def billing_capability():
    uid, error = _require_usage_user()
    if error:
        return error
    from app.domains.usage.metering import get_summary
    summary = get_summary(uid)
    return jsonify({"plan": summary["plan"], "monthly_token_limit": summary["limit"], "per_request_token_limit": summary["per_request_token_limit"], "enforcement_enabled": summary["enforcement_enabled"], "reset_at": summary["reset_at"], "period_start": summary.get("period_start"), "period_end": summary.get("period_end")}), 200


def owned_stems(user_id: Optional[str]) -> set:
    """Canonical source stems owned by `user_id`, from the registry.

    When AUTH_PROTECT_APP_APIS is OFF, legacy/None-owner rows are included (today's
    open behavior). When ON, only rows whose user_id matches are returned (and, for
    a None user_id, nothing) — the fail-closed base the later phases enforce."""
    try:
        registry = _load_source_registry()
    except Exception:
        return set()
    protect = _auth_protect_enabled()
    out: set = set()
    for row in registry.values():
        if not isinstance(row, dict):
            continue
        stem = row.get("source_stem")
        if not stem:
            continue
        owner = row.get("user_id")
        if protect:
            if user_id is not None and owner == user_id:
                out.add(stem)
        else:
            # open mode: everything visible (owner filter is a no-op)
            out.add(stem)
    return out


# Phase C — source/query ownership.
# Sentinel stem that matches NO chunk: used when an enforced query resolves to zero
# owned sources, so retrieval returns [] instead of falling back to the global corpus.
_NO_OWNED_SOURCES = ["\x00__no_owned_sources__"]


def _source_owner_ok(stem_or_id: str, user_id: Optional[str]) -> bool:
    """True when the source (matched by source_id key OR canonical stem) is owned by
    user_id. Registry is the authoritative owner map; never trusts client-supplied
    user_id."""
    try:
        registry = _load_source_registry()
    except Exception:
        return False
    norm = _normalize_video_stem(stem_or_id)
    for sid, row in registry.items():
        if not isinstance(row, dict):
            continue
        row_stem = _normalize_video_stem(row.get("source_stem") or row.get("filename") or "")
        if sid == stem_or_id or (norm and row_stem == norm):
            return row.get("user_id") == user_id
    return False


def _resolve_owned_query_sources(raw_sources, user_id: Optional[str]):
    """Return (resolved_sources, error_response|None).

    Flag OFF → raw passthrough; raw empty → every stem in the registry, which
      `all_rows()` already filters to non-deleted. Empty registry keeps returning []
      (= global corpus), so a fresh install or an index with no registry rows behaves
      exactly as before. Audit vòng 6 P3: `soft_delete` only flips `documents.status`
      and leaves the FAISS chunks in place, so an empty list here used to search the
      whole corpus — including documents the user had deleted. The trade-off: a stem
      present in the index but absent from the registry is no longer searched in open
      mode.
    Flag ON  → owner-scoped:
      * raw empty   → all owned stems (or the NO-OWNED sentinel → retrieval returns [])
      * raw present → every requested stem must be owned, else 403; returns the
        canonicalized owned subset. Never falls back to the global corpus."""
    if not _auth_protect_enabled():
        if raw_sources:
            return list(raw_sources), None
        return sorted(owned_stems(user_id)), None
    owned = owned_stems(user_id)  # set of canonical stems
    raw = [s for s in (raw_sources or []) if s]
    if not raw:
        return (sorted(owned) if owned else list(_NO_OWNED_SOURCES)), None
    norm = [_normalize_video_stem(s) for s in raw]
    if any(n not in owned for n in norm):
        return None, (jsonify({"error": "forbidden_source"}), 403)
    return norm, None


def _ensure_owned_sources(source_names: list, user_id: Optional[str]):
    """Phase D — derived-artifact generation (summary/mindmap) source gate.

    Flag OFF → None (no-op, open behavior).
    Flag ON  → every requested source must be an owned stem; a foreign source (or a
    caller with zero owned sources) → 403. collect_mindmap_input already filters the
    global index to this allowlist, so a validated subset never leaks another user's
    chunks. Returns an error response, or None when allowed."""
    if not _auth_protect_enabled():
        return None
    owned = owned_stems(user_id)
    norm = [_normalize_video_stem(s) for s in (source_names or [])]
    if not norm or any(n not in owned for n in norm):
        return (jsonify({"error": "forbidden_source"}), 403)
    return None


def _ensure_ready_sources(source_names: list[str]):
    """Reject guided generation until every selected source has indexed chunks."""
    registry = _load_source_registry()
    if not registry:
        return None  # legacy/open installs may only have index.json
    for requested in source_names:
        norm = _normalize_video_stem(requested)
        rows = [row for sid, row in registry.items()
                if isinstance(row, dict) and (sid == requested or
                   _normalize_video_stem(row.get("source_stem") or row.get("filename") or "") == norm)]
        if rows and any((row.get("status") or row.get("pipeline_status") or "ready") not in ("ready", "index_ready") for row in rows):
            return jsonify({"error": "source_not_ready", "source": requested}), 409
    return None


def _chunk_owner_stem(chunk_id) -> str:
    """Canonical source stem a chunk_id belongs to (from index.json), or '' if unknown.
    Used to owner-check /chunk-text without trusting any client-supplied identity."""
    try:
        with open(INDEX_META_JSON_PATH, encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        return ""
    m = meta.get(str(chunk_id))
    if not isinstance(m, dict):
        return ""
    return _normalize_video_stem(m.get("source_stem") or "")


def _derived_job_owner_ok(job_id: str, user_id: Optional[str], allowed_types) -> Optional[bool]:
    """Owner check for derived-artifact jobs (summary/mindmap) that live in jobs_store.

    Giữ lại ở đây vì `summary-cancel` và `mindmap-cancel` — hai route NẰM NGOÀI batch
    Phase 2D — vẫn gọi. Chữ ký và ngữ nghĩa tri-state (None/True/False) giữ nguyên.
    """
    return jobs_uc.chu_so_huu_hop_le(job_id, user_id, allowed_types)


def _query_job_owner_ok(job_id: str, user_id: Optional[str]) -> Optional[bool]:
    """None if the job is unknown; True if owned by user_id; False if foreign.
    Checks the in-memory query_jobs map first (carries user_id), then jobs_store —
    so neither the sqlite nor the in-process fallback path can leak across users."""
    with query_jobs_lock:
        j = query_jobs.get(job_id)
    if j is not None and "user_id" in j:
        return j.get("user_id") == user_id
    try:
        from app.domains.jobs.jobs_store import get_job as _js_get
        row = _js_get(job_id)
    except Exception:
        row = None
    if row is not None:
        return row.get("user_id") == user_id
    if j is not None:
        return False  # in-mem present without user_id (legacy) → deny under enforcement
    return None


def _update_source_status(
    source_id: str,
    status: str,
    progress: float = None,
    error: Optional[str] = None,
    substatus: Optional[str] = None,
    capabilities: Optional[Dict[str, bool]] = None
) -> None:
    """Cập nhật trạng thái ingest của tài liệu.

    - status: "processing" | "index_ready" | "ready" | "error"
    - substatus: "faiss_ready" | "building_memory_tree" | "memory_tree_ready"
    - capabilities: {"chunk_query": bool, "memory_query": bool}

    Trạng thái pipeline nằm ở `documents.metadata_json.ingest_status`; cột
    `documents.status` giữ giá trị đã quy đổi theo đặc tả 3.2.4.
    """
    try:
        from app.domains.documents import repository as _docs
        _docs.update_status(source_id, status, progress=progress, error=error,
                            substatus=substatus, capabilities=capabilities)
    except Exception as exc:
        print(f"⚠️ Không cập nhật được trạng thái tài liệu {source_id}: {exc}")


def _get_source_status(source_id: str) -> Optional[Dict]:
    try:
        from app.domains.documents import repository as _docs
        return _docs.get(source_id)
    except Exception:
        return None


def _get_source_status_by_stem(source_stem: str) -> Optional[Dict]:
    """Tìm tài liệu theo canonical stem (khớp cả tên hiển thị lẫn stem đã chuẩn hoá)."""
    try:
        from app.domains.documents import repository as _docs
        return _docs.get_by_stem(source_stem)
    except Exception:
        return None


def _check_sources_status(selected_sources: List[str]) -> Dict[str, str]:
    """
    Check status của các selected_sources.
    Trả về dict: {source_stem: status}
    """
    status_map = {}
    for source in selected_sources:
        stem = _normalize_video_stem(source)
        status_info = _get_source_status_by_stem(stem)
        if status_info:
            status_map[stem] = status_info.get("status", "ready")
        else:
            status_map[stem] = "ready"
    return status_map


# LangGraph pipelines được dựng tập trung ở app/wiring.py — gọi ở CUỐI khối init
# (sau khi mọi callback/helper cần thiết đã sẵn sàng).

def _query_da_huy(job_id: str) -> bool:
    """Người dùng đã bấm Huỷ cho job truy vấn này chưa.

    Graph gọi hàm này ở MỌI ranh giới node. Đọc cờ hỏng (sqlite khoá, file mất) thì trả
    False: một job đang chạy tốt không được chết vì tra cờ thất bại.
    """
    try:
        from app.domains.jobs.jobs_store import is_cancel_requested
        return bool(is_cancel_requested(job_id))
    except Exception:
        return False


def _get_session_history_safe(session_id: str, limit: int,
                              user_id: Optional[str] = None) -> list:
    try:
        from app.domains.jobs.sessions_store import get_history as _gh
        return _gh(session_id, limit_messages=limit, user_id=user_id)
    except Exception:
        return []


def _warmup_model_names() -> list[str]:
    """Model Ollama cần warm = ĐÚNG model runtime sẽ resolve theo feature
    (một nguồn sự thật `_model_map` — hết chuyện warmup ôm một default cứng riêng
    trong khi compose chạy model khác). Dedupe giữ thứ tự,
    chat/query warm trước (interactive nhạy cold-start nhất)."""
    from app.clients.llm_factory import _model_map
    out: list[str] = []
    for feature in ("chat", "summary", "mindmap"):
        m = (_model_map(feature) or "").strip()
        if m and m not in out:
            out.append(m)
    return out


def _warmup_ollama_background() -> list[str]:
    """Warm mọi model đã cấu hình, nền + fail-open tuyệt đối (warmup lỗi không
    được chặn request nào). Trả về list model đã lên lịch ([] khi tắt/không host)
    — để test quan sát được mà không cần Ollama thật."""
    if (os.getenv("OLLAMA_WARMUP", "1") or "").strip().lower() in ("0", "false", "no", "off"):
        return []
    host = (os.getenv("OLLAMA_HOST") or "").strip().rstrip("/")
    if not host:
        return []
    models = _warmup_model_names()
    try:
        timeout = float((os.getenv("MODEL_WARMUP_TIMEOUT_SECONDS") or "").strip() or 120)
    except ValueError:
        timeout = 120.0

    def _run():
        import requests

        # Tuần tự — warm song song trên Ollama CPU chỉ thrash lẫn nhau.
        for model in models:
            try:
                r = requests.post(
                    f"{host}/api/generate",
                    json={
                        "model": model,
                        "prompt": "Hi",
                        "stream": False,
                        "options": {"num_predict": 1, "temperature": 0},
                    },
                    timeout=timeout,
                )
                if r.status_code == 200:
                    print(f"[warmup] Ollama model {model!r} ready")
                else:
                    print(f"[warmup] Ollama model {model!r} HTTP {r.status_code}")
            except Exception as e:
                print(f"[warmup] Ollama model {model!r} failed: {e}")

        # Embedding warmup OPT-IN: bge-m3 ~2GB nạp RAM MỖI gunicorn worker →
        # mặc định OFF; bật ở deploy muốn trả giá RAM để first-query nhanh.
        if (os.getenv("EMBEDDING_WARMUP_ENABLED", "0") or "").strip().lower() in ("1", "true", "yes", "on"):
            try:
                from app.clients.llm_factory import get_embeddings
                get_embeddings().embed_query("warmup")
                print("[warmup] embedding model ready")
            except Exception as e:
                print(f"[warmup] embedding warmup failed: {e}")

        # Rerank/NLI cũng nạp lười, và giá nạp rơi TRỌN vào câu hỏi đầu tiên của
        # người dùng: đo được rerank 21.9s ở câu đầu so với 8.8s ở câu sau trong
        # cùng tiến trình — 13 giây chỉ để nạp bge-reranker. Warm ở đây thì người
        # dùng không phải trả.
        #
        # Opt-in như embedding warmup và cùng lý do: mỗi worker gunicorn giữ một
        # bản model trong RAM (bge-reranker-v2-m3 ~2.2GB). Bật khi chấp nhận đổi
        # RAM lấy câu-đầu-nhanh. Tôn trọng RERANK_ENABLED/NLI_ENABLED — tắt thành
        # phần thì không nạp model của nó.
        if (os.getenv("RETRIEVAL_WARMUP_ENABLED", "0") or "").strip().lower() in ("1", "true", "yes", "on"):
            from shared.config import get_settings as _get_settings

            _s = _get_settings()
            if _s.rerank_enabled:
                try:
                    from app.domains.retrieval import rerank as _rr
                    _rr.warmup()
                    print("[warmup] rerank model ready")
                except Exception as e:
                    print(f"[warmup] rerank warmup failed: {e}")
            if _s.nli_enabled:
                try:
                    from app.domains.retrieval import nli as _nli
                    _nli.warmup()
                    print("[warmup] NLI model ready")
                except Exception as e:
                    print(f"[warmup] NLI warmup failed: {e}")

    threading.Thread(target=_run, daemon=True).start()
    return models


_warmup_ollama_background()


# Khôi phục index từ kho object nếu đĩa trống. Mặc định TẮT
# (`INDEX_PERSISTENCE_ENABLED`), và thiếu cấu hình Supabase thì bỏ qua im lặng — đĩa
# của Render free là phù du, nhưng biến Supabase KHÔNG được là điều kiện để app boot.
# Hàm này không bao giờ ném; đặt TRƯỚC khi dựng RETRIEVER để lần truy hồi đầu tiên
# thấy index đã ở đúng chỗ.
try:
    from app.domains.vectorstore import persistence as _index_persistence

    _index_persistence.restore_luc_khoi_dong()
except Exception as _exc:  # pragma: no cover - phòng thủ cho đường import
    print(f"[index_persistence] restore skipped: {type(_exc).__name__}", flush=True)


# === Dựng toàn bộ LangGraph pipeline qua wiring tập trung (T4) ===
from app.wiring import build_graphs as _build_graphs
from app.clients.mindmap_factory import get_mindmap_pipeline as _get_mindmap_pipeline
from app.clients.summary_factory import get_summary_pipeline as _get_summary_pipeline

# Migrate legacy mindmaps.json / summaries.json → sqlite một lần khi startup
# (best-effort, idempotent — file được rename .migrated sau khi import).
try:
    mindmap_store.migrate_from_json(MINDMAPS_PATH)
except Exception:
    pass
try:
    summary_store.migrate_from_json(SUMMARIES_PATH)
except Exception:
    pass

# Composition root: đây là nơi DUY NHẤT biết retriever cụ thể là HybridRetriever.
# `query_graph` trước đây tự dựng nó khi không được truyền — nghĩa là tầng graph phải
# import lớp cụ thể và tự biết cách ghép đường dẫn index. Dựng ở đây rẻ như cũ: hàm
# khởi tạo chỉ giữ hai Path, index nạp lười ở lần truy hồi đầu.
from app.domains.retrieval.hybrid import HybridRetriever as _HybridRetriever

RETRIEVER = _HybridRetriever(index_path=INDEX_FAISS_PATH, meta_path=INDEX_META_JSON_PATH)

_graphs = _build_graphs(
    data_dir=DATA_DIR,
    index_meta_path=INDEX_META_JSON_PATH,
    update_source_status=lambda sid, status="processing", **kw: _update_source_status(sid, status, **kw),
    extract_text=extract_text,
    split_text=split_text,
    append_to_index=append_to_index,
    build_memory_tree_for_sources=build_memory_tree_for_sources,
    jobs_update=_jobs_update_dispatch,
    make_cache_key=_make_query_cache_key,
    get_cached=_get_cached_query,
    set_cached=_set_cached_query,
    check_sources_status=_check_sources_status,
    get_source_status_by_stem=_get_source_status_by_stem,
    query_da_huy=_query_da_huy,
    summarize_results=summarize_results,
    query_with_memory_tree=query_with_memory_tree,
    retriever=RETRIEVER,
    collect_mindmap_input=collect_mindmap_input,
    mindmap_pipeline=_get_mindmap_pipeline(),
    persist_mindmap=mindmap_store.save_record,
    summary_pipeline=_get_summary_pipeline(),
    persist_summary=summary_store.save_record,
)
INGEST_GRAPH = _graphs.ingest
QUERY_GRAPH = _graphs.query
QUERY_GRAPH_BUILD_ERROR = _graphs.query_build_error
MINDMAP_GRAPH = _graphs.mindmap
SUMMARY_GRAPH = _graphs.summary

# Phase 5: reconcile orphaned jobs at startup (queue-aware; never kills live worker jobs).
_reconcile_jobs_safe()
# Retention + sweep một lần lúc startup; sau đó lazy trên status endpoints.
_run_jobs_maintenance(force=True)


# Bốn helper vòng đời job nền đã chuyển sang tầng Application (Phase 1). Import lại
# dưới TÊN CŨ: mọi chỗ gọi trong file này và các test đang tham chiếu
# `app.main._job_error_text` / `_nhip_tim_job` vẫn chạy nguyên trạng.
from app.application.shared import (  # noqa: E402
    _job_error_text,
    _JobCancelled,
    _langgraph_invoke,
    _LOI_AI_DE_HIEU,
    _nhip_tim_job,
)





# Audit vòng 7 Q5 — hai lỗi AI hay gặp nhất từng tới người dùng dưới CÙNG một câu
# "Gọi model thất bại: ...", trong khi chúng đòi hai hành động ngược nhau: một cái bảo
# "chờ rồi thử lại", cái kia bảo "máy này không kham nổi, giảm tải hoặc đổi model".
# Giữ nguyên văn kỹ thuật ở cuối để log và người sửa lỗi không mất gì.






def _detect_query_interrupt(graph: Any, thread_id: str) -> Optional[dict]:
    """HITL: phát hiện graph đang tạm dừng tại interrupt().

    langgraph 0.2.x KHÔNG đặt key '__interrupt__' trong kết quả invoke → đọc qua get_state().
    Trả về payload review (dict) nếu đang chờ duyệt, ngược lại None.
    """
    try:
        st = graph.get_state({"configurable": {"thread_id": thread_id}})
    except Exception:
        return None
    if not getattr(st, "next", None):
        return None
    for task in getattr(st, "tasks", []) or []:
        intrs = getattr(task, "interrupts", None) or ()
        if intrs:
            return getattr(intrs[0], "value", None) or {}
    return None


def _mark_query_interrupted(jid: str, review: dict) -> None:
    """HITL: đánh dấu job chờ người duyệt (SSE coi 'interrupted' là terminal)."""
    review = review or {}
    result_obj = {"payload": {"review": review}, "status": 200}
    with query_jobs_lock:
        if jid in query_jobs:
            query_jobs[jid]["status"] = "interrupted"
            query_jobs[jid]["result"] = result_obj
    if _jobs_update_job:
        try:
            _jobs_update_job(jid, status="interrupted", current_node="ReviewGate", result=result_obj)
        except Exception:
            pass


_CITE_PREFIX_RE = re.compile(r"^\s*\[\s*Nguồn\s*:\s*(.+?)\s*,\s*đoạn\s*(\d+)\s*\]\s*", re.IGNORECASE)


def _attach_evidence(payload: dict, out: dict, max_chunks: int = 12) -> None:
    """Bổ sung provenance (`sources` + `chunks`) vào payload query từ state của graph,
    để FE dựng "lề bằng chứng". CHỈ THÊM (additive) — không đổi answer/error.

    Tái dùng stem canonical đã có trong state (`retrieved_sources`/`retrieved_stems`)
    và prefix "[Nguồn: <stem>, đoạn <id>]" do node RetrieveFAISS gắn — KHÔNG suy lại
    định danh (xem .playbook: một nguồn sự thật cho source_stem)."""
    if not isinstance(payload, dict) or not isinstance(out, dict):
        return
    srcs = out.get("retrieved_sources")
    if isinstance(srcs, list) and srcs and not payload.get("sources"):
        seen: list[str] = []
        for s in srcs:
            s = str(s).strip()
            if s and s not in seen:
                seen.append(s)
        if seen:
            payload["sources"] = seen
    chunks = out.get("retrieved_chunks")
    stems = out.get("retrieved_stems")
    chunk_ids = out.get("retrieved_chunk_ids")
    if isinstance(chunks, list) and chunks and not payload.get("chunks"):
        ev: list[dict] = []
        for i, c in enumerate(chunks[:max_chunks]):
            text = str(c) if c is not None else ""
            stem, chunk_id = "", ""
            if isinstance(chunk_ids, list) and i < len(chunk_ids) and chunk_ids[i] is not None:
                chunk_id = str(chunk_ids[i]).strip()
            m = _CITE_PREFIX_RE.match(text)
            if m:
                stem = m.group(1).strip()
                if not chunk_id:
                    chunk_id = m.group(2)
                text = text[m.end():]
            elif isinstance(stems, list) and i < len(stems) and stems[i]:
                stem = str(stems[i]).strip()
            snippet = text.strip().replace("\x00", "")
            if len(snippet) > 600:
                snippet = snippet[:600].rstrip() + "…"
            ev.append({"stem": stem, "chunk_id": chunk_id, "snippet": snippet})
        if ev:
            payload["chunks"] = ev


def _conversation_enabled() -> bool:
    """Feature gate for the Conversation Context Layer (default OFF)."""
    try:
        from shared.config import get_settings
        return bool(get_settings().conversation_context_enabled)
    except Exception:
        return False


def _save_conversation_turns(
    session_id: str,
    question: str,
    answer: str,
    *,
    source_ids: Optional[list] = None,
    source_context_hash: Optional[str] = None,
    cited_chunk_ids: Optional[list] = None,
    rewritten_query: Optional[str] = None,
    metadata: Optional[dict] = None,
    user_id: Optional[str] = None,
    enforce_owner: bool = False,
) -> None:
    """Persist a user+assistant turn pair to the conversation store. Best-effort:
    a DB failure must never break /query (fail-open). Gated on the feature flag.
    When owner-enforced without a user, skip (never write NULL-owned protected rows)."""
    if not _conversation_enabled():
        return
    if not session_id or not (answer or "").strip():
        return
    if enforce_owner and not user_id:
        return  # flag on + no authenticated user → do not persist
    try:
        from app.domains.conversation import store as _conv
        _conv.append_message(
            session_id, "user", question,
            selected_source_ids=source_ids, source_context_hash=source_context_hash,
            user_id=user_id, enforce_owner=enforce_owner,
        )
        _conv.append_message(
            session_id, "assistant", str(answer),
            selected_source_ids=source_ids, source_context_hash=source_context_hash,
            cited_chunk_ids=cited_chunk_ids, rewritten_query=rewritten_query,
            answer_summary=str(answer)[:300], metadata=metadata,
            user_id=user_id, enforce_owner=enforce_owner,
        )
    except Exception:
        pass


def _finalize_query_job(jid: str, session_id: str, question: str, out: dict,
                        *, user_id: Optional[str] = None, enforce_owner: bool = False) -> None:
    """Trích payload/status từ kết quả graph → cập nhật query_jobs/jobs_store + persist history.

    Dùng chung cho /query và /query-resume. user_id/enforce_owner scope the
    conversation-turn persistence to the caller (Phase B).
    """
    # Huỷ phải đọc TRƯỚC mọi nhánh lỗi. Lượt bị huỷ không có `answer` và cũng không có
    # `error`, nên nếu rơi xuống dưới thì khối "not has_ans and not has_err" gán
    # `error = "Unknown error"` và màn hình đổ lỗi cho hệ thống về một việc chính người
    # dùng vừa bấm dừng — đúng bẫy đã gặp ở quiz vòng 8.
    if out.get("cancelled"):
        ket_qua = {"payload": {"answer": None, "cancelled": True},
                   "status": int(out.get("status_code") or 499)}
        with query_jobs_lock:
            if jid in query_jobs:
                query_jobs[jid]["status"] = "cancelled"
                query_jobs[jid]["result"] = ket_qua
        if _jobs_update_job:
            try:
                _jobs_update_job(jid, status="cancelled", progress=0,
                                 current_node="Cancelled", result=ket_qua)
            except Exception:
                pass
        # KHÔNG ghi lịch sử hội thoại: lượt này không có câu trả lời, ghi vào là bịa ra
        # một lượt chưa từng hoàn thành rồi mang nó sang ngữ cảnh lượt sau.
        print(f"query_job_cancelled job_id={jid}", flush=True)
        return

    raw_pl = out.get("payload")
    payload = dict(raw_pl) if isinstance(raw_pl, dict) else {}
    ans_state = (out.get("answer") or "").strip()
    if ans_state and not (payload.get("answer") or "").strip():
        payload["answer"] = out["answer"]
    has_ans = bool((payload.get("answer") or "").strip())
    has_err = bool((payload.get("error") or "").strip())
    if not has_ans and not has_err:
        payload["error"] = out.get("error") or "Unknown error"
    if has_ans:
        try:
            _attach_evidence(payload, out)
        except Exception:
            pass
    status = int(out.get("status_code") or 200)
    result_obj = {"payload": payload, "status": status}

    with query_jobs_lock:
        if jid in query_jobs:
            query_jobs[jid]["status"] = "done"
            query_jobs[jid]["result"] = result_obj

    if _jobs_update_job:
        try:
            _jobs_update_job(jid, status="done", progress=100, current_node="Finalize", result=result_obj)
        except Exception:
            pass

    # Persist conversation history (best-effort)
    try:
        if isinstance(payload, dict) and payload.get("answer"):
            from app.domains.jobs.sessions_store import append_messages as _ss_append
            _ss_append(session_id, [{"role": "user", "content": question}, {"role": "assistant", "content": str(payload.get("answer"))}], user_id=user_id)
    except Exception:
        pass

    # Conversation Context Layer: structured turn store with source scope (flag-gated).
    try:
        if isinstance(payload, dict) and payload.get("answer"):
            src = out.get("selected_sources") or []
            try:
                import app.domains.cache.llm_cache as _lc
                sch = _lc.source_context_hash(src, out.get("language"), out.get("category"), bool(out.get("use_memory_tree", True)))
            except Exception:
                sch = None
            cited = [c.get("chunk_id") for c in (payload.get("chunks") or []) if isinstance(c, dict) and c.get("chunk_id")]
            _rewritten = out.get("rewritten_query") or out.get("standalone_question")
            _mode = out.get("context_mode") or "standalone"
            _save_conversation_turns(
                session_id, question, str(payload.get("answer")),
                source_ids=src, source_context_hash=sch, cited_chunk_ids=cited or None,
                rewritten_query=(_rewritten if _rewritten and _rewritten != question else None),
                metadata={"context_mode": _mode, "context_signature": out.get("context_signature")},
                user_id=user_id, enforce_owner=enforce_owner,
            )
    except Exception:
        pass


# -------------------------
# 🔄 Background tasks (non-blocking)
# -------------------------
# ── Wrapper tương thích (Phase 1) ──────────────────────────────────────────
# Thân hàm đã chuyển sang `app/application/`. Giữ tên ở ĐÚNG chỗ này vì RQ
# serialize hàm theo `module.qualname` (`app.main.<ten>`) — job đã nằm trong
# hàng đợi trước lúc deploy vẫn phải resolve được. Chữ ký giữ NGUYÊN.
def run_memory_tree_job(source_stems: List[str]):
    from app.application.memory_tree import run_memory_tree_job as _impl
    return _impl(source_stems)


# Backward-compatible alias (older callers / tests may reference this name).
_build_memory_tree_background = run_memory_tree_job


def _trigger_memory_tree_build(source_stems: List[str]):
    """Trigger Memory Tree build (non-blocking). Phase 5 Step 4: via enqueue_job — daemon
    thread when QUEUE_ENABLED=false (default, unchanged), RQ 'memory' queue when true."""
    if not source_stems:
        return
    from app.jobs.queue import enqueue_job
    res = enqueue_job(run_memory_tree_job, args=(source_stems,), queue="memory")
    _event = {"rq": "memory_tree_enqueue_rq", "thread": "memory_tree_enqueue_thread",
              "thread_fallback": "memory_tree_queue_fallback_thread"}.get(res.get("mode"),
                                                                          f"memory_tree_enqueue_{res.get('mode')}")
    print(f"{_event} sources={source_stems}", flush=True)


def _don_file_tam(source_id: str, file_path: str) -> None:
    """Xoá bản local sau khi ingest xong — CHỈ khi Storage đã giữ bản gốc.

    Bản gốc sống trên Supabase Storage (bucket private); `input_docs/` chỉ là chỗ
    đặt tạm để pipeline ingest có một đường dẫn để đọc. Giữ lại sau đó là nhân đôi
    dung lượng mà không ai đọc tới: đo được 13MB cho 9 file, và không có luồng nào
    đọc lại bản local sau ingest (`_trigger_background_ingest` gọi đúng một lần,
    `rebuild_*` làm việc trên index, mở file gốc thì dùng signed URL).

    Điều kiện bảo vệ: `documents.file_path` phải KHÁC `input_path`. Khi Storage
    chưa cấu hình hoặc upload lỗi, code upload đặt `file_path = save_path` — lúc
    đó bản local CHÍNH LÀ kho lưu, xoá là mất hẳn file.
    """
    try:
        from app.domains.documents import repository as _docs

        row = _docs.get(source_id) or {}
        tren_storage = (row.get("file_path") or "").strip()
        if not tren_storage or tren_storage == file_path:
            return  # local đang là kho lưu duy nhất — không đụng
        p = Path(file_path)
        if p.is_file():
            p.unlink()
            # `input_path` trong DB thành đường dẫn chết — KHÔNG cần dọn:
            # `_delete_input_file` đã kiểm `.exists()` trước khi xoá và coi
            # file-không-còn là thành công. Giữ lại còn có ích khi truy vết.
            print(f"🧹 [Ingest] Đã xoá bản tạm: {p.name} (bản gốc ở Storage)")
    except Exception as exc:
        # Không dọn được thì thôi — rác đĩa, không phải lỗi nghiệp vụ.
        print(f"⚠️ [Ingest] Không xoá được bản tạm {file_path}: {exc}")


def _run_ingest_job(
    source_id: str,
    file_path: str,
    filename: str,
    usage_context_data: Optional[dict] = None,
) -> None:
    """Ingest execution body. Runs EITHER in a daemon thread (QUEUE_ENABLED=false)
    OR in an RQ worker process (QUEUE_ENABLED=true) — identical behaviour. Enqueued
    by dotted path `app.main._run_ingest_job`, so the worker builds/reuses INGEST_GRAPH
    on import. Status/result land in the shared jobs.sqlite; the graph nodes own the
    done/error writes (atomic-with-result invariant preserved)."""
    job_id = source_id
    from app.domains.usage import (
        UsageReservationContext,
        finalize_reservation,
        get_operation_usage,
    )
    usage_context = UsageReservationContext.from_dict(usage_context_data)

    def _finish_usage(status: str) -> None:
        if usage_context is None:
            return
        finalize_reservation(usage_context.reservation_id, status=status)
        usage = get_operation_usage(
            usage_context.reservation_id, user_id=usage_context.user_id,
        )
        if _jobs_update_job:
            _jobs_update_job(
                job_id,
                usage_summary_json=json.dumps(usage or {}, ensure_ascii=False),
            )
    try:
        if _jobs_update_job:
            _jobs_update_job(job_id, status="running", current_node="Ingest")
    except Exception:
        pass
    try:
        init_state = {
            "job_id": job_id,
            "source_id": source_id,
            "file_path": file_path,
            "filename": filename,
            "progress": 0,
            "current_node": "Queued",
            "artifacts": {},
            "error": None,
        }
        init_state["usage_context"] = (
            usage_context.to_dict() if usage_context is not None else None
        )
        result_state = _langgraph_invoke(INGEST_GRAPH, init_state, thread_id=job_id)
        current_usage = (
            get_operation_usage(
                usage_context.reservation_id, user_id=usage_context.user_id,
            )
            if usage_context is not None else None
        )
        if result_state.get("error"):
            _finish_usage(
                "failed" if current_usage and current_usage.get("total_tokens", 0)
                else "released"
            )
        else:
            _finish_usage("committed")
    except Exception as exc:
        try:
            _update_source_status(source_id, "error", progress=0.0, error=_job_error_text(exc))
        except Exception:
            pass
    finally:
        # `finally`: ingest hỏng giữa chừng cũng không để lại bản tạm. Hàm tự kiểm
        # điều kiện an toàn nên gọi vô điều kiện ở đây là đúng.
        _don_file_tam(source_id, file_path)


def _trigger_background_ingest(
    source_id: str,
    file_path: str,
    filename: str,
    usage_context_data: Optional[dict] = None,
):
    """
    Trigger ingest qua LangGraph. Phase 5: qua enqueue_job — daemon thread khi
    QUEUE_ENABLED=false (mặc định), RQ worker khi bật. FE polling không đổi.
    """
    if INGEST_GRAPH is None or _jobs_create_job is None:
        print("[INGEST] INGEST_GRAPH hoặc jobs_store không khả dụng — không thể xử lý upload.")
        try:
            _update_source_status(source_id, "error", progress=0.0, error="Ingest LangGraph unavailable")
        except Exception:
            pass
        return

    job_id = source_id  # re-use source_id làm job_id để FE polling đơn giản
    try:
        _jobs_create_job(
            job_id,
            job_type="ingest",
            status="pending",
            progress=0,
            current_node="Queued",
            user_id=_current_user_id(),
            usage_reservation_id=(usage_context_data or {}).get("reservation_id"),
        )
    except Exception:
        pass

    from app.jobs.queue import EnqueueFailed, enqueue_job
    try:
        res = enqueue_job(
            _run_ingest_job,
            args=(source_id, file_path, filename, usage_context_data),
                          queue="ingest", job_id=job_id, fail_closed=True)
    except EnqueueFailed as exc:
        # Bật queue mà Redis/RQ không đẩy được: KHÔNG chạy ingest trong tiến trình web.
        # Đó chính là đường đã giết tiến trình ngày 2026-09-05. Hàng `documents` đã tạo
        # trước lời gọi này nên phải tự hạ xuống lỗi — bỏ nguyên nó là để lại đúng cái
        # tài liệu kẹt `processing` vĩnh viễn mà phase này đang đi dọn.
        try:
            _update_source_status(source_id, "error", progress=0.0,
                                  error=f"Hàng đợi xử lý chưa sẵn sàng: {exc}")
        except Exception:
            pass
        # Sổ job phải nói CÙNG một chuyện với hàng `documents`. Job được tạo
        # `pending` ở ngay trên; bỏ nguyên nó thì `/api/jobs` báo một lượt ingest
        # đang chờ chạy mà sẽ không bao giờ chạy, và `sweep_stuck_jobs` cố ý không
        # quét `pending` — nên nó chỉ được dọn ở lần khởi động sau. Đúng lớp "hai
        # nguồn sự thật lệch nhau" mà phase này sinh ra để dẹp.
        # Thông điệp CỐ Ý là hằng số: `exc` đã sạch, nhưng sổ job bị nhiều nơi đọc
        # và hiển thị, nên ở đây không lấy gì từ ngoại lệ cả.
        try:
            if _jobs_update_job:
                _jobs_update_job(job_id, status="error",
                                 error_text="hàng đợi chưa sẵn sàng")
        except Exception:
            # Ghi sổ hỏng KHÔNG được che mất việc chính: người dùng vẫn phải nhận
            # 503, và tài liệu vẫn đã được hạ xuống lỗi ở trên.
            pass
        _don_file_tam(source_id, file_path)
        raise IngestQueueRequired(str(exc)) from None
    print(f"🚀 [Background] ingest source={source_id} mode={res.get('mode')}")


# -------------------------
# 📤 Upload single file (ASYNC)
# -------------------------
# Ký tự cấm trên tên file Windows (+ control chars). NFKD ở canonicalizer lo phần
# khớp; ở đây chỉ lo lưu file vật lý an toàn (chặn ký tự cấm + path traversal).
_ILLEGAL_FS_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_save_path(filename: str) -> str:
    """Đường lưu vật lý AN TOÀN trong INPUT_DIR: bỏ thành phần thư mục (chống
    traversal), thay ký tự cấm → '_', và GIÀNH tên bằng một lần tạo file atomic.

    `O_CREAT|O_EXCL` chứ không phải `os.path.exists()`: bản cũ chỉ KIỂM rồi trả chuỗi,
    file mãi tới `file.save(path)` mới ra đời — hai upload trùng tên cùng lúc nhận CÙNG
    một đường dẫn và bản sau đè bản trước. Gunicorn chạy nhiều worker dùng chung
    `input_docs/` nên đây là nhiều TIẾN TRÌNH; khoá trong tiến trình không cứu được.
    Ném lỗi khác `FileExistsError` thì để nó nổi lên: hết đĩa/không có quyền phải thấy
    ngay ở đây, không phải vài dòng sau khi `save` chết vì lý do khó hiểu hơn."""
    os.makedirs(INPUT_DIR, exist_ok=True)
    base = os.path.basename((filename or "").strip()) or "file"
    safe = _ILLEGAL_FS_CHARS.sub("_", base).strip().strip(".") or "file"
    path = os.path.join(INPUT_DIR, safe)
    root, ext = os.path.splitext(path)
    n = 2
    while True:
        try:
            # File 0 byte nằm lại nếu `save` ném — giống hệt hành vi cũ (file dở dang),
            # và `_don_file_tam` trong `finally` của job ingest dọn nó.
            os.close(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
            return path
        except FileExistsError:
            path = f"{root}_{n}{ext}"
            n += 1


def _unique_display_filename(filename: str, registry: dict) -> str:
    """Chống trùng tên: nếu canonical stem đã có trong registry → thêm hậu tố
    " (n)" trước đuôi để hai tài liệu cùng tên KHÔNG trộn chunk (mỗi cái 1 stem)."""
    fn = filename or "file"
    existing = {(info.get("source_stem") or "") for info in registry.values()}
    if _normalize_video_stem(fn) not in existing:
        return fn
    base, ext = os.path.splitext(fn)
    n = 2
    while _normalize_video_stem(f"{base} ({n}){ext}") in existing:
        n += 1
    return f"{base} ({n}){ext}"


class UnsupportedFileType(ValueError):
    """Đuôi file không có bộ đọc nào trong pipeline ingest."""


class DurableStorageRequired(RuntimeError):
    """Ingest production nhưng kho object không dùng được.

    Chỉ ném ở tiến trình mang nhãn `ingest_origin=production`. Trên Render free,
    `/tmp` bị xoá sạch mỗi lần khởi động lại, nên một tài liệu "completed" mà bản
    gốc chỉ nằm ở `/tmp` là tài liệu SẼ MẤT — chỉ chưa ai biết. Đo 2026-09-04: cả
    hai tài liệu production đều có `file_path == input_path`, tức đã rơi vào nhánh
    dự phòng từ lượt upload đầu tiên mà không dòng log nào ở tầng cấu hình nói ra.
    """


class IngestQueueRequired(RuntimeError):
    """Bật `QUEUE_ENABLED` nhưng không đẩy được việc ingest ra worker.

    Song song với `DurableStorageRequired`: cả hai đều là "hạ tầng chưa sẵn sàng", và
    cả hai đều CHỌN từ chối thay vì đi đường vòng im lặng. Đường vòng ở đây là chạy
    ingest trong tiến trình web — đúng thứ đã bị OOM killer giết trên Render free
    ngày 2026-09-05, kéo sập cả `/health` lẫn `/sources/<id>/status` trong 61 giây.
    """


def _queue_required_response(exc: "IngestQueueRequired"):
    """503 — hạ tầng chưa sẵn sàng, không phải request sai. Cùng khuôn với
    `_storage_required_response`, và cũng không kèm bí mật nào."""
    return jsonify({
        'error': 'Hàng đợi xử lý chưa sẵn sàng nên chưa nhận tài liệu.',
        'detail': str(exc),
        'hint': 'Kiểm tra REDIS_URL và worker hàng đợi, xem GET /stats.',
    }), 503


def _ingest_uploaded_file(file) -> dict:
    """Đăng ký + lưu an toàn + trigger ingest cho 1 file. Dùng chung cho
    /upload-file và /upload-multiple (đồng nhất: source_id + registry + poll)."""
    # Kiểm đuôi TRƯỚC khi ghi bất cứ thứ gì. Không có cổng này thì file lạ vẫn
    # được lưu đĩa, đẩy lên Storage và tạo dòng documents, rồi vài phút sau ingest
    # mới chết với "Cannot read file content" — người dùng không thấy lỗi lúc bấm.
    from app.domains.ingest import formats as _formats

    _name = (file.filename or "").strip()
    if not _formats.is_supported(_name):
        raise UnsupportedFileType(os.path.splitext(_name)[1].lower() or _name)

    source_id = str(uuid.uuid4())
    uid = _current_user_id()
    usage_context = _reserve_usage_context(
        uid,
        feature="upload",
        operation="ingest",
        idempotency_key=f"upload:{source_id}",
        request_id=request.headers.get("X-Request-ID") or source_id,
        job_id=source_id,
        lease_owner=f"ingest:{source_id}",
    )
    try:
        return _ingest_uploaded_file_reserved(
            file, source_id=source_id, uid=uid, usage_context=usage_context,
        )
    except Exception:
        # No provider call can happen before the worker is enqueued. Releasing is
        # idempotent, so this also safely covers queue/storage failures.
        _finish_usage_context(usage_context, status="released", job_id=source_id)
        raise


def _ingest_uploaded_file_reserved(
    file,
    *,
    source_id: str,
    uid: Optional[str],
    usage_context,
) -> dict:
    """Persist and enqueue one validated upload under an explicit reservation."""
    registry = _load_source_registry()
    # Tên hiển thị (chống trùng) — canonical stem suy từ tên này nên FE chọn theo
    # tên hiển thị sẽ khớp chunk; lưu vật lý theo path an toàn riêng.
    filename = _unique_display_filename(file.filename or "file", registry)
    # `_safe_save_path` tạo thư mục và giành tên (atomic) — `save` chỉ ghi đè nội dung.
    save_path = _safe_save_path(filename)
    file.save(save_path)

    source_stem = _normalize_video_stem(filename)
    # Bản gốc lên Supabase Storage (bucket private) và đó là kho lưu DUY NHẤT.
    # File local chỉ là chỗ đặt TẠM để pipeline ingest có đường dẫn mà đọc —
    # `_don_file_tam` xoá nó trong `finally` của job ingest.
    # Chưa cấu hình Storage (test/CI) → file_path trỏ đường dẫn local, và lúc đó
    # bản local CHÍNH LÀ kho lưu nên không bị xoá. Xem `_don_file_tam`.
    from app.domains.documents import repository as _docs
    from app.domains.documents import storage as _storage
    from app.domains.documents import provenance as _prov

    # Production thì kho bền là BẮT BUỘC; dev/test thì bản local chính là kho lưu.
    # Cùng một hàm quyết định nhãn nguồn gốc, nên không có cờ thứ hai để lệch nhau.
    bat_buoc_ben = _prov.la_production(_prov.nguon_ingest())
    stored_path = save_path
    if _storage.is_configured():
        try:
            _storage.ensure_bucket()
            obj = _storage.object_path(uid or "anonymous", source_id, filename)
            with open(save_path, "rb") as fh:
                _storage.upload(obj, fh.read())
            stored_path = obj
        except Exception as exc:
            if bat_buoc_ben:
                _go_file_tam(save_path)
                raise DurableStorageRequired(
                    f"đẩy bản gốc lên kho object thất bại: {type(exc).__name__}") from exc
            print(f"⚠️ [Storage] Không đẩy được file lên bucket, dùng bản local: {exc}")
    elif bat_buoc_ben:
        # Ném TRƯỚC `_docs.create` nên không để lại hàng documents ma. Bản cũ đi
        # thẳng qua đây không một lời cảnh báo — đó là cách sự cố này im lặng suốt.
        _go_file_tam(save_path)
        raise DurableStorageRequired(
            "kho object chưa cấu hình (thiếu SUPABASE_URL / SUPABASE_SECRET_KEY)")

    _docs.create(
        document_id=source_id,
        filename=filename,
        file_type=os.path.splitext(filename)[1].lstrip(".").lower(),
        file_path=stored_path,
        user_id=uid,
        input_path=save_path,   # để xóa file gốc khi delete
        file_size=(os.path.getsize(save_path) if os.path.exists(save_path) else None),
    )
    _trigger_background_ingest(
        source_id,
        save_path,
        filename,
        usage_context.to_dict() if usage_context is not None else None,
    )
    return {
        'source_id': source_id,
        'filename': filename,
        'video_stem': source_stem,
        'status': 'processing',
        'progress': 0.0,
        'can_query': False,
    }


def _go_file_tam(duong_dan: str) -> None:
    """Xoá bản tạm khi upload bị từ chối. Không để lại rác cho một lượt đã hỏng."""
    try:
        if duong_dan and os.path.exists(duong_dan):
            os.remove(duong_dan)
    except OSError:
        pass


def _storage_required_response(exc: "DurableStorageRequired"):
    """503, không phải 500: đây là hạ tầng chưa sẵn sàng, không phải request sai.
    Nói thẳng nguyên nhân để người vận hành sửa được, và KHÔNG kèm bí mật nào."""
    return jsonify({
        'error': 'Kho lưu trữ bền chưa sẵn sàng nên chưa nhận tài liệu.',
        'detail': str(exc),
        'hint': 'Kiểm tra SUPABASE_URL / SUPABASE_SECRET_KEY, xem GET /api/config/status.',
    }), 503


def _unsupported_response(exc: "UnsupportedFileType"):
    """415 kèm danh sách đuôi nhận được, để FE hiện thẳng cho người dùng."""
    from app.domains.ingest import formats as _formats

    return jsonify({
        'error': f'Không đọc được định dạng {exc}',
        'supported_extensions': sorted(_formats.SUPPORTED_EXTENSIONS),
    }), 415


@app.post('/upload-file')
def upload_file():
    """Upload file và trả response ngay, xử lý ingest chạy background."""
    _uid, err = _require_app_user()
    if err:
        return err
    file = request.files.get('file')
    if not file or not (file.filename or "").strip():
        return jsonify({'error': 'Missing file'}), 400
    try:
        return jsonify(_ingest_uploaded_file(file))
    except Exception as exc:
        from app.domains.usage import QuotaExceeded
        if isinstance(exc, QuotaExceeded):
            return _quota_error_response(exc)
        if isinstance(exc, UnsupportedFileType):
            return _unsupported_response(exc)
        if isinstance(exc, DurableStorageRequired):
            return _storage_required_response(exc)
        if isinstance(exc, IngestQueueRequired):
            return _queue_required_response(exc)
        raise


@app.post('/upload')
def upload():
    """
    Alias cho /upload-file để đồng nhất với spec.
    """
    return upload_file()


# -------------------------
# 📊 Source Status Endpoint
# -------------------------
@app.get('/sources/<source_id>/status')
def get_source_status(source_id: str):
    """
    Lấy status của một source (processing | ready | error).
    UI sẽ polling endpoint này để cập nhật progress.
    """
    uid, err = _require_app_user()
    if err:
        return err
    status_info = _get_source_status(source_id)
    if not status_info:
        return jsonify({'error': 'Source not found'}), 404
    # Owner scope: a foreign source is indistinguishable from a missing one (404).
    if _auth_protect_enabled() and status_info.get("user_id") != uid:
        return jsonify({'error': 'Source not found'}), 404
    
    status = status_info.get('status', 'processing')
    capabilities = status_info.get('capabilities') if isinstance(status_info, dict) else None
    if not isinstance(capabilities, dict):
        capabilities = {}

    # Single source of truth: can_query
    # TRUE when FAISS is ready (chunk-level search is available). Do NOT wait for memory tree / mindmap / summary.
    can_query = (
        status in ("index_ready", "ready")
        and bool(capabilities.get("chunk_query", True))  # default True for backward compatibility
        and status != "error"
    )

    response = {
        'status': status,
        'progress': status_info.get('progress', 0.0),
        'substatus': status_info.get('substatus'),
        'capabilities': capabilities if capabilities else None,
        'can_query': bool(can_query),
        'video_stem': status_info.get('source_stem') or status_info.get('video_stem'),
    }
    try:
        from app.domains.jobs.jobs_store import get_job as _js_get
        usage_job = _js_get(source_id)
        if usage_job and (not _auth_protect_enabled() or usage_job.get("user_id") == uid):
            response["usage"] = usage_job.get("usage_summary")
    except Exception:
        pass
    
    if status_info.get('error'):
        response['error'] = status_info['error']
    
    return jsonify(response)

# -------------------------
# 📤 Upload multiple files
# -------------------------
@app.post('/upload-multiple')
def upload_multiple():
    """Upload nhiều file — mỗi file đi CÙNG luồng async với /upload-file
    (tạo source_id + registry + background ingest) nên FE poll status được."""
    _uid, err = _require_app_user()
    if err:
        return err
    files = request.files.getlist('files')
    if not files:
        return jsonify({'error': 'Missing files'}), 400

    sources, results = [], []
    for file in files:
        if not (file.filename or "").strip():
            results.append({'file': file.filename, 'error': 'Empty filename'})
            continue
        try:
            info = _ingest_uploaded_file(file)
            sources.append(info)
            results.append({'file': info['filename'], 'source_id': info['source_id'], 'status': 'processing'})
        except UnsupportedFileType as exc:
            results.append({'file': file.filename, 'error': f'Không đọc được định dạng {exc}'})
        except DurableStorageRequired as exc:
            results.append({'file': file.filename, 'error': f'Kho lưu trữ bền chưa sẵn sàng: {exc}'})
        except IngestQueueRequired as exc:
            results.append({'file': file.filename, 'error': f'Hàng đợi xử lý chưa sẵn sàng: {exc}'})
        except Exception as exc:
            from app.domains.usage import QuotaExceeded
            if isinstance(exc, QuotaExceeded):
                results.append({'file': file.filename, **exc.payload})
                continue
            import traceback; traceback.print_exc()
            results.append({'file': file.filename, 'error': f'Upload failed: {str(exc)}'})

    return jsonify({'sources': sources, 'results': results})
# -------------------------
# 🖼️ Đọc ảnh dán vào khung chat
# -------------------------
@app.get('/api/vision/status')
def api_vision_status():
    """FE hỏi trước khi hiện nút kèm ảnh — không có mô hình thì đừng mời người
    dùng làm việc chắc chắn hỏng."""
    from app.domains import vision as _vision

    return jsonify({
        'available': _vision.is_available(),
        'model': _vision.vision_model(),
        'max_image_mb': VISION_MAX_IMAGE_MB,
    })


@app.get('/api/config/status')
def api_config_status():
    """Production đang chạy với cấu hình nào. KHÔNG xác thực, KHÔNG bí mật.

    Vì sao endpoint này tồn tại: `render.yaml` khai `sync: false` cho mọi biến nhạy
    cảm, và không API đọc nào của Render trả về giá trị biến môi trường. Suốt hai
    phase kiểm toán, câu hỏi "production ĐANG chạy cấu hình gì" chỉ trả lời được bằng
    suy đoán — và một lần suy đoán sai đã dẫn tới kết luận ngược hẳn về việc production
    dùng database nào. Rẻ hơn nhiều là để chính tiến trình đó tự khai.

    Chỉ khai TÊN và CỜ. Khoá API chỉ báo có/không, không bao giờ báo giá trị — cùng
    quy ước với `fpt_api_key()`, nơi khoá được đọc và không được log.
    """
    from app.clients import llm_factory as _lf
    from app.domains import vision as _vision
    from app.domains.documents import provenance as _prov
    from app.domains.documents import storage as _doc_storage
    from app.domains.vectorstore import persistence as _persist

    return jsonify({
        # Nhãn mà mọi tài liệu nạp từ tiến trình này sẽ mang.
        'ingest_origin': _prov.nguon_ingest(),
        'llm_providers': list(_lf.PROVIDERS),
        'embedding': {
            'enabled': _lf.fpt_embedding_enabled(),
            **_lf.embedding_identity(),
        },
        'rerank': {
            'enabled': (os.getenv('RERANK_ENABLED', '1') or '').strip().lower()
                       not in ('0', 'false', 'no', 'off'),
            'backend': (os.getenv('RERANK_BACKEND') or 'local').strip(),
        },
        'vision': {'available': _vision.is_available(), 'model': _vision.vision_model()},
        'index_persistence_enabled': _persist.enabled(),
        # Bật persistence mà kho object chưa cấu hình thì khôi phục lúc khởi động im
        # lặng bỏ qua, VÀ bản gốc người dùng tải lên cũng nằm lại trên đĩa phù du —
        # hai hỏng hóc lớn mà từ ngoài không nhìn ra. Đo được 2026-09-04: production
        # bật persistence nhưng thiếu SUPABASE_URL/SUPABASE_SECRET_KEY.
        'supabase_storage_configured': _doc_storage.is_configured(),
        'skip_model_load': os.environ.get('SKIP_MODEL_LOAD') == '1',
        # CÓ hay KHÔNG, không bao giờ là giá trị.
        'fpt_api_key_present': bool(_lf.fpt_api_key()),
    })


@app.post('/api/vision/transcribe')
def api_vision_transcribe():
    """Ảnh → chữ. KHÔNG lưu ảnh: đọc xong là bỏ, chỉ phần chữ đi tiếp sang
    /query như một câu hỏi thuần chữ.

    Tách khỏi /upload-file có chủ đích — ảnh ở đây là câu hỏi dùng một lần, không
    phải tài liệu, nên không tạo dòng documents và không đánh chỉ mục."""
    _uid, err = _require_app_user()
    if err:
        return err

    from app.domains.ingest import formats as _formats
    from app.domains import vision as _vision

    file = request.files.get('image') or request.files.get('file')
    name = (file.filename or '').strip() if file else ''
    if not file or not name:
        return jsonify({'error': 'Missing image'}), 400

    ext = os.path.splitext(name)[1].lower()
    if ext not in _formats.IMAGE:
        return jsonify({
            'error': f'Chỉ đọc được ảnh, không đọc được {ext or name}',
            'supported_extensions': sorted(_formats.IMAGE),
        }), 415

    # Đọc dư 1 byte để phân biệt 'vừa đủ mốc' với 'vượt mốc'.
    cap = VISION_MAX_IMAGE_MB * 1024 * 1024
    blob = file.read(cap + 1)
    if len(blob) > cap:
        return jsonify({
            'error': f'Ảnh vượt giới hạn {VISION_MAX_IMAGE_MB}MB',
            'max_image_mb': VISION_MAX_IMAGE_MB,
        }), 413

    try:
        return jsonify(_vision.transcribe_image(blob))
    except _vision.VisionUnavailable as exc:
        # 503 chứ không 500: máy chưa có mô hình thị giác là tình trạng cấu hình,
        # không phải lỗi lập trình. FE dựa vào đó để ẩn nút kèm ảnh.
        return jsonify({'error': str(exc), 'model': _vision.vision_model()}), 503


# -------------------------
# 📚 API tài liệu StudyMap (đặc tả 12.2)
# -------------------------
def _doc_public(doc_id: str, row: dict) -> dict:
    """Shape trả ra FE. KHÔNG lộ storage path thô (NFR-04.3) — muốn mở file gốc
    thì gọi `GET /api/documents/<id>/file` để lấy signed URL có hạn."""
    return {
        "document_id": doc_id,
        "title": row.get("filename"),
        "source_stem": row.get("source_stem"),
        # Đặc tả 3.2.4 / 8.3: uploaded | processing | completed | failed | deleted.
        # Trạng thái pipeline (`ready`, `index_ready`) đi kèm riêng ở `ingest_status`
        # để FE hiện chi tiết mà không phá hợp đồng của API.
        "status": row.get("spec_status") or row.get("status"),
        "ingest_status": row.get("status"),
        "progress": row.get("progress", 0.0),
        "substatus": row.get("substatus"),
        "capabilities": row.get("capabilities"),
        "page_count": row.get("page_count"),
        "char_count": row.get("char_count"),
        "chunk_count": row.get("chunk_count"),
        "created_at": row.get("created_at"),
        "error": row.get("error"),
        # Bảy trường thư viện (Phase 1A) — THÊM khoá, không đổi khoá nào đang có.
        # Có mặt ở đây để `/api/documents`, `/api/documents/<id>` và phản hồi upload
        # nói cùng một thứ với `/api/library`; khối `ai` thì KHÔNG, nó cần hai lượt
        # đọc kho và chỉ `/api/library` mới đáng trả giá đó.
        **_thu_vien.library_fields(row),
    }


def _owned_document(document_id: str, uid):
    """(row, error_response). Tài liệu của người khác = 404, không phải 403 —
    không tạo oracle cho biết id đó có tồn tại hay không (FR-01.6)."""
    from app.domains.documents import repository as _docs
    row = _docs.get(document_id)
    if not row:
        return None, (jsonify({"error": "Document not found"}), 404)
    if _auth_protect_enabled() and row.get("user_id") != uid:
        return None, (jsonify({"error": "Document not found"}), 404)
    return row, None


@app.post('/api/documents/upload')
def api_documents_upload():
    """Upload tài liệu (FR-02.1). Cùng luồng async với /upload-file."""
    uid, err = _require_app_user()
    if err:
        return err
    file = request.files.get('file')
    if not file or not (file.filename or "").strip():
        return jsonify({'error': 'Missing file'}), 400
    try:
        info = _ingest_uploaded_file(file)
    except Exception as exc:
        from app.domains.usage import QuotaExceeded
        if isinstance(exc, QuotaExceeded):
            return _quota_error_response(exc)
        if isinstance(exc, UnsupportedFileType):
            return _unsupported_response(exc)
        if isinstance(exc, DurableStorageRequired):
            return _storage_required_response(exc)
        if isinstance(exc, IngestQueueRequired):
            return _queue_required_response(exc)
        raise
    from app.domains.documents import repository as _docs
    row = _docs.get(info['source_id']) or {}
    return jsonify(_doc_public(info['source_id'], row)), 201


@app.get('/api/documents')
def api_documents_list():
    """Danh sách tài liệu của người dùng (FR-02.5, FR-02.6)."""
    uid, err = _require_app_user()
    if err:
        return err
    from app.domains.documents import repository as _docs
    rows = _docs.all_rows()
    out = [
        _doc_public(did, row) for did, row in rows.items()
        if not _auth_protect_enabled() or row.get("user_id") == uid
    ]
    out.sort(key=lambda d: d.get("created_at") or "", reverse=True)
    return jsonify({"documents": out})


@app.get('/api/documents/<document_id>')
def api_documents_get(document_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    row, err = _owned_document(document_id, uid)
    if err:
        return err
    return jsonify(_doc_public(document_id, row))


@app.delete('/api/documents/<document_id>')
def api_documents_delete(document_id: str):
    """Xoá mềm (đặc tả 8.10): ẩn khỏi truy vấn, giữ dữ liệu con."""
    uid, err = _require_app_user()
    if err:
        return err
    _row, err = _owned_document(document_id, uid)
    if err:
        return err
    from app.domains.documents import repository as _docs
    _docs.soft_delete(document_id)
    return jsonify({"document_id": document_id, "status": "deleted"})


# -------------------------
# 📖 Thư viện học tập (Phase 1A)
# -------------------------
_TAGS_TOI_DA = 20
_TAG_DAI_TOI_DA = 30
_TEN_DAI_TOI_DA = 200


def _doc_tags(gia_tri):
    """(tags, lỗi). Cắt trắng, bỏ rỗng, khử trùng KHÔNG phân biệt hoa thường và
    giữ cách viết ĐẦU TIÊN — người dùng gõ "AI" rồi "ai" thì thấy lại "AI"."""
    if not isinstance(gia_tri, list):
        return None, "tags phải là danh sách chuỗi"
    out, seen = [], set()
    for item in gia_tri:
        if not isinstance(item, str):
            return None, "tags phải là danh sách chuỗi"
        t = item.strip()
        if not t:
            continue
        if len(t) > _TAG_DAI_TOI_DA:
            return None, f"mỗi thẻ tối đa {_TAG_DAI_TOI_DA} ký tự"
        khoa = t.lower()
        if khoa in seen:
            continue
        seen.add(khoa)
        out.append(t)
    if len(out) > _TAGS_TOI_DA:
        return None, f"tối đa {_TAGS_TOI_DA} thẻ"
    return out, None


@app.get('/api/library')
def api_library():
    """Thư viện học tập — MỘT lần gọi thay cho hàng chục lượt hỏi trạng thái.

    Ngân sách: 5 truy vấn gộp (tài liệu, quiz+lượt chấm, kế hoạch ôn tập,
    StudyMap, ngôn ngữ) + 2 lượt đọc kho phù du (tóm tắt, sơ đồ tư duy). Không có
    truy vấn nào chạy theo từng tài liệu — đó là ràng buộc chính của endpoint này.

    Kho phù du hỏng hoặc trống KHÔNG được làm hỏng cả thư viện: hỏng thì phần AI
    của nó về `not_generated` và danh sách vẫn hiện. Danh sách tài liệu là thứ
    trang này tồn tại để hiện; tóm tắt là phần thêm.
    """
    uid, err = _require_app_user()
    if err:
        return err
    from app.domains.documents import repository as _docs

    rows = {
        did: row for did, row in _docs.all_rows().items()
        if not _auth_protect_enabled() or row.get("user_id") == uid
    }
    scope_uid = uid if _auth_protect_enabled() else None

    def _thu(ham, du_phong):
        """Nguồn phụ hỏng thì mất đúng nguồn ấy, không mất cả trang."""
        try:
            return ham()
        except Exception as exc:  # noqa: BLE001 — nguồn phụ, không được lan ra
            print(f"⚠️ /api/library: nguồn phụ lỗi ({exc})", flush=True)
            return du_phong

    summaries = _thu(
        lambda: (summary_store.list_records(user_id=uid, enforce_owner=True)
                 if _auth_protect_enabled() else summary_store.list_records()), [])
    mindmaps = _thu(
        lambda: (mindmap_store.list_records(user_id=uid, enforce_owner=True)
                 if _auth_protect_enabled() else mindmap_store.list_records()), [])
    counts = _thu(lambda: _docs.ai_counts(scope_uid),
                  {"quizzes": {}, "reviews": {}, "studymaps": {}})
    languages = _thu(lambda: _docs.languages_for(rows.keys()), {})
    # Chu de + moc thoi gian: MOT vong truy van gom cho ca thu vien, khong
    # phai moi tai lieu mot lan. Hong thi mat dung khoi tri thuc.
    tri_thuc_tho = _thu(lambda: _docs.tri_thuc_tho(scope_uid), {})

    # Bộ sưu tập đi CÙNG payload: thanh bên và huy hiệu trên thẻ đều cần nó, và một
    # lượt gọi thứ hai chỉ để lấy danh sách này là đúng thứ endpoint gộp sinh ra để
    # tránh. Tên bộ sưu tập nằm ở ĐÂY, không nhúng vào từng tài liệu — tài liệu chỉ
    # mang `collection_id`, nên đổi tên một bộ sưu tập không phải sửa N chỗ.
    #
    # Danh sách THẺ thì KHÔNG trả riêng: mọi tài liệu trong payload đã mang `tags`,
    # nên thanh bên gộp lại ở client. Trả thêm một mảng thẻ là nhân bản dữ liệu đã có.
    collections = _thu(lambda: _bo_suu_tap.liet_ke(scope_uid), [])

    documents = _thu_vien.chieu_thu_vien(
        rows,
        summaries=summaries,
        mindmaps=mindmaps,
        studymap_status=counts.get("studymaps") or {},
        quiz_counts=counts.get("quizzes") or {},
        review_counts=counts.get("reviews") or {},
        languages=languages,
    )

    # ── Tang tri thuc (Phase 1C.1) ──────────────────────────────────────────
    # THUAN: chi tinh tren du lieu da lay o tren, khong them mot truy van nao.
    # Dung lai `index_by_stem` cua thu_vien thay vi khop stem lan hai.
    sum_theo_stem = _thu_vien.index_by_stem(summaries)
    map_theo_stem = _thu_vien.index_by_stem(mindmaps)
    for d in documents:
        did = d["document_id"]
        tho = tri_thuc_tho.get(did) or {}
        stem = d.get("source_stem") or ""
        ban_tt = sum_theo_stem.get(stem)
        ban_sd = map_theo_stem.get(stem)

        # Moc thoi gian: gop moc cua chinh tai lieu voi moc tu cac bang artifact.
        # `indexed` CO Y vang mat — chua co cot `indexed_at`, va suy tu `updated_at`
        # la dat mot moc BIA len dong thoi gian cua nguoi dung (Phase 1C.2 them cot).
        moc = dict(tho.get("moc") or {})
        moc["uploaded"] = d.get("created_at")
        moc["last_opened"] = d.get("last_opened_at")
        if isinstance(ban_tt, dict):
            moc["summary"] = ban_tt.get("created_at")
        if isinstance(ban_sd, dict):
            moc["mindmap"] = ban_sd.get("created_at")

        d["knowledge"] = _tri_thuc.chieu_tri_thuc(
            ai_block=d.get("ai") or {},
            summary_record=ban_tt,
            entity_list=((d.get("ai") or {}).get("summary") or {}).get("entities") or [],
            tag_list=d.get("tags") or [],
            masteries=tho.get("masteries") or [],
            quiz_concept_tags=tho.get("quiz_tags") or [],
            review_topics=tho.get("review_topics") or [],
            studymap_node_titles=tho.get("studymap_titles") or [],
            moc=moc,
            open_count=d.get("open_count") or 0,
            recency_score=d.get("recency_score") or 0.0,
            last_opened_at=d.get("last_opened_at"),
            graded_attempts=((counts.get("quizzes") or {}).get(did) or {})
                .get("graded_attempts") or 0,
        )

    return jsonify({"documents": documents, "collections": collections})


@app.patch('/api/documents/<document_id>')
def api_documents_patch(document_id: str):
    """Sửa một phần siêu dữ liệu thư viện. Chỉ ghi trường ĐƯỢC GỬI.

    CỐ Ý không nhận mốc thời gian: `archived` là bool, máy chủ tự đặt
    `archived_at`. Và `archived` KHÔNG đụng tới `status` — tài liệu đã lưu trữ
    vẫn `completed`, vẫn nằm trong `all_rows()`, vẫn trong `owned_stems()`, nên
    vẫn tra cứu được bằng AI. Lưu trữ chỉ ẩn khỏi giao diện.
    """
    uid, err = _require_app_user()
    if err:
        return err
    _row, err = _owned_document(document_id, uid)
    if err:
        return err

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Body phải là JSON object"}), 400

    kw = {}
    if "display_name" in body:
        gt = body["display_name"]
        if gt is None:
            kw["display_name"] = None          # xoá tên đã đặt → quay về `title`
        elif isinstance(gt, str):
            ten = gt.strip()
            if not ten:
                return jsonify({"error": "Tên hiển thị không được để trống"}), 400
            if len(ten) > _TEN_DAI_TOI_DA:
                return jsonify({"error": f"Tên hiển thị tối đa {_TEN_DAI_TOI_DA} ký tự"}), 400
            kw["display_name"] = ten
        else:
            return jsonify({"error": "display_name phải là chuỗi hoặc null"}), 400

    for ten_truong in ("favorite", "pinned", "archived"):
        if ten_truong in body:
            # `bool` nghiêm ngặt: ép truthy ở đây thì `"false"` bật cờ lên.
            if not isinstance(body[ten_truong], bool):
                return jsonify({"error": f"{ten_truong} phải là true hoặc false"}), 400
            kw[ten_truong] = body[ten_truong]

    if "tags" in body:
        tags, loi = _doc_tags(body["tags"])
        if loi:
            return jsonify({"error": loi}), 400
        kw["tags"] = tags

    if "collection_id" in body:
        cid = body["collection_id"]
        if cid is None or cid == "":
            kw["collection_id"] = None       # bỏ khỏi bộ sưu tập
        elif isinstance(cid, str):
            # Bộ sưu tập của người khác đọc ra None → 400 "không tồn tại", KHÔNG phải
            # 403: xác nhận id đó có thật là dựng một oracle để dò id.
            if not _bo_suu_tap.lay(cid, user_id=uid if _auth_protect_enabled() else None):
                return jsonify({"error": "Bộ sưu tập không tồn tại"}), 400
            kw["collection_id"] = cid
        else:
            return jsonify({"error": "collection_id phải là chuỗi hoặc null"}), 400

    if not kw:
        return jsonify({"error": "Không có trường nào để cập nhật"}), 400

    from app.domains.documents import repository as _docs
    if not _docs.set_library_fields(document_id, **kw):
        return jsonify({"error": "Document not found"}), 404
    row = _docs.get(document_id) or {}
    return jsonify(_doc_public(document_id, row))


@app.post('/api/documents/<document_id>/opened')
def api_documents_opened(document_id: str):
    """Ghi nhận người dùng vừa MỞ tài liệu ở một bề mặt học tập.

    Route riêng chứ không gộp vào PATCH: client vá được timestamp là client giả
    mạo được thứ tự "mở gần đây". Và không gộp vào GET: đọc phải không có tác dụng
    phụ, nếu không thì mỗi lần tải danh sách là một lần "vừa mở" mọi tài liệu.
    """
    uid, err = _require_app_user()
    if err:
        return err
    _row, err = _owned_document(document_id, uid)
    if err:
        return err

    body = request.get_json(silent=True) or {}
    workspace = body.get("workspace")
    if workspace is not None:
        if not isinstance(workspace, str) or workspace.strip().lower() not in _thu_vien.WORKSPACES:
            return jsonify({
                "error": f"workspace không hợp lệ (chọn: {', '.join(_thu_vien.WORKSPACES)})"
            }), 400
        workspace = workspace.strip().lower()

    from app.domains.documents import repository as _docs
    if not _docs.touch_opened(document_id, workspace):
        return jsonify({"error": "Document not found"}), 404
    row = _docs.get(document_id) or {}
    return jsonify({
        "document_id": document_id,
        "last_opened_at": row.get("last_opened_at"),
        "last_workspace": row.get("last_workspace"),
    })


# -------------------------
# 🗂️ Bộ sưu tập + thao tác hàng loạt (Phase 1B)
# -------------------------
_TEN_BST_TOI_DA = 100
_MAU_TOI_DA = 20
_ICON_TOI_DA = 40
_BULK_TOI_DA = 200

_BULK_HANH_DONG = ("pin", "unpin", "favorite", "unfavorite", "archive", "unarchive",
                   "move_collection", "add_tags", "remove_tags", "delete")


def _chuoi_tuy_chon(body, khoa, dai_toi_da):
    """(giá_trị, lỗi). Không gửi → KHONG_DOI. `null`/rỗng → None (xoá giá trị)."""
    from app.domains.documents.bo_suu_tap import KHONG_DOI
    if khoa not in body:
        return KHONG_DOI, None
    v = body[khoa]
    if v is None:
        return None, None
    if not isinstance(v, str):
        return None, f"{khoa} phải là chuỗi hoặc null"
    v = v.strip()
    if not v:
        return None, None
    if len(v) > dai_toi_da:
        return None, f"{khoa} tối đa {dai_toi_da} ký tự"
    return v, None


@app.get('/api/collections')
def api_collections_list():
    """Danh sách bộ sưu tập kèm số tài liệu — một truy vấn gộp.

    Có route riêng NGOÀI `/api/library` vì thanh bên cần làm mới sau khi tạo/sửa/xoá
    một bộ sưu tập mà không phải tải lại toàn bộ thư viện.
    """
    uid, err = _require_app_user()
    if err:
        return err
    scope = uid if _auth_protect_enabled() else None
    return jsonify({"collections": _bo_suu_tap.liet_ke(scope)})


@app.post('/api/collections')
def api_collections_create():
    uid, err = _require_app_user()
    if err:
        return err
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Body phải là JSON object"}), 400

    ten = body.get("name")
    if not isinstance(ten, str) or not ten.strip():
        return jsonify({"error": "Tên bộ sưu tập không được để trống"}), 400
    ten = ten.strip()
    if len(ten) > _TEN_BST_TOI_DA:
        return jsonify({"error": f"Tên tối đa {_TEN_BST_TOI_DA} ký tự"}), 400

    from app.domains.documents.bo_suu_tap import KHONG_DOI
    mau, loi = _chuoi_tuy_chon(body, "color", _MAU_TOI_DA)
    if loi:
        return jsonify({"error": loi}), 400
    icon, loi = _chuoi_tuy_chon(body, "icon", _ICON_TOI_DA)
    if loi:
        return jsonify({"error": loi}), 400

    return jsonify(_bo_suu_tap.tao(
        user_id=uid if _auth_protect_enabled() else None,
        name=ten,
        color=None if mau is KHONG_DOI else mau,
        icon=None if icon is KHONG_DOI else icon,
    )), 201


@app.patch('/api/collections/<collection_id>')
def api_collections_patch(collection_id: str):
    """Vá một phần. Tên đổi ở ĐÂY và chỉ ở đây — tài liệu chỉ giữ `collection_id`,
    nên không có bản sao tên nào phải cập nhật theo."""
    uid, err = _require_app_user()
    if err:
        return err
    scope = uid if _auth_protect_enabled() else None
    if not _bo_suu_tap.lay(collection_id, user_id=scope):
        return jsonify({"error": "Collection not found"}), 404

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Body phải là JSON object"}), 400

    from app.domains.documents.bo_suu_tap import KHONG_DOI
    kw = {}
    if "name" in body:
        ten = body["name"]
        if not isinstance(ten, str) or not ten.strip():
            return jsonify({"error": "Tên bộ sưu tập không được để trống"}), 400
        if len(ten.strip()) > _TEN_BST_TOI_DA:
            return jsonify({"error": f"Tên tối đa {_TEN_BST_TOI_DA} ký tự"}), 400
        kw["name"] = ten.strip()

    for khoa, dai in (("color", _MAU_TOI_DA), ("icon", _ICON_TOI_DA)):
        gt, loi = _chuoi_tuy_chon(body, khoa, dai)
        if loi:
            return jsonify({"error": loi}), 400
        if gt is not KHONG_DOI:
            kw[khoa] = gt

    if "sort_order" in body:
        if not isinstance(body["sort_order"], int) or isinstance(body["sort_order"], bool):
            return jsonify({"error": "sort_order phải là số nguyên"}), 400
        kw["sort_order"] = body["sort_order"]

    if "archived" in body:
        if not isinstance(body["archived"], bool):
            return jsonify({"error": "archived phải là true hoặc false"}), 400
        kw["archived"] = body["archived"]

    if not kw:
        return jsonify({"error": "Không có trường nào để cập nhật"}), 400
    if not _bo_suu_tap.cap_nhat(collection_id, **kw):
        return jsonify({"error": "Collection not found"}), 404
    return jsonify(_bo_suu_tap.lay(collection_id, user_id=scope))


@app.delete('/api/collections/<collection_id>')
def api_collections_delete(collection_id: str):
    """Xoá bộ sưu tập. Tài liệu bên trong KHÔNG bị xoá — khoá ngoại `SET NULL` đưa
    chúng về "chưa phân loại". Dọn dẹp không được biến thành mất dữ liệu."""
    uid, err = _require_app_user()
    if err:
        return err
    scope = uid if _auth_protect_enabled() else None
    if not _bo_suu_tap.lay(collection_id, user_id=scope):
        return jsonify({"error": "Collection not found"}), 404
    _bo_suu_tap.xoa(collection_id)
    return jsonify({"collection_id": collection_id, "deleted": True})


@app.post('/api/documents/bulk')
def api_documents_bulk():
    """Một hành động, nhiều tài liệu, MỘT phiên database.

    Vì sao không để client lặp `PATCH`: 200 tài liệu × một vòng tới Supabase
    (~50-100ms) là 20 giây, và một nửa số lượt hỏng giữa chừng để lại trạng thái
    dở dang mà không ai dọn.

    Id không thuộc về người gọi bị BỎ QUA lặng lẽ, không báo lỗi — báo lỗi là xác
    nhận id đó có thật. Phản hồi trả số hàng thực sự đổi, nên client vẫn biết được
    có gì đó không áp dụng được.
    """
    uid, err = _require_app_user()
    if err:
        return err
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Body phải là JSON object"}), 400

    ids = body.get("document_ids")
    if not isinstance(ids, list) or not ids or not all(isinstance(i, str) and i for i in ids):
        return jsonify({"error": "document_ids phải là danh sách id không rỗng"}), 400
    if len(ids) > _BULK_TOI_DA:
        return jsonify({"error": f"Tối đa {_BULK_TOI_DA} tài liệu mỗi lần"}), 400

    hanh_dong = body.get("action")
    if hanh_dong not in _BULK_HANH_DONG:
        return jsonify({
            "error": f"action không hợp lệ (chọn: {', '.join(_BULK_HANH_DONG)})"}), 400

    from app.domains.documents import repository as _docs
    scope = uid if _auth_protect_enabled() else None

    if hanh_dong == "delete":
        return jsonify({"updated": _docs.bulk_soft_delete(ids, user_id=scope),
                        "action": hanh_dong})

    kw = {}
    if hanh_dong in ("pin", "unpin"):
        kw["pinned"] = hanh_dong == "pin"
    elif hanh_dong in ("favorite", "unfavorite"):
        kw["favorite"] = hanh_dong == "favorite"
    elif hanh_dong in ("archive", "unarchive"):
        kw["archived"] = hanh_dong == "archive"
    elif hanh_dong == "move_collection":
        cid = body.get("collection_id")
        if cid in (None, ""):
            kw["collection_id"] = None
        elif isinstance(cid, str):
            if not _bo_suu_tap.lay(cid, user_id=scope):
                return jsonify({"error": "Bộ sưu tập không tồn tại"}), 400
            kw["collection_id"] = cid
        else:
            return jsonify({"error": "collection_id phải là chuỗi hoặc null"}), 400
    else:   # add_tags / remove_tags
        tags, loi = _doc_tags(body.get("tags"))
        if loi:
            return jsonify({"error": loi}), 400
        if not tags:
            return jsonify({"error": "tags không được để trống"}), 400
        kw["them_tags" if hanh_dong == "add_tags" else "bo_tags"] = tags

    return jsonify({"updated": _docs.bulk_library_fields(ids, user_id=scope, **kw),
                    "action": hanh_dong})


@app.get('/api/documents/<document_id>/questions')
def api_document_questions(document_id: str):
    """Cau hoi goi y — LUOI, suy ra, khong sinh gi.

    Vi sao khong nam trong `/api/library`: payload thu vien di kem MOI tai lieu, con
    cau hoi chi co nghia khi nguoi dung mo mot tai lieu ra. Tra chung o danh sach la
    tinh cho hang tram tai lieu de hien thi cho mot.

    Endpoint nay KHONG goi tom tat, KHONG goi embedding, KHONG sinh quiz. No doc du
    lieu bon pipeline da ghi san roi ghep chuoi. Khong co LLM o day.
    """
    uid, err = _require_app_user()
    if err:
        return err
    row, err = _owned_document(document_id, uid)
    if err:
        return err

    from app.domains.documents import repository as _docs

    def _thu(ham, du_phong):
        """Nguon phu hong thi mat dung loai cau hoi do, khong mat ca endpoint."""
        try:
            return ham()
        except Exception as exc:  # noqa: BLE001
            print(f"warn /questions: nguon phu loi ({exc})", flush=True)
            return du_phong

    stem = row.get("source_stem") or ""
    ban_tt = _thu_vien.index_by_stem(
        _thu(lambda: (summary_store.list_records(user_id=uid, enforce_owner=True)
                      if _auth_protect_enabled() else summary_store.list_records()),
             [])).get(stem)

    scope_uid = uid if _auth_protect_enabled() else None
    tho = (_thu(lambda: _docs.tri_thuc_tho(scope_uid), {}) or {}).get(document_id) or {}

    chu_de = _tri_thuc.topics(
        masteries=tho.get("masteries") or [],
        quiz_concept_tags=tho.get("quiz_tags") or [],
        review_topics=tho.get("review_topics") or [],
        studymap_node_titles=tho.get("studymap_titles") or [],
    )

    cau_hoi = _cau_hoi.sinh_cau_hoi(
        topic_list=chu_de,
        entity_list=_thu_vien.entities(ban_tt),
        section_list=_thu(lambda: _docs.list_sections(document_id), []),
        relation_types=_thu(lambda: _docs.quan_he_studymap(document_id), set()),
        recent_ai=_tri_thuc.hoat_dong_gan_day(moc=tho.get("moc") or {}),
    )
    return jsonify({"document_id": document_id, "questions": cau_hoi})


@app.get('/api/documents/<document_id>/sections')
def api_documents_sections(document_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    _row, err = _owned_document(document_id, uid)
    if err:
        return err
    from app.domains.documents import repository as _docs
    return jsonify({"document_id": document_id, "sections": _docs.list_sections(document_id)})


@app.get('/api/documents/<document_id>/chunks')
def api_documents_chunks(document_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    _row, err = _owned_document(document_id, uid)
    if err:
        return err
    try:
        limit = max(1, min(500, int(request.args.get("limit", 100))))
        offset = max(0, int(request.args.get("offset", 0)))
    except (TypeError, ValueError):
        return jsonify({"error": "limit/offset phải là số nguyên"}), 400
    from app.domains.documents import repository as _docs
    return jsonify({
        "document_id": document_id,
        "total": _docs.count_chunks(document_id),
        "limit": limit,
        "offset": offset,
        "chunks": _docs.list_chunks(document_id, limit=limit, offset=offset),
    })


@app.get('/api/documents/<document_id>/file')
def api_documents_file(document_id: str):
    """Signed URL có hạn để mở lại file gốc — không bao giờ trả storage path thô."""
    uid, err = _require_app_user()
    if err:
        return err
    row, err = _owned_document(document_id, uid)
    if err:
        return err
    from app.domains.documents import storage as _storage
    path = row.get("file_path")
    if not path or not _storage.is_configured():
        return jsonify({"error": "File gốc không có trên storage"}), 404
    try:
        ttl = max(60, min(3600, int(request.args.get("ttl", 600))))
        return jsonify({"url": _storage.signed_url(path, ttl=ttl), "expires_in": ttl})
    except Exception as exc:
        print(f"⚠️ [Storage] ký URL thất bại: {exc}")
        return jsonify({"error": "Không tạo được link tải"}), 502


# -------------------------
# 🔎 API tìm kiếm ngữ nghĩa (FR-05)
# -------------------------
def _search_payload():
    """(query, top_k, error_response) — validate chung cho cả 2 route search."""
    data = request.json or {}
    query = (data.get("query") or "").strip()
    if not query:
        return None, None, (jsonify({"error": "Thiếu query"}), 400)
    try:
        top_k = max(1, min(50, int(data.get("top_k", 5))))
    except (TypeError, ValueError):
        return None, None, (jsonify({"error": "top_k phải là số nguyên"}), 400)
    return query, top_k, None


@app.post('/api/search')
def api_search():
    """Tìm trong TOÀN BỘ tài liệu của người dùng (FR-05.5)."""
    uid, err = _require_app_user()
    if err:
        return err
    query, top_k, err = _search_payload()
    if err:
        return err
    from app.domains.retrieval import search as _search
    # Chế độ mở: không lọc nguồn (danh sách stem đầy đủ chỉ làm chậm, kết quả y hệt).
    stems = sorted(owned_stems(uid)) if _auth_protect_enabled() else []
    if _auth_protect_enabled() and not stems:
        return jsonify({"query": query, "results": []})
    results = _search.semantic_search(
        query, index_meta_path=INDEX_META_JSON_PATH, source_stems=stems,
        top_k=top_k, user_id=uid if _auth_protect_enabled() else None,
    )
    return jsonify({"query": query, "results": results})


@app.post('/api/documents/<document_id>/search')
def api_document_search(document_id: str):
    """Tìm trong MỘT tài liệu. Tài liệu người khác = 404 như mọi route documents."""
    uid, err = _require_app_user()
    if err:
        return err
    row, err = _owned_document(document_id, uid)
    if err:
        return err
    query, top_k, err = _search_payload()
    if err:
        return err
    from app.domains.retrieval import search as _search
    stem = row.get("source_stem")
    results = _search.semantic_search(
        query, index_meta_path=INDEX_META_JSON_PATH,
        source_stems=[stem] if stem else [], top_k=top_k,
        user_id=uid if _auth_protect_enabled() else None,
    )
    results = [r for r in results if r["document_id"] == document_id]
    return jsonify({"document_id": document_id, "query": query, "results": results})


# -------------------------
# 🗺️ API Study Map (FR-04, đặc tả 7.4)
# -------------------------
# ── Wrapper tương thích (Phase 1) ──────────────────────────────────────────
# Thân hàm đã chuyển sang `app/application/`. Giữ tên ở ĐÚNG chỗ này vì RQ
# serialize hàm theo `module.qualname` (`app.main.<ten>`) — job đã nằm trong
# hàng đợi trước lúc deploy vẫn phải resolve được. Chữ ký giữ NGUYÊN.
def run_study_map_job(job_id: str, document_id: str, user_id: Optional[str] = None) -> None:
    from app.application.study_map_generation import run_study_map_job as _impl
    return _impl(job_id, document_id, user_id)


@app.post('/api/study-maps/generate')
def api_study_maps_generate():
    """Tạo Study Map từ một tài liệu (FR-04.1). Trả job_id để poll."""
    uid, err = _require_app_user()
    if err:
        return err
    data = request.json or {}
    document_id = (data.get("document_id") or "").strip()
    if not document_id:
        return jsonify({"error": "Thiếu document_id"}), 400
    row, err = _owned_document(document_id, uid)
    if err:
        return err
    if not row.get("source_stem"):
        return jsonify({"error": "Tài liệu chưa index xong"}), 409

    from app.domains.studymap import repository as _sm_repo
    if not data.get("force"):
        existing = _sm_repo.latest_completed(document_id, uid)
        if existing:
            return jsonify({"map_id": existing, "status": "completed", "cached": True}), 200

    job_id = str(uuid.uuid4())
    from app.domains.jobs.jobs_store import create_job
    create_job(job_id, job_type="study_map_generation", status="pending", progress=0,
               current_node="Queued", user_id=uid)
    from app.jobs.queue import enqueue_job
    res = enqueue_job(run_study_map_job, args=(job_id, document_id, uid),
                      queue="mindmap", job_id=job_id)
    print(f"study_map_enqueue_{res.get('mode')} job_id={job_id}", flush=True)
    return jsonify({"job_id": job_id, "status": "started"}), 202


@app.get('/api/study-maps/jobs/<job_id>')
def api_study_maps_job(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    _run_jobs_maintenance()
    try:
        return jsonify(jobs_uc.xem(
            job_id, uid, loai_cho_phep=("study_map_generation",), kem_job_type=False,
            bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


@app.post('/api/study-maps/jobs/<job_id>/cancel')
def api_study_maps_job_cancel(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    try:
        return jsonify(jobs_uc.huy_theo_loai(
            job_id, uid, loai_cho_phep=("study_map_generation",),
            bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


@app.get('/api/study-maps/<map_id>')
def api_study_maps_get(map_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    from app.domains.studymap import repository as _sm_repo
    m = _sm_repo.get_map(map_id)
    if not m or (_auth_protect_enabled() and m.get("user_id") != uid):
        return jsonify({"error": "Study map not found"}), 404
    m.pop("user_id", None)
    return jsonify(m)


@app.get('/api/documents/<document_id>/study-maps')
def api_document_study_maps(document_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    _row, err = _owned_document(document_id, uid)
    if err:
        return err
    from app.domains.studymap import repository as _sm_repo
    maps = _sm_repo.list_by_document(document_id, user_id=uid if _auth_protect_enabled() else None)
    return jsonify({"document_id": document_id, "study_maps": maps})


# -------------------------
# 📝 API Quiz (FR-06, FR-13, đặc tả 7.5)
# -------------------------
# Điều phối sinh quiz (chẩn đoán + luyện tập) đã sang `app/application/quiz_dispatch.py`
# ở Phase 2G.2. Tầng ấy không biết HTTP: nó ném lỗi mang ngữ nghĩa, `_ATTEMPT_ERR_HTTP`
# chọn con số. `QUIZ_MAX_QUESTIONS` nằm dưới khối import vì nó alias
# `quiz_uc.SO_CAU_TOI_DA` nên phải đứng SAU import.
QUIZ_MAX_CONTEXT_CHUNKS = int(os.getenv("QUIZ_MAX_CONTEXT_CHUNKS", "200"))


def _day_quiz_job(job_id: str, document_id: str, config: dict, uid):
    """RQ serialize hàm theo `module.qualname`. Truyền WRAPPER ở module này để job vẫn
    mang đường dẫn `app.main.run_quiz_generation_job` — cả quiz chẩn đoán lẫn luyện tập."""
    from app.jobs.queue import enqueue_job
    return enqueue_job(run_quiz_generation_job, args=(job_id, document_id, config, uid),
                       queue="mindmap", job_id=job_id)


# ── Wrapper tương thích (Phase 1) ──────────────────────────────────────────
# Thân hàm đã chuyển sang `app/application/`. Giữ tên ở ĐÚNG chỗ này vì RQ
# serialize hàm theo `module.qualname` (`app.main.<ten>`) — job đã nằm trong
# hàng đợi trước lúc deploy vẫn phải resolve được. Chữ ký giữ NGUYÊN.
def run_quiz_generation_job(job_id: str, document_id: str, config: dict,
                            user_id: Optional[str] = None) -> None:
    from app.application.quiz_generation import run_quiz_generation_job as _impl
    return _impl(job_id, document_id, config, user_id)


# Audit vòng 7 Q2 — chống job quiz trùng.
# Bấm "Tạo quiz" năm lần trong hai giây từng tạo NĂM job y hệt nhau (log 2026-08-30
# 00:24:40). Máy chỉ có 1 slot LLM (`MAX_CONCURRENT_LLM_CALLS`), nên job trùng không chỉ
# vô ích: chúng xếp hàng, chờ quá `LLM_QUEUE_WAIT_TIMEOUT_SECONDS` rồi chết với
# "LLM busy (in-process): all 1 slots in use" — người dùng thấy "Tạo quiz thất bại" dù
# một quiz đã ra xong. Cờ chặn ở FE không đủ: F5, hai tab, app khác đều đi vòng qua nó.
_QUIZ_JOB_SONG = ("pending", "running", "processing")   # cùng từ vựng với list_active_jobs
_QUIZ_INFLIGHT: "OrderedDict[str, str]" = OrderedDict()
_QUIZ_INFLIGHT_LOCK = threading.Lock()
_QUIZ_INFLIGHT_MAX = 256

# Job `pending` quá ngưỡng này = xếp hàng xong mà không worker nào nhận. Rộng rãi so với
# thời gian một job thật cần để chuyển sang `running` (đo được: dưới một giây ở chế độ
# thread, vài giây khi qua RQ), nhưng vẫn đủ ngắn để người dùng bấm lại được trong cùng
# một phiên làm việc thay vì phải chờ tới lần khởi động sau.
_QUIZ_PENDING_TOI_DA_GIAY = float(os.getenv("QUIZ_PENDING_TOI_DA_GIAY", "120"))


def _quiz_job_key(uid: Optional[str], document_id: str, config: dict) -> str:
    """Luật trùng giờ ở `quiz_dispatch.khoa_trung`. Giữ TÊN ở đây vì
    `test_quiz_job_dedupe` gọi thẳng `app.main._quiz_job_key`."""
    return quiz_uc.khoa_trung(uid, document_id, config)


def _quiz_job_giu_cho(key: str, job_id_moi: str) -> Optional[str]:
    """Trả `job_id` CŨ nếu có job y hệt đang sống; None nếu đã giữ chỗ cho job mới.

    Kiểm tra và giữ chỗ nằm TRONG cùng một lần khoá — tách hai bước thì hai request tới
    cùng lúc đều thấy trống và cả hai cùng tạo job, đúng thứ hàm này sinh ra để chặn.
    `get_job` là một lần đọc sqlite local (vài ms) nên chấp nhận nằm trong lock.
    """
    from app.domains.jobs.jobs_store import get_job
    with _QUIZ_INFLIGHT_LOCK:
        cu = _QUIZ_INFLIGHT.get(key)
        if cu:
            job = get_job(cu)
            if job and job.get("status") in _QUIZ_JOB_SONG and not _job_pending_da_chet(job):
                return cu
        # Giữ chỗ TRƯỚC khi enqueue — giữ chỗ SAU thì cửa sổ đua quay lại. Route phải
        # gọi `_quiz_job_nha_cho` nếu không xếp hàng được (xem ở đó).
        _QUIZ_INFLIGHT[key] = job_id_moi
        while len(_QUIZ_INFLIGHT) > _QUIZ_INFLIGHT_MAX:
            _QUIZ_INFLIGHT.popitem(last=False)
    return None


def _job_pending_da_chet(job: dict) -> bool:
    """Job `pending` quá lâu = xếp hàng xong mà không worker nào nhận.

    `sweep_stuck_jobs` CỐ Ý không đụng `pending` (hàng đợi chờ lâu là hợp lệ, và
    `tests/test_jobs_retention.py` khoá đúng hành vi đó), nên không ai dọn nó cho tới
    lần khởi động sau. Comment cũ ở đây ghi ngược lại — nó hứa một cơ chế không tồn tại.

    Hậu quả nếu tin comment cũ: dedupe thấy job chết vẫn "còn sống" và trả lại đúng nó
    cho MỌI lần bấm sau — người dùng vĩnh viễn không tạo lại được quiz cùng cấu hình,
    còn giao diện thì poll một job không bao giờ nhúc nhích.
    """
    if job.get("status") != "pending":
        return False   # `running` cũ là việc của sweep_stuck_jobs, không phải của đây
    moc = job.get("updated_at") or job.get("created_at")
    if not moc:
        return False
    try:
        from datetime import datetime, timezone
        tuoi = (datetime.now(timezone.utc) - datetime.fromisoformat(str(moc))).total_seconds()
    except Exception:
        return False   # không đọc được mốc thì đừng đoán, cứ coi là còn sống
    return tuoi > _QUIZ_PENDING_TOI_DA_GIAY


def _quiz_job_nha_cho(key: str, job_id_cua_minh: str) -> None:
    """Trả lại chỗ đã giữ khi không xếp hàng được.

    Chỉ xoá nếu chỗ VẪN đang là của mình — request khác có thể đã chiếm sau đó, xoá
    nhầm thì mở lại đúng cửa sổ đua mà dedupe sinh ra để đóng.
    """
    with _QUIZ_INFLIGHT_LOCK:
        if _QUIZ_INFLIGHT.get(key) == job_id_cua_minh:
            _QUIZ_INFLIGHT.pop(key, None)





@app.post('/api/quizzes/generate')
def api_quizzes_generate():
    """Tạo quiz chẩn đoán từ một tài liệu (FR-06.1). Trả job_id để poll."""
    uid, err = _require_app_user()
    if err:
        return err
    data = request.json or {}
    document_id = (data.get("document_id") or "").strip()
    if not document_id:
        return jsonify({"error": "Thiếu document_id"}), 400
    row, err = _owned_document(document_id, uid)
    if err:
        return err
    try:
        payload, _ = quiz_uc.sinh_quiz(
            document_id, data, uid, source_stem=row.get("source_stem"),
            giu_cho=_quiz_job_giu_cho, nha_cho=_quiz_job_nha_cho, day_job=_day_quiz_job)
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)
    return jsonify(payload), 202


@app.get('/api/quizzes/jobs/<job_id>')
def api_quizzes_job(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    _run_jobs_maintenance()
    try:
        return jsonify(jobs_uc.xem(
            job_id, uid, loai_cho_phep=("quiz_generation",), kem_job_type=False,
            bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


@app.post('/api/quizzes/jobs/<job_id>/cancel')
def api_quizzes_job_cancel(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    try:
        return jsonify(jobs_uc.huy_theo_loai(
            job_id, uid, loai_cho_phep=("quiz_generation",),
            bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


@app.get('/api/quizzes/<quiz_id>')
def api_quizzes_get(quiz_id: str):
    """Đề bài. KHÔNG kèm correct_answer/explanation (FR-06.12) — đáp án chỉ lộ ở
    `/api/quizzes/results/{attempt_id}` sau khi nộp (Phase 5)."""
    uid, err = _require_app_user()
    if err:
        return err
    from app.domains.quiz import repository as _quiz_repo
    quiz = _quiz_repo.get_quiz(quiz_id, include_answers=False)
    if not quiz or (_auth_protect_enabled() and quiz.get("user_id") != uid):
        return jsonify({"error": "Quiz not found"}), 404
    quiz.pop("user_id", None)
    return jsonify(quiz)


@app.get('/api/documents/<document_id>/quizzes')
def api_document_quizzes(document_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    _row, err = _owned_document(document_id, uid)
    if err:
        return err
    from app.domains.quiz import repository as _quiz_repo
    return jsonify({
        "document_id": document_id,
        "quizzes": _quiz_repo.list_by_document(
            document_id, user_id=uid if _auth_protect_enabled() else None),
    })


@app.get('/api/quizzes/jobs/<job_id>/validation-logs')
def api_quizzes_validation_logs(job_id: str):
    """Câu bị AI Validation loại, kèm rule_code (FR-13.10, FR-13.11)."""
    uid, err = _require_app_user()
    if err:
        return err
    from app.domains.jobs.jobs_store import get_job as _js_get
    j = _js_get(job_id)
    if not j or j.get("job_type") != "quiz_generation":
        return jsonify({"error": "Job not found"}), 404
    if _auth_protect_enabled() and j.get("user_id") != uid:
        return jsonify({"error": "Job not found"}), 404
    from app.domains.ai_validation import store as _val_store
    return jsonify({
        "job_id": job_id,
        "counts_by_rule": _val_store.count_by_rule(job_id),
        "logs": _val_store.list_for_job(job_id),
    })


# -------------------------
# 🎯 API làm bài + chấm điểm (FR-07, FR-08, đặc tả 7.6)
# -------------------------
# Các tầng use case request-scoped (Phase 2B/2C/2D). Chúng không biết HTTP: mỗi tầng
# ném lỗi mang NGỮ NGHĨA, còn bảng `_ATTEMPT_ERR_HTTP` bên dưới chọn con số.
from app.application import attempts as attempts_uc  # noqa: E402
from app.application import jobs as jobs_uc  # noqa: E402
from app.application import practice as practice_uc  # noqa: E402
from app.application import progress as progress_uc  # noqa: E402
from app.application import quiz_dispatch as quiz_uc  # noqa: E402
from app.application import review_plans as review_uc  # noqa: E402

# Nguồn sự thật của trần số câu giờ ở tầng use case. Giữ TÊN ở đây vì
# `test_generate_characterization` đọc `app.main.QUIZ_MAX_QUESTIONS`.
QUIZ_MAX_QUESTIONS = quiz_uc.SO_CAU_TOI_DA

# Một bảng cho cả ba nhóm: lỗi của review-plan và practice đều kế thừa
# `attempts_uc.AttemptError`, nên route chỉ cần MỘT chỗ bắt. Thiếu một lớp ở đây là
# `KeyError` trong route, tức 500 thay cho 404/409 — có test quét đủ các lớp con.
_ATTEMPT_ERR_HTTP = {
    attempts_uc.AttemptKhongTonTai: 404,
    attempts_uc.QuizKhongTonTai: 404,
    attempts_uc.JobChamKhongTonTai: 404,
    attempts_uc.QuizChuaSanSang: 409,
    attempts_uc.AttemptDaNop: 409,
    attempts_uc.AttemptKhongConDangLam: 409,
    attempts_uc.AttemptChuaNop: 409,
    attempts_uc.ThieuDapAn: 400,
    attempts_uc.CauHoiLac: 400,
    # Phase 2C
    review_uc.ThieuAttemptId: 400,
    review_uc.AttemptChuaCham: 409,
    review_uc.ReviewPlanKhongTonTai: 404,
    # 500 là hành vi ĐANG CÓ khi `review.generate` trả None. Lạ nhưng giữ nguyên:
    # đổi nó ở đây là đổi API trong một commit refactor.
    review_uc.KhongTaoDuocPlan: 500,
    practice_uc.PracticeKhongTonTai: 404,
    practice_uc.PracticeChuaSanSang: 409,
    practice_uc.ChuaCoLanChamNao: 409,
    # Phase 2D
    jobs_uc.JobKhongTonTai: 404,
    jobs_uc.JobKhongHoTroHuy: 409,
    # Phase 2G.2 — sáu thân lỗi của `cau_hinh_quiz` giữ nguyên từng cái, không gộp.
    quiz_uc.SoCauKhongPhaiSo: 400,
    quiz_uc.SoCauNgoaiKhoang: 400,
    quiz_uc.DoKhoSai: 400,
    quiz_uc.LoaiCauKhongPhaiList: 400,
    quiz_uc.LoaiCauKhongHopLe: 400,
    quiz_uc.ScopeKhongPhaiObject: 400,
    quiz_uc.SectionLac: 400,
    quiz_uc.TaiLieuChuaIndex: 409,
    quiz_uc.ReviewItemKhongTonTai: 404,
    quiz_uc.ReviewItemKhongCoChunk: 409,
}


def _attempt_err(exc: "attempts_uc.AttemptError"):
    """Lỗi ngữ nghĩa -> (body, status). `exc.kem` mang các trường phải giữ nguyên
    trong response, ví dụ `status` của attempt lúc bị từ chối."""
    return jsonify({"error": exc.loi, **exc.kem}), _ATTEMPT_ERR_HTTP[type(exc)]


def _dispatch_grading(job_id: str, attempt_id: str, uid):
    """RQ serialize hàm theo `module.qualname`. Truyền WRAPPER ở module này để job
    vẫn mang đường dẫn `app.main.run_short_answer_grading_job` như trước."""
    from app.jobs.queue import enqueue_job
    res = enqueue_job(run_short_answer_grading_job, args=(job_id, attempt_id, uid),
                      queue="mindmap", job_id=job_id)
    print(f"grading_enqueue_{res.get('mode')} job_id={job_id}", flush=True)


def _owned_attempt(attempt_id: str, uid):
    """(attempt, error_response). Bài của người khác = 404, không phải 403.

    Giữ lại vì còn route ngoài nhóm attempt dùng (review-plan, practice)."""
    try:
        return attempts_uc.load_owned_attempt(
            attempt_id, uid, bat_buoc_chu_so_huu=_auth_protect_enabled()), None
    except attempts_uc.AttemptError as exc:
        return None, _attempt_err(exc)


def _attempt_public(attempt: dict) -> dict:
    return attempts_uc.attempt_public(attempt)


# ── Wrapper tương thích (Phase 1) ──────────────────────────────────────────
# Thân hàm đã chuyển sang `app/application/`. Giữ tên ở ĐÚNG chỗ này vì RQ
# serialize hàm theo `module.qualname` (`app.main.<ten>`) — job đã nằm trong
# hàng đợi trước lúc deploy vẫn phải resolve được. Chữ ký giữ NGUYÊN.
def run_short_answer_grading_job(job_id: str, attempt_id: str,
                                 user_id: Optional[str] = None) -> None:
    from app.application.short_answer_grading import run_short_answer_grading_job as _impl
    return _impl(job_id, attempt_id, user_id)


@app.post('/api/quizzes/<quiz_id>/attempts')
def api_attempt_open(quiz_id: str):
    """Mở quiz (FR-07.1) — tạo attempt `in_progress` ngay, không đợi nộp (FR-07.10)."""
    uid, err = _require_app_user()
    if err:
        return err
    try:
        data, moi = attempts_uc.open_attempt(
            quiz_id, uid, bat_buoc_chu_so_huu=_auth_protect_enabled())
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)
    return jsonify(data), 201 if moi else 200


@app.get('/api/attempts/<attempt_id>')
def api_attempt_get(attempt_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    try:
        return jsonify(attempts_uc.get_attempt(
            attempt_id, uid, bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


@app.patch('/api/attempts/<attempt_id>/answers')
def api_attempt_save_answers(attempt_id: str):
    """Lưu nháp (FR-07.5, FR-07.11). Gọi lại cho cùng câu thì ghi đè."""
    uid, err = _require_app_user()
    if err:
        return err
    try:
        return jsonify(attempts_uc.save_answers(
            attempt_id, uid, (request.json or {}).get("answers"),
            bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


@app.post('/api/attempts/<attempt_id>/submit')
def api_attempt_submit(attempt_id: str):
    """Nộp bài (FR-07.7). Bài toàn trắc nghiệm chấm luôn; có tự luận thì chấm nền."""
    uid, err = _require_app_user()
    if err:
        return err
    try:
        data, cham_nen = attempts_uc.submit_attempt(
            attempt_id, uid, bat_buoc_chu_so_huu=_auth_protect_enabled(),
            dispatch_grading=_dispatch_grading)
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)
    return (jsonify(data), 202) if cham_nen else jsonify(data)


@app.get('/api/attempts/jobs/<job_id>')
def api_attempt_grading_job(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    _run_jobs_maintenance()
    try:
        return jsonify(attempts_uc.grading_job(
            job_id, uid, bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


@app.get('/api/quizzes/results/<attempt_id>')
def api_attempt_results(attempt_id: str):
    """Kết quả sau khi nộp — CHỖ DUY NHẤT lộ đáp án đúng + giải thích (FR-08.8).

    Chưa nộp thì 409: trả đáp án lúc bài còn `in_progress` là đưa bài giải cho người
    đang làm.
    """
    uid, err = _require_app_user()
    if err:
        return err
    try:
        return jsonify(attempts_uc.results(
            attempt_id, uid, bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


@app.get('/api/quizzes/<quiz_id>/attempts')
def api_quiz_attempts(quiz_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    try:
        return jsonify(attempts_uc.list_attempts(
            quiz_id, uid, bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


# -------------------------
# 🩺 API lỗ hổng kiến thức + gợi ý ôn tập (FR-09, FR-10, đặc tả 7.7)
# -------------------------
@app.get('/api/attempts/<attempt_id>/concept-masteries')
def api_attempt_masteries(attempt_id: str):
    """Mức nắm từng concept của bài làm; `?weak=1` chỉ lấy chủ đề yếu (FR-09.8)."""
    uid, err = _require_app_user()
    if err:
        return err
    weak_only = str(request.args.get("weak", "")).lower() in ("1", "true", "yes")
    try:
        return jsonify(attempts_uc.concept_masteries(
            attempt_id, uid, weak_only=weak_only,
            bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


@app.post('/api/review-plans/generate')
def api_review_plan_generate():
    """Tạo review plan từ một attempt đã chấm (FR-10.1). 201 khi vừa sinh, 200 khi
    trả bản đã có — xem `review_plans.generate`."""
    uid, err = _require_app_user()
    if err:
        return err
    data = request.json or {}
    try:
        plan, tao_moi = review_uc.generate(
            data.get("attempt_id"), uid, force=bool(data.get("force")),
            bat_buoc_chu_so_huu=_auth_protect_enabled())
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)
    return jsonify(plan), 201 if tao_moi else 200


@app.get('/api/review-plans/<attempt_id>')
def api_review_plan_by_attempt(attempt_id: str):
    """Đặc tả 7.7: tra theo `attempt_id`, không phải review_plan_id."""
    uid, err = _require_app_user()
    if err:
        return err
    try:
        return jsonify(review_uc.by_attempt(
            attempt_id, uid, bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


@app.get('/api/review-plans/<review_plan_id>/items')
def api_review_plan_items(review_plan_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    try:
        return jsonify(review_uc.items(
            review_plan_id, uid, bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


# -------------------------
# 🏋️ API luyện tập + tiến độ (FR-11, FR-12, đặc tả 7.8–7.10)
# -------------------------
@app.post('/api/practice/generate')
def api_practice_generate():
    """Tạo practice quiz từ một review item yếu (FR-11.1–FR-11.3).

    Dùng CHUNG `run_quiz_generation_job` với quiz chẩn đoán, chỉ khác nguồn ngữ liệu:
    chunk lấy thẳng từ review item thay vì theo section (FR-11.2, FR-11.4).
    """
    uid, err = _require_app_user()
    if err:
        return err
    data = request.json or {}
    review_item_id = (data.get("review_item_id") or "").strip()
    if not review_item_id:
        return jsonify({"error": "Thiếu review_item_id"}), 400

    try:
        payload = quiz_uc.sinh_practice(
            review_item_id, data, uid,
            bat_buoc_chu_so_huu=_auth_protect_enabled(), day_job=_day_quiz_job)
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)
    return jsonify(payload), 202


@app.get('/api/practice/<practice_quiz_id>')
def api_practice_get(practice_quiz_id: str):
    """Đề luyện tập. Vẫn KHÔNG kèm đáp án trước khi nộp (FR-06.12)."""
    uid, err = _require_app_user()
    if err:
        return err
    try:
        return jsonify(practice_uc.get(
            practice_quiz_id, uid, bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


@app.post('/api/practice/<practice_quiz_id>/submit')
def api_practice_submit(practice_quiz_id: str):
    """Nộp bài luyện tập trong MỘT lần gọi (FR-11.6, FR-11.7).

    Luồng chẩn đoán tách mở/nháp/nộp vì người học làm dài và cần lưu nháp; bài luyện tập
    ngắn nên gộp lại — vẫn đi qua đúng repository attempt để lịch sử thống nhất.
    """
    uid, err = _require_app_user()
    if err:
        return err
    try:
        return jsonify(practice_uc.submit(
            practice_quiz_id, uid, (request.json or {}).get("answers"),
            bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


@app.get('/api/practice/<practice_quiz_id>/comparison')
def api_practice_comparison(practice_quiz_id: str):
    """Mastery trước/sau luyện tập (FR-11.10, FR-12.7).

    "Trước" là attempt chẩn đoán gốc (`source_attempt_id`), "sau" là lần làm practice
    gần nhất đã chấm.
    """
    uid, err = _require_app_user()
    if err:
        return err
    try:
        return jsonify(practice_uc.comparison(
            practice_quiz_id, uid, bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


@app.get('/api/progress/overview')
def api_progress_overview():
    uid, err = _require_app_user()
    if err:
        return err
    return jsonify(progress_uc.overview(uid))


@app.get('/api/progress/concepts')
def api_progress_concepts():
    """Mastery theo concept qua nhiều attempt (FR-12.3, FR-12.4). `?weak=1` lọc chủ đề yếu."""
    uid, err = _require_app_user()
    if err:
        return err
    document_id = (request.args.get("document_id") or "").strip() or None
    if document_id:
        # `_owned_document` có 12 caller ngoài nhóm này — cổng ở lại đây, không chuyển.
        _row, err = _owned_document(document_id, uid)
        if err:
            return err
    weak_only = str(request.args.get("weak", "")).lower() in ("1", "true", "yes")
    return jsonify(progress_uc.concepts(uid, document_id=document_id, weak_only=weak_only))


@app.get('/api/progress/attempts')
def api_progress_attempts():
    uid, err = _require_app_user()
    if err:
        return err
    try:
        limit = max(1, min(200, int(request.args.get("limit", 50))))
    except (TypeError, ValueError):
        return jsonify({"error": "limit phải là số nguyên"}), 400
    return jsonify(progress_uc.attempt_history(uid, limit=limit))


# -------------------------
# ⚙️ API job dùng chung (đặc tả 7.10)
# -------------------------
@app.get('/api/jobs/<job_id>')
def api_job_get(job_id: str):
    """Tra job bất kể loại — FE chỉ cần một poller thay vì một cái cho mỗi tính năng."""
    uid, err = _require_app_user()
    if err:
        return err
    _run_jobs_maintenance()
    try:
        return jsonify(jobs_uc.xem(
            job_id, uid, bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


# Nguồn sự thật giờ ở `application/jobs.py`. Giữ TÊN Ở ĐÂY vì `test_query_cancel.py`
# đọc `app.main._CANCELLABLE_JOB_TYPES` để khẳng định "query" có trong tập còn
# "ingest"/"short_answer_grading" thì không.
_CANCELLABLE_JOB_TYPES = jobs_uc.LOAI_HUY_DUOC


@app.post('/api/jobs/<job_id>/cancel')
def api_job_cancel(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    # Cổng "loại nào huỷ được" đã sang `jobs_uc.LOAI_HUY_DUOC`. Giữ lại ở đây một
    # giới hạn mà tập hằng không nói được: với `query`, cờ huỷ được đọc ở ranh giới
    # giữa các node, nên trần là thời lượng node đang chạy (một request HTTP tới
    # Ollama) — huỷ không tức thì.
    try:
        return jsonify(jobs_uc.huy_chung(
            job_id, uid, bat_buoc_chu_so_huu=_auth_protect_enabled()))
    except attempts_uc.AttemptError as exc:
        return _attempt_err(exc)


@app.get('/list-indexed')
def list_indexed():
    """
    Lấy danh sách tất cả sources đã được index.
    Trả về format mà frontend expect: { video: stem, chunks: [...], num_chunks: N }
    """
    uid, err = _require_app_user()
    if err:
        return err
    try:
        with open(INDEX_META_JSON_PATH, encoding='utf-8') as f:
            meta = json.load(f)

        # Map canonical source_stem -> tên hiển thị (filename gốc) từ registry.
        stem_to_filename = {}
        try:
            for info in (_load_source_registry() or {}).values():
                st = _normalize_video_stem(info.get('source_stem') or info.get('filename') or '')
                if st and st not in stem_to_filename:
                    stem_to_filename[st] = info.get('filename') or st
        except Exception:
            pass

        video_map = {}
        from app.domains.vectorstore import chunk_text_store
        for key, item in meta.items():
            if not isinstance(key, str) or not key.isdigit():
                continue
            # Canonical stem DÙNG CHUNG với retrieval/upload (bỏ path/ext/timestamp,
            # sanitize space/đặc biệt).
            video_stem = _normalize_video_stem(item.get('source_stem') or '')
            if not video_stem or video_stem == 'unknown':
                continue
            t = chunk_text_store.get_text(int(key)) or item.get('text') or ''
            video_map.setdefault(video_stem, []).append(t)

        sources = []
        for video_stem, chunks in video_map.items():
            sources.append({
                'video': video_stem,          # giữ key cũ (FE đang đọc s.video)
                'video_stem': video_stem,     # khóa canonical (FE nên dùng cái này)
                'filename': stem_to_filename.get(video_stem) or video_stem,  # tên hiển thị
                'chunks': chunks,
                'num_chunks': len(chunks),
                'can_query': True,
            })

        # Owner scope (flag on): return only the caller's sources; legacy NULL-owner
        # sources are hidden (owned_stems excludes them under enforcement).
        if _auth_protect_enabled():
            owned = owned_stems(uid)
            sources = [s for s in sources if s.get('video_stem') in owned]

        return jsonify({'sources': sources})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e), 'sources': []})


# -------------------------
# 🔍 Query — chỉ LangGraph (QUERY_GRAPH)
# -------------------------
@app.post('/query')
def query():
    """
    Async job-based query:
    - POST /query returns immediately with job_id
    - background thread runs the existing pipeline
    - FE polls GET /query-status/<job_id>
    """
    _cleanup_old_query_jobs()

    data = request.json or {}
    q = data.get('q') or data.get('question') or ''
    selected_sources = data.get('sources') or []
    use_memory_tree = data.get('use_memory_tree', True)
    session_id = (data.get("session_id") or "").strip()
    f_category = (data.get('category') or '').strip() or None
    f_language = (data.get('language') or '').strip() or None
    node_context = data.get("node_context") or {
        "node_id": data.get("node_id"),
        "map_id": data.get("map_id"),
        "citations": data.get("citation_context") or [],
    }
    if not isinstance(node_context, dict):
        node_context = {}

    # Phase C: auth gate FIRST (before input validation) so a no-token request is
    # 401, not 400. /query stays in-process. Then owner-scope the selected sources.
    q_uid, q_err = _require_app_user()
    if q_err:
        return q_err

    if not (q or "").strip():
        return jsonify({'error': 'Missing query'}), 400

    selected_sources, src_err = _resolve_owned_query_sources(selected_sources, q_uid)
    if src_err:
        return src_err

    # Phase 4: ingress rate limit (off by default; fail-open). Structured 429.
    allowed, retry_after = _rate_limit_check(_rl_scope_id(session_id))
    if not allowed:
        return _rate_limited_response(retry_after)

    # Limit concurrent query threads (per-worker admission). Structured 429 + Retry-After.
    acquired = _query_semaphore.acquire(blocking=False)
    if not acquired:
        return _admission_rejected_response()

    job_id = str(uuid.uuid4())
    if not session_id:
        session_id = str(uuid.uuid4())
    # Auth Hardening Phase B: capture the caller identity NOW (request context;
    # the query runs in a thread with no request). /query itself is NOT gated in
    # Phase B — but with the flag on, conversation persistence/read is owner-scoped,
    # and with no authenticated user we skip it entirely (no NULL-owned rows).
    req_user_id = _current_user_id()
    conv_enforce = _auth_protect_enabled()
    auth_enforce = conv_enforce  # Phase C: same flag gates source/query protection
    # Phase E: cache scope. Flag off → "public" (shared cache, unchanged). Flag on → the
    # authenticated user id (never a client-supplied value). The protected /query route
    # already 401s without a user, so req_user_id is set here under enforcement; the
    # sentinel is a fail-safe that still never collapses to "public".
    cache_scope = (req_user_id or "\x00__no_user__") if auth_enforce else "public"
    usage_context = None
    if req_user_id:
        usage_key = str(
            data.get("idempotency_key")
            or request.headers.get("Idempotency-Key")
            or f"query:{job_id}"
        )
        try:
            usage_context = _reserve_usage_context(
                req_user_id,
                feature="chat",
                operation="ask",
                idempotency_key=usage_key,
                request_id=request.headers.get("X-Request-ID") or job_id,
                job_id=job_id,
                lease_owner=f"query-web:{os.getpid()}",
            )
        except Exception as exc:
            from app.domains.usage import QuotaExceeded
            _query_semaphore.release()
            if isinstance(exc, QuotaExceeded):
                return _quota_error_response(exc)
            raise
    # Conversation Context Layer: ensure the conversation row exists (flag-gated, fail-open).
    if _conversation_enabled() and not (conv_enforce and not req_user_id):
        try:
            from app.domains.conversation import store as _conv
            _conv.ensure_conversation(session_id, active_source_scope=selected_sources or [],
                                      user_id=req_user_id, enforce_owner=conv_enforce)
        except Exception:
            pass
    try:
        from app.domains.jobs.jobs_store import create_job as _js_create
        _js_create(
            job_id, job_type="query", status="pending", progress=0,
            current_node="Queued", user_id=req_user_id,
            usage_reservation_id=(usage_context.reservation_id if usage_context else None),
        )
    except Exception:
        pass
    with query_jobs_lock:
        query_jobs[job_id] = {
            "status": "pending",
            "result": None,
            "error": None,
            "created_at": time.time(),
            "user_id": req_user_id,  # Phase C: owner guard for status/stream/resume
            "usage_context": usage_context.to_dict() if usage_context else None,
        }

    def process_query_job(jid: str, question: str, sources: list, use_mem: bool, category: str | None = None, language: str | None = None) -> None:
        start_ts = time.time()
        sf_lock = None  # (key, token) if we became the single-flight leader
        # PR#4: follower ngủ chờ leader không được giữ admission slot. Cờ này là
        # NGUỒN SỰ THẬT duy nhất về slot — mọi release đi qua _release_for_wait /
        # finally, mỗi acquire đúng một release (Semaphore thường, double-release
        # sẽ phình capacity vĩnh viễn).
        holds_admission = True  # route đã acquire trước khi start thread

        def _release_for_wait() -> None:
            nonlocal holds_admission
            if holds_admission:
                holds_admission = False
                _query_semaphore.release()
                _SF_METRICS["follower_slot_released"] += 1
                _sf_log("singleflight_follower_slot_released", job=jid[:8])
        # Phase 0 observability: counter LLM call per-query (cache hit = 0 call).
        from app.graphs.logger import begin_llm_count, flush_llm_count
        _llm_counter = begin_llm_count()
        try:
            with query_jobs_lock:
                if jid in query_jobs:
                    query_jobs[jid]["status"] = "running"

            if QUERY_GRAPH is None:
                raise RuntimeError("QUERY_GRAPH chưa khởi tạo — kiểm tra logs khởi động.")

            # Phase 3 single-flight: coalesce duplicate/equivalent concurrent queries.
            # Fail-open — leader runs the graph below; follower served from cache returns here.
            # Phase E: user-scoped keys (cache_scope) — coalescing/cache are safe under the
            # flag because A and B get different single-flight + bucket keys, so they never
            # share a leader or an answer. Same user + same resolved sources still coalesce.
            try:
                _sf = _single_flight_try(jid, question, sources, use_mem, category, language, session_id, user_id=req_user_id, enforce_owner=conv_enforce, cache_scope=cache_scope, release_for_wait=_release_for_wait)
            except Exception:
                _sf = {"served": False, "lock": None}  # single-flight must never break the answer path
            if _sf.get("served"):
                if usage_context is not None:
                    from app.domains.usage import commit_reservation
                    commit_reservation(
                        usage_context.reservation_id,
                        attempt_id="cache-hit:single-flight",
                        total_tokens=0,
                        usage_source="system",
                        status="cache_hit",
                        metadata={"cache_hit": True},
                    )
                    _finish_usage_context(
                        usage_context, status="committed", job_id=jid,
                    )
                return  # follower finalized from the leader's cached answer
            sf_lock = _sf.get("lock")

            # PR#4: follower fail-open (đã nhả slot lúc ngủ) giờ phải chạy graph
            # → xin lại admission. Bị từ chối (slot đã bị query thật lấy) → job
            # error có cấu trúc, KHÔNG chạy graph lậu vượt capacity.
            if not holds_admission:
                if _query_semaphore.acquire(blocking=False):
                    holds_admission = True
                else:
                    _SF_METRICS["follower_readmit_rejected"] += 1
                    _sf_log("singleflight_follower_readmit_rejected", job=jid[:8])
                    busy_msg = "Hệ thống đang bận (quá nhiều truy vấn đồng thời). Vui lòng thử lại."
                    with query_jobs_lock:
                        if jid in query_jobs:
                            query_jobs[jid]["status"] = "error"
                            query_jobs[jid]["error"] = busy_msg
                    if _jobs_update_job:
                        try:
                            _jobs_update_job(jid, status="error", error_text=busy_msg)
                        except Exception:
                            pass
                    return

            try:
                from app.domains.jobs.jobs_store import clear_token_buffer as _js_tb_clear
                _js_tb_clear(jid)
            except Exception:
                pass

            try:
                from app.domains.jobs.sessions_store import get_history as _ss_get
                history = _ss_get(session_id, limit_messages=8, user_id=req_user_id)
            except Exception:
                history = []

            # Conversation Context Layer (flag-gated): replace the unscoped session
            # history with source-scoped, reset-aware turns so context never leaks
            # across documents and respects Clear-context. Fail-open to the legacy history.
            conv_ctx = None
            conv_sch = None
            if _conversation_enabled() and not (conv_enforce and not req_user_id):
                try:
                    conv_sch = llm_cache.source_context_hash(sources or [], language, category, bool(use_mem))
                except Exception:
                    conv_sch = None
                try:
                    from app.domains.conversation.context_builder import build_recent_conversation_context
                    conv_ctx = build_recent_conversation_context(
                        session_id, selected_sources=sources or [], source_context_hash=conv_sch,
                        user_id=req_user_id, enforce_owner=conv_enforce,
                    )
                    if not conv_ctx.is_empty:
                        history = [{"role": t["role"], "content": t["content"]} for t in conv_ctx.turns]
                    else:
                        history = []  # no same-scope context → treat as standalone (no leak)
                except Exception:
                    conv_ctx = None

            # Phase C: rewrite the follow-up into a standalone question for retrieval.
            # Original question is preserved for answer generation. Fail-open to original.
            standalone_q = question
            context_mode = "standalone"
            context_sig = None
            if _conversation_enabled() and conv_ctx is not None and not conv_ctx.is_empty:
                context_sig = conv_ctx.context_signature
                try:
                    from app.domains.conversation.rewrite import rewrite_followup_question, decide_context_mode
                    _rw = rewrite_followup_question(
                        question,
                        conv_ctx,
                        sources or [],
                        usage_context=usage_context,
                        usage_attempt_id="query-context-rewrite:0",
                    )
                    context_mode = decide_context_mode(_rw)
                    if context_mode == "contextual":
                        standalone_q = (_rw.get("standalone_question") or question)
                        print(f"conversation_rewrite mode={context_mode} conf={_rw.get('confidence')} "
                              f"q={question[:40]!r} -> {standalone_q[:60]!r}", flush=True)
                except Exception:
                    pass

            init_state = {
                "job_id": jid,
                "session_id": session_id,
                "conversation_history": history,
                "conversation_context": (conv_ctx.to_dict() if conv_ctx is not None else None),
                "source_context_hash": conv_sch,
                "original_question": question,
                "standalone_question": standalone_q,
                "context_mode": context_mode,
                "context_signature": context_sig,
                "q": question,
                "selected_sources": sources or [],
                "use_memory_tree": bool(use_mem),
                "category": category,
                "language": language,
                # Phase E: cache scope threaded to the graph so answer-cache read/write
                # and the retrieval cache key on this user under enforcement ("public"
                # when the flag is off → shared cache unchanged). Replaces the Phase C
                # auth_no_cache bypass.
                "cache_scope": cache_scope,
                "usage_context": usage_context.to_dict() if usage_context else None,
                "retrieved_chunks": [],
                "retrieved_sources": [],
                "context": "",
                # Context supplied by the verified Mind Map inspector. The graph
                # may use this as conversational context; citations remain server
                # data and are never synthesized from this client field.
                "node_context": {
                    "node_id": str(node_context.get("node_id") or ""),
                    "map_id": str(node_context.get("map_id") or ""),
                    "citations": node_context.get("citations") if isinstance(node_context.get("citations"), list) else [],
                },
                "answer": "",
                "retry_count": 0,
                "low_confidence": False,
                "progress": 0,
                "current_node": "Queued",
                "error": None,
            }
            # thread_id = jid (duy nhất/truy vấn) → tránh rò state/interrupt giữa các lượt cùng session; lưu để /query-resume dùng lại.
            with query_jobs_lock:
                if jid in query_jobs:
                    query_jobs[jid]["thread_id"] = jid
                    query_jobs[jid]["question"] = question
                    query_jobs[jid]["session_id"] = session_id
            out = _langgraph_invoke(QUERY_GRAPH, init_state, thread_id=jid)
            review = _detect_query_interrupt(QUERY_GRAPH, jid)
            if review is not None:
                _mark_query_interrupted(jid, review)
                return
            if usage_context is not None:
                if out.get("usage_cache_hit"):
                    from app.domains.usage import commit_reservation
                    commit_reservation(
                        usage_context.reservation_id,
                        attempt_id="cache-hit:query-graph",
                        total_tokens=0,
                        usage_source="system",
                        status="cache_hit",
                        metadata={"cache_hit": True},
                    )
                    _finish_usage_context(
                        usage_context, status="committed", job_id=jid,
                    )
                else:
                    _finish_usage_context(usage_context, status="committed", job_id=jid)
            # Publish terminal job status only after the usage aggregate is
            # durable/in-memory. Pollers stop on `done`, so the reverse order
            # races and permanently loses the inline usage display.
            _finalize_query_job(
                jid, session_id, question, out,
                user_id=req_user_id, enforce_owner=conv_enforce,
            )
        except Exception as exc:
            err_txt = _job_error_text(exc)
            with query_jobs_lock:
                if jid in query_jobs:
                    query_jobs[jid]["status"] = "error"
                    query_jobs[jid]["error"] = err_txt
            if _jobs_update_job:
                try:
                    _jobs_update_job(jid, status="error", error_text=err_txt)
                except Exception:
                    pass
            logging.exception("[QUERY_JOB] job_id=%s failed: %s", jid, err_txt)
            if usage_context is not None:
                try:
                    from app.domains.usage import get_operation_usage
                    current_usage = get_operation_usage(
                        usage_context.reservation_id, user_id=usage_context.user_id,
                    )
                    terminal = "failed" if int((current_usage or {}).get("total_tokens") or 0) else "released"
                    _finish_usage_context(usage_context, status=terminal, job_id=jid)
                except Exception:
                    logging.exception("[QUERY_USAGE] failed to close reservation job_id=%s", jid)
        finally:
            flush_llm_count(jid, _llm_counter)
            # Release the single-flight lock AFTER finalize (cache already written) so
            # followers read the leader's answer rather than racing an empty cache.
            if sf_lock:
                try:
                    _single_flight_release(sf_lock[0], sf_lock[1])
                except Exception:
                    pass
            elapsed = time.time() - start_ts
            if elapsed > QUERY_JOB_TIMEOUT_SEC:
                print(f"[QUERY_JOB] job_id={jid} exceeded timeout={QUERY_JOB_TIMEOUT_SEC}s (elapsed={elapsed:.1f}s)")
            # PR#4: chỉ release khi còn giữ (follower đã nhả lúc ngủ thì thôi —
            # double release trên Semaphore thường phình capacity vĩnh viễn).
            if holds_admission:
                holds_admission = False
                _query_semaphore.release()

    thread = threading.Thread(
        target=process_query_job,
        args=(job_id, q, selected_sources, use_memory_tree, f_category, f_language),
        daemon=True
    )
    thread.start()

    # Return immediately (no blocking)
    return jsonify({"job_id": job_id, "status": "pending", "session_id": session_id}), 202


@app.get('/query-status/<job_id>')
def query_status(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    if _auth_protect_enabled() and _query_job_owner_ok(job_id, uid) is not True:
        return jsonify({"error": "Job not found"}), 404  # foreign/unknown → no oracle
    _cleanup_old_query_jobs()
    _run_jobs_maintenance()
    # Ưu tiên SQLite jobs store nếu bật
    if (os.getenv("USE_SQLITE_JOBS", "1") or "").strip() not in ("0", "false", "False"):
        try:
            from app.domains.jobs.jobs_store import get_job as _js_get
            j = _js_get(job_id)
            if j and j.get("job_type") in ("query", None):
                return jsonify({
                    "status": j.get("status"),
                    "result": j.get("result"),
                    "error": j.get("error"),
                    "usage": j.get("usage_summary"),
                }), 200
        except Exception:
            pass
    with query_jobs_lock:
        job = query_jobs.get(job_id)
        if not job:
            return jsonify({"error": "Job not found"}), 404
        return jsonify({
            "status": job.get("status"),
            "result": job.get("result"),
            "error": job.get("error"),
            "usage": job.get("usage_summary"),
        }), 200


@app.post('/query-resume/<job_id>')
def query_resume(job_id: str):
    """HITL: tiếp tục một job đang chờ duyệt (status='interrupted').

    Body: {"action": "approve"|"edit"|"reject", "answer": "..."}.
    """
    uid, err = _require_app_user()
    if err:
        return err
    if _auth_protect_enabled() and _query_job_owner_ok(job_id, uid) is not True:
        return jsonify({"error": "Job not found"}), 404  # cannot resume another user's job
    data = request.json or {}
    action = str(data.get("action") or "approve").strip().lower()
    if action not in ("approve", "edit", "reject"):
        return jsonify({"error": "action phải là approve, edit hoặc reject"}), 400
    decision = {"action": action}
    if action == "edit":
        decision["answer"] = str(data.get("answer") or "").strip()

    with query_jobs_lock:
        job = query_jobs.get(job_id)
        if not job:
            return jsonify({"error": "Job not found"}), 404
        if job.get("status") != "interrupted":
            return jsonify({"error": "Job không ở trạng thái chờ duyệt"}), 409
        tid = job.get("thread_id") or job_id
        session_id = job.get("session_id") or ""
        question = job.get("question") or ""
        from app.domains.usage import UsageReservationContext
        resume_usage_context = UsageReservationContext.from_dict(job.get("usage_context"))
        job["status"] = "running"

    acquired = _query_semaphore.acquire(blocking=False)
    if not acquired:
        with query_jobs_lock:
            if job_id in query_jobs:
                query_jobs[job_id]["status"] = "interrupted"
        return _admission_rejected_response()

    # Capture caller identity in request context (resume_job runs in a thread).
    resume_uid = _current_user_id()
    resume_enforce = _auth_protect_enabled()

    def resume_job() -> None:
        try:
            from langgraph.types import Command
            out = _langgraph_invoke(QUERY_GRAPH, None, thread_id=tid, command=Command(resume=decision))
            review = _detect_query_interrupt(QUERY_GRAPH, tid)
            if review is not None:
                _mark_query_interrupted(job_id, review)
                return
            _finalize_query_job(job_id, session_id, question, out, user_id=resume_uid, enforce_owner=resume_enforce)
            if resume_usage_context is not None:
                _finish_usage_context(
                    resume_usage_context, status="committed", job_id=job_id,
                )
        except Exception as exc:
            err_txt = _job_error_text(exc)
            with query_jobs_lock:
                if job_id in query_jobs:
                    query_jobs[job_id]["status"] = "error"
                    query_jobs[job_id]["error"] = err_txt
            if _jobs_update_job:
                try:
                    _jobs_update_job(job_id, status="error", error_text=err_txt)
                except Exception:
                    pass
            logging.exception("[QUERY_RESUME] job_id=%s failed: %s", job_id, err_txt)
            if resume_usage_context is not None:
                try:
                    from app.domains.usage import get_operation_usage
                    used = get_operation_usage(
                        resume_usage_context.reservation_id,
                        user_id=resume_usage_context.user_id,
                    )
                    _finish_usage_context(
                        resume_usage_context,
                        status="failed" if int((used or {}).get("total_tokens") or 0) else "released",
                        job_id=job_id,
                    )
                except Exception:
                    logging.exception("[QUERY_USAGE] failed to close resumed reservation")
        finally:
            _query_semaphore.release()

    threading.Thread(target=resume_job, daemon=True).start()
    return jsonify({"job_id": job_id, "status": "running"}), 202


@app.get("/query-stream/<job_id>")
def query_stream(job_id: str):
    """
    SSE: stream trạng thái job query realtime (thay polling).
    Dữ liệu đọc từ jobs_store (SQLite) nếu có.
    Phase 2C: header chuẩn proxy + timeout SSE_TIMEOUT_SEC.
    """
    uid, err = _require_app_user()
    if err:
        return err
    if _auth_protect_enabled() and _query_job_owner_ok(job_id, uid) is not True:
        return jsonify({"error": "Job not found"}), 404  # SSE token_buffer must not leak cross-user
    sse_timeout = int(os.getenv("SSE_TIMEOUT_SEC", "300"))

    def generate():
        waited = 0.0
        interval = float(os.getenv("SSE_POLL_INTERVAL_SEC", "0.4"))
        last_token_len = 0
        while waited < sse_timeout:
            try:
                from app.domains.jobs.jobs_store import get_job as _js_get
                j = _js_get(job_id) or {}
            except Exception:
                j = {}

            buf = j.get("token_buffer") or ""
            if isinstance(buf, str) and len(buf) > last_token_len:
                delta = buf[last_token_len:]
                last_token_len = len(buf)
                yield f"data: {json.dumps({'type': 'token', 'content': delta, 'job_id': job_id}, ensure_ascii=False)}\n\n"

            st = j.get("status")
            err_raw = j.get("error")
            if isinstance(err_raw, str):
                err_sse = err_raw.strip()
            elif err_raw is not None:
                err_sse = str(err_raw).strip()
            else:
                err_sse = ""
            if st == "error" and not err_sse:
                err_sse = "Lỗi không xác định khi xử lý truy vấn."

            payload = {
                "type": "status",
                "job_id": job_id,
                "status": st,
                "progress": j.get("progress"),
                "current_node": j.get("current_node"),
                "result": j.get("result"),
                "error": err_sse or None,
                "usage": j.get("usage_summary"),
            }
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            if st in ("done", "error", "interrupted"):
                return
            time.sleep(interval)
            waited += interval

        yield f"data: {json.dumps({'job_id': job_id, 'error': 'SSE timeout', 'status': 'error', 'type': 'status'}, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )

# -------------------------
# 📝 Summary v2 — section-first, job async (mirror mindmap; spec docs/SUMMARY_V2_SPEC.md)
# -------------------------
def _summary_input_and_hash(source_names: list[str], length_mode: str,
                            mode: str = "standard") -> tuple[dict, str]:
    mm = collect_mindmap_input(INDEX_META_JSON_PATH, source_names)
    # Phase 5: coverage flag goes into the cache key so a no-coverage record cached earlier is
    # not served once SUMMARY_COVERAGE=1 (and vice-versa). collect_node mirrors this.
    from shared.config import get_settings as _get_settings
    _s = _get_settings()
    cov_on, facts_on = _s.summary_coverage, _s.summary_facts
    h = summary_schema.content_hash(mm.get("sources") or [],
                                    [c["text"] for c in mm.get("chunks") or []],
                                    [c.get("heading_path", "") for c in mm.get("chunks") or []],
                                    length_mode, mode, cov_on, facts_on)
    return mm, h


def _start_summary_job(source_names: list[str], mm_input: dict, content_hash: str,
                       length_mode: str, mode: str = "standard", *,
                       usage_idempotency_key: Optional[str] = None,
                       operation: str = "generate") -> str:
    """Phase 5 Step 2: dispatch Summary v2 via enqueue_job — daemon thread when
    QUEUE_ENABLED=false (default, unchanged), RQ 'summary' queue when true. FE polling
    (/summary-status) unchanged; result still in summary_store."""
    job_id = str(uuid.uuid4())
    uid = _current_user_id()  # request context: stamp job + record owner (Phase D)
    usage_context = _reserve_usage_context(
        uid,
        feature="summary",
        operation=operation,
        idempotency_key=usage_idempotency_key or f"summary:{job_id}",
        request_id=request.headers.get("X-Request-ID") or job_id,
        job_id=job_id,
        lease_owner=f"summary-web:{os.getpid()}",
    )
    from app.domains.jobs.jobs_store import create_job
    create_job(
        job_id, job_type="summary", status="pending", progress=0,
        current_node="Queued", user_id=uid,
        usage_reservation_id=(usage_context.reservation_id if usage_context else None),
    )
    from app.jobs.queue import enqueue_job
    try:
        res = enqueue_job(
            run_summary_job,
            args=(job_id, source_names, mm_input, content_hash, length_mode, uid,
                  mode, usage_context.to_dict() if usage_context else None),
            queue="summary", job_id=job_id,
        )
    except Exception:
        _finish_usage_context(usage_context, status="released", job_id=job_id)
        raise
    _event = {"rq": "summary_enqueue_rq", "thread": "summary_enqueue_thread",
              "thread_fallback": "summary_queue_fallback_thread"}.get(res.get("mode"),
                                                                      f"summary_enqueue_{res.get('mode')}")
    print(f"{_event} job_id={job_id}", flush=True)
    return job_id


# ── Wrapper tương thích (Phase 1) ──────────────────────────────────────────
# Thân hàm đã chuyển sang `app/application/`. Giữ tên ở ĐÚNG chỗ này vì RQ
# serialize hàm theo `module.qualname` (`app.main.<ten>`) — job đã nằm trong
# hàng đợi trước lúc deploy vẫn phải resolve được. Chữ ký giữ NGUYÊN.
def run_summary_job(job_id: str, source_names: list[str], mm_input: dict,
                    content_hash: str, length_mode: str, user_id: Optional[str] = None,
                    mode: str = "standard", usage_context_data: Optional[dict] = None) -> None:
    # Graph là biến module của file này (dựng lúc khởi động) — TIÊM vào use case
    # thay vì để tầng application import ngược lên tầng API.
    from app.application.summary_generation import run_summary_job as _impl
    return _impl(job_id, source_names, mm_input, content_hash, length_mode, user_id,
                 mode, usage_context_data, graph=SUMMARY_GRAPH)


# -------------------------
# 💬 Conversation Context Layer — controls (Phase B)
# Flag-gated; when disabled the routes report a clear disabled state so the FE can
# degrade gracefully. All handlers fail open — a store error never 500s the chat.
# -------------------------
@app.post('/conversations/<conversation_id>/clear-context')
def clear_conversation_context(conversation_id: str):
    """Clear context: stop using older turns from now on. Keeps messages in the DB."""
    if not _conversation_enabled():
        return jsonify({"ok": False, "error": "conversation_context_disabled"}), 404
    uid, err = _require_app_user()
    if err:
        return err
    enforce = _auth_protect_enabled()
    try:
        from app.domains.conversation import store as _conv
        if enforce and _conv.owner_check(conversation_id, uid) is False:
            return jsonify({"ok": False, "error": "not_found"}), 404  # owner mismatch → no oracle
        reset_at = _conv.set_context_reset(conversation_id, user_id=uid, enforce_owner=enforce)
        if enforce and reset_at is None:
            return jsonify({"ok": False, "error": "not_found"}), 404
        return jsonify({"ok": True, "conversation_id": conversation_id, "context_reset_at": reset_at})
    except Exception as e:
        logging.exception("[conversation] clear-context failed: %s", e)
        return jsonify({"ok": False, "error": "clear_context_failed"}), 500


@app.delete('/conversations/<conversation_id>')
def delete_conversation(conversation_id: str):
    """Delete chat history: hard-delete this conversation's messages (storage-saving)."""
    if not _conversation_enabled():
        return jsonify({"ok": False, "error": "conversation_context_disabled"}), 404
    uid, err = _require_app_user()
    if err:
        return err
    enforce = _auth_protect_enabled()
    try:
        from app.domains.conversation import store as _conv
        if enforce and _conv.owner_check(conversation_id, uid) is False:
            return jsonify({"ok": False, "error": "not_found"}), 404  # owner mismatch → no oracle
        removed = _conv.delete_messages(conversation_id, user_id=uid, enforce_owner=enforce)
        _conv.soft_delete(conversation_id, user_id=uid, enforce_owner=enforce)
        return jsonify({"ok": True, "conversation_id": conversation_id, "removed": removed})
    except Exception as e:
        logging.exception("[conversation] delete failed: %s", e)
        return jsonify({"ok": False, "error": "delete_failed"}), 500


@app.get('/conversations/<conversation_id>/messages')
def get_conversation_messages(conversation_id: str):
    """Return this conversation's messages (for restoring the chat UI)."""
    if not _conversation_enabled():
        return jsonify({"conversation_id": conversation_id, "messages": []}), 404
    uid, err = _require_app_user()
    if err:
        return err
    enforce = _auth_protect_enabled()
    try:
        from app.domains.conversation import store as _conv
        if enforce and _conv.owner_check(conversation_id, uid) is False:
            return jsonify({"error": "not_found"}), 404  # owner mismatch → no oracle
        msgs = _conv.get_messages(conversation_id, user_id=uid, enforce_owner=enforce)
        return jsonify({"conversation_id": conversation_id, "messages": msgs})
    except Exception as e:
        logging.exception("[conversation] get-messages failed: %s", e)
        return jsonify({"conversation_id": conversation_id, "messages": []}), 500


@app.post("/generate-summary")
def generate_summary():
    uid, err = _require_app_user()
    if err:
        return err
    data = request.json or {}
    raw_sources = data.get("sources") or []
    if not isinstance(raw_sources, list):
        return jsonify({"error": "Sources phải là list"}), 400

    source_names: list[str] = []
    for item in raw_sources:
        candidate = None
        if isinstance(item, str):
            candidate = item.strip()
        elif isinstance(item, dict):
            for key in ("video", "name", "id", "source", "title"):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    candidate = value.strip()
                    break
        if candidate and candidate not in source_names:
            source_names.append(candidate)

    if not source_names:
        return jsonify({"error": "No sources selected"}), 400

    # Phase D: every requested source must be owned (foreign → 403, no global fallback).
    src_err = _ensure_owned_sources(source_names, uid)
    if src_err:
        return src_err

    raw_length = str(data.get("length_mode") or "").strip().lower()
    length_mode = raw_length if raw_length in summary_schema.LENGTH_MODES else "medium"

    # mode = mục đích/định dạng (standard|study), trực giao length_mode. Thiếu → standard.
    # Có gửi nhưng sai → 400 rõ ràng (không âm thầm rơi về standard như length_mode).
    raw_smode = str(data.get("mode") or "standard").strip().lower()
    if raw_smode not in summary_schema.SUMMARY_MODES:
        return jsonify({"error": f"mode không hợp lệ (chọn: {', '.join(summary_schema.SUMMARY_MODES)})"}), 400
    mode = raw_smode

    force = bool(data.get("force"))
    try:
        mm_input, content_hash = _summary_input_and_hash(source_names, length_mode, mode)
    except Exception as e:
        return jsonify({"error": f"Không đọc được dữ liệu nguồn: {e}"}), 500
    if not mm_input.get("chunks"):
        return jsonify({"error": "Nguồn chưa có dữ liệu đã index"}), 400
    if not force:
        # Phase D: user-scoped cache lookup so User B can never reuse User A's summary
        # record even on an identical content_hash. Flag off → today's global lookup.
        cached = (summary_store.get_by_hash(content_hash, user_id=uid, enforce_owner=True)
                  if _auth_protect_enabled() else summary_store.get_by_hash(content_hash))
        if cached:
            # Cache hit KHÔNG có job_id — FE phải branch theo status="done" trước (aec6017)
            return jsonify({
                "status": "done", "result": cached, "cached": True,
                "usage": _zero_cache_hit_usage(),
            }), 200
    usage_key = str(
        data.get("idempotency_key") or request.headers.get("Idempotency-Key")
        or f"summary:{uuid.uuid4()}"
    )
    try:
        import inspect
        start_kwargs = {}
        start_params = inspect.signature(_start_summary_job).parameters.values()
        if any(p.name == "usage_idempotency_key" or p.kind == p.VAR_KEYWORD
               for p in start_params):
            start_kwargs = {
                "usage_idempotency_key": usage_key,
                "operation": "regenerate" if force else "generate",
            }
        job_id = _start_summary_job(
            source_names, mm_input, content_hash, length_mode, mode, **start_kwargs,
        )
    except Exception as exc:
        from app.domains.usage import QuotaExceeded
        if isinstance(exc, QuotaExceeded):
            return _quota_error_response(exc)
        raise
    return jsonify({"job_id": job_id, "status": "started"}), 202


@app.get("/summary-status/<job_id>")
def summary_status(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    _run_jobs_maintenance()
    from app.domains.jobs.jobs_store import get_job as _js_get
    j = _js_get(job_id)
    if not j or j.get("job_type") not in ("summary", None):
        return jsonify({"error": "Job not found"}), 404
    if _auth_protect_enabled() and j.get("user_id") != uid:
        return jsonify({"error": "Job not found"}), 404  # foreign job → no oracle
    return jsonify({
        "status": j.get("status"),
        "progress": j.get("progress", 0),
        "current_node": j.get("current_node") or "",
        "result": j.get("result"),
        "error": j.get("error"),
        "usage": j.get("usage_summary"),
    }), 200


@app.post("/summary-cancel/<job_id>")
def summary_cancel(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    # Owner check BEFORE cancel — never let User B cancel User A's job.
    if _auth_protect_enabled() and _derived_job_owner_ok(job_id, uid, ("summary", None)) is not True:
        return jsonify({"error": "Job not found"}), 404
    from app.domains.jobs.jobs_store import get_job as _js_get, request_cancel
    j = _js_get(job_id)
    if not j or j.get("job_type") not in ("summary", None):
        return jsonify({"error": "Job not found"}), 404  # cùng contract với /summary-status
    request_cancel(job_id)
    # Idempotent: done/error/cancelled giữ nguyên; pending/interrupted → cancelled NGAY
    # (không còn executor để ack cờ); running → cờ cooperative, graph dừng ở checkpoint kế.
    j2 = _js_get(job_id) or {}
    return jsonify({"ok": True, "status": j2.get("status")}), 200


@app.route('/summaries', methods=['OPTIONS'])
def summaries_options():
    return jsonify({"ok": True}), 200


@app.get('/summaries')
def list_summaries():
    uid, err = _require_app_user()
    if err:
        return err
    if _auth_protect_enabled():
        return jsonify({"summaries": summary_store.list_records(user_id=uid, enforce_owner=True)})
    return jsonify({"summaries": summary_store.list_records()})


@app.delete('/summaries/<string:summary_id>')
def delete_summary(summary_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    # Owner-scoped delete: a foreign summary is indistinguishable from a missing one.
    ok = (summary_store.delete_record(summary_id, user_id=uid, enforce_owner=True)
          if _auth_protect_enabled() else summary_store.delete_record(summary_id))
    if not ok:
        return jsonify({"error": "Summary not found"}), 404
    return jsonify({"message": "Deleted", "removed": 1})



# -------------------------
# 🗑️ Delete source
# -------------------------
@app.post('/delete-source')
def delete_source():
    uid, err = _require_app_user()
    if err:
        return err
    data = request.json or {}
    video_name = data.get('video', '')
    if not video_name:
        return jsonify({'error': 'Missing video name'}), 400

    target_stem = _normalize_video_stem(video_name)
    # Owner scope: cannot delete another user's source (404, no oracle).
    if _auth_protect_enabled() and not _source_owner_ok(target_stem, uid):
        return jsonify({'error': 'Source not found'}), 404
    meta_path = INDEX_META_JSON_PATH
    if not meta_path.exists():
        return jsonify({'error': 'No index metadata found'}), 404

    try:
        with open(meta_path, encoding='utf-8') as f:
            meta = json.load(f)

        # Khớp theo canonical stem DÙNG CHUNG (không glob prefix → không xóa nhầm).
        stored_names = set()
        removed_total = 0
        for v in meta.values():
            if not isinstance(v, dict):
                continue
            raw_stem = v.get('source_stem') or ''
            if raw_stem and _normalize_video_stem(raw_stem) == target_stem:
                stored_names.add(raw_stem)
                removed_total += 1

        if not stored_names:
            return jsonify({'message': 'No matching source found', 'removed': 0})

        for stored in stored_names:
            try:
                delete_source_from_index(stored)
            except Exception as e:
                print("delete_source_from_index failed:", stored, e)

        # Cache Redis: index_version (mtime index.json) đã đổi nên entry cũ tự orphan;
        # xoá chủ động thêm cho chắc (best-effort, fail-open).
        try:
            llm_cache.invalidate_all()
        except Exception as e:
            print("cache invalidate failed:", e)

        # Dọn bản ghi documents cùng canonical stem (+ file gốc local và trên Storage).
        try:
            from app.domains.documents import repository as _docs
            from app.domains.documents import storage as _storage
            reg = _load_source_registry()
            to_del = [sid for sid, info in reg.items()
                      if _normalize_video_stem(info.get('source_stem') or info.get('filename') or '') == target_stem]
            for sid in to_del:
                info = reg[sid]
                ip = info.get('input_path')
                if ip:
                    try:
                        if Path(ip).is_file():
                            Path(ip).unlink()
                    except Exception:
                        pass
                obj = info.get('file_path')
                if obj and obj != ip and _storage.is_configured():
                    _storage.delete(obj)
                _docs.hard_delete(sid)
        except Exception as e:
            print("document cleanup failed:", e)

        try:
            mindmap_store.delete_by_source(target_stem)
        except Exception as e:
            print("mindmap store cleanup failed:", e)

        try:
            summary_store.delete_by_source(target_stem)
        except Exception as e:
            print("summary store cleanup failed:", e)

        return jsonify({'message': 'Deleted', 'removed': removed_total})

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def _mindmap_input_and_hash(source_names: list[str]) -> tuple[dict, str]:
    mm = collect_mindmap_input(INDEX_META_JSON_PATH, source_names)
    h = mindmap_schema.content_hash(mm.get("sources") or [],
                                    [c["text"] for c in mm.get("chunks") or []],
                                    [c.get("heading_path", "") for c in mm.get("chunks") or []])
    return mm, h


def _start_mindmap_job(source_names: list[str], mm_input: dict, content_hash: str,
                       generation_intent: Optional[dict] = None, *, job_id: Optional[str] = None,
                       job_metadata: Optional[dict] = None,
                       usage_context_data: Optional[dict] = None) -> str:
    """Phase 5 Step 3: dispatch Mindmap v3 via enqueue_job — daemon thread when
    QUEUE_ENABLED=false (default, unchanged), RQ 'mindmap' queue when true. FE polling
    (/mindmap-status) unchanged; result still in mindmap_store."""
    job_id = job_id or str(uuid.uuid4())
    uid = _current_user_id()  # request context: stamp job + record owner (Phase D)
    from app.domains.jobs.jobs_store import create_job
    from app.domains.jobs import guided_store
    if not job_metadata:
        if guided_store.use_postgres() and generation_intent is not None:
            # The Postgres row is created by the request route. A missing row is
            # a programming/configuration error; never start a process-local job.
            if not guided_store.get_job(job_id, user_id=uid):
                raise RuntimeError("durable_store_unavailable")
        else:
            create_job(
                job_id, job_type="mindmap", status="pending", progress=0,
                current_node="Queued", user_id=uid,
                usage_reservation_id=(usage_context_data or {}).get("reservation_id"),
            )
    if guided_store.use_postgres() and generation_intent is not None:
        print(f"mindmap_job_durable_enqueue job_id={job_id}", flush=True)
        return job_id
    from app.jobs.queue import enqueue_job
    try:
        res = enqueue_job(run_mindmap_job,
                          args=(job_id, source_names, mm_input, content_hash, uid, usage_context_data),
                          queue="mindmap", job_id=job_id)
    except Exception:
        from app.domains.usage import UsageReservationContext
        _finish_usage_context(
            UsageReservationContext.from_dict(usage_context_data),
            status="released", job_id=job_id,
        )
        raise
    _event = {"rq": "mindmap_enqueue_rq", "thread": "mindmap_enqueue_thread",
              "thread_fallback": "mindmap_queue_fallback_thread"}.get(res.get("mode"),
                                                                      f"mindmap_enqueue_{res.get('mode')}")
    print(f"{_event} job_id={job_id}", flush=True)
    return job_id


# ── Wrapper tương thích (Phase 1) ──────────────────────────────────────────
# Thân hàm đã chuyển sang `app/application/`. Giữ tên ở ĐÚNG chỗ này vì RQ
# serialize hàm theo `module.qualname` (`app.main.<ten>`) — job đã nằm trong
# hàng đợi trước lúc deploy vẫn phải resolve được. Chữ ký giữ NGUYÊN.
def run_mindmap_job(job_id: str, source_names: list[str], mm_input: dict, content_hash: str,
                    user_id: Optional[str] = None, usage_context_data: Optional[dict] = None,
                    *, already_claimed: bool = False) -> None:
    from app.application.mindmap_generation import run_mindmap_job as _impl
    return _impl(job_id, source_names, mm_input, content_hash, user_id, usage_context_data,
                 graph=MINDMAP_GRAPH, already_claimed=already_claimed)


def _recover_guided_jobs() -> None:
    """Re-enqueue durable Guided requests after a web/worker restart.

    Only source IDs and guided configuration are persisted. Chunks are rebuilt
    from the current indexed source store, so the jobs table never stores
    document content or credentials.
    """
    if (os.getenv("GUIDED_JOB_RECOVERY_ENABLED", "false") or "").strip().lower() not in ("1", "true", "yes", "on"):
        return
    try:
        from app.domains.jobs.jobs_store import recover_expired_jobs, list_recoverable_mindmap_jobs
        recover_expired_jobs()
        from app.domains.mindmap.guided import intent_hash, suggest_topics
        for row in list_recoverable_mindmap_jobs():
            source_names = row.get("source_ids") or []
            mm_input, content_hash = _mindmap_input_and_hash(source_names)
            intent = row.get("guided_config") or None
            if intent:
                topics = suggest_topics(mm_input)
                mm_input = {**mm_input, "generation_intent": intent, "guided_topics": topics}
                content_hash = intent_hash(content_hash, intent)
            _start_mindmap_job(source_names, mm_input, content_hash, intent,
                               job_id=row["job_id"], job_metadata=row)
    except Exception as exc:
        print(f"guided_job_recovery_failed err={str(exc)[:120]}", flush=True)


# -------------------------
def _guided_v3_enabled(user_id: Optional[str]) -> bool:
    """Server-authoritative rollout gate; client flags are never trusted."""
    # The repository's explicit open/dev mode remains backward-compatible for
    # legacy test clients. Production has AUTH_PROTECT_APP_APIS=true, so this
    # branch cannot grant an unauthenticated production caller access.
    if not _auth_protect_enabled():
        return True
    if not user_id:
        return False
    qa_ids = {item.strip() for item in (os.getenv("GUIDED_MINDMAP_V3_QA_USER_IDS") or "").split(",") if item.strip()}
    enabled = (os.getenv("GUIDED_MINDMAP_V3_ENABLED", "false") or "").strip().lower() in ("1", "true", "yes", "on")
    return enabled or user_id in qa_ids


def _guided_capability(user_id: Optional[str]) -> dict[str, Any]:
    if not _guided_v3_enabled(user_id):
        return {"guided_mindmap_v3": False, "fallback": "v2", "reason": "guided_v3_disabled"}
    from app.domains.jobs import guided_store
    store = guided_store.health()
    if guided_store.use_postgres() and not store.get("available"):
        return {"guided_mindmap_v3": False, "fallback": "v2", "reason": "durable_store_unavailable"}
    if guided_store.use_postgres() and not guided_store.worker_healthy(int(os.getenv("GUIDED_WORKER_HEARTBEAT_TTL_SEC", "90"))):
        return {"guided_mindmap_v3": False, "fallback": "v2", "reason": "worker_unhealthy"}
    try:
        from app.clients.llm_factory import PROVIDERS
        configured_provider = any((os.getenv(key) or "").strip() for key in (
            "GEMINI_API_KEY", "GROQ_API_KEY", "FPT_AI_API_KEY", "LLM_GATEWAY_ADDR"))
        if not PROVIDERS or (os.getenv("PROCESS_ROLE", "").strip().lower() in {"web", "mindmap-worker"} and not configured_provider):
            return {"guided_mindmap_v3": False, "fallback": "v2", "reason": "provider_not_configured"}
    except Exception:
        return {"guided_mindmap_v3": False, "fallback": "v2", "reason": "provider_not_configured"}
    return {"guided_mindmap_v3": True, "fallback": "v2", "reason": None}


@app.get("/mindmaps/capability")
def mindmap_capability():
    uid, err = _require_app_user()
    if err:
        return err
    return jsonify(_guided_capability(uid)), 200


@app.post("/mindmaps/suggest-topics")
def suggest_mindmap_topics():
    uid, err = _require_app_user()
    if err:
        return err
    capability = _guided_capability(uid)
    if not capability["guided_mindmap_v3"]:
        return jsonify({"error": "Guided Mind Map V3 is unavailable", "error_code": capability["reason"], "fallback": "v2"}), 404
    data = request.json or {}
    raw_sources = data.get("source_ids") or data.get("sources") or []
    if not isinstance(raw_sources, list) or not raw_sources:
        return jsonify({"error": "No sources selected"}), 400
    source_names = []
    for item in raw_sources:
        value = item if isinstance(item, str) else (item.get("video") or item.get("name") or item.get("id") or item.get("source"))
        if isinstance(value, str) and value.strip() and value.strip() not in source_names:
            source_names.append(value.strip())
    if not source_names:
        return jsonify({"error": "No sources selected"}), 400
    src_err = _ensure_owned_sources(source_names, uid)
    if src_err:
        return src_err
    ready_err = _ensure_ready_sources(source_names)
    if ready_err:
        return ready_err
    try:
        mm_input, _ = _mindmap_input_and_hash(source_names)
    except Exception as exc:
        return jsonify({"error": f"Không đọc được dữ liệu nguồn: {exc}"}), 500
    if not mm_input.get("chunks"):
        return jsonify({"suggestions": [], "status": "empty"}), 200
    from app.domains.mindmap.guided import suggest_topics
    return jsonify({"suggestions": suggest_topics(mm_input, str(data.get("query") or "")),
                    "source_ids": source_names}), 200


@app.post("/generate-mindmap")
def generate_mindmap():
    uid, err = _require_app_user()
    if err:
        return err
    data = request.json or {}
    guided_requested = any(key in data for key in ("instruction", "selected_topic_ids", "selected_topics", "preset", "detail_level"))
    capability = _guided_capability(uid) if guided_requested else None
    if guided_requested and not capability["guided_mindmap_v3"]:
        return jsonify({"error": "Guided Mind Map V3 is unavailable", "error_code": capability["reason"], "fallback": "v2"}), 404
    raw_sources = data.get("sources") or []
    if not isinstance(raw_sources, list):
        return jsonify({"error": "Sources phải là list"}), 400

    source_names: list[str] = []
    for item in raw_sources:
        candidate = None
        if isinstance(item, str):
            candidate = item.strip()
        elif isinstance(item, dict):
            for key in ("video", "name", "id", "source", "title"):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    candidate = value.strip()
                    break
        if candidate:
            if candidate not in source_names:
                source_names.append(candidate)

    if not source_names:
        return jsonify({"error": "No sources selected"}), 400

    # Phase D: every requested source must be owned (foreign → 403, no global fallback).
    src_err = _ensure_owned_sources(source_names, uid)
    if src_err:
        return src_err

    ready_err = _ensure_ready_sources(source_names)
    if ready_err:
        return ready_err

    from app.domains.mindmap.guided import intent_hash, normalize_intent, suggest_topics
    try:
        intent = normalize_intent(data) if guided_requested else None
    except ValueError as exc:
        return jsonify({"error": str(exc), "error_code": "invalid_guided_request"}), 400

    force = bool(data.get("force"))
    try:
        mm_input, content_hash = _mindmap_input_and_hash(source_names)
    except Exception as e:
        return jsonify({"error": f"Không đọc được dữ liệu nguồn: {e}"}), 500
    if not mm_input.get("chunks"):
        return jsonify({"error": "Nguồn chưa có dữ liệu đã index"}), 400
    if intent:
        available_topics = suggest_topics(mm_input)
        by_id = {row["id"]: row for row in available_topics}
        selected_ids = intent["selected_topic_ids"]
        grounded = [by_id[item]["title"] for item in selected_ids if item in by_id]
        # Client text is only a user preference; evidence remains server-derived.
        intent["selected_topics"] = grounded or intent["selected_topics"]
        mm_input = {**mm_input, "generation_intent": intent,
                    "guided_topics": available_topics}
        content_hash = intent_hash(content_hash, intent)

    if not force:
        # Phase D: user-scoped cache lookup — no cross-user reuse on identical content_hash.
        # 2026-09-24: MUST run before create_idempotent_job below. It used to run
        # after, so every cache-hit still inserted a real row into the durable
        # Postgres ledger and the guided worker would claim and re-run it for
        # nothing -- wasted a full generation cycle on every "same config as
        # before" click, invisible to the caller (who got the synchronous cached
        # response) and to the job itself (which completed correctly but nobody
        # was ever waiting on its result). Found while correlating a real QA
        # browser click against the job ledger.
        cached = (mindmap_store.get_by_hash(content_hash, user_id=uid, enforce_owner=True)
                  if _auth_protect_enabled() else mindmap_store.get_by_hash(content_hash))
        if cached:
            return jsonify({
                "status": "done", "result": cached, "cached": True,
                "usage": _zero_cache_hit_usage(),
            }), 200
    idempotency_key = str(data.get("idempotency_key") or "").strip()
    from app.domains.jobs import guided_store
    if guided_requested and guided_store.use_postgres() and not idempotency_key:
        # The durable ledger requires a key even when an older client does not
        # send one; this generated key is unique to this request and preserves
        # the old client contract without allowing duplicate retries to merge.
        idempotency_key = f"auto:{uuid.uuid4()}"
    request_fingerprint = hashlib.sha256(json.dumps({"sources": source_names, "intent": intent, "force": force}, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    requested_job_id = str(uuid.uuid4())
    usage_key = f"mindmap:{idempotency_key or requested_job_id}"
    try:
        usage_context = _reserve_usage_context(
            uid, feature="mindmap",
            operation="regenerate" if force else ("guided_generate" if guided_requested else "generate"),
            idempotency_key=usage_key,
            request_id=request.headers.get("X-Request-ID") or requested_job_id,
            job_id=requested_job_id,
            lease_owner=f"mindmap-web:{os.getpid()}",
        )
    except Exception as exc:
        from app.domains.usage import QuotaExceeded
        if isinstance(exc, QuotaExceeded):
            return _quota_error_response(exc)
        raise
    durable_job = None
    if guided_requested and idempotency_key and uid:
        outcome, durable_job = guided_store.create_idempotent_job(
            requested_job_id, user_id=uid, idempotency_key=idempotency_key,
            request_fingerprint=request_fingerprint, source_ids_json=json.dumps(source_names),
            guided_config_json=json.dumps(intent or {}, ensure_ascii=False), stage="queued",
            force=force,
            usage_reservation_id=(usage_context.reservation_id if usage_context else None))
        if outcome == "conflict":
            return jsonify({"error": "Idempotency key was already used with a different request", "error_code": "idempotency_conflict"}), 409
        if outcome == "existing":
            if durable_job.get("status") == "done" and durable_job.get("result"):
                return jsonify({
                    "status": "done",
                    "result": durable_job["result"],
                    "job_id": durable_job["job_id"],
                    "usage": durable_job.get("usage_summary"),
                }), 200
            return jsonify({"job_id": durable_job["job_id"], "status": durable_job.get("status") or "queued", "status_url": f"/mindmap-status/{durable_job['job_id']}"}), 202
    job_id = _start_mindmap_job(source_names, mm_input, content_hash, intent,
                                job_id=durable_job.get("job_id") if durable_job else requested_job_id,
                                job_metadata=durable_job,
                                usage_context_data=usage_context.to_dict() if usage_context else None)
    response = {"job_id": job_id, "status": "queued", "status_url": f"/mindmap-status/{job_id}"}
    return jsonify(response), 202


@app.get("/mindmap-status/<job_id>")
def mindmap_status(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    _run_jobs_maintenance()
    from app.domains.jobs import guided_store
    j = guided_store.get_job(job_id, user_id=uid) if guided_store.use_postgres() else None
    if j is None:
        from app.domains.jobs.jobs_store import get_job as _js_get
        j = _js_get(job_id)
    if not j or j.get("job_type") not in ("mindmap", None):
        return jsonify({"error": "Job not found"}), 404
    if _auth_protect_enabled() and j.get("user_id") != uid:
        return jsonify({"error": "Job not found"}), 404  # foreign job → no oracle
    result = j.get("result")
    payload: Dict[str, Any] = {
        "status": j.get("status"),
        "progress": j.get("progress", 0),
        # current_node để FE hiện đúng giai đoạn + stall-fingerprint bắt được
        # chuyển node dù progress % đứng yên (codex #6).
        "current_node": j.get("current_node") or "",
        "result": result,
        "error": j.get("error"),
        "usage": j.get("usage_summary"),
    }
    # Passthrough preview khi đang chạy (Skeleton node ghi result={"partial": {...}}).
    if j.get("status") == "running" and isinstance(result, dict) and "partial" in result:
        payload["partial"] = result["partial"]
    return jsonify(payload), 200


@app.post("/mindmap-cancel/<job_id>")
def mindmap_cancel(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    # Owner check BEFORE cancel — never let User B cancel User A's job.
    if _auth_protect_enabled() and _derived_job_owner_ok(job_id, uid, ("mindmap", None)) is not True:
        return jsonify({"error": "Job not found"}), 404
    from app.domains.jobs.jobs_store import request_cancel
    request_cancel(job_id)
    print(f"mindmap_queue_cancel_requested job_id={job_id}", flush=True)
    return jsonify({"ok": True}), 200


@app.get("/chunk-text/<int:chunk_id>")
def get_chunk_text(chunk_id: int):
    uid, err = _require_app_user()
    if err:
        return err
    from app.domains.vectorstore import chunk_text_store
    text = chunk_text_store.get_text(chunk_id)
    if text is None:
        return jsonify({"error": "Chunk not found"}), 404
    # Owner scope: resolve the chunk's source and deny raw-text exfiltration by global
    # chunk id. A foreign chunk is indistinguishable from a missing one (404).
    if _auth_protect_enabled() and not _source_owner_ok(_chunk_owner_stem(chunk_id), uid):
        return jsonify({"error": "Chunk not found"}), 404
    return jsonify({"chunk_id": chunk_id, "text": text}), 200


@app.get("/mindmaps/<mindmap_id>/nodes/<node_id>/context")
def get_mindmap_node_context(mindmap_id: str, node_id: str):
    """Return persisted, owner-scoped context for one mind-map node.

    Selection is intentionally read-only: no retriever, LLM, or generation job is
    invoked.  A foreign map/node is indistinguishable from a missing one.
    """
    uid, err = _require_app_user()
    if err:
        return err
    record = (mindmap_store.get_record(mindmap_id, user_id=uid, enforce_owner=True)
              if _auth_protect_enabled() else mindmap_store.get_record(mindmap_id))
    if not record:
        return jsonify({"error": "Mind map not found"}), 404
    try:
        with open(INDEX_META_JSON_PATH, encoding="utf-8") as handle:
            index_meta = json.load(handle)
    except Exception:
        index_meta = {}
    registry = _load_source_registry()
    from app.domains.mindmap.context import build_node_context
    from app.domains.vectorstore import chunk_text_store

    def _meta(ref):
        value = index_meta.get(str(ref))
        return value if isinstance(value, dict) else None

    def _source_info(stem):
        normalized = _normalize_video_stem(stem)
        for sid, row in registry.items():
            if not isinstance(row, dict):
                continue
            row_stem = _normalize_video_stem(row.get("source_stem") or row.get("filename") or "")
            if sid == stem or row_stem == normalized:
                return {"id": sid, **row}
        return None

    def _allowed(stem):
        return (not _auth_protect_enabled()) or _source_owner_ok(stem, uid)

    context = build_node_context(
        record,
        node_id,
        chunk_meta=_meta,
        chunk_text=lambda ref: chunk_text_store.get_text(int(ref)) if str(ref).isdigit() else None,
        source_info=_source_info,
        source_allowed=_allowed,
    )
    if context is None:
        return jsonify({"error": "Mind map node not found"}), 404
    return jsonify(context), 200


@app.get('/mindmaps')
def list_mindmaps():
    uid, err = _require_app_user()
    if err:
        return err
    if _auth_protect_enabled():
        return jsonify({"mindmaps": mindmap_store.list_records(user_id=uid, enforce_owner=True)})
    return jsonify({"mindmaps": mindmap_store.list_records()})


@app.route("/mindmaps/<mindmap_id>", methods=["PUT"])
def update_mindmap(mindmap_id: str):
    """Lưu bản chỉnh sửa tay từ viewer. Bảo vệ id/hash/created_at/sources gốc."""
    uid, err = _require_app_user()
    if err:
        return err
    # Owner-scoped read: a foreign mindmap reads as not-found, so PUT can never overwrite
    # another user's record.
    base = (mindmap_store.get_record(mindmap_id, user_id=uid, enforce_owner=True)
            if _auth_protect_enabled() else mindmap_store.get_record(mindmap_id))
    if not base:
        return jsonify({"error": "Mind map not found"}), 404

    body = request.get_json(silent=True) or {}
    from services.mindmap.pipeline.schema import sanitize_nodes, validate_relations

    nodes = sanitize_nodes(body.get("nodes") or [])
    if not nodes:
        return jsonify({"error": "nodes trống hoặc không hợp lệ"}), 400

    relations = validate_relations(body.get("relations") or [], nodes)
    record = {
        **base,
        "title": (str(body.get("title") or "").strip() or base.get("title") or ""),
        "nodes": nodes,
        "relations": relations,
    }
    for key in ("id", "content_hash", "created_at", "sources", "schema_version"):
        record[key] = base.get(key)

    record["updated_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    generator = dict(base.get("generator") or {})
    generator["edited"] = True
    record["generator"] = generator

    # Preserve the owner explicitly (the caller passed the owner check above) so an edit
    # never nulls the owner column. Flag off → today's call.
    if _auth_protect_enabled():
        mindmap_store.save_record(record, user_id=uid)
    else:
        mindmap_store.save_record(record)
    return jsonify(record)


@app.delete('/mindmaps/<string:mindmap_id>')
def delete_mindmap(mindmap_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    ok = (mindmap_store.delete_record(mindmap_id, user_id=uid, enforce_owner=True)
          if _auth_protect_enabled() else mindmap_store.delete_record(mindmap_id))
    if not ok:
        return jsonify({"error": "Mind map not found"}), 404
    return jsonify({"message": "Deleted"})


# -------------------------
# 📄 Mindmap document export (DOCX/XLSX/PDF) — Export Studio Round 2, section 8.
# Client-side image formats (PNG/JPEG/SVG) never touch the backend; only the
# three document formats, which need real server-side generation, go through
# a job (see app/application/mindmap_export.py + app/domains/jobs/export_jobs.py).
# -------------------------
_EXPORT_FORMATS = ("docx", "xlsx", "pdf")
_EXPORT_SCOPE_TYPES = ("full", "current_branch", "selected_branches")


def _export_job_owner_or_404(job_id: str, uid: Optional[str]):
    """Loads an export job and enforces ownership the same way every other
    owner-scoped read in this file does: a foreign job reads as 404, never
    403 (no existence leak). Returns (job, None) or (None, error_response)."""
    from app.domains.jobs import jobs_store
    job = jobs_store.get_job(job_id)
    if not job or job.get("job_type") != export_jobs.EXPORT_JOB_TYPE:
        return None, (jsonify({"error": "Export job not found"}), 404)
    if _auth_protect_enabled() and job.get("user_id") and job.get("user_id") != uid:
        return None, (jsonify({"error": "Export job not found"}), 404)
    return job, None


@app.post("/mindmaps/<mindmap_id>/exports")
def create_mindmap_export(mindmap_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    base = (mindmap_store.get_record(mindmap_id, user_id=uid, enforce_owner=True)
            if _auth_protect_enabled() else mindmap_store.get_record(mindmap_id))
    if not base:
        return jsonify({"error": "Mind map not found"}), 404

    body = request.get_json(silent=True) or {}
    fmt = str(body.get("format") or "").strip()
    if fmt not in _EXPORT_FORMATS:
        return jsonify({"error": f"format phải là một trong {_EXPORT_FORMATS}", "error_code": "invalid_format"}), 400

    scope_body = body.get("scope") or {}
    scope_type = str(scope_body.get("scope_type") or "full").strip()
    if scope_type not in _EXPORT_SCOPE_TYPES:
        return jsonify({"error": f"scope_type phải là một trong {_EXPORT_SCOPE_TYPES}", "error_code": "invalid_scope_type"}), 400
    scope_params = {
        "scope_type": scope_type,
        "selected_node_id": scope_body.get("selected_node_id"),
        "selected_branch_root_ids": scope_body.get("selected_branch_root_ids") or [],
        "include_descendants": bool(scope_body.get("include_descendants", True)),
    }

    # Node membership validation — fail fast with a real 400, not a job that
    # dies asynchronously for something checkable right now.
    from services.mindmap.export.scope import resolve_export_scope, ExportScopeError, UnknownNodeIdError, NoSelectionError
    try:
        resolve_export_scope(base.get("nodes") or [], **scope_params)
    except UnknownNodeIdError:
        return jsonify({"error": "Một hoặc nhiều node đã chọn không còn tồn tại trên sơ đồ này", "error_code": "unknown_node_id"}), 400
    except NoSelectionError:
        return jsonify({"error": "Chưa có lựa chọn cho phạm vi này", "error_code": "no_selection"}), 400
    except ExportScopeError as e:
        return jsonify({"error": str(e), "error_code": "invalid_scope"}), 400

    # Section 2/3 (format-capability model): the SAME format_capabilities.json
    # that drives which controls the FE shows is what validates and
    # normalizes the request here — never a second, hand-rolled per-format
    # if/elif block. validate_options REJECTS (400) any control this format
    # doesn't declare or any out-of-range value; normalize_options then fills
    # in this format's own defaults for whatever the request left unset.
    from services.mindmap.export.capabilities import validate_options, normalize_options, UnsupportedOptionError
    options_body = body.get("options") or {}
    try:
        validate_options(fmt, options_body)
    except UnsupportedOptionError as e:
        return jsonify({"error": str(e), "error_code": "invalid_option"}), 400
    format_options = normalize_options(fmt, options_body)

    map_image_bytes = None
    if body.get("map_image_base64"):
        import base64
        try:
            map_image_bytes = base64.b64decode(body["map_image_base64"], validate=True)
        except Exception:
            return jsonify({"error": "map_image_base64 không hợp lệ", "error_code": "invalid_image"}), 400
    if fmt == "pdf" and format_options.get("mode") in ("map", "map_and_outline") and not map_image_bytes:
        return jsonify({"error": "Chế độ này cần ảnh sơ đồ (map_image_base64)", "error_code": "missing_map_image"}), 400

    from app.domains.jobs import jobs_store
    request_fingerprint = hashlib.sha256(json.dumps(
        {"map_id": mindmap_id, "format": fmt, "scope": scope_params, "options": format_options},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
    idempotency_key = str(body.get("idempotency_key") or "").strip()

    job_id = export_jobs.new_job_id()
    if idempotency_key and uid:
        outcome, durable = jobs_store.create_idempotent_job(
            job_id, user_id=uid, idempotency_key=idempotency_key,
            request_fingerprint=request_fingerprint, job_type=export_jobs.EXPORT_JOB_TYPE,
        )
        if outcome == "conflict":
            return jsonify({"error": "idempotency_key đã dùng cho một yêu cầu khác", "error_code": "idempotency_conflict"}), 409
        if outcome == "existing":
            return jsonify({"job_id": durable["job_id"], "status": durable.get("status") or "queued"}), 202
        job_id = durable["job_id"]
    else:
        jobs_store.create_job(job_id, job_type=export_jobs.EXPORT_JOB_TYPE, status="pending", current_node="Queued", user_id=uid,
                              map_id=mindmap_id, idempotency_key=idempotency_key or None, request_fingerprint=request_fingerprint)

    from app.jobs.queue import enqueue_job
    from app.application.mindmap_export import run_export_job
    enqueue_job(run_export_job, args=(job_id, mindmap_id, uid, fmt, scope_params, format_options, map_image_bytes), queue="mindmap_export", job_id=job_id)
    return jsonify({"job_id": job_id, "status": "queued", "status_url": f"/mindmaps/exports/{job_id}"}), 202


@app.get("/mindmaps/exports/<job_id>")
def get_mindmap_export(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    _run_jobs_maintenance()
    job, err = _export_job_owner_or_404(job_id, uid)
    if err:
        return err
    payload = {
        "job_id": job["job_id"], "status": job["status"], "progress": job.get("progress") or 0,
        "stage": job.get("stage"), "error": job.get("error"), "error_code": job.get("error_code"),
        "result": job.get("result"),
    }
    if job["status"] == "done":
        payload["download_token"] = export_jobs.make_download_token(job_id, uid)
        payload["download_url"] = f"/mindmaps/exports/{job_id}/download?token={payload['download_token']}"
    return jsonify(payload)


@app.post("/mindmaps/exports/<job_id>/cancel")
def cancel_mindmap_export(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    job, err = _export_job_owner_or_404(job_id, uid)
    if err:
        return err
    from app.domains.jobs import jobs_store
    jobs_store.request_cancel(job_id)
    return jsonify({"job_id": job_id, "status": "cancel_requested"})


@app.get("/mindmaps/exports/<job_id>/download")
def download_mindmap_export(job_id: str):
    # Two independent auth paths, either sufficient — see export_jobs.py's
    # own header comment for why: a direct browser navigation can't carry
    # an Authorization header, so the short-lived signed token (minted by
    # the status endpoint once status=="done") is the one the FE actually
    # uses; the bearer-token path stays available for programmatic fetches.
    from app.domains.jobs import jobs_store as _js
    job = _js.get_job(job_id)
    if not job or job.get("job_type") != export_jobs.EXPORT_JOB_TYPE:
        return jsonify({"error": "Export job not found"}), 404

    job_owner = job.get("user_id")
    token = request.args.get("token") or ""
    token_payload = export_jobs.read_download_token(token) if token else None
    token_ok = bool(token_payload) and token_payload.get("job_id") == job_id and (
        not _auth_protect_enabled() or not job_owner or token_payload.get("uid") == job_owner
    )

    bearer_ok = False
    if not token_ok:
        uid = _current_user_id()
        bearer_ok = (not _auth_protect_enabled()) or (uid is not None and (not job_owner or uid == job_owner))

    if not (token_ok or bearer_ok):
        return jsonify({"error": "unauthorized"}), 401

    if job["status"] != "done":
        return jsonify({"error": "Export chưa hoàn tất", "error_code": "not_ready", "status": job["status"]}), 409

    fmt = (job.get("result") or {}).get("format")
    path = export_jobs.output_path_for(job_id, fmt) if fmt else None
    if not path or not path.is_file():
        return jsonify({"error": "File xuất không còn tồn tại (có thể đã hết hạn)", "error_code": "file_expired"}), 410

    from flask import send_file
    map_title = None
    base = mindmap_store.get_record(job.get("map_id")) if job.get("map_id") else None
    if base:
        map_title = base.get("title")
    filename = export_jobs.display_filename(map_title or "mindmap", fmt)
    mimetypes = {"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                 "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "pdf": "application/pdf"}
    return send_file(str(path), mimetype=mimetypes.get(fmt, "application/octet-stream"), as_attachment=True, download_name=filename)


# -------------------------
# 🔍 Memory Tree Status
# -------------------------
@app.get('/memory-tree-status')
def memory_tree_status():
    """
    Kiểm tra trạng thái Memory Tree cho các source.
    Trả về danh sách source với status chi tiết: "none" | "building" | "completed"
    """
    uid, err = _require_app_user()
    if err:
        return err
    try:
        from app.domains.memory.tree import _load_memory_trees, _normalize_video_stem
        trees = _load_memory_trees()
        tree_map = {}
        for t in trees:
            stem = _normalize_video_stem(t.get("source_stem", ""))
            if stem:
                tree_map[stem] = {
                    "status": t.get("status", "completed"),  # building | completed
                    "built_at": t.get("built_at"),
                    "num_nodes": len(t.get("nodes", [])),
                }
        
        # Lấy danh sách tất cả sources từ index
        with open(INDEX_META_JSON_PATH, encoding='utf-8') as f:
            meta = json.load(f)
        
        all_sources = set()
        for item in meta.values():
            if not isinstance(item, dict):
                continue
            stem = _normalize_video_stem(item.get("source_stem") or "")
            if stem:
                all_sources.add(stem)

        # Owner scope: only the caller's stems; legacy NULL-owner sources are hidden
        # (owned_stems excludes them under enforcement).
        if _auth_protect_enabled():
            owned = owned_stems(uid)
            all_sources = {s for s in all_sources if s in owned}

        status_list = []
        for source in sorted(all_sources):
            tree_info = tree_map.get(source)
            if tree_info:
                status_list.append({
                    "source": source,
                    "status": tree_info["status"],  # building | completed
                    "built_at": tree_info.get("built_at"),
                    "num_nodes": tree_info.get("num_nodes", 0),
                })
            else:
                status_list.append({
                    "source": source,
                    "status": "none",  # Chưa có tree
                    "built_at": None,
                    "num_nodes": 0,
                })
        
        return jsonify({
            "sources": status_list,
            "total_sources": len(all_sources),
            "sources_with_tree": len(tree_map),
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# -------------------------
# 🗑️ Delete Source Helper Functions
# -------------------------

def _delete_storage_object(source_info: Dict) -> Optional[bool]:
    """Xoá bản gốc trên Supabase Storage. None = không có gì để xoá.

    `DELETE /sources/<id>` (đường FE dùng mặc định — SidebarLeft.jsx:126) trước
    2026-08-29 làm 6 bước dọn mà KHÔNG có bước này, dù docstring của chính route đó
    hứa "File gốc trong input_docs/ VÀ object trên Supabase Storage". Người dùng bấm
    xoá, giao diện sạch, file gốc nằm lại vĩnh viễn trong bucket private — không
    đường nào dọn. Route cũ `POST /delete-source` thì có (main.py cũ dòng 4131).

    Guard `obj != input_path` giống hệt `_don_file_tam`: khi Storage chưa cấu hình
    hoặc upload lỗi, `documents.file_path` chính là đường local, và lúc đó bước xoá
    file local đã lo rồi — gọi `storage.delete` với một đường dẫn đĩa là vô nghĩa.
    """
    obj = (source_info or {}).get("file_path")
    ip = (source_info or {}).get("input_path")
    if not obj or obj == ip:
        return None
    from app.domains.documents import storage as _storage
    if not _storage.is_configured():
        return None
    ok = _storage.delete(obj)          # best-effort, không ném
    if not ok:
        # KHÔNG nuốt im: đây là rác tồn kho có tính tiền (bài học C5 vòng 2).
        print(f"⚠️ [Delete] Không xoá được object trên Storage: {obj}")
    else:
        print(f"🗑️ [Delete] Đã xoá bản gốc trên Storage: {obj}")
    return ok


def _delete_input_file(source_id: str, source_info: Dict) -> bool:
    """
    Xóa file gốc trong input_docs/.
    Returns True nếu xóa thành công hoặc file không tồn tại.
    """
    # Ưu tiên input_path (đường lưu vật lý THẬT, đã sanitize/chống trùng); fallback
    # INPUT_DIR/filename cho entry cũ. Tránh sót file gốc khi tên bị sanitize/đổi.
    candidates = []
    ip = source_info.get("input_path")
    if ip:
        candidates.append(Path(ip))
    filename = source_info.get("filename")
    if filename:
        candidates.append(Path(INPUT_DIR) / filename)
    if not candidates:
        return True

    ok = True
    for input_file_path in candidates:
        try:
            if input_file_path.exists():
                input_file_path.unlink()
                print(f"🗑️ [Delete] Đã xóa input file: {input_file_path}")
        except Exception as e:
            print(f"⚠️ [Delete] Không thể xóa input file {input_file_path}: {e}")
            ok = False
    return ok


def _purge_chunk_index(source_stem: str) -> int:
    """
    Xóa tất cả chunks thuộc source từ index.
    Returns số lượng chunks đã xóa.
    """
    try:
        deleted_count = delete_chunks_by_source(source_stem)
        print(f"🗑️ [Delete] Đã xóa {deleted_count} chunks từ index")
        return deleted_count
    except Exception as e:
        print(f"⚠️ [Delete] Lỗi khi xóa chunks: {e}")
        raise


def _purge_memory_tree(source_stem: str) -> int:
    """
    Xóa toàn bộ memory nodes thuộc source.
    Returns số lượng nodes đã xóa.
    """
    try:
        deleted_nodes = delete_memory_tree_by_source(source_stem)
        print(f"🗑️ [Delete] Đã xóa {deleted_nodes} memory nodes")
        
        # Rebuild memory index sau khi xóa
        rebuild_memory_index()
        print(f"🔄 [Delete] Đã rebuild memory_index")
        
        return deleted_nodes
    except Exception as e:
        print(f"⚠️ [Delete] Lỗi khi xóa memory tree: {e}")
        raise


def _delete_registry_entry(source_id: str) -> bool:
    """Xoá bản ghi `documents` (cascade sang sections/document_chunks theo cây 6.2)."""
    try:
        from app.domains.documents import repository as _docs
        _docs.hard_delete(source_id)
        print(f"🗑️ [Delete] Đã xóa bản ghi documents: {source_id}")
        return True
    except Exception as e:
        print(f"⚠️ [Delete] Lỗi khi xóa bản ghi documents: {e}")
        raise


def _validate_source_exists(source_id: str, source_stem: str) -> Tuple[bool, Optional[Dict]]:
    """
    Validate source có tồn tại không.
    Returns (exists, source_info) từ registry.
    """
    # Kiểm tra trong registry trước
    registry = _load_source_registry()
    source_info = registry.get(source_id)
    
    if source_info:
        return True, source_info
    
    # Nếu không có trong registry, kiểm tra trong index
    index_path = INDEX_META_JSON_PATH
    if index_path.exists():
        try:
            with open(index_path, encoding="utf-8") as f:
                meta = json.load(f)
            for item in meta.values():
                if not isinstance(item, dict):
                    continue
                if _normalize_video_stem(item.get("source_stem") or "") == source_stem:
                    return True, None  # Tồn tại nhưng không có trong registry
        except Exception:
            pass
        current_usage = (
            get_operation_usage(
                usage_context.reservation_id, user_id=usage_context.user_id,
            )
            if usage_context is not None else None
        )
        _finish_usage(
            "failed" if current_usage and current_usage.get("total_tokens", 0)
            else "released"
        )
    
    # Kiểm tra trong memory_trees.json
    try:
        from app.domains.memory.tree import _load_memory_trees
        trees = _load_memory_trees()
        for t in trees:
            stem = _normalize_video_stem(t.get("source_stem", ""))
            if stem == source_stem:
                return True, None
    except Exception:
        pass
    
    return False, None


@app.delete('/sources/<source_id>')
def delete_source_v2(source_id: str):
    """
    Xóa toàn bộ dữ liệu liên quan tới một source (clean delete).
    
    Xóa:
    1. File gốc trong input_docs/ và object trên Supabase Storage
    2. Chunk metadata và vectors trong index/ (FAISS)
    3. Memory nodes và vectors trong memory/
    4. Bản ghi `documents` (cascade sang sections/document_chunks)
    
    Đảm bảo atomicity và rebuild indexes sau khi xóa.
    """
    uid, err = _require_app_user()
    if err:
        return err
    source_id = (source_id or "").strip()
    if not source_id:
        return jsonify({"error": "Missing source_id"}), 400

    source_stem = _normalize_video_stem(source_id)

    # 1️⃣ VALIDATE: Kiểm tra source có tồn tại không
    exists, source_info = _validate_source_exists(source_id, source_stem)
    if not exists:
        return jsonify({"error": "Source not found"}), 404
    # Owner scope: a foreign source is treated as not found (no oracle, no cross-user delete).
    if _auth_protect_enabled() and (not source_info or source_info.get("user_id") != uid):
        return jsonify({"error": "Source not found"}), 404

    # source_id là UUID, KHÔNG phải stem. Lấy stem THẬT từ registry entry để purge
    # chunk/video/memory đúng nguồn (nếu không sẽ xóa sót do stem sai từ UUID).
    if source_info:
        _real_stem = _normalize_video_stem(source_info.get("source_stem") or source_info.get("filename") or "")
        if _real_stem:
            source_stem = _real_stem

    # Kiểm tra nếu source đang processing (cho phép xóa nhưng log warning)
    if source_info and source_info.get("status") == "processing":
        print(f"⚠️ [Delete] Source {source_id} đang processing, vẫn tiếp tục xóa")
        # Background task sẽ fail gracefully khi cố update registry entry đã bị xóa
    
    # Chuẩn bị backup để rollback nếu lỗi
    backups = []
    backup_dir = DATA_DIR / "backups"
    backup_dir.mkdir(exist_ok=True)
    
    try:
        # Backup các file quan trọng
        critical_files = [
            INDEX_META_JSON_PATH,
            INDEX_FAISS_PATH,
            MEMORY_DIR / "memory_trees.json",
            MEMORY_DIR / "memory_index.faiss",
            MEMORY_DIR / "memory_index.json",
        ]
        
        import shutil
        from datetime import datetime
        backup_timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        for file_path in critical_files:
            if file_path.exists():
                backup_path = backup_dir / f"{file_path.name}.{backup_timestamp}.bak"
                shutil.copy2(file_path, backup_path)
                backups.append((file_path, backup_path))
                print(f"💾 [Delete] Đã backup: {file_path.name}")
        
        # 2️⃣ DELETE FILE SYSTEM (local tạm + bản gốc trên Storage)
        input_file_deleted = _delete_input_file(source_id, source_info or {})
        storage_object_deleted = _delete_storage_object(source_info or {})
        
        # 3️⃣ DELETE INDEX (CHUNK LEVEL)
        chunks_removed = _purge_chunk_index(source_stem)
        
        # 4️⃣ DELETE MEMORY TREE
        memory_nodes_removed = _purge_memory_tree(source_stem)
        
        # 5️⃣ DELETE REGISTRY
        registry_deleted = _delete_registry_entry(source_id)

        # 6️⃣ DELETE MINDMAPS liên quan tới source (best-effort)
        try:
            mindmap_store.delete_by_source(source_stem)
        except Exception as e:
            print("mindmap store cleanup failed:", e)

        # Nếu mọi thứ OK -> cleanup backup
        for orig, bak in backups:
            try:
                if bak.exists():
                    bak.unlink()
            except Exception:
                pass  # Best effort cleanup
        
        print(f"✅ [Delete] Hoàn thành xóa source {source_id}")
        
        return jsonify({
            "status": "deleted",
            "source_id": source_id,
            "deleted_items": {
                "input_file": input_file_deleted,
                # None = không có object nào để xoá (Storage chưa cấu hình, hoặc
                # bản gốc chính là file local). True/False = đã thử và kết quả.
                "storage_object": storage_object_deleted,
                "chunks_removed": chunks_removed,
                "memory_nodes_removed": memory_nodes_removed,
            }
        })
    
    except Exception as e:
        # Rollback best-effort
        import traceback
        traceback.print_exc()
        print(f"❌ [Delete] Lỗi khi xóa source {source_id}, đang rollback...")
        
        for orig, bak in backups:
            try:
                if bak.exists() and orig.exists() is False:
                    bak.replace(orig)
                    print(f"🔄 [Delete] Đã rollback: {orig.name}")
            except Exception as rb_err:
                print(f"⚠️ [Delete] Rollback error cho {orig}: {rb_err}")
        
        return jsonify({"error": f"Delete failed: {str(e)}"}), 500
@app.get('/memory-tree/<source_stem>')
def get_memory_tree(source_stem: str):
    """
    Lấy Memory Tree cho một source cụ thể.
    Trả về tree với nodes (có thể là partial nếu đang building).
    """
    uid, err = _require_app_user()
    if err:
        return err
    try:
        from app.domains.memory.tree import _load_memory_trees, _normalize_video_stem
        norm_stem = _normalize_video_stem(source_stem)
        # Owner scope: a foreign/unowned stem reads as not-found (404, no oracle).
        if _auth_protect_enabled() and not _source_owner_ok(norm_stem, uid):
            return jsonify({"error": "Memory tree not found"}), 404
        trees = _load_memory_trees()
        
        for tree in trees:
            if _normalize_video_stem(tree.get("source_stem", "")) == norm_stem:
                # Trả về tree với nodes đã filter theo type nếu cần
                nodes = tree.get("nodes", [])
                doc_node = next((n for n in nodes if n.get("type") == "document"), None)
                section_nodes = [n for n in nodes if n.get("type") == "section"]
                
                return jsonify({
                    "source_stem": tree.get("source_stem"),
                    "status": tree.get("status", "completed"),
                    "built_at": tree.get("built_at"),
                    "document": doc_node,  # Document node (nếu có)
                    "sections": section_nodes,  # Danh sách section nodes
                    "total_nodes": len(nodes),
                })
        
        return jsonify({
            "source_stem": norm_stem,
            "status": "none",
            "document": None,
            "sections": [],
            "total_nodes": 0,
        }), 404
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


_recover_guided_jobs()


if __name__ == '__main__':
    debug_env = (os.environ.get("DEBUG", "0") or "").strip().lower()
    debug = debug_env in {"1", "true", "yes", "y", "on"}
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=debug, use_reloader=debug)
