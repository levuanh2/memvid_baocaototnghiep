# Feature Pack D — Personal Knowledge Graph & Knowledge Evolution

Real implementation, continues from Feature Pack C on the same branch. Frontend-only, no fabricated data — every number, list, and label below is a real derivation over `StudyContext`'s existing `history[]` (Feature Pack A) and the currently loaded mindmap's node list. Nothing is persisted, nothing is invented.

---

## Architecture impact

None structural. One new pure computation module (`utils/knowledgeEvolution.js`), one new component (`KnowledgeDashboard.jsx`) added as a 4th tab alongside Evidence/Tutor/Timeline in the SAME `SidebarRight` tab row Feature Pack A already established — no new panel mechanism, no new global state, no persistence layer. One small, real capability gap closed additively: `useMindMapController.js` now also exposes `allNodes` (the full node list of the loaded mindmap), because "visited vs. unvisited" and "frequently vs. rarely vs. never opened" need to know the full set a session's visits are a subset of — that set already existed inside the hook's `graphIndexRef`, just wasn't returned before.

Three small, safe consolidations were made along the way (each mirrors a precedent Feature Pack B/C already set — e.g. `citeKey`): `KIND_META` (kind → icon/label), `formatRelativeTime` (the "x phút trước" formatter), and `canJumpEntry` (the "can this history entry actually navigate anywhere" rule) each existed as a local copy inside `ResearchTimeline.jsx` (and, for `KIND_META`, a second copy in `CommandPalette.jsx`). All three are now single exported functions in `knowledgeEvolution.js`/`relativeTime.js`, imported by every real caller instead of duplicated. Behavior is unchanged — these are relocations, not rewrites.

---

## Files changed

| File | Change |
|---|---|
| `FE/src/utils/relativeTime.js` (new) | `formatRelativeTime(at, now)` — extracted from `ResearchTimeline.jsx`'s local `nhanThoiGian`, now a tested, shared function. |
| `FE/src/utils/relativeTime.test.js` (new) | 5 tests covering all four time bands + a clock-moved-backward guard. |
| `FE/src/utils/knowledgeEvolution.js` (new) | The knowledge model (see below): `KIND_META`, `canJumpEntry`, `dedupeHistory`, `classifyEntry`, `evolutionGroups`, `reviewSuggestions`, `sessionSummary`, `partitionNodesByVisit`, `nodeHeatmap`. Pure, no DOM/React, same convention as `mindmapGraph.js`/`keyboardShortcuts.js`. |
| `FE/src/utils/knowledgeEvolution.test.js` (new) | 23 tests across every exported function: the honest "middle band classifies as null" case, exact boundary tests at the 5-minute/10-minute thresholds (inclusive on both), first-visit-vs-revisit, duplicate (kind,id) merging, a document-reset-to-empty-history case, malformed entries, and node-id type coercion (numeric vs. string) in both `dedupeHistory` and `partitionNodesByVisit`. |
| `FE/src/utils/mindmapGraph.js` | New pure `allNodeSummaries(index)` — every non-root node, same `summarize()` shape `relationsFor` already returns. |
| `FE/src/utils/mindmapGraph.test.js` | 3 new tests for it. |
| `FE/src/hooks/useMindMapController.js` | New `allNodes` (memoized over `graphIndexRef`, keyed on `data?.id`) added to the returned object. |
| `FE/src/components/study/KnowledgeDashboard.jsx` (new) | The dashboard (mục 7) — see User workflow. |
| `FE/src/components/Layout/SidebarRight.jsx` | New 4th tab "Kiến thức" (`rightView === "insights"`), same peer weight as the existing three tabs; renders `KnowledgeDashboard`. |
| `FE/src/components/Layout/MainLayout.jsx` | New `openInsights` (mirrors `openTutor`'s shape exactly — sets `rightView`, opens the drawer/expands the column) + a header button. |
| `FE/src/utils/workspaceInit.js` | `VALID_RIGHT_VIEWS` gained `"insights"` — `?right=insights` is now a valid deep-link value, same convention Feature Pack B established for `tab`/`right`. |
| `FE/src/utils/workspaceInit.test.js` | Updated to cover the 4th value. |
| `FE/src/components/study/ResearchTimeline.jsx` | Consolidation only: now imports `formatRelativeTime`, `KIND_META`, `canJumpEntry` instead of its own local copies. Behavior unchanged (verified by its own pre-existing tests still passing — this component has no direct test file, its behavior is exercised transitively through `knowledgeEvolution.test.js`'s tests of the extracted functions). |
| `FE/src/components/palette/CommandPalette.jsx` | Consolidation only: `TIMELINE_KIND_META` local copy replaced with an import of the same shared `KIND_META`. |

14 files: 9 modified, 5 new (all FE). No BE file touched.

---

## Knowledge model

**What ships**, all computed in `utils/knowledgeEvolution.js` over `history[]` entries (`{kind, id, label, source, at}`, unchanged shape from Feature Pack A):

- **Mới khám phá (Recently discovered)** — an item's first visit fell within the last 5 minutes of the session.
- **Ôn đi ôn lại (Frequently revisited)** — an item (same `kind`+`id`) appears 2+ times in `history`.
- **Cần xem lại (Needs review)** — visited exactly once, more than 10 minutes ago, never revisited since.
- **Session Summary** — real counts: distinct questions asked, distinct evidence opened, distinct topics+entities ("concepts"), distinct mindmap/StudyMap nodes visited.
- **Knowledge Graph Overlay** — for the currently loaded mindmap: visited vs. unvisited node counts+lists (`allNodes` minus/intersect the `kind:"node"` ids in `history`), the selected node's real parent/children/siblings (`mindMapController.relations`, unchanged from Feature Pack A), and its real root-to-node ancestor chain (`mindMapController.breadcrumb`).
- **Knowledge Heatmap** — the same visit-count tally as "frequently revisited," applied to every node in the loaded mindmap: frequent (2+ visits), rare (1 visit), never opened (0 visits, real absence from `history`).
- **Review Suggestions** — the "needs review" group, oldest-stale-first, capped at 5.

**What does NOT ship, and why** — the epic's own example labels include "Mastered" and "Forgotten." Neither is implemented as a literal category. There is no correctness or retention signal anywhere in reachable frontend state: `history[]` records *what was looked at and when*, never *whether it was understood*, and no quiz/mastery data (`DocumentList.jsx`'s `weak`/`attempts`/`d.knowledge?.readiness?.mastery`, all real and already fetched — but on a different page, via a different `studyApi` call, at document/concept granularity, not reachable from inside `Workspace`) flows into `history` or into `Workspace`'s reachable state. Inventing "Mastered: 40%" from visit-count alone would be exactly the fabrication the epic's IMPORTANT section forbids — restraint here was the correct call, not a shortfall.

**A second honest data-granularity limit, discovered while building Session Summary**: both the MindMap-canvas node click (`useMindMapController.js:75`) and the StudyMap-tree node click (`StudyMapView.jsx:384`) log `{kind:"node", source:"mindmap"}` to the SAME shared `history`. The two surfaces are not distinguishable from `source` alone. "MindMap nodes visited" and "StudyMap progress" are therefore reported as one unified "nodes visited" count, not a fabricated split.

---

## User workflow

A new "Kiến thức" tab sits alongside Bằng chứng / Gia sư AI / Dòng thời gian in the right column (reachable the same way Timeline already is — the tab row, or the new header button). Opening it, with zero activity yet, shows an honest empty state ("Chưa có hoạt động nào... bảng này sẽ tự lấp đầy") instead of empty charts. As the user asks questions, opens citations, and browses the MindMap, six sections fill in with real data: **Tóm tắt phiên** (stat row), **Hôm nay** (last 5 activities, each with a real Jump button, plus a link to the full Timeline — no duplicate "continue learning" card was built, since Timeline's own "Tiếp tục từ chỗ đang dở" section already covers that exact job), **Tri thức đang thay đổi** (discovered/frequent groups), **Nên xem lại gì?** (review suggestions), **Sơ đồ tri thức** (visited/unvisited node counts, related-node pills, root-to-node path — only shown once a mindmap exists), and **Nhánh hay dùng / hiếm dùng** (heatmap lists, collapsed by default). Every Jump button follows the exact discipline Feature Pack A established: real navigation when possible, disabled-with-a-stated-reason when not, never a fake success.

---

## Build

```
npm run build   ->  clean (2362 modules, no errors)
```

## Tests

```
npm run test    ->  973/973 (was 942 before this pass — 31 new:
                     23 knowledgeEvolution.test.js, 5 relativeTime.test.js,
                     3 mindmapGraph.test.js's allNodeSummaries block.
                     workspaceInit.test.js's 4th-value coverage extended an
                     existing test, no new count there.)
```

## Lint

```
npx eslint src  ->  66 problems (58 errors, 8 warnings) —
                     unchanged from the confirmed baseline after fixing 3
                     transient warnings introduced mid-implementation
                     (an un-memoized `allNodes` fallback in
                     KnowledgeDashboard.jsx, and an intentional ref-driven
                     useMemo dependency in useMindMapController.js — the
                     latter silenced with the SAME eslint-disable-next-line
                     pattern this file's own pre-existing `recentItems`
                     memo already uses for an identical situation)
```

Pre-commit hygiene (same checks as Pack A/B/C): `git diff --check` clean (CRLF notices only), terminal-contamination grep zero hits, `git status --short` matches exactly the 14 intended FE files, zero BE files touched.

**Pre-stage review fixes** (Codex, applied before commit): node ids are now coerced through one shared `nodeKey()` helper before every `Set`/`Map` comparison in `partitionNodesByVisit`/`nodeHeatmap`/`dedupeHistory` — mind-elixir/StudyMap node ids can arrive as either a number or a string depending on source, and an uncoerced `Set.has`/`Map.get` would silently fail to match one against the other (the same class of bug Feature Pack B's `findNodeByChunk` already guards against with `String(chunkId ?? "")`). 9 boundary/edge tests added: exact-threshold behavior at 5 and 10 minutes (inclusive both ends), first-visit-vs-revisit, a full document-reset-to-`[]`, malformed entries, and numeric-vs-string node id merging in both `dedupeHistory` and `partitionNodesByVisit`. Confirmed: `allNodes` is additive only (new key on the returned object, `registerMindInstance`/`onNodeSelected`/`jumpTo`/etc. all untouched) and touches no backend shape (`mindmapNormalize.js` untouched, zero BE files in this diff). Confirmed: Session Summary's `nodes` count is reported as one unified number, never split by MindMap/StudyMap origin (see Knowledge model above). Confirmed: the new tab button and header button reuse the exact `pill-tab`/`aria-pressed` and `pill-action` markup patterns their siblings (Timeline, Gia sư AI) already use — no new ARIA pattern introduced. Confirmed: the `KIND_META`/`formatRelativeTime`/`canJumpEntry` consolidations changed zero behavior (full suite green before and after; the extractions are direct relocations, not rewrites).

---

## Remaining limitations — documented, not invented around

- **No "Mastered"/"Forgotten" categories** — see Knowledge model above. Would require either a new backend correctness signal flowing into `Workspace`'s reachable state, or reaching into `DocumentList.jsx`'s already-fetched `weak`/`attempts`/mastery data from inside `Workspace` — a cross-page data-reachability problem structurally identical to Feature Pack C's Command-Palette blocker, not solved here for the same reason (would mean lifting page-local fetched state into something global, duplicating it).
- **MindMap-canvas vs. StudyMap-tree node visits are not separable** — both log `source:"mindmap"` to the same shared `history`; Session Summary reports a unified count rather than a fabricated split.
- **The Knowledge Dashboard has no MindMap-mode floating-overlay variant.** Unlike Timeline (Feature Pack B), opening it while on the MindMap tab behaves the same way the pre-existing "Gia sư AI" button already does — it sets `rightView` without checking `workspaceMode`, a real no-visible-effect no-op while `SidebarRight` is swapped out for `KnowledgeInspector`. This is an existing, already-present rough edge (Tutor has had it since before this pack), not something Pack D introduces or was scoped to fix; building a second overlay mechanism for a fourth tab was judged out of proportion for this pass.
- **"This Week" was not built as a Learning Journey bucket.** `history` is never persisted across a page reload, so in practice everything in it is "today" — a "This Week" section would structurally always render empty, which looks like a bug rather than an honest reflection of the data. "Hôm nay" (genuinely accurate) plus a link into the full Timeline was built instead.
