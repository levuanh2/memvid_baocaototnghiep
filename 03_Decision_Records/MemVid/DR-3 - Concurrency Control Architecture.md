# DR-3: Concurrency Control Architecture

## Status
Proposed 2026-07-07. **D2 IMPLEMENTED 2026-07-07** (gateway semaphore, uncommitted) exactly as
decided — see reports/performance/phase2-gateway-semaphore.md + the Playbook "Phase 2 Gateway
Semaphore" section. Empirical addendum: on this single-CPU Ollama box the measured optimum is
`MAX_CONCURRENT_LLM_CALLS=1`, not 2 (cap=2 already thrashes: gens stretch to ~248s, 6/10 success;
cap=1: gens 29–148s, 9/10). Keep default 2 for multi-core/GPU; set 1 on single-CPU deployments.
Overflow returns gRPC `RESOURCE_EXHAUSTED` (the "busy signal" of D2). D1/D3/D4/D5/D6 still Proposed.

## Context
MemVid must serve many concurrent requests. Every LLM call (answer, semantic-cache judge,
LLM-rerank, summary, mindmap enrich/relations) routes through ONE Ollama running qwen3.5:9b
on host CPU. CPU generation is ~30–40s and effectively serial: 2–3 concurrent gens already
thrash, more collapses latency. Current controls: per-gunicorn-worker
`threading.Semaphore(4)` (workers do not coordinate) and an 8-thread gRPC gateway — i.e. the
funnel toward the CPU is WIDER than the CPU can serve. No single-flight, no ingress rate limit.

## Decisions

### D1 — Keep sync Flask + background threads. Do NOT migrate to async/ASGI.
The bottleneck is CPU-bound generation, not I/O concurrency. Async would force rewriting the
entire request/job model (blocking Ollama, blocking bge-m3 embed, blocking FAISS all stay
blocking) for zero throughput gain. Rejected as over-engineering.

### D2 — Global LLM concurrency gate lives in the llm-gateway, not in main.py.
All LLM traffic already funnels through the single-process gateway → it is the one place a
`BoundedSemaphore(MAX_CONCURRENT_LLM_CALLS)` (default 2) actually bounds GLOBAL concurrency.
The per-worker semaphore in main.py cannot (2 workers × 4 ≠ coordinated). Overflow waits a
bounded time, then returns a busy signal the caller already degrades on (timeout→fallback).
Limiter only: never changes answer correctness.

### D3 — Single-flight via Redis SETNX at job submission (main.py), not inside the graph.
Coalesce identical concurrent questions BEFORE any embed/retrieve/LLM work. Lock key =
existing `cache_key`. Winner generates and writes cache; losers wait bounded then read the
winner's cached answer; on wait-timeout or lock-backend-down → proceed normally. Fail-open,
same invariant as the cache: it can only optimize, never block or empty an answer.

> **IMPLEMENTED 2026-07-07 (uncommitted) — one refinement vs the decision.** The lock key is NOT
> the literal `cache_key`; it is a dedicated `{ns}:{env}:sf:{bucket}:{eid_nodiacritics}`
> (`llm_cache.single_flight_key`). Rationale: keying by the exact `cache_key` would NOT coalesce
> Vietnamese diacritic variants (different exact keys). Using the semantic-cache **bucket** (which
> already hashes sources + index_version → still no cross-document coalescing) plus the
> **no-diacritics** normalized query coalesces the variants onto one leader; followers then read
> the answer back via the existing exact→alias→cosine→judge cache path, so homograph safety is
> preserved. Everything else matches D3 (SETNX at submit, bounded follower wait, fail-open,
> TTL-guarded, unsafe/follow-up bypassed). Measured: 10 identical cold → 1 generation, 10/10, empty 0.
> See reports/performance/phase3-single-flight.md.

### D4 — Keep the sync `redis-py` client. No async Redis.
Consistent with D1. Redis ops are sub-ms with 0.5s fail-open timeouts; not the bottleneck.

### D5 — Queue library: RQ, not Celery.
Redis is already in the stack; jobs are simple fire-and-forget with SQLite status. RQ is a
few lines and one worker process. Celery's broker/beat/routing is unused weight (YAGNI).
Purpose of the queue is ISOLATION (heavy ingest/mindmap/summary embed+LLM off the query CPU
path) + durability, not fan-out — a queue does not add throughput against one CPU.

### D6 — Cache order unchanged: exact → no-diacritics alias → semantic (DR-2). Do not lower
threshold to chase hit-rate.

## Consequences
- Throughput is explicitly bounded by `MAX_CONCURRENT_LLM_CALLS`; extra load queues/sheds
  gracefully instead of thrashing. Widening the funnel (more gateway/gunicorn workers) is now
  a KNOWN anti-move, documented.
- Repeated/paraphrased-question storms cost ~1 generation, not N.
- Heavy jobs stop starving interactive queries once moved to the RQ worker (Phase 5).
- New env knobs: MAX_CONCURRENT_LLM_CALLS, SINGLE_FLIGHT_ENABLED, SINGLE_FLIGHT_WAIT_SEC,
  RATE_LIMIT_ENABLED, QUEUE_ENABLED, WORKER_CONCURRENCY, LLM_GATEWAY_MAX_WORKERS.

## Alternatives rejected
- Async/ASGI rewrite (D1). Bigger gateway/worker pools (worsens thrash). Celery (D5).
  In-process global lock in main.py (doesn't cross workers). Client-side async Redis (D4).

## Related
- 00_Active_Plans/MemVid - Active Plan.md (v4)
- 01_Project_Playbooks/MemVid/High Concurrency Request Handling Playbook.md
- 04_General_Skills/High Concurrency Backend Design Skill.md
- [[DR-2 - Semantic Cache Threshold Policy]]
