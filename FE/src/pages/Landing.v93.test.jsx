// @vitest-environment jsdom
// V9.3 P2a (docs/StudyMap-V9.3/04): dark-ink hero with "Đọc có nguồn. Hiểu đến gốc.",
// one primary "start learning" action, every product illustration labelled
// "Ví dụ minh họa", the real journey upload → ask and check → map → practise,
// an independent FAQ, and no invented numbers or features.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Landing from "./Landing";

const auth = vi.hoisted(() => ({ user: null }));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ user: auth.user, logout: vi.fn() }) }));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ isDark: false, toggleTheme: vi.fn() }) }));

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  container = root = null;
  auth.user = null;
});

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><Landing /></MemoryRouter>); });
  return container;
}

describe("Landing V9.3", () => {
  it("opens on the dark-ink hero with the V9.3 headline", async () => {
    const c = await render();
    const hero = c.querySelector("section.lp-hero");
    expect(hero.className).toContain("lp-ink");
    expect(hero.querySelector("h1").textContent).toBe("Đọc có nguồn. Hiểu đến gốc.");
  });

  it("has exactly one primary action in the hero, to start learning", async () => {
    const c = await render();
    const ctas = [...c.querySelectorAll("section.lp-hero .lp-cta")];
    expect(ctas.map((a) => [a.textContent.trim(), a.getAttribute("href")])).toEqual([["Bắt đầu học", "/register"]]);
  });

  it("sends a signed-in learner straight to the workspace", async () => {
    auth.user = { id: "u1" };
    const c = await render();
    const cta = c.querySelector("section.lp-hero .lp-cta");
    expect([cta.textContent.trim(), cta.getAttribute("href")]).toEqual(["Vào không gian học", "/app"]);
  });

  it("labels every product illustration as an example", async () => {
    const c = await render();
    const figures = [...c.querySelectorAll("main figure")];
    expect(figures.length).toBeGreaterThanOrEqual(4);
    for (const f of figures) expect(f.querySelector("figcaption").textContent).toContain("Ví dụ minh họa");
  });

  it("walks the real journey in order", async () => {
    const c = await render();
    const steps = [...c.querySelectorAll("#quytrinh ol.lp-route > li h3")].map((h) => h.textContent);
    expect(steps).toEqual(["Tải tài liệu lên", "Hỏi và đối chiếu nguồn", "Xem sơ đồ", "Luyện tập"]);
  });

  it("covers chat with sources, summary, map and quiz", async () => {
    const c = await render();
    const text = c.querySelector("main").textContent;
    for (const s of ["trích dẫn", "Tóm tắt", "Sơ đồ tư duy", "Quiz"]) expect(text).toContain(s);
  });

  it("has an FAQ of independent details/summary items, all closed", async () => {
    const c = await render();
    const items = [...c.querySelectorAll("#hoidap details")];
    expect(items.length).toBeGreaterThanOrEqual(4);
    for (const d of items) {
      expect(d.querySelector("summary")).not.toBeNull();
      expect(d.hasAttribute("name")).toBe(false);
      expect(d.open).toBe(false);
    }
  });

  it("claims no user counts, ratings, results, or a notes feature the app lacks", async () => {
    const c = await render();
    const text = c.querySelector("main").textContent;
    expect(text).not.toMatch(/\d[\d.,]*\s*\+?\s*(người dùng|học viên|sinh viên|lượt|đánh giá)/i);
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/ghi chú/i);
  });

  // Codex P1/P2 (#201): grounding is conditional. Reject the absolute shapes, not two old
  // sentences: "mỗi/mọi ý … trích dẫn", "chỉ dựa trên", "câu trả lời đánh số/có trích dẫn"
  // stated without a condition ("khi …").
  it.each([
    [/(mỗi|mọi|từng) ý[^.]*trích dẫn/i],
    [/(mỗi|mọi|từng) ý[^.]*(dẫn về|có nguồn)/i],
    [/chỉ dựa (trên|vào)/i],
    [/(^|[.!?]\s+)câu trả lời (đánh số|có|kèm) trích dẫn/i],
  ])("makes no absolute grounding promise: %s", async (re) => {
    const c = await render();
    const text = [...c.querySelectorAll("main p, main li, main dd, main figcaption")].map((e) => e.textContent).join(" ");
    expect(text).not.toMatch(re);
  });

  it("links the onboarding preview and says it is a preview", async () => {
    const c = await render();
    const link = c.querySelector("a[href='/onboarding']");
    expect(link.textContent).toMatch(/xem trước/i);
  });
});
