// The Fixture Smoke list is a merge gate: a spec must not be able to leave it unnoticed.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REQUIRED, WHEN_PRESENT, resolveSmokeSpecs } from "./fixture-smoke-specs.mjs";

const FE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("fixture smoke spec list", () => {
  it("every required spec exists on this branch", () => {
    expect(resolveSmokeSpecs(FE).missingRequired).toEqual([]);
  });

  it("a missing required spec is reported, not dropped", () => {
    const gone = REQUIRED[0];
    const result = resolveSmokeSpecs(FE, (file) => !file.replaceAll("\\", "/").endsWith(gone) && existsSync(file));
    expect(result.missingRequired).toEqual([gone]);
    expect(result.specs).not.toContain(gone);
  });

  it("a when-present spec joins the list as soon as its file exists, and is listed as pending until then", () => {
    const all = resolveSmokeSpecs(FE, () => true);
    expect(all.specs).toEqual([...REQUIRED, ...WHEN_PRESENT]);
    expect(all.pending).toEqual([]);
    const none = resolveSmokeSpecs(FE, (file) => REQUIRED.some((required) => file.replaceAll("\\", "/").endsWith(required)));
    expect(none.specs).toEqual(REQUIRED);
    expect(none.pending).toEqual(WHEN_PRESENT);
  });

  it("the V6 regressions the owner asked to gate are in the list (2026-11-15)", () => {
    const all = [...REQUIRED, ...WHEN_PRESENT];
    for (const spec of [
      "e2e-fixture/quiz-review-v6.spec.js",
      "e2e-fixture/mobile-viewport.spec.js",
      "e2e-fixture/landing-wordmark-contrast.spec.js",
      "e2e-fixture/landing-v6.spec.js",
    ]) expect(all).toContain(spec);
  });

  it("every entry is a spec path Playwright collects (a malformed name would never match a file)", () => {
    // On this branch the WHEN_PRESENT files do not exist yet; a typo in a name would leave the
    // spec out of the gate forever. Each name must match the `<name>.spec.js` pattern Playwright
    // collects, and no entry may point outside e2e-fixture/.
    for (const spec of [...REQUIRED, ...WHEN_PRESENT]) {
      expect(spec).toMatch(/^e2e-fixture\/[a-z0-9-]+\.spec\.js$/);
    }
  });

  it("no spec is listed twice", () => {
    const all = [...REQUIRED, ...WHEN_PRESENT];
    expect(new Set(all).size).toBe(all.length);
  });

  it("the CI job runs this list and keeps its strict flags", () => {
    const ci = readFileSync(path.join(FE, "..", ".github", "workflows", "ci.yml"), "utf8");
    expect(ci).toContain("node scripts/fixture-smoke-specs.mjs");
    expect(ci).toMatch(/playwright test -c playwright\.fixture\.config\.js --workers=1 --fail-on-flaky-tests/);
  });
});
