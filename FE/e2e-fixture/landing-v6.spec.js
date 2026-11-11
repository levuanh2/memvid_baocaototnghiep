// Landing (V6): layout and content guards across the release widths, light and dark, with the
// webfont and with Google Fonts blocked (V5 rule 3: layout must not depend on Inter loading).
// No backend: auth calls are answered 401 so the page renders its signed-out state.
// Set LANDING_QA_DIR to also write full-page captures.
import { test, expect } from "@playwright/test";
import path from "node:path";

const OUT = process.env.LANDING_QA_DIR;
const WIDTHS = [320, 390, 768, 1024, 1440];

async function open(page, { width, dark, blockFonts = false }) {
  await page.addInitScript((d) => localStorage.setItem("memvid-theme", d ? "dark" : "light"), dark);
  await page.setViewportSize({ width, height: 900 });
  await page.route(/localhost:8080\//, (r) => r.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  if (blockFonts) await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

// Every element whose box leaves the viewport horizontally, ignoring clipped descendants.
const overflowing = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  return [...document.querySelectorAll("main *, header *, footer *")]
    .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 0.5 || b.left < -0.5); })
    .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`);
});

for (const width of WIDTHS) {
  for (const dark of [false, true]) {
    const tag = `${width}-${dark ? "dark" : "light"}`;
    test(`landing layout holds at ${tag}`, async ({ page }) => {
      await open(page, { width, dark });
      expect(await overflowing(page)).toEqual([]);

      // One primary action in the hero, and it is the first thing a keyboard user can act on
      // after the header.
      const hero = page.locator("main section").first();
      await expect(hero.getByRole("link", { name: "Bắt đầu miễn phí" })).toBeVisible();
      await expect(hero.locator(".btn-seal")).toHaveCount(1);

      // The specimen (answer + cited passage) is visible and inside the viewport.
      const specimen = page.locator("[data-landing-specimen]");
      await expect(specimen).toBeVisible();
      await expect(specimen.locator(".cite-chip")).toHaveCount(2);

      // Touch targets below 768px.
      if (width < 768) {
        for (const el of await hero.locator("a, button").all()) {
          const b = await el.boundingBox();
          expect(b.height, await el.textContent()).toBeGreaterThanOrEqual(40);
        }
      }

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

test("landing layout holds at 320 with Google Fonts blocked", async ({ page }) => {
  await open(page, { width: 320, dark: false, blockFonts: true });
  expect(await overflowing(page)).toEqual([]);
});

test("landing copy uses the product's own names, not internal ones", async ({ page }) => {
  await open(page, { width: 1280, dark: false });
  const text = await page.locator("main").innerText();
  for (const internal of ["Summary v2", "Mindmap v3", "Background Queue", "Source-grounded", "Job nền", "RAG"]) {
    expect(text).not.toContain(internal);
  }
  for (const name of ["Tải tài liệu lên", "Sơ đồ tư duy", "bản đồ kiến thức", "Thư viện học tập", "Gia sư AI", "câu chưa đúng"]) {
    expect(text).toContain(name);
  }
  // Illustrations are labelled as samples.
  await expect(page.getByText("Ví dụ minh hoạ", { exact: false }).first()).toBeVisible();
});

test("header anchors scroll to their sections", async ({ page }) => {
  await open(page, { width: 1280, dark: false });
  for (const [name, id] of [["Cách hoạt động", "quytrinh"], ["Công cụ", "tinhnang"], ["Ví dụ", "demo"]]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }
});

test("keyboard order is header, then the hero actions", async ({ page }) => {
  await open(page, { width: 1280, dark: false });
  const seen = [];
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.getAttribute("aria-label")));
  }
  expect(seen).toEqual(["Cách hoạt động", "Công cụ", "Ví dụ", "Đổi giao diện sáng/tối", "Đăng nhập", "Bắt đầu", "Bắt đầu miễn phí", "Xem cách hoạt động"]);
});
