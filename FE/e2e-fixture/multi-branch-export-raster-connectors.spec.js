import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveExportScopeFromRecord } from "../src/utils/mindmapExportScope";
import { assertEveryNodeHasConnector } from "../src/utils/testHelpers/assertEveryNodeHasConnector";
import { FIXTURE_EXACT_V3 } from "../src/dev/mindmapFixtures";

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "qa-artifacts",
  "multi-branch-export-raster-connectors",
);

function deepRecord() {
  const nodes = [{ id: "root", kind: "root", title: "Deep mixed-side export", parent: null, order: 0 }];
  for (let branch = 0; branch < 6; branch += 1) {
    const branchId = `b${branch}`;
    nodes.push({ id: branchId, kind: "section", title: `Branch ${branch}`, parent: "root", order: branch });
    let parent = branchId;
    for (let depth = 1; depth <= 3; depth += 1) {
      const id = `${branchId}-d${depth}`;
      nodes.push({ id, kind: "section", title: `Branch ${branch} depth ${depth}`, parent, order: 0 });
      parent = id;
    }
    for (let leaf = 0; leaf < 2; leaf += 1) {
      nodes.push({
        id: `${branchId}-leaf${leaf}`,
        kind: "idea",
        title: `Selected leaf ${branch}.${leaf} with a long production-like title`,
        parent,
        order: leaf,
      });
    }
  }
  return {
    id: "deep-raster-connectors",
    title: "Deep raster connector regression",
    nodes,
    relations: [],
    sources: [],
    schema_version: 2,
  };
}

const selectedIds = [0, 1, 2, 3, 4, 5].flatMap((branch) => [
  `b${branch}-leaf0`,
  `b${branch}-leaf1`,
]);

async function capture(page, record, suppressedContextIds) {
  return page.evaluate(async ({ captureRecord, selected, suppressed }) => {
    const [{ captureMapImageWithGeometry }, { recordToMindElixir }] = await Promise.all([
      import("/src/utils/mindmapImageExport.js"),
      import("/src/utils/mindElixirAdapter.js"),
    ]);
    const moduleUrl = performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => name.includes("mind-elixir"));
    const { default: MindElixir } = await import(moduleUrl);
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-99999px;top:0;width:2400px;height:1600px";
    document.body.appendChild(host);
    const mind = new MindElixir({ el: host, direction: MindElixir.SIDE, editable: false });
    mind.init(recordToMindElixir(captureRecord, { fullTitles: true }).mindData);
    try {
      return await captureMapImageWithGeometry({
        mind,
        record: captureRecord,
      scopeType: "selected_branches",
      branchRootIds: selected,
      includeDescendants: false,
      contextMode: "minimal",
      suppressedContextIds: suppressed,
      backgroundColor: "#ffffff",
      scale: 2,
      quality: 1,
      title: "deep-raster-connectors",
      settleMs: 30,
      });
    } finally {
      mind.destroy?.();
      host.remove();
    }
  }, { captureRecord: record, selected: selectedIds, suppressed: suppressedContextIds });
}

async function captureCurrentFixture(page, record, selected) {
  return page.evaluate(async ({ captureRecord, selectedIds: ids }) => {
    const { captureMapImageWithGeometry } = await import("/src/utils/mindmapImageExport.js");
    return captureMapImageWithGeometry({
      mind: window.__STUDYMAP_FIXTURE__.mind,
      record: captureRecord,
      scopeType: "selected_branches",
      branchRootIds: ids,
      includeDescendants: false,
      contextMode: "minimal",
      suppressedContextIds: [],
      backgroundColor: "#ffffff",
      scale: 2,
      quality: 1,
      title: "mixed-side-raster-connectors",
      settleMs: 30,
    });
  }, { captureRecord: record, selectedIds: selected });
}
async function rasterInkMetrics(page, base64, manifest) {
  return page.evaluate(async ({ pngBase64, geometry }) => {
    const binary = atob(pngBase64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const insideNode = (x, y) => geometry.nodes.some((node) => (
      x >= node.x - 1 && x <= node.x + node.width + 1
      && y >= node.y - 1 && y <= node.y + node.height + 1
    ));
    const connectorInk = geometry.connectors.map((connector, index) => {
      const x0 = Math.max(0, Math.floor(connector.x - 3));
      const y0 = Math.max(0, Math.floor(connector.y - 3));
      const x1 = Math.min(canvas.width, Math.ceil(connector.x + connector.width + 3));
      const y1 = Math.min(canvas.height, Math.ceil(connector.y + connector.height + 3));
      let inkPixels = 0;
      let examinedPixels = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          if (insideNode(x, y)) continue;
          examinedPixels += 1;
          const offset = (y * canvas.width + x) * 4;
          if (
            pixels[offset + 3] > 20
            && Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < 235
          ) inkPixels += 1;
        }
      }
      return {
        index,
        x: connector.x,
        y: connector.y,
        width: connector.width,
        height: connector.height,
        inkPixels,
        examinedPixels,
      };
    });
    return {
      width: canvas.width,
      height: canvas.height,
      connectorInk,
      minInkPixels: Math.min(...connectorInk.map((item) => item.inkPixels)),
      zeroInkConnectorIndices: connectorInk.filter((item) => item.inkPixels === 0).map((item) => item.index),
    };
  }, { pngBase64: base64, geometry: manifest });
}

test("deep mixed-side selected branches keep every connector in DOM geometry and raster pixels through suppress/restore", async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto("/fixture-harness.html");
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);

  const record = deepRecord();
  const parentById = Object.fromEntries(record.nodes.map((node) => [node.id, node.parent]));
  const scenarios = [
    { name: "auto-context", suppressed: [] },
    { name: "parent-suppressed", suppressed: ["b1-d2"] },
    { name: "parent-restored", suppressed: [] },
  ];
  const evidence = [];

  for (const scenario of scenarios) {
    const scope = resolveExportScopeFromRecord(record.nodes, {
      scopeType: "selected_branches",
      selectedBranchRootIds: selectedIds,
      includeDescendants: false,
      contextMode: "minimal",
      suppressedContextIds: scenario.suppressed,
    });
    const result = await capture(page, record, scenario.suppressed);
    expect(result.geometryManifest).not.toBeNull();
    const manifest = result.geometryManifest;
    const expectedIds = [...scope.renderIds].sort();
    expect(manifest.nodes.map((node) => node.id).sort()).toEqual(expectedIds);
    expect(manifest.nodes.length).toBeGreaterThanOrEqual(20);
    expect(scope.presentationRootIds.length).toBe(scenario.suppressed.length ? 2 : 1);
    expect(manifest.connectors).toHaveLength(manifest.nodes.length - scope.presentationRootIds.length);

    const contract = assertEveryNodeHasConnector(manifest, {
      parentById,
      presentationRootIds: scope.presentationRootIds,
      tolerancePx: 18,
    });
    expect(contract.matchedEdgeCount).toBe(manifest.nodes.length - scope.presentationRootIds.length);

    const nodeById = new Map(manifest.nodes.map((node) => [node.id, node]));
    const centerX = (node) => node.x + node.width / 2;
    const rootX = centerX(nodeById.get("root"));
    const branchXs = [0, 1, 2, 3, 4, 5].map((branch) => centerX(nodeById.get(`b${branch}`)));

    const raster = await rasterInkMetrics(page, result.base64, manifest);
    expect(raster.zeroInkConnectorIndices, `${scenario.name}: connector boxes without painted PNG pixels`).toEqual([]);
    expect(raster.minInkPixels, `${scenario.name}: minimum painted pixels in any connector box`).toBeGreaterThan(5);

    fs.writeFileSync(path.join(OUT, `${scenario.name}.png`), Buffer.from(result.base64, "base64"));
    fs.writeFileSync(path.join(OUT, `${scenario.name}.manifest.json`), JSON.stringify(manifest, null, 2));
    evidence.push({
      scenario: scenario.name,
      suppressedContextIds: scenario.suppressed,
      presentationRootIds: scope.presentationRootIds,
      manifest: {
        nodeCount: manifest.nodes.length,
        connectorCount: manifest.connectors.length,
        imageWidth: manifest.image_width_px,
        imageHeight: manifest.image_height_px,
      },
      geometryContract: contract,
      orientation: { rootX, branchXs },
      raster,
    });
  }

  await page.goto("/fixture-harness.html?map=exact-v3");
  await expect.poll(() => page.evaluate(() => window.__STUDYMAP_FIXTURE__?.mind?.nodeData?.id)).toBe("F");
  const mixedSelected = ["A", "J"];
  const mixedScope = resolveExportScopeFromRecord(FIXTURE_EXACT_V3.nodes, {
    scopeType: "selected_branches",
    selectedBranchRootIds: mixedSelected,
    includeDescendants: false,
    contextMode: "minimal",
    suppressedContextIds: [],
  });
  const mixedResult = await captureCurrentFixture(page, FIXTURE_EXACT_V3, mixedSelected);
  const mixedManifest = mixedResult.geometryManifest;
  const mixedParents = Object.fromEntries(FIXTURE_EXACT_V3.nodes.map((node) => [node.id, node.parent]));
  const mixedContract = assertEveryNodeHasConnector(mixedManifest, {
    parentById: mixedParents,
    presentationRootIds: mixedScope.presentationRootIds,
    tolerancePx: 18,
  });
  const mixedNodes = new Map(mixedManifest.nodes.map((node) => [node.id, node]));
  const mixedCenter = (id) => mixedNodes.get(id).x + mixedNodes.get(id).width / 2;
  expect(mixedCenter("E")).toBeLessThan(mixedCenter("F"));
  expect(mixedCenter("J")).toBeGreaterThan(mixedCenter("F"));
  const mixedRaster = await rasterInkMetrics(page, mixedResult.base64, mixedManifest);
  expect(mixedRaster.zeroInkConnectorIndices, "mixed LEFT/RIGHT connector boxes without painted PNG pixels").toEqual([]);
  expect(mixedRaster.minInkPixels).toBeGreaterThan(5);
  fs.writeFileSync(path.join(OUT, "mixed-left-right.png"), Buffer.from(mixedResult.base64, "base64"));
  fs.writeFileSync(path.join(OUT, "mixed-left-right.manifest.json"), JSON.stringify(mixedManifest, null, 2));
  evidence.push({
    scenario: "mixed-left-right",
    presentationRootIds: mixedScope.presentationRootIds,
    manifest: {
      nodeCount: mixedManifest.nodes.length,
      connectorCount: mixedManifest.connectors.length,
      imageWidth: mixedManifest.image_width_px,
      imageHeight: mixedManifest.image_height_px,
    },
    geometryContract: mixedContract,
    orientation: { E: mixedCenter("E"), F: mixedCenter("F"), J: mixedCenter("J") },
    raster: mixedRaster,
  });
  expect(evidence[2].manifest).toEqual(evidence[0].manifest);
  expect(evidence[2].raster.minInkPixels).toBe(evidence[0].raster.minInkPixels);
  fs.writeFileSync(path.join(OUT, "evidence.json"), JSON.stringify(evidence, null, 2));
});
