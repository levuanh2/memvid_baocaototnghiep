// @vitest-environment jsdom
// Codex P3 (PR #200): route focus through real <Routes>, a lazy target behind
// Suspense, and a page that places its own focus during its first commit.
import { act, lazy, Suspense, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import StudyShell from "./StudyShell";

vi.mock("../../study/useStudyContext", () => ({
  useStudyContext: () => ({ selectedDocument: null, selectedTopic: null, selectedEntity: null,
    selectedQuestion: null, selectionSource: null }),
}));

let release;
const gate = new Promise((r) => { release = r; });
const LazyProgress = lazy(() => gate.then(() => ({
  default: () => <StudyShell title="Tiến độ"><p>p</p></StudyShell>,
})));

function Quiz() {
  const ref = useRef(null);
  useEffect(() => { ref.current.focus(); }, []);
  return <StudyShell title="Quiz"><button type="button" ref={ref}>Câu 1</button></StudyShell>;
}

function Library() {
  return (
    <StudyShell title="Thư viện">
      <Link to="/app/study/progress">Tiến độ</Link>
      <Link to="/app/study/quiz/q1">Quiz</Link>
    </StudyShell>
  );
}

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  container = root = null;
});

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/app/study"]}>
        <Suspense fallback={<p>Đang tải…</p>}>
          <Routes>
            <Route path="/app/study" element={<Library />} />
            <Route path="/app/study/progress" element={<LazyProgress />} />
            <Route path="/app/study/quiz/:id" element={<Quiz />} />
          </Routes>
        </Suspense>
      </MemoryRouter>,
    );
  });
}

function clickLink(name) {
  const a = [...container.querySelectorAll("main a")].find((x) => x.textContent === name);
  a.focus();
  a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
}

it("ends on the incoming main after a lazy route resolves", async () => {
  await mount();
  await act(async () => { clickLink("Tiến độ"); });
  // The router navigates in a transition: the outgoing page stays until the chunk loads.
  expect(container.querySelector("main#main-content").textContent).toContain("Quiz");
  await act(async () => { release(); await gate; });
  const main = container.querySelector("main#main-content");
  expect(main.closest(".study-shell").textContent).toContain("Tiến độ");
  expect(document.activeElement).toBe(main);
});

it("lets a page that focuses its question keep that focus", async () => {
  await mount();
  await act(async () => { clickLink("Quiz"); });
  expect(document.activeElement.textContent).toBe("Câu 1");
});
