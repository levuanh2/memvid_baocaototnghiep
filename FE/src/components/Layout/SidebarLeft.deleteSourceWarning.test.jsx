// @vitest-environment jsdom
//
// Owner decision 2026-11-19 (item 4): deleting a source from the sidebar is a HARD delete
// (DELETE /sources/<id>): the document and every quiz, review plan, practice quiz and
// result made from it go, archived topics included. The confirmation says so in words,
// needs the explicit checkbox, and sends nothing before it. (The Library's delete is a
// soft delete and says nothing of the kind.)
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarLeft from "./SidebarLeft";
import { nhoNguon, quenHetNguon } from "../../utils/nguonDangXuLy";

const calls = [];
vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path, init) => {
    calls.push([path, init?.method || "GET"]);
    if (path === "/list-indexed") return { ok: false, status: 500 };
    if (path === "/sources/up1/status") return { ok: true, json: async () => ({ status: "processing", progress: 10 }) };
    return { ok: true, json: async () => ({}) };
  }),
  _appError: vi.fn(async () => new Error("failed")), isUnauthorizedError: vi.fn(() => false),
  isNotFoundOrForbiddenError: vi.fn(() => false), getUserFriendlyApiError: vi.fn((e) => String(e)),
}));

let container;
let root;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<SidebarLeft selectedSources={[]} setSelectedSources={() => {}} onSourcesChange={() => {}} onClose={() => {}} />);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  quenHetNguon();
  calls.length = 0;
  vi.restoreAllMocks();
});

const deletes = () => calls.filter(([path, method]) => path === "/sources/up1" && method === "DELETE");

describe("deleting a source", () => {
  it("warns that its quizzes, plans and practice history go too, and sends nothing before the checkbox", async () => {
    nhoNguon({ sourceId: "up1", filename: "Doc.txt" });
    const confirmSpy = vi.spyOn(window, "confirm");
    await mount();
    await act(async () => { container.querySelector('[aria-label="Tuỳ chọn"]').click(); });
    await act(async () => { container.querySelector('[role="menuitem"]').click(); });
    expect(confirmSpy, "no bare browser confirm").not.toHaveBeenCalled();
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Doc.txt");
    expect(dialog?.textContent).toContain("kế hoạch ôn tập, bài luyện tập và kết quả làm bài");
    expect(dialog?.textContent).toContain("Không thể hoàn tác");
    const confirm = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Xoá vĩnh viễn"));
    await act(async () => { confirm.click(); });
    expect(deletes(), "nothing before the checkbox").toHaveLength(0);
    await act(async () => { dialog.querySelector('input[type="checkbox"]').click(); });
    await act(async () => { confirm.click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(deletes()).toHaveLength(1);
  });
})
