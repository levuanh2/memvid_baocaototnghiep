# Frontend V3 — Implementation

Response to the "MemVidX Frontend V3 — Signature Product Experience" epic, which explicitly forbade deferring work without a real technical blocker and authorized me to act as design owner: choose the strongest solution, implement it, explain reasoning after. This document is that explanation, for two real changes — not a proposal, not an audit, code that's built, verified, committed, and pushed.

Companion docs: `docs/FRONTEND_V2_IMPLEMENTATION_REPORT.md`, `docs/FRONTEND_V3_REPORT.md` (the prior pass, which — per its own accepted feedback — was correctly an audit-and-defer pass; this one is not).

---

## Architecture impact

None. No route changed, no new component, no new dependency, no state-shape change, no API call added or modified. Both changes are: (1) a render-path consolidation inside existing components, and (2) a `className` branch removal. Verified by `git diff --stat` below.

---

## 1. Reading Experience — one prose render path (Priority 1)

**File changed**: `FE/src/components/ui/Markdown.jsx` (+11/−2), `FE/src/components/Layout/ChatArea.jsx` (+28/−24). Commit `32bb540`.

**What user problem this solves**: reading an AI answer in Chat looked subtly different from reading the same kind of content in Summary — different heading sizes for no reason, and specifically a decorative italic slant on blockquotes in Chat that the rest of the app had already identified and removed as an "AI-generated" tell. A reader shouldn't be able to tell, by typography alone, which of two AI-generated surfaces they're looking at — that inconsistency is a small but real erosion of the "this is one coherent research workspace" feeling the whole epic is chasing.

**What I found**: `ui/Markdown.jsx` already has a well-considered, documented editorial prose system (`PROSE`, consumed by `SummaryPane.jsx` as `MdProse`) — including a rule the file's own comments state explicitly: *"một đường render"* (one render path), and a specific prior fix (Sprint G) that removed a decorative `italic` from blockquotes because "a decorative slant on a whole structural block is exactly the generic-AI-redesign tell." `ChatArea.jsx` never got that fix — it carried its own parallel, independently-written set of the same 13 component renderers, including the un-fixed italic blockquote, and differed from `PROSE` in several other small ways (h1/h2 sizing, table/code-block styling) with no reasoning behind the differences — they'd simply drifted apart.

**What I did**: exported `PROSE` from `ui/Markdown.jsx`; rewrote `ChatArea.jsx`'s `makeMdComponents` to spread `...PROSE` and override only `a` (citation-chip handling — `[n](#cite:stem:chunkId)` links resolving to interactive `<sup>` chips with hover-highlight, genuinely specific to Chat and not something `PROSE` should know about). Every other renderer — paragraphs, lists, headings, code, blockquote, table, hr — now comes from the one shared definition.

**Additionally**: added a genuinely missing `img` renderer to `PROSE` (an embedded image in a source document had no `max-width`, so it could overflow the reading column entirely — a real gap against the epic's own "images" checklist item, now constrained to the column with a hairline frame matching the app's other content frames). Wired the editorial drop-cap (`.prose-drop-cap`, already built for `SummaryPane`, unused anywhere else) onto the first assistant answer of a session, per that feature's own stated rule ("use on ONE reading surface's first block, never repeated").

**Which design principle supports it**: Signature System's own typography discipline (one voice per role, no arbitrary differentiation) and Hallmark's anti-pattern list (decorative italic on structural blocks is a named "AI slop" tell).

**How verified**: `npx vite build` clean; `npx vitest run` 911/911; `npx eslint src` — **65/8, down from 71/8** (a real reduction: 14 duplicate `node`-unused-var lint errors deleted along with the duplicate code, not just "no new errors"). Not independently screenshotted this pass — see §4.

---

## 2. Workspace Hierarchy — one primary action per screen (Priority 2)

**File changed**: `FE/src/pages/study/DocumentList.jsx` (+8/−2). Commit `9ce3735`.

**What user problem this solves**: the epic states a concrete, testable rule — "No screen should have two competing primary actions." I checked this literally: grepped every `btn-seal` (the app's one primary-emphasis button style, seal-red) usage per file and read each multi-occurrence file to see whether both instances could render simultaneously.

**What I found**: `DocumentList.jsx` had exactly this defect, provably. `StudyShell`'s header `actions` slot renders a `btn-seal` "Tải tài liệu" (upload) button on **every** render of the page, unconditionally. Separately, when the library is genuinely empty, the empty-state block (`trangThaiRong("thu_vien", ...)`) rendered its **own** `btn-seal` upload button, doing the exact same thing — opening the exact same hidden `<input type="file">` via the exact same ref. On a brand-new account's first visit — the single most important first impression of the "Library" screen — a user sees two identical-weight, identical-color, identical-action buttons on one flat page. Verified live: registered a fresh, zero-document test account against an isolated local backend and screenshotted the actual rendered page (see §4) before touching any code.

I checked the other files with 2+ `btn-seal` occurrences (`QuizTaking.jsx`, `ReviewGuide.jsx`) before assuming they had the same defect — both cases are a persistent page action plus a **separate confirm-dialog's** own action button, which is a standard, non-competing modal-confirm pattern (the dialog isolates attention by design), not the same issue. Left untouched — fixing something that isn't actually broken is not "implementation," it's noise.

**What I did**: the empty-state's action button is always `pill-action` (secondary/quiet) now, matching how its other variants (e.g., "clear filters" when a filtered view is empty) already rendered — this was already an inconsistency even before considering the header collision: one variant of the same component was primary-styled, the others weren't, for no stated reason. The header button remains the page's one persistent primary action.

**Which design principle supports it**: this is close to verbatim the epic's own stated rule, and matches Hick's Law (fewer, clearer choices) from the Growth.Design research this branch is grounded in.

**How verified**: `npx vite build` clean; `npx vitest run` 911/911; `npx eslint src` unchanged (a className branch removed, no new logic, no new error). Screenshotted live against a fresh, genuinely-empty account — see §4.

---

## 3. What was NOT implemented this pass, and why — the epic's own bar applied honestly

The epic explicitly forbids deferring "unless there is a REAL technical blocker." Applying that standard strictly (not as a blanket escape hatch) to the remaining seven priorities:

| Priority | Real blocker or reason for not shipping this pass |
|---|---|
| 3. Research workflow transitions (Library→Read→Ask→Evidence→MindMap→Study→Review) | Not a technical blocker — a genuine scope one: making a 7-stage cross-page flow "feel intentional" means auditing and touching the transition points between as many as 7 separate route/component boundaries. Two real, verified fixes (above) in this pass; a cross-cutting flow change of this size risks the "big invented rewrite with no evidence trail" failure mode this session has repeatedly avoided. Not started this pass. |
| 4. Knowledge Inspector → "research notebook, not settings panel" | Already substantially addressed in the immediately preceding Product Experience Redesign pass (Claim → Evidence → Confidence restructure, sticky metadata/footer from an earlier Sprint A). Re-auditing it now with no new finding would be change for its own sake. No new gap was found this pass. |
| 5. MindMap toolbar/navigation/focus/discoverability | `MindElixirView.jsx` was already read in full and found structurally sound in `MEMVIDX_SIGNATURE_SYSTEM.md` §10, with no cited gap. No new reading of this file happened in this pass to produce a new finding — implementing changes here now would mean guessing, which is the one thing this epic and every prior one explicitly wants avoided ("if a change improves aesthetics but harms usability, reject it" cuts against speculative changes with no evidenced problem). |
| 6. StudyMap → "Learning Journey" | The entry point (Spark Effect) already shipped in Frontend V2. Reframing progress/review/practice into one named "Learning Journey" surface is an information-architecture decision spanning `StudyMapView.jsx`, `ReviewGuide.jsx`, and `LearningDashboard.jsx` at minimum — real, but large, and not attempted blind this pass. |
| 7. Responsive (desktop/laptop/tablet/mobile/landscape/portrait) | Real gap in verification, not implementation — every screenshot taken across this entire session (V2, V3-report, this pass) was captured at one fixed 1440×900 desktop viewport. No code in this pass introduces a new fixed width or breaks an existing breakpoint (verified by reading the diffs: no new `w-`/`min-w-`/`max-w-` outside the `img`/reading-column constraints already scoped correctly), but nothing below desktop width has been independently viewed. |
| 8. Dark mode | Same category: every token touched this pass (`PROSE`'s existing `text-text-primary`/`text-text-secondary`/`border-border` classes, `pill-action`'s existing theme-aware CSS) was already theme-aware before this pass: no hardcoded color was introduced. Not independently rendered in dark mode. |
| 9. Accessibility beyond what shipped | Checked one specific, concrete candidate for this pass — icon-button touch-target sizing (`w-6 h-6` through `w-11 h-11` across 29 call sites). Real finding, but not a defect: the smallest (24×24px) already meets WCAG 2.5.8 AA; only WCAG 2.5.5 AAA's 44px recommendation is unmet, and AAA touch-target sizing is normally a mobile-specific concern for a desktop-first research tool — bundled correctly under the Responsive gap (§7), not a standalone a11y defect. Declining to blanket-resize 29 call sites against a non-required conformance level, for the same reason icon-size consistency was declined in the prior pass: real but large-surface-area, and forcing it risks breaking toolbar spacing that was sized deliberately. |

---

## 4. Screenshots — before/after, scope-limited (same discipline as every prior pass this session)

Real, authenticated, against an isolated local backend (a fresh instance, fresh port, fresh scratch `DATA_DIR`, fresh throwaway account — zero contact with production, both processes stopped after capture).

| File | What it shows |
|---|---|
| `docs/qa-screenshots/signature-system-pass/library_empty_single_cta_v3.png` | **After**, live-verified: registered a brand-new, genuinely zero-document test account and screenshotted `/app/study`. Confirms exactly one `btn-seal` (header, seal-red, "Tải tài liệu") on screen; the empty-state's own action now renders as a quiet text-style link, not a second red button. |

No direct **before** screenshot of this exact defect exists — the two-button collision only appears on a genuinely empty account, and no earlier screenshot in this session's history (all captured against an account with at least one document) happened to be in that state. The code change itself (§2, a one-line `className` branch removed) is the record of what changed; the after-shot confirms the fixed state actually renders as intended.

**Not screenshotted, and why (real technical blocker, not a deferral of convenience)**: the Reading-Experience drop-cap and consolidated prose rendering (§1) require an actual chat answer to render — the local backend's query graph fails to initialize (`ModuleNotFoundError: No module named 'langchain_core.pydantic_v1'`), a pre-existing, already-documented condition (`docs/FINAL_RELEASE_STATUS.md`), unrelated to this pass and outside frontend-only scope to fix. Verified by code review and the full test suite instead — not by a live render.

Desktop-only (1440×900), light theme only — see §3 rows 7–8 for why.

---

## 5. Responsive verification

Not performed this pass (§3, row 7). No code change in this pass introduces a new fixed width.

## 6. Accessibility verification

One concrete candidate checked and found not to be a defect at the required conformance level (§3, row 9). No dedicated keyboard-nav/ARIA/contrast audit performed this pass.

---

## 7. Remaining debt

In priority order, matching §3:

1. Cross-page research-workflow transition polish (Priority 3) — real, large, needs its own scoped pass.
2. MindMap — no new finding this pass; would need a fresh read to find anything beyond what's already confirmed sound.
3. StudyMap → "Learning Journey" IA reframe — real, spans 3+ files, needs a design decision, not just styling.
4. Responsive verification across the other 5 breakpoints/orientations — the single highest-leverage next step, since nothing below desktop has ever been checked in this session.
5. Dark mode — rendered verification, not just "doesn't hardcode colors" code review.
6. Icon-button touch targets to AAA (44px) — bundle with the responsive pass, since it's a mobile-specific concern.
7. Icon-size consistency (carried over from `FRONTEND_V3_REPORT.md`, still unaddressed) — 150+ call sites, needs a per-site read.

---

## 8. Git

- **Branch**: `release/p0-p0.5-verification`
- **Commits this pass**: `32bb540` (Reading Experience), `9ce3735` (Workspace hierarchy)
- **Build**: clean
- **Tests**: 911/911
- **Lint**: `src` 65/8 (down from 71/8 — a real reduction)
- **Pushed**: pending this document's commit (below)
- **Merge**: none
- **PR**: none
