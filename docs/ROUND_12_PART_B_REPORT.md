# Round 12 — Part B implementation report

## Scope

Implemented the Mind Map workspace chrome against the approved reference image. The change is FE-only; the existing BE dirty tree was not staged, reset, or modified.

- Added a compact, real-data map context row inside `MindElixirView`: current map, saved `mindMaps` selector, 40px create action, quality state, regenerate action, saved state, and overflow affordance.
- Threaded the existing `mindMaps`, `setShowModalMap`, and generation handler from `SidebarRight` through `WorkspaceContainer` into the viewer. No hardcoded map records or new API calls.
- Reduced the floating toolbar to zoom, percentage, fit, expand, collapse, with reset/center/relations/export in a menu.
- Removed the centered `mm-generate-cta` from the rendered UI and updated its regression test.
- Moved Knowledge Inspector into an absolute, canvas-local overlay with a narrow edge tab, closed by default. It does not participate in MainLayout flex sizing.
- Removed the active MainLayout Inspector/Timeline replacement path so SidebarRight remains the normal right column, including in MindMap mode.
- Preserved the public MindElixir instance lifecycle, node data, selection, expand/collapse, pan/zoom, save, export, and generation callbacks.

## Verification

- Targeted Part B test: 4/4 passing in `MindElixirView.newControls.test.jsx`.
- Full FE suite: 1067/1067 passing, 92 test files.
- Production build: passed (`vite build`, 2368 modules).
- FE lint: 67 findings (60 errors, 7 warnings), matching the repository baseline in this worktree; no new findings in `SidebarRight.jsx`, `WorkspaceContainer.jsx`, or the Part B test. Existing findings remain in `MindElixirView.jsx` (exported theme constant) and `KnowledgeInspector.jsx` (pre-existing unused parameter).
- `git diff --check`: clean apart from Git's normal LF-to-CRLF notices for the touched FE files.

## Viewport and responsive evidence

The implementation keeps all MindElixir controls inside the existing relative canvas wrapper. The Inspector uses absolute positioning and `pointer-events` gating, so opening/closing it does not change the canvas width. No live local FE/BE server was available in this workspace during this pass, so authenticated screenshots at 1440x1024, 1024x768, and 390x844 were not fabricated and remain an explicit verification gap. The supplied reference images remain the visual source of truth:

- `docs/4f945e04-7c2e-4fc0-ac58-b440c3e560e8.png`
- `docs/b87b5a7b-695c-48ab-ad45-651f80831b25.png`

The test harness verifies the closed-by-default overlay and the real map-list selector structurally. A live dense-graph viewport pass should still be run before release, including node selection, drawer toggle, map switching, save, quality-state updates, mode switching, and return.

## Accepted limitations

Branch color cycling and left/right balance were investigated before this pass and remain unchanged. Exact subtree-size balancing would require precomputing direction in `mindElixirAdapter.js`; it is not part of this implementation. Existing MindElixir zoom/pan behavior is intentionally untouched.
