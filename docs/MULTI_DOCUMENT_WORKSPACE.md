# M1 — Multi-Document Intelligence

Real implementation, continues from Feature Pack D on the same branch. Frontend-only — zero backend files touched, zero backend behavior assumed as verified. Everything below is either (a) real, working, and checked against the actual code, or (b) an explicitly documented blocker with a proposed contract, never a heuristic dressed up as the real thing.

---

## Architecture

### What already existed, verified by reading the code (not assumed)

Before this pass, multi-document selection was already wired further than the epic's own framing ("transform MemVidX... into a research workspace") suggested was needed:

- `SidebarLeft.jsx` already renders **checkboxes** (`toggleSelect`, `handleSelectAll`), building `selectedSources` as a real array of stems — not a single-select radio pattern.
- `ChatArea.jsx` already posts the **full** `selectedSources` array as `sources` in the chat request body.
- `SidebarRight.jsx`'s `handleGenerateMindMap`/summary-generation handlers already call `generateMindmap(selectedSources, ...)` / `generateSummary(selectedSources, ...)` — the full array, not `selectedSources[0]`.
- `utils/api.js`'s `generateMindmap`/`generateSummary` both already accept a `sources` array in their POST body (`/generate-mindmap`, `/generate-summary`).
- `SummaryPane.jsx` contains an explicit code comment stating the API "hỗ trợ tóm tắt nhiều nguồn" (supports summarizing multiple sources) — a previous author's own acknowledgment that the wire-shape is multi-source-capable.

**What this means, precisely, and what it does NOT mean:** the *wire shape* already supports N sources for chat, mindmap generation, and summary generation. Whether the backend *actually aggregates content across multiple sources* when given more than one — as opposed to, say, using only the first, or erroring — was **not verified live** in this pass (no backend test environment was exercised) and is **not assumed** anywhere in this implementation or its UI copy. Every UI change below either (a) reads data that is unambiguously already real regardless of that question (the `sources`/`chunks` a completed response already carries, per-document metadata from `/api/library`), or (b) is phrased to describe what IS visible, not to claim a synthesis process happened.

### The one real architectural gap: no per-node/per-section source attribution

`mindmapNormalize.js`'s node shape has no source field — only `chunkRefs` (opaque chunk ids). `GET /chunk-text/{chunkId}` returns `{text}` only, no stem or document id. `SummaryPane.jsx`'s summary sections carry `chunk_refs` the same way, with the same absence. There IS a top-level `sources` array on both a generated mindmap record and a generated summary record (used for the existing "N tài liệu" labels) — but nothing that ties an individual **node** or **section** back to which specific document it came from.

This blocks a true, honest implementation of "visually distinguish document-specific / shared / merged concepts" (mục 4) and any per-node provenance UI, for a mindmap generated from more than one source. Building that distinction from a client-side heuristic (e.g., guessing by which chunk-id ranges "look like" they belong to which document) would be exactly the kind of guessed relationship the epic's own IMPORTANT section forbids ("No guessed relationships... everything must remain explainable").

**This was raised with Codex (BE owner) before any implementation decision was made on it.** The agreed position: an additive, backward-compatible BE field is the right fix in principle, but is **not being made in this pass** — no BE contract has been finalized, no BE file has been touched, and no workaround was implemented in its place. If it is built later, the agreed shape is:

- `source_stems: string[]` per node (and, by the same reasoning, per summary section) — deterministically derived from real chunk provenance / known source mapping, never from LLM text or approximate name matching.
- A merged/shared node keeps **every** contributing stem, never collapses to one.
- A chunk/node whose source can't be resolved is `source_stems: undefined`/absent — the FE renders "unknown," it never guesses or defaults to a UI category.
- Populated for single-source AND multi-source mindmaps alike (stable semantics — not a field that only sometimes exists depending on request shape), with the field simply absent on old records (backward-compatible; old records need no migration).
- Would need real BE-side fixture tests (single-source, multi-source-shared, multi-source-unresolved) before FE relies on it, and the FE-side normalizer (`mindmapNormalize.js`) would need to tolerate the field's absence exactly as it already tolerates every other optional v2 field.

Until that exists, this pass explicitly does **not** implement per-node "document-specific / shared / merged" styling. What it implements instead is described below — all provably real today.

---

## Files changed

| File | Change |
|---|---|
| `FE/src/utils/multiDocument.js` (new) | The Concept Merge (mục 5) + Compare Documents (mục 6) engine: `extractConcepts` (reads `doc.knowledge.topics`/`doc.knowledge.entities` — real, already-loaded `/api/library` fields, same ones `taiLieuLienQuan.js` already reads for "related documents"), `compareConcepts` (deterministic exact-name grouping into shared/unique, reusing the SAME `boDau` normalization `taiLieuLienQuan.js` already established as this codebase's "identical concept" bar), `matchDocumentsToStems` (stem matching via the existing `normStem`), `evidenceCoverage` (per-document coverage from real opened citations). |
| `FE/src/utils/multiDocument.test.js` (new) | 17 tests: kind-scoped merging (a topic and an entity with the same name do NOT merge), no-semantic-merging (a real synonym pair never merges), presence-not-frequency within one doc, timestamp-suffix stem matching, malformed input safety. |
| `FE/src/utils/evidence.js` | New `parseCiteKey` — the exact inverse of the existing `citeKey`, consolidating a parse that `ResearchTimeline.jsx` and `KnowledgeDashboard.jsx` each independently re-implemented inline. |
| `FE/src/utils/evidence.citeKey.test.js` | 3 new tests for `parseCiteKey`. |
| `FE/src/components/study/KnowledgeDashboard.jsx` | New "So sánh tài liệu" section (mục 5+6+8), rendered only with 2+ selected sources: fetches `/api/library` (the SAME existing endpoint `CommandPalette`/`DocumentList` already call — no new request shape), filters to the workspace's selection, runs `compareConcepts`, shows shared concepts (with every contributing document named) and each document's unique concepts, plus a real evidence-coverage line ("opened a citation from N/M documents this session"). Also now imports `parseCiteKey` instead of a local duplicate. |
| `FE/src/components/Layout/SidebarRight.jsx` | Threads `selectedSources` (already an existing prop here) into `KnowledgeDashboard`. |
| `FE/src/components/Layout/ChatArea.jsx` | Answer provenance (mục 2): the existing "· N nguồn" badge and "Đã trả lời với N nguồn" line now name the actual contributing documents (via the SAME stem→filename resolution `buildSuggestions` already used) when there are 4 or fewer, falling back to the count above that — real data (`evidence.sources`, already returned by the backend and already forwarded via `onEvidence`), not a new signal. |
| `FE/src/components/Layout/SummaryPane.jsx` | Same real-names-instead-of-count-only enhancement for a summary's contributing sources. |
| `FE/src/components/mindmap/KnowledgeInspector.jsx` | Same enhancement for a mindmap's whole-record `sources` label — this is the ONE level of mindmap provenance that's real today (see Architecture above for what's deliberately NOT implemented at the node level). |
| `FE/src/components/Layout/MainLayout.jsx` | New header eyebrow state: "Không gian nghiên cứu · N tài liệu" when 2+ sources are selected and no single document is the Study Context's active pointer. |
| `FE/src/components/study/ResearchTimeline.jsx` | Workspace Timeline (mục 7): the Timeline already spans every document a multi-source session touches (`history` only resets on a single-document `selectDocument` call, which a multi-source chat session never makes) — this pass makes that visible: an evidence-kind entry now shows its source document (parsed from its `citeKey` id, the one history kind that genuinely encodes it) inline. |
| `FE/src/utils/workspaceSourcesBus.js` (new) | Workspace search (mục 9): a plain-module mirror of the current `selectedSources`, written by `Workspace.jsx`, read by `CommandPalette.jsx` — the cross-tree bridge those two files need since `CommandPalette` mounts outside `Workspace`'s subtree (same boundary Feature Pack C/D each hit). |
| `FE/src/pages/Workspace.jsx` | Writes to the bus whenever `selectedSources` changes (and clears it on unmount). |
| `FE/src/components/palette/CommandPalette.jsx` | New "workspace" search scope (alongside the existing "all"/"current"), filtering results to the workspace's selected documents via `matchDocumentsToStems` — reused, not reimplemented. |
| `FE/src/components/palette/AdvancedSearchPanel.jsx` | New scope chip, disabled with an explanatory title below 2 selected sources (same pattern the existing "current document" chip already uses when nothing's selected). |

15 files: 12 modified, 3 new (all FE). **Zero BE files touched.**

---

## Workflow

A user checks 2+ documents in the left sidebar (already-existing UI, unchanged). The header immediately shows "Không gian nghiên cứu · N tài liệu." Opening the "Kiến thức" tab (Feature Pack D) now shows a "So sánh tài liệu" section: which topics/entities are literally named the same across the selected documents (with every contributing document listed, never collapsed to a count), which are unique to each one, and how many of the selected documents have had at least one citation actually opened this session. Asking a question in Chat, generating a MindMap, or generating a Summary already sends the full multi-document selection (pre-existing); the resulting UI now names the contributing documents instead of only counting them, wherever that data already exists (whole-answer, whole-mindmap, whole-summary level). The Research Timeline already accumulates entries across every document touched in a multi-source session, and now labels each evidence entry with its source. Command Palette (Ctrl+K) gained a third search scope, "Không gian nghiên cứu," limiting results to the checked documents.

---

## Performance impact

- `KnowledgeDashboard`'s Compare section fetches `/api/library` once per distinct `selectedSources` set change (2+ sources), not per keystroke or per render — same fetch-on-open discipline `CommandPalette` already uses for the same endpoint. With a single document selected (the common case), this fetch never fires at all.
- `compareConcepts`/`extractConcepts` run client-side over already-fetched document metadata — O(total concept count across selected documents), the same order of magnitude `taiLieuLienQuan.js`'s existing per-document comparison already runs at, just generalized from pairwise to N documents.
- No change to bundle-critical paths: `multiDocument.js`/`workspaceSourcesBus.js` are small, tree-shakeable pure modules; `KnowledgeDashboard.jsx` was already lazy-loaded as part of the existing Workspace chunk (unchanged chunking).
- No new polling, no new WebSocket, no change to any existing job-poller cadence (mindmap/summary generation polling untouched).

---

## Build / Tests / Lint

```
npm run build   ->  clean (no errors)
npm run test    ->  993/993 (was 973 before this pass — 20 new:
                     17 multiDocument.test.js, 3 evidence.citeKey.test.js's
                     new parseCiteKey block)
npx eslint src  ->  66 problems (58 errors, 8 warnings) —
                     unchanged from the confirmed baseline, zero new issues
```

Regression: the full existing suite (978 pre-existing tests across Frontend V2/V3/Workspace V4/Feature Packs A–D) passes unchanged — nothing in this pass altered an existing function's behavior; `parseCiteKey` extraction and `KIND_META`/`formatRelativeTime`/`canJumpEntry`-style consolidations already established in Feature Pack D were the only refactors, and both `ResearchTimeline.jsx` call sites were updated to use them with identical output.

Pre-commit hygiene (same checks as every pack in this series): `git diff --check` clean (CRLF notices only), terminal-contamination grep zero hits, `git status --short` matches exactly the 15 intended FE files, **zero BE files in the diff**.

---

## Remaining limitations — documented, not invented around

- **No per-node or per-section source attribution for a multi-source mindmap or summary.** The single largest gap in this epic. See Architecture above for the exact reason (no field exists to read) and the proposed `source_stems` BE contract, discussed with and not yet approved/built by Codex. Nothing in this pass fakes this — every "document-specific/shared/merged" framing that DOES ship operates at the whole-mindmap or whole-summary level only, using the `sources` array that's genuinely already there.
- **Whether the backend actually aggregates content across multiple `sources` for chat/mindmap/summary generation is unverified.** The wire shape supports it and one existing code comment states the API "supports" multi-source summaries; this pass does not depend on that being true for correctness (every UI change here reads data that's real regardless), but it also doesn't claim to have confirmed it live.
- **Cross-document MindMap concept merging operates on `topics`/`entities` metadata, not the mindmap's own node tree.** A given document's mindmap nodes and its `knowledge.topics`/`knowledge.entities` list are two different data sources generated by different pipeline stages; the Compare/Merge section in Knowledge Dashboard compares the latter (real, cheap, already-loaded, no generation triggered) — it does not claim these are literally the mindmap's node titles.
- **Concept Merge only catches EXACT name matches (after case/diacritic folding).** By design — the epic's own hard rule. "Bộ nhớ" and "RAM," or "CPU" and "bộ xử lý," are real synonyms a human would merge; this system will not, and is not supposed to.
- **Workspace search scope needs 2+ selected sources to be selectable** — with 0 or 1, it's indistinguishable from "all documents"/"current document" and is shown disabled with an explanatory title rather than silently doing nothing.
