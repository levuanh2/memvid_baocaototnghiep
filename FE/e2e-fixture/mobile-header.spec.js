// Global header: compact one-row header below 1024px, full desktop header at 1024px and up.
// Runs the REAL workspace (MainLayout) on the Vite dev server with the API mocked at the
// network layer, so it needs no backend, no provider, and no production data.
import { test, expect } from "@playwright/test";

const API = /localhost:8080\//;
const MIN = 40;

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const USAGE = {
  ok: { plan: "Free", used: 120, reserved: 0, limit: 1000, remaining: 880, percentage: 12 },
  warn: { plan: "Free", used: 850, reserved: 0, limit: 1000, remaining: 150, percentage: 85 },
  exhausted: { plan: "Free", used: 1000, reserved: 0, limit: 1000, remaining: 0, percentage: 100 },
};

// One real map record so the Mind Map mode renders its contextual row and canvas.
const MAP = {
  id: "map-a", title: "Bản đồ A", schema_version: 2, sources: [], relations: [], content_hash: "h1",
  nodes: [
    { id: "map-a-root", kind: "root", title: "Chủ đề gốc", parent: null, order: 0 },
    { id: "map-a-m0", kind: "section", title: "Nhánh một", parent: "map-a-root", order: 0 },
    { id: "map-a-m1", kind: "section", title: "Nhánh hai", parent: "map-a-root", order: 1 },
  ],
  generator: { pipeline: "fixture", model: "fixture", elapsed_sec: 0, degraded: false, missing: [] },
};

/**
 * Opens the workspace with mocked API.
 *  usage:    "ok" | "warn" | "exhausted" | "error-then-ok" | "loading"
 *  provider: account provider ("local" | "NKS") — NKS shows the password item.
 *  withMap:  include one map (enables contextual row and Mind Map canvas).
 * Returns { release } so a "loading" usage response can be released by the test.
 */
async function openApp(page, { width, height, dark = false, usage = "ok", provider = "local", withMap = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let usageCalls = 0;
  await page.route(API, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider } }));
    if (pathname === "/usage/me") {
      usageCalls += 1;
      if (usage === "loading") await gate;
      if (usage === "error-then-ok" && usageCalls <= 2) return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      const state = usage === "error-then-ok" || usage === "loading" ? "ok" : usage;
      return route.fulfill(json({ ...USAGE[state], reset_at: "2026-11-01T00:00:00Z", breakdown: { chat: 120 } }));
    }
    if (pathname === "/mindmaps") return route.fulfill(json({ mindmaps: withMap ? [MAP] : [] }));
    if (pathname === "/mindmaps/map-a") return route.fulfill(json(MAP));
    if (pathname === "/list-indexed") return route.fulfill(json({ sources: [{ video: "sample-doc", video_stem: "sample-doc", filename: "sample-doc.txt", status: "index_ready" }] }));
    if (pathname === "/api/documents") return route.fulfill(json({ documents: [{ document_id: "d1", title: "sample-doc.txt", status: "completed", ingest_status: "index_ready", progress: 1 }] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app");
  await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible", timeout: 30000 });
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  return { release: () => release() };
}

// Center point of a control must hit the control itself or one of its descendants.
const hitOwnership = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { found: false };
  const b = el.getBoundingClientRect();
  const x = b.left + b.width / 2, y = b.top + b.height / 2;
  const top = document.elementFromPoint(x, y);
  return {
    found: true,
    w: Math.round(b.width),
    h: Math.round(b.height),
    ok: !!top && (top === el || el.contains(top)),
    at: top ? top.tagName + "." + String(top.getAttribute("class") || "").slice(0, 40) : null,
  };
}, selector);

const CONTROLS = [
  'header a[aria-label^="MemVidX"]',
  'nav[role="tablist"] [role="tab"][title="Trò chuyện"]',
  'nav[role="tablist"] [role="tab"][title="Sơ đồ tư duy"]',
  'nav[role="tablist"] [role="tab"][title="Tóm tắt"]',
  'header button[aria-label="Mở công cụ StudyMap"]',
  'header button[aria-label^="Mức sử dụng AI"]',
  'header button[aria-haspopup="menu"][aria-label^="Tài khoản"]',
];

// Compact header widths: everything below 1024px, including the tablet widths.
const COMPACT = [
  { width: 320, height: 720 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 720, height: 900 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 912, height: 1368 },
  { width: 1023, height: 768 },
];

for (const vp of COMPACT) {
  for (const dark of [false, true]) {
    test.describe(`compact header ${vp.width}x${vp.height} ${dark ? "dark" : "light"}`, () => {
      test("one 56px row, no horizontal overflow, mode switch never scrolls", async ({ page }) => {
        await openApp(page, { ...vp, dark });
        const h = await page.evaluate(() => {
          const nav = document.querySelector('nav[role="tablist"]');
          const header = document.querySelector("header");
          return {
            height: Math.round(header.getBoundingClientRect().height),
            headerScroll: header.scrollWidth, headerClient: header.clientWidth,
            docScroll: document.documentElement.scrollWidth, docClient: document.documentElement.clientWidth,
            navScroll: nav.scrollWidth, navClient: nav.clientWidth, navOverflowX: getComputedStyle(nav).overflowX,
          };
        });
        expect(h.height).toBe(56);
        expect(h.headerScroll).toBeLessThanOrEqual(h.headerClient);
        expect(h.docScroll).toBeLessThanOrEqual(h.docClient);
        expect(h.navScroll).toBeLessThanOrEqual(h.navClient);
        expect(h.navOverflowX).not.toBe("auto");
      });

      test("home, three mode tabs, tools, usage and account are each at least 40x40 and hit their own centre", async ({ page }) => {
        await openApp(page, { ...vp, dark });
        for (const sel of CONTROLS) {
          const r = await hitOwnership(page, sel);
          expect(r.found, `${sel} present`).toBe(true);
          expect(r.w, `${sel} width`).toBeGreaterThanOrEqual(MIN);
          expect(r.h, `${sel} height`).toBeGreaterThanOrEqual(MIN);
          expect(r.ok, `${sel} centre hit at ${r.at}`).toBe(true);
        }
      });

      test("mode tabs are icon-only and show no clipped label", async ({ page }) => {
        await openApp(page, { ...vp, dark });
        for (const name of ["Trò chuyện", "Sơ đồ tư duy", "Tóm tắt"]) {
          const label = await page.locator(`nav[role="tablist"] [role="tab"][title="${name}"] span`).first();
          await expect(label).toBeHidden();
        }
      });

      test("the mode switch is the same width in every global mode and one tap changes aria-selected once", async ({ page }) => {
        await openApp(page, { ...vp, dark });
        const widths = [];
        for (const mode of ["Trò chuyện", "Sơ đồ tư duy", "Tóm tắt"]) {
          await page.getByRole("tab", { name: mode }).click();
          await expect(page.getByRole("tab", { name: mode })).toHaveAttribute("aria-selected", "true");
          widths.push(await page.evaluate(() => Math.round(document.querySelector('nav[role="tablist"]').getBoundingClientRect().width)));
        }
        expect(new Set(widths).size).toBe(1);
        await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
        await expect(page.getByRole("tab", { name: "Sơ đồ tư duy" })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("tab", { name: "Trò chuyện" })).toHaveAttribute("aria-selected", "false");
      });

      test("exactly one workspace-tools owner; source library and inspector live inside its menu", async ({ page }) => {
        await openApp(page, { ...vp, dark });
        await expect(page.locator('header button[aria-label="Mở công cụ StudyMap"]')).toHaveCount(1);
        await expect(page.locator('header button[aria-label="Mở công cụ"]')).toHaveCount(0);
        await expect(page.locator('header button[aria-label="Mở thư mục nguồn"]')).toHaveCount(0);
        await page.locator('header button[aria-label="Mở công cụ StudyMap"]').click();
        const menu = page.getByRole("menu", { name: "Công cụ học" });
        await expect(menu).toBeVisible();
        const box = await menu.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
        await expect(menu.getByRole("menuitem", { name: /Gia sư AI/ })).toBeVisible();
        await expect(menu.getByRole("menuitem", { name: /Mở thư mục nguồn/ })).toBeVisible();
        await expect(menu.getByRole("menuitem", { name: /Mở công cụ/ })).toBeVisible();
      });
    });
  }
}

test.describe("full desktop header at 1024px and up", () => {
  for (const vp of [{ width: 1024, height: 768 }, { width: 1280, height: 800 }, { width: 1440, height: 1024 }]) {
    test(`${vp.width}x${vp.height}: one 56px row, labels visible, shortcut and theme toggle present, no overflow`, async ({ page }) => {
      await openApp(page, vp);
      const h = await page.evaluate(() => {
        const header = document.querySelector("header");
        return {
          height: Math.round(header.getBoundingClientRect().height),
          headerScroll: header.scrollWidth, headerClient: header.clientWidth,
          docScroll: document.documentElement.scrollWidth, docClient: document.documentElement.clientWidth,
        };
      });
      expect(h.height).toBe(56);
      expect(h.headerScroll).toBeLessThanOrEqual(h.headerClient);
      expect(h.docScroll).toBeLessThanOrEqual(h.docClient);
      await expect(page.getByRole("tab", { name: "Sơ đồ tư duy" })).toBeVisible();
      await expect(page.locator('nav[role="tablist"] [role="tab"][title="Sơ đồ tư duy"] span').first()).toBeVisible();
      await expect(page.locator('header button[aria-label="Xem phím tắt"]')).toBeVisible();
      const home = await hitOwnership(page, 'header a[aria-label^="MemVidX"]');
      expect(home.h, "home link height at full header").toBeGreaterThanOrEqual(MIN);
      expect(home.ok, `home centre hit at ${home.at}`).toBe(true);
      await expect(page.getByRole("group", { name: "Chế độ sáng/tối" })).toBeVisible();
      await expect(page.locator('header button[aria-label^="Mức sử dụng AI"] span').last()).toBeVisible();
    });
  }
});

test.describe("contextual Mind Map row does not overlap the global header", () => {
  for (const vp of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
    test(`${vp.width}x${vp.height}: header bottom <= contextual row top, and tab centres hit only the tab`, async ({ page }) => {
      await openApp(page, { ...vp, withMap: true });
      await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
      const library = page.locator('button[aria-label="Mở thư viện sơ đồ"]');
      await expect(library).toBeVisible();
      const rows = await page.evaluate(() => {
        const header = document.querySelector("header").getBoundingClientRect();
        const lib = document.querySelector('button[aria-label="Mở thư viện sơ đồ"]').getBoundingClientRect();
        const tabs = [...document.querySelectorAll('nav[role="tablist"] [role="tab"]')].map((t) => t.getBoundingClientRect().bottom);
        return { headerBottom: header.bottom, contextualTop: lib.top, tabBottom: Math.max(...tabs) };
      });
      expect(rows.headerBottom).toBeLessThanOrEqual(rows.contextualTop);
      expect(rows.tabBottom).toBeLessThanOrEqual(rows.contextualTop);
      for (const sel of CONTROLS) {
        const r = await hitOwnership(page, sel);
        expect(r.ok, `${sel} centre hit in Mind Map at ${r.at}`).toBe(true);
      }
    });
  }
});

test.describe("compact usage control states", () => {
  test("default (12%): 40x40 icon, status dot, percentage in the accessible name", async ({ page }) => {
    await openApp(page, { width: 390, height: 844 });
    const btn = page.locator('header button[aria-label^="Mức sử dụng AI"]');
    await expect(btn).toHaveAttribute("aria-label", "Mức sử dụng AI 12%");
    const r = await hitOwnership(page, 'header button[aria-label^="Mức sử dụng AI"]');
    expect(r.w).toBeGreaterThanOrEqual(MIN);
    expect(r.h).toBeGreaterThanOrEqual(MIN);
  });

  test("loading placeholder is visible before the usage response", async ({ page }) => {
    const { release } = await openApp(page, { width: 390, height: 844, usage: "loading" });
    await expect(page.getByLabel("Đang tải mức sử dụng")).toBeVisible();
    release();
    await expect(page.locator('header button[aria-label^="Mức sử dụng AI"]')).toBeVisible();
  });

  test("error shows a retry button; retry loads the usage", async ({ page }) => {
    await openApp(page, { width: 390, height: 844, usage: "error-then-ok" });
    const retry = page.getByRole("button", { name: "Thử lại mức sử dụng AI" });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.locator('header button[aria-label^="Mức sử dụng AI"]')).toHaveAttribute("aria-label", "Mức sử dụng AI 12%");
  });

  for (const dark of [false, true]) {
    test(`warning (85%) and exhausted (100%) are named and use distinct dot colours (${dark ? "dark" : "light"})`, async ({ page }) => {
      const dotFor = async (usage) => {
        await openApp(page, { width: 390, height: 844, usage, dark });
        const btn = page.locator('header button[aria-label^="Mức sử dụng AI"]');
        const pct = usage === "warn" ? 85 : usage === "exhausted" ? 100 : 12;
        await expect(btn).toHaveAttribute("aria-label", `Mức sử dụng AI ${pct}%`);
        return btn.locator("span[aria-hidden]").evaluate((el) => getComputedStyle(el).backgroundColor);
      };
      const ok = await dotFor("ok");
      const warn = await dotFor("warn");
      const bad = await dotFor("exhausted");
      expect(warn, "warning dot is coloured").not.toBe("rgba(0, 0, 0, 0)");
      expect(bad, "exhausted dot is coloured").not.toBe("rgba(0, 0, 0, 0)");
      expect(new Set([ok, warn, bad]).size, `ok/warning/exhausted dots distinct (${ok} / ${warn} / ${bad})`).toBe(3);
    });
  }

  test("popover fits the viewport at 320px and closes on Escape, outside click; inside click keeps it open", async ({ page }) => {
    await openApp(page, { width: 320, height: 720 });
    const btn = page.locator('header button[aria-label^="Mức sử dụng AI"]');
    await btn.click();
    const pop = page.getByRole("dialog", { name: "Mức sử dụng AI" });
    await expect(pop).toBeVisible();
    const box = await pop.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
    await pop.getByText(/Gói/).click();
    await expect(pop).toBeVisible();
    await page.mouse.click(160, 690);
    await expect(pop).toHaveCount(0);
    await btn.click();
    await expect(pop).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
  });
});

test.describe("menu dismissal", () => {
  test("tools menu: Escape and outside click close it; a click inside keeps it open", async ({ page }) => {
    await openApp(page, { width: 390, height: 844 });
    const trigger = page.locator('header button[aria-label="Mở công cụ StudyMap"]');
    const menu = page.getByRole("menu", { name: "Công cụ học" });
    await trigger.click();
    await expect(menu).toBeVisible();
    await menu.getByText("Công cụ học").click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await trigger.click();
    await page.mouse.click(190, 700);
    await expect(menu).toHaveCount(0);
  });

  test("opening usage or account while tools is open closes the tools menu", async ({ page }) => {
    await openApp(page, { width: 390, height: 844 });
    const menu = page.getByRole("menu", { name: "Công cụ học" });
    await page.locator('header button[aria-label="Mở công cụ StudyMap"]').click();
    await expect(menu).toBeVisible();
    await page.locator('header button[aria-label^="Mức sử dụng AI"]').click();
    await expect(menu).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.locator('header button[aria-label="Mở công cụ StudyMap"]').click();
    await expect(menu).toBeVisible();
    await page.locator('header button[aria-haspopup="menu"][aria-label^="Tài khoản"]').click();
    await expect(menu).toHaveCount(0);
  });

  test("a source-library action from the tools menu runs and the menu closes", async ({ page }) => {
    await openApp(page, { width: 390, height: 844 });
    const menu = page.getByRole("menu", { name: "Công cụ học" });
    await page.locator('header button[aria-label="Mở công cụ StudyMap"]').click();
    await menu.getByRole("menuitem", { name: /Mở thư mục nguồn/ }).click();
    await expect(menu).toHaveCount(0);
  });

  test("account menu: outside click and Escape close it; profile and logout stay present (password only for NKS)", async ({ page }) => {
    await openApp(page, { width: 390, height: 844 });
    const acct = page.locator('header button[aria-haspopup="menu"][aria-label^="Tài khoản"]');
    const menu = page.getByRole("menu").filter({ hasText: "qa@example.test" });
    await acct.click();
    await expect(menu.getByRole("menuitem", { name: /Hồ sơ tài khoản/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Đăng xuất/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Đổi mật khẩu/ })).toHaveCount(0);
    await page.mouse.click(190, 700);
    await expect(menu).toHaveCount(0);
    await acct.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("account menu shows the password item for an NKS account", async ({ page }) => {
    await openApp(page, { width: 390, height: 844, provider: "NKS" });
    await page.locator('header button[aria-haspopup="menu"][aria-label^="Tài khoản"]').click();
    await expect(page.getByRole("menuitem", { name: /Đổi mật khẩu/ })).toBeVisible();
  });
});

test.describe("mode-switch lifecycle invariants", () => {
  test("chat pane is not remounted and the Mind Map canvas keeps its node and transform through round trips", async ({ page }) => {
    await openApp(page, { width: 390, height: 844, withMap: true });
    await page.getByRole("tab", { name: "Trò chuyện" }).click();
    await page.evaluate(() => { window.__chat = document.querySelector("textarea"); });
    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
    await expect(page.locator("me-root").first()).toBeAttached();
    const before = await page.evaluate(() => ({
      root: document.querySelector("me-root")?.outerHTML.length ?? 0,
      transform: document.querySelector(".map-canvas, .mm-canvas-wrap > div")?.style.transform || "",
      tpc: document.querySelectorAll("me-tpc").length,
    }));
    await page.getByRole("tab", { name: "Tóm tắt" }).click();
    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
    await page.getByRole("tab", { name: "Trò chuyện" }).click();
    const after = await page.evaluate(() => ({
      sameTextarea: document.querySelector("textarea") === window.__chat,
      transform: document.querySelector(".map-canvas, .mm-canvas-wrap > div")?.style.transform || "",
      tpc: document.querySelectorAll("me-tpc").length,
    }));
    expect(after.sameTextarea, "ChatArea not remounted").toBe(true);
    expect(after.transform, "canvas transform unchanged across round trip").toBe(before.transform);
    expect(after.tpc, "topic count unchanged").toBe(before.tpc);
  });

  test("Mind Elixir instance (me-root element) survives Mind Map → Summary → Mind Map", async ({ page }) => {
    await openApp(page, { width: 390, height: 844, withMap: true });
    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
    await expect(page.locator("me-root").first()).toBeAttached();
    await page.evaluate(() => { window.__root = document.querySelector("me-root"); });
    await page.getByRole("tab", { name: "Tóm tắt" }).click();
    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
    const same = await page.evaluate(() => document.querySelector("me-root") === window.__root);
    expect(same, "same Mind Elixir root element after the round trip").toBe(true);
  });

  test("Export Studio opens from the Mind Map header", async ({ page }) => {
    await openApp(page, { width: 390, height: 844, withMap: true });
    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
    await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
    await expect(page.getByRole("dialog").filter({ hasText: "Xuất sơ đồ" }).first()).toBeVisible();
  });

  test("the map library opens from the compact header and offers the create action", async ({ page }) => {
    // Guided itself is verified on production (aria-modal, Escape, no generation POST).
    // This fixture cannot open it: the create action needs a selected source.
    await openApp(page, { width: 390, height: 844, withMap: true });
    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
    await page.locator('button[aria-label="Mở thư viện sơ đồ"]').click();
    const listbox = page.getByRole("listbox", { name: "Chọn sơ đồ" });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("button", { name: /Tạo sơ đồ mới/ })).toBeVisible();
  });
});
