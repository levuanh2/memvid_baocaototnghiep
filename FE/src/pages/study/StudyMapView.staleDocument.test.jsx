// @vitest-environment jsdom
// Map of document A -> map of document B while A is slow (V6 bug hunt #4). Neither load was
// tied to its document, so A answering last drew A's map and title under B's URL.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudyMapView from "./StudyMapView";
import { fourTierMapFixture } from "../../test/fixtures/fourTierMapFixture";

const stableStudyContext = { selectDocument: () => {}, selectNode: () => {} };
vi.mock("../../study/useStudyContext", () => ({ useStudyContext: () => stableStudyContext }));
vi.mock("react-d3-tree", () => ({ default: () => <div data-testid="tree-stub" /> }));

const docs = {};   // documentId -> deferred getDocument
const builds = {}; // documentId -> deferred generateStudyMap
const maps = { list: async (id) => [{ map_id: `map-${id}`, status: "completed" }] };
const fetchJobStatus = vi.fn(async () => ({ status: "processing", progress: 10 }));
vi.mock("../../utils/studyApi", async () => ({
  ...(await vi.importActual("../../utils/studyApi")),
  getDocument: (id) => new Promise((resolve, reject) => { docs[id] = { resolve, reject }; }),
  listStudyMaps: (id) => maps.list(id),
  generateStudyMap: (id) => new Promise((resolve, reject) => { builds[id] = { resolve, reject }; }),
  fetchJobStatus: (...a) => fetchJobStatus(...a),
  getStudyMap: async (mapId) => ({ map_id: mapId, title: `Sơ đồ ${mapId}`, nodes: fourTierMapFixture.studyNodes }),
  listChunks: async () => [],
}));

let go;
function Nav() { go = useNavigate(); return null; }

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove(); container = null; root = null;
  for (const k of Object.keys(docs)) delete docs[k];
  for (const k of Object.keys(builds)) delete builds[k];
  maps.list = async (id) => [{ map_id: `map-${id}`, status: "completed" }];
  fetchJobStatus.mockClear();
});
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

async function goFromAToB() {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/app/study/map/doc-A"]}>
        <Nav />
        <Routes><Route path="/app/study/map/:documentId" element={<StudyMapView />} /></Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => { go("/app/study/map/doc-B"); });
  expect(docs["doc-A"] && docs["doc-B"]).toBeTruthy();
}

describe("StudyMapView: a slow load for the previous document cannot land on the new one", () => {
  it("A answering after B leaves B's document on screen", async () => {
    await goFromAToB();
    await act(async () => { docs["doc-B"].resolve({ document_id: "doc-B", title: "Tài liệu B", source_stem: "b" }); });
    await flush();
    expect(container.textContent).toContain("Tài liệu B");
    await act(async () => { docs["doc-A"].resolve({ document_id: "doc-A", title: "Tài liệu A", source_stem: "a" }); });
    await flush();
    expect(container.textContent).toContain("Tài liệu B");
    expect(container.textContent).not.toContain("Tài liệu A");
  });

  it("a build started for A that is accepted after moving to B is not tracked on B", async () => {
    maps.list = async () => [];   // no map yet: the page offers to build one
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/app/study/map/doc-A"]}>
          <Nav />
          <Routes><Route path="/app/study/map/:documentId" element={<StudyMapView />} /></Routes>
        </MemoryRouter>,
      );
    });
    await act(async () => { docs["doc-A"].resolve({ document_id: "doc-A", title: "Tài liệu A", source_stem: "a" }); });
    await flush();
    const buildButton = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Dựng sơ đồ kiến thức"));
    expect(buildButton).toBeTruthy();
    await act(async () => { buildButton.click(); });
    expect(builds["doc-A"]).toBeTruthy();

    await act(async () => { go("/app/study/map/doc-B"); });
    await act(async () => { docs["doc-B"].resolve({ document_id: "doc-B", title: "Tài liệu B", source_stem: "b" }); });
    await flush();
    await act(async () => { builds["doc-A"].resolve({ job_id: "job-A" }); });
    await flush();
    expect(fetchJobStatus).not.toHaveBeenCalled();
  });

  it("A failing late shows no error over B", async () => {
    await goFromAToB();
    await act(async () => { docs["doc-A"].reject(new Error("A hỏng muộn")); });
    await flush();
    expect(container.textContent).not.toContain("Không tải được sơ đồ kiến thức");
    expect(container.textContent).not.toContain("A hỏng muộn");
  });
});
