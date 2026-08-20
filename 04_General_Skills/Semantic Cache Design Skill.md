# Skill: Semantic Cache Design

## Purpose
Design LLM answer caches that raise hit rate without false hits or poisoning.

## When To Use
Any system caching LLM responses keyed by natural-language queries (RAG chat, FAQ bots, doc Q&A).

## Inputs Needed
- The embedding encoder actually used (not assumed) and sample real query pairs.
- What conditions make an answer valid (document set, prompt version, index state, language).
- Which queries are unsafe to cache (personal, realtime, destructive).

## Procedure
1. Encode ALL validity conditions into the key/bucket (context hash), never into similarity: different context must be a different bucket, so entries can never see each other. Index mtime works as a cheap global version → auto-invalidation on data change.
2. Layer lookups cheapest-first: exact match on normalized text (O(1), no embedding) → orthography aliases (diacritics/case/punctuation variants) → embedding similarity last.
3. CALIBRATE before trusting cosine: measure real positive AND negative pairs on your encoder. If distributions overlap, a pure threshold cannot separate paraphrases — accept exact/near-dup only, or add an intent judge.
4. Guard the ambiguous band with a cheap LLM judge (strict JSON: same_intent + safe_to_reuse; any error → miss). Judge sees text, so it catches what embeddings miss (negation, homographs, intent shifts).
5. Fail direction always = miss/bypass. Cache failure must cost one extra LLM call, never a wrong answer or an outage (fail-open Redis client, timeouts, unavailable-window).
6. Risk-classify before WRITE (deny personal/realtime/destructive); denied queries then never hit (nothing stored).
7. Log every decision with a reason (hit kind + sim, miss reason, bypass reason) and count per-outcome metrics — tuning is impossible without them.

## Guardrails
- Never verify orthography-variant matches with embedding cosine before measuring: same-meaning cross-form pairs can score LOW while different-meaning near-identical strings score HIGH (inverted guard).
- Never lower the similarity threshold to buy hit rate; widen coverage with normalization/aliases/judge instead.
- Multi-turn answers depend on history: cache only context-free (standalone) questions, and generate those answers without history so stored ≡ served.
- Never cache secrets/private data; TTL is the floor, key rotation (context version) is the real invalidation.

## Quality Checklist
- Repeat question hits in O(1) without embedding.
- Cache off/down → system behavior identical (slower only).
- Every miss explains itself in one log line.
- Threshold decisions backed by measured pair table, written down (decision record).

## Failure Modes
- Generic questions ("what is this doc about") reused across documents — context not in key.
- Judge called on every request (cost explosion) — must be band-limited.
- Per-worker metrics mistaken for global (multi-process servers).
- Stale entries after data change — missing version component in bucket.

## Related Project Playbooks
- MemVid: [[Semantic Cache Redis Playbook]]

## Source Sessions
- 02_Session_Logs/MemVid/2026-07-06 - Session Log
