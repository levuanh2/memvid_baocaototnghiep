# 06. Implementation roadmap (for approval; nothing implemented)

Each line is one small PR, revertible on its own. Visual polish is never mixed
with structural changes. Every PR that touches `FE/` triggers a Render
frontend deploy after merge, so each one is also the next observation for the
Round 8.6 frontend deploy-order gate.

Regression gates for every PR: `CI / required` green (unit, fixture smoke,
e2e critical flows); for PRs touching map, export or Library, also a Full
Fixture Audit run (`workflow_dispatch`, 449 tests today); Library flag stays
OFF in production; no backend contract change unless stated.

## P0: broken or misleading main tasks

| PR | Change | Impact | Effort | Risk | Depends on | Files | Tests required | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|
| P0-1 | Summary selector + working "Tạo tóm tắt" in the reading room (B1) | High: restores a whole mode | M | Low | — | `MainLayout.jsx`, `SummaryPane.jsx`, new small selector | unit: CTA calls create once; selector lists and opens; fixture: summary mode open + create job mocked | With a source selected, "Tạo tóm tắt" sends one `POST /generate-summary`; an existing summary opens from the selector; keyboard and Escape work in the selector |
| P0-2 | Centre "Tạo sơ đồ tư duy" uses the toolbar's create path (B2) | High when Guided is off | S | Low | — | `MainLayout.jsx`, `SidebarRight.jsx` | unit for enabled / disabled / loading capability | Guided on: dialog opens; off: legacy job starts; loading: intent parked once, no double job |
| P0-3 | Library links carry `tab` (B3) | High: buttons open what they say | S | Very low | — | `utils/tiepTucHoc.js` | `tiepTucHoc.test.js` cases for summary and mindmap | Card "Tóm tắt" lands in Summary mode with the source selected; "Hỏi AI" still lands in chat |
| P0-0 | (owner) confirm production Guided capability | Decides P0-2 urgency | — | — | signed-in read | — | — | `GET /mindmaps/capability` result recorded |

## P1: simplification

| PR | Change | Impact | Effort | Risk | Depends on | Files | Tests | Acceptance |
|---|---|---|---|---|---|---|---|---|
| P1-1 | One name per map (B4), one upload label, "Công cụ học" | High clarity | S | Low (copy) | O1, O2 | card, tools sheet, filters, StudyMapView, palette, shortcuts | label assertions updated | No screen shows bare "Sơ đồ" or "Bản đồ học tập"; upload reads "Tải tài liệu lên" everywhere |
| P1-2 | Right-panel tab row visible; split `legacyInspectorSurfacesEnabled` (B7) | Medium | M | Medium | P1-1 | `SidebarRight.jsx`, `MainLayout.jsx` | `SidebarRight.legacyInspectorFlag.test.jsx`, new tab-row test | Tutor, timeline, knowledge reachable from the panel itself; legacy artifact block still not rendered |
| P1-3 | Library rollout readiness: fix "Thêm" overflow and button wrap (flag ON only) | Unblocks B5 | S | Low | — | `StudyDocumentActionRow.jsx`, `libraryActionMatrix.css` | `round6-library-action-matrix.spec.js` at 1024/1440 | Every control inside its row at 320–1440 |
| P1-4 | Library rollout (B5) | High | — | Medium | P1-3, checklist row 4.6 (both readers), owner O3 | env only | Fixture Audit with flag ON | Separate release decision, as set in Round 8.6 |
| P1-4b | If O3 = not yet: interim flag-OFF list (one "Tiếp tục học" + one list) (B5) | High | M | Medium | O3 | `DocumentList.jsx` | DocumentList behaviour tests | Each document appears once per page |
| P1-5 | Card actions without duplicate chips (B6) | Medium | S | Low | skip if P1-4 ships | `StudyCard.jsx` | card unit tests | Six actions, no chip row, no duplicate of the "Tiếp tục" target |
| P1-6 | Export Studio footer and appearance save (B8) | Medium | M | Medium | — | `ExportStudioDialog.jsx` | `export-studio.spec.js`, exact-node and branch export specs, Fixture Audit | Footer has two buttons; scopes and exact-node output unchanged (byte-level fixture checks pass) |
| P1-7 | Mobile copy and header fixes (B9) | Medium on phones | S | Low | — | `ChatArea.jsx`, Library header, usage chip z-index | `mobile-header*.spec.js`, `responsive.spec.js` | At 320/390: Library title visible, no clipped button, chat hint names the button; usage chip under modals |
| P1-8 | Quiz result next step, units on percentages, queue bucket names (B10) | Medium | S | Low | — | `QuizResult.jsx`, `LearningDashboard.jsx`, `reviewQueue.js` | `QuizResult.round7.test.jsx` | Primary CTA is the plan when wrong answers exist; every % has a unit word |
| P1-9 | Palette "Mở Gia sư AI" opens the tutor; Alt+S label (D14, D15); remove duplicate "Hỏi AI về khái niệm này" (D25); remove hidden "Lưu" (D16) | Low–medium | S | Low | — | `CommandPalette.jsx`, `keyboardShortcuts.js`, `KnowledgeInspector.jsx`, `MindElixirView.jsx` | palette and shortcut tests | Labels match outcomes |

## P2: polish

| PR | Change | Effort | Files | Acceptance |
|---|---|---|---|---|
| P2-1 | Microcopy: "Đủ", "Xem thử", "Viết lại", depth labels (D24), viewport tooltips (D23) | S | Library header, ReviewGuide, MindElixirView | Every label states its effect |
| P2-2 | Map first open fits the screen on phones | S | `MindElixirView.jsx` | Root and first-level branches visible at 320/390 |
| P2-3 | Knowledge map header: "Về Thư viện" / "Hỏi tài liệu này", readable breadcrumb, export menu (D21, D22) | S | `StudyMapView.jsx` | Two clearly named exits; title instead of file stem |
| P2-4 | Empty states: centre upload CTA, Library empty CTA as a button | S | `ChatArea.jsx`, `DocumentList.jsx` | Each empty state has one button for the next step |
| P2-5 | Select-all checkbox label, chat box label (a11y) | S | `SidebarLeft.jsx`, `ChatArea.jsx` | Both have programmatic names; S1/S2 rows still the acceptance |
| P2-6 | Product name decision applied (O1) | S | header, Library eyebrow, profile | One product name on every screen |

## Order

P0-0 → P0-3 → P0-1 → P0-2 → P1-1 → P1-7 → P1-8 → P1-9 → P1-6 → P1-2 →
(P1-3 → P1-4 or P1-4b, P1-5) → P2.

Reason: the three P0 fixes are small and restore broken flows; renames come
next because later PRs and tests depend on the final words; Export Studio
and the right panel touch the most tested code, so they go after the cheap
wins; the Library rollout waits for its own owner decision.
