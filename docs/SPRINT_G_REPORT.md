# Sprint G — Typography System & Reading Experience

Status: implementation complete for all code-reachable work. Not committed, not pushed (per sprint rule). Scope held to presentation/typography only — no backend, routing, business logic, MindMap/Summary/StudyMap generation, Analytics, Recovery, Semantic AST, Citation Engine, Database, or Deploy code was touched.

## 1. Architecture impact

None. Zero non-FE files touched. Zero changes to component logic, state, hooks, routing, or data flow — every edit in this sprint is a className/JSX-markup/token-value change or a CSS/Tailwind-config addition. The one JS-level touch outside `className` strings is `StudyMapView.jsx`'s `MARK` object, and that only changes the numeric `text:` (SVG `fontSize`) fields — the object's `r`/`fill`/`stroke`/`weight` fields and every consumer of `markOf()` (selection, hover, search-focus, collapse/expand, export, keyboard nav) are untouched.

## 2. Files changed

44 files, +720/−530 (see `git diff --stat -- FE/src FE/tailwind.config.js`). Grouped by what changed:

- **Scale definition**: `tailwind.config.js` — `fontSize` rewritten to the full 13-role named scale (display/h1/h2/h3/title/subtitle/body-lg/body/small/label/caption/metadata/mono), each with its own baked `lineHeight` (and `letterSpacing`/`fontWeight` where the role calls for it).
- **Metadata-pattern codemod** (26 files): every `font-mono` + `uppercase` line whose size was `text-[10px|10.5px|11px]` → `text-metadata`, with the accompanying `tracking-[...]` stripped (the token bakes in `letter-spacing:0.12em`).
- **Plain-value codemod** (40 files): every remaining `text-[Npx]` mapped to the nearest semantic role, grounded in sampled real usage per value (not nearest-numeric rounding) — see §5.
- **`leading-[...]` cleanup** (21 files, 51 instances): stripped everywhere the value duplicated or drifted from its own role's baked line-height.
- **Manual fixes**: `MainLayout.jsx` (a `12px` metadata instance outside the first codemod's filter range), `Landing.jsx` (workflow-step numeral reclassified from a metadata-shaped label to `text-h3 tabular-nums`), `Login.jsx`/`Register.jsx`/`DocumentList.jsx`/`Practice.jsx`/`QuizResult.jsx` (5-site numeral/header unification to `text-h2`), `StudyMapView.jsx` (`MARK` SVG font sizes repointed to the named scale's underlying px values).
- **`Markdown.jsx`**: both component maps (`SM` for evidence snippets, `PROSE` for reading prose) rewritten onto the named scale; added `hr`/`table`/`thead`/`th`/`td` handlers that didn't exist before; dropped decorative `italic` on `blockquote`.

## 3. Typography system created

```
fontSize: {
  display:  clamp(2.6rem, 5vw, 4.4rem) / 1.05
  h1:       2.25rem   / 1.15
  h2:       1.5rem    / 1.25
  h3:       1.2rem    / 1.3
  title:    1.0625rem / 1.35  (weight 600 baked in)
  subtitle: 0.9375rem / 1.45
  body-lg:  1rem       / 1.7   — reading prose (Markdown.jsx PROSE)
  body:     0.875rem   / 1.55  — dense default UI text
  small:    0.8125rem  / 1.5
  label:    0.8rem     / 1.4   (letter-spacing 0.06em)
  caption:  0.71875rem / 1.45
  metadata: 0.65625rem / 1.4   (letter-spacing 0.12em, uppercase pattern)
  mono:     0.8125rem  / 1.4
}
```

Every role now exists exactly once, with its line-height baked in at the token level — components no longer hand-tune `leading-[...]` per instance. This is a deliberate **redefinition** of `body` from Wave 1's draft (was 1rem/"reading prose") to 0.875rem/"dense UI text" — the single highest-count real size across the app. `body-lg` takes over the old reading-prose role; `Markdown.jsx`'s `PROSE` component was repointed to `body-lg` in the same change so no reading surface silently shrank.

## 4. Components audited

Markdown.jsx (both component maps), ChatArea.jsx's own separate markdown map (unified onto the same size values as Markdown.jsx, though the two component definitions remain physically separate files — see §10), MainLayout.jsx, Landing.jsx, Login.jsx, Register.jsx, DocumentList.jsx, Practice.jsx, QuizResult.jsx, QuizSetup.jsx, QuizTaking.jsx, ReviewGuide.jsx, StudyMapView.jsx, SummaryPane.jsx, KnowledgeInspector.jsx, EvidenceDrawer.jsx, SidebarRight.jsx, MindElixirView.jsx, knowledgeParts.jsx, CommandPalette.jsx, AdvancedSearchPanel.jsx, CollectionSidebar.jsx, KnowledgePanel.jsx, LearningDashboard.jsx, StudyShell.jsx, TutorPanel.jsx, ChangePasswordDialog.jsx, NksVerifyDialog.jsx, ProfileEditForm.jsx, ProfileView.jsx.

## 5. Magic values removed

Before → after (app-wide grep census, `FE/src/**/*.jsx`):

| Pattern | Before | After |
|---|---|---|
| `text-[Npx]` | ~495 | 4 (2 documented exceptions, 2 unrelated color values — see §11) |
| `leading-[...]` | 52 | 1 (paired with the one documented size exception) |
| `tracking-[...]` | ~51 | 0 |
| `font-[...]` | (present) | 0 |

The plain-value codemod mapping was grounded in sampled real usage per pixel value (grep'd every distinct value's actual call sites before deciding), not nearest-numeric rounding:

```
10/10.5/11/11.5px → caption   12/12.5/13px → small
13.5/14/14.5px    → body      15/16/16.5px → body-lg
15.5/17px         → title     18px → h2   19px → h3
```

56 total site-level codemod replacements across the metadata pass + 409 across the plain-value pass, plus 5 hand-classified numeral/header sites (§2) that a blind size-match would have mis-mapped (e.g. DocumentList's 22px stat number and QuizResult's 26px score number are the *same role* at drifted values — both now `text-h2` — but neither is a "heading" in the structural sense the codemod's heuristics assume).

## 6. Reading improvements

- `Markdown.jsx` PROSE: added `hr`, `table`/`thead`/`th`/`td` handlers (didn't exist before — GFM tables rendered unstyled). Dropped `italic` from `blockquote` (a decorative slant on a structural block was flagged by the Signature Contract as a generic-redesign tell; the left-rule already signals quotation).
- Line-height is no longer fought over per-component: 51 sites where an explicit `leading-[...]` diverged from — or blindly repeated — its own text-role's baked value now defer entirely to the token, including on `<li>`/`<span>` children one level below the sized ancestor (7 sites: `ChatArea.jsx`, `SummaryPane.jsx` ×3, `Markdown.jsx` ×2, `ReviewGuide.jsx`).
- StudyMap's four-depth node hierarchy (root/section/concept/example) now uses the exact px values of `title`/`body`/`small`/`caption` instead of an independent 15.5/14/13/12 scale nobody else in the app shares (SVG `fontSize` can't read CSS custom properties, so the values are copied literally with a comment pointing at their source).

## 7. Responsive verification

Verified via Playwright against the live dev server (not code-reading):

- Landing: desktop (1280), tablet (768), mobile (375) — light and dark. No clipped titles, no horizontal overflow; H1 wraps cleanly with `textWrap:balance` at all three widths.
- Login / Register: desktop (1280), mobile (375). "Tài khoản StudyMap" tab label wraps to two lines gracefully at mobile width, no overlap or clipping.

Not verified this pass (no authenticated session available in this environment — same constraint noted in the Sprint F v2 report): Main workspace, Sidebar, Inspector, MindMap, Summary, StudyMap (live), Document List (live), Dialogs, Chat — at Laptop/Tablet breakpoints specifically. These were spot-checked via static harnesses in Sprint F v2 at desktop/mobile only; Sprint G's own typography edits to those screens have not been re-screenshotted (see §10).

## 8. Playwright visual verification

Screenshots taken this pass: `landing_desktop_light/dark`, `landing_tablet_light`, `landing_mobile_light`, `login_desktop_light`, `login_mobile_light`, `register_desktop_light` (all in the session scratchpad, not committed).

One near-miss worth recording: a full-page screenshot of Landing's dark-serif headings ("đến", "Bốn", "nguồn") appeared, at reduced viewing scale, to have broken/detached Vietnamese diacritics. Before reporting it as a defect, re-shot a tight crop of the exact heading at full resolution and confirmed the rendering is correct — Spectral 600 is genuinely loaded (confirmed via `document.fonts` inspection) and renders the precomposed glyphs properly. This was a screenshot-compression artifact in my own review, not a product bug — recorded here as the same "measure, don't eyeball" discipline applied earlier in Sprint F v2.

## 9. Accessibility improvements

None targeted this sprint beyond what falls out of the type-scale consolidation itself (consistent, predictable line-heights reduce the chance of overlapping text at zoom). No contrast-ratio or focus-order work was in scope for Sprint G (that was Sprint F v2's remit); nothing here regresses it — no color values were touched.

## 10. Remaining typography debt

- **ChatArea.jsx's own separate markdown component map** still exists as a physically distinct definition from `Markdown.jsx`'s `PROSE`/`SM`, even though the codemod pass unified their pixel values onto the same named scale. Structurally unifying them into one shared component (not just matching sizes) was out of this sprint's diff budget and risks touching ChatArea's citation-chip/highlight logic, which is explicitly off-limits.
- **Score/stat numerals render in `font-display` (serif), not `font-mono`**, on Practice/QuizResult/DocumentList — the Signature Contract's "numbers always Plex Mono/tabular/bronze" rule is not applied there. Left alone deliberately: changing font-family and color on a working, already-legible score display is a visual-design decision beyond "remove magic typography values," and risks a regression nobody asked to review this sprint.
- **Full authenticated-screen visual QA is still missing** for Main workspace, Knowledge Inspector (live), Evidence Drawer (live), MindMap (live), Summary, StudyMap (live), Document List (live), Dialogs, Chat, and Dark mode on all of the above — no login credentials/backend session available in this environment. Sprint F v2's static-harness screenshots (MindMap, Inspector) predate this sprint's typography edits and were not re-shot.
- **§6 (Knowledge Inspector bucket hierarchy), §8 (Summary editorial rhythm beyond the existing drop-cap), §9 (Document List density/hover states), §10 (badge/button/tab/dialog/tooltip/popover micro-typography)** were not given a dedicated pass beyond what the codemods touched incidentally. The named scale now covers every site in these components, but a deliberate hierarchy-and-rhythm review (as opposed to "same role, same size") was not performed given the scope already covered.

## 11. Anything intentionally left unchanged

- **Two responsive two-step hero headlines** (`ChatArea.jsx:696`, `Landing.jsx:262`) use `text-[26px] sm:text-[30px|32px]` — a real, consistent idiom used in exactly these two places for "hero sub-headline that scales up on wide viewports." No named role currently has a responsive step; folding these into the fixed-size `h2` (24px) would flatten the intentional scale-up, and Sprint G's 13 named roles don't ask for a 14th. Left as-is, documented here per §13's own "must be intentional" instruction.
- **Two `text-[var(--err)]` instances** (`SidebarLeft.jsx:364`, `SidebarRight.jsx:56`) — this is Tailwind's arbitrary-value *color* syntax, not a font-size magic value; out of Sprint G's remit entirely, left untouched.
- **`blockquote`'s `border-brand/50` color** — Sprint G removed the blockquote's decorative `italic`, but its border color was left exactly as-is; recoloring it is a color decision, not a typography one.
- **No commit, no push** — per the sprint's explicit instruction. All changes are in the working tree only.

Build: `npm run build` clean (no errors, no new warnings). Tests: `npm test -- --run` — 72 files / 911 tests, all passing, unchanged from baseline. Lint: 73 pre-existing errors / 8 pre-existing warnings, none introduced by this sprint (verified by inspecting each flagged file — all are unused-var destructuring, `react-refresh/only-export-components`, empty-block, or config `no-undef` issues unrelated to any size/line-height class touched this sprint).
