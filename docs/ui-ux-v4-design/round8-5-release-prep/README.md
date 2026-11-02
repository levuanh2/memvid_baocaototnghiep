# Round 8.5 preparation: release integration and next corrections

| Item | Value |
|---|---|
| Base | `origin/main` `2479a32` (unchanged) |
| Pending release PRs | #101 (deploy SHA pinning, head `57f77f6`), #102 (QA hardening, head `87717c0`). Both are drafts, CI is green, and agent reviews are APPROVE. **Neither is authorised to merge** |
| Correction PRs (drafts) | #104 `fix/studymap-v4-chat-delete-focus` (R84-A11Y-02), #103 `fix/studymap-v4-quiz-grading-integrity` (P2 grading). Both are independent of #101 and #102. #103 and #101 both append to `.playbook/lessons-learned.md`: a trivial text conflict for whichever merges second |
| This branch | Documentation only. Do not merge it as part of a release; a merge to `main` deploys |

| File | Content |
|---|---|
| `release-integration-readiness.md` | PR state, the unprotected `main` finding, the pinned EC2 preflight with its SHA-256, live Render settings (read through the API), the transition-window risk, and the step-by-step integration order |
| `human-acceptance-tests.md` | Forms E1–E6: EC2 preflight output, Render settings, real-phone flick, screen readers, production runtime revision, manual Fixture Audit |
| `citation-navigation-proposal.md` | Inline "Xem N đoạn nguồn" design (proposal only) |
| `map-summary-deletion-proposal.md` | Codex1's read-only investigation: storage, ownership, delete APIs, reachability, impact, options A/B/C (recommended: A) |

Policy carried forward:

- `fixture-smoke` stays in `CI / required`.
- Flakes are investigated and fixed, never skipped.
- No merge, deploy, flag change, break glass or production-setting change
  happens without the release owner's explicit approval.
