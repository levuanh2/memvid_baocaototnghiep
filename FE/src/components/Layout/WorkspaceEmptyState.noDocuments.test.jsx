// @vitest-environment jsdom
// W1-4 (item 2): when the library has no document at all (`hasAnyDocuments`
// false), Mind Map/Summary's empty state shows one primary "Tải tài liệu
// lên" button instead of the normal (always-disabled, nothing to select)
// create CTA.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import WorkspaceEmptyState from "./WorkspaceEmptyState";

vi.mock("../ui/Icon", () => ({ Icon: ({ name }) => <span data-icon={name} /> }));

let container;
afterEach(() => { if (container) { document.body.removeChild(container); container = null; } });

async function render(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<WorkspaceEmptyState kind="mindmap" selectedCount={0} onCreate={vi.fn()} {...props} />); });
  return root;
}

describe("WorkspaceEmptyState — no documents at all", () => {
  it("defaults hasAnyDocuments to true (pre-existing callers/tests keep the old 'select a document' behavior)", async () => {
    await render({});
    expect(container.textContent).toContain("Chưa chọn tài liệu nào");
    expect(container.textContent).toContain("Chọn tài liệu bên trái trước.");
    expect(container.textContent).not.toContain("Tải tài liệu lên");
  });

  it("shows the upload CTA instead of the disabled create button when the library is truly empty", async () => {
    const onUpload = vi.fn();
    await render({ hasAnyDocuments: false, onUpload });
    const upload = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Tải tài liệu lên");
    expect(upload).toBeTruthy();
    await act(async () => upload.click());
    expect(onUpload).toHaveBeenCalledTimes(1);

    // The old "nothing selected yet" copy/CTA must be replaced, not just
    // supplemented -- there is nothing to select.
    expect(container.textContent).not.toContain("Chưa chọn tài liệu nào");
    expect(container.textContent).not.toContain("Chọn tài liệu bên trái trước.");
    expect(container.querySelector("button[disabled]")).toBeNull();
  });

  it("summary kind gets the same upload CTA", async () => {
    await render({ kind: "summary", hasAnyDocuments: false });
    expect(container.textContent).toContain("Tải tài liệu lên");
  });
});
