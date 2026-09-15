# M2 — Provenance Contract

Backend infrastructure sprint, implemented and owned by Codex (BE), documented here against the actual landed commits — not the epic's original wishlist. A full-repo `pytest` run was attempted and did not complete (see Tests below — a pre-existing, unrelated collection error, not something this document treats as "full suite green").

**Commit history — read this before the file list below.** M2 landed as TWO commits on `release/p0-p0.5-verification`, not one, and the first is NOT an isolated M2 diff:

- **`a47aa34`** — the original M2 commit. It correctly scoped to the 7 files named in this document, but `app/graphs/mindmap_graph.py` was staged as a whole dirty file, which also carried Codex's own **pre-existing, unrelated, uncommitted Phase 2B / quality / recovery WIP** (~148 lines) that happened to be sitting in that file at the time. **`a47aa34` is historical, mixed content — it is not a clean M2-only commit, and this document's earlier claim that "no pipeline logic was touched" is not accurate for `a47aa34` specifically.**
- **`85182e4`** — a non-destructive follow-up commit (no reset, no rewrite of `a47aa34`, no rebase — shared branch, other pushes had already landed on top of it). It restores `app/graphs/mindmap_graph.py`'s effective content to its pre-`a47aa34` parent state and reapplies **only** the provenance-attachment wiring. The unrelated Phase 2B/quality/recovery WIP that had leaked into `a47aa34` was moved back to Codex's local working tree (uncommitted, not lost, not pushed).

**The correct thing to read is the branch tip after `85182e4`, not `a47aa34` in isolation.** At that tip, the effective tree genuinely matches every claim in this document: `source_stems` only, no pipeline/prompt/hierarchy/LLM logic changed, exactly the 7 files below. Everything below describes that effective state unless stated otherwise.

---

## Architecture

`source_stems: string[]` is derived **deterministically** from data that already existed before this epic — no new signal, no inference, no LLM involvement:

- **MindMap**: a node's existing `chunk_refs` are resolved back to the chunks' known source stems (the same stem-per-chunk association `app.domains.mindmap.input_collector.collect_mindmap_input` already attaches to each input chunk from index metadata during generation). A node's `source_stems` is the deduped, sorted union of every resolved stem across its `chunk_refs`.
- **Summary**: a section's existing `chunk_refs` are resolved the same way, via `services.summary.pipeline.pointers._chunk_meta_index` (chunk key → source stem), which already existed for a different purpose in the summary pipeline.
- **StudyMap**: the current generator is single-document (one `document_id` per map, `KnowledgeMap`/`KnowledgeNode` both FK to a single document). There is no multi-source chunk-to-stem mapping available (`chunks_by_embedding(document_id)` returns `chunk_id`/`section_id`/`chunk_index`, not a stem). `source_stems` here is therefore always the ONE canonical stem resolved from the map's own `Document` row — a single-element array, attached only to nodes that actually have `chunk_ids`. This is a genuine, intentional scope boundary, not an oversight — see Limitations.
- Attachment happens **after** each pipeline's existing `sanitize_nodes`/section-sanitize step and **before** the build/persist step — sanitization already strips unrecognized fields, so provenance has to be added after it survives that gate, not before.
- **No pipeline, prompt, hierarchy, or LLM logic was touched** — at the effective, post-`85182e4` tree (see Commit history above; `a47aa34` alone briefly mixed in unrelated pre-existing WIP, corrected non-destructively). `source_stems` is metadata bolted onto an already-built node/section, never an input to generation.

---

## Schema

```
source_stems: string[]   // present, non-empty  -> every stem that deterministically
                          //   contributed to this node/section
                          // ABSENT (key omitted, never present-and-empty) -> nothing
                          //   could be deterministically resolved
```

- **Never an empty array.** An empty array would read as "resolved, and the answer is zero sources" — a false claim. Genuinely-unresolvable provenance omits the key entirely.
- **A node/section with multiple contributing chunks from multiple documents keeps every stem** — never collapsed to one, never silently picks a "primary" source.
- **A concept/section with no chunk refs at all gets the field omitted, never inherits every document in the map's `sources` list.** Nothing here fabricates provenance by defaulting to "everything that went in."
- MindMap and Summary: `source_stems` can legitimately be a multi-element array (multiple contributing documents).
- StudyMap: `source_stems`, when present, is **always exactly one element** — the map's own canonical document stem. This is a structural fact of the current single-document generator, not a coincidence of this epic's test data.

### Field name and format

`source_stems` — same name, same normalized-stem shape (`normStem`) the frontend's `citeKey`/evidence pipeline already uses everywhere (`FE/src/utils/evidence.js`). This was a deliberate joint decision in the design discussion for this epic: the frontend needs zero new parsing logic to eventually consume this field, because it's the exact shape it already knows how to read.

**What was NOT implemented, and was never more than an example in the epic's own text:** `source_document_id`, `source_chunk_ids`, `source_hash`, `generation_stage`. The epic's "Define canonical provenance model" section listed these as *examples* of a possible model, not a required field list. What actually landed is the one field the design discussion converged on as sufficient, deterministic, and consistent with the FE's existing citation model — `source_stems` alone. If a future pass needs the others, they are not implemented and nothing here should be read as claiming otherwise.

---

## Migration / Compatibility

- **New-records-only.** No lazy per-record migration on read, no batch backfill. This was an explicit, deliberate choice (discussed and agreed before implementation): a lazy-mutate-on-read strategy risks silent contract drift between what a record claims and what was actually re-derived at read time from possibly-changed pipeline state; new-records-only keeps the guarantee simple — a record either was generated after this change and may carry `source_stems`, or it wasn't and doesn't.
- **Old records remain permanently without the field.** They are not touched, not migrated, not reprocessed. `source_stems` is simply absent on them, exactly the same "absent means unresolved" contract new-but-unresolvable records use — a reader cannot distinguish "old record" from "new record with nothing resolvable" from the field's presence alone, and doesn't need to: both mean the same thing to a consumer ("no provenance claim is being made here").
- **No DB migration.** StudyMap persistence uses the existing `KnowledgeNode.metadata_json` additive-storage field — `source_stems` is stored there, no schema/column change. MindMap and Summary records store it as an additive field in their existing JSON record shape the same way every other optional v2 field already works (see `mindmapNormalize.js`'s existing tolerance for `number`/`level`/`enrichment` — this is one more field of that same kind).
- **Existing record shape is preserved.** No renamed field, no restructured node/section shape, nothing that would break an old consumer reading a record produced by this change but ignoring the new key.

---

## FE-side verification (done this pass, no FE files changed)

Verified against the actual FE normalizer code, not assumed:

- `mindmapNormalize.js`'s `normalizeV2` node mapping is an **explicit field allowlist** (`{id, parent, title, note, kind, chunkRefs, order, number, level, enrichment}`) — an unrecognized field like `source_stems` on a raw BE node is silently ignored, not passed through, not crashed on. Adding `source_stems` server-side today changes nothing observable in the FE until (and unless) a future pass explicitly adds it to that allowlist.
- `summaryJob.js`'s `normalizeSummaryRecord` passes `sections` through **as-is** (`Array.isArray(record.sections) ? record.sections : []`, no per-field filtering) — an added `source_stems` per section survives into the FE's `rec.sections` array, unused by any current renderer (`SummaryPane.jsx` only reads `id`/`title`/`summary`/`key_points`/`chunk_refs` off each section), but present and inert, not destructive.
- `StudyMapView.jsx` stores the raw API response (`setMap(body)`) with no schema/normalization layer at all for nodes; every node access in this codebase is plain property access (`n.node_id`, `attrs.node_id`, …), which ignores unknown fields by construction — no validation library anywhere in this codebase would reject an unrecognized key.

**Conclusion: the frontend is tolerant of this change as-is. No FE code changes were required or made for this pass.** Actually *surfacing* `source_stems` in any UI is out of scope here — the epic is explicit that this sprint exists only to expose the data at the backend/serializer level, not to redesign anything that consumes it.

---

## Files changed (BE, Codex-owned; landed and pushed as `a47aa34` + corrective `85182e4`)

| File | Status |
|---|---|
| `BE/services/provenance.py` | new — the shared deterministic resolver |
| `BE/tests/test_provenance.py` | new |
| `BE/app/graphs/mindmap_graph.py` | modified — see commit-history note above; effective (post-`85182e4`) content is provenance-attachment only |
| `BE/app/graphs/summary_graph.py` | modified |
| `BE/app/domains/studymap/generator.py` | modified |
| `BE/app/application/study_map_generation.py` | modified |
| `BE/app/domains/studymap/repository.py` | modified |

Zero FE files in either commit. No prompt/LLM/hierarchy-logic files touched, at the effective (post-`85182e4`) tree — none of these 7 files are prompt or generation-logic modules; `provenance.py` is metadata-only, and the other six are wiring, not generation logic. (`a47aa34` alone, before the correction, is not evidence of this — see Commit history above.)

---

## Tests (as reported by Codex)

```
49 passed  — focused provenance/schema/summary/pointers tests
57 passed  — graph/summary regression suite (no behavior change beyond the new field)
10 skipped — StudyMap DB-dependent tests (missing TEST_DATABASE_URL in this environment,
             not a failure — those tests need a real DB connection this local run didn't have)
```

`git diff --check`: clean (only the usual CRLF-conversion notices, no real whitespace errors).

**The full BE `pytest` suite has NOT been run green end-to-end for this change, and this document does not claim otherwise.** A full-suite run was attempted and stopped during collection with a `ModuleNotFoundError: langchain_core.pydantic_v1` across 9 query/CRAG-related modules. This is a pre-existing environment issue — those 9 modules are unrelated to this diff (none of the 7 files this epic touched are among them), and no test body from them ran either way, so it's neither a pass nor a fail caused by M2, just a collection-time gap in this local environment that predates this epic. The 49+57 focused/regression numbers above are what's actually been verified; "full suite green" is not a claim made anywhere in this document.

The test matrix (`BE/tests/test_provenance.py`, 6 tests) covers: stem canonicalization, shared multi-source union, unresolved/empty input, input immutability (the resolver doesn't mutate what it's given), and StudyMap's ref-bound single-source case. Old-record backward compatibility is covered by construction (new-records-only means an old record's test fixture simply has no `source_stems` key to begin with, and the regression suite passing confirms nothing about existing record handling changed).

---

## Limitations

- **StudyMap provenance is single-source only, by the current generator's own architecture, not a shortcut taken for this epic.** A StudyMap concept's `source_stems`, when present, is always a one-element array — the map's own document. Extending this to genuine multi-document StudyMap concepts would require expanding StudyMap's generation/API/data model (currently one `document_id` per map end-to-end) — explicitly out of scope, since the epic's own DO NOT TOUCH list forbids pipeline/architecture changes, and that expansion would be exactly that. This was raised as a possible blocker during the design discussion and resolved without needing separate approval: the epic's own constraints already settle it.
- **A concept/section with no chunk references at all has no provenance claim.** `source_stems` is omitted rather than inherited from the containing map/document's full source list — a concept that can't point to a specific chunk gets no claim about where it came from, not a fabricated broad one.
- **`source_document_id`, `source_chunk_ids`, `source_hash`, `generation_stage`** from the epic's own example list were not implemented. `source_stems` alone was judged sufficient for the FE's actual consumption needs (it's the exact shape `citeKey`/`normStem` already expect) and is what landed.
- **No migration/backfill exists or is planned for old records.** They will never carry `source_stems`; this is permanent, not a "not yet."
- **`a47aa34` alone is not a clean, isolated M2 commit** — it also carries unrelated pre-existing WIP that leaked in from staging a whole dirty file. The corrective `85182e4` fixes this non-destructively on top. Anyone diffing "M2's changes" against `main`/a base should diff the effective post-`85182e4` tree, not `a47aa34` by itself, or they will see ~148 lines of unrelated Phase 2B/quality/recovery work that isn't part of this contract.
- **A full-repo `pytest` run did not complete** (blocked at collection by a pre-existing, unrelated `langchain_core.pydantic_v1` import error in 9 query/CRAG modules — none of which this epic touched). Verified coverage is the 49 focused + 57 regression tests reported above, not a full-suite green.
- **The frontend does not yet surface `source_stems` in any UI.** This pass confirmed tolerance (no breakage), not adoption. A future pass would be needed to actually display per-node/per-section provenance to a user — the exact FE follow-up Feature Pack D/M1 left as an open door once this BE contract existed.
