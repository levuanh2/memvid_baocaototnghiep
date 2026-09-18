# StudyMap Workspace V3 — implementation candidate

## Approved mock fidelity pass (2026-09-19)

Official references opened full-resolution, read-only:

| Role | File | Resolution | SHA-256 |
|---|---|---:|---|
| Desktop mock | `docs/e00640ad-e749-4706-8671-9d869f6f4616.png` | 1487x1058 | `541EF6C5207D85F0D87AB394CC244A742CCD6D3C8EF50C336ACCCAB65421564F` |
| Mobile mock | `docs/7ff064b6-a4f3-4125-9a0b-ccb59060fe82.png` | 853x1844 | `7B5DB069DBB2B94C2387A0451E6DD8DE1DEC141DB3B7B19356E792D3F8C708D1` |

The `(1)` mobile file was byte-identical and excluded as a duplicate. Older blocker captures were not used as source of truth.

### Measured visual decisions

| Semantic role | Mock flat-region color | Current token / renderer value | Decision |
|---|---|---|---|
| App/canvas background | `#F4F8FC` | `--bg-base: #F4F8FC` | aligned |
| Header/sidebar surface | `#FEFEFE` | `--bg-sidebar: #FEFEFE` | aligned |
| Card/popover surface | `#FFFFFF` | `--bg-card: #FFFFFF` | preserved |
| Elevated/hover surface | `#F1F6FB` / `#EAF3FF` | `--bg-elevated`, `--bg-hover` | aligned |
| Primary/active | `#006BFE` | `--accent: #006BFE` | corrected |
| Main text | approximately `#102A5D` | `--text-primary: #102A5D` | aligned |
| Secondary/muted text | cool slate blue | `--text-secondary: #5B7096`, `--text-muted: #8294B1` | aligned |
| Dividers | cool blue-gray | `rgba(29,67,117,.14/.24)` | aligned |
| Ready/success | approximately `#16B36A` | `--ok: #16B36A` | separate from primary |
| Warning | warm amber | `--warn: #F39A1B` | separate from primary |
| Citation/provenance | red | `--seal/--err: #F1333A` | provenance-only |
| Mind Map branches | blue/orange/green/purple/red/cyan | vivid `BRANCH_COLORS`/`PALETTE` | corrected |

Only `FE/src/index.css`, `FE/src/utils/mindmapLayout.js`, the existing palette in `FE/src/components/mindmap/MindElixirView.jsx`, and its branch-color contract assertion changed for this pass. No layout, lifecycle, API, or business logic changed.

### Comparison evidence

Brave rendered the local candidate at the requested sizes with QA-only GET fixtures. This is visual evidence only, not a real account/document/map. The run recorded zero console errors and zero failed requests.

![Desktop comparison](qa-screenshots/studymap-workspace-v3/comparison-desktop-light.png)

![Mobile comparison](qa-screenshots/studymap-workspace-v3/comparison-mobile-light.png)

Additional captures cover neutral, library, StudyMap tools, and source-filter states at 1440x1024 and 1024x768, plus light/dark neutral mobile captures. The fixture map list rendered, but selected-map canvas/drawer behavior was not used as acceptance evidence because the fixture did not reproduce the full authenticated map-selection runtime state.

`COLOR ALIGNMENT: PASS` for the inspected surfaces, active state, text hierarchy, borders, status colors, and branch palette.

`LIVE GATE B: BLOCKED BY CORS` — no production deployment, account, real document, or real map was used or claimed.

## Status

`Implementation exists; automated verification passed; visual QA blocked by local-origin CORS and unavailable authenticated workspace data.`

This work was performed in an isolated worktree from `177c717` on
`feature/studymap-workspace-v3`. The original dirty worktree and all backend
files were left untouched. No production deployment or Gate B verification was
performed.

## Implemented ownership changes

- `MainLayout.jsx` now owns the single mode switch and the StudyMap tools entry.
- `ModeLibraryMenu.jsx` is the shared real-item library surface for Mind Maps and
  Summaries; it receives the existing saved-item arrays and generation callbacks.
- `StudyToolsMenu.jsx` exposes exactly Tutor, Timeline, and Knowledge, reusing the
  existing right-panel views.
- Mind Map mode hides the permanent right Inspector and opens the existing
  contextual surface as an overlay without changing canvas width.
- `SidebarLeft.jsx` owns source search and a composed type/status/date filter
  popover. Existing selection and upload behavior remains in the same component.
- `SidebarRight.jsx` no longer renders the old four-tab header or bottom artifact
  creator; its library callbacks expose the existing saved-map/summary state to
  the global libraries.
- `index.css` adds responsive styles for the libraries, StudyMap menu, filter
  popover, tool overlay, and contextual surface. Existing Mind Elixir drawer
  lifecycle and transform behavior were not changed.

## Changed-file allowlist

```text
FE/src/components/Layout/MainLayout.jsx
FE/src/components/Layout/ModeLibraryMenu.jsx
FE/src/components/Layout/ModeLibraryMenu.test.jsx
FE/src/components/Layout/SidebarLeft.jsx
FE/src/components/Layout/SidebarRight.jsx
FE/src/components/Layout/SidebarRight.loopFix.test.jsx
FE/src/components/Layout/StudyToolsMenu.jsx
FE/src/components/Layout/StudyToolsMenu.test.jsx
FE/src/index.css
```

No backend files, API contracts, Mind Elixir data, or Mind Map generation code
were changed. The clean base does not contain `cbeb475` as an ancestor.

## Automated verification

Commands run from `FE/`:

| Command | Result |
|---|---|
| `npx vitest run src/components/Layout/ModeLibraryMenu.test.jsx src/components/Layout/StudyToolsMenu.test.jsx src/components/Layout/MainLayout.modeTabs.test.jsx src/components/Layout/SidebarLeft.checkbox.test.jsx` | 7/7 pass |
| `npm test -- --run` | 1076/1076 pass, 95 files |
| `npm run build` | pass, Vite 7.2.1; 2371 modules transformed |
| targeted `npx eslint` on changed layout files | 0 errors; one pre-existing SidebarLeft hook warning |
| `git diff --check` | exit 0; only LF/CRLF conversion notices |

The repository lint baseline remains the existing repository debt; no new error
was introduced by this pass. The icon-registry test and the SidebarRight loop
regression were both rerun after the final corrections.

## Visual QA / browser evidence

Brave was found and launched through the installed Python Playwright package at
`C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`; no browser
dependency was added to package metadata. The candidate ran locally at
`http://127.0.0.1:5173/` with the temporary, non-persisted override
`VITE_API_URL=https://api.studymap.space`.

The real registration attempt used the disposable account
`qa-mindmap-v3-20260919@example.com` and failed before account creation because
the production API correctly rejected the local origin during the registration
preflight:

```text
Access to fetch at https://api.studymap.space/auth/register from origin
http://127.0.0.1:5173 has been blocked by CORS policy: Response to preflight
request doesn't pass access control check: No Access-Control-Allow-Origin header.
```

Therefore no account, document, map, or authenticated workspace state was
created by this attempt. This is a genuine environment/deployment boundary, not
a reason to bypass CORS or call the login screen a Mind Map acceptance pass.

The following screenshots are attached directly as blocker evidence. They show
the candidate's real login surface at the requested dimensions, not fabricated
workspace states:

![Local candidate login at 1440 light](qa-screenshots/studymap-workspace-v3/login-1440-light.png)
![Local candidate login at 1440 dark](qa-screenshots/studymap-workspace-v3/login-1440-dark.png)
![Local candidate login at 1024 light](qa-screenshots/studymap-workspace-v3/login-1024-light.png)
![Local candidate login at 390 light](qa-screenshots/studymap-workspace-v3/login-390-light.png)

These are explicitly **not** evidence for the required library, drawer, map
selector, viewport, or real-data checks. Those checks require either a preview
origin included by the production CORS allowlist or deployment of this candidate
to an authorized preview; neither is available under the no-deploy constraint.

The exact local command was:

```text
npm run dev -- --host 127.0.0.1
```

Required follow-up evidence is a real authenticated workspace with at least two
saved maps: light/dark screenshots for closed state, library, StudyMap tools,
source filters, node drawer/sheet, console errors, failed requests, and viewport
transform checks while switching maps and opening/closing transient surfaces.

## Remaining limitations

- This candidate has not been deployed; it must not be used as production
  acceptance evidence.
- Browser tooling itself is available, but authenticated workspace visual QA and
  real-data interaction verification remain outstanding because local-origin
  access to the production API is blocked by CORS.
- The existing Mind Elixir V2 renderer and its documented map-switch/fit
  invariants were intentionally preserved rather than reimplemented.

Final status: **BLOCKED — implementation candidate is pushed, but Gate B cannot
run without an authorized preview/production origin or a CORS policy change.**
