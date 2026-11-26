// @vitest-environment jsdom
// V9.3 P3a (docs/StudyMap-V9.3/05 "Thư viện"): the card says what kind of file it is, and the
// full name wraps instead of being cut at two lines (the compact density, a choice the learner
// makes, still clamps). "Lưu trữ" is never called "Xóa".
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudyCard from "./StudyCard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  container = root = null;
});

const DOC = {
  document_id: "doc-1", source_stem: "s", title: "Giáo trình.pdf", display_name: "Giáo trình",
  file_type: "pdf", status: "completed", ingest_status: "index_ready",
  ai: { index: "ready", summary: { state: "not_generated" }, mindmap: { state: "not_generated" },
    studymap: { state: "not_generated" }, quiz: { ready: false }, review: { ready: false } },
};

async function render(doc) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(
    <StudyCard doc={doc} documents={[doc]} chiMucBst={new Map()} jobs={{ summary: new Set(), mindmap: new Set() }}
      onDoiTen={vi.fn()} onLuuTen={vi.fn()} onHuyDoiTen={vi.fn()} onBatTat={vi.fn()} onMo={vi.fn()} />,
  ));
}

const type = () => container.querySelector(".study-card__type");

describe("StudyCard V9.3", () => {
  it.each([["pdf", "PDF"], ["docx", "DOCX"], ["txt", "TXT"]])("labels a %s file as %s", async (fileType, label) => {
    await render({ ...DOC, file_type: fileType });
    expect(type().textContent).toContain(label);
  });

  it("falls back to the original file name's extension", async () => {
    await render({ ...DOC, file_type: undefined, title: "Bài đọc.docx" });
    expect(type().textContent).toContain("DOCX");
  });

  it("draws no label when the type is unknown", async () => {
    await render({ ...DOC, file_type: undefined, title: "Không đuôi" });
    expect(type()).toBeNull();
  });

  it("archives with 'Lưu trữ' and restores with 'Bỏ lưu trữ', never 'Xóa'", async () => {
    for (const doc of [DOC, { ...DOC, archived_at: "2026-11-01" }]) {
      await render(doc);
      await act(async () => { container.querySelector(".study-card__menu-trigger").click(); });
      const menu = container.textContent;
      expect(menu).toContain(doc.archived_at ? "Bỏ lưu trữ" : "Lưu trữ");
      expect(menu).not.toMatch(/X[oó]a/);
      act(() => root.unmount());
      container.remove();
      root = null;
    }
  });

  it("wraps the full name in the comfortable density and clamps only the compact one", () => {
    const css = fs.readFileSync(path.resolve("src/components/study/studyCard.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (sel) => css.match(new RegExp(`${sel.replace(/[.[\]="]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] || "";
    expect(rule(".study-card__title")).not.toMatch(/line-clamp/);
    expect(rule('.study-card[data-density="compact"] .study-card__title')).toMatch(/line-clamp/);
  });
});
