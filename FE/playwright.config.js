// Real-browser E2E against a REAL running frontend (production Vite build,
// served statically) and a REAL running backend (Flask, real routes/DB/auth
// — see BE/scripts/run_e2e_server.py for exactly what's mocked: only the
// two LangGraph pipelines that would otherwise call a live model provider).
//
// No live FPT/production Supabase/production AWS/real user credentials —
// see docs/ci/CI_ARCHITECTURE.md §5 "Live Provider Integration Strategy" for
// where THAT coverage lives instead (live-integration.yml, scheduled/manual).
import { defineConfig, devices } from "@playwright/test";

const FE_PORT = Number(process.env.E2E_FE_PORT || 4173);
const BE_PORT = Number(process.env.PORT || 8080);
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // ponytail: one worker. The suite shares one backend process and one
  // Postgres DB (documents/jobs), and several specs assert "no NEW POST
  // happened" by counting requests since a fixed point — parallel workers
  // would race on those counts and on job-store /mindmaps ordering. Upgrade
  // to per-worker DB schemas + worker-scoped fixtures if this suite's
  // runtime ever becomes the CI bottleneck; it isn't today (a handful of
  // specs against a mocked, sub-second backend).
  workers: 1,
  fullyParallel: false,
  retries: CI ? 1 : 0,
  reporter: CI
    ? [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]]
    : "list",
  use: {
    baseURL: `http://127.0.0.1:${FE_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Real Flask app, real routes, real Postgres — only QUERY_GRAPH/
      // MINDMAP_GRAPH are swapped for deterministic mocks. See that script's
      // own docstring for the full "why" and the env knobs it reads.
      command: `python ../BE/scripts/run_e2e_server.py`,
      url: `http://127.0.0.1:${BE_PORT}/health`,
      timeout: 60_000,
      reuseExistingServer: !CI,
      env: { PORT: String(BE_PORT) },
    },
    {
      // Real production build (FE/dist, built by the CI step right before
      // this config runs with VITE_API_URL pointed at the server above) —
      // `-s` gives SPA history-mode fallback so a hard reload on a deep
      // route (e.g. /app/study/map/:id, exercised by the reload-persistence
      // spec) doesn't 404 against a plain static file server.
      command: `npx serve -s dist -l ${FE_PORT}`,
      url: `http://127.0.0.1:${FE_PORT}`,
      timeout: 30_000,
      reuseExistingServer: !CI,
    },
  ],
});
