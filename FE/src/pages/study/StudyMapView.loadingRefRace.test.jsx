// @vitest-environment jsdom
//
// Round 4 regression for the loading/ref race documented in
// .playbook/known-issues.md ("StudyMap proportional mobile zoom ... Follow-up").
// `StudyShell` unmounts the canvas while `loading` is true; `setMap(body)`
// commits on an earlier render than `setLoading(false)` (two separate
// `setState` calls split by `listChunks`'s own await inside `load()`), so the
// narrow-canvas effect's FIRST run after `map` changes always finds
// `canvasRef.current === null`. Without `loading` in that effect's dependency
// array, it never re-fires once the canvas actually mounts, and the zoom/
// translate defaults are never replaced — reproduced here via two separate,
// real `act()`-flushed commits (map arrives, then loading flips), matching
// the live-browser repro rather than a single synchronous resolve.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudyMapView from "./StudyMapView";
import { fourTierMapFixture } from "../../test/fixtures/fourTierMapFixture";

// Stable references across renders -- an inline `() => ({...})` factory would
// return a fresh `selectDocument` identity every render, destabilizing
// `load`'s own `useCallback([documentId, openMap, selectDocument])` and
// re-triggering `useEffect(() => { load(); }, [load])` on every commit.
const stableStudyContext = { selectDocument: () => {}, selectNode: () => {} };
vi.mock("../../study/useStudyContext", () => ({
  useStudyContext: () => stableStudyContext,
}));

// react-d3-tree binds d3-zoom on mount, which needs SVG APIs (`viewBox.baseVal`
// etc.) jsdom doesn't implement. The orientation/zoom effect under test reads
// only `canvasRef.current` and `map`/`loading` state — nothing inside Tree's
// own mount lifecycle — so a trivial stub keeps the real effect under test
// while sidestepping an unrelated jsdom/d3-zoom gap.
vi.mock("react-d3-tree", () => ({ default: () => <div data-testid="tree-stub" /> }));

const getDocument = vi.fn();
const listStudyMaps = vi.fn();
const getStudyMap = vi.fn();
const listChunks = vi.fn();
vi.mock("../../utils/studyApi", async () => {
  const actual = await vi.importActual("../../utils/studyApi");
  return {
    ...actual,
    getDocument: (...a) => getDocument(...a),
    listStudyMaps: (...a) => listStudyMaps(...a),
    getStudyMap: (...a) => getStudyMap(...a),
    listChunks: (...a) => listChunks(...a),
  };
});

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  if (container) container.remove();
  container = null; root = null;
  getDocument.mockReset(); listStudyMaps.mockReset(); getStudyMap.mockReset(); listChunks.mockReset();
});

beforeEach(() => {
  getDocument.mockResolvedValue({ document_id: "doc-1", title: fourTierMapFixture.title, source_stem: "fixture-4tier" });
  listStudyMaps.mockResolvedValue([{ map_id: "map-1", status: "completed" }]);
  getStudyMap.mockResolvedValue({ map_id: "map-1", title: fourTierMapFixture.title, nodes: fourTierMapFixture.studyNodes });
  // A real, separate microtask tick after `setMap` — the exact gap that
  // previously left `canvasRef.current` unmounted when the orientation
  // effect's dependencies first changed.
  listChunks.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([]), 0)));
});

describe("StudyMapView narrow-canvas zoom survives the loading/ref race", () => {
  it("applies the mobile zoom floor after the canvas mounts on a later commit than `map`", async () => {
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/app/study/map/doc-1"]}>
          <Routes><Route path="/app/study/map/:documentId" element={<StudyMapView />} /></Routes>
        </MemoryRouter>,
      );
    });
    // Flush: getDocument + listStudyMaps resolve, then getStudyMap resolves
    // (map commits here, loading still true), then listChunks's deferred
    // promise resolves on its own later tick (loading flips false only then).
    for (let i = 0; i < 10; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }

    // jsdom's getBoundingClientRect is {0,0,0,0} by default, so this asserts
    // the SAME narrow-canvas branch the live 390px/320px repro exercised
    // (width 0 < 500) actually ran, not merely that it was computed correctly
    // in isolation.
    expect(container.textContent).toContain("65%");
    expect(container.textContent).not.toContain("80%");
  });
});
