// @vitest-environment jsdom
// V9.3 P5b — Notes Preview pane (owner brief C).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
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

  it("does not offer editing without a signed-in user", async () => {
    await render({ userId: null });
    expect(area()).toBeNull();
    expect(container.textContent).toMatch(/Đăng nhập để ghi chú/);
  });
});
