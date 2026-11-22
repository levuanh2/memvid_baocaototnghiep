// @vitest-environment jsdom
// V9.3 P1b (docs/StudyMap-V9.3/01, 03, 14): the study shell carries a skip link to a
// focusable main, a bottom nav at <=700px with real routes only and aria-current, an
// error banner announced as an alert, and focus that lands on main after a route
// change when nothing else claimed it.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudyShell from "./StudyShell";
import AppNav, { APP_NAV_ITEMS } from "./AppNav";

vi.mock("../../study/useStudyContext", () => ({
  useStudyContext: () => ({ selectedDocument: null, selectedTopic: null, selectedEntity: null,
    selectedQuestion: null, selectionSource: null }),
}));

let container, root, go;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  container = root = go = null;
});

function Grab() { go = useNavigate(); return null; }

async function render(ui, path = "/app/study") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><Grab />{ui}</MemoryRouter>);
  });
}

describe("AppNav", () => {
  it("lists only routes the app really has", () => {
    expect(APP_NAV_ITEMS.map((i) => [i.label, i.to])).toEqual([
      ["Thư viện", "/app/study"],
      ["Học tập", "/app"],
      ["Luyện tập", "/app/study/quiz/new"],
      ["Tiến độ", "/app/study/progress"],
    ]);
  });

  it.each([
    ["/app/study", "Thư viện"],
    ["/app/study/map/abc", "Thư viện"],
    ["/app", "Học tập"],
    ["/app/study/quiz/new", "Luyện tập"],
    ["/app/study/quiz/q1", "Luyện tập"],
    ["/app/study/result/a1", "Luyện tập"],
    ["/app/study/review/a1", "Luyện tập"],
    ["/app/study/practice/q1", "Luyện tập"],
    ["/app/study/progress", "Tiến độ"],
  ])("marks exactly one current link on %s", async (path, label) => {
    await render(<AppNav />, path);
    const nav = container.querySelector("nav.app-bottom-nav");
    expect(nav.getAttribute("aria-label")).toBe("Điều hướng chính");
    const current = [...nav.querySelectorAll("a[aria-current='page']")];
    expect(current.map((a) => a.textContent.trim())).toEqual([label]);
  });

  it("marks nothing current on the profile page", async () => {
    await render(<AppNav />, "/app/profile");
    expect(container.querySelectorAll("a[aria-current]").length).toBe(0);
  });
});

describe("StudyShell V9.3 shell", () => {
  it("has a skip link to a focusable main and the bottom nav", async () => {
    await render(<StudyShell title="T">x</StudyShell>);
    const skip = container.querySelector("a.skip-link");
    expect(skip.getAttribute("href")).toBe("#main-content");
    expect(skip.textContent).toBe("Bỏ qua đến nội dung chính");
    const main = container.querySelector("main#main-content");
    expect(main.getAttribute("tabindex")).toBe("-1");
    expect(container.querySelector("nav.app-bottom-nav")).not.toBeNull();
    expect(container.firstElementChild.className).toContain("study-shell");
  });

  it("announces the error banner and keeps the retry", async () => {
    const onRetry = vi.fn();
    await render(<StudyShell title="T" error="Chưa tải được tài liệu" onRetry={onRetry} />);
    const alert = container.querySelector("[role='alert']");
    expect(alert.textContent).toContain("Chưa tải được tài liệu");
    container.querySelector("button").click();
    expect(onRetry).toHaveBeenCalled();
  });

  it("marks main busy while loading", async () => {
    await render(<StudyShell title="T" loading />);
    expect(container.querySelector("main").getAttribute("aria-busy")).toBe("true");
  });

  it("moves focus to main after a route change when focus fell to body", async () => {
    await render(<StudyShell title="T">x</StudyShell>);
    document.body.focus();
    await act(async () => { go("/app/study/progress"); });
    expect(document.activeElement).toBe(container.querySelector("main"));
  });

  it("does not steal focus a page already placed", async () => {
    function Page() {
      return <StudyShell title="T"><button type="button" autoFocus>Câu 1</button></StudyShell>;
    }
    await render(<Page />);
    const q = container.querySelector("button");
    q.focus();
    await act(async () => { go("/app/study/quiz/q2"); });
    expect(document.activeElement).toBe(q);
  });
});
