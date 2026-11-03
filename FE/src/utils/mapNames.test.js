// V4.1 W1-1 (owner decision O2): exactly two map names in the UI.
// "Sơ đồ tư duy" = the editable mind map; "Bản đồ kiến thức" = the document
// structure page (/app/study/map/:id). Older names must not come back.
import { describe, expect, it } from "vitest";
import { BE_MAT } from "./tiepTucHoc";

const sources = import.meta.glob(["../**/*.{js,jsx}", "!../**/*.test.*", "!../dev/**", "!../r71qa.jsx", "!../round6LibraryQa.jsx"], {
  query: "?raw", import: "default", eager: true,
});

describe("map names", () => {
  it("source has no retired map names", () => {
    const hits = Object.entries(sources).flatMap(([file, text]) =>
      ["Bản đồ học tập", "Sơ đồ kiến thức", "Sơ đồ tri thức", 'nhan: "Sơ đồ"', 'label: "Sơ đồ"', 'nhan="Sơ đồ"', "tạo Sơ đồ!"]
        .filter((old) => text.includes(old)).map((old) => `${file}: ${old}`));
    expect(hits).toEqual([]);
  });

  it("surface labels use the two approved names", () => {
    expect(BE_MAT.mindmap).toBe("Sơ đồ tư duy");
    expect(BE_MAT.studymap).toBe("Bản đồ kiến thức");
  });
});
