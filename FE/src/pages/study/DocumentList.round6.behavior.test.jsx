// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import {
  bulkDocuments, deleteCollection, getLibrary, getProgressAttempts, getProgressConcepts,
  getProgressOverview, markOpened,
} from "../../utils/studyApi";

let currentUser = { id: "user-a" };

vi.mock("../../auth/useAuth", () => ({ useAuth: () => ({ user: currentUser }) }));
vi.mock("../../utils/studyApi", async (original) => ({
  ...(await original()),
  getLibrary: vi.fn(), getProgressOverview: vi.fn(), getProgressConcepts: vi.fn(),
  getProgressAttempts: vi.fn(), bulkDocuments: vi.fn(), deleteCollection: vi.fn(),
  patchDocument: vi.fn(), patchCollection: vi.fn(), createCollection: vi.fn(),
  uploadDocument: vi.fn(), markOpened: vi.fn(() => Promise.resolve()), getQuestions: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../../components/study/StudyShell", () => ({
  default: ({ loading, error, actions, children }) => <div>{actions}{loading ? <div data-loading /> : error ? <div role="alert">{error}</div> : children}</div>,
  EmptyState: ({ title, action }) => <div data-empty>{title}{action}</div>,
}));
vi.mock("../../components/study/CollectionSidebar", () => ({ default: ({ boSuuTap, onChon, onXoa, onHienLuuTru }) => <aside>
  <button type="button" data-collection-filter onClick={() => onChon({ collectionId: "course-a" })}>Course A</button>
  <button type="button" data-tag-filter onClick={() => onChon({ tags: ["Exam"] })}>Exam</button>
  <button type="button" data-archive-toggle onClick={() => onHienLuuTru((value) => !value)}>Archive</button>
  {boSuuTap[0] && <button type="button" data-delete-collection onClick={() => onXoa(boSuuTap[0])}>Delete collection</button>}
</aside> }));
vi.mock("../../components/study/BulkBar", () => ({ default: ({ so, onHanhDong }) => so
  ? <button type="button" data-bulk-pin onClick={() => onHanhDong("pin")}>Pin {so}</button> : null }));
vi.mock("../../components/study/StudyCard", () => ({ default: ({ doc }) => <div data-legacy-card={doc.document_id} /> }));
vi.mock("../../components/study/AiInsightCard", () => ({ default: () => null }));
vi.mock("../../components/study/LearningDashboard", () => ({ default: () => null }));
vi.mock("../../components/ui/Disclosure", () => ({ default: ({ children }) => <div>{children}</div> }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;

const docs = [
  { document_id: "doc-1", source_stem: "one", title: "Alpha", collection_id: "course-a", tags: ["Exam"], file_type: "pdf", created_at: "2026-01-01", ai: { index: "ready", summary: { state: "ready" }, quiz: { ready: true, latest_quiz_id: "q1" } } },
  { document_id: "doc-2", source_stem: "two", title: "Beta", collection_id: "course-b", tags: [], file_type: "pdf", created_at: "2026-01-02", ai: { index: "ready", summary: { state: "not_generated" }, quiz: { ready: false } } },
  { document_id: "doc-3", source_stem: "three", title: "Gamma", collection_id: "course-a", tags: ["Exam"], file_type: "pdf", created_at: "2026-01-03", archived_at: "2026-04-01", ai: { index: "ready", summary: { state: "not_generated" }, quiz: { ready: false } } },
];
const collections = [{ collection_id: "course-a", name: "Course A", color: "forest" }];

const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const setInput = (input, value) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

async function renderDocumentList({ flag = true } = {}) {
  vi.stubEnv("VITE_LIBRARY_ACTION_MATRIX", flag ? "true" : "false");
  vi.resetModules();
  const { default: DocumentList } = await import("./DocumentList");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><StudyContextProvider><DocumentList /></StudyContextProvider></MemoryRouter>));
  await flush();
}

beforeEach(() => {
  currentUser = { id: "user-a" };
  sessionStorage.clear();
  vi.clearAllMocks();
  getLibrary.mockResolvedValue({ documents: docs, collections });
  getProgressOverview.mockResolvedValue(null);
  getProgressConcepts.mockResolvedValue([]);
  getProgressAttempts.mockResolvedValue([]);
  bulkDocuments.mockResolvedValue({});
  deleteCollection.mockResolvedValue({});
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.scrollTo = vi.fn();
  window.requestAnimationFrame = (callback) => { callback(); return 1; };
  window.cancelAnimationFrame = vi.fn();
});

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  document.body.innerHTML = "";
  root = null;
  host = null;
  vi.unstubAllEnvs();
});

describe("DocumentList Round 6 mounted integration", () => {
  it("switches deterministically between legacy and matrix renderers without a duplicate fetch", async () => {
    await renderDocumentList({ flag: false });
    expect(host.querySelectorAll("[data-document-row]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-legacy-card]").length).toBeGreaterThan(0);
    expect(getLibrary).toHaveBeenCalledTimes(1);
    act(() => root.unmount()); root = null; host.remove(); host = null;
    await renderDocumentList({ flag: true });
    expect([...host.querySelectorAll("[data-document-row]")].map((node) => node.dataset.documentId)).toEqual(["doc-2", "doc-1"]);
    expect(host.querySelectorAll("[data-legacy-card]")).toHaveLength(0);
    expect(getLibrary).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["search", () => setInput(host.querySelector('[aria-label="Tìm trong thư viện"]'), "Beta"), ["doc-2"]],
    ["collection", () => act(() => host.querySelector("[data-collection-filter]").click()), ["doc-1"]],
    ["tags", () => act(() => host.querySelector("[data-tag-filter]").click()), ["doc-1"]],
    ["task", () => act(() => host.querySelector('[data-task-view="needs_summary"]').click()), ["doc-2"]],
  ])("builds the immediate bulk request from visible rows after a same-cycle %s change", async (_kind, change, expectedIds) => {
    await renderDocumentList();
    const selectAll = [...host.querySelectorAll('input[type="checkbox"]')].find((input) => input.parentElement?.textContent.includes("đang hiện"));
    act(() => selectAll.click());
    change();
    act(() => host.querySelector("[data-bulk-pin]").click());
    await flush();
    expect(bulkDocuments).toHaveBeenCalledWith({ action: "pin", document_ids: expectedIds });
  });

  it("excludes immediately hidden archived UUIDs from the actual bulk request", async () => {
    await renderDocumentList();
    act(() => host.querySelector("[data-archive-toggle]").click());
    const selectAll = [...host.querySelectorAll('input[type="checkbox"]')].find((input) => input.parentElement?.textContent.includes("đang hiện"));
    act(() => selectAll.click());
    act(() => host.querySelector("[data-archive-toggle]").click());
    act(() => host.querySelector("[data-bulk-pin]").click());
    await flush();
    expect(bulkDocuments).toHaveBeenCalledWith({ action: "pin", document_ids: ["doc-2", "doc-1"] });
  });

  it("routes one row action through useOpenSurface and marks the UUID exactly once", async () => {
    await renderDocumentList();
    act(() => host.querySelector('[data-document-id="doc-2"] [data-quick-action]').click());
    await flush();
    expect(markOpened).toHaveBeenCalledTimes(1);
    expect(markOpened).toHaveBeenCalledWith("doc-2", "summary");
  });

  it("moves focus to the stable matrix fallback if filtering removes an open mobile-sheet trigger", async () => {
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    await renderDocumentList();
    act(() => host.querySelector('[data-document-id="doc-1"] [data-tools-trigger]').click());
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    setInput(host.querySelector('[aria-label="Tìm trong thư viện"]'), "Beta");
    await flush();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector("[data-matrix-focus-fallback]"));
  });

  it("restores only the authenticated account state after rows render", async () => {
    sessionStorage.setItem("memvidx.library.actionMatrix.v1:user-a", JSON.stringify({ query: "Beta", view: "all", sort: "az", scrollY: 240 }));
    sessionStorage.setItem("memvidx.library.actionMatrix.v1:user-b", JSON.stringify({ query: "Alpha", view: "all", sort: "az", scrollY: 999 }));
    await renderDocumentList();
    expect([...host.querySelectorAll("[data-document-row]")].map((node) => node.dataset.documentId)).toEqual(["doc-2"]);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 240 });
  });

  it("passes the exact collection ID, supports cancel, and leaves a failed dialog retryable", async () => {
    await renderDocumentList();
    act(() => host.querySelector("[data-delete-collection]").click());
    act(() => document.body.querySelector('[role="dialog"] .btn-secondary').click());
    expect(deleteCollection).not.toHaveBeenCalled();
    act(() => host.querySelector("[data-delete-collection]").click());
    deleteCollection.mockRejectedValueOnce(new Error("server rejected"));
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog.querySelector(".destructive-confirm__action").disabled).toBe(true);
    act(() => dialog.querySelector('input[type="checkbox"]').click());
    await act(async () => dialog.querySelector(".destructive-confirm__action").click());
    expect(deleteCollection).toHaveBeenCalledWith("course-a");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("Không kết nối được máy chủ");
    await act(async () => document.body.querySelector(".destructive-confirm__action").click());
    expect(deleteCollection).toHaveBeenCalledTimes(2);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
