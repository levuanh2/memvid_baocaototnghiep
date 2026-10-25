# StudyMap usability and flow audit

Audit date: 2026-10-25  
Baseline: `4f228ef9d1e34f8bac59f37a3792fc859400cb64`  
Environment: real Chromium against FE `http://localhost:5180` and Flask/Postgres at `http://127.0.0.1:8090`; AI providers were the supplied deterministic mocks.  
Scope: behavior, user flow, discoverability, feedback, recovery, state preservation, and interaction cost. Visual styling is intentionally excluded.

## Executive summary

The basic shell is understandable and the shortest first-time path—register, add a source, select it, and ask—is discoverable. The audit did **not** produce an end-to-end clean pass, however. A fresh account saw documents created outside that account, a document displayed as indexed failed quiz generation because no indexed chunks were found, and the mocked chat returned an answer without citations. These block three of the seven required journeys at meaningful checkpoints.

The highest-leverage usability problem after those failures is the learning library's presentation model. One document is rendered repeatedly in several overlapping sections, producing a page over 50,000 px tall and more than 800 focusable controls in the captured state. The summary counter simultaneously said `0 tài liệu` while the list offered `Chọn 19 đang hiện`. This makes finding and resuming the correct item materially harder, especially for keyboard and mobile users.

## Evidence and rating method

- P0: essential use/data isolation/data safety failure or severe accessibility failure.
- P1: major failure in an essential workflow or highly confusing essential state.
- P2: significant friction, inconsistency, responsive issue, or recoverable barrier.
- P3: minor polish.
- **Confirmed issue** means reproduced in the live stack and supported by a screenshot, DOM/accessibility trace, console trace, or downloaded artifact.
- **Likely issue needing validation** means the audited environment prevented the production-like branch from being exercised.
- **Design opportunity** identifies avoidable interaction cost without claiming a defect.
- No finding below is based only on aesthetic preference.

Key evidence:

- [Fresh account / first workspace](screenshots/ux-03-first-app-shell.png)
- [Fresh account sees a long pre-existing document library](screenshots/ux-05-two-documents-uploaded.png)
- [Multi-source chat answer with empty evidence panel](screenshots/ux-09-chat-result-citations.png)
- [Mind-map generation choices](screenshots/ux-25-map-dialog-before-submit.png)
- [Generated one-node mock map](screenshots/ux-26-map-generated.png)
- [Quiz generation contradicts the displayed indexed state](screenshots/ux-19-quiz-generated-or-progress.png)
- [Mobile learning library above the fold](screenshots/ux-32-mobile-study-above-fold.png)
- [Export review](screenshots/ux-35-export-review.png)
- [Downloaded SVG reopened in Chromium](screenshots/ux-37-opened-exported-svg.png)

## Journey results

| Journey | Measured path | Effective interaction count | Outcome | Critical information / recovery |
|---|---|---:|---|---|
| 1. First-time learner | Landing CTA → register form → submit → add two sources → select all → compose → Enter → view result | 10 (1 CTA, 4 form fields/actions, 2 uploads, 1 select-all, 1 compose, 1 submit) | **Partial / blocked at evidence quality** | Registration and upload were clear. Answer rendered, but it was only `mock answer`; no citation or source evidence appeared. |
| 2. Research workflow | Select two sources → verify selected count → ask comparative question → inspect right evidence panel | 4 | **Blocked** | The right panel remained in its empty instructional state. There was no citation chip to open and the stream ended with an uncaught `AbortError`. |
| 3. Mind map | Mind-map tab → empty-state CTA → configure → submit → view map | 4 to generated map | **Partial** | Generation succeeded, but the deterministic backend returned one root node only. Node-to-node navigation and expand/collapse could not be meaningfully exercised. |
| 4. Export | Reopen map → close/avoid inspector overlap → Export → content → SVG → appearance → review → Export SVG → open file | 8 | **Pass with friction** | A 429,468-byte SVG downloaded and rendered in Chromium. The just-generated map initially positioned the inspector over the export trigger, requiring an extra close/backtrack. |
| 5. Learning | Library → choose owned document → Quiz → accept defaults → Create quiz → wait | 3 | **Blocked** | UI said the source had `1 đoạn` and `Đã lập chỉ mục`; job then failed with `Phạm vi đã chọn không có chunk nào đã index.` Recovery offered “Sửa cấu hình và thử lại,” which cannot repair missing chunks. |
| 6. Returning user | Leave workflow → `/app` → reload → inspect sources/conversation → library “continue” card | 2 plus re-selection | **Partial / state lost** | Source selection returned to 0 and the prior answer was not restored in the reloaded workspace. Library did expose “Tiếp tục · Quiz,” but its aggregate count contradicted the visible records. |
| 7. Mobile | Open workspace at 390×844 → open source drawer → select sources path → open study library → inspect first card | 3 | **Visual layout passes; interaction/a11y does not** | No document-level horizontal overflow was measured. Essential controls fit, but hidden drawer controls remain in keyboard order and the library repeats cards across categories. |

Interaction counts include user actions, not passive waits. Direct route entry was used only to return to already discovered `/app` and `/app/study` states; controls within each journey were exercised through the UI.

## Confirmed issues

### UX-001 · P1 · App API ownership protection fails open when its environment flag is omitted

The cross-account list was reproduced in the audit environment, but it is **not evidence of a current production data leak**. The local server was `BE/scripts/run_e2e_server.py`, which explicitly defaults `AUTH_PROTECT_APP_APIS` to `false`. With that flag off, `/list-indexed` intentionally skips the `owned_stems(uid)` filter, so a newly registered local account saw 17 existing `sample-doc (n).txt` records and 19 after uploading two owned files.

The production posture was checked directly, not inferred from the application default: `render.yaml:247-251` labels the block `# --- auth: production posture ---` and sets `AUTH_PROTECT_APP_APIS` to `"true"`. In that configuration, `BE/app/main.py:4471-4475` filters `/list-indexed` through `owned_stems(uid)`. Current Render production configuration is therefore protected.

Evidence: [the local E2E library capture](screenshots/ux-05-two-documents-uploaded.png) contains the two `ux-audit-*` files plus the pre-existing `sample-doc` records. The enabling mechanism is `BE/app/main.py:1492-1493`, where `_auth_protect_enabled()` defaults the environment variable to `false`; the E2E launcher repeats that open posture at `BE/scripts/run_e2e_server.py:51`.

Impact: this is a deployment-hardening and fail-safe-default concern. Any future deployment path that omits the flag would silently expose cross-account document listings rather than fail closed. Prefer a secure default, or emit a loud startup failure/warning when the flag is unset or false in a production-labelled process. Keep the local open mode explicit for test environments.

### UX-002 · P1 · Ready/indexed presentation contradicts quiz eligibility

The owned `ux-audit-secondary.txt` displayed a green ready indicator, `1 đoạn`, and later `Đã lập chỉ mục`. Default quiz generation failed at 0% with `Phạm vi đã chọn không có chunk nào đã index.` The only recovery action, “Sửa cấu hình và thử lại,” returns to question settings even though count, difficulty, and question type cannot fix the stated cause.

Evidence: [quiz failure](screenshots/ux-19-quiz-generated-or-progress.png) and [the same document shown as indexed](screenshots/ux-32-mobile-study-above-fold.png).

Impact: the learning journey stops before taking, results, review, and practice-again stages. Recovery text sends the learner toward the wrong remedy.

### UX-003 · P1 · Research answer completes without the promised citations or evidence

With two sources selected, the chat returned `mock answer`. No citation chips were present and “Bằng chứng câu trả lời” continued to say evidence would appear after asking. The browser also recorded an unhandled `AbortError: BodyStreamBuffer was aborted` from `ChatArea.jsx` / `sseStream.js` immediately after the response.

Evidence: [chat result](screenshots/ux-09-chat-result-citations.png). The accessibility snapshot contains the answer paragraph but no citation link/button and preserves the empty evidence instructions.

Impact: “Chat with citations → Inspect evidence,” a primary product promise, is not verifiable and appears broken to the learner. The UI provides no retry or explanation that the deterministic provider omitted evidence.

### UX-004 · P1 · Learning library repeats records across overlapping sections

The same document appears under “Tiếp tục học,” “Hôm nay,” “Tải lên gần đây,” “Chưa mở bao giờ,” “Cần tóm tắt,” “Cần sơ đồ,” “Cần quiz,” and “Tất cả tài liệu.” Each copy repeats selection, overflow, summary, map, quiz, practice, Ask AI, and detail controls. The desktop full-page capture exceeded 50,000 px; the instrumentation counted 823 visible interactive controls after two uploads.

Evidence: [desktop full-page capture](screenshots/ux-05-two-documents-uploaded.png) and [mobile card duplication](screenshots/ux-32-mobile-study-above-fold.png).

Impact: scanning cost grows multiplicatively, keyboard navigation becomes impractical, and “return to the correct document” becomes harder rather than easier. Section shortcuts are useful, but duplicating complete actionable cards in every section is not.

### UX-005 · P1 · Library aggregate count says zero while records and bulk selection say 19

At 390×844 the summary says `0 tài liệu`, while the same screen offers `Chọn 19 đang hiện` and renders document cards. The contradiction is above the first result and is therefore likely to undermine confidence before any action.

Evidence: [mobile learning library](screenshots/ux-32-mobile-study-above-fold.png).

Impact: users cannot tell whether their library is empty, whether filtering is active, or whether records belong to them. This compounds UX-001.

### UX-006 · P2 · Returning to the workspace does not preserve the active source context

Two selected sources became zero after leaving/reloading the workspace. The composer returned to “Chưa chọn nguồn,” so continuing the previous activity requires reopening the source drawer and reconstructing scope. The previous mocked answer was not present after reload in this run.

Evidence: compare [two selected sources](screenshots/ux-09-chat-result-citations.png) with [fresh mobile workspace / zero selected](screenshots/ux-30-mobile-workspace-fresh.png).

Impact: returning users can silently ask against a different scope unless they notice the small selected-source status. If clearing selection is intentional for safety, state that choice prominently and offer one-click restoration.

### UX-007 · P2 · The “StudyMap” header menu does not lead to the learning library

The header control labelled “Mở công cụ StudyMap” exposes Gia sư AI, Dòng thời gian, and Kiến thức. It does not expose “Thư viện học tập,” Documents, Quiz, or Practice. The logo returns to `/app`, not `/app/study`. The learning library is therefore difficult to rediscover from the core workspace even though it is the owner of returning-study workflows.

Evidence: [StudyMap tools menu](screenshots/ux-38-study-tools-menu.png).

Impact: “StudyMap” reads like the product-area destination but behaves as a contextual-tools menu. This increases navigation guessing and makes the returning-user journey dependent on remembered URLs or incidental shortcuts.

### UX-008 · P2 · Immediately after generation, the inspector can obstruct Export

On the newly generated map the right inspector remained open and overlaid the right end of the map toolbar. Playwright repeatedly reported that `.study-surface-header` inside `.mindmap-tools-overlay` intercepted pointer events on the otherwise visible `Xuất sơ đồ` button. Closing/avoiding the inspector allowed export to proceed.

Evidence: [generated map with inspector covering toolbar](screenshots/ux-26-map-generated.png). A later reopened map exported successfully, so this is a recoverable state-dependent obstruction, not a universal export failure.

Impact: the next natural action after generation can require unexplained panel management.

### UX-009 · P2 · Export selection and review are reliable but costly for a simple vector export

SVG required opening Export, accepting scope, advancing to formats, selecting SVG, advancing to appearance, advancing to review, and confirming. The four-step rail and final summary are useful for complex exports, but a frequent “download current map as SVG” task takes seven dialog interactions after the map is open.

Evidence: [format step](screenshots/ux-35-export-format.png), [appearance step](screenshots/ux-35-export-appearance.png), [review step](screenshots/ux-35-export-review.png), and [opened artifact](screenshots/ux-37-opened-exported-svg.png).

Impact: significant but non-blocking friction. Preserve the full configurator; consider a contextual shortcut only if telemetry confirms repeated same-format exports.

### UX-010 · P2 · Empty evidence occupies a permanent third column

Before and after the citation-free answer, the right evidence panel consumes substantial desktop width while containing only instructions. The panel can be collapsed, but there is no result-specific prompt explaining why it stayed empty.

Evidence: [chat result](screenshots/ux-09-chat-result-citations.png).

Impact: reduces answer reading space and makes the missing-citation state look like a rendering delay rather than a completed response with no evidence.

## Likely issues needing validation

### UX-011 · P1 · Multi-node mind-map navigation was not testable in the supplied deterministic backend

The real generation endpoint succeeded but returned `E2E mock mindmap` with exactly one node. There was no child expander, connector, sibling, or branch to navigate. Therefore expand/collapse, branch selection, node-to-node inspector history, and return behavior are **not passed**.

Evidence: [generated one-node map](screenshots/ux-26-map-generated.png) and the export summary reporting `1 node`.

Required validation: provide a deterministic multi-level map fixture through the same live route, then repeat select → inspect → back/forward → collapse → expand → return.

### UX-012 · P1 · Quiz result, review, and practice-again remain unverified

UX-002 stopped the flow before a quiz existed. The library did expose “Tiếp tục · Quiz,” but it referred to the failed attempt state and could not establish the result/review/practice lifecycle.

Required validation: seed or generate one owned quiz from an actually indexed owned document, then complete all answer types, submit, open “Xem phần cần ôn,” and start practice again.

### UX-013 · P1 · Provider-backed citation inspection remains unverified

The supplied mock did not emit citations. The UI's citation/evidence interaction semantics may work with a production provider, but this audit cannot claim that outcome.

Required validation: extend the deterministic mock to emit at least two citations across two documents, including an unavailable/deleted evidence case for recovery.

## Design opportunities

### UX-014 · P2 · Make library sections navigational views, not repeated full records

Keep useful categories such as “Continue learning” and “Needs quiz,” but make them filters, anchors, or compact references to one canonical document card. This preserves shortcuts without multiplying every control and state announcement.

### UX-015 · P2 · Align recovery actions with the diagnosed cause

When the server says there are no indexed chunks, offer “Check document processing” or “Re-index” rather than “Edit quiz configuration.” When an answer has no citations, say so and offer retry/report instead of leaving the evidence panel in its pre-question state.

### UX-016 · P3 · Preserve safe defaults between repeated exports

The export summary and artifact were accurate. Remembering the last format/preset per user or map could reduce repeat work without removing the review step.

## Positive observations

- Registration fields expose programmatic labels and follow a logical keyboard order.
- The workspace uses meaningful landmarks, a named tablist, named side regions, and clear selected-source count.
- The generated map status and the export review provide clear completion feedback.
- The SVG downloaded through the real UI and reopened successfully; the artifact contained the expected root text.
- At 390 px, no document-level horizontal overflow was measured in either the workspace or study library.

## Audit limits

This was a live read-only audit, not a source modification pass. AI output was intentionally mocked; where that mock prevented citations, a multi-node map, or a successful quiz, the corresponding journey is marked blocked or needing validation. No claim of WCAG conformance is made.
