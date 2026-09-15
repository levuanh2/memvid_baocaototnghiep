# Feature Pack B — Cross Navigation

Real implementation, reviewed by Codex before design and again before commit. Continues from Feature Pack A (Research Timeline) on the same branch — Timeline itself untouched, only its reachability.

---

## Architecture impact

None structural. No new route, no new page, no new backend call, no new global state system. Every navigation added either (a) reuses an existing query-param initializer pattern (`Workspace.jsx` already had `?source=`/`?prompt=`; this pass adds `?tab=`/`?right=` the same way), (b) reuses an existing tab/mode switch already in `MainLayout.jsx` (`setWorkspaceMode`, `setRightView`), or (c) reads data that was already being computed and simply wasn't exposed as a link (`doc.source_stem`, per-node `chunkRefs`).

One real gap found and closed with a genuinely new UI element: while viewing the MindMap tab, the right column shows only `KnowledgeInspector` — `SidebarRight` (and with it, the Research Timeline) is completely unreachable. A floating overlay panel closes this, described below.

---

## Files changed

| File | Change |
|---|---|
| `FE/src/pages/Workspace.jsx` | Reads two new optional query params, `tab` and `right`, as one-time initial values — same contract as the pre-existing `source`/`prompt` (`sau đó [state] làm chủ y như cũ`). Delegates the fallback/validation logic to a new pure module (below) instead of inlining it. |
| `FE/src/utils/workspaceInit.js` (new) | `resolveInitialTab`/`resolveInitialRightView` — allow-list + fallback, pure, unit-tested. An unknown or garbage query value degrades to the exact same default as no value at all. |
| `FE/src/utils/workspaceInit.test.js` (new) | 6 tests: valid values pass through, unknown values and empty/absent values both fall back to the pre-existing default. |
| `FE/src/components/Layout/MainLayout.jsx` | Accepts `initialWorkspaceMode`/`initialRightView` (default to the pre-existing `"chat"`/`"evidence"`, so every other entry point into Workspace is byte-for-byte unchanged). Adds the MindMap-mode Timeline overlay (dialog, backdrop, Escape-to-close, focused close button) and its two jump-handler wrappers that also switch `workspaceMode` so a jump is actually visible, not just logged. |
| `FE/src/pages/study/StudyMapView.jsx` | New "Về nguồn" (back to source) link in the page header, built from `doc.source_stem` — a value this page already sent into `StudyContext` on load, just never had a link using it. Points at `/app?source=<stem>&tab=mindmap&right=timeline`. |
| `FE/src/components/Layout/SidebarRight.jsx` | (1) The Chat evidence-frame list (a second rendering of citation data, separate from the inline prose chips) is now clickable — calls `selectEvidence`, same contract the prose chips already use since Pack A. (2) Each evidence-frame item that has a matching MindMap node now shows a small "view in mindmap" icon button. (3) `mindMapController`/`onJumpToMindMapNode` props (added for the Timeline tab in this same pass) reused for both. |
| `FE/src/hooks/useMindMapController.js` | New `findNodeByChunk(chunkId)`, delegating to a pure function in `mindmapGraph.js` (below) — no new data. |
| `FE/src/utils/mindmapGraph.js` | New pure `findNodeByChunk(index, chunkId)` — reads the SAME per-node `chunkRefs` field `normalizeMindmapRecord` already attaches to every node in the graph index this module already builds (`relationsFor`/`headingPath` use the same index). No sidecar, no second data structure. |
| `FE/src/utils/mindmapGraph.test.js` | 5 new tests for `findNodeByChunk`: single match, deterministic first-match on a shared chunk, no match, type-coercion (number vs string id), empty/null/undefined input. |
| `FE/src/components/Layout/ChatArea.jsx` | (1) Its own citation-click handler (Pack A) now calls the existing `citeKey()` helper (`utils/evidence.js`) instead of a hand-rolled duplicate of the same formula — found while implementing SidebarRight's version of the same click and realizing both should be calling one real function, not two copies that happen to agree today. (2) New "Xem tóm tắt" button, shown only when a summary genuinely exists, switching to the Summary tab via the existing mode-switch mechanism. |
| `FE/src/utils/evidence.citeKey.test.js` (new) | 4 tests locking down `citeKey`'s contract, now that two real call sites depend on it agreeing — normalization, missing chunkId, missing stem. |

11 files: 8 modified, 3 new (all FE). No BE file touched.

---

## Navigation added

1. **StudyMap → back to source, landing on MindMap with the Timeline open** — `doc.source_stem` (already known, already flowing into `StudyContext`) turned into a real link for the first time: `/app?source=<stem>&tab=mindmap&right=timeline`.
2. **MindMap → Research Timeline** — a persistent header button, always visible regardless of which Workspace tab is active. Everywhere except the MindMap tab it just switches to the existing Timeline tab in `SidebarRight`. On the MindMap tab specifically (the one place that tab is hidden), it opens the Timeline as a floating dialog over `KnowledgeInspector`, which stays mounted and visible underneath, unaffected.
3. **Chat's evidence panel → Timeline** — clicking an evidence-frame item (not just the inline citation chip) now logs it, closing a real inconsistency between two renderings of the same citation data.
4. **Chat's evidence panel → MindMap node** — when a cited chunk is actually referenced by a mindmap node, a small button jumps straight to it (switches to the MindMap tab, scrolls/selects the node). Absent — not disabled — when no node cites that chunk.
5. **Chat → Summary** — a visible button when a summary exists for the current session.
6. **Timeline (both the tab and the MindMap-mode overlay) → Chat/Evidence** — jumping to a `question` or `evidence` entry from the Timeline now also switches `workspaceMode`/`rightView` so the jump is actually visible, not just a silent context update.

---

## Reused components / infrastructure

- `StudyContext`'s existing `selectEvidence`/`selectNode` (Pack A) — every new navigation dispatches through these, nothing new added to that reducer.
- `Workspace.jsx`'s existing `?source=` query-param convention — extended with two more fields, same pattern, same one-time-initializer contract.
- `MainLayout`'s existing `workspaceMode`/`rightView` switches and `askDirect`/`onHighlight` callbacks — the overlay's jump handlers call the exact same functions Tutor and the citation chips already call, not a second wiring channel.
- `mindmapGraph.js`'s existing graph index (`buildGraphIndex`, already used by `relationsFor`/`headingPath`) — `findNodeByChunk` is a third pure reader over the identical data structure, not a new one.
- `utils/evidence.js`'s existing `citeKey` — now actually used by both real callers instead of being duplicated by each.
- The mobile right-drawer's existing fixed-position/backdrop CSS shape — reused for the MindMap-mode Timeline overlay instead of inventing new overlay chrome.

---

## Build / Tests / Lint

```
npm run build   ->  clean
npm run test    ->  931/931 (was 916 before this pass — 15 real new tests:
                     5 findNodeByChunk, 4 citeKey, 6 workspaceInit)
npm run lint    ->  eslint src: 66 problems (58 errors, 8 warnings) —
                     unchanged from the confirmed baseline, zero new issues
                     across all 11 touched/new files
```

Pre-commit hygiene (same checks as Feature Pack A, run again): `git diff --check` clean (CRLF notices only), terminal-contamination grep zero hits, exactly the 11 intended FE files, zero BE files.

---

## Remaining blockers — documented, not invented around

- **Timeline "Jump" for a `node`-kind entry logged on the StudyMap page still can't navigate there.** Unchanged from Frontend V4's finding: the Workspace page's data model carries only source *stems*, not `document_id`, and `StudyMapView`'s own route needs the latter. This pass adds the *reverse* direction (StudyMap → Workspace, which only needed a stem, which StudyMap already has) — genuinely different from the blocked direction, not a partial fix of it.
- **No paragraph-level jump from a MindMap node or citation.** There is no chunk-to-paragraph-position mapping anywhere in the frontend's data (a citation knows its `chunk_id`, not a scroll offset or DOM anchor in a rendered document view — and there is no rendered "document view" surface in this app to scroll within in the first place). Would need new backend data (a paragraph/offset field) to do for real; not invented around.
- **The MindMap-mode Timeline overlay is a genuine overlay, not a merged three-way view.** While it's open, the Inspector underneath is visible but not interactively usable (the overlay sits on top). This was a deliberate, reviewed trade-off — building a true three-pane MindMap/Inspector/Timeline layout would be a real layout redesign, out of scope for a navigation-only pass.
