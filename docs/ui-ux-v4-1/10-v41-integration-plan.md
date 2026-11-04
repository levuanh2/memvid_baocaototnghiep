# 10. V4.1 integration plan (2026-11-04)

Status: draft, compiled by an independent reviewing agent (Claude pD) from the
current state of every open V4.1 PR, this cycle's owner decisions, and the
human-acceptance sheets on `origin/main` (`927cf88`). Facts only; anything not
directly verified is marked **NOT VERIFIED**. Supersedes nothing in
`07-v41-pr-roadmap.md`; this is a snapshot for merge planning, not a new plan.

## 1. Updated decisions matrix (A1–A8 + C)

Compiled from brief files and PR/commit titles under
`.worktrees/v41-briefs/` and `git log --all`. Where a letter's source could
not be found in any file this agent could read, it is marked NOT FOUND rather
than guessed.

| Decision | Subject | PR | Status |
|---|---|---|---|
| A1 | NOT FOUND — no brief, PR title, or commit message matching "owner A1"/"decision A1" located in this repo's `.worktrees/v41-briefs/` or `git log --all` | — | NOT VERIFIED |
| A2 | Mobile header "Công cụ học" discoverability — move Usage into the tools menu (Option A recommended) | #142 | Reviewed, APPROVE (content) — see `R3-review-result.md`. CI not yet run on HEAD `09dd0f1` |
| A3 | Quiz Result weak-topic count: dedupe by `concept_mastery_id` first, `concept_name` fallback (original A3) | #121 | Implemented, CI green at HEAD `3f4bf9f`. **A further owner correction to A3's dedup priority (name-first, trim+lowercase, id only as fallback; neither-present rows count 0) is queued and not yet implemented as of this doc.** |
| A4 | Export Studio footer (#136): keep cancellation/retry/completed contracts and exact-node/branch/multibranch semantics unchanged | #136 | Reviewed, APPROVE — see `R3-review-result.md`. CI green at HEAD `8dcf063` |
| A5 | PR #135 before/after evidence must come from a genuine `origin/main` baseline, not a same-branch pre/post-interaction pair | #135 | Implemented, CI green at HEAD `113f0e3` |
| A6 | Mobile mind-map touch targets / first-tap reliability (W5-3 framing + marker-click-under-path fix) | #130 | In progress on branch `v41/w5-map-fit-mobile`, HEAD `838c9fe` (includes R3-130's marker-click fix). CI status: NOT VERIFIED by this doc — TODO below |
| A7 | "Mở một tài liệu" tooltip names the auto-picked document | #138 | HEAD `05ca35c`. CI status: NOT VERIFIED by this doc — TODO below |
| A8 | Mind-map depth-preset labels + viewport-button tooltips must match actual `fitView`/`resetView`/`toCenter` behavior | #139 | HEAD `bcc8878`. CI status: NOT VERIFIED by this doc — TODO below |
| C | W5-5 spacing/layout: evidence-based, bounded proposal, not an open-ended redesign | #141 | Reviewed, APPROVE — see `R3-review-result.md`. CI green at HEAD `90b4ce9` |

## 2. PRs modified and current HEADs

All PRs below are **draft**, **open**, **not merged**, confirmed via
`gh pr list --search "head:v41/" --state all` at the time this doc was
written. P0 hotfixes #117/#118/#119 are already merged into `main` (see
`07-v41-pr-roadmap.md`) and are not repeated here.

| PR | Branch | HEAD | Title |
|---|---|---|---|
| #121 | `v41/w2-result-next-step` | `3f4bf9f` | fix(quiz-result): next-step action matches O5 |
| #122 | `v41/w1-map-names` | `4707cf3` | feat(ui): two map names, Sơ đồ tư duy and Bản đồ kiến thức (W1-1) |
| #123 | `v41/w4-matrix-responsive` | `7fabfab` | fix(library): contain action matrix controls |
| #124 | `v41/w3-remove-duplicates` | `19734ef` | refactor(ui): remove duplicate Lưu and Hỏi AI về khái niệm này (W3-2) |
| #125 | `v41/w3-card-menu-a11y` | `896fe72` | fix(library): make card menu keyboard accessible |
| #126 | `v41/w1-tools-upload-labels` | `9d1bccb` | feat(ui): Công cụ học menu and one upload label (W1-2) |
| #127 | `v41/w2-queue-labels` | `a89fcc7` | feat(study): Ôn ngay / Ôn sớm / Ôn sau (W2-3) |
| #128 | `v41/w1-library-header-mobile` | `489c1f9` | fix(library): stack mobile header actions |
| #129 | `v41/w1-mobile-empty-states` | `92edfc0` | fix(workspace): mobile-aware empty states (W1-4) |
| #130 | `v41/w5-map-fit-mobile` | `838c9fe` | fix(mindmap): frame root + first level on phones (W5-3) + R3-130 marker-click fix |
| #131 | `v41/w3-palette-actions` | `af6d4cd` | fix(palette): Mở Gia sư AI opens the tutor (W3-1) |
| #132 | `v41/w5-a11y-labels` | `c7c0b4c` | fix(a11y): name source checkboxes and chat box (W5-4) |
| #133 | `v41/w4-matrix-a11y` | `a6fc65f` | fix(a11y): announce Library selection, name matrix row controls (W4-2) |
| #134 | `v41/w1-branding` | `4ee9338` | feat(branding): StudyMap as the single product name (W1-3) |
| #135 | `v41/w3-right-panel-tabs` | `113f0e3` | feat(workspace): restore the right panel's own tab row (W3-4) |
| #136 | `v41/w3-export-footer` | `8dcf063` | refactor(export): two-button idle footer, rail-only navigation (W3-3) |
| #137 | `v41/w2-percent-units` | `c742936` | fix(study): percentages name their unit |
| #138 | `v41/w5-library-microcopy` | `05ca35c` | feat(ui): Library and review-guide labels say what they do (W5-1) |
| #139 | `v41/w5-map-microcopy` | `bcc8878` | feat(mindmap): viewport button titles and depth preset microcopy (W5-1a) |
| #140 | `v41/w5-knowledge-map-header` | `355c08f` | fix(study): knowledge map header — two named exits (W5-2) |
| #141 | `v41/w55-spacing-proposal` | `90b4ce9` | docs(v4.1): propose spacing normalization |
| #142 | `v41/mobile-header-proposal` | `09dd0f1` | docs: mobile header proposal for Công cụ học (A2) |

Known inter-PR dependency pairs stated in their own PR bodies/briefs:
`#137` depends on `#121`; `#140` depends on `#122`; `#121` (A3) is queued for
one more owner-requested revision (dedup-priority correction) not yet pushed
as of this doc.

## 3. Before/after evidence paths

| PR | Evidence location |
|---|---|
| #129 (W1-4) | fixture specs `FE/e2e-fixture/chat-mobile-empty-state.spec.js`, `FE/e2e-fixture/no-documents-empty-state.spec.js` |
| #130 (W5-3/A6) | `docs/ui-ux-v4-1/evidence/w5-3/` (per `R3-130.md`/`DONE-W5-3.md` — not independently re-read by this doc) |
| #135 (W3-4/A5) | `docs/ui-ux-v4-1/evidence/w3-4/` — `before-main-{1440,390,panel-320}.png`, `after-{1440,390,panel-320}.png`, 3 before-interaction shots, captured from a genuine `origin/main` throwaway worktree baseline per A5 |
| #136 (W3-3/A4) | `docs/ui-ux-v4-1/evidence/w3-3/` (per `DONE-W3-3.md`) |
| #140 (W5-2) | screenshots referenced in `DONE-W5-2.md` |
| #141 (C) | `docs/ui-ux-v4-1/evidence/spacing/` (12 computed-style JSON files, 390/1440 × 6 screens) + pre-existing `docs/ui-ux-v4-1/evidence/screens/*.jpg` |
| #142 (A2) | `docs/ui-ux-v4-1/evidence/mobile-header-proposal/` (9 PNGs, 3 options × 320/375/390) |

## 4. Human acceptance status (S1–S4)

Source: `docs/ui-ux-v4-design/round8-6-release-gate-closure/human-acceptance-sheets.md`
on `origin/main`. Read in full for this doc. Every sheet's Tester/date field
is blank in that file as committed — **no sheet has been filled in by a named
person**.

| Sheet | Covers | Status |
|---|---|---|
| S1 — NVDA / Windows / Chrome | Checklist rows 1.1–6.4 + C1 (29 rows), E4 gate | **NOT VERIFIED** — template blank, no tester/date recorded |
| S2 — Narrator / Windows / Edge | Same 29 rows, E4 gate | **NOT VERIFIED** — template blank |
| S3 — Android phone / Chrome, fast-flick | E3 gate (first-tap-after-flick reliability) | **NOT VERIFIED** — template blank |
| S4 — iPhone / Safari, fast-flick | E3 gate | **NOT VERIFIED** — template blank |

Frontend/backend revision fields: each sheet has its own "Frontend SHA
(meta) / backend SHA (`/health`)" row to be filled at test time; none is
filled yet, so no revision pair is recorded. Row 4.6 (Library Action Matrix,
flag ON) explicitly requires a separate test-build SHA/URL, per the sheet's
own instructions — also not yet recorded.

**No V4.1 PR in section 2 can close E3/E4 on the strength of this doc.** Any
claim elsewhere of S1–S4 passing must point to a filled copy of this file plus
the attached per-row checklist (per the sheet's own rule: "a total such as
`29/29` without the filled checklist is not evidence").

## 5. Remaining V4 and V4.1 blockers

- **W4-3 (Library Action Matrix flag ON)**: per `07-v41-pr-roadmap.md`, this
  requires W4-1 (#123) and W4-2 (#133) merged, row 4.6 run by a person in both
  S1 and S2, and separate written owner approval. Flag must stay OFF in
  production until then. **Blocked on S1/S2 (section 4) and owner sign-off —
  neither exists yet.**
- **A3 follow-up correction** (section 1): PR #121's dedup-priority fix
  (name-first, trim+lowercase, id-fallback, neither-present counts 0) is
  queued per the owner's own instruction but not yet implemented, tested, or
  pushed as of this doc. `#137` merge-forward will need to repeat once #121
  moves again.
- **Merge order / conflict matrix**: TODO, see section 7 — `R3-train-result.md`
  does not exist yet in `.worktrees/v41-briefs/` as of this doc.
- **PR #142 CI**: zero check-runs on HEAD `09dd0f1` (see `R3-review-result.md`
  §2) — must be triggered and confirmed green before merge.
- **E3/E4 human gates** (section 4): fully open, blocking anything that
  depends on them (W4-3 row 4.6, and the general release gate per
  `round8-6-release-gate-closure`).
- This doc did not re-verify CI status for #123–#134, #138, #139 individually
  (see TODO in section 7) or the Full Fixture Audit result on any current
  HEAD — both are explicitly left for the lead per the brief for this task.

## 6. Post-merge checklist (for whoever merges this wave)

1. Update each feature branch against the latest `main` after every merge in
   the batch (merge-forward, never rebase/force-push — same rule as this
   cycle's A3/A5 merge-forwards).
2. Rerun the full FE unit suite (`npx vitest run`) and the relevant fixture
   specs on the merged branch before pushing again.
3. Wait for `CI / required` green on the actual merge commit, not just the
   feature branch tip.
4. Verify Render deploy order and SHA after each `FE/`-touching merge to
   `main`: `CI / required` success timestamp, Render deploy `trigger` and
   creation time for that SHA, confirm no older SHA deploys afterward, and
   that `studymap-build` meta + `/health` `revision` both match — same method
   already used for #118/#117/#119 in `07-v41-pr-roadmap.md`.
5. Smoke test with an authorized/disposable QA account only — never
   production user data.
6. Stop and do not continue the merge train on any regression; file it the
   same way `.playbook/known-issues.md` records prior fixes (symptom, root
   cause, fix, prevention) before resuming.

## 7. TODO — left for the lead

- **Dependency/conflict matrix and merge order** — from `R3-train-result.md`.
  That file does not exist in `.worktrees/v41-briefs/` as of this doc (only
  the brief `R3-train.md` does); the lead's prior informal estimate
  (7 conflicts: `.playbook` on #125/#123/#130; `LearningDashboard` on #137;
  `StudyShell` on #140; `branchToggle` test on #139) is recorded in
  `R3-train.md` itself but has not been confirmed or corrected by an actual
  merge-train simulation yet.
- **Current CI status per final HEAD** — this doc verified CI directly only
  for the three PRs this agent independently reviewed (#136 green, #141
  green, #142 no checks run — see `R3-review-result.md`) plus #121/#135/#137
  from this agent's own earlier implementation work (all green at the HEADs
  listed in section 2). CI has not been (re)checked here for #122–#134,
  #138, #139.
- **Full Fixture Audit results** — the only Full Fixture Audit referenced in
  files available to this agent is run `41771126563` on `v41/w5-map-fit-mobile`
  (failed `marker-click-resolution.spec.js` at 390px, prompting the R3-130
  fix now at HEAD `838c9fe`); whether a fresh Full Fixture Audit has been run
  against that fixed HEAD is NOT VERIFIED by this doc.
