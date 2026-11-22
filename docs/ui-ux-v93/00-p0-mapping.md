# V9.3 — P0: the real app vs the 21 V9.3 screens

**Base.** `origin/main` `db005ab` (PR #152, V5 foundation). The design source is the V9.3
handoff in `docs/StudyMap-V9.3/` (00–17), which is not in Git yet.

**About 30 Draft PRs (#159–#196) are not in `main`.** They cover:
- the V6 landing, library, chat and quiz screens;
- double-submit and stale-response guards;
- background regrade, provisional grading, Idempotency-Key and archived review topics;
- the learning progress page;
- DB roles.

So the "keep" rules below that point to those PRs are about code **not yet on this base**.
Any V9.3 module PR that touches the same screens has to be based on them, or wait until
they merge. That base question is an owner decision.

## Screen mapping

Abbreviations in the table:
- `PR` = `ProtectedRoute`.
- `MainLayout` = `components/Layout/MainLayout` (the `/app` workspace).

| # | V9.3 screen (prototype route) | Real route / component | Real API | Status on `main` | Note |
|---|---|---|---|---|---|
| 1 | Landing `#/home` | `/` `pages/Landing.jsx` | none | exists (V5) | V6 landing in #159 |
| 2 | Dashboard `#/dashboard` | none. Closest: Library learning home (#172, Draft) | `/api/progress/overview`, `/api/library` | **missing** | build from real progress data only; no sample numbers without a label |
| 3 | Library `#/library` | `/app/study` `pages/study/DocumentList.jsx`, `CollectionSidebar`, `StudyCard` | `/api/library`, `/api/collections`, `/api/documents` (`/bulk`, `/upload`) | exists | #166, #171, #173, #176 reshape it |
| 4–8 | Workspace chat / reader / summary / map / notes `#/workspace/:id/*` | `/app` `pages/Workspace.jsx`, `MainLayout`, `ChatArea`, `SidebarLeft` (sources), `SidebarRight` (evidence/tools), `SummaryPane`, mind map | `/query`, `/query-stream/:id`, `/query-resume/:id`, `/conversations/:id/*`, `/generate-summary`, `/summaries*`, `/generate-mindmap`, `/mindmaps*`, `/chunk-text/:id`, `/sources/:id` | chat, summary and map exist; the workspace is **not per document** (sources are a multi-select scope) | V9.3 routes per document ID; see decision D2 |
| 5 | Reader | `chunk-text` excerpt only (evidence) | `/chunk-text/:id` | **no file reader** | needs a renderer per file type; no invented page numbers |
| 8 | Notes | none | **no notes API** | **missing** | needs a backend contract (owner decision); not localStorage dressed up as a saved account note |
| 9 | Quiz `#/quiz` | `/app/study/quiz/new`, `/quiz/:quizId`, `/result/:attemptId`, `/practice/:quizId` | `/api/quizzes/*`, `/api/attempts/*`, `/api/practice/*` | exists | keep #183, #185, #188, #190, #192, #193 (Draft) |
| 10 | Review `#/review` | `/app/study/review/:attemptId` `ReviewGuide` (a review plan, not flip cards) | `/api/review-plans/*` | different model | flip cards with self-rating need a card/SRS contract; keep #194 archive |
| 11 | Progress `#/progress` | none on `main`; #186 (Draft) | `/api/progress/overview`, `/attempts`, `/concepts` | **missing on main** | real data exists in the API |
| 12 | Notifications | none | none | **missing** | out of scope until a backend exists; V9.3 doc 12 says so |
| 13 | Settings profile | `/app/profile` `ProfilePage`, `ProfileDrawer`, `AvatarPicker` | `/auth/me`, `/me/nks/profile`, `/me/nks/avatar`, `/me/nks/password` | exists | |
| 14 | Settings appearance | header theme toggle `useTheme` | none | partial | |
| 15 | Settings notifications | none | none | missing | prototype-only |
| 16 | Settings usage | `UsageChip`, `OperationUsage` | `/usage/me` | exists | real quota; no sample 28% |
| 17 | Settings privacy | none | none | missing | export/delete need backend contracts |
| 18 | Onboarding | none | none | missing | goals only locally, per V9.3 doc 04 |
| 19–21 | Login / register / forgot | `/login`, `/register` (`pages/Login.jsx`, `Register.jsx`), NKS login | `/auth/login`, `/auth/register`, `/auth/me`, `/auth/nks/grant` | login and register exist; **no forgot-password flow** | keep the existing auth; no new reset endpoint |

## Must keep while redesigning

- Auth and `ProtectedRoute` on every `/app/*` route.
- The guards for job polling and stale responses (`jobPoller`, `activeJob*`, #164 and #177 in Draft).
- Chat attempt identity (#163).
- The double-submit locks (#162).
- Quiz history, grading recovery, regrade, Idempotency-Key and the archived review topics (#183–#194).
- Collections and bulk actions, and `DestructiveConfirmDialog` for hard deletes.
- The archive vs. delete wording.
- The command palette (Ctrl/Cmd+K) and keyboard shortcuts.
- The mind map export studio.

## Owner decisions this mapping raises

- **D1 Base.** Build V9.3 modules on `main` and rebase the V6 stack later, or merge or
  integrate the V6 stack first. Recommendation: P1a (tokens only, this PR) on `main`,
  since it touches token values and few rules. P1b and later go on an integration
  branch of the V6 stack.
- **D2 Workspace model.** V9.3 opens one document per workspace (`/workspace/:id/mode`).
  The real `/app` scopes chat across several selected sources. Options:
  - map V9.3's "Nguồn" panel onto the existing multi-select scope;
  - add a per-document route.
- **D3 Notes, Notifications, Onboarding, forgot password, privacy export.** None has a
  backend. Either build each as a labelled local-only feature, or write a backend
  contract first.
- **D4 Review.** Flip cards with self-rating vs. the existing review plan.

## Phase plan

| PR | Scope | Depends on |
|---|---|---|
| P1a (this) | V9.3 tokens, Be Vietnam Pro, focus ring, 44px buttons, brand mark | `main` |
| P1b | Shell: sidebar and header, bottom nav ≤700px, dialog, toast, empty/error/loading states | D1 |
| P2 | Landing, login, register, onboarding (local) | P1b, #159 |
| P3 | Library and dashboard | #166–#176, D1 |
| P4 | Workspace layout, focus mode, drafts per document | D2 |
| P5 | Chat/evidence, reader, summary, map, notes | P4, D3 |
| P6 | Quiz, review | #169–#194, D4 |
| P7 | Progress, settings | #186 |
