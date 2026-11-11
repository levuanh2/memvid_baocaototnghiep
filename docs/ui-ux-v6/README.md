# StudyMap V6 — redesign and frontend reliability

Evidence-first, delivered as small Draft PRs on top of V5. Nothing here is merged or deployed without owner approval. R7 stays **NO-GO**.

V6 is **not complete**. This file is the single status page: it says which waves have shipped as Draft PRs and which have not started.

| Doc | Content |
|---|---|
| [01-audit.md](01-audit.md) | Browser audit of the live site and the confirmed frontend bug inventory |
| [02-design-spec.md](02-design-spec.md) | V6 direction, what V6 keeps from V5, and the rules for new surfaces |
| `evidence/before`, `evidence/after` | Full-page captures from the running app (Playwright, local Vite), not mockups |

## Waves

| Wave | Scope | Status |
|---|---|---|
| A | Design foundation: direction, rules, landing as the first surface built to them | **Draft PR** (this branch): spec + Landing. Tokens for the app shell are not changed yet |
| B | Navigation and information architecture: header, sidebars, action deduplication | Not started. Needs the action inventory (agy, in progress) |
| C | Learning experience: Library, Chat, Summary, Quiz, learning dashboard | Not started |
| D | Knowledge visualisation: Mind map, Knowledge map, toolbars, export | Not started |
| E | Frontend reliability: the bugs in `01-audit.md` §3 | Not started. 6 P1 findings are the next PRs |

## Status

| Track | Branch | Draft PR | Local validation |
|---|---|---|---|
| V6-A landing + spec | `design/v6-foundation` | see PR | Vitest 1933/1933; `landing-v6.spec.js` 14/14; lint ratchet 63 (baseline 67); build pass |

## Skills and tools used

| Skill / tool | Used for |
|---|---|
| `frontend-design` (read and applied) | Landing: design plan, review against generic defaults, copy rules |
| Claude in Chrome | Live audit of studymap.space with the QA browser account (read-only: no upload, no generation, no deletion) |
| Playwright (fixture config, local Vite) | Before/after captures and the landing regression spec |
| Codex (Herdr pane) | Read-only frontend bug hunt, `01-audit.md` §3 |
| agy (Herdr pane) | Read-only route and action inventory (in progress) |

Not used: `ui-ux-pro-max`, `web-interface-guidelines`, `design-system` are installed but were not read for this wave.

## Not verified

- Real phones and tablets. Every width here is an emulated viewport in Chromium.
- Firefox and WebKit.
- Screen readers.
- Live-site flows that create data (upload, generation, quiz attempts) were not run on production.

## Owner decisions

1. Landing headline and sample content (economics examples) are proposals.
2. The landing no longer colours part of the headline red. Red is kept for citations and the wordmark, as V5 rule §1 says.
3. Order of Wave E fixes: the proposal is findings 1, 2, 3 (chat cancel race, orphan pollers) before the double-submit group (5, 6, 8, 9, 10).
