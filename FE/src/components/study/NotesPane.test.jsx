// @vitest-environment jsdom
// V9.3 P5b — Notes Preview pane (owner brief C).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { useLayoutEffect } from "react";
import NotesPane from "./NotesPane";
import { forgetPendingNotes, readNote, writeNote, NOTE_MAX } from "../../utils/notesPreview";

const DOCS = [
  { document_id: "d1", source_stem: "kinh_te", title: "Kinh tế vi mô.pdf", status: "ready" },
  { document_id: "d2", source_stem: "lich_su", title: "Lịch sử.pdf", status: "ready" },
  { document_id: "d3", source_stem: "trung", title: "Trùng A.pdf", status: "ready" },
  { document_id: "d4", source_stem: "trung", title: "Trùng B.pdf", status: "ready" },
];

let container, root;
const load = vi.fn(() => Promise.resolve(DOCS));

async function render(props) {
  await act(async () => { root.render(<NotesPane active userId="u1" selectedSources={["kinh_te"]} loadDocuments={load} {...props} />); });
  await act(async () => { await Promise.resolve(); });
}
const area = () => container.querySelector("textarea");
const type = async (value) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(area(), value);
    area().dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const tick = async (ms = 800) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const button = (name) => [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === name);

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  forgetPendingNotes();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("NotesPane", () => {
  it("says plainly where the note lives and what can lose it", async () => {
    await render();
    const text = container.textContent;
    expect(text).toContain("chỉ lưu trên trình duyệt này");
    expect(text).toContain("không đồng bộ");
    expect(text).toMatch(/xoá dữ liệu trình duyệt/i);
    expect(text).toMatch(/dùng chung hồ sơ trình duyệt/i);
    expect(text).not.toMatch(/mã hoá|đã lưu vào tài khoản|tự động lưu lên/i);
  });

  it("opens the note of the one matching document and saves it for this user only", async () => {
    await render();
    expect(area().getAttribute("aria-label")).toContain("Kinh tế vi mô.pdf");
    await type("Cầu co giãn khi có nhiều hàng thay thế.");
    await tick();
    expect(readNote("u1", "d1").text).toBe("Cầu co giãn khi có nhiều hàng thay thế.");
    expect(readNote("u2", "d1").text).toBe("");
    expect(container.textContent).toMatch(/Đã lưu trên trình duyệt này lúc \d{2}:\d{2}/);
  });

  it("shows another account nothing of the first account's note", async () => {
    writeNote("u1", "d1", "của u1");
    await render({ userId: "u2" });
    expect(area().value).toBe("");
  });

  it("asks which document when two share the source name, and never guesses", async () => {
    await render({ selectedSources: ["trung"] });
    expect(area()).toBeNull();
    const pick = container.querySelector("select");
    expect(pick).not.toBeNull();
    expect([...pick.options].map((o) => o.textContent)).toEqual(expect.arrayContaining(["Trùng A.pdf", "Trùng B.pdf"]));
  });

  it("works with no AI source selected: the user picks the document", async () => {
    writeNote("u1", "d2", "ghi chú lịch sử");
    await render({ selectedSources: [] });
    await act(async () => {
      const pick = container.querySelector("select");
      pick.value = "d2";
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(area().value).toBe("ghi chú lịch sử");
  });

  it("saves the draft of the previous document before switching", async () => {
    await render({ selectedSources: [] });
    const choose = async (id) => {
      await act(async () => {
        const pick = container.querySelector("select");
        pick.value = id;
        pick.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    await choose("d1");
    await type("nháp d1");
    await choose("d2"); // before the debounce fired
    expect(readNote("u1", "d1").text).toBe("nháp d1");
    expect(area().value).toBe("");
  });

  it("keeps the typed text while the pane is hidden (mode switch, Focus Mode)", async () => {
    await render();
    await type("đang viết dở");
    await render({ active: false });
    await render({ active: true });
    expect(area().value).toBe("đang viết dở");
  });

  it("reports blocked storage, keeps the text, and saves on retry", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked"); });
    await render();
    await type("không lưu được");
    await tick();
    expect(container.querySelector("[role='alert']").textContent).toMatch(/Chưa lưu được/);
    expect(area().value).toBe("không lưu được");
    spy.mockRestore();
    await act(async () => { button("Thử lưu lại").click(); });
    expect(readNote("u1", "d1").text).toBe("không lưu được");
  });

  it("stops at the limit and says so", async () => {
    await render();
    expect(Number(area().getAttribute("maxlength"))).toBe(NOTE_MAX);
    await type("x".repeat(NOTE_MAX));
    expect(container.textContent).toContain(`${NOTE_MAX.toLocaleString("vi-VN")}/${NOTE_MAX.toLocaleString("vi-VN")}`);
    expect(container.textContent).toMatch(/Đã đến giới hạn/);
  });

  it("deletes this browser's note only after confirmation", async () => {
    writeNote("u1", "d1", "sẽ xoá");
    await render();
    await act(async () => { button("Xoá ghi chú trên trình duyệt này").click(); });
    expect(readNote("u1", "d1").text).toBe("sẽ xoá");
    await act(async () => { button("Huỷ").click(); });
    expect(readNote("u1", "d1").text).toBe("sẽ xoá");
    await act(async () => { button("Xoá ghi chú trên trình duyệt này").click(); });
    await act(async () => { button("Xoá").click(); });
    expect(readNote("u1", "d1").text).toBe("");
    expect(area().value).toBe("");
  });

  // CI #210: the hidden pane rendered "Đang tải danh sách tài liệu…" inside <main> before it was
  // ever opened, which doubled the sidebar/chat loading text other specs count.
  it("renders and fetches nothing until the Notes mode is first opened", async () => {
    load.mockClear();
    await render({ active: false });
    expect(load).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
    await render({ active: true });
    expect(load).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Ghi chú");
  });

  it("does not offer editing without a signed-in user", async () => {
    await render({ userId: null });
    expect(area()).toBeNull();
    expect(container.textContent).toMatch(/Đăng nhập để ghi chú/);
  });
});

// Independent review of #210 (P1): the pane stays mounted across an account switch. The
// document list was loaded once and never per account, and a late response from the previous
// account could fill the next account's picker.
describe("NotesPane identity", () => {
  it("reloads documents per account and ignores a late response from the previous account", async () => {
    let finishU1;
    const u1Docs = [{ document_id: "x1", source_stem: "rieng_u1", title: "Riêng của u1.pdf" }];
    const u2Docs = [{ document_id: "y1", source_stem: "rieng_u2", title: "Riêng của u2.pdf" }];
    const loader = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishU1 = () => resolve(u1Docs); }))
      .mockImplementationOnce(() => Promise.resolve(u2Docs));
    await render({ userId: "u1", selectedSources: [], loadDocuments: loader });
    await render({ userId: "u2", selectedSources: [], loadDocuments: loader });
    await act(async () => { finishU1(); await Promise.resolve(); });
    const titles = [...container.querySelectorAll("option")].map((o) => o.textContent);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(titles).toContain("Riêng của u2.pdf");
    expect(titles).not.toContain("Riêng của u1.pdf");
  });

  // Owner brief (V9.3 Task 6A): a direct account switch must not show the previous account's
  // document titles or note text in ANY commit, including the first one after the switch
  // (#210 independent review P3). A layout-effect probe reads the DOM of every commit before
  // passive effects (where the pane reloads) can run.
  it("never shows the previous account's titles or note, even in the first commit after a switch", async () => {
    const snapshots = [];
    function Probe(props) {
      useLayoutEffect(() => { snapshots.push(container.innerHTML); });
      return <NotesPane active selectedSources={[]} {...props} />;
    }
    const u1Docs = [{ document_id: "x1", source_stem: "rieng_u1", title: "Bí mật của u1.pdf" }];
    const u2Docs = [{ document_id: "y1", source_stem: "rieng_u2", title: "Tài liệu của u2.pdf" }];
    writeNote("u1", "x1", "nội dung riêng của u1");
    const loader = vi.fn().mockResolvedValueOnce(u1Docs).mockResolvedValueOnce(u2Docs);
    await act(async () => { root.render(<Probe userId="u1" loadDocuments={loader} />); });
    await act(async () => { await Promise.resolve(); });
    // u1 picks the document so its note is on screen before the switch.
    await act(async () => {
      const select = container.querySelector("#notes-pane-document");
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(select, "x1");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.innerHTML).toContain("Bí mật của u1.pdf");
    expect(area().value).toBe("nội dung riêng của u1");
    snapshots.length = 0;
    await act(async () => { root.render(<Probe userId="u2" loadDocuments={loader} />); });
    await act(async () => { await Promise.resolve(); });
    expect(snapshots.length).toBeGreaterThan(0);
    snapshots.forEach((html, i) => {
      expect(html, `commit ${i} after the switch`).not.toContain("Bí mật của u1.pdf");
      expect(html, `commit ${i} after the switch`).not.toContain("nội dung riêng của u1");
    });
    expect(container.innerHTML).toContain("Tài liệu của u2.pdf");
  });

  it("writes a pending draft under the account that typed it, never the next one", async () => {
    await render({ userId: "u1" });
    await type("nháp của u1");
    await render({ userId: "u2" }); // before the debounce fired
    expect(readNote("u1", "d1").text).toBe("nháp của u1");
    expect(readNote("u2", "d1").text).toBe("");
    if (area()) {
      expect(area().value).toBe("");
      await type("của u2");
      await tick();
      expect(readNote("u2", "d1").text).toBe("của u2");
      expect(readNote("u1", "d1").text).toBe("nháp của u1");
    }
  });
});

// Independent review of #210 (P3): opening the delete confirmation dropped keyboard focus.
describe("NotesPane delete confirmation focus", () => {
  it("moves focus into the confirmation, Escape cancels, and focus returns to the trigger", async () => {
    writeNote("u1", "d1", "sẽ xoá");
    await render();
    await act(async () => { button("Xoá ghi chú trên trình duyệt này").focus(); button("Xoá ghi chú trên trình duyệt này").click(); });
    expect(document.activeElement).toBe(button("Huỷ"));
    await act(async () => { document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(container.querySelector("[role='group']")).toBeNull();
    expect(document.activeElement).toBe(button("Xoá ghi chú trên trình duyệt này"));
    expect(readNote("u1", "d1").text).toBe("sẽ xoá");
    await act(async () => { button("Xoá ghi chú trên trình duyệt này").click(); });
    await act(async () => { button("Huỷ").click(); });
    expect(document.activeElement).toBe(button("Xoá ghi chú trên trình duyệt này"));
  });
});
