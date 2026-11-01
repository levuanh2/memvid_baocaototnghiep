import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire("E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/phase-c-round8-2-release-gate/FE/package.json");
const { chromium } = require("@playwright/test");

const BASE_URL = "http://localhost:5199";
const EVIDENCE_DIR = "E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/phase-c-round8-2-release-gate/docs/ui-ux-v4-design/round8-2-qa-evidence/agy";
const SCREENSHOT_DIR = path.join(EVIDENCE_DIR, "screenshots");

const API = /localhost:8080\//;
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const USAGE = {
  ok: { plan: "Free", used: 120, reserved: 0, limit: 1000, remaining: 880, percentage: 12, reset_at: "2026-11-01T00:00:00Z", breakdown: { chat: 120 } },
};

const MAP = {
  id: "map-a", title: "Bản đồ A", schema_version: 2, sources: [], relations: [], content_hash: "h1",
  nodes: [
    { id: "map-a-root", kind: "root", title: "Chủ đề gốc", parent: null, order: 0 },
    { id: "map-a-m0", kind: "section", title: "Nhánh một", parent: "map-a-root", order: 0 },
    { id: "map-a-m1", kind: "section", title: "Nhánh hai", parent: "map-a-root", order: 1 },
  ],
  generator: { pipeline: "fixture", model: "fixture", elapsed_sec: 0, degraded: false, missing: [] },
};

async function openApp(page, { width, height, dark = false }) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(({ isDark }) => {
    localStorage.setItem("memvid-token", "fixture-token");
    localStorage.setItem("memvid-theme", isDark ? "dark" : "light");
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, { isDark: dark });

  await page.route(API, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/auth/me") {
      return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA User", provider: "local" } }));
    }
    if (pathname === "/usage/me") {
      return route.fulfill(json(USAGE.ok));
    }
    if (pathname === "/mindmaps") return route.fulfill(json([MAP]));
    if (pathname === "/mindmaps/map-a") return route.fulfill(json(MAP));
    if (pathname === "/list-indexed") return route.fulfill(json({ sources: [] }));
    if (pathname === "/api/documents") return route.fulfill(json({ documents: [] }));
    return route.fulfill(json({}));
  });

  await page.goto(`${BASE_URL}/app`);
  await page.getByRole("tablist", { name: /Workspace/i }).waitFor({ state: "visible", timeout: 30000 });
  await page.evaluate(({ isDark }) => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, { isDark: dark });
  await page.waitForTimeout(300);
}

// Measurement routine for Account Control & Header Geometry
const MEASURE_ACCOUNT_AND_HEADER = () => {
  const header = document.querySelector("header.workspace-global-header");
  const hb = header.getBoundingClientRect();
  const csHeader = window.getComputedStyle(header);
  const headerPadL = parseFloat(csHeader.paddingLeft) || 0;
  const headerPadR = parseFloat(csHeader.paddingRight) || 0;
  const headerGap = parseFloat(csHeader.columnGap || csHeader.gap) || 0;

  const btn = document.querySelector('header button[aria-haspopup="menu"][aria-label^="Tài khoản"]')
    || document.querySelector('.account-menu__trigger');

  if (!btn) return { error: "Account button not found" };

  const b = btn.getBoundingClientRect();
  const rect = {
    left: Math.round(b.left * 100) / 100,
    top: Math.round(b.top * 100) / 100,
    right: Math.round(b.right * 100) / 100,
    bottom: Math.round(b.bottom * 100) / 100,
    width: Math.round(b.width * 100) / 100,
    height: Math.round(b.height * 100) / 100,
  };

  const cx = b.left + b.width / 2;
  const cy = b.top + b.height / 2;

  // Header children measurement
  const kids = [...header.children].map((c) => {
    const cb = c.getBoundingClientRect();
    return {
      tag: c.tagName.toLowerCase(),
      className: String(c.getAttribute("class") || "").slice(0, 50),
      rect: {
        left: Math.round(cb.left * 100) / 100,
        right: Math.round(cb.right * 100) / 100,
        width: Math.round(cb.width * 100) / 100,
        height: Math.round(cb.height * 100) / 100,
      },
    };
  });

  // Actions group children (.workspace-header-actions)
  const actionsGroup = document.querySelector(".workspace-header-actions");
  const actionsKids = actionsGroup ? [...actionsGroup.children].map((c) => {
    const cb = c.getBoundingClientRect();
    return {
      tag: c.tagName.toLowerCase(),
      className: String(c.getAttribute("class") || "").slice(0, 50),
      rect: {
        left: Math.round(cb.left * 100) / 100,
        right: Math.round(cb.right * 100) / 100,
        width: Math.round(cb.width * 100) / 100,
        height: Math.round(cb.height * 100) / 100,
      },
    };
  }) : [];

  // Nearest interactive neighbour to Account button
  const candidates = [...header.querySelectorAll("button, a, [role='button'], [tabindex='0']")].filter(
    (el) => el !== btn && !btn.contains(el) && !el.contains(btn)
  );

  let nearest = null;
  let minGap = Infinity;

  for (const c of candidates) {
    const cb = c.getBoundingClientRect();
    if (cb.width === 0 || cb.height === 0) continue;
    let gap = Infinity;
    if (cb.right <= b.left) {
      gap = b.left - cb.right;
    } else if (cb.left >= b.right) {
      gap = cb.left - b.right;
    } else {
      gap = 0;
    }

    if (gap < minGap) {
      minGap = gap;
      nearest = {
        tag: c.tagName.toLowerCase(),
        ariaLabel: c.getAttribute("aria-label"),
        className: String(c.className || "").slice(0, 50),
        rect: {
          left: Math.round(cb.left * 100) / 100,
          right: Math.round(cb.right * 100) / 100,
          width: Math.round(cb.width * 100) / 100,
          height: Math.round(cb.height * 100) / 100,
        },
        gap: Math.round(gap * 100) / 100,
      };
    }
  }

  // Viewport right margin
  const rightMargin = Math.round((window.innerWidth - b.right) * 100) / 100;

  // Real hit area scan
  // Horizontal span through cy
  let hitMinX = Infinity, hitMaxX = -Infinity;
  for (let x = 0; x <= window.innerWidth; x += 0.5) {
    const el = document.elementFromPoint(x, cy);
    if (el && (el === btn || btn.contains(el))) {
      if (x < hitMinX) hitMinX = x;
      if (x > hitMaxX) hitMaxX = x;
    }
  }

  // Vertical span through cx
  let hitMinY = Infinity, hitMaxY = -Infinity;
  for (let y = 0; y <= window.innerHeight; y += 0.5) {
    const el = document.elementFromPoint(cx, y);
    if (el && (el === btn || btn.contains(el))) {
      if (y < hitMinY) hitMinY = y;
      if (y > hitMaxY) hitMaxY = y;
    }
  }

  // Envelope scan (±35px box around center)
  let boundMinX = Infinity, boundMaxX = -Infinity;
  let boundMinY = Infinity, boundMaxY = -Infinity;
  for (let y = Math.max(0, cy - 35); y <= cy + 35; y += 0.5) {
    for (let x = Math.max(0, cx - 35); x <= cx + 35; x += 0.5) {
      const el = document.elementFromPoint(x, y);
      if (el && (el === btn || btn.contains(el))) {
        if (x < boundMinX) boundMinX = x;
        if (x > boundMaxX) boundMaxX = x;
        if (y < boundMinY) boundMinY = y;
        if (y > boundMaxY) boundMaxY = y;
      }
    }
  }

  const effectiveHitArea = {
    horizontalSpan: {
      minX: Math.round(hitMinX * 100) / 100,
      maxX: Math.round(hitMaxX * 100) / 100,
      width: Math.round((hitMaxX - hitMinX) * 100) / 100,
    },
    verticalSpan: {
      minY: Math.round(hitMinY * 100) / 100,
      maxY: Math.round(hitMaxY * 100) / 100,
      height: Math.round((hitMaxY - hitMinY) * 100) / 100,
    },
    envelope: {
      width: boundMaxX >= boundMinX ? Math.round((boundMaxX - boundMinX) * 100) / 100 : 0,
      height: boundMaxY >= boundMinY ? Math.round((boundMaxY - boundMinY) * 100) / 100 : 0,
    },
  };

  // 44x44 centered box tests
  const half = 22;
  const box44 = {
    left: Math.round((cx - half) * 100) / 100,
    right: Math.round((cx + half) * 100) / 100,
    top: Math.round((cy - half) * 100) / 100,
    bottom: Math.round((cy + half) * 100) / 100,
  };

  const checkPoint = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const resolves = !!el && (el === btn || btn.contains(el));
    return {
      point: [Math.round(x * 100) / 100, Math.round(y * 100) / 100],
      resolvesToAccount: resolves,
      resolvedElement: el ? `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).slice(0, 40) : ''}` : null,
    };
  };

  const cardinalExtrema = {
    topCenter: checkPoint(cx, cy - half),
    bottomCenter: checkPoint(cx, cy + half),
    leftCenter: checkPoint(cx - half, cy),
    rightCenter: checkPoint(cx + half, cy),
  };

  const corners = {
    topLeft: checkPoint(cx - half, cy - half),
    topRight: checkPoint(cx + half, cy - half),
    bottomLeft: checkPoint(cx - half, cy + half),
    bottomRight: checkPoint(cx + half, cy + half),
  };

  // Perimeter sampling (1px step along the 44x44 perimeter)
  let perimeterTotal = 0;
  let perimeterResolves = 0;
  for (let x = cx - half; x <= cx + half; x += 1) {
    for (const y of [cy - half, cy + half]) {
      perimeterTotal++;
      if (checkPoint(x, y).resolvesToAccount) perimeterResolves++;
    }
  }
  for (let y = cy - half + 1; y < cy + half; y += 1) {
    for (const x of [cx - half, cx + half]) {
      perimeterTotal++;
      if (checkPoint(x, y).resolvesToAccount) perimeterResolves++;
    }
  }

  // 2D grid sampling (1px step inside 44x44 box)
  let gridTotal = 0;
  let gridResolves = 0;
  for (let y = cy - half; y <= cy + half; y += 1) {
    for (let x = cx - half; x <= cx + half; x += 1) {
      gridTotal++;
      const el = document.elementFromPoint(x, y);
      if (el && (el === btn || btn.contains(el))) gridResolves++;
    }
  }

  // Free width calculation
  // Find rightmost point of header content and available header clientWidth
  // Header natural width is sum of top children bounding widths + gaps + padding
  const naturalContentWidth = kids.reduce((sum, k) => sum + k.rect.width, 0) + headerGap * Math.max(0, kids.length - 1) + headerPadL + headerPadR;
  const freeWidth = Math.round((window.innerWidth - naturalContentWidth) * 100) / 100;

  const targetMet = (rect.width >= 44 && rect.height >= 44) ||
    (effectiveHitArea.envelope.width >= 44 && effectiveHitArea.envelope.height >= 44 && perimeterResolves === perimeterTotal);

  return {
    rect,
    center: { x: Math.round(cx * 100) / 100, y: Math.round(cy * 100) / 100 },
    effectiveHitArea,
    nearestNeighbour: nearest,
    rightMarginToViewport: rightMargin,
    box44,
    cardinalExtrema,
    corners,
    perimeterTest: {
      totalPoints: perimeterTotal,
      resolvingPoints: perimeterResolves,
      percentResolving: Math.round((perimeterResolves / perimeterTotal) * 1000) / 10,
    },
    gridTest: {
      totalPoints: gridTotal,
      resolvingPoints: gridResolves,
      percentResolving: Math.round((gridResolves / gridTotal) * 1000) / 10,
    },
    is44pxTargetMet: targetMet,
    headerMetrics: {
      height: Math.round(hb.height * 100) / 100,
      clientWidth: header.clientWidth,
      scrollWidth: header.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      padL: headerPadL,
      padR: headerPadR,
      gap: headerGap,
      naturalContentWidth: Math.round(naturalContentWidth * 100) / 100,
      freeWidth,
    },
  };
};

async function runTask1Audit() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const viewports = [
    { width: 320, height: 720 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
  ];

  const results = {
    gitHead: "c02e2b91ae2207d472756cd34003b5cb6fee1620",
    auditDate: new Date().toISOString(),
    environment: "Fixture Harness (http://localhost:5199, port 5199)",
    apiMocked: true,
    engine: "Headless Chromium 153.0.8010.12 (Windows x64)",
    accountEvidence: {},
    r8001Evidence: {},
    r8005Evidence: {},
  };

  console.log("=== Auditing Compact Account Control across 12 configurations ===");

  for (const vp of viewports) {
    for (const theme of ["light", "dark"]) {
      const key = `${vp.width}x${vp.height}_${theme}`;
      console.log(`Auditing Account at ${key}...`);
      await openApp(page, { ...vp, dark: theme === "dark" });
      const data = await page.evaluate(MEASURE_ACCOUNT_AND_HEADER);
      results.accountEvidence[key] = {
        viewport: vp,
        theme,
        ...data,
      };

      // Take screenshot of header for 320 and 1024
      if (vp.width === 320 || vp.width === 1024) {
        const headerHandle = page.locator("header.workspace-global-header");
        await headerHandle.screenshot({
          path: path.join(SCREENSHOT_DIR, `header-${vp.width}-${theme}.png`),
        });
      }
    }
  }

  console.log("=== Auditing R8-001 Survival (320px & 1024px) ===");

  for (const w of [320, 1024]) {
    const h = w === 320 ? 720 : 768;
    for (const dark of [false, true]) {
      const theme = dark ? "dark" : "light";
      const key = `${w}_${theme}`;
      await openApp(page, { width: w, height: h, dark });

      const header = page.locator("header.workspace-global-header");
      const hb = await header.boundingBox();
      const overflow = await page.evaluate(() => {
        const header = document.querySelector("header.workspace-global-header");
        return {
          height: Math.round(header.getBoundingClientRect().height),
          headerScroll: header.scrollWidth,
          headerClient: header.clientWidth,
          docScroll: document.documentElement.scrollWidth,
          docClient: document.documentElement.clientWidth,
        };
      });

      // Account reachable
      const accountBtn = page.locator('header button[aria-haspopup="menu"][aria-label^="Tài khoản"]');
      const accountBox = await accountBtn.boundingBox();
      const accountCenterHit = await page.evaluate(() => {
        const btn = document.querySelector('header button[aria-haspopup="menu"][aria-label^="Tài khoản"]');
        const b = btn.getBoundingClientRect();
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return top === btn || btn.contains(top);
      });

      // Open account menu
      await accountBtn.click();
      const accountMenu = page.locator('div[role="menu"]');
      const menuVisible = await accountMenu.isVisible();
      let menuBox = null;
      let menuContained = false;
      if (menuVisible) {
        menuBox = await accountMenu.boundingBox();
        menuContained = menuBox.x >= 0 && (menuBox.x + menuBox.width) <= w + 1;
      }
      await page.keyboard.press("Escape");

      // Compact Theme Switch test via StudyToolsMenu
      const studyToolsBtn = page.locator('header button[aria-label="Mở công cụ StudyMap"]');
      await studyToolsBtn.click();
      const toolsMenu = page.getByRole("menu", { name: "Công cụ học" });
      await toolsMenu.waitFor({ state: "visible" });

      const initialDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      const expectedLabel = initialDark ? /Chuyển sang nền sáng/ : /Chuyển sang nền tối/;
      const themeItem = toolsMenu.getByRole("menuitem", { name: expectedLabel });
      const themeItemVisible = await themeItem.isVisible();

      let toggleSuccess = false;
      if (themeItemVisible) {
        await themeItem.click();
        const newDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
        const storageVal = await page.evaluate(() => localStorage.getItem("memvid-theme"));
        toggleSuccess = (newDark !== initialDark) && storageVal === (newDark ? "dark" : "light");

        // Toggle back to preserve state
        await studyToolsBtn.click();
        await toolsMenu.waitFor({ state: "visible" });
        const revertLabel = newDark ? /Chuyển sang nền sáng/ : /Chuyển sang nền tối/;
        await toolsMenu.getByRole("menuitem", { name: revertLabel }).click();
      }

      results.r8001Evidence[key] = {
        viewport: `${w}x${h}`,
        theme,
        headerHeight: overflow.height,
        headerOverflowX: overflow.headerScroll - overflow.headerClient,
        docOverflowX: overflow.docScroll - overflow.docClient,
        isOneRow56px: overflow.height === 56,
        zeroOverflow: overflow.headerScroll <= overflow.headerClient && overflow.docScroll <= overflow.docClient,
        accountCenterHit,
        accountMenuOpened: menuVisible,
        accountMenuContained: menuContained,
        themeSwitchItemFound: themeItemVisible,
        themeSwitchFunctional: toggleSuccess,
        status: (overflow.height === 56 && overflow.docScroll <= overflow.docClient && accountCenterHit && toggleSuccess) ? "PASS" : "FAIL",
      };
    }
  }

  console.log("=== Auditing R8-005 Survival (Tablet Popover 768, 820, 1024 px) ===");

  const tabletViewports = [
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
  ];

  for (const vp of tabletViewports) {
    for (const theme of ["light", "dark"]) {
      const key = `${vp.width}x${vp.height}_${theme}`;
      console.log(`Auditing Library Popover at ${key}...`);
      await page.setViewportSize(vp);
      await page.goto(`${BASE_URL}/round6-library-qa.html?theme=${theme}`);
      await page.getByTestId("round6-library-qa").waitFor({ state: "visible" });

      // 1. Open tools popover on row 1 and measure all action rows
      const firstRowTrigger = page.locator("[data-document-row]").first().locator("[data-tools-trigger]");
      await firstRowTrigger.click();
      const popover = page.locator(".document-tools--desktop");
      await popover.waitFor({ state: "visible" });

      const actionMetrics = await page.evaluate(() => {
        const menu = document.querySelector(".document-tools--desktop");
        const actions = [...menu.querySelectorAll("button, a")];
        return actions.map((a) => {
          const b = a.getBoundingClientRect();
          return {
            text: a.textContent.trim().replace(/\s+/g, " "),
            w: Math.round(b.width * 100) / 100,
            h: Math.round(b.height * 100) / 100,
            isAbove44: b.height >= 44,
          };
        });
      });

      const allAbove44 = actionMetrics.every((a) => a.h >= 44);

      if (theme === "light") {
        await popover.screenshot({
          path: path.join(SCREENSHOT_DIR, `library-popover-${vp.width}.png`),
        });
      }
      await page.keyboard.press("Escape");

      // 2. Near-bottom containment probe
      // Find row near bottom of viewport or scroll down so row is near bottom
      // Let's test row near bottom
      const containment = await page.evaluate(async (vh) => {
        const rows = [...document.querySelectorAll("[data-document-row]")];
        // Pick a row that is positioned around vh - 100
        // Find row closest to bottom edge of current viewport
        let targetRow = null;
        for (const row of rows) {
          const b = row.getBoundingClientRect();
          if (b.top > vh * 0.6 && b.bottom < vh - 20) {
            targetRow = row;
            break;
          }
        }
        if (!targetRow) {
          // Scroll page so a row sits near bottom
          rows[15]?.scrollIntoView({ block: "center" });
          targetRow = rows[15];
        }

        const trigger = targetRow.querySelector("[data-tools-trigger]");
        const triggerRect = trigger.getBoundingClientRect();
        trigger.click();

        // Wait a frame
        await new Promise((r) => requestAnimationFrame(r));
        const menu = document.querySelector(".document-tools--desktop");
        if (!menu) return { error: "Menu did not open" };

        const mb = menu.getBoundingClientRect();
        const cs = window.getComputedStyle(menu);
        return {
          viewportHeight: vh,
          triggerTop: Math.round(triggerRect.top),
          triggerBottom: Math.round(triggerRect.bottom),
          menuTop: Math.round(mb.top),
          menuBottom: Math.round(mb.bottom),
          menuHeight: Math.round(mb.height),
          isAbove: menu.classList.contains("is-above"),
          maxHeightStyle: menu.style.maxHeight,
          computedMaxHeight: cs.maxHeight,
          strictlyContained: mb.top >= 0 && mb.bottom <= vh,
        };
      }, vp.height);

      if (theme === "light") {
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `library-bottom-containment-${vp.width}.png`),
          fullPage: false,
        });
      }
      await page.keyboard.press("Escape");

      results.r8005Evidence[key] = {
        viewport: vp,
        theme,
        totalActions: actionMetrics.length,
        allRowsAtLeast44px: allAbove44,
        actionMetricsSummary: {
          minHeight: Math.min(...actionMetrics.map((a) => a.h)),
          maxHeight: Math.max(...actionMetrics.map((a) => a.h)),
          sampleRow: actionMetrics[0],
        },
        nearBottomContainment: containment,
        status: (allAbove44 && containment.strictlyContained && containment.isAbove) ? "PASS" : "FAIL",
      };
    }
  }

  await browser.close();

  const outPath = path.join(EVIDENCE_DIR, "task1-evidence.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Task 1 Audit complete. Results saved to ${outPath}`);
}

runTask1Audit().catch((err) => {
  console.error("Task 1 audit failed:", err);
  process.exit(1);
});
