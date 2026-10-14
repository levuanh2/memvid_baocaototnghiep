// @vitest-environment jsdom
//
// PR H2 Phase 4 QA gap: captureMapImageWithGeometry/extractGeometryManifest/
// MapCaptureLimitError (added in 8e02633/eb556b9) had ZERO direct unit
// coverage — only mocked away at the ExportStudioDialog level, and only the
// zoom-transform bug got a real-browser Playwright check. jsdom has no real
// createImageBitmap, so it's stubbed here (same spirit as this file's
// existing snapdom injection) to exercise the REAL _finishCapture/
// extractGeometryManifest code paths deterministically.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import MindElixir from "mind-elixir";
import { captureMapImageWithGeometry, exportMindmapImage, MapCaptureLimitError } from "./mindmapImageExport";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

function makeMind() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const mind = new MindElixir({ el, direction: MindElixir.SIDE, compact: true, editable: true, toolBar: false });
  mind.init({
    nodeData: {
      id: "root", topic: "Root", expanded: true,
      children: [{ id: "a", topic: "Alpha", expanded: true, children: [] }],
    },
  });
  return mind;
}

function fakeResult() {
  return {
    download: vi.fn().mockResolvedValue(undefined),
    toBlob: vi.fn().mockResolvedValue(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" })),
  };
}

function stubImageBitmap(width, height) {
  const bitmap = vi.fn().mockResolvedValue({ width, height });
  vi.stubGlobal("createImageBitmap", bitmap);
  return bitmap;
}

let mind;
afterEach(() => { mind?.destroy?.(); mind = null; document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("captureMapImageWithGeometry", () => {
  it("returns a manifest built from the REAL captured target's DOM, in bitmap pixel coords derived from the real decoded bitmap (not devicePixelRatio)", async () => {
    mind = makeMind();
    stubImageBitmap(2000, 1000); // real bitmap 2x the mounted CSS size below
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    // jsdom returns zero-size rects by default; force a real size on the
    // target so effective_scale (bitmap / CSS width) is a known, checkable 2x.
    const { base64, geometryManifest } = await captureMapImageWithGeometry({
      mind, scopeType: "visible", snapdom, settleMs: 0,
    });
    expect(base64.length).toBeGreaterThan(0);
    // jsdom has no real layout engine (every getBoundingClientRect is
    // zero-size), so x/y/width/height/font_size_px are degenerate here —
    // real pixel values are covered by the real-browser Playwright suite
    // (mindmap-visible-geometry-transform.spec.js). This test's job is the
    // WIRING: correct dims from the real decoded bitmap, one manifest entry
    // per real me-tpc/path element, built from THIS capture (no 2nd render).
    expect(geometryManifest.version).toBe(1);
    expect(geometryManifest.image_width_px).toBe(2000);
    expect(geometryManifest.image_height_px).toBe(1000);
    expect(geometryManifest.nodes.map((n) => n.id).sort()).toEqual(["a", "root"]);
    expect(geometryManifest.connectors.length).toBeGreaterThanOrEqual(0);
  });

  it("throws MapCaptureLimitError and skips manifest building when the real decoded bitmap exceeds MAX_CAPTURE_DIMENSION_PX, and never calls download", async () => {
    mind = makeMind();
    stubImageBitmap(12001, 500);
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    await expect(captureMapImageWithGeometry({ mind, scopeType: "visible", snapdom, settleMs: 0 }))
      .rejects.toThrow(MapCaptureLimitError);
    expect(result.download).not.toHaveBeenCalled();
  });

  it("throws MapCaptureLimitError when the real decoded bitmap exceeds MAX_CAPTURE_PIXELS even with both dimensions individually under the per-axis cap", async () => {
    mind = makeMind();
    stubImageBitmap(8000, 6000); // 48,000,000 px > 40,000,000, both axes < 12000
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    const err = await captureMapImageWithGeometry({ mind, scopeType: "visible", snapdom, settleMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(MapCaptureLimitError);
    expect(err.code).toBe("map_capture_dimension_limit");
    expect(err.details).toEqual({ width: 8000, height: 6000 });
  });

  it("a capture WITHOUT withGeometryManifest never builds a manifest nor applies the capture-dimension guard, even when the decoded bitmap would exceed it", async () => {
    mind = makeMind();
    stubImageBitmap(99999, 99999); // would violate MAX_CAPTURE_DIMENSION_PX if the guard ran
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    const { base64, geometryManifest } = await exportMindmapImage({
      mind, scopeType: "visible", format: "png", title: "T", outputMode: "base64", snapdom, settleMs: 0,
    });
    expect(base64.length).toBeGreaterThan(0);
    expect(geometryManifest).toBeNull();
  });
});
