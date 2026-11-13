// Landing (V6): layout and content guards. No backend: the API is mocked at the network layer.
// Matrix actually run (keep docs/ui-ux-v6/02-design-spec.md §4 in step with this):
//   - signed out, webfonts loaded: 320 / 390 / 768 / 1024 / 1440, light and dark;
//   - Google Fonts blocked: 320 light and dark, signed out and signed in;
//   - copy, anchors, keyboard order, reduced motion, specimen typography: 1280 light, signed out.
// Set LANDING_QA_DIR to also write full-page captures.
import { test, expect } from "@playwright/test";
import path from "node:path";

const OUT = process.env.LANDING_QA_DIR;
const WIDTHS = [320, 390, 768, 1024, 1440];
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function open(page, { width, dark = false, blockFonts = false, signedIn = false, reducedMotion = false }) {
  if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(({ d, s }) => {
    localStorage.setItem("memvid-theme", d ? "dark" : "light");
    if (s) localStorage.setItem("memvid-token", "fixture-token");
  }, { d: dark, s: signedIn });
  await page.setViewportSize({ width, height: 900 });
  await page.route(/localhost:8080\//, (r) => {
    const p = new URL(r.request().url()).pathname;
    if (signedIn && p === "/auth/me") return r.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (signedIn) return r.fulfill(json({}));
    return r.fulfill({ status: 401, contentType: "application/json", body: "{}" });
  });
  if (blockFonts) await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (signedIn) await expect(page.locator("header").getByRole("link", { name: "Vào workspace" })).toBeVisible();
}

// Two kinds of horizontal overflow: a box that leaves the viewport, and content wider than a
// box that clips it (`overflow: hidden` panels would otherwise hide lost text from the first check).
const overflowing = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const name = (el) => `${el.tagName}.${String(el.className).slice(0, 40)}`;
  const outside = [...document.querySelectorAll("main *, header *, footer *")]
    .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 0.5 || b.left < -0.5); })
    .map((el) => `outside viewport: ${name(el)}`);
  const clipped = [...document.querySelectorAll(".lp-panel, .lp-sheet, .lp-slip, .lp-nav, .lp-route li, .lp-also div")]
    .filter((el) => el.scrollWidth > el.clientWidth + 1)
    .map((el) => `clips its content: ${name(el)} (${el.scrollWidth} > ${el.clientWidth})`);
  return [...outside, ...clipped];
});

// Every visible link and button in the header and the hero.
async function expectTouchTargets(page) {
  const controls = await page.locator("header a, header button, main section:first-of-type a, main section:first-of-type button").all();
  let checked = 0;
  for (const el of controls) {
    if (!(await el.isVisible())) continue;
    const b = await el.boundingBox();
    const label = (await el.textContent())?.trim() || (await el.getAttribute("aria-label"));
    // Rounded to 1/100 px: a 44px box at a fractional offset is reported as 43.99997
    // (seen once in a full Fixture Audit run). The threshold itself stays 44.
    const px = (value) => Math.round(value * 100) / 100;
    expect(px(b.height), `${label} height`).toBeGreaterThanOrEqual(44);
    expect(px(b.width), `${label} width`).toBeGreaterThanOrEqual(44);
    checked += 1;
  }
  expect(checked).toBeGreaterThanOrEqual(4);
}

for (const width of WIDTHS) {
  for (const dark of [false, true]) {
    const tag = `${width}-${dark ? "dark" : "light"}`;
    test(`landing layout holds at ${tag}`, async ({ page }) => {
      await open(page, { width, dark });
      expect(await overflowing(page)).toEqual([]);

      // One primary action in the hero.
      const hero = page.locator("main section").first();
      await expect(hero.getByRole("link", { name: "Bắt đầu miễn phí" })).toBeVisible();
      await expect(hero.locator(".btn-seal")).toHaveCount(1);

      // The specimen (answer + cited passage) is visible.
      const specimen = page.locator("[data-landing-specimen]");
      await expect(specimen).toBeVisible();
      await expect(specimen.locator(".cite-chip")).toHaveCount(2);

      if (width < 768) await expectTouchTargets(page);

      if (OUT) {
        const h = await page.evaluate(() => {
          const s = document.querySelector("#root > div");
          s.style.height = "auto"; s.style.overflow = "visible"; document.body.style.overflow = "visible";
          return s.scrollHeight;
        });
        await page.setViewportSize({ width, height: Math.min(h, 6000) });
        await page.screenshot({ path: path.join(OUT, `landing-${tag}.png`) });
      }
    });
  }
}

for (const dark of [false, true]) {
  for (const signedIn of [false, true]) {
    test(`320px with Google Fonts blocked, ${dark ? "dark" : "light"}, ${signedIn ? "signed in" : "signed out"}`, async ({ page }) => {
      await open(page, { width: 320, dark, blockFonts: true, signedIn });
      expect(await overflowing(page)).toEqual([]);
      await expectTouchTargets(page);
      // The header's primary action is fully inside the viewport.
      const cta = page.locator("header .btn-seal");
      const box = await cta.boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    });
  }
}

test("landing copy uses the product's own names, not internal ones", async ({ page }) => {
  await open(page, { width: 1280 });
  const text = await page.locator("main").innerText();
  for (const internal of ["Summary v2", "Mindmap v3", "Background Queue", "Source-grounded", "Job nền", "RAG"]) {
    expect(text).not.toContain(internal);
  }
  for (const name of ["Tải tài liệu lên", "Sơ đồ tư duy", "bản đồ kiến thức", "Thư viện học tập", "Gia sư AI", "câu chưa đúng"]) {
    expect(text).toContain(name);
  }
  // No absolute promises the app does not enforce (review of #159).
  expect(text).not.toContain("Mỗi câu trả lời");
  expect(text).not.toContain("Câu trả lời chỉ dựa trên những tài liệu bạn đang chọn");
});

test("specimens are readable by assistive technology and labelled as samples", async ({ page }) => {
  await open(page, { width: 1280 });
  const figures = page.locator("main figure");
  await expect(figures).toHaveCount(3);
  for (const figure of await figures.all()) {
    await expect(figure.locator("figcaption")).toContainText("Ví dụ minh hoạ");
    expect(await figure.evaluate((el) => el.closest("[aria-hidden='true']") !== null)).toBe(false);
  }
  // The specimen classes keep their own type (a broader `.lp-row p` rule once overrode them).
  const size = (selector) => page.locator(selector).evaluate((el) => getComputedStyle(el).fontSize);
  expect(await size(".lp-quiz__q")).toBe("17px");
  expect(await size(".lp-quiz__why")).toBe("13px");
});

test("section links are anchors that scroll to their sections", async ({ page }) => {
  await open(page, { width: 1280 });
  for (const [name, id] of [["Cách hoạt động", "quytrinh"], ["Công cụ", "tinhnang"], ["Ví dụ", "demo"]]) {
    const link = page.locator("header").getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", `#${id}`);
    await link.click();
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }
});

test("with reduced motion, a section link jumps without animating", async ({ page }) => {
  await open(page, { width: 1280, reducedMotion: true });
  await page.locator("header").getByRole("link", { name: "Ví dụ", exact: true }).click();
  // No smooth scroll: the target is already in view on the next frame.
  const top = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(document.getElementById("demo").getBoundingClientRect().top))));
  expect(top).toBeLessThan(120);
});

test("keyboard order is header, then the hero actions", async ({ page }) => {
  await open(page, { width: 1280 });
  const seen = [];
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.getAttribute("aria-label")));
  }
  expect(seen).toEqual(["Cách hoạt động", "Công cụ", "Ví dụ", "Đổi giao diện sáng/tối", "Đăng nhập", "Bắt đầu", "Bắt đầu miễn phí", "Xem cách hoạt động"]);
});
