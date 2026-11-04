# Option A implementation plan — Usage inside “Công cụ học”

Status: owner-selected design plan, not an implementation. This document does
not authorize a frontend merge or enable the Library flag.

Owner decision date: 2026-11-04. Base read for this plan: `origin/main`
`927cf88`.

## 1. Product contract

At phone widths, move AI usage from the global header into the existing
**Công cụ học** menu.

The persistent header must retain:

- Home;
- Chat, Mind Map and Summary mode controls;
- a visibly labelled **Công cụ học** trigger; and
- Account.

Library must be an easy-to-find, first-class row in **Công cụ học** at 320,
375 and 390 px. It must not disappear merely because the viewport is wider
than the current 340 px cutoff. Desktop behavior remains unchanged.

The header remains 56 px high. Every visible control and menu action has a
minimum 40 × 40 px hit target, owns its geometric centre, and stays inside the
viewport without document-level horizontal overflow.

## 2. Existing ownership and the single-fetch rule

Current data flow:

- `MainLayout.jsx` mounts one `<UsageChip />`; it does not fetch usage itself.
- `UsageChip.jsx` owns `usage`, `loading`, `error`, open/close state and the
  only frontend `apiFetch("/usage/me")` call.
- `BE/app/main.py::usage_me` authenticates the current user and returns
  `app.domains.usage.metering.get_summary(uid)`.

The product PR must preserve **one request owner and one request per mount**.
Do not mount a hidden header UsageChip plus a second menu UsageChip, and do not
add a `/usage/me` call to `StudyToolsMenu`.

Implementation shape:

1. Extract the existing request/state logic from `UsageChip.jsx` into one
   controller hook (for example `useUsageSummary`) without changing the API or
   retry semantics.
2. Instantiate that controller exactly once in `MainLayout`.
3. Pass the same controller to the desktop UsageChip presentation and the
   phone menu usage row/details presentation. Only one presentation is active
   for a given responsive composition; neither child fetches.
4. Add a fixture assertion that counts `/usage/me` and fails if opening or
   closing **Công cụ học** creates another request.

This is a presentation relocation, not a backend or quota-accounting change.

## 3. Header composition and typography at 320 px

The proposal measured an 11 px label, but **11 px is not accepted as the final
type size by default**. Implement and capture these candidates in order:

| Candidate | Trigger text | Type treatment | When to accept |
|---|---|---|---|
| A | `Công cụ học` | 12 px / 600, reduce container gaps and horizontal padding first | Preferred if the full label, chevron and 40 px target fit at 320 px without clipping or overlap. |
| B | `Công cụ học` | 11.5 px / 600, normal Vietnamese diacritics and no artificial tracking | Accept if A fails geometry but B remains clearly readable in screenshots and browser zoom. |
| C | `Công cụ học` | 11 px / 600, the measured prototype floor | Last resort only, requiring explicit owner acceptance of the 320 px screenshot. |

Judge each candidate at 320, 375 and 390 px using all of these gates:

- the visible text bounding box is fully inside the trigger;
- Home, all three mode controls, tools and Account are at least 40 × 40 px;
- `elementFromPoint()` at each control centre returns that control or a child;
- header height is exactly 56 px and header/document horizontal overflow is 0;
- Vietnamese diacritics remain legible at 100% and 200% browser zoom;
- light and dark screenshots show adequate contrast and no visual crowding.

Do not solve fit by hiding Home, Account or a workspace mode, abbreviating the
label, or shrinking a touch target.

## 4. Công cụ học menu composition

Phone order:

1. Gia sư AI, Dòng thời gian, Kiến thức (existing tools);
2. **Thư viện học tập** with `BookOpen`, visible at 320/375/390;
3. **Mức sử dụng AI** with percentage and textual state;
4. existing phone-only source, inspector and theme actions.

Library must use the existing `/app/study` navigation and close the menu after
selection. It must be findable by visible text, accessible name and keyboard
navigation; no icon-only Library row.

The usage row opens the existing detail content (plan, progress, used/reserved/
limit, remaining, reset date and breakdown) using the shared controller. It
must preserve loading and retry states.

Quota communication is not color-only:

- normal: `Mức sử dụng AI · <n>%`;
- near quota (`percentage >= 80` and `remaining > 0`): add visible text such as
  `Sắp hết hạn mức AI` and keep the warning token;
- exhausted (`remaining <= 0`): add visible text `Đã hết hạn mức AI` and state
  what is unavailable until the displayed reset date.

The same state text must be in the accessible name. Do not infer a new
threshold or duplicate the calculation outside the shared controller.

## 5. Keyboard, focus and touch contract

- Tools trigger keeps `aria-haspopup="menu"` and live `aria-expanded`.
- Opening places focus on the first menu action; ArrowDown/ArrowUp wrap,
  Home/End move to the ends, Enter/Space activate, and Tab remains predictable.
- Escape from the menu closes it and restores focus to the tools trigger.
- Selecting Library or a learning tool closes the menu and restores focus
  before navigation/surface change.
- Opening usage details moves focus into the details surface. Escape/Close
  returns to the usage row if the menu remains open, otherwise to the tools
  trigger. No nested focus trap or orphaned focus.
- Outside pointer dismissal preserves focus on another focusable target and
  restores the trigger only for inert background, matching the existing
  `StudyToolsMenu` contract.
- All trigger, menu, Close and retry targets are at least 40 × 40 px on touch;
  rows may retain the existing 58 px minimum.

## 6. Expected product files

Implementation files:

- `FE/src/components/Layout/MainLayout.jsx` — instantiate the single usage
  controller, keep header owners, pass phone actions.
- `FE/src/components/Layout/UsageChip.jsx` — separate request controller from
  presentation without changing `/usage/me` semantics.
- `FE/src/components/Layout/StudyToolsMenu.jsx` — Library and usage rows,
  keyboard/focus behavior.
- `FE/src/index.css` — measured 320/375/390 composition and candidate type.

Tests/evidence:

- `FE/src/components/Layout/UsageChip.test.jsx`
- `FE/src/components/Layout/StudyToolsMenu.test.jsx`
- `FE/src/components/Layout/MainLayout.mobileThemeControl.test.jsx` if its
  existing extra-action/focus contract changes
- `FE/e2e-fixture/mobile-header.spec.js`
- `FE/e2e-fixture/mobile-header-visual.spec.js`
- `FE/e2e/mobile-theme-control.spec.js` only if the menu action order changes
  its real-app selectors
- `docs/ui-ux-v4-1/evidence/option-a/` for approved screenshots

No BE, production environment, feature-flag or production-data file belongs in
this PR.

## 7. Test and evidence gates

Unit tests must prove:

- exactly one `/usage/me` request owner and no extra request on menu toggles;
- loading, retry, normal, near-quota and exhausted states;
- Library is present at the three phone widths' composition contract;
- menu order, accessible names, arrow keys, Escape and focus restoration.

Real Chromium fixtures at 320, 375 and 390 px, light and dark, must prove:

- 56 px header, no header/document overflow and full visible tools label;
- Home, three modes, tools and Account remain present and centre-hittable;
- Usage is absent as a standalone phone-header control and present in the menu;
- Library is visible without scrolling past an ambiguous icon-only row;
- `/usage/me` request count stays one;
- warning/exhausted text is visible and announced;
- Escape, outside click, keyboard traversal and touch activation work.

Capture closed-header and open-menu screenshots at **320, 375 and 390 px**.
Also capture near-quota and exhausted menu states at 320 px. The evidence must
record the chosen font size; screenshots alone do not approve candidate C.

Before handoff: targeted Vitest, targeted fixture specs, whole `npx vitest run`,
`npm run lint`, production build, Full Fixture Audit, and `CI / required` on the
final HEAD.

## 8. Risks and rollback

| Risk | Prevention |
|---|---|
| Duplicate or stale usage requests | One controller in `MainLayout`; request-count regression. |
| Responsive remount loses loading/detail state | Keep controller above the two presentations; do not key it by viewport. |
| 320 px label becomes unreadable | Candidate ladder and explicit owner acceptance; 11 px is not presumed final. |
| Library remains hidden at 375/390 | Replace the current `<= 340` composition rule with the measured phone contract and assert all three widths. |
| Menu grows beyond short screens | Bounded scroll region while header and Close remain reachable. |
| Escape/focus regression from nested usage details | Explicit focus-return owner and real-browser keyboard tests. |
| Warning conveyed only by color | Visible and accessible status text for near/exhausted states. |
| Conflict with #126 in `MainLayout`/header fixtures | Product PR starts only after #126 is on `main`. |

Rollback is FE-only: revert the product merge commit. The existing backend
usage route and accounting are unchanged.

## 9. Dependency and PR split

1. **This docs PR**: implementation plan only, based on `origin/main`.
2. **#126 first**: it establishes the approved `Công cụ học` and upload labels.
   Do not start or merge the product implementation before #126 is on `main`.
3. **One Option A product PR** from updated `main`: single usage controller,
   responsive relocation, Library row, accessibility, tests and screenshots.
   Keeping these together prevents an intermediate state with a hidden or
   duplicate Usage owner.
4. If the owner rejects all typography candidates after screenshots, open a
   separate visual-tuning PR; do not silently reduce below the approved size.

Library remains OFF. This plan does not authorize the Option A product PR to
merge.

## 10. Wave 1 readiness (read 2026-11-04)

`base = main` is from GitHub. `Base ancestor` and `behind` are computed against
the fetched `origin/main` `927cf88`. Lead comments are not GitHub approvals.

| PR | HEAD | Base / behind | `CI / required` on HEAD | GitHub reviews | Conflict state | Audit need |
|---:|---|---|---|---|---|---|
| #122 | `4707cf3` | `main`; ancestor yes; 0 behind | SUCCESS | None | CLEAN / mergeable | No new Full Fixture Audit for copy-only naming; rerun source scan and affected fixtures after any merge-forward. |
| #126 | `9d1bccb` | `main`; ancestor yes; 0 behind | SUCCESS | None | CLEAN / mergeable | No Full Fixture Audit for this copy-only HEAD; rerun mobile-header/library fixtures after merge-forward. Option A is a separate audited product PR. |
| #134 | `4ee9338` | `main`; ancestor yes; 0 behind | SUCCESS | None | CLEAN / mergeable | No Full Fixture Audit; branding source scan plus required CI is proportionate. |
| #129 | `f3c789e` | `main`; ancestor yes; 0 behind | SUCCESS | None | CLEAN / mergeable | **Yes before frontend merge authorization**: behavioral mobile empty states; no Full Fixture Audit is recorded on this HEAD. |
| #128 | `489c1f9` | `main`; ancestor yes; 0 behind | SUCCESS | None | CLEAN / mergeable | **Yes before frontend merge authorization**: responsive Library layout; no Full Fixture Audit is recorded on this HEAD. |

Preparation status only: S1–S4 and explicit owner authorization still gate any
V4.1 frontend merge.

### Docs PRs

| PR | HEAD | `CI / required` | Conflict | Docs-only diff? |
|---:|---|---|---|---|
| #141 | `90b4ce9` | SUCCESS | CLEAN / mergeable | Yes by path: all changes are under `docs/`; one is a capture `.spec.js`, but no FE/BE product source changes. |
| #143 | `5d1d817` | SUCCESS | CLEAN / mergeable | Yes: one Markdown file under `docs/`. |

Both have zero GitHub reviews and are zero commits behind the fetched main.
They may be presented to the owner after confirming the green check and diff;
that is not merge authorization.
