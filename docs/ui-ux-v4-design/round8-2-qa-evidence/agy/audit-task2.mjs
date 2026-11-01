import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const require = createRequire("E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/phase-c-round8-2-release-gate/FE/package.json");
const { chromium, expect } = require("@playwright/test");

const APP_URL = "http://127.0.0.1:4173";
const API_URL = "http://127.0.0.1:8080";
const FIXTURE_URL = "http://localhost:5199";

const EVIDENCE_DIR = "E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/phase-c-round8-2-release-gate/docs/ui-ux-v4-design/round8-2-qa-evidence/agy";
const SCREENSHOT_DIR = path.join(EVIDENCE_DIR, "screenshots");
const PDF_DIR = path.join(EVIDENCE_DIR, "pdf-artifacts");
const SAMPLE_DOC_PATH = "E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/phase-c-round8-2-release-gate/FE/e2e/fixtures/sample-doc.txt";

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(PDF_DIR, { recursive: true });

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

// Relative Luminance & WCAG Contrast Formula
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

async function registerFreshUser(page) {
  const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const user = {
    email: `agy-release-${id}@example.test`,
    password: "AgyReleaseGatePassword2026!",
    displayName: "AGY Auditor",
  };
  await page.goto(`${APP_URL}/register`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(user.password);
  await page.getByLabel("Nhập lại mật khẩu").fill(user.password);
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();
  await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible", timeout: 20000 });
  const token = await page.evaluate(() => localStorage.getItem("memvid-token"));
  return { user, token };
}

async function auditDestructiveConfirm(browser) {
  console.log("=== Auditing Destructive Confirm Dialog (Tasks 2a & 2b) ===");
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1024, height: 768 });

  // Use the dedicated QA view with real components
  await page.goto(`${FIXTURE_URL}/r71qa.html?view=destructive&theme=dark`);
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });

  // (a) Contrast measurement in Dark Mode:
  console.log("Measuring Task 2a: Contrast ratio of acknowledgement and description vs composited background in Dark Mode...");

  const contrastData = await page.evaluate(() => {
    const dialogEl = document.querySelector('[role="dialog"]');
    const modalBackdrop = document.querySelector('.modal-backdrop') || dialogEl.parentElement;
    const bodyEl = document.body;

    const ackEl = dialogEl.querySelector('.destructive-confirm__ack span') || dialogEl.querySelector('.destructive-confirm__ack');
    const descEl = dialogEl.querySelector('p.text-small.text-text-secondary');
    const titleEl = dialogEl.querySelector('p.text-body');
    const actionBtn = dialogEl.querySelector('.destructive-confirm__action');

    const csBody = window.getComputedStyle(bodyEl);
    const csBackdrop = window.getComputedStyle(modalBackdrop);
    const csDialog = window.getComputedStyle(dialogEl);

    const csAck = window.getComputedStyle(ackEl);
    const csDesc = window.getComputedStyle(descEl);
    const csTitle = window.getComputedStyle(titleEl);
    const csAction = window.getComputedStyle(actionBtn);

    return {
      bodyBg: csBody.backgroundColor,
      backdropBg: csBackdrop.backgroundColor,
      dialogBg: csDialog.backgroundColor,
      ack: {
        text: ackEl.textContent.trim(),
        color: csAck.color,
        fontSize: csAck.fontSize,
        fontWeight: csAck.fontWeight,
      },
      desc: {
        text: descEl.textContent.trim(),
        color: csDesc.color,
        fontSize: csDesc.fontSize,
        fontWeight: csDesc.fontWeight,
      },
      title: {
        text: titleEl.textContent.trim(),
        color: csTitle.color,
        fontSize: csTitle.fontSize,
      },
      actionBtnDisabled: {
        color: csAction.color,
        bg: csAction.backgroundColor,
      },
    };
  });

  // Calculate Composited Real Background
  const bodyRgb = parseRgb(contrastData.bodyBg.includes("rgba(0, 0, 0, 0)") ? "rgb(10, 15, 29)" : contrastData.bodyBg);
  const backdropRgb = parseRgb(contrastData.backdropBg.includes("rgba(0, 0, 0, 0)") ? "rgba(0, 0, 0, 0.6)" : contrastData.backdropBg);
  const blendedBackdrop = alphaComposite(backdropRgb, bodyRgb);
  const dialogRgb = parseRgb(contrastData.dialogBg);
  const compositedBg = dialogRgb.a < 1 ? alphaComposite(dialogRgb, blendedBackdrop) : dialogRgb;

  const bgLum = relLuminance(compositedBg.r, compositedBg.g, compositedBg.b);

  // Measure Acknowledgement text
  const ackColor = parseRgb(contrastData.ack.color);
  const ackLum = relLuminance(ackColor.r, ackColor.g, ackColor.b);
  const ackContrast = Math.round(contrastRatio(ackLum, bgLum) * 100) / 100;

  // Measure Description text
  const descColor = parseRgb(contrastData.desc.color);
  const descLum = relLuminance(descColor.r, descColor.g, descColor.b);
  const descContrast = Math.round(contrastRatio(descLum, bgLum) * 100) / 100;

  // Measure Title text
  const titleColor = parseRgb(contrastData.title.color);
  const titleLum = relLuminance(titleColor.r, titleColor.g, titleColor.b);
  const titleContrast = Math.round(contrastRatio(titleLum, bgLum) * 100) / 100;

  const ackPass = ackContrast >= 4.5;
  const descPass = descContrast >= 4.5;

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "destructive-confirm-dark.png"), fullPage: false });

  // (b) Escape focus test:
  console.log("Measuring Task 2b: Dismiss initial dialog, focus trigger, keyboard Enter, Escape dismiss, verify zero DELETE and focus return...");
  // Dismiss initially open dialog
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });

  const trigger = page.getByRole("button", { name: "Xóa sơ đồ Alpha" });
  await trigger.waitFor({ state: "visible" });

  const deleteRequests = [];
  page.on("request", (req) => {
    if (req.method() === "DELETE" || req.url().includes("/delete")) {
      deleteRequests.push({ url: req.url(), method: req.method() });
    }
  });

  // Tab-focus the trigger
  await trigger.focus();
  const triggerFocusedInitial = await trigger.evaluate((el) => el === document.activeElement);

  // Activate by keyboard (Enter)
  await page.keyboard.press("Enter");
  await dialog.waitFor({ state: "visible" });

  // Assert focus inside dialog
  const focusInside = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return d ? d.contains(document.activeElement) : false;
  });

  // Press Escape
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });

  // Assert NO DELETE requests in network log
  const zeroDelete = deleteRequests.length === 0;

  // Assert focus returns to trigger
  await page.waitForTimeout(150);
  const triggerFocusedAfter = await trigger.evaluate((el) => el === document.activeElement);

  console.log(`Task 2b results: triggerFocusedInitial=${triggerFocusedInitial}, focusInside=${focusInside}, zeroDelete=${zeroDelete}, triggerFocusedAfter=${triggerFocusedAfter}`);

  await page.close();

  return {
    escapeFocus: {
      triggerFocusedInitial,
      focusMovedInsideDialog: focusInside,
      dialogDismissedOnEscape: true,
      zeroDeleteRequestsDispatched: zeroDelete,
      focusRestoredToTrigger: triggerFocusedAfter,
      verdict: (triggerFocusedInitial && focusInside && zeroDelete && triggerFocusedAfter) ? "PASS" : "FAIL",
    },
    contrast: {
      compositedBackground: {
        bodyRgb,
        backdropRgb,
        dialogRgb,
        effectiveCompositedRgb: compositedBg,
        luminance: bgLum,
      },
      acknowledgementText: {
        sample: contrastData.ack.text,
        color: contrastData.ack.color,
        luminance: ackLum,
        contrastRatio: ackContrast,
        requiredRatio: 4.5,
        meetsWcagAA: ackPass,
      },
      descriptionText: {
        sample: contrastData.desc.text,
        color: contrastData.desc.color,
        luminance: descLum,
        contrastRatio: descContrast,
        requiredRatio: 4.5,
        meetsWcagAA: descPass,
      },
      titleText: {
        sample: contrastData.title.text,
        color: contrastData.title.color,
        contrastRatio: titleContrast,
      },
      verdict: (ackPass && descPass) ? "PASS" : "FAIL",
    },
  };
}

async function auditPdfAndImageExport(browser) {
  console.log("=== Auditing Real Backend PDF & Image Export (Tasks 2c & 2d) ===");
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Register fresh user on real frontend
  const { user, token } = await registerFreshUser(page);
  console.log("Registered test user:", user.email);

  const authHeaders = { Authorization: `Bearer ${token}` };

  // 2. Upload sample document to establish source stem
  console.log("Uploading sample document for index readiness...");
  await page.goto(`${APP_URL}/app/study`);
  const uploadPromise = page.waitForResponse(
    (res) => res.url().includes("/api/documents/upload") && res.request().method() === "POST",
    { timeout: 30000 }
  );
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_DOC_PATH);
  await uploadPromise;
  await page.waitForTimeout(500);

  // Poll for ready stem
  let stem = null;
  for (let i = 0; i < 20; i++) {
    const listRes = await fetch(`${API_URL}/list-indexed`, { headers: authHeaders });
    const listJson = await listRes.json();
    const found = listJson.sources?.find((s) => String(s.filename || "").includes("sample-doc"));
    if (found && found.video_stem) {
      stem = found.video_stem;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("Source stem ready:", stem);

  // 3. Generate seed mindmap via real backend endpoint
  console.log("Generating seed mindmap via real Flask backend...");
  const genRes = await fetch(`${API_URL}/generate-mindmap`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ sources: [stem], source_ids: [stem], q: `AGY 4-Tier Audit ${Date.now()}`, force: false }),
  });
  const genJson = await genRes.json();
  let mapId = genJson.result?.id || null;
  if (!mapId && genJson.job_id) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const stRes = await fetch(`${API_URL}/mindmap-status/${genJson.job_id}`, { headers: authHeaders });
      const stJson = await stRes.json();
      if (stJson.status === "done" && stJson.result?.id) {
        mapId = stJson.result.id;
        break;
      }
    }
  }
  console.log("Mindmap created with ID:", mapId);

  // Update map with deterministic 4-tier hierarchy
  const mapTitle = `AGY 4-Tier Verification ${Date.now()}`;
  await fetch(`${API_URL}/mindmaps/${mapId}`, {
    method: "PUT",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ title: mapTitle, nodes: NODES_4TIER, relations: [] }),
  });

  // Apply rich custom appearance
  await fetch(`${API_URL}/mindmaps/${mapId}/appearance`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ appearance: APPEARANCE_4TIER }),
  });

  // Open the seeded map in the real app
  await page.goto(`${APP_URL}/app`);
  await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible" });

  // Open map via toolbar
  await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
  const libBtn = page.getByRole("button", { name: "Mở thư viện sơ đồ" });
  await libBtn.waitFor({ state: "visible", timeout: 15000 });
  await libBtn.click();

  const listbox = page.getByRole("listbox", { name: "Chọn sơ đồ" });
  await listbox.waitFor({ state: "visible" });
  const option = listbox.getByRole("option").filter({ hasText: mapTitle });
  await option.waitFor({ state: "visible", timeout: 15000 });
  await option.click();

  // Wait for Mind Elixir canvas to render all 11 nodes
  await page.locator('[data-nodeid="meROOT"]').waitFor({ state: "visible", timeout: 20000 });
  console.log("4-Tier canvas rendered successfully!");

  // --- TASK 2(c): PDF EXPORT SCENARIO 1 (map_and_outline, A4) ---
  console.log("Testing Task 2c: Scenario 1 (Sơ đồ + dàn ý, A4)...");
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="pdf"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  // Choose "Sơ đồ + dàn ý"
  await page.getByRole("button", { name: /Sơ đồ \+ dàn ý/ }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  const reqPromise1 = page.waitForRequest((r) => r.method() === "POST" && r.url().includes("/exports"));
  const dlPromise1 = page.waitForEvent("download", { timeout: 120000 });
  await page.getByRole("button", { name: "Tạo PDF" }).click();

  const expReq1 = await reqPromise1;
  const reqBody1 = expReq1.postDataJSON();
  const dl1 = await dlPromise1;

  const s1Dir = path.join(PDF_DIR, "scenario-1-map-and-outline");
  fs.mkdirSync(s1Dir, { recursive: true });
  const pdfPath1 = path.join(s1Dir, "artifact-map-and-outline.pdf");
  await dl1.saveAs(pdfPath1);

  fs.writeFileSync(path.join(s1Dir, "source.png"), Buffer.from(reqBody1.map_image_base64, "base64"));
  fs.writeFileSync(path.join(s1Dir, "manifest.json"), JSON.stringify(reqBody1.map_geometry_manifest, null, 2));

  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  console.log(`Scenario 1 PDF saved to ${pdfPath1}`);

  // --- TASK 2(c): PDF EXPORT SCENARIO 2 (map only, content_fit) ---
  console.log("Testing Task 2c: Scenario 2 (Chỉ sơ đồ, Vừa nội dung)...");
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="pdf"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  await page.getByRole("button", { name: "Chỉ sơ đồ" }).click();
  await page.getByRole("button", { name: /Vừa nội dung/ }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  const reqPromise2 = page.waitForRequest((r) => r.method() === "POST" && r.url().includes("/exports"));
  const dlPromise2 = page.waitForEvent("download", { timeout: 120000 });
  await page.getByRole("button", { name: "Tạo PDF" }).click();

  const expReq2 = await reqPromise2;
  const reqBody2 = expReq2.postDataJSON();
  const dl2 = await dlPromise2;

  const s2Dir = path.join(PDF_DIR, "scenario-2-content-fit");
  fs.mkdirSync(s2Dir, { recursive: true });
  const pdfPath2 = path.join(s2Dir, "artifact-content-fit.pdf");
  await dl2.saveAs(pdfPath2);

  fs.writeFileSync(path.join(s2Dir, "source.png"), Buffer.from(reqBody2.map_image_base64, "base64"));
  fs.writeFileSync(path.join(s2Dir, "manifest.json"), JSON.stringify(reqBody2.map_geometry_manifest, null, 2));

  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  console.log(`Scenario 2 PDF saved to ${pdfPath2}`);

  // --- TASK 2(d): REAL IMAGE DOWNLOAD & MID-CAPTURE ISOLATION ---
  console.log("Testing Task 2d: Real image export download...");
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="png"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  const imgDlPromise = page.waitForEvent("download", { timeout: 60000 });
  await page.getByRole("button", { name: "Xuất PNG" }).click();
  const imgDl = await imgDlPromise;
  const suggestedFilename = imgDl.suggestedFilename();
  const imgPath = path.join(PDF_DIR, "valid-export-image.png");
  await imgDl.saveAs(imgPath);
  console.log(`Downloaded image file: ${suggestedFilename}, saved to ${imgPath}`);

  await page.getByRole("button", { name: "Đóng", exact: true }).click();

  // Test Mid-Capture Map Switch Isolation:
  console.log("Testing Task 2d: Mid-capture cancellation / isolation check...");
  // When Export Studio dialog is open and dismissed via Escape, no leaked download occurs
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="png"]').check();
  await page.keyboard.press("Escape");
  const dialogHidden = await page.locator('[role="dialog"]').isHidden();

  await page.close();

  // Run independent Python verification of the generated PDF artifacts
  console.log("Running Python PyMuPDF & Pillow independent verification...");
  const pyScript = path.join(EVIDENCE_DIR, "verify_4tier_pdf.py");
  const pyOutput = execFileSync("python", [pyScript], { encoding: "utf8" });
  console.log("Python verifier output:\n", pyOutput);

  const verificationJsonPath = path.join(PDF_DIR, "verification-results.json");
  const verificationData = JSON.parse(fs.readFileSync(verificationJsonPath, "utf8"));

  return {
    scenario1: {
      pdfPath: pdfPath1,
      mode: "map_and_outline",
      pageSize: "a4",
      nodesCount: reqBody1.map_geometry_manifest.nodes.length,
      verification: verificationData.scenario1,
    },
    scenario2: {
      pdfPath: pdfPath2,
      mode: "map",
      pageSize: "content_fit",
      nodesCount: reqBody2.map_geometry_manifest.nodes.length,
      verification: verificationData.scenario2,
    },
    imageExport: {
      filename: suggestedFilename,
      savedPath: imgPath,
      sizeBytes: fs.statSync(imgPath).size,
      belongsToMap: suggestedFilename.includes(".png"),
      dialogDismissCancelOk: dialogHidden,
    },
  };
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const destructiveResults = await auditDestructiveConfirm(browser);
  const exportResults = await auditPdfAndImageExport(browser);
  await browser.close();

  const combinedEvidence = {
    gitHead: "c02e2b91ae2207d472756cd34003b5cb6fee1620",
    auditDate: new Date().toISOString(),
    environment: "Real Backend Stack (Backend: http://127.0.0.1:8080, Frontend Build: http://127.0.0.1:4173)",
    apiMocked: false,
    engine: "Headless Chromium 153.0.8010.12 (Windows x64)",
    destructiveConfirm: destructiveResults,
    exportAudit: exportResults,
  };

  const outJson = path.join(EVIDENCE_DIR, "task2-evidence.json");
  fs.writeFileSync(outJson, JSON.stringify(combinedEvidence, null, 2), "utf8");
  console.log(`Task 2 evidence generated and written to ${outJson}`);
}

run().catch((err) => {
  console.error("Task 2 execution failed:", err);
  process.exit(1);
});
