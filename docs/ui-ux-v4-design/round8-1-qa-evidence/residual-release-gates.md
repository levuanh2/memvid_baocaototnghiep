# Residual release gates

Round 8.1 closes code defects R8-001 … R8-007. It does not by itself approve a
production release. These gates remain open and are not inferred from unit,
fixture or CI results.

| Gate | Status | Why | Next action |
|---|---|---|---|
| Real API-backed ten-question Quiz journey | NOT VERIFIED | Save/submit ordering is proven with deterministic deferred-promise tests, not a seeded Flask + PostgreSQL run | Round 8.2 with a disposable database seed |
| Actual PDF generated through frontend + backend | NOT VERIFIED | Serializer/API tests do not produce a downloaded end-to-end file | Run the repository PDF Playwright spec against disposable PostgreSQL and inspect the file |
| Critical real-backend Playwright (`FE/playwright.config.js`) locally | BLOCKED | No reachable PostgreSQL and missing generated `BE/shared/proto/gen` (built by `scripts/build_proto.py` in CI); Flask `/health` never answered within ~45 s | Covered by GitHub CI on the PR head; locally needs disposable Postgres + proto generation |
| NVDA / Narrator / VoiceOver announcement sequence | NOT VERIFIED | DOM semantics cannot prove spoken order | Manual assistive-technology pass |
| Dialog acknowledgement contrast and Escape focus restoration | NOT VERIFIED | Gap carried from Round 8; not touched by this correction set | Targeted Round 8.2 browser/AT check |
| 12 pre-existing fixture failures (`branch-export-visual` 390px ×2, `exact-node-export-v3` ×1, `mindmap-depth-presets` ×7, `post-pr77-exact-selection` ×2) | OPEN, pre-existing | Identical 23 pass / 12 fail on `origin/main` `16fcc84` and on this branch; outside R8-001 … R8-007 | Triage as new findings in Round 8.2 |
| Compact Account trigger 44×44 target | OPEN P2 (accepted residual) | Measured 40×40 effective hit area at 320/375/390/768/1024 (`agy/account-target-ab6e90c.json`); see `p2-disposition.md` | Decide in Round 8.2 whether to adopt a vertical-only 44px hit extension |

The production Library flag (`VITE_LIBRARY_ACTION_MATRIX`) stays OFF. Nothing
in this round merges, deploys or changes production flags.
