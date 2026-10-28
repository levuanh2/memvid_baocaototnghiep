# Round 7.1 pre-merge QA evidence

These images are rendered by Chromium from the real production React
components. They are not captures of the Phase B static HTML prototype.

## Renderer and fixture

- Entry: `FE/r71qa.html` / `FE/src/r71qa.jsx`.
- Browser runner: `FE/e2e-fixture/round7-1-qa.spec.js` using
  `playwright.fixture.config.js` and Chromium.
- Components: `QuizTaking`, `QuizResult`, `ReviewGuide`, `ProfilePage`,
  `ChatArea`, and `DestructiveConfirmDialog`.
- Routes inside the fixture router: `/app/study/quiz/quiz-qa-1`,
  `/app/study/result/attempt-qa-1`,
  `/app/study/review/attempt-qa-1`, and `/app/profile`.
- Data: deterministic in-browser API fixture with ten production-shaped quiz
  questions, restored answers, wrong answers at original positions 4 and 9,
  a submitted payload that deliberately includes provisional score fields,
  concept mastery, and a populated review plan.
- Backend status: mocked/isolated browser fixture. No production records,
  credentials, or personal data are present. This is **Browser + deterministic
  fixture**, not an actual-backend end-to-end run.

## Captures

| File | Component/state | Viewport/theme |
| --- | --- | --- |
| `quiz-taking-populated-1440-light.png` | QuizTaking, populated/restored answers | 1440x900 light |
| `quiz-result-pending-1440-light.png` | QuizResult, pending grading with provisional fields hidden | 1440x900 light |
| `quiz-result-graded-1440-light.png` | QuizResult, completed graded state | 1440x900 light |
| `wrong-review-original-ordinals-1440-light.png` | Wrong-answer rail/detail showing original 4 and 9 | 1440x900 light |
| `quiz-rail-820-light.png` | QuizTaking rail after local-overflow fix | 820x1180 light |
| `wrong-review-contextual-820-dark.png` | Contextual Review Plan action while reviewing | 820x1180 dark |
| `wrong-review-contextual-390-light.png` | Contextual Review Plan action while reviewing | 390x844 light |
| `review-guide-populated-390-light.png` | ReviewGuide populated review plan | 390x844 light |
| `review-guide-820-light.png` | Two-column ReviewGuide card geometry | 820x1180 light |
| `review-guide-320-dark.png` | Narrow ReviewGuide card/action wrapping | 320x568 dark |
| `profile-1440-dark.png` | Protected-page component renderer | 1440x900 dark |
| `profile-390-light.png` | Protected-page component renderer | 390x844 light |
| `profile-320-light.png` | Profile heading and labelled edit action | 320x568 light |
| `destructive-confirm-unchecked-1024-light.png` | Destructive dialog before acknowledgement | 1024x768 light |
| `destructive-confirm-checked-1024-light.png` | Destructive dialog after acknowledgement | 1024x768 light |
| `destructive-confirm-checked-390-dark.png` | Acknowledged destructive action, dark mode | 390x844 dark |
| `submit-confirm-320-light.png` | Submit confirmation action wrapping | 320x568 light |

The machine-readable before/after measurements are in
`visual-metrics-before.json`, `visual-metrics-final.json`,
`interaction-metrics-before.json`, and `interaction-metrics-final.json`.
The pre-fix interaction file remains useful for hitbox/layout geometry, but its
translucent `color(srgb ...)` contrast fields predate the corrected parser and
are not used for contrast conclusions. All reported final contrast values come
from `interaction-metrics-final.json`, whose parser handles that serialization.

## Final visual triage

**Source- and browser-confirmed defects, fixed:**

- The tablet rail's five 32px columns overflowed its 140px content box. After
  the three-column/176px-track fix, every question target is contained and is
  44.66px at 768/780/800/820; it is 56px at 1001/1010/1024/1279. Global
  overflow remains zero at every probe.
- Destructive confirmation measured 3.98:1 light and 3.44:1 dark before the
  scoped action role. Final enabled contrast is 6.53:1 light and 6.39:1 dark;
  hover is 8.54:1/8.46:1, disabled is 4.64:1/9.44:1, and both footer targets
  are at least 44px high.
- Profile edit was 40x28px; Profile form actions were 33.5px high; wrong-review
  arrows were 40px high; ReviewGuide actions were 37.5px high; Question Builder
  pills were 34px high. Final measured hitboxes are at least 44x44px, with a
  persistent visible label and accessible name on the Profile edit action.
  The 320px Profile Back target is also 44px high and remains separate from the
  title.
- Light Quiz processing/correct/completed treatments and both-theme incorrect
  rail labels failed computed contrast. Final composed contrast for every
  measured correct/partial/incorrect verdict, processing label, completed
  question number, rail label and rail number is at least 4.5:1.
- The desktop next-step panel disappears below 1001px. A compact contextual
  Review Plan link now stays visible at 820/390/320 while the existing header
  action and `/app/study/review/:attemptId` route remain unchanged; it remains
  hidden on desktop to avoid duplicate CTA clutter.
- Agy's screenshot review reproduced cramped mobile ReviewGuide copy. Below
  421px the meter and text stack, while the real 820px two-column cards retain
  zero local overflow.

**Hypotheses disproved by Chromium:** the 320px Profile heading does not collide
with “Quay lại”; the 320px submit buttons remain contained and measure 119x57px;
the 820px ReviewGuide cards have no local overflow; long unbroken short-answer
content does not create card or page overflow. No production fix was made for
those non-defects.

## Assertions exercised

- Populated navigation, restored answer, MCQ selection, short-answer editing,
  autosave failure, blocked unsafe submit, successful retry, and one submit.
- Pending grading never shows the provisional completed score or mastered
  seal; graded state remains distinct.
- Wrong-answer desktop rail and mobile detail retain original ordinals 4/9.
- Populated review-plan rendering and the unchanged quick-practice request
  body (`review_item_id`, `question_count: 5`, `difficulty: easy`).
- Confirmation acknowledgement, cancel, Escape, exact ID, rejection/error,
  double-click suppression, same-instance second target, focus trap/restoration,
  target/consequence copy, and real ChatArea consumer deletion.
- 1440x900, 1024x768, 820x1180, 800x900, 768x1024, 390x844, and 320x568 in light and dark:
  horizontal overflow, reachability/hit testing, focus visibility, question
  controls, pending/graded distinction, profile page semantics, and dialog
  action reachability.
- Targeted rail probes at 780, 1001, 1010, and 1279px compare every question
  button rectangle with the rail's padding-adjusted content rectangle.

## Limitations

- Actual backend Quiz end-to-end: **NOT VERIFIED**. The real-backend Playwright
  harness has no isolated deterministic seed path for this ten-question flow;
  production backend code and real user records were intentionally not changed.
- Repository critical real-backend Playwright: **BLOCKED by environment**. Its
  isolated Flask webServer did not reach `/health` within the configured 60s;
  this is not represented as an E2E pass. Browser + deterministic fixture is
  independently **PASS (6/6)**.
- Chromium viewport resizing is not a real-device virtual-keyboard test; no
  such claim is made.
- SidebarRight's historical inline artifact lists are behind the existing
  `legacyInspectorSurfacesEnabled = false` workspace boundary, so their delete
  buttons are not browser-reachable in the current production render. The
  shared dialog exercises exact MindMap/Summary endpoint contracts in the
  isolated browser fixture; source/unit verification covers the unchanged
  SidebarRight callers. This is reported as a limitation, not represented as
  an actual SidebarRight click-through PASS.

## Shared Modal and preserved paths

The shared Modal header is a sibling of the body wrapper, so a form rendered in
the body is not an ancestor of the close button. No NKS form-submit reproduction
was found. `type="button"` was added only as explicit hardening; the Modal API,
styling, initial-focus policy, focus trap, Escape handling and restoration are
unchanged and covered by focused tests. Initial focus landing on the close
button remains a separate focus-policy decision, not a defect silently changed
in this round.

Source diff verification confirms SidebarRight's native
`confirmRegenerateIfDirty(..., window.confirm)` path and BulkBar's recoverable
hide confirmation are unchanged. No DocumentList/CollectionSidebar (Round 6),
backend production, export-pipeline, or shared StudyMap-engine files changed.
