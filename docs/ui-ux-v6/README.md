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
| B | Navigation and information architecture: header, sidebars, action hierarchy | Not started. The inventory is in: 1 true duplicate left, so this wave is about grouping, not removal |
| C | Learning experience: Library, Chat, Summary, Quiz, learning dashboard | **Started.** Chat start screen is Draft PR #161. Library, Summary, Quiz, dashboard not started |
| D | Knowledge visualisation: Mind map, Knowledge map, toolbars, export | Not started |
| E | Frontend reliability: the bugs in `01-audit.md` §2 and §3 | **Started.** W1 is Draft PR #160; findings 5, 6, 8, 9, 10 are Draft PR #162. Findings 1–4, 7, 11–15 are not fixed |

## Status

| Track | Branch | Draft PR | Local validation |
|---|---|---|---|
| V6-A landing + spec | `design/v6-foundation` | #159 | Vitest 1933/1933; `landing-v6.spec.js` 19/19; lint ratchet 63 (baseline 67); build pass; Codex review: 11 of 12 findings fixed, 1 recorded |
| V6-E1 false "empty library" while loading | `fix/v6-source-loading-state` | #160 | `source-loading-state.spec.js` 8/8; Layout unit tests 170/170; Codex review: race fixed, 1 item left open (stale `?source=` with a collapsed panel) |
| V6-C1 chat start screen (stacked on #160) | `design/v6-chat-start` | #161 | Vitest 1938/1938; `chat-start.spec.js` + `chat-mobile-empty-state.spec.js` 16/16; build pass |
| V6-E2 double-submit guards | `fix/v6-double-submit-guards` | #162 | Vitest 1938/1938; three double-click tests red before the fix; `StudyMapView` guards untested |

## Skills and tools used

| Skill / tool | Used for |
|---|---|
| `frontend-design` (read and applied) | Landing: design plan, review against generic defaults, copy rules |
| Claude in Chrome | Live audit of studymap.space with the QA browser account (read-only: no upload, no generation, no deletion) |
| Playwright (fixture config, local Vite) | Before/after captures and the landing regression spec |
| Codex (Herdr pane) | Read-only frontend bug hunt (`01-audit.md` §3) and reviews of #159, #160 and #162 |
| agy (Herdr pane) | Read-only route and action inventory, journey-to-test map (`03-actions-and-journeys.md`) |

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
