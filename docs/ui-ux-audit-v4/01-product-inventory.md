# 01 — Product Inventory (Phase 0/1, Claude — Audit Lead)

Baseline: `main` @ `4f228ef9d1e34f8bac59f37a3792fc859400cb64`. Worktree
`E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\ui-ux-audit-v4`, branch
`docs/ui-ux-audit-v4`. Live app for this audit: FE `http://localhost:5180`
(real routes, real app — not a fixture harness), BE `http://127.0.0.1:8090`
(real Flask routes/auth/DB against test Postgres, AI providers mocked,
100% offline/deterministic — `BE/scripts/run_e2e_server.py`). Read-only
audit; no app code changed.

## 0. Critical context found before anything else — read this first

This is **not** a greenfield design review. The codebase already carries a
large amount of prior, documented design-decision history:

1. **A full redesign was already attempted and partially reverted.**
   `docs/UI_AUDIT_V2.md`, `DESIGN_TOKEN_AUDIT.md`,
   `VISUAL_IDENTITY_WORKSPACE_REDESIGN.md`, and `UI_IMPLEMENTATION_PLAN.md`
   describe a "Paper & Graphite" redesign — seal-red/forest/bronze accents,
   warm paper background, a named "MemVid Signature Contract" — planned and
   implemented across several rounds. Git history on these same files shows
   later commits titled things like *"record the forest-to-blue accent
   decision and resolution"* and *"record the fourth-pass root-cause
   investigation, honestly"*. **Live code right now does not match those
   docs**: `FE/src/index.css` currently defines `--accent: #126CF2` (blue),
   `--bg-base: #F4F8FC` (cool), `--text-primary: #102A5D` (navy) — not the
   seal-red/warm-paper system those docs describe as current. A stray
   comment at `index.css:511` still reads `--accent flips to forest
   (Signature Contract §1/§7)`, i.e. code that still *references* the old
   contract's logic. **Working hypothesis, to be verified with live
   evidence by Codex 1/Agy, not assumed true**: the user's own complaint
   ("not cohesive", "some components look unfinished") may be a direct,
   measurable symptom of this redesign being interrupted/reverted partway
   through, leaving a hybrid of two systems rather than either one
   fully realized.
2. **The app has already been through many iteration rounds** —
   `MainLayout.jsx` alone has inline comments citing "Round 11 (mockup
   parity, explicit user decision)", "Feature Pack B (Cross Navigation)",
   "Phase 6/7" (route-splitting, Command Palette). The `docs/` root lists
   `FEATURE_PACK_A/B/C/D_REPORT.md`, `SPRINT_F/G/H_REPORT.md`,
   `MINDMAP_WORKSPACE_V2_REPORT.md`, `UI_MIGRATION_WAVE_REPORT.md`, and
   more — a long paper trail of deliberate, individually-reasoned past
   changes, not accidental drift. Findings in this audit should cite
   whether a given rough edge is a *fresh* observation or something these
   past rounds already discussed and chose to accept as a tradeoff —
   Codex 1/2/Agy should check this docs root before calling something a
   "new" finding.
3. Per the brief's own instruction, **this audit trusts live current code
   and rendering over any of the above historical docs** — the history is
   context for root-cause hypotheses, not ground truth about today's app.

## 1. Routes (`FE/src/App.jsx`)

Two **separate, route-level-disconnected** trees, bridged by exactly one
named entry point:

| Path | Page | Auth | Notes |
|---|---|---|---|
| `/` | `Landing` | public | eager-loaded (first paint for every anonymous visit) |
| `/login` | `Login` | public | lazy |
| `/register` | `Register` | public | lazy |
| `/app` | `Workspace` (→ `MainLayout`) | protected | chat / mindmap / summary workspace |
| `/app/chat` | redirects to `/app` | protected | legacy alias |
| `/app/study` | `DocumentList` | protected | **separate route tree** |
| `/app/study/map/:documentId` | `StudyMapView` | protected | separate tree |
| `/app/study/quiz/new` | `QuizSetup` | protected | separate tree |
| `/app/study/quiz/:quizId` | `QuizTaking` | protected | separate tree |
| `/app/study/result/:attemptId` | `QuizResult` | protected | separate tree |
| `/app/study/review/:attemptId` | `ReviewGuide` | protected | separate tree |
| `/app/study/practice/:quizId` | `Practice` | protected | separate tree |
| `*` | redirect to `/` | — | |

**IA finding (confirmed, code-read)**: `/app` (the AI workspace: chat,
mind map, summary) and `/app/study/*` (document list, quiz, review,
practice) are two independently-mounted route subtrees with **no shared
layout component** — each lazy-loads and mounts its own page shell. The
only bridge is one header `<Link to="/app/study">` labelled "StudyMap" in
`MainLayout.jsx` (plus an `Alt+S` shortcut mirroring it). This means a user
currently inside `/app/study/*` has no equivalent one-click way back into
the chat/mindmap workspace except browser back or whatever that page's own
chrome provides — **Codex 2 should verify this live** (does
`StudyShell`/`StudyBreadcrumb` expose a return path to `/app`, or is browser
back the only route?). If not, this is a real navigation-ownership gap, not
just a code-structure curiosity.

**Terminology note**: "StudyMap" is both (a) the product's overall brand
name per `docs/PRODUCT.md`-style references and (b) the specific label on
the header link that takes you to `/app/study` (documents/quiz/review). A
user hearing "StudyMap" in conversation and a user looking at that header
button are not obviously thinking about the same thing — flag as a likely
naming-collision finding for Codex 2/Agy to verify against real first-time-user
reactions, not just inferred from code.

## 2. Workspace (`/app`) structure — `MainLayout.jsx`

- Single global header (58px, fixed) containing: wordmark, a 3-way mode
  switch (`MODE_TABS` — `Trò chuyện` / `Sơ đồ tư duy` / `Tóm tắt`, i.e.
  Chat / Mind Map / Summary — moved here from a now-deleted
  `LessonHeader.jsx` in "Round 11"), theme toggle, usage chip, account
  menu, and (desktop ≥768px) direct buttons for source library/inspector
  that collapse into `StudyToolsMenu`'s `extraActions` below that width.
- `WorkspaceContainer`: all three mode panes (Chat/MindMap/Summary) stay
  **mounted simultaneously**, toggled via CSS `hidden` — deliberate (state
  preservation across mode switches), not a bug; confirmed by its own
  "do not touch, zero styling of its own" code comment.
- `SidebarLeft` (source library: upload, list, search/filter, selection) /
  `SidebarRight` (`ContextInspector`, Evidence) — resizable via
  `PanelDivider` (confirmed real, accessible splitter:
  `role="separator"`, full keyboard resize, `aria-valuenow/min/max`), both
  collapsible to a `PanelSpine` rail.
- `StudyToolsMenu` is a **separate concept from `/app/study`** despite the
  name proximity — it is an in-workspace popover picker for `Tutor` /
  `Timeline` / `Insights(Knowledge)`, rendered inside the right-side panel.
  It does **not** navigate anywhere; it swaps which panel content shows.
  **Potential naming confusion, flag for Codex 2's duplication matrix**:
  "StudyMap" (header link → `/app/study`) vs. "Công cụ học / Study Tools"
  (`StudyToolsMenu`, in-panel picker) vs. the product being named StudyMap
  overall — three different things sharing the word "study"/"StudyMap" in
  one app.
- `CommandPalette` (Ctrl+K) mounts once, app-wide, only when authenticated
  — confirmed deliberately excluded from Landing/Login/Register for bundle
  cost, per its own code comment.

## 3. Study workflows (`/app/study/*`)

Each page (`DocumentList`, `StudyMapView`, `QuizSetup/Taking/Result`,
`ReviewGuide`, `Practice`) is its own top-level route with its own shell
(`StudyShell`/`StudyBreadcrumb` per prior audit notes — to be confirmed
live by Codex 2/Agy), separate from `MainLayout`. `StudyMapView` uses a
**hand-rolled `react-d3-tree` SVG renderer**, entirely independent from the
Mind Map feature's Mind-Elixir-based canvas in `/app` — two different
graph-rendering systems for two conceptually similar "map" features in the
same product. This is a strong candidate for the duplication matrix
(Codex 2) and for Agy's "shared component / redesign risk" review — **two
different libraries, two different visual languages, one user-facing
concept ("a map of my knowledge")**.

## 4. Known-already-documented correctness bugs (not a style opinion)

`DESIGN_TOKEN_AUDIT.md` claims 25+ call sites across 7+ files reference
undeclared CSS custom properties (`var(--border)`, `var(--brand)`,
`var(--surface-elevated)`, `var(--ok-bg)`, `var(--font-display)`),
including `StudyMapView`'s root/section/selection node color. **Status as
of this audit is unverified against live current code** — Codex 1 should
re-grep `FE/src` for these exact variable names against the CURRENT
`index.css` token list (not trust the audit doc's claim) and confirm which
are still actually undeclared today vs. already fixed since that doc was
written. If still present, this is a correctness defect (nodes rendering
via inherited/default fallback color, not the intended one), tag P1/P2
depending on visible impact — not a design-system opinion.

## 5. Open questions for Phase 9 synthesis (not yet answered)

- Does `/app/study/*` actually have a return path to `/app`, or only the
  header's one-way link + browser back? (Codex 2 to verify live.)
- Are the phantom CSS vars from `DESIGN_TOKEN_AUDIT.md` still present on
  the current `main` baseline? (Codex 1 to verify.)
- Is the StudyMapView (`react-d3-tree`) vs MindMap (Mind-Elixir) dual
  graph-renderer situation something users actually perceive as two
  different "map" features, or a backend-only implementation detail they
  never notice? (Codex 2/Agy — needs real journey evidence, not inferred
  from code.)
- Given the Paper & Graphite → blue-accent reversal, is there any
  remaining user-visible seam (a screen that still carries old-system
  colors/radii the main revert missed)? (Codex 1 — grep for `#B23A2E`,
  `Fraunces`, any remaining seal-red hex across `FE/src` as a direct check.)

This document will be updated with the route/screen/state matrix (doc 02)
and revisited during Phase 9 synthesis once Codex 1, Codex 2 and Agy report.
