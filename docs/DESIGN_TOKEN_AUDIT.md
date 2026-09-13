# Design Token Audit — Paper & Graphite Redesign, Phase 2

Read-only audit. No files modified. Scope: `FE/tailwind.config.js`,
`FE/postcss.config.js`, `FE/src/index.css`, `FE/src/App.css`,
`FE/src/components/mindmap/mindmap.css`, `FE/src/hooks/useTheme.js`, plus a
full grep sweep of `FE/src/**/*.{js,jsx}`.

## 0. What already exists (good news first)

The token *architecture* is already sound — this is not a "hunt gray-100
across 100 files" migration:

- All surface/text/border/accent colors are piped through CSS custom
  properties in `index.css` (`--bg-base/sidebar/card/elevated/panel/hover`,
  `--text-primary/secondary/muted/inverse`, `--border-color/-strong`,
  `--accent`/`--brand-rgb`), consumed via `var(--token)` or Tailwind's
  `rgb(var(--brand-rgb) / <alpha-value>)` opacity-safe channel trick.
- Dark mode is automatic wherever a token is used — `html.dark` redefines the
  same variable names with a genuinely hand-tuned parallel palette (not an
  auto-invert filter).
- Three font roles already exist: `display`/`reading` (Spectral), `body`
  (Inter), `mono` (IBM Plex Mono). **The mono role already matches Paper &
  Graphite exactly** — zero change needed there.
- `boxShadow.card`/`card-hover` are already tokens (`var(--shadow-card)`), not
  raw Tailwind `shadow-lg` in the vast majority of cases.
- **Confirmed zero** `gray-\d{2,3}` Tailwind utility matches anywhere in
  `FE/src`.
- **Confirmed zero** Framer Motion usage (`transition={{`, `motion.div`,
  `from "framer-motion"`, `stiffness`, `damping`) and it is **absent from
  `package.json`** — the brief's stack list is stale. All real motion is plain
  CSS `@keyframes`/`transition`.

**What's missing**: no `fontSize` scale, no `spacing` scale, no `borderRadius`
scale in `tailwind.config.js`'s `theme.extend`. This absence is the direct
cause of finding #1 below, which is the single largest structural gap found
in this entire audit — bigger than color.

---

## 1. No shared type scale — the dominant finding

Grep for `text-\[\d+(\.\d)?px\]` across `FE/src`: **495 matches across 42
files.** Sampled distinct pixel values across a representative subset of
files: **10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5,
17, 18, 19, 24, 26, 28, 32, 34, 44 — 23+ distinct sizes with no scale
relationship to one another.**

A second, fully independent type scale exists inside `Markdown.jsx`'s `PROSE`
component map (h1 19px / h2 17px / h3 15px) that shares no relationship with
the app-wide sizes above.

**Fix — revised per Codex/hallmark critique (see `UI_IMPLEMENTATION_PLAN.md`'s
Revision note)**: define a real `fontSize` scale in `tailwind.config.js`
matching the table below, then replace the 495 arbitrary instances by
**semantic role** — what the text actually is (label, caption, body, stat,
heading) mapped to the matching token — not by rounding each pixel value to
its nearest scale neighbor. Nearest-numeric mapping would encode "close
enough" as the scale's own logic and silently launder inconsistency into the
new system instead of removing it; role-mapping is slower per instance but
is the only version of this fix that actually produces a *scale* rather than
a smaller set of arbitrary numbers. Any instance that resists a clean role
(rare, but expect a few) gets logged as a named exception, not forced.

**Typeface correction**: the original version of this table specified
Fraunces for every serif role and an italic H3. Corrected — **Spectral
stays** (it's already the app's own signature reading serif; swapping it is
a brand-voice change, not a token update — see Signature Contract §3) and
**no role uses italic** (Signature Contract §4 — italic display type is a
recognizable generic-redesign tell). Emphasis that would have been italic
uses weight + a bronze underline/rule instead.

| Token | Family / weight | Size | Use |
|---|---|---|---|
| `--fs-display` | Spectral 380–520 | clamp(2.6rem, 5vw, 4.4rem) | Masthead only |
| `--fs-h1` | Spectral 540 | 2–2.75rem | Screen/panel titles |
| `--fs-h2` | Spectral 540 | 1.5rem | Section heads |
| `--fs-h3` | Spectral 600, roman, bronze underline rule | 1.15–1.3rem | Sub-heads, pull quotes |
| `--fs-body` | Inter 400 | 1rem / 1.7 | Running text, list items |
| `--fs-label` | Inter 500 | .8rem, +.06em tracking | Buttons, tabs, form labels |
| `--fs-mono` | Plex Mono 400–500 | .78–1rem, tabular | Counts, IDs, timestamps |

---

## 2. Arbitrary Tailwind bracket values (all kinds)

Grep for `\[(rounded|p|m[trblxy]?|text|w|h)-\[` patterns app-wide: **606
matches across 42 files** (495 of these are the `text-[Npx]` count above; the
remainder is spacing/sizing/radius arbitrary values). This is the true
"magic numbers" finding the brief asked for — not hardcoded colors (there are
almost none), arbitrary *dimensions*.

**Fix**: add `spacing` and `borderRadius` scales to `tailwind.config.js`
alongside the `fontSize` scale above; migrate call sites opportunistically as
each component is touched during the Phase 3 rollout, rather than as one
giant mechanical pass (spacing values are more context-dependent than type
sizes and riskier to codemod blindly).

## 3. Radius

Grep for `rounded-lg|rounded-xl|rounded-2xl|rounded-full`: **26 matches
across 12 files** — mostly legitimate `rounded-full` circles (avatars, seal
meter, progress bar pills), not the violation. The real radius debt is in the
arbitrary bracket values: `.surface-card` = 8px, `.btn-*`/`.input-surface` =
6–7px, `Badge` = 4px, `Modal` = 10px, `CommandPalette` active row = 8px —
**consistently above Paper & Graphite's 3px ceiling**, but never using
Tailwind's own oversized defaults (`rounded-lg` etc.), which is a better
starting position than a typical shadcn app.

**Fix**: add a `borderRadius` scale capped at 3px for interactive controls
(buttons, inputs, chips, badges, palette rows); zero out radius on
`.surface-card`/panels/dialogs/containers per spec ("square containers,
radius spent by role").

## 4. Shadows

Grep for literal `shadow-lg|shadow-xl|shadow-md` (bypassing the `--shadow-card`
token): **6 matches across 5 files** — `DocumentList.jsx:481`,
`BulkBar.jsx:70,105`, `ChatArea.jsx:653`, `StudyCard.jsx:254`,
`SidebarRight.jsx:674`. **All six are floating dropdown/context menus** — a
defensible "elevate a popover above content" use, not decoration on a static
card. This is not the brief's "shadow-lg everywhere" problem; the actual
shadow debt is `.surface-card`'s soft `--shadow-card` token being applied to
nearly every card in the app by default, which the spec's "not everything is
a card" rule wants trimmed, not these 6 literal instances.

**Fix**: keep a restrained elevation token for the 6 legitimate popover
sites; remove `--shadow-card` from `.surface-card`'s default state (hairline
edge instead), matching the spec's austerity rule.

## 5. Hardcoded hex colors

Grep for `#[0-9a-fA-F]{3,6}` inside `className`/`style` props: **6 matches
across 4 files.** Two categories:
- `MindElixirView.jsx:26` — the 6-value `PALETTE` array for MindMap branch
  colors (`#5C6B7A #3E6B57 #B5821F #B23A2E #4A5A8A #8A7A66`) — none of these
  map to forest/bronze/rust; a real, direct fix needed (see UI_AUDIT_V2 §11).
- `KnowledgePanel.jsx:26-27`, `StudyCard.jsx:28` — defensive `var(--x,
  #fallback)` fallback values, low severity, kept for safety.

## 6. Inline `style={{...}}` usage

**606 occurrences across 42 files** (same count as the bracket-value grep —
significant overlap: many inline styles set `var(--token)` values
dynamically, e.g. `style={{ background: "var(--accent)" }}`, which is
deliberate runtime theming, not a violation). A real subset is genuine debt:
- Hardcoded scrim `rgba(0,0,0,0.45)` in `AvatarPicker.jsx:49` instead of a
  token.
- `ProfileView.jsx:67-68` — `style={{ borderColor: "var(--border-color)" }}`
  duplicating what a Tailwind-mapped `border-hairline` utility class should
  express directly once one exists.
- `CommandPalette.jsx:56-60` — one-off inline active-row highlight
  duplicating `.pill-action-active`/`.badge-*` class logic.
- `AdvancedSearchPanel.jsx:10-33` — `Chip`/`Disabled` are hand-rolled
  inline-style components duplicating badge/pill logic a *third* way (see
  UI_AUDIT_V2 §23 for the full triplication finding).

## 7. **Phantom / undeclared CSS custom properties — correctness bug, not a style violation**

This is the most important finding in this document. The following variables
are referenced via inline `style={{}}` throughout the app but are **never
declared anywhere in `index.css`** (verified by full-file read, not just
grep-absence):

| Undeclared var | Should be | Call sites found | Severity |
|---|---|---|---|
| `var(--border)` | `var(--border-color)` | 21 sites across `StudyCard.jsx`, `DocumentList.jsx`, `BulkBar.jsx`, `CollectionSidebar.jsx`, `KnowledgePanel.jsx`, `LearningDashboard.jsx` (+ `ChatArea.jsx`/`SidebarRight.jsx` in the Layout group) | Medium — silently resolves to browser-initial value, not the intended border color |
| `var(--brand)` | `var(--accent)` or the `text-brand`/`border-brand` Tailwind utility (which works correctly elsewhere) | 4 sites, most visibly `StudyMapView.jsx:40-43` — **root/section node `fill`/`stroke` and selection ring color in the app's primary data visualization** | **High** — the StudyMap's root/section/selection node color is likely rendering wrong (or only "right by accident" via SVG inheritance) in every browser today |
| `var(--surface-elevated)` | `var(--bg-elevated)` | 1 site | Low |
| `var(--ok-bg)` | not declared; call sites all use a fallback: `var(--ok-bg, rgba(34,150,94,0.12))` | 2 sites (`KnowledgePanel.jsx`, `StudyCard.jsx` — the duplicated `MAU_MASTERY`/`MAU_CHIP` constants) | Low — the fallback is not a safety net here, it's the *only* value that has ever actually run |
| `var(--font-display)` | Tailwind's `font-display` class, or declare the var | 1 site (`StudyMapView.jsx` node label `fontFamily`) | Low — masked by a working CSS fallback to `Spectral`, harmless in effect |

**Likely root cause**: a token rename (`--border` → `--border-color`,
`--surface-elevated` → `--bg-elevated`) that updated `index.css` and
`tailwind.config.js` but missed inline `style={{}}` call sites, which no
linter currently catches.

**This must be fixed as a standalone correctness step — before or during,
never silently folded into, the Paper & Graphite token rename** — because
repainting a phantom-var bug with new phantom values just relocates the same
bug. Each site needs a quick visual check when touched (some may currently
render acceptably by accident via inherited/default values; don't assume the
rename alone is a safe blind find-and-replace).

## 8. Motion durations (for reference — no library to migrate)

Since Framer Motion doesn't exist in this codebase, the "replace spring
configs" instruction in the Paper & Graphite migration plan's §09 has nothing
to act on. Real CSS animations found, with durations:

| Animation | Duration / easing | Spec ceiling | Status |
|---|---|---|---|
| EvidenceDrawer slide-in | 180ms, ease-out, translateX only | 180ms, ease-out, translate only | **Exact match, no change needed** |
| WorkspaceTabs active state | instant color/border change | 120ms hover budget | Compliant |
| Modal `fadeUp` | 450ms ease-out, translateY 12px→0 | ~180ms panel-open budget | Over budget — trim duration, keep ease-out (it is not a spring) |
| `pulse`/`pulseSoft` (processing/loading indicators) | 1.3s breathing loop | n/a — ambient loop, not interaction response | Not in scope of the interaction-response ceiling; keep, just confirm reduced-motion guard carries over |
| `scanPulse` (`.apparatus-dot--active`) | 1.4s ring expand | n/a — ambient loop | Same as above |

All sampled animations are already `prefers-reduced-motion`-guarded at their
call sites.

## 9. Existing `tailwind.config.js` customizations worth preserving as-is

- `fontFamily.mono` → IBM Plex Mono: **keep verbatim**, already correct.
- Color tokens piped through CSS vars with the `rgb(var(--x-rgb) /
  <alpha-value>)` trick for opacity-safe Tailwind utilities: **keep the
  mechanism**, only repoint the underlying hex values in `index.css`.
- `boxShadow.card`/`card-hover` as named tokens rather than raw utilities:
  **keep the mechanism**, shrink/adjust the values.

## 10. Recommended new/changed tokens (mechanical summary for Phase 3)

Revised per the Signature Contract: seal-red is **kept**, not deleted — it
narrows to a provenance-only role (wordmark stamp, `.cite-chip`, verified-
source signals) instead of doing every job at once. `--accent` becomes the
new forest primary-action/selection color; `--seal` is the renamed, unchanged
seal-red value, now scoped to exactly one meaning instead of six.

```
--bg              #F3EEE1   (was --bg-base   #ECE7DB)
--bg-raised       #EAE1CC   (was --bg-sidebar / --bg-elevated family)
--surface-contrast #221F19  (NEW — permanent dark register, both themes — see Signature Contract §2 for WHICH surfaces, not just the value)
--on-contrast     #EDE6D3   (NEW — text on --surface-contrast, fixed both themes)
--text            #1C1912   (was --text-primary #1B2A41)
--text-muted      #5B5642   (was --text-secondary/--text-muted)
--accent          #1F4033   (NEW forest — primary action/selection/links/active-tab ONLY)
--accent-warm     #A06A3B   (NEW bronze — hover edge + numbers/counts/data-badge role; ALSO the one color every screen family may use for stat/count emphasis, per Signature Contract §5)
--seal            #B23A2E   (KEPT, unchanged value, renamed from --accent — provenance/citation/wordmark-stamp role ONLY, per Signature Contract §1: not deleted, narrowed)
--signal          #A93F23   (was --err, semantically distinct from BOTH --accent and --seal now — role narrows to error/conflict/unread ONLY, never doubles as decoration)
--hairline        rgba(28,25,18,.16)  (was --border-color, same mechanism)
```

Font family: **Spectral stays** for the `display`/`reading` roles,
**collapsed to one role** (`display`) per the "three roles, three families,
never blended" rule — having two serif aliases today invites drift and is
one of the contributing causes of the type-scale fragmentation in finding
#1. (Corrected from an earlier draft of this table that specified swapping
to Fraunces — see Signature Contract §3: that would have been a brand-voice
change, not a token update, and Spectral is already the app's own
signature.)

Every value above is a **repoint of an existing, working token mechanism** —
none of this requires introducing a new theming system, a new build step, or
touching component logic. The one net-new *concept* (not just a new value)
is `--surface-contrast`/`--on-contrast` — see Open Decision #1 in
`UI_IMPLEMENTATION_PLAN.md` for which surfaces actually earn it.
