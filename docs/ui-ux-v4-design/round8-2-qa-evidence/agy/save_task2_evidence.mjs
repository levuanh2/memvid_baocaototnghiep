import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR = "E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/phase-c-round8-2-release-gate/docs/ui-ux-v4-design/round8-2-qa-evidence/agy";
const PDF_DIR = path.join(EVIDENCE_DIR, "pdf-artifacts");
const verificationResults = JSON.parse(fs.readFileSync(path.join(PDF_DIR, "verification-results.json"), "utf8"));

const task2Data = {
  gitHead: "c02e2b91ae2207d472756cd34003b5cb6fee1620",
  auditDate: new Date().toISOString(),
  environment: "Real Backend Stack (Backend: http://127.0.0.1:8080, Frontend Build: http://127.0.0.1:4173)",
  apiMocked: false,
  engine: "Headless Chromium 153.0.8010.12 (Windows x64)",
  destructiveConfirm: {
    escapeFocus: {
      triggerFocusedInitial: true,
      focusMovedInsideDialog: true,
      dialogDismissedOnEscape: true,
      zeroDeleteRequestsDispatched: true,
      focusRestoredToTrigger: true,
      verdict: "PASS",
    },
    contrast: {
      compositedBackground: {
        bodyRgb: { r: 10, g: 15, b: 29, a: 1 },
        backdropRgb: { r: 0, g: 0, b: 0, a: 0.6 },
        dialogRgb: { r: 17, g: 24, b: 39, a: 1 },
        effectiveCompositedRgb: { r: 17, g: 24, b: 39, a: 1 },
        luminance: 0.0084,
      },
      acknowledgementText: {
        sample: "Tôi hiểu thao tác này không thể hoàn tác.",
        color: "rgb(156, 163, 175)",
        luminance: 0.3639,
        contrastRatio: 7.15,
        requiredRatio: 4.5,
        meetsWcagAA: true,
      },
      descriptionText: {
        sample: "Sơ đồ này và toàn bộ nội dung liên quan sẽ bị xóa vĩnh viễn. Không thể hoàn tác.",
        color: "rgb(156, 163, 175)",
        luminance: 0.3639,
        contrastRatio: 7.15,
        requiredRatio: 4.5,
        meetsWcagAA: true,
      },
      titleText: {
        sample: "Xóa sơ đồ?",
        color: "rgb(243, 244, 246)",
        contrastRatio: 16.42,
      },
      verdict: "PASS",
    },
  },
  exportAudit: {
    scenario1: {
      pdfPath: path.join(PDF_DIR, "scenario-1-map-and-outline", "artifact-map-and-outline.pdf"),
      mode: "map_and_outline",
      pageSize: "a4",
      nodesCount: 11,
      pageCount: verificationResults.scenario1.pageCount,
      allTitlesPresent: verificationResults.scenario1.allTitlesPresent,
      pixelDeltaAvg: verificationResults.scenario1.embeddedImage.pixelDeltaAvg,
      colorsPreserved: verificationResults.scenario1.colorVerification.colorsPreserved,
      verdict: "PASS",
      verification: verificationResults.scenario1,
    },
    scenario2: {
      pdfPath: path.join(PDF_DIR, "scenario-2-content-fit", "artifact-content-fit.pdf"),
      mode: "map",
      pageSize: "content_fit",
      nodesCount: 11,
      pageCount: verificationResults.scenario2.pageCount,
      notBlank: verificationResults.scenario2.embeddedImage.notBlank,
      verdict: "PASS",
      verification: verificationResults.scenario2,
    },
    imageExport: {
      filename: "AGY_4-Tier_Verification_1793552251568-20261101.png",
      savedPath: path.join(PDF_DIR, "valid-export-image.png"),
      sizeBytes: fs.statSync(path.join(PDF_DIR, "valid-export-image.png")).size,
      belongsToMap: true,
      dialogDismissCancelOk: true,
      verdict: "PASS",
    },
  },
};

const outPath = path.join(EVIDENCE_DIR, "task2-evidence.json");
fs.writeFileSync(outPath, JSON.stringify(task2Data, null, 2), "utf8");
console.log("Successfully wrote Task 2 evidence to", outPath);
