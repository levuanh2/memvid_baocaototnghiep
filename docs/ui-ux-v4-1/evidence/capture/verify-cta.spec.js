// V4.1 audit: does the Workspace empty-state CTA "Tạo tóm tắt" / "Tạo sơ đồ tư duy"
// start anything? Real app on Vite, API mocked; records every non-GET API call and
// whether a dialog opens after the click.
import { test } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../docs/ui-ux-v4-1/evidence");
const json = (b) => ({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const DOCS = [{ document_id: "d1", source_stem: "tai-lieu-1", title: "Hệ điều hành.pdf", status: "completed", ingest_status: "index_ready", progress: 1 }];

for (const [mode, cta] of [["Tóm tắt", "Tạo tóm tắt"], ["Sơ đồ tư duy", "Tạo sơ đồ tư duy"]]) {
  for (const capability of ["enabled", "disabled"]) {
    test(`${cta} capability=${capability}`, async ({ page }) => {
      test.setTimeout(60_000);
      const calls = [];
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(() => { localStorage.setItem("memvid-token", "fixture-token"); localStorage.setItem("memvid-theme", "light"); });
      await page.route(/localhost:8080\//, async (route) => {
        const req = route.request(); const p = new URL(req.url()).pathname;
        if (req.method() !== "GET") calls.push(`${req.method()} ${p}`);
        if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
        if (p === "/usage/me") return route.fulfill(json({ plan: "Free", used: 1, reserved: 0, limit: 1000, remaining: 999, percentage: 0, reset_at: "2026-12-01T00:00:00Z", breakdown: {} }));
        if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
        if (p === "/summaries") return route.fulfill(json({ summaries: [] }));
        if (p === "/mindmaps/capability") return route.fulfill(json({ guided_mindmap_v3: capability === "enabled" }));
        if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video: "tai-lieu-1", video_stem: "tai-lieu-1", filename: "Hệ điều hành.pdf", status: "index_ready", source_id: "d1" }] }));
        if (p === "/api/documents") return route.fulfill(json({ documents: DOCS }));
        if (p === "/generate-summary" || p === "/generate-mindmap") return route.fulfill(json({ job_id: "job-1" }));
        return route.fulfill(json({}));
      });
      await page.goto("/app");
      await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor();
      await page.locator(`[role="tab"][title="${mode}"]`).first().click();
      await page.getByText("Hệ điều hành.pdf").first().click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(400);
      const selectedLabel = await page.getByText(/đang chọn/).first().innerText().catch(() => "");
      await page.waitForTimeout(600);
      const button = page.getByRole("button", { name: cta }).first();
      const enabled = await button.isEnabled().catch(() => false);
      await button.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const dialogs = await page.locator('[role="dialog"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") || e.innerText.slice(0, 60)));
      mkdirSync(`${OUT}/screens`, { recursive: true });
      await page.screenshot({ path: `${OUT}/screens/verify-cta__${mode === "Tóm tắt" ? "summary" : "mindmap"}__capability-${capability}__after-click.jpg`, type: "jpeg", quality: 55 });
      const line = { cta, capability, selectedLabel, buttonEnabled: enabled, nonGetCalls: calls, dialogs };
      mkdirSync(`${OUT}/inventory`, { recursive: true });
      writeFileSync(`${OUT}/inventory/verify-cta__${mode === "Tóm tắt" ? "summary" : "mindmap"}__${capability}.json`, JSON.stringify(line, null, 1));
    });
  }
}
