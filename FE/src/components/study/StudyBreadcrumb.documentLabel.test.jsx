// @vitest-environment jsdom
// W5-2: Study Context only ever holds the document STEM (the bridge key
// shared with Summary/MindMap, see StudyMapView.jsx's own comment on
// `selectDocument`), so the breadcrumb's first segment used to print the raw
// stem instead of the real title. `documentLabel` lets a page that knows the
// title (StudyMapView) override it; omitting it keeps every other caller's
// existing stem-based behavior exactly as it was.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudyBreadcrumb from "./StudyBreadcrumb";

const stableContext = {
  selectedDocument: "file-stem-abc",
  selectedTopic: null, selectedEntity: null, selectedQuestion: null, selectionSource: "mindmap",
};
vi.mock("../../study/useStudyContext", () => ({ useStudyContext: () => stableContext }));

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  if (container) container.remove();
  container = null; root = null;
});

async function render(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<StudyBreadcrumb {...props} />); });
}

describe("StudyBreadcrumb — documentLabel override (W5-2)", () => {
  it("defaults to the stem when documentLabel is not passed (every pre-existing caller)", async () => {
    await render({});
    expect(container.textContent).toContain("file-stem-abc");
    expect(container.textContent).not.toContain("Tiêu đề tài liệu thật");
  });

  it("shows the real title instead of the stem when documentLabel is passed", async () => {
    await render({ documentLabel: "Tiêu đề tài liệu" }); // <= 20 chars, no truncation
    expect(container.textContent).toContain("Tiêu đề tài liệu");
    expect(container.textContent).not.toContain("file-stem-abc");
  });
});
