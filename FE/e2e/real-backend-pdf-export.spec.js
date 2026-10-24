import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  openMapLibrary,
  registerAndEnterApp,
  selectAllSources,
  uploadSampleDocument,
} from "./fixtures.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "..", "qa-artifacts", "real-backend-pdf-export");
const VERIFY = path.join(HERE, "verify-real-backend-pdf.py");

const TITLES = {
  ROOT: "ROOT — Kiểm chứng PDF tiếng Việt: Trí tuệ nhân tạo và dữ liệu",
  P: "Nhánh cha — Kết nối, màu sắc và hình học không bị cắt",
  A: "Đồng bộ hóa đa ngôn ngữ: ă â ê ô ơ ư đ Á Ế Ỗ Ờ Ữ",
  B: "Dữ liệu nguồn và bằng chứng có thể truy vết",
  C: "Hình học ổn định qua mọi khổ trang",
};

const APPEARANCE = {
  version: 2,
  preset: "default",
  overrides: {
    canvas: { background: "#FFFFFF", grid: "none" },
    node: {
      root: { shape: "roundedRect", fill: "#111827", textColor: "#FDE047", radius: 8 },
      branch: { shape: "roundedRect", fill: "#FEF3C7", textColor: "#1E3A8A", borderColor: "#D97706", borderWidth: 2, radius: 8 },
      leaf: { shape: "roundedRect", fill: "#DBEAFE", textColor: "#172554", borderColor: "#2563EB", borderWidth: 1, radius: 6 },
    },
    connector: { colorMode: "fixed", fixedColor: "#E11D48", thickness: "thick", style: "solid" },
  },
};

const NODES = [
  { id: "ROOT", parent: null, kind: "root", title: TITLES.ROOT, order: 0 },
  { id: "P", parent: "ROOT", kind: "section", title: TITLES.P, order: 0 },
  { id: "A", parent: "P", kind: "idea", title: TITLES.A, order: 0 },
  { id: "B", parent: "P", kind: "idea", title: TITLES.B, order: 1 },
  { id: "C", parent: "ROOT", kind: "section", title: TITLES.C, order: 1 },
];

function apiSession(page) {
  return page.evaluate(() => localStorage.getItem("memvid-token")).then((token) => {
    expect(token, "registration created a browser auth token").toBeTruthy();
    return {
      base: `http://127.0.0.1:${process.env.PORT || 8080}`,
      headers: { Authorization: `Bearer ${token}` },
    };
  });
}

async function sourceStem(request, api) {
  let stem = null;
  await expect.poll(async () => {
    const response = await request.get(`${api.base}/list-indexed`, { headers: api.headers });
    const body = await response.json();
    stem = body.sources.find((source) => String(source.filename || "").includes("sample-doc"))?.video_stem || null;
    return stem;
  }, { timeout: 20_000 }).not.toBeNull();
  return stem;
}

async function createRichMap(request, api) {
  const stem = await sourceStem(request, api);
  const generated = await request.post(`${api.base}/generate-mindmap`, {
    headers: api.headers,
    data: {
      sources: [stem],
      source_ids: [stem],
      q: `real PDF verification ${Date.now()}`,
      force: false,
    },
  });
  expect(generated.ok(), `POST /generate-mindmap -> ${generated.status()}`).toBeTruthy();
  const queued = await generated.json();
  let mapId = queued.result?.id || null;
  if (!mapId) {
    await expect.poll(async () => {
      const response = await request.get(`${api.base}/mindmap-status/${queued.job_id}`, { headers: api.headers });
      const body = await response.json();
      mapId = body.result?.id || null;
      return body.status;
    }, { timeout: 60_000, intervals: [250, 500, 1_000] }).toBe("done");
  }

  const title = `Real PDF verification ${Date.now()}`;
  const updated = await request.put(`${api.base}/mindmaps/${mapId}`, {
    headers: api.headers,
    data: { title, nodes: NODES, relations: [] },
  });
  expect(updated.ok(), `PUT /mindmaps/${mapId} -> ${updated.status()}`).toBeTruthy();
  const styled = await request.patch(`${api.base}/mindmaps/${mapId}/appearance`, {
    headers: api.headers,
    data: { appearance: APPEARANCE },
  });
  expect(styled.ok(), `PATCH appearance -> ${styled.status()}`).toBeTruthy();
  return { mapId, title };
}

async function openSeededMap(page, title) {
  await page.goto("/app");
  await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible" });
  const listbox = await openMapLibrary(page);
  await listbox.getByRole("option").filter({ hasText: title }).click();
  await page.locator('[data-nodeid="meROOT"]').waitFor({ state: "visible" });
  await expect(page.locator("me-tpc")).toHaveCount(NODES.length);
}

async function assertLiveTextInsideNodes(page) {
  return page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
    const host = document.querySelector(`[data-nodeid="me${id}"]`);
    const text = host?.querySelector(".text") || host;
    if (!host || !text) throw new Error(`missing rendered topic ${id}`);
    const box = host.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(text);
    const content = range.getBoundingClientRect();
    const overflow = {
      left: Math.max(0, box.left - content.left),
      top: Math.max(0, box.top - content.top),
      right: Math.max(0, content.right - box.right),
      bottom: Math.max(0, content.bottom - box.bottom),
    };
    return [id, {
      overflow,
      background: getComputedStyle(host).backgroundColor,
      color: getComputedStyle(host).color,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
    }];
  })), ["ROOT", "P"]);
}

async function exportPdf(page, scenario, liveMetrics) {
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="pdf"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  await page.getByRole("button", {
    name: scenario.mode === "map" ? "Chỉ sơ đồ" : "Sơ đồ + dàn ý",
  }).click();
  if (scenario.pageSize === "content_fit") {
    await page.getByRole("button", { name: "Vừa nội dung — Xem trên màn hình" }).click();
  }
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  const requestPromise = page.waitForRequest((request) => (
    request.method() === "POST" && /\/mindmaps\/[^/]+\/exports$/.test(new URL(request.url()).pathname)
  ));
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "Tạo PDF" }).click();
  const exportRequest = await requestPromise;
  const body = exportRequest.postDataJSON();
  const download = await downloadPromise;

  expect(body.options.mode).toBe(scenario.mode);
  expect(body.options.pageSize).toBe(scenario.pageSize);
  expect(body.map_image_base64, "real PDF request includes the Chromium map capture").toBeTruthy();
  expect(body.map_geometry_manifest, "real PDF request includes measured geometry").toBeTruthy();
  expect(body.map_geometry_manifest.nodes.map((node) => node.id).sort()).toEqual(Object.keys(TITLES).sort());
  expect(body.map_geometry_manifest.connectors.length).toBeGreaterThanOrEqual(NODES.length - 1);

  const scenarioDir = path.join(OUT, scenario.name);
  fs.mkdirSync(scenarioDir, { recursive: true });
  fs.writeFileSync(path.join(scenarioDir, "source.png"), Buffer.from(body.map_image_base64, "base64"));
  fs.writeFileSync(path.join(scenarioDir, "manifest.json"), JSON.stringify(body.map_geometry_manifest, null, 2));
  fs.writeFileSync(path.join(scenarioDir, "request.json"), JSON.stringify({ ...body, map_image_base64: "<saved as source.png>" }, null, 2));
  fs.writeFileSync(path.join(scenarioDir, "expectations.json"), JSON.stringify({
    ...scenario,
    titles: TITLES,
    liveMetrics,
    colors: {
      ROOT: { fill: "#111827", text: "#FDE047" },
      P: { fill: "#FEF3C7", text: "#1E3A8A" },
      connector: "#E11D48",
    },
  }, null, 2));
  await download.saveAs(path.join(scenarioDir, "artifact.pdf"));
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
}

test("real Flask/Postgres PDF exports preserve text, colors, Unicode and geometry", async ({ page, request }) => {
  test.setTimeout(300_000);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  await registerAndEnterApp(page);
  await uploadSampleDocument(page);
  await selectAllSources(page);
  const api = await apiSession(page);
  const seeded = await createRichMap(request, api);
  await openSeededMap(page, seeded.title);

  const liveMetrics = await assertLiveTextInsideNodes(page);
  for (const id of ["ROOT", "P"]) {
    expect(Math.max(...Object.values(liveMetrics[id].overflow)), `${id} live text is inside its visible node`).toBeLessThanOrEqual(1);
  }
  expect(liveMetrics.ROOT.background).toBe("rgb(17, 24, 39)");
  expect(liveMetrics.ROOT.color).toBe("rgb(253, 224, 71)");
  expect(liveMetrics.P.background).toBe("rgb(254, 243, 199)");
  expect(liveMetrics.P.color).toBe("rgb(30, 58, 138)");

  for (const scenario of [
    { name: "map-a4", mode: "map", pageSize: "A4" },
    { name: "map-content-fit", mode: "map", pageSize: "content_fit" },
    { name: "map-and-outline-content-fit", mode: "map_and_outline", pageSize: "content_fit" },
  ]) {
    await exportPdf(page, scenario, liveMetrics);
  }

  const verification = execFileSync("python", [VERIFY, OUT], { encoding: "utf8", timeout: 120_000 });
  fs.writeFileSync(path.join(OUT, "verification.json"), verification);
  const report = JSON.parse(verification);
  expect(report.status, JSON.stringify(report, null, 2)).toBe("PASS");
  expect(report.scenarios).toHaveLength(3);
});
