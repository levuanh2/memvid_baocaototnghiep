# StudyMap Workspace V3 — QA Round 2

Follow-up hardening pass on `feature/studymap-workspace-v3`, run against real
authenticated production data (QA account) through a local Vite dev-proxy
(not committed — see below). Continues from `docs/STUDYMAP_WORKSPACE_V3_REPORT.md`.

## Branch / commits

- Branch: `feature/studymap-workspace-v3`
- New commits this round: `b26ea66`, `dc573fc`, `f6021a7` (2 fixes + 1 test commit)
- No merge to `main`, no deploy, no push of anything beyond this branch.

## Bugs found and fixed

1. **Map-library selection silently broken** (`MainLayout.jsx`). The Mind Map
   overlay branch only rendered `<ContextInspector>` (SidebarRight — owner of
   `fetchMindMaps`/generation/the library's `onSelect`) inside
   `rightOpen && (...)`. `rightOpen` starts `false` (closed-by-default is a
   spec requirement), so SidebarRight never mounted until a node was already
   selected — selecting a map closed the popover but loaded nothing.
   Root-caused via a `git stash` A/B test against the original code. Fixed by
   unifying overlay/rail/drawer into one always-mounted `<aside>`, hiding the
   closed overlay via CSS only.

2. **Background pan didn't work** (`MindElixirView.jsx`). Dragging empty
   canvas space never moved the viewport — confirmed via
   `getComputedStyle('.map-canvas').transform` being byte-identical
   before/after a real drag. Root cause is inside mind-elixir 5.13.0 itself:
   its pointerdown handler hardcodes left-button-on-`.map-container` to a
   `BoxSelect` state regardless of the app's `mouseSelectionButton: 2`
   config, and `BoxSelect` has no `pointermove` case — a silent dead end.
   Fixed by driving the library's own public `move(dx, dy)` from a listener
   on the canvas wrapper, gated to skip drags starting on a node
   (`<me-tpc>`), so node drag/reparent is untouched.

## Verified live (Playwright + Brave, real production data)

- Map-library selection loads real map data, connectors render correctly.
- Node drawer closed by default, doesn't consume canvas width; opens as a
  320px floating overlay on node click without shifting the canvas
  transform; close button hides it via CSS (still mounted).
- Background drag pans the viewport (transform delta matches cursor delta
  exactly); a drag starting on a node does not pan, and does not reparent
  below mind-elixir's own drag threshold.
- Viewport preserved (identical `.map-canvas` transform) across: node
  select/open/close drawer, expand/collapse all, theme toggle, mode switch
  away and back, fullscreen on/off.
- Source filter popover: opens on trigger, closes on Escape and
  outside-click; search box narrows/restores the visible source list.
- Responsive: 1440×1024 and 1024×768, light + dark, all render cleanly (no
  horizontal scroll, no broken wrapping, theme tokens apply consistently).
  Mobile 390×844: chat default view clean; switching to Mind Map mode,
  selecting a source, opening a map, and tapping a node all work — the node
  drawer renders as a bottom sheet (drag handle, backdrop, same
  KnowledgeInspector content as desktop) matching the mobile mock's pattern.

## Not fixed this round (documented, not hidden)

- **Map A↔B switch**: only one real mind map exists on the QA account.
  Testing a true switch would require generating a second real map (a paid
  backend job) — not triggered without explicit approval. BLOCKED, not
  faked.
- **Node-drawer header chrome**: the drawer shows a generic "Chi tiết sơ đồ"
  panel title (`SidebarRight.jsx`) stacked above KnowledgeInspector's own
  "Trình khám phá tri thức" nav-bar label, then the node's own title — three
  stacked header rows where the approved mock shows one (the node's title
  directly). Functionally equivalent (nav history + node identity are both
  real, useful chrome), but visually more cluttered than the mock. Left
  as-is this round: fixing it touches shared chrome used by all three modes
  (mindmap/summary/chat), which is more scope than this QA pass' fix budget.
- **Evidence/links section wording**: app uses "Bằng chứng" / "Liên hệ"
  (`KnowledgeInspector.jsx`), the mock's demo data shows "Nguồn trích dẫn" /
  "Liên kết". Kept the app's existing wording — it's the same term used
  consistently in the chat mode's evidence panel ("Bằng chứng câu trả lời"),
  and changing it here would break that cross-mode consistency for the sake
  of matching one demo screenshot's placeholder copy.
- **Canvas legend**: current legend explains interaction affordances (drag
  hints, node-type markers); the mock's legend maps branch colors to
  category names for that specific demo map. Different concept, not a
  literal mismatch — left as-is (V2-preserved "stable branch colors"
  invariant, out of this pass' explicit scope).
- **Mobile floating toolbar position**: zoom/fit controls sit top-left on
  mobile (same as desktop); the mobile mock places them bottom-left for
  thumb reach, with an additional bottom-right round "open library" button
  not present in the current mobile layout. Cosmetic/ergonomic gap, not a
  functional break — not fixed this round.

## Automated tests

4 new files added (`MainLayout.contextInspectorMount.test.jsx`,
`MindElixirView.backgroundPan.test.jsx`, `MindElixirView.lifecycle.test.jsx`,
`SidebarLeft.filterPopover.test.jsx`). The two regression tests were verified
to fail against the pre-fix code (`git stash` of the two fix commits), so
they're real regression guards, not tautologies.

- Full suite: **1086/1086 pass** (was 1077 before this round; +9 net new
  tests across the 4 files, all passing).
- `src/components/Layout/`: 19/19 pass.
- `src/components/mindmap/`: 12/12 pass.

## Build / lint

- `npm run build`: pass, no warnings beyond the pre-existing
  browserslist-data notice.
- Changed-file lint (`MainLayout.jsx`, `MindElixirView.jsx`, all 4 new test
  files): 0 new problems. `MindElixirView.jsx` line 42 has a pre-existing
  `react-refresh/only-export-components` error unrelated to this round's
  edit (verified via `git stash` — present before and after).
- Full repository lint: **66 problems (60 errors, 6 warnings) — baseline
  unchanged.** This worktree's own pre-existing baseline (before this
  round's edits) was already 66/60/6, two errors above the
  `docs/STUDYMAP_WORKSPACE_V3_REPORT.md`-stated 64/58/6 from earlier
  commits in this branch's history — that drift predates this round and
  isn't touched here.
- `git diff --check`: clean, no whitespace errors.

## QA-only local aids (not committed)

- `FE/vite.config.js` had a temporary `server.proxy` block
  (`/api-proxy` → `https://api.studymap.space`) to authenticate real
  production data from local dev without touching backend CORS. Reverted
  before committing (`git checkout -- FE/vite.config.js`).
- `FE/.env.local` (`VITE_API_URL=/api-proxy`) — gitignored by `*.local`
  (never staged), contained no credentials, deleted after QA.
- Confirmed via `git status --short` / `git diff --stat` on every commit in
  this round that neither file, nor any credential, entered the diff.

## Status

Implementation candidate pushed — visual and automated QA passed for the
items above; production Gate B pending. Map A↔B switch verification and the
four cosmetic/IA items listed above remain open, explicitly not claimed as
done.
