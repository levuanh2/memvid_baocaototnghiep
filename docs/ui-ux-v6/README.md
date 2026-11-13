# StudyMap V6 — redesign and frontend reliability

Evidence-first, delivered as small Draft PRs on top of V5. Nothing here is merged or deployed without owner approval. R7 stays **NO-GO**.

V6 is **not complete**. This file is the single status page: it says which waves have shipped as Draft PRs and which have not started.

| Doc | Content |
|---|---|
| [01-audit.md](01-audit.md) | Browser audit of the live site and the confirmed frontend bug inventory |
| [02-design-spec.md](02-design-spec.md) | V6 direction, what V6 keeps from V5, and the rules for new surfaces |
| [03-actions-and-journeys.md](03-actions-and-journeys.md) | Action inventory decisions and which journey steps have automated tests (agy, not independently verified) |
| `evidence/before`, `evidence/after` | Full-page captures from the running app (Playwright, local Vite), not mockups |

## Waves

| Wave | Scope | Status |
|---|---|---|
| A | Design foundation: direction, rules, landing as the first surface built to them | **Draft PR** (this branch): spec + Landing. Tokens for the app shell are not changed yet |
| B | Navigation and information architecture: header, sidebars, action hierarchy | **Started.** Header #167; Library sidebar #166. Workspace sidebars, "Công cụ học" and the usage chip are unchanged |
| C | Learning experience: Library, Chat, Summary, Quiz, learning dashboard | **Started.** Chat start screen #161; chat conversation #174; composer #178; evidence panel #180; account page #168; quiz-taking #169; quiz results #175; quiz setup and progress #179; Library card #171; learning home #172; Library page integration #173; Library as one list #176. Not started: conversation history (needs a backend route, see #180), the right inspector, review guide, score header, the detailed dashboard panel |
| D | Knowledge visualisation: Mind map, Knowledge map, toolbars, export | Not started |
| E | Frontend reliability: the bugs in `01-audit.md` §2 and §3 | Bug-hunt findings 1-15 each have a fix in a Draft PR: 1 and 11 in #163; 2, 12 and 15 in #160; 3, 4, 7, 14 in #164; 13 in #165; 5, 6, 8, 9, 10 in #162. Also #160 (false empty library) and #165 (false empty Summary / mind-map screen, first-commit flash). Two review clicks in one tick: fixed in #177 (ref lock; the backend also answers a second resume with 409). Left open: a stale `POST /query` is ignored, not aborted, and the backend does not stop a `query` job (audit in #180) |

## Status

Six different things are kept apart below. Do not read one as another.

| Column | Meaning |
|---|---|
| Draft PR | The change exists on a Draft pull request. Nothing more. |
| Tested alone | Local runs on that branch by itself (counts in the PR). CI on the PR's head is separate and is named as CI. |
| Local integration | The branch was part of a local merge of V6 branches that was tested as a whole. Never pushed. |
| Merged to `main` | **None of the V6 pull requests is merged.** `main` is `db005ab`. |
| Deployed | **Nothing from V6 is deployed.** studymap.space runs `main`. |
| Not verified | Listed under "Not verified". |

### Pull requests

`CI` = the required check on the head named here, read from GitHub on 2026-11-13.
`Trial 4` = the head that was in the fourth local integration (next section); a different head means the branch changed afterwards.

| PR | Branch | Head | CI | Tested alone | Trial 4 head | Depends on |
|---|---|---|---|---|---|---|
| #159 | `design/v6-foundation` | this branch | pass on `97ec77e` | Vitest 1933; `landing-v6.spec.js` 38/38 over two repeats | `97ec77e` | — |
| #160 | `fix/v6-source-loading-state` | `22aa5b5` | pass | Layout 174; `source-loading-state.spec.js` 8/8 | same | — |
| #161 | `design/v6-chat-start` | `32bb6c1` | pass | Vitest 1940; five chat fixture specs 55/55 | same | #160 (stacked) |
| #162 | `fix/v6-double-submit-guards` | `4e42f9d` | pass | Vitest 1938 | same | — |
| #163 | `fix/v6-chat-attempt-identity` | `abc25d7` | pass | Layout 174 | same | — |
| #164 | `fix/v6-stale-owner-guards` | `7a39e12` | pass | Vitest 1945; `knowledge-map-*.spec` 4/4 | same | — |
| #165 | `fix/v6-summary-loading-state` | `d24d6aa` | pass | Vitest 1951 at the merge; `summary-loading-state.spec.js` 5/5 | same | #164 (stacked) |
| #166 | `design/v6-library-actions` | `43ff246` | pass | Vitest 1934; Library fixture specs 42/42 | same | — |
| #167 | `design/v6-header` | `0279d07` | pass | Vitest 1936; `mobile-header.spec.js` 115/115 | same | reconcile with #160 |
| #168 | `design/v6-profile` | `c9d329e` | pass | Vitest 1942 | same | — |
| #169 | `design/v6-quiz` | `ceea584` | pass | Vitest 1939; quiz fixture specs 9/9 | same | — |
| #170 | `ci/v6-fixture-smoke` | `5253f86` | pass | list unit test 5/5; six added specs 21/21; gate failure proven on CI | same | merge first |
| #171 | `design/v6-library-card` | `1ee999e` | pass | Vitest 1943 before the review fixes; card tests after them | same | — |
| #172 | `design/v6-learning-home` | `61feebc` | pass | Vitest 1940 before the last fix | same | — |
| #173 | `design/v6-library-integration` | `4cd342e` | pass | Vitest 1956; `library-learning-home.spec.js` 18/18; five Library specs 46/46 | same | #166, #171, #172 (stacked) |
| #174 | `design/v6-chat-workspace` | `99a29ee` | pass | Vitest 1951; chat, evidence and header fixture specs 141/141 | same | #160, #161, #163 (stacked) |
| #175 | `design/v6-quiz-result` | `99c78f2` | pass | Vitest 1941; quiz-result fixture specs 12/12 | same | #169 (stacked) |
| #176 | `design/v6-library-one-list` | `d3d139d` | pass | `library-one-list.spec.js` 18/18; grouping unit tests | same | #173 (stacked) |
| #177 | `fix/v6-chat-review-single-flight` | `02a2310` | pass | ChatArea tests | same | #174 (stacked) |
| #178 | `design/v6-chat-composer` | `c04fdd1` | pass | `chat-composer.spec.js` 10/10; chat-start specs updated | same | #177 (stacked) |
| #179 | `design/v6-quiz-setup` | `f8792b1` | pass | Vitest 1945; `quiz-setup-v6.spec.js` 6/6 | same | #175 (stacked) |
| #180 | `design/v6-chat-evidence` | `7a7fa3e` | pass | Layout tests 192/192 | not in trial 4 | #178 (stacked) |
| #181 | `fix/test-guided-dialog-unmount` | `78935e1` | see PR | shuffled full Vitest 1933/1933 | not in trial 4 | — (test only) |

### Local integrations (never pushed)

| Trial | Branches | Commit / tree | Vitest | Build | Lint | Full Fixture Audit |
|---|---|---|---|---|---|---|
| 1 | #159-#166 (8) | discarded | 1968/1968 | pass | 63 | 603/604; the failure was a 43.99997px measurement in `landing-v6.spec.js`, fixed in #159 |
| 2 | #159-#169 (11) | `ce5dd9c` | 1994/1994 | pass | 63 | 608/608, 24.8 min |
| 3 | #159-#172 (14) | `aba1494c89ef` / tree `e3217ca2dab2` | 2016/2016 (246 files) | pass | 63 (baseline 67) | 608 collected, 608 passed, 0 failed, 0 skipped, 0 flaky, 22.0 min |
| 4 | #159-#179 (21) | `1df5748` / tree `effeb5af95b4` | 2042/2042 (250 files) | pass | 63 (baseline 67) | **660 collected, 660 passed, 0 failed, 0 skipped, 0 flaky**, 27.8 min |

Trial 4 details:
- Command: `npx playwright test -c playwright.fixture.config.js --workers=1 --fail-on-flaky-tests`, Chromium only (the config has one project). Logs kept outside the repository: `studymap-qa-execution/v6/results/integration-21/`.
- Heads merged: the "Trial 4 head" column above, in the order of `04-integration-checklist.md`. Conflicts: the two `.playbook` files (kept both sides), one line of `MainLayout.jsx` between #160 and #167, and the end of `FE/src/index.css` (#167 and #174 both append). The first build failed with "Unclosed block" at `index.css:1278`: the resolution had dropped the closing `}` of #167's `@media (max-width: 767px)` block. The trial commit `1df5748` restores it. Whoever merges must keep both appended blocks **and** that brace.
- The smoke-list script found 21 spec files on the merged tree.
- **Not covered by trial 4:** #180 and #181 (tested on their branches and by CI only).

### Merge order and conflicts

See `04-integration-checklist.md` for the dependency graph, the order, and what to check at each step.

## Skills and tools used

| Skill / tool | Used for |
|---|---|
| `frontend-design` (read and applied) | Landing: design plan, review against generic defaults, copy rules |
| Claude in Chrome | Live audit of studymap.space with the QA browser account (read-only: no upload, no generation, no deletion) |
| Playwright (fixture config, local Vite) | Before/after captures and the landing regression spec |
| Codex (Herdr pane) | Read-only frontend bug hunt (`01-audit.md` §3); reviews of #159-#165 and of the header, Library and account-page branches; wrote the fixes for findings 2, 3, 11 and 15 with their tests (each reviewed and adjusted before commit) |
| agy (Herdr pane) | Read-only inventories: routes and actions, journey-to-test map, controls of header / Library / Summary / account page, quiz and review screens, Fixture Audit vs Fixture Smoke coverage. Items were checked in code before use; three of its claims were wrong and were not acted on |

Not used: `ui-ux-pro-max`, `web-interface-guidelines`, `design-system` are installed but were not read for this wave.

## Not verified

- Real phones and tablets. Every width here is an emulated viewport in Chromium.
- Firefox and WebKit.
- Screen readers.
- Live-site flows that create data (upload, generation, quiz attempts) were not run on production.

## Owner decisions

Decided:
1. Library: "Yêu thích" and "Đã ghim" are filters in the "Lọc" popover only (#166).
2. Header: one theme control; shortcut help in the account menu (#167).
3. Account page keeps "Đổi mật khẩu" as well as the account menu; both open the same dialog (#168).
4. Regression specs may be added to Fixture Smoke through a separate pull request (#170).
5. The card renderer is the Library design for V6. The matrix renderer and its flag stay in the code, unchanged.

Open:
1. Landing headline and sample content are proposals (#159). Wordmark contrast: keep the brand red under the logo exemption, or add a darker brand-text token.
2. One document, one card: decided by the owner, done in #176 (views "Tất cả", "Học gần đây", "Tải lên gần đây", "Cần xử lý"; 4,789px to 1,821px at 1440). Open: a separate "Đã ghim" view would contradict decision 1, so pinned documents are only sorted first in "Tất cả".
3. The Library header's "Tải tài liệu lên" is a filled button next to the learning home's filled "Tiếp tục" (#173).
4. "Tiếp tục" is no longer offered for a document that is not indexed or whose processing failed (#171).
5. Whether practice submit should be idempotent on the server (#162).

## Backlog, in order

1. AI chat workspace: conversation history (needs a backend route that lists a learner's conversations; an owner-approved API change), mobile keyboard and `visualViewport`, the right inspector. Done: start screen (#161), conversation and citations (#174), composer (#178), evidence panel names (#180).
2. Quiz score header and review guide. Done: quiz-taking (#169), the per-question result list (#175), setup and progress (#179).
3. Workspace panels: left and right sidebars, mind-map controls, summary pane, knowledge-map evidence, toolbars, dialogs.
4. Library: the detailed "Tổng quan học tập" panel; the "Đang yếu ở" section; the phone tools sheet and mind-map shortcut of the matrix renderer (not moved in #176).
5. Reliability: a stale `POST /query` is ignored, not aborted, and the backend has no cancel for `query` jobs. Done: `SidebarRight.guidedDialogClose.test.jsx` order dependence (#181: the test never unmounted its root, so the portaled dialog leaked into the next test; CI does not shuffle) and the Library page's test globals (#166).
6. Coverage: Firefox, WebKit, real devices, screen readers. Move the five V6 specs to `REQUIRED` in the smoke list after their pull requests merge.
7. Matrix renderer: its empty-library state is fixed in #176. A later pull request should fold its useful parts into the card renderer (task views, remembered search and scroll, the phone tools sheet, the mind-map shortcut) and remove the second renderer.
