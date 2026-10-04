// @vitest-environment jsdom
// Controller-level lifecycle with a REAL Mind Elixir instance: the canvas
// selection (mind.bus "selectNodes") and the React selection must clear together,
// and the instance/transform must stay untouched.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixir from "mind-elixir";
import { useMindMapController } from "./useMindMapController";
import { StudyContextProvider } from "../study/StudyContextProvider";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

function record(id, topics) {
  return {
    id,
    title: `Map ${id}`,
    nodes: [
      { id: "root", parent: null, kind: "root", title: "Root" },
      ...topics.map((t) => ({ id: t, parent: "root", kind: "topic", title: t.toUpperCase() })),
    ],
    relations: [],
    sources: [],
  };
}

function tree(topics) {
  return {
    nodeData: { id: "root", topic: "Root", expanded: true, children: topics.map((t) => ({ id: t, topic: t.toUpperCase(), children: [] })) },
    arrows: [],
    summaries: [],
  };
}

let container;
let root;
let latest;
afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  container = null;
  root = null;
  latest = null;
});

function Harness({ data, mindRef }) {
  latest = useMindMapController(data);
  mindRef.current = latest;
  return null;
}

async function renderController(data, mindRef) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<StudyContextProvider><Harness data={data} mindRef={mindRef} /></StudyContextProvider>);
  });
  return root;
}

async function rerenderController(data, mindRef) {
  await act(async () => {
    root.render(<StudyContextProvider><Harness data={data} mindRef={mindRef} /></StudyContextProvider>);
  });
}

describe("useMindMapController — selection lifecycle with a real Mind Elixir instance", () => {
  it("clearSelectedNode clears React selection AND the canvas selection, without touching the instance or transform", async () => {
    const mindRef = { current: null };
    const data = record("map-a", ["a", "b"]);
    await renderController(data, mindRef);

    const mindContainer = document.createElement("div");
    mindContainer.style.width = "1200px";
    mindContainer.style.height = "800px";
    document.body.appendChild(mindContainer);
    const mind = new MindElixir({ el: mindContainer, direction: MindElixir.SIDE, editable: false, keypress: false, toolBar: false, contextMenu: false });
    mind.init(tree(["a", "b"]));
    const toCenter = vi.spyOn(mind, "toCenter");
    const scaleFit = vi.spyOn(mind, "scaleFit");

    const controller = mindRef.current;
    controller.registerMindInstance(mind, new Map());
    // Same wiring MindElixirView uses: canvas selection -> controller.
    mind.bus.addListener("selectNodes", (nodes) => controller.onNodeSelected(nodes));

    await act(async () => { mind.selectNode(mind.findEle("a")); });
    expect(mindRef.current.selected?.id).toBe("a");
    const rootTransformBefore = mindContainer.querySelector("me-root")?.style.transform ?? "";

    await act(async () => { mindRef.current.clearSelectedNode(); });

    expect(mindRef.current.selected).toBeNull();
    expect(mindContainer.querySelectorAll("me-tpc.selected").length).toBe(0);
    expect(mind.currentNode ?? null).toBeNull();
    expect(mindContainer.querySelector("me-root")?.style.transform ?? "").toBe(rootTransformBefore);
    expect(toCenter).not.toHaveBeenCalled();
    expect(scaleFit).not.toHaveBeenCalled();

    mindContainer.remove();
  });

  it("switching to another map clears the selection, and returning to the first map starts with none", async () => {
    const mindRef = { current: null };
    await renderController(record("map-a", ["a"]), mindRef);
    await act(async () => { mindRef.current.onNodeSelected([{ id: "a", topic: "A" }]); });
    expect(mindRef.current.selected?.id).toBe("a");

    await rerenderController(record("map-b", ["x"]), mindRef);
    expect(mindRef.current.selected).toBeNull();

    await rerenderController(record("map-a", ["a"]), mindRef);
    expect(mindRef.current.selected).toBeNull();
  });
});
