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

// Claude review of P5a: the server cuts a chat evidence snippet at 600 characters and appends
// "…" (_attach_evidence). The verified chunk text never contains that ellipsis, so every long
// chunk was reported as "no longer in the current version".
describe("citation snippets cut by the server", () => {
  it("matches a chunk whose snippet was truncated with an ellipsis", () => {
    const text = "Đoạn dài ".repeat(120).trim();
    const chunk = { embedding_id: "7", text };
    const citation = { kind: "chat", id: "7", text: `${text.slice(0, 600).trimEnd()}…` };
    expect(citationMatchesChunk(chunk, citation)).toBe(true);
  });

  it("still refuses a truncated snippet that is not in the chunk", () => {
    const chunk = { embedding_id: "7", text: "Nội dung khác hẳn ".repeat(60) };
    const citation = { kind: "chat", id: "7", text: `${"Đoạn dài ".repeat(80).slice(0, 600)}…` };
    expect(citationMatchesChunk(chunk, citation)).toBe(false);
  });
});
