import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.resolve(globalThis.process.cwd(), file), "utf8");

describe("compact StudyMap workspace contract", () => {
  it("uses compact header and library dimensions", () => {
    const layout = read("src/components/Layout/MainLayout.jsx");
    const css = read("src/index.css");
    expect(layout).toContain('className="flex items-center gap-4 px-4 sm:px-5 h-[56px]');
    expect(css).toMatch(/\.mode-library-menu\s*\{[^}]*width:\s*min\(400px/);
  });

  it("keeps mindmap typography within the compact reading scale", () => {
    const css = read("src/components/mindmap/mindmap.css");
    expect(css).toMatch(/\.me-container me-root me-tpc\s*\{[^}]*font-size:\s*20px/);
    expect(css).toMatch(/\.me-container me-tpc\s*\{\s*font-size:\s*13px/);
  });

  it("has one collapse affordance per source and inspector surface", () => {
    const left = read("src/components/Layout/SidebarLeft.jsx");
    const right = read("src/components/Layout/SidebarRight.jsx");
    expect(left.match(/onClick=\{onClose\}/g)).toHaveLength(1);
    const closeButton = read("src/components/Layout/ContextPanelCloseButton.jsx");
    expect(right.match(/<ContextPanelCloseButton/g)).toHaveLength(1);
    expect(closeButton.match(/onClick=\{onClose\}/g)).toHaveLength(1);
  });

  it("keeps the global mode switch responsible for mode switching only", () => {
    const layout = read("src/components/Layout/MainLayout.jsx");
    const modeSwitch = layout.slice(
      layout.indexOf('<nav role="tablist" aria-label="Chế độ Workspace"'),
      layout.indexOf("{/* Right actions */}"),
    );

    expect(modeSwitch).not.toContain("ModeLibraryMenu");
    expect(modeSwitch).not.toContain("const count =");
    expect(modeSwitch).not.toContain("▾");
    expect(modeSwitch).not.toContain("openModeLibrary");
  });

  it("uses one shared 48px contextual-toolbar contract for Summary and Mind Map", () => {
    const summary = read("src/components/Layout/SummaryPane.jsx");
    const mindmap = read("src/components/mindmap/MindElixirView.jsx");
    const css = read("src/index.css") + read("src/components/mindmap/mindmap.css");

    expect(summary).toContain('className="artifact-toolbar');
    expect(mindmap).toContain('className="artifact-toolbar');
    expect(css).toMatch(/\.artifact-toolbar\s*\{[^}]*height:\s*48px/);
  });

  it("exposes one Mind Map library trigger and one create-new action inside that library", () => {
    const mindmap = read("src/components/mindmap/MindElixirView.jsx");
    expect(mindmap.match(/aria-label="Mở thư viện sơ đồ"/g)).toHaveLength(1);
    expect(mindmap.match(/Tạo sơ đồ mới/g)).toHaveLength(1);
    expect(mindmap).not.toContain('className="mm-context-action"');
  });
});
