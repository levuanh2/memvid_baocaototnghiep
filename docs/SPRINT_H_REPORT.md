# Sprint H — Interaction & Product Polish (Final UI Sprint)

Status: complete for everything verifiable without an authenticated backend session. Not committed, not pushed. No design token, typography scale, color palette, routing, state, or generation-logic file was touched — every change is CSS state-handling (`:hover`/`:focus-visible`/`:disabled`) or a small interaction-behavior fix (dropdown dismiss, motion duration) on top of the existing Paper & Graphite visual language.

## 1. Architecture impact

None. Four files touched, all presentation/interaction-layer: `FE/src/index.css`, `FE/src/components/mindmap/mindmap.css`, `FE/src/components/Layout/MainLayout.jsx`, `FE/src/components/Layout/SidebarLeft.jsx`. The one JS-level change (`SidebarLeft.jsx`) adds a `useEffect` for outside-click/Escape dismissal of an existing menu's existing `useState` — no new state shape, no prop changes, no new dependency, nothing touching upload/polling/source-fetch logic elsewhere in the same file.

## 2. Files changed

- **`index.css`** — added one shared `:focus-visible` rule and one shared `:disabled` rule covering `.btn-primary`, `.btn-seal`, `.btn-secondary`, `.btn-danger`, `.pill-tab`, `.pill-action`, `.icon-btn` (7 primitives, ~30 consuming components).
- **`mindmap.css`** — widened node hover feedback from "first branch level only" to all non-root depths; added a settle transition to mind-elixir's own `.selected` outline (previously instant snap).
- **`MainLayout.jsx`** — 3 mobile-drawer slide transitions, `duration-300` → `duration-200` (Sprint H's 150–220ms motion ceiling).
- **`SidebarLeft.jsx`** — the per-source "…" menu gained outside-click dismiss, Escape dismiss, `aria-haspopup`/`aria-expanded` on its toggle, `role="menu"`/`role="menuitem"`, and a subtle `animate-fadeIn` reveal.

## 3. Interaction improvements

- **Keyboard focus ring, app-wide, in one place.** `.btn-seal`, `.btn-secondary`, `.btn-danger`, `.pill-tab`, `.pill-action`, and `.icon-btn` had hover/active states but no focus-visible ring of their own — Tab landed on the browser's mismatched default outline (confirmed: a plain blue/UA ring against the paper palette). Now every consumer of these six classes gets a consistent `2px solid var(--accent)` ring with no per-component work, instead of the two call sites (`AvatarPicker`, `StudyCard`) that previously hand-rolled the same effect via inline `--tw-ring-color`.
- **Disabled state, app-wide, in one place.** 27 call sites across the codebase each picked their own disabled opacity (30/35/40/45/50/60/70%, no pattern) via per-instance Tailwind utilities. Files using these six primitives with no `disabled:opacity-*` utility of their own (19 files, confirmed by grep) rendered a disabled button fully opaque — indistinguishable from enabled. Added one baseline `:disabled` rule (`opacity: 0.5; cursor: not-allowed; pointer-events: none`) to the primitive classes themselves; any call site with its own explicit `disabled:opacity-*` utility still wins the cascade (Tailwind's utilities layer outranks `@layer components`), so nothing already-tuned changed.
- **MindMap hover feedback now reaches the whole graph, not just top-level branches.** The Sprint F hover rule was scoped to `me-main > me-wrapper > me-parent > me-tpc` — direct children of the root only. Every node nested deeper (concept/example depth, where most nodes in a real generated graph live) had zero hover feedback. Widened to a descendant selector so hover works at every depth.
- **MindMap selection ring now eases in.** mind-elixir's own `.selected{outline:2px solid var(--selected)}` (library CSS, not ours) had no transition — the ring snapped in instantly on click/search-jump. Added a 150ms ease-out override on `outline-color`, gated under `prefers-reduced-motion: no-preference`.
- **SidebarLeft's per-source "…" menu had no dismiss path** except clicking its own "Xóa" button or re-clicking the toggle — clicking anywhere else on the page, or pressing Escape, left it floating open indefinitely. Fixed with the same outside-click pattern already used elsewhere in the same file (`DoiTenTaiCho`'s rename box), containment-checked against a `.sidebar-source-menu` class so the mousedown-then-click sequence on the toggle button itself doesn't close-then-reopen in the same interaction.
- **Mobile drawer transitions tightened** from 300ms to 200ms (SidebarLeft/SidebarRight/Tutor-panel slide-in on mobile) to sit inside Sprint H's 150–220ms motion ceiling; still `ease-in-out`, no bounce.

## 4. Accessibility improvements

- `aria-haspopup="true"` / `aria-expanded` added to SidebarLeft's menu toggle; `role="menu"` / `role="menuitem"` added to the menu itself and its one action — previously neither state nor menu semantics were exposed to assistive tech.
- Six shared interactive primitives now have a real, intentional focus-visible ring instead of relying on (and being visually inconsistent with) the browser default — this is the single highest-leverage accessibility fix in this sprint, since it reaches roughly 30 consuming components at once.
- Disabled buttons using these primitives are no longer visually identical to enabled ones by default.

## 5. Performance impact

None measurable. No new renders introduced — the SidebarLeft fix adds one `useEffect` that only attaches listeners while its own menu is open (`if (menuOpen === null) return;` guard) and detaches them on close/unmount, mirroring the existing `DoiTenTaiCho` pattern in the same file. No new CSS is duplicated: the six-primitive focus/disabled rules are each declared once and shared, not copy-pasted per component (the opposite of the audit's own complaint about the disabled-opacity sprawl). Build output size is unchanged within rounding (`index-*.js` / `*.css` bundle sizes identical to pre-Sprint-H, confirmed via `npm run build`).

## 6. Playwright verification

Real browser checks against the live dev server (not code-reading):

- **Login, keyboard Tab to submit button (`.btn-seal`)**: confirmed via `getComputedStyle` that the new focus ring resolves to `outline: rgb(178,58,46) solid 2px` (exactly `--accent`), offset 2px, once settled. **One measurement pitfall caught and corrected in-session**: the button's own `transition-all` unintentionally animates the outline too, so a screenshot/computed-style read taken within ~100–200ms of the Tab keypress shows a mid-transition intermediate color, not the final one — an early read looked like the rule wasn't applying at all. Confirmed by reading `document.styleSheets` directly (the rule was present and matched all along) and by re-reading `getComputedStyle` after a full settle window. Recorded here per the same "measure, don't eyeball, and don't stop at the first measurement either" discipline established in Sprint F v2 and Sprint G.
- **Landing, keyboard Tab to the "Đăng nhập" link (`.btn-secondary`)**: screenshot confirms a clear, legible ring against the paper background.
- Full `npm run build` / `npm run lint` / `npm test -- --run` after every batch of changes: build clean, 911/911 tests passing throughout, lint unchanged from baseline (73 pre-existing errors / 8 warnings, none newly introduced — verified by re-running lint after Sprint H's edits and confirming the exact same count as pre-sprint).

Not screenshot-verified this pass (no authenticated session available in this environment — same constraint as Sprints F/G): the widened MindMap hover and the `.selected` transition were verified by reading the generated CSS and confirming selector/specificity correctness, not by live-clicking a real generated graph (Sprint F v2's static IIFE-bundle harness could be re-run for this specifically if a dedicated follow-up pass is wanted). The SidebarLeft menu fix was verified by code-reading the event-listener lifecycle and confirming the same shape as the file's own already-working `DoiTenTaiCho` pattern, not by live-clicking (SidebarLeft's data comes from `/list-indexed`, which needs a real backend).

## 7. Remaining UX debt

- **The 3x-duplicated popover pattern** the Implementation Plan's Task 9b named (DocumentList/StudyCard/BulkBar filter menus, `shadow-lg` + literal styling triplicated) was searched for this sprint and **not found in its originally-described shape** — the phantom `var(--border)` bug it was filed alongside was fixed back in Wave 0, and the specific "filter popover" markup described no longer matches the current DocumentList.jsx (its closest surviving relative, `chonBoSuuTap`, is a persistent filter-chip selection, not a transient dismissable overlay). Recommend re-auditing this specific claim fresh rather than trusting the old audit line — it may already be resolved, or may have moved to a different component under a different name.
- **CommandPalette's active-row highlight is still a hand-rolled inline style** (`color-mix(in srgb, var(--accent) 10%, transparent)`) that exactly duplicates `.pill-tab-active`'s own recipe instead of sharing a class (Task 16, still open). Zero visual difference either way — pure code-organization debt, left alone this sprint since it changes no pixel and the Implementation Plan already scored it Low impact.
- **Disabled-opacity call sites that already had their own explicit value** (27 of them, 30–70% range) were deliberately left as-is (see §8) — the new baseline only fills gaps, it doesn't unify the existing spread. A real unification pass would need per-site visual judgment, not a blanket value change.
- **Scroll/sticky-footer/clipped-shadow audit (§8 of the sprint brief) was not exhaustively walked screen-by-screen** — Knowledge Inspector's sticky header/footer grid was already verified structurally sound in the original UI audit (`UI_AUDIT_V2.md` §14, "real, deliberate sticky-metadata architecture"); Evidence Drawer, long-document Markdown scroll, and Dialog body scroll were not independently re-tested this sprint for jump/clip regressions.
- **Tablet/Laptop breakpoint interaction testing (§9)** was not performed — only desktop (1280) and the existing mobile (375) verification from Sprint G carries forward; no new tablet-width interaction pass was run this sprint.

## 8. Anything intentionally not changed

- **`.seal-meter__ink`'s 400ms fill transition** — reviewed and kept. It's the mastery-meter "ink filling a stamp" signature motif (Signature Contract §7), a value-over-time fill rather than a hover/press micro-interaction; Sprint H's 150–220ms ceiling targets the latter, not a deliberately slower narrative animation.
- **`.transition-theme`'s 200–250ms values** (light/dark swap, 21 sites) — reviewed and kept. This is a whole-page color-scheme crossfade, not a micro-interaction; tightening it to 220ms would make a full-app theme flip feel more abrupt, the opposite of what the crossfade exists to prevent.
- **Disabled-opacity values that already had an explicit per-instance choice** — not touched (see §7). Only the gap (primitives with no disabled treatment at all) was filled.
- **`Markdown.jsx`'s `blockquote` border color, StudyMap's connector stroke, any color/token value anywhere** — out of scope per the sprint's own "DO NOT TOUCH: Design Tokens / Typography Scale / Color Palette" rule; nothing here was recolored, only state-behavior (hover/focus/disabled/dismiss/timing) was touched.
- **No commit, no push** — per the sprint's explicit instruction.

## 9. Screens still requiring human QA

No authenticated backend session is available in this environment (confirmed unchanged from Sprints F/G — `demoMode.js` requires real indexed documents, no synthetic offline path exists). The following need a real login session for genuine interaction QA, not just code review:

- **Main workspace** (SidebarLeft real data, SidebarRight, WorkspaceTabs) — the SidebarLeft menu-dismiss fix specifically needs a live click-through with real source cards.
- **Knowledge Inspector / Evidence Drawer** — section expand/collapse, evidence reveal, copy-interaction feedback, pinned state, sticky behavior under real scroll content.
- **MindMap (live graph)** — the widened hover and eased selection ring need a real generated graph at real depth/density to confirm the "dense graph readability" improvement actually reads as intended, not just that the CSS selectors are structurally correct.
- **Summary, StudyMap (live), Document List (live), Dialogs, Command Palette** — keyboard nav, scroll, loading/empty/error states under real data.
- **Dark mode and mobile/tablet width** for all of the above.

## 10. Readiness score: 6/10

**Not production-ready as a blanket claim, and here's exactly why**, not just a number:

- The visual/typography/token system (Sprints F, G) and this sprint's shared-primitive interaction fixes (focus ring, disabled state, dropdown dismiss, motion timing) are genuinely solid and verified where verification was possible — desktop, no-auth screens are close to done.
- **The single largest gap is verification coverage, not code quality.** Every authenticated screen — which is most of the actual product (workspace, Inspector, MindMap, StudyMap, Document List, dialogs) — has had zero live interaction testing across this entire three-sprint arc (F/G/H), because no backend session has been available in any of these sessions. Code-level review and static-harness screenshots (Sprint F v2) are not a substitute for clicking through a real, populated workspace.
- A handful of specific claims from the original `UI_AUDIT_V2.md` (the popover triplication, the exact shape of DocumentList's filter UI) no longer match the current codebase — the audit itself needs a refresh pass before it can be trusted as a source of remaining work, not just executed against blindly.
- **What would move this to 9–10**: one real QA pass, logged in, with actual documents indexed, walking every screen in §9 above in both themes at three widths, fixing whatever that pass finds. That is fundamentally a different kind of work than what any of these three sprints could do in this environment, and it's the one thing standing between "the code is ready" and "the product is ready."
