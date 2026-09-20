// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import StudyToolsMenu from "./StudyToolsMenu";

vi.mock("../ui/Icon", () => ({ Icon: ({ name }) => <span data-icon={name} /> }));

let container;
afterEach(() => {
  if (container) document.body.removeChild(container);
  container = null;
});

describe("StudyToolsMenu", () => {
  it("exposes exactly the three existing study tools and no evidence duplicate", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelect = vi.fn();
    await act(async () => root.render(<StudyToolsMenu open onClose={vi.fn()} onSelect={onSelect} />));
    expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(3);
    expect(container.textContent).toContain("Gia sư AI");
    expect(container.textContent).toContain("Dòng thời gian");
    expect(container.textContent).toContain("Kiến thức");
    expect(container.textContent).not.toContain("Bằng chứng");
    await act(async () => container.querySelectorAll('[role="menuitem"]')[1].click());
    expect(onSelect).toHaveBeenCalledWith("timeline");
  });

  it("renders no transient surface while closed", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<StudyToolsMenu open={false} />));
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });
});
