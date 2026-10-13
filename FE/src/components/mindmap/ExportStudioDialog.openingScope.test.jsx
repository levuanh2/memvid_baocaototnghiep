// @vitest-environment jsdom
//
// PR G — root cause (confirmed with real exported SVG and PDF files against
// both the backend-free fixture harness and a real backend job): the
// Export Studio scope radio is seeded ONLY once, at the dialog's very
// first mount (`useState(selectedNodeId ? "current_branch" : "full")`),
// and never re-derived later -- not even when the dialog is reopened with
// a fresh selection. A user who selects a node, opens Export Studio, sees
// "Toàn bộ sơ đồ" silently pre-picked, and exports without noticing gets
// the whole map for every format (PNG/JPEG/SVG/WebP and PDF alike, since
// they all share this one dialog's state).
//
// Contract (approved checkpoint) for the closed -> open edge only:
//   1. selectedBranchIds non-empty  -> "selected_branches"
//   2. else selectedNodeId set      -> "current_branch"
//   3. else                          -> "full"
// Never re-seeds while already open, even if the selection changes under
// it; a manual radio change during the open session must stick until the
// dialog closes and reopens.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import ExportStudioDialog from "./ExportStudioDialog";

vi.mock("../../utils/mindmapImageExport", async (loadOriginal) => {
  const original = await loadOriginal();
  return {
    ...original,
    estimateExportDimensions: () => ({ width: 1200, height: 800 }),
    exportMindmapImage: vi.fn().mockResolvedValue({ filename: "map.png" }),
  };
});

const { createMindmapExportMock } = vi.hoisted(() => ({ createMindmapExportMock: vi.fn() }));
vi.mock("../../utils/mindmapDocumentExport", () => ({
  createMindmapExport: createMindmapExportMock,
  pollMindmapExportUntilDone: vi.fn().mockResolvedValue({ status: "done", download_url: "/x" }),
  cancelMindmapExport: vi.fn(),
  triggerMindmapExportDownload: vi.fn(),
}));

beforeAll(() => {
  window.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});

// A -> A1 -> A2 (section "a"), B -> B1 (section "b") -- mirrors the Phase 2
// fixture tree's shape closely enough for pure dialog-state assertions
// (this file never exports real content, just inspects the scope radio).
const nodeData = {
  id: "root", topic: "Root", expanded: true,
  children: [
    { id: "a", topic: "A", expanded: true, children: [{ id: "a1", topic: "A1", expanded: true, children: [] }] },
    { id: "b", topic: "B", expanded: true, children: [{ id: "b1", topic: "B1", expanded: true, children: [] }] },
  ],
};
const mind = { nodeData, map: document.createElement("div"), container: document.createElement("div") };

let host;
let root;

function Harness(props) {
  return <ExportStudioDialog mind={mind} mapId="map-1" title="Bản đồ thử nghiệm" onClose={vi.fn()} onRequestBranchSelection={vi.fn()} {...props} />;
}

async function mountClosed(strict = false) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const body = <Harness open={false} selectedNodeId={null} selectedBranchIds={new Set()} />;
  await act(async () => root.render(strict ? <StrictMode>{body}</StrictMode> : body));
}

async function update(props, strict = false) {
  const body = <Harness {...props} />;
  await act(async () => root.render(strict ? <StrictMode>{body}</StrictMode> : body));
}

function dialog() {
  return document.body.querySelector('[role="dialog"]');
}

function checkedScope() {
  const checked = dialog()?.querySelector('input[name="mm-export-scope"]:checked');
  return checked?.value ?? null;
}

function clickScopeRadio(value) {
  const input = dialog().querySelector(`input[name="mm-export-scope"][value="${value}"]`);
  return act(async () => input.click());
}

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("ExportStudioDialog — opening scope seeded on the closed->open edge", () => {
  it("mounted hidden with nothing selected, then a node is selected, then opened: current_branch", async () => {
    await mountClosed();
    await update({ open: false, selectedNodeId: "a", selectedBranchIds: new Set() }); // select while still closed
    await update({ open: true, selectedNodeId: "a", selectedBranchIds: new Set() }); // open
    expect(checkedScope()).toBe("current_branch");
  });

  it("multiple branches selected, then opened: selected_branches", async () => {
    await mountClosed();
    const branches = new Set(["a", "b"]);
    await update({ open: false, selectedNodeId: null, selectedBranchIds: branches });
    await update({ open: true, selectedNodeId: null, selectedBranchIds: branches });
    expect(checkedScope()).toBe("selected_branches");
  });

  it("nothing selected, then opened: full", async () => {
    await mountClosed();
    await update({ open: true, selectedNodeId: null, selectedBranchIds: new Set() });
    expect(checkedScope()).toBe("full");
  });

  it("opened with A (current_branch), user switches to full by hand, selection changes under the open dialog: stays full", async () => {
    await mountClosed();
    await update({ open: true, selectedNodeId: "a", selectedBranchIds: new Set() });
    expect(checkedScope()).toBe("current_branch");

    await clickScopeRadio("full");
    expect(checkedScope()).toBe("full");

    // Selection changes to a DIFFERENT node while the dialog is still open --
    // must NOT re-seed and knock the manual "full" choice back to current_branch.
    await update({ open: true, selectedNodeId: "b", selectedBranchIds: new Set() });
    expect(checkedScope()).toBe("full");
  });

  it("close, clear the selection, reopen: full", async () => {
    await mountClosed();
    await update({ open: true, selectedNodeId: "a", selectedBranchIds: new Set() });
    expect(checkedScope()).toBe("current_branch");

    await update({ open: false, selectedNodeId: null, selectedBranchIds: new Set() });
    await update({ open: true, selectedNodeId: null, selectedBranchIds: new Set() });
    expect(checkedScope()).toBe("full");
  });

  it("close, select a different node (B), reopen: current_branch", async () => {
    await mountClosed();
    await update({ open: true, selectedNodeId: "a", selectedBranchIds: new Set() });
    await clickScopeRadio("full"); // manual override during the first session
    await update({ open: false, selectedNodeId: "a", selectedBranchIds: new Set() });

    await update({ open: false, selectedNodeId: "b", selectedBranchIds: new Set() });
    await update({ open: true, selectedNodeId: "b", selectedBranchIds: new Set() });
    expect(checkedScope()).toBe("current_branch");
  });

  it("both a selected node AND selected branches exist: selected_branches wins", async () => {
    await mountClosed();
    const branches = new Set(["a", "b"]);
    await update({ open: true, selectedNodeId: "a", selectedBranchIds: branches });
    expect(checkedScope()).toBe("selected_branches");
  });

  it("StrictMode double-invoke does not corrupt the seeded scope", async () => {
    await mountClosed(true);
    await update({ open: false, selectedNodeId: "a", selectedBranchIds: new Set() }, true);
    await update({ open: true, selectedNodeId: "a", selectedBranchIds: new Set() }, true);
    expect(checkedScope()).toBe("current_branch");
  });

  it("re-opening without changing anything keeps re-deriving the same answer (idempotent)", async () => {
    await mountClosed();
    await update({ open: true, selectedNodeId: "a", selectedBranchIds: new Set() });
    expect(checkedScope()).toBe("current_branch");
    await update({ open: false, selectedNodeId: "a", selectedBranchIds: new Set() });
    await update({ open: true, selectedNodeId: "a", selectedBranchIds: new Set() });
    expect(checkedScope()).toBe("current_branch");
  });
});

describe("ExportStudioDialog — the DEFAULT (never manually touched) scope reaches the real export call", () => {
  it("opens with A selected and exports PDF without touching the radio: BE payload scope_type is current_branch", async () => {
    createMindmapExportMock.mockResolvedValue({ job_id: "job-1", status: "queued" });
    await mountClosed();
    await update({ open: true, selectedNodeId: "a", selectedBranchIds: new Set() });
    expect(checkedScope()).toBe("current_branch"); // never clicked by hand

    const clickText = async (text) => {
      const btn = [...dialog().querySelectorAll("button")].find((b) => b.textContent.trim() === text);
      await act(async () => btn.click());
    };
    await clickText("Tiếp tục"); // -> format
    await act(async () => dialog().querySelector('input[name="mm-export-format"][value="pdf"]').click());
    await clickText("Tiếp tục"); // -> appearance
    await clickText("Tiếp tục"); // -> review
    await clickText("Thử lại").catch(() => {}); // no-op if not present
    const exportBtn = [...dialog().querySelectorAll("button")].find((b) => /Tạo PDF/.test(b.textContent));
    await act(async () => exportBtn.click());

    expect(createMindmapExportMock).toHaveBeenCalled();
    const [, payload] = createMindmapExportMock.mock.calls[0];
    expect(payload.scope.scope_type).toBe("current_branch");
  });
});
