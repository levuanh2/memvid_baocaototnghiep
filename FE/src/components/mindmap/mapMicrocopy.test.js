// V4.1 W5-1a (PR #139, owner-final wording): Fit, Reset and Center do different things, so their
// titles say what each one does; the depth-0 preset names the central topic.
import { describe, expect, it } from "vitest";
import view from "./MindElixirView.jsx?raw";

describe("mind-map viewport and depth microcopy", () => {
  it("Fit / Reset / Center titles state their distinct effect", () => {
    expect(view).toContain('title="Vừa khung: thu/phóng để thấy toàn bộ sơ đồ (F)"');
    expect(view).toContain('title="Đặt lại khung nhìn: về 100% và căn giữa"');
    expect(view).toContain('title="Căn giữa: đưa nút gốc vào giữa khung, giữ mức thu phóng"');
    expect(view).not.toContain('title="Vừa khung (F)"');
  });
  it("depth 0 is 'Chỉ chủ đề trung tâm' (the retired 'Chỉ chủ đề chính' must not return)", () => {
    expect(view).toContain("/> Chỉ chủ đề trung tâm</");
    expect(view).not.toContain("Chỉ chủ đề chính");
  });
});
