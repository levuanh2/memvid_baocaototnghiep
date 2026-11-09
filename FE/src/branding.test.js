import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname);
const feDir = path.resolve(__dirname, "..");

function getSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getSourceFiles(fullPath));
    } else if (
      (entry.name.endsWith(".js") || entry.name.endsWith(".jsx")) &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".spec.")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("W1-3 branding: StudyMap is the only product name", () => {
  it("FE/src contains no rendered 'MemVidX' or '>MemVid<' or 'MemVid<' logo text", () => {
    const files = getSourceFiles(srcDir);
    const matches = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      const relPath = path.relative(srcDir, file).replace(/\\/g, "/");

      if (content.includes("MemVidX") || content.includes(">MemVid<") || content.includes("MemVid<")) {
        matches.push(relPath);
      }
    }

    expect(matches).toEqual([]);
  });

  it("FE/index.html title uses StudyMap", () => {
    const indexPath = path.join(feDir, "index.html");
    const content = fs.readFileSync(indexPath, "utf8");
    expect(content).not.toContain("MemVidX");
    expect(content).toContain("<title>StudyMap — Đọc · Truy hồi · Dẫn chứng</title>");
  });
});
