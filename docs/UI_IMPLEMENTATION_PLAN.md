# UI Implementation Plan — Paper & Graphite Redesign, Phase 3

Roadmap only. **No code changed by this document.** Built from
`UI_AUDIT_V2.md` and `DESIGN_TOKEN_AUDIT.md`. Visual-only throughout — no
architecture, routing, backend, API, business logic, state management, or
MindMap generation logic changes anywhere in this plan.

**Revision note (post-audit, pre-Wave-1)**: Codex reviewed the four Phase
1–3 docs against the `hallmark` skill (Nutlope/hallmark — installed
separately, cross-checks a redesign plan against generic/template-looking
patterns) and returned five corrections, folded into this revision:

1. A token/radius/codemod plan alone doesn't produce a structural
   fingerprint — added the **MemVid Signature Contract** below, which every
   task in the sequencing table must be read against, not just the raw
   audit findings.
2. Task 20 (type-scale codemod) was specified as nearest-numeric-value
   mapping — that produces a scale with no meaning, just fewer distinct
   numbers. Corrected to semantic-role mapping (see Task 20 below).
3. Fraunces (italic in particular) reads as a recognizable "generic AI
   redesign" tell per `hallmark`, and — more importantly — **Spectral is
   already MemVid's own established signature serif** (the "Phòng Đọc /
   Reading Room" identity `UI_AUDIT_V2.md` §0 documents). Swapping it for
   Fraunces is a brand-voice change dressed up as a token update, not a
   pure restyle. **Dropped from this plan** — every task below that
   referenced loading Fraunces or using italic for emphasis has been
   corrected to keep Spectral, roman weight, no italic on display type.
4. The graphite register needs a stated material reason tied to MemVid's
   own subject, not "dark panel because instrument tools are dark in other
   apps" (a cliché this exact redesign is supposed to avoid) — see
   Signature Contract §2.
5. Not corrected here, kept as designed: phantom CSS vars stay a separate,
   Critical-severity correctness fix (Task 1), never folded into the
   token-value work — Codex agreed this split is right as-is.

## MemVid Signature Contract

Everything in the sequencing table below implements *one* of these seven
rules, or it isn't done yet — this is the structural fingerprint the raw
token/radius/codemod work by itself doesn't produce. Read this before
touching any task, especially typography-related ones (4, 5, 15, 19, 22).

1. **The seal is provenance, not brand.** `--accent`'s seal-red heritage
   (chu sa / seal-stamp — provenance, active state, error) doesn't get
   deleted and replaced by forest/bronze wholesale. Seal-red narrows to
   **provenance/citation-verified content only** (the wordmark stamp,
   `.cite-chip`, "this came from a real source" signals) — a real,
   already-existing motif, kept and sharpened, not discarded for a fresh
   unrelated palette.
2. **Graphite is the desk, not a dark-mode default.** The paper/graphite
   split is justified by what a surface *is for*, not decoration: MindMap
   canvas and the Knowledge Inspector are where knowledge is actively being
   drawn and annotated — the working desk (graphite, instrument-toned, true
   in both themes). Summary, StudyMap-as-artifact, Document List, Study
   Home are the finished page (paper). This is the one-sentence test every
   graphite-register decision in Open Decision #1 must pass: "is this
   screen the desk, or the page?" — never "does it look more premium dark."
3. **Spectral stays.** It is already the app's signature reading serif.
   The redesign fixes the *duplicate-alias* problem (`display`/`reading`
   collapse to one role) and the *missing scale* problem — not the
   typeface. No Fraunces anywhere in this plan.
4. **No italic on display type, anywhere.** Emphasis (active tab, pull
   quotes, sub-heads) is carried by weight + a bronze underline/rule +
   color — never italic. Kept as a hard rule specifically because it's the
   single most "generated redesign" tell `hallmark` flags.
5. **Numbers are the one cross-screen constant.** Every screen family below
   may have its own composition, but a score, a count, a timestamp, a
   confidence percentage is *always* IBM Plex Mono, tabular, bronze — with
   zero exceptions anywhere in the app. This is the one rule that must never
   vary per screen; everything else may.
6. **Screen families, not one repeated `.surface-card` grid everywhere.**
   Group screens by relationship to the user, not by which file happens to
   import the same class:
   - *Instrument family* (MindMap, StudyMap, Command Palette) — graphite,
     dense, mono-labeled, click-precise.
   - *Reading family* (Summary, Knowledge Inspector, Review Guide) — paper,
     drop caps, generous column width, inline citations.
   - *Ledger family* (Document List, Study Home/Dashboard, Quiz Result) —
     paper-raised, numbers-as-anchors, tabular stat rows, status always
     word + color together (never color alone).
   - *Threshold family* (Landing, Login/Register, Dialogs) — the seal-stamp
     wordmark is the one recurring anchor across this family; everything
     else here is deliberately the plainest, quietest UI in the app.
7. **The seal-stamp motif is referenced, never duplicated.** A loading
   state or empty state may echo the wordmark's rotation/ink metaphor in
   spirit, but no other component gets its own rotated-square treatment —
   one signature, spent deliberately in a small number of places, not
   scattered as decoration.

## Open decisions required before Wave 1 starts

These are things the audit surfaced as genuinely ambiguous — not implementation
work, but calls that change what "done" means for later tasks. Get explicit
answers before touching code, not mid-wave:

1. **Which surfaces become permanently graphite** (dark in both themes)?
   Audit recommends: MindMap canvas, Knowledge Inspector panel + Evidence
   Drawer, workspace nav frame + splitter + panel spine. Less clear: does
   StudyMap's canvas join them, or stay paper (it currently reads more
   "document" than "instrument")? Does Command Palette (an overlay, not a
   persistent frame) count?
2. **Landing / Login / Register — in scope or explicitly deferred?** Paper &
   Graphite's own 10 sections never mention the marketing/auth surface. Audit
   recommends deferring (follow-up pass) to keep this rollout's LOC/risk
   bounded — but that must be a stated decision, not a silent gap.
3. **Should the 3x-duplicated popover pattern (DocumentList / StudyCard /
   BulkBar filter menus) be consolidated into one shared `<Popover>`
   component while it's being touched anyway?** Recommended yes (it's
   currently the same bug copy-pasted three times), but this is the one item
   in this plan that edges toward a structural change (new shared component)
   rather than a pure restyle — flagging for explicit sign-off given the
   brief's "never redesign architecture" rule. If declined, token-fix all
   three copies in place instead (see Wave 2, Task 9b).
4. **Does the input-styling rule (underline in reading contexts, boxed in
   instrument toolbars) apply to the global header search?** Needs one call,
   reused everywhere the same question recurs (dialogs, filters).

---

## Sequencing table

Sorted by **Risk** (primary), then **Impact** (secondary) — land the
highest-impact / lowest-risk work first, isolate the few genuinely risky
items into their own waves with dedicated QA, defer structural-adjacent asks.

| # | Task | Area | Impact | Difficulty | Depends on | Est. LOC | Risk | Rollback |
|---|---|---|---|---|---|---|---|---|
| 1 | Fix phantom CSS vars (`--border`, `--brand`, `--surface-elevated`, `--ok-bg` fallback removal, `--font-display`) | Cross-cutting correctness bug | High (fixes real rendering bugs, incl. StudyMap's primary node colors) | Trivial per-site, systemic sweep | None | ~30 (25+ call sites, 1-line each) | **Low** (mechanical, but verify each site visually) | Instant (revert var name) |
| 2 | Add `fontSize`/`spacing`/`borderRadius` scales to `tailwind.config.js` | Tokens | High (unblocks everything downstream) | Small | None | ~40 | Low (additive, nothing consumes it yet) | Instant (remove config keys) |
| 3 | Repoint color tokens in `index.css` `:root` + `html.dark`: `--bg*`, `--text*`, new forest `--accent`, new bronze `--accent-warm`, rename existing seal-red to `--seal` (kept, narrowed to provenance role — Signature Contract §1), `--signal` (was `--err`, now distinct from both) | Tokens | High (recolors entire app in one pass) | Small | #2 | ~25 | Low–Medium (global reach, but token-only — see Wave note) | Instant (revert index.css) |
| 4 | Collapse `fontFamily.display`/`reading` alias to one role — **keep Spectral** (Signature Contract §3, revised from the original Fraunces plan; no new font load needed) | Tokens | High | Trivial | #2 | ~5 | Low | Instant |
| 5 | WorkspaceTabs — bronze underline color + weight change on active label (Signature Contract §4 — **no italic**, revised from the original Fraunces-italic plan) | Layout | Medium (highest-leverage trivial win) | Trivial | #3, #4 | ~5 | Low | Instant |
| 6 | MindMap structural connector color (`--mm-connector`, forest-tinted, depth-weighted) | MindMap | High (cleanest, most visible single fix in MindMap area) | Trivial | #3 | ~10 | Low | Instant |
| 7 | Modal.jsx restyle (radius 10→3px, remove shadow, 450ms→180ms) | UI primitive | High (cascades to every dialog app-wide) | Trivial | #2, #3 | ~15 | Low (one file, high leverage) | Instant |
| 8 | PanelDivider/Spine retint (graphite bg, bronze badge, grip hidden at rest) | Layout | Medium | Trivial | #1 (graphite decision), #3 | ~15 | Low (a11y contract untouched, verify keyboard resize still works) | Instant |
| 9a | Badge / Avatar / Disclosure / Toaster radius+color token swap | UI primitives | Medium | Trivial | #2, #3 | ~20 | Low | Instant |
| 9b | Fix 3x-duplicated popover (`shadow-lg` + broken border var) — token-fix in place OR consolidate per Open Decision #3 | Study/Document | Medium | Small (in place) / Medium (consolidated) | #1, #2 | ~15 (in place) / ~80 (consolidated) | Low (in place) / Medium (consolidated — behavior must be preserved exactly) | Instant (in place) / Small diff revert (consolidated) |
| 10 | Sidebar Left card border/selection restyle (hairline trailing edge, single selection signal) | Layout | Medium | Small (needs a selection-state decision, not just tokens) | #3 | ~40 | Low | Small diff revert |
| 11 | Dialog inputs (`.input-surface`, ChangePasswordDialog/NksVerifyDialog/ProfileEditForm labels) radius+focus-ring retint | Dialogs | Low–Medium | Small | #2, #3 | ~25 | Low | Instant |
| 12 | Summary Panel + Document List card register/radius pass | Summary/Study | Medium | Small | #3 (graphite decision doesn't apply here — stays paper) | ~30 | Low | Instant |
| 13 | Quiz flow (Setup/Taking/Result) + ReviewGuide + StudyShell radius/token pass | Study | Medium | Trivial (zero bugs to fix first, per audit) | #2, #3 | ~40 | Low | Instant |
| 14 | Study Card / Knowledge Panel / Bulk Bar / Collection Sidebar / Learning Dashboard / AI Insight / Tutor Panel — token sweep (bundled with Task 1's fix in these exact files) | Study | Medium | Small–Medium (7 files, each trivial) | #1, #2, #3 | ~60 | Low (verify with before/after screenshot per audit's own recommendation) | Small diff revert |
| 15 | Markdown.jsx — collapse to shared type scale, add opening-paragraph drop cap | UI primitive | Medium | Small | #2, #4 | ~25 | Low (2 consumers: SummaryPane, EvidenceDrawer — verify both) | Instant |
| 16 | Command Palette / Advanced Search — replace inline-style Chip/highlight with shared classes, radius fix | UI primitives | Low | Small | #2, #3, #9a | ~30 | Low | Instant |
| 17 | Knowledge Inspector panel — graphite register swap | MindMap | High (structural register change, but additive to an already-correct layout) | Small | Open Decision #1, #3 | ~20 | **Low** (grid/sticky contract untouched, purely token) | Instant |
| 18 | Evidence Drawer — graphite register swap (motion untouched, already compliant) | MindMap | Medium | Trivial | Open Decision #1, #17 | ~10 | Low | Instant |
| 19 | Knowledge Inspector / Markdown prose — drop cap on opening paragraph | MindMap | Low | Trivial | #15 | ~10 | Low | Instant |
| 20 | Type-scale codemod — replace the ~495 arbitrary `text-[Npx]` instances by **semantic role** (what the text IS — label/caption/body/stat/heading — mapped to the matching scale token), not by nearest numeric value; each instance gets a one-line role tag during the pass, and any instance that doesn't cleanly fit a role is logged as a **deliberate exception**, not forced into the nearest token | Cross-cutting | **Very High** (largest single structural fix in the whole plan) | Medium–Large (mechanical count, but role-classification per instance is a judgment call, not a lookup — slower than a pure regex codemod, correctly so) | #2 | ~495 line touches across 42 files, plus an exceptions list | **Medium** (breadth — but role-mapping is inherently safer than nearest-value rounding, which would have quietly encoded "close enough" as the scale's actual logic) | Medium (large diff; revert per-file if a regression surfaces, not all-or-nothing) |
| 21 | MindMap node depth hierarchy — branch fill/leaf hairline split, bronze hover edge, forest selection ring, `PALETTE` array repoint | MindMap | High | Small–Medium (real semantic split: introduces a second accent role into an architecturally single-accent system) | #3, #6, Open Decision #1 | ~50 | **Medium** (touches `--accent` consumers app-wide by extension — must land AFTER #3's global repoint is verified stable) | Small diff revert (isolated to MindElixirView.jsx + mindmap.css) |
| 22 | MindMap root node — from filled ink box to typographic title (Spectral roman, bronze rule, no border, **no italic** — Signature Contract §4) | MindMap | Medium | Small | #21 | ~20 | Medium (changes the map's primary visual anchor — needs real visual QA against actual generated graphs, not just a storybook check) | Small diff revert |
| 23 | StudyMap depth-hierarchy + connector restyle (`MARK` const, `.study-map__link`) | StudyMap | Medium–High | Medium (JS render-function edits, not pure CSS) | #1 (StudyMap's `--brand` bug must be fixed first — don't restyle a broken render), #3 | ~60 | **Medium–High** (styling lives inside `renderNode`/`onPick`/search-state functions — isolate, do not batch with anything else) | Small diff revert, but requires careful re-test of click/search/zoom interactions after |
| 24 | Loading/skeleton treatment addendum + rollout (Toaster/Spinner areas currently have none; DocumentList/MindMap already do) | Cross-cutting | Low | Small | New spec addendum (not code) | ~20 | Low | Instant |
| 25 | Landing/Login/Register restyle | Auth/Marketing | Low (out of original spec scope) | Medium (300+ line Landing page, many one-off blocks) | Open Decision #2 — **only if scoped in** | ~150 | Low | Small diff revert |
| 26 | Full-repo audit pass — grep for remaining `text-[`, `rounded-[` over 3px, `shadow-lg`, seal-red hex leftovers; reclassify or document each survivor as a deliberate exception | Cross-cutting | Medium (closes the loop) | Small | All prior waves | ~0 (audit only, fixes as found) | Low | n/a |

---

## Recommended waves (bundling the table above into shippable units)

**Wave 0 — Correctness, not redesign (land first, independently reviewable).**
Task 1 only. Fixes real bugs (StudyMap node color, 24 other sites) that exist
today regardless of any redesign. Ships alone so it can be verified against
the *current* visual system before the palette underneath it changes, making
regressions unambiguous either way.

**Wave 1 — Token foundation (invisible in the running app).**
Tasks 2, 3, 4. Zero visual change ships to users yet (Task 4 is now an
alias-collapse only, keeping Spectral — no font load, no visible change) —
this just makes the new tokens available. Safe to land as one PR.

**Wave 2 — High-leverage, low-risk quick wins.**
Tasks 5, 6, 7, 8, 9a, 9b(in-place). Each is trivial, isolated, and — for 6, 7,
8 especially — each fix updates many downstream consumers at once (Modal
alone touches every dialog). This wave is where the app visibly starts
looking different with the least effort spent.

**Wave 3 — Screen-by-screen token/radius passes (mechanical, parallelizable).**
Tasks 10, 11, 12, 13, 14, 16. Independent of each other; can be split across
multiple PRs or people since none of these files share risk with one
another. Bundle Task 1's remaining per-file phantom-var fixes into whichever
of these touches the same file (14 already assumes this).

**Wave 4 — Type scale codemod.**
Task 20 alone, in its own PR, with mandatory manual spot-check (not just
script-and-ship) given its breadth — the single largest diff in this plan.

**Wave 5 — MindMap (isolated, matches the existing migration plan's own
caution about this library's theme surface).**
Tasks 17, 18, 19 first (Inspector/Drawer register — low risk, additive), then
21, 22 (node depth hierarchy, root treatment — medium risk, needs real
generated-graph QA) as a separate, later sub-wave. Do not bundle 21/22 with
anything else.

**Wave 6 — StudyMap (isolated, same caution as MindMap, for the same
reason — styling lives inside interaction-logic functions).**
Task 23 alone. Requires Task 1's `--brand` fix to have landed and been
verified first.

**Wave 7 — Cleanup and optional scope.**
Tasks 24, 25 (only if Open Decision #2 says yes), 26.

---

## Risk concentration summary

Three places in this whole plan carry more than "low" risk, and they are the
same three the underlying per-file audits independently flagged:

1. **MindMap node depth hierarchy + root treatment (Tasks 21-22)** — the one
   spot where a single shared accent variable's semantics change app-wide by
   extension, and where the visual anchor of the app's primary artifact
   changes shape. Needs dedicated visual QA against real generated graphs.
2. **StudyMap connector/depth restyle (Task 23)** — the one file where
   styling constants and interaction logic (click, search, zoom, collapse)
   share the same functions. Isolate; re-test interactions after, not just
   colors.
3. **Type-scale codemod (Task 20)** — not risky per-instance, but risky in
   aggregate breadth (495 touches); mitigate with a scripted pass plus manual
   spot-check rather than either pure-manual (too slow) or pure-script-and-trust
   (too blind).

Everything else in this plan is a token/class-level restyle on files the
audit confirmed are either already correctly token-driven or trivially close,
with strong existing accessibility that must be preserved (not rebuilt) —
low risk, high aggregate visual impact, straightforward rollback.

## Explicit non-goals (restated from the brief, binding for every task above)

No task in this plan may: change routing, change backend/API contracts,
change state management, change MindMap generation logic, remove a feature,
simplify or hide information present today, or introduce a new component
architecture beyond the one explicitly flagged optional case (Task 9b,
gated on Open Decision #3).

---

**STOP. Awaiting approval before any implementation begins.**
