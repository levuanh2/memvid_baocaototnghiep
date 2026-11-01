import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.resolve(here, "../../docs/ui-ux-v4-design/round8-2-qa-evidence/agy");

export default defineConfig({
  testDir: here,
  testMatch: "**/*.spec.js",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  outputDir: path.join(evidenceDir, "playwright-artifacts"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(evidenceDir, "agy-protected-playwright-report.json") }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
