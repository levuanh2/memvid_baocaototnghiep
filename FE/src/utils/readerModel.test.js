import { describe, expect, it } from "vitest";
import {
  CITATION_STALE_MESSAGE,
  citationMatchesChunk,
  resolveWorkspaceDocument,
} from "./readerModel";

const docs = [
  { document_id: "d1", source_stem: "alpha", status: "completed" },
  { document_id: "d2", source_stem: "beta", status: "completed" },
];

describe("resolveWorkspaceDocument", () => {
  it("uses the caller-owned list and resolves one exact active stem", () => {
    expect(resolveWorkspaceDocument(["alpha"], docs)).toEqual(docs[0]);
  });

  it.each([
    [[], docs],
    [["missing"], docs],
    [["alpha", "beta"], docs],
    [["alpha"], [...docs, { ...docs[0], document_id: "duplicate" }]],
  ])("never guesses for missing, multiple, or duplicate matches", (sources, owned) => {
    expect(resolveWorkspaceDocument(sources, owned)).toBeNull();
  });
});

describe("citationMatchesChunk", () => {
  const chunk = {
    chunk_id: "chunk-uuid",
    embedding_id: "814",
    text: "  Hệ   điều hành quản lý tài nguyên và tiến trình.  ",
  };

  it("matches chat evidence by embedding_id and normalized snippet text", () => {
    expect(citationMatchesChunk(chunk, {
      kind: "chat", id: 814, text: "Hệ điều hành quản lý tài nguyên",
    })).toBe(true);
  });

  it("matches StudyMap evidence by chunk UUID and normalized excerpt text", () => {
    expect(citationMatchesChunk(chunk, {
      kind: "studymap", id: "chunk-uuid", text: "quản lý tài nguyên và tiến trình",
    })).toBe(true);
  });

  it("rejects an id match when the text no longer matches", () => {
    expect(citationMatchesChunk(chunk, {
      kind: "chat", id: "814", text: "một bản trích hoàn toàn khác",
    })).toBe(false);
    expect(CITATION_STALE_MESSAGE).toContain("không còn trong bản hiện tại");
  });
});
