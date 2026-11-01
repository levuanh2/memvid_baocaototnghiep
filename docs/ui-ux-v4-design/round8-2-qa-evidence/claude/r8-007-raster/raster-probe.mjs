// Diagnose R8-007 helper: which "mind-elixir" resource does the fixture helper import?
import { chromium } from "playwright";
const base = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base + "/fixture-harness.html");
await page.waitForFunction(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind));
const out = await page.evaluate(async () => {
  await Promise.all([import("/src/utils/mindmapImageExport.js"), import("/src/utils/mindElixirAdapter.js")]);
  const names = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes("mind-elixir"));
  const first = names[0];
  const mod = first ? await import(first) : null;
  return { total: performance.getEntriesByType("resource").length, names, first, keys: mod ? Object.keys(mod).slice(0, 20) : null, hasDefault: !!mod?.default };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
