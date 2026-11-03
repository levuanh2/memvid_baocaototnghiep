# 07. V4.1 PR roadmap after owner approval (2026-11-03)

Supersedes the order in `06` where they differ. Approved decisions: StudyMap as
the only product name; "Sơ đồ tư duy" (editable map) and "Bản đồ kiến thức"
(document structure, `/app/study/map/:id`); header menu "Công cụ học"; upload
"Tải tài liệu lên"; Library Action Matrix is the target but its flag stays OFF
until W4 gates pass and the owner approves separately; right-panel tab row
restored, legacy artifact block stays off; Quiz Result with wrong answers:
"Kế hoạch ôn tập" primary, "Xem lại câu sai" secondary, no grading change;
removals limited to D16, D25 and (after W4-3) D06.

Draft from AGY: `_work/v41-roadmap-draft-agy.md` (raw; corrected here).

## P0 hotfixes

| PR | Fix | Merge order |
|---|---|---|
| #118 | P0-1 Summary mode create/open (`SummaryPicker`, `summaryActions`, double-start guard) | **merged** 2026-11-03T11:54:00Z as `e3823df` |
| #117 | P0-3 Library / Palette open the named Workspace mode (`?tab=`, also in-app) | open, ready; branch updated with `e3823df` |
| #119 | P0-2 Mind-map empty-state create never dead-ends | open (Draft); branch updated with `e3823df` |

Frontend deploy-order gate (Round 8.6 gate 6), first observation, merge of
#118 (`e3823df`): `CI / required` success 12:01:10Z; Render deploy created
12:01:14.7Z for `e3823df` (trigger `new_commit`), live 12:02:07Z; no older SHA
deployed afterwards; `studymap-build` and `/health` both `e3823df`. PASS.

After the three merge: Full Fixture Audit on the resulting `main` SHA, and the
frontend deploy-order observation (Round 8.6 gate 6) for each FE merge.

## Rules for every V4.1 PR

One concern per PR; copy/visual PRs never carry structural changes; each PR has
a regression test that fails when reverted; `CI / required` green; PRs that
touch map, export or Library also get a Full Fixture Audit run before merge.
Every merge touching `FE/` is recorded against the deploy-order gate.

## Wave 1: user clarity

| ID | Branch | Scope | Main files | Depends | Risk | Tests | Acceptance |
|---|---|---|---|---|---|---|---|
| W1-1 | `v41/w1-map-names` | Two map names everywhere (card, chips, tools sheet, filters, page title, palette, shortcuts, `BE_MAT` labels) | `StudyCard.jsx`, `DocumentToolsSheet.jsx`, `DocumentList.jsx`, `StudyMapView.jsx`, `tiepTucHoc.js`, `CommandPalette.jsx`, `keyboardShortcuts.js` | P0s | Low | label tests + a grep test that "Bản đồ học tập" and bare "Sơ đồ" labels are gone | No screen shows "Bản đồ học tập", "Sơ đồ kiến thức" or a bare "Sơ đồ" |
| W1-2 | `v41/w1-tools-upload-labels` | "Công cụ học" (header menu, visible label also on phones), "Tải tài liệu lên" (left column, Library, palette) | `MainLayout.jsx`, `StudyToolsMenu.jsx`, `SidebarLeft.jsx`, `DocumentList.jsx`, `CommandPalette.jsx` | W1-1 | Low | `StudyToolsMenu.test.jsx`, `mobile-header.spec.js` (names, 40×40 targets) | Menu trigger has a visible label at 320 px; one upload label |
| W1-3 | `v41/w1-branding` | StudyMap as the only product name (logo text, page titles, profile provider line); "Phòng đọc" / "Thư viện" as place names | `MainLayout.jsx`, `StudyShell.jsx`, `ProfileView.jsx`, `index.html` title | W1-1 | Low | header and profile tests | No "MemVidX" in rendered UI |
| W1-4 | `v41/w1-mobile-empty-states` | Viewport-aware chat hint (button "Mở thư mục nguồn" on phones); centre "Tải tài liệu lên" when no documents | `ChatArea.jsx`, `WorkspaceEmptyState.jsx` | — | Low | `ChatArea.*.test.jsx`, fixture at 320/390 | New user sees one upload button in the centre; no "bên trái" text on phones |
| W1-5 | `v41/w1-library-header-mobile` | Library header at 320/390: title visible, upload full width, "Xem thử" into overflow | `DocumentList.jsx`, `StudyShell.jsx` | — | Low | `responsive.spec.js`, new header-clip check | Title and all header buttons inside the viewport at 320 |

## Wave 2: learning journey

| ID | Branch | Scope | Main files | Depends | Risk | Tests | Acceptance |
|---|---|---|---|---|---|---|---|
| W2-1 | `v41/w2-result-next-step` | With wrong answers: primary "Kế hoạch ôn tập (N chủ đề)", secondary "Xem lại câu sai"; all correct: primary back to Library | `QuizResult.jsx` | — | Low | `QuizResult.round7.test.jsx` (pending/provisional cases unchanged) | Score, grading, mastery untouched; pending results still hide scores |
| W2-2 | `v41/w2-percent-units` | Each percentage names its unit (câu đúng / mức nắm / đã có / sẵn sàng) | `LearningDashboard.jsx`, `QuizResult.jsx`, `Practice.jsx` | W2-1 | Low | dashboard and result tests | No bare % next to another % of a different kind |
| W2-3 | `v41/w2-queue-labels` | "Hôm nay / Ngày mai / Sau" → "Ôn ngay / Ôn sớm / Ôn sau" | `LearningDashboard.jsx`, `reviewQueue.js` | — | Low | `reviewQueue.test.js` | No date wording without a schedule |

## Wave 3: workspace simplification

| ID | Branch | Scope | Main files | Depends | Risk | Tests | Acceptance |
|---|---|---|---|---|---|---|---|
| W3-1 | `v41/w3-palette-actions` | "Mở Gia sư AI" opens the tutor view; Alt+S label; palette surface actions select the document's source on `/app` too | `CommandPalette.jsx`, `keyboardShortcuts.js`, `Workspace.jsx` | #117 | Low | palette tests + fixture | Every palette action does what its label says |
| W3-2 | `v41/w3-remove-duplicates` | Remove hidden duplicate "Lưu" (D16) and "Hỏi AI về khái niệm này" (D25) | `MindElixirView.jsx`, `KnowledgeInspector.jsx` | — | Low | existing MindElixir and inspector tests | Save and ask still reachable from their remaining controls |
| W3-3 | `v41/w3-export-footer` | Footer "Hủy" + "Xuất <định dạng>"; "Áp dụng cho sơ đồ" moved to the appearance step as "Lưu giao diện cho sơ đồ" | `ExportStudioDialog.jsx` | — | Medium | `export-studio.spec.js`, exact-node / exact-branch / multi-branch export specs, Full Fixture Audit | Export output byte-identical on fixture checks; two footer buttons |
| W3-4 | `v41/w3-right-panel-tabs` | Split `legacyInspectorSurfacesEnabled`; show the tab row (Bằng chứng, Gia sư AI, Dòng thời gian, Kiến thức); legacy artifact block stays off; mobile menu keeps labelled entries | `SidebarRight.jsx`, `MainLayout.jsx`, `StudyToolsMenu.jsx` | W1-2 | Medium | `SidebarRight.legacyInspectorFlag.test.jsx`, new tab-row test, `MainLayout.guided*` tests | Tools reachable from the panel itself; no artifact list/generate UI returns |
| W3-5 | `v41/w3-card-menu-a11y` | Library card ⋮ menu: `aria-haspopup`, `aria-expanded`, `role="menu"`/`menuitem`, Escape returns focus | `StudyCard.jsx` | — | Low | new unit test + fixture | Screen reader announces a menu (checked again in S1/S2) |

## Wave 4: Library rollout readiness (flag stays OFF in production)

| ID | Branch | Scope | Main files | Depends | Risk | Tests | Acceptance |
|---|---|---|---|---|---|---|---|
| W4-1 | `v41/w4-matrix-responsive` | Fix "Thêm" outside the row at 1440 and the wrapped arrow in "Bắt đầu · …" | `StudyDocumentActionRow.jsx`, `libraryActionMatrix.css` | — | Low | `round6-library-action-matrix.spec.js` at 320–1440, flag ON | Every control inside its row at all five widths |
| W4-2 | `v41/w4-matrix-a11y` | Keyboard order and names in rows and the tools sheet; checklist row 4.6 prepared for NVDA/Narrator in a flag-ON test build | `StudyDocumentActionRow.jsx`, `DocumentToolsSheet.jsx`, `LibraryTaskViews.jsx` | W4-1 | Medium | matrix spec keyboard cases | Row 4.6 run by a person in both readers (human gate) |
| W4-3 | (no code) | Owner approval, then flag ON with a rollback plan (env var revert + rebuild); afterwards remove the repeated flag-OFF sections (D06) in a separate PR | env, later `DocumentList.jsx` | W4-1, W4-2, S1/S2 row 4.6 | Medium | Full Fixture Audit with flag ON | Separate written owner approval |

## Wave 5: polish

| ID | Branch | Scope | Main files | Risk | Acceptance |
|---|---|---|---|---|---|
| W5-1 | `v41/w5-microcopy` | "Đủ", "Xem thử", "Viết lại", depth labels (D24), viewport tooltips (D23) | Library header, `ReviewGuide.jsx`, `MindElixirView.jsx` | Low | Each label states its effect |
| W5-2 | `v41/w5-knowledge-map-header` | "Về Thư viện" / "Hỏi tài liệu này", title instead of file stem in breadcrumb, one export menu | `StudyMapView.jsx`, `StudyBreadcrumb.jsx` | Low | Two clearly named exits |
| W5-3 | `v41/w5-map-fit-mobile` | Fit the mind map on first open at 320/390 | `MindElixirView.jsx` | Low | Root and first level visible |
| W5-4 | `v41/w5-a11y-labels` | Select-all checkbox and chat box names; usage chip below modals | `SidebarLeft.jsx`, `ChatArea.jsx`, `UsageChip.jsx` CSS | Low | Programmatic names present; chip never over a dialog |
| W5-5 | `v41/w5-spacing` | Spacing and hierarchy pass on the screens above, no behaviour change | CSS only | Low | Visual diff reviewed per screen |

## Approvals needed before each wave

- Merge of #118, #117, #119 (order above), then the Fixture Audit run.
- Wave 1 copy (exact strings) before W1-1.
- W3-3 Export Studio footer and W3-4 right panel: owner review of the before/after screenshots in their PRs.
- W4-3 Library flag: separate written approval after W4-1, W4-2 and row 4.6 in S1/S2.
