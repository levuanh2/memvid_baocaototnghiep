// @vitest-environment jsdom
// P0-2: an artifact request with `create: true` (Mind Map empty-state CTA) runs
// the toolbar's create route once per request; a view request (Tutor "Xem sơ
// đồ") never starts a job.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarRight from "./SidebarRight";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import { generateMindmap, getMindmapCapability } from "../../utils/api";

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => {
    if (path === "/mindmaps") return { ok: true, json: async () => ({ mindmaps: [] }) };
    if (path === "/summaries") return { ok: true, json: async () => ({ summaries: [] }) };
    return { ok: true, json: async () => ({}) };
  }),
  generateMindmap: vi.fn(),
  suggestMindmapTopics: vi.fn(async () => ({ suggestions: [] })),
  cancelMindmap: vi.fn(), generateSummary: vi.fn(), cancelSummary: vi.fn(),
  getMindmapCapability: vi.fn(),
  isUnauthorizedError: vi.fn(() => false), isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((e) => String(e)),
}));
vi.mock("../ui/Toaster", () => ({ toast: vi.fn() }));

const noop = () => {};
let container; let root;
beforeEach(() => { generateMindmap.mockReturnValue(new Promise(() => {})); });
afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  localStorage.clear(); generateMindmap.mockReset(); getMindmapCapability.mockReset();
});

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
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
const dialogCount = () => document.body.querySelectorAll('[role="dialog"]').length;

describe("Mind Map empty-state create request", () => {
  it("Guided OFF: starts one legacy job; a later selection change does not start another", async () => {
    getMindmapCapability.mockResolvedValue({ guided_mindmap_v3: false });
    await render({ selectedSources: ["doc-1"] });
    const request = { tab: "mindmap", nonce: 1, create: true };
    await render({ selectedSources: ["doc-1"], artifactRequest: request });
    expect(generateMindmap).toHaveBeenCalledTimes(1);
    await render({ selectedSources: ["doc-1", "doc-2"], artifactRequest: request });
    expect(generateMindmap).toHaveBeenCalledTimes(1);
  });

  it("Guided ON: opens the Guided dialog, no legacy job", async () => {
    getMindmapCapability.mockResolvedValue({ guided_mindmap_v3: true });
    await render({ selectedSources: ["doc-1"] });
    await render({ selectedSources: ["doc-1"], artifactRequest: { tab: "mindmap", nonce: 2, create: true } });
    expect(dialogCount()).toBe(1);
    expect(generateMindmap).not.toHaveBeenCalled();
  });

  it("view request (Tutor 'Xem sơ đồ') with Guided OFF starts nothing", async () => {
    getMindmapCapability.mockResolvedValue({ guided_mindmap_v3: false });
    await render({ selectedSources: ["doc-1"] });
    await render({ selectedSources: ["doc-1"], artifactRequest: { tab: "mindmap", nonce: 3 } });
    expect(generateMindmap).not.toHaveBeenCalled();
    expect(dialogCount()).toBe(0);
  });
});
