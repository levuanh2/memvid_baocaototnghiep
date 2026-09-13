# Sprint F — Paper & Graphite Visual Language: Final Report

Not committed, not pushed, per instruction. All changes are local, uncommitted, and scoped to 7 FE files (verified by `git diff --stat` — no BE file touched, no pre-existing FE dirty state swept in).

This sprint used real browser verification (Playwright, headless Chromium) for the first time in this project's redesign work — a capability the prior mission's report explicitly said was unavailable. Every visual claim below is backed by an actual rendered screenshot or a computed-style/contrast-ratio check, not source-reading alone; where that wasn't possible, it's stated plainly.

## 1. Architecture impact

None. Every change is CSS values/selectors, one Tailwind-class rename pattern, JSX `className`/inline-`style` edits, and one theme-config value swap (`MindElixirView.jsx`'s `THEME.cssVar`). No routing, API, backend, business logic, state management, or data-model file touched. No MindMap/Summary/StudyMap generation logic touched — `MindElixirView.jsx`'s edits are entirely inside the `THEME` presentation object; `mindElixirAdapter.js` (the actual generation-facing adapter) was read but not modified.

## 2. Files changed

| File | What changed |
|---|---|
| `FE/src/index.css` | Added the graphite register tokens (`--surface-contrast`, `--on-contrast`, `--on-contrast-muted`, `--contrast-border(-strong)`, `--contrast-hover`, `--contrast-input-bg`, `--contrast-focus`) — declared once, no `html.dark` override, by design |
| `FE/src/components/mindmap/mindmap.css` | Connector opacity tiering; citation-tag color migrated to `--seal`; clean hover on branch nodes; the full graphite-register override block for Inspector/Drawer/Sidebar, plus the paper-card exception for `.evidence-frame` |
| `FE/src/components/mindmap/MindElixirView.jsx` | `THEME.cssVar`'s `--selected`/`--accent-color` → `var(--forest)` (was `var(--accent)`, still seal-red today) |
| `FE/src/components/mindmap/KnowledgeInspector.jsx` | Root panel + footer background → `var(--surface-contrast)` |
| `FE/src/components/mindmap/EvidenceDrawer.jsx` | Root panel background → `var(--surface-contrast)` |
| `FE/src/components/Layout/SidebarRight.jsx` | Root background → `var(--surface-contrast)`, added `sidebar-right` class for CSS targeting |
| `FE/src/pages/Landing.jsx` | H1 → `text-display` scale (was a flat 34/44px); its subhead paragraph → `font-body` (was incorrectly `font-display` — a real pre-existing bug); 5 section H2s → `text-h1` scale (was 24/28px); 3 marketing-tile grids de-bordered (`.surface-card` → plain spacing, wider gaps); wordmark → `--seal` (was `--accent`) |

7 files, +172/−25 lines.

## 3. Visual improvements

All verified with real screenshots (paths in the report's working notes; reproducible via the harnesses described in §12's method).

- **Landing hero**: H1 went from a modest 34-44px to the `text-display` clamp scale (~42-70px), with `leading-[1.05]` and `text-wrap: balance` — now unmistakably the dominant element on the page, "editorial, large, airy" instead of reading like a slightly-larger paragraph.
- **Landing section headers**: 24-28px → 36px (`text-h1`) — now a clear, legible step down from the hero instead of nearly matching it.
- **Landing marketing tiles** (Problem/Solution/Feature grids, 3 grids × 4-6 tiles each): removed `.surface-card`'s border+shadow, widened grid gaps — tiles now read as icon+title+description groups separated by whitespace, not a bordered feature-grid; screenshots before/after confirm the page reads less like a generic SaaS template.
- **MindMap connectors**: root→branch connectors stay full-opacity; every nested connector (branch→child and deeper) renders at 60% opacity — verified in a live-rendered mind-elixir instance, screenshots show a real, visible depth cue that did not exist before.
- **MindMap selection**: ring color changed from seal-red to forest green, confirmed rendering correctly (clean 2px outline, no glow) via a real selected-node screenshot.
- **MindMap citation tag** (`※N`): was reading `var(--accent)`, migrated to `--seal` — a latent bug (would have gone forest-green once `--accent` is ever globally flipped) fixed before it could manifest.
- **Graphite register**: Knowledge Inspector, Evidence Drawer, and the right sidebar now render on a permanent warm graphite (`#26241F`) background, confirmed via screenshot to be **visually identical in both light and dark reading themes** (the defining property of a "register" rather than a dark-mode variant) — the paper control column in the same screenshot correctly flips between themes, proving the two are independent.
- **Evidence cards inside the graphite panels**: confirmed still rendering as light paper cards (the "research note pinned to a graphite desk" effect from Sprint F §7), and confirmed they still correctly respond to the light/dark toggle themselves (unlike the panel background around them).

## 4. Components redesigned

- MindMap canvas (connector styling, selection color, citation tag color) — via `MindElixirView.jsx` + `mindmap.css`.
- Knowledge Inspector, Evidence Drawer, right sidebar — graphite register + a full text/border/icon-button override system scoped to each, with an explicit paper-card exception for evidence/citation content.
- Landing page — hero, section headers, three marketing-tile grids.

## 5. Consistency audit

- Confirmed the graphite override mechanism (Tailwind utility classes as override selectors, e.g. `.knowledge-inspector .text-text-secondary`) reaches every consumer of `.text-text-primary/-secondary/-muted`, `.border-border`, and `.icon-btn` inside the three graphite containers without a single JSX edit — verified by reading every call site in `KnowledgeInspector.jsx` and cross-checking the compiled CSS output contains the expected combined selector rules.
- Contrast measured, not eyeballed (WCAG relative-luminance formula, computed directly, not estimated): `surface-contrast`/`on-contrast` = 12.67:1, `surface-contrast`/`on-contrast-muted` = 5.84:1 (both clear AA 4.5:1). The base `--bronze` on graphite measured only 3.41:1 (fails AA for text, marginal for UI components) — caught before shipping, replaced with a dedicated `--contrast-focus` (`#C99A6C`) measuring 6.14:1. `--forest` on graphite measured 1.36:1 — confirms Codex's warning was correct; `--forest` is never used against graphite anywhere in this sprint's changes.
- Found and corrected one real pre-existing bug while auditing Landing's typography: the hero subhead paragraph used `font-display` (the serif "voice") for body copy — should be `font-body` (Inter) per the app's own three-voice system. Fixed, not just for this sprint's new sizing.
- Verified — via computed style, not visual impression — that Login's "Email"/"Mật khẩu" field labels (which look faintly blue in a screenshot) are in fact `rgb(74,85,103)`, the exact, correct `--text-secondary` value. Recording this explicitly because it's a case where the discipline of measuring instead of eyeballing prevented a wrong "fix" to something that was never broken.
- Dark mode re-checked after every code change (Landing, Login, MindMap, Inspector) via real dark-mode screenshots — no regression found in any of them.

## 6. Accessibility changes

- None regressed: reduced-motion guards, focus-visible outlines, ARIA roles on the Inspector/Drawer/dialogs were not touched by this sprint and were not re-verified beyond confirming no CSS selector here targets `:focus-visible`, `role`, or `aria-*` attributes in a way that could change them.
- One incidental improvement: the graphite `--contrast-focus` color was chosen using a measured 6.14:1 contrast ratio specifically so hover/focus indicators inside the new dark panels stay legible for low-vision users, not just "looks fine here."
- Not attempted: no new keyboard-navigation work (MindMap node selection, previously flagged as click/search-only, remains unchanged — out of this sprint's explicit "presentation only" scope and not mentioned in Sprint F's own list).

## 7. Performance impact

Negligible and mechanical only: a handful of new CSS custom-property declarations and override rules (~130 new lines in one CSS file), no new JS logic, no new render passes, no new dependencies. Bundle sizes moved by double-digit bytes between builds (`Workspace-*.css`/`.js` chunk), consistent with pure CSS/className churn. Confirmed via `npm run build` output at every stage of this sprint, not just at the end.

## 8. Screens requiring manual browser review

In order of how much actually changed:

1. **Knowledge Inspector, Evidence Drawer, right sidebar (live, authenticated)** — verified via a faithful static harness built from the real compiled CSS and the exact markup/classes these components use, NOT the live React components with real data. A human should open the real, running, logged-in app and confirm the harness's findings hold with real evidence text length, long node titles, many citations, and the loading/empty states as the real components produce them (not my harness's approximations).
2. **MindMap canvas (live, authenticated, real generated map)** — verified via a real mind-elixir instance with the app's actual theme config and mock data (not synthetic component reproduction — mind-elixir itself, doing the real rendering), but still not the real app's own data/controller wiring, zoom/pan history, or a genuinely large/deep real map. Check a real map with 50+ nodes, deeply nested branches, and very long node labels.
3. **StudyMap, Summary, Document List, Dialogs, Study/Knowledge panels** — **not verified visually at all this sprint.** These require an authenticated session with real indexed documents (confirmed via `demoMode.js`: no synthetic/offline preview path exists), which this environment cannot stand up. Only touched indirectly if at all (none of these files appear in §2's file list) — but they consume the SAME shared `.icon-btn`/`.border-border`/font-scale tokens that changed, so a real visual pass on all four is warranted before considering this sprint's changes fully verified app-wide.
4. **Landing/Login mobile + dark** — desktop and one mobile width (375px) and both themes were screenshotted for Landing; Login was checked at desktop in both themes. A quick pass at 768px and Register (not screenshotted, but received no Landing-style edits) would close the loop.

## 9. Remaining UI debt

Carried over from the prior mission, still true:
- The `text-brand`/`border-brand`/`bg-brand`/`accent-brand` Tailwind-class universe (~63 sites, separate from the `var(--accent)` sites this and the prior sprint have been migrating) is still unclassified. `--accent`'s and `--brand-rgb`'s base color values are still deliberately NOT flipped from seal-red to forest.
- The ~495-instance arbitrary `text-[Npx]` type-scale codemod has still only been applied to a handful of files (`Markdown.jsx` previously; Landing's H1/H2/wordmark paragraph this sprint). The other ~40 files remain.
- Landing/Login/Register's continued inclusion in scope is still an implicit yes by virtue of this sprint editing Landing directly — no explicit product decision was requested or given on this point.

New from this sprint:
- The graphite-register CSS override mechanism (Tailwind-utility-class selectors scoped by container) is powerful but adds real selector-specificity surface area — any FUTURE component added inside `.knowledge-inspector`/`.evidence-drawer`/`.sidebar-right` that uses a *new* utility class not in this sprint's override list (e.g., `text-text-inverse`, or a new arbitrary color) will silently NOT get graphite-corrected text and needs a matching rule added.
- `EnrichmentCard`'s "Xem thêm" link and a few remaining `text-brand` (not `text-text-*`) usages inside `knowledgeParts.jsx` were not audited for graphite-contrast this sprint — `text-brand` resolves to `--brand-rgb`, unaffected by any override here, and untested against the graphite background.
- MindMap's two-tier connector-opacity approximation (root-branch vs. everything-nested) is an honest compromise, not a true per-depth fade — documented in the code comment; a real per-level fade would require patching mind-elixir's internals, which was deliberately avoided.

## 10. Anything intentionally NOT changed

- MindMap root node's filled-ink-box treatment — Sprint F's own wording ("Root: strongest") is already satisfied by the existing solid, high-contrast box; changing it to a typographic-only title (an idea from an earlier, different mission) was not requested this time and was not attempted.
- Global `--accent` base color value (still seal-red) — flipping it now, with the `text-brand`-class universe still unclassified, would recolor an unknown mix of correct and incorrect consumers app-wide; deliberately deferred again, same reasoning as the prior mission.
- Mind-elixir's per-branch `PALETTE` array values — unchanged this sprint (a prior mission already fixed the one real bug there, a seal-red collision); no new complaint was raised against it and it renders correctly per this sprint's own screenshots.
- Any BE file, any routing, any API contract, any state-management code — untouched, confirmed via `git status` scoped to `FE/` only.
- The pre-existing uncommitted BE working-tree state from earlier in this session — left exactly as found, not swept into this sprint's diff.

No commit. No push.
