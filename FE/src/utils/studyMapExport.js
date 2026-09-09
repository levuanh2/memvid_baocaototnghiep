// Xuất ảnh sơ đồ kiến thức — bọc `@zumer/snapdom`, KHÔNG lộ nó ra ngoài file này.
// `StudyMapView` (và bất cứ nơi nào dùng sau này) chỉ biết `exportImage(element,
// options)` — đổi thư viện chụp ảnh chỉ sửa module này, không sửa nơi gọi. Cùng lý do
// `studyMapLayout.js` giấu "orientation"/"pathFunc" sau một adapter.
//
// PNG qua `@zumer/snapdom` là cách `MindElixirView.jsx::handleExportPng` đã dùng và đã
// chạy thật — bọc lại, không viết một đường xuất ảnh thứ hai bằng thư viện khác.
import { snapdom } from "@zumer/snapdom";

const TEN_TOI_DA = 60;

const chuoi = (v) => (typeof v === "string" ? v.trim() : "");

/** Tên file an toàn trên cả Windows/macOS/Linux + ngày — KHÔNG gồm phần đuôi, vì
 * `result.download()` của snapdom tự thêm đuôi đúng theo `format`. Tách khỏi
 * `exportImage` vì đây là phần THUẦN, test được mà không cần DOM/snapdom thật. */
export function tenFileXuat(tieuDe, { now = new Date() } = {}) {
  const antoan = chuoi(tieuDe).replace(/[\\/:*?"<>|]+/g, "_").trim() || "study-map";
  const ngay = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `study-map-${antoan.slice(0, TEN_TOI_DA)}-${ngay}`;
}

/**
 * `format`: "png" | "svg" | "jpg" | "webp" (mặc định "png"). `scale`: bội số DPI, mặc
 * định 2 — khớp hành vi PNG đã có ở `MindElixirView`. `transparent`: bỏ nền hẳn; mặc
 * định false và dùng `nenMacDinh` (màu nền THEME hiện tại của trang, không phải trắng
 * bịa) để ảnh khớp giao diện người dùng đang xem.
 */
export async function exportImage(element, {
  title, format = "png", scale = 2, transparent = false, nenMacDinh = "#ffffff",
} = {}) {
  if (!element) throw new Error("Không có phần tử để xuất ảnh.");
  const result = await snapdom(element, {
    backgroundColor: transparent ? "transparent" : nenMacDinh,
    scale,
  });
  await result.download({ format, filename: tenFileXuat(title) });
}
