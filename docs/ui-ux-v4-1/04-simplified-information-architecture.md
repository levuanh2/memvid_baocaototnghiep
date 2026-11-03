# 04. Simplified information architecture (proposal, needs owner approval)

## 1. Does the target journey fit?

Proposed journey: Upload → Chat / Mind map / Summary → Quiz / Practice →
Review / Progress → Export / Share.

It fits the main use case (a student preparing an exam from course files)
with two corrections taken from the audit:

1. Summary and mind map are not "after chat"; they are parallel ways to read
   the same sources. They stay as peers of chat in one place (the reading
   room), not as steps.
2. Export belongs to the mind map, not to the end of the journey. It is a
   contextual action of the map, reachable whenever a map is open.

A second use case, "ask one quick question about a file", must stay one step
from the Library: card → chat with that file selected. That works today and
is kept.

## 2. Places and names

Two places, one product name. Everything else is a mode or a panel.

| Place | Route | Name in UI (proposed) | Today |
|---|---|---|---|
| Reading room | `/app` | **Phòng đọc** | "MemVidX" logo, "Phòng đọc" eyebrow, "StudyMap" menu |
| Library | `/app/study` and its sub-pages | **Thư viện** | "STUDYMAP · Thư viện học tập" |
| Product | logo | one name (owner decision O1: MemVidX or StudyMap) | both |

Feature names:

| Feature | Proposed name | Replaces |
|---|---|---|
| Editable map in the reading room | **Sơ đồ tư duy** | unchanged |
| Document structure tree (`/app/study/map/:id`) | **Bản đồ kiến thức** | "Sơ đồ", "Bản đồ học tập", "Sơ đồ kiến thức" |
| Header tools menu | **Công cụ học** | "StudyMap ▾" |
| Upload | **Tải tài liệu lên** | "Thêm tài liệu", "Tải tài liệu" |
| Review plan | **Kế hoạch ôn tập** | "Ôn tập", "Kế hoạch ôn" |
| Queue buckets | **Ôn ngay / Ôn sớm / Ôn sau** | "Hôm nay / Ngày mai / Sau" |

## 3. Navigation

**Primary (header, always visible):** logo (Phòng đọc), mode switch Trò
chuyện / Sơ đồ tư duy / Tóm tắt, link Thư viện, account.

**Secondary:**

- Reading room left column: sources (upload, select, filter).
- Reading room right panel: a visible tab row Bằng chứng / Gia sư AI / Dòng
  thời gian / Kiến thức (re-enable the existing row, `SidebarRight.jsx:918`).
  The header "Công cụ học" menu then becomes a shortcut, not the only door.
- Library: one list with task tabs (Tất cả / Tiếp tục học / Cần tóm tắt /
  Cần quiz / Cần ôn) and collections on the left. This is the existing Library
  Action Matrix; it needs its own rollout decision (O3).

**Contextual (inside a mode or card):**

- Mind map: selector (with "Tạo sơ đồ mới"), Tạo lại, Lưu, Giao diện, Xuất.
- Summary: selector (with "Tạo tóm tắt mới"), citations. (Missing today, P0.)
- Library card: one primary "Tiếp tục" or "Bắt đầu", then Tóm tắt, Sơ đồ tư
  duy, Bản đồ kiến thức, Quiz, Kế hoạch ôn tập, Hỏi AI; management (rename,
  favourite, pin, archive, delete) in "Thêm".

**Advanced (one click away, never two):** depth presets, viewport reset,
export appearance, file name, transparent PNG, SVG, presentation mode,
shortcuts, command palette.

## 4. Action hierarchy per screen

| Screen | Primary | Secondary | Advanced | Destructive |
|---|---|---|---|---|
| Reading room, no documents | Tải tài liệu lên (centre and left) | — | — | — |
| Chat | Gửi | Chọn nguồn, Cuộc trò chuyện mới | Đính kèm ảnh, palette | Xóa lịch sử chat (dialog) |
| Mind map, none yet | Tạo sơ đồ tư duy (Guided if on, else legacy) | — | — | — |
| Mind map, open | none (canvas) | Xuất, Lưu (when dirty) | Giao diện, độ sâu, khung nhìn, Tạo lại | Xóa sơ đồ (dialog) |
| Summary, none yet | Tạo tóm tắt | — | độ dài, chế độ học | — |
| Summary, open | none (reading) | Chọn tóm tắt khác | Tạo lại | Xóa tóm tắt (dialog) |
| Export Studio | Xuất <định dạng> | Hủy | Trình bày, tên tệp | — |
| Library | Tải tài liệu lên | search, task tabs | sort, density, filters | Xóa (bulk, dialog) |
| Library card | Tiếp tục / Bắt đầu | the six learning actions | Thêm (manage) | Xóa (in Thêm) |
| Knowledge map | Dựng (first time) | Xuất, Về Thư viện, Hỏi tài liệu này | layout, Trình chiếu | — |
| Quiz setup | Tạo quiz | count, types | scope | — |
| Quiz result | Kế hoạch ôn tập (when there are wrong answers) or Về Thư viện | Xem lại câu sai | — | — |
| Review guide | Luyện ngay | Tùy chỉnh | Tạo lại kế hoạch | — |

Change from today: on Quiz result, the plan becomes the main next step,
because it leads to practice; reviewing wrong answers stays one click.

## 5. Journeys after the change

1. **New user.** Sign in → reading room with a centre card "Tải tài liệu lên"
   → file indexes → select it → three equal modes. No dead end.
2. **Summary.** Library card "Tóm tắt" → `/app?source=…&tab=summary` → if a
   summary exists it opens, otherwise "Tạo tóm tắt" starts one.
3. **Mind map export.** Mind map → Xuất → choose scope → Xuất PNG. Two
   buttons in the footer, not three.
4. **Exam prep.** Library "Cần quiz" tab → Quiz → result → Kế hoạch ôn tập →
   Luyện ngay → practice result → back to plan.
