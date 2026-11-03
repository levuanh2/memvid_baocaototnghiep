# Round 8.6: final release gate closure (StudyMap V4)

| Item | Value |
|---|---|
| Checked | 2026-11-03, by Claude; GitHub and Render reads only, plus one Fixture Audit dispatch |
| Baseline | `main` `2d283aa384f2cef1e88f2209032bbeefbe4f3e67` (merges #106 `741ed48`, #107 `f109484`, #110 `e83f1f3`, #111 `2d283aa`) |
| Open PR | #112 `fix/ci-main-no-queue`, Draft, head `4c8486b`, CI 12/12 green, **not merged** |
| Authority | No merge, deploy, flag change or Render setting change was made |
| History | Round 8.2–8.5 evidence is unchanged. This folder only adds the closure state |

| File | Content |
|---|---|
| `render-deploy-gate.md` | Event timeline of the Render deploy-before-CI incident, review of #112, residual risk, option B design, recommendation |
| `human-acceptance-sheets.md` | Run sheets for NVDA/Chrome, Narrator/Edge, Android/Chrome and iPhone/Safari (E3/E4 criteria unchanged) |
| `independent-review-codex1.md` | Codex1 review of the deploy gate and #112: REQUEST CHANGES; all four findings addressed in `render-deploy-gate.md` (see its §5) |
| `independent-review-codex2.md` | Codex2 review of this matrix and the sheets: REQUEST CHANGES; all four findings applied (per-row evidence, row 4.6 test build, Auto Sync order, 401 method/path) |
| `render-docs-research-agy.md` | AGY research of Render docs: 0 claims contradicted. Its quotes are secondary: a spot check confirmed the deploy-hook 409-on-suspended statement; its claim that a `?ref=` hook does not disable auto-deploy conflicts with Render's deploys page as read by Claude, so rely on neither (option B sets `autoDeployTrigger: "off"` explicitly) |

## 1. Final release matrix

Status values: PASS, FAIL, NOT VERIFIED (not yet observed), PENDING OWNER
(needs an owner action that is outside an agent's authority).

### 1.1 Technical implementation

| Gate | Status | Evidence |
|---|---|---|
| `CI / required` on `main` HEAD | PASS | CI run 41575181269 on `2d283aa`, all jobs green |
| `CI / required` fails when `detect-changes` fails (#107) | PASS | Probe PRs #108 (old: PASS with 0 tests) and #109 (fixed: FAIL); merged as `f109484` |
| Destructive dialog first frame after reopen (#111) | PASS | Unit test with a layout-effect probe; failed before the fix |
| Full Fixture Audit on `main` | PASS | Run 41586296321 (`workflow_dispatch`, `main`, SHA `2d283aa`): 449 collected, **449 passed**, 0 failed, 0 flaky, 0 skipped, 0 retries used (config allows 1; `--fail-on-flaky-tests`), 16.9 min. Report artifact `playwright-fixture-full-report` |

### 1.2 Production deployment verification

| Gate | Status | Evidence |
|---|---|---|
| EC2 deploy pinned to the CI-verified SHA | PASS | Deploy run 41576552966: `decision=deploy reason=verified_sha_is_current_main`, activation SHA verified, ledger line recorded for `2d283aa` |
| `/health` | PASS | `status=ok`, `revision=2d283aa384f2…` |
| Frontend build | PASS | `studymap.space` and `studymap-web.onrender.com` serve `studymap-build=2d283aa384f2…` |
| Frontend talks to the EC2 API | PASS | Render env `VITE_API_BASE=https://api.studymap.space` (only `NODE_VERSION` and `VITE_API_BASE` set) |
| Unauthenticated API call | PASS | `GET https://api.studymap.space/api/documents` without `Authorization` returns 401 (2026-11-03, reproduced by Codex2) |
| Frontend deployed only after CI passed | **FAIL** (2026-11-03) | Render built `e83f1f3` and `2d283aa` before their CI ran. Root cause and fix: `render-deploy-gate.md` |

### 1.3 Release governance

| Gate | Status | Evidence / action |
|---|---|---|
| Branch protection on `main` | PASS | Required check `CI / required` (app 15368), strict, PR required, 0 approvals, admins included, conversation resolution, no force push, no deletion |
| Render waits for main CI (#112) | PENDING OWNER | Review: PASS on all five properties, one rare fail-stale edge (EC2 may stay on the previous SHA; re-run Deploy fixes it). Recommendation: merge #112, accept the documented residual seconds-wide race, and check the Render deploy order after the first parallel merges (an older SHA after a newer one is a blocker) |
| Blueprint dropped `studymap-api` (#106) | **NOT VERIFIED** | Render has not synced: last sync `2026-11-02T17:11:20Z` for `1f4d4d7`; no sync for `741ed48`. Operator steps in §2 |
| `studymap-api` stays suspended | PASS | `suspended`, suspender `user`; last deploy `fdc1c9d` on 2026-09-15 |
| `studymap-api` Auto-Deploy off | PENDING OWNER | Currently `autoDeploy=yes`, trigger `checksPass`. Suspension has blocked every deploy since 2026-09-15, but Auto-Deploy must be off before anyone resumes the service |
| `studymap-web` configuration matches `render.yaml` | PASS | rootDir `FE`, `npm ci && npm run build`, publish `./dist`, rewrite `/* → /index.html`, `checksPass`, previews off |

### 1.4 Human accessibility acceptance

| Gate | Status | Sheet |
|---|---|---|
| NVDA, Windows/Chrome (E4) | NOT VERIFIED | S1 |
| Narrator, Windows/Edge (E4) | NOT VERIFIED | S2 |
| Android/Chrome fast flick (E3) | NOT VERIFIED | S3 |
| iPhone/Safari fast flick (E3) | NOT VERIFIED | S4 |

### 1.5 Library rollout readiness (not part of the V4 release)

| Gate | Status | Note |
|---|---|---|
| Library Action Matrix flag in production | OFF (intended) | Bundle has no `VITE_LIBRARY_ACTION_MATRIX` |
| Ready to switch on | NOT VERIFIED | Needs checklist row 4.6 with the flag ON in a test build (both readers) and a separate owner decision. V4 ships with the flag OFF |

## 2. Render Blueprint: operator steps

Read-only findings: Blueprint `membaocaototnghiep` (`exs-dacf7q2fngtc73d8q5jg`)
reports `in_sync` with Auto Sync on, but its last sync is for `1f4d4d7`. The
two syncs that can be matched (`1f4d4d7`, `fdc1c9d`) each ran seconds after a
deploy of the same commit. `741ed48` was never deployed (Render deployed the
newer `e83f1f3`), which is consistent with its sync never being triggered.
That cause is not confirmed.
Render's documentation: removing a resource from the Blueprint never deletes
it.

1. Render Dashboard, workspace "le's workspace", **Blueprints**, then
   `membaocaototnghiep`.
2. If the page offers **Manual Sync**, click it. If it is only available
   with Auto Sync off: Settings, set Auto Sync to **No** first, go back and
   click **Manual Sync**. Leave Auto Sync at No for now (see step 6).
3. Read the sync preview before confirming. Expected: `studymap-api` is no
   longer managed, `studymap-web` has no changes. If the preview shows
   anything else (a new resource, a change to `studymap-web`, an
   environment variable), cancel and report it.
4. After the sync has finished: open `studymap-api`, Settings, Build &
   Deploy, **Auto-Deploy: Off**. Do **not** Resume, delete or edit its
   environment.
5. Tell Claude. The read-only re-check confirms: a sync entry for a commit
   at or after `741ed48`, Blueprint resources = `studymap-web` only,
   `studymap-api` still suspended with `autoDeploy=no`.
6. Only after step 5 passes: if you changed Auto Sync in step 2, set it back
   to **Yes**.

Observation, not a gate: Render lists `studymap.space` and
`www.studymap.space` as `unverified` custom domains. Both are served through
Cloudflare to the Render origin (`rndr-id` present) and return the current
build. Check it if Render later fails to renew the origin certificate.

## 3. Verdict

**CONDITIONAL.**

StudyMap V4 is implemented, tested and running in production on `2d283aa`,
with backend and frontend on the same verified SHA, the Library flag OFF and
no known product defect. The technical gates (§1.1) and production
verification (§1.2, except the deploy-order incident) pass.

What still prevents GREEN, in order:

1. **Human accessibility (§1.4), four sheets.** NVDA/Chrome, Narrator/Edge,
   Android/Chrome and iPhone/Safari have not been run by a person. They are
   required gates and no agent result can replace them.
2. **Render deploy gate (§1.3, owner decision).** On 2026-11-03 the frontend
   went live before CI. Merge #112, or choose option B, and record the
   accepted residual risk.
3. **Blueprint sync and old backend (§1.3, operator).** Sync the Blueprint
   so `studymap-api` is unmanaged, then turn off its Auto-Deploy (§2). Do not
   resume or delete it.

After 2 and 3, Claude re-checks read-only: Blueprint resources, `studymap-api`
state, the next main merge's CI and Render deploy order, `/health` and
`studymap-build`. GREEN is declared only when items 1–3 are closed with
evidence.

Library rollout is outside this verdict; the flag stays OFF.
