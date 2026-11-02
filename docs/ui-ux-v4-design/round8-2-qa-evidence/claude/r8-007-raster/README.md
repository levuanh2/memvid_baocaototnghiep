# R8-007 raster fixture: root cause of the Round 8.2 failure

Owner: Claude, 2026-11-01 17:05–17:15Z.

| Item | Value |
|---|---|
| Tree | `c02e2b9` |
| Harness | `FE/playwright.fixture.config.js` (Vite dev server, mocked data, no backend) |
| Spec | `FE/e2e-fixture/multi-branch-export-raster-connectors.spec.js` |
| Who saw it first | Codex2: 0/1 in `codex2/regression.md` |

## Observation

| Run | Result |
|---|---|
| Original spec, fresh server on `:5302` | FAIL |
| Original spec, Round 8.1 worktree, fresh server on `:5305` | FAIL |
| Original spec, ×3 on a warm server on `:5304` | 2 PASS, 1 FAIL |
| Instrumented copy, ×6 on `:5304` | 4 PASS, 2 FAIL |

Instrumented-run log: `instrumented-runs.txt`.

Every failure raises
`TypeError: Cannot read properties of undefined (reading 'SIDE')`. It happens
inside the test helper `capture()` (spec lines 58–62), before any product
assertion runs.

## Root cause (test-only)

The helper picks the Mind Elixir module like this:

```js
performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("mind-elixir"))
```

Two resources match:

- `/node_modules/.vite/deps/mind-elixir.js?v=…`, the JS module.
- `/node_modules/mind-elixir/dist/MindElixir.css`, the stylesheet.

The helper takes whichever resource-timing entry comes first. Both files start
loading in parallel, so their order varies:

- In both failing instrumented runs, the CSS was first. `import()` of the CSS
  URL returns a module with no exports (`[]`), so `MindElixir` is undefined.
- In every passing run, the JS module was first, with exports
  `DARK_THEME, LEFT, RIGHT, SIDE, THEME, default`.

The helper was introduced by `6b4e8e2` (Round 8.1, R8-007). Round 8.1
recorded 1/1 because that run happened to pick the JS module first.

## Classification

- **NONDETERMINISTIC_TEST.** The flake rate was about 1 in 3 on this machine.
- **Product: no regression.** Whenever the helper resolves the JS module, the
  spec passes all of its product assertions: DOM geometry, connectors and
  raster ink, through suppress and restore. That happened in 6 of 9 runs.
- **R8-007 is only partly closed.** The `MindElixir.SIDE` crash is fixed when
  the module resolves; the helper's resource lookup is still flaky.
- New test defect **R82-T01**, P3. Owner: FE MindMap QA.
- Minimal fix, not applied in this audit: match only the JS module, for
  example `name.includes("/.vite/deps/mind-elixir.js")`, or
  `/mind-elixir[^/]*\.m?js(\?|$)/`.
