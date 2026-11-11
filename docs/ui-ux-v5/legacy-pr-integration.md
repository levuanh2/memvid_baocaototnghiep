# V4.1 legacy PR integration (#138–#147)

Date: 2026-11-11 · Main `d912419` · Sources: Codex Task 1 (`git cherry`, `merge-tree` and per-PR diffs) and agy Task 1 (docs track and screen inventory), re-checked against main.

**Rules:**
- No old PR is merged, closed or force-pushed.
- Each product fix is **reconstructed** on a fresh branch from current main, taking only its still-missing hunks, with an independent Draft PR.
- A PR is marked **PROPOSED SUPERSEDED** only with evidence of where every function and test lives on main. The owner decides whether to close it.

## Checklist (every PR stays on this list until the owner closes it)

- [ ] #138 Library / Review Guide microcopy: reconstruct → Draft PR
- [ ] #146 Mind-map marker hit-testing: product fix already on main; reconstruct the missing regression tests → Draft PR; propose superseding the product part
- [ ] #139 Mind-map viewport / depth microcopy: reconstruct the final wording → Draft PR
- [ ] #140 Knowledge-map header: reconstruct the breadcrumb, exits and export menu on top of main's `StudyShell` → Draft PR
- [ ] #142 Mobile-header proposal (docs): keep the research; drop the #126 duplicates → docs PR
- [ ] #144 Option A implementation plan (docs): keep the spec; implement in V5-B (12px provisional floor)
- [ ] #147 Mobile map fit options (docs): keep the evidence; final choice needs real-device validation and an owner decision
- [ ] New PRs since the audit: none found (re-check before each milestone)
- [x] Prerequisites #122, #126, #130 and #134 are already on main. `git cherry` shows no exact copies in the open branches. #146 contains a semantic duplicate of `838c9fe2` whose wording differs, which `git cherry` cannot detect.

## Matrix

| PR | Purpose | State, base → head | Behind / ahead of main | Overlap with main or V5 | Must preserve | Method | Owner decision |
|---|---|---|---|---|---|---|---|
| **#138** | Library and Review Guide labels say what they do | OPEN, mergeable but behind; `6cf0952` → `a06cbd3` | 21 / 4 | `DocumentList.jsx` (also touched by #150 CSS; no line overlap), `ReviewGuide.jsx`, `index.css` | `Xem gọn` density label, the auto-selected-document tooltip, `Tạo lại kế hoạch`, the `.pill-action[aria-pressed]` style, `libraryMicrocopy.test.js` (2 source-contract tests, CRLF-tolerant) | Reconstruct the 4-file final diff on a fresh branch | — |
| **#146** | Mind-map selection markers stay clickable above SVG paths | Draft, CONFLICTING; `2876bcf` → `66d2ccd` | 98 / 3 | `mindmap.css` (product rule **already on main** as `838c9fe2`), `marker-click-resolution.spec.js` | Real 390px zoom-out test (a painted relation path must not swallow a marker click or move the canvas), `visibleTargetDot`, the bounded 2-D empty-canvas search in `pan()` | **Product: PROPOSED SUPERSEDED** (evidence: `838c9fe2` + identical selectors on main). Reconstruct the test hunks only. | Close #146 after the test PR merges? |
| **#139** | Viewport button titles and depth-preset wording | Draft, CONFLICTING; `927cf88` → `bcc8878` | 117 / 2 | `MindElixirView.jsx` (only #139 touches it among open PRs; main changed it heavily since: #130 mobile fit, export, save) | Fit / Reset / Center distinctions: "Vừa khung: thu/phóng để thấy toàn bộ sơ đồ (F)", "Đặt lại khung nhìn: về 100% và căn giữa", "Căn giữa: đưa nút gốc vào giữa khung, giữ mức thu phóng"; depth 0 "Chỉ chủ đề trung tâm" (depth 1 is already on main) | Reconstruct the strings plus the matching assertions only. Do **not** take the stale `applyReadableFloor`, duplicate save button, old export-dialog test navigation or "Bản đồ chưa đầy đủ". | — |
| **#140** | Knowledge-map header: two named exits, real-title breadcrumb, one export menu | Draft, CONFLICTING; `4707cf3` → `355c08f` (30 files, mostly #122 history) | 115 / 1 | `StudyShell.jsx` (main added `stackActionsOnMobile`), `StudyBreadcrumb.jsx`, `StudyMapView.jsx` | Optional `documentLabel` in the breadcrumb with stem fallback; exits "Về Thư viện" and "Hỏi tài liệu này" via `duongDi(doc, "chat")`; mobile labels visually hidden but accessible; one ARIA export menu keeping PNG / transparent PNG / SVG, outside-click and Escape close, and focus return | Reconstruct by **combining** the breadcrumb prop with main's mobile layout (a cherry-pick stops on `StudyShell.jsx`) | — |
| **#142** | Mobile-header research for "Công cụ học" | Draft, mergeable but behind; `9d1bccb` → `5e173c9` (21 files) | 116 / 2 | Docs and evidence; only `09dd0f1` and `5e173c9` are unique, the rest is #126 history | Option A research and measurements | Docs PR with the 2 unique commits re-applied on a fresh branch | Option A was already selected |
| **#144** | Option A implementation plan | Draft, mergeable but behind; `927cf88` → `4929144` | 117 / 2 | 1 doc | Breakpoints 320–390 / 391–767 / 768–1100 / >1100; UsageChip moves into the "Công cụ học" menu | Fold into the V5-B spec | **Header text size:** 12px provisional minimum (owner, 2026-11-11), larger where it fits; to be confirmed on real browser geometry |
| **#147** | Mobile map fit alternatives | Draft, mergeable but behind; `927cf88` → `63469ea` (10 files) | 117 / 1 | Docs; main has the #130 fit (scale 0.50: root + first level) | Measured options, e.g. B = 0.75 readable priority branch (min label 9px, 28 host / 0 visible-dot overlaps) | Keep the evidence. A V5-D decision needs real-device checks of readable text, overlap, pan/zoom and touch selection, not simulation alone. | **Choose the fit strategy** after real-device validation |

## Integration order and dependencies

1. **#138 first.** It is isolated copy plus a source-contract test, with no dependency.
2. **#146 tests.** These only touch the e2e fixture. They must pass on main as-is, which proves the product fix is there.
3. **#139.** Strings in `MindElixirView.jsx`. The #146 tests must not break, since both concern map interaction.
4. **#140.** `StudyShell` / `StudyMapView` are independent of 1–3.
5. **Docs track (#142, #144, #147)** runs in parallel. It feeds V5-B (mobile header) and V5-D (map fit).

The unique feature hunks of the reconstructed commits do not overlap. The original open PR diffs do (for example #139 and #140 both list `MindElixirView.jsx`; in #140 that is inherited #122 history). The risk is historical: stale branch trees would revert later main work if merged.

## Per-PR result

| PR | Integration branch | Draft PR | CI | Final status |
|---|---|---|---|---|
| #138 | `integ/v41-138-library-microcopy` (`94f348e`) | #153 | pass | Vitest and lint pass. Fixtures 45 passed, 3 failed (round7 stale label, already failing on main; fixed by #151). Codex approve. Original PROPOSED SUPERSEDED, owner decides. |
| #146 | `integ/v41-146-marker-tests` (`ef52d45`) | #156 | pass | Vitest and lint pass. Fixtures 13/13; red-before 2 of 4 fail without the `838c9fe` CSS rule. Product part PROPOSED SUPERSEDED (on main as `838c9fe`). Codex approve. Original PROPOSED SUPERSEDED, owner decides. |
| #139 | `integ/v41-139-map-microcopy` (`5063e36`) | #154 | pass | Vitest and lint pass. Fixtures 41/41; rendered title test restored after Codex review. Codex approve. Original PROPOSED SUPERSEDED, owner decides. |
| #140 | `integ/v41-140-kmap-header` (`6f05c98`) | #155 | pass | Vitest and lint pass. Fixtures 11/11; breadcrumb test guards the prop chain. Codex approve. Original PROPOSED SUPERSEDED, owner decides. |
| #142 / #144 / #147 | `docs/v5-mobile-header-map-fit` | — | — | planned |
