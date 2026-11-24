// @vitest-environment jsdom
// V9.3 P5b — Notes Preview storage (owner brief C): browser-only, one note per signed-in
// user and document, nothing synced, kept on logout (option A), in-memory drafts dropped.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  NOTE_MAX, noteKey, readNote, writeNote, deleteNote,
  setPendingNote, flushPendingNotes, forgetPendingNotes, hasPendingNotes, takeNotesLostNotice,
  resolveWorkspaceDocument,
} from "./notesPreview";
import { xoaDuLieuPhienNguoiDung } from "../auth/phienNguoiDung";

beforeEach(() => { window.localStorage.clear(); forgetPendingNotes(); });
afterEach(() => { vi.restoreAllMocks(); });

const blockStorage = () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
};

describe("keys and isolation", () => {
  it("keys a note by user and document, and has no key without both", () => {
    expect(noteKey("u1", "d1")).toBe("studymap.notes.v1:u1:d1");
    expect(noteKey(null, "d1")).toBeNull();
    expect(noteKey("u1", "")).toBeNull();
  });

  it("never returns another user's or another document's note", () => {
    expect(writeNote("u1", "d1", "ghi chú của u1").ok).toBe(true);
    expect(readNote("u1", "d1").text).toBe("ghi chú của u1");
    expect(readNote("u2", "d1").text).toBe("");
    expect(readNote("u1", "d2").text).toBe("");
  });

  it("does not save without a signed-in user", () => {
    expect(writeNote(null, "d1", "x")).toEqual({ ok: false, error: "no_user" });
    expect(window.localStorage.length).toBe(0);
  });
});

describe("saving", () => {
  it("records when the note was saved", () => {
    const r = writeNote("u1", "d1", "abc");
    expect(r.ok).toBe(true);
    expect(typeof r.savedAt).toBe("string");
    expect(readNote("u1", "d1").savedAt).toBe(r.savedAt);
  });

  it("refuses a note over the limit instead of cutting it", () => {
    const r = writeNote("u1", "d1", "x".repeat(NOTE_MAX + 1));
    expect(r).toEqual({ ok: false, error: "too_long" });
    expect(readNote("u1", "d1").text).toBe("");
  });

  it("reports blocked storage instead of throwing", () => {
    blockStorage();
    expect(writeNote("u1", "d1", "abc")).toEqual({ ok: false, error: "blocked" });
  });

  it("deletes only that user's note for that document", () => {
    writeNote("u1", "d1", "a");
    writeNote("u1", "d2", "b");
    writeNote("u2", "d1", "c");
    expect(deleteNote("u1", "d1").ok).toBe(true);
    expect(readNote("u1", "d1").text).toBe("");
    expect(readNote("u1", "d2").text).toBe("b");
    expect(readNote("u2", "d1").text).toBe("c");
  });
});

describe("pending drafts and logout", () => {
  it("flushes pending drafts to storage", () => {
    setPendingNote("u1", "d1", "chưa lưu");
    expect(hasPendingNotes()).toBe(true);
    expect(flushPendingNotes()).toEqual({ ok: true });
    expect(readNote("u1", "d1").text).toBe("chưa lưu");
    expect(hasPendingNotes()).toBe(false);
  });

  it("keeps the draft pending and says so when storage is blocked", () => {
    setPendingNote("u1", "d1", "chưa lưu");
    blockStorage();
    expect(flushPendingNotes()).toEqual({ ok: false, failed: 1 });
    expect(hasPendingNotes()).toBe(true);
  });

  // Independent review of #210 (P2): forced session ends (401, bfcache user mismatch, logout
  // after a password change) called this cleanup, which dropped a pending draft unsaved and
  // silently. It now writes pending drafts first, then clears memory; saved notes stay (A).
  it("session cleanup writes pending drafts, then clears memory, and keeps saved notes (owner option A)", () => {
    writeNote("u1", "d1", "đã lưu");
    setPendingNote("u1", "d2", "nháp trong bộ nhớ");
    xoaDuLieuPhienNguoiDung();
    expect(hasPendingNotes()).toBe(false);
    expect(readNote("u1", "d1").text).toBe("đã lưu");
    expect(readNote("u1", "d2").text).toBe("nháp trong bộ nhớ");
    expect(takeNotesLostNotice()).toBe(false);
  });

  it("a forced session end that cannot save says so and never claims the draft was saved", () => {
    setPendingNote("u1", "d2", "nháp trong bộ nhớ");
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (k, v) {
      if (String(k).startsWith("studymap.notes.v1")) throw new DOMException("blocked", "SecurityError");
      return realSetItem.call(this, k, v);
    });
    xoaDuLieuPhienNguoiDung();
    vi.restoreAllMocks();
    expect(hasPendingNotes()).toBe(false);
    expect(readNote("u1", "d2").text).toBe("");
    expect(takeNotesLostNotice()).toBe(true);
    expect(takeNotesLostNotice()).toBe(false); // shown once
  });
});

describe("resolveWorkspaceDocument", () => {
  const docs = [
    { document_id: "a", source_stem: "kinh_te", title: "Kinh tế.pdf" },
    { document_id: "b", source_stem: "trung", title: "Trùng 1.pdf" },
    { document_id: "c", source_stem: "trung", title: "Trùng 2.pdf" },
  ];
  it("picks the one document whose stem matches the active source", () => {
    expect(resolveWorkspaceDocument(["kinh_te"], docs)).toEqual({ document: docs[0], reason: "unique" });
  });
  it("never guesses between two documents with the same stem", () => {
    expect(resolveWorkspaceDocument(["trung"], docs)).toEqual({ document: null, reason: "ambiguous" });
  });
  it("asks when no source is selected or nothing matches", () => {
    expect(resolveWorkspaceDocument([], docs)).toEqual({ document: null, reason: "none" });
    expect(resolveWorkspaceDocument(["khac"], docs)).toEqual({ document: null, reason: "none" });
  });
});
