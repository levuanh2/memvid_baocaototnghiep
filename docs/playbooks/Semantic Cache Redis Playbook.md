# Playbook: Semantic Cache Redis

## Project
MemVid

## Purpose
Operate, debug, and tune the 3-tier Redis LLM cache (semantic response + retrieval).

## When To Use
Cache not hitting, EMPTY or stale answers, tuning threshold/TTL, cache-adjacent features.

## Preconditions
- Docker stack up (`docker compose ps` — redis healthy) OR local dev (REDIS_URL empty = cache silently off, by design).

## Steps
1. Read docs/SEMANTIC_CACHE_SPEC.md — calibration tables explain thresholds.
2. Check config: CACHE_ENABLED, SEMANTIC_CACHE_ENABLED, REDIS_URL, SEMANTIC_CACHE_THRESHOLD (0.85), SEMANTIC_CACHE_JUDGE_ENABLED (1), TTLs (48h/1h). BE/.env.example section SESSION & CACHE.
3. Hit path order: exact (normalized) → no-diacritics alias (judge-gated) → semantic scan (≥0.88 direct; [0.80,0.88) judge; else miss). Every hit requires non-empty cached answer.
4. Debug: `docker compose logs backend | Select-String "event="` — one line per decision with reason (below_threshold+best_sim, judge_denied, empty_bucket, risk_*, empty_cached_answer, write_skipped_empty_answer, cache_error_fallback_to_llm).
5. Metrics: GET /stats key "cache". CAVEAT: per-gunicorn-worker; /stats samples ONE worker — logs are ground truth.
6. Smoke: `python BE/scripts/smoke_semantic_cache.py` — 6 checks incl. non-empty answers at hit speed.

## Debugging "empty answer / Không có phản hồi"
- FIRST check latency correlation: fast responses empty + slow responses fine = poll race, NOT cache logic. Root cause 2026-07-06: status="done" written before result → fixed, done now atomic with result in _finalize_query_job. Never reintroduce _set_job(status="done") inside graph nodes.
- Then check for poisoned entries: scan Redis entries for empty payload.answer (in-container script in session log 2026-07-06). Lookup now refuses empty entries anyway (_answer_ok).
- gen_fallback: diagnostic "Không nhận được phản hồi từ model..." answers are flagged and never cached.

## Commands
- `docker compose build backend; docker compose up -d --force-recreate backend` — deploy (code baked in image)
- `cd BE; python -m pytest tests/test_llm_cache.py -q` — 31 tests (global python)
- Redis entry scan / cosine probe: `docker compose exec backend python -c ...`

## Files / Paths
- BE/app/domains/cache/llm_cache.py — all cache logic (+_answer_ok guard)
- BE/app/clients/redis_client.py — fail-open connection
- BE/app/main.py::_get_cached_query/_set_cached_query/_finalize_query_job
- BE/app/graphs/query_graph.py::cache_lookup_node (fall-through on exception), finalize_node (no status=done), generate_answer_node (gen_fallback)
- BE/scripts/smoke_semantic_cache.py

## Common Errors
- Follow-up questions bypass by design (DR-1); only standalone cached.
- No-diacritics miss: check judge log (nodia_judge_denied).
- All misses silently: REDIS_URL empty / Redis down (fail-open).
- Entries survive restart: Redis container separate, TTL 48h; invalidate_all() or re-ingest rotates bucket.

## Verification
Smoke 6/6 PASS; log kinds exact / exact_nodia / semantic / semantic_judged appear; no empty answers at any speed.

## Related Decisions
- [[DR-1 - Standalone-question caching in multi-turn]] · [[DR-2 - Semantic Cache Threshold Policy]]

## Related General Skills
- [[Semantic Cache Design Skill]] · [[Semantic Cache Fallback Contract Skill]]
