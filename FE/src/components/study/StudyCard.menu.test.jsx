// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudyCard from "./StudyCard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  container = null;
  root = null;
});

const doc = {
  document_id: "doc-1",
  source_stem: "tai-lieu-1",
  title: "Tai lieu 1.pdf",
  status: "completed",
  ingest_status: "index_ready",
  ai: { index: "ready", summary: { state: "not_generated" }, quiz: {}, review: {} },
};

const key = (target, value) => act(() => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true }));
});

async function renderCard() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(
    <StudyCard
      doc={doc}
      documents={[doc]}
      chiMucBst={new Map()}
      jobs={{ summary: new Set(), mindmap: new Set() }}
      onDoiTen={vi.fn()}
      onLuuTen={vi.fn()}
      onHuyDoiTen={vi.fn()}
      onBatTat={vi.fn()}
      onMo={vi.fn()}
      onKeyDown={vi.fn()}
      tabIndex={0}
    />,
  ));
  return container.querySelector('[aria-haspopup="menu"]');
}

describe("StudyCard document menu", () => {
  it("exposes menu semantics, moves focus with arrows, and restores the trigger on Escape", async () => {
    const trigger = await renderCard();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await act(async () => trigger.click());
    const menu = container.querySelector('[role="menu"]');
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(items).toHaveLength(4);
    expect(document.activeElement).toBe(items[0]);

    key(items[0], "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    key(items[1], "ArrowUp");
    expect(document.activeElement).toBe(items[0]);

    key(items[0], "Escape");
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});
