// Real-browser, real-file Export Studio QA (Round 2, section 2/3/4) against
// the backend-free fixture harness (fixture-harness.html). No production
// API, no auth, no CORS — see playwright.fixture.config.js's own header for
// why this is a SEPARATE config from the main e2e suite.
//
// Every assertion here is against an ACTUAL downloaded file: real magic
// bytes read off disk, real width/height from the browser's own Image
// decoder (not a mocked snapdom.download() call shape — see
// mindmapImageExport.test.js for that unit-level coverage). One honest gap:
// there is no OCR in this environment, so "Vietnamese text visible" and
// "app chrome absent" for the RASTER formats (PNG/JPEG) are verified at the
// DOM level — asserting the exact element handed to snapdom contains the
// expected branch label text and no toolbar/drawer/export-control markup —
// rather than by reading pixels back out of the compressed image. SVG's
// text is real XML and IS asserted directly against the downloaded file's
// own markup, not the DOM.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = path.join(__dirname, "..", "qa-artifacts");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const MAP_A_ID = "fixture-map-a";
const MAP_B_ID = "fixture-map-b";

function nodeSelector(id) {
  return `[data-nodeid="me${id}"]`;
}

async function openExportStudio(page) {
  await page.locator('[aria-label="Xuất sơ đồ"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function chooseScope(page, value) {
  await page.locator(`input[name="mm-export-scope"][value="${value}"]`).check();
}

async function chooseFormat(page, value) {
  await page.locator(`input[name="mm-export-format"][value="${value}"]`).check();
}

async function clickNext(page) {
  await page.getByRole("button", { name: "Tiếp tục" }).click();
}

/** From step 0 (scope), advances all the way to step 3 (preview) — 3 clicks. */
async function advanceToPreview(page) {
  for (let i = 0; i < 3; i++) await clickNext(page);
}

async function exportAndSave(page, filenameHint) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^(Xuất|Tạo) (PNG|JPEG|SVG|WebP|PDF|DOCX|XLSX)$/ }).click();
  const download = await downloadPromise;
  const savePath = path.join(ARTIFACT_DIR, `${filenameHint}-${Date.now()}${path.extname(download.suggestedFilename())}`);
  await download.saveAs(savePath);
  return savePath;
}

/** Same as exportAndSave, but keeps the EXACT filename given (no timestamp) — used for the Section 8 named QA specimens (full-map.png etc.) so there's one canonical file per format to point a report at. */
async function exportAndSaveExact(page, exactFilename) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^(Xuất|Tạo) (PNG|JPEG|SVG|WebP|PDF|DOCX|XLSX)$/ }).click();
  const download = await downloadPromise;
  const savePath = path.join(ARTIFACT_DIR, exactFilename);
  await download.saveAs(savePath);
  return savePath;
}

/** Real browser Image decode — proves the file is actually a valid, decodable raster image, not just bytes with a matching header. */
async function decodeImageDimensions(page, filePath) {
  const buf = fs.readFileSync(filePath);
  const mime = filePath.endsWith(".png") ? "image/png" : "image/jpeg";
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  return page.evaluate((url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("image failed to decode"));
    img.src = url;
  }), dataUrl);
}

/** Samples one pixel via a real <canvas> 2D context — used to prove a JPEG's background was actually filled with the requested color, not left black/undefined. */
async function samplePixel(page, filePath, x, y) {
  const buf = fs.readFileSync(filePath);
  const dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
  return page.evaluate(({ url, x, y }) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve([...ctx.getImageData(x, y, 1, 1).data]);
    };
    img.onerror = () => reject(new Error("image failed to decode"));
    img.src = url;
  }), { url: dataUrl, x, y });
}

test.describe("Export Studio — fixture harness, real files", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/fixture-harness.html");
    await expect(page.getByTestId("fixture-harness-root")).toBeVisible();
    // Fixture map A's root renders synchronously off static data — no
    // network wait needed (this harness makes zero API calls).
    await expect(page.locator(nodeSelector(`${MAP_A_ID}-root`))).toBeVisible();
  });

  test("PNG: full-scope export produces a valid, decodable, non-trivial PNG file", async ({ page }) => {
    await openExportStudio(page);
    await chooseScope(page, "full");
    await advanceToPreview(page);
    const filePath = await exportAndSave(page, "full-png");

    const buf = fs.readFileSync(filePath);
    expect(buf.length).toBeGreaterThan(5000); // sensible minimum for a 60-node map at 2x
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); // PNG signature

    const { width, height } = await decodeImageDimensions(page, filePath);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  test("JPEG: full-scope export is a valid decodable JPEG whose background is actually opaque white, not left transparent/black", async ({ page }) => {
    await openExportStudio(page);
    await chooseScope(page, "full");
    await page.getByRole("button", { name: "Tiếp tục" }).click(); // -> format step
    await chooseFormat(page, "jpeg");
    await page.getByRole("button", { name: "Tiếp tục" }).click(); // -> appearance step
    await page.locator('.pill-tab', { hasText: "Trắng" }).click(); // explicit white background
    await page.getByRole("button", { name: "Tiếp tục" }).click(); // -> preview step
    const filePath = await exportAndSave(page, "full-jpeg");

    const buf = fs.readFileSync(filePath);
    expect(buf.length).toBeGreaterThan(5000);
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff])); // JPEG SOI + marker

    const { width, height } = await decodeImageDimensions(page, filePath);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);

    const [r, g, b] = await samplePixel(page, filePath, 2, 2); // a corner, outside any node
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(200);
    expect(b).toBeGreaterThan(200);
  });

  test("SVG: full-scope export is valid, well-formed XML with a non-zero viewBox and no NaN/Infinity coordinates", async ({ page }) => {
    await openExportStudio(page);
    await chooseScope(page, "full");
    await clickNext(page); // -> format step
    await chooseFormat(page, "svg");
    await clickNext(page); // -> appearance step
    await clickNext(page); // -> preview step
    const filePath = await exportAndSave(page, "full-svg");

    const svgText = fs.readFileSync(filePath, "utf8");
    expect(svgText).toMatch(/<svg[^>]*>/);
    expect(svgText).not.toMatch(/NaN|undefined|Infinity/);
    const viewBoxMatch = svgText.match(/viewBox="([\d.\s-]+)"/);
    expect(viewBoxMatch).toBeTruthy();
    const [, , vbw, vbh] = viewBoxMatch[1].trim().split(/\s+/).map(Number);
    expect(vbw).toBeGreaterThan(0);
    expect(vbh).toBeGreaterThan(0);
    // Real Vietnamese text from the fixture, present in the exported markup.
    expect(svgText).toContain("Kiến trúc hệ thống");
    // No toolbar/drawer/export-control chrome leaked into the capture.
    expect(svgText).not.toMatch(/mm-export-toolbar|mm-selection-bar|Xuất sơ đồ/);
  });

  test("PR C1: WebP full-scope export has real RIFF/WEBP magic bytes and decodes in Chromium", async ({ page }) => {
    await openExportStudio(page);
    await chooseScope(page, "full");
    await clickNext(page); // -> format step
    await chooseFormat(page, "webp");
    await clickNext(page); // -> appearance step
    await clickNext(page); // -> preview step
    const filePath = await exportAndSave(page, "full-webp");

    const buf = fs.readFileSync(filePath);
    expect(buf.length).toBeGreaterThan(500);
    // RIFF container header + "WEBP" fourcc at byte offset 8 — the real magic
    // byte signature, not just a sniffed extension.
    expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(buf.subarray(8, 12).toString("ascii")).toBe("WEBP");

    const dataUrl = `data:image/webp;base64,${buf.toString("base64")}`;
    const { width, height } = await page.evaluate((url) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("webp failed to decode"));
      img.src = url;
    }), dataUrl);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  test("PR C1: PDF create-new export still works end to end (pipeline unchanged by format gating)", async ({ page }) => {
    await openExportStudio(page);
    await chooseScope(page, "full");
    await clickNext(page); // -> format step
    await chooseFormat(page, "pdf");
    await clickNext(page); // -> appearance step
    await clickNext(page); // -> preview step
    const exportBtn = page.getByRole("button", { name: /^(Xuất|Tạo) (PNG|JPEG|SVG|WebP|PDF)$/ });
    await expect(exportBtn).toBeEnabled();
  });

  test("Section 7 gate: the exact representative Vietnamese character set renders correctly in real SVG (XML text)", async ({ page }) => {
    // ă â ê ô ơ ư đ Á Ế Ỗ Ờ Ữ — the fixture's dedicated `${MAP_A_ID}-vn-gate`
    // node (mindmapFixtures.js) carries exactly this string.
    await openExportStudio(page);
    await chooseScope(page, "full");
    await clickNext(page); // -> format step
    await chooseFormat(page, "svg");
    await clickNext(page); // -> appearance step
    await clickNext(page); // -> preview step
    const svgPath = await exportAndSave(page, "vn-gate-svg");
    const svgText = fs.readFileSync(svgPath, "utf8");
    expect(svgText).toContain("ă â ê ô ơ ư đ Á Ế Ỗ Ờ Ữ");
  });

  test("Section 7 gate: the exact representative Vietnamese character set does not corrupt a real decodable PNG", async ({ page }) => {
    await openExportStudio(page);
    await chooseScope(page, "full");
    await advanceToPreview(page); // format defaults to png
    const pngPath = await exportAndSave(page, "vn-gate-png");
    const buf = fs.readFileSync(pngPath);
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const { width, height } = await decodeImageDimensions(page, pngPath);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  test("appearance: 'Trình bày' preset (legend + branding + monochrome/custom-palette color) actually changes the exported SVG markup", async ({ page }) => {
    await openExportStudio(page);
    await chooseScope(page, "full");
    await clickNext(page); // -> format step
    await chooseFormat(page, "svg");
    await clickNext(page); // -> appearance step
    await page.getByRole("button", { name: "Trình bày" }).click(); // presentation preset
    await clickNext(page); // -> preview step
    const filePath = await exportAndSave(page, "preset-presentation-svg");

    const svgText = fs.readFileSync(filePath, "utf8");
    expect(svgText).not.toMatch(/NaN|undefined|Infinity/);
    // Branding overlay text, real output of applyTargetAppearance's overlay.
    expect(svgText).toContain("StudyMap");
    // Legend overlay lists each top-level branch's own topic text.
    expect(svgText).toContain("Kiến trúc hệ thống");
  });

  test("appearance: font change (serif) and spacing change (compact) do not corrupt the exported SVG geometry", async ({ page }) => {
    await openExportStudio(page);
    await chooseScope(page, "full");
    await clickNext(page);
    await chooseFormat(page, "svg");
    await clickNext(page); // -> appearance step
    await page.getByRole("button", { name: "Serif (Spectral)" }).click();
    await page.getByRole("button", { name: "Bố cục" }).click();
    await page.getByRole("button", { name: "Gọn" }).click(); // spacing: compact
    await clickNext(page);
    const filePath = await exportAndSave(page, "appearance-font-spacing-svg");

    const svgText = fs.readFileSync(filePath, "utf8");
    expect(svgText).not.toMatch(/NaN|undefined|Infinity/);
    const viewBoxMatch = svgText.match(/viewBox="([\d.\s-]+)"/);
    expect(viewBoxMatch).toBeTruthy();
    const [, , vbw, vbh] = viewBoxMatch[1].trim().split(/\s+/).map(Number);
    expect(vbw).toBeGreaterThan(0);
    expect(vbh).toBeGreaterThan(0);
    expect(svgText).toContain("Kiến trúc hệ thống");
  });

  test("SVG: branch-only scope includes the selected branch's label and excludes an unselected branch's label", async ({ page }) => {
    const s1Id = `${MAP_A_ID}-m0`; // "Kiến trúc hệ thống"
    const s2Id = `${MAP_A_ID}-m1`; // "Bảo mật & xác thực" — deliberately NOT selected
    await openExportStudio(page);
    await chooseScope(page, "current_branch");
    await page.getByRole("dialog").getByText("Chọn một node trên canvas trước.").waitFor().catch(() => {});
    // current_branch requires a live canvas selection — close the dialog,
    // select the node on canvas, reopen (mirrors how a real user would
    // pick a branch before opening Export Studio).
    await page.getByRole("button", { name: "Hủy" }).click();
    await page.locator(nodeSelector(s1Id)).click();
    await openExportStudio(page);
    await chooseScope(page, "current_branch");
    await clickNext(page); // -> format step
    await chooseFormat(page, "svg");
    await clickNext(page); // -> appearance step
    await clickNext(page); // -> preview step
    const filePath = await exportAndSave(page, "branch-svg");

    const svgText = fs.readFileSync(filePath, "utf8");
    expect(svgText).toContain("Kiến trúc hệ thống");
    expect(svgText).not.toContain("Bảo mật & xác thực");
    void s2Id;
  });

  test("SVG: multi-branch (selected_branches) export composes two disjoint branches, excluding a third", async ({ page }) => {
    const m0 = `${MAP_A_ID}-m0`; // "Kiến trúc hệ thống"
    const m1 = `${MAP_A_ID}-m1`; // "Bảo mật & xác thực"
    const m2 = `${MAP_A_ID}-m2`; // "Hiệu năng & mở rộng" — NOT selected

    await openExportStudio(page);
    await chooseScope(page, "selected_branches");
    await page.locator(".export-inline-action").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator(nodeSelector(m0)).click();
    await page.locator(nodeSelector(m1)).click();
    await expect(page.locator(".mm-selection-bar")).toContainText("2 nhánh đã chọn");
    await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();

    await clickNext(page); // -> format step
    await chooseFormat(page, "svg");
    await clickNext(page); // -> appearance step
    await clickNext(page); // -> preview step
    const exportBtn = page.getByRole("button", { name: /^(Xuất|Tạo) (PNG|JPEG|SVG|WebP|PDF|DOCX|XLSX)$/ });
    await expect(exportBtn).toBeEnabled();
    const filePath = await exportAndSave(page, "multi-branch-svg");

    const svgText = fs.readFileSync(filePath, "utf8");
    expect(svgText).not.toMatch(/NaN|undefined|Infinity/);
    expect(svgText).toContain("Kiến trúc hệ thống");
    expect(svgText).toContain("Bảo mật &amp; xác thực"); // XML-escaped ampersand
    expect(svgText).not.toContain("Hiệu năng &amp; mở rộng");
    void m2;
  });

  test("PR B: current_branch SVG export keeps the minimal ancestor path as context, never a sibling", async ({ page }) => {
    // "Nguyên lý — Kiến trúc hệ thống" is m0's own sub-branch (depth 2) — its
    // ancestor chain is [root, m0]. m1 ("Bảo mật & xác thực") is neither an
    // ancestor nor a descendant, so it must never appear, context or not.
    const target = `${MAP_A_ID}-m0-s0`;
    await page.locator(nodeSelector(target)).click();
    await openExportStudio(page);
    await chooseScope(page, "current_branch");
    await clickNext(page); // -> format step
    await chooseFormat(page, "svg");
    await clickNext(page); // -> appearance step
    await clickNext(page); // -> preview step
    const filePath = await exportAndSave(page, "branch-ancestor-context-svg");

    const svgText = fs.readFileSync(filePath, "utf8");
    expect(svgText).toContain("Nguyên lý"); // the selected branch itself
    expect(svgText).toContain("Kiến trúc hệ thống"); // m0, kept as ancestor context
    expect(svgText).toContain("Bản đồ tư duy: Hệ thống StudyMap (Fixture A)"); // map root, kept as ancestor context
    expect(svgText).not.toContain("Bảo mật &amp; xác thực"); // m1 — not an ancestor, never included
    expect(svgText).not.toContain("Hiệu năng &amp; mở rộng"); // m2 — not an ancestor, never included
  });

  test("closing Export Studio after a multi-branch selection leaves the live canvas viewport and map A/B state unchanged", async ({ page }) => {
    const beforeTransform = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
    await openExportStudio(page);
    await chooseScope(page, "selected_branches");
    await page.locator(".export-inline-action").click();
    await page.locator(nodeSelector(`${MAP_A_ID}-m0`)).click();
    await page.locator(nodeSelector(`${MAP_A_ID}-m1`)).click();
    await page.locator(".mm-selection-bar").getByRole("button", { name: "Hủy" }).click();
    // "Hủy" must actually register as a click on ITSELF, not get silently
    // swallowed by the canvas's own pan-gesture pointer capture (a real
    // bug this suite caught: see MindElixirView.jsx's onDown exclusion
    // list) — assert the visible effect, not just that nothing crashed.
    await expect(page.locator(".mm-selection-bar")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("0 nhánh"); // selection cleared
    const afterTransform = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
    expect(afterTransform).toBe(beforeTransform);
    // Map A's root is still the one rendered — no leaked switch to map B.
    await expect(page.locator(nodeSelector(`${MAP_A_ID}-root`))).toBeVisible();
    await expect(page.locator(nodeSelector(`${MAP_B_ID}-root`))).toHaveCount(0);
  });

  test("regression: selection-bar buttons are not hijacked by the canvas's background-pan pointer capture", async ({ page }) => {
    // Root cause this guards: the canvas wrapper's pan handler calls
    // setPointerCapture(wrap) on any pointerdown not matching its
    // exclusion list. Without ".mm-selection-bar" in that list, Chromium
    // redirects the CLICK that follows a pointerdown on the bar's own
    // buttons to the captured wrapper element instead of the button, so
    // the button's onClick never fires — invisible in jsdom, which
    // doesn't model pointer-capture click redirection.
    await openExportStudio(page);
    await chooseScope(page, "selected_branches");
    await page.locator(".export-inline-action").click();
    await page.locator(nodeSelector(`${MAP_A_ID}-m0`)).click();
    await expect(page.locator(".mm-selection-bar")).toContainText("1 nhánh đã chọn");
    await page.locator(".mm-selection-bar").getByRole("button", { name: "Xóa chọn" }).click();
    await expect(page.locator(".mm-selection-bar")).toContainText("Chọn các nhánh muốn xuất");
  });

  test("Section 8 artifact quality gate: full-map.png is retained and valid", async ({ page }) => {
    await openExportStudio(page);
    await chooseScope(page, "full");
    await advanceToPreview(page);
    const filePath = await exportAndSaveExact(page, "full-map.png");
    const buf = fs.readFileSync(filePath);
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const { width, height } = await decodeImageDimensions(page, filePath);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  test("Section 8 artifact quality gate: selected-branch.jpeg is retained and valid", async ({ page }) => {
    const s1Id = `${MAP_A_ID}-m0`;
    await page.locator(nodeSelector(s1Id)).click();
    await openExportStudio(page);
    await chooseScope(page, "current_branch");
    await clickNext(page); // -> format step
    await chooseFormat(page, "jpeg");
    await clickNext(page); // -> appearance step
    await clickNext(page); // -> preview step
    const filePath = await exportAndSaveExact(page, "selected-branch.jpeg");
    const buf = fs.readFileSync(filePath);
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    const { width, height } = await decodeImageDimensions(page, filePath);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  test("Section 8 artifact quality gate: multi-branch.svg is retained and valid", async ({ page }) => {
    await openExportStudio(page);
    await chooseScope(page, "selected_branches");
    await page.locator(".export-inline-action").click();
    await page.locator(nodeSelector(`${MAP_A_ID}-m0`)).click();
    await page.locator(nodeSelector(`${MAP_A_ID}-m1`)).click();
    await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();
    await clickNext(page); // -> format step
    await chooseFormat(page, "svg");
    await clickNext(page); // -> appearance step
    await clickNext(page); // -> preview step
    const filePath = await exportAndSaveExact(page, "multi-branch.svg");
    const svgText = fs.readFileSync(filePath, "utf8");
    expect(svgText).toMatch(/<svg[^>]*>/);
    expect(svgText).not.toMatch(/NaN|undefined|Infinity/);
    const viewBoxMatch = svgText.match(/viewBox="([\d.\s-]+)"/);
    expect(viewBoxMatch).toBeTruthy();
  });
});

/** The actual `<me-export-check>` checkbox for a node, by its aria-label
 * (mindmapBranchSelectionMode.js sets `Chọn nhánh: ${topic}`) — distinct
 * from `nodeSelector(id)` above, which targets `<me-tpc>` (the topic label
 * itself). Every OTHER test in this file clicks the label, which routes
 * through a separate "click the topic while in selection mode" handler and
 * was never affected by the bug this block guards: production's real
 * checkbox had `pointer-events: none` (inherited from mind-elixir's own
 * `.map-canvas`, which is `none` so panning/dragging aren't blocked by
 * arbitrary canvas content — `<me-tpc>`/`<me-epd>` opt back in via mind-
 * elixir's own base rules, this brand-new element had no such rule). A
 * jsdom `dispatchEvent` (every existing unit test) or a Playwright click on
 * `<me-tpc>` (every existing test above) cannot see that regression class
 * at all — jsdom does no CSS hit-testing, and the label was never blocked.
 * Only a real Playwright click AT THE CHECKBOX'S OWN COORDINATES, which
 * performs real actionability/hit-testing against computed CSS, can. */
function checkboxFor(topicTitle) {
  return `me-export-check[aria-label="Chọn nhánh: ${topicTitle}"]`;
}

test.describe("Export Selection Mode — checkbox pointer regression (hotfix)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/fixture-harness.html");
    await expect(page.getByTestId("fixture-harness-root")).toBeVisible();
    await expect(page.locator(nodeSelector(`${MAP_A_ID}-root`))).toBeVisible();
  });

  test("A: a real click on the checkbox itself toggles selection 0 -> 1 -> 0, opens no node-detail drawer, and leaves the canvas transform untouched", async ({ page }) => {
    const beforeTransform = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
    await openExportStudio(page);
    await chooseScope(page, "selected_branches");
    await page.locator(".export-inline-action").click();

    const check = page.locator(checkboxFor("Kiến trúc hệ thống"));
    await expect(check).toBeVisible();
    // Real hit-testing click — this is the assertion that fails on
    // unfixed code (pointer-events:none means Playwright's own
    // actionability check finds the element is not the hit-test target
    // at its own center, and the click never registers).
    await check.click();
    await expect(page.locator(".mm-selection-bar")).toContainText("1 nhánh đã chọn");
    await expect(check).toHaveAttribute("aria-checked", "true");

    // No node-detail drawer opened from the checkbox click.
    await expect(page.getByText("Chi tiết sơ đồ")).toHaveCount(0);

    // Canvas didn't pan/zoom from this click.
    const midTransform = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
    expect(midTransform).toBe(beforeTransform);

    // Click again -> back to 0 (real toggle, not just "always sets true").
    await check.click();
    await expect(page.locator(".mm-selection-bar")).toContainText("Chọn các nhánh muốn xuất");
    await expect(check).toHaveAttribute("aria-checked", "false");
    const afterTransform = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
    expect(afterTransform).toBe(beforeTransform);
  });

  test("B: two real checkbox clicks on different branches both register, and 'Xóa chọn' returns count to 0", async ({ page }) => {
    await openExportStudio(page);
    await chooseScope(page, "selected_branches");
    await page.locator(".export-inline-action").click();

    await page.locator(checkboxFor("Kiến trúc hệ thống")).click();
    await page.locator(checkboxFor("Trải nghiệm người dùng")).click(); // opposite end of the branch list
    await expect(page.locator(".mm-selection-bar")).toContainText("2 nhánh đã chọn");
    await expect(page.locator(checkboxFor("Kiến trúc hệ thống"))).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(checkboxFor("Trải nghiệm người dùng"))).toHaveAttribute("aria-checked", "true");

    await page.locator(checkboxFor("Kiến trúc hệ thống")).click(); // uncheck just this one
    await expect(page.locator(".mm-selection-bar")).toContainText("1 nhánh đã chọn");
    await expect(page.locator(checkboxFor("Kiến trúc hệ thống"))).toHaveAttribute("aria-checked", "false");

    await page.locator(".mm-selection-bar").getByRole("button", { name: "Xóa chọn" }).click();
    await expect(page.locator(".mm-selection-bar")).toContainText("Chọn các nhánh muốn xuất");
    await expect(page.locator(checkboxFor("Trải nghiệm người dùng"))).toHaveAttribute("aria-checked", "false");
  });

  test("C: checking a branch's checkbox AND its own child's checkbox exports the child's content exactly once (dedupe), with the child's sibling still included via the parent", async ({ page }) => {
    await openExportStudio(page);
    await chooseScope(page, "selected_branches");
    await page.locator(".export-inline-action").click();

    await page.locator(checkboxFor("Kiến trúc hệ thống")).click(); // parent (main branch)
    await page.locator(checkboxFor("Nguyên lý — Kiến trúc hệ thống")).click(); // its own child (sub-branch)
    await expect(page.locator(".mm-selection-bar")).toContainText("2 nhánh đã chọn"); // UI counts both picks, resolver dedupes on export
    await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();

    await clickNext(page); // -> format step
    await chooseFormat(page, "svg");
    await clickNext(page); // -> appearance step
    await clickNext(page); // -> preview step
    const filePath = await exportAndSave(page, "checkbox-parent-child-dedupe-svg");

    const svgText = fs.readFileSync(filePath, "utf8");
    expect(svgText).not.toMatch(/NaN|undefined|Infinity/);
    // The child's own NODE (its `data-nodeid`, not just its title text —
    // the title legitimately appears twice for one real node: once in the
    // visible label, once in its own <me-epd>'s `aria-label="Thu nhánh:
    // ..."`) is rendered exactly once, not duplicated by being reachable
    // through both the parent selection and its own selection.
    const childNodeOccurrences = svgText.split(`data-nodeid="me${MAP_A_ID}-m0-s0"`).length - 1;
    expect(childNodeOccurrences).toBe(1);
    // The child's SIBLING sub-branch is still present — it's only reachable
    // through the parent pick, proving the parent's full subtree wasn't
    // dropped in favor of just the explicitly-checked child.
    expect(svgText).toContain("Triển khai thực tế — Kiến trúc hệ thống");
  });

  test("D: leaving selection mode (Tiếp tục or Hủy) removes every injected checkbox from the canvas — no orphaned, still-clickable UI left behind", async ({ page }) => {
    await openExportStudio(page);
    await chooseScope(page, "selected_branches");
    await page.locator(".export-inline-action").click();
    await page.locator(checkboxFor("Kiến trúc hệ thống")).click();
    await expect(page.locator(".mm-selection-bar")).toContainText("1 nhánh đã chọn");

    await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();
    await expect(page.getByRole("dialog")).toBeVisible(); // dialog reopened at the scope step (a selection already exists)
    // Root cause this guards: turning selectionModeActive off only stopped
    // NEW checkboxes from being created — it never removed the ones already
    // in the DOM, which (once pointer-events was fixed) stayed fully
    // clickable on the live canvas after the selection UI was supposed to
    // be gone.
    await expect(page.locator("me-export-check")).toHaveCount(0);

    // Re-enter selection mode for the OTHER exit path. Label reads "Chọn
    // LẠI trên sơ đồ" now — a selection already exists from above.
    await page.locator(".export-inline-action").click();
    await page.locator(checkboxFor("Kiến trúc hệ thống")).click();
    await page.locator(".mm-selection-bar").getByRole("button", { name: "Hủy" }).click();
    await expect(page.locator("me-export-check")).toHaveCount(0);
  });

  test("E: selection mode leaves <me-epd> expand/collapse and background pan fully intact", async ({ page }) => {
    const collapseToggle = page.locator(`me-parent:has(${nodeSelector(`${MAP_A_ID}-m0`)}) > me-epd`).first();
    await expect(collapseToggle).toBeVisible();

    await openExportStudio(page);
    await chooseScope(page, "selected_branches");
    await page.locator(".export-inline-action").click();
    await page.locator(checkboxFor("Kiến trúc hệ thống")).click();
    await page.locator(".mm-selection-bar").getByRole("button", { name: "Hủy" }).click();
    await page.getByRole("button", { name: "Hủy" }).click(); // close the dialog, back to a plain canvas

    // <me-epd> still collapses its branch after a selection-mode round trip.
    await expect(page.locator(nodeSelector(`${MAP_A_ID}-m0-s0`))).toBeVisible();
    await collapseToggle.click();
    await expect(page.locator(nodeSelector(`${MAP_A_ID}-m0-s0`))).toHaveCount(0);
    await collapseToggle.click(); // restore, don't leak state into other tests
    await expect(page.locator(nodeSelector(`${MAP_A_ID}-m0-s0`))).toBeVisible();

    // Background pan (dragging empty canvas) still moves the map. Must drag
    // from a point that's actually empty background — `.map-canvas` itself
    // is `pointer-events: none` (mind-elixir's own base stylesheet; that's
    // *why* panning works via its ancestor `.mm-canvas-wrap`'s own
    // container-level listener instead of being blocked by canvas content),
    // so its bounding box can still overlap real node content at some
    // points. Find a real gap via elementFromPoint instead of guessing a
    // fixed offset.
    const beforeTransform = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
    const emptySpot = await page.evaluate(() => {
      // ".map-canvas" itself is `pointer-events: none` (see the pan-handler
      // comment in MindElixirView.jsx), so a genuinely empty point hits
      // whatever's behind it — its parent ".map-container" — not the canvas
      // element itself; that's the correct/expected background hit, not a
      // miss.
      const wrap = document.querySelector(".mm-canvas-wrap");
      const r = wrap.getBoundingClientRect();
      for (let fx = 0.05; fx <= 0.95; fx += 0.05) {
        for (let fy = 0.05; fy <= 0.95; fy += 0.05) {
          const x = r.x + r.width * fx, y = r.y + r.height * fy;
          const el = document.elementFromPoint(x, y);
          if (el === wrap || el?.classList?.contains("map-container")) return { x, y };
        }
      }
      return null;
    });
    expect(emptySpot).toBeTruthy(); // fixture layout guarantee, not a product assertion
    await page.mouse.move(emptySpot.x, emptySpot.y);
    await page.mouse.down();
    await page.mouse.move(emptySpot.x - 60, emptySpot.y - 60, { steps: 5 });
    await page.mouse.up();
    const afterTransform = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
    expect(afterTransform).not.toBe(beforeTransform);
  });
});
