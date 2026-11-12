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
| B | Navigation and information architecture: header, sidebars, action hierarchy | **Started.** Header (one theme control, shortcut help in the account menu) is Draft PR #167; Library sidebar no longer duplicates the state filters is #166. Sidebars of the workspace, "Công cụ học" and the usage chip are unchanged |
| C | Learning experience: Library, Chat, Summary, Quiz, learning dashboard | **Started.** Chat start screen #161; account page #168; quiz-taking screen #169. Not started: learning dashboard, Library document card, quiz setup / result / review, chat workspace and side panels |
| D | Knowledge visualisation: Mind map, Knowledge map, toolbars, export | Not started |
| E | Frontend reliability: the bugs in `01-audit.md` §2 and §3 | Bug-hunt findings 1-15 each have a fix in a Draft PR: 1 and 11 in #163; 2, 12 and 15 in #160; 3, 4, 7, 14 in #164; 13 in #165; 5, 6, 8, 9, 10 in #162. Also #160 (false empty library) and #165 (false empty Summary / mind-map screen, first-commit flash). Left open: requests are ignored when stale, not aborted; two review clicks in one tick still send two requests |

## Status

| Track | Branch | Draft PR | Local validation |
|---|---|---|---|
| V6-A landing + spec | `design/v6-foundation` | #159 | Vitest 1933/1933; `landing-v6.spec.js` 19/19; lint ratchet 63 (baseline 67); build pass; Codex review: 11 of 12 findings fixed, 1 recorded |
| V6-E1 false "empty library" while loading | `fix/v6-source-loading-state` | #160 | `source-loading-state.spec.js` 8/8; Layout unit tests 170/170; Codex review: race fixed, 1 item left open (stale `?source=` with a collapsed panel) |
| V6-C1 chat start screen (stacked on #160) | `design/v6-chat-start` | #161 | Vitest 1938/1938; `chat-start.spec.js` + `chat-mobile-empty-state.spec.js` 16/16; build pass |
| V6-E2 double-submit guards | `fix/v6-double-submit-guards` | #162 | Vitest 1938/1938; three double-click tests red before the fix; `StudyMapView` guards untested |
| V6-E3 cancelled chat attempt cannot publish into the next | `fix/v6-chat-attempt-identity` | #163 | Vitest 1937/1937; four tests red before their fixes; review-resume polling still has no cancellation |
| V6-E4 stale loads (quiz, study map), orphan pollers, keyboard map nodes | `fix/v6-stale-owner-guards` | #164 | Vitest 1942/1942; 8 of 9 new unit tests red before the fix; `knowledge-map-keyboard.spec.js` 2/2; build pass. `SidebarRight` guards written by Codex |
| V6-E5 Summary / mind-map lists: no false empty screen, one publishing rule (stacked on #164) | `fix/v6-summary-loading-state` | #165 | Vitest 1951/1951 at the merge; `SidebarRight.summaryListOwnership.test.jsx` 7 cases, mutation-checked; `summary-loading-state.spec.js` 5/5 |
| V6-B1 Library sidebar without duplicate state filters | `design/v6-library-actions` | #166 | Vitest 1934/1934; three Library fixture specs 42/42; regression test red before the fix |
| V6-B2 header: one theme control, shortcut help in the account menu | `design/v6-header` | #167 | Vitest 1936/1936; `mobile-header.spec.js` 115/115; CI ran the changed `e2e/mobile-theme-control.spec.js` green |
| V6-C2 account page: usage by activity, password section | `design/v6-profile` | #168 | Vitest 1942/1942; no fixture spec for this page |
| V6-C3 quiz-taking screen: one hand-in control, one primary action | `design/v6-quiz` | #169 | Vitest 1939/1939; two quiz fixture specs 9/9 |

### Trial integration (local, never pushed)

All eleven open V6 branches (#159-#169) merged into one local branch at these heads: #159 `0e32513`, #160 `22aa5b5`, #161 `32bb6c1`, #162 `4e42f9d`, #163 `abc25d7`, #164 `7a39e12`, #165 `d24d6aa`, #166 `63fcf9f`, #167 `0279d07`, #168 `c9d329e`, #169 `ceea584`.

- Vitest 1994/1994, lint ratchet 63 (baseline 67), production build pass.
- **Full Fixture Audit** (`npx playwright test -c playwright.fixture.config.js --workers=1 --fail-on-flaky-tests`): **608/608 passed**, 24.8 minutes, Chromium only. An earlier run on the first eight branches was 603/604; the one failure was a 43.99997px measurement in `landing-v6.spec.js`, fixed in `0e32513`.
- Not covered: Firefox and WebKit (the fixture config has a Chromium project only; Firefox is not installed here), real devices, screen readers.
- CI runs only Fixture Smoke (10 of the fixture spec files). Of the specs added in V6, only the additions to `mobile-header.spec.js` run in CI; `source-loading-state`, `chat-start`, `knowledge-map-keyboard`, `summary-loading-state` and `landing-v6` run only in the Fixture Audit workflow (weekly or on demand).

### Merge order and conflicts

- #160 before #161 (stacked). #164 before #165 (stacked since the conflict in `fetchSummaries` was resolved by merging #164 into #165 with both rules kept).
- #167 conflicts with #160 in one line of `MainLayout.jsx` (the `useTheme()` line directly under the block #160 adds): keep #160's block and #167's line.
- #160, #162, #163, #164, #165 each append to the end of the two `.playbook` files: after one merges, the others need their notes rebased. No other code conflict was found in the trial merge.

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

1. Landing headline and sample content (economics examples) are proposals.
2. The landing no longer colours part of the headline red. Red is kept for citations and the wordmark, as V5 rule §1 says.
3. Wordmark contrast (see `02-design-spec.md`, review notes): keep the brand red under the logo exemption, or add a darker brand-text token.
4. Order of Wave E fixes: the proposal is findings 1, 2, 3 (chat cancel race, orphan pollers) before the double-submit group (5, 6, 8, 9, 10).
