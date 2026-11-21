import { expect, test } from "@playwright/test";

function channel(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbChannels(value) {
  return (value.match(/[\d.]+/g) || []).slice(0, 3).map((part) => Number(part) / 255);
}

async function openLanding(page, dark) {
  await page.addInitScript((theme) => localStorage.setItem("memvid-theme", theme), dark ? "dark" : "light");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/localhost:8080\//, (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: "{}",
  }));
  await page.goto("/");
  await expect(page.locator(".lp-wordmark")).toBeVisible();
}

async function openWorkspace(page, dark) {
  const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.addInitScript((theme) => {
    localStorage.setItem("memvid-theme", theme);
    localStorage.setItem("memvid-token", "fixture-token");
  }, dark ? "dark" : "light");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/localhost:8080\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (path === "/list-indexed") return route.fulfill(json({ sources: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app");
  await expect(page.locator(".workspace-wordmark")).toBeVisible();
}

async function measuredColors(page) {
  return page.evaluate(() => {
    const parse = (value) => {
      value = value.trim();
      if (value.startsWith("#")) {
        return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255).concat(1);
      }
      const numbers = value.match(/[\d.]+/g)?.map(Number) || [];
      if (value.startsWith("color(srgb")) return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
      return [numbers[0] / 255, numbers[1] / 255, numbers[2] / 255, numbers[3] ?? 1];
    };
    const composite = ([r, g, b, a], [br, bg, bb]) => [
      r * a + br * (1 - a),
      g * a + bg * (1 - a),
      b * a + bb * (1 - a),
    ];
    const header = document.querySelector("header");
    const study = document.querySelector(".lp-wordmark");
    const map = study.querySelector(".text-seal");
    const rootStyle = getComputedStyle(document.documentElement);
    const [headerRed, headerGreen, headerBlue] = parse(rootStyle.getPropertyValue("--bg-sidebar"));
    const headerLayer = [headerRed, headerGreen, headerBlue, 0.92];
    const pageBackground = parse(rootStyle.getPropertyValue("--bg-base"));
    return {
      studyCss: getComputedStyle(study).color,
      mapCss: getComputedStyle(map).color,
      headerCss: getComputedStyle(header).backgroundColor,
      pageCss: getComputedStyle(document.querySelector("#root > div")).backgroundColor,
      study: parse(getComputedStyle(study).color).slice(0, 3),
      map: parse(getComputedStyle(map).color).slice(0, 3),
      sealCss: rootStyle.getPropertyValue("--seal").trim(),
      seal: parse(rootStyle.getPropertyValue("--seal")).slice(0, 3),
      background: composite(headerLayer, pageBackground),
    };
  });
}

for (const dark of [false, true]) {
  const theme = dark ? "dark" : "light";
  test(`landing header wordmark contrast is AA in ${theme}`, async ({ page }) => {
    await openLanding(page, dark);
    const colors = await measuredColors(page);
    const result = {
      theme,
      study: colors.studyCss,
      map: colors.mapCss,
      header: colors.headerCss,
      pageBehindHeader: colors.pageCss,
      originalSeal: colors.sealCss,
      studyRatio: Number(contrast(colors.study, colors.background).toFixed(2)),
      beforeMapRatio: Number(contrast(colors.seal, colors.background).toFixed(2)),
      mapRatio: Number(contrast(colors.map, colors.background).toFixed(2)),
    };
    console.log(`WORDMARK_CONTRAST ${JSON.stringify(result)}`);
    expect(result.mapRatio).toBeGreaterThanOrEqual(4.5);
  });

  test(`landing footer and app header wordmarks are AA in ${theme} (owner decision 2026-11-15)`, async ({ page }) => {
    await openLanding(page, dark);
    const footer = await page.locator("footer").evaluate((element) => {
      const wordmark = element.querySelector(".font-display");
      return {
        study: getComputedStyle(wordmark).color,
        map: getComputedStyle(wordmark.querySelector(".text-seal")).color,
        background: getComputedStyle(element).backgroundColor,
      };
    });
    await openWorkspace(page, dark);
    const workspace = await page.locator("header.workspace-global-header").evaluate((element) => {
      const wordmark = element.querySelector(".workspace-wordmark");
      return {
        study: getComputedStyle(wordmark).color,
        map: getComputedStyle(wordmark.querySelector(".text-seal")).color,
        background: getComputedStyle(element).backgroundColor,
      };
    });
    for (const [place, colors] of Object.entries({ landingFooter: footer, mainLayoutHeader: workspace })) {
      console.log(`OTHER_WORDMARK_CONTRAST ${JSON.stringify({
        theme,
        place,
        ...colors,
        studyRatio: Number(contrast(rgbChannels(colors.study), rgbChannels(colors.background)).toFixed(2)),
        mapRatio: Number(contrast(rgbChannels(colors.map), rgbChannels(colors.background)).toFixed(2)),
      })}`);
      // Both backgrounds are opaque (checked: no alpha), so the ratio is against what is painted.
      expect(colors.background, `${place} background must be opaque to measure it`).not.toMatch(/\/|rgba/);
      expect(contrast(rgbChannels(colors.map), rgbChannels(colors.background)), place).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test("only the wordmark text changes colour: every other seal-coloured element keeps --seal", async ({ page }) => {
  // Probes instead of whatever seal text a page happens to have: the start screens change
  // between V6 branches (trial 6 lost the one this used to read), the CSS scope does not.
  for (const [dark, open] of [[false, openLanding], [true, openLanding], [false, openWorkspace], [true, openWorkspace]]) {
    await open(page, dark);
    const result = await page.evaluate(() => {
      const make = (html) => { const d = document.createElement("div"); d.innerHTML = html; document.body.appendChild(d); return d; };
      const color = (css) => { const p = make(`<span style="color:${css}">x</span>`); const c = getComputedStyle(p.firstChild).color; p.remove(); return c; };
      const outside = make('<span class="text-seal">Map</span><button class="text-seal">x</button>');
      const inside = make('<span class="workspace-wordmark"><span class="text-seal">Map</span></span>');
      const out = [...outside.querySelectorAll(".text-seal")].map((el) => getComputedStyle(el).color);
      const ins = getComputedStyle(inside.querySelector(".text-seal")).color;
      outside.remove(); inside.remove();
      const real = [...document.querySelectorAll(".text-seal")]
        .filter((el) => !el.closest(".lp-wordmark, .lp-footer-wordmark, .workspace-wordmark"))
        .map((el) => getComputedStyle(el).color);
      return { seal: color("var(--seal)"), brand: color("var(--brand-text)"), out, ins, real };
    });
    for (const c of [...result.out, ...result.real]) expect(c).toBe(result.seal);
    expect(result.ins).toBe(result.brand);
    expect(result.brand).not.toBe(result.seal);
  }
});

test("capture: footer and app header wordmarks, light and dark", async ({ page }) => {
  const out = process.env.V6_SHOT_OUT;
  test.skip(!out, "set V6_SHOT_OUT to capture");
  const tag = process.env.V6_SHOT_TAG || "after";
  for (const dark of [false, true]) {
    const theme = dark ? "dark" : "light";
    await openLanding(page, dark);
    await page.locator("footer").first().screenshot({ path: `${out}/wordmark-footer-${theme}-${tag}.png` });
    await openWorkspace(page, dark);
    await page.locator(".workspace-home-link").screenshot({ path: `${out}/wordmark-app-header-${theme}-${tag}.png` });
  }
});
