// @vitest-environment jsdom
// V6 document card: one primary action, tools that carry their own state, a sentence instead of
// greyed-out buttons when the document cannot be studied yet, and flags as words.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudyCard from "./StudyCard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  container = null; root = null;
});

const READY = {
  document_id: "doc-1", source_stem: "kinh-te", title: "KTVM_C3.pdf", display_name: "Kinh tế vi mô — Chương 3",
  status: "completed", ingest_status: "index_ready", reading_minutes: 42, page_count: 36, chunk_count: 118, open_count: 7,
  ai: {
    index: "ready",
    summary: { state: "ready", ai_overview: ["Giá cân bằng ở điểm cung bằng cầu."], preview: "Chương này trình bày luật cầu." },
    mindmap: { state: "ready" }, studymap: { state: "not_generated" },
    quiz: { ready: true, count: 3 }, review: { ready: false },
  },
};
const NO_JOBS = { summary: new Set(), mindmap: new Set() };

async function render(doc, props = {}) {
  const onMo = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(
    <StudyCard doc={doc} documents={[doc]} chiMucBst={new Map()} jobs={NO_JOBS}
      onDoiTen={vi.fn()} onLuuTen={vi.fn()} onHuyDoiTen={vi.fn()} onBatTat={vi.fn()} onMo={onMo}
      onChon={vi.fn()} tabIndex={0} {...props} />,
  ));
  return onMo;
}
const tools = () => [...container.querySelectorAll(".study-card__tool")];
const tool = (name) => tools().find((b) => b.textContent.includes(name));

describe("StudyCard (V6)", () => {
  it("offers the five study tools as one named group, each carrying its own prepared state", async () => {
    await render(READY);
    const group = container.querySelector('[role="group"]');
    expect(group.getAttribute("aria-label")).toBe("Học với Kinh tế vi mô — Chương 3");
    // The accessible NAME of each tool is exactly its name: counts and marks are aria-hidden.
    const name = (b) => [...b.childNodes]
      .filter((n) => n.nodeType === 3 || (n.nodeType === 1 && !n.hidden && n.getAttribute("aria-hidden") !== "true" && n.tagName !== "svg"))
      .map((n) => n.textContent).join("").trim();
    expect(tools().map(name)).toEqual(["Tóm tắt", "Bản đồ kiến thức", "Quiz", "Ôn tập", "Hỏi AI"]);
    // The state is the DESCRIPTION: words for assistive technology, a mark for the eye.
    const description = (b) => document.getElementById(b.getAttribute("aria-describedby") || "")?.textContent ?? null;
    expect(description(tool("Tóm tắt"))).toBe("đã có");
    expect(description(tool("Quiz"))).toBe("đã có 3");
    expect(tool("Quiz").getAttribute("data-ready")).toBe("true");
    expect(tool("Quiz").textContent).toContain("(3)");
    expect(tool("Ôn tập").hasAttribute("aria-describedby")).toBe(false);
    // The old row of state chips, which repeated the same names, is gone.
    expect(container.textContent).not.toContain("Đã lập chỉ mục");
  });

  it("a tool opens its surface", async () => {
    const onMo = await render(READY);
    await act(async () => tool("Quiz").click());
    expect(onMo).toHaveBeenCalledWith(READY, "quiz");
  });

  it("with a place to continue there is one filled button, and its destination is not offered twice", async () => {
    const doc = { ...READY, last_opened_at: new Date(Date.now() - 3600e3).toISOString(), last_workspace: "quiz" };
    const onMo = await render(doc);
    const filled = container.querySelectorAll(".btn-seal");
    expect(filled).toHaveLength(1);
    expect(filled[0].textContent).toContain("Tiếp tục · ");
    expect(tool("Quiz")).toBeUndefined();
    expect(tools()).toHaveLength(4);
    await act(async () => filled[0].click());
    expect(onMo).toHaveBeenCalledWith(doc, "quiz");
  });

  it("on a page whose learning home holds the filled action, the card's 'Tiếp tục' is outlined", async () => {
    const doc = { ...READY, last_opened_at: new Date(Date.now() - 3600e3).toISOString(), last_workspace: "quiz" };
    const onMo = await render(doc, { nutTiepTuc: "secondary" });
    expect(container.querySelectorAll(".btn-seal")).toHaveLength(0);
    const resume = container.querySelector(".study-card__resume");
    expect(resume.className).toContain("btn-secondary");
    expect(resume.getAttribute("data-emphasis")).toBe("secondary");
    await act(async () => resume.click());
    expect(onMo).toHaveBeenCalledWith(doc, "quiz");
  });

  it("without a place to continue there is no filled button at all", async () => {
    await render(READY);
    expect(container.querySelectorAll(".btn-seal")).toHaveLength(0);
  });

  it("a document that is not indexed yet says so in words and offers no study tools", async () => {
    await render({ ...READY, ingest_status: "processing", status: "processing", ai: { index: "not_generated", summary: { state: "not_generated" } } });
    expect(tools()).toHaveLength(0);
    expect(container.querySelectorAll("button[disabled]")).toHaveLength(0);
    const state = container.querySelector(".study-card__state");
    expect(state.getAttribute("data-state")).toBe("waiting");
    expect(state.textContent).toContain("Tài liệu chưa được lập chỉ mục.");
    // The document menu and the details disclosure stay available.
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeTruthy();
    expect(container.querySelector(".study-card__details")).toBeTruthy();
  });

  it("a document whose processing failed says that, not 'not indexed yet'", async () => {
    await render({ ...READY, ingest_status: "error", status: "failed", ai: { index: "not_generated" } });
    const state = container.querySelector(".study-card__state");
    expect(state.getAttribute("data-state")).toBe("failed");
    expect(state.textContent).toContain("Xử lý tài liệu này bị lỗi.");
    expect(tools()).toHaveLength(0);
  });

  it("pinned, favourite and archived are words, and an archived card is not dimmed with opacity", async () => {
    await render({ ...READY, pinned: true, favorite: true, archived_at: "2026-10-01T00:00:00Z" });
    const badges = [...container.querySelectorAll(".study-card__badge")].map((b) => b.textContent.trim());
    expect(badges).toEqual(expect.arrayContaining(["Đã ghim", "Yêu thích", "Đã lưu trữ"]));
    const card = container.querySelector(".study-card");
    expect(card.getAttribute("data-archived")).toBe("true");
    expect(card.style.opacity).toBe("");
  });

  it("facts show reading time and pages; internal counters stay off the card", async () => {
    await render(READY);
    const facts = container.querySelector(".study-card__facts").textContent;
    expect(facts).toContain("42 phút đọc");
    expect(facts).toContain("36 trang");
    expect(facts).toContain("Có sơ đồ tư duy");
    expect(container.textContent).not.toContain("118 đoạn");
    expect(container.textContent).not.toContain("7 lần mở");
  });

  it("the title is a heading and keeps the full name available when clamped", async () => {
    await render(READY);
    const title = container.querySelector("h3.study-card__title");
    expect(title.textContent).toBe("Kinh tế vi mô — Chương 3");
    expect(title.getAttribute("title")).toBe("Kinh tế vi mô — Chương 3");
    expect(container.querySelector(".study-card__file").textContent).toBe("KTVM_C3.pdf");
  });

  it("compact density keeps the title, first overview line and the tools; drops preview, facts and file name", async () => {
    await render(READY, { matDo: "compact" });
    expect(container.querySelector(".study-card").getAttribute("data-density")).toBe("compact");
    expect(container.querySelectorAll(".study-card__overview li")).toHaveLength(1);
    expect(container.querySelector(".study-card__preview")).toBeNull();
    expect(container.querySelector(".study-card__facts")).toBeNull();
    expect(container.querySelector(".study-card__file")).toBeNull();
    expect(tools()).toHaveLength(5);
  });
});
