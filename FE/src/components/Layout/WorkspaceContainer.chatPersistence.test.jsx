// @vitest-environment jsdom
//
// Regression for round 7 (top-chrome reduction): the whole point of
// WorkspaceContainer's CSS-`hidden` pane-switching architecture (see its own
// top-of-file comment) is that ChatArea NEVER remounts — switching modes,
// opening/closing the Inspector, collapsing the source rail, or collapsing
// the goal banner must never reset the conversation. Round 7 restructured
// ChatArea's internal JSX (moved the goal banner/next-action/conversation-
// toolbar rows from persistent chrome into the scrollable content) without
// touching its mount point or adding a `key` — this test proves that
// invariant still holds by counting real mount effects, not just reading
// the source.
//
// Scoped to WorkspaceContainer itself (not the full MainLayout, which needs
// far more mocking) because that's the actual component owning the
// hidden-vs-flex-1 toggle ChatArea's persistence depends on; Inspector
// open/close and source-rail collapse live in MainLayout and don't affect
// WorkspaceContainer's own tree at all, which is exactly the property this
// test also demonstrates (mode is the only prop this component uses to
// decide what's visible, and it never conditionally omits ChatArea).
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { useEffect } from "react";
import WorkspaceContainer from "./WorkspaceContainer";

let mountCount = 0;
let unmountCount = 0;

vi.mock("./ChatArea", () => ({
  default: function ChatAreaStub() {
    useEffect(() => {
      mountCount += 1;
      return () => { unmountCount += 1; };
    }, []);
    return <div data-testid="chat-area-stub">chat</div>;
  },
}));
vi.mock("../mindmap/MindElixirView", () => ({ default: () => <div>mindmap</div> }));
vi.mock("./SummaryPane", () => ({ default: () => <div>summary</div> }));

let container;

afterEach(() => {
  if (container) {
    document.body.removeChild(container);
    container = null;
  }
  mountCount = 0;
  unmountCount = 0;
  vi.restoreAllMocks();
});

describe("WorkspaceContainer keeps ChatArea mounted across mode switches", () => {
  it("mounts ChatArea exactly once regardless of how many times mode changes", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const render = (mode) => act(async () => {
      root.render(
        <WorkspaceContainer
          mode={mode} onModeChange={() => {}}
          chatProps={{ selectedSources: [] }}
          mindmapData={null} summaryData={null} controller={{}}
          lessonTitle="Test" onMindmapAction={() => {}} onSummaryAction={() => {}}
        />
      );
    });

    await render("chat");
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);

    // Cycle through every mode several times — the exact interaction pattern
    // point 5 lists (mode switching, panel toggles that re-render the tree).
    for (const mode of ["mindmap", "summary", "chat", "mindmap", "chat"]) {
      await render(mode);
    }

    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);

    // ChatArea's wrapper div must be the CSS-hidden class, not removed from
    // the DOM — the actual mechanism the "never remounts" guarantee rests on.
    await render("mindmap");
    const chatStub = container.querySelector('[data-testid="chat-area-stub"]');
    expect(chatStub).toBeTruthy(); // still in the DOM even while Mind Map is the active pane
    expect(chatStub.parentElement.className).toContain("hidden");

    await render("chat");
    expect(chatStub.parentElement.className).not.toContain("hidden");
    expect(mountCount).toBe(1);
  });
});
