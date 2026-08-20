# Corpus inventory — Phase 4B.1 candidate snapshot

Inventory date: 2026-08-11. A full recursive workspace scan found no additional genuine user-provided research/learning documents beyond the original three. “Eligible” means suitable for human consideration, not approved for the study.

| doc_id | file | domain / subdomain | type | language | size / est. tokens | pages / headings | structure and scan | proposed split | status |
|---|---|---|---|---|---:|---:|---|---|---|
| `cv1_vector_feature_store` | `1-Day 19 - Track 2 - Vector store and Feature store_v2.pdf` | AI / Retrieval / RAG; vector and feature stores | lecture slides | Vietnamese + English terms | 1,955,542 B / 1,190 | 29 / 27 | medium slide structure; text on 29/29 pages; media-heavy | test | candidate |
| `cv1_ragas_guardrails` | `2-day24-ragas-guardrails.pdf` | AI / Retrieval / RAG; evaluation and guardrails | lecture slides | Vietnamese + English terms | 2,032,955 B / 10,405 | 74 / 188 | high slide structure; text on 74/74 pages; media-heavy | development | candidate |
| `cv1_social_engineering` | `TIỂU LUẬN AN TOÀN THÔNG TIN.docx` | Cybersecurity; social engineering | student essay + lab appendix | Vietnamese + English terms | 19,444 B / 682 | n/a / 10 | born-digital, headed structure, one table | test | candidate |

Excluded real or fixture-like files:

- `doc.md`: too short, demo-like, and of unknown authorship.
- `smoke.txt` and six `smk_doc*` files: explicit software/auth test fixtures; the six files form two exact-duplicate groups.
- `docs/memvid_speed_fix.docx`: internal project implementation report; circular and potentially stale for this evaluation.
- `BE/cleaned_md/*`: tiny generated/test artifacts rather than original user documents.
- Project chapters, literature reports, playbooks, decision records, code documentation, prompts, and environment package templates: project-authored/internal material, excluded by design.
- Legacy source-registry entries whose originals are absent: excluded because immutable source hashes and source-level provenance cannot be established.

No exact or high-overlap textual duplicate exists among the three eligible files. Five-word shingle Jaccard similarity has a selected-pair maximum of 0.000142; human semantic/version review is still required. Exact metadata and SHA-256 values remain in `documents.jsonl`.
