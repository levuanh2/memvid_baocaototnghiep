// @vitest-environment node
//
// P2 fix guard: the rehomed Guided generation progress/retry UI
// (WorkspaceEmptyState.progress.test.jsx, MindElixirView.jobStatus.test.jsx)
// must NOT be achieved by flipping `legacyInspectorSurfacesEnabled` back on
// -- that flag also gates unrelated, genuinely-dead legacy Inspector
// surfaces ("Tạo từ tài liệu" panel, its own tab switcher, summary library
// list, etc.) that were never verified against the current architecture and
// must stay off unless proven otherwise. A plain source-text check catches
// an accidental `= true` in a future edit that unit tests of the new UI,
// which never touch this file, would not.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./SidebarRight.jsx", import.meta.url)), "utf-8");

describe("SidebarRight.jsx — legacyInspectorSurfacesEnabled stays off", () => {
  it("is declared false", () => {
    expect(source).toMatch(/const legacyInspectorSurfacesEnabled = false;/);
  });

  it("still gates exactly the two known-legacy blocks (no new one introduced, none removed)", () => {
    const matches = source.match(/legacyInspectorSurfacesEnabled &&/g) || [];
    expect(matches).toHaveLength(2);
  });
});
