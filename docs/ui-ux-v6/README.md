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

`CI` = the required check (`CI / required`) on the head named here, read from GitHub on 2026-11-16: green on all 28.
`In trial 8` = whether that exact head is in the eighth local integration, the one fully tested on 2026-11-16 (next section). Two exceptions, changed after the trial: #159 (documentation only) and #185 (`0f5fce0`, migration safety; then `5e18271`, Windows test harness only). Release review, deploy gate and GO/NO-GO list: `06-release-review.md`.

| PR | Branch | Head | CI | Tested alone | In trial 8 | Depends on |
|---|---|---|---|---|---|---|
| #159 | `design/v6-foundation` | `4f1c656` + this docs update | pass | wordmark AA in landing header, footer and app header (4.72-4.91:1); scope probe test; conversation-history design `05-…` | `4f1c656` (code identical) | — |
| #160 | `fix/v6-source-loading-state` | `22aa5b5` | pass | Layout 174; `source-loading-state.spec.js` 8/8 | yes | — |
| #161 | `design/v6-chat-start` | `32bb6c1` | pass | Vitest 1940; five chat fixture specs 55/55 | yes | #160 (stacked) |
| #162 | `fix/v6-double-submit-guards` | `4e42f9d` | pass | Vitest 1938 | yes | — |
| #163 | `fix/v6-chat-attempt-identity` | `abc25d7` | pass | Layout 174 | yes | — |
| #164 | `fix/v6-stale-owner-guards` | `7a39e12` | pass | Vitest 1945; `knowledge-map-*.spec` 4/4 | yes | — |
| #165 | `fix/v6-summary-loading-state` | `d24d6aa` | pass | Vitest 1951 at the merge; `summary-loading-state.spec.js` 5/5 | yes | #164 (stacked) |
| #166 | `design/v6-library-actions` | `43ff246` | pass | Vitest 1934; Library fixture specs 42/42 | yes | — |
| #167 | `design/v6-header` | `6372346` | pass | Vitest 1936; `mobile-header.spec.js` 115/115; `@media` rule on one line (trials 4-6 lost its brace) | yes | reconcile with #160 |
| #168 | `design/v6-profile` | `c9d329e` | pass | Vitest 1942 | yes | — |
| #169 | `design/v6-quiz` | `ceea584` | pass | Vitest 1939; quiz fixture specs 9/9 | yes | — |
| #170 | `ci/v6-fixture-smoke` | `9cd8765` | pass | list unit test 7/7; 7 V6 specs added to `WHEN_PRESENT` (28 files on the integration) | yes | merge first |
| #171 | `design/v6-library-card` | `1ee999e` | pass | Vitest 1943 before the review fixes; card tests after them | yes | — |
| #172 | `design/v6-learning-home` | `61feebc` | pass | Vitest 1940 before the last fix | yes | — |
| #173 | `design/v6-library-integration` | `4cd342e` | pass | Vitest 1956; `library-learning-home.spec.js` 18/18; five Library specs 46/46 | yes | #166, #171, #172 (stacked) |
| #174 | `design/v6-chat-workspace` | `99a29ee` | pass | Vitest 1951; chat, evidence and header fixture specs 141/141 | yes | #160, #161, #163 (stacked) |
| #175 | `design/v6-quiz-result` | `99c78f2` | pass | Vitest 1941; quiz-result fixture specs 12/12 | yes | #169 (stacked) |
| #176 | `design/v6-library-one-list` | `953b142` | pass | Vitest 1966; Library specs 36/36 | yes | #173 (stacked) |
| #177 | `fix/v6-chat-review-single-flight` | `02a2310` | pass | ChatArea tests | yes | #174 (stacked) |
| #178 | `design/v6-chat-composer` | `c04fdd1` | pass | `chat-composer.spec.js` 10/10; chat-start specs updated | yes | #177 (stacked) |
| #179 | `design/v6-quiz-setup` | `f8792b1` | pass | Vitest 1945; `quiz-setup-v6.spec.js` 6/6 | yes | #175 (stacked) |
| #180 | `design/v6-chat-evidence` | `7a7fa3e` | pass | Vitest 1957; build pass | yes | #178 (stacked) |
| #181 | `fix/test-guided-dialog-unmount` | `78935e1` | pass | shuffled full Vitest 1933/1933 | yes | — (test only) |
| #182 | `design/v6-quiz-review` | `bb4916e` | pass | Vitest 1955; `quiz-review-v6.spec.js` 5/5; title no longer cut to "K…" (red before) | yes | #179 (stacked) |
| #183 | `fix/practice-submit-atomic` | `1d787f8` | pass (backend suite on PostgreSQL) | concurrency tests 5/5 (red 4/4 on `main`); backend suite 2962 passed, 6 failed also on `main` | yes | — (backend only); superseded in part by #185 |
| #184 | `design/v6-mobile-viewport` | `0b7d58a` | pass | `useAppHeight` 7 (5 red before: pan, zoom, rotation, cleanup, dedupe); viewport spec +4; drawer focus spec (red before) | yes | #180 (stacked) |
| #185 | `fix/practice-idempotency-key` | `5e18271` | pass (run 43837028065; `0f5fce0` run 43811959733: backend on PostgreSQL 16 3025 passed, 0 failed) | 24 PostgreSQL tests + 2 race tests; FE 8; two independent reviews, all BUG findings fixed; migration verified from `pg_index` and fail-closed, read-only `scripts.verify_db_schema` as deploy step 5b, runbook `docs/RUNBOOK_SUBMIT_KEY_INDEX.md`; 10 failure-injection tests red on `ee152c3` (old logic), green on `0f5fce0` | **no**: trial 8 has `06a65f8`; trial 9 (`64e701b`, backend run 2026-11-16) has `0f5fce0`, see `06-release-review.md` | #183 (stacked) |
| #187 | `fix/devtest-isolation` | `7389d77` | pass (run 44033127356) | 61 isolation and guard tests; four Codex review rounds (11 findings fixed, 0 open); hand-started backend guard | n/a (from `main`, after the trials) | none; backend test harness and dev guard only |
| #188 | `fix/diagnostic-grading-recovery` | `8a16902` | pass (run 44060712513) | diagnostic recovery 41 PostgreSQL tests, FE 11; Codex task25 (4 rounds) and agy task24/26/27; see `06-release-review.md` 8c | n/a (after the trials) | #185 (stacked) |
| #191 | `fix/e2e-memory-isolation` | `ac1a411` | pass (run 44263766276) | E2E isolation 6 tests | n/a (in trial 13) | from `main`; test harness only; conflicts with #187 in `run_e2e_server.py` (section 10) |
| #192 | `fix/practice-provisional-regrade` | `fd0812f` | pass (run 44262980102) | practice regrade 16 + FE 9 tests, 3 E2E | n/a (in trial 13) | stacked on #190; merge after it |
| #193 | `fix/practice-regrade-background` | `f69d911` | pass (run 44350467761) | 22 backend + 4 FE tests, E2E | n/a (trial 14 merge check) | stacked on #192; merge after it |
| #194 | `fix/review-plan-archive` | `6145d62` | pass (run 44354303047) | 9 + 6 migration + 4 FE tests | n/a (trial 14 merge check) | stacked on #190; **migration**: owner approval + window |
| #195 | `test/mindmap-export-contract-slow` | `47dc4b1` | **success** (run 44363261244) | contract test budget, 40 measured runs | n/a | from `main`; test only |
| #190 | `fix/provisional-grading-recovery` | `b74de27` | pass (run 44119547612) | provisional regrade 23 PostgreSQL tests, FE 11 + 4 E2E; Codex task34 + agy task35 | n/a (in trial 11) | stacked on #188; merge after it |
| #189 | `fix/llm-timeouts` | `2d174d8` | pass (run 44035654037) | LLM deadline tests 15; Codex task28/30 + agy task29 | n/a (after the trials; in trial 10) | none (from `main`); merge before #188 |
| #186 | `design/v6-learning-progress` | `3c6859f` | pass | helpers 10; `learning-progress.spec.js` 6/6; Vitest 1976 | yes | #176 (stacked) |

### Local integrations (never pushed)

| Trial | Branches | Commit / tree | Vitest | Build | Lint | Full Fixture Audit |
|---|---|---|---|---|---|---|
| 1 | #159-#166 (8) | discarded | 1968/1968 | pass | 63 | 603/604; the failure was a 43.99997px measurement in `landing-v6.spec.js`, fixed in #159 |
| 2 | #159-#169 (11) | `ce5dd9c` | 1994/1994 | pass | 63 | 608/608, 24.8 min |
| 3 | #159-#172 (14) | `aba1494c89ef` / tree `e3217ca2dab2` | 2016/2016 (246 files) | pass | 63 (baseline 67) | 608 collected, 608 passed, 0 failed, 0 skipped, 0 flaky, 22.0 min |
| 4 | #159-#179 (21) | `1df5748` / tree `effeb5af95b4` | 2042/2042 (250 files) | pass | 63 (baseline 67) | 660 collected, 660 passed, 0 failed, 0 skipped, 0 flaky, 27.8 min |
| 5 | #159-#184 (26) | `e3ff458` / tree `76afcfbce69f` | 2071/2071 (256 files); shuffled (seed 61201) 2071/2071 | pass | 63 (baseline 67) | **675 collected, 673 passed, 0 failed, 0 flaky, 2 skipped** (the two screenshot-capture tests, which run only with `V6_SHOT_OUT`), 25.1 min |
| 6 | #159-#186 (28) | `ee010e6` / tree `72cc0cb0ac62` | 2093/2093 (258 files); shuffled seeds 61201, 7, 4242: 2093/2093 each | pass | 63 (baseline 67) | **689 collected, 683 passed, 1 failed, 0 flaky, 5 skipped**, 32.6 min. Fixture Smoke (26 files): 325 passed, 1 failed, 4 skipped. The one failure, both runs: the new wordmark-scope test of #159 found no seal text to compare on the integrated chat start (#161 removed it); test rewritten with probes in `3a0991d` |
| 7 | #159-#186 (28) | `3487bcc` / tree `b41fa85ad513` | not run | not run | not run | **not run**: merge clean, but the test run was stopped by Claude Code because the machine ran low on memory. Superseded by trial 8 (it lacked #159's `4f1c656`) |
| 8 | #159-#186 (28), every head of 2026-11-16 | `d1ed4a3` / tree `8ca03e042ccf` | 2095/2095 (258 files), 241 s; shuffled (seed 61201) 2095/2095 | pass, 10 s | 63 (baseline 67, unchanged) | **691 collected, 686 passed, 0 failed, 0 flaky, 5 skipped**, 25.8 min. Fixture Smoke (28 files): **339 collected, 333 passed, 0 failed, 0 flaky, 6 skipped**, 19.6 min. Backend: **3008 passed, 6 failed (the same 6 on `main`), 9 skipped** |

Trial 8 details (2026-11-16, run one stage at a time, never two heavy suites together):
- Merge: 28 heads, 84 non-merge commits, no duplicate subject or patch-id; conflicts only in the two `.playbook` files (both sides kept), one line of `MainLayout.jsx` (#160/#167) and the end of `index.css` (#167/#174). `index.css` parses (19 `@media` blocks) and #167's one-line rule is intact; no hand repair. Every file a pull request adds is present in the tree.
- Limits: Vitest `--maxWorkers=2`; Playwright `--workers=1 --retries=1 --fail-on-flaky-tests` (as CI), Chromium only, port 5299; backend alone. Free RAM stayed between 9.5 and 13.1 GB of 28 GB across the stages.
- Skipped: in both Playwright runs, five capture tests that only run with `V6_SHOT_OUT` (wordmark, learning progress, two mobile viewport, quiz review). Fixture Smoke skipped one more: the 320px webfont check in `round6-library-action-matrix`, because Google Fonts did not load within 8 s (its fallback-font twin passed; in the full audit the webfont check ran and passed).
- Backend: disposable PostgreSQL 16 (`--rm`, removed after the run). `alembic upgrade head` reaches the single head `20261115_attempt_submit_key`; `downgrade -1` then `upgrade head` both run and the unique partial index is valid. The 70 practice, idempotency and concurrency tests pass (dead grader after the lease, keyless reclaim, a failed grader not releasing a newer claim, mastery repair, mismatch, anonymous keys, draft-vs-submit race). The first run stopped at collection because `shared/proto/gen` was missing locally; the stubs were generated with `scripts/build_proto.py` as CI does, which also collects the four gRPC modules trial 6 skipped (hence 3008, not 2985). The 6 failures (`test_index_khoa_that.py` x5, `test_fpt_rerank.py` x1) fail the same way on `main` `db005ab`.
- Logs and a stage checkpoint: `studymap-qa-execution/v6/results/integration-28-trial8/`.

**Verdict: READY FOR OWNER REVIEW** as a set, in the order of `04-integration-checklist.md`. Not release-ready: nothing is verified on real devices, Firefox, WebKit or a screen reader, and the backend owner decisions below are open. Blockers before merging particular pull requests:
- #185's head is now `5e18271` = `0f5fce0` + a test-harness fix (`BE/tests/test_attempt_submit_key_migration.py`, `.playbook/`), CI green; product code as in trial 9. `0f5fce0` came after trial 8. Trial 9 (`64e701b`, tree `b97da2793ae6`) adds it: `FE/` identical to trial 8, `BE/` and `scripts/` identical to #185's CI-tested head; trial 9's combined backend run on disposable PostgreSQL 16 (2026-11-16): 3018 passed, 9 skipped, 6 failed = the 6 that fail on `main`; migration/idempotency/concurrency files alone 144 passed; `verify_db_schema` exit 0. Merging is also gated by the GO/NO-GO list in `06-release-review.md` (the `production` environment has no required reviewers today).
- #183 + #185: owner approval of the deploy order (migration, then backend, then web) and of the open items 1-2 below (diagnostic grading claim, open-mode client identity). They are not regressions from these pull requests, but #185's guarantees hold only for the practice route.
- Pre-existing, not caused by V6: the 6 backend failures above (they also fail on `main` on this machine).

Trial 6 details: backend suite on the tree (disposable PostgreSQL 16): 2985 passed, 9 skipped, 6 failed, the same 6 that fail on `main` (`test_index_khoa_that.py` x5, `test_fpt_rerank.py` x1). No CSS repair was needed: #167 now writes its `@media` rule on one line. One real conflict, `Practice.jsx` imports (#162 vs #185), removed by aligning the import order in #185 (`88824f8`). Logs: `studymap-qa-execution/v6/results/integration-28/`.

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

Decided 2026-11-15:
10. Practice submission: `Idempotency-Key` (#185), not the 30 s window as a lasting rule.
11. `--brand-text` for every wordmark (#159: landing header, footer, app header).
12. Headline approved: "Hỏi chính tài liệu của bạn, rồi xem câu trả lời dựa trên đoạn nào."
13. Conversation history: design only, now in `05-conversation-history-api.md`.
14. lean-ctx: no global change; cause found (below), fix needs approval.

Open:
1. Diagnostic grading has no grading claim (a duplicated grading job can grade twice) and a diagnostic attempt can still be stranded `submitted`; needs a sweeper or a regrade route.
2. Open mode: one anonymous owner for every client; the practice key is then a bearer token, and the diagnostic flow shares one in-progress attempt between anonymous clients.
3. Conversation history retention: 24 h today (SQLite TTL); choose 24 h, 30 days or until deleted, and SQLite vs PostgreSQL.
4. lean-ctx: its MCP server rewrites `~/.claude/settings.json` with an unquoted path on every session start; two fixes verified in isolation (`manage_hooks = false`, or `LEAN_CTX_HOOK_BINARY` = 8.3 path). Either one turns `rewrite-enforce` on, which blocks `herdr`/`docker`; see `studymap-qa-execution/v6/results/hook-overwrite-root-cause-2026-11-15.md`.

### Conversation history: API design only (not implemented)
Full proposal: `05-conversation-history-api.md` (contracts, keyset pagination, data model, ownership review, retention options, migration paths, frontend plan).

## Backlog, in order

1. AI chat workspace: conversation history (design only), the right inspector, modals portaled to `body` during an iOS pan. Done: start screen (#161), conversation and citations (#174), composer (#178), evidence panel names (#180), phone keyboard and iOS pan (#184), drawer focus and Escape (#184).
2. Quiz: per-topic practice history on the review guide (the API has none). Done: quiz-taking (#169), the per-question result list (#175), setup and progress (#179), score header and review guide (#182). Done: the `StudyShell` title no longer collapses at 390px (#182).
3. Workspace panels: left and right sidebars, mind-map controls, summary pane, knowledge-map evidence, toolbars, dialogs.
4. Library: done, the detailed progress page (#186); open: the "Đang yếu ở" section; the phone tools sheet and mind-map shortcut of the matrix renderer (not moved in #176).
5. Reliability: a stale `POST /query` is ignored, not aborted, and the backend has no cancel for `query` jobs. Done: `SidebarRight.guidedDialogClose.test.jsx` order dependence (#181: the test never unmounted its root, so the portaled dialog leaked into the next test; CI does not shuffle) and the Library page's test globals (#166).
6. Coverage: Firefox, WebKit, real devices, screen readers. Move the V6 specs to `REQUIRED` in the smoke list after their pull requests merge (seven more joined `WHEN_PRESENT` in #170). `quiz-setup-v6`, `quiz-result-next-step` and `quiz-result-partial-counter` run only in the full audit; add them to `WHEN_PRESENT` too.
7. Matrix renderer: its empty-library state is fixed in #176. A later pull request should fold its useful parts into the card renderer (task views, remembered search and scroll, the phone tools sheet, the mind-map shortcut) and remove the second renderer.
