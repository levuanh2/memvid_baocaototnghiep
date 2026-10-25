# StudyMap accessibility and responsive interaction audit

Audit date: 2026-10-25  
Baseline: `4f228ef9d1e34f8bac59f37a3792fc859400cb64`  
Tested viewports: 1440×900 desktop and 390×844 mobile.

This is an interaction-oriented audit using Chromium accessibility snapshots, keyboard traces, element geometry, and mobile screenshots. It is not a WCAG conformance statement and does not include a full screen-reader/user study.

## Summary

StudyMap has a better semantic base than many complex workspaces: the main shell exposes banner/main/complementary landmarks, the three primary modes form a named tablist, register fields have computed labels, and the generation/export dialogs expose names. Keyboard-only registration is clean.

The principal barriers are state containment rather than missing global semantics. The mobile off-canvas source drawer leaves visually hidden controls in the tab order; backdrop interaction can release focus from the still-open generation modal into the page behind it; workspace source-row checkboxes have no accessible names; and the learning library's repeated cards create hundreds of redundant focus stops. These are functional barriers, not visual preferences.

## Test method and traces

- Chromium headless, native Tab/Escape key presses.
- `locator("body").aria_snapshot()` at registration, workspace, chat result, generation dialog, quiz setup/failure, and mobile pages.
- `document.activeElement` captured after each Tab, including bounding boxes to detect off-screen focus.
- Document `scrollWidth` compared with viewport width at 390 px.
- Modal focus tested in two ways: normal open/cycle/Escape, and backdrop click followed by Tab.
- Downloaded SVG reopened in Chromium to verify the browser could consume the artifact.

Representative evidence:

- [Register](screenshots/ux-02-register.png)
- [Desktop workspace](screenshots/ux-03-first-app-shell.png)
- [Generation dialog focus cycle](screenshots/ux-24-map-dialog-focus-cycle.png)
- [Mobile workspace](screenshots/ux-30-mobile-workspace-fresh.png)
- [Mobile source drawer](screenshots/ux-31-mobile-source-drawer.png)
- [Mobile learning library](screenshots/ux-32-mobile-study-above-fold.png)
- [Opened SVG](screenshots/ux-37-opened-exported-svg.png)

## Confirmed accessibility issues

### UX-021 · P1 · Closed/off-canvas mobile source controls remain keyboard-focusable

At 390 px with the visual source drawer closed, Tab stops 8–15 landed on the source drawer's Close button, search, filter, select-all, document checkboxes, and overflow actions. Their measured x coordinates ranged from `-236` to `-49`, outside the viewport. Only at stop 17 did focus reach the visible “Mở thư mục nguồn” button.

Impact: keyboard and switch users traverse and activate invisible controls without knowing which surface owns focus. This also makes the visible composer significantly slower to reach.

Expected behavior: when closed, the drawer subtree should be removed from sequential focus (`inert`, unmounted, or equivalent); when opened, focus should enter the drawer, remain appropriately contained, and return to “Mở thư mục nguồn” on close.

### UX-022 · P1 · The mobile source drawer is not an isolated modal interaction

Opening the source drawer visually adds a blocking backdrop, but the accessibility tree continues to expose the underlying workspace and its controls. The captured before/after control inventory remained at 23 controls, and focusable page content was not isolated.

Evidence: compare [closed workspace](screenshots/ux-30-mobile-workspace-fresh.png) and [open drawer](screenshots/ux-31-mobile-source-drawer.png).

Impact: screen-reader and keyboard users can move into obscured content, while pointer users perceive a modal drawer.

### UX-023 · P1 · Backdrop interaction can break modal focus containment

On normal open, focus correctly entered the “Đóng” button. Six forward Tab stops cycled within the generation dialog (instruction textarea, two topic buttons, two selected radios, submit, then close), and Escape returned focus to “Tạo sơ đồ tư duy.” This is the healthy path.

However, clicking the backdrop while the dialog remained open, then pressing Tab, traversed the underlying logo, workspace tabs, theme controls, source controls, and map CTA rather than the dialog. The dialog stayed visible throughout.

Evidence: [dialog remains open](screenshots/ux-12-generate-map-dialog.png) while the recorded 24-stop trace contains only background controls.

Impact: one pointer interaction leaves keyboard focus behind a modal, a major operability and context failure.

### UX-024 · P1 · Workspace document-row checkboxes have no accessible name

The workspace snapshot announces `checkbox [checked]`, followed separately by filename text. Both owned document rows reproduce this. The select-all checkbox is correctly named, but individual source checkboxes are not.

Impact: a screen-reader user cannot distinguish which document will be selected or deselected. The adjacent filenames are visually clear but are not the checkbox's computed accessible name.

Expected behavior: associate each checkbox with its filename and, if needed, status (for example, “Chọn ux-audit-primary.txt”).

### UX-025 · P1 · Repeated library cards make keyboard and screen-reader navigation impractical

The desktop capture counted 823 visible interactive elements; mobile counted 833 in one run. The accessibility tree repeats the same document, checkbox, overflow button, resume action, Summary, Map, Quiz, Practice, Ask AI, and Details under several headings.

Evidence: [desktop full page](screenshots/ux-05-two-documents-uploaded.png) and [mobile above fold](screenshots/ux-32-mobile-study-above-fold.png).

Impact: users must hear or traverse the same record many times to reach later content. Landmark and heading semantics do not compensate for the multiplied control set.

### UX-026 · P2 · Async quiz failure is not exposed as an alert

The job switches from progress to `Tạo quiz thất bại`, but the failure container is ordinary content rather than a live alert in the inspected implementation/state. A user already focused elsewhere may receive no announcement that the asynchronous job ended.

Evidence: [quiz failure](screenshots/ux-19-quiz-generated-or-progress.png).

Impact: screen-reader users may wait indefinitely at 0% or repeatedly activate Create.

### UX-027 · P2 · Chat stream abort has no user-facing error recovery

The browser recorded an unhandled `BodyStreamBuffer was aborted` rejection, while the UI presented `mock answer` as a completed answer and left evidence empty. There was no `role=alert`, retry, or “answer incomplete” status associated with the event.

Evidence: [chat result](screenshots/ux-09-chat-result-citations.png).

Impact: assistive-technology users and sighted users receive the same misleading completion signal, but screen-reader users additionally have no announced error.

### UX-028 · P2 · Several mobile targets are below the 44×44 touch recommendation

The mobile header mode buttons measured 40×40; overflow controls measured 28×28; source checkboxes were 14×14; study-card action buttons were generally 34 px high. Some may have larger label hit areas, but the measured interactive boxes themselves were smaller than a comfortable coarse-pointer target.

Evidence: geometry in the keyboard/control traces and [mobile library](screenshots/ux-32-mobile-study-above-fold.png).

Impact: increased mis-taps, particularly around adjacent mode icons and dense card actions. This is a usability recommendation, not a claim that every target violates a specific WCAG success criterion.

### UX-029 · P2 · Mobile mode navigation is icon-only visually

Chat, Mind Map, and Summary retain good accessible names in the tablist, but at 390 px the visible labels disappear. Users who do not recognize the icons must experiment; selection state alone does not explain the other two destinations.

Evidence: [mobile workspace](screenshots/ux-30-mobile-workspace-fresh.png).

Impact: discoverability barrier for new and cognitively impaired users. Accessible names help screen readers but do not help sighted users unfamiliar with the icon set.

### UX-030 · P2 · Mobile library status conflicts are announced early

The accessibility tree exposes `0 tài liệu`, then later `Chọn 19 đang hiện`, followed by cards. This contradiction is not only visual; screen readers hear both values in the primary reading order.

Evidence: [mobile library](screenshots/ux-32-mobile-study-above-fold.png).

Impact: users cannot form a reliable mental model of the result set or bulk-selection scope.

## Responsive interaction findings

### What worked

- No document-level horizontal overflow was detected at 390×844 on the workspace or study library.
- The composer remained visible and usable at the bottom of the workspace.
- The source drawer fits within the viewport and exposes a clear visual Close action.
- Core header controls remain approximately 40×40 and retain programmatic names.
- Study cards reflow their actions rather than clipping them horizontally.

### UX-031 · P2 · The mobile learning page is structurally enormous

Although it does not overflow horizontally, repeated category cards make the page tens of thousands of pixels tall. The first card alone exposes eight actions, and the same document reappears shortly afterward.

Impact: long swipes, lost scroll position, and difficulty relocating a document after visiting a sub-route. Address through the canonical-record recommendation in `05-duplication-matrix.md`, not through visual compression alone.

### UX-032 · P2 · Source selection is cleared across mobile/return transitions

The mobile workspace reopened with `0 đang chọn`, despite two sources being selected in the earlier desktop session using the same authenticated storage. The source drawer is reachable, but the user must recreate context before asking.

Impact: repeated work and a risk of composing before noticing that scope was cleared.

## Semantics that passed

- Registration: labelled textboxes for display name, email, password, and confirmation; logical order; visible submit.
- Workspace: `banner`, `main`, and two `complementary` regions; named `Chế độ Workspace` tablist with selected state.
- Resizers: named separators for source and evidence panes.
- Evidence shell: named `Bộ kiểm tra ngữ cảnh` region and expanded/collapsed state.
- Generation dialog: named dialog and heading; named textarea; `Mục đích` and `Độ chi tiết` radiogroups; Escape closes and restores trigger focus on the normal path.
- Export: named dialog, named progress navigation, explicit review terms, and successful downloaded artifact.
- Study library: named search, sort combobox/options, filter controls, category headings, and document-specific checkbox names on this surface.

## Likely issues needing validation

### UX-033 · P2 · Map keyboard navigation and screen-reader structure are unverified

The deterministic generator returned one custom-element node, so there was no meaningful graph traversal. A future pass must verify whether nodes are focusable, whether parent/child relationships are announced, whether collapse state uses `aria-expanded`, and whether arrow-key behavior is documented.

### UX-034 · P2 · Citation focus handoff is unverified

No citation controls were emitted by the mock response. Verify that activating a citation moves focus or reading context into the matching evidence, that returning to the citation is possible, and that unavailable evidence is announced.

### UX-035 · P2 · Quiz-taking keyboard and announcement behavior are unverified

Quiz generation failed before the taking route. Verify answer-option names/pressed state, progress-strip navigation, autosave announcements, submit-confirmation focus trapping, results headings, review source links, and practice-again focus placement.

## Design opportunities

### UX-036 · P2 · Add a skip path to the primary workspace task

Desktop keyboard order reaches the composer after roughly 18 controls; mobile reaches it after the hidden drawer controls plus chat-header actions. Fixing UX-021 is primary. A “skip to composer/main workspace” link would further reduce repetition for frequent keyboard users.

### UX-037 · P3 · Expose text labels for mobile modes on demand

Options include a compact labelled overflow, a tooltip on long press/focus, or preserving short labels if space permits. This should not alter the current tab semantics.

## Retest checklist

1. Closed mobile drawers contribute zero sequential focus stops; open drawers isolate background and restore focus on close.
2. Clicking a modal backdrop either closes by documented behavior or keeps focus inside; Tab never enters the page behind an open modal.
3. Every workspace source-row checkbox announces its filename.
4. One document appears once in the primary accessible result collection; category shortcuts do not duplicate full control sets.
5. Library total, visible count, and bulk-selection count agree.
6. Quiz failure and chat stream failure use announced status/alert messaging with an actionable recovery.
7. Run a deterministic multi-node map, citation-rich answer, and complete quiz through NVDA or Narrator in addition to automated snapshots.
