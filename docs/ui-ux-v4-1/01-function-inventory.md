# 01. Function inventory

Source: `main` `ec4d1af` (frontend identical to production `studymap-build`
`2d283aa`: no `FE/` change since). Only components reachable from
`FE/src/App.jsx` routes count as LIVE. Line-level tables are in the appendix
files `_work/inv-*.md` (agent inventories, spot-checked; where they disagree
with this file, this file wins).

## 1. Screens and routes

| # | Route | Page component | Purpose | Auth |
|---|---|---|---|---|
| 1 | `/` | `pages/Landing.jsx` | Marketing, sign in / sign up | Public |
| 2 | `/login`, `/register` | `pages/Login.jsx`, `Register.jsx` | Sign in, sign up (local + NKS) | Public |
| 3 | `/app` (mode Trò chuyện) | `pages/Workspace.jsx` → `Layout/MainLayout.jsx` → `ChatArea.jsx` | Ask questions over selected sources, with evidence | Protected |
| 4 | `/app` (mode Sơ đồ tư duy) | `MainLayout` → `mindmap/MindElixirView.jsx`, `SidebarRight.jsx` | Editable mind map, Export Studio | Protected |
| 5 | `/app` (mode Tóm tắt) | `MainLayout` → `SummaryPane.jsx` | Read a generated summary with citations | Protected |
| 6 | `/app/study` | `pages/study/DocumentList.jsx` | Library: documents, collections, progress | Protected |
| 7 | `/app/study/map/:documentId` | `pages/study/StudyMapView.jsx` | Knowledge map (D3 tree) of one document | Protected |
| 8 | `/app/study/quiz/new?document=` | `QuizSetup.jsx` | Configure and generate a quiz | Protected |
| 9 | `/app/study/quiz/:quizId` | `QuizTaking.jsx` | Take a quiz | Protected |
| 10 | `/app/study/result/:attemptId` | `QuizResult.jsx` | Score, per-question review | Protected |
| 11 | `/app/study/review/:attemptId` | `ReviewGuide.jsx` | Review plan per weak topic | Protected |
| 12 | `/app/study/practice/:quizId` | `Practice.jsx` | Topic practice, before/after mastery | Protected |
| 13 | `/app/profile` | `ProfilePage.jsx` | Account details, avatar | Protected |
| — | overlays on every `/app/*` | `palette/CommandPalette.jsx` (Ctrl+K), `shortcuts/ShortcutsOverlay` (?) | Search and jump, shortcut list | Protected |

13 routes, 15 distinct screens (Workspace has 3 modes), 2 global overlays.

## 2. Function groups

| Group | Screens | Main functions |
|---|---|---|
| G1 Sources | Workspace left column, Library | Upload, select sources, filter, rename, delete, collections, favourite, pin, archive |
| G2 Ask (chat) | Workspace chat | Question, streaming answer, citations, evidence panel, image attach, history, clear context |
| G3 Mind map | Workspace map, Guided dialog | Create (Guided V3 or legacy V2), select map, edit, regenerate, save, depth presets, appearance |
| G4 Export | Export Studio dialog, StudyMap view | Scope (all / branch / ticked nodes / visible), format (PNG, WebP, PDF), appearance, file name |
| G5 Summary | Workspace summary | Create, open, cite sections |
| G6 Knowledge map | StudyMap view | Build, rebuild, layout, search, node detail, PNG/SVG export, presentation |
| G7 Quiz and learning | Quiz setup, taking, result, review guide, practice, Library dashboard | Generate quiz, take, submit, result, review plan, practice, mastery, progress |
| G8 Study tools | Header menu "StudyMap", right panel | AI tutor, timeline, knowledge explorer, evidence |
| G9 Account | Account menu, profile page | Profile, avatar, password (NKS), sign out, theme, AI usage |
| G10 Navigation | Header, palette, shortcuts | Mode switch, Library link, Ctrl+K, shortcuts |

## 3. Primary and secondary actions per screen (as rendered)

Evidence: `evidence/screens/<screen>__<width>__<theme>.jpg`, control lists in
`evidence/inventory/<screen>__{390,1440}__light.json` (every visible control,
region, accessible name, first 15–25 Tab stops).

| Screen | Primary action today | Secondary actions | Visible controls (1440 / 390) |
|---|---|---|---|
| Workspace chat | Send question (disabled until a source is selected) | Add document, select sources, new chat, chat options, evidence | 33 / 32 |
| Workspace chat, no documents | "Thêm tài liệu" (left column) | — | 20 / 19 |
| Workspace map | none (map shown) | Map selector, Tạo lại, Giao diện, Xuất, overflow (Lưu, depth, view) | 41 / 40 |
| Workspace summary | "Tạo tóm tắt" (**does nothing**, see 03 §1) | — | 29 / 26 |
| Export Studio | "Xuất PNG" | Tiếp tục, Hủy, quick formats, 4 scopes, Nâng cao, 3 steps | 86 / 84 |
| Library (flag OFF, production) | "Tải tài liệu" + one "Tiếp tục · …" per card | Xem thử, search, sort, Lọc, Đủ, collections, per card: Tóm tắt, Sơ đồ, Quiz, Ôn tập, Hỏi AI, Chi tiết, ⋮ | 231 / 224 (26 cards for 6 documents) |
| Library (flag ON, test build only) | "Bắt đầu · …" per row | task tabs, Tóm tắt / Sơ đồ tư duy icon buttons, Thêm | ≈ 60 |
| Knowledge map | Dựng / Dựng lại | Về nguồn, search, layout, PNG, PNG trong suốt, SVG, Trình chiếu | 12 |
| Quiz setup | Tạo quiz | count, difficulty, types, scope | 16 |
| Quiz taking | Nộp bài | Nộp bài sớm, question nav, answers | 15 / 8 |
| Quiz result | "Xem lại N câu cần ôn" | Kế hoạch ôn tập | 3 |
| Review guide | "Luyện ngay (5 câu)" per topic | Tùy chỉnh, Viết lại | 6 |
| Practice | Nộp bài | Kế hoạch ôn | 13 |
| Profile | none | Quay lại (avatar change for NKS accounts) | 1 |

## 4. LIVE vs not mounted vs flagged

| Item | State | Evidence |
|---|---|---|
| `Layout/ModeLibraryMenu.jsx` (map and summary library: list, select, create) | **NOT MOUNTED** since commit `99258df` (2026-10-04); no importer | `git show 99258df -- FE/src/components/Layout/MainLayout.jsx` |
| Right panel tab row (Bằng chứng / Gia sư AI / Dòng thời gian / Kiến thức) and legacy artifact block (generate, list, delete maps and summaries) | NOT MOUNTED: `legacyInspectorSurfacesEnabled = false` | `SidebarRight.jsx:32`, `:918`, `:1089` |
| `mindmap/EvidenceDrawer.jsx`, `knowledgeParts` `EvidenceCard` | NOT MOUNTED | appendix A3 |
| `dev/*`, `fixtureHarness.jsx`, `r71qa.jsx`, `round6LibraryQa.jsx`, `*.testonly.jsx` | QA harness only | not in `App.jsx` chain |
| Library Action Matrix (`LibraryTaskViews`, `StudyDocumentActionRow`, `DocumentToolsSheet`) | Flag `VITE_LIBRARY_ACTION_MATRIX`; OFF in production | `utils/libraryActionMatrixFlag.js`; screens `library__*__flagon.jpg` (local test build) |
| Guided mind map V3 dialog | Server capability `GET /mindmaps/capability` → `guided_mindmap_v3`; compose default `GUIDED_MINDMAP_V3_ENABLED=false` | `BE/app/main.py:5568`, `docker-compose.prod.yml:22` |
