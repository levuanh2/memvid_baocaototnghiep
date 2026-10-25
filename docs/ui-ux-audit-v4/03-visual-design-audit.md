# StudyMap visual-design audit

Audit date: 2026-10-25  
Baseline: `main` at `4f228ef9d1e34f8bac59f37a3792fc859400cb64`  
Auditor scope: visual design and design-system expression only. Usability-flow, duplication and accessibility/responsive ownership remain in documents 04–06.

## Executive summary

The product is visually functional and generally polished at a component level, but it does not yet read as one finished system. Three distinct visual registers coexist:

1. the public “reading room” experience (large Spectral headings, navy ink, seal red, sparse paper composition);
2. the workspace instrument (dense blue controls, three-column app chrome, compact icon toolbars);
3. the Study library (bronze metrics, green status chips, roomy stacked records and a second map renderer).

This is not merely an aesthetic preference. The token source contains contradictory role descriptions from prior forest/seal and current blue phases; the live UI changes density, component grammar and accent hierarchy across routes. Two measurable contrast failures recur: dark primary buttons render white on `#5B9DF5` at only **2.77:1**, and muted copy renders at **2.89–3.43:1** on common surfaces. Tablet workspace composition, mobile Export Studio and mobile StudyMap also show confirmed clipping/compression.

No P0 issue was found in this visual-design pass. P1 is reserved below for repeated contrast or composition failures with material reading/operation impact, not taste.

## Audit method and coverage

- Used the real Chromium app at `http://localhost:5180` with the real Flask/Postgres backend at `http://127.0.0.1:8090`.
- Registered a disposable account and used live routes/interactions. No product source was changed.
- Audited 1920×1080, 1440×900, 1280×800, 1024×768, 820×1180, 768×1024, 430×932, 390×844, 375×812 and 320×568 across light and dark themes.
- Inspected all accepted screenshots; an initially captured profile dialog was visibly mid-animation and was replaced with a settled capture.
- Measured token contrast with WCAG relative luminance and inspected computed geometry/control rectangles for workspace states.

### State coverage

| Area | Live states inspected | Representative evidence |
|---|---|---|
| Landing | desktop/tablet/mobile, light/dark | [1920 light](screenshots/codex1-visual-landing-1920x1080-light.png), [1024 dark](screenshots/codex1-visual-landing-1024x768-dark.png), [320 dark](screenshots/codex1-visual-landing-320x568-dark.png) |
| Login/register | both themes, desktop/mobile, validation error | [login mobile dark](screenshots/codex1-visual-login-390x844-dark.png), [register validation](screenshots/codex1-visual-register-error-375x812-light.png) |
| Workspace chat | all responsive regimes, empty state | [1920](screenshots/codex1-visual-workspace-chat-1920x1080-light.png), [820](screenshots/codex1-visual-workspace-chat-820x1180-dark.png), [320](screenshots/codex1-visual-workspace-chat-320x568-dark.png) |
| Sources/filter | source list, search/filter popover | [820 filter](screenshots/codex1-visual-source-filter-820x1180-light.png) |
| Summary | empty state desktop/mobile | [desktop](screenshots/codex1-visual-workspace-summary-1440x900-light.png), [mobile](screenshots/codex1-visual-workspace-summary-390x844-dark.png) |
| Workspace MindMap | generated map, desktop/tablet/mobile, light/dark | [1280](screenshots/codex1-visual-workspace-mindmap-1280x800-light.png), [768](screenshots/codex1-visual-workspace-mindmap-768x1024-dark.png), [375](screenshots/codex1-visual-workspace-mindmap-375x812-dark.png) |
| Appearance/export | appearance accordion, Export Studio desktop/mobile | [appearance](screenshots/codex1-visual-appearance-editor-1440x900-light.png), [export desktop](screenshots/codex1-visual-export-studio-1440x900-dark.png), [export mobile](screenshots/codex1-visual-export-studio-430x932-light.png) |
| Account/profile | account popover and profile dialog | [menu](screenshots/codex1-visual-account-menu-390x844-dark.png), [profile](screenshots/codex1-visual-profile-390x844-dark.png) |
| Command/search | command palette desktop/mobile | [1024](screenshots/codex1-visual-command-palette-1024x768-dark.png), [430](screenshots/codex1-visual-command-palette-430x932-light.png) |
| Study library | populated list, desktop/tablet/mobile, light/dark | [1920](screenshots/codex1-visual-study-library-1920x1080-light.png), [1024](screenshots/codex1-visual-study-library-1024x768-dark.png), [430](screenshots/codex1-visual-study-library-430x932-dark.png), [320](screenshots/codex1-visual-study-library-320x568-light.png) |
| StudyMap | generated map, desktop/tablet/mobile, both themes | [1440](screenshots/codex1-visual-study-map-1440x900-light.png), [820](screenshots/codex1-visual-study-map-820x1180-dark.png), [390](screenshots/codex1-visual-study-map-390x844-light.png) |
| Quiz/review/practice | setup, generation failure, route error/retry states | [setup](screenshots/codex1-visual-quiz-setup-1280x800-light.png), [generation failure](screenshots/codex1-visual-quiz-generation-failure-1280x800-light.png), [taking error](screenshots/codex1-visual-quiz-taking-error-390x844-dark.png), [result error](screenshots/codex1-visual-quiz-result-error-1024x768-light.png), [review error](screenshots/codex1-visual-review-error-390x844-light.png), [practice error](screenshots/codex1-visual-practice-error-820x1180-dark.png) |

### Coverage limitation

The audit database exposed 20 library records, but every record reported `status: processing` and no indexed chunks. A real quiz-generation attempt therefore ended with “Phạm vi đã chọn không có chunk nào đã index.” Populated Quiz Taking, Result, Review Guide and Practice screens could not be produced honestly in this environment. Their real setup/loading/error shells were inspected, and populated component code was reviewed, but their data-filled visual hierarchy remains a **likely issue needing validation**, not a confirmed live finding.

Change-password/edit-profile controls are provider-dependent and were not exposed for the disposable local StudyMap account; the account popover and read-only profile dialog were validated live.

## Major findings

### UX-VIS-001 — P1 — Confirmed issue: dark primary CTA text fails contrast

Dark mode sets the interactive accent to `#5B9DF5` while `.btn-primary` and `.btn-seal` force white text. The measured ratio is **2.77:1**, below 4.5:1 for normal text and below 3:1 even for large text. It affects primary actions including login, registration, landing “Bắt đầu,” quiz creation and Study upload actions.

Evidence: [dark login](screenshots/codex1-visual-login-390x844-dark.png), [dark register](screenshots/codex1-visual-register-error-1280x800-dark.png), [dark Study library](screenshots/codex1-visual-study-library-1440x900-dark.png), `FE/src/index.css` `.btn-primary`/`.btn-seal`.

Impact: the highest-priority action is less legible than adjacent secondary copy, especially at 13–14 px. The light theme equivalent is 4.72:1 and passes, confirming a theme-specific role mismatch rather than a component-layout problem.

### UX-VIS-002 — P1 — Confirmed issue: muted token is used as readable copy but fails in both themes

Measured ratios:

- light `#8294B1` on base: **2.89:1**; on white card: **3.08:1**;
- dark `#6B7689` on base: **3.43:1**; on card: **3.15:1**.

The token appears in placeholders, metadata, help text, breadcrumbs, inactive controls and empty-state support copy, often at the 10.5–13 px end of the scale. These are not all safely “decorative” or disabled states.

Evidence: [quiz setup dark](screenshots/codex1-visual-quiz-setup-390x844-dark.png), [Study library dark](screenshots/codex1-visual-study-library-430x932-dark.png), [workspace light](screenshots/codex1-visual-workspace-chat-1920x1080-light.png).

Impact: essential labels such as Study timestamps, inactive-but-available artifact names and form hints recede below the surrounding visual noise.

### UX-VIS-003 — P1 — Confirmed issue: tablet workspace becomes a three-column sliver

At 768–820 px the workspace retains the 252 px source column and a roughly 328 px evidence column, leaving about 239 px for the central reading surface. In the 820×1180 source-filter state the main heading wraps to four lines, the composer compresses its content, and both side regions visually outweigh the primary task.

Evidence: [820 filter open](screenshots/codex1-visual-source-filter-820x1180-light.png), [768 MindMap](screenshots/codex1-visual-workspace-mindmap-768x1024-dark.png).

Impact: the primary reading/canvas hierarchy collapses at common portrait-tablet widths. This is recorded here as a visual-composition failure; interaction/responsive mechanics belong to audit 06.

### UX-VIS-004 — P2 — Confirmed issue: mobile Export Studio presents clipped format choices

At 430×932 the “Xuất nhanh” row extends beyond the right edge; the third format is visibly cut (“Ảnh W…”). The region is horizontally scrollable in CSS but has no visible continuation affordance, edge fade, scrollbar or pagination cue. In contrast, the remaining choices form a clear full-width vertical list.

Evidence: [430 Export Studio](screenshots/codex1-visual-export-studio-430x932-light.png).

Impact: the first workflow step looks broken/unfinished and a valid format can be mistaken for unavailable.

### UX-VIS-005 — P2 — Confirmed issue: mobile StudyMap canvas crops the graph instead of composing it

At 390×844 the canvas is clipped at the viewport edge: the root-to-child connector continues off-screen and the child node is absent from the initial composition. The page supplies zoom and layout controls above, but the first view does not visually communicate the full graph extent. The separate evidence panel is also pushed below the tall canvas.

Evidence: [390 StudyMap](screenshots/codex1-visual-study-map-390x844-light.png), compared with [1440 StudyMap](screenshots/codex1-visual-study-map-1440x900-light.png).

Impact: a generated two-node map initially appears to contain one node and a truncated line, weakening confidence in the artifact.

### UX-VIS-006 — P2 — Confirmed issue: current routes express three competing visual identities

The landing/auth experience is editorial and seal-red; the workspace is a blue dense instrument; Study adds bronze figures, green readiness tags and large stacked white/ink cards. Moving from workspace MindMap to StudyMap also switches node typography, connector language, control placement and canvas framing.

Evidence: [landing](screenshots/codex1-visual-landing-1920x1080-light.png), [workspace](screenshots/codex1-visual-workspace-chat-1920x1080-light.png), [Study library](screenshots/codex1-visual-study-library-1920x1080-light.png), [workspace MindMap](screenshots/codex1-visual-workspace-mindmap-1280x800-light.png), [StudyMap](screenshots/codex1-visual-study-map-1440x900-light.png).

Source confirmation: `index.css` actively defines blue `--accent` while retaining seal/forest/bronze narrative comments from prior redesign phases; `.btn-seal` now renders blue. The historical transition hypothesis is therefore confirmed as a system seam, not assumed from old documents.

Impact: users encounter different rules for what color means “action,” “selection,” “status” and “brand” depending on route. This finding does **not** prescribe which identity should win.

### UX-VIS-007 — P2 — Confirmed issue: Study library cards have insufficient hierarchy for their action density

Each record can show a checkbox, overflow menu, title, summary status, up to six state badges, metadata, a prominent continuation CTA, six artifact/action links and a detail disclosure. On 430 px these actions wrap into three rows; the primary button competes with all secondary links, while successive records repeat the same structure with little grouping relief.

Evidence: [1920 library](screenshots/codex1-visual-study-library-1920x1080-light.png), [430 library](screenshots/codex1-visual-study-library-430x932-dark.png).

Impact: repeated actions dominate document identity and make comparison/scanning harder. This is a hierarchy/density finding; flow duplication is left to audit 05.

### UX-VIS-008 — P2 — Confirmed issue: two “mind map” products use incompatible visual grammar

Workspace MindMap uses a large rounded blue root node, floating zoom box, bottom legend and top-right appearance/export controls. StudyMap uses small circle anchors, serif labels, straight gray connectors, an inline text-heavy toolbar and an adjacent/stacked evidence card. Even empty space is handled differently: workspace centers the root; StudyMap positions a small graph low/left within a large framed canvas.

Evidence: [workspace map](screenshots/codex1-visual-workspace-mindmap-1280x800-light.png), [Study map](screenshots/codex1-visual-study-map-1440x900-light.png).

Impact: similar concepts do not transfer visually between the two tools; perceived quality also differs because the StudyMap graph looks sparse and under-scaled in the same viewport.

### UX-VIS-009 — P2 — Confirmed issue: error-state composition is inconsistent and under-weighted

Quiz generation failure uses a wide progress/status card with percentage and corrective action. Invalid Quiz Taking, Result, Review and Practice routes use a small error line plus “Thử lại” inside otherwise very large blank pages. Header and card widths differ across those four sibling screens.

Evidence: [generation failure](screenshots/codex1-visual-quiz-generation-failure-1280x800-light.png), [taking](screenshots/codex1-visual-quiz-taking-error-390x844-dark.png), [result](screenshots/codex1-visual-quiz-result-error-1024x768-light.png), [practice](screenshots/codex1-visual-practice-error-820x1180-dark.png).

Impact: failure severity and recovery hierarchy depend on which Study route raised the same class of problem. The small upper-left message can read like unfinished content rather than a deliberate terminal state.

### UX-VIS-010 — P2 — Likely issue needing validation: command palette position may conflict with mobile keyboard

The 430×932 palette is vertically centered around y=372 rather than anchored near the top. With the search input focused, a typical software keyboard would occupy the lower portion of the viewport and may cover the results/footer area. No OS keyboard was invoked in the headless capture, so this remains likely rather than confirmed.

Evidence: [430 command palette](screenshots/codex1-visual-command-palette-430x932-light.png).

Validation needed: repeat on iOS Safari and Android Chrome with the virtual keyboard visible and a populated result list.

### UX-VIS-011 — P3 — Confirmed issue: radius language is fragmented

The source contains arbitrary radii at every integer step from 3 through 10 px plus 12, 14 and 16 px, alongside `rounded`, `rounded-lg`, `rounded-full` and the 3 px `rounded-control` token. Live screens visibly mix 3 px apparatus controls, 7 px primary buttons, 8 px cards, round segmented navigation and square Study controls.

Evidence: [appearance editor](screenshots/codex1-visual-appearance-editor-1440x900-light.png), [login](screenshots/codex1-visual-login-1440x900-light.png), [Study library](screenshots/codex1-visual-study-library-1024x768-dark.png). Full counts are in `07-design-system-inventory.md`.

Impact: individual components look polished, but adjacent controls do not consistently belong to the same family.

### UX-VIS-012 — P3 — Confirmed issue: modal/workflow frames do not share one hierarchy

The shared profile and appearance dialogs use a compact centered panel with title row. Appearance then adds four near-equal footer buttons (“Hoàn tác,” “Đặt lại,” “Hủy,” “Áp dụng”). Export Studio uses an almost full-viewport shell, left rail on desktop, icon-only step rail on mobile, and its own sticky footer. Command Palette uses a third frame with an empty title strip and shortcut footer.

Evidence: [profile](screenshots/codex1-visual-profile-1440x900-light.png), [appearance](screenshots/codex1-visual-appearance-editor-390x844-dark.png), [export](screenshots/codex1-visual-export-studio-1440x900-dark.png), [palette](screenshots/codex1-visual-command-palette-1024x768-dark.png).

Impact: each feature has a learnable hierarchy in isolation, but close/title/navigation/action placement is not predictable across overlays.

### UX-VIS-013 — P3 — Confirmed issue: typography roles are clear in tokens but blur in application

Spectral, Inter and IBM Plex Mono have a defensible editorial/instrument/apparatus split. In practice, Spectral is used for public marketing headlines, workspace empty-state headlines, document names and map-node labels; mono appears in both useful metadata and numerous tiny structural labels. The visual roles therefore overlap.

Evidence: [landing](screenshots/codex1-visual-landing-390x844-dark.png), [workspace empty](screenshots/codex1-visual-workspace-summary-390x844-dark.png), [StudyMap](screenshots/codex1-visual-study-map-820x1180-dark.png).

Impact: serif no longer reliably signals “reading content,” and very small mono labels add texture without always improving hierarchy.

## Per-screen observations

### Landing

Confirmed strengths: strong headline hierarchy, consistent editorial grid, excellent primary-text contrast, and a responsive hero that reorders the product diagram below copy. The 320 px version remains readable without horizontal clipping.

Confirmed issues: dark CTA contrast (UX-VIS-001); secondary/muted copy is weak; the product diagram is visually precise but too low-information to explain the actual three-column product. Red remains dominant in the headline while the application is blue-dominant (UX-VIS-006).

### Login and register

Confirmed strengths: forms are centered, stable, and coherent across widths; error copy is adjacent to the relevant form region; fields remain comfortably sized on mobile.

Confirmed issues: dark primary button contrast (UX-VIS-001), low-contrast placeholders/muted “back” link (UX-VIS-002), and subtle input boundaries. The account-provider segmented control and primary button use different active grammars.

### Workspace shell, sources, chat and summary

Confirmed strengths: the desktop grid is aligned and calm at 1280+; the header segmented mode switch is clear; empty states use consistent editorial typography; mobile correctly collapses to icon navigation and drawers.

Confirmed issues: portrait-tablet compression (UX-VIS-003); 28/32/36/40 px control sizes create a slightly uneven toolbar rhythm; mobile icon-only header reduces visible information scent; red empty-state language competes with blue navigation as an accent.

### MindMap, inspector, evidence and appearance

Confirmed strengths: canvas controls remain legible over the large work area; the root node has strong hierarchy; appearance presets and accordions are easy to scan; export/appearance controls are visually reachable on mobile.

Confirmed issues: a single-node fixture leaves extreme unused canvas and makes the bottom legend more prominent than the content; the two map systems diverge (UX-VIS-008); appearance/export overlay grammar differs (UX-VIS-012). Exact-node and connector-specific export states were not visually distinguishable in this audit fixture, so no claim is made about their artifact correctness here.

### Export Studio

Confirmed strengths: desktop step rail, selected scope rows and footer summary form a clear wizard; mobile turns the rail into a compact horizontal progress strip and keeps actions fixed at the bottom.

Confirmed issues: clipped quick-format row (UX-VIS-004); the desktop modal consumes nearly the full viewport for a sparse first step; the mobile rail is mostly icon-only while the content starts immediately below, weakening step orientation.

### Account/profile/settings

Confirmed strengths: account menu alignment is stable at desktop/mobile; the profile modal uses a single-column definition list that handles the long email; settled dialog surfaces are opaque and legible in both themes.

Confirmed issues: local-account profile is purely informational, leaving a very sparse modal with no clear settings grouping. Provider-specific edit/password variants require a separate NKS-backed validation pass.

### Study library

Confirmed strengths: the page has a readable desktop max-width, useful collection rail at wide screens, and consistent status colors. Mobile stacks filters and card actions without page-level horizontal overflow.

Confirmed issues: action-density hierarchy (UX-VIS-007), muted metadata contrast (UX-VIS-002), and identity transition from workspace (UX-VIS-006). The displayed “0 tài liệu” while records are visible is a data/semantics issue and is intentionally left to the usability audit rather than scored here.

### StudyMap

Confirmed strengths: layout/export controls are grouped above the canvas; dark theme is consistently applied to canvas and evidence panel; desktop shows map and detail panel together.

Confirmed issues: mobile crop (UX-VIS-005), incompatibility with workspace map grammar (UX-VIS-008), and under-scaled sparse graph at desktop. The selected blue node ring is visually clear, but the gray connector and small serif label have much lower emphasis than the surrounding toolbar.

### Quiz setup, taking, result, review and practice

Confirmed strengths: setup controls use clear grouped labels and a concise live summary; the generation failure provides cause, percentage and recovery action; sibling error pages keep recovery near the message.

Confirmed issues: error-state hierarchy varies by route (UX-VIS-009); dark button and muted-copy contrast failures recur. Populated taking/result/review/practice hierarchy remains unverified due the environment limitation documented above.

## Opportunities (not confirmed defects)

### UX-VIS-014 — P3 — Design opportunity: make specialist tools inherit more system grammar

Appearance, Export Studio, the two map toolbars and Study cards could consume the same button, field, toolbar, status and dialog-frame primitives before any aesthetic direction is chosen. This would reduce visual seams without deciding whether the final identity is editorial, blue-instrument, or another direction.

### UX-VIS-015 — P3 — Design opportunity: document accent-role ownership

The current palette can work if interaction blue, provenance red, success green and knowledge/metric bronze have explicit ownership and collision rules. The visible problem is not the number of hues alone; it is that comments/classes still encode older meanings and consumers sometimes use color by legacy name.

## Personal preference (not scored as a defect)

- The serif/mono/sans trio gives StudyMap a distinctive scholarly tone and should not be reduced merely for uniformity.
- The cool paper base is cleaner than pure white for long sessions, while the red seal gives the public pages a memorable signature.
- I personally find the large blank workspace calming, but this preference does not offset the confirmed hierarchy and contrast findings above.

## Visual QA priorities for synthesis

1. Resolve UX-VIS-001 and UX-VIS-002 at token/component level and remeasure all themes.
2. Validate the 768–1024 workspace regime before polishing individual panels.
3. Correct mobile Export Studio and StudyMap clipping with real device screenshots.
4. Decide and document role ownership for blue/red/green/bronze before choosing any redesign direction.
5. Consolidate radius, button, field, card, status and overlay primitives using the inventory in `07-design-system-inventory.md`.
6. Re-run populated Quiz/Result/Review/Practice visual audit once an indexed deterministic document fixture exists.
