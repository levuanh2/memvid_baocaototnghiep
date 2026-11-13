// Owner decision (V6): the landing page describes what StudyMap does; it makes no absolute
// promise ("always", "every answer", "100%"). An answer is cited when the documents support
// it, and the page must not claim more than that.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./Landing.jsx", import.meta.url), "utf-8");
// Visible copy only: JSX text and string literals, not identifiers or comments.
const copy = [
  ...source.matchAll(/>([^<>{}]+)</g),
  ...source.matchAll(/"([^"]*[\p{L}][^"]*)"/gu),
].map((m) => m[1]).join("\n");

describe("Landing copy makes no absolute promise", () => {
  it.each([
    ["luôn"], ["mọi câu trả lời"], ["tất cả câu trả lời"], ["100%"], ["tuyệt đối"],
    ["chắc chắn"], ["không bao giờ sai"], ["chính xác hoàn toàn"],
  ])("does not say %s", (phrase) => {
    expect(copy.toLowerCase()).not.toContain(phrase);
  });

  it("the headline is one short sentence (at most 72 characters)", () => {
    const h1 = source.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim();
    expect(h1).toBeTruthy();
    expect(h1.length).toBeLessThanOrEqual(72);
  });
});
