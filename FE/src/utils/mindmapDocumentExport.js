// Client for the document-export job API (BE/app/main.py's
// create_mindmap_export/get_mindmap_export/cancel_mindmap_export/
// download_mindmap_export) — PDF/DOCX/XLSX only. Image formats (PNG/JPEG/
// SVG) never touch the backend; see mindmapImageExport.js for those.
import { apiFetch, apiUrl, _appError } from "./api";

export async function createMindmapExport(mapId, { format, scope, options, mapImageBase64, idempotencyKey }) {
  const res = await apiFetch(`/mindmaps/${encodeURIComponent(mapId)}/exports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format, scope, options,
      ...(mapImageBase64 ? { map_image_base64: mapImageBase64 } : {}),
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    }),
  });
  if (!res.ok) throw await _appError(res);
  return res.json(); // {job_id, status, status_url}
}

export async function getMindmapExportStatus(jobId) {
  const res = await apiFetch(`/mindmaps/exports/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw await _appError(res);
  return res.json(); // {job_id, status, progress, stage, error, error_code, result, download_token?, download_url?}
}

export async function cancelMindmapExport(jobId) {
  const res = await apiFetch(`/mindmaps/exports/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  if (!res.ok) throw await _appError(res);
  return res.json();
}

const TERMINAL_STATUSES = new Set(["done", "error", "cancelled", "timeout", "interrupted"]);

/** Polls status until a terminal state, calling `onUpdate` with every poll (queued/running/... progress). Stops immediately if `signal` aborts. */
export async function pollMindmapExportUntilDone(jobId, { intervalMs = 700, signal, onUpdate } = {}) {
  for (;;) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const status = await getMindmapExportStatus(jobId);
    onUpdate?.(status);
    if (TERMINAL_STATUSES.has(status.status)) return status;
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, intervalMs);
      signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); }, { once: true });
    });
  }
}

/** Real browser download: the token in `downloadUrl`'s query string IS the auth (see BE's download_mindmap_export — a plain navigation can't carry an Authorization header), so this is a real `<a download>` click, not a fetch+blob dance. */
export function triggerMindmapExportDownload(downloadUrl) {
  const a = document.createElement("a");
  a.href = apiUrl(downloadUrl);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
