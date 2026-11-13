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
| C | Learning experience: Library, Chat, Summary, Quiz, learning dashboard | **Started.** Chat start screen #161; chat conversation #174; composer #178; evidence panel #180; account page #168; quiz-taking #169; quiz results #175; quiz setup and progress #179; Library card #171; learning home #172; Library page integration #173; Library as one list #176; quiz score header and review guide #182; phone keyboard #184. Not started: conversation history (backend route not approved; design proposal below), the right inspector, the detailed dashboard panel, workspace side panels |
| D | Knowledge visualisation: Mind map, Knowledge map, toolbars, export | Not started |
| E | Frontend reliability: the bugs in `01-audit.md` §2 and §3 | Bug-hunt findings 1-15 each have a fix in a Draft PR: 1 and 11 in #163; 2, 12 and 15 in #160; 3, 4, 7, 14 in #164; 13 in #165; 5, 6, 8, 9, 10 in #162. Also #160 (false empty library) and #165 (false empty Summary / mind-map screen, first-commit flash). Two review clicks in one tick: fixed in #177 (ref lock; the backend also answers a second resume with 409). Server side: two submits of one attempt or practice quiz were both graded; fixed in #183 (row locks, replay rule). Test order: #181. Left open: a stale `POST /query` is ignored, not aborted, and the backend does not stop a `query` job (audit in #180) |

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

`CI` = the required check on the head named here, read from GitHub on 2026-11-14.
`Trial 5` = the head that was in the fifth local integration (next section). All current heads were in it.

| PR | Branch | Head | CI | Tested alone | Trial 5 head | Depends on |
|---|---|---|---|---|---|---|
| #159 | `design/v6-foundation` | this branch | pass on `a210312` | Vitest 1933; landing specs 23/23; copy and wordmark-contrast tests | `a210312` | — |
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
| #176 | `design/v6-library-one-list` | `953b142` | pass | Vitest 1966; Library specs 36/36 | same | #173 (stacked) |
| #177 | `fix/v6-chat-review-single-flight` | `02a2310` | pass | ChatArea tests | same | #174 (stacked) |
| #178 | `design/v6-chat-composer` | `c04fdd1` | pass | `chat-composer.spec.js` 10/10; chat-start specs updated | same | #177 (stacked) |
| #179 | `design/v6-quiz-setup` | `f8792b1` | pass | Vitest 1945; `quiz-setup-v6.spec.js` 6/6 | same | #175 (stacked) |
| #180 | `design/v6-chat-evidence` | `7a7fa3e` | pass | Vitest 1957; build pass | same | #178 (stacked) |
| #181 | `fix/test-guided-dialog-unmount` | `78935e1` | pass | shuffled full Vitest 1933/1933 | same | — (test only) |
| #182 | `design/v6-quiz-review` | `85c43bc` | pass | Vitest 1955; `quiz-review-v6.spec.js` 5/5 | same | #179 (stacked) |
| #183 | `fix/practice-submit-atomic` | `1d787f8` | pass (backend suite on PostgreSQL) | concurrency tests 5/5 (red 4/4 on `main`); backend suite 2962 passed, 6 failed also on `main` | same | — (backend only) |
| #184 | `design/v6-mobile-viewport` | `337cae4` | pass | Vitest 1960; mobile/chat specs 160/160 | same | #180 (stacked) |

### Local integrations (never pushed)

| Trial | Branches | Commit / tree | Vitest | Build | Lint | Full Fixture Audit |
|---|---|---|---|---|---|---|
| 1 | #159-#166 (8) | discarded | 1968/1968 | pass | 63 | 603/604; the failure was a 43.99997px measurement in `landing-v6.spec.js`, fixed in #159 |
| 2 | #159-#169 (11) | `ce5dd9c` | 1994/1994 | pass | 63 | 608/608, 24.8 min |
| 3 | #159-#172 (14) | `aba1494c89ef` / tree `e3217ca2dab2` | 2016/2016 (246 files) | pass | 63 (baseline 67) | 608 collected, 608 passed, 0 failed, 0 skipped, 0 flaky, 22.0 min |
| 4 | #159-#179 (21) | `1df5748` / tree `effeb5af95b4` | 2042/2042 (250 files) | pass | 63 (baseline 67) | 660 collected, 660 passed, 0 failed, 0 skipped, 0 flaky, 27.8 min |
| 5 | #159-#184 (26) | `e3ff458` / tree `76afcfbce69f` | 2071/2071 (256 files); shuffled (seed 61201) 2071/2071 | pass | 63 (baseline 67) | **675 collected, 673 passed, 0 failed, 0 flaky, 2 skipped** (the two screenshot-capture tests, which run only with `V6_SHOT_OUT`), 25.1 min |

Trial 5 details:
- Command: `npx playwright test -c playwright.fixture.config.js --workers=1 --fail-on-flaky-tests`, Chromium only (the config has one project). Logs outside the repository: `studymap-qa-execution/v6/results/integration-26/`.
- 69 non-merge commits; no two share a patch-id or a subject (no duplicated commit or diff across the stacks).
- Conflicts: the two `.playbook` files (kept both sides), one line of `MainLayout.jsx` (#160/#167), and the end of `FE/src/index.css` (#167/#174). The union of the two appended CSS blocks again lost the shared closing `}` of #167's `@media (max-width: 767px)` block ("Unclosed block", line 1283); the local commit `e3ff458` restores it, exactly as in trial 4. Whoever merges must keep both blocks **and** that brace; #184 adds its CSS mid-file on purpose to stay out of this.
- Lint: `eslint .` 63 problems, `lint:ratchet` pass (baseline 67).
- The smoke-list script (#170) lists 25 spec files; the three new specs of #159, #182 and #184 are not in it (the list names files explicitly).
- Backend (#183) is in the tree but the local backend suite was run on its own branch, not on this tree.

### Merge order and conflicts

See `04-integration-checklist.md` for the dependency graph, the order, and what to check at each step.

## Skills and tools used

| Skill / tool | Used for |
|---|---|
| `frontend-design` (read and applied) | Landing; quiz score header (#182: one signature element, shape as well as colour, restraint elsewhere) |
| Claude in Chrome | Live audit of studymap.space with the QA browser account (read-only: no upload, no generation, no deletion) |
| Playwright (fixture config, local Vite) | Before/after captures and the landing regression spec |
| Codex (Herdr pane) | Read-only frontend bug hunt (`01-audit.md` §3); reviews of #159-#165, the header, Library and account-page branches, and #183 (three findings, all fixed in `1d787f8`); wrote the fixes for findings 2, 3, 11 and 15, the review-guide part of #182 and the wordmark token of #159, each with tests and reviewed before commit |
| agy (Herdr pane) | Read-only inventories: routes and actions, journey-to-test map, controls of header / Library / Summary / account page, quiz and review screens, Fixture Audit vs Fixture Smoke coverage. Items were checked in code before use; three of its claims were wrong and were not acted on |

Not used: `ui-ux-pro-max`, `web-interface-guidelines`, `design-system` are installed but were not read for this wave.

## Not verified

- Real phones and tablets. Every width here is an emulated viewport in Chromium. The keyboard in #184 is simulated (the test drives `visualViewport`).
- Firefox and WebKit (only Chromium is installed for Playwright on this machine).
- Screen readers.
- Live-site flows that create data (upload, generation, quiz attempts) were not run on production.

## Owner decisions

Decided:
1. Library: "Yêu thích" and "Đã ghim" are filters in the "Lọc" popover only (#166).
2. Header: one theme control; shortcut help in the account menu (#167).
3. Account page keeps "Đổi mật khẩu" as well as the account menu; both open the same dialog (#168).
4. Regression specs may be added to Fixture Smoke through a separate pull request (#170).
5. The card renderer is the Library design for V6. The matrix renderer and its flag stay in the code, unchanged.
6. Library: one document, one card (#176); no separate "Đã ghim" view; "Tiếp tục" never for a failed, unindexed or not-ready document (#171, extended in #176 to indexed-then-failed documents and the Command Palette); retry only where the backend supports it (there is no reprocess route, so no retry action).
7. Landing: no absolute promises; the headline was shortened (#159); keep the V5 brand; wordmark text at 4.5:1 through `--brand-text` without changing the mark (#159).
8. Practice submission: server-side protection prepared as a Draft (#183); no deploy and no public API change without approval.
9. Conversation history: no new backend route; API design only (below).

Open:
1. #183's replay rule (same answers within 30 s get 409) is a heuristic; an `Idempotency-Key` header would be exact but is an API change (proposal in #183). Choose the window, or approve the key.
2. Wordmark in the landing footer and the app header still measures 3.95:1 (light) / 4.20:1 (dark); #159 changed only the landing header.
3. The new headline "Hỏi chính tài liệu của bạn, rồi xem câu trả lời dựa trên đoạn nào." is a proposal.
4. lean-ctx PreToolUse hook: quoting it would block `herdr`/`docker` for every session; proposal in `studymap-qa-execution/v6/results/hook-rewrite-enforce-2026-11-14.md`.

### Conversation history: API design only (not implemented)
`GET /api/conversations?limit=20&before=<iso>` for the signed-in user: `{ conversations: [{ id, title, document_stems, last_message_at, message_count }], next_before }`, newest first, owner-scoped like `/conversations/<id>/messages`, no message bodies in the list. The frontend would list them under the chat header and reload one through the existing `GET /conversations/<id>/messages`.

## Backlog, in order

1. AI chat workspace: conversation history (API design above; route not approved), the right inspector, iOS `visualViewport.offsetTop` while focused. Done: start screen (#161), conversation and citations (#174), composer (#178), evidence panel names (#180), phone keyboard (#184).
2. Quiz: per-topic practice history on the review guide (the API has none). Done: quiz-taking (#169), the per-question result list (#175), setup and progress (#179), score header and review guide (#182). Open: at 390px the `StudyShell` title is cut to one letter when the header action is long.
3. Workspace panels: left and right sidebars, mind-map controls, summary pane, knowledge-map evidence, toolbars, dialogs.
4. Library: the detailed "Tổng quan học tập" panel; the "Đang yếu ở" section; the phone tools sheet and mind-map shortcut of the matrix renderer (not moved in #176).
5. Reliability: a stale `POST /query` is ignored, not aborted, and the backend has no cancel for `query` jobs. Done: `SidebarRight.guidedDialogClose.test.jsx` order dependence (#181: the test never unmounted its root, so the portaled dialog leaked into the next test; CI does not shuffle) and the Library page's test globals (#166).
6. Coverage: Firefox, WebKit, real devices, screen readers. Move the V6 specs to `REQUIRED` in the smoke list after their pull requests merge, and add `quiz-review-v6`, `mobile-viewport`, `landing-wordmark-contrast`.
7. Matrix renderer: its empty-library state is fixed in #176. A later pull request should fold its useful parts into the card renderer (task views, remembered search and scroll, the phone tools sheet, the mind-map shortcut) and remove the second renderer.
