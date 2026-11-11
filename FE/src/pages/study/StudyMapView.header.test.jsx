// @vitest-environment jsdom
// W5-2: two clearly named exits ("Về Thư viện", "Hỏi tài liệu này" via
// duongDi(doc, "chat")) and one "Xuất" menu replacing the three separate
// export buttons (same handlers/formats, proper menu ARIA incl. Escape
// closing and returning focus to the trigger).
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudyMapView from "./StudyMapView";
import { fourTierMapFixture } from "../../test/fixtures/fourTierMapFixture";
import viewSource from "./StudyMapView.jsx?raw";
import shellSource from "../../components/study/StudyShell.jsx?raw";

const stableStudyContext = { selectDocument: () => {}, selectNode: () => {} };
vi.mock("../../study/useStudyContext", () => ({ useStudyContext: () => stableStudyContext }));

// react-d3-tree needs SVG APIs jsdom doesn't implement; this file only tests
// the header/toolbar chrome around it, not the canvas itself.
vi.mock("react-d3-tree", () => ({ default: () => <div data-testid="tree-stub" /> }));

const getDocument = vi.fn();
const listStudyMaps = vi.fn();
const getStudyMap = vi.fn();
const listChunks = vi.fn();
vi.mock("../../utils/studyApi", async () => {
  const actual = await vi.importActual("../../utils/studyApi");
  return {
    ...actual,
    getDocument: (...a) => getDocument(...a),
    listStudyMaps: (...a) => listStudyMaps(...a),
    getStudyMap: (...a) => getStudyMap(...a),
    listChunks: (...a) => listChunks(...a),
  };
});

const DOC = { document_id: "doc-1", title: "Giáo trình Hệ điều hành", filename: "os.pdf", source_stem: "os-stem" };

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  if (container) container.remove();
  container = null; root = null;
  getDocument.mockReset(); listStudyMaps.mockReset(); getStudyMap.mockReset(); listChunks.mockReset();
});

beforeEach(() => {
  getDocument.mockResolvedValue(DOC);
  listStudyMaps.mockResolvedValue([{ map_id: "map-1", status: "completed" }]);
  getStudyMap.mockResolvedValue({ map_id: "map-1", title: fourTierMapFixture.title, nodes: fourTierMapFixture.studyNodes });
  listChunks.mockResolvedValue([]);
});

async function renderReady() {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/app/study/map/doc-1"]}>
        <Routes><Route path="/app/study/map/:documentId" element={<StudyMapView />} /></Routes>
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

describe("StudyMapView header (W5-2)", () => {
  it("has two clearly named exits: 'Về Thư viện' (/app/study) and 'Hỏi tài liệu này' (duongDi chat route)", async () => {
    await renderReady();
    const links = [...container.querySelectorAll("a")];
    const veThuVien = links.find((a) => a.textContent.includes("Về Thư viện"));
    expect(veThuVien?.getAttribute("href")).toBe("/app/study");

    const hoiTaiLieu = links.find((a) => a.textContent.includes("Hỏi tài liệu này"));
    // duongDi(doc, "chat") for a doc with a source_stem -> "/app?source=<stem>".
    expect(hoiTaiLieu?.getAttribute("href")).toBe("/app?source=os-stem");

    // Old label/route gone.
    expect(container.textContent).not.toContain("Về nguồn");
  });

  it("page heading shows the document title, and the title is wired through to the breadcrumb", async () => {
    await renderReady();
    expect(container.querySelector("h1")?.textContent).toBe("Giáo trình Hệ điều hành");
    // The useStudyContext stub has no `selectedDocument`, so the breadcrumb renders nothing here;
    // StudyBreadcrumb.documentLabel.test.jsx covers the leaf. Guard the prop chain itself, so
    // dropping either hop fails: StudyMapView -> StudyShell -> StudyBreadcrumb.
    expect(viewSource).toContain("breadcrumbDocumentLabel={doc?.title || doc?.filename}");
    expect(shellSource).toMatch(/documentLabel=\{breadcrumbDocumentLabel\}/);
  });

  it("one 'Xuất' menu replaces the three separate export buttons; opens with all three formats, Escape closes it and returns focus", async () => {
    await renderReady();
    expect(container.querySelector('[role="menu"]')).toBeNull();
    const trigger = [...container.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Xuất"));
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await act(async () => { trigger.click(); });
    const menu = container.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim());
    expect(items).toEqual(["PNG", "PNG nền trong suốt", "SVG"]);

    trigger.focus();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
