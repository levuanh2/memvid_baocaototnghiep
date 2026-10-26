// @vitest-environment jsdom
//
// Round 4.1 — export-fidelity closure. Regression for the confirmed defect:
// `sourceProjection()` used to bucket every node at original depth >= 2
// (concept AND detail alike) into a single "leaf" role, and the CSS override
// for that role (`.mm-export-offscreen me-tpc[data-export-source-role="leaf"]`)
// was unscoped — it matched every leaf-role node anywhere in the exported
// tree, not only a promoted structural root — so it always won (by
// selector specificity) over the real four-tier depth-based CSS, collapsing
// concept and detail nodes to one identical, stale look in every non-"full"
// export scope.
//
// The fix adds a SEPARATE, additive `visualTiers` map (root/section/concept/
// detail, computed from the exact same original-depth data `sourceRoles`
// already derives from) alongside the pre-existing `sourceRoles`
// (root/branch/leaf) — `sourceRoles`/`exportSourceRole` are left completely
// unchanged, since a separate, pre-existing, deliberately-3-tier appearance-
// preset system (mindMapAppearanceLiveApply.js's `resolved.node[...]`) reads
// that exact field and would break if it suddenly saw a 4th role value it
// has no preset slot for.
//
// These tests assert the real computed DOM attribute each node ends up
// with — not merely that attributes exist — across every scope the defect
// could reach, plus a membership check and an appearance-preset
// backward-compatibility check.
import { describe, it, expect, vi } from "vitest";
import { exportMindmapImage } from "./mindmapImageExport";

function fakeSnapdom(targets) {
  return vi.fn(async (target) => {
    targets.push(target);
    return { download: vi.fn(async () => {}), toBlob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) };
  });
}

// Mirrors mindmapImageExportAppearanceV2.test.js's own FakeOffscreenMind.
class FakeOffscreenMind {
  static SIDE = 2;
  constructor({ el }) {
    this.container = el;
    this.map = document.createElement("div");
    const els = new Map();
    this.findEle = (id) => els.get(id) || null;
    const mk = (n, depth) => {
      const tpc = document.createElement("me-tpc");
      tpc.dataset.nodeid = n.id;
      tpc.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 40 * (depth + 1), width: 200, height: 40 });
      els.set(n.id, tpc);
      this.map.appendChild(tpc);
      (n.children || []).forEach((c) => mk(c, depth + 1));
    };
    this._mk = mk;
    el.appendChild(this.map);
    this.layout = vi.fn();
    this.linkDiv = vi.fn();
    this.destroy = vi.fn();
    FakeOffscreenMind.instances.push(this);
  }
  init(data) { this.nodeData = data?.nodeData; this._mk(data.nodeData, 0); }
}
FakeOffscreenMind.instances = [];

// R (root) -> A, B (sections) -> A1, A2 (concepts, children of A) -> A1a, A2a
// (details, children of A1/A2). B has no children: the deliberate "unselected
// sibling that must remain excluded" from any export scoped to A's subtree.
// A1's title is the deterministic long-Vietnamese-title fixture other Round 4
// tests already use, kept here too so a real export of this fixture is
// visually checkable, not just attribute-checkable.
const RECORD = {
  id: "m1", title: "Hệ điều hành hiện đại", schema_version: 2, relations: [], sources: [],
  nodes: [
    { id: "R", kind: "root", title: "Hệ điều hành hiện đại", parent: null, order: 0 },
    { id: "A", kind: "section", title: "Quản lý tiến trình", parent: "R", order: 0 },
    { id: "B", kind: "section", title: "Quản lý bộ nhớ", parent: "R", order: 1 },
    { id: "A1", kind: "idea", title: "Cơ chế điều phối tiến trình hiện đại bảo đảm công bằng phản hồi nhanh và tránh bế tắc trong hệ thống nhiều lõi", parent: "A", order: 0 },
    { id: "A1a", kind: "detail", title: "Ví dụ nhận diện và phòng tránh bế tắc", parent: "A1", order: 0 },
    { id: "A2", kind: "idea", title: "Lập lịch round-robin", parent: "A", order: 1 },
    { id: "A2a", kind: "detail", title: "Ví dụ quantum 10ms mỗi tiến trình", parent: "A2", order: 0 },
  ],
};

async function runExport(opts) {
  FakeOffscreenMind.instances = [];
  const targets = [];
  await exportMindmapImage({
    record: RECORD, format: "png", backgroundColor: "#fff",
    snapdom: fakeSnapdom(targets), settleMs: 0, MindElixirCtor: FakeOffscreenMind,
    ...opts,
  });
  return FakeOffscreenMind.instances.at(-1);
}

const roleOf = (instance, id) => instance.findEle(id)?.dataset.exportSourceRole;

describe("export visual-role fidelity (Round 4.1)", () => {
  it("'full' scope sets no data-export-source-role at all — the real depth-based CSS governs, untouched", async () => {
    const instance = await runExport({ scopeType: "full" });
    expect(roleOf(instance, "A")).toBeUndefined();
    expect(roleOf(instance, "A1")).toBeUndefined();
    expect(roleOf(instance, "A1a")).toBeUndefined();
  });

  it("'current_branch' rooted at a CONCEPT node: concept and its detail child get distinct tiers, not the same flattened one", async () => {
    const instance = await runExport({ scopeType: "current_branch", targetNodeId: "A1" });
    expect(roleOf(instance, "A1")).toBe("concept");
    expect(roleOf(instance, "A1a")).toBe("detail");
    expect(roleOf(instance, "A1")).not.toBe(roleOf(instance, "A1a"));
  });

  it("'current_branch' rooted at a SECTION node: section/concept/detail all three distinct, unselected sibling absent", async () => {
    const instance = await runExport({ scopeType: "current_branch", targetNodeId: "A" });
    expect(roleOf(instance, "A")).toBe("section");
    expect(roleOf(instance, "A1")).toBe("concept");
    expect(roleOf(instance, "A1a")).toBe("detail");
    expect(roleOf(instance, "A2")).toBe("concept");
    expect(roleOf(instance, "A2a")).toBe("detail");
    // Negative membership case — B is a sibling of A, never a selected scope
    // target or its descendant, and must not appear in the exported tree.
    expect(instance.findEle("B")).toBeNull();
    expect(instance.nodeData.children.some((c) => c.id === "B")).toBe(false);
  });

  it("'selected_branches' EXACT mode genuinely promotes a section to the structural root — its concept children keep concept styling, not section styling re-derived from their new shallower DOM position", async () => {
    const instance = await runExport({
      scopeType: "selected_branches", branchRootIds: ["A1", "A2"], includeDescendants: false,
    });
    // Exact-checkbox mode's own contract: only the ticked nodes plus the
    // minimal connecting ancestor (here "A", A1/A2's real LCA) render — A1a/
    // A2a (descendants, not ticked) are correctly absent.
    expect(instance.findEle("A1a")).toBeNull();
    // The real regression: A is promoted to be the export's DOM root (its
    // own true parent, R, is excluded from this exact selection), but A1 and
    // A2 — now sitting at DOM depth 1 directly under that promoted root,
    // the exact DOM position the "section" tier CSS keys off — must still
    // read their TRUE original depth-2 "concept" role, not get silently
    // re-skinned as another section.
    expect(roleOf(instance, "A")).toBe("section");
    expect(roleOf(instance, "A1")).toBe("concept");
    expect(roleOf(instance, "A2")).toBe("concept");
    expect(roleOf(instance, "A1")).not.toBe(roleOf(instance, "A"));
  });

  it("'visible' scope is untouched by this fix — it captures the live DOM directly, never builds a sourceRoles/visualTiers projection", async () => {
    const targets = [];
    FakeOffscreenMind.instances = [];
    const mind = {
      nodeData: { id: "R" }, map: document.createElement("div"),
      findEle: () => null,
    };
    await exportMindmapImage({
      mind, scopeType: "visible", format: "png", backgroundColor: "#fff",
      snapdom: fakeSnapdom(targets), settleMs: 0, MindElixirCtor: FakeOffscreenMind,
    });
    // No record-based offscreen instance is ever constructed for "visible" —
    // the live mind.map itself is handed straight to snapdom.
    expect(FakeOffscreenMind.instances.length).toBe(0);
    expect(targets[0]).toBe(mind.map);
  });

  it("the pre-existing 3-role appearance-preset system (sourceRoles/exportSourceRole) still resolves correctly for a non-full scope — unchanged by the new visualTiers map", async () => {
    const instance = await runExport({
      scopeType: "current_branch", targetNodeId: "A1",
      exportStyleOverride: { node: { root: {}, branch: {}, leaf: { fill: "#010203" } } },
    });
    const probe = document.createElement("div");
    probe.style.background = "#010203";
    // A1a is a "leaf" under the OLD 3-role scheme (sourceRoles, still exactly
    // as before) regardless of its NEW 4-tier "detail" visualTier — the
    // appearance override must still apply to it via that unchanged field.
    expect(instance.findEle("A1a").style.background).toBe(probe.style.background);
  });
});
