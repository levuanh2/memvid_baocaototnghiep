// V9.3 P5b — "Ghi chú" workspace mode: Notes Preview, browser only (owner brief C).
// One plain-text note per signed-in user and document, in this browser's localStorage.
// Nothing reaches the server. The pane stays mounted when hidden, so the typed text
// survives mode switches and Focus Mode; switching document saves the previous one first.
import { useCallback, useEffect, useRef, useState } from "react";
import { listDocuments } from "../../utils/studyApi";
import {
  NOTE_MAX, readNote, writeNote, deleteNote,
  setPendingNote, clearPendingNote, resolveWorkspaceDocument,
} from "../../utils/notesPreview";

const SAVE_DELAY_MS = 600;
const soVN = (n) => n.toLocaleString("vi-VN");
const gio = (iso) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });

export default function NotesPane({ active, userId, selectedSources = [], loadDocuments = listDocuments }) {
  // Every piece of per-account state carries the account it belongs to, and is only used while
  // that is still the signed-in account: a direct account switch renders nothing of the previous
  // account, not even for the first commit before the reload effect runs (V9.3 Task 6A).
  const [docsFor, setDocsFor] = useState({ userId: null, list: null });
  const [errorFor, setErrorFor] = useState(null);
  const [pickedFor, setPickedFor] = useState({ userId: null, id: "" });
  const docs = docsFor.userId === userId ? docsFor.list : null;
  const loadError = errorFor !== null && errorFor === userId;
  const pickedId = pickedFor.userId === userId ? pickedFor.id : "";
  const [text, setText] = useState("");
  const [status, setStatus] = useState({ kind: "idle" });
  const [confirming, setConfirming] = useState(false);
  const timer = useRef(null);
  const current = useRef({ userId: null, docId: null, text: "", dirty: false });
  // The identity the shown text was loaded for. The textarea only renders when it equals the
  // current props, and edits are keyed by it, never by props (#210 review P1).
  const [loaded, setLoaded] = useState({ userId: null, docId: null });
  const docsRequest = useRef(0);
  const deleteRef = useRef(null);
  const cancelRef = useRef(null);
  const returnFocus = useRef(false);
  // Nothing renders or loads until the mode is first opened (the pane is mounted hidden).
  const [opened, setOpened] = useState(false);

  const load = useCallback(() => {
    // One list per account; a response for an earlier request (another account) is dropped.
    const request = ++docsRequest.current;
    const owner = userId;
    setErrorFor(null);
    setDocsFor({ userId: owner, list: null });
    loadDocuments()
      .then((list) => { if (request === docsRequest.current) setDocsFor({ userId: owner, list: list || [] }); })
      .catch(() => { if (request === docsRequest.current) setErrorFor(owner); });
  }, [loadDocuments, userId]);
  useEffect(() => {
    if (active && !opened) setOpened(true);
  }, [active, opened]);
  useEffect(() => {
    if (!opened) return undefined;
    setPickedFor({ userId, id: "" });
    load();
    return () => { docsRequest.current += 1; };
  }, [opened, userId, load]);

  const resolved = docs ? resolveWorkspaceDocument(selectedSources, docs) : null;
  const docId = pickedId || resolved?.document?.document_id || "";
  const doc = docs?.find((d) => d.document_id === docId) || null;

  const save = useCallback((uid, id, value) => {
    const r = writeNote(uid, id, value);
    if (r.ok) {
      clearPendingNote(uid, id);
      setStatus({ kind: "saved", at: r.savedAt });
    } else {
      setStatus({ kind: "error", error: r.error });
    }
    return r;
  }, []);

  const flushNow = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    const c = current.current;
    if (!c.dirty || !c.userId || !c.docId) return;
    c.dirty = !save(c.userId, c.docId, c.text).ok;
  }, [save]);

  // Load this user's note for this document; on the way out (document switch, account
  // switch, unmount at logout) write the previous one first.
  useEffect(() => {
    const r = readNote(userId, docId);
    setText(r.text);
    setConfirming(false);
    setStatus(r.error ? { kind: "error", error: "blocked" } : r.savedAt ? { kind: "saved", at: r.savedAt } : { kind: "idle" });
    current.current = { userId, docId, text: r.text, dirty: false };
    setLoaded({ userId, docId });
    return () => flushNow();
  }, [userId, docId, flushNow]);

  const onChange = (e) => {
    const value = e.target.value;
    setText(value);
    current.current = { userId: loaded.userId, docId: loaded.docId, text: value, dirty: true };
    setPendingNote(loaded.userId, loaded.docId, value);
    clearTimeout(timer.current);
    timer.current = setTimeout(flushNow, SAVE_DELAY_MS);
  };

  const remove = () => {
    clearTimeout(timer.current);
    const r = deleteNote(loaded.userId, loaded.docId);
    setConfirming(false);
    returnFocus.current = true;
    if (!r.ok) { setStatus({ kind: "error", error: r.error }); return; }
    setText("");
    current.current = { userId: loaded.userId, docId: loaded.docId, text: "", dirty: false };
    setStatus({ kind: "idle" });
  };
  const cancelDelete = () => { setConfirming(false); returnFocus.current = true; };
  // #210 review P3: focus goes into the confirmation (the safe choice) and back to the trigger.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (returnFocus.current) { returnFocus.current = false; deleteRef.current?.focus(); }
  }, [confirming]);

  if (!opened) return null;

  return (
    <section className="notes-pane flex-1 min-h-0 overflow-y-auto" aria-labelledby="notes-pane-title">
      <div className="mx-auto w-full max-w-[940px] px-4 py-5 flex flex-col gap-4">
        <header className="flex flex-wrap items-center gap-2">
          <h2 id="notes-pane-title" className="text-title font-semibold text-text-primary">Ghi chú</h2>
          <span className="notes-pane__badge rounded-full border border-border px-2.5 py-0.5 text-caption text-text-secondary">
            Bản xem trước · chỉ lưu trên trình duyệt này
          </span>
        </header>
        <p className="text-small text-text-secondary max-w-[72ch]">
          Ghi chú không đồng bộ sang tài khoản, thiết bị hay trình duyệt khác. Xoá dữ liệu trình duyệt
          hoặc dùng cửa sổ ẩn danh sẽ làm mất ghi chú. Ghi chú lưu dạng văn bản thường: ai dùng chung hồ sơ
          trình duyệt này đều đọc được.
        </p>

        {!userId ? (
          <p className="text-small text-text-primary">Đăng nhập để ghi chú.</p>
        ) : loadError ? (
          <div role="alert" className="flex items-center gap-3 text-small">
            <span>Không tải được danh sách tài liệu.</span>
            <button type="button" className="notes-pane__btn" onClick={load}>Thử lại</button>
          </div>
        ) : docs === null ? (
          <p className="text-small text-text-secondary">Đang tải tài liệu để ghi chú…</p>
        ) : docs.length === 0 ? (
          <p className="text-small text-text-primary">Chưa có tài liệu nào để ghi chú. Tải tài liệu lên trong Thư viện.</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="notes-pane-document" className="text-small font-medium text-text-primary">Tài liệu</label>
              <select id="notes-pane-document" className="notes-pane__select" value={docId}
                onChange={(e) => setPickedFor({ userId, id: e.target.value })}>
                <option value="">Chọn tài liệu…</option>
                {docs.map((d) => <option key={d.document_id} value={d.document_id}>{d.title || d.filename || d.document_id}</option>)}
              </select>
              {!docId && resolved?.reason === "ambiguous" && (
                <p className="text-caption text-text-secondary">Có nhiều tài liệu cùng tên nguồn này. Chọn đúng tài liệu để ghi chú.</p>
              )}
            </div>

            {doc && loaded.userId === userId && loaded.docId === docId && (
              <div className="flex flex-col gap-2">
                <textarea
                  className="notes-pane__text"
                  aria-label={`Ghi chú cho ${doc.title || doc.document_id}`}
                  aria-describedby="notes-pane-count notes-pane-status"
                  value={text}
                  onChange={onChange}
                  onBlur={flushNow}
                  maxLength={NOTE_MAX}
                  rows={14}
                  placeholder="Viết ghi chú cho tài liệu này…"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-text-secondary">
                  <span id="notes-pane-count">
                    {soVN(text.length)}/{soVN(NOTE_MAX)} ký tự
                    {text.length >= NOTE_MAX && " · Đã đến giới hạn của một ghi chú."}
                  </span>
                  <span id="notes-pane-status" aria-live="polite">
                    {status.kind === "saved" && `Đã lưu trên trình duyệt này lúc ${gio(status.at)}`}
                  </span>
                </div>
                {status.kind === "error" && (
                  <div role="alert" className="notes-pane__alert flex flex-wrap items-center gap-3 text-small">
                    <span>Chưa lưu được: trình duyệt đang chặn lưu cục bộ. Ghi chú vẫn còn trong tab này, hãy sao chép lại nếu cần.</span>
                    <button type="button" className="notes-pane__btn" onClick={() => {
                      current.current.dirty = !save(userId, docId, current.current.text).ok;
                    }}>Thử lưu lại</button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {!confirming ? (
                    <button type="button" ref={deleteRef} className="notes-pane__btn" onClick={() => setConfirming(true)}>Xoá ghi chú trên trình duyệt này</button>
                  ) : (
                    <div role="group" aria-label="Xác nhận xoá ghi chú" className="flex flex-wrap items-center gap-2 text-small"
                      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); cancelDelete(); } }}>
                      <span>Xoá hẳn ghi chú của tài liệu này trên trình duyệt này? Không khôi phục được.</span>
                      <button type="button" className="notes-pane__btn notes-pane__btn--danger" onClick={remove}>Xoá</button>
                      <button type="button" ref={cancelRef} className="notes-pane__btn" onClick={cancelDelete}>Huỷ</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
