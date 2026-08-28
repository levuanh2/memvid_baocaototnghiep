import os
from pathlib import Path

# Load .env early so all modules see env vars (Windows/dev friendly).
try:
    from shared.env_loader import load_project_env
    load_project_env(override=False)
except Exception:
    pass

import json
import re
import uuid
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
    search_index,
    delete_source_from_index,
    delete_chunks_by_source,
    rebuild_chunk_index,
    MODEL_NAME,
)
from app.clients.llm_factory import summarize_results
from app.domains.cache import llm_cache
from shared.config import DEFAULT_LOCAL_MODEL
# Chỉ dùng cho local Ollama (Gemini sẽ bỏ qua model).
SLM_MODEL = os.environ.get("SLM_MODEL_CHAT", os.environ.get("SLM_MODEL", DEFAULT_LOCAL_MODEL))
from app.domains.mindmap import store as mindmap_store
from app.domains.mindmap.input_collector import collect_mindmap_input
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
    methods=["GET", "POST", "DELETE", "OPTIONS"],
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
        pruned = cleanup_terminal_jobs()
        from app.graphs.logger import cleanup_old_node_logs
        logs = cleanup_old_node_logs()
        if swept or pruned or logs:
            print(f"jobs_maintenance swept={swept} pruned={pruned} logs={logs}", flush=True)
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
        return
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

def _get_cached_query(cache_key: str) -> Optional[dict]:
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
    return llm_cache.semantic_lookup(cache_key)

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


def _sf_enabled() -> bool:
    return (os.getenv("SINGLE_FLIGHT_ENABLED", "true") or "").strip().lower() not in (
        "0", "false", "no", "off",
    )


def _sf_num(name: str, default: float) -> float:
    try:
        return float((os.getenv(name) or "").strip() or default)
    except ValueError:
        return default


def _sf_log(event: str, **kv: object) -> None:
    parts = " ".join(f"{k}={v}" for k, v in kv.items())
    print(f"singleflight {event} {parts}".rstrip(), flush=True)


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
            ])
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
        history = _get_session_history_safe(session_id, 8)
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
    parts = " ".join(f"{k}={v}" for k, v in kv.items())
    print(f"overload {event} {parts}".rstrip(), flush=True)


def _ovl_bool(name: str, default: bool) -> bool:
    v = (os.getenv(name) or "").strip().lower()
    if not v:
        return default
    return v not in ("0", "false", "no", "off")


def _ovl_num(name: str, default: float) -> float:
    try:
        return float((os.getenv(name) or "").strip() or default)
    except ValueError:
        return default


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
    payload: Dict[str, Any] = {
        "status": "ok",
        "mode": "ci" if os.environ.get("SKIP_MODEL_LOAD") == "1" else "normal",
        "query_graph_ready": QUERY_GRAPH is not None,
        "ingest_graph_ready": INGEST_GRAPH is not None,
    }
    err = globals().get("QUERY_GRAPH_BUILD_ERROR")
    if err:
        payload["query_graph_error"] = err[:800]
    return jsonify(payload), 200


# -------------------------
# 🔐 Auth MVP (Bearer token) — register / login / logout / me
# Additive; existing app APIs stay OPEN in this phase (no @require_auth applied).
# -------------------------
@app.post('/auth/register')
def auth_register():
    from app.domains.auth import service as _auth
    from app.domains.auth import tokens as _tokens
    from app.domains.auth import users_store as _users
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
        return jsonify({"error": "email_exists"}), 409
    token = _tokens.make_token(user)
    return jsonify({"token": token, "user": _auth.public_user(user)}), 201


@app.post('/auth/login')
def auth_login():
    from app.domains.auth import service as _auth
    from app.domains.auth import tokens as _tokens
    from app.domains.auth import users_store as _users
    data = request.json or {}
    email = data.get("email") or ""
    password = data.get("password") or ""
    # Reuse the Phase-4 token-bucket limiter (off by default; fail-open).
    allowed, retry_after = _rate_limit_check(f"login:{_client_ip()}")
    if not allowed:
        return _rate_limited_response(retry_after)
    user = _users.verify_password(email, password)
    if user is None:
        # Generic error — no user enumeration.
        return jsonify({"error": "invalid_credentials"}), 401
    token = _tokens.make_token(user)
    return jsonify({"token": token, "user": _auth.public_user(user)}), 200


@app.post('/auth/logout')
def auth_logout():
    # Stateless: the client drops the token. (No token_version bump = not logout-all.)
    return jsonify({"ok": True}), 200


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
    return jsonify({"token": _tokens.make_token(user), "user": _auth.public_user(user)}), 200


@app.get('/auth/me')
def auth_me():
    from app.domains.auth import service as _auth
    user = _auth.current_user_from_request()
    if user is None:
        return jsonify({"error": "unauthorized"}), 401
    return jsonify({"user": _auth.public_user(user)}), 200


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
    from app.domains.jobs.jobs_store import get_job as _js_get
    j = _js_get(job_id)
    if not j:
        return jsonify({"error": "Job not found"}), 404
    if _auth_protect_enabled() and j.get("user_id") != uid:
        return jsonify({"error": "Job not found"}), 404  # foreign job → no oracle
    from app.graphs.logger import read_job_events
    events = read_job_events(job_id)
    total_ms = 0.0
    llm_calls = None
    for e in events:
        try:
            total_ms += float(e.get("duration_ms") or 0.0)
        except Exception:
            pass
        md = e.get("metadata") or {}
        if "llm_calls" in md:
            try:
                llm_calls = int(md["llm_calls"])
            except Exception:
                pass
    # queue_wait_ms best-effort: created_at (isoformat UTC) → ts event đầu tiên
    # (sqlite datetime('now'), UTC). Parse lỗi → None, không bao giờ 500.
    queue_wait_ms = None
    try:
        if events and j.get("created_at"):
            from datetime import datetime, timezone
            t0 = datetime.fromisoformat(str(j["created_at"]))
            if t0.tzinfo is None:
                t0 = t0.replace(tzinfo=timezone.utc)
            t1 = datetime.strptime(str(events[0]["ts"]), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            qw = (t1 - t0).total_seconds() * 1000.0
            if qw >= 0:
                queue_wait_ms = round(qw, 1)
    except Exception:
        pass
    return jsonify({
        "job_id": job_id,
        "job_type": j.get("job_type"),
        "status": j.get("status"),
        "progress": j.get("progress", 0),
        "events": events,
        "totals": {"total_ms": total_ms, "llm_calls": llm_calls,
                   "queue_wait_ms": queue_wait_ms},
    }), 200


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

    Flag OFF → (raw, None): today's behavior (empty means global).
    Flag ON  → owner-scoped:
      * raw empty   → all owned stems (or the NO-OWNED sentinel → retrieval returns [])
      * raw present → every requested stem must be owned, else 403; returns the
        canonicalized owned subset. Never falls back to the global corpus."""
    if not _auth_protect_enabled():
        return (list(raw_sources) if raw_sources else []), None
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
    """Owner check for derived-artifact jobs (summary/mindmap/rebuild) that live in
    jobs_store. None if the job is unknown or of a foreign type; True if owned; False
    if owned by someone else. Both None and False map to 404 (no existence oracle)."""
    try:
        from app.domains.jobs.jobs_store import get_job as _js_get
        row = _js_get(job_id)
    except Exception:
        row = None
    if row is None or row.get("job_type") not in allowed_types:
        return None
    return row.get("user_id") == user_id


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

def _get_session_history_safe(session_id: str, limit: int) -> list:
    try:
        from app.domains.jobs.sessions_store import get_history as _gh
        return _gh(session_id, limit_messages=limit)
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

_graphs = _build_graphs(
    data_dir=DATA_DIR,
    index_meta_path=INDEX_META_JSON_PATH,
    update_source_status=lambda sid, status="processing", **kw: _update_source_status(sid, status, **kw),
    extract_text=extract_text,
    split_text=split_text,
    append_to_index=append_to_index,
    build_memory_tree_for_sources=build_memory_tree_for_sources,
    jobs_update=_jobs_update_job,
    make_cache_key=_make_query_cache_key,
    get_cached=_get_cached_query,
    set_cached=_set_cached_query,
    check_sources_status=_check_sources_status,
    get_source_status_by_stem=_get_source_status_by_stem,
    search_index=search_index,
    summarize_results=summarize_results,
    query_with_memory_tree=query_with_memory_tree,
    get_session_history=_get_session_history_safe,
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


def _langgraph_invoke(graph: Any, state: dict, *, thread_id: str, command: Any = None) -> dict:
    """Graph compile với SqliteSaver yêu cầu configurable.thread_id.

    command != None → resume một interrupt (HITL): truyền Command(resume=...) thay cho state.
    """
    tid = (thread_id or "").strip() or str(uuid.uuid4())
    try:
        return graph.invoke(command if command is not None else state, config={"configurable": {"thread_id": tid}})
    except Exception as e:
        # LangGraph / thư viện đôi khi ném exception str() rỗng — bọc để job/SSE có nội dung.
        if not str(e).strip():
            raise RuntimeError(_job_error_text(e)) from e
        raise


class _JobCancelled(Exception):
    """Người dùng bấm huỷ — không phải lỗi, không ghi error_text."""


def _job_error_text(exc: BaseException) -> str:
    """Nhiều built-in (TimeoutError, RuntimeError…) có str(exc)==''; không bao giờ trả chuỗi rỗng."""
    msg = str(exc).strip()
    if msg:
        return msg
    name = getattr(type(exc), "__name__", None) or type(exc).__qualname__ or "Exception"
    return f"{name}: không có nội dung chi tiết (xem traceback trong log server)."


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
    if isinstance(chunks, list) and chunks and not payload.get("chunks"):
        ev: list[dict] = []
        for i, c in enumerate(chunks[:max_chunks]):
            text = str(c) if c is not None else ""
            stem, chunk_id = "", ""
            m = _CITE_PREFIX_RE.match(text)
            if m:
                stem = m.group(1).strip()
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
            _ss_append(session_id, [{"role": "user", "content": question}, {"role": "assistant", "content": str(payload.get("answer"))}])
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
def run_memory_tree_job(source_stems: List[str]):
    """Build Memory Tree for the given sources. Runs in a daemon thread
    (QUEUE_ENABLED=false) OR an RQ worker process (QUEUE_ENABLED=true) — identical
    behaviour, no Flask request context. Enqueued by dotted path
    `app.main.run_memory_tree_job`. Fire-and-forget: there is no per-job status store
    today (results land in memory_trees.json, surfaced by /memory-tree-status); errors are
    logged, not persisted, matching the existing contract."""
    print(f"memory_tree_job_running sources={source_stems}", flush=True)
    try:
        build_memory_tree_for_sources(source_stems)
        print(f"memory_tree_job_done sources={source_stems}", flush=True)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        print(f"memory_tree_job_failed sources={source_stems} err={str(exc)[:80]}", flush=True)


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


def _run_ingest_job(source_id: str, file_path: str, filename: str) -> None:
    """Ingest execution body. Runs EITHER in a daemon thread (QUEUE_ENABLED=false)
    OR in an RQ worker process (QUEUE_ENABLED=true) — identical behaviour. Enqueued
    by dotted path `app.main._run_ingest_job`, so the worker builds/reuses INGEST_GRAPH
    on import. Status/result land in the shared jobs.sqlite; the graph nodes own the
    done/error writes (atomic-with-result invariant preserved)."""
    job_id = source_id
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
        _langgraph_invoke(INGEST_GRAPH, init_state, thread_id=job_id)
    except Exception as exc:
        try:
            _update_source_status(source_id, "error", progress=0.0, error=_job_error_text(exc))
        except Exception:
            pass
    finally:
        # `finally`: ingest hỏng giữa chừng cũng không để lại bản tạm. Hàm tự kiểm
        # điều kiện an toàn nên gọi vô điều kiện ở đây là đúng.
        _don_file_tam(source_id, file_path)


def _trigger_background_ingest(source_id: str, file_path: str, filename: str):
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
        _jobs_create_job(job_id, job_type="ingest", status="pending", progress=0, current_node="Queued", user_id=_current_user_id())
    except Exception:
        pass

    from app.jobs.queue import enqueue_job
    res = enqueue_job(_run_ingest_job, args=(source_id, file_path, filename),
                      queue="ingest", job_id=job_id)
    print(f"🚀 [Background] ingest source={source_id} mode={res.get('mode')}")


# -------------------------
# 📤 Upload single file (ASYNC)
# -------------------------
# Ký tự cấm trên tên file Windows (+ control chars). NFKD ở canonicalizer lo phần
# khớp; ở đây chỉ lo lưu file vật lý an toàn (chặn ký tự cấm + path traversal).
_ILLEGAL_FS_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_save_path(filename: str) -> str:
    """Đường lưu vật lý AN TOÀN trong INPUT_DIR: bỏ thành phần thư mục (chống
    traversal), thay ký tự cấm → '_', và đảm bảo không trùng file sẵn có."""
    base = os.path.basename((filename or "").strip()) or "file"
    safe = _ILLEGAL_FS_CHARS.sub("_", base).strip().strip(".") or "file"
    path = os.path.join(INPUT_DIR, safe)
    root, ext = os.path.splitext(path)
    n = 2
    while os.path.exists(path):
        path = f"{root}_{n}{ext}"
        n += 1
    return path


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
    registry = _load_source_registry()
    # Tên hiển thị (chống trùng) — canonical stem suy từ tên này nên FE chọn theo
    # tên hiển thị sẽ khớp chunk; lưu vật lý theo path an toàn riêng.
    filename = _unique_display_filename(file.filename or "file", registry)
    save_path = _safe_save_path(filename)
    os.makedirs(INPUT_DIR, exist_ok=True)
    file.save(save_path)

    source_stem = _normalize_video_stem(filename)
    uid = _current_user_id()

    # Bản gốc lên Supabase Storage (bucket private) và đó là kho lưu DUY NHẤT.
    # File local chỉ là chỗ đặt TẠM để pipeline ingest có đường dẫn mà đọc —
    # `_don_file_tam` xoá nó trong `finally` của job ingest.
    # Chưa cấu hình Storage (test/CI) → file_path trỏ đường dẫn local, và lúc đó
    # bản local CHÍNH LÀ kho lưu nên không bị xoá. Xem `_don_file_tam`.
    from app.domains.documents import repository as _docs
    from app.domains.documents import storage as _storage
    stored_path = save_path
    if _storage.is_configured():
        try:
            _storage.ensure_bucket()
            obj = _storage.object_path(uid or "anonymous", source_id, filename)
            with open(save_path, "rb") as fh:
                _storage.upload(obj, fh.read())
            stored_path = obj
        except Exception as exc:
            print(f"⚠️ [Storage] Không đẩy được file lên bucket, dùng bản local: {exc}")

    _docs.create(
        document_id=source_id,
        filename=filename,
        file_type=os.path.splitext(filename)[1].lstrip(".").lower(),
        file_path=stored_path,
        user_id=uid,
        input_path=save_path,   # để xóa file gốc khi delete
        file_size=(os.path.getsize(save_path) if os.path.exists(save_path) else None),
    )
    _trigger_background_ingest(source_id, save_path, filename)
    return {
        'source_id': source_id,
        'filename': filename,
        'video_stem': source_stem,
        'status': 'processing',
        'progress': 0.0,
        'can_query': False,
    }


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
    except UnsupportedFileType as exc:
        return _unsupported_response(exc)


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
        except Exception as e:
            import traceback; traceback.print_exc()
            results.append({'file': file.filename, 'error': f'Upload failed: {str(e)}'})

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
    except UnsupportedFileType as exc:
        return _unsupported_response(exc)
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
def run_study_map_job(job_id: str, document_id: str, user_id: Optional[str] = None) -> None:
    """Sinh Study Map cho MỘT tài liệu (FR-04.2).

    Gọi thẳng pipeline mindmap thay vì đi qua MINDMAP_GRAPH: graph tự ghi
    `status=done` kèm result là artifact mindmap, mà job này phải trả `map_id` —
    để graph đóng job trước rồi mới ghi map_id là dựng lại đúng race
    done-trước-result đã có trong known-issues. Ở đây job chỉ done sau khi map
    đã nằm trong DB.
    """
    from app.domains.documents import repository as _docs
    from app.domains.jobs.jobs_store import is_cancel_requested, update_job
    from app.domains.studymap import generator as _sm_gen
    from app.domains.studymap import repository as _sm_repo

    print(f"study_map_job_running job_id={job_id}", flush=True)
    map_id = None
    try:
        row = _docs.get(document_id) or {}
        stem = row.get("source_stem")
        if not stem:
            raise ValueError("Tài liệu chưa có dữ liệu đã index.")
        map_id = _sm_repo.create_map(document_id=document_id, user_id=user_id,
                                     title=row.get("filename") or "Study Map")
        update_job(job_id, status="running", progress=5, current_node="CollectInput",
                   result={"map_id": map_id, "status": "processing"})

        mm = collect_mindmap_input(INDEX_META_JSON_PATH, [stem])
        if not mm.get("chunks"):
            raise ValueError("Tài liệu chưa có chunk nào đã index.")

        def _cancelled() -> bool:
            return bool(is_cancel_requested(job_id))

        pipeline = _get_mindmap_pipeline()
        update_job(job_id, progress=15, current_node="Skeleton")
        skeleton, method = pipeline.skeleton(mm)
        if _cancelled():
            raise _JobCancelled()

        update_job(job_id, progress=30, current_node="Enrich")
        nodes, deg_enrich = pipeline.enrich(
            mm, skeleton,
            progress_cb=lambda p, msg: update_job(job_id, progress=p, current_node=msg),
            cancel_cb=_cancelled,
        )
        if _cancelled():
            raise _JobCancelled()

        update_job(job_id, progress=75, current_node="Relations")
        relations, deg_rel = pipeline.relations(nodes, cancel_cb=_cancelled)
        if _cancelled():
            raise _JobCancelled()

        update_job(job_id, progress=85, current_node="Persist")
        clean = mindmap_schema.sanitize_nodes(nodes)
        rels = mindmap_schema.validate_relations(relations, clean)
        node_rows, edge_rows = _sm_gen.build_graph(
            clean, rels, _docs.chunks_by_embedding(document_id),
        )
        if not node_rows:
            raise ValueError("Pipeline không dựng được node nào.")
        counts = _sm_repo.save_graph(map_id, document_id, node_rows, edge_rows)
        _sm_repo.finish(map_id, "completed", generator={
            "pipeline": mindmap_schema.PIPELINE_VERSION,
            "skeleton_method": method,
            "degraded": bool(deg_enrich or deg_rel),
            **counts,
        })
        update_job(job_id, status="done", progress=100, current_node="Persist",
                   result={"map_id": map_id, "status": "completed", **counts})
        print(f"study_map_job_done job_id={job_id} map_id={map_id}", flush=True)
    except _JobCancelled:
        if map_id:
            _sm_repo.finish(map_id, "failed", generator={"cancelled": True})
        update_job(job_id, status="cancelled", progress=0, current_node="Cancelled")
        print(f"study_map_job_cancelled job_id={job_id}", flush=True)
    except Exception as e:
        if map_id:
            _sm_repo.finish(map_id, "failed", generator={"error": str(e)[:500]})
        update_job(job_id, status="error", error_text=_job_error_text(e))
        print(f"study_map_job_failed job_id={job_id} err={str(e)[:80]}", flush=True)


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
    from app.domains.jobs.jobs_store import get_job as _js_get
    j = _js_get(job_id)
    if not j or j.get("job_type") != "study_map_generation":
        return jsonify({"error": "Job not found"}), 404
    if _auth_protect_enabled() and j.get("user_id") != uid:
        return jsonify({"error": "Job not found"}), 404  # foreign job → no oracle
    return jsonify({
        "job_id": job_id,
        "status": j.get("status"),
        "progress": j.get("progress", 0),
        "current_step": j.get("current_node") or "",
        "result": j.get("result"),
        "error": j.get("error"),
    })


@app.post('/api/study-maps/jobs/<job_id>/cancel')
def api_study_maps_job_cancel(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    if _auth_protect_enabled() and _derived_job_owner_ok(job_id, uid, ("study_map_generation",)) is not True:
        return jsonify({"error": "Job not found"}), 404
    from app.domains.jobs.jobs_store import request_cancel
    request_cancel(job_id)
    return jsonify({"job_id": job_id, "cancel_requested": True})


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
QUIZ_MAX_QUESTIONS = int(os.getenv("QUIZ_MAX_QUESTIONS", "50"))
QUIZ_MAX_CONTEXT_CHUNKS = int(os.getenv("QUIZ_MAX_CONTEXT_CHUNKS", "200"))


def _quiz_config(data: dict):
    """(config, error_response). Ép mọi giá trị về tập DB chấp nhận trước khi chạy job —
    để CHECK của Postgres bắt thì job đã tốn một lượt gọi LLM rồi mới hỏng."""
    from app.domains.ai_validation.rules import QUESTION_TYPES

    try:
        count = int(data.get("question_count", 10))
    except (TypeError, ValueError):
        return None, (jsonify({"error": "question_count phải là số nguyên"}), 400)
    if not 1 <= count <= QUIZ_MAX_QUESTIONS:
        return None, (jsonify({"error": f"question_count phải trong 1..{QUIZ_MAX_QUESTIONS}"}), 400)

    difficulty = str(data.get("difficulty") or "mixed").strip().lower()
    if difficulty not in ("easy", "medium", "hard", "mixed"):
        return None, (jsonify({"error": "difficulty phải là easy|medium|hard|mixed"}), 400)

    types = data.get("question_types") or list(QUESTION_TYPES)
    if not isinstance(types, list):
        return None, (jsonify({"error": "question_types phải là list"}), 400)
    types = [str(t).strip().lower() for t in types if str(t or "").strip()]
    bad = [t for t in types if t not in QUESTION_TYPES]
    if bad or not types:
        return None, (jsonify({"error": f"question_types không hợp lệ: {bad or 'rỗng'}"}), 400)

    scope = data.get("scope") or {}
    if not isinstance(scope, dict):
        return None, (jsonify({"error": "scope phải là object"}), 400)
    section_ids = [str(x) for x in (scope.get("section_ids") or []) if str(x or "").strip()]
    scope_type = "sections" if section_ids else "full_document"

    return {
        "question_count": count,
        "difficulty": difficulty,
        "question_types": types,
        "scope": {"type": scope_type, "section_ids": section_ids},
    }, None


def run_quiz_generation_job(job_id: str, document_id: str, config: dict,
                            user_id: Optional[str] = None) -> None:
    """Sinh quiz chẩn đoán (FR-06) + kiểm chất lượng (FR-13).

    Không dùng LangGraph: luồng thẳng một mạch, và graph tự ghi `status=done` là dựng
    lại race done-trước-result trong known-issues (xem `run_study_map_job`). Ở đây job
    chỉ `done` sau khi câu hỏi đã nằm trong DB.
    """
    from app.domains.ai_validation import rules as _rules
    from app.domains.ai_validation import store as _val_store
    from app.domains.jobs import ledger as _ledger
    from app.domains.jobs.jobs_store import is_cancel_requested, update_job
    from app.domains.quiz import generator as _quiz_gen
    from app.domains.quiz import repository as _quiz_repo

    print(f"quiz_job_running job_id={job_id}", flush=True)
    quiz_id = None
    # Log validation có FK tới `jobs` (Postgres). Sổ cái mở được thì mới gắn job_id,
    # không thì vẫn ghi log nhưng để trống — FR-13.10 không kèm điều kiện.
    ledger_ok = _ledger.open_job(job_id, job_type="quiz_generation", user_id=user_id,
                                 input_json={"document_id": document_id, **config})
    log_job_id = job_id if ledger_ok else None

    def _cancelled() -> bool:
        return bool(is_cancel_requested(job_id))

    try:
        scope = config["scope"]
        # Practice (FR-11.2) chỉ định thẳng chunk từ review item; quiz chẩn đoán lấy
        # theo section. Dùng CHUNG job này để hai đường sinh quiz không lệch nhau.
        if config.get("chunk_ids"):
            chunks = _quiz_repo.chunks_by_ids(document_id, config["chunk_ids"],
                                              limit=QUIZ_MAX_CONTEXT_CHUNKS)
            if not chunks:
                raise ValueError("Review item không còn chunk nguồn nào.")
        else:
            chunks = _quiz_repo.chunks_for_scope(document_id, scope.get("section_ids"),
                                                 limit=QUIZ_MAX_CONTEXT_CHUNKS)
            if not chunks:
                raise ValueError("Phạm vi đã chọn không có chunk nào đã index.")

        quiz_id = _quiz_repo.create_quiz(
            user_id=user_id, document_id=document_id,
            title=config.get("title") or _quiz_repo.document_title(document_id),
            scope=scope, question_count=config["question_count"],
            difficulty=config["difficulty"],
            quiz_type=config.get("quiz_type") or "diagnostic",
            source_review_item_id=config.get("source_review_item_id"),
            source_attempt_id=config.get("source_attempt_id"),
        )
        update_job(job_id, status="running", progress=10, current_node="BuildContext",
                   result={"quiz_id": quiz_id, "status": "processing"})

        context, ref_map = _quiz_gen.build_context(chunks)
        if _cancelled():
            raise _JobCancelled()

        update_job(job_id, progress=30, current_node="GenerateQuestions")
        raw_questions, err, attempts = _quiz_gen.generate_questions(context, config)
        if err:
            _val_store.log_rejections([_rules.json_failure(err)], job_id=log_job_id)
            raise ValueError(err)
        if _cancelled():
            raise _JobCancelled()

        update_job(job_id, progress=70, current_node="Validate")
        accepted, rejected = _rules.validate_questions(
            raw_questions,
            allowed_chunk_refs=ref_map.keys(),
            allowed_section_ids=_quiz_repo.section_ids_of(document_id),
            allowed_types=config["question_types"],
        )
        _val_store.log_rejections(rejected, job_id=log_job_id)

        # Nhãn `c0` sang chunk_id thật + suy ra section từ chunk nguồn (FR-06.10):
        # model không được cấp section_id nên tự nó không gắn được.
        # Practice: ÉP tag chủ đề của review item vào mọi câu (FR-11.10).
        # Tag do LLM tự đặt nên bài chẩn đoán ra "hàm hợp" còn bài luyện ra "quy tắc
        # hàm hợp" — hai tên khác nhau thì so sánh trước/sau không bao giờ khớp và
        # màn hình tiến bộ im lặng báo "chưa đo". Chủ đề đã biết chắc từ review item,
        # không có lý do để model quyết định lại.
        practice_topic = (config.get("practice_topic") or "").strip()
        if practice_topic:
            for q in accepted:
                tags = [t for t in (q.get("concept_tags") or []) if t != practice_topic]
                q["concept_tags"] = [practice_topic] + tags

        section_by_chunk = {c["chunk_id"]: c.get("section_id") for c in chunks}
        for q in accepted:
            q["chunk_ids"] = _quiz_gen.resolve_chunk_refs(q["chunk_refs"], ref_map)
            if not q.get("section_id"):
                sections = [section_by_chunk.get(cid) for cid in q["chunk_ids"]]
                sections = [x for x in sections if x]
                q["section_id"] = max(set(sections), key=sections.count) if sections else None
        accepted = [q for q in accepted if q["chunk_ids"]][: config["question_count"]]

        if not accepted:
            raise ValueError(
                f"Không câu hỏi nào qua kiểm chất lượng ({len(rejected)} câu bị loại).")

        update_job(job_id, progress=90, current_node="Persist")
        _quiz_repo.save_questions(quiz_id, accepted)
        _quiz_repo.finish(quiz_id, "ready", question_count=len(accepted))
        result = {"quiz_id": quiz_id, "status": "ready", "question_count": len(accepted),
                  "rejected_count": len(rejected), "llm_attempts": attempts}
        update_job(job_id, status="done", progress=100, current_node="Persist", result=result)
        _ledger.close_job(job_id, "done", result_type="quiz", result_id=quiz_id)
        print(f"quiz_job_done job_id={job_id} quiz_id={quiz_id} "
              f"kept={len(accepted)} rejected={len(rejected)}", flush=True)
    except _JobCancelled:
        if quiz_id:
            _quiz_repo.finish(quiz_id, "failed")
        update_job(job_id, status="cancelled", progress=0, current_node="Cancelled")
        _ledger.close_job(job_id, "cancelled")
        print(f"quiz_job_cancelled job_id={job_id}", flush=True)
    except Exception as e:
        if quiz_id:
            _quiz_repo.finish(quiz_id, "failed")
        update_job(job_id, status="error", error_text=_job_error_text(e))
        _ledger.close_job(job_id, "error", error_message=str(e))
        print(f"quiz_job_failed job_id={job_id} err={str(e)[:80]}", flush=True)


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
    if not row.get("source_stem"):
        return jsonify({"error": "Tài liệu chưa index xong"}), 409
    config, err = _quiz_config(data)
    if err:
        return err

    # Section lạ / của tài liệu khác → 400 ngay, đừng để job chạy rồi mới ra quiz rỗng.
    from app.domains.quiz import repository as _quiz_repo
    wanted = config["scope"]["section_ids"]
    if wanted:
        known = set(_quiz_repo.section_ids_of(document_id))
        unknown = [x for x in wanted if x not in known]
        if unknown:
            return jsonify({"error": f"section_ids không thuộc tài liệu: {unknown}"}), 400

    job_id = str(uuid.uuid4())
    from app.domains.jobs.jobs_store import create_job
    create_job(job_id, job_type="quiz_generation", status="pending", progress=0,
               current_node="Queued", user_id=uid)
    from app.jobs.queue import enqueue_job
    res = enqueue_job(run_quiz_generation_job, args=(job_id, document_id, config, uid),
                      queue="mindmap", job_id=job_id)
    print(f"quiz_enqueue_{res.get('mode')} job_id={job_id}", flush=True)
    return jsonify({"job_id": job_id, "status": "started"}), 202


@app.get('/api/quizzes/jobs/<job_id>')
def api_quizzes_job(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    _run_jobs_maintenance()
    from app.domains.jobs.jobs_store import get_job as _js_get
    j = _js_get(job_id)
    if not j or j.get("job_type") != "quiz_generation":
        return jsonify({"error": "Job not found"}), 404
    if _auth_protect_enabled() and j.get("user_id") != uid:
        return jsonify({"error": "Job not found"}), 404  # foreign job → no oracle
    return jsonify({
        "job_id": job_id,
        "status": j.get("status"),
        "progress": j.get("progress", 0),
        "current_step": j.get("current_node") or "",
        "result": j.get("result"),
        "error": j.get("error"),
    })


@app.post('/api/quizzes/jobs/<job_id>/cancel')
def api_quizzes_job_cancel(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    if _auth_protect_enabled() and _derived_job_owner_ok(job_id, uid, ("quiz_generation",)) is not True:
        return jsonify({"error": "Job not found"}), 404
    from app.domains.jobs.jobs_store import request_cancel
    request_cancel(job_id)
    return jsonify({"job_id": job_id, "cancel_requested": True})


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
def _owned_attempt(attempt_id: str, uid):
    """(attempt, error_response). Bài của người khác = 404, không phải 403."""
    from app.domains.attempts import repository as _attempts
    attempt = _attempts.get_attempt(attempt_id)
    if not attempt:
        return None, (jsonify({"error": "Attempt not found"}), 404)
    if _auth_protect_enabled() and attempt.get("user_id") != uid:
        return None, (jsonify({"error": "Attempt not found"}), 404)
    return attempt, None


def _attempt_public(attempt: dict) -> dict:
    out = dict(attempt)
    out.pop("user_id", None)
    out["unanswered_count"] = len(out.get("unanswered_question_ids") or [])
    return out


def run_short_answer_grading_job(job_id: str, attempt_id: str,
                                 user_id: Optional[str] = None) -> None:
    """Chấm bài có câu tự luận (FR-08.3). Chấm CẢ attempt rồi ghi một lần."""
    from app.domains.attempts import service as _grading_service
    from app.domains.jobs import ledger as _ledger
    from app.domains.jobs.jobs_store import update_job

    print(f"grading_job_running job_id={job_id}", flush=True)
    _ledger.open_job(job_id, job_type="short_answer_grading", user_id=user_id,
                     input_json={"attempt_id": attempt_id})
    try:
        update_job(job_id, status="running", progress=20, current_node="Grading")
        result = _grading_service.grade_attempt(attempt_id)
        if result is None:
            raise ValueError("Attempt không tồn tại.")
        update_job(job_id, status="done", progress=100, current_node="Grading",
                   result={"attempt_id": attempt_id, **result})
        _ledger.close_job(job_id, "done", result_type="quiz_attempt", result_id=attempt_id)
        print(f"grading_job_done job_id={job_id} attempt_id={attempt_id} "
              f"score={result['score']}/{result['max_score']}", flush=True)
    except Exception as e:
        update_job(job_id, status="error", error_text=_job_error_text(e))
        _ledger.close_job(job_id, "error", error_message=str(e))
        print(f"grading_job_failed job_id={job_id} err={str(e)[:80]}", flush=True)


@app.post('/api/quizzes/<quiz_id>/attempts')
def api_attempt_open(quiz_id: str):
    """Mở quiz (FR-07.1) — tạo attempt `in_progress` ngay, không đợi nộp (FR-07.10)."""
    uid, err = _require_app_user()
    if err:
        return err
    from app.domains.quiz import repository as _quiz_repo
    quiz = _quiz_repo.get_quiz(quiz_id, include_answers=False)
    if not quiz or (_auth_protect_enabled() and quiz.get("user_id") != uid):
        return jsonify({"error": "Quiz not found"}), 404
    if quiz["status"] != "ready":
        return jsonify({"error": "Quiz chưa sẵn sàng"}), 409

    from app.domains.attempts import repository as _attempts
    opened = _attempts.open_attempt(quiz_id, uid)
    attempt = _attempts.get_attempt(opened["attempt_id"])
    quiz.pop("user_id", None)
    return jsonify({**_attempt_public(attempt), "quiz": quiz}), 201 if opened["created"] else 200


@app.get('/api/attempts/<attempt_id>')
def api_attempt_get(attempt_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    attempt, err = _owned_attempt(attempt_id, uid)
    if err:
        return err
    return jsonify(_attempt_public(attempt))


@app.patch('/api/attempts/<attempt_id>/answers')
def api_attempt_save_answers(attempt_id: str):
    """Lưu nháp (FR-07.5, FR-07.11). Gọi lại cho cùng câu thì ghi đè."""
    uid, err = _require_app_user()
    if err:
        return err
    attempt, err = _owned_attempt(attempt_id, uid)
    if err:
        return err
    if attempt["status"] != "in_progress":
        # Đã nộp rồi mà còn sửa đáp án thì điểm không còn nghĩa gì.
        return jsonify({"error": "Attempt đã nộp, không sửa được đáp án",
                        "status": attempt["status"]}), 409

    data = request.json or {}
    raw = data.get("answers")
    if isinstance(raw, list):
        raw = {a.get("question_id"): a.get("user_answer")
               for a in raw if isinstance(a, dict) and a.get("question_id")}
    if not isinstance(raw, dict) or not raw:
        return jsonify({"error": "Thiếu answers"}), 400

    from app.domains.attempts import repository as _attempts
    known = set(_attempts.question_ids_of_quiz(attempt["quiz_id"]))
    unknown = [q for q in raw if str(q) not in known]
    if unknown:
        return jsonify({"error": f"question_id không thuộc quiz: {unknown}"}), 400

    _attempts.save_draft_answers(attempt_id, {str(k): v for k, v in raw.items()})
    return jsonify(_attempt_public(_attempts.get_attempt(attempt_id)))


@app.post('/api/attempts/<attempt_id>/submit')
def api_attempt_submit(attempt_id: str):
    """Nộp bài (FR-07.7). Bài toàn trắc nghiệm chấm luôn; có tự luận thì chấm nền."""
    uid, err = _require_app_user()
    if err:
        return err
    attempt, err = _owned_attempt(attempt_id, uid)
    if err:
        return err

    from app.domains.attempts import repository as _attempts
    from app.domains.attempts import service as _grading_service
    submitted = _attempts.submit(attempt_id)
    if submitted is None:
        return jsonify({"error": "Attempt không còn ở trạng thái in_progress",
                        "status": attempt["status"]}), 409

    if not _grading_service.has_short_answer(attempt["quiz_id"]):
        result = _grading_service.grade_attempt(attempt_id)
        return jsonify({**_attempt_public(_attempts.get_attempt(attempt_id)),
                        "grading": "done", **(result or {})})

    job_id = str(uuid.uuid4())
    from app.domains.jobs.jobs_store import create_job
    create_job(job_id, job_type="short_answer_grading", status="pending", progress=0,
               current_node="Queued", user_id=uid)
    from app.jobs.queue import enqueue_job
    res = enqueue_job(run_short_answer_grading_job, args=(job_id, attempt_id, uid),
                      queue="mindmap", job_id=job_id)
    print(f"grading_enqueue_{res.get('mode')} job_id={job_id}", flush=True)
    return jsonify({**_attempt_public(_attempts.get_attempt(attempt_id)),
                    "grading": "pending", "job_id": job_id}), 202


@app.get('/api/attempts/jobs/<job_id>')
def api_attempt_grading_job(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    _run_jobs_maintenance()
    from app.domains.jobs.jobs_store import get_job as _js_get
    j = _js_get(job_id)
    if not j or j.get("job_type") != "short_answer_grading":
        return jsonify({"error": "Job not found"}), 404
    if _auth_protect_enabled() and j.get("user_id") != uid:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({
        "job_id": job_id,
        "status": j.get("status"),
        "progress": j.get("progress", 0),
        "result": j.get("result"),
        "error": j.get("error"),
    })


@app.get('/api/quizzes/results/<attempt_id>')
def api_attempt_results(attempt_id: str):
    """Kết quả sau khi nộp — CHỖ DUY NHẤT lộ đáp án đúng + giải thích (FR-08.8).

    Chưa nộp thì 409: trả đáp án lúc bài còn `in_progress` là đưa bài giải cho người
    đang làm.
    """
    uid, err = _require_app_user()
    if err:
        return err
    attempt, err = _owned_attempt(attempt_id, uid)
    if err:
        return err
    if attempt["status"] == "in_progress":
        return jsonify({"error": "Attempt chưa nộp", "status": attempt["status"]}), 409

    from app.domains.quiz import repository as _quiz_repo
    quiz = _quiz_repo.get_quiz(attempt["quiz_id"], include_answers=True) or {}
    by_question = {a["question_id"]: a for a in attempt["answers"]}
    questions = []
    for q in quiz.get("questions") or []:
        answer = by_question.get(q["question_id"]) or {}
        questions.append({
            **q,
            "user_answer": answer.get("user_answer"),
            "verdict": answer.get("verdict"),
            "is_correct": answer.get("is_correct"),
            "score": answer.get("score"),
            "feedback": answer.get("feedback"),
        })
    return jsonify({
        **_attempt_public(attempt),
        "quiz_id": attempt["quiz_id"],
        "quiz_title": quiz.get("title"),
        "questions": questions,
    })


@app.get('/api/quizzes/<quiz_id>/attempts')
def api_quiz_attempts(quiz_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    from app.domains.quiz import repository as _quiz_repo
    owner = _quiz_repo.owner_of(quiz_id)
    if owner is None or (_auth_protect_enabled() and owner != uid):
        return jsonify({"error": "Quiz not found"}), 404
    from app.domains.attempts import repository as _attempts
    return jsonify({
        "quiz_id": quiz_id,
        "attempts": _attempts.list_by_quiz(
            quiz_id, user_id=uid if _auth_protect_enabled() else None),
    })


# -------------------------
# 🩺 API lỗ hổng kiến thức + gợi ý ôn tập (FR-09, FR-10, đặc tả 7.7)
# -------------------------
@app.get('/api/attempts/<attempt_id>/concept-masteries')
def api_attempt_masteries(attempt_id: str):
    """Mức nắm từng concept của bài làm; `?weak=1` chỉ lấy chủ đề yếu (FR-09.8)."""
    uid, err = _require_app_user()
    if err:
        return err
    attempt, err = _owned_attempt(attempt_id, uid)
    if err:
        return err
    from app.domains.gap_analysis import service as _gap
    weak_only = str(request.args.get("weak", "")).lower() in ("1", "true", "yes")
    rows = _gap.list_for_attempt(attempt_id, weak_only=weak_only)
    if not rows and attempt["status"] == "graded" and not weak_only:
        # Bài đã chấm mà chưa có snapshot (hook lúc chấm hỏng) → tính bù, đừng trả rỗng.
        _gap.analyze_attempt(attempt_id)
        rows = _gap.list_for_attempt(attempt_id)
    return jsonify({"attempt_id": attempt_id, "status": attempt["status"],
                    "concept_masteries": rows})


@app.post('/api/review-plans/generate')
def api_review_plan_generate():
    """Tạo review plan từ một attempt đã chấm (FR-10.1).

    Chạy đồng bộ: đúng một lượt gọi LLM, và model hỏng vẫn ra plan rule-based nên
    không cần job nền như tạo quiz.
    """
    uid, err = _require_app_user()
    if err:
        return err
    data = request.json or {}
    attempt_id = (data.get("attempt_id") or "").strip()
    if not attempt_id:
        return jsonify({"error": "Thiếu attempt_id"}), 400
    attempt, err = _owned_attempt(attempt_id, uid)
    if err:
        return err
    if attempt["status"] != "graded":
        return jsonify({"error": "Attempt chưa được chấm", "status": attempt["status"]}), 409

    from app.domains.review import service as _review
    if not data.get("force"):
        existing = _review.get_by_attempt(attempt_id)
        if existing:
            existing.pop("user_id", None)
            return jsonify({**existing, "cached": True}), 200

    plan = _review.generate(attempt_id)
    if plan is None:
        return jsonify({"error": "Không tạo được review plan"}), 500
    plan.pop("user_id", None)
    return jsonify(plan), 201


@app.get('/api/review-plans/<attempt_id>')
def api_review_plan_by_attempt(attempt_id: str):
    """Đặc tả 7.7: tra theo `attempt_id`, không phải review_plan_id."""
    uid, err = _require_app_user()
    if err:
        return err
    _attempt, err = _owned_attempt(attempt_id, uid)
    if err:
        return err
    from app.domains.review import service as _review
    plan = _review.get_by_attempt(attempt_id)
    if not plan:
        return jsonify({"error": "Review plan not found"}), 404
    plan.pop("user_id", None)
    return jsonify(plan)


@app.get('/api/review-plans/<review_plan_id>/items')
def api_review_plan_items(review_plan_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    from app.domains.review import service as _review
    plan = _review.get_plan(review_plan_id)
    if not plan or (_auth_protect_enabled() and plan.get("user_id") != uid):
        return jsonify({"error": "Review plan not found"}), 404
    return jsonify({"review_plan_id": plan["review_plan_id"],
                    "attempt_id": plan["attempt_id"],
                    "items": plan["items"]})


# -------------------------
# 🏋️ API luyện tập + tiến độ (FR-11, FR-12, đặc tả 7.8–7.10)
# -------------------------
def _owned_practice(quiz_id: str, uid):
    """(meta, error). Quiz chẩn đoán vào route practice cũng là 404 — hai luồng khác nhau."""
    from app.domains.quiz import repository as _quiz_repo
    meta = _quiz_repo.get_meta(quiz_id)
    if not meta or meta.get("quiz_type") != "practice":
        return None, (jsonify({"error": "Practice quiz not found"}), 404)
    if _auth_protect_enabled() and meta.get("user_id") != uid:
        return None, (jsonify({"error": "Practice quiz not found"}), 404)
    return meta, None


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

    from app.domains.review import service as _review
    item = _review.get_item(review_item_id)
    if not item or (_auth_protect_enabled() and item.get("user_id") != uid):
        return jsonify({"error": "Review item not found"}), 404
    if not item.get("chunk_ids"):
        return jsonify({"error": "Review item không có chunk nguồn để ra đề"}), 409

    config, err = _quiz_config(data)
    if err:
        return err
    config.update({
        "quiz_type": "practice",
        "chunk_ids": item["chunk_ids"],
        # FR-11.8 / FR-11.9: mất hai khoá này là mất cả chuỗi yếu → ôn → luyện.
        "source_review_item_id": review_item_id,
        "source_attempt_id": item["attempt_id"],
        "title": f"Luyện tập: {item['topic']}",
        "practice_topic": item["topic"],
    })

    job_id = str(uuid.uuid4())
    from app.domains.jobs.jobs_store import create_job
    create_job(job_id, job_type="quiz_generation", status="pending", progress=0,
               current_node="Queued", user_id=uid)
    from app.jobs.queue import enqueue_job
    res = enqueue_job(run_quiz_generation_job,
                      args=(job_id, item["document_id"], config, uid),
                      queue="mindmap", job_id=job_id)
    print(f"practice_enqueue_{res.get('mode')} job_id={job_id}", flush=True)
    return jsonify({"job_id": job_id, "status": "started"}), 202


@app.get('/api/practice/<practice_quiz_id>')
def api_practice_get(practice_quiz_id: str):
    """Đề luyện tập. Vẫn KHÔNG kèm đáp án trước khi nộp (FR-06.12)."""
    uid, err = _require_app_user()
    if err:
        return err
    _meta, err = _owned_practice(practice_quiz_id, uid)
    if err:
        return err
    from app.domains.quiz import repository as _quiz_repo
    quiz = _quiz_repo.get_quiz(practice_quiz_id, include_answers=False)
    quiz.pop("user_id", None)
    meta = _quiz_repo.get_meta(practice_quiz_id) or {}
    return jsonify({**quiz,
                    "source_review_item_id": meta.get("source_review_item_id"),
                    "source_attempt_id": meta.get("source_attempt_id")})


@app.post('/api/practice/<practice_quiz_id>/submit')
def api_practice_submit(practice_quiz_id: str):
    """Nộp bài luyện tập trong MỘT lần gọi (FR-11.6, FR-11.7).

    Luồng chẩn đoán tách mở/nháp/nộp vì người học làm dài và cần lưu nháp; bài luyện tập
    ngắn nên gộp lại — vẫn đi qua đúng repository attempt để lịch sử thống nhất.
    """
    uid, err = _require_app_user()
    if err:
        return err
    meta, err = _owned_practice(practice_quiz_id, uid)
    if err:
        return err
    if meta.get("status") != "ready":
        return jsonify({"error": "Practice quiz chưa sẵn sàng"}), 409

    data = request.json or {}
    raw = data.get("answers")
    if isinstance(raw, list):
        raw = {a.get("question_id"): a.get("user_answer")
               for a in raw if isinstance(a, dict) and a.get("question_id")}
    if not isinstance(raw, dict) or not raw:
        return jsonify({"error": "Thiếu answers"}), 400

    from app.domains.attempts import repository as _attempts
    from app.domains.attempts import service as _grading_service
    known = set(_attempts.question_ids_of_quiz(practice_quiz_id))
    unknown = [q for q in raw if str(q) not in known]
    if unknown:
        return jsonify({"error": f"question_id không thuộc quiz: {unknown}"}), 400

    attempt_id = _attempts.open_attempt(practice_quiz_id, uid)["attempt_id"]
    _attempts.save_draft_answers(attempt_id, {str(k): v for k, v in raw.items()})
    if _attempts.submit(attempt_id) is None:
        return jsonify({"error": "Attempt không còn ở trạng thái in_progress"}), 409
    result = _grading_service.grade_attempt(attempt_id)
    return jsonify({**_attempt_public(_attempts.get_attempt(attempt_id)),
                    "grading": "done", **(result or {})})


@app.get('/api/practice/<practice_quiz_id>/comparison')
def api_practice_comparison(practice_quiz_id: str):
    """Mastery trước/sau luyện tập (FR-11.10, FR-12.7).

    "Trước" là attempt chẩn đoán gốc (`source_attempt_id`), "sau" là lần làm practice
    gần nhất đã chấm.
    """
    uid, err = _require_app_user()
    if err:
        return err
    meta, err = _owned_practice(practice_quiz_id, uid)
    if err:
        return err

    from app.domains.gap_analysis import service as _gap
    from app.domains.progress import service as _progress
    from app.domains.review import service as _review

    after_attempt = _progress.latest_graded_attempt(practice_quiz_id, uid)
    if not after_attempt:
        return jsonify({"error": "Chưa có lần làm nào đã chấm cho practice quiz này"}), 409

    source_attempt = meta.get("source_attempt_id")
    item = _review.get_item(meta.get("source_review_item_id") or "")
    topics = [item["topic"]] if item else None

    body = _progress.compare_masteries(
        _gap.list_for_attempt(source_attempt) if source_attempt else [],
        _gap.list_for_attempt(after_attempt),
        topics=topics,
    )
    return jsonify({
        "practice_quiz_id": practice_quiz_id,
        "topic": item["topic"] if item else None,
        "source_attempt_id": source_attempt,
        "practice_attempt_id": after_attempt,
        **body,
    })


@app.get('/api/progress/overview')
def api_progress_overview():
    uid, err = _require_app_user()
    if err:
        return err
    from app.domains.progress import service as _progress
    return jsonify(_progress.overview(uid))


@app.get('/api/progress/concepts')
def api_progress_concepts():
    """Mastery theo concept qua nhiều attempt (FR-12.3, FR-12.4). `?weak=1` lọc chủ đề yếu."""
    uid, err = _require_app_user()
    if err:
        return err
    from app.domains.progress import service as _progress
    document_id = (request.args.get("document_id") or "").strip() or None
    if document_id:
        _row, err = _owned_document(document_id, uid)
        if err:
            return err
    rows = _progress.concept_progress(uid, document_id=document_id)
    if str(request.args.get("weak", "")).lower() in ("1", "true", "yes"):
        rows = [r for r in rows if r["status"] != "mastered"]
    return jsonify({"concepts": rows})


@app.get('/api/progress/attempts')
def api_progress_attempts():
    uid, err = _require_app_user()
    if err:
        return err
    try:
        limit = max(1, min(200, int(request.args.get("limit", 50))))
    except (TypeError, ValueError):
        return jsonify({"error": "limit phải là số nguyên"}), 400
    from app.domains.progress import service as _progress
    return jsonify({"attempts": _progress.attempt_history(uid, limit=limit)})


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
    from app.domains.jobs.jobs_store import get_job as _js_get
    j = _js_get(job_id)
    if not j:
        return jsonify({"error": "Job not found"}), 404
    if _auth_protect_enabled() and j.get("user_id") != uid:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({
        "job_id": job_id,
        "job_type": j.get("job_type"),
        "status": j.get("status"),
        "progress": j.get("progress", 0),
        "current_step": j.get("current_node") or "",
        "result": j.get("result"),
        "error": j.get("error"),
    })


# Job_type mà executor THẬT SỰ gọi is_cancel_requested giữa các bước.
# Kiểm bằng: grep -rn "is_cancel_requested" BE/app BE/services --include=*.py
_CANCELLABLE_JOB_TYPES = {"mindmap", "summary", "quiz_generation", "study_map_generation"}


@app.post('/api/jobs/<job_id>/cancel')
def api_job_cancel(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    from app.domains.jobs.jobs_store import get_job as _js_get
    j = _js_get(job_id)
    if not j or (_auth_protect_enabled() and j.get("user_id") != uid):
        return jsonify({"error": "Job not found"}), 404
    # Chỉ những job_type có điểm kiểm huỷ trong executor mới huỷ được. Các loại còn
    # lại (ingest, query, short_answer_grading) KHÔNG đọc cờ ở bất kỳ đâu — trước đây
    # route này vẫn trả cancel_requested=True cho chúng, nên FE hiện "Đang huỷ…" rồi
    # treo tới hết TTL (đúng lớp lỗi known-issues 2026-07-17). Thà từ chối thẳng.
    # Thêm job_type vào đây CHỈ SAU KHI executor của nó thật sự gọi is_cancel_requested.
    if (j.get("job_type") or "") not in _CANCELLABLE_JOB_TYPES:
        return jsonify({
            "error": f"Loại job '{j.get('job_type')}' không hỗ trợ huỷ giữa chừng.",
            "job_id": job_id,
            "cancel_requested": False,
        }), 409
    from app.domains.jobs.jobs_store import request_cancel
    request_cancel(job_id)
    return jsonify({"job_id": job_id, "cancel_requested": True})


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
        _js_create(job_id, job_type="query", status="pending", progress=0, current_node="Queued", user_id=req_user_id)
    except Exception:
        pass
    with query_jobs_lock:
        query_jobs[job_id] = {
            "status": "pending",
            "result": None,
            "error": None,
            "created_at": time.time(),
            "user_id": req_user_id,  # Phase C: owner guard for status/stream/resume
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
                history = _ss_get(session_id, limit_messages=8)
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
                    _rw = rewrite_followup_question(question, conv_ctx, sources or [])
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
                "retrieved_chunks": [],
                "retrieved_sources": [],
                "context": "",
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
            _finalize_query_job(jid, session_id, question, out, user_id=req_user_id, enforce_owner=conv_enforce)
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
                       length_mode: str, mode: str = "standard") -> str:
    """Phase 5 Step 2: dispatch Summary v2 via enqueue_job — daemon thread when
    QUEUE_ENABLED=false (default, unchanged), RQ 'summary' queue when true. FE polling
    (/summary-status) unchanged; result still in summary_store."""
    job_id = str(uuid.uuid4())
    uid = _current_user_id()  # request context: stamp job + record owner (Phase D)
    from app.domains.jobs.jobs_store import create_job
    create_job(job_id, job_type="summary", status="pending", progress=0, current_node="Queued", user_id=uid)
    from app.jobs.queue import enqueue_job
    res = enqueue_job(run_summary_job,
                      args=(job_id, source_names, mm_input, content_hash, length_mode, uid, mode),
                      queue="summary", job_id=job_id)
    _event = {"rq": "summary_enqueue_rq", "thread": "summary_enqueue_thread",
              "thread_fallback": "summary_queue_fallback_thread"}.get(res.get("mode"),
                                                                      f"summary_enqueue_{res.get('mode')}")
    print(f"{_event} job_id={job_id}", flush=True)
    return job_id


def run_summary_job(job_id: str, source_names: list[str], mm_input: dict,
                    content_hash: str, length_mode: str, user_id: Optional[str] = None,
                    mode: str = "standard") -> None:
    """Summary v2 execution body. Runs in a daemon thread (QUEUE_ENABLED=false) OR an RQ
    worker process (QUEUE_ENABLED=true) — identical behaviour, no Flask request context
    needed. Enqueued by dotted path `app.main.run_summary_job`. The graph owns the
    done/result write (atomic); this wraps errors -> job error. Cancellation uses the
    existing cooperative flag (summary graph `_guard` checks jobs_store cancel_requested)."""
    print(f"summary_job_running job_id={job_id}", flush=True)
    # Phase 0 observability: counter LLM call per-job (pipeline pool propagate
    # qua ctx_submit); flush thành node event "LLMCalls" kể cả khi job lỗi.
    from app.graphs.logger import begin_llm_count, flush_llm_count
    _llm_counter = begin_llm_count()
    try:
        from app.domains.jobs.jobs_store import update_job as _uj
        try:
            _uj(job_id, status="running", current_node="Summary")
        except Exception:
            pass
        if SUMMARY_GRAPH is None:
            raise RuntimeError("SUMMARY_GRAPH chưa khởi tạo — kiểm tra logs khởi động.")
        _langgraph_invoke(SUMMARY_GRAPH, {
            "job_id": job_id, "source_names": source_names, "mm_input": mm_input,
            "content_hash": content_hash, "length_mode": length_mode, "mode": mode,
            "user_id": user_id,  # Phase D: persisted onto the summary record (owner)
            "progress": 0, "current_node": "", "error": None,
        }, thread_id=job_id)
        print(f"summary_job_done job_id={job_id}", flush=True)
    except Exception as e:
        from app.domains.jobs.jobs_store import update_job
        update_job(job_id, status="error", error_text=_job_error_text(e))
        print(f"summary_job_failed job_id={job_id} err={str(e)[:80]}", flush=True)
    finally:
        flush_llm_count(job_id, _llm_counter)


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
            return jsonify({"status": "done", "result": cached, "cached": True}), 200
    job_id = _start_summary_job(source_names, mm_input, content_hash, length_mode, mode)
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


def _start_mindmap_job(source_names: list[str], mm_input: dict, content_hash: str) -> str:
    """Phase 5 Step 3: dispatch Mindmap v3 via enqueue_job — daemon thread when
    QUEUE_ENABLED=false (default, unchanged), RQ 'mindmap' queue when true. FE polling
    (/mindmap-status) unchanged; result still in mindmap_store."""
    job_id = str(uuid.uuid4())
    uid = _current_user_id()  # request context: stamp job + record owner (Phase D)
    from app.domains.jobs.jobs_store import create_job
    create_job(job_id, job_type="mindmap", status="pending", progress=0, current_node="Queued", user_id=uid)
    from app.jobs.queue import enqueue_job
    res = enqueue_job(run_mindmap_job,
                      args=(job_id, source_names, mm_input, content_hash, uid),
                      queue="mindmap", job_id=job_id)
    _event = {"rq": "mindmap_enqueue_rq", "thread": "mindmap_enqueue_thread",
              "thread_fallback": "mindmap_queue_fallback_thread"}.get(res.get("mode"),
                                                                      f"mindmap_enqueue_{res.get('mode')}")
    print(f"{_event} job_id={job_id}", flush=True)
    return job_id


def run_mindmap_job(job_id: str, source_names: list[str], mm_input: dict, content_hash: str, user_id: Optional[str] = None) -> None:
    """Mindmap v3 execution body. Runs in a daemon thread (QUEUE_ENABLED=false) OR an RQ
    worker process (QUEUE_ENABLED=true) — identical behaviour, no Flask request context
    needed. Enqueued by dotted path `app.main.run_mindmap_job`. The graph owns the
    done/result write (atomic); this wraps errors -> job error. Cancellation uses the
    existing cooperative flag (mindmap graph `_guard` checks jobs_store cancel_requested)."""
    print(f"mindmap_job_running job_id={job_id}", flush=True)
    from app.graphs.logger import begin_llm_count, flush_llm_count
    _llm_counter = begin_llm_count()
    try:
        from app.domains.jobs.jobs_store import update_job as _uj
        try:
            _uj(job_id, status="running", current_node="Mindmap")
        except Exception:
            pass
        if MINDMAP_GRAPH is None:
            raise RuntimeError("MINDMAP_GRAPH chưa khởi tạo — kiểm tra logs khởi động.")
        _langgraph_invoke(MINDMAP_GRAPH, {
            "job_id": job_id, "source_names": source_names, "mm_input": mm_input,
            "content_hash": content_hash, "user_id": user_id,  # Phase D: record owner
            "progress": 0, "current_node": "", "error": None,
        }, thread_id=job_id)
        print(f"mindmap_job_done job_id={job_id}", flush=True)
    except Exception as e:
        from app.domains.jobs.jobs_store import update_job
        update_job(job_id, status="error", error_text=_job_error_text(e))
        print(f"mindmap_job_failed job_id={job_id} err={str(e)[:80]}", flush=True)
    finally:
        flush_llm_count(job_id, _llm_counter)


# -------------------------
@app.post("/generate-mindmap")
def generate_mindmap():
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
        if candidate:
            if candidate not in source_names:
                source_names.append(candidate)

    if not source_names:
        return jsonify({"error": "No sources selected"}), 400

    # Phase D: every requested source must be owned (foreign → 403, no global fallback).
    src_err = _ensure_owned_sources(source_names, uid)
    if src_err:
        return src_err

    force = bool(data.get("force"))
    try:
        mm_input, content_hash = _mindmap_input_and_hash(source_names)
    except Exception as e:
        return jsonify({"error": f"Không đọc được dữ liệu nguồn: {e}"}), 500
    if not mm_input.get("chunks"):
        return jsonify({"error": "Nguồn chưa có dữ liệu đã index"}), 400
    if not force:
        # Phase D: user-scoped cache lookup — no cross-user reuse on identical content_hash.
        cached = (mindmap_store.get_by_hash(content_hash, user_id=uid, enforce_owner=True)
                  if _auth_protect_enabled() else mindmap_store.get_by_hash(content_hash))
        if cached:
            return jsonify({"status": "done", "result": cached, "cached": True}), 200
    job_id = _start_mindmap_job(source_names, mm_input, content_hash)
    return jsonify({"job_id": job_id, "status": "started"}), 202


@app.get("/mindmap-status/<job_id>")
def mindmap_status(job_id: str):
    uid, err = _require_app_user()
    if err:
        return err
    _run_jobs_maintenance()
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
        
        # 2️⃣ DELETE FILE SYSTEM
        input_file_deleted = _delete_input_file(source_id, source_info or {})
        
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


if __name__ == '__main__':
    debug_env = (os.environ.get("DEBUG", "0") or "").strip().lower()
    debug = debug_env in {"1", "true", "yes", "y", "on"}
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=debug, use_reloader=debug)
