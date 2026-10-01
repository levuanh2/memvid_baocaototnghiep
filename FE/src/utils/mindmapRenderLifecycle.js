export const MINDMAP_RENDER_STATES = Object.freeze([
  "idle", "mounting", "waiting_for_size", "laying_out", "linking", "validating", "ready", "error",
]);

export function validateMindMapRender(container) {
  if (!container) return { ok: false, reason: "missing_container" };
  const paths = [...container.querySelectorAll(".lines path, .subLines path")];
  const invalidPath = paths.some((path) => /NaN|undefined|Infinity/.test(path.getAttribute("d") || ""));
  if (invalidPath) return { ok: false, reason: "invalid_connector" };
  const visibleNodes = container.querySelectorAll("me-tpc").length;
  const connectorCount = paths.filter((path) => (path.getAttribute("d") || "").trim()).length;
  if (visibleNodes > 1 && connectorCount === 0) return { ok: false, reason: "missing_connector" };
  if (connectorCount > Math.max(1, visibleNodes * 2)) return { ok: false, reason: "unexpected_connector_count" };
  return { ok: true, visibleNodes, connectorCount };
}
