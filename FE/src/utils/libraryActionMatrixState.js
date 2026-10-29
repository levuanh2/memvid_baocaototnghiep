import { TASK_VIEWS } from "./libraryActionMatrix";
import { CHE_DO_SAP } from "./thuVienTaiLieu";

export const DEFAULT_LIBRARY_STATE = Object.freeze({
  view: "all",
  query: "",
  sort: "newest",
  collectionId: null,
  tags: [],
  filterKeys: [],
  includeArchived: false,
  scrollY: 0,
});

const STORAGE_PREFIX = "memvidx.library.actionMatrix.v1";

export function libraryStateStorageKey(userId) {
  const identity = String(userId || "").trim();
  return identity ? `${STORAGE_PREFIX}:${encodeURIComponent(identity)}` : null;
}

const strings = (value) => Array.isArray(value)
  ? value.map((item) => String(item || "").trim()).filter(Boolean)
  : [];

export function parseLibraryState(raw) {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { value = {}; }
  }
  value = value && typeof value === "object" ? value : {};
  return {
    view: TASK_VIEWS.includes(value.view) ? value.view : DEFAULT_LIBRARY_STATE.view,
    query: String(value.query || ""),
    sort: CHE_DO_SAP.includes(value.sort) ? value.sort : DEFAULT_LIBRARY_STATE.sort,
    collectionId: value.collectionId ? String(value.collectionId) : null,
    tags: strings(value.tags),
    filterKeys: strings(value.filterKeys),
    includeArchived: value.includeArchived === true,
    scrollY: Number.isFinite(Number(value.scrollY)) ? Math.max(0, Number(value.scrollY)) : 0,
  };
}

export function serializeLibraryState(state) {
  return JSON.stringify(parseLibraryState(state));
}
