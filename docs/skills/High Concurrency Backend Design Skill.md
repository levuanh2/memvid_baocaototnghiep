# Skill: High Concurrency Backend Design (LLM/RAG systems)

## Purpose
Design a backend that serves many concurrent requests fast, safely, cheaply — especially when
a single expensive resource (an LLM on CPU/GPU) is the real ceiling.

## When to use
Any RAG/LLM service facing concurrent load where generation dominates latency and cost.

## Core principle
Find the ONE serial bottleneck (usually the model) and design around it, not against it.
Concurrency controls upstream of the bottleneck do not add throughput — they only decide how
much you pile onto it. Bound the pile; coalesce duplicate work; shed the rest gracefully.

## Procedure
1. **Trace to the wall.** Follow one request end to end and find where it serializes
   (model host, GPU, single DB). Everything else is secondary. Measure it before tuning.
2. **Bound concurrency AT the wall, in ONE place.** A single global semaphore where all
   traffic already funnels (a gateway process) beats N uncoordinated per-worker limits.
   Default it low for CPU inference (1–2). Overflow: bounded wait, then a busy signal callers
   already degrade on.
3. **Coalesce identical work (single-flight) BEFORE spending on it.** Lock on the cache key at
   admission; winner computes + caches; losers wait bounded then read the result. Fail-open:
   miss or lock-backend-down → proceed normally. Never let it block or empty an answer.
4. **Cache is optimization only.** Miss / bypass / backend error / empty entry always falls
   back to real compute. (See Semantic Cache Fallback Contract Skill.)
5. **Do not widen the funnel to "scale".** More workers/threads upstream of a CPU model make
   p95 worse. Scale the model (quantize, GPU, replicas) or the cap — not the intake.
6. **Move heavy, non-interactive work off the hot path** to a worker/queue so it stops
   competing for the bottleneck with interactive requests. The queue buys isolation +
   durability, not throughput against one device.
7. **Match the client library to the model.** Don't rewrite sync→async when the bottleneck is
   CPU/GPU compute; async only helps I/O-bound fan-out. Rewriting for no I/O gain is
   over-engineering.
8. **Shed, don't stall.** Admission limits + rate limit + circuit view; return honest 429/503
   with retry guidance instead of unbounded queuing.
9. **Terminal job status must be atomic with its result.** Fast (cached) responses expose any
   done-before-result race to pollers.

## Guardrails
- Symptom "adding workers didn't help / made it worse" = you widened the funnel; add a cap instead.
- Symptom "N identical requests = N generations" = missing/placed-too-deep single-flight.
- Any retry loop (quality retry, empty-answer re-gen) is a load amplifier under stress — cap it
  and confirm it can't runaway.
- Prove behavior with a concurrent load test (10/50/100…), not unit tests — contention only
  shows under real cadence.

## Decision defaults
- Sync stack + CPU model → keep sync; add a global cap + single-flight; RQ (if Redis present)
  for heavy jobs. Async/Celery only when a real need is demonstrated.
- Global cap in the shared gateway process; single-flight at request admission on the cache key.

## Failure modes
- Per-worker limits mistaken for a global cap (don't coordinate across processes).
- Single-flight inside the deep pipeline → duplicate embed/retrieve already paid before the lock.
- Caching fallback/timeout text as a real answer → poisons every equivalent question.
- Async rewrite chasing throughput on a compute-bound bottleneck → cost, no gain.

## Related project playbooks
- MemVid: [[High Concurrency Request Handling Playbook]]
- MemVid: [[Semantic Cache Redis Playbook]]

## Related decisions
- MemVid: [[DR-3 - Concurrency Control Architecture]]

## Related general skills
- [[Semantic Cache Fallback Contract Skill]] · [[Semantic Cache Design Skill]]
