// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import ReaderPane from "./ReaderPane";

const api = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  listSections: vi.fn(),
  listChunkPage: vi.fn(),
  moTaLoi: vi.fn((error, fallback) => error?.message || fallback),
}));

vi.mock("../../utils/studyApi", () => api);

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = vi.fn();
});

let host;
let root;

async function render(props = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ReaderPane active selectedSources={["alpha"]} {...props} />);
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.clearAllMocks();
});

const documentRow = (id, stem, extra = {}) => ({
  document_id: id, source_stem: stem, title: `${stem}.md`, status: "completed", ...extra,
});

describe("ReaderPane data contract", () => {
  it("paginates chunks in stored order with requests capped at 500", async () => {
    api.listDocuments.mockResolvedValue([documentRow("d1", "alpha")]);
    api.listSections.mockResolvedValue([{ section_id: "s1", title: "Mở đầu", order_index: 0 }]);
    api.listChunkPage
      .mockResolvedValueOnce({ total: 501, chunks: Array.from({ length: 500 }, (_, i) => ({ chunk_id: `c${i}`, chunk_index: i, section_id: "s1", text: `Đoạn ${i}` })) })
      .mockResolvedValueOnce({ total: 501, chunks: [{ chunk_id: "c500", chunk_index: 500, section_id: "s1", text: "Đoạn 500" }] });

    await render();

    expect(api.listDocuments).toHaveBeenCalledTimes(1);
    expect(api.listChunkPage.mock.calls).toEqual([["d1", { limit: 500, offset: 0 }], ["d1", { limit: 500, offset: 500 }]]);
    expect(host.textContent).toContain("Đoạn 500");
  });

  it("renders every chunk in stored order even when section metadata is interleaved or missing", async () => {
    api.listDocuments.mockResolvedValue([documentRow("d1", "alpha")]);
    api.listSections.mockResolvedValue([
      { section_id: "s1", title: "Một", order_index: 0 },
      { section_id: "s2", title: "Hai", order_index: 1 },
    ]);
    api.listChunkPage.mockResolvedValue({ total: 3, chunks: [
      { chunk_id: "c2", chunk_index: 0, section_id: "s2", text: "Thứ nhất" },
      { chunk_id: "c1", chunk_index: 1, section_id: "s1", text: "Thứ hai" },
      { chunk_id: "cx", chunk_index: 2, section_id: "missing", text: "Thứ ba" },
    ] });
    await render();
    expect([...host.querySelectorAll("[data-reader-chunk]")].map((node) => node.dataset.readerChunk)).toEqual(["c2", "c1", "cx"]);
    expect(host.textContent).toContain("Thứ ba");
  });

  it("works with zero AI sources by asking the learner to choose an owned document", async () => {
    api.listDocuments.mockResolvedValue([documentRow("d1", "alpha"), documentRow("d2", "beta")]);
    await render({ selectedSources: [] });
    expect(host.querySelector("select[aria-label='Chọn tài liệu để đọc']")).not.toBeNull();
    expect(api.listSections).not.toHaveBeenCalled();
  });

  it("shows a not-ready status instead of pretending the document is empty", async () => {
    api.listDocuments.mockResolvedValue([documentRow("d1", "alpha", { status: "processing" })]);
    await render();
    expect(host.textContent).toContain("đang được xử lý");
    expect(api.listSections).not.toHaveBeenCalled();
  });

  it("ignores late responses after the document changes", async () => {
    let resolveOld;
    api.listDocuments.mockResolvedValue([documentRow("d1", "alpha"), documentRow("d2", "beta")]);
    api.listSections.mockImplementation((id) => id === "d1"
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve([]));
    api.listChunkPage.mockResolvedValue({ total: 1, chunks: [{ chunk_id: "new", chunk_index: 0, text: "Tài liệu mới" }] });
    await render({ selectedSources: ["alpha"] });

    await act(async () => {
      root.render(<ReaderPane active selectedSources={["beta"]} />);
      await Promise.resolve(); await Promise.resolve();
    });
    await act(async () => { resolveOld([{ section_id: "old", title: "Không được hiện" }]); await Promise.resolve(); });

    expect(host.textContent).toContain("Tài liệu mới");
    expect(host.textContent).not.toContain("Không được hiện");
  });

  it("renders Markdown without executing raw HTML or script", async () => {
    api.listDocuments.mockResolvedValue([documentRow("d1", "alpha")]);
    api.listSections.mockResolvedValue([]);
    api.listChunkPage.mockResolvedValue({ total: 1, chunks: [{ chunk_id: "c1", chunk_index: 0, text: "**Đậm** <script>window.__readerXss = true</script><a href='javascript:alert(1)'>x</a> [Mở liên kết](https://example.test)" }] });
    await render();
    expect(host.querySelector(".reader-chunk strong")?.textContent).toBe("Đậm");
    expect(host.querySelector("script")).toBeNull();
    expect(window.__readerXss).toBeUndefined();
    expect(host.querySelector("a[href^='javascript:']")).toBeNull();
    expect(host.querySelector("a[href='https://example.test']")?.getAttribute("rel")).toContain("noopener");
  });

  it("highlights a chat citation only when embedding_id and snippet both match", async () => {
    api.listDocuments.mockResolvedValue([documentRow("d1", "alpha")]);
    api.listSections.mockResolvedValue([]);
    api.listChunkPage.mockResolvedValue({ total: 1, chunks: [{ chunk_id: "uuid-1", embedding_id: "91", chunk_index: 0, text: "Nội dung đã được chuẩn hoá khoảng trắng." }] });
    await render({ citation: { kind: "chat", stem: "alpha", id: 91, text: "được chuẩn hoá khoảng trắng" } });
    expect(host.querySelector("[data-reader-chunk='uuid-1']").classList.contains("reader-chunk--highlighted")).toBe(true);
    expect(host.textContent).not.toContain("không còn trong bản hiện tại");
  });

  it.each([
    [{ kind: "chat", stem: "alpha", id: "91", text: "đoạn trích đã thay đổi" }, "id match but text mismatch"],
    [{ kind: "chat", stem: "alpha", id: "404", text: "Nội dung" }, "no id match"],
  ])("shows the reprocessed message and never highlights for %s", async (citation) => {
    api.listDocuments.mockResolvedValue([documentRow("d1", "alpha")]);
    api.listSections.mockResolvedValue([]);
    api.listChunkPage.mockResolvedValue({ total: 1, chunks: [{ chunk_id: "uuid-1", embedding_id: "91", chunk_index: 0, text: "Nội dung hiện tại" }] });
    await render({ citation });
    expect(host.textContent).toContain("không còn trong bản hiện tại");
    expect(host.querySelector(".reader-chunk--highlighted")).toBeNull();
  });

  it("retries the failed request and keeps the same reader surface", async () => {
    api.listDocuments.mockResolvedValue([documentRow("d1", "alpha")]);
    api.listSections.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
    api.listChunkPage.mockResolvedValue({ total: 1, chunks: [{ chunk_id: "c1", chunk_index: 0, text: "Đã tải lại" }] });
    await render();
    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent.includes("Thử tải lại mục lục"));
    expect(retry).toBeTruthy();
    await act(async () => { retry.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(api.listSections).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Đã tải lại");
  });

  it("keeps its scroll position when hidden for a mode or Focus Mode switch", async () => {
    api.listDocuments.mockResolvedValue([documentRow("d1", "alpha")]);
    api.listSections.mockResolvedValue([]);
    api.listChunkPage.mockResolvedValue({ total: 1, chunks: [{ chunk_id: "c1", chunk_index: 0, text: "Nội dung dài" }] });
    await render();
    const scroll = host.querySelector(".reader-scroll");
    scroll.scrollTop = 372;
    await act(async () => { root.render(<ReaderPane active={false} selectedSources={["alpha"]} />); });
    await act(async () => { root.render(<ReaderPane active selectedSources={["alpha"]} />); });
    expect(host.querySelector(".reader-scroll")).toBe(scroll);
    expect(scroll.scrollTop).toBe(372);
    expect(api.listChunkPage).toHaveBeenCalledTimes(1);
  });

  it("switches from a manually picked document to a citation document when a citation arrives with a new nonce", async () => {
    api.listDocuments.mockResolvedValue([
      documentRow("d1", "alpha"),
      documentRow("d2", "beta"),
    ]);
    api.listSections.mockResolvedValue([]);
    api.listChunkPage.mockImplementation((id) => Promise.resolve({
      total: 1,
      chunks: id === "d1"
        ? [{ chunk_id: "uuid-1", embedding_id: "91", chunk_index: 0, text: "Đoạn văn alpha được trích dẫn" }]
        : [{ chunk_id: "uuid-2", embedding_id: "92", chunk_index: 0, text: "Đoạn văn beta" }],
    }));

    await render({ selectedSources: ["alpha"] });
    expect(host.textContent).toContain("Đoạn văn alpha");

    const select = host.querySelector("#reader-toolbar-picker");
    expect(select).not.toBeNull();
    await act(async () => {
      select.value = "d2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Đoạn văn beta");

    await act(async () => {
      root.render(
        <ReaderPane
          active
          selectedSources={["alpha"]}
          citation={{
            kind: "chat",
            stem: "alpha",
            id: 91,
            text: "alpha được trích dẫn",
            nonce: 42,
          }}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Đoạn văn alpha được trích dẫn");
    expect(host.querySelector("[data-reader-chunk='uuid-1']").classList.contains("reader-chunk--highlighted")).toBe(true);
    expect(host.textContent).not.toContain("không còn trong bản hiện tại");
  });

  it("keeps manual document selection when selectedSources changes with no new citation", async () => {
    api.listDocuments.mockResolvedValue([
      documentRow("d1", "alpha"),
      documentRow("d2", "beta"),
      documentRow("d3", "gamma"),
    ]);
    api.listSections.mockResolvedValue([]);
    api.listChunkPage.mockImplementation((id) => Promise.resolve({
      total: 1,
      chunks: [{ chunk_id: `chunk-${id}`, chunk_index: 0, text: `Nội dung của ${id}` }],
    }));

    await render({ selectedSources: ["alpha"] });
    expect(host.textContent).toContain("Nội dung của d1");

    const select = host.querySelector("#reader-toolbar-picker");
    await act(async () => {
      select.value = "d2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Nội dung của d2");

    await act(async () => {
      root.render(<ReaderPane active selectedSources={["gamma"]} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Nội dung của d2");
    expect(host.textContent).not.toContain("Nội dung của d3");
  });

  it("shows the picker and does not guess when a citation is ambiguous or unauthorized", async () => {
    api.listDocuments.mockResolvedValue([
      documentRow("d1", "shared"),
      documentRow("d2", "shared"),
    ]);
    api.listSections.mockResolvedValue([]);
    api.listChunkPage.mockResolvedValue({ total: 0, chunks: [] });

    await render({
      selectedSources: [],
      citation: { kind: "chat", stem: "shared", id: "c1", text: "text", nonce: 99 },
    });
    expect(host.querySelector("select[aria-label='Chọn tài liệu để đọc']")).not.toBeNull();
  });
});

// Claude review of P5a (CI #211): the hidden Reader loaded the document list, the sections and
// EVERY chunk page of the active source on each workspace load, before anyone opened it.
describe("ReaderPane before it is first opened", () => {
  it("requests nothing while hidden, and loads once opened", async () => {
    api.listDocuments.mockResolvedValue([documentRow("d1", "alpha")]);
    api.listSections.mockResolvedValue([]);
    api.listChunkPage.mockResolvedValue({ total: 0, chunks: [] });
    await render({ active: false });
    expect(api.listDocuments).not.toHaveBeenCalled();
    expect(api.listSections).not.toHaveBeenCalled();
    expect(api.listChunkPage).not.toHaveBeenCalled();
    await act(async () => { root.render(<ReaderPane active selectedSources={["alpha"]} />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(api.listDocuments).toHaveBeenCalledTimes(1);
    expect(api.listSections).toHaveBeenCalledTimes(1);
  });
});

// Claude review of P5a: the reading position relied on the browser keeping scrollTop through
// display:none, which drifted by a few pixels (and resets in some engines). The pane now saves
// the position while visible and restores it exactly when shown again.
describe("ReaderPane reading position", () => {
  it("restores the exact scroll position after being hidden", async () => {
    api.listDocuments.mockResolvedValue([documentRow("d1", "alpha")]);
    api.listSections.mockResolvedValue([]);
    api.listChunkPage.mockResolvedValue({ total: 1, chunks: [{ chunk_id: "c1", chunk_index: 0, text: "Đoạn 1" }] });
    await render();
    const node = host.querySelector(".reader-scroll");
    expect(node).not.toBeNull();
    node.scrollTop = 420;
    await act(async () => { node.dispatchEvent(new Event("scroll")); });
    await act(async () => { root.render(<ReaderPane active={false} selectedSources={["alpha"]} />); });
    node.scrollTop = 0; // what a hidden scroller may come back with
    await act(async () => { root.render(<ReaderPane active selectedSources={["alpha"]} />); });
    expect(host.querySelector(".reader-scroll").scrollTop).toBe(420);
  });
});
