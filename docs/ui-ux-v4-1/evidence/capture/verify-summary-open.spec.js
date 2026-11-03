// V4.1 audit: with an existing summary for the selected source, does Workspace
// "Tóm tắt" mode show it, and where does Library card "Tóm tắt" lead?
import { test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../docs/ui-ux-v4-1/evidence");
const json = (b) => ({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const SUMMARY = { id: "s1", title: "Tóm tắt: Hệ điều hành", sources: ["tai-lieu-1"], created_at: "2026-11-01T00:00:00Z", content: "## Tổng quan\nHệ điều hành quản lý tiến trình.", summary: "Hệ điều hành quản lý tiến trình." };
const DOC = { document_id: "d1", source_stem: "tai-lieu-1", title: "Hệ điều hành.pdf", status: "completed", ingest_status: "index_ready", progress: 1,
  ai: { index: "ready", summary: { state: "ready" }, quiz: { ready: false }, review: {} } };

async function setup(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => { localStorage.setItem("memvid-token", "fixture-token"); localStorage.setItem("memvid-theme", "light"); });
  await page.route(/localhost:8080\//, async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/usage/me") return route.fulfill(json({ plan: "Free", used: 1, reserved: 0, limit: 1000, remaining: 999, percentage: 0, reset_at: "2026-12-01T00:00:00Z", breakdown: {} }));
    if (p === "/summaries") return route.fulfill(json({ summaries: [SUMMARY] }));
    if (p === "/summaries/s1") return route.fulfill(json(SUMMARY));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (p === "/mindmaps/capability") return route.fulfill(json({ guided_mindmap_v3: true }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video: "tai-lieu-1", video_stem: "tai-lieu-1", filename: "Hệ điều hành.pdf", status: "index_ready", source_id: "d1" }] }));
    if (p === "/api/documents") return route.fulfill(json({ documents: [DOC] }));
    if (p === "/api/library") return route.fulfill(json({ documents: [DOC], collections: [] }));
    if (p === "/api/documents/d1") return route.fulfill(json(DOC));
    return route.fulfill(json({}));
  });
}

test("workspace summary mode with an existing summary and the source selected", async ({ page }) => {
  await setup(page);
  await page.goto("/app");
  await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor();
  await page.getByText("Hệ điều hành.pdf").first().click();
  await page.locator('[role="tab"][title="Tóm tắt"]').first().click();
  await page.waitForTimeout(1500);
  const text = await page.locator("main").innerText().catch(() => "");
  await page.screenshot({ path: `${OUT}/screens/verify-summary__existing__workspace.jpg`, type: "jpeg", quality: 55 });
  writeFileSync(`${OUT}/inventory/verify-summary__existing__workspace.json`, JSON.stringify({ showsSummaryContent: text.includes("Tổng quan") || text.includes("quản lý tiến trình"), mainText: text.slice(0, 300) }, null, 1));
});

test("library card Tóm tắt destination", async ({ page }) => {
  await setup(page);
  await page.goto("/app/study");
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Tóm tắt/ }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const text = await page.locator("body").innerText().catch(() => "");
  await page.screenshot({ path: `${OUT}/screens/verify-summary__library-card__after-click.jpg`, type: "jpeg", quality: 55 });
  writeFileSync(`${OUT}/inventory/verify-summary__library-card.json`, JSON.stringify({ url: page.url().replace(/^https?:\/\/[^/]+/, ""), showsSummaryContent: text.includes("Tổng quan") || text.includes("quản lý tiến trình") }, null, 1));
});
