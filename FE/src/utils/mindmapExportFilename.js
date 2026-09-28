// Filename sanitization for exported files — same character set the
// existing PNG export already strips (MindElixirView.jsx's handleExportPng),
// pulled out so Export Studio can share it and preview it before download.
const UNSAFE_CHARS = /[\\/:*?"<>|]+/g;

export function sanitizeExportFilename(rawTitle, { maxLength = 80 } = {}) {
  const base = String(rawTitle || "").trim() || "mindmap";
  const cleaned = base.replace(UNSAFE_CHARS, "_").replace(/\s+/g, "_");
  return (cleaned.slice(0, maxLength) || "mindmap");
}

export function exportFilenameFor(title, extension, { date = new Date() } = {}) {
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `${sanitizeExportFilename(title)}-${stamp}.${extension}`;
}
