# DR-1: Standalone-question caching in multi-turn

## Status
Accepted (2026-07-06)

## Context
Semantic cache never hit in real chat: `cache_lookup_node` bypassed ALL queries once `conversation_history` was non-empty (FE keeps session_id → history exists from message 2 onward). Repeated identical questions regenerated every time. Root tension: answer prompt injects history, so caching multi-turn answers risks context poisoning.

## Decision
Bypass cache only for FOLLOW-UP questions. Standalone questions (heuristic `llm_cache.is_standalone_question`) keep their cache_key, AND `generate_answer_node` drops history from the prompt whenever cache_key is set — making the stored answer context-free by construction.

## Why
- Same-session repeats of self-contained questions are the dominant real-world cache opportunity.
- Dropping history for standalone questions makes lookup and store consistent: cached answer was never influenced by any conversation context, so serving it in any session is safe.
- Heuristic is conservative (doubt → follow-up): misclassifying standalone as follow-up only costs a cache miss; the reverse would cost answer quality — asymmetry favors bypass.

## Alternatives Considered
- Lookup-only for standalone (store still disabled): safe but cache only fills from first-message queries — barely improves hit rate.
- LLM-based standalone classification: accurate but adds an LLM call to every query — defeats the latency purpose.
- Hash history into cache key: keys almost never repeat — useless.

## Consequences
- Standalone questions in mid-conversation now answer WITHOUT history context (acceptable by definition of standalone; heuristic errs toward keeping history).
- Regex heuristic is tunable; upgrade path to LLM classification noted with `ponytail:` comment if measured hit rate too low.
- New metric `standalone_with_history` for observability.

## Related Files
- BE/app/domains/cache/llm_cache.py (`is_standalone_question`)
- BE/app/graphs/query_graph.py (cache_lookup_node, generate_answer_node)
- BE/tests/test_llm_cache.py (2 regression tests)

## Related Playbooks
- .playbook/known-issues.md — entry 2026-07-06 (LateChunkEmbeddings + cache note)

## Related Skills
- (none yet)
