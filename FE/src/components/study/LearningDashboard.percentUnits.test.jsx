// @vitest-environment jsdom
// W2-2 (audit finding, README top-10 #10): four kinds of % appeared side by
// side on this dashboard with no unit, ambiguous which measured what.
// Analytics helpers are mocked (pure data shaping, their own module's
// concern) so this file only asserts the JSX wiring of the unit words.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import LearningDashboard from "./LearningDashboard";

vi.mock("../../study/learningAnalytics", () => ({
  baoPhuArtifact: () => ({
    tongSoDaLapChiMuc: 4,
    summary: { co: 3, tong: 4, phanTram: 75 },
    mindmap: { co: 2, tong: 4, phanTram: 50 },
    quiz: { co: 1, tong: 4, phanTram: 25 },
    review: { co: 0, tong: 4, phanTram: 0 },
  }),
  hoanThanhTongThe: () => 73,
  chuDeChuaDanhGia: () => [],
  taiLieuItMo: () => [],
  taiLieuChuaXong: () => [{ document_id: "d1", title: "Tài liệu dở dang", knowledge: { readiness: { total: 62 } } }],
  thoiLuongDocUocTinh: () => 10,
  insightThuVien: () => ({
    chuDeHocNhieuNhat: null, chuDeItHocNhat: null, taiLieuLonNhat: null, taiLieuHoatDongNhat: null,
    luotQuizDaCham: 3, soMindmapDaXem: 2, baoPhuTomTat: 55,
  }),
}));
vi.mock("../../study/reviewQueue", () => ({
  hangDoiOnTap: () => ({ homNay: [], ngayMai: [], sau: [] }),
  taiLieuDaOnXong: () => [],
}));
vi.mock("../../study/learningJourney", () => ({ hanhTrinhHoc: () => ({}) }));

let container, root;
afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

async function render(props = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <LearningDashboard
        documents={[]}
        overview={{ average_percentage: 85 }}
        weak={[]}
        attempts={[]}
        mucHienThi={{ canOnTap: [], tiepTucHoc: null, hocGanDay: [] }}
        onMo={() => {}}
        {...props}
      />,
    );
  });
}

describe("LearningDashboard — percentages name their unit (W2-2)", () => {
  it("quiz average score names 'điểm' (it is an average of score percentages, not of correct answers)", async () => {
    await render();
    expect(container.textContent).toContain("85% điểm");
    expect(container.textContent).not.toContain("câu đúng");
  });

  it("document readiness in the 'Học dở dang' list names 'sẵn sàng'", async () => {
    await render();
    expect(container.textContent).toContain("62% sẵn sàng");
  });

  it("summary coverage insight names 'đã có'", async () => {
    await render();
    expect(container.textContent).toContain("55% đã có");
  });

  it("'Hoàn thành'/'Tóm tắt'/'Quiz' progress tiles name 'đã có'; 'Sơ đồ' is left exactly as-is (another open PR owns that line)", async () => {
    await render();
    expect(container.textContent).toContain("73% đã có"); // Hoàn thành
    expect(container.textContent).toContain("75% đã có"); // Tóm tắt
    expect(container.textContent).toContain("25% đã có"); // Quiz
    // Sơ đồ's own tile text is untouched (W3 note: PR #122 owns this line).
    const tiles = [...container.querySelectorAll(".font-display.text-body-lg.font-semibold.text-text-primary")]
      .map((el) => el.textContent);
    expect(tiles).toContain("50%");
  });
});
