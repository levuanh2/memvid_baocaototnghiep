# Independent review — PR #117 & PR #119

Scope: read-only review (no edit/commit/push/merge). Repo `levuanh2/memvid_baocaototnghiep`.

## PR #117 — fix(library): open the Workspace mode a Library action names

Worktree: `.worktrees/p0-library-mode-navigation`. Change: `FE/src/utils/tiepTucHoc.js` `duongDi` adds `tab=summary`/`tab=mindmap` to the `/app` URL it builds, so Library's "Tóm tắt"/"Sơ đồ tư duy" actions land on the right Workspace mode instead of falling into Chat.

**VERDICT: REQUEST CHANGES**

1. `FE/src/study/useOpenSurface.js:23` + `FE/src/pages/Workspace.jsx:36` — **medium** — `tab` is read exactly once, via `useState(() => resolveInitialTab(searchParams.get("tab")))` at mount; nothing re-reads it on a later render. `navigate()` to `/app?...` from a caller that is already mounted on `/app` keeps the same `Workspace` instance (same route, only search params differ) — React Router does not remount, so the new `tab` is silently dropped and the mode never switches.
   - **Failing scenario**: user is on `/app` with Chat open, opens `CommandPalette` (mounted globally in `App.jsx`, available on every route including `/app`), picks a result whose `resume.beMat || last_workspace` is `"mindmap"` or `"summary"` (`CommandPalette.jsx:298`, `moTheoDoi(gioiHan, resume?.beMat || gioiHan.last_workspace || "studymap")`). `useOpenSurface` navigates to `/app?source=x&tab=mindmap`; pathname is unchanged → no remount → `workspaceMode` stays on Chat. This is exactly the bug this PR fixes, reproduced through the one caller that can fire from inside Workspace itself.
   - **Test gap**: the new `library-mode-navigation.spec.js` only enters via `/app/study → /app` (cross-route, remounts fine) and `tiepTucHoc.test.js`/`cauHoiGoiY.test.js` only assert the pure `duongDi()` string. Reverting the `duongDi` fix would not fail any existing test for this path, and the fix as shipped does not actually cover it.
   - **Fix**: have `Workspace`/`MainLayout` react to `searchParams` changes after mount (e.g. an effect on `searchParams.get("tab")` that calls `setWorkspaceMode`), or have `CommandPalette`'s resume action switch the mode directly (it already has the `beMat` value in hand) instead of relying on a URL param that is only ever read once.

No other findings. Verified clean:
- `StudyCard`/`DocumentList` (`/app/study`) and `CommandPalette`'s own direct `duongDi` calls for other surfaces all navigate from a different route than `/app`, so the remount happens and `tab` is read correctly.
- `cauHoiGoiY.js:35` (`BE_MAT = { chat, quiz, studymap }`) never produces `"summary"`/`"mindmap"`, so its callers are unaffected by this change.
- No other code asserts the old (tab-less) `duongDi()` output for summary/mindmap outside the two test files already updated in this diff.
- No changes to quiz/grading, exact-node export, or Library feature-flag behavior.

## PR #119 — fix(mindmap): empty-state "Tạo sơ đồ tư duy" never dead-ends

Worktree: `.worktrees/p0-mindmap-create-fallback`. Change: `MainLayout.openArtifact(tab, {create})`, `SidebarRight`'s artifact-request effect (`handledCreateNonceRef`) calling `createMindmapRef`, and a new `runMindmapGeneration` start guard (`mindmapStartingRef`/`currentMindmapJobIdRef`).

**VERDICT: APPROVE**

No findings. Specifically checked and confirmed sound:

1. **Double-start guard** (`SidebarRight.jsx:477`): `if (mindmapStartingRef.current || currentMindmapJobIdRef.current) return;` is set synchronously before any `await`, so it correctly blocks a second call from any entry point: empty-state create, Guided dialog submit (`submitGuidedMindmap`), the toolbar "Tạo sơ đồ mới" button, "Tạo lại" regenerate (`force: true`), and PR#8 retry. Resumed jobs (`startMindmapPoller` called directly from the mount-time resume effect, `SidebarRight.jsx:427-432`, bypassing `runMindmapGeneration`) are still covered because `startMindmapPoller` itself sets `currentMindmapJobIdRef.current`, which the guard also checks.
2. **Create-once-per-request** (`handledCreateNonceRef`, `SidebarRight.jsx:161-178`): the nonce guard correctly runs `createMindmapRef.current?.()` exactly once per `artifactRequest.nonce`; a later `selectedSources` change re-firing the effect with the same nonce is a no-op. Verified against `SidebarRight.emptyStateCreate.test.jsx`: Guided ON opens the dialog with no legacy job call, Guided OFF starts exactly one `generateMindmap` call even after a selection change, and a view-only request (`create` absent — Tutor "Xem sơ đồ") starts nothing. These tests would fail if the fix were reverted.
3. **Capability-loading dead-end fix** (`MainLayout.jsx:832-833`): `mindmapCreating` now ORs in `createPending`, and `mindmapJobLabel` falls back to "Đang kiểm tra tính năng…" while the capability request is in flight — previously a click during that window parked the intent (`pendingCreateRef`) with zero visible feedback. Confirmed wired through to the rendered panel (`WorkspaceContainer.jsx:63-64`).
4. **Regenerate / Guided submit / resume paths**: all route through the same `runMindmapGeneration`, so they inherit the same guard uniformly; no separate bypass found.

Minor, non-blocking observation: the "waiting_for_capability" / `createPending` branch (click arriving while the capability request is still in flight) is not exercised by `SidebarRight.emptyStateCreate.test.jsx` — all three tests let capability settle before the `create: true` render. Low severity (UI label only, same pre-existing park mechanism as the toolbar button already relied on); not required before merge.

No changes to grading, exact-node export, or Library feature-flag behavior.
