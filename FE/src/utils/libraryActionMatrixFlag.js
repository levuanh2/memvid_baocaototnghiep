export function isLibraryActionMatrixEnabled(env = import.meta.env) {
  return String(env?.VITE_LIBRARY_ACTION_MATRIX || "").toLowerCase() === "true";
}
