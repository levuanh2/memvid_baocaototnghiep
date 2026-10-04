# MindMap toolbar and root-collapse QA — 2026-10-04

Branch: `fix/mindmap-toolbar-root-collapse-ux`

## Behavioral evidence

- Global workspace switch contains only Chat, Mind Map, and Summary mode
  actions. It no longer owns artifact counts, dropdowns, or create actions.
- The 48px MindMap contextual toolbar is the single owner of map identity,
  library selection, create, quality/save state, Export Studio, and grouped
  overflow actions. Summary uses the same 48px artifact-toolbar contract.
- Mind Elixir 5.13 root-only collapse renders exactly one `me-tpc` and zero
  `.lines/.subLines path` elements. Expanding restores the prior topic and
  connector counts, including branch-local collapse state.
- The Mind Elixir instance and `.map-canvas` transform are unchanged. The root
  topic's screen-space center is preserved to within one pixel.
- Export Studio opens, selected-branch scope remains clickable, ordinary node
  selection still updates controller state, and Map A → B → A leaves no stale
  DOM or thrown `findEle()` lookup.

## Automated gates

| Gate | Result |
|---|---|
| Focused Vitest | 7 files, 39 tests passed |
| Full FE Vitest | 136 files, 1325 tests passed |
| Production build | Passed; 2390 modules transformed |
| Changed-file ESLint | 0 errors; CSS excluded by project config |
| Lint ratchet | Passed: 56 problems vs baseline 67 |
| Fixture Playwright | 12/12 passed in Chromium |
| `git diff --check` | Passed |

The only tool warning was the existing stale `caniuse-lite` dataset notice.

## Responsive matrix

Each viewport was checked in light and dark themes for: one 48px row, no page
horizontal overflow, a menu fully inside the viewport, non-NaN connector paths,
and visible tree connectors before collapse.

- 1440×1024: light + dark
- 1024×768: light + dark
- 768×1024: light + dark
- 390×844: light + dark; overflow rendered as a compact bottom sheet

Screenshots are stored under
`docs/qa-screenshots/mindmap-toolbar-root-collapse/`, including a dedicated
`root-only-1440x1024-light.png` showing the single preserved root topic.
