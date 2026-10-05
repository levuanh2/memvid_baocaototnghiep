// @vitest-environment jsdom
//
// Regression: "Tạo sơ đồ mới" clicked before GET /mindmaps/capability resolved
// took the legacy generation path (runMindmapGeneration -> POST /generate-mindmap)
// instead of opening the Guided dialog, because guidedCapability started as
// `false`, which means "guided is off", not "not known yet". Production QA saw
// the Guided dialog fail to open at random widths for exactly this reason.
// Unknown capability must open Guided; only a confirmed `false` may fall back.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarRight from "./SidebarRight";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import { generateMindmap, getMindmapCapability } from "../../utils/api";

const noop = () => {};

function Harness({ onMindmapLibraryChange }) {
  return (
    <StudyContextProvider>
      <SidebarRight
        selectedSources={["doc-1"]} evidence={null} onMindmapDataChange={noop}
        onMindmapLibraryChange={onMindmapLibraryChange}
        onSummaryDataChange={noop} onSwitchToChat={noop}
      />
    </StudyContextProvider>
  );
}

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => {
    if (path === "/mindmaps") return { ok: true, json: async () => ({ mindmaps: [] }) };
    if (path === "/summaries") return { ok: true, json: async () => ({ summaries: [] }) };
    return { ok: true, json: async () => ({}) };
  }),
  generateMindmap: vi.fn(),
  suggestMindmapTopics: vi.fn(async () => ({ suggestions: [] })),
  cancelMindmap: vi.fn(), generateSummary: vi.fn(), cancelSummary: vi.fn(),
  getMindmapCapability: vi.fn(async () => ({ guided_mindmap_v3: true })),
  isUnauthorizedError: vi.fn(() => false), isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((e) => String(e)),
}));

let container;
let root;

afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  localStorage.clear();
  generateMindmap.mockClear();
  vi.restoreAllMocks();
});

async function clickCreateBeforeCapabilityResolves() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let libraryActions;

  await act(async () => {
    root.render(<Harness onMindmapLibraryChange={(value) => { libraryActions = value.actions; }} />);
  });
  // Capability is still in flight here: the click lands before it resolves.
  await act(async () => { libraryActions.create(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("Guided capability not yet known", () => {
  it("opens the Guided dialog instead of generating when the click lands first", async () => {
    getMindmapCapability.mockReturnValue(new Promise(() => {}));

    await clickCreateBeforeCapabilityResolves();

    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
    expect(generateMindmap).not.toHaveBeenCalled();
  });

  it("still uses the legacy generation path once capability is confirmed off", async () => {
    getMindmapCapability.mockResolvedValue({ guided_mindmap_v3: false });
    generateMindmap.mockReturnValue(new Promise(() => {}));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let libraryActions;
    await act(async () => {
      root.render(<Harness onMindmapLibraryChange={(value) => { libraryActions = value.actions; }} />);
    });
    // Flush the confirmed-off capability response before clicking.
    await act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
    await act(async () => { libraryActions.create(); });

    expect(document.body.querySelector('[role="dialog"]')).toBeFalsy();
    expect(generateMindmap).toHaveBeenCalledTimes(1);
  });
});
