// R5 trial server configuration. Keep dependency optimization local to this
// worktree even when agents share an installed node_modules tree.
import { execSync } from "node:child_process";
import { mergeConfig } from "vite";
import baseConfig from "./vite.config.js";

function trialBuildSha() {
  try {
    const sha = execSync("git rev-parse --short=12 HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean)
      .some((line) => !/^(?:.. )?(?:\.tmp\/|FE\/test-results(?:-|\/)|FE\/playwright-report\/)/.test(line));
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "unknown";
  }
}

export default mergeConfig(baseConfig, {
  // Keep generated dependencies outside FE so `eslint .` never scans them.
  cacheDir: "../.tmp/vite-r5-cache",
  // Trial harness only. Production builds use vite.config.js directly and
  // never receive or render this value.
  define: {
    "import.meta.env.VITE_TRIAL_BUILD_SHA": JSON.stringify(trialBuildSha()),
  },
});
