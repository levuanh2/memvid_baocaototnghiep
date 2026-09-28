import { describe, it, expect } from "vitest";
import { sanitizeExportFilename, exportFilenameFor } from "./mindmapExportFilename";

describe("sanitizeExportFilename", () => {
  it("strips filesystem-unsafe characters", () => {
    expect(sanitizeExportFilename('Bad:Name/With*Chars?"<>|')).toBe("Bad_Name_With_Chars_");
  });
  it("collapses whitespace runs into a single underscore", () => {
    expect(sanitizeExportFilename("Sơ đồ   tư duy")).toBe("Sơ_đồ_tư_duy");
  });
  it("falls back to 'mindmap' for empty/whitespace-only input", () => {
    expect(sanitizeExportFilename("")).toBe("mindmap");
    expect(sanitizeExportFilename("   ")).toBe("mindmap");
    expect(sanitizeExportFilename(undefined)).toBe("mindmap");
  });
  it("truncates to the max length", () => {
    expect(sanitizeExportFilename("a".repeat(200)).length).toBe(80);
  });
});

describe("exportFilenameFor", () => {
  it("combines sanitized title, an ISO date stamp, and the extension", () => {
    const date = new Date("2026-09-28T00:00:00Z");
    expect(exportFilenameFor("My Map", "png", { date })).toBe("My_Map-20260928.png");
  });
});
