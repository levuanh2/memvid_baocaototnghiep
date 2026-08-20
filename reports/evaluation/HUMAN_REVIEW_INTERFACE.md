# Phase 4B.2 local human-review interface

## Start

From the repository root:

```powershell
python -m BE.evaluation.review_app --dataset reports/evaluation/datasets/corpus_v1 --port 8765
```

Open `http://127.0.0.1:8765`. The server binds only to localhost by default.

## Review workflow

1. Enter a pseudonymous reviewer ID such as `R1`. The application never reads the OS identity.
2. Review one query at a time. Candidate answers and evidence are labeled `CANDIDATE — NOT GROUND TRUTH`; production E0–E7 answers are never loaded.
3. Explicitly decide query disposition, answerability, answer, and evidence. `Incomplete` or `Wrong` evidence keeps the query pending until corrected and explicitly approved.
4. Review every atomic citation claim and assign `full`, `partial`, `none`, or `contradicted`.
5. Compare contradiction passages side by side and provide both an explicit label and rationale.
6. Review summary and mind-map aids for each selected document.
7. Check Progress & export. Export stays disabled while required decisions remain pending.
8. When complete, export the reviewed package. Export does not import, freeze, build indexes, or run experiments.

## Safe persistence

Each save is atomic and stored under:

```text
reports/evaluation/datasets/corpus_v1/reviews/<reviewer_id>/state.json
```

The original candidate CSV and JSONL files are guarded by hashes and are never overwritten. To resume, restart the server, open the page, and enter the same reviewer ID.

Completed exports are written to:

```text
reports/evaluation/datasets/corpus_v1/reviews/<reviewer_id>/export/
    human_review_queries.csv
    human_review_citations.csv
    human_review_contradictions.csv
    human_review_artifacts.csv
    human_review_summary.json
```

The summary contains annotation counts and blocking state only; it contains no research performance metrics.

## Import after genuine human completion

Replace `R1` with the actual pseudonymous reviewer ID:

```powershell
$env:PYTHONPATH="BE"
python -m evaluation.dataset import-review reports/evaluation/datasets/corpus_v1 --input reports/evaluation/datasets/corpus_v1/reviews/R1/export/human_review_queries.csv
python -m evaluation.dataset validate reports/evaluation/datasets/corpus_v1
```

Import remains a separate deliberate action. It does not freeze the corpus or dataset.

## Validation

- Explicit query/answer/evidence decisions are required.
- Reject persists as reject across reload.
- Corrected evidence must resolve to an eligible source, unchanged source hash, valid locator, offsets, and exact text.
- Missing/invalid sources cannot be approved.
- Duplicate candidate IDs are rejected during startup validation.
- Candidate package files remain byte-identical after save and export.
- Exported four-file packages pass the existing `import-review` path in software tests.
- Browser validation covers session start, missing-decision error, autosave, reload/resume, blocked progress, and disabled incomplete export.
