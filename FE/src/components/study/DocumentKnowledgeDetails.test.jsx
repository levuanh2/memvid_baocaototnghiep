// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import DocumentKnowledgeDetails from "./DocumentKnowledgeDetails";
import { getQuestions } from "../../utils/studyApi";

vi.mock("../../utils/studyApi", async (original) => ({
  ...(await original()),
  getQuestions: vi.fn(),
}));

const doc = {
  document_id: "doc-1", source_stem: "source-one", title: "Nguồn một", tags: [],
  ai: { index: "ready", summary: { state: "ready", preview: "Nội dung" } },
};
let root;
let host;
const jobs = { summary: new Set(), mindmap: new Set(), quiz: new Set() };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(open, props = {}) {
  const element = <StudyContextProvider><DocumentKnowledgeDetails open={open} doc={doc}
    documents={[doc]} chiMucBst={new Map()} jobs={jobs} onOpen={() => {}} {...props} /></StudyContextProvider>;
  if (!root) {
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  }
  act(() => root.render(element));
}

beforeEach(() => getQuestions.mockReset());
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); root = null; host = null; });

describe("DocumentKnowledgeDetails", () => {
  it("fetches once on first open and reuses the cached questions on reopen", async () => {
    getQuestions.mockResolvedValue([{ id: "q1", text: "Hỏi gì?", category: "concept", target: "chat" }]);
    render(false);
    expect(getQuestions).not.toHaveBeenCalled();
    render(true);
    await act(async () => {});
    expect(getQuestions).toHaveBeenCalledTimes(1);
    render(false);
    render(true);
    await act(async () => {});
    expect(getQuestions).toHaveBeenCalledTimes(1);
  });

  it("shows an error and retries through the single fetch path", async () => {
    getQuestions.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
    render(true);
    await act(async () => {});
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => host.querySelector('[role="alert"] button').click());
    expect(getQuestions).toHaveBeenCalledTimes(2);
  });

  it("opens a source-linked question through the shared dispatcher", async () => {
    const onOpen = vi.fn();
    getQuestions.mockResolvedValue([{ id: "q1", text: "Hỏi về nguồn?", category: "concept", target: "chat" }]);
    render(true, { onOpen });
    await act(async () => {});
    const question = [...host.querySelectorAll("button")].find((button) => button.textContent.includes("Hỏi về nguồn?"));
    act(() => question.click());
    expect(onOpen).toHaveBeenCalledWith(doc, "chat", { prompt: "Hỏi về nguồn?" });
  });
});
