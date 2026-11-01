import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.resolve(here, "../../docs/ui-ux-v4-design/round8-2-qa-evidence/codex1");
export default defineConfig({
  testDir: here, testMatch: "quiz-10q-api-e2e.spec.js", timeout: 150_000,
  expect: { timeout: 15_000 }, workers: 1, fullyParallel: false, retries: 0,
  outputDir: path.join(evidence, "quiz-10q-playwright-artifacts"),
  reporter: [["list"], ["json", { outputFile: path.join(evidence, "quiz-10q-playwright-report.json") }]],
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure",
         screenshot: "only-on-failure", video: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
