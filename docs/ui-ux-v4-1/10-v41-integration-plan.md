# 10. V4.1 integration plan (2026-11-04)

Status: plan for the owner. Nothing here is merged or deployed, and the Library
flag stays OFF. Merging waits for explicit owner authorization, PR by PR or
wave by wave. Anything not directly verified is marked **NOT VERIFIED**.

`origin/main` at the time of writing: `927cf88`.

## Latest status (2026-11-04, when this plan was merged)

This block overrides older statements below where they differ. The sections
below are kept as the record at the time they were written, so their HEADs and
CI results may be out of date.

- **Docs merges:** the owner authorized #141 and #143 separately. #141 merged as
  `8dab917`. No other PR is authorized to merge.
- **Release acceptance freeze:** after the lead merges #145, follow
  [`release-acceptance-freeze.md`](../ui-ux-v4-design/round8-6-release-gate-closure/release-acceptance-freeze.md).
  Its baseline is the #145 merge commit; no PR, including docs, merges during
  acceptance.
- **Sequence note in §5:** docs do not wait for #126, except #142, which still
  must not land before #126.
- **S1–S4:** still required before any V4.1 frontend merge, and still **NOT
  VERIFIED**. The tester guide is in Draft PR #145, not on `main` yet.
- **Mobile map fit:** the owner chose to try Option B from #147 first, compared
  with Option A on the same data on real phones. #130 is not approved and is not
  changed on fixture screenshots alone. Real-device result: **NOT VERIFIED**.
- **Marker click:** #146 stays independent of the initial fit; a separate merge
  window is proposed after the S1–S4 baseline. Not authorized to merge.
- **Wave 1:** order unchanged (#122 → #126 → #134 → #129 → #128); locked until
  S1–S4 are complete and the owner unlocks frontend merges.
- **#126 responsive correction:** its **Công cụ học** trigger remains icon-only
  through 1100 px, not only through 768 px. The source rule is
  `@media (max-width: 1100px)` in `FE/src/index.css`.
- **Revisions:** a docs-only merge can change the backend revision in `/health`
  without changing the frontend `studymap-build`. Read both on the test day.
- Library flag OFF.

## Final owner decision (2026-11-04)

- **#130: request changes.** Do not present it as approved or merge-ready.
- **#135: design approved**, but it still waits for S1/S2 human acceptance and
  final CI on the HEAD that would merge.
- **#142: Option A selected.** Move Usage into the visibly labelled
  **Công cụ học** menu, keep Home/Chat/Map/Summary/Account, and make Library
  easy to find there. #142 remains docs-only and must not land before #126.
- **S1–S4 must be completed before any V4.1 frontend merge.** Automated and
  simulated browser tests do not substitute for those human sheets.
- **Wave 1 is preparation only.** No V4.1 frontend PR is authorized to merge by
  this decision or by this plan.
- **#141 and #143 may be sent to the owner** after `CI / required` is green on
  their current HEAD and the diff is confirmed docs-only. That is review
  permission, not automatic merge permission.
- **Waves 2–5 require separate owner approval.** Approval of one wave does not
  authorize the next.
- **Library stays OFF.** Do not enable its production flag or production data
  path without separate written authorization.

## 1. Decisions matrix

| ID | Owner decision | PR | State |
|---|---|---|---|
| A1 | Run S1–S4 on production before the merge train; record frontend and backend revisions separately | none | **NOT VERIFIED**: no filled sheet exists (§7) |
| A2 | Accept "Công cụ học" and "Tải tài liệu lên"; icon-only on phones is interim; separate proposal for a visible label at 320/390 | #126, #142 | #126 unchanged. Proposal #142 recommends moving Usage into the tools menu. Owner picks an option; any product change is a separate PR |
| A3 | Weak-topic count: only `light_review`, `review_needed`, `critical_gap`; no duplicate concepts; no fabricated number | #121 | Done, `c51b07c`. Matches the backend `WEAK_STATUSES`. Dedup by normalized concept name, row id as fallback, a row with neither is not counted |
| A4 | Export footer direction approved; keep cancel, retry and completed contracts | #136 | Done, `8dcf063`. Only the idle footer changes; lifecycle states match `main`. Independent review: APPROVE. Audit 467/467 |
| A5 | Four right-panel tabs; real before screenshots; legacy block stays off | #135 | Evidence re-captured from `main`, `113f0e3`. **Owner review of screenshots pending** |
| A6 | Before/after at 320/390; fit, readability, first level, touch targets, no refit; audit | #130 | Evidence ready, `c2d695f`, audit 466/466. **Owner visual acceptance pending, see the trade-offs below** |
| A7 | "Xem gọn", "Mở một tài liệu", "Tạo lại kế hoạch"; tooltip explains automatic selection | #138 | Done, `c4e4167` |
| A8 | Depth labels as specified; tooltips must match the code | #139 | Done, `bcc8878`, audit 466/466. `toCenter()` centres the root, so the tooltip now says "đưa nút gốc vào giữa khung, giữ mức thu phóng" |
| C | "Sơ đồ tư duy" percentage unit | none yet | After #122 and #137 merge |
| C | W5-5 as an evidence-based proposal | #141 | Done. Independent review: APPROVE |
| C | Library production flag OFF; rollout needs separate written approval | #123, #133 | Flag untouched |

### A6 trade-offs for the owner (#130)

Measured in the fixture harness, map with 5 first-level branches. Not read on a
real phone (**NOT VERIFIED**).

| Width | Version | Scale | First-level inside the canvas | Rendered label size |
|---|---|---|---|---|
| 320 | `main` | 0.75 | 0 / 5 | 10.5 px |
| 320 | #130 | 0.5 | 1 / 5; the others are cut at the edge | 7 px |
| 390 | `main` | 0.75 | 0 / 5 | 10.5 px |
| 390 | #130 | 0.5 | 5 / 5 | 7 px |

- The 0.5 floor and the 7 px "legible" figure were chosen during this work.
  They are not an owner or accessibility standard.
- At 0.5 the fixed-size selection markers of stacked leaves overlap, so
  `mobile-touch-selection.spec.js` now zooms in to at least 75% before picking
  leaves. A real click still resolves to the nearest marker
  (`marker-click-resolution.spec.js`).
- The audit found a real defect on the way: a connector path could swallow a
  marker click. Fixed in `c2d695f`; SVG layers ignore pointers only while branch
  selection is active.

Screenshots: `docs/ui-ux-v4-1/evidence/w5-3/`.

## 2. PRs changed after the owner decisions

| PR | Old HEAD | New HEAD | Change |
|---|---|---|---|
| #121 | `93a33ca` | `c51b07c` | A3 count and dedup |
| #129 | `92edfc0` | `f3c789e` | Comments use the approved upload label; found by the #126 source scan in the train simulation |
| #130 | `cbebd95` | `c2d695f` | Evidence (A6); marker click under a path |
| #135 | `b6b1e61` | `113f0e3` | Real before/after evidence (A5) |
| #136 | `9d3292e` | `8dcf063` | Lifecycle states back to `main`'s contracts (A4), tests restored |
| #137 | `3bc27b9` | `6233d50` | Merge-forward of #121 |
| #138 | `103daa9` | `c4e4167` | A7 copy and tooltip; CRLF-tolerant test |
| #139 | `79124c1` | `bcc8878` | A8 labels and tooltips |
| #142 | `09dd0f1` | `5e173c9` | Base changed from the #126 branch to `main`, because CI never ran; merge after #126 |

New in this round: #141 (W5-5 proposal), #142 (mobile header proposal), #143
(this plan).

## 3. Evidence

| PR | Path |
|---|---|
| #121 | `docs/ui-ux-v4-1/evidence/w2-1/` |
| #130 | `docs/ui-ux-v4-1/evidence/w5-3/` |
| #135 | `docs/ui-ux-v4-1/evidence/w3-4/`: `before-main-*`, `after-*` at 1440, 390 and 320 px panel |
| #136 | `docs/ui-ux-v4-1/evidence/w3-3/`: idle state at 1440 and 390. Busy, error and completed states are covered by tests, not screenshots |
| #140 | `docs/ui-ux-v4-1/evidence/w5-2/` |
| #141 | `docs/ui-ux-v4-1/evidence/spacing/` |
| #142 | `docs/ui-ux-v4-1/evidence/mobile-header-proposal/` |

`right-panel-tabs.spec.js` rewrites the tracked `w3-4/after-*.png` on each run,
and the round 6/7 specs rewrite their own evidence. Restore those files before
committing unrelated work.

## 4. Dependencies and conflicts

Measured by merging the final HEADs in order on a local detached worktree
(`5b3474b`, never pushed). After all 20 merges: unit 1879/1879; fixture 160/160
(mobile-header, library-mode-navigation, right-panel-tabs, export-studio,
palette-actions, a11y-names, marker-click-resolution, mobile-touch-selection,
mindmap-responsive-interactions). The Full Fixture Audit and real-backend E2E
were not run on this combined result.

Hard dependencies: #137 after #121 (contains it); #140 after #122 (contains it);
#142 after #126 (contains it).

| PR | HEAD | Merge in this order | Resolution when it lands |
|---|---|---|---|
| #122 | `4707cf3` | clean | |
| #126 | `9d1bccb` | clean | |
| #134 | `4ee9338` | clean | |
| #129 | `f3c789e` | clean | |
| #128 | `489c1f9` | clean | |
| #121 | `c51b07c` | clean | |
| #137 | `6233d50` | `LearningDashboard.jsx` | Keep "Sơ đồ tư duy" and the "% đã có" unit |
| #127 | `a89fcc7` | clean | |
| #131 | `af6d4cd` | clean | |
| #125 | `896fe72` | `.playbook/known-issues.md`, `.playbook/lessons-learned.md` | Keep all entries |
| #124 | `19734ef` | clean | |
| #136 | `8dcf063` | clean | |
| #135 | `113f0e3` | clean | |
| #123 | `7fabfab` | `.playbook/known-issues.md` | Keep all entries |
| #133 | `a6fc65f` | clean | |
| #140 | `355c08f` | `StudyShell.jsx` | Keep `stackActionsOnMobile` and `breadcrumbDocumentLabel` |
| #138 | `c4e4167` | clean | |
| #139 | `bcc8878` | `MindElixirView.branchToggle.test.jsx` | Keep both new tests |
| #130 | `c2d695f` | `.playbook/known-issues.md` | Keep all entries |
| #132 | `c7c0b4c` | clean | |

Files touched by the most PRs: `MindElixirView.jsx` (#122, #124, #130, #139,
#140), `DocumentList.jsx` (#122, #126, #128, #138, #140), `MainLayout.jsx`
(#126, #129, #131, #134), `CommandPalette.jsx` (#122, #126, #131, #140),
`LearningDashboard.jsx` (#122, #127, #137, #140).

## 5. Recommended merge sequence

The owner's order holds; the simulation found no better one.

1. Wave 1: #122 → #126 → #134 → #129 → #128. Then the docs: #142, #141, #143 can
   go in at any point after #126.
2. Wave 2: #121 → #137 → #127. Then the follow-up PR for the "Sơ đồ tư duy" unit.
3. Wave 3: #131 → #125 → #124 → #136 → #135.
4. Wave 4 (flag stays OFF): #123 → #133.
5. Wave 5: #140 → #138 → #139 → #130 → #132.

After each merge:

1. Merge the latest `main` into the remaining PR branches that overlap (no
   rebase, no force-push). Resolve conflicts without reverting earlier fixes.
2. Rerun the relevant tests and wait for `CI / required` on the new HEAD.
3. For #123, #124, #130, #136, #139 and anything else that materially changes
   map, export or Library behavior: rerun the Full Fixture Audit on the updated
   HEAD. The workflow cancels a running audit when a new one starts, so run them
   one at a time.
4. After `CI / required` on `main`, verify the Render deploy order and SHA. The
   frontend meta shows the frontend SHA, `/health` the backend SHA; they differ
   after a docs-only merge, so compare each with what was actually deployed.
5. Smoke-test the affected flows with an authorized account. **No such account is
   available to the agents, so this step needs the owner or a provided test
   account.**
6. Stop on any regression before the next merge.

## 6. Current CI and audit status (final HEADs)

`CI / required` is SUCCESS on all of #121–#143 at the HEADs above. Each result
applies to that PR against `927cf88`, and goes stale once the branch is updated.

| PR | Full Fixture Audit | Run |
|---|---|---|
| #123 `7fabfab` | success, 471 passed | 41767637092 |
| #124 `19734ef` | success, 466 passed | 41769633491 |
| #130 `c2d695f` | success, 466 passed | 41788263951 |
| #136 `8dcf063` | success, 467 passed | 41784265833 |
| #139 `bcc8878` | success, 466 passed | 41786364063 |

## 7. Human acceptance

| Sheet | Setup | Status |
|---|---|---|
| S1 | NVDA + Chrome | **NOT VERIFIED** |
| S2 | Narrator + Edge | **NOT VERIFIED** |
| S3 | Real Android + Chrome | **NOT VERIFIED** |
| S4 | Real iPhone + Safari | **NOT VERIFIED** |

Sheets: `docs/ui-ux-v4-design/round8-6-release-gate-closure/human-acceptance-sheets.md`.
No filled copy exists. Simulated tests do not count.

Record on each sheet, read on the day of testing. On 2026-11-04:

- Frontend (`studymap-build`): `973fd2c`
- Backend (`/health` revision): `927cf88`

Row 4.6 still needs a test build with the Library flag ON, never production.
After V4.1 merges, repeat the affected flows; the riskiest for a screen reader
are #125, #132, #133 and #135.

## 8. Remaining blockers

**V4 (still CONDITIONAL):**

- Gates 10/11: S1–S4 by a person.
- Gates 4/5: owner Manual Sync of Blueprint `membaocaototnghiep`, then Auto-Deploy
  Off on `studymap-api`. Read on 2026-11-04: last sync still
  `2026-11-02T17:11:20Z`, `studymap-api` suspended with Auto-Deploy on.
- Production use with a real account and the Guided capability value: **NOT
  VERIFIED**.

**V4.1, before the train starts:**

- Owner merge authorization.
- A1 result, or an owner decision to go on without it.
- Owner review: #135 screenshots; #130 trade-offs (§1).
- Owner choice among the #142 options; a later product PR implements it.

**V4.1, during or after the train:**

- Audits and E2E on updated HEADs, including the combined result.
- Production smoke tests with an authorized account.
- "Sơ đồ tư duy" percentage unit follow-up.
- W5-5 implementation, only if the owner accepts #141.
- W4-3 Library flag: separate written approval, after #123, #133 and row 4.6.
