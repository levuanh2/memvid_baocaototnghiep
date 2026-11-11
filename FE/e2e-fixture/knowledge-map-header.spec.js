// W5-2: knowledge map page header -- two exits ("Về Thư viện", "Hỏi tài liệu
// này"), breadcrumb showing the real title, and one "Xuất" menu replacing
// the three separate export buttons. Real app on the Vite dev server, API
// mocked at the network layer (pattern copied from
// FE/e2e-fixture/library-mode-navigation.spec.js).
import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const DOC = { document_id: "doc-1", title: "Giáo trình Hệ điều hành", filename: "os.pdf", source_stem: "os-stem" };
const NODES = [
  { node_id: "root", title: "Hệ điều hành hiện đại", node_type: "root", parent_node_id: null },
  { node_id: "section-process", title: "Quản lý tiến trình", node_type: "section", parent_node_id: "root" },
  { node_id: "concept-scheduling", title: "Điều phối tiến trình", node_type: "concept", parent_node_id: "section-process" },
];

const EVIDENCE_DIR = "../docs/ui-ux-v4-1/evidence/w5-2";
test.beforeAll(async () => { await mkdir(new URL(EVIDENCE_DIR, import.meta.url), { recursive: true }); });

async function openMapPage(page) {
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/api/documents/doc-1") return route.fulfill(json(DOC));
    if (p === "/api/documents/doc-1/study-maps") return route.fulfill(json({ study_maps: [{ map_id: "map-1", status: "completed" }] }));
    if (p === "/api/study-maps/map-1") return route.fulfill(json({ map_id: "map-1", title: DOC.title, nodes: NODES, edges: [] }));
    if (p === "/api/documents/doc-1/chunks") return route.fulfill(json({ chunks: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app/study/map/doc-1");
  await expect(page.getByRole("heading", { name: DOC.title })).toBeVisible();
}

for (const width of [1440, 390]) {
  test(`${width}px: two exits, real title in breadcrumb, Xuất menu (before closed / after open)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await openMapPage(page);

    const veThuVien = page.getByRole("link", { name: "Về Thư viện" });
    await expect(veThuVien).toBeVisible();
    await expect(veThuVien).toHaveAttribute("href", "/app/study");

    const hoiTaiLieu = page.getByRole("link", { name: "Hỏi tài liệu này" });
    await expect(hoiTaiLieu).toBeVisible();
    await expect(hoiTaiLieu).toHaveAttribute("href", "/app?source=os-stem");

    // Breadcrumb's first segment: real title, not the raw stem.
    await expect(page.getByText(DOC.title).first()).toBeVisible();
    await expect(page.getByText("os-stem")).toHaveCount(0);

    const xuatTrigger = page.getByRole("button", { name: /^Xuất/ });
    await expect(xuatTrigger).toBeVisible();
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE_DIR}/${width}-before.png`, fullPage: width !== 1440 });

    await xuatTrigger.click();
    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(3);
    await page.screenshot({ path: `${EVIDENCE_DIR}/${width}-after.png`, fullPage: width !== 1440 });

    // Escape closes it and returns focus to the trigger.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(xuatTrigger).toBeFocused();
  });
}
