# 11 — Master Audit Report: StudyMap Full Product UI/UX Audit V4

**Audit team**: Claude (Audit Lead), Codex 1 (Visual Design/Design System), Codex 2 (UX Flow/Accessibility), Agy (Independent Product & Architecture Reviewer, worked alone first).
**Baseline**: `main` @ `4f228ef9d1e34f8bac59f37a3792fc859400cb64`.
**Method**: Real Chromium/Playwright against a live local stack (FE `http://localhost:5180`, BE `http://127.0.0.1:8090` — real Flask routes/auth/Postgres, AI providers mocked, 100% offline/deterministic), plus direct source code reading. Read-only: no app code, production data, merges, or deploys were touched.
**Supporting documents**: `01-product-inventory.md`, `03-visual-design-audit.md`, `04-usability-flow-audit.md`, `05-duplication-matrix.md`, `06-accessibility-responsive-audit.md`, `07-design-system-inventory.md`, `08-independent-agy-review.md`, `09-redesign-options.md`, `10-prioritized-backlog.md`, plus a `screenshots/` evidence directory referenced throughout.

---

## For the user — plain summary

The team spent real time clicking through your actual running app (not old screenshots) across desktop, tablet, and mobile, in both themes, and had three people look at it from three different angles — one for visuals, one for workflows/accessibility, and one independent reviewer who worked completely alone before comparing notes with the other two.

**The good news first**: your engineering is genuinely strong in places most products get wrong — real keyboard-accessible panel resizing, a proper focus-trapped modal system, a hand-tuned dark mode (not a cheap auto-invert), zero bloated animation libraries, and (after this session's earlier hotfix work) a solid export pipeline. This is not a "rebuild from scratch" situation.

**What's actually wrong**, in your own words: the "not cohesive" and "accumulated patches" feeling is real and traceable to a specific cause — the app went through a full redesign attempt (seal-red → forest/bronze "Paper & Graphite") that got partially reverted back to blue, and the reversal wasn't fully finished. That left real scars: a MindMap node-selection ring stuck in dark forest-green on an otherwise all-blue interface, some old seal-red hex codes still hardcoded, and two genuinely different-looking "map" features (Mind Map and Study Map) that use two different code libraries and never talk to each other.

**The single most serious bug we found**: the button in your header that should take users to their document library doesn't actually do that — a developer comment in the code claims the link is there, but it was never actually rendered. Right now, 50% of your product (documents, quizzes, review, practice) has **no visible way in** from the main screen. We also found that selecting a mind-map node covers up the Export/Appearance buttons so they can't be clicked.

Both of those are one-file fixes. We've laid out a 7-round plan (`10-prioritized-backlog.md`) that fixes both immediately, finishes the color migration, and — the highest-leverage single change — collapses your document library from one document rendering 5+ times across sections (823 clickable things on one screen) down to one clean list. We recommend **Option B** in `09-redesign-options.md`: fix everything above, visually align the two map features, but don't force them into one engine yet — that's a much bigger, separate project worth doing deliberately later, not bundled into this fix.

Nothing has been changed yet. This is the audit and the plan; implementation starts only when you say go.

---

## 1. Executive assessment

StudyMap is architecturally sound with isolated pockets of excellent, above-average engineering (accessibility primitives, dark mode, export pipeline). The product does not need a rebuild. It needs: (a) two P0 bug fixes that are each a single-file change, (b) the deliberate completion of an interrupted design-system migration, and (c) one structural consolidation of a repeated-card library screen. The "multiple partially integrated tools" feeling the user identified is accurate and has a specific, traceable cause — not a vague aesthetic complaint.

## 2. Product-wide coverage summary

Covered via real browser interaction and/or direct code verification: Landing, Login, Register, Account menu/Profile/Settings, the full Workspace shell (header, both sidebars, Chat, Summary, Knowledge Inspector, Command Palette, theme controls), Mind Map (generation, node selection, Export Studio, appearance editor, exact-node export contract), Document List, Study Map View, and all cross-cutting primitives (Modal, Toaster, dialogs, drawers). **Not honestly coverable in this environment**: populated Quiz/Result/Review/Practice states — the audit's test database never finished indexing uploaded documents (an offline-mock limitation, not a frontend defect), so only setup/empty/error states for that family could be captured. This gap is explicitly scheduled to close in Round 7 of the backlog via a seeded test fixture.

## 3. Actual routes/screens inspected

See `01-product-inventory.md` §1 for the full route table and §2-3 for workspace/study-route structure. Summary: `/`, `/login`, `/register`, `/app` (Chat/MindMap/Summary tabs), `/app/study`, `/app/study/map/:id`, `/app/study/quiz/new|:id`, `/app/study/result/:id`, `/app/study/review/:id`, `/app/study/practice/:id` — 11 routes across 2 structurally disconnected trees.

## 4. Top 10 UX problems with evidence

1. **UX-ADJ-001 (P0)** — Workspace header omits the `<Link to="/app/study">` its own code comment claims exists; the entire Study subsystem is unreachable without typing a URL, using `Alt+S`, or the command palette. (`08` §3 UX-001, verified directly by Claude against `MainLayout.jsx:503-520`.)
2. **UX-ADJ-002 (P0)** — The floating Knowledge Inspector overlay physically intercepts pointer clicks on the MindMap toolbar's Export/Appearance/Overflow buttons whenever a node is selected. (`08` §3 UX-002, live `elementFromPoint` measurement.)
3. **UX-ADJ-007 (P1)** — `DocumentList.jsx` renders the same document card repeatedly across sections: 823 interactive controls measured in one state, a 50,000px-tall page. (`04`, `05`, `03` all independently flagged this.)
4. **UX-ADJ-008 (P1)** — Two completely separate, visually incompatible graph engines (`mind-elixir` vs `react-d3-tree`) for conceptually the same "map" feature, with zero interoperability.
5. **UX-ADJ-005/006 (P1)** — WCAG AA contrast failures: dark-mode primary CTA text at 2.77:1 (needs 4.5:1), muted copy at 2.89–3.43:1.
6. **UX-ADJ-009 (P1)** — MindMap node-selection ring still renders in leftover dark forest-green (`#1F4033`) on an otherwise all-blue interface — a direct visible scar from the interrupted color migration.
7. **UX-ADJ-003/004 (P1)** — Command Palette (`Ctrl+K`) focuses the dialog's close button instead of its own search input, and renders a completely blank box when opened with no search history.
8. **UX-ADJ-010 (P1, mobile)** — A closed off-canvas mobile source drawer leaves its controls reachable by keyboard Tab even though it's visually hidden.
9. **UX-ADJ-018 (P2)** — Internal development-era terminology ("Phòng đọc") leaks into user-facing Register/DocumentList screens alongside the real "MemVidX"/"StudyMap" branding.
10. **UX-ADJ-012 (P2)** — Undeclared `--font-display`/`--font-mono` CSS variables silently break the artifact-toolbar typography (invalid shorthand falls back to system sans-serif).

## 5. Duplicate feature matrix

Full table in `05-duplication-matrix.md`. Headline finding: **most apparent "duplication" in this product is legitimate, evidence-validated contextual shortcuts** (launching Chat/MindMap/Summary from a document card, Export Studio's separate one-off appearance override vs. the map's persistent appearance drawer) — removing these would add friction, not reduce it. The one **confirmed harmful duplication** is the repeated document-card rendering in `DocumentList.jsx` (UX-ADJ-007), which is caused by the same record being rendered in multiple sections simultaneously, not by legitimate multi-entry-point design.

## 6. Design consistency issues

Full inventory in `07-design-system-inventory.md`. The product has one coherent token system (confirmed: zero `gray-*` Tailwind classes, a real hand-tuned dark mode, zero Framer Motion), but it is mid-migration: blue (`#126CF2`) is the live primary accent everywhere **except** the MindMap selection ring (still forest-green) and a few hardcoded legacy hex values (`AccountMenu.jsx`). Radius values are disciplined (never raw Tailwind defaults) but fragmented across an undocumented set of arbitrary pixel values.

## 7. Critical accessibility problems

- Command Palette focus management is broken on open (UX-ADJ-003) and renders a blank, un-discoverable command list on first open (UX-ADJ-004).
- Desktop users cannot dismiss the MindMap Knowledge Inspector overlay with Escape (UX-ADJ-014), despite its own tooltip claiming `Esc` works.
- A closed mobile drawer remains in the keyboard Tab sequence (UX-ADJ-010).
- Two confirmed WCAG AA contrast failures (UX-ADJ-005/006).
- **Counterbalance, also confirmed**: Modal.jsx's focus-trap, PanelDivider's full keyboard resize support, and the Quiz flow's `aria-live`/`aria-current` usage are all genuinely above-average — this audit found real defects, not a systemically broken accessibility posture.

## 8. Desktop/tablet/mobile findings

Full detail in `06-accessibility-responsive-audit.md`. Confirmed: mobile touch targets below the 44x44px standard on header mode tabs (40x40px) and kebab menus (28x28px); Export Studio's quick-format row clips without a scroll affordance on narrow viewports; `StudyMapView`'s canvas crops the graph on mobile initial load instead of auto-fitting.

## 9. User journeys and friction

Full table in `08-independent-agy-review.md` §4 (7 journeys tested). Three of seven journeys hit a real blocker: Mind Map workflow (toolbar occlusion, UX-ADJ-002), Study workflow (no visible entry point, UX-ADJ-001), and Returning-user workflow (Command Palette focus/blank-state bugs). The other four (first-time learner, research/chat, export, mobile) completed with only minor friction, confirming the core AI-workspace loop itself works well.

## 10. Agent disagreements and adjudication

Full detail in `08-independent-agy-review.md` §3. Three resolved disagreements, all resolved with live evidence rather than majority vote:
- **Severity upgrade**: Codex 2 scored the navigation gap P2 ("menu mislabeled"); Agy's direct AST read of the actual JSX (not just the misleading code comment) proved the link was never rendered at all, upgrading it to P0.
- **Severity downgrade**: Codex 2 scored a cross-account document-list exposure as P1 ("data isolation"); direct verification (by Claude, independently confirmed by Agy) of `render.yaml`'s production config showed `AUTH_PROTECT_APP_APIS=true` is set there — the exposure only reproduces in the unprotected local test harness, recalibrated to P2 (deployment-hardening hygiene, not a live production leak).
- **Invalidation**: a historical audit document claimed `StudyMapView.jsx` used an undeclared `var(--brand)`; Agy's direct code read proved this was already fixed in a prior PR and the claim is stale — explicitly excluded from the remediation scope so it isn't "fixed" a second time.

## 11. Three redesign options

Full detail in `09-redesign-options.md`. **A** (conservative: fix defects, finish the color migration, no IA change). **B** (balanced, **recommended**: everything in A plus map visual-parity and document-library consolidation). **C** (structural: fully unify the two map engines into one — high value, high risk, recommended as a separate future initiative rather than bundled here).

## 12. Recommended strategy

Ship **Option B**. It resolves both P0s, every P1 except full engine unification, and both of the user's specifically-named complaints (patch-accumulation feel, visual clutter), while touching zero guarded architectural invariants (`WorkspaceContainer`'s simultaneous mounting, `useStudyContext`'s dual-identity contract, `ContextPanelCloseButton`'s dual-mode lifecycle — all documented in `08` §6 and respected by every item in the backlog).

## 13. Prioritized roadmap

Full detail in `10-prioritized-backlog.md`: Round 0 (two P0s) → Round 1 (navigation/terminology) → Round 2 (tokens/contrast) → Round 3 (Command Palette/Escape a11y) → Round 4 (MindMap/Export Studio mobile + map visual parity) → Round 5 (document-library consolidation, highest-leverage, highest-risk) → Round 6 (full responsive re-verification) → Round 7 (final WCAG sweep + closes the Quiz/Result/Review/Practice coverage gap).

## 14. Risks and regressions

The single highest-risk item in the entire roadmap is Round 5's document-card consolidation (Medium-High per `05-duplication-matrix.md`: sections, selection, analytics, and scroll anchors currently assume repeated cards). Recommend a feature flag or kept-in-version-control fallback for one release cycle. Every other round is Low-to-Medium risk with an isolated, single-commit rollback path. Shared-blast-radius files (`Modal.jsx`: 10 consumers; `useStudyContext.js`: 18 consumers; `WorkspaceContainer.jsx`) require explicit diff review before merge in any round that touches them, per `08` §2.

## 15. Unverified areas and blockers

- Populated Quiz/Result/Review/Practice states could not be honestly captured in this audit environment (documents never finished indexing in the offline mock) — closed by Round 7's seeded-fixture plan, not by this audit's own evidence.
- `05-duplication-matrix.md`'s own "Validation needed before consolidation" list (whether study-library bulk selection affects AI source scope, whether all document-card shortcuts preserve return location) should be confirmed before Round 5 begins, not assumed from this audit alone.
- This audit used a local offline test stack, not the live `studymap.space` production site — all findings are about the app's current `main` branch code, verified against production config files (`render.yaml`) only where explicitly noted (the UX-ADJ-001 severity recalibration), not against a live production crawl.

---

**No implementation has begun. Per the brief's Phase A gate: STOP here and wait for the user's explicit approval of a direction (A/B/C, or a modification) before any code changes, merge, or deploy.**
