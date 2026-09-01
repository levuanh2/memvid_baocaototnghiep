# Cuộn bị nuốt ở sơ đồ kiến thức, và một đợt nắn UX quanh nó

> **Cho người thực thi:** dùng `superpowers:executing-plans`. Mỗi bước có checkbox.

**Mục tiêu:** người dùng cuộn được trang sơ đồ kiến thức bằng con lăn như mọi trang khác;
và những chỗ "trông cứng" quanh nó mềm lại mà KHÔNG phá ngôn ngữ hình ảnh đang có.

**Nguồn:** người dùng báo *"giao diện studymap khi làm xong không scroll được luôn"* +
đọc mã `StudyMapView.jsx`, `MainLayout.jsx`, `SidebarRight.jsx`.

## Bản sắc đang có — KHÔNG được thay

Kho này không phải trang trắng. Đọc `src/index.css` thấy một hệ đã chọn có chủ đích:

| thứ | giá trị | vai trò |
|---|---|---|
| con dấu | `--brand-rgb: 178 58 46` (son), dark: `216 106 83` | `btn-seal`, nhấn mạnh |
| chữ đọc | `Spectral` serif (`.font-reading`) | thân bài, câu trả lời |
| chữ hệ thống | `.font-display`, `.font-body` | tiêu đề, giao diện |
| nhãn kỹ thuật | `.coord` (mono, tracking rộng) | eyebrow, mã đoạn |
| bề mặt | `.surface-card` + `--shadow-card-hover` | thẻ nổi nhẹ |

Ẩn dụ xuyên suốt trong chính comment của mã: *"phòng đọc"*, *"kệ trái"*, *"gáy sách"*,
*"lề phải — bằng chứng"*. **Mọi việc dưới đây là nắn cho đúng ẩn dụ đó, không phải thay
nó.** Tra Mobbin để lấy *pattern tương tác* (bản đồ nhúng, thanh hành động dính đáy,
gợi ý còn nội dung phía dưới) — không lấy *phong cách*.

## Ràng buộc chung

- Không thêm phụ thuộc mới. Không đổi palette, không đổi font.
- Không đụng `MainLayout` `h-screen overflow-hidden` — nó ĐÚNG cho bố cục ba cột.
- Mốc phải giữ: FE 230 passed, build OK, lint 70.

---

### Task 1: Con lăn phải trả về cho trang, trừ khi người dùng chủ ý phóng bản đồ

**Vấn đề (đã định vị):** `StudyMapView.jsx:283-285`

```jsx
ref={canvasRef}
className="surface-card !p-0 overflow-hidden w-full lg:flex-1"
style={{ height: "min(70vh, 640px)" }}
```

`react-d3-tree` gắn d3-zoom lên `<svg>` bên trong; d3-zoom **nghe `wheel` và
`preventDefault`**. Canvas cao 70vh nên chiếm gần hết vùng nhìn — con trỏ gần như luôn
nằm trên nó, và mọi cú lăn đều bị nuốt để phóng to/thu nhỏ cây. Trang *có* cuộn được
(`StudyShell` có `overflow-y-auto`) nhưng người dùng không bao giờ chạm tới được.

**Cách sửa — pattern bản đồ nhúng:** lăn thường = cuộn trang; **Ctrl/⌘ + lăn** = phóng
bản đồ. Chặn ở **pha capture** của thẻ bọc: capture chạy TRƯỚC listener của `<svg>`, nên
`stopPropagation()` là đủ để d3 không nhận. **Không gọi `preventDefault`** — để trình
duyệt cuộn trang như bình thường.

Kéo-thả để di chuyển cây giữ nguyên, không đụng.

**Files:**
- Create: `FE/src/utils/wheelGate.js` (hàm thuần, quyết định cho qua hay chặn)
- Create: `FE/src/utils/wheelGate.test.js`
- Modify: `FE/src/pages/study/StudyMapView.jsx`

- [ ] **Bước 1: viết test đỏ**

```js
import { describe, expect, it } from "vitest";
import { nenChanLan } from "./wheelGate";

describe("nenChanLan", () => {
  it("lăn thường trên bản đồ -> CHẶN d3, trả cuộn về cho trang", () => {
    expect(nenChanLan({ ctrlKey: false, metaKey: false })).toBe(true);
  });
  it("Ctrl + lăn -> để d3 phóng bản đồ", () => {
    expect(nenChanLan({ ctrlKey: true, metaKey: false })).toBe(false);
  });
  it("Cmd + lăn (macOS) -> để d3 phóng", () => {
    expect(nenChanLan({ ctrlKey: false, metaKey: true })).toBe(false);
  });
  it("sự kiện rỗng không làm nổ", () => {
    expect(nenChanLan(null)).toBe(true);
    expect(nenChanLan(undefined)).toBe(true);
  });
});
```

- [ ] **Bước 2: chạy, phải đỏ** — `npx vitest run src/utils/wheelGate.test.js`

- [ ] **Bước 3: viết `wheelGate.js`**

```js
// Bản đồ nhúng nuốt con lăn là một trong những cách nhanh nhất làm người dùng thấy
// trang "chết cứng": trang vẫn cuộn được, nhưng con trỏ luôn nằm trên bản đồ nên cú
// lăn nào cũng bị d3-zoom lấy mất. Pattern quen thuộc (Google Maps nhúng, Figma nhúng):
// lăn thường thuộc về TRANG, phóng bản đồ phải là chủ ý — giữ Ctrl (hoặc ⌘ trên macOS).
export function nenChanLan(e) {
  if (!e) return true;
  return !(e.ctrlKey || e.metaKey);
}
```

- [ ] **Bước 4: nối vào `StudyMapView`**

```jsx
  // Pha CAPTURE: chạy trước listener d3 gắn trên <svg> bên trong, nên stopPropagation
  // là đủ để chặn. KHÔNG preventDefault — trang phải cuộn tự nhiên.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    const chan = (e) => { if (nenChanLan(e)) e.stopPropagation(); };
    el.addEventListener("wheel", chan, { capture: true });
    return () => el.removeEventListener("wheel", chan, { capture: true });
  }, [map]);
```

- [ ] **Bước 5: nói cho người dùng biết luật mới**

Không ai đoán được "Ctrl + lăn để phóng" nếu không nói. Thêm một dòng gợi ý ngay dưới
canvas, dùng `.coord` cho đúng giọng nhãn kỹ thuật đang có:

```jsx
<div className="coord mt-2 text-text-muted">
  Ctrl + lăn để phóng · kéo để di chuyển
</div>
```

- [ ] **Bước 6: `npm run build` + `npx vitest run` + `npx eslint src`; so mốc 230/70**

- [ ] **Bước 7: commit**

---

### Task 2: Rà những chỗ khác cũng có thể nuốt cuộn hoặc cắt nội dung

**Vấn đề:** `overflow-hidden` trên một khung mà bên trong **không có** vùng cuộn thì nội
dung dư bị cắt im lặng — không thanh cuộn, không dấu hiệu, người dùng tưởng hết nội dung.

Đã thấy hai chỗ đáng kiểm (chưa kết luận, phải mở trình duyệt xem):

| chỗ | hiện trạng |
|---|---|
| `SidebarRight.jsx:588` | `<div className="flex flex-col h-full overflow-hidden">` — có `606: flex-1 min-h-0 overflow-y-auto` bọc phần chính, nhưng khối "danh sách đã lưu" ở `777` lại tự giới hạn `max-h-[34vh]`, tức có **hai** vùng cuộn lồng nhau |
| `MainLayout.jsx:151, 223` | `<aside className="shrink-0 ... overflow-hidden">` — đúng, vì con của nó tự cuộn; giữ nguyên |

- [ ] **Bước 1: mở từng màn hình ở khổ hẹp (≤768px) và khổ rộng, thử cuộn bằng con lăn
      VÀ bằng bàn phím (PageDown) ở: chat, kệ trái, lề phải, sơ đồ, làm quiz, kết quả,
      ôn tập, luyện tập.** Ghi lại chỗ nào không cuộn được.

- [ ] **Bước 2: với mỗi chỗ hỏng, sửa theo đúng một luật:** khung cha giữ
      `overflow-hidden`, đúng MỘT con mang `flex-1 min-h-0 overflow-y-auto`. Không lồng
      hai vùng cuộn trong cùng một cột — người dùng không biết mình đang cuộn cái nào.

- [ ] **Bước 3: commit**

---

### Task 3: Ba việc nắn UX, mỗi việc sửa một điều CỤ THỂ

Không đổi màu, không đổi font, không thêm hiệu ứng. Ba thứ dưới đây đều nhắm vào cảm
giác "cứng" mà người dùng mô tả, và đều bám ẩn dụ phòng đọc đang có.

**3a. Không có dấu hiệu "còn nội dung phía dưới".**
Vùng cuộn hiện cắt phẳng ở mép dưới, nên trông như đã hết. Thêm một dải mờ 24px ở đáy
vùng cuộn (`mask-image: linear-gradient(...)`), tắt khi đã cuộn tới đáy. Đây là chi tiết
Mobbin xuất hiện gần như ở mọi app đọc dài — nó rẻ và nó nói thật.

- [ ] Thêm class `.co-the-cuon-them` vào `index.css`, áp cho vùng cuộn của ChatArea,
      SidebarLeft, SidebarRight.

**3b. Thanh hành động ở trang làm quiz trôi mất khi cuộn.**
Câu hỏi dài thì nút "Câu trước / Câu sau / Nộp bài" nằm dưới đáy màn hình, phải cuộn mới
bấm được. Cho khối đó `sticky bottom-0` với nền `--bg-base` và một đường kẻ trên — pattern
thanh hành động dính đáy, quen thuộc trong mọi app làm bài.

- [ ] `QuizTaking.jsx`: bọc cụm nút điều hướng trong `sticky bottom-0 z-10` + nền + border-top.

**3c. Ba trạng thái của mỗi danh sách phải khác nhau rõ.**
Vòng 8 đã sửa phần "hỏng ≠ rỗng" ở `SidebarRight`/`SidebarLeft`. Còn thiếu **đang tải**:
vài chỗ nhảy thẳng từ trống sang có nội dung, gây cảm giác giật. Dùng khối xương (skeleton)
cùng bo góc và chiều cao với thẻ thật, không dùng spinner giữa màn hình.

- [ ] `DocumentList.jsx`: thay `loading` toàn trang bằng 3 thẻ xương đúng kích thước thẻ tài liệu.

- [ ] **Bước cuối: build + test + lint, so mốc; commit từng mục 3a/3b/3c riêng.**

---

## Thứ tự

Task 1 trước — đó là lỗi người dùng đang gặp. Task 2 là việc rà, cần mở trình duyệt nên
phải có người xem cùng. Task 3 làm sau, và **từng mục một**, mỗi mục một commit để dễ lùi
nếu nhìn không ưng.

## Điều cố ý KHÔNG làm

- **Không** đổi bảng màu / font / bo góc theo một app trên Mobbin. Kho này đã có bản sắc
  (con dấu son + Spectral + ẩn dụ phòng đọc) và nó nhất quán; thay bằng phong cách vay
  mượn sẽ làm sản phẩm giống mọi sản phẩm khác.
- **Không** thêm animation trang trí. Cảm giác "cứng" ở đây đến từ *nội dung bị kẹp và
  cuộn bị nuốt*, không phải từ thiếu chuyển động.
