// @vitest-environment jsdom
// V5-A branding: the retired MemVidX marks (favicon "M" + "X" badge, the "M" seal beside the
// wordmark) must not come back, and the favicon is served from a new URL so browsers do not keep
// showing the cached MemVidX icon.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import BrandMark from "./BrandMark";
import indexHtml from "../../../index.html?raw";
import markSvg from "../../../public/studymap-mark.svg?raw";
import faviconSvg from "../../../public/favicon.svg?raw";
import landingSource from "../../pages/Landing.jsx?raw";
import shellSource from "../Layout/MainLayout.jsx?raw";
import markSource from "./BrandMark.jsx?raw";
import fs from "node:fs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("StudyMap brand mark", () => {
  it("index.html points the tab icon at the new mark URL, not the cached /favicon.svg", () => {
    expect(indexHtml).toContain('rel="icon" type="image/svg+xml" href="/studymap-mark.svg"');
    expect(indexHtml).not.toMatch(/rel="icon"[^>]*href="\/favicon\.svg"/);
    expect(indexHtml).toContain("<title>StudyMap");
  });

  it("neither icon file carries the MemVidX letterform or X badge", () => {
    for (const svg of [markSvg, faviconSvg]) {
      expect(svg).not.toMatch(/<text[\s>]/);            // the old icon was a typeset "M"
      expect(svg).not.toContain("M46 12 L52 18");       // the old "X" badge stroke
      expect(svg).toContain("<title>StudyMap</title>");
    }
    expect(faviconSvg.replace(/\r\n/g, "\n")).toBe(markSvg.replace(/\r\n/g, "\n"));
  });

  it("static icon and component share geometry, and the static tile is the light --seal", () => {
    // Static SVG files cannot read CSS variables: their tile is pinned to the light theme value.
    // (`index.css?raw` is empty under Vitest's CSS handling, so read the file.)
    const lightSeal = fs.readFileSync("src/index.css", "utf8").match(/--seal:\s*(#[0-9A-Fa-f]{6})/)[1];
    expect(markSvg).toContain(`<rect x="2" y="2" width="60" height="60" rx="15" fill="${lightSeal}" />`);
    expect(markSource).toContain(`fill="var(--seal, ${lightSeal})"`);
    const shapes = (s) => [...s.matchAll(/ (?:d|cx|cy|r|rx|viewBox)="[^"]+"/g)].map((m) => m[0]).join("");
    expect(shapes(markSource)).toBe(shapes(markSvg));
  });

  it("landing header and app shell use BrandMark, not the retired 'M' seal", () => {
    for (const source of [landingSource, shellSource]) {
      expect(source).toContain("<BrandMark");
      expect(source).not.toContain('transform: "rotate(-4deg)"');
      expect(source).not.toMatch(/aria-hidden\s*>\s*M\s*</);
    }
  });

  it("renders a decorative SVG with no text (the link carries the accessible name)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<BrandMark size={16} />));
    const svg = container.querySelector("svg[data-brand-mark]");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.textContent.trim()).toBe("");
    act(() => root.unmount());
    container.remove();
  });
});
