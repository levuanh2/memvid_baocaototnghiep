// @vitest-environment jsdom
// V9.3 P2c (docs/StudyMap-V9.3/04 "Onboarding"; owner D3): a clearly labelled preview,
// three steps (goal, pace, how to start), back keeps choices, skip always available,
// and nothing is saved: no network call, no browser storage write.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Onboarding from "./Onboarding";

let container, root, fetchSpy, setItemSpy;
beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
  setItemSpy = vi.spyOn(Storage.prototype, "setItem");
});
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  container = root = null;
  setItemSpy.mockRestore();
});

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><Onboarding /></MemoryRouter>); });
  return container;
}

const button = (c, name) => [...c.querySelectorAll("button")].find((b) => b.textContent.trim() === name);
const click = async (el) => { await act(async () => { el.click(); }); };
const step = (c) => c.querySelector("[data-onboarding-step]").getAttribute("data-onboarding-step");

describe("Onboarding preview", () => {
  it("says it is a preview that saves nothing", async () => {
    const c = await render();
    const note = c.querySelector(".onb-preview-note");
    expect(note.textContent).toMatch(/Bản xem trước/);
    expect(note.textContent).toMatch(/không lưu/i);
  });

  it("offers the four goals and moves through three steps", async () => {
    const c = await render();
    expect(step(c)).toBe("1");
    const goals = [...c.querySelectorAll("input[name='onb-goal']")].map((i) => i.closest("label").textContent.trim());
    expect(goals).toEqual(["Hiểu sâu một môn", "Ôn thi", "Đọc nghiên cứu", "Sắp xếp việc học"]);
    await click(c.querySelectorAll("input[name='onb-goal']")[1]);
    await click(button(c, "Tiếp tục"));
    expect(step(c)).toBe("2");
    const paces = [...c.querySelectorAll("input[name='onb-pace']")].map((i) => i.closest("label").textContent.trim());
    expect(paces).toEqual(["15 phút", "25 phút", "45 phút", "Linh hoạt"]);
    await click(c.querySelectorAll("input[name='onb-pace']")[2]);
    await click(button(c, "Tiếp tục"));
    expect(step(c)).toBe("3");
    const links = [...c.querySelectorAll("[data-onboarding-step='3'] a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(expect.arrayContaining(["/app/study", "/app"]));
  });

  it("keeps the choice when going back", async () => {
    const c = await render();
    await click(c.querySelectorAll("input[name='onb-goal']")[2]);
    await click(button(c, "Tiếp tục"));
    await click(button(c, "Quay lại"));
    expect(c.querySelectorAll("input[name='onb-goal']")[2].checked).toBe(true);
  });

  it("can be skipped from every step", async () => {
    const c = await render();
    for (let i = 0; i < 3; i += 1) {
      const skip = c.querySelector("a.onb-skip");
      expect(skip.getAttribute("href")).toBe("/app");
      if (i < 2) await click(button(c, "Tiếp tục"));
    }
  });

  it("moves focus to the new step heading", async () => {
    const c = await render();
    await click(button(c, "Tiếp tục"));
    expect(document.activeElement).toBe(c.querySelector("[data-onboarding-step='2'] h2"));
  });

  it("makes no network call and writes no storage", async () => {
    const c = await render();
    await click(c.querySelectorAll("input[name='onb-goal']")[0]);
    await click(button(c, "Tiếp tục"));
    await click(c.querySelectorAll("input[name='onb-pace']")[0]);
    await click(button(c, "Tiếp tục"));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
  });
});
