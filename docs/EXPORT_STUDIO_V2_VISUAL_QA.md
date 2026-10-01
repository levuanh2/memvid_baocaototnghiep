# Export Studio UX v2 — Visual QA

Ngày kiểm tra: 2026-10-01

## Audit semantics

| Control cũ | Contract/state | Control v2 | Semantics |
|---|---|---|---|
| 4 radio cards scope | `scopeType` (`full/current_branch/selected_branches/visible`) | Grouped list rows | Giữ nguyên |
| “Chỉ các node đang hiển thị” | `visibleOnly`, lọc độc lập trên full/current/selected | Disclosure “Nâng cao” | Giữ nguyên; không trùng hoàn toàn với scope `visible` |
| 6 format cards dọc | `format` + capability model | Hai compact grids Ảnh/Tài liệu | Giữ nguyên |
| Appearance controls phẳng | `appearance`, `docOptions`, capabilities | Preset + preview + accordion | Giữ nguyên; chỉ render option được support |
| Preview text debug-like | Derived summary | Structured review rows | Giữ nguyên export request |
| Generic “Xuất” | Image/document pipelines | CTA theo format | Giữ nguyên pipeline |

## Side-by-side review với mock Phương án 2

- Hierarchy: rail 4 bước là anchor duy nhất; bỏ nhãn “Bước 1/4” lặp lại.
- Density: quick presets là 3 nút nhỏ; scope là một grouped list; format là grid compact.
- Grouping: appearance dùng preset, preview swatch và 4 accordion; review dùng `dl` có cấu trúc.
- Footer: summary trái, navigation/action phải; nằm ngoài vùng scroll nên không che content.
- Selected state: nền xanh nhạt + indicator/radio/check, không dùng viền xanh dày.
- Theme: light/dark dùng token hiện có, `#126CF2`, border slate nhẹ, không gradient/shadow trang trí.

## Viewports và states

Artifacts nằm tại `FE/qa-artifacts/responsive/` và index tại `FE/qa-artifacts/responsive/INDEX.md`.

- 1440×1024 light/dark: scope, format, appearance, review, running/error/done.
- 1024×768 light/dark: cùng state set; footer trong viewport.
- 768×1024 light/dark: rail thành horizontal step navigation.
- 390×844 light/dark: full-height sheet, horizontal preset strip, one-column scope/format, safe-area footer.
- Selection mode: canvas bar, checkbox clicks, drawer isolation, cleanup, pan/viewport preservation.

## Kết quả audit

- P0: không có.
- P1: không có.
- P2: không có.
- P3: mobile quick-preset strip chủ ý để lộ một phần item kế tiếp nhằm báo có thể cuộn ngang.
- Không sửa badge “+N hidden descendants”.

## Verification

- FE unit/component: 131 files, 1,299 tests passed.
- Fixture image/export/selection: 19 scenarios passed (18 trong full pass + ca cuối chạy lại riêng sau selector migration).
- Responsive/visual/accessibility: 141 scenarios completed across 8 viewport/theme combinations.
- Production build: passed.
- Changed-file ESLint: passed.
- `git diff --check`: passed.

