// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ModeLibraryMenu from "./ModeLibraryMenu";

vi.mock("../ui/Icon", () => ({ Icon: ({ name }) => <span data-icon={name} /> }));

let container;
afterEach(() => {
  if (container) document.body.removeChild(container);
  container = null;
});

function renderMenu(props = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(<ModeLibraryMenu mode="mindmap" items={[]} selectedSources={["doc-a"]} {...props} />);
  return root;
}

describe("ModeLibraryMenu", () => {
  it("lists real maps, marks the selected item, and exposes one create row", async () => {
    const onSelect = vi.fn();
    const onCreate = vi.fn();
    await act(async () => renderMenu({
      items: [
        { id: "map-1", title: "Cơ sở dữ liệu", sources: ["a"] },
        { id: "map-2", title: "Mạng máy tính", sources: ["a", "b"] },
      ],
      selectedId: "map-2",
      onSelect,
      onCreate,
    }));
    const options = container.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(container.querySelectorAll(".mode-library-menu__create")).toHaveLength(1);
    await act(async () => options[0].click());
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "map-1" }));
    await act(async () => container.querySelector(".mode-library-menu__create").click());
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("renders the empty state without inventing library rows", async () => {
    await act(async () => renderMenu());
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(container.textContent).toContain("Chưa có sơ đồ");
  });
});
