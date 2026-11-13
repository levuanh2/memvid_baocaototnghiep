# V6 integration checklist

For the owner. Nothing here has been merged; every pull request below is a Draft. Heads are the
commits the trial integration used (see "Evidence").

## Dependency graph

```
main (db005ab)
│
├─ #170 ci/v6-fixture-smoke ............ merge FIRST (see step 1)
│
├─ #160 fix/v6-source-loading-state
│    ├─ #161 design/v6-chat-start ...... stacked: contains #160
│    │    └─ #174 design/v6-chat-workspace  stacked: contains #161 and #163
│    │         └─ #177 fix/v6-chat-review-single-flight
│    │              └─ #178 design/v6-chat-composer
│    │                   └─ #180 design/v6-chat-evidence
│    │                        └─ #184 design/v6-mobile-viewport
│    └─ #167 design/v6-header .......... one-line conflict with #160 in MainLayout.jsx
│
├─ #164 fix/v6-stale-owner-guards
│    └─ #165 fix/v6-summary-loading-state  stacked: contains #164 (both rules kept)
│
├─ #162 fix/v6-double-submit-guards
├─ #163 fix/v6-chat-attempt-identity
├─ #166 design/v6-library-actions ─┐
├─ #171 design/v6-library-card ────┼─ #173 design/v6-library-integration (stacked: contains all three)
│                                  │    └─ #176 design/v6-library-one-list
├─ #172 design/v6-learning-home ───┘
├─ #168 design/v6-profile
├─ #169 design/v6-quiz
│    └─ #175 design/v6-quiz-result ... stacked: contains #169
│         └─ #179 design/v6-quiz-setup
│              └─ #182 design/v6-quiz-review
├─ #181 fix/test-guided-dialog-unmount (test only, from main)
├─ #183 fix/practice-submit-atomic (backend only, from main; owner approval before deploy)
└─ #159 design/v6-foundation (landing + these documents)
```

Real dependencies: #161 needs #160, #165 needs #164, #173 needs #166 + #171 + #172, #174 needs
#161 + #163, #175 needs #169, #176 needs #173, #177 -> #178 -> #180 stack on #174, #179 needs #175, #182 needs #179, #184 needs #180, and #167 has to
be reconciled with #160. Everything else is independent in code.

## Order

1. **#170 first.** Then update every other V6 branch onto `main`. Reason: the V6 branches were
   cut before #170, so their CI does not yet run their own new spec in the gate. Merged in the
   other order, a V6 spec would run for the first time after it is already on `main`.
2. **#160**, then **#161**.
3. **#164**, then **#165**.
4. **#167** (after #160): in `MainLayout.jsx` keep the block #160 adds and this branch's line
   `const { isDark, toggleTheme } = useTheme();`.
5. **#166, #171, #172**, then **#173** (it contains all three; #171 and #172 both change `DocumentList.jsx`, in different places), then **#176**.
6. **#162, #163, #168, #169, #159, #181, #183** in any order (#183 changes the backend: merge only
   with the owner's approval of its replay rule); then **#174** (after #161 and #163)
   -> **#177** -> **#178** -> **#180** -> **#184**, and **#175** (after #169) -> **#179** -> **#182**.
   When #174 meets #167 in `FE/src/index.css` (both append at the end), keep both blocks and the
   closing `}` of #167's `@media (max-width: 767px)` block; trial 4 lost it once ("Unclosed block").
7. After #159, #160, #161, #164, #165 are on `main`: move their five specs from `WHEN_PRESENT`
   to `REQUIRED` in `FE/scripts/fixture-smoke-specs.mjs`. Until then, deleting or renaming one of
   those spec files would not fail CI.

## At every step

- [ ] The pull request's required check is green **on its current head**, after it was updated
      onto the new `main`.
- [ ] `.playbook/known-issues.md` and `.playbook/lessons-learned.md`: #160, #162, #163, #164,
      #165, #166 and #171 each append entries at the end of the file. After one merges, the next
      conflicts there. Resolution: keep **both** sets of entries (no entry is replaced).
- [ ] No regression fix is lost. Check these by name after resolving a conflict:
  - `SidebarRight.jsx` `fetchSummaries` / `fetchMindMaps`: the predicate must test **both**
    "still mounted" and "newest request" (#164 + #165). Tests:
    `SidebarRight.summaryListOwnership.test.jsx`, `SidebarRight.orphanPoller.test.jsx`.
  - `SidebarLeft.jsx`: a late upload starts no poller **and** is still remembered (#160).
    Tests: `SidebarLeft.orphanUploadPoller.test.jsx`, `SidebarLeft.staleListResponse.test.jsx`.
  - `ChatArea.jsx`: every async path checks the attempt (#163), and the start screen from #161
    is intact. Tests: `ChatArea.attemptIdentity.test.jsx`, `ChatArea.reviewResumeCancel.test.jsx`.
  - `MainLayout.jsx`: lists start as "loading" (#165), the collapsed-panel fetch (#160), one
    theme button (#167).
  - `DocumentList.jsx`: the sidebar no longer carries state filters (#166) and the learning
    home is mounted (#172).
- [ ] Full Vitest and the production build on the result.
- [ ] Do not close, force-push or re-base a pull request you are not about to merge.

## Evidence (local trial integration, never pushed)

See "Trial integration" in `README.md` for the heads, test counts and the full Fixture Audit
result. Trial 5 merged #159-#184 in the order above (26 branches); the conflicts were the
playbook files, the one line in `MainLayout.jsx`, and the end of `index.css` (see step 6), and the
`index.css` brace was lost again by the union and restored by hand.

## Not covered by this checklist

- Deploy. Merging to `main` triggers the deploy workflow; that decision is the owner's.
- Firefox, WebKit, real devices and screen readers: not tested on any V6 branch.
