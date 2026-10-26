import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STUDY_MAP_LIVE_CSS,
  STUDY_MAP_MARKS,
  wrapStudyMapLabel,
} from "./StudyMapView";
import { recordToMindElixir } from "../../utils/mindElixirAdapter";
import { buildMapTree } from "../../utils/studyApi";
import { fourTierMapFixture } from "../../test/fixtures/fourTierMapFixture";

const studySource = fs.readFileSync(new URL("./StudyMapView.jsx", import.meta.url), "utf8");
const mindMapCss = fs.readFileSync(new URL("../../components/mindmap/mindmap.css", import.meta.url), "utf8");

describe("shared four-tier map visual grammar", () => {
  it("feeds one deterministic four-tier fixture through both production adapters", () => {
    const { mindData } = recordToMindElixir(fourTierMapFixture.mindmapRecord, { fullTitles: true });
    const studyTree = buildMapTree(fourTierMapFixture.studyNodes);
    expect(mindData.nodeData.id).toBe("root");
    expect(mindData.nodeData.children[0].children[0].children[0].id).toBe("detail-deadlock");
    expect(studyTree.attributes.node_id).toBe("root");
    expect(studyTree.children[0].children[0].children[0].attributes.node_type).toBe("example");
    expect(fourTierMapFixture).toMatchObject({
      selectedNodeId: "concept-scheduling",
      collapsedNodeId: "section-memory",
      searchQuery: "bế tắc",
    });
  });

  it("pins the four StudyMap semantic roles to the normative size and weight hierarchy", () => {
    expect(STUDY_MAP_MARKS).toMatchObject({
      root: { r: 9, text: 16, weight: 600, strokeWidth: 2.2 },
      section: { r: 7, text: 14, weight: 600, strokeWidth: 2 },
      concept: { r: 5, text: 13, weight: 500, strokeWidth: 1.5 },
      example: { r: 3.5, text: 12, weight: 400, strokeWidth: 1.2 },
    });
    expect(studySource).toContain("data-map-role={attrs.node_type");
  });

  it("wraps a long Vietnamese title at word boundaries and ellipsizes beyond three tspans", () => {
    const title = "Cơ chế điều phối tiến trình hiện đại bảo đảm công bằng phản hồi nhanh và tránh bế tắc trong hệ thống nhiều lõi";
    const lines = wrapStudyMapLabel(title, { maxChars: 24, maxLines: 3 });
    expect(lines).toHaveLength(3);
    expect(lines.at(-1)).toMatch(/…$/u);
    expect(lines.every((line) => line.length > 1)).toBe(true);
    expect(studySource).toContain("<tspan");
    expect(studySource).not.toContain("slice(0, 46)");
  });

  it("keeps connector paths unfilled and differentiates trunk, branch and leaf strokes", () => {
    expect(STUDY_MAP_LIVE_CSS).toContain("fill: none !important");
    expect(STUDY_MAP_LIVE_CSS).toContain("study-map__link--trunk");
    expect(STUDY_MAP_LIVE_CSS).toContain("stroke-width: 2px");
    expect(STUDY_MAP_LIVE_CSS).toContain("stroke-width: 1.5px");
    expect(STUDY_MAP_LIVE_CSS).toContain("stroke-width: 1.2px");
  });

  it("keeps selected, search-match and collapsed affordances structurally distinct", () => {
    expect(studySource).toContain("study-map__selection-aura");
    expect(studySource).toContain('data-search-match={isMatch ? (isActiveMatch ? "active" : "match")');
    expect(studySource).toContain("study-map__collapse-dot");
    expect(studySource).toContain("strokeDasharray=\"2 2\"");
  });

  it("preserves depth-one mobile initialization and a 44px SVG touch diameter", () => {
    expect(studySource).toContain("initialDepth={1}");
    expect(studySource).toContain('r={22} fill="transparent"');
    expect(studySource).toContain("MOBILE_SCALE_MIN = 0.65");
    expect(mindMapCss).toContain("width: max(44px, 100%)");
    expect(mindMapCss).toContain("max-width: 180px");
  });

  it("uses shared tokens and scopes the lattice away from the export sandbox", () => {
    expect(studySource).toContain("var(--bg-base)");
    expect(studySource).toContain("var(--border-strong), transparent 68%");
    expect(studySource).toContain('fontFamily: \'Aptos, -apple-system');
    expect(mindMapCss).toContain("background: var(--accent-cta) !important");

    const latticeRule = mindMapCss.match(/\.mm-canvas-wrap\s*\{[^}]*radial-gradient[^}]*\}/s)?.[0] || "";
    expect(latticeRule).toContain("24px 24px");
    expect(latticeRule).not.toContain(".mm-export-offscreen");
    const exportRules = [...mindMapCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) => selector.trim().startsWith(".mm-export-offscreen"));
    expect(exportRules.every(([, , body]) => !body.includes("radial-gradient"))).toBe(true);
  });
});
