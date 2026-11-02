import base from "../playwright.fixture.config.js";

const port = Number(process.env.E2E_FIXTURE_PORT || 5301);

export default {
  ...base,
  testDir: ".",
  webServer: {
    ...base.webServer,
    command: `npx vite .. --port ${port} --strictPort`,
    url: `http://localhost:${port}/fixture-harness.html`,
  },
};
