# Research Workspace V4 — Implementation

Response to the "MemVidX V4 — Research Workspace Experience" epic: workflow/experience, explicitly not another visual pass. One real change shipped, one real dead-end investigated and found genuinely blocked (not deferred out of convenience), the rest reasoned through honestly against the epic's own bar.

Companion docs: `docs/FRONTEND_V3_IMPLEMENTATION.md` (the immediately preceding pass), `docs/PRODUCT_EXPERIENCE_REDESIGN.md` (originally flagged the MindMap→StudyMap gap this pass re-investigated with more context — see §2).

---

## Architecture impact

None new. One existing hook (`useMindMapController.js`) now also calls an existing context method (`useStudyContext().selectNode`) that a structurally parallel screen (`StudyMapView.jsx`) already called. No new component, no new state shape, no new dependency, no new route.

---

## The real finding this pass is built on

Before writing any code, I checked what the epic's 10 categories actually map to in the existing codebase — not by assumption, by grepping. Result: **most of what V4 asks for already exists**, built in an earlier "Phase 4" effort that this session hadn't previously surfaced:

- **`StudyContextProvider.jsx`** — a single app-wide selection store (`selectedDocument`, `selectedTopic`, `selectedEntity`, `selectedQuestion`, `selectionSource`), mounted in `main.jsx` **above** `<Routes>` specifically so it survives route changes. Its own comment states the exact problem it was built to solve: *"đổi route sẽ unmount Provider và tạo lại state rỗng, đúng lỗi mất-lựa-chọn-khi-điều-hướng mà Phase 4 tồn tại để sửa"* (changing route would unmount the Provider and reset state — exactly the lose-selection-on-navigate bug Phase 4 exists to fix). This is, verbatim, epic item 1 (Research Session) and item 6 (Context Preservation).
- **`StudyBreadcrumb.jsx`** — a real breadcrumb component, already wired into both `StudyShell` (Library/StudyMap pages) and `MainLayout`'s header (Chat/MindMap workspace), reading straight from that context. This is epic item 2 (Knowledge Breadcrumb).
- **`useMindMapController.js`** — its own local history/recent-items/breadcrumb system for MindMap browsing (`headingPath`, `recentItems`, back/forward navigation). This is most of epic item 3 (Research Timeline), scoped to MindMap.

**What was missing**: `useMindMapController`'s node-click never told the shared `StudyContext` about it. `StudyMapView.jsx`'s structurally identical node-click already did (`selectNode(id, {source:"mindmap"})`). Two parallel interactions — click a node in MindMap, click a node in StudyMap — had different integration with the rest of the app. Browsing StudyMap updated the global breadcrumb and became visible to every other `useStudyContext` consumer (`KnowledgePanel`, `TutorPanel`, `CommandPalette`, `SummaryPane`); browsing MindMap didn't. This is exactly the epic's stated core problem — "feels like switching applications" — reproduced in one specific, provable spot.

---

## 1. Shipped: MindMap joins the shared research session

**File changed**: `FE/src/hooks/useMindMapController.js` (+13/−1). Commit `295e594`.

**What user problem this solves**: a user exploring the MindMap tab and then switching to Chat, the Tutor panel, or the command palette lost all trace of what they'd just been looking at — the breadcrumb didn't update, and nothing downstream knew a MindMap node was selected. The exact same action in StudyMap didn't have this problem.

**What I did**: `onNodeSelected` now also calls `useStudyContext().selectNode(n.id, { source: "mindmap" })`, immediately after updating its own local `selected` state — same call shape StudyMapView already uses, so both surfaces now behave identically from the shared context's point of view.

**What user problem does it solve**: closes a real, provable inconsistency between two screens meant to feel like the same product. The breadcrumb in the workspace header now reflects MindMap activity the same way it already reflected StudyMap activity.

**What workflow becomes faster**: nothing gets *slower* to check — the actual gain is orientation, not speed: a user who tabs away from MindMap and comes back (or opens the Tutor panel, or the command palette) mid-exploration now finds the app still knows where they were.

**How does this reduce cognitive load**: it removes a "wait, did that register?" moment — one less thing the user has to re-establish mentally after switching surfaces, which is precisely what Growth.Design's Zeigarnik Effect research describes (an unresolved/lost state creates a nagging mental tab; closing that loop, even silently, reduces load the user may not consciously notice missing until it's fixed).

**Which Hallmark principle supports it**: non-destructive, additive integration — reuses 100% existing infrastructure, adds no new UI surface, matches the "don't invent, connect what exists" discipline this whole branch has followed.

**Which Growth.Design principle supports it**: Zeigarnik Effect (above) and Mental Models — a user who has already learned "clicking a node updates where I am" from StudyMap shouldn't have to learn a second, different rule for MindMap.

**How verified**: `npx vite build` clean; `npx vitest run` 911/911; `npx eslint src` — confirmed via a stash A/B test that the true pre-existing baseline is 66 problems (58 errors, 8 warnings; an earlier report in this session cited a stale "65/8" figure, corrected here) and this commit adds zero new lint issues (the touched file has 0 errors before and after, same 1 pre-existing, unrelated `react-hooks/exhaustive-deps` warning both times). Not independently screenshotted — see §4: the live, visible effect (the breadcrumb's "Sơ đồ" segment appearing after a MindMap node click) requires an actual rendered mindmap, which needs document generation the local environment's known, pre-existing `langchain_core.pydantic_v1` limitation blocks. Verified by code review of the exact data flow (`selectionSource` → `StudyBreadcrumb`'s `NHAN_NGUON` map → rendered segment) instead.

---

## 2. Investigated, genuinely blocked (not deferred for convenience): MindMap/StudyMap cross-navigation

Epic item 4 explicitly asks for "MindMap node → StudyMap" as a named cross-navigation path. I checked whether this is a real dead end today: grepped both `MindElixirView.jsx` and `KnowledgeInspector.jsx` for any existing StudyMap link — zero matches, confirmed dead end.

**Why it's not fixed this pass**: read `MainLayout.jsx` to see what would be needed, and found the team already hit this exact wall building a similar feature (the Tutor panel's "Xem sơ đồ"/"Xem tóm tắt" jump). The code's own comment states it plainly: *"Workspace không có `document_id` để gọi `duongDi`"* (the Workspace page doesn't have a `document_id` to call the routing helper) — `StudyMapView`'s route (`/app/study/map/:documentId`) needs a real document UUID; the Chat/MindMap workspace's own data model only carries `selectedSources` (a list of file stems, a different identifier system). The existing workaround for the analogous Tutor case was to switch *tabs* within the same workspace rather than navigate to a new route, specifically because of this gap — not an oversight, a deliberate design constraint the team already worked around once.

This is the epic's own explicit exception: *"if any requested redesign would require backend or pipeline changes, STOP, document the dependency."* Resolving stem→document_id needs either a new network call to an existing (but currently unused-here) endpoint, or a reshaping of how the Workspace page loads its source list in the first place — real work, not a one-line integration fix, and outside what "frontend only, no invented scope" should attempt blind in this pass. Documented, not silently dropped.

---

## 3. The other eight epic items, reasoned honestly

| Item | Status |
|---|---|
| 3. Research Timeline (recent questions/evidence/concepts, session-only) | Partially exists (MindMap's own `recentItems`, §0), not exposed anywhere outside the MindMap tab. Building a cross-surface timeline UI is real, additive work — not attempted this pass; the one-line integration fix in §1 is the prerequisite that makes a future cross-surface timeline possible (it needs the shared context to actually know about MindMap activity, which it now does). |
| 4. Cross Navigation (the rest of it — Evidence→paragraph, paragraph→MindMap node, StudyMap→source paragraph, source paragraph→Chat) | Not audited this pass beyond the MindMap↔StudyMap link in §2. Each of the other four links needs its own real-code check (does the data even exist to support the jump?) before claiming anything — not done blind. |
| 5. Knowledge Evolution (today's discoveries, recently understood, needs review, mastered) | Already substantially built — `LearningDashboard.jsx`'s review queue (today/tomorrow/later spaced-review buckets) and `chiaMuc()`'s "recently studied" sorting, both confirmed real in earlier passes this session (`MEMVIDX_SIGNATURE_SYSTEM.md` §5-6). No new gap found this pass to act on. |
| 7. Interaction Polish (hover/selection/focus/loading/transition/feedback) | Not audited this pass — this is the same category of work as V3's Priority 1/2 (would need its own per-surface read to find real, not invented, gaps). |
| 8. Power User Workflow (keyboard nav, quick actions, context menu, command palette, fast switching) | `CommandPalette.jsx` already exists and already consumes `useStudyContext` (confirmed in §0's grep) — meaning it already has some awareness of current selection. Whether it does anything useful with MindMap-sourced selection specifically was not checked this pass. Real candidate for a focused next pass, not touched here. |
| 9. Discovery (coach marks, first-use hints) | Not implemented — this is a net-new UI feature with no existing infrastructure found this pass. Same category as V3's declined "5 signature interactions": a real product decision (what to teach, when, how intrusively) that shouldn't be invented mid-implementation. |
| 10. Product Identity | Not a discrete piece of work this pass — it's the cumulative effect of every fix across V2/V3/V4 that closes a real inconsistency, including §1. |

---

## 4. Screenshots

None captured this pass. The one shipped change's visible effect (a breadcrumb segment appearing on MindMap node click) requires a rendered mindmap, blocked by the same pre-existing local-environment limitation documented in every prior pass this session (`langchain_core.pydantic_v1` missing, blocks the query/generation graph locally). Verified by code review of the exact data path instead of a live render — stated as a limitation, not implied as covered.

---

## 5. Build / Lint / Tests

```
npx vite build   ->  clean
npx vitest run   ->  911/911 tests, 72/72 files
npx eslint src   ->  66 problems (58 errors, 8 warnings) -- confirmed via git-stash
                     A/B that this is the TRUE pre-existing baseline (an earlier
                     report this session cited a stale "65/8"); this pass's one
                     commit adds zero new issues.
```

---

## 6. Remaining limitations

1. Cross-navigation beyond MindMap↔StudyMap (§2) — not audited.
2. A cross-surface Research Timeline UI — the data plumbing prerequisite (§1) now exists; the UI itself doesn't.
3. Interaction polish, Discovery/coach-marks, and the deeper Power User Workflow integration — none audited or implemented this pass, each needs its own real-code read first.
4. The `document_id` gap in Workspace's data model (§2) is real infrastructure debt worth fixing on its own — it blocks not just this cross-nav link but potentially other future StudyMap-from-Workspace features.
5. No live screenshot of the one shipped change (§4) — code-review-verified only, due to the same pre-existing local-generation limitation noted in every pass this session.

---

## 7. Git

- **Branch**: `release/p0-p0.5-verification`
- **Commit this pass**: `295e594` (`feat(ui): mindmap node selection joins the shared research session`)
- **Build**: clean
- **Tests**: 911/911
- **Lint**: 66/8, unchanged by this commit
- **Pushed**: pending this document's commit (below)
- **Merge**: none
- **PR**: none
