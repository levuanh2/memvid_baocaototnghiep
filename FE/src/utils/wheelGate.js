// Ai được nhận cú lăn chuột: trang, hay bản đồ?
//
// `react-d3-tree` gắn d3-zoom lên `<svg>` bên trong canvas sơ đồ, và d3-zoom nghe
// `wheel` rồi `preventDefault`. Canvas cao `min(70vh, 640px)` nên chiếm gần hết vùng
// nhìn — con trỏ gần như luôn nằm trên nó, và MỌI cú lăn bị lấy mất để phóng to/thu nhỏ
// cây. Trang vẫn cuộn được về mặt kỹ thuật (`StudyShell` có `overflow-y-auto`), nhưng
// người dùng không bao giờ chạm tới được. Đọc ra là "trang chết cứng".
//
// Luật quen thuộc ở mọi bản đồ nhúng (Google Maps, Figma): **cuộn thuộc về TRANG**, còn
// phóng bản đồ phải là chủ ý — giữ Ctrl (hoặc ⌘ trên macOS).
//
// Cách dùng: nghe `wheel` ở PHA CAPTURE của thẻ bọc canvas. Capture chạy TRƯỚC listener
// mà d3 gắn trên `<svg>` con, nên `stopPropagation()` là đủ để chặn. Tuyệt đối KHÔNG gọi
// `preventDefault` — đó chính là thứ phải trả lại cho trình duyệt để trang cuộn.
export function nenChanLan(e) {
  if (!e) return true;
  return !(e.ctrlKey || e.metaKey);
}
