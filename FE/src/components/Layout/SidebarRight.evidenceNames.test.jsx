// @vitest-environment jsdom
// V6 evidence panel: a citation is named by its document, not by the internal stem.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarRight from "./SidebarRight";
import { StudyContextProvider } from "../../study/StudyContextProvider";

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => {
    if (path === "/mindmaps") return { ok: true, json: async () => ({ mindmaps: [] }) };
    if (path === "/summaries") return { ok: true, json: async () => ({ summaries: [] }) };
    return { ok: true, json: async () => ({}) };
  }),
  generateMindmap: vi.fn(), suggestMindmapTopics: vi.fn(async () => ({ suggestions: [] })),
  cancelMindmap: vi.fn(), generateSummary: vi.fn(), cancelSummary: vi.fn(),
  getMindmapCapability: vi.fn(async () => ({ guided_mindmap_v3: false })),
  isUnauthorizedError: vi.fn(() => false), isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((e) => String(e)),
}));
vi.mock("../ui/Toaster", () => ({ toast: vi.fn() }));
// This file's concern is the tab row/header title/legacy-block gating, not
// these panes' own internals (each has its own test coverage) -- stubbed
// out so a `rightView`/`mode` combination that mounts them doesn't also
// need a Router (TutorPanel's `Link`) or a full `mindMapContext` shape
// (KnowledgeInspector).
vi.mock("../study/TutorPanel", () => ({ default: () => <div data-testid="tutor-panel-stub" /> }));
vi.mock("../study/ResearchTimeline", () => ({ default: () => <div data-testid="research-timeline-stub" /> }));
vi.mock("../study/KnowledgeDashboard", () => ({ default: () => <div data-testid="knowledge-dashboard-stub" /> }));
vi.mock("../mindmap/KnowledgeInspector", () => ({ default: () => <div data-testid="knowledge-inspector-stub" /> }));

const noop = () => {};
let container, root;
afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  localStorage.clear();
});

const flush = () => act(async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); });
async function render(props) {
  if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  await act(async () => {
    root.render(
      <StudyContextProvider>
        <SidebarRight evidence={null} onMindmapDataChange={noop} onSummaryDataChange={noop} onSwitchToChat={noop} {...props} />
      </StudyContextProvider>,
    );
  });
  await flush();
}

const EVIDENCE = {
  sources: ["kinh_te_vi_mo_20261101_120000"],
  chunks: [
    { stem: "kinh_te_vi_mo_20261101_120000", chunk_id: "12", snippet: "Luật cầu: giá tăng thì lượng cầu giảm." },
    { stem: "khong_co_trong_danh_sach", chunk_id: "3", snippet: "Đoạn của một tài liệu không còn trong danh sách." },
  ],
};
const SOURCES = [{ video_stem: "kinh_te_vi_mo_20261101_120000", filename: "Kinh tế vi mô — Chương 3.pdf" }];

describe("SidebarRight evidence: citations named by document", () => {
  it("shows the document name and passage number, keeps the stem only in the tooltip, and shows the quoted text", async () => {
    await render({ evidence: EVIDENCE, sources: SOURCES, rightView: "evidence", onRightViewChange: noop });
    const rows = [...container.querySelectorAll(".evidence-frame")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Kinh tế vi mô — Chương 3, đoạn 12");
    expect(rows[0].textContent).not.toContain("kinh_te_vi_mo_20261101_120000");
    expect(rows[0].textContent).not.toContain(".pdf");
    expect(rows[0].querySelector("[title]").getAttribute("title")).toBe("kinh_te_vi_mo_20261101_120000");
    expect(rows[0].textContent).toContain("Luật cầu: giá tăng thì lượng cầu giảm.");
    // A stem with no matching document still shows something readable, not "nguồn".
    expect(rows[1].textContent).toContain("khong_co_trong_danh_sach, đoạn 3");
  });

  it("without passages, the documents used are listed by name", async () => {
    await render({ evidence: { sources: EVIDENCE.sources, chunks: [] }, sources: SOURCES, rightView: "evidence", onRightViewChange: noop });
    expect(container.textContent).toContain("Kinh tế vi mô — Chương 3");
    expect(container.textContent).not.toContain("kinh_te_vi_mo_20261101_120000");
  });
});
