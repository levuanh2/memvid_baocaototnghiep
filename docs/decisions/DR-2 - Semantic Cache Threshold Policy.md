# DR-2: Semantic Cache Threshold Policy

## Status
Accepted (2026-07-06)

## Context
Requirement: Vietnamese repeated/paraphrased questions should hit the semantic cache safely. Measured calibration (docs/SEMANTIC_CACHE_SPEC.md): bge-m3 mean-pool cosine for TRUE paraphrase pairs = 0.55–0.80, for FALSE pairs up to 0.79 — distributions overlap. Also measured: diacritics vs no-diacritics same-meaning pair = 0.558 (very low), while homograph pairs (1-char diff) embed nearly identically.

## Decision
Layered hit policy:
1. Exact tier (O(1), no embedding): normalized question (NFC, lowercase, punctuation stripped, whitespace collapsed).
2. No-diacritics alias tier (O(1), no embedding): full normalized string equal modulo diacritics → hit, gated by LLM judge when enabled (judge OFF → direct hit, documented tradeoff). NO cosine gate — measured to be inverted for this threat.
3. Semantic tier: cosine ≥ 0.88 → direct hit; cosine in [0.80, 0.88) → hit only if LLM judge approves (same_intent AND safe_to_reuse, strict JSON, fail → miss); below → miss.
4. THRESHOLD default 0.85, floor 0.80 (clamp + loud warning; override env only). Explicit floor override (<0.80) disables the judge band and restores plain threshold rule — admin takes the wheel.

## Why
- Overlapping cosine distributions make any pure-threshold paraphrase matching unsafe; the judge adds intent verification exactly in the ambiguous band.
- Alias tier recovers the highest-frequency real-world variation (typing without diacritics) that embeddings measurably fail on.
- Fail direction is always miss (judge error/timeout/bad JSON → miss): worst case = one extra LLM answer generation.

## Alternatives Considered
- Cosine verify on alias hits: rejected — measured 0.558 for true positives, ~high for homograph false positives (inverted guard).
- Lowering threshold to 0.80 without judge: rejected — calibration shows false hits ("Phishing" vs "Whaling" = 0.727, intent pairs 0.788).
- Separate sentence-similarity encoder for cache: viable upgrade path (env SEMANTIC_CACHE_EMBED_MODEL slot in bucket key), not needed yet.

## Consequences
- Borderline + alias hits cost one short judge call (~2–5s qwen CPU) vs ~30–40s full generation.
- Judge OFF (SEMANTIC_CACHE_JUDGE_ENABLED=0): band reverts to plain threshold; alias hits become direct (small homograph false-hit risk, whole-sentence collision only, same document bucket).
- TTL stays 48h semantic / 1h retrieval; realtime/personal/action queries never cached (classifier), so no dynamic-data staleness tier needed.

## Related Files
- BE/app/domains/cache/llm_cache.py
- docs/SEMANTIC_CACHE_SPEC.md (calibration tables)
- BE/tests/test_llm_cache.py (25 tests)

## Related Playbooks
- 01_Project_Playbooks/MemVid/Semantic Cache Redis Playbook.md

## Related Skills
- 04_General_Skills/Semantic Cache Design Skill.md
