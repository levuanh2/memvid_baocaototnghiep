// @vitest-environment jsdom
// V9.3 P3a (docs/StudyMap-V9.3/05 "Thêm tài liệu"): the upload button still opens the file
// chooser in one click (V6 contract, e2e/fixtures.js uploads through the same input), but now
// takes several files, checks each before sending, uploads them one at a time, shows each
// file's own status and error inline, and retries only the file that failed.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import {
  getLibrary, getProgressAttempts, getProgressConcepts, getProgressOverview, uploadDocument,
} from "../../utils/studyApi";
import { GIOI_HAN_TAI_LEN } from "../../utils/taiLenTep";
import DocumentList from "./DocumentList";

vi.mock("../../auth/useAuth", () => ({ useAuth: () => ({ user: { id: "user-a" } }) }));
vi.mock("../../utils/studyApi", async (original) => ({
  ...(await original()),
  getLibrary: vi.fn(), getProgressOverview: vi.fn(), getProgressConcepts: vi.fn(),
  getProgressAttempts: vi.fn(), uploadDocument: vi.fn(), markOpened: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../components/study/StudyShell", () => ({
  default: ({ loading, error, actions, children }) => <div>{actions}{loading ? <div data-loading /> : error ? <div data-page-error>{error}</div> : children}</div>,
  EmptyState: ({ title, action }) => <div data-empty>{title}{action}</div>,
}));
vi.mock("../../components/study/CollectionSidebar", () => ({ default: () => <aside /> }));
vi.mock("../../components/study/BulkBar", () => ({ default: () => null }));
vi.mock("../../components/study/StudyCard", () => ({ default: ({ doc }) => <div data-card={doc.document_id} /> }));
vi.mock("../../components/study/AiInsightCard", () => ({ default: ({ doc, dangTai, tenTep }) => <div data-insight>{dangTai ? `tai:${tenTep}` : `doc:${doc?.document_id}`}</div> }));
vi.mock("../../components/study/LearningDashboard", () => ({ default: () => null }));
vi.mock("../../components/study/LearningHome", () => ({ default: () => null }));
vi.mock("../../components/ui/Disclosure", () => ({ default: ({ children }) => <div>{children}</div> }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;

const docs = [{ document_id: "doc-1", source_stem: "one", title: "Alpha", file_type: "pdf",
  created_at: "2026-01-01", ai: { index: "ready" } }];

const flush = async () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });

function file(name, size = 10) {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: size });
  return f;
}

async function pick(files) {
  const input = host.querySelector("input[type='file']");
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
}

const items = () => [...host.querySelectorAll("[data-upload-item]")];
const item = (name) => items().find((li) => li.textContent.includes(name));

beforeEach(async () => {
  vi.clearAllMocks();
  sessionStorage.clear();
  getLibrary.mockResolvedValue({ documents: docs, collections: [] });
  getProgressOverview.mockResolvedValue(null);
  getProgressConcepts.mockResolvedValue([]);
  getProgressAttempts.mockResolvedValue([]);
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.scrollTo = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><StudyContextProvider><DocumentList /></StudyContextProvider></MemoryRouter>));
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Library upload V9.3", () => {
  it("lets the chooser take several files and keeps the backend's accept list", () => {
    const input = host.querySelector("input[type='file']");
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain(".pdf");
    expect(input.accept).toContain(".docx");
  });

  it("sends only the files that pass, and says why each other one was refused", async () => {
    uploadDocument.mockResolvedValue({ document_id: "doc-new" });
    await pick([file("bai-giang.pdf"), file("setup.exe"), file("qua-lon.pdf", GIOI_HAN_TAI_LEN + 1)]);
    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect(uploadDocument.mock.calls[0][0].name).toBe("bai-giang.pdf");
    expect(item("setup.exe").querySelector("[role='alert']").textContent).toMatch(/\.exe/);
    expect(item("qua-lon.pdf").querySelector("[role='alert']").textContent).toMatch(/100 MB/);
    expect(item("bai-giang.pdf").textContent).toMatch(/Đã tải lên/);
  });

  it("uploads one file at a time and blocks a second pick while it runs", async () => {
    let finish;
    uploadDocument.mockImplementationOnce(() => new Promise((r) => { finish = r; }))
      .mockResolvedValue({ document_id: "doc-b" });
    await pick([file("a.pdf"), file("b.pdf")]);
    expect(uploadDocument).toHaveBeenCalledTimes(1);
    const button = [...host.querySelectorAll("button")].find((b) => /tải lên/i.test(b.textContent));
    expect(button.disabled).toBe(true);
    await act(async () => { finish({ document_id: "doc-a" }); });
    await flush();
    expect(uploadDocument).toHaveBeenCalledTimes(2);
    expect(uploadDocument.mock.calls[1][0].name).toBe("b.pdf");
  });

  it("keeps the library on screen when an upload fails and retries only that file", async () => {
    uploadDocument.mockRejectedValueOnce(new Error("Máy chủ bận")).mockResolvedValue({ document_id: "doc-a" });
    await pick([file("a.pdf")]);
    expect(host.querySelector("[data-page-error]")).toBeNull();
    expect(host.querySelector("[data-card='doc-1']")).not.toBeNull();
    const failed = item("a.pdf");
    expect(failed.querySelector("[role='alert']")).not.toBeNull();
    const retry = [...failed.querySelectorAll("button")].find((b) => b.textContent.includes("Thử lại"));
    await act(async () => { retry.click(); });
    await flush();
    expect(uploadDocument).toHaveBeenCalledTimes(2);
    expect(uploadDocument.mock.calls[1][0].name).toBe("a.pdf");
    expect(item("a.pdf").textContent).toMatch(/Đã tải lên/);
  });

  it("offers no retry for a file refused before sending", async () => {
    await pick([file("setup.exe")]);
    expect(uploadDocument).not.toHaveBeenCalled();
    expect([...item("setup.exe").querySelectorAll("button")].some((b) => b.textContent.includes("Thử lại"))).toBe(false);
  });

  // Codex P1 (#202): a new pick used to replace the queue, dropping a failed file and its retry.
  it("keeps a failed file and its retry when another file is picked", async () => {
    uploadDocument.mockRejectedValueOnce(new Error("Máy chủ bận")).mockResolvedValue({ document_id: "doc-1" });
    await pick([file("a.pdf")]);
    await pick([file("b.pdf")]);
    expect(item("b.pdf").textContent).toMatch(/Đã tải lên/);
    const retry = [...item("a.pdf").querySelectorAll("button")].find((b) => b.textContent.includes("Thử lại"));
    expect(retry).toBeTruthy();
    await act(async () => { retry.click(); });
    await flush();
    expect(uploadDocument.mock.calls.map((c) => c[0].name)).toEqual(["a.pdf", "b.pdf", "a.pdf"]);
  });

  // Codex P1 (#202): the insight card named the previous upload while a later one was running,
  // and kept it after a later batch failed entirely.
  it("does not show the previous upload's document during or after a later batch", async () => {
    uploadDocument.mockResolvedValueOnce({ document_id: "doc-1" });
    await pick([file("a.pdf")]);
    expect(host.querySelector("[data-insight]").textContent).toBe("doc:doc-1");
    let fail;
    uploadDocument.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    await pick([file("b.pdf")]);
    expect(host.querySelector("[data-insight]").textContent).toBe("tai:b.pdf");
    await act(async () => { fail(new Error("Máy chủ bận")); });
    await flush();
    expect(host.querySelector("[data-insight]")).toBeNull();
  });

  // Codex P2 (#202): retry and close removed the focused control and left focus on <body>.
  it("keeps focus on the queue after retry and returns it to the upload button after closing", async () => {
    uploadDocument.mockRejectedValueOnce(new Error("Máy chủ bận")).mockResolvedValue({ document_id: "doc-1" });
    await pick([file("a.pdf")]);
    const retry = [...item("a.pdf").querySelectorAll("button")].find((b) => b.textContent.includes("Thử lại"));
    retry.focus();
    await act(async () => { retry.click(); });
    await flush();
    const queue = host.querySelector(".upload-queue");
    expect(document.activeElement).toBe(queue);
    expect(queue.getAttribute("aria-label")).toBe("Danh sách tải lên");
    const close = [...queue.querySelectorAll("button")].find((b) => b.textContent.includes("Ẩn danh sách"));
    close.focus();
    await act(async () => { close.click(); });
    expect(document.activeElement.textContent).toMatch(/Tải tài liệu lên/);
  });
});
