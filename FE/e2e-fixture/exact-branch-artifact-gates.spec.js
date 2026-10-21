import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = path.join(__dirname, "..", "qa-artifacts", "exact-node-v2");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const MAP_ID = "fixture-map-a";
const ROOT = `${MAP_ID}-root`;
const P = `${MAP_ID}-m0`;
const A = `${P}-s0`;
const B = `${P}-s1`;
const C = `${P}-s2`;

const marker = (id) => `me-export-check[data-node-id="${id}"]`;

async function openSelectionAt69(page) {
  await page.goto("/fixture-harness.html");
  await expect(page.getByTestId("fixture-harness-root")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);
  await page.evaluate(() => window.__STUDYMAP_FIXTURE__.mind.scale(0.69));
  await expect.poll(() => page.evaluate(() => window.__STUDYMAP_FIXTURE__.mind.scaleVal)).toBeCloseTo(0.69, 5);
  await expect(page.locator(".mm-floating-toolbar button").nth(1)).toContainText("69%");

  await page.locator('[aria-label="Xuất sơ đồ"]').click();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await page.locator(".export-inline-action").click();
  await expect(page.locator(marker(A))).toBeVisible();
}

async function pickExactSiblings(page, { overlap = false } = {}) {
  await page.locator(marker(A)).click();
  await page.locator(marker(B)).click();
  await expect(page.locator(".mm-selection-bar")).toContainText("2 node đã tick");
  await expect(page.locator(marker(A))).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(marker(B))).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(marker(P))).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(marker(C))).toHaveAttribute("aria-checked", "false");

  if (!overlap) return;

  // Put B's 40px host above A's visible dot. The click point remains inside
  // A's 20px dot, but outside B's dot, while B's overlapping host receives
  // the browser hit. This is the exact low-zoom overlap that used to promote
  // a child click to a neighbouring/parent marker by centre proximity.
  const point = await page.evaluate(({ a, b }) => {
    const aHost = document.querySelector(a);
    const bHost = document.querySelector(b);
    const aDot = aHost.querySelector(".mm-export-check__dot");
    const ar = aDot.getBoundingClientRect();
    const br = bHost.getBoundingClientRect();
    const desiredCenterX = ar.left + ar.width / 2 + 11;
    const desiredCenterY = ar.top + ar.height / 2;
    const scale = window.__STUDYMAP_FIXTURE__.mind.scaleVal;
    bHost.style.transform = `translate(${(desiredCenterX - (br.left + br.width / 2)) / scale}px, ${(desiredCenterY - (br.top + br.height / 2)) / scale}px)`;
    bHost.style.zIndex = "999";
    const moved = bHost.getBoundingClientRect();
    const x = ar.left + 2;
    const y = ar.top + ar.height / 2;
    return {
      x, y,
      hostsOverlap: !(moved.right < ar.left || moved.left > ar.right || moved.bottom < ar.top || moved.top > ar.bottom),
    };
  }, { a: marker(A), b: marker(B) });
  expect(point.hostsOverlap).toBe(true);

  await page.mouse.click(point.x, point.y);
  await expect(page.locator(marker(A))).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(marker(B))).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(marker(P))).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(marker(C))).toHaveAttribute("aria-checked", "false");
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(marker(A))).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(marker(B))).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".mm-selection-bar")).toContainText("2 node đã tick");
}

async function continueFromSelection(page) {
  await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();
}

async function chooseFormatAndPreview(page, format) {
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator(`input[name="mm-export-format"][value="${format}"]`).check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
}

async function download(page, exactName) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: /^(Xuất|Tạo) (PNG|SVG)$/ }).click();
  const item = await waiting;
  const output = path.join(ARTIFACT_DIR, exactName);
  await item.saveAs(output);
  return output;
}

async function imageDimensions(page, filePath) {
  const data = fs.readFileSync(filePath).toString("base64");
  return page.evaluate((src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = `data:image/png;base64,${src}`;
  }), data);
}

test("Gate 1: Chromium 69% keeps exact A/B marker selection through overlapping edge toggles and real SVG/PNG", async ({ page }) => {
  await openSelectionAt69(page);
  await pickExactSiblings(page, { overlap: true });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "gate1-selection-69-overlap.png"), fullPage: true });
  await continueFromSelection(page);
  await chooseFormatAndPreview(page, "svg");
  const svgPath = await download(page, "gate1-selected-ab.svg");
  const svg = fs.readFileSync(svgPath, "utf8");
  expect(svg).not.toContain(`data-nodeid="me${ROOT}"`);
  expect(svg).toContain(`data-nodeid="me${P}"`);
  expect(svg).toContain(`data-nodeid="me${A}"`);
  expect(svg).toContain(`data-nodeid="me${B}"`);
  expect(svg).not.toContain(`data-nodeid="me${A}-l0"`);
  expect(svg).not.toContain(`data-nodeid="me${B}-l0"`);
  expect(svg).not.toContain(`data-nodeid="me${C}"`);
  const viewBox = svg.match(/viewBox="([\d.\s-]+)"/);
  expect(viewBox).toBeTruthy();
  const [, , svgWidth, svgHeight] = viewBox[1].trim().split(/\s+/).map(Number);
  expect(svgWidth).toBeGreaterThan(0);
  expect(svgHeight).toBeGreaterThan(0);

  await openSelectionAt69(page);
  await pickExactSiblings(page);
  await continueFromSelection(page);
  await chooseFormatAndPreview(page, "png");
  const pngPath = await download(page, "gate1-selected-ab.png");
  const selectedSize = await imageDimensions(page, pngPath);
  expect(selectedSize.width).toBeGreaterThan(0);
  expect(selectedSize.height).toBeGreaterThan(0);

  await page.goto("/fixture-harness.html");
  await expect(page.getByTestId("fixture-harness-root")).toBeVisible();
  await page.locator('[aria-label="Xuất sơ đồ"]').click();
  await page.locator('input[name="mm-export-scope"][value="full"]').check();
  await chooseFormatAndPreview(page, "png");
  const fullPath = await download(page, "gate1-full-reference.png");
  const fullSize = await imageDimensions(page, fullPath);
  const areaRatio = (selectedSize.width * selectedSize.height) / (fullSize.width * fullSize.height);
  expect(areaRatio).toBeLessThan(0.65);
  fs.writeFileSync(path.join(ARTIFACT_DIR, "gate1-image-metadata.json"), JSON.stringify({
    selectedSize, fullSize, areaRatio, svgViewBox: [svgWidth, svgHeight],
  }, null, 2));
});

async function capturePdfRequest(page, mode, pageSize = "A4") {
  let requestBody;
  await page.unrouteAll({ behavior: "wait" });
  await page.route("**/mindmaps/*/exports", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ job_id: `gate-${mode}`, status: "queued" }) });
  });
  await page.route(`**/mindmaps/exports/gate-${mode}`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ job_id: `gate-${mode}`, status: "done", progress: 100, result: { node_count: 4 } }),
  }));

  await openSelectionAt69(page);
  // At 69% a deep-left marker can sit under the fixed map selector. Keyboard
  // activation is the real accessible checkbox path and remains deterministic
  // without bypassing the component event handler with a forced pointer click.
  for (const nodeId of [A, B, `${A}-l0`]) {
    const checkbox = page.locator(marker(nodeId));
    await checkbox.focus();
    await checkbox.press("Space");
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
  }
  await expect(page.locator(".mm-selection-bar")).toContainText("3 node đã tick");
  await continueFromSelection(page);
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="pdf"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  const modeButton = page.locator("[data-testid=doc-appearance] .export-control").filter({ hasText: "Chế độ" })
    .locator("button", { hasText: mode === "map" ? "Chỉ sơ đồ" : "Sơ đồ + dàn ý" });
  await modeButton.click();
  if (pageSize === "content_fit") {
    const contentFit = page.getByRole("button", { name: "Vừa nội dung — Xem trên màn hình" });
    await contentFit.click();
    await expect(contentFit).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "A4 — In tài liệu" })).toHaveAttribute("aria-pressed", "false");
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "h4-content-fit-option.png"), fullPage: true });
  }
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tạo PDF" }).click();
  await expect.poll(() => Boolean(requestBody), { timeout: 30_000 }).toBe(true);

  expect({ ...requestBody.scope, selected_branch_root_ids: [...requestBody.scope.selected_branch_root_ids].sort() }).toEqual({
    scope_type: "selected_branches",
    selected_node_id: null,
    selected_branch_root_ids: [A, `${A}-l0`, B].sort(),
    include_descendants: false,
  });
  expect(requestBody.scope.selected_branch_root_ids).not.toContain(P);
  expect(requestBody.options.mode).toBe(mode);
  expect(requestBody.options.pageSize).toBe(pageSize);
  expect(requestBody.map_image_base64.length).toBeGreaterThan(5_000);
  expect(requestBody.map_geometry_manifest.nodes.map((node) => node.id).sort()).toEqual([
    P, A, `${A}-l0`, B,
  ].sort());
  expect(requestBody.map_geometry_manifest.nodes.some((node) => node.id === ROOT)).toBe(false);
  expect(requestBody.map_geometry_manifest.nodes.some((node) => node.id === C)).toBe(false);

  const base = path.join(ARTIFACT_DIR, `gate2-${mode}-${pageSize}`);
  fs.writeFileSync(`${base}-source.png`, Buffer.from(requestBody.map_image_base64, "base64"));
  fs.writeFileSync(`${base}-request.json`, JSON.stringify(requestBody, null, 2));
  fs.writeFileSync(`${base}-manifest.json`, JSON.stringify(requestBody.map_geometry_manifest, null, 2));
  return requestBody;
}

test("Gate 2 capture: map and map_and_outline requests carry the exact Chromium PNG and scoped geometry", async ({ page }) => {
  const map = await capturePdfRequest(page, "map");
  const combined = await capturePdfRequest(page, "map_and_outline");
  expect(combined.scope).toEqual(map.scope);
  expect(combined.map_geometry_manifest.nodes.map((node) => node.id).sort())
    .toEqual(map.map_geometry_manifest.nodes.map((node) => node.id).sort());
});

test("H4: Chromium sends content_fit with the same exact scoped PNG and geometry", async ({ page }) => {
  const request = await capturePdfRequest(page, "map_and_outline", "content_fit");
  expect(request.options.pageSize).toBe("content_fit");
  expect(request.map_geometry_manifest.nodes.map((node) => node.id).sort()).toEqual([
    P, A, `${A}-l0`, B,
  ].sort());
});

test("H4 UX: outline explains its intentional A4 fallback and cannot retain content_fit", async ({ page }) => {
  await page.goto("/fixture-harness.html");
  await expect(page.getByTestId("fixture-harness-root")).toBeVisible();
  await page.getByLabel("Xuất sơ đồ").click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="pdf"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  const contentFit = page.getByRole("button", { name: "Vừa nội dung — Xem trên màn hình" });
  const a4 = page.getByRole("button", { name: "A4 — In tài liệu" });
  await expect(page.getByText("“Vừa nội dung” chỉ áp dụng cho trang sơ đồ; khi chọn “Chỉ dàn ý”, khổ này chuyển về A4.")).toBeVisible();
  await expect(contentFit).toBeDisabled();
  await expect(a4).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Chỉ sơ đồ" }).click();
  await expect(contentFit).toBeEnabled();
  await contentFit.click();
  await expect(contentFit).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Chỉ dàn ý" }).click();
  await expect(contentFit).toBeDisabled();
  await expect(a4).toHaveAttribute("aria-pressed", "true");
});
