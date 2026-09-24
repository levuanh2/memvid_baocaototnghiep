// @vitest-environment jsdom
//
// 2026-09-24 regression: `missingEnrichment` checked for a per-node
// "enrichment" key that only ever existed on V2 records. Every V3 guided
// node (note/chunk_refs/node_type instead) failed that check, so
// `upgradeRequired` was true for every V3 map regardless of real quality --
// confirmed against a real production record with a genuine root/branch/leaf
// hierarchy and 14 real relations that still showed "Sơ đồ cũ · Nâng cấp".
// V2 behavior (real "old map" label on records that predate the guided
// pipeline) must be unchanged.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixirView from "./MindElixirView";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver = window.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} };
});

const CONTROLLER = { registerMindInstance: vi.fn(), onNodeSelected: vi.fn(), selected: null, sidecarRef: { current: new Map() } };
let container;

afterEach(() => {
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

async function renderView(data) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MindElixirView data={data} onRegenerate={vi.fn()} regenerating={false} controller={CONTROLLER} />);
  });
  return root;
}

function qualityStatusText() {
  return container.querySelector(".mm-quality-status")?.textContent || "";
}

describe("MindElixirView quality badge — V2 vs V3 schema", () => {
  it("does not flag a complete V3 record as 'Sơ đồ cũ · Nâng cấp'", async () => {
    await renderView({
      id: "map-v3", title: "V3 Map", schema_version: 3,
      nodes: [
        { id: "n0", parent: null, kind: "root", title: "Root", node_type: "concept", chunk_refs: [] },
        { id: "n1", parent: "n0", kind: "section", title: "Branch", node_type: "concept", chunk_refs: ["1"] },
      ],
      relations: [{ source: "n0", target: "n1", type: "part_of", label: "" }],
      sources: [], generator: { degraded: false, missing: [] },
    });
    expect(qualityStatusText()).not.toContain("Sơ đồ cũ");
    expect(qualityStatusText()).toContain("Đã kiểm tra");
  });

  it("still flags a real legacy V2 record as 'Sơ đồ cũ · Nâng cấp'", async () => {
    await renderView({
      id: "map-v2", title: "V2 Map", schema_version: 2,
      nodes: [{ id: "n0", parent: null, kind: "root", title: "Root" }],
      relations: [], sources: [],
    });
    expect(qualityStatusText()).toContain("Sơ đồ cũ · Nâng cấp");
  });
});
