import { apiFetch } from "./api";

export async function fetchMindmapNodeContext(mapId, nodeId, signal) {
  if (!mapId || !nodeId) return null;
  const res = await apiFetch(`/mindmaps/${encodeURIComponent(mapId)}/nodes/${encodeURIComponent(nodeId)}/context`, { signal });
  if (!res.ok) {
    const error = new Error(`Mind map node context request failed: ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}
