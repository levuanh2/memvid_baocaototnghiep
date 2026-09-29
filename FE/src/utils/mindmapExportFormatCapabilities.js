// Reads exportFormatCapabilities.json — the SAME file (byte-identical,
// contract-tested against BE/services/mindmap/export/format_capabilities.json
// in BE/tests/test_mindmap_export_contract.py) that drives backend
// validation. Never scatter format-specific `if (format === "pdf")` checks
// across components — read this instead.
import raw from "./exportFormatCapabilities.json";

const IMAGE_FORMATS = new Set(["png", "jpeg", "svg"]);
const DOCUMENT_FORMATS = new Set(["pdf", "docx", "xlsx"]);

function capabilityKeyFor(format) {
  return IMAGE_FORMATS.has(format) ? "image" : format;
}

/** Returns {controls, defaults} for a concrete export format (png/jpeg/svg/pdf/docx/xlsx — the three image formats all share the "image" capability set). */
export function getExportFormatCapabilities(format) {
  const key = capabilityKeyFor(format);
  const entry = raw[key];
  if (!entry) throw new Error(`getExportFormatCapabilities: unknown format ${format}`);
  return entry;
}

export function isDocumentFormat(format) {
  return DOCUMENT_FORMATS.has(format);
}

export function isImageFormat(format) {
  return IMAGE_FORMATS.has(format);
}

/** Whether this format declares the given control at all (drives which UI controls render). */
export function formatSupportsControl(format, controlKey) {
  return controlKey in getExportFormatCapabilities(format).controls;
}

/** Whether this format's content toggle set includes `contentKey`. */
export function formatSupportsContent(format, contentKey) {
  return (getExportFormatCapabilities(format).controls.content || []).includes(contentKey);
}
