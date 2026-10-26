# Round 3 QA closure — evidence

Captured during the Round 3 pre-merge QA closure pass (PR #92), against a
throwaway local harness, never committed — real production `MainLayout`,
real CSS/layout via the actual Vite dev server, mocked network/auth
boundary only (no backend was available this session).

## Screenshots

| File | What it shows |
|---|---|
| `1440px-baseline-light.jpg` | Desktop baseline, unchanged by this round |
| `820px-rail-collapsed-dark.jpg` | Tablet 56px rail, dark theme, real per-source buttons |
| `768px-dual-panel-stress-after-fix-light.jpg` | The exact stress case this closure pass fixed — both panels forced open at 768px. Measured center width: 407px (was 26px before the fix) |
| `390px-mobile-context-light.jpg` | Mobile header context chips (Sources/Evidence), 44×44px after the touch-target fix |
| `820px-rail-toggle-keyboard-focus-ring.png` | Zoomed crop proving the rail toggle's keyboard focus ring is now visible (was `outline: none` with no replacement before this closure pass) |

## Reproducible capture method

1. From `FE/`, create two throwaway files (never commit them):
   - `temp-round3-check.html` — a bare HTML shell loading `/src/tempRound3Check.jsx`.
   - `src/tempRound3Check.jsx` — renders `MainLayout` wrapped in `MemoryRouter`
     + a real `AuthContext.Provider` (fake user object, bypasses the real
     auth/network flow) + `StudyContextProvider`, with `window.fetch`
     intercepted for `/list-indexed`, `/mindmaps`, `/summaries`, `/auth/me`
     to return fixture JSON (a few fake sources) instead of hitting a real
     backend.
2. `npm run dev -- --port <N>` from `FE/`.
3. Open `http://localhost:<N>/temp-round3-check.html` in a real browser.
4. This machine's display caps at 1280×800, so true 1440px-wide viewports
   aren't physically renderable — inject a same-origin `<iframe>` sized to
   the exact target width/height (sets the iframe's own real layout
   viewport), with a CSS `transform: scale()` on its wrapper purely for
   on-screen visibility. Reload the iframe's `src` with a cache-busting
   query param (`?r=<timestamp>`) between viewport changes — same-origin
   same-URL `iframe.src` reassignment is a no-op in Chromium and will show
   stale state otherwise.
5. `localStorage.clear()` (shared origin with the iframe) before each fresh
   viewport load, so `usePanelLayout`'s default-collapsed logic evaluates
   against the real target width instead of a carried-over session.
6. Measure real geometry via `getBoundingClientRect()` /
   `getComputedStyle()` inside the iframe's own `contentWindow`/`document`
   — not the outer (scaled) page.
7. Delete both throwaway files before committing.
