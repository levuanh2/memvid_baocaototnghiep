import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "qa-artifacts", "multi-branch-export-connectors");
const marker = (id) => `me-export-check[data-node-id="${id}"]`;

async function installOffscreenGeometryTrace(page) {
  await page.evaluate(() => {
    const mind = window.__STUDYMAP_FIXTURE__.mind;
    const proto = Object.getPrototypeOf(mind);
    const originalLinkDiv = proto.linkDiv;
    const originalScaleFit = proto.scaleFit;
    const trace = [];

    const distanceToRect = (point, rect) => {
      const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
      const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
      return Math.hypot(dx, dy);
    };
    const snapshot = (instance, event) => {
      if (!instance.map?.closest?.(".mm-export-offscreen")) return;
      const nodes = Object.fromEntries([...instance.map.querySelectorAll("me-tpc[data-nodeid]")].map((topic) => {
        const rect = topic.getBoundingClientRect();
        return [(topic.dataset.nodeid || "").replace(/^me/, ""), {
          left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        }];
      }));
      const paths = [...instance.map.querySelectorAll("svg.lines path, svg.subLines path")].map((connector) => {
        const length = connector.getTotalLength();
        const matrix = connector.getScreenCTM();
        const point = (at) => {
          const local = connector.getPointAtLength(at);
          const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
          return { x: screen.x, y: screen.y };
        };
        return { d: connector.getAttribute("d"), start: point(0), end: point(length) };
      });
      const nearestEndpointDistance = Object.fromEntries(Object.entries(nodes).map(([id, rect]) => [
        id,
        Math.min(...paths.flatMap((connector) => [
          distanceToRect(connector.start, rect), distanceToRect(connector.end, rect),
        ]), Number.POSITIVE_INFINITY),
      ]));
      trace.push({
        event,
        scaleVal: instance.scaleVal,
        transform: instance.map.style.transform,
        container: (() => {
          const rect = instance.map.parentElement.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        })(),
        nodes,
        paths,
        nearestEndpointDistance,
      });
    };

    proto.linkDiv = function tracedLinkDiv(...args) {
      const result = originalLinkDiv.apply(this, args);
      snapshot(this, "after-linkDiv");
      return result;
    };
    proto.scaleFit = function tracedScaleFit(...args) {
      snapshot(this, "before-scaleFit");
      const result = originalScaleFit.apply(this, args);
      snapshot(this, "after-scaleFit");
      return result;
    };
    window.__MULTI_BRANCH_CONNECTOR_TRACE__ = trace;
  });
}

async function exportMixedBranchSvg(page, ids) {
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await page.locator(".export-inline-action").click();
  for (const id of ids) {
    await page.locator(marker(id)).focus();
    await page.locator(marker(id)).press("Space");
    await expect(page.locator(marker(id))).toHaveAttribute("aria-checked", "true");
  }
  await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="svg"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất SVG" }).click();
  const download = await waiting;
  const svgPath = path.join(OUT, "red-mixed-a-k.svg");
  await download.saveAs(svgPath);
  return { svgPath, svg: fs.readFileSync(svgPath, "utf8") };
}

async function inspectExportedTopology(page, svg, edges) {
  await page.setContent(svg);
  return page.evaluate((expectedEdges) => {
    const nodeRects = Object.fromEntries([...document.querySelectorAll("me-tpc[data-nodeid]")].map((topic) => {
      const rect = topic.getBoundingClientRect();
      return [(topic.dataset.nodeid || "").replace(/^me/, ""), {
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height,
      }];
    }));
    const paths = [...document.querySelectorAll("svg.lines path, svg.subLines path")].map((connector, index) => {
      const length = connector.getTotalLength();
      const matrix = connector.getScreenCTM();
      const point = (at) => {
        const local = connector.getPointAtLength(at);
        const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
        return { x: screen.x, y: screen.y };
      };
      return { index, d: connector.getAttribute("d"), start: point(0), end: point(length) };
    });
    const distanceToRect = (point, rect) => {
      const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
      const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
      return Math.hypot(dx, dy);
    };
    const edgeMetrics = expectedEdges.map(([parentId, childId]) => {
      const parent = nodeRects[parentId];
      const child = nodeRects[childId];
      const candidates = paths.map((connector) => {
        const forward = {
          parentGap: distanceToRect(connector.start, parent),
          childGap: distanceToRect(connector.end, child),
        };
        const reverse = {
          parentGap: distanceToRect(connector.end, parent),
          childGap: distanceToRect(connector.start, child),
        };
        const chosen = Math.max(forward.parentGap, forward.childGap) <= Math.max(reverse.parentGap, reverse.childGap)
          ? forward : reverse;
        return { ...chosen, pathIndex: connector.index, d: connector.d, maxGap: Math.max(chosen.parentGap, chosen.childGap) };
      }).sort((a, b) => a.maxGap - b.maxGap);
      return { parentId, childId, ...candidates[0] };
    });
    return { nodeRects, paths, edgeMetrics };
  }, edges);
}

test("multi-branch SVG connectors remain attached after offscreen scaleFit", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto("/fixture-harness.html");
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);
  await installOffscreenGeometryTrace(page);

  // Twenty-seven exact leaves across three independent top-level branches.
  // This keeps auto-context enabled and makes scaleFit genuinely shrink the
  // throwaway map; a small five-node tree stays at scale=1 and cannot expose
  // scale-dependent connector drift.
  const selectedIds = [0, 1, 3].flatMap((main) => [0, 1, 2].flatMap((sub) => (
    [0, 1, 2].map((leaf) => `fixture-map-a-m${main}-s${sub}-l${leaf}`)
  )));
  const expectedNodes = ["fixture-map-a-root"];
  const expectedEdges = [];
  for (const main of [0, 1, 3]) {
    const mainId = `fixture-map-a-m${main}`;
    expectedNodes.push(mainId);
    expectedEdges.push(["fixture-map-a-root", mainId]);
    for (const sub of [0, 1, 2]) {
      const subId = `${mainId}-s${sub}`;
      expectedNodes.push(subId);
      expectedEdges.push([mainId, subId]);
      for (const leaf of [0, 1, 2]) {
        const leafId = `${subId}-l${leaf}`;
        expectedNodes.push(leafId);
        expectedEdges.push([subId, leafId]);
      }
    }
  }
  const { svgPath, svg } = await exportMixedBranchSvg(page, selectedIds);
  const trace = await page.evaluate(() => window.__MULTI_BRANCH_CONNECTOR_TRACE__);
  expect([...svg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1]).sort()).toEqual(expectedNodes.sort());

  const topology = await inspectExportedTopology(page, svg, expectedEdges);
  await page.screenshot({ path: path.join(OUT, "red-mixed-a-k.png"), fullPage: true });
  fs.writeFileSync(path.join(OUT, "connector-evidence.json"), JSON.stringify({ trace, topology }, null, 2));

  const events = trace.map((sample) => sample.event);
  expect(events).toContain("after-linkDiv");
  expect(trace.length, "scaleFit itself performs additional connector linking").toBeGreaterThanOrEqual(2);
  expect(topology.paths).toHaveLength(expectedEdges.length);
  for (const edge of topology.edgeMetrics) {
    expect(edge.maxGap, `${edge.parentId} -> ${edge.childId} must reach both rendered node boxes in ${svgPath}`).toBeLessThanOrEqual(8);
  }
});
