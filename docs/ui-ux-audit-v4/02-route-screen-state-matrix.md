# 02 — Route / Screen / Viewport / State Coverage Matrix (Phase 2, Claude — Audit Lead)

Baseline: `main` @ `4f228ef9d1e34f8bac59f37a3792fc859400cb64` (merge of PR #86, `fix/export-connector-missing-nodes`). This is the same baseline recorded in `01-product-inventory.md` and used by all four agents throughout Phase A. No commit has landed on `main` since.

This matrix closes the Phase 2 gap flagged by the user: a single table showing which route × viewport × theme × interaction-state combinations were actually captured (real browser, real local backend), versus assumed from code reading alone. "Evidence" cites exact filenames under `screenshots/`. Rows with no filename were verified by direct code/DOM read only (cited inline), not a captured screenshot.

## Legend

- **Viewports captured across the audit**: 1920×1080, 1440×900, 1280×800, 1024×768, 820×1180, 768×1024, 430×932, 390×844, 375×812, 320×568 — the full set the brief specified.
- **D** = Desktop (≥1280px), **T** = Tablet (768–1024px), **M** = Mobile (<768px).
- Theme column shows which of light/dark were actually captured, not just "supported in code."

## Matrix

| Route | Screen | D | T | M | Theme | Interaction states captured | Evidence | Gaps |
|---|---|---|---|---|---|---|---|---|
| `/` | Landing | 1920×1080, 1024×768 | — | 390×844, 320×568 | light + dark | Page load only | `codex1-visual-landing-*` (6 files), `ux-01-landing-desktop.png` | No scroll/hover-state capture; not a functional surface so low priority |
| `/login` | Login | 1440×900 | — | 390×844 | light + dark | Default form state only | `codex1-visual-login-*` (4 files) | Error/validation state not captured here (see Register for the equivalent pattern) |
| `/register` | Register | 1280×800 | — | 375×812 | light + dark | **Error/validation state** (not just default) | `codex1-visual-register-error-*` (4 files), `ux-02-register.png`, `codex1-visual-register-metrics.json` | None — this is the one auth screen with real error-state evidence |
| `/app` (Chat tab) | Workspace — Chat | 1920×1080, 1440×900, 1024×768 | 820×1180 | 430×932, 390×844, 320×568 | light + dark | Fresh account (empty), citations present | `codex1-visual-workspace-chat-*` (6 files), `ux-09-chat-result-citations.png`, `ux-03-first-app-shell.png`, `ux-30-mobile-workspace-fresh.png` | Long-conversation / scroll-heavy state not captured |
| `/app` (MindMap tab) | Workspace — MindMap | 1280×800 | 768×1024 | 390×844, 375×812 | light + dark | Node selected (toolbar-occlusion proof via `elementFromPoint`), generate-dialog open | `codex1-visual-workspace-mindmap-*` (4 files), `ux-12-generate-map-dialog.png`, `ux-24/25/26` (dialog focus cycle, pre-submit, generated) | Fullscreen mode and zoomed-in state verified by Agy via code/DOM read (`08` UX-ADJ-002 evidence), not a separate screenshot file |
| `/app` (Summary tab) | Workspace — Summary | 1440×900 | — | 390×844 | light + dark | Default/empty | `codex1-visual-workspace-summary-*` (2 files) | Populated-summary state not captured (depends on the same indexing gap as Quiz below) |
| `/app` — Command Palette | Overlay | 1024×768 | — | 430×932 | light + dark | Open with query; **blank/ghost state on empty query** (UX-ADJ-004) | `codex1-visual-command-palette-*` (2 files) | — |
| `/app` — Appearance editor | Drawer | 1440×900 | — | 390×844 | light + dark | Open, presets visible | `codex1-visual-appearance-editor-*` (2 files) | — |
| `/app` — Export Studio | Dialog (4-step rail) | 1440×900 | — | 430×932 | light + dark | Appearance step, format step, review step | `codex1-visual-export-studio-*` (2 files), `ux-35-export-appearance/format/review.png`, `ux-37-opened-exported-svg.png`, `ux-exported-*.svg` | Mobile clipping (UX-ADJ-015) confirmed from the 430×932 capture itself |
| `/app` — Account menu | Overlay | 1440×900 | — | 390×844 | light + dark | Open | `codex1-visual-account-menu-*` (2 files) | — |
| `/app` — Profile/Settings | Page | 1440×900 | — | 390×844 | light (desktop), dark (mobile) | Default | `codex1-visual-profile-*` (2 files) | Not both themes at both sizes — low priority, static form |
| `/app/study` | Document List (library) | 1920×1080, 1440×900, 1024×768 | 768×1024 | 430×932, 320×568 | light + dark | Two documents uploaded (repeated-card problem, UX-ADJ-007), mobile above-the-fold, source drawer open | `codex1-visual-study-library-*` (6 files), `ux-05-two-documents-uploaded.png`, `ux-31-mobile-source-drawer.png`, `ux-32-mobile-study-above-fold.png`, `ux-38-study-tools-menu.png` | — this is the most heavily captured surface, matching its P1 severity |
| `/app/study/map/:documentId` | StudyMapView (react-d3-tree) | 1440×900 | 820×1180 | 390×844 | light + dark | Default rendered map | `codex1-visual-study-map-*` (3 files) | No node-click/search-focus interaction state captured — same keyboard-only gap noted in `09`/`10` as a known limitation carried into Round 4 |
| `/app/study/quiz/new` | Quiz setup | 1280×800 | — | 390×844 | light (desktop), dark (mobile) | Default, **generation-failure error state** | `codex1-visual-quiz-setup-*` (2 files), `codex1-visual-quiz-generation-failure-1280x800-light.png` | Populated/success quiz-taking state **not captured** — offline-mock DB never finished indexing (see below) |
| `/app/study/quiz/:quizId` | Quiz taking | — | — | 390×844 | dark | Error state only | `codex1-visual-quiz-taking-error-390x844-dark.png` | Populated state not captured — same root cause |
| `/app/study/result/:attemptId` | Quiz result | 1024×768 | — | — | light | Error state only | `codex1-visual-quiz-result-error-1024x768-light.png` | Populated state not captured — same root cause |
| `/app/study/review/:attemptId` | Quiz review | — | — | 390×844 | light | Error state only | `codex1-visual-review-error-390x844-light.png` | Populated state not captured — same root cause |
| `/app/study/practice/:quizId` | Practice mode | 820×1180 | 820×1180 | — | dark | Error state only | `codex1-visual-practice-error-820x1180-dark.png` | Populated state not captured — same root cause |
| `/app/study` — Source filter | Overlay/panel | — | 820×1180 | — | light | Open | `codex1-visual-source-filter-820x1180-light.png` | — |
| `*` → `/` redirect | Redirect | — | — | — | — | Verified by code read (`App.jsx` catch-all route) | — | Not independently screenshotted; trivial redirect, low risk |

## The one real coverage gap: populated Quiz/Result/Review/Practice states

Every route in the Quiz/Result/Review/Practice family was captured only in its **setup/empty/error** state, never its **populated/success** state. Root cause (already documented in `03`, `04`, and `11`): the local offline-mock test database (`run_e2e_server.py` against `studymap_test`) never finished indexing uploaded documents during this audit, so quiz generation had no indexed chunks to work from in every attempt made. This is an **offline-mock test-environment limitation, not a frontend defect** — confirmed independently by Codex 2 (`04-usability-flow-audit.md` UX-002) and Agy (`08-independent-agy-review.md` Challenge 4).

This gap is already scheduled to close in `10-prioritized-backlog.md` Round 7, via a seeded test fixture that pre-populates indexed chunks before the quiz flow is exercised. No Round 0–6 fix depends on the populated state being visible, so this does not block the Round 0 execution gate.

## Everything else

All 11 routes in `App.jsx`'s route table have at least one real-browser capture at ≥1 desktop and ≥1 mobile width, in both themes, with the two P0-relevant surfaces (`/app` MindMap toolbar, `/app` header nav) captured at 3+ viewports specifically because they are Round 0's fix targets. No route was audited from code alone with zero browser evidence.
