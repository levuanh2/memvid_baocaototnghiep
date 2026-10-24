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
const OUT = path.resolve(HERE, "..", "qa-artifacts", "real-backend-current-branch-appearance");
const VERIFY = path.join(HERE, "verify-real-backend-current-branch-appearance.py");
const CONNECTOR = "#2563EB";
const CANVAS = "#FFF7ED";

const NODES = [
  { id: "ROOT", parent: null, kind: "root", title: "ROOT — Kiểm chứng nhánh tùy biến", order: 0 },
  { id: "P", parent: "ROOT", kind: "section", title: "Nhánh được chọn — kết nối phải rõ", order: 0 },
  { id: "A", parent: "P", kind: "section", title: "Nút cha bên trong nhánh", order: 0 },
  { id: "A1", parent: "A", kind: "idea", title: "Tiếng Việt: ă â ê ô ơ ư đ Á Ế Ổ Ờ Ữ", order: 0 },
  { id: "B", parent: "P", kind: "idea", title: "Nút lá thứ hai", order: 1 },
  { id: "C", parent: "ROOT", kind: "section", title: "Nhánh không được xuất", order: 1 },
];
const EXPECTED_IDS = ["ROOT", "P", "A", "A1", "B"];
const EXPECTED_EDGES = [["ROOT", "P"], ["P", "A"], ["A", "A1"], ["P", "B"]];
test.use({ actionTimeout: 15_000 });
const APPEARANCE = {
  version: 2,
  preset: "default",
  overrides: {
    canvas: { background: CANVAS, grid: "none" },
    node: {
      root: { shape: "roundedRect", fill: "#1E3A8A", textColor: "#FFFFFF", radius: 10 },
      branch: { shape: "roundedRect", fill: "#FEF3C7", textColor: "#422006", borderColor: "#B45309", borderWidth: 2, radius: 8 },
      leaf: { shape: "roundedRect", fill: "#DCFCE7", textColor: "#14532D", borderColor: "#15803D", borderWidth: 1, radius: 6 },
    },
    connector: { colorMode: "fixed", fixedColor: CONNECTOR, thickness: "thick", style: "solid" },
  },
};

function apiSession(page) {
  return page.evaluate(() => localStorage.getItem("memvid-token")).then((token) => ({
    base: `http://127.0.0.1:${process.env.PORT || 8080}`,
    headers: { Authorization: `Bearer ${token}` },
  }));
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

async function seedMap(request, api) {
  const stem = await sourceStem(request, api);
  const generated = await request.post(`${api.base}/generate-mindmap`, {
    headers: api.headers,
    data: { sources: [stem], source_ids: [stem], q: `current branch appearance ${Date.now()}`, force: false },
  });
  expect(generated.ok()).toBeTruthy();
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

  const title = `Current branch custom appearance ${Date.now()}`;
  const updated = await request.put(`${api.base}/mindmaps/${mapId}`, {
    headers: api.headers,
    data: { title, nodes: NODES, relations: [] },
  });
  expect(updated.ok(), `PUT map -> ${updated.status()}`).toBeTruthy();
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
  await expect(page.locator("me-tpc")).toHaveCount(NODES.length);
  await page.locator('[data-nodeid="meP"]').click();
  const overlay = page.locator(".mindmap-tools-overlay");
  await overlay.locator(".study-surface-header button").click();
  await expect(overlay).toHaveCSS("opacity", "0");
}

async function openCurrentBranchExport(page) {
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  const scope = page.locator('input[name="mm-export-scope"][value="current_branch"]');
  await expect(scope).toBeChecked();
  await scope.check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
}

async function exportImage(page, format) {
  await openCurrentBranchExport(page);
  await page.locator(`input[name="mm-export-format"][value="${format}"]`).check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: `Xuất ${format.toUpperCase()}` }).click();
  const download = await waiting;
  const target = path.join(OUT, `current-branch.${format}`);
  await download.saveAs(target);
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  return target;
}

async function exportPdf(page) {
  await openCurrentBranchExport(page);
  await page.locator('input[name="mm-export-format"][value="pdf"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Chỉ sơ đồ" }).click();
  await page.getByRole("button", { name: "Vừa nội dung — Xem trên màn hình" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  const requestPromise = page.waitForRequest((request) => (
    request.method() === "POST" && /\/mindmaps\/[^/]+\/exports$/.test(new URL(request.url()).pathname)
  ));
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "Tạo PDF" }).click();
  const exportRequest = await requestPromise;
  const body = exportRequest.postDataJSON();
  const download = await downloadPromise;

  expect(body.scope.scope_type).toBe("current_branch");
  expect(body.scope.selected_node_id).toBe("P");
  expect(body.options.mode).toBe("map");
  expect(body.options.pageSize).toBe("content_fit");
  expect(body.map_geometry_manifest.nodes.map((node) => node.id).sort()).toEqual([...EXPECTED_IDS].sort());
  expect(body.map_geometry_manifest.connectors).toHaveLength(EXPECTED_EDGES.length);

  fs.writeFileSync(path.join(OUT, "pdf-source.png"), Buffer.from(body.map_image_base64, "base64"));
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(body.map_geometry_manifest, null, 2));
  fs.writeFileSync(path.join(OUT, "pdf-request.json"), JSON.stringify({ ...body, map_image_base64: "<saved as pdf-source.png>" }, null, 2));
  await download.saveAs(path.join(OUT, "current-branch.pdf"));
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
}

async function inspectSvg(page, svg) {
  await page.setContent(svg);
  return page.evaluate(({ edges, connectorHex }) => {
    const nodes = Object.fromEntries([...document.querySelectorAll("me-tpc[data-nodeid]")].map((topic) => {
      const rect = topic.getBoundingClientRect();
      return [(topic.dataset.nodeid || "").replace(/^me/, ""), { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }];
    }));
    const paths = [...document.querySelectorAll("svg.lines path, svg.subLines path")].map((pathElement, index) => {
      const length = pathElement.getTotalLength();
      const matrix = pathElement.getScreenCTM();
      const point = (position) => {
        const local = pathElement.getPointAtLength(position);
        const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
        return { x: screen.x, y: screen.y };
      };
      const style = getComputedStyle(pathElement);
      return { index, start: point(0), end: point(length), stroke: style.stroke, strokeWidth: style.strokeWidth, opacity: style.opacity };
    });
    const distance = (point, rect) => Math.hypot(
      Math.max(rect.left - point.x, 0, point.x - rect.right),
      Math.max(rect.top - point.y, 0, point.y - rect.bottom),
    );
    const edgeMetrics = edges.map(([parentId, childId]) => {
      const candidates = paths.map((connector) => {
        const forward = [distance(connector.start, nodes[parentId]), distance(connector.end, nodes[childId])];
        const reverse = [distance(connector.end, nodes[parentId]), distance(connector.start, nodes[childId])];
        const gaps = Math.max(...forward) <= Math.max(...reverse) ? forward : reverse;
        return { pathIndex: connector.index, parentGap: gaps[0], childGap: gaps[1], maxGap: Math.max(...gaps) };
      }).sort((a, b) => a.maxGap - b.maxGap);
      return { parentId, childId, ...candidates[0] };
    });
    const probe = document.createElement("span");
    probe.style.color = connectorHex;
    document.body.appendChild(probe);
    const expectedStroke = getComputedStyle(probe).color;
    probe.remove();
    return { nodes, paths, edgeMetrics, expectedStroke };
  }, { edges: EXPECTED_EDGES, connectorHex: CONNECTOR });
}

test("real backend current_branch custom appearance preserves visible connectors in SVG, PNG and PDF", async ({ page, request }) => {
  test.setTimeout(300_000);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  await registerAndEnterApp(page);
  await uploadSampleDocument(page);
  await selectAllSources(page);
  const seeded = await seedMap(request, await apiSession(page));
  await openSeededMap(page, seeded.title);

  const live = await page.evaluate(() => ({
    connectorStrokes: [...document.querySelectorAll("svg.lines path, svg.subLines path")].map((pathElement) => getComputedStyle(pathElement).stroke),
    canvas: getComputedStyle(document.querySelector(".map-canvas")).backgroundColor,
  }));
  expect(live.connectorStrokes).toContain("rgb(37, 99, 235)");

  const svgPath = await exportImage(page, "svg");
  const pngPath = await exportImage(page, "png");
  await exportPdf(page);

  const svg = fs.readFileSync(svgPath, "utf8");
  const ids = [...svg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1]);
  expect(ids.sort()).toEqual([...EXPECTED_IDS].sort());
  expect(ids).not.toContain("C");
  const svgEvidence = await inspectSvg(page, svg);
  expect(svgEvidence.paths).toHaveLength(EXPECTED_EDGES.length);
  expect(new Set(svgEvidence.edgeMetrics.map((edge) => edge.pathIndex)).size).toBe(EXPECTED_EDGES.length);
  for (const pathEvidence of svgEvidence.paths) {
    expect(pathEvidence.stroke).toBe(svgEvidence.expectedStroke);
    expect(Number.parseFloat(pathEvidence.strokeWidth)).toBeGreaterThanOrEqual(3);
  }
  for (const edge of svgEvidence.edgeMetrics) {
    expect(edge.maxGap, `${edge.parentId} -> ${edge.childId}`).toBeLessThanOrEqual(8);
  }
  fs.writeFileSync(path.join(OUT, "svg-evidence.json"), JSON.stringify({ ids, ...svgEvidence }, null, 2));
  await page.screenshot({ path: path.join(OUT, "rendered-svg.png"), fullPage: true });

  fs.writeFileSync(path.join(OUT, "expectations.json"), JSON.stringify({
    connector: CONNECTOR,
    canvas: CANVAS,
    expectedIds: EXPECTED_IDS,
    expectedEdges: EXPECTED_EDGES,
    directPng: path.basename(pngPath),
  }, null, 2));
  const verification = execFileSync("python", [VERIFY, OUT], { encoding: "utf8", timeout: 120_000 });
  fs.writeFileSync(path.join(OUT, "verification.json"), verification);
  const report = JSON.parse(verification);
  expect(report.status, JSON.stringify(report, null, 2)).toBe("PASS");
});
