// @vitest-environment jsdom
// PR C2 — exportCanonicalFullMap must apply the resolved export appearance
// (map's saved canvas appearance + optional export-only override) to the
// offscreen scene, via the exact same zero-further-layout engine the live
// canvas uses — "canvas and export resolve the same appearance contract".
import { describe, it, expect, vi } from "vitest";
import { exportMindmapImage } from "./mindmapImageExport";

function fakeSnapdom(targets) {
  return vi.fn(async (target) => {
    targets.push(target);
    return { download: vi.fn(async () => {}), toBlob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) };
  });
}

// Mirrors mindmapExportRender.v3.test.js's own FakeOffscreenMind, extended
// with findEle/container so applyLiveCanvasAppearance has something real
// to style and assert against (jsdom has no layout engine, so a real
// mind-elixir instance can't produce non-zero content bounds here).
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

const RECORD = {
  id: "m1", title: "Bản đồ", schema_version: 2, relations: [], sources: [],
  nodes: [
    { id: "root", kind: "root", title: "Root", parent: null },
    { id: "a", kind: "section", title: "A", parent: "root" },
    { id: "a1", kind: "idea", title: "A1", parent: "a" },
  ],
};

describe("exportCanonicalFullMap applies the resolved export appearance", () => {
  it("with no canvasAppearance/exportStyleOverride, styles nothing (true no-op, same as the live canvas default)", async () => {
    FakeOffscreenMind.instances = [];
    const targets = [];
    await exportMindmapImage({
      record: RECORD, scopeType: "full", format: "png", backgroundColor: "#fff",
      snapdom: fakeSnapdom(targets), settleMs: 0, MindElixirCtor: FakeOffscreenMind,
    });
    const rootEl = FakeOffscreenMind.instances.at(-1).findEle("root");
    expect(rootEl.style.background).toBe("");
    expect(rootEl.style.boxShadow).toBe("");
  });

  it("applies the map's saved canvasAppearance to the offscreen scene's own nodes", async () => {
    FakeOffscreenMind.instances = [];
    const targets = [];
    await exportMindmapImage({
      record: RECORD, scopeType: "full", format: "png", backgroundColor: "#fff",
      canvasAppearance: { version: 2, preset: "highContrast", overrides: {} },
      snapdom: fakeSnapdom(targets), settleMs: 0, MindElixirCtor: FakeOffscreenMind,
    });
    const rootEl = FakeOffscreenMind.instances.at(-1).findEle("root");
    expect(rootEl.style.background).not.toBe("");
  });

  it("an exportStyleOverride wins over the inherited canvasAppearance for the field it sets", async () => {
    FakeOffscreenMind.instances = [];
    const targets = [];
    await exportMindmapImage({
      record: RECORD, scopeType: "full", format: "png", backgroundColor: "#fff",
      canvasAppearance: { version: 2, preset: "highContrast", overrides: {} },
      exportStyleOverride: { node: { root: { fill: "#010203" }, branch: {}, leaf: {} } },
      snapdom: fakeSnapdom(targets), settleMs: 0, MindElixirCtor: FakeOffscreenMind,
    });
    const rootEl = FakeOffscreenMind.instances.at(-1).findEle("root");
    const probe = document.createElement("div");
    probe.style.background = "#010203";
    expect(rootEl.style.background).toBe(probe.style.background);
  });

  it("never calls layout()/linkDiv() a second time beyond the scene's own normal construction", async () => {
    FakeOffscreenMind.instances = [];
    const targets = [];
    await exportMindmapImage({
      record: RECORD, scopeType: "full", format: "png", backgroundColor: "#fff",
      canvasAppearance: { version: 2, preset: "study", overrides: {} },
      snapdom: fakeSnapdom(targets), settleMs: 0, MindElixirCtor: FakeOffscreenMind,
    });
    const instance = FakeOffscreenMind.instances.at(-1);
    expect(instance.layout).toHaveBeenCalledTimes(1); // the scene's OWN normal construction call, not an extra one from appearance
    expect(instance.linkDiv).toHaveBeenCalledTimes(1);
  });
});
