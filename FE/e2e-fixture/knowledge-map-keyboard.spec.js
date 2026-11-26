// V6 bug hunt #7: knowledge-map nodes were pointer-only (an SVG <g onClick> with no tabIndex,
// role or key handler). Real app on the Vite dev server, API mocked at the network layer
// (setup copied from knowledge-map-header.spec.js).
import { test, expect } from "@playwright/test";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const DOC = { document_id: "doc-1", title: "Giáo trình Hệ điều hành", filename: "os.pdf", source_stem: "os-stem" };
const NODES = [
  { node_id: "root", title: "Hệ điều hành hiện đại", node_type: "root", parent_node_id: null },
  { node_id: "section-process", title: "Quản lý tiến trình", node_type: "section", parent_node_id: "root" },
  { node_id: "concept-scheduling", title: "Điều phối tiến trình", node_type: "concept", parent_node_id: "section-process" },
];

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

test("a map node takes focus and Enter selects it and opens its branch, keeping focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMapPage(page);

  const section = page.getByRole("button", { name: "Quản lý tiến trình" });
  await expect(section).toBeVisible();
  await expect(section).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Điều phối tiến trình" })).toHaveCount(0);   // collapsed

  await section.focus();
  await page.keyboard.press("Enter");

  const after = page.getByRole("button", { name: "Quản lý tiến trình" });
  await expect(after).toHaveAttribute("aria-pressed", "true");
  await expect(after).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Điều phối tiến trình" })).toBeVisible();
  // Focus stays on the node that was activated, so the next key press continues from there.
  await expect(after).toBeFocused();

  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Điều phối tiến trình" })).toHaveCount(0);
});

test("every node can be reached with Tab", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMapPage(page);
  const root = page.getByRole("button", { name: "Hệ điều hành hiện đại" });
  await expect(root).toBeVisible();
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await root.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
});
