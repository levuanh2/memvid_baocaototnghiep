# Playbook: RQ Worker (Phase 5 — Queue Heavy Jobs)

## Project
MemVid

## Status
Steps 1-3 MERGED TO MAIN 2026-07-08 — PR #2 `1241cca` (ingest `1f7da5f` + summary `4047f06`
+ mindmap `24bd937`). **Step 4 (rebuild-index + memory-tree) IMPLEMENTED, uncommitted** on branch
`feat/phase5-step4-rebuild-memory-rq` — queues now **ingest, summary, mindmap, rebuild, memory**.
Default OFF. See [[High Concurrency Request Handling Playbook]], [[Background Job Queue Design Skill]], DR-3.

## Purpose
Move heavy, non-interactive background jobs (ingest, summary, mindmap, rebuild-index, memory-tree)
off the web (gunicorn) process into a separate RQ worker so their bge-m3 embed + LLM stop competing
for the one CPU with interactive `/query`. RQ is TRANSPORT only; `jobs.sqlite` stays the STATUS/result
store so the FE polling contract is unchanged. Feature-flagged (`QUEUE_ENABLED`, default OFF) = reversible.

## Mental model (read first)
- `/query` + `/query-resume` stay IN-PROCESS (interactive, low-latency, SSE token buffer reads
  jobs.sqlite live, already bounded by admission + gateway cap + single-flight). NEVER queue them.
- Heavy jobs are the ones worth queuing: ingest (parse+chunk+bge-m3+FAISS), summary (section
  embed + N LLM), mindmap (skeleton + enrich/relations LLM). One CPU serves ~1–2 gens → the
  worker runs concurrency=1; the win is *isolating* heavy work from the interactive path, not
  parallelism.
- Flag OFF = today's daemon-thread behaviour, byte-for-byte. Flag ON = same code path, different
  dispatcher (RQ). The switch is one function: `enqueue_job`.

## Architecture
```
POST /upload* /generate-summary /generate-mindmap
→ create_job(status="pending") in jobs.sqlite (shared volume)
→ enqueue_job(fn, args, queue=<ingest|summary|mindmap>, job_id)
     QUEUE_ENABLED=false → threading.Thread(daemon) [today]
     QUEUE_ENABLED=true  → rq.Queue(name).enqueue(fn by dotted path, job_id, timeouts, ttls)
     enqueue raises      → thread fallback (fail-safe: uploads work even if Redis/RQ down)
→ (RQ) SimpleWorker picks job from its queue → runs module-level fn in worker process
→ fn: update_job(status="running") → LangGraph invoke → graph writes done+result ATOMICALLY
→ FE polls /<type>-status → {status,progress,current_node,result,error} from jobs.sqlite
```

### Key files
- `BE/app/jobs/queue.py` — `enqueue_job` (the switch), `QUEUE_NAMES=(ingest,summary,mindmap,rebuild,
  memory)`, `queue_stats` (per-queue + aggregate), `reconcile_interrupted` (registry-aware), `_live_job_ids`.
- `BE/app/jobs/worker.py` — `python -m app.jobs.worker` = **SimpleWorker** (no fork → bge-m3 stays
  warm), listens on `RQ_QUEUES` (default = all 5). Compose does NOT pin RQ_QUEUES → uses this default.
- `BE/app/main.py` — module-level, Flask-context-free runners enqueued by dotted path:
  `_run_ingest_job` / `run_summary_job` / `run_mindmap_job` / `run_rebuild_index_job` /
  `run_memory_tree_job`; dispatchers `_trigger_background_ingest` / `_start_summary_job` /
  `_start_mindmap_job` / `/rebuild-index` route / `_trigger_memory_tree_build` call `enqueue_job`.
  `/stats.queue`, `/ready` queue-depth.

### Per-job status model (differs by job)
- **ingest / summary / mindmap / rebuild** — status in shared `jobs.sqlite` (job_type column), polled
  by `/<type>-status`. Rebuild ALSO keeps a legacy per-process in-mem `jobs` dict; `/rebuild-status`
  reads jobs.sqlite first, dict fallback (num_chunks/num_videos live in the sqlite `result`, coalesced
  to 0 before the first write to preserve the pre-Step-4 contract).
- **memory-tree** — FIRE-AND-FORGET, no per-job status row (result → `memory_trees.json`, surfaced by
  `/memory-tree-status`). Enqueued with job_id=None (RQ auto-id) → reconcile (scans jobs.sqlite rows
  only) never touches it. Failures are logged, not persisted (matches the pre-Step-4 thread contract).
- `docker-compose.yml` — `rq-worker` service under `profiles: [worker]` (NOT started by default;
  backend does not depend on it). Same image/env/volumes as backend.

## Runtime config
| Mode | Command |
|------|---------|
| Default (safe, unchanged) | `docker compose up -d` → QUEUE_ENABLED off, no worker, thread path |
| Prod high-concurrency | `QUEUE_ENABLED=true MAX_CONCURRENT_LLM_CALLS=1 SINGLE_FLIGHT_ENABLED=true docker compose --profile worker up -d` behind a /ready-aware LB |

Env: `QUEUE_ENABLED`(false) · `WORKER_CONCURRENCY`(1) · `RQ_QUEUES` · `RQ_JOB_TIMEOUT_SEC`(1800)
· `QUEUE_DEPTH_MAX` · `JOBS_DB_PATH`/`LOG_DB_PATH` (shared-volume paths, WAL + busy_timeout).

## Operate / diagnose
- **Worker alive?** `docker compose logs rq-worker | grep "Listening on"` → expect
  `ingest, summary, mindmap`. `/stats.queue` → `worker_count>=1`.
- **Job stuck queued?** `worker_count=0` (no consumer) OR worker crashed. Check worker logs;
  if flag on, a worker MUST be running.
- **Depth / backlog:** `/stats.queue` per-queue `queued/started/failed` + `oldest_queued_age_sec`.
  `/ready` returns 503 `queue_full` when `queued > QUEUE_DEPTH_MAX` (heavy-submit routes only;
  does NOT gate `/query`).
- **Job lifecycle logs (grep):** `<type>_enqueue_rq` / `_enqueue_thread` / `_queue_fallback_thread`
  (dispatch); `<type>_job_running` / `_job_done` / `_job_failed` (worker); `queue enqueue_*`,
  `reconcile_*`.
- **Reconcile on restart:** flag off = mark ALL active interrupted (legacy); flag on =
  registry-aware, only mark jobs absent from RQ queued/started/deferred registries; RQ unreachable
  = touch nothing. A backend restart does NOT kill a live worker job.

## Verified (smoke, QUEUE_ENABLED=true, cap=1)
All 3 job types: enqueue_rq → worker runs module-level fn → running→done → `Job OK`, FE-visible via
`/<type>-status`. Concurrent `/query` = 202 in-process, non-empty answer, NOT queued. 0 SQLite lock
errors (WAL+busy_timeout over bind mount). Reconcile `live=N active=N interrupted=0`.

## Gotchas / invariants
- **SimpleWorker, not forking Worker** — forking reloads ~2GB bge-m3 every job (killer).
- **Job done atomic with result** — the graph writes both in one update; never set done in one
  layer and attach result in another (see cache empty-answer race, known-issues).
- **Shared volumes** — jobs.sqlite/logs.sqlite MUST be on the shared `/app/memory` volume
  (JOBS_DB_PATH/LOG_DB_PATH) or the worker writes its own DB and FE never sees status.
- **RQ forking Worker doesn't run on Windows** — SimpleWorker does; dev runs Docker/Linux anyway.
- **Worker must reach** llm-gateway + mindmap-service (same env/network as backend).
- **Do NOT queue `/query`** — interactive, has SSE + cap + single-flight.

## Known risks
1. `QUEUE_ENABLED=true` with NO worker → jobs queued forever. Always start `--profile worker`
   when the flag is on. Future: `/ready` degrade when `worker_count=0`.
2. SQLite cross-container status held under smoke; escalate to Redis/Postgres status only if
   write contention grows (Active Plan item 4B).

## Status: Phase 5 COMPLETE (pending Step 4 commit/merge)
All heavy jobs (ingest, summary, mindmap, rebuild-index, memory-tree) route through RQ behind
`QUEUE_ENABLED`. `/query` + `/query-resume` stay in-process permanently. Step 4 verified: worker
listens on all 5 queues; rebuild + memory execute in the worker; /query in-process; 0 SQLite locks;
reconcile preserves live jobs. Only remaining Phase 5 action = commit + merge Step 4.

### Diagnosing rebuild-index failures
`[REBUILD] reconstructed chunks=0 decoded=N used=0` → QR video frames decode but no chunk text
reconstructed. In headless containers this is the known opencv QR-decode limitation (see
known-issues "Video QR ghi 0 frame"), NOT a queue bug — the job correctly surfaces status=error via
`/rebuild-status`. Real rebuild needs decodable QR videos on the shared `videos/` volume.
