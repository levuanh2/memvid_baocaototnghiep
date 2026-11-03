# Re-review — PR #117 after commit 464735a

Worktree: `.worktrees/p0-library-mode-navigation`. Read-only.

Commit `464735a` "fix(workspace): apply ?tab= on in-app navigation too" addresses the r1 finding (CommandPalette-while-on-`/app` navigation left `workspaceMode` stale because `tab` was only read once at mount). Change: `Workspace.jsx` now passes `requestedWorkspaceMode={resolveInitialTab(searchParams.get("tab"))}` (recomputed every render, since `useSearchParams()` subscribes to location) to `MainLayout`; `MainLayout` adds `useEffect(() => { if (requestedWorkspaceMode) setWorkspaceMode(requestedWorkspaceMode); }, [requestedWorkspaceMode])`.

**VERDICT: APPROVE**

No findings. Checked specifically for the three risk areas asked about:

1. **Loop between the new effect and the existing mode→URL effect** (`MainLayout.jsx:114-126`, unchanged by this commit): traced the full round-trip —
   - User/palette-driven `setWorkspaceMode(X)` (internal state) → mode→URL effect fires (dep `workspaceMode`), `current !== X` → `navigate({...tab:X}, {replace:true})`.
   - That `navigate` updates the router location → `Workspace` re-renders (it subscribes via `useSearchParams()`) → `requestedWorkspaceMode` recomputes to `X` (the value that was just written) → new effect fires (dep `requestedWorkspaceMode` changed) → `setWorkspaceMode(X)` — already `X`, same primitive value, React bails out (`Object.is` same-value), no re-render, no further effect run.
   - Converges in exactly one extra round-trip, every time, regardless of which side (manual click, auto-switch, or an external `navigate()` from CommandPalette) initiated the change. `resolveInitialTab` (`workspaceInit.js:16-19`) always returns one of `"chat"/"mindmap"/"summary"` (never `null`/`undefined`), so the new effect's `if (requestedWorkspaceMode)` guard is always satisfied — no edge case where it's skipped unexpectedly, and none where it fires with a falsy/invalid value.
   - A CommandPalette navigation (push, not replace) also converges the same way: picking a mindmap result pushes `tab=mindmap` → `requestedWorkspaceMode` becomes `"mindmap"` → `setWorkspaceMode("mindmap")` → mode→URL effect checks `current ("mindmap" from the push) === workspaceMode ("mindmap")` → returns immediately, no extra navigate. No double history entry, no loop.

2. **Auto-switch on new map/summary** (`MainLayout.jsx:129-143`, `hadMindmapRef`/`hadSummaryRef` null→non-null guards, unchanged by this commit): these call `setWorkspaceMode` directly and are independent of the `requestedWorkspaceMode` prop — they don't change Workspace's `searchParams`, so the new effect does not re-fire synchronously in the same commit and cannot race or override an auto-switch mid-flight. The auto-switch's own `setWorkspaceMode` call then flows through the same mode→URL→re-render→prop-echo round-trip described in (1), which converges back to the *same* mode the auto-switch picked — it is never fought or reverted.

3. **Tests mounting `MainLayout` alone**: grepped all ten (`MainLayout.*.test.jsx`, e.g. `modeTabs`, `workspaceShell`, `guidedReveal`, `sidebarRightMount`, …) — none passes `requestedWorkspaceMode`, so it is `undefined` in every one, the new effect's guard (`if (requestedWorkspaceMode)`) short-circuits, and `setWorkspaceMode` is never called from it. Fully backward compatible; no existing assertion about `workspaceMode` in these files can be affected by this diff.

New e2e case (`library-mode-navigation.spec.js`, "Command Palette 'Tóm tắt' while already on /app switches to Summary mode") directly reproduces the original r1 scenario and additionally asserts a manual tab click right after still works and clears `tab=` from the URL — this is exactly the "does a later click get overridden" check and it passes, confirming (1) empirically as well as by trace.

**Informational, not a finding** (explicitly out of scope for this re-review, and pre-existing/documented by design): `selectedSources` (from `?source=`) is still read only once at Workspace mount (`Workspace.jsx:18-21`, comment explicitly says this is intentional — "sau đó cột trái làm chủ lựa chọn"), so a CommandPalette/in-app navigation that changes `source=` without changing `tab=` still won't re-select the source column. This is unrelated to the `tab`/mode loop this commit fixes and was not part of what either review was asked to check.
