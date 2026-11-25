// Export Studio fixture-harness QA (Round 2, section 2/3/10) — a SEPARATE
// config from playwright.config.js on purpose. That config's webServer
// array starts a REAL Flask backend and serves a REAL production build —
// exactly what this suite must NOT depend on (no production API call, no
// auth, no CORS wall from a local origin — the blocker the previous round
// hit). This config's only webServer is Vite's own dev server, serving
// fixture-harness.html directly; there is no backend entry at all.
import { defineConfig, devices } from "@playwright/test";

const FE_PORT = Number(process.env.E2E_FIXTURE_PORT || 5199);
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e-fixture",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  retries: CI ? 1 : 0,
  reporter: CI
    ? [["html", { outputFolder: "playwright-fixture-report", open: "never" }], ["list"]]
    : "list",
  use: {
    // "localhost", not "127.0.0.1": Vite's dev server here binds only its
    // IPv6 loopback ([::1]) address, which "127.0.0.1" (IPv4) can't reach
    // on this host — verified with `netstat -ano` showing `[::1]:5199
    // LISTENING` and a plain IPv4 curl failing to connect while a
    // "localhost" curl (which resolves to ::1 first) succeeds.
    baseURL: `http://localhost:${FE_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    acceptDownloads: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Vite dev server ONLY — no backend, no production build. Serves
    // fixture-harness.html at the repo-relative path Vite already resolves
    // any root-level .html file at (see fixtureHarness.jsx's own header
    // comment for why this file exists).
    command: `npx vite --port ${FE_PORT} --strictPort`,
    url: `http://localhost:${FE_PORT}/fixture-harness.html`,
    timeout: 30_000,
    reuseExistingServer: !CI,
  },
});
