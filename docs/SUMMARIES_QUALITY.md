# Summary Quality Audit — Release Hardening Sprint V1, Phase 2

## Honest finding first: Summary has no dedicated quality-instrumentation layer

Unlike MindMap (`docs/MINDMAP_QUALITY_AUDIT.md`), the Summary pipeline
(`BE/services/summary/pipeline/{sections,summarize}.py`) has **no per-section structured
tracking** of token usage, generation time, or a failure-reason taxonomy. Confirmed by reading
`summarize.py::summarize_sections` in full: it tracks exactly one signal per section —
success/failure — and on failure appends a flat string `"section:<title>"` to a `missing` list
plus a `print()` with the exception message. No token counts, no per-section timing, no reason
enum. This is a real gap against this phase's ask (generated/missing/failed/empty/fallback/
token usage/generation time/reason, per section) — reported as a gap, not silently worked around
or patched (`services/summary/pipeline/sections.py` is part of the reserved/in-flight BE tree
this sprint does not edit).

## What IS real and measurable today

Per the actual code (`summarize.py:100-179`) and this session's real run:

| Signal | Available? | Source |
|---|---|---|
| Generated (non-empty summary) | Yes | `section.summary` non-empty |
| Missing (LLM call raised) | Yes | `generator.missing: ["section:<title>", ...]` |
| Failed vs. empty vs. fallback | **No distinction** — a raised exception, a JSON-parse failure, and an empty-but-valid LLM response are not distinguished; all either produce a populated `summary` or land in the same flat `missing` list | — |
| Token usage | **No** — not captured anywhere in this call path | — |
| Generation time (per section) | **No** — only a whole-job `elapsed_sec` in `generator` | `generator.elapsed_sec` |
| Reason | **Only free-text**: the raw exception string, printed to console, not persisted in the record | console log only |

## Real run (this sprint, local, job `103d535e-ab0f-4b49-ba28-b363ecc74e43`)

Same document as the MindMap run (`qa_large_doc.txt`), `length_mode="medium"`, model
`qwen2.5:7b-instruct` (local Ollama — cloud providers unavailable, see confounds in
`docs/MINDMAP_QUALITY_AUDIT.md`).

```json
"generator": {"degraded": false, "elapsed_sec": 207.5, "missing": [],
  "model": "qwen2.5:7b-instruct", "pipeline": "summary_sections_v6", "skeleton_method": "headings"}
```

| Section | Summary length (chars) | Key points | Empty? |
|---|---|---|---|
| Nội dung khác | 237 | 2 | No |
| Chương 1: Cấu trúc và chức năng của tế bào | 531 | 4 | No |
| Chương 2: Cấu trúc DNA và tổ chức bộ gen | 312 | 3 | No |
| Chương 3: Sao chép DNA | 366 | 5 | No |
| Chương 4: Phiên mã và dịch mã | 462 | 3 | No |
| Chương 5: Điều hòa biểu hiện gen | 533 | 3 | No |
| Chương 6: Di truyền học Mendel và ngoài Mendel | 549 | 3 | No |
| Chương 7: Đột biến và sửa chữa DNA | 387 | 3 | No |
| Chương 8: Công nghệ sinh học phân tử | 346 | 3 | No |

**9/9 sections generated, 0 missing, 0 empty, 0 fallback triggered, `degraded: false`.** No
`[summary] section ... failed` lines in the server log for this run — a clean pass.

## A real discrepancy worth flagging, not resolving here

Earlier this same session, during the Final Visual QA pass against **production** (the deployed,
older pipeline, same source document uploaded fresh there), the Summary tab showed several
chapters as `"Mục này chưa tóm tắt được"` (this section could not be summarized) — a real,
screenshotted partial-failure state (see `docs/FINAL_VISUAL_QA.md`, Summary tab entry). This
sprint's local run of what should be a comparable pipeline came back 9/9 clean.

**This is not resolved as a contradiction** — the two runs differ in more than one variable at
once (different environment, different model/provider path, different point in time, and
production's pipeline version is not confirmed identical to the local working tree's). Reporting
both honestly rather than picking whichever result looks better: production has been observed,
at least once, producing partial summary failures on real content; this sprint's one local run
did not reproduce that. This needs a controlled re-test (same pipeline version, same provider,
same document) to actually explain — flagged as a gap, not closed.

## Recommendations

1. **Build the same class of instrumentation Summary is missing**, mirroring MindMap's
   `quality_report`/`analytics` pattern (out of this sprint's edit scope — coordinate with the
   BE/Codex workstream that owns the reserved MindMap quality tree, since the pattern to follow
   already exists there). Minimum bar to close this phase's actual ask: per-section reason enum
   (not free-text), per-section elapsed time, token usage if the provider returns it.
2. **Re-run the production-vs-local Summary discrepancy above under controlled conditions**
   before assuming either result generalizes.
3. Coverage gap, same as Phase 1: this is one real document, not ten. See
   `docs/RELEASE_CANDIDATE_REPORT.md` for why, and the same recommendation (batch job with valid
   credentials, outside an interactive session).
