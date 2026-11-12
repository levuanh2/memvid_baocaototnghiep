// The spec files the blocking "Fixture Smoke" CI job runs (job `fixture-smoke` in
// .github/workflows/ci.yml). Prints one path per line for `npx playwright test ...`.
//
// The full fixture suite (about 600 tests, 25 minutes) stays in fixture-audit.yml. This list is
// the part that gates a merge: specs for regressions that reached users or review, chosen so
// the whole job stays a few minutes long.
//
// REQUIRED: must exist. A missing file is an error (exit 1): a renamed or deleted spec must
// never drop out of the gate silently.
//
// WHEN_PRESENT: specs that are added by V6 pull requests which are still open. Each one joins
// the gate in the same commit that brings the file to `main`; until then it is reported on
// stderr and skipped. Move an entry to REQUIRED once its pull request has merged.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED = [
  // Round 8 smoke set (unchanged).
  "e2e-fixture/mobile-header.spec.js",
  "e2e-fixture/round6-library-action-matrix.spec.js",
  "e2e-fixture/export-studio.spec.js",
  "e2e-fixture/exact-node-export-v3.spec.js",
  "e2e-fixture/exact-branch-artifact-gates.spec.js",
  "e2e-fixture/post-pr77-exact-selection.spec.js",
  "e2e-fixture/multi-branch-export-connectors.spec.js",
  "e2e-fixture/multi-branch-export-raster-connectors.spec.js",
  "e2e-fixture/mindmap-depth-presets.spec.js",
  "e2e-fixture/mobile-touch-selection.spec.js",
  // Added in V6: regressions that passed CI only because their spec was outside the gate.
  "e2e-fixture/summary-mode-recovery.spec.js",      // Summary mode could not create or open a summary
  "e2e-fixture/no-documents-empty-state.spec.js",   // empty library offered "select a document"
  "e2e-fixture/chat-mobile-empty-state.spec.js",    // chat start pointed at a column phones do not have
  "e2e-fixture/library-mode-navigation.spec.js",    // Library actions opened the wrong mode
  "e2e-fixture/knowledge-map-header.spec.js",       // knowledge-map exits and export menu
  "e2e-fixture/a11y-names.spec.js",                 // controls without an accessible name
];

export const WHEN_PRESENT = [
  "e2e-fixture/source-loading-state.spec.js",    // #160: false "empty library" while the list loads
  "e2e-fixture/chat-start.spec.js",              // #161: chat start screen
  "e2e-fixture/knowledge-map-keyboard.spec.js",  // #164: map nodes usable from the keyboard
  "e2e-fixture/summary-loading-state.spec.js",   // #165: false "Chưa có tóm tắt", first-commit flash
  "e2e-fixture/landing-v6.spec.js",              // #159: landing overflow, touch targets, copy
];

/** { specs, missingRequired, pending } for the FE directory `root`. */
export function resolveSmokeSpecs(root, exists = existsSync) {
  const here = (file) => exists(path.join(root, file));
  return {
    specs: [...REQUIRED.filter(here), ...WHEN_PRESENT.filter(here)],
    missingRequired: REQUIRED.filter((file) => !here(file)),
    pending: WHEN_PRESENT.filter((file) => !here(file)),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { specs, missingRequired, pending } = resolveSmokeSpecs(root);
  if (missingRequired.length) {
    console.error(`fixture-smoke: required spec(s) missing:\n  ${missingRequired.join("\n  ")}`);
    process.exit(1);
  }
  for (const file of pending) console.error(`fixture-smoke: not on this branch yet, skipped: ${file}`);
  console.error(`fixture-smoke: ${specs.length} spec file(s)`);
  process.stdout.write(specs.join("\n") + "\n");
}
