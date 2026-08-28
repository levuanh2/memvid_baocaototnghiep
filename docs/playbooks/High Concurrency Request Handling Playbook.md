# Playbook: High Concurrency Request Handling

## Project
MemVid

## Purpose
Operate, diagnose, and tune MemVid under concurrent load. Keep latency bounded and cost low
given ONE Ollama (qwen3.5:9b) on host CPU as the hard serial bottleneck.

## Mental model (read this first)
Everything expensive ends at one CPU-bound Ollama. Concurrency knobs UPSTREAM of it
(gunicorn workers, gateway threads, per-worker query semaphore) do NOT add throughput — they
only decide how much you pile onto a CPU that serves ~1–2 gens at a time. The job of this
playbook is to keep the pile bounded and coalesce duplicate work.

## Request flow (query)
```
POST /query
→ route handler (main.py::query)  [acquire per-worker Semaphore(4) or 429]
→ 202 {job_id}; work in daemon Thread
→ LangGraph invoke:
   CacheLookup (L1 OrderedDict → L2 semantic Redis; empty-answer hit = miss)
   → RetrieveMemory (memory tree, timeout 15s → fallback)
   → RetrieveFAISS (L3 retrieval Redis cache → hybrid/ensemble bge-m3 + BM25)
   → ContextBuilder → [Rerank] → [VerifyContext(NLI)]
   → GenerateAnswer (gRPC gateway → Ollama; AI_TIMEOUT 180s; ≤2 FeedbackLoop retries;
                     ≤3 empty-answer re-gen)
   → Evaluate → FeedbackLoop → Finalize (write cache: non-empty, non-fallback only)
→ _finalize_query_job: status="done" + result written ATOMICALLY (never done-before-result)
→ FE polls /query-status or SSE /query-stream
```

## When to use
Latency spikes under load, 429/503 storms, Ollama pegged, cache stampede suspected,
tuning worker/semaphore/queue counts.

## Diagnosis steps
1. Is Ollama the wall? `docker stats` + host CPU. If Ollama ~100% and gens serialize → expected;
   fix is a smaller/quantized model or fewer concurrent gens, NOT more workers.
2. Stampede? Many identical questions → many `GenerateAnswer` log lines for same q within
   seconds = missing/failed single-flight. Check `single_flight_*` metrics.
3. Retry amplification? Grep FeedbackLoop retries + `gen_fallback` + "AI timeout sau" —
   under load these multiply gens. Consider disabling EVAL (default off) and confirming
   empty-answer re-gen isn't looping.
4. Cache health: GET /stats "cache" (PER WORKER — logs are ground truth). `redis-cli INFO`.
5. Fallback intact? Redis down must still answer (fail-open). Empty cached answer must miss.

## Tuning knobs (env)
- `MAX_CONCURRENT_LLM_CALLS` (planned, gateway) — the real throttle. CPU: 1–2.
- `WEB_CONCURRENCY` (compose=2) — HTTP acceptance only; do NOT raise to chase LLM throughput.
- `QUERY_MAX_CONCURRENT` (4/worker) — admission cap before 429.
- `AI_TIMEOUT_SEC` (180), `MEMORY_TREE_TIMEOUT_SEC` (15).
- Cache: `SEMANTIC_CACHE_THRESHOLD` (0.85, floor 0.80), TTLs 48h/1h, `CACHE_ENABLED`, `REDIS_URL`.
- `SINGLE_FLIGHT_ENABLED`, `SINGLE_FLIGHT_WAIT_SEC` (planned).
- `QUEUE_ENABLED`, `WORKER_CONCURRENCY` (planned RQ).
- Host: `OLLAMA_NUM_PARALLEL`, `OLLAMA_MAX_LOADED_MODELS` — keep small on CPU.

## Anti-patterns (documented failures to avoid)
- Widening the funnel (more gunicorn/gateway workers) to "handle more" — thrashes CPU, worse p95.
- Async/ASGI rewrite — no gain, bottleneck is CPU (DR-3 D1).
- Single-flight deep in the graph — coalesce at job submit, before embed/retrieve/LLM.
- Setting job status="done" in a graph node — must be atomic with result (known-issues 2026-07-06).
- Lowering cache threshold for hit-rate (DR-2).

## Metrics to expose
request_count, concurrent_requests, p50/p95/p99, cache_hit/miss/bypass_rate,
semantic_similarity_score, single_flight_wait_count, llm_call_count, llm_inflight,
llm_timeout_count, llm_reject_count, redis_latency, vector_search_latency, queue_depth,
worker_utilization, empty_response_count, error_rate, est_cost_per_request.

## Failure modes → expected behavior
- Redis down → fail-open, cache off, answers still generated (window 60s retry).
- Ollama timeout → RuntimeError "AI timeout" → job error, FE shows error (no empty cache write).
- Vector store slow → retrieval cache absorbs repeats; cold path slow but bounded.
- Many same question → single-flight coalesces to ~1 gen (once Phase 3 lands).
- Many uploads → move to RQ worker (Phase 5) so they don't starve queries.
- Empty cached answer → treated as miss, regenerates (contract).

## Verification
Baseline script (Phase 1) at 10/50 concurrent; p95 stable; no empty answers at hit speed;
Redis-down smoke still answers; single-flight collapses N identical to ~1 gen.

## How to run the baseline load test (`BE/scripts/perf/baseline_concurrency.py`)
Stdlib only (no deps). Docker stack must be up (`docker compose up -d`). Run from repo root.
```
# Health only (fast: backend/ollama/redis/logs.sqlite reachability + doc/chunk counts)
SCENARIO=health python BE/scripts/perf/baseline_concurrency.py

# One scenario (identical stampede | distinct multi-user | vn paraphrase)
SCENARIO=identical CONCURRENCY=10 TOTAL_REQUESTS=10 TIMEOUT_SECONDS=420 \
    python BE/scripts/perf/baseline_concurrency.py
QUESTION_MODE=distinct SCENARIO=distinct CONCURRENCY=10 python BE/scripts/perf/baseline_concurrency.py
SCENARIO=vietnamese_paraphrase python BE/scripts/perf/baseline_concurrency.py

# Full matrix (10/50 identical + 10/50 distinct + vn paraphrase) — SLOW, pegs CPU
SCENARIO=all python BE/scripts/perf/baseline_concurrency.py
```
Env knobs: BASE_URL, CONCURRENCY, TOTAL_REQUESTS, QUESTION_MODE, POLL_INTERVAL_SECONDS,
TIMEOUT_SECONDS, SOURCES (comma stems, default all docs), RETRY_ON_429 (default 1), COMPOSE,
REPORT_DIR. Output: `reports/performance/baseline-<UTCts>.{json,md}`.

### Reading the results
- **Success/empty/error/timeout/429** counts + p50/p95/p99/max latency + throughput per scenario.
- **cache hits** = delta of `/stats` cache counters over the run (PER-WORKER, a clue not exact).
- **LLM gens** = delta of backend `node_logs` GenerateAnswer rows = ground-truth generation count.
  JSON `llm_generations` can UNDERCOUNT if gens outlive the client deadline — the authoritative
  count is a direct query:
  ```
  docker compose exec -T backend python -c "import sqlite3;c=sqlite3.connect('/app/logs.sqlite');\
  print(c.execute(\"select status,count(*),round(avg(duration_ms)/1000,1) from node_logs \
  where node='GenerateAnswer' group by status\").fetchall())"
  ```
  N generations for N *identical* questions with 0 cache hits = single-flight is missing.

### First baseline (2026-07-07, pre-Phase-2) — reference numbers
- Solo GenerateAnswer ~57s. At 10 concurrent identical: every gen 248–284s, ALL > AI_TIMEOUT_SEC
  180s → error. 0/10 success; cache never seeds. This is the "before" for Phase 2 comparison.
  Re-run `SCENARIO=all` after the gateway cap lands and expect gens < 180s + non-zero success.

## Phase 2 Gateway Semaphore (SHIPPED 2026-07-07, uncommitted)
Global LLM concurrency cap in `services/llm_gateway/server.py` — the one process all generation
funnels through. `threading.BoundedSemaphore(MAX_CONCURRENT_LLM_CALLS)` wraps the Ollama call in
`Ask` + `AskStream` (Embed NOT capped). Overflow waits `LLM_QUEUE_WAIT_TIMEOUT_SECONDS` then
aborts `RESOURCE_EXHAUSTED` → backend job error (never empty, never hang). Released in `finally`;
retries share the same slot. Limiter only — never changes answer correctness.

- **Env:** `MAX_CONCURRENT_LLM_CALLS` (default 2), `LLM_QUEUE_WAIT_TIMEOUT_SECONDS` (default 30).
  In compose the gateway reads `${MAX_CONCURRENT_LLM_CALLS:-2}` — override per-run:
  `MAX_CONCURRENT_LLM_CALLS=1 docker compose up -d llm-gateway` (env change only, no rebuild;
  CODE change needs `--build`).
- **TUNING (measured 2026-07-07, single CPU Ollama):** **cap=1 is optimal on this box.**
  10 concurrent distinct(cold): no-cap 0/10 → cap=2 6/10 (p50 256s, gens to 248s) → cap=1 9/10
  (p50 76s, gens 29–148s). One CPU serves ~1 gen cleanly; cap=2 already thrashes. Use 2 only on
  multi-core / GPU / multi-replica Ollama. Full data: reports/performance/phase2-gateway-semaphore.md.
- **Observe:** `docker compose logs llm-gateway | grep llm_semaphore` — events
  `llm_semaphore_waiting|acquired|released|timeout` + `llm_generation_started|finished`
  (fields: `label` Ask/AskStream, `active` in-flight, `max`). `active=max` with rising
  `llm_semaphore_timeout` = saturated → either lower load, add single-flight (Phase 3), or scale Ollama.
- **Known residual:** bge-m3 embeddings are NOT capped and co-thrash the CPU with generation under
  burst — the cause of the tail errors that survive even at cap=1. Address in Phase 4/5 (move heavy
  embed off the query hot path), NOT by widening the generation cap.
- **Diagnose gen duration:** `docker compose exec -T backend python -c "import sqlite3;\
  c=sqlite3.connect('/app/logs.sqlite');print(c.execute(\"select status,count(*),\
  round(avg(duration_ms)/1000,1) from node_logs where node='GenerateAnswer' group by status\")\
  .fetchall())"` — solo ~57s; if ok-gens climb toward 180s+ under load the cap is too high or embed is thrashing.

## Phase 3 Single-flight / request coalescing (SHIPPED 2026-07-07, uncommitted)
Redis SETNX lock at `app/main.py::process_query_job` (job submit, BACKEND process). ONE leader
per (semantic-cache bucket + no-diacritics query) runs the graph + writes cache; followers poll
the cache and return the leader's answer. Optimization-only, fail-open. Coalesces what the Phase-2
cap cannot: DUPLICATE work.

- **Key:** `{ns}:{env}:sf:{bucket}:{eid_nd}` — `bucket=llm_cache._bucket_id(...)` (incl. sources +
  index_version) so it NEVER coalesces across documents and auto-invalidates on ingest/delete;
  `eid_nd` = no-diacritics normalized query so VN variants share a leader. `single_flight_key`
  returns None for unsafe (personal/realtime/action) queries → bypass.
- **Env (backend):** `SINGLE_FLIGHT_ENABLED`(true), `SINGLE_FLIGHT_LOCK_TTL_SECONDS`(180),
  `SINGLE_FLIGHT_WAIT_SECONDS`(120), `SINGLE_FLIGHT_POLL_INTERVAL_SECONDS`(0.5). Host-overridable
  in compose.
- **Observe:** `docker compose logs backend | grep singleflight` (leader_acquired /
  follower_waiting / follower_cache_hit / follower_timeout_fail_open / lock_release_* /
  redis_error_fail_open / bypass_unsafe). Metrics at `/stats` → `single_flight`
  (leader/follower/follower_hit/dup_avoided/timeout/fail_open/...). PER-WORKER counters.
- **Measured (10 identical COLD, cap=1):** 0/10 (no SF) → **10/10 success, 1 GenerateAnswer for
  10 requests, empty 0**, p50/p95 ~84s (= leader job time). See phase3-single-flight.md.
- **Fail-open matrix:** Redis down / lock error → bypass; leader crash → TTL frees lock, followers
  fail-open at wait timeout; empty cached answer → treated as miss; unsafe/follow-up → bypass.
  Single-flight can only optimize, never block or empty an answer.
- **Known tradeoff → Phase 4:** a waiting follower holds a per-worker query-semaphore slot for the
  leader's whole job (~84s). A big storm fills the ~8 admission slots → excess spills to HTTP 429.
  This is why Phase 4 (rate limit + `/ready` vs `/health` + circuit view) is next.
- **Diagnose "N identical still = N gens":** check `singleflight_disabled` (env off), Redis reachable
  (`redis_error_fail_open`), and that the questions land in the SAME bucket (different sources /
  category / language / memory-tree flag = different bucket = separate leaders, by design).

## Phase 4 Ingress overload protection (SHIPPED 2026-07-07, uncommitted)
Rate limit + readiness + polite shed in `app/main.py` (BACKEND). All fail-open, rate limit OFF
by default (opt-in for prod). Never touches the answer path / gateway cap / single-flight.

- **Rate limit (`/query`):** Redis token-bucket (Lua, atomic) `_rate_limit_check` before the
  admission semaphore. `RATE_LIMIT_RPS` refill, `RATE_LIMIT_BURST` cap, `RATE_LIMIT_WINDOW_SECONDS`
  key TTL, `RATE_LIMIT_SCOPE=ip|session`. Reject = 429 `{error:rate_limited,retry_after_seconds}`
  + Retry-After. Redis down -> allow (fail-open) unless `RATE_LIMIT_REQUIRE_REDIS=true`. NOT on /health.
- **`/health` vs `/ready`:** `/health` = liveness (200 if process up, never needs Redis, used by
  compose healthcheck). `/ready` = readiness: 200 ready, **503** with `{status,redis,llm_gateway,
  admission_available,reason}` when `graph_not_ready | admission_saturated | redis_required_down`.
  Put a load balancer in front that honours `/ready` so a saturated worker is pulled, not piled on.
- **Admission-full (`/query`, `/query-resume`):** structured 429 `{error:admission_rejected,
  retry_after_seconds}` + Retry-After (`ADMISSION_RETRY_AFTER_SECONDS`), logged + counted.
- **Env (backend, host-overridable):** RATE_LIMIT_ENABLED(false), RATE_LIMIT_RPS(1),
  RATE_LIMIT_BURST(5), RATE_LIMIT_WINDOW_SECONDS(60), RATE_LIMIT_SCOPE(ip),
  RATE_LIMIT_REQUIRE_REDIS(false), ADMISSION_RETRY_AFTER_SECONDS(5).
- **Observe:** `/stats.overload` (rate_limit_allowed/rejected/redis_error, admission_rejected,
  admission_available, admission_capacity, rate_limit_enabled). Logs: `docker compose logs backend |
  grep -E 'overload|readiness'` (rate_limit_*/admission_rejected/overload_response_sent/readiness_*).
- **Measured (cold identical, cap=1, rate limit OFF):** 10 conc 10/10; **50 conc 50/50 success,
  empty 0, 1 LLM gen, 341 structured admission-429 shed+retried**, p50 3s / p95 70s. No collapse
  (Phase 1 was 0/10 at 10 conc). See phase4-overload-protection.md.
- **Prod recommendation:** `MAX_CONCURRENT_LLM_CALLS=1` + `SINGLE_FLIGHT_ENABLED=true` +
  `RATE_LIMIT_ENABLED=true` behind a `/ready`-aware LB. LLM busy/timeout counts still live in the
  gateway logs (`llm_semaphore_timeout`) — cross-process metric aggregation is future work.

## Phase 5 RQ worker (STEP 1 = ingest only, SHIPPED 2026-07-08, uncommitted, flag OFF)
Heavy background jobs move off the web process into an RQ worker so bge-m3 embed + LLM stop
competing with interactive /query for the one CPU. RQ = transport; `jobs.sqlite` stays the status
store (FE polling unchanged). All behind `QUEUE_ENABLED` (default OFF = today's daemon threads).

- **Enable (opt-in):** `QUEUE_ENABLED=true docker compose --profile worker up -d --build`. The
  `rq-worker` service is `profiles:[worker]` so a plain `docker compose up` does NOT start it and
  the backend never depends on it. Turn off = drop QUEUE_ENABLED (falls back to in-process threads).
- **Shared DB (critical):** web + worker MUST share one job/log DB. `JOBS_DB_PATH` +`LOG_DB_PATH`
  default to `/app/memory/*` (the shared bind-mount). If unset -> legacy `/app` path (single-process
  dev/tests only). WAL + busy_timeout=5000 set for cross-process writers. If cross-container SQLite
  locking misbehaves on the bind mount -> escalate job STATUS to Redis (documented fallback).
- **Worker:** `python -m app.jobs.worker` = RQ **SimpleWorker (no fork)** so bge-m3 stays warm
  across jobs. `WORKER_CONCURRENCY=1` (CPU serial; 2 heavy jobs = Phase-1 thrash). LLM still
  funnels through the Phase-2 gateway cap.
- **What is queued:** INGEST (Step 1) + SUMMARY (Step 2), on queues `ingest` / `summary`; worker
  listens on both. `/query`,`/query-resume`,mindmap still run in-process. `enqueue_job()`
  (app/jobs/queue.py) is the one switch; on enqueue failure it falls back to a thread so work never
  breaks. `/stats.queue` shows per-queue `{queued,started,failed}` + aggregate totals. (Step 2 smoke
  2026-07-08: summary enqueued to `summary`, worker ran → done, result in store, /query unaffected.)
- **Orphan reconciliation:** `reconcile_interrupted()` (SIGTERM + startup). Flag off = mark all
  active interrupted. Flag on = only mark jobs ABSENT from RQ queued/started/deferred registries
  (a live worker job is preserved); RQ down = touch nothing. Prevents a backend restart from
  killing a live worker job.
- **Observe:** `/stats.queue` = {queued/started/failed/worker_count/oldest_queued_age, enabled}.
  `/ready` returns 503 `queue_full` when `queued > QUEUE_DEPTH_MAX` (queue mode only) — for LB
  backoff; does NOT gate /query. Logs: `docker compose logs | grep queue` (enqueue_*/reconcile_*).
- **Diagnose:** ingest stuck pending + `QUEUE_ENABLED=true` -> is `rq-worker` running
  (`docker compose --profile worker ps`)? Redis reachable? worker + backend on the SAME
  `JOBS_DB_PATH`? `queue enqueue_failed_fallback_thread` in logs = RQ enqueue failed (ran as thread).
- **Docker smoke VERIFIED 2026-07-08:** worker ran a real ingest (`Job OK`), status FE-visible via
  the shared `/app/memory/jobs.sqlite` (same inode both containers), startup reconcile preserved the
  live job (`live=1 active=1 interrupted=0`), 0 SQLite lock errors, concurrent /query stayed 202→done
  (non-empty). Cross-container SQLite locking held — no Redis-status fallback needed yet.

## Related
- [[High Concurrency Backend Design Skill]] · [[DR-3 - Concurrency Control Architecture]]
- [[Semantic Cache Redis Playbook]] · [[Semantic Cache Fallback Contract Skill]]
- .playbook/known-issues.md · docs/SEMANTIC_CACHE_SPEC.md
- reports/performance/phase2-gateway-semaphore.md · phase3-single-flight.md · phase4-overload-protection.md
