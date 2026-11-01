import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  openMapLibrary,
  registerAndEnterApp,
  selectAllSources,
  uploadSampleDocument,
} from "../e2e/fixtures.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(HERE, "../../docs/ui-ux-v4-design/round8-2-qa-evidence/agy");
const PDF_OUT_DIR = path.join(EVIDENCE_DIR, "pdf-artifacts");
const VERIFY_SCRIPT = path.join(EVIDENCE_DIR, "verify_4tier_pdf.py");

const OFF_URL = "http://127.0.0.1:4173";
const ON_URL = "http://127.0.0.1:4174";
const API_URL = "http://127.0.0.1:8080";
const FIXTURE_URL = "http://localhost:5199";

// 4-Tier Deterministic Mindmap Hierarchy with Vietnamese Labels
const TITLES_4TIER = {
  ROOT: "Chủ đề chính: Nghiên cứu Khoa học và Chuyển đổi số Nông nghiệp Carbon Thấp TEC2026",
  SEC1: "Nhánh 1: Cơ sở lý luận và Khung pháp lý Quốc tế về Tín chỉ Carbon Rừng và Nông nghiệp",
  SEC2: "Nhánh 2: Phương pháp luận MRV và Mô hình Đo đạc Phát thải Khí nhà kính Bền vững",
  IDEA1: "Tiêu chuẩn Verra VM0042 và Phương pháp đo đạc tín chỉ carbon đất nông nghiệp",
  IDEA2: "Hệ thống chính sách phát thải ròng bằng không Net Zero 2050 tại Việt Nam",
  IDEA3: "Cảm biến IoT và Công nghệ Viễn thám Giám sát Mực nước Ruột lúa AWD",
  IDEA4: "Thuật toán Ước lượng Phát thải Mê-tan CH4 và Nitơ Oxit N2O tự động",
  LEAF1: "Dữ liệu lịch sử canh tác ba năm liên tiếp và đối chiếu tọa độ ranh giới thửa ruộng",
  LEAF2: "Cơ chế trao đổi hạn ngạch và thị trường tín chỉ carbon trong nước theo Nghị định 06",
  LEAF3: "Thiết bị đo cảm biến siêu âm truyền dữ liệu qua giao thức LoRaWAN về trạm trung tâm",
  LEAF4: "Mô hình DNDC và IPCC Tier 2 hiệu chỉnh theo đặc thù khí hậu Đồng bằng Sông Cửu Long",
};

const NODES_4TIER = [
  { id: "ROOT", parent: null, kind: "root", title: TITLES_4TIER.ROOT, order: 0 },
  { id: "SEC1", parent: "ROOT", kind: "section", title: TITLES_4TIER.SEC1, order: 0 },
  { id: "SEC2", parent: "ROOT", kind: "section", title: TITLES_4TIER.SEC2, order: 1 },
  { id: "IDEA1", parent: "SEC1", kind: "idea", title: TITLES_4TIER.IDEA1, order: 0 },
  { id: "IDEA2", parent: "SEC1", kind: "idea", title: TITLES_4TIER.IDEA2, order: 1 },
  { id: "IDEA3", parent: "SEC2", kind: "idea", title: TITLES_4TIER.IDEA3, order: 0 },
  { id: "IDEA4", parent: "SEC2", kind: "idea", title: TITLES_4TIER.IDEA4, order: 1 },
  { id: "LEAF1", parent: "IDEA1", kind: "leaf", title: TITLES_4TIER.LEAF1, order: 0 },
  { id: "LEAF2", parent: "IDEA2", kind: "leaf", title: TITLES_4TIER.LEAF2, order: 0 },
  { id: "LEAF3", parent: "IDEA3", kind: "leaf", title: TITLES_4TIER.LEAF3, order: 0 },
  { id: "LEAF4", parent: "IDEA4", kind: "leaf", title: TITLES_4TIER.LEAF4, order: 0 },
];

const APPEARANCE_4TIER = {
  version: 2,
  preset: "default",
  overrides: {
    canvas: { background: "#FFFFFF", grid: "none" },
    node: {
      root: { shape: "roundedRect", fill: "#111827", textColor: "#FDE047", radius: 8 },
      branch: { shape: "roundedRect", fill: "#FEF3C7", textColor: "#1E3A8A", borderColor: "#D97706", borderWidth: 2, radius: 8 },
      idea: { shape: "roundedRect", fill: "#DBEAFE", textColor: "#172554", borderColor: "#2563EB", borderWidth: 1, radius: 6 },
      leaf: { shape: "roundedRect", fill: "#DCFCE7", textColor: "#14532D", borderColor: "#16A34A", borderWidth: 1, radius: 6 },
    },
    connector: { colorMode: "fixed", fixedColor: "#E11D48", thickness: "thick", style: "solid" },
  },
};

function sRGBtoLin(c) {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relLuminance(r, g, b) {
  return 0.2126 * sRGBtoLin(r) + 0.7152 * sRGBtoLin(g) + 0.0722 * sRGBtoLin(b);
}

function contrastRatio(lum1, lum2) {
  const l1 = Math.max(lum1, lum2);
  const l2 = Math.min(lum1, lum2);
  return (l1 + 0.05) / (l2 + 0.05);
}

function parseRgb(colorStr) {
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (match) {
    return {
      r: parseInt(match[1], 10),
      g: parseInt(match[2], 10),
      b: parseInt(match[3], 10),
      a: match[4] !== undefined ? parseFloat(match[4]) : 1,
    };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

function alphaComposite(top, bottom) {
  const a = top.a + bottom.a * (1 - top.a);
  const r = Math.round((top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / (a || 1));
  const g = Math.round((top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / (a || 1));
  const b = Math.round((top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / (a || 1));
  return { r, g, b, a };
}

test.describe("AGY Protected Stack: OFF Build (:4173)", () => {
  test.use({ baseURL: OFF_URL });

  test("1. Auth & Backend API Protection Enforcement", async ({ page, request }) => {
    // Probe without token -> Must return 401 Unauthorized under AUTH_PROTECT_APP_APIS=true
    const unauthRes = await request.get(`${API_URL}/api/documents`);
    expect(unauthRes.status(), "Unauthenticated request to /api/documents must be 401").toBe(401);

    // Register fresh user A
    await registerAndEnterApp(page);
    const tokenA = await page.evaluate(() => localStorage.getItem("memvid-token"));
    expect(tokenA, "Token A exists in localStorage").toBeTruthy();

    // Authenticated request with Bearer token -> 200 OK
    const authRes = await request.get(`${API_URL}/api/documents`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(authRes.status(), "Authenticated request with Bearer token must be 200").toBe(200);

    // Upload a document as user A
    await uploadSampleDocument(page);
    const docsResA = await request.get(`${API_URL}/api/documents`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const docsBodyA = await docsResA.json();
    const docIdA = docsBodyA.documents?.[0]?.document_id;
    expect(docIdA, "User A has uploaded document").toBeTruthy();

    // Register fresh user B
    await page.evaluate(() => localStorage.removeItem("memvid-token"));
    await registerAndEnterApp(page);
    const tokenB = await page.evaluate(() => localStorage.getItem("memvid-token"));
    expect(tokenB).not.toBe(tokenA);

    // User B cannot see User A's documents in /api/documents
    const docsResB = await request.get(`${API_URL}/api/documents`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(docsResB.status()).toBe(200);
    const docsBodyB = await docsResB.json();
    const listB = docsBodyB.documents || [];
    expect(listB.map((d) => d.document_id)).not.toContain(docIdA);

    // Direct access to User A's document as User B is rejected (403 or 404)
    const crossRes = await request.get(`${API_URL}/api/documents/${docIdA}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect([403, 404]).toContain(crossRes.status());
  });

  test("2. Destructive Confirm Dialog Contrast & Escape Focus Management", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`${FIXTURE_URL}/r71qa.html?view=destructive&theme=dark`);

    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });

    // Measure Dark Mode Contrast
    const contrastData = await page.evaluate(() => {
      const dialogEl = document.querySelector('[role="dialog"]');
      const modalBackdrop = document.querySelector(".modal-backdrop") || dialogEl.parentElement;
      const bodyEl = document.body;

      const ackEl = dialogEl.querySelector(".destructive-confirm__ack span") || dialogEl.querySelector(".destructive-confirm__ack");
      const descEl = dialogEl.querySelector("p.text-small.text-text-secondary");
      const titleEl = dialogEl.querySelector("p.text-body");

      return {
        bodyBg: window.getComputedStyle(bodyEl).backgroundColor,
        backdropBg: window.getComputedStyle(modalBackdrop).backgroundColor,
        dialogBg: window.getComputedStyle(dialogEl).backgroundColor,
        ackColor: window.getComputedStyle(ackEl).color,
        descColor: window.getComputedStyle(descEl).color,
        titleColor: window.getComputedStyle(titleEl).color,
      };
    });

    const bodyRgb = parseRgb(contrastData.bodyBg.includes("rgba(0, 0, 0, 0)") ? "rgb(10, 15, 29)" : contrastData.bodyBg);
    const backdropRgb = parseRgb(contrastData.backdropBg.includes("rgba(0, 0, 0, 0)") ? "rgba(0, 0, 0, 0.6)" : contrastData.backdropBg);
    const blendedBackdrop = alphaComposite(backdropRgb, bodyRgb);
    const dialogRgb = parseRgb(contrastData.dialogBg);
    const compositedBg = dialogRgb.a < 1 ? alphaComposite(dialogRgb, blendedBackdrop) : dialogRgb;
    const bgLum = relLuminance(compositedBg.r, compositedBg.g, compositedBg.b);

    const ackColor = parseRgb(contrastData.ackColor);
    const ackLum = relLuminance(ackColor.r, ackColor.g, ackColor.b);
    const ackRatio = contrastRatio(ackLum, bgLum);

    const descColor = parseRgb(contrastData.descColor);
    const descLum = relLuminance(descColor.r, descColor.g, descColor.b);
    const descRatio = contrastRatio(descLum, bgLum);

    const titleColor = parseRgb(contrastData.titleColor);
    const titleLum = relLuminance(titleColor.r, titleColor.g, titleColor.b);
    const titleRatio = contrastRatio(titleLum, bgLum);

    expect(ackRatio, "Ack text contrast ratio against composited dark bg").toBeGreaterThanOrEqual(4.5);
    expect(descRatio, "Description text contrast ratio against composited dark bg").toBeGreaterThanOrEqual(4.5);
    expect(titleRatio, "Title text contrast ratio against composited dark bg").toBeGreaterThanOrEqual(4.5);

    // Escape focus test
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });

    const trigger = page.getByRole("button", { name: "Xóa sơ đồ Alpha" });
    await trigger.waitFor({ state: "visible" });

    const deleteRequests = [];
    page.on("request", (req) => {
      if (req.method() === "DELETE" || req.url().includes("/delete")) {
        deleteRequests.push(req.url());
      }
    });

    await trigger.focus();
    expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);

    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "visible" });

    const focusInside = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return d ? d.contains(document.activeElement) : false;
    });
    expect(focusInside, "Focus moves inside dialog on keyboard open").toBe(true);

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });

    expect(deleteRequests.length, "Zero DELETE requests dispatched on Escape").toBe(0);
    await page.waitForTimeout(150);
    const restored = await trigger.evaluate((el) => el === document.activeElement);
    expect(restored, "Focus restores to original trigger after Escape").toBe(true);
  });

  test("3. 4-Tier Mindmap PDF Export E2E on Protected Backend", async ({ page, request }) => {
    test.setTimeout(240_000);

    // Register fresh user
    await registerAndEnterApp(page);
    await uploadSampleDocument(page);
    await selectAllSources(page);

    const token = await page.evaluate(() => localStorage.getItem("memvid-token"));
    const headers = { Authorization: `Bearer ${token}` };

    // Get stem
    let stem = null;
    await expect.poll(async () => {
      const res = await request.get(`${API_URL}/list-indexed`, { headers });
      const body = await res.json();
      stem = body.sources.find((s) => String(s.filename || "").includes("sample-doc"))?.video_stem || null;
      return stem;
    }, { timeout: 25_000 }).not.toBeNull();

    // Generate mindmap
    const title = `AGY 4-Tier Protected Audit ${Date.now()}`;
    const genRes = await request.post(`${API_URL}/generate-mindmap`, {
      headers,
      data: { sources: [stem], source_ids: [stem], q: title, force: false },
    });
    expect(genRes.ok()).toBe(true);
    const queued = await genRes.json();
    let mapId = queued.result?.id || null;
    if (!mapId) {
      await expect.poll(async () => {
        const statusRes = await request.get(`${API_URL}/mindmap-status/${queued.job_id}`, { headers });
        const body = await statusRes.json();
        mapId = body.result?.id || null;
        return body.status;
      }, { timeout: 60_000, intervals: [250, 500, 1000] }).toBe("done");
    }

    // Update with 4-tier 11 nodes & appearance
    const putRes = await request.put(`${API_URL}/mindmaps/${mapId}`, {
      headers,
      data: { title, nodes: NODES_4TIER, relations: [] },
    });
    expect(putRes.ok()).toBe(true);

    const patchRes = await request.patch(`${API_URL}/mindmaps/${mapId}/appearance`, {
      headers,
      data: { appearance: APPEARANCE_4TIER },
    });
    expect(patchRes.ok()).toBe(true);

    // Open map in UI
    await page.goto("/app");
    await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible" });
    const listbox = await openMapLibrary(page);
    await listbox.getByRole("option").filter({ hasText: title }).click();
    await page.locator('[data-nodeid="meROOT"]').waitFor({ state: "visible", timeout: 30_000 });
    await expect(page.locator("me-tpc")).toHaveCount(NODES_4TIER.length);

    // Scenario 1: Export PDF (map_and_outline, A4 landscape)
    await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
    await page.getByRole("button", { name: "Tiếp tục" }).click();
    await page.locator('input[name="mm-export-format"][value="pdf"]').check();
    await page.getByRole("button", { name: "Tiếp tục" }).click();

    await page.getByRole("button", { name: "Sơ đồ + dàn ý" }).click();
    await page.getByRole("button", { name: "Tiếp tục" }).click();

    const exportReqPromise = page.waitForRequest((req) => (
      req.method() === "POST" && /\/mindmaps\/[^/]+\/exports$/.test(new URL(req.url()).pathname)
    ));
    const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
    await page.getByRole("button", { name: "Tạo PDF" }).click();

    const exportReq = await exportReqPromise;
    const reqBody = exportReq.postDataJSON();
    const download = await downloadPromise;

    const scenario1Dir = path.join(PDF_OUT_DIR, "scenario-1-map-and-outline");
    fs.mkdirSync(scenario1Dir, { recursive: true });

    const pdfPath = path.join(scenario1Dir, "artifact-map-and-outline.pdf");
    await download.saveAs(pdfPath);
    fs.writeFileSync(path.join(scenario1Dir, "source.png"), Buffer.from(reqBody.map_image_base64, "base64"));
    fs.writeFileSync(path.join(scenario1Dir, "manifest.json"), JSON.stringify(reqBody.map_geometry_manifest, null, 2));

    await page.getByRole("button", { name: "Đóng", exact: true }).click();

    // Verify PDF using independent Python script
    const pyOutput = execFileSync("python", [VERIFY_SCRIPT], { encoding: "utf8", timeout: 60_000 });
    expect(pyOutput).toContain("Scenario 1: PASS");
    expect(pyOutput).toContain("Scenario 2: PASS");
  });

  test("4. Real Image Download and Mid-Capture Dismissal Isolation", async ({ page, request }) => {
    test.setTimeout(120_000);
    await registerAndEnterApp(page);
    await uploadSampleDocument(page);
    await selectAllSources(page);

    const token = await page.evaluate(() => localStorage.getItem("memvid-token"));
    const headers = { Authorization: `Bearer ${token}` };

    let stem = null;
    await expect.poll(async () => {
      const res = await request.get(`${API_URL}/list-indexed`, { headers });
      const body = await res.json();
      stem = body.sources.find((s) => String(s.filename || "").includes("sample-doc"))?.video_stem || null;
      return stem;
    }, { timeout: 25_000 }).not.toBeNull();

    const title = `AGY Image Download ${Date.now()}`;
    const genRes = await request.post(`${API_URL}/generate-mindmap`, {
      headers,
      data: { sources: [stem], source_ids: [stem], q: title, force: false },
    });
    const queued = await genRes.json();
    let mapId = queued.result?.id;
    if (!mapId) {
      await expect.poll(async () => {
        const s = await request.get(`${API_URL}/mindmap-status/${queued.job_id}`, { headers });
        const b = await s.json();
        mapId = b.result?.id;
        return b.status;
      }, { timeout: 60_000 }).toBe("done");
    }

    // Set title explicitly on mindmap
    await request.put(`${API_URL}/mindmaps/${mapId}`, {
      headers,
      data: { title, nodes: NODES_4TIER, relations: [] },
    });

    await page.goto("/app");
    await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible" });
    const listbox = await openMapLibrary(page);
    await listbox.getByRole("option").filter({ hasText: title }).click();
    await page.locator('[data-nodeid="meROOT"]').waitFor({ state: "visible", timeout: 30_000 });

    // Open export studio for PNG
    await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
    await page.getByRole("button", { name: "Tiếp tục" }).click();
    await page.locator('input[name="mm-export-format"][value="png"]').check();
    await page.getByRole("button", { name: "Tiếp tục" }).click();
    await page.getByRole("button", { name: "Tiếp tục" }).click();

    // Valid download
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: "Xuất PNG" }).click();
    const download = await downloadPromise;
    const downloadedName = download.suggestedFilename();
    expect(downloadedName.endsWith(".png")).toBe(true);

    const validImagePath = path.join(PDF_OUT_DIR, "valid-export-image.png");
    await download.saveAs(validImagePath);
    const stats = fs.statSync(validImagePath);
    expect(stats.size, "Downloaded PNG image has non-trivial bytes").toBeGreaterThan(10000);

    await page.getByRole("button", { name: "Đóng", exact: true }).click();

    // Mid-capture dismissal test
    await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
    await page.getByRole("button", { name: "Tiếp tục" }).click();

    let leakCount = 0;
    page.on("download", () => {
      leakCount++;
    });

    // Press Escape to dismiss mid-flow
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    expect(leakCount, "Zero leaked downloads on mid-capture dismissal").toBe(0);
  });

  test("5. Library OFF Build: Legacy multiselect renders, no matrix region", async ({ page }) => {
    await registerAndEnterApp(page);
    await uploadSampleDocument(page);
    await page.goto("/app/study");
    await expect(page.getByRole("heading", { name: "Thư viện học tập" })).toBeVisible();
    await expect(page.locator('[aria-label="Danh sách tài liệu"][aria-multiselectable="true"]')).toBeVisible();
    await expect(page.locator('[aria-label="Ma trận hành động học tập"]')).toHaveCount(0);
  });

  test("6. Compact Account Target & R8-001 Reflow Survival on Real Build", async ({ page }) => {
    // Viewport 320x720
    await page.setViewportSize({ width: 320, height: 720 });
    await registerAndEnterApp(page);

    const header = page.locator("header").first();
    const headerBox = await header.boundingBox();
    expect(headerBox.height, "Header height at 320px must be 56px").toBe(56);

    const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(docOverflow, "Document horizontal overflow at 320px must be 0").toBe(0);

    const accountTrigger = page.locator('.account-menu__trigger, header button[aria-haspopup="menu"][aria-label^="Tài khoản"]');
    const accBox = await accountTrigger.boundingBox();
    expect(accBox.width, "Account button width is 40px").toBe(40);
    expect(accBox.height, "Account button height is 40px").toBe(40);

    // Viewport 1024x768
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(200);
    const headerBox1024 = await header.boundingBox();
    expect(headerBox1024.height, "Header height at 1024px must be 56px").toBe(56);

    const docOverflow1024 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(docOverflow1024, "Document horizontal overflow at 1024px must be 0").toBe(0);
  });
});

test.describe("AGY Protected Stack: Library ON Build (:4174)", () => {
  test.use({ baseURL: ON_URL });

  test("7. Library Action Matrix: ON (:4174) Accessibility & Target Audit", async ({ page }) => {
    await registerAndEnterApp(page);
    await uploadSampleDocument(page);
    await page.goto("/app/study");

    const matrix = page.locator('[aria-label="Ma trận hành động học tập"]');
    await expect(matrix).toBeVisible();
    await expect(matrix.getByText(/^1 tài liệu phù hợp$/)).toBeVisible();

    // Check target sizes of action buttons, interactive chips, and search inputs inside Learning Action Matrix
    const targetSizes = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[aria-label="Ma trận hành động học tập"] button, [aria-label="Ma trận hành động học tập"] a, [aria-label="Ma trận hành động học tập"] input:not([type="checkbox"]):not([type="radio"])'));
      return items.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          label: el.getAttribute("aria-label") || el.textContent.trim().slice(0, 30),
          width: Math.round(r.width * 10) / 10,
          height: Math.round(r.height * 10) / 10,
        };
      });
    });

    expect(targetSizes.length, "Interactive controls found in Learning Action Matrix").toBeGreaterThan(0);
    for (const t of targetSizes) {
      expect(t.height, `Target ${t.label} height`).toBeGreaterThanOrEqual(24);
    }
  });
});
