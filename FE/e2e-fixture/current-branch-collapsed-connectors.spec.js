import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "qa-artifacts", "current-branch-collapsed-connectors");
const MAP = "fixture-map-a";
const TARGET = `${MAP}-m2`;
const nodeSelector = (id) => `[data-nodeid="me${id}"]`;

async function exportCurrentBranchSvg(page, target = TARGET, filename = "current-branch-m2-collapsed.svg") {
  await page.locator(nodeSelector(target)).click();
  await page.locator('[aria-label="Xuất sơ đồ"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator('input[name="mm-export-scope"][value="current_branch"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="svg"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất SVG" }).click();
  const download = await waiting;
  const svgPath = path.join(OUT, filename);
  await download.saveAs(svgPath);
  return { svgPath, svg: fs.readFileSync(svgPath, "utf8") };
}

async function inspectTopology(page, svg, expectedEdges) {
  await page.setContent(svg);
  return page.evaluate((edges) => {
    const nodes = Object.fromEntries([...document.querySelectorAll("me-tpc[data-nodeid]")].map((topic) => {
      const rect = topic.getBoundingClientRect();
      return [(topic.dataset.nodeid || "").replace(/^me/, ""), {
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      }];
    }));
    const paths = [...document.querySelectorAll("svg.lines path, svg.subLines path")].map((connector, index) => {
      const length = connector.getTotalLength();
      const matrix = connector.getScreenCTM();
      const screenPoint = (position) => {
        const local = connector.getPointAtLength(position);
        const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
        return { x: screen.x, y: screen.y };
      };
      return { index, d: connector.getAttribute("d"), start: screenPoint(0), end: screenPoint(length) };
    });
    const distanceToRect = (point, rect) => {
      const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
      const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
      return Math.hypot(dx, dy);
    };
    const edgeMetrics = edges.map(([parentId, childId]) => {
      const parent = nodes[parentId];
      const child = nodes[childId];
      const candidates = paths.map((connector) => {
        const forward = [distanceToRect(connector.start, parent), distanceToRect(connector.end, child)];
        const reverse = [distanceToRect(connector.end, parent), distanceToRect(connector.start, child)];
        const gaps = Math.max(...forward) <= Math.max(...reverse) ? forward : reverse;
        return { pathIndex: connector.index, d: connector.d, parentGap: gaps[0], childGap: gaps[1], maxGap: Math.max(...gaps) };
      }).sort((a, b) => a.maxGap - b.maxGap);
      return { parentId, childId, ...candidates[0] };
    });
    return { nodes, paths, edgeMetrics };
  }, expectedEdges);
}

test("current_branch SVG reconnects a previously-collapsed subtree at its capture boundary", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto("/fixture-harness.html");
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);

  // m2 is pre-collapsed by FixtureHarnessApp. Its grandchildren are absent
  // from the live DOM before export, so this exercises force-expand/re-layout
  // rather than merely capturing an already-expanded branch.
  await expect(page.locator(nodeSelector(TARGET))).toBeVisible();
  await expect(page.locator(nodeSelector(`${TARGET}-s0`))).toHaveCount(0);
  await page.screenshot({ path: path.join(OUT, "before-export-collapsed.png"), fullPage: true });

  const { svgPath, svg } = await exportCurrentBranchSvg(page);
  const ids = [...svg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1]);
  const idSet = new Set(ids);
  const expectedEdges = [];
  if (idSet.has(`${MAP}-root`)) expectedEdges.push([`${MAP}-root`, TARGET]);
  for (let sub = 0; sub < 3; sub += 1) {
    const subId = `${TARGET}-s${sub}`;
    expectedEdges.push([TARGET, subId]);
    for (let leaf = 0; leaf < 3; leaf += 1) expectedEdges.push([subId, `${subId}-l${leaf}`]);
  }
  expectedEdges.push([`${TARGET}-s1`, `${MAP}-extra4`]);

  expect(idSet, "forceExpandAll must include a descendant hidden before export").toContain(`${TARGET}-s0-l0`);
  expect(idSet, "current_branch must not leak a sibling branch").not.toContain(`${MAP}-m1`);

  const topology = await inspectTopology(page, svg, expectedEdges);
  await page.screenshot({ path: path.join(OUT, "exported-current-branch.png"), fullPage: true });
  fs.writeFileSync(path.join(OUT, "connector-evidence.json"), JSON.stringify({ svgPath, ids, expectedEdges, topology }, null, 2));

  expect(topology.paths, "one tree connector per non-root rendered node").toHaveLength(expectedEdges.length);
  for (const edge of topology.edgeMetrics) {
    expect(edge.maxGap, `${edge.parentId} -> ${edge.childId} must reach both rendered node boxes`).toBeLessThanOrEqual(8);
  }
});

test("current_branch SVG keeps both ancestor connectors when a depth-2 collapsed target is force-expanded", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto("/fixture-harness.html");
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);

  const deepTarget = `${TARGET}-s0`;
  await page.evaluate((parentId) => {
    const mind = window.__STUDYMAP_FIXTURE__.mind;
    mind.expandNode(mind.findEle(parentId), true);
  }, TARGET);
  await expect(page.locator(nodeSelector(deepTarget))).toBeVisible();
  await expect(page.locator(nodeSelector(`${deepTarget}-l0`))).toHaveCount(0);

  const { svgPath, svg } = await exportCurrentBranchSvg(page, deepTarget, "current-branch-m2-s0-collapsed.svg");
  const ids = [...svg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1]);
  const expectedEdges = [
    [`${MAP}-root`, TARGET],
    [TARGET, deepTarget],
    ...[0, 1, 2].map((leaf) => [deepTarget, `${deepTarget}-l${leaf}`]),
  ];
  const topology = await inspectTopology(page, svg, expectedEdges);
  await page.screenshot({ path: path.join(OUT, "exported-depth-2-current-branch.png"), fullPage: true });
  fs.writeFileSync(path.join(OUT, "depth-2-connector-evidence.json"), JSON.stringify({ svgPath, ids, expectedEdges, topology }, null, 2));

  expect(ids.sort()).toEqual([
    `${MAP}-root`, TARGET, deepTarget,
    `${deepTarget}-l0`, `${deepTarget}-l1`, `${deepTarget}-l2`,
  ].sort());
  expect(topology.paths).toHaveLength(expectedEdges.length);
  for (const edge of topology.edgeMetrics) {
    expect(edge.maxGap, `${edge.parentId} -> ${edge.childId} must reach both rendered node boxes`).toBeLessThanOrEqual(8);
  }
});

test("current_branch SVG keeps boundary connectors for a collapsed target on the opposite map side", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto("/fixture-harness.html");
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);

  const branch = `${MAP}-m0`;
  const deepTarget = `${branch}-s0`;
  await page.evaluate((targetId) => {
    const mind = window.__STUDYMAP_FIXTURE__.mind;
    mind.expandNode(mind.findEle(targetId), false);
  }, deepTarget);
  await expect(page.locator(nodeSelector(deepTarget))).toBeVisible();
  await expect(page.locator(nodeSelector(`${deepTarget}-l0`))).toHaveCount(0);

  const { svgPath, svg } = await exportCurrentBranchSvg(page, deepTarget, "current-branch-m0-s0-collapsed.svg");
  const ids = [...svg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1]);
  const expectedEdges = [
    [`${MAP}-root`, branch],
    [branch, deepTarget],
    ...[0, 1, 2].map((leaf) => [deepTarget, `${deepTarget}-l${leaf}`]),
    [deepTarget, `${MAP}-extra0`],
  ];
  const topology = await inspectTopology(page, svg, expectedEdges);
  await page.screenshot({ path: path.join(OUT, "exported-opposite-side-current-branch.png"), fullPage: true });
  fs.writeFileSync(path.join(OUT, "opposite-side-connector-evidence.json"), JSON.stringify({ svgPath, ids, expectedEdges, topology }, null, 2));

  expect(topology.paths).toHaveLength(expectedEdges.length);
  for (const edge of topology.edgeMetrics) {
    expect(edge.maxGap, `${edge.parentId} -> ${edge.childId} must reach both rendered node boxes`).toBeLessThanOrEqual(8);
  }
});

test("legacy no-record current_branch SVG includes connectors for a force-expanded subtree", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto("/fixture-harness.html");
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);
  await expect(page.locator(nodeSelector(`${TARGET}-s0`))).toHaveCount(0);

  // ExportStudioDialog always supplies `record`, but exportMindmapImage keeps
  // a public no-record fallback for live-DOM callers. Exercise that path with
  // the real Mind Elixir instance and real SnapDOM download: its capture
  // target is the branch's ME-WRAPPER rather than the complete mind.map.
  const waiting = page.waitForEvent("download");
  const exporting = page.evaluate(async ({ target }) => {
    const { exportMindmapImage } = await import("/src/utils/mindmapImageExport.js");
    await exportMindmapImage({
      mind: window.__STUDYMAP_FIXTURE__.mind,
      scopeType: "current_branch",
      targetNodeId: target,
      format: "svg",
      backgroundColor: "#ffffff",
      scale: 2,
      quality: 1,
      title: "legacy-current-branch-no-record",
      settleMs: 30,
    });
  }, { target: TARGET });
  const download = await waiting;
  await exporting;
  const svgPath = path.join(OUT, "legacy-current-branch-no-record.svg");
  await download.saveAs(svgPath);
  const svg = fs.readFileSync(svgPath, "utf8");

  const ids = [...svg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1]);
  const expectedEdges = [];
  for (let sub = 0; sub < 3; sub += 1) {
    const subId = `${TARGET}-s${sub}`;
    expectedEdges.push([TARGET, subId]);
    for (let leaf = 0; leaf < 3; leaf += 1) expectedEdges.push([subId, `${subId}-l${leaf}`]);
  }
  expectedEdges.push([`${TARGET}-s1`, `${MAP}-extra4`]);

  const topology = await inspectTopology(page, svg, expectedEdges);
  await page.screenshot({ path: path.join(OUT, "legacy-current-branch-no-record.png"), fullPage: true });
  fs.writeFileSync(path.join(OUT, "legacy-no-record-evidence.json"), JSON.stringify({ svgPath, ids, expectedEdges, topology }, null, 2));

  expect(ids).toContain(`${TARGET}-s0-l0`);
  expect(topology.paths, "one connector per force-expanded descendant edge").toHaveLength(expectedEdges.length);
  for (const edge of topology.edgeMetrics) {
    expect(edge.maxGap, `${edge.parentId} -> ${edge.childId} must reach both rendered node boxes`).toBeLessThanOrEqual(8);
  }
});
