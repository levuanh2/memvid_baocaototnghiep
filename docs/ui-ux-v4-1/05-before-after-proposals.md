# 05. Before / after proposals

Wireframes are text sketches for review; no production code was changed.

## B1. Summary mode works again (P0)

- **Current:** "Tạo tóm tắt" does nothing; saved summaries cannot be opened in
  the reading room (`03` §1).
- **Evidence:** `screens/verify-cta__summary__capability-enabled__after-click.jpg`,
  `inventory/verify-cta__summary__enabled.json`,
  `inventory/verify-summary__existing__workspace.json`.
- **Proposed:** a summary selector in the summary toolbar, mirroring the map
  selector that `99258df` added for mind maps, plus wiring the centre CTA to
  the existing `summaryActions.create`.

```
Before                               After
┌ Tóm tắt ───────────────────────┐   ┌ [≡ Tóm tắt: Hệ điều hành ▾]  Tạo lại ┐
│        Chưa có tóm tắt         │   │  ▸ Tóm tắt: Hệ điều hành   2/11       │
│        [ Tạo tóm tắt ] (dead)  │   │  ▸ Tóm tắt: Mạng máy tính  1/11       │
└────────────────────────────────┘   │  + Tạo tóm tắt mới                    │
                                     └───────────────────────────────────────┘
```

- **Why:** a whole mode is unusable; the backend and job flow already work.
- **Journey impact:** restores Upload → Summary.
- **Risk:** low; reuses `SidebarRight` job flow (poller, cancel, resume).
- **Scope:** `MainLayout.jsx`, `SummaryPane.jsx` (toolbar), maybe a small
  `SummarySelector` modelled on the map selector in `MindElixirView.jsx`.

## B2. Create mind map never dead-ends (P0, conditional)

- **Current:** with Guided off and no map, the centre CTA does nothing.
- **Evidence:** `verify-cta__mindmap__disabled.json`.
- **Proposed:** the centre CTA calls the same create path as the toolbar's
  "Tạo sơ đồ mới" (`handleGenerateMindMap`, Guided when enabled, legacy V2
  otherwise, parked intent while loading).
- **Risk:** low; touches the Guided capability gate covered by
  `SidebarRight.guidedCapabilityPending.test.jsx`.
- **Scope:** `MainLayout.jsx` (`onMindmapAction`), `SidebarRight.jsx` (expose
  the create action, already in `mindMapActions`).

## B3. Library buttons open the right mode (P0)

- **Current:** card "Tóm tắt" and (flag ON) "Sơ đồ tư duy" open chat mode.
- **Evidence:** `verify-summary__library-card.json` → `/app?source=tai-lieu-1`.
- **Proposed:** `duongDi` adds `tab=summary` / `tab=mindmap`; Workspace already
  reads `tab` (`MainLayout.jsx:108`).
- **Risk:** very low; one function with unit tests (`tiepTucHoc.test.js`).
- **Scope:** `utils/tiepTucHoc.js`.

## B4. One name per map (P1)

- **Current:** "Sơ đồ", "Sơ đồ tư duy", "Bản đồ học tập", "Sơ đồ kiến thức"
  for two features (D05).
- **Proposed:** "Sơ đồ tư duy" = editable map in the reading room; "Bản đồ
  kiến thức" = structure tree of one document. Card button, chip, tools sheet,
  page title, filter, palette and shortcut list use exactly these two.
- **Risk:** copy only; tests that assert labels need updating.
- **Scope:** `StudyCard.jsx`, `DocumentToolsSheet.jsx`, `DocumentList.jsx`
  filters, `StudyMapView.jsx`, `tiepTucHoc.js` labels, `keyboardShortcuts.js`,
  `CommandPalette.jsx`.

## B5. Library: one list, not seven sections (P1)

- **Current (production):** 26 cards for 6 documents (D06).
- **Proposed:** ship the Library Action Matrix (task tabs, one row per
  document). This is a rollout decision (O3), not new design. Before rollout:
  fix the "Thêm" overflow at 1440 px and the wrapped arrow in "Bắt đầu ·
  Tóm tắt" (`library__1440__light__flagon.jpg`), and close checklist row 4.6.
- If the owner keeps the flag OFF for now, interim fix: show "Tiếp tục học"
  plus one "Tất cả tài liệu" list; move the other five sections into a filter.

```
Before (flag OFF)                     After (flag ON)
TIẾP TỤC HỌC  [card A]                [Tất cả 6][Tiếp tục 1][Cần quiz 4][Cần tóm tắt 3]
HÔM QUA       [card A]                ☐ A  PDF·12′  Tóm tắt ✓ Quiz –   [Bắt đầu · Tóm tắt] ⋯
TẢI LÊN GẦN   [A][B][C][D][E][F]      ☐ B  …
CHƯA MỞ       [B][C][D][E][F]
CẦN TÓM TẮT   [A][C][E]
CẦN QUIZ      [C][D][E][F]
TẤT CẢ        [A][B][C][D][E][F]
```

## B6. Card actions: one row, readiness on the button (P1, flag OFF only)

- **Current:** chips and buttons repeat the same six words; "Tiếp tục · Hỏi
  AI" sits next to "Hỏi AI" (D07, D08).
- **Proposed:** drop the chip row; each action button shows a small tick when
  ready; hide the secondary button that equals the "Tiếp tục" target.
- **Scope:** `StudyCard.jsx`. Skip if B5 rollout happens first.

## B7. Study tools are visible where they live (P1)

- **Current:** AI tutor, timeline and knowledge are reachable only through the
  "StudyMap ▾" menu (chevron only on phones); the right panel's tab row is
  disabled (`legacyInspectorSurfacesEnabled = false`).
- **Proposed:** enable only the tab row (not the legacy artifact block) and
  rename the header menu "Công cụ học"; on phones keep the menu, label it.
- **Risk:** medium; the flag also guards the legacy artifact block, so split
  the flag first. Re-run `SidebarRight.legacyInspectorFlag.test.jsx`.
- **Scope:** `SidebarRight.jsx`, `MainLayout.jsx`, `StudyToolsMenu.jsx`.

## B8. Export Studio: one forward button (P1)

- **Current:** footer "Tiếp tục" + "Hủy" + "Xuất PNG", plus a step rail and
  quick presets (D18).
- **Proposed:** footer "Hủy" + "Xuất PNG"; the rail stays as tabs; quick
  presets stay. Move "Áp dụng cho sơ đồ" out of the export footer into the
  appearance step, labelled "Lưu giao diện cho sơ đồ" (D17).
- **Risk:** medium; Export Studio has dense fixture coverage
  (`export-studio.spec.js`, exact-node specs). Must keep scope semantics.
- **Scope:** `ExportStudioDialog.jsx`.

## B9. Mobile reading room copy and header (P1)

- Chat empty state: "Chọn tài liệu bên trái" becomes viewport-aware ("Mở thư
  mục nguồn" button on phones); with no documents, show "Tải tài liệu lên" in
  the centre.
- Library header at 320/390: title on its own line; upload button full width
  below; "Xem thử" into the overflow.
- Export dialog at 390: keep the header usage indicator below the modal layer.
- **Scope:** `ChatArea.jsx`, `DocumentList.jsx` header, `StudyShell`, CSS
  z-index for `UsageChip`.

## B10. Quiz result: plan first (P1)

- **Current:** main button reviews wrong answers; plan is a header button.
- **Proposed:** primary "Kế hoạch ôn tập (2 chủ đề)", secondary "Xem lại 2
  câu sai"; label percentages with their unit (D32); rename queue buckets
  (D31).
- **Scope:** `QuizResult.jsx`, `LearningDashboard.jsx`, `reviewQueue.js` labels.
