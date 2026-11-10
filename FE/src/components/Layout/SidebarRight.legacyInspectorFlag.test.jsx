// @vitest-environment node
//
// P2 fix guard: the rehomed Guided generation progress/retry UI
// (WorkspaceEmptyState.progress.test.jsx, MindElixirView.jobStatus.test.jsx)
// must NOT be achieved by flipping `legacyInspectorSurfacesEnabled` back on
// -- that flag also gates the genuinely-dead legacy Inspector artifact
// block ("Tạo từ tài liệu" panel, summary library list, etc.) that was
// never verified against the current architecture and must stay off
// unless proven otherwise. A plain source-text check catches an accidental
// `= true` in a future edit that unit tests of the new UI, which never
// touch this file, would not.
//
// W3-4 (owner decision O4): this flag used to ALSO gate the right panel's
// own tab row -- one flag, two unrelated things, so turning the dead
// generator off silently took the tab row with it. Split into its own
// `rightPanelTabsEnabled` flag (see SidebarRight.tabRow.test.jsx for its
// own coverage); this file's job narrows to exactly the one block that
// must still stay off.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./SidebarRight.jsx", import.meta.url)), "utf-8");

describe("SidebarRight.jsx — legacyInspectorSurfacesEnabled stays off", () => {
  it("is declared false", () => {
    expect(source).toMatch(/const legacyInspectorSurfacesEnabled = false;/);
  });

  it("still gates exactly the one known-legacy artifact block (no new one introduced, none removed)", () => {
    const matches = source.match(/legacyInspectorSurfacesEnabled &&/g) || [];
    expect(matches).toHaveLength(1);
  });

  it("the right-panel tab row is on its OWN flag now, not this one", () => {
    expect(source).toMatch(/const rightPanelTabsEnabled = true;/);
    expect(source).toMatch(/rightPanelTabsEnabled && mode/);
  });
});
