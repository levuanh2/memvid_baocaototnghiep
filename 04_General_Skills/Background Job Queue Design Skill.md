# Skill: Background Job Queue Design (heavy work off the web process)

## Purpose
Move heavy, non-interactive work (ingest/embed, batch LLM, document processing) out of the web
process into a durable worker — without rewriting the app, without breaking the client polling
contract, and with a reversible on/off switch.

## When to use
A monolith web app runs long CPU/LLM jobs in request threads, and those jobs starve the
interactive path (queries, page loads) by competing for the same scarce resource (a CPU-bound
model, a GPU, a single DB). You want isolation, not necessarily parallelism.

## Core principle
The queue's job is **isolation and durability**, not throughput. If one serial resource (a model
on CPU) is the ceiling, the worker runs concurrency=1 — the win is that heavy work no longer
shares the web process with interactive requests. Keep the interactive, low-latency path
in-process; queue only the heavy, tolerant-of-latency jobs.

## Procedure
1. **Split by latency tolerance, not by "background".** Interactive request/response with a
   client waiting (or streaming) → STAYS in-process. Heavy, fire-and-poll jobs → queue. Do not
   queue the interactive path just because you now have a queue.
2. **One switch point.** A single `enqueue_job(fn, args, queue, job_id)`:
   - flag OFF → today's thread (`threading.Thread(daemon=True)`), byte-for-byte unchanged;
   - flag ON → `queue.enqueue(fn by dotted path, job_id, timeouts, ttls)`;
   - enqueue raises → fall back to a thread (fail-safe: submits keep working if the broker is down).
   Minimal diff per call site, reversible, testable for flag parity.
3. **Transport ≠ state.** Keep job STATUS/result in the store the client already polls
   (a jobs table/DB). The queue only carries "run this fn". Then the client contract is identical
   whether the job ran in a thread or a worker — zero client changes.
4. **Runner must be process-portable.** The job function is module-level (importable by dotted
   path), takes plain serialisable args, and needs NO web request context. It sets
   status=running, does the work, and writes the terminal status+result ATOMICALLY (never
   "done" in one layer, result in another — a fast poll hits the gap and sees an empty done).
5. **Keep the model warm.** Use a non-forking worker (RQ SimpleWorker) so a multi-GB model
   loaded once stays resident across jobs. A forking worker reloads it per job = killer.
6. **Shared state on shared storage.** If web and worker are separate containers, the status DB
   and all result artifacts MUST be on a shared volume (and SQLite needs WAL + busy_timeout for
   cross-process writes), or the worker writes its own copy the client never sees.
7. **Restart safety (orphan reconciliation).** On startup/shutdown, "mark running jobs
   interrupted" must be registry-aware once a separate worker exists: only mark jobs the broker
   no longer knows (absent from queued/started/deferred registries). If the broker is
   unreachable, touch nothing (fail safe). Otherwise a web restart wrongly kills the worker's
   live job.
8. **Observe + protect.** Expose per-queue depth (queued/started/failed, oldest-age, worker
   count). Gate NEW heavy submissions with a `queue_full` 503 when depth exceeds a max — but
   never gate the interactive path on heavy-job backlog. Emit structured lifecycle logs
   (enqueue / running / done / failed / fallback).
9. **Timeouts + retries per type.** Generous job_timeout (minutes). Retry 0–1 only for
   idempotent jobs (content-hash cache makes re-runs cheap); don't blind-retry expensive
   LLM/embed failures (rarely transient). Set result/failure TTLs so registries self-clean.
10. **Roll out behind a flag, default OFF.** Ship the plumbing dark, verify with a smoke
    (real worker, real job, client sees status, interactive path unaffected, no lock storm,
    reconcile preserves live jobs), then enable per environment.

## Status models are per-job, not one-size
Not every job needs a status row. Three shapes, all valid — match the job's existing contract:
- **Polled job** (client waits on progress/result) → shared status store, keyed by job_id.
- **Fire-and-forget** (result lands in a domain store the client reads elsewhere; nobody polls the
  JOB) → no per-job row. Enqueue with job_id absent so the broker auto-ids it, and orphan
  reconciliation (which scans your status store) naturally ignores it. Keep failures logged, not
  persisted, if that was the thread-era contract.
- **Legacy per-process store** (an in-memory dict that worked when the job ran in the web process) →
  the moment the job moves to a separate worker process, that dict is invisible to the status
  endpoint. Migrate status to the shared store. When you do, **preserve the exact field defaults**:
  if the old dict returned `0/0` on a fresh job, the new store-backed endpoint must coalesce
  absent-result fields to `0`, not leak `null` — a silent contract drift that fires even with the
  flag OFF. (A parallel reviewer caught exactly this; unit tests asserting the pre-migration
  response shape catch it too.)

## Anti-patterns
- Queuing the interactive/streaming path "for consistency" → adds latency, loses SSE.
- Putting job status in the broker only → client must learn a new contract; keep it in the
  store the client already polls.
- Forking worker with a big model → reloads per job.
- Widening the funnel (more workers) to "go faster" when one serial resource is the ceiling →
  just piles more onto the same wall.
- Non-atomic terminal write → the classic "done but empty" race under fast polling.

## Signals it's working
Flag-off path identical to before (parity tests). Flag-on: heavy job runs in the worker, client
polls the same endpoint and sees running→done+result, the interactive path stays responsive and
non-empty while jobs run, zero DB lock errors, and a web restart does not kill live worker jobs.

## Related
[[High Concurrency Backend Design Skill]] · [[RQ Worker Playbook]] · MemVid Phase 5 (RQ:
ingest+summary+mindmap, PR #2). Companion to the "find the ONE serial bottleneck" skill — this
one keeps heavy work from sharing the web process with the requests fighting for that bottleneck.
