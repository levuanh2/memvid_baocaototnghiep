# Skill: Semantic Cache Fallback Contract

## Purpose
Guarantee an LLM-response cache can never degrade the product: no empty answers, no blocked pipeline, no poisoned entries.

## When To Use
Any async-job system with a response cache in front of expensive generation (LLM, RAG, rendering).

## Inputs Needed
- Where lookup, write, and generation happen (may be different layers/processes).
- How job status and job result reach the client (same write? separate writes?).

## Procedure
1. Enumerate every path a client-visible answer can be empty: hit on empty entry, write of empty answer, lookup exception routed to error, diagnostic/fallback text cached as real answer, AND terminal-status written before result.
2. Enforce at BOTH ends: lookup serves only entries with non-empty answers (every hit path); writes reject empty/whitespace/diagnostic answers (every write path — L1, L2, finalizer). Belt and suspenders: layers drift independently.
3. Lookup/judge/classifier exceptions must degrade to MISS, never to an error state that terminates the request.
4. Flag non-answers (timeouts, "model returned nothing" messages) at generation time (e.g. gen_fallback) and exclude them from caching like any other fallback.
5. Job terminal status must be written atomically WITH the result payload. Setting "done" in one layer and attaching the result in another creates a race window; fast (cached) responses make that window observable to pollers.
6. Prove with a live smoke that asserts non-empty answers for: fresh, exact repeat, variant forms, unsafe query, and (if possible) cache-backend failure.

## Guardrails
- Symptom "fast responses broken, slow responses fine" = suspect status/result race BEFORE suspecting cache logic; correlation with latency is the tell.
- Never assert success from unit tests alone — the race only shows under real polling cadence.
- Reproduce with evidence before fixing; if the trigger is historic and evidence is gone, close every contract hole instead of guessing one.

## Quality Checklist
- Grep test: no code path can mark a job done without its result attached.
- Every miss/bypass/skip logs a reason; empty-entry hits count in metrics.
- Smoke passes with all answers non-empty at cache-hit speed.

## Failure Modes
- Fixing only the write side: legacy poisoned entries still served (lookup validation is the backstop).
- Treating lookup exceptions as request errors (cache outage = product outage).
- Caching apologetic fallback text as a real answer — repeats forever until TTL.

## Related Project Playbooks
- MemVid: [[Semantic Cache Redis Playbook]]

## Source Sessions
- 02_Session_Logs/MemVid/2026-07-06 - Session Log (empty-answer bug: done-before-result race, reproduced 3/3, fixed, smoke 6/6)
