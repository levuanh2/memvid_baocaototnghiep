// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ContextPanelCloseButton from "./ContextPanelCloseButton";

describe("ContextPanelCloseButton", () => {
  let root;
  let host;
  afterEach(() => {
    root?.unmount();
    host?.remove();
  });

  const render = async (props) => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<ContextPanelCloseButton {...props} />));
    return host.querySelector("button");
  };

  it("in the MindMap detail overlay (not collapsible) is named as a close action, not as a collapse", async () => {
    const button = await render({ collapsible: false, onClose: () => {} });
    expect(button.getAttribute("aria-label")).toBe("Đóng chi tiết nhánh");
    expect(button.getAttribute("title")).toBe("Đóng");
  });

  it("when the panel is collapsible it keeps the collapse name", async () => {
    const button = await render({ collapsible: true, onClose: () => {} });
    expect(button.getAttribute("aria-label")).toBe("Thu gọn bộ kiểm tra ngữ cảnh");
  });

  it("is a real button with a 40px hit target class, so keyboard and pointer activation reach onClose", async () => {
    const onClose = vi.fn();
    const button = await render({ collapsible: false, onClose });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("w-10");
    expect(button.className).toContain("h-10");
    await act(async () => button.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
