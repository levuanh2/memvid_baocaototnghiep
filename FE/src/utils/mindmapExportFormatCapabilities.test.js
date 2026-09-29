import { describe, it, expect } from "vitest";
import {
  getExportFormatCapabilities, isDocumentFormat, isImageFormat,
  formatSupportsControl, formatSupportsContent,
} from "./mindmapExportFormatCapabilities";

describe("getExportFormatCapabilities", () => {
  it("returns the image capability set for png/jpeg/svg alike", () => {
    const png = getExportFormatCapabilities("png");
    const jpeg = getExportFormatCapabilities("jpeg");
    const svg = getExportFormatCapabilities("svg");
    expect(png).toEqual(jpeg);
    expect(png).toEqual(svg);
    expect(png.controls.spacing).toBe(true);
  });

  it("returns the pdf/docx/xlsx capability sets directly", () => {
    expect(getExportFormatCapabilities("pdf").controls.mode).toEqual(["outline", "map", "map_and_outline"]);
    expect(getExportFormatCapabilities("docx").controls.headingColor).toBe(true);
    expect(getExportFormatCapabilities("xlsx").controls.headerStyle).toBe(true);
  });

  it("throws for an unknown format", () => {
    expect(() => getExportFormatCapabilities("csv")).toThrow();
  });
});

describe("isDocumentFormat / isImageFormat", () => {
  it("classifies every real format correctly", () => {
    expect(isImageFormat("png")).toBe(true);
    expect(isImageFormat("pdf")).toBe(false);
    expect(isDocumentFormat("docx")).toBe(true);
    expect(isDocumentFormat("svg")).toBe(false);
  });
});

describe("formatSupportsControl / formatSupportsContent", () => {
  it("xlsx has no background/connector/orientation controls", () => {
    expect(formatSupportsControl("xlsx", "background")).toBe(false);
    expect(formatSupportsControl("xlsx", "connectorThickness")).toBe(false);
    expect(formatSupportsControl("xlsx", "orientation")).toBe(false);
  });

  it("docx has no background control and no legend content", () => {
    expect(formatSupportsControl("docx", "background")).toBe(false);
    expect(formatSupportsContent("docx", "legend")).toBe(false);
  });

  it("image supports transparent-capable background; pdf's background control exists but disallows transparent (checked via the raw shape, not a boolean helper)", () => {
    expect(formatSupportsControl("png", "background")).toBe(true);
    expect(formatSupportsControl("pdf", "background")).toBe(true);
    expect(getExportFormatCapabilities("pdf").controls.background.transparent).toBe(false);
  });

  it("pdf supports every required content toggle", () => {
    for (const key of ["notes", "citations", "sourceNames", "relations", "legend", "branding"]) {
      expect(formatSupportsContent("pdf", key)).toBe(true);
    }
  });
});
