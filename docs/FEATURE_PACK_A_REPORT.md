# Feature Pack A — Research Timeline

Real implementation, reviewed and approved by Codex (BE workstream owner, coordinated throughout via Herdr) before design work started and again before commit — see the design/approval exchange this session for the full back-and-forth. Not an audit, not a proposal.

---

## What this is

A session-scoped, in-memory log of the six kinds of thing a user does while researching a document — ask a question, open a citation, visit a MindMap node, visit a StudyMap concept, look at a topic/entity, open a summary — surfaced as a third tab ("Dòng thời gian") in the existing right sidebar, next to Evidence and Tutor AI. Every entry supports one real "Jump" action that reuses the app's existing selection/navigation machinery; nothing is simulated.

## Architecture — reuses, does not duplicate

This app already has a mature, app-wide selection store: `StudyContextProvider` (mounted above `<Routes>` in `main.jsx` specifically so it survives navigation), backed by a pure reducer (`studySelection.js`) that "only stores IDs/keys, never a second copy of the full object" (the module's own long-standing documented rule). Six actions already existed before this feature: `selectTopic`/`selectEntity`/`selectSummary`/`selectNode`/`selectQuestion`, plus the new `selectEvidence` this feature adds as the sixth, mirroring the other five exactly.

**The Timeline is not a new state system.** Every one of those six actions now also appends a bounded entry (`{kind, id, label, source, at}`) onto a `history` array living inside the *same* reducer state — the exact same append-only pattern `useMindMapController` already used locally for its own `recentItems`, just promoted to the whole app. Nothing about the six actions' existing behavior changed; they do one more thing (log) on top of what they already did.

## What was added

| File | Change |
|---|---|
| `FE/src/study/studySelection.js` | `history: []` + `selectedEvidence: null` added to the empty state (9 → 11 fields). `chonEvidence` (6th action, mirrors the other 5). `xoaLichSu` — a **separate** reducer action for clearing the timeline, distinct from `xoaLuaChon` (which clears one current-selection pointer, not a log). History capped at 50 entries, FIFO. `chonDoc` (document switch) resets history for free, since it already resets the whole state object — a stale "visited node X" entry pointing at a document that's no longer open would be actively misleading. |
| `FE/src/study/studySelection.test.js` | The pre-existing "exactly 9 fields, nothing else" assertion was rewritten to assert 11 — an intentional, expected red-then-green, not a hidden regression (per this repo's own lessons-learned rule: changing behavior means the old test *must* go red first). 5 new tests added (12 total, was 7): per-action history append, reselecting the same id still logs a new entry (the log records actions, not "what's currently selected"), the 50-entry cap, `chonDoc` wiping history, and `xoaLichSu`'s own two cases (clears / no-ops when already empty). |
| `FE/src/study/StudyContextProvider.jsx` | Exposes `selectEvidence` and `clearHistory`, wired to the two new reducer functions. No change to the five existing callbacks. |
| `FE/src/hooks/useMindMapController.js` | `onNodeSelected` now also calls the shared context's `selectNode` with a `label` (the node's title) — the fix from the immediately preceding pass, extended with a label so timeline entries are readable. Adds `canJumpTo(id)`: a capability check (does the *currently loaded* mindmap's sidecar contain this id?) so the Timeline can render "Jump" as genuinely disabled for stale or StudyMap-only entries instead of a dead click. |
| `FE/src/pages/study/StudyMapView.jsx` | One line: threads `label: nodeDatum.name` into its pre-existing `selectNode` call. No new call site. |
| `FE/src/components/Layout/ChatArea.jsx` | Two new, real integration points — this was the one surface that never touched Study Context before this feature. (1) `selectQuestion` fires once, inside `handleSend`, at the moment a question is actually submitted (not on every keystroke, not for a suggestion merely filled into the composer). (2) A new `onEvidenceOpen` fires **only** from a citation's click/keypress, never its hover (hover already drives the existing, unlogged, transient `onHighlight`) — deliberately, to avoid flooding the timeline with every citation the cursor happened to cross. |
| `FE/src/components/Layout/SidebarRight.jsx` | New third tab, same `pill-tab` weight and `aria-pressed` semantics as the existing two (not the demoted `pill-tab--sub` style used for the *inner* artifact sub-tabs — this is a peer view-switch, not a sub-section). Renders `ResearchTimeline`, wiring its jump callbacks to the exact same `askDirect`/`onHighlight`/`onRightViewChange` this component already receives — no second wiring channel. |
| `FE/src/components/Layout/MainLayout.jsx` | One new callback, `onJumpToMindMapNode`: switches the workspace to the MindMap tab, then calls the controller's `jumpTo` on the next paint (`requestAnimationFrame`) — necessary because `MindElixirView` stays permanently mounted but CSS-hidden between tab switches (by design, to avoid re-initializing the canvas), and a `display:none` element has no layout box to scroll into until it's actually visible. `mindMapController` and this callback are threaded down to `SidebarRight`. |
| `FE/src/components/study/ResearchTimeline.jsx` (new) | The panel itself. Reads `history` and dispatches Jump via the six existing `select*` actions — owns no selection state of its own, only local UI state (search text, expanded/collapsed), per the reviewed plan. |

## Design decisions made explicitly, not silently

**Jump, Highlight, and Focus were consolidated into one action per entry**, not three. In every existing part of this app, selecting something already means select + highlight + scroll-to-it as one gesture — a MindMap node click, a StudyMap node click, and a citation click all already work this way. Three separate buttons per timeline entry would have been three names for the same behavior, not three real capabilities. Flagged and agreed with Codex before implementation, not discovered after the fact.

**"Jump" is honest about what it can't do.** A timeline entry's Jump button is disabled — with a `title` and `aria-label` stating the specific reason, native HTML `disabled` (which blocks both click and keyboard activation as one mechanism) — when there's genuinely nowhere to go:
- A `node` entry whose id isn't in the *currently loaded* mindmap (the map was regenerated, or — since `StudyMapView`'s node clicks log under the same `source: "mindmap"` tag, because both are diagram surfaces conceptually, but Workspace has no access to StudyMap's own separate canvas — the entry came from the StudyMap page). Checked via `canJumpTo`, which reads the mindmap's own per-node sidecar `Map` — confirmed by reading `mindElixirAdapter.js`'s build loop directly that every node gets a sidecar entry unconditionally, not assumed.
- A `topic`/`entity`/`summary` entry — there's no real jump target for these anywhere in the current UI yet. Rather than fake one, they render as visited-but-not-navigable, honestly labeled.

Real, working Jump exists for `question` (refills the Chat composer via the existing `askDirect` channel — the same one the Tutor panel already uses) and `evidence` (switches to the Evidence tab and highlights the citation via the existing `onHighlight` mechanism).

## Verification

```
npm run build   ->  clean
npm run test    ->  916/916 (was 911 before this pass — 5 real new tests, listed above)
npm run lint    ->  eslint src: 66 problems (58 errors, 8 warnings) — the confirmed
                     baseline from the prior pass, unchanged; zero new issues across
                     all 9 touched files plus the 1 new file.
```

**Duplicate-dispatch check** (requested explicitly before approval): traced every new call site for whether one user action could fire twice. Question logging happens once inside `handleSend`'s async body — not inside an effect, not subject to React StrictMode's dev-only double-invoke (that only affects effects/certain lifecycle hooks, not a function called directly from a click handler). Citation-open fires from `onClick` XOR `onKeyDown` — mutually exclusive for any single real interaction. The MindMap/StudyMap node-select integrations were extended in place (one new field or one new trailing line added to an *existing* single call), not duplicated. No new path found where one user action produces two log entries.

**Hygiene, checked before staging**: `git diff --check` clean (only expected CRLF-normalization notices, not real whitespace errors). Diffed and grepped for the terminal-contamination string that leaked into two earlier Herdr messages this session (a Windows `LABEL` command accidentally triggered by backticks in a shell-passed string) — confirmed it never touched any source file, only the chat transcript. Confirmed exactly 9 FE files plus this doc staged; zero BE files.

## What this deliberately doesn't do

- No backend persistence — session-only, exactly as specified. A page reload clears the timeline (same as every other piece of `StudyContext` state).
- No live screenshot of the panel — the local environment's known, pre-existing `langchain_core.pydantic_v1` limitation (documented since `docs/FINAL_RELEASE_STATUS.md`) blocks real chat answers and mindmap generation, so there's no way to populate the timeline with real activity and render it in this environment. Verified by code review and the test suite instead of a live capture — stated as a real limitation, not glossed over.
- Topic/entity/summary entries have no Jump target yet (see above) — visible in the timeline, honestly non-navigable.
- StudyMap-visited nodes aren't jumpable from within the Chat/MindMap workspace (see above) — a real architectural gap (Workspace has no `document_id` to route to StudyMap's own page), not new to this pass; already documented in `docs/RESEARCH_WORKSPACE_V4.md`.

## Git

- **Branch**: `release/p0-p0.5-verification`
- **Files**: the 9 listed above, plus this report
- **Build**: clean · **Tests**: 916/916 · **Lint**: 66/8 (unchanged baseline)
- **Merge**: none · **PR**: none
