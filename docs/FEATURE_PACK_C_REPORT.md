# Feature Pack C — Keyboard-first Research Workspace

Real implementation, continues from Feature Pack B on the same branch. No visual redesign, no rewrite of existing working code — every new shortcut is additive, and every existing shortcut (Ctrl+K, Ctrl+/, Escape, "/", mindmap +/-/0/F) is left exactly as it was.

---

## Architecture impact

None structural. One new pure module (`utils/keyboardShortcuts.js`) holds the shortcut registry and two pure decision functions, following the SAME convention already established by `paletteKeyboard.js` / `mindmapViewport.js` / `chatFocus.js` in this codebase: no DOM, no React, event facts in, an intent string out, unit-testable under Vitest's default `node` environment. One tiny event bus (`utils/shortcutsBus.js`) mirrors the existing `commandPaletteBus.js` pattern exactly, for the one case that genuinely needs it (CommandPalette is mounted as a sibling of `<Routes>` in `App.jsx`, outside `MainLayout`'s tree — see Remaining limitations). Everything else is new `useEffect` blocks inside `MainLayout.jsx`, which already owns every other global shortcut (Ctrl+/, the Timeline-overlay Escape, the right-drawer Escape) — the natural, existing owner, not a new state layer.

---

## Files changed

| File | Change |
|---|---|
| `FE/src/utils/keyboardShortcuts.js` (new) | `SHORTCUT_REGISTRY` (single source of truth, existing shortcuts documented alongside new ones so nothing can be double-bound) + two pure functions: `globalShortcutAction` (Alt+C/M/S/T, Alt+[, Alt+], "?") and `mindmapRelationAction` (bare c/u/d/[/]). |
| `FE/src/utils/keyboardShortcuts.test.js` (new) | 11 tests: registry shape/uniqueness, every new binding, the typing-guard, the Alt+Ctrl refusal, that `mindmapRelationAction` never fires with a modifier held or while a button/link holds focus. |
| `FE/src/utils/shortcutsBus.js` (new) | `OPEN_SHORTCUTS_EVENT` + `openShortcutsOverlay()` — same shape as `commandPaletteBus.js`. |
| `FE/src/components/shortcuts/ShortcutsOverlay.jsx` (new) | Renders `SHORTCUT_REGISTRY` grouped by category inside the existing `ui/Modal.jsx` (Escape/backdrop/focus-trap/portal all reused, zero new dialog chrome). |
| `FE/src/components/ui/Icon.jsx` | Additive: registered lucide's `Keyboard` icon (same pattern as Pack B's `Clock` addition). |
| `FE/src/components/Layout/MainLayout.jsx` | New: `shortcutsOpen` state + listener for `OPEN_SHORTCUTS_EVENT`; a global-shortcut `useEffect` dispatching `globalShortcutAction`; a MindMap-relation `useEffect` (scoped to `workspaceMode === "mindmap"`) dispatching `mindmapRelationAction`; renders `<ShortcutsOverlay>`; a small header icon-button opens it too; keyboard hints added to the existing StudyMap link and Timeline button titles. |
| `FE/src/components/palette/CommandPalette.jsx` | New "Phím tắt" command (opens the same overlay via the bus). New search group "Dòng thời gian" reading `StudyContext`'s existing `history` log, filtered the same way `ResearchTimeline.jsx` already filters it. |

7 files: 3 modified, 4 new (all FE). No BE file touched.

---

## Shortcut map

**Global** (respects focused inputs everywhere — never fires while typing in an input/textarea/contentEditable):

| Keys | Action | Owner |
|---|---|---|
| Ctrl/Cmd+K | Command Palette | pre-existing |
| Ctrl/Cmd+/ | Gia sư AI | pre-existing |
| `/` | Focus chat composer | pre-existing |
| Esc | Close active overlay | pre-existing |
| **?** | **Open Shortcuts overlay** | **new** |
| **Alt+C** | **Switch to Chat** | **new** |
| **Alt+M** | **Switch to MindMap** (no-op if no mindmap generated yet — mirrors `WorkspaceTabs.jsx`'s own disabled-tab gate exactly) | **new** |
| **Alt+S** | **Go to StudyMap** (same destination as the existing header "StudyMap" link) | **new** |
| **Alt+T** | **Open Research Timeline** | **new** |
| **Alt+[** | **Research history — back** | **new** |
| **Alt+]** | **Research history — forward** | **new** |

**MindMap tab only**, and only while the mind-elixir canvas itself does NOT have focus (see Accessibility notes for why):

| Keys | Action |
|---|---|
| **C** | Center the selected node |
| **U** | Jump to parent |
| **D** | Jump to first child |
| **[** | Previous sibling |
| **]** | Next sibling |

**Already existing, unchanged, listed in the overlay for discoverability only:** `+`/`-`/`0`/`F` (MindMap & StudyMap zoom), `↑`/`↓`/`Tab`/`Enter` (Command Palette result navigation).

Every shortcut answers the epic's three questions in one line each: **Alt+M/S/C/T** — anyone mid-research who wants the other pane without reaching for the mouse; replaces a click + waits for hover; the whole "which tab am I on" decision becomes one keystroke. **Alt+[/]** — anyone who jumped to a citation or a node and wants back; replaces re-finding it in the Timeline panel by hand. **c/u/d/[/]** — anyone reading a MindMap branch-by-branch; replaces four separate mouse clicks on Inspector pills per hop. **?** — anyone who forgot a binding; replaces guessing or reading source.

---

## Accessibility notes

- **Respects focused inputs**: `globalShortcutAction` refuses to fire while `document.activeElement` is an `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable` element — same guard shape as the pre-existing `chatFocus.js::shouldFocusOnSlash`. `mindmapRelationAction` (bare letters, no modifier) uses a STRICTER guard — the existing `isInteractiveTarget` from `chatFocus.js`, reused rather than duplicated — which also refuses while a `button`/`a`/`[role="button"]`/label/etc. holds keyboard focus, not just form fields: a Related-concept pill in the Knowledge Inspector focused via Tab must not have its own `d`/`u` stolen by a node jump underneath it.
- **Never steals typing**: same guards as above; additionally, `mindmapRelationAction` is only ever dispatched by `MainLayout.jsx` when `document.activeElement` is NOT inside `.me-container` (the mind-elixir canvas). That canvas is mounted with `editable: true` (`MindElixirView.jsx`) and binds its OWN Arrow/Enter/Tab/Delete/Backspace keymap directly on the container (verified by reading `node_modules/mind-elixir/dist/MindElixir.js`'s keymap table) — a second handler claiming any of those same keys would double-dispatch or collide with real node-editing shortcuts already live today. The five keys chosen (`c`/`u`/`d`/`[`/`]`) were checked against that table and are not claimed by it.
- **Shortcuts don't leak through an open modal**: both new `MainLayout.jsx` effects refuse to dispatch while any `[aria-modal="true"]` element is present (`document.querySelector`) — the exact same selector MainLayout's own pre-existing right-drawer Escape effect already guards with, reused rather than a new convention. This covers ShortcutsOverlay itself, Command Palette, and the Summary modal alike: Alt+M can't switch tabs underneath an open dialog. The one exception is `"?"` itself, which may still toggle ShortcutsOverlay closed while it's the modal that's open — the same self-toggle exception `CommandPalette.jsx`'s own Ctrl+K already has for its own modal.
- **Discoverable**: one registry (`SHORTCUT_REGISTRY`) feeds both the dispatch logic and the `?`/Command-Palette-reachable `ShortcutsOverlay`, so the two can't drift apart. Existing shortcuts are listed in the overlay too (marked without a "Mới" badge), so it doubles as a complete reference, not just a changelog of this pack.
- **One owner per key**: `Alt+Left`/`Alt+Right` were deliberately NOT used for history back/forward — that combination is the browser's own reserved back/forward gesture in Chrome and Firefox on Windows and is not reliably interceptable from page JavaScript (this is exactly the "conflicts with browser shortcuts" case the epic's IMPORTANT section calls out). `Alt+[` / `Alt+]` carry the same meaning without the collision.
- The overlay itself needs no new accessibility work: it's `ui/Modal.jsx`, which already provides `role="dialog"`, `aria-modal`, backdrop-click-to-close, Escape-to-close, a Tab focus trap, and open/close focus management.

---

## Reused components / infrastructure

- `mindMapController`'s existing `goBack`/`goForward`/`jumpTo`/`relations`/`selected` (all pre-existing, from `useMindMapController.js`) — every new MindMap keyboard action is a direct call to one of these; none are new capabilities on the controller.
- `WorkspaceTabs.jsx`'s existing `hasMindmap` gate — Alt+M checks the exact same `mindmapData?.data` truthiness the tab's own `disabled` state already checks, so a keyboard shortcut for an empty tab behaves identically to clicking a disabled tab (a no-op, not a broken jump).
- The existing header "StudyMap" `<Link to="/app/study">` — Alt+S calls `navigate("/app/study")`, the same destination, no new route.
- `openTimeline` (Feature Pack B) — Alt+T calls it directly, unchanged.
- `StudyContext`'s existing `history` log (Feature Pack A) — CommandPalette's new "Dòng thời gian" search group reads it directly; no second data source.
- `commandPaletteBus.js`'s exact pattern, mirrored as `shortcutsBus.js`, for the one cross-tree case that needs it.
- `ui/Modal.jsx` — wholesale, for `ShortcutsOverlay`.

---

## Build

```
npm run build   ->  clean (2362 modules, no errors)
```

## Tests

```
npm run test    ->  942/942 (was 931 before this pass — 11 new,
                     all in utils/keyboardShortcuts.test.js)
```

## Lint

```
npx eslint src  ->  66 problems (58 errors, 8 warnings) —
                     unchanged from the confirmed baseline, zero new
                     issues across any touched or new file
```

Pre-commit hygiene (same checks as Pack A/B): `git diff --check` clean (CRLF notices only), terminal-contamination grep zero hits, `git status --short` matches exactly the 7 intended FE files, zero BE files touched.

---

## Remaining limitations — documented, not invented around

- **Command Palette cannot search MindMap nodes or StudyMap concepts.** `CommandPalette.jsx` is mounted once in `App.jsx`, as a sibling of `<Routes>` — outside `MainLayout`'s tree entirely (confirmed by reading `App.jsx`: the palette has no `Workspace`/`MainLayout` ancestor). The full node graph for a MindMap (and its `relations`/`chunkRefs`) only exists inside `useMindMapController`'s local hook state, created once per `Workspace` mount; StudyMap's node list is similarly local to `StudyMapView.jsx`, fetched per `documentId` route param. Neither is reachable from the palette without either (a) lifting that graph state into the global `StudyContext` — which would duplicate state Feature Pack A/B deliberately kept singular, the exact anti-pattern this epic's own "never duplicate state" instruction rules out — or (b) a new per-keystroke fetch pattern outside the existing job-polling generation architecture (`mindmapJob.js`), which is a real, separate feature, not a keyboard-shortcut change. Implemented instead: search over `StudyContext`'s existing `history` (Timeline/recent-activity — genuinely reachable, zero new state) and existing pinned-document search (`doc.pinned`, already wired and already visible with a pin badge in results) — this satisfies "Recent sessions" and "Pinned items" with real, already-existing data instead of a fabricated second list.
- **Command Palette's Timeline entries re-run the search, they don't jump.** For the same reason as above — no reachable `mindMapController`/`onJump*` callbacks from the palette's mount point — clicking a Timeline search result sets the palette's own query to that entry's label (the same honest action `lich_su_tim` already performs for search history) rather than faking a navigation it structurally cannot perform. A real jump for `node`/`question`/`evidence` entries is still available from the Research Timeline panel itself (Feature Pack A/B, unchanged) whenever the Workspace is open.
- **MindMap relation shortcuts (c/u/d/[/]) require workspace focus to be outside the canvas.** This is a deliberate accessibility/collision choice (see Accessibility notes), not a gap: the canvas's own native keyboard navigation (arrow keys, when `editable: true`) already exists and is untouched; these five keys are the *second*, Inspector-oriented way to move through the same tree, active whenever the MindMap tab is open and the user isn't actively editing a node's text inside the canvas itself.
