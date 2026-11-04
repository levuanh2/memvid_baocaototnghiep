// R5 trial server configuration. Keep dependency optimization local to this
// worktree even when agents share an installed node_modules tree.
import { mergeConfig } from "vite";
import baseConfig from "./vite.config.js";

export default mergeConfig(baseConfig, {
  // Keep generated dependencies outside FE so `eslint .` never scans them.
  cacheDir: "../.tmp/vite-r5-cache",
});
