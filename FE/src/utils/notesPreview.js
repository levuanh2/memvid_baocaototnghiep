// V9.3 P5b — Notes Preview: a plain-text note per signed-in user and document, kept ONLY in
// this browser's localStorage. Nothing is sent to the server or synced; it is not encrypted
// and anyone using the same browser profile can read it (the pane says so).
//
// Owner decision (option A): saved notes stay on logout. What logout drops is the in-memory
// draft list below (`forgetPendingNotes`, called from xoaDuLieuPhienNguoiDung).

export const NOTE_PREFIX = "studymap.notes.v1";
export const NOTE_MAX = 20000;

export function noteKey(userId, documentId) {
  if (!userId || !documentId) return null;
  return `${NOTE_PREFIX}:${userId}:${documentId}`;
}

/** { text, savedAt } — empty text when there is none; { error } when storage cannot be read. */
export function readNote(userId, documentId) {
  const key = noteKey(userId, documentId);
  if (!key) return { text: "", savedAt: null };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { text: "", savedAt: null };
    const parsed = JSON.parse(raw);
    return { text: typeof parsed?.text === "string" ? parsed.text : "", savedAt: parsed?.savedAt || null };
  } catch {
    return { text: "", savedAt: null, error: "blocked" };
  }
}

export function writeNote(userId, documentId, text) {
  const key = noteKey(userId, documentId);
  if (!key) return { ok: false, error: "no_user" };
  const value = String(text ?? "");
  if (value.length > NOTE_MAX) return { ok: false, error: "too_long" };
  const savedAt = new Date().toISOString();
  try {
    window.localStorage.setItem(key, JSON.stringify({ text: value, savedAt }));
    return { ok: true, savedAt };
  } catch {
    return { ok: false, error: "blocked" };
  }
}

export function deleteNote(userId, documentId) {
  const key = noteKey(userId, documentId);
  if (!key) return { ok: false, error: "no_user" };
  pending.delete(key);
  try {
    window.localStorage.removeItem(key);
    return { ok: true };
  } catch {
    return { ok: false, error: "blocked" };
  }
}

// Drafts typed but not yet written (debounce in flight, or storage refused them).
// ponytail: module-level map, one tab; a per-user store is not needed while a tab has one user.
const pending = new Map();

export function setPendingNote(userId, documentId, text) {
  const key = noteKey(userId, documentId);
  if (key) pending.set(key, { userId, documentId, text });
}

export function clearPendingNote(userId, documentId) {
  const key = noteKey(userId, documentId);
  if (key) pending.delete(key);
}

export const hasPendingNotes = () => pending.size > 0;

/** Write every pending draft. { ok: true } or { ok: false, failed } (those stay pending). */
export function flushPendingNotes() {
  let failed = 0;
  for (const [key, d] of [...pending]) {
    if (writeNote(d.userId, d.documentId, d.text).ok) pending.delete(key);
    else failed += 1;
  }
  return failed ? { ok: false, failed } : { ok: true };
}

export function forgetPendingNotes() {
  pending.clear();
}

// A one-time notice for the next screen (login) when a session ended with a draft the browser
// refused to save (#210 review P2). sessionStorage: this tab only, gone with it.
const LOSS_FLAG = "studymap.notes.unsavedLost";

export function takeNotesLostNotice() {
  try {
    const flagged = window.sessionStorage.getItem(LOSS_FLAG) === "1";
    if (flagged) window.sessionStorage.removeItem(LOSS_FLAG);
    return flagged;
  } catch {
    return false;
  }
}

/** Session end (any path): write pending drafts, then drop them from memory. A draft the
 * browser refuses is not reported as saved; the next screen says it was lost. */
export function flushThenForgetPendingNotes() {
  const result = flushPendingNotes();
  if (!result.ok) {
    try { window.sessionStorage.setItem(LOSS_FLAG, "1"); } catch { /* nothing left to tell */ }
  }
  forgetPendingNotes();
  return result;
}

/**
 * The document the workspace is on: the caller's document whose `source_stem` matches the
 * first selected source. Exactly one match or nothing: two documents on one stem are never
 * guessed between (the user picks).
 */
export function resolveWorkspaceDocument(selectedStems, documents) {
  const stem = (selectedStems || [])[0];
  if (!stem) return { document: null, reason: "none" };
  const matches = (documents || []).filter((d) => d?.source_stem === stem);
  if (matches.length === 1) return { document: matches[0], reason: "unique" };
  return { document: null, reason: matches.length > 1 ? "ambiguous" : "none" };
}
