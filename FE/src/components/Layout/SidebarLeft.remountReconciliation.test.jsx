// @vitest-environment jsdom
//
// SidebarLeft unmounts and remounts on every 768px / 1280px crossing. A fresh mount used to start
// from `sources = []`, so when `/list-indexed` then returned the same file under a new stem, the
// reconciliation had no old filename to follow and dropped the user's selection. The layout now
// seeds the new mount with its last known list (`initialSources`).
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarLeft from "./SidebarLeft";

let listIndexed;
vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => (path === "/list-indexed" ? listIndexed() : { ok: true, json: async () => ({}) })),
  _appError: vi.fn(async () => new Error("list failed")), isUnauthorizedError: vi.fn(() => false),
  isNotFoundOrForbiddenError: vi.fn(() => false), getUserFriendlyApiError: vi.fn((e) => String(e)),
}));

const ok = (sources) => async () => ({ ok: true, json: async () => ({ sources }) });
const doc = (stem) => ({ video_stem: stem, filename: "same.pdf", num_chunks: 3 });
const state = {};

function Harness() {
  const [show, setShow] = useState(true);
  const [selected, setSelected] = useState(["old_stem"]);
  const [retained, setRetained] = useState([]);
  Object.assign(state, { setShow, selected, retained });
  return show ? (
    <SidebarLeft selectedSources={selected} setSelectedSources={setSelected}
      onSourcesChange={setRetained} initialSources={retained} onClose={() => {}} />
  ) : null;
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
let container; let root;

async function mountThenRemountWith(next) {
  listIndexed = ok([doc("old_stem")]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Harness />); });
  await flush();
  expect(state.selected).toEqual(["old_stem"]);
  expect(state.retained.map((s) => s.video_stem)).toEqual(["old_stem"]);
  await act(async () => { state.setShow(false); });     // real unmount, as at a breakpoint
  listIndexed = next;
  await act(async () => { state.setShow(true); });
  await flush();
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

describe("SidebarLeft selection across an unmount/remount", () => {
  it("follows a backend rename (same file, new stem) instead of dropping the selection", async () => {
    await mountThenRemountWith(ok([doc("new_stem")]));
    expect(state.selected).toEqual(["new_stem"]);
    expect(state.retained.map((s) => s.video_stem)).toEqual(["new_stem"]);
  });

  it("keeps the rows and the selection when the remount fetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await mountThenRemountWith(async () => ({ ok: false, status: 500 }));
    expect(state.selected).toEqual(["old_stem"]);
    expect(container.textContent).toContain("same.pdf");
  });

  it("drops the selection when the document is really gone", async () => {
    await mountThenRemountWith(ok([]));
    expect(state.selected).toEqual([]);
    expect(state.retained).toEqual([]);
  });
});
