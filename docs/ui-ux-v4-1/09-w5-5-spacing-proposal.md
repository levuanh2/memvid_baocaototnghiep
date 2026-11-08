# W5-5 spacing and layout proposal

Status: proposal only. No product CSS or component behavior changes are included.

## Scope and method

This proposal compares the Library, Workspace Chat/Mind Map/Summary, Quiz Result, and Review Guide on `origin/main` (`927cf88`) at 390 × 844 and 1440 × 900. The real frontend ran in Chromium with the audit's deterministic network mocks on fixture port 5229; no backend, production account, or production data was used.

The measurement mode in [`audit-capture.spec.js`](evidence/capture/audit-capture.spec.js) records computed padding, margin, row/column gap, heading size, and visible vertical gaps. “Distinct spacing values” below means unique non-zero computed padding/margin/gap values from 0–96 px in the visible DOM. Raw results are in [`evidence/spacing/`](evidence/spacing/). Existing screenshots remain the visual reference.

The goal is a constrained normalization pass, not a redesign. Navigation, copy, information hierarchy, grading, exact-node export, and Library feature-flag behavior are out of scope.

## Findings

| Screen | Element | 390 px measured value | 1440 px measured value | Inconsistency / consequence | Evidence |
|---|---|---:|---:|---|---|
| Library | Visible spacing vocabulary | 15 values | 14 values | Includes 2, 3, 4, 6, 7.2, 8, 10, 11.2, 12, 14, 16, 20, 24, 28 px plus a 46.98 px mobile outlier; the page has more spacing variants than its hierarchy needs. | [390 data](evidence/spacing/library__390__light.json), [1440 data](evidence/spacing/library__1440__light.json) |
| Library | Page / section headings | H1 19.2 px; H2 10.5 px; dashboard H3 16 px | Same | The 10.5 px uppercase section heading is visually much smaller than the 19.2 px page heading, while the dashboard introduces a third 16 px level. The roles are valid, but their spacing is not consistently tied to them. | [390 screen](evidence/screens/library__390__light.jpg), [1440 screen](evidence/screens/library__1440__light.jpg) |
| Library | Document card vs mastery card | 16 px / 14 px padding | 16 px / 14 px padding | Equivalent bordered content units use near-duplicate padding values. Document cards also use 12 px internal gaps, so 14 px adds density without creating a new hierarchy. | [390 data](evidence/spacing/library__390__light.json), [1440 data](evidence/spacing/library__1440__light.json) |
| Library | Repeated sections | 28 px bottom separation | 28 px | `mb-7` is a page-specific 28 px rhythm while Review uses 24 px and Quiz question groups use 12 px. Repeated Library sections become very long on mobile because the same documents also recur across sections. | [390 screen](evidence/screens/library__390__light.jpg), [1440 screen](evidence/screens/library__1440__light.jpg) |
| Workspace Chat | Visible spacing vocabulary | 17 values | 18 values | Chat alone uses 1/2/4/5/6/7/8/10/11/12/14/16/20/24/28/48/64 px on mobile, plus 9/29/32 px on desktop. This is the widest vocabulary measured. | [390 data](evidence/spacing/workspace-chat__390__light.json), [1440 data](evidence/spacing/workspace-chat__1440__light.json) |
| Workspace Chat | Empty-state heading | 26 px | 30 px | The responsive size change is intentional, but it does not reuse the existing semantic `text-h1`/`text-h2` scale and is much larger than Summary's 19 px empty-state heading. | [390 screen](evidence/screens/workspace-chat__390__light.jpg), [1440 screen](evidence/screens/workspace-chat__1440__light.jpg) |
| Workspace Chat | Conversation viewport | 20 px horizontal, 28 px vertical, 24 px item gap | 32 px horizontal, 28 px vertical, 24 px item gap | Horizontal gutters respond, but vertical padding and message gap do not; the composer separately uses 12/24 px horizontal padding. The two adjacent Workspace regions therefore do not share one gutter. | [source](../../FE/src/components/Layout/ChatArea.jsx), [390 screen](evidence/screens/workspace-chat__390__light.jpg) |
| Workspace Mind Map | Visible spacing vocabulary | 19 values | 16 values | The canvas/tooling surface has the most mobile variants, including 1, 3, 5, 7, 9, 11, 15, 30, 45, and 60 px. Some are node hierarchy values, but toolbar spacing also uses off-grid 5/9/13 px. | [390 data](evidence/spacing/workspace-map__390__light.json), [1440 data](evidence/spacing/workspace-map__1440__light.json) |
| Workspace Mind Map | Context toolbar | 4 × 8 px padding; 5 px gap | 9 × 13 px padding; 9 px gap | Equivalent toolbar structure changes across three near-neighbour values instead of the existing 4/8/12/16 scale. This makes future responsive fit calculations harder. | [390 screen](evidence/screens/workspace-map__390__light.jpg), [1440 screen](evidence/screens/workspace-map__1440__light.jpg) |
| Workspace Summary | Empty state / content sheet | 12 px empty-state gap; 24 px horizontal empty-state padding; 20 px summary-sheet padding | Same | Summary's empty state is compact, but a loaded Summary immediately switches to a 20 px content sheet; Chat uses 20/32 px page gutters. Workspace modes do not share a central-surface gutter contract. | [390 data](evidence/spacing/workspace-summary__390__light.json), [1440 data](evidence/spacing/workspace-summary__1440__light.json) |
| Quiz Result | Visible spacing vocabulary | 9 values | 10 values | The screen is comparatively coherent, but desktop adds 30 px only for the score hero and mobile adds 18 px only for its vertical padding. | [390 data](evidence/spacing/quiz-result__390__light.json), [1440 data](evidence/spacing/quiz-result__1440__light.json) |
| Quiz Result | Score hero | 18 × 4 px padding; 16 px gap | 24 px padding; 30 px gap | Four-pixel mobile side padding is the clearest outlier: it is smaller than the 20 px StudyShell gutter and the 20 px question-card padding, so score content visually touches the hero edge. | [390 screen](evidence/screens/quiz-result__390__light.jpg), [1440 screen](evidence/screens/quiz-result__1440__light.jpg) |
| Quiz Result | Question cards | 20 px padding; 12 px between cards; H3 16 px | Same | The 20 px card padding matches Review, but the question title is 16 px while equivalent Review item titles use the existing 17 px `text-title` token. | [390 data](evidence/spacing/quiz-result__390__light.json), [1440 data](evidence/spacing/quiz-result__1440__light.json) |
| Review Guide | Plan summary / grid / cards | 24 px summary-to-grid; 14 px card gap; 20 px card padding | Same | Card padding is coherent with Quiz, but the 14 px grid gap is an isolated near-neighbour of the existing 12/16 px steps. | [390 data](evidence/spacing/review-guide__390__light.json), [1440 data](evidence/spacing/review-guide__1440__light.json) |
| Review Guide | Headings | H1 19.2 px; card H3 17 px | Same | These already use `text-h3` and `text-title`; Quiz should converge on these roles rather than add another 16 px card-heading treatment. | [390 screen](evidence/screens/review-guide__390__light.jpg), [1440 screen](evidence/screens/review-guide__1440__light.jpg) |

## Proposed token set

Do not introduce a second spacing system. Reuse Tailwind's existing default scale and the existing semantic typography in `tailwind.config.js`:

| Purpose | Existing utility | Value |
|---|---|---:|
| Tight inline separation | `gap-2`, `p-2` | 8 px |
| Related controls / stacked metadata | `gap-3`, `p-3` | 12 px |
| Dense card / mobile surface gutter | `p-4`, `px-4` | 16 px |
| Standard card | `p-5` | 20 px |
| Section separation / desktop surface gutter | `gap-6`, `mb-6`, `px-6` | 24 px |
| Wide desktop reading gutter only | `px-8` | 32 px |

Typography should continue to use `text-h3` (19.2 px), `text-title` (17 px), and `text-metadata` (10.5 px). No new font-size token is proposed.

The current 14, 18, 28, and 30 px values should be treated as migration candidates, not banned globally: they may remain where a measured geometry or touch-target constraint requires them.

## Ranked changes for a future implementation PR

1. **Fix the mobile Quiz score-hero gutter.** Change the mobile hero from `padding: 18px 4px; gap: 16px` to 16 px padding and 16 px gap. Files: `FE/src/pages/study/quizJourney.css`. Impact: high; risk: medium because the four-stat row and long provisional copy must be checked at 320/390.
2. **Establish one Study page section rhythm.** Use 24 px between top-level content sections (`mb-6`/`gap-6`) instead of Library's 28 px and Review's 14 px grid gap where elements are peer cards. Files: `FE/src/pages/study/DocumentList.jsx`, `FE/src/pages/study/quizJourney.css`, `FE/src/pages/study/QuizResult.jsx`, `FE/src/pages/study/ReviewGuide.jsx`. Impact: high on scanability; risk: medium because Library is long and responsive card grids must be remeasured.
3. **Name two card densities using existing utilities.** Standard content cards remain 20 px (`surface-card`/`p-5`); dense dashboard/document cards use 16 px (`!p-4`). Remove the isolated 14 px (`!p-3.5`) only after checking its content at 320 px. Files: `FE/src/pages/study/DocumentList.jsx`, `FE/src/pages/study/QuizResult.jsx`, `FE/src/pages/study/ReviewGuide.jsx`, optionally `FE/src/index.css` for documented modifier classes. Impact: high consistency; risk: medium due to card-height changes.
4. **Align Quiz card titles with Review's semantic title role.** Use `text-title` for reviewed-question titles instead of a separate 16 px treatment; retain `text-metadata` for section labels. Files: `FE/src/pages/study/QuizResult.jsx`. Impact: medium; risk: low, with long-question wrapping tests at 390.
5. **Give Workspace modes a shared content-gutter contract.** Use 20 px mobile and 32 px desktop for scrollable reading content, while full-bleed canvas chrome remains exempt. Apply consistently to Chat history/composer and loaded Summary content; keep the empty state centered with 24 px safety padding. Files: `FE/src/components/Layout/ChatArea.jsx`, `FE/src/components/Layout/SummaryPane.jsx`, `FE/src/components/Layout/WorkspaceEmptyState.jsx`. Impact: medium; risk: medium because composer width and citations can wrap.
6. **Move Workspace empty-state headings onto semantic type tokens.** Replace Chat's ad-hoc 26/30 px and Summary/Mind Map's 19 px literal with one role per hierarchy (suggest `text-h3` for mode-empty titles; reserve larger display copy for the no-document onboarding screen). Files: `FE/src/components/Layout/ChatArea.jsx`, `FE/src/components/Layout/WorkspaceEmptyState.jsx`. Impact: medium; risk: low, but copy wrapping must be checked at 320.
7. **Put the Mind Map context toolbar on the 4/8/12 scale.** Normalize desktop padding/gap from 9/13/9 to 8/12/8; retain 40 px action targets. Normalize mobile gap from 5 to 4 or 8 only if hit-testing remains clear. Files: `FE/src/components/mindmap/mindmap.css`. Impact: medium maintenance benefit; risk: high because inspector occlusion and the 768–800 px fit band have prior regressions.
8. **Add a spacing regression census, not screenshot-only approval.** Keep the measurement collector and assert that targeted surfaces do not introduce new off-scale values; geometry assertions should cover 320, 390, and 1440 before merging implementation work. Files: `docs/ui-ux-v4-1/evidence/capture/audit-capture.spec.js` and a future focused fixture spec under `FE/e2e-fixture/`. Impact: medium prevention; risk: low if assertions are scoped to owned surfaces rather than the whole DOM.

## Acceptance boundaries for implementation

- No change to API payloads, grading, quiz scoring, exact-node/export membership, Library flag behavior, or navigation.
- No reduction below 40 × 40 px for existing interactive targets.
- No horizontal page overflow at 320/390.
- Recheck dark mode even though spacing measurements are theme-independent.
- Mind Map toolbar changes require the existing inspector-occlusion and export-transform suites; do not bundle them with the lower-risk Study-page normalization.
- Prefer two implementation PRs: Study pages first (items 1–4), then Workspace surfaces (items 5–7).

## Limitations

The fixture uses deterministic representative data, not production content. It measures computed layout in Chromium only and does not prove perceived density, localization extremes, or screen-reader behavior. Existing screenshots provide visual corroboration; a future implementation still needs real-browser geometry and wrapping checks at 320/390/1440.
