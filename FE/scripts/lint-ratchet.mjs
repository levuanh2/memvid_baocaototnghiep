#!/usr/bin/env node
// ponytail: simplest ratchet that actually works — total problem count vs a
// committed baseline, no per-file diffing. Upgrade to lint-staged/diff-only
// mode if the team wants "new files must be zero-lint" enforced per-PR.
//
// Fails CI only when the CURRENT total (errors+warnings) exceeds the
// committed baseline in .eslint-baseline.json. Existing debt is allowed;
// new debt is not. Lowering the baseline (fixing lint problems) is always
// allowed and expected over time — just edit the number down.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const feRoot = path.resolve(__dirname, "..");
const baselinePath = path.join(feRoot, ".eslint-baseline.json");

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

let raw;
try {
  raw = execFileSync(
    "npx",
    ["eslint", ".", "--format", "json"],
    { cwd: feRoot, encoding: "utf8", shell: true, maxBuffer: 1024 * 1024 * 32 }
  );
} catch (err) {
  // eslint exits non-zero when it finds problems — that's expected, the JSON
  // report is still on stdout.
  raw = err.stdout ?? "";
}

let results;
try {
  results = JSON.parse(raw);
} catch {
  console.error("lint-ratchet: could not parse eslint JSON output — failing closed.");
  console.error(raw.slice(0, 2000));
  process.exit(1);
}

let errors = 0;
let warnings = 0;
for (const file of results) {
  errors += file.errorCount ?? 0;
  warnings += file.warningCount ?? 0;
}
const total = errors + warnings;

console.log(`lint-ratchet: current=${total} (errors=${errors}, warnings=${warnings}) baseline=${baseline.problems}`);

if (total > baseline.problems) {
  console.error(
    `::error::ESLint problem count increased (${total} > baseline ${baseline.problems}). ` +
    `Fix the new problem(s) introduced by this change, or if the baseline itself was ` +
    `wrong, update FE/.eslint-baseline.json deliberately in its own commit.`
  );
  process.exit(1);
}

if (total < baseline.problems) {
  console.log(
    `lint-ratchet: nice — ${baseline.problems - total} fewer problem(s) than baseline. ` +
    `Consider lowering FE/.eslint-baseline.json to lock in the improvement.`
  );
}

process.exit(0);
