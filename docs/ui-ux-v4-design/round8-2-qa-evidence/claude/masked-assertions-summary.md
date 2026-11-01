# Assertions masked by stale fixture steps

Summary written by Claude from Codex2's raw output. Codex2 hit its usage limit
before writing its own report.

Codex2's files are in `../codex2/masked-assertions/`:

- `masked-assertions-repeat3.raw.json`
- `migrated/`: the six specs, each with only its stale step changed
- `migrated-vs-originals.diff`

| Item | Value |
|---|---|
| Tree | `c02e2b9` |
| Environment | Fixture harness (Vite dev server on `:5301`, mocked data, Chromium) |
| Run | `--repeat-each=3`, finished 2026-11-01 17:16Z |

## Why

In four triaged failures (tests #3, #10, #11 and #12 in
`codex2/fixture-failures-triage.md`), a stale step fails first. Two causes:

- navigation that clicks the wizard's "Quay lại" button;
- the old combined summary text.

Because the stale step fails, the export-membership and identity assertions
after it never ran. Tests #1 and #2 depend on clicking at coordinates that the
auto-context change in PR #84 made ambiguous.

## Diff scope

`migrated-vs-originals.diff` has 4 hunks.

- Three hunks change navigation or selection steps only:
  - **#3:** click the "Nội dung" rail section instead of "Quay lại".
  - **#10:** click the rail sections, then the same `full` radio.
  - **#1 and #2:** press Space on two stable leaf IDs instead of clicking at coordinates.
- One hunk replaces one stale assertion with two current ones. Old:
  `"2 node đã tick · 3 node thực tế"`. New:
  - footer `"2 node đã chọn · 1 node cha tự thêm · 3 node được xuất"`
  - preview `"3 node"`

No other `expect` line was removed or changed. Every downstream assertion is
unchanged.

## Result

18 executions: 18 passed, 0 failed, 0 flaky.

| Test | Downstream assertions now exercised | 3× |
|---|---|---|
| `branch-export-visual` 390×844 light | Two ticks, geometry, pan, screenshot | PASS ×3 |
| `branch-export-visual` 390×844 dark | Same as light | PASS ×3 |
| `exact-node-export-v3` manual suppression | Suppression survives navigation, selection changes and the map session | PASS ×3 |
| `mindmap-depth-presets` depth ≤ 2, then full scope | depth ≤ 2 gives 6 nodes; **full scope gives exactly 8 nodes** | PASS ×3 |
| `post-pr77-exact-selection` six pairs at 69% | **Downloaded-SVG membership exact for all six pairs**, across mouse, Space, presets, reopen and cache reload | PASS ×3 |
| `post-pr77-exact-selection` offscreen identity | Offscreen `nodeObj.id` / `data-node-id` identity complete | PASS ×3 |

## Conclusion

The six STALE_TEST_CONTRACT classifications hold. With the stale step
updated, every masked assertion about export membership, depth scope,
suppression and identity passes, deterministically.

The fixture failures hide no export-integrity defect. The only real product
finding is the P3 root-anchor drift of 1.29–1.72 px (6 identities).

Follow-up: land the same migration in the repository tests, as a test-only PR.
