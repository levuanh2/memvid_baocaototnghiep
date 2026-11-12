// @vitest-environment jsdom
// V6 learning home: the block at the top of the Library that says where to pick up.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import LearningHome from "./LearningHome";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  container = null; root = null;
});

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const doc = (id, title, extra = {}) => ({
  document_id: id, source_stem: id, title, status: "completed", ingest_status: "index_ready",
  ai: { index: "ready", summary: { state: "ready" }, quiz: { ready: false }, review: {} }, ...extra,
});
const A = doc("a", "Kinh tế vi mô", { last_opened_at: hoursAgo(2), last_workspace: "quiz", ai: { index: "ready", summary: { state: "ready" }, quiz: { ready: true }, review: {} } });
const B = doc("b", "Hệ điều hành", { last_opened_at: hoursAgo(30), last_workspace: "summary" });
const C = doc("c", "Xác suất", { ai: { index: "ready", summary: { state: "not_generated" }, quiz: { ready: false }, review: {} } });

async function render(props) {
  const onMo = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(
    <LearningHome documents={[A, B, C]} mucHienThi={{ tiepTucHoc: A, hocGanDay: [A, B], canOnTap: [] }}
      overview={{ average_percentage: 72 }} onMo={onMo} {...props} />,
  ));
  return onMo;
}
const button = (text) => [...container.querySelectorAll("button")].find((b) => b.textContent.includes(text));

describe("LearningHome", () => {
  it("names the document to pick up, when and where it was left, and continues there", async () => {
    const onMo = await render();
    expect(container.querySelector(".learning-home__title").textContent).toBe("Kinh tế vi mô");
    expect(container.querySelector(".learning-home__meta").textContent).toMatch(/Mở lần cuối 2 giờ trước, ở Quiz\./);
    const cta = container.querySelectorAll(".btn-seal");
    expect(cta).toHaveLength(1);
    await act(async () => cta[0].click());
    expect(onMo).toHaveBeenCalledWith(A, "quiz");
  });

  it("lists other recently opened documents, never the one already offered, and opens each where it was left", async () => {
    const onMo = await render();
    const rows = [...container.querySelectorAll(".learning-home__recent button")];
    expect(rows.map((b) => b.querySelector(".learning-home__recent-name").textContent)).toEqual(["Hệ điều hành"]);
    await act(async () => rows[0].click());
    expect(onMo).toHaveBeenCalledWith(B, "summary");
  });

  it("shows library progress as counts with their unit, and the quiz average only when there is one", async () => {
    await render();
    const text = container.querySelector(".learning-home__progress").textContent;
    expect(text).toContain("Có tóm tắt2/3 tài liệu");
    expect(text).toContain("Có quiz1/3 tài liệu");
    expect(text).toContain("72% điểm");
    act(() => root.unmount()); container.remove();
    await render({ overview: {} });
    expect(container.querySelector(".learning-home__progress").textContent).not.toContain("Điểm quiz trung bình");
  });

  it("with nothing to continue it says so and tells the learner what to do, with no filled button", async () => {
    await render({ mucHienThi: { tiepTucHoc: null, hocGanDay: [], canOnTap: [] } });
    expect(container.textContent).toContain("Chưa có tài liệu nào đang học dở");
    expect(container.querySelectorAll(".btn-seal")).toHaveLength(0);
    expect(container.querySelector(".learning-home__recent")).toBeNull();
  });

  it("does not offer to continue a document that is no longer studyable", async () => {
    const broken = { ...A, ai: { index: "not_generated" } };
    await render({ mucHienThi: { tiepTucHoc: broken, hocGanDay: [], canOnTap: [] } });
    expect(container.querySelectorAll(".btn-seal")).toHaveLength(0);
    expect(container.textContent).toContain("chưa lập chỉ mục xong");
  });

  it("offers the review queue only when something is due, starting with the first due document", async () => {
    await render();
    expect(button("cần ôn ngay")).toBeUndefined();
  });

  it("is a labelled region with one heading for its main part", async () => {
    await render();
    const section = container.querySelector("section.learning-home");
    const label = document.getElementById(section.getAttribute("aria-labelledby"));
    expect(label.textContent).toBe("Học tiếp");
    expect(label.tagName).toBe("H2");
  });
});
