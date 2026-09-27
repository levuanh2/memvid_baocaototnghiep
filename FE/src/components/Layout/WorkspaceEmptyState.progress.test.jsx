// @vitest-environment jsdom
//
// P2 fix regression: when NO map exists yet for the selected document, a
// Guided generation submitted from here had ZERO visible surface between
// dialog-close and the eventual done/error toast (this screen just showed
// the static "Tạo sơ đồ tư duy" CTA the whole time -- the exact class of
// "submit -> silence -> something happens eventually" complaint this whole
// effort traces back to). These props are plain data -- proves the fix
// needs no `legacyInspectorSurfacesEnabled` flag at all.
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
  await act(async () => { root.render(<WorkspaceEmptyState kind="mindmap" selectedCount={1} onCreate={vi.fn()} {...props} />); });
  return root;
}

describe("WorkspaceEmptyState — Guided generation status (no map open yet)", () => {
  it("shows a submitting/queued indicator with the generic fallback label before a real stage arrives", async () => {
    await render({ creating: true, jobLabel: "" });
    expect(container.textContent).toContain("Đang tạo sơ đồ…");
    // The static "create new" CTA/copy must be replaced, not just supplemented.
    expect(container.textContent).not.toContain("Chưa có sơ đồ tư duy");
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows the real processing stage label and progress once the poller has ticked", async () => {
    await render({ creating: true, jobLabel: "Tìm quan hệ chéo…", jobProgress: 77 });
    expect(container.textContent).toContain("Tìm quan hệ chéo…");
    expect(container.textContent).toContain("(77%)");
  });

  it("resolves cleanly back to the normal create CTA once generation completes (no lingering progress)", async () => {
    await render({ creating: false, jobError: null });
    expect(container.textContent).toContain("Chưa có sơ đồ tư duy");
    expect(container.textContent).toContain("Tạo sơ đồ tư duy");
    expect(container.textContent).not.toContain("Đang tạo sơ đồ…");
  });

  it("shows a visible failure with a Retry action, offered only when a safe retry context exists", async () => {
    const onRetry = vi.fn();
    await render({ creating: false, jobError: "Không tạo được sơ đồ: boom", onRetry });
    expect(container.textContent).toContain("Không tạo được sơ đồ: boom");
    const retryBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Thử lại"));
    expect(retryBtn).toBeTruthy();
    await act(async () => retryBtn.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("falls back to the normal create CTA on failure when no retry context is available", async () => {
    await render({ creating: false, jobError: "Không tạo được sơ đồ: boom", onRetry: null });
    expect(container.textContent).toContain("boom");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent.includes("Thử lại"))).toBe(false);
    expect(container.textContent).toContain("Tạo sơ đồ tư duy");
  });

  it("never shows the generation UI for the summary empty-state kind (scoped to mindmap only)", async () => {
    await render({ kind: "summary", creating: true, jobLabel: "should not leak" });
    expect(container.textContent).not.toContain("should not leak");
  });
});
