// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import LearningDashboard from "./LearningDashboard";

let root;
let host;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const docs = [
  { document_id: "doc-1", title: "Doc 1", knowledge: { readiness: { mastery: 20 } } },
  { document_id: "doc-2", title: "Doc 2", knowledge: { readiness: { mastery: 55 } } },
  { document_id: "doc-3", title: "Doc 3", knowledge: { readiness: { mastery: 85 } } },
];

function render(props = {}) {
  const defaultProps = {
    documents: docs,
    overview: {},
    weak: [],
    attempts: [],
    mucHienThi: {
      canOnTap: docs,
      tiepTucHoc: null,
      hocGanDay: [],
    },
    onMo: () => {},
    ...props,
  };
  if (!root) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => root.render(<LearningDashboard {...defaultProps} />));
}

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("LearningDashboard review queue labels", () => {
  it("renders the review queue column headers with 'Ôn ngay', 'Ôn sớm', 'Ôn sau'", () => {
    render();
    const text = host.textContent;
    expect(text).toContain("Hàng đợi ôn tập");
    expect(text).toContain("Ôn ngay (1)");
    expect(text).toContain("Ôn sớm (1)");
    expect(text).toContain("Ôn sau (1)");
    expect(text).not.toContain("Hôm nay (1)");
    expect(text).not.toContain("Ngày mai (1)");
    expect(text).not.toContain("Sau (1)");
  });
});
