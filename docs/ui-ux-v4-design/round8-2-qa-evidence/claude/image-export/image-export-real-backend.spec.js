// Round 8.2 audit probe (Claude): R8-003 image-export commit boundary in the
// REAL app (c02e2b9 build on :4173, protected Flask on :8080, disposable PG).
// Seeding mirrors FE/e2e/real-backend-pdf-export.spec.js.
import { expect, test } from "@playwright/test";
import { openMapLibrary, registerAndEnterApp, uploadSampleDocument } from "../e2e/fixtures.js";

const API = "http://127.0.0.1:8080";
const NODES = (tag) => [
  { id: "ROOT", parent: null, kind: "root", title: `R82 ${tag} gốc`, order: 0 },
  { id: "P", parent: "ROOT", kind: "section", title: `${tag} nhánh một`, order: 0 },
  { id: "A", parent: "P", kind: "idea", title: `${tag} ý A`, order: 0 },
  { id: "C", parent: "ROOT", kind: "section", title: `${tag} nhánh hai`, order: 1 },
];

async function api(page) {
  const token = await page.evaluate(() => localStorage.getItem("memvid-token"));
  expect(token).toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

async function createMap(request, headers, tag) {
  let stem = null;
  await expect.poll(async () => {
    const body = await (await request.get(`${API}/list-indexed`, { headers })).json();
    stem = body.sources.find((s) => String(s.filename || "").includes("sample-doc"))?.video_stem || null;
    return stem;
  }, { timeout: 20_000 }).not.toBeNull();
  const queued = await (await request.post(`${API}/generate-mindmap`, {
    headers, data: { sources: [stem], source_ids: [stem], q: `r82 image ${tag} ${Date.now()}`, force: true },
  })).json();
  let mapId = queued.result?.id || null;
  if (!mapId) {
    await expect.poll(async () => {
      const body = await (await request.get(`${API}/mindmap-status/${queued.job_id}`, { headers })).json();
      mapId = body.result?.id || null;
      return body.status;
    }, { timeout: 60_000 }).toBe("done");
  }
  const title = `R82_Map_${tag}_${Date.now()}`;
  expect((await request.put(`${API}/mindmaps/${mapId}`, { headers, data: { title, nodes: NODES(tag), relations: [] } })).ok()).toBeTruthy();
  return title;
}

async function openMap(page, title) {
  await page.goto("/app");
  const listbox = await openMapLibrary(page);
  await listbox.getByRole("option").filter({ hasText: title }).click();
  await page.locator('[data-nodeid="meROOT"]').waitFor({ state: "visible" });
}

async function openPngExport(page) {
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="png"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
}

test("valid PNG export downloads exactly once and belongs to the open map; closing mid-capture downloads nothing", async ({ page, request }) => {
  test.setTimeout(180_000);
  await registerAndEnterApp(page);
  await uploadSampleDocument(page);
  const headers = await api(page);
  const alpha = await createMap(request, headers, "Alpha");
  const beta = await createMap(request, headers, "Beta");

  const downloads = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));

  // 1. Valid export of Beta (the map that is open): exactly one file, named for Beta.
  await openMap(page, alpha);
  await openMap(page, beta);
  await openPngExport(page);
  await page.getByRole("button", { name: "Xuất PNG" }).click();
  await expect.poll(() => downloads.length, { timeout: 30_000 }).toBe(1);
  await page.waitForTimeout(4_000);
  expect(downloads, "one click -> one file").toHaveLength(1);
  expect(downloads[0]).toContain("Beta");
  expect(downloads[0]).not.toContain("Alpha");
  test.info().annotations.push({ type: "valid-download", description: downloads[0] });
  await page.getByRole("button", { name: "Đóng", exact: true }).click();

  // 2. Real user input: click Export, then press Escape and click "Hủy" as fast as Playwright can
  //    (separate input tasks). The dialog must refuse to close while exporting; the export the
  //    user started completes as exactly one more file.
  await openPngExport(page);
  await page.getByRole("button", { name: "Xuất PNG" }).click();
  await page.keyboard.press("Escape");
  const dialogOpenAfterEscape = await page.getByRole("dialog").isVisible();
  const cancelDisabled = await page.getByRole("button", { name: "Hủy", exact: true }).isDisabled().catch(() => null);
  await expect.poll(() => downloads.length, { timeout: 30_000 }).toBe(2);
  await page.waitForTimeout(4_000);
  expect(dialogOpenAfterEscape, "Escape is ignored while an image export is in flight").toBe(true);
  expect(downloads, "one click -> one file").toHaveLength(2);
  test.info().annotations.push({ type: "real-input-close", description: `dialogOpenAfterEscape=${dialogOpenAfterEscape} cancelDisabled=${cancelDisabled}` });
  await page.getByRole("button", { name: "Đóng", exact: true }).click();

  // 3. Synthetic race (not reachable by human input): click + Escape inside ONE JS task, before
  //    React re-renders exporting=true. Recorded, not asserted.
  await openPngExport(page);
  await page.getByRole("button", { name: "Xuất PNG" }).evaluate((btn) => {
    btn.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  const closed = await page.getByRole("dialog").isHidden();
  await page.waitForTimeout(8_000);
  test.info().annotations.push({ type: "synthetic-same-task-race", description: `dialogClosed=${closed} downloadsAfterClose=${downloads.length - 2}` });
});
