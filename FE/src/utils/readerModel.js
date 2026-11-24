export const CITATION_STALE_MESSAGE = "Đoạn này không còn trong bản hiện tại — tài liệu có thể đã được xử lý lại";

const stemOf = (value) => String(value || "").trim().toLocaleLowerCase("vi");

/**
 * Resolve only when the workspace points at exactly one source and the caller-owned
 * document list contains exactly one row for that source. Anything ambiguous is a
 * picker state, never a first-row fallback.
 */
export function resolveWorkspaceDocument(activeSources, ownedDocuments) {
  const stems = [...new Set((activeSources || [])
    .map((source) => stemOf(typeof source === "string" ? source : source?.video_stem || source?.video))
    .filter(Boolean))];
  if (stems.length !== 1) return null;
  const matches = (ownedDocuments || []).filter((doc) => stemOf(doc?.source_stem) === stems[0]);
  return matches.length === 1 ? matches[0] : null;
}

export function normalizeReaderText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
}

export function citationIdMatchesChunk(chunk, citation) {
  if (!chunk || !citation) return false;
  const actual = citation.kind === "chat" ? chunk.embedding_id : chunk.chunk_id;
  return actual != null && String(actual) === String(citation.id);
}

export function citationMatchesChunk(chunk, citation) {
  if (!citationIdMatchesChunk(chunk, citation)) return false;
  const text = normalizeReaderText(chunk.text);
  // The server cuts long evidence snippets at 600 characters and appends "…" (_attach_evidence);
  // compare only the part that came from the chunk.
  const snippet = normalizeReaderText(String(citation.text || "").replace(/\s*(…|\.\.\.)\s*$/u, ""));
  return Boolean(text && snippet && text.includes(snippet));
}

export function readerDocumentReady(document) {
  const status = stemOf(document?.status);
  const ingest = stemOf(document?.ingest_status || document?.ai?.index?.state || document?.ai?.index);
  return ["completed", "ready", "index_ready"].includes(status)
    || ["completed", "ready", "index_ready"].includes(ingest);
}

export function readerDocumentLabel(document) {
  return document?.display_name || document?.title || document?.filename || document?.source_stem || "Tài liệu không tên";
}
