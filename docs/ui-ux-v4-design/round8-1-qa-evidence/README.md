# Phase C Round 8.1 correction evidence

- Base: `origin/main` at `16fcc8480e03aed0fcec0f8d046955e587af5e46`
- Branch: `fix/studymap-v4-round8-1-release-blockers`
- Worktree: `.worktrees/phase-c-round8-1-p1-closure`
- Library production flag: unchanged (OFF)

This package records how Round 8 defects R8-001 … R8-007 were corrected and
verified. It is not a Round 8.2 release re-audit and does not approve a
production release.

The original RED findings stay where Round 8 left them, in the audit worktree
`audit/studymap-v4-round8-final-gate`:
`docs/ui-ux-v4-design/round8-qa-evidence/defects.md` and
`release-readiness.md`. That worktree was not reset, cleaned or copied over.

## Contents

| File | What it holds |
|---|---|
| `p1-closure.md` | R8-001, R8-002, R8-003: root cause, fix commits, proof, reviewer |
| `quiz-autosave-race.md` | R8-002 invariant, fix and save-ack → submit ordering per case |
| `export-session-isolation.md` | R8-003 commit boundary and browser-download counts |
| `p2-disposition.md` | R8-004 … R8-007 and the compact Account 44px measurement |
| `test-results.md` | Every suite with pass/fail/skip counts and the exact SHA tested |
| `residual-release-gates.md` | Checks still NOT VERIFIED or BLOCKED |
| `agy/` | Agy's independent Chromium evidence (owned by Agy, unchanged) |

## Commits on this branch

| Commit | Scope |
|---|---|
| `e196bbb` | fix(quiz): synchronize autosave before submission — R8-002 |
| `883b616` | fix(export): validate image attempt before download — R8-003 |
| `4b56a91` | fix(workspace): compact header through tablet boundary — R8-001 |
| `f316c01` | fix(library): gate tools by destination readiness — R8-004, R8-005 |
| `6b4e8e2` | test(export): align fixtures with preview bench — R8-006, R8-007 |
| `76c1a32` | test(header): align compact breakpoint contracts — R8-001 |
| `ab6e90c` | fix(library): clamp tools menu to available viewport — R8-005 |
| `21ab319` | fix(quiz): keep save barrier alive under StrictMode and attempt switches — R8-002 |
| `07fbf82` | test(export): pin double-click, newer-attempt and format parity — R8-003 |
| `ef1b3de` | test(library): cover not_generated, unknown and absent index — R8-004 |
| `e009d38` | test(export): migrate responsive QA states to the Preview Bench — R8-006 |

## Reviewers

- **Agy**: independent Chromium/visual QA. Header and Library geometry at
  `ab6e90c`; fixture Playwright suite and Account target measurement.
- **Codex2**: independent code review of R8-002/003/004 (all APPROVE after
  `21ab319`); author of the `21ab319` fix and the `e009d38` spec migration
  under Claude's direction; local critical-E2E prerequisite probe.
- **Codex1**: builds, lint ratchet, diff check, backend export/PDF tests and
  the `origin/main` baseline rerun of the four pre-existing failing specs.
- **Claude**: lead; review of R8-002/003, test additions, this package.

## Guardrails observed

No merge, deployment, production flag change, backend schema or business-logic
change, and no change to the Round 8 audit worktree.
