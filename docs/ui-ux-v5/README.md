# StudyMap V5 — design and engineering package

Evidence-first, delivered as small Draft PRs. Nothing here is merged or deployed without owner approval. R7 stays **NO-GO** until a separate release decision.

| Doc | Content |
|---|---|
| [01-branding-diagnosis.md](01-branding-diagnosis.md) | Why the live site still looked like MemVidX: the favicon and the "M" seal, not deploy or cache |
| [02-design-foundation.md](02-design-foundation.md) | The brand mark, the tokens adopted from main, and the rules every V5 workstream follows |
| `legacy-pr-integration.md` | V4.1 backlog (#138–#147) integration matrix. Added by the legacy-integration PR. |

## Workstreams

| ID | Scope | Depends on |
|---|---|---|
| **V5-A** | Branding and design foundation: StudyMap mark, new favicon URL, foundation rules | main |
| V5-B | Global navigation and responsive shell, incl. the #142/#144 Option A mobile header (12px provisional floor) | V5-A, Fixture Audit restore |
| V5-C | Library and document experience | V5-B, #138 |
| V5-D | AI workspace: Chat, Summary, Mind Map, Export Studio | V5-B, #139, #146 coverage |
| V5-E | Learning journey: Quiz, Result, Review Guide, Practice, Knowledge Map | V5-B, #140; keeps #148 |
| V5-F | Quality: accessibility, motion, loading, font resilience, visual regressions | all |

## Status

Single table, updated per milestone. SHAs are exact at the time of writing.

| Track | Branch | Head | Draft PR | CI | Review | Blocker |
|---|---|---|---|---|---|---|
| Fixture Audit restore | `fix/fixture-audit-baseline` | `e94c493` | Draft PR #151 | pass (Linux Fixture Audit 530/530) | Codex approve, agy pass | awaiting owner review |
| V5-A branding / foundation | `design/v5-foundation` | `2a9be7e` + docs | Draft PR #152 | pass | Codex approve (after 1 medium + 3 low fixed) | awaiting owner review |
| V4.1 legacy integration | four `integ/v41-*` branches | see `legacy-pr-integration.md` | Draft PRs #153–#156 | pass (all four) | Codex approve, agy pre-check pass | awaiting owner review; originals #138/#139/#140/#146 PROPOSED SUPERSEDED |
