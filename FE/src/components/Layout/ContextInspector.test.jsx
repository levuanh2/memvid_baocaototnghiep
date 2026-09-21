// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ContextInspector from "./ContextInspector";

const calls = [];
vi.mock("./SidebarRight", () => ({ default: (props) => { calls.push(props); return <div role="region" data-mode={props.mode} />; } }));

describe("ContextInspector", () => {
  let root;
  let host;
  afterEach(() => { root?.unmount(); host?.remove(); calls.length = 0; });

  it("keeps one shared owner while the workspace mode changes", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<ContextInspector mode="chat" />); });
    await act(async () => { root.render(<ContextInspector mode="mindmap" />); });
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(calls.at(-1).mode).toBe("mindmap");
  });
});
