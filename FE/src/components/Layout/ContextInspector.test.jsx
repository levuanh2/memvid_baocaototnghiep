// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ContextInspector from "./ContextInspector";

const renderCalls = [];
vi.mock("./SidebarRight", () => ({ default: (props) => {
  renderCalls.push(props);
  return <div role="region" aria-label="Bộ kiểm tra ngữ cảnh" data-mode={props.mode} />;
} }));

describe("shared ContextInspector owner", () => {
  let root;
  let host;
  afterEach(() => {
    root?.unmount();
    host?.remove();
    renderCalls.length = 0;
  });

  it("keeps one owner while the active mode changes", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<ContextInspector mode="chat" />));
    await act(async () => root.render(<ContextInspector mode="mindmap" />));
    expect(host.querySelectorAll('[role="region"]').length).toBe(1);
    expect(host.querySelector('[role="region"]').dataset.mode).toBe("mindmap");
    expect(renderCalls).toHaveLength(2);
  });
});
