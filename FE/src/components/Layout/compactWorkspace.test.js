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
    expect(right.match(/onClick=\{onClose\}/g)).toHaveLength(1);
  });
});
