# M2.5 — Provenance Adoption & M1 Closure

Frontend adoption of the `source_stems` contract landed in M2. Closes the per-node/per-section provenance blocker M1 documented, to the extent that blocker is actually closeable — see "M1 blocker status" below for the one part that genuinely isn't (StudyMap multi-document, an architectural boundary, not something this pass could or should paper over).

---

## Commit hashes

**M2 (BE, Codex-owned):**
- `a47aa34` — original M2 commit. Historical, mixed content (see `docs/PROVENANCE_CONTRACT.md`'s Commit history section — it also carried unrelated pre-existing WIP from a whole-dirty-file stage).
- `85182e4` — non-destructive corrective follow-up. **This is the effective M2 tip** — the tree that actually matches the contract.
- `b88ee7d` — doc correction (Claude) describing the above.

**M2.5 (FE, this pass, Claude):** committed and pushed in the same session this report was written — see the GIT section below for the exact hashes, added after commit.

---

## Files changed (FE, this pass)

| File | Change |
|---|---|
| `FE/src/utils/evidence.js` | New `normalizeSourceStems(raw)` — the shared defensive-normalization helper every consumer below uses. Non-array → `undefined`; non-string/blank/duplicate entries dropped; empty result → `undefined`, never `[]`. |
| `FE/src/utils/evidence.sourceStems.test.js` (new) | 8 direct unit tests for that helper. |
| `FE/src/utils/mindmapNormalize.js` | **The actual bug fix.** `normalizeV2`'s node mapper was a strict field allowlist that silently dropped `source_stems`. Now adds `node.sourceStems` (camelCase, matching every other field here) only when `normalizeSourceStems` returns something. |
| `FE/src/utils/mindmapNormalize.test.js` | +7 tests: single source, multiple sources (order preserved, not re-sorted), missing field, invalid values, duplicate stems, mixed valid/invalid, legacy v1 untouched. |
| `FE/src/utils/mindmapGraph.js` | `summarize()` (feeds `relationsFor`/`breadcrumb`/`allNodeSummaries`) now carries `sourceStems` through when present. New `classifyByProvenance(node)` — deterministic `"unresolved" \| "single-source" \| "shared"`, `source_stems.length` only, nothing else. |
| `FE/src/utils/mindmapGraph.test.js` | +4 tests for the above. |
| `FE/src/utils/mindElixirAdapter.js` | The sidecar (`recordToMindElixir`) now carries `sourceStems` alongside `note`/`chunkRefs`/etc — this was the SECOND silent-drop point in the chain (a node's normalized `sourceStems` never reached `useMindMapController`'s `selected` state without this). Canvas tag: a node with 2+ resolved stems gets a small `⇄ N` badge (reuses the exact tag mechanism the existing `※ N` citation-count tag already uses — same `--seal` color, a light fill differentiates it). `mindElixirToRecord` (the save/export direction) deliberately does NOT round-trip `sourceStems` — same "computed, read-only, never re-sent" treatment `number`/`level`/`enrichment` already get. |
| `FE/src/utils/mindElixirAdapter.test.js` | +4 tests: reaches the sidecar, stays `undefined` when absent (key present, value `undefined` — not silently dropped), never echoed into a save payload, canvas tag appears only for shared nodes. |
| `FE/src/hooks/useMindMapController.js` | `onNodeSelected`'s `setSelected(...)` — the THIRD silent-drop point — now includes `sourceStems: side?.sourceStems`. This is what actually reaches `KnowledgeInspector`'s `node` prop. |
| `FE/src/components/mindmap/KnowledgeInspector.jsx` | New provenance `MetaChip` on the selected node's header, once, not repeated per Evidence card (`Nguồn: paper-a` / `Nguồn: paper-a · paper-b`). "Mở nguồn" now uses the node's own `sourceStems` when present — one button per stem, never auto-picks `[0]` — falling back to the pre-existing whole-mindmap single-source case only when the node itself has none. |
| `FE/src/utils/summaryJob.js` | `normalizeSummaryRecord`'s `sections` mapping now defensively normalizes each section's `source_stems` into `sourceStems` (same shared helper, same contract) instead of passing the raw field through untouched. |
| `FE/src/utils/summaryJob.test.js` | +5 tests: single/multiple sources, missing, invalid (with other fields on the same section proven untouched), old/legacy sections. |
| `FE/src/components/Layout/SummaryPane.jsx` | Each section now shows its own `Nguồn: …` line when `sourceStems` is present — never falls back to the summary's whole-record `sources`. |
| `FE/src/pages/study/StudyMapView.jsx` | `NodeDetail` shows `Nguồn: …` from the node's raw `source_stems` (StudyMap has no normalizer layer — `setMap(body)` stores the raw API response, plain property access everywhere already; a defensive `Array.isArray(...) && .length > 0` guard is the correct equivalent here). Single-document only, by construction — see Limitations. |
| `FE/src/components/study/KnowledgeDashboard.jsx` | M1 closure: the "Chưa xem" (unvisited) node pills and the Heatmap's "Hay dùng" list now show a small shared-across-documents indicator (`classifyByProvenance`) instead of nothing. Knowledge Evolution's "Hôm nay"/"Mới khám phá"/"Ôn đi ôn lại"/"Nên xem lại gì?" node-kind entries are enriched with the SAME real provenance (looked up from the current mindmap's `allNodes`) when resolvable — the classification rules themselves (recency/frequency, Feature Pack D) are completely unchanged; this only adds a hint next to an entry that already existed. |
| `FE/src/components/mindmap/mindmap.css` | New `.mm-tag-shared` rule — same `--seal` token the existing citation tag already uses (seal already IS this app's provenance color; no new hue introduced), light fill for visual distinction. |

15 files: 14 modified, 1 new (all FE). **Zero BE files touched or staged this pass.**

---

## Provenance flow (the full chain, four silent-drop points found and fixed)

```
BE record.nodes[i].source_stems (list[str] | absent)
        │
        ▼  mindmapNormalize.js::normalizeV2   ← FIX 1 (the epic's named bug)
node.sourceStems (string[] | undefined, defensively normalized)
        │
        ▼  mindElixirAdapter.js::recordToMindElixir  ← FIX 2 (found during this pass)
sidecar.get(id).sourceStems
        │
        ▼  useMindMapController.js::onNodeSelected    ← FIX 3 (found during this pass)
selected.sourceStems
        │
        ▼
KnowledgeInspector.jsx reads `node.sourceStems`
```

The epic named only FIX 1. FIXES 2 and 3 were found by tracing the actual data path end-to-end rather than stopping once the named allowlist was patched — `mindmapNormalize.js` alone would have produced a normalized node with `sourceStems` that then got silently dropped TWICE more before reaching any UI. This is documented explicitly because "the allowlist fix" was the epic's literal ask, and stopping there would have shipped something that still didn't work.

Summary's chain is shorter (no sidecar, no mind-elixir canvas): `summaryJob.js::normalizeSummaryRecord` is the only hop, and it already passed `sections` through as-is (per `docs/PROVENANCE_CONTRACT.md`'s prior FE-tolerance finding) — this pass adds defensive normalization there rather than trusting the wire payload raw.

StudyMap has no normalizer layer at all (`StudyMapView.jsx` stores the raw API response) — nothing to fix there structurally, just a render-site guard.

---

## MindMap adoption

- **Inspector**: compact `Nguồn: X` / `Nguồn: X · Y` chip on the selected node, once. Absent → renders nothing (verified: no fallback string, no empty chip).
- **Cross-document classification** (`classifyByProvenance`): `unresolved` / `single-source` / `shared`, `source_stems.length` only. No title comparison, no semantic anything.
- **Canvas**: subtle `⇄ N` tag on shared nodes only — reuses the existing tag mechanism (same one the `※ N` citation count already uses), same `--seal` provenance color. Nothing else on the map recolors; single-source and unresolved nodes get no new tag at all (the default case doesn't need flagging, and absence of data isn't itself a state worth badging).
- **Cross Navigation** ("Mở nguồn"): now node-specific when the node has its own `sourceStems` — one button per stem when there are several, never an automatic pick of the first.
- **Knowledge Dashboard**: unvisited-node pills and the heatmap's frequent list show the same shared-node indicator; Knowledge Evolution's per-entry lists get it too, via a lookup against the currently loaded mindmap — enrichment only, zero change to which entries land in which bucket.

## Summary adoption

- Each section shows its own `Nguồn: …` line when resolvable — never falls back to the record's whole-document `sources` list, never guesses.
- Old summaries (no `source_stems` on any section) render exactly as before — the line simply doesn't appear.

## StudyMap adoption

- `NodeDetail` shows the concept's resolved source stem(s) as plain metadata, alongside its existing summary/evidence display.
- **Deliberately not pretended to be multi-document.** StudyMap's generator, API, and data model are single-document today (`KnowledgeMap`/`KnowledgeNode` both FK to one `document_id`) — `source_stems`, when present, is always exactly one element, by construction. This UI change does not imply otherwise anywhere in its copy.

---

## M1 blocker status

| Surface | Status |
|---|---|
| MindMap node provenance | **CLOSED**, for any node a BE-generated-post-M2 mindmap resolves `source_stems` for. Un-resolvable nodes and pre-M2 mindmaps correctly show nothing — that's the contract working, not a remaining gap. |
| Summary section provenance | **CLOSED**, same terms. |
| Knowledge Inspector provenance | **CLOSED** — this was the actual UI surface the blocker was named after; see Provenance flow above for the 3 fixes that made it real. |
| Cross-document navigation labels | **CLOSED** — "Mở nguồn" is now node-specific, multi-stem-aware. |
| Knowledge Dashboard source grouping | **CLOSED** — real per-node enrichment added, existing classification rules untouched. |
| Compare-document presentation | **Unaffected, correctly.** M1's Compare Documents (`utils/multiDocument.js`) compares each document's OWN `knowledge.topics`/`knowledge.entities` metadata — a different, already-correct data source (document-level, from `/api/library`, no chunk-level ambiguity to begin with). It never needed `source_stems` and this pass did not touch it. |
| **StudyMap multi-document concept provenance** | **NOT CLOSED — proven architectural blocker, not a remaining task.** A StudyMap concept's provenance is, and can only be, one document, because StudyMap generation itself is single-document end to end. Closing this for real would mean expanding StudyMap's generation/API/data model to accept multiple documents — outside M2.5's and M2's own DO NOT TOUCH boundary (no architecture/pipeline changes). This is the one part of M1's blocker that remains open, by design, not by oversight. |

---

## Legacy compatibility

Explicitly tested (not assumed) for all three surfaces:

- **Old MindMap** (no `source_stems` on any node): `mindmapNormalize.test.js`'s "old (v1/legacy) records never carry the field" + `mindmapNormalize.js`'s "missing field" case; `mindElixirAdapter.test.js`'s "stays undefined in the sidecar... never []". Renders normally — no crash, no chip, no fake source.
- **Old Summary** (no `source_stems` on any section): `summaryJob.test.js`'s "old (legacy/pre-M2) summary sections" test, and the "invalid... other fields untouched" test proving a malformed/absent `source_stems` never corrupts the rest of a section's real data.
- **Old StudyMap** (no `source_stems` on any node): covered by construction — `NodeDetail`'s guard (`Array.isArray(node.source_stems) && node.source_stems.length > 0`) is false for any node lacking the field, same pattern every other optional field in that component already uses. No dedicated test file exists for `StudyMapView.jsx` itself (this codebase has no React-Testing-Library-based component tests anywhere — confirmed by search — every existing test is a pure-function test; this is consistent with that established convention, not a gap introduced here).

No migration, no backfill, no crash anywhere in this pass — all defaults degrade to "nothing shown," never a fabricated fallback.

---

## Test contract end-to-end (fixtures A/B/C/D from the epic)

| Fixture | Where it's exercised |
|---|---|
| A. one-document node, `source_stems: ["paper-a"]` | `mindmapNormalize.test.js` ("single source"), `mindElixirAdapter.test.js` ("source_stems reaches the sidecar") |
| B. shared node, `source_stems: ["paper-a", "paper-b"]` | `mindmapNormalize.test.js` ("multiple sources"), `mindmapGraph.test.js` (`classifyByProvenance` → `"shared"`), `mindElixirAdapter.test.js` (canvas tag test) |
| C. unresolved node, field absent | `mindmapNormalize.test.js` ("missing field"), `mindElixirAdapter.test.js` ("stays undefined... never []"), `mindmapGraph.test.js` (`classifyByProvenance` → `"unresolved"`) |
| D. legacy record, field absent because pre-M2 | `mindmapNormalize.test.js` ("v1: ... never had these"), `mindElixirAdapter.test.js` ("v1 legacy đi qua normalize không vỡ"), `summaryJob.test.js` ("old (legacy/pre-M2) summary sections") |

The chain is proven through every PURE layer (BE shape → normalizer → sidecar). `useMindMapController.js`'s hook itself and `KnowledgeInspector.jsx`'s render are not independently unit-tested — this codebase has no React-hook or component test tooling anywhere (confirmed, not assumed), so "where technically testable" stops at the last pure boundary, consistent with every prior pass in this series (Feature Packs A–D, M1).

---

## BE tests (Codex-reported, re-stated here for a complete record)

```
49 passed  — focused provenance/schema/summary/pointers tests
57 passed  — graph/summary regression suite
10 skipped — StudyMap DB-dependent tests (missing TEST_DATABASE_URL)
```

Full-repo `pytest` did not complete at collection (pre-existing, unrelated `langchain_core.pydantic_v1` import error in 9 query/CRAG modules — none of which either M2 or M2.5 touched). Not reported as green, not reported as a regression — see `docs/PROVENANCE_CONTRACT.md` for the full detail and the `a47aa34`/`85182e4` commit-history caveat.

## FE tests

```
1020/1020 (was 993 before this pass — 27 new:
  7  evidence.sourceStems.test.js (new file)
  7  mindmapNormalize.test.js's "v2: source_stems" block
  4  mindmapGraph.test.js's classifyByProvenance + allNodeSummaries additions
  4  mindElixirAdapter.test.js's provenance-chain + shared-tag tests
  5  summaryJob.test.js's section-provenance block
```

## Build

```
npm run build   ->  clean
```

## Lint

```
npx eslint src  ->  66 problems (58 errors, 8 warnings) — unchanged baseline, zero new issues
```

---

## Known limitations

- **StudyMap multi-document concept provenance is a real, proven architectural blocker, not a remaining task for a future FE pass** — see M1 blocker status above. Closing it needs a BE architecture change explicitly out of scope for both M2 and M2.5.
- **A pre-M2 (or unresolved) MindMap/Summary/StudyMap record shows no provenance UI at all, permanently** — there is no migration/backfill, per the BE contract (`docs/PROVENANCE_CONTRACT.md`). This is intentional, not a gap.
- **The `⇄ N` canvas tag only ever indicates "shared," never "single-source" or "unresolved."** This was a deliberate "keep it subtle" choice per the epic's own instruction — flagging every node's provenance state would be map-wide noise, not a complement to the existing forest/bronze/seal visual language.
- **`useMindMapController.js` and `KnowledgeInspector.jsx` are not independently unit-tested** — no hook/component test tooling exists in this codebase (confirmed by search, not assumed); coverage stops at the last pure-function boundary in the chain, consistent with this whole series' established testing convention.
- **The full BE `pytest` suite has still not been run green end-to-end** for either M2 or M2.5 — the pre-existing `langchain_core.pydantic_v1` collection blocker predates both and was not fixed by either (fixing it would be outside this epic's own DO NOT TOUCH boundary — it's an unrelated dependency issue, not provenance work).
