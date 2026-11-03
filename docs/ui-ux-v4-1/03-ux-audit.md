# 03. UX audit by screen

How the evidence was made (`evidence/README.md`): the real app ran on the
Vite dev server with the API mocked at the network layer; no production
account, data or API call. 15 screens and 5 open-menu states × 5 widths
(320, 390, 768, 1024, 1440) × light and dark = 200 screenshots, plus the
Library with the flag ON (30, local test build only), plus 8 targeted
click-through checks. Production itself was not logged into (no authorised
test account was provided), so anything that depends on production data or
server flags is marked NOT VERIFIED.

Severity: **P0** blocks a main task or misleads into a wrong action; **P1**
causes hesitation, extra steps or lost context; **P2** polish.

## 1. Workspace: Summary mode (P0)

- **Creating a summary is impossible in Workspace.** After selecting a source,
  "Tạo tóm tắt" is enabled; clicking it sends no request and changes nothing.
  Evidence: `verify-cta__summary__enabled.json` (`nonGetCalls: []`,
  `dialogs: []`), `screens/verify-cta__summary__capability-enabled__after-click.jpg`.
  Cause: `WorkspaceEmptyState` → `MainLayout.onSummaryAction` →
  `openArtifact("summary")`; the only generator (`SidebarRight`
  `handleGenerateSummary`) is exported as `summaryActions.create`
  (`SidebarRight.jsx:890-897`) and stored in `MainLayout.jsx:301`, but no
  mounted component calls it.
- **Opening an existing summary is impossible in Workspace.** With a saved
  summary for the selected source, Summary mode still says "Chưa có tóm tắt".
  Evidence: `verify-summary__existing__workspace.json`. The summary list and
  `select` action have no mounted consumer either.
- Regression: commit `99258df` (2026-10-04, "consolidate contextual toolbar
  ownership") removed `ModeLibraryMenu` from the header. The mind map got a
  replacement selector inside its toolbar; Summary did not. The frontend in
  production (`2d283aa`) contains this commit.
- Coming from the Library does not help: the card's "Tóm tắt" opens
  `/app?source=…` in **chat** mode (D04, `verify-summary__library-card.json`).
- NOT VERIFIED on production data: whether any other path (for example an old
  browser tab with a running summary job) still opens a summary. The code
  path for a finished job (`handleSummaryDone`) does open it.

## 2. Workspace: Mind map mode

- **P0 (conditional).** With no map yet and the Guided capability off, the only
  create button ("Tạo sơ đồ tư duy", centre) does nothing
  (`verify-cta__mindmap__disabled.json`). With Guided on, it opens the Guided
  dialog correctly. `docker-compose.prod.yml` documents
  `GUIDED_MINDMAP_V3_ENABLED` default `false`, and the capability is also off
  when the worker is unhealthy (`BE/app/main.py:5568-5585`). Production's
  value is NOT VERIFIED (needs a signed-in `GET /mindmaps/capability`).
- P1: toolbar mixes states and actions in one row: "Sơ đồ cũ · Nâng cấp"
  warning, "Tạo lại", "Đã lưu", "Giao diện", "Xuất", overflow
  (`workspace-map__1440__light.jpg`). "Tạo lại" is larger text than its
  neighbours. Save lives only in the overflow menu.
- P1: at 390 px the map opens at 75 % with branches cut off on both sides
  (`workspace-map__390__dark.jpg`); "Vừa khung" exists but is not applied on
  first open.
- P2: depth labels "Chỉ chủ đề chính" (= root only) and "Hiện 1 tầng nhánh"
  read the wrong way round (D24).

## 3. Export Studio

- P1: three ways to drive one dialog at the same time: a 3-step rail (Nội
  dung, Trình bày, Kiểm tra), quick presets (Ảnh PNG, PDF học tập, Ảnh WebP)
  and the full scope list, then a footer with "Tiếp tục", "Hủy" and "Xuất PNG"
  (`workspace-map-export__1440__light.jpg`). Users see two forward buttons.
- P1: the preview is a generic placeholder ("CHỦ ĐỀ" with four empty boxes,
  "Sơ đồ minh họa"), not the user's map, although the dialog says "Xem trước
  bản xuất".
- P1: at 390 px the header AI-usage indicator is drawn on top of the dialog
  header, next to its close button (`workspace-map-export__390__light.jpg`).
- P2: "Áp dụng cho sơ đồ" saves appearance to the server inside an export
  dialog (D17).
- Kept: exact-node and branch scopes, "Chọn trên canvas" hand-off, file-name
  step. These carry the R8 exact-selection semantics and must not change.

## 4. Workspace: Chat and shell

- P1: the header "StudyMap ▾" button is the product name used as a menu
  label; at ≤ 1023 px it is a bare chevron (`workspace-chat__390__light.jpg`).
  It is the only visible way to the AI tutor, timeline and knowledge views,
  because the right panel's own tab row is not mounted
  (`SidebarRight.jsx:32`, `:918`).
- P1: chat empty state says "Chọn tài liệu bên trái" on phones, where there
  is no left column (`workspace-chat__390__light.jpg`); a new user with no
  documents sees the question box but no upload call to action in the centre
  (`workspace-chat-empty__1440__light.jpg`; the only CTA is in the left
  column).
- P1: three different words for the same place: logo "MemVidX", menu
  "StudyMap", eyebrow "Phòng đọc"; Library pages use "STUDYMAP · Thư viện học
  tập" (D33).
- P2: the right panel's empty evidence state is a large empty column at
  1440 px before the first question.
- Kept: three-mode switch (Trò chuyện / Sơ đồ tư duy / Tóm tắt), source
  checkboxes, evidence panel, header usage indicator.

## 5. Library (`/app/study`)

Production (flag OFF):

- P1: 6 documents render as 26 cards in 7 overlapping sections; one document
  appears 5 times (D06, `library__1440__light.json`).
- P1: every card carries readiness chips and action buttons with the same
  words, plus a "Tiếp tục · X" button that duplicates button X (D07, D08).
- P1: "Sơ đồ" on the card opens the knowledge map, while the chip beside it
  says "Sơ đồ tư duy" and another says "Bản đồ học tập" (D05).
- P1: at 320 and 390 px the header hides the page title behind the upload
  button, and "Xem thử" is cut off at the right edge
  (`library__320__light.jpg`, `library__390__light.jpg`).
- P2: "Đủ" (density toggle) and "Xem thử" (open a demo document) are unclear
  labels; "Đang yếu ở" cards show only a number and a status word.
- P2: empty library shows its CTA as plain text under the hint
  (`library-empty__1440__light.jpg`); the header button is the real CTA.

Test build (flag ON, never production):

- Task tabs (Tất cả / Tiếp tục học / Cần quiz / Cần tóm tắt) replace the
  repeated sections: this directly fixes D06.
- P1 for the rollout: the row's "Thêm" button sits outside the row border at
  1440 px, and the arrow icon wraps above the label in "Bắt đầu · Tóm tắt"
  (`library__1440__light__flagon.jpg`). Row 4.6 of the screen-reader checklist
  is still open (Round 8.6).

## 6. Knowledge map (`/app/study/map/:id`)

- P1: two exits with unclear targets, "← Tài liệu" and "Về nguồn" (D22); the
  breadcrumb shows the raw file stem ("tai-lieu-1 › Sơ đồ").
- P1: export here is four inline buttons (PNG, PNG trong suốt, SVG, Trình
  chiếu) with a different engine and options from Export Studio (D21).
- P2: dense toolbar line mixing a help sentence ("Ctrl + lăn để phóng…"),
  zoom, search, layout and export (`studymap__1440__light.jpg`).

## 7. Quiz, result, review, practice

- Good: one clear primary action per screen (Tạo quiz, Nộp bài, "Xem lại 2 câu
  cần ôn", "Luyện ngay (5 câu)").
- P1: the next step after a quiz is split: the result's main button reviews
  wrong answers, the review plan is a secondary header button, and practice
  starts only inside the plan (`quiz-result__1440__light.jpg`,
  `review-guide__1440__light.jpg`). There is no "Làm lại quiz" (appendix A4).
- P1: four kinds of percentage near each other (score, coverage, readiness,
  mastery) without units (D32); "Hôm nay / Ngày mai / Sau" suggest a schedule
  that does not exist (D31).
- P2: quiz setup's scope list looks like plain text (no visible checkbox until
  focused) (`quiz-setup__1440__light.jpg`); "Viết lại" means regenerate the
  plan.

## 8. Account

- P2: the profile page shows read-only fields for local accounts; the
  provider line reads "Đăng nhập qua StudyMap" (`profile__1440__light.jpg`).
  Avatar and password changes exist only for NKS accounts.
- P2: theme lives in the header (desktop) and in the tools menu (mobile), not
  in the account menu where users often look for it.

## 9. Accessibility risks found (not a screen-reader result)

These are DOM checks, not NVDA or Narrator results; S1–S4 remain the
acceptance gate.

- The Workspace "Chọn tất cả tài liệu sẵn sàng" checkbox has no programmatic
  name (visible text is not a `<label>`); the chat box relies on its
  placeholder (`evidence/capture/` unlabeled dump).
- Icon-only header controls below 1024 px depend on `aria-label` only; the
  "StudyMap" menu trigger becomes a chevron with the name "Mở công cụ
  StudyMap" (fine for screen readers, unclear visually).
- No horizontal page overflow at any captured width (`overflowX = 0` in all
  inventory files), but the Library header clips content inside itself at
  320/390.

## 10. Coverage

| Flow | Covered | How |
|---|---|---|
| Workspace Chat / Map / Summary | Yes | screens, CTA click-through |
| Document Library (flag OFF and ON) | Yes | screens, control inventory |
| MindMap creation and editing | Partly | creation CTA verified; editing (drag, rename node) read from code only |
| Export Studio | Yes (open state, scopes) | screens; export output not re-run (covered by Round 8 Fixture Audit 449/449) |
| Quiz journey, ReviewGuide, Practice | Yes | screens with mocked data |
| Learning progress | Partly | Library dashboard screens; dashboard internals from code |
| Profile / settings | Yes (local account) | NKS account variant from code only |
| Desktop and mobile navigation | Yes | 5 widths, menus open |
| Real production data, slow network, errors | NOT VERIFIED | needs an authorised test account |
| Keyboard | Partly | first 15–25 Tab stops per screen in inventory JSON; full keyboard pass is S1/S2 |
