# Round 8.5 human-only acceptance tests: steps and evidence forms

These gates **cannot** be passed by an agent. Chromium emulation, the DOM, axe
and accessibility-tree checks do **not** count as PASS for any of them. Every
result below stays **NOT VERIFIED** until a named person fills in the form.

Record the production build under test. It must be the same SHA in all three
places:

- the EC2 checkout HEAD;
- `/health` `revision` (after PR #102);
- `<meta name="studymap-build">` (after PR #102).

## E1. EC2 deployment preflight (before merging #101)

**Steps:** follow `release-integration-readiness.md` §2 exactly. Use the
pinned SHA and check the SHA-256.

| Field | Value |
|---|---|
| Operator / date (UTC) | |
| `sha256sum -c` result | OK / FAILED |
| `git rev-parse HEAD` on EC2 | |
| `git status --short --ignored -- BE docker-compose.prod.yml` | (paste) |
| Full preflight output | (paste verbatim) |
| `exit=` | |
| FAIL lines and the agreed correction | |
| Result | PASS / FAIL |

## E2. Production Render settings

**Steps:** in the Render dashboard, before and after #101:

1. Open `studymap-web`, then Settings, then Build & Deploy, and read
   Auto-Deploy.
2. Do the same for `studymap-api`, and also read its suspended / active state.
3. Open Blueprints, then `membaocaototnghiep`, and read the sync status and
   the last sync time.
4. Under Workspace settings, read the overlapping-deploy policy
   (Wait / Override).

| Check | Before #101 | After #101 | Expected after |
|---|---|---|---|
| `studymap-web` Auto-Deploy | | | After CI Checks Pass |
| `studymap-api` Auto-Deploy | | | After CI Checks Pass |
| `studymap-api` state | | | **Suspended** (must not resume) |
| Blueprint sync | | | In sync; last sync after the #101 merge |
| Overlapping-deploy policy | | | Recorded (Override if only the latest release may activate) |
| Operator / date | | | |
| Result | | | PASS / FAIL |

## E3. Touch on a real phone: first tap after a fast flick (R84-TOUCH-01)

**Devices:** one Android phone with Chrome and one iPhone with Safari. Not
emulation.

**Steps** (production or staging build, test account):

1. Open a mind map. Choose Xuất sơ đồ, then Các node được chọn, then Chọn
   trên canvas.
2. **Fast-flick** the canvas with one finger. Lift the finger while it is
   still moving.
3. About 1 s later, tap a branch dot **once**.
4. Record whether it toggled at the first tap. Repeat 5 times.
5. Control run: pan **slowly** and stop before lifting, then tap once.

| Device / OS / browser | Build SHA | Flick: toggled on 1st tap (×5) | Slow pan: toggled on 1st tap (×5) | Notes | Tester / date |
|---|---|---|---|---|---|
| | | _/5 | _/5 | | |
| | | _/5 | _/5 | | |

Interpretation:

- 5/5 on both rows: **PASS**. The issue is an emulation artefact.
- Any first-tap miss after a flick: **FAIL**. Open a product fix: also
  toggle on `pointerup` for `pointerType === "touch"`, de-duplicated against
  the click.

## E4. Screen readers (spoken output)

**Steps:** use `../round8-4-qa-evidence/accessibility-manual-checklist.md`.
It covers Quiz, Result (including the pending asynchronous grading state),
ReviewGuide, Library, Export Studio and the destructive dialogs.

| Reader | OS / browser | Build SHA | Rows PASS / total | FAIL rows (ids) | Tester / date |
|---|---|---|---|---|---|
| NVDA | Windows / Chrome or Firefox | | | | |
| Narrator | Windows / Edge | | | | |
| VoiceOver | macOS or iOS / Safari (only if the hardware exists) | | | | |

Add one row for the chat "Xóa lịch sử chat" dialog. After PR
`fix/studymap-v4-chat-delete-focus`: Escape must announce focus back on
"Tùy chọn cuộc trò chuyện".

## E5. Production runtime revision (only after #101 and #102 are merged with approval)

```bash
# On EC2 (read-only)
git -C /opt/memvid/app rev-parse HEAD
tail -3 /opt/memvid/deployments.log
# From anywhere (read-only GET)
curl -s https://api.studymap.space/health | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['status'], d.get('revision'))"
curl -s https://studymap.space/ | grep -o '<meta name="studymap-build" content="[^"]*"'
# Library flag must stay OFF: the production bundle must not enable the matrix.
# Same method as Round 8.2: fetch the JS chunks and confirm the matrix is not
# enabled (VITE_LIBRARY_ACTION_MATRIX is not "true").
```

| Value | Observed | Expected |
|---|---|---|
| Merge commit verified by CI (Actions run id) | | — |
| EC2 HEAD | | = CI SHA |
| Ledger last line | | `<CI SHA> deploy` |
| `/health` status / revision | | `ok` / = CI SHA |
| Frontend `studymap-build` | | = CI SHA (Render built after checks passed) |
| Library Action Matrix flag in production | | OFF |
| Result / operator / date | | PASS / FAIL |

## E6. Manual Fixture Audit dispatch (full 448)

**Steps:**

1. Open GitHub, then Actions, then **Fixture Audit**, then Run workflow
   (branch `main`).
2. Wait. The job allows up to 45 minutes.
3. Record the summary and download the artifact `playwright-fixture-full-report`.

| Field | Value |
|---|---|
| Run URL / commit | |
| passed / failed / flaky / skipped | |
| On failure: trace, duration, environment or product, and the fix issue | |
| Result | PASS / FAIL |

A flaky or failed spec is **not** to be skipped. Capture its trace, classify
it as environmental or product, fix the cause, and re-run.
