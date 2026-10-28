import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { nhanOChon } from "../../utils/chonNhieu";
import { nhanThoiGianDoc, tenHienThi, thoiGianDoc } from "../../utils/thuVienTaiLieu";
import { primaryActionFor } from "../../utils/libraryActionMatrix";
import DocumentToolsSheet, { DesktopDocumentTools } from "./DocumentToolsSheet";
import InlineDocumentNameEditor from "./InlineDocumentNameEditor";

const progressCopy = (state, ready, missing, unknown) => (
  state === "ready" ? ready : state === "missing" ? missing : unknown
);

function useMobileTools() {
  const [mobile, setMobile] = useState(() => window.matchMedia?.("(max-width: 767px)").matches || false);
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 767px)");
    if (!query) return undefined;
    const update = () => setMobile(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return mobile;
}

export default function StudyDocumentActionRow({
  doc, view, onOpen, onDetails, onRename, onPatch, selected = false, onSelect,
  primaryTabIndex = -1, onPrimaryKeyDown, primaryRef, renaming = false,
  saving = false, onSaveRename, onCancelRename,
  fallbackFocusRef,
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const mobile = useMobileTools();
  const triggerRef = useRef(null);
  const title = tenHienThi(doc);
  const primary = primaryActionFor(view, doc);
  const indexed = doc.ai?.index === "ready";

  const closeTools = () => setToolsOpen(false);
  const choose = (surface) => {
    closeTools();
    if (surface === "details") onDetails?.(doc);
    else onOpen(doc, surface);
  };
  const manage = (action) => {
    closeTools();
    if (action === "rename") return onRename?.(doc.document_id);
    if (action === "favorite") return onPatch?.(doc, { favorite: !doc.favorite });
    if (action === "pin") return onPatch?.(doc, { pinned: !doc.pinned });
    return onPatch?.(doc, { archived: !doc.archived_at });
  };

  return (
    <article data-document-row data-document-id={doc.document_id}
      className={`study-document-row${selected ? " is-selected" : ""}${doc.archived_at ? " is-archived" : ""}`}>
      <label className="study-document-row__select">
        <input type="checkbox" checked={selected} onChange={() => onSelect?.(doc.document_id)}
          aria-label={nhanOChon(title, selected)} />
      </label>
      <div className="study-document-row__identity">
        {renaming ? (
          <InlineDocumentNameEditor initialValue={doc.display_name || doc.title}
            saving={saving} onSave={onSaveRename} onCancel={onCancelRename}
            className="study-document-row__inline-editor" />
        ) : <strong title={title}>{title}</strong>}
        <span>{[doc.file_type?.toUpperCase(), nhanThoiGianDoc(thoiGianDoc(doc))].filter(Boolean).join(" · ")}</span>
      </div>
      <div className="study-document-row__progress">
        <span>{progressCopy(doc.summaryState, "Tóm tắt sẵn sàng", "Chưa có tóm tắt", "Trạng thái tóm tắt chưa xác định")}</span>
        <span>{progressCopy(doc.quizState, "Quiz sẵn sàng", "Chưa có quiz", "Quiz đang xử lý hoặc chưa xác định")}</span>
      </div>
      <button ref={(node) => { primaryRef?.(node); }} type="button" data-primary-action
        tabIndex={primaryTabIndex} className="btn-seal study-document-row__primary"
        disabled={!indexed || !primary} onKeyDown={onPrimaryKeyDown}
        onClick={() => primary && onOpen(doc, primary.surface)}>
        <Icon name="ArrowRight" size={14} /> {primary?.label || "Chưa sẵn sàng"}
      </button>
      <div className="study-document-row__quick" aria-label={`Mở nhanh ${title}`}>
        <button type="button" data-quick-action aria-label={`Tóm tắt · ${title}`}
          disabled={!indexed} onClick={() => onOpen(doc, "summary")}><Icon name="ScrollText" size={15} /></button>
        <button type="button" data-quick-action aria-label={`Sơ đồ tư duy · ${title}`}
          disabled={!indexed} onClick={() => onOpen(doc, "mindmap")}><Icon name="Network" size={15} /></button>
      </div>
      <div className="study-document-row__tools">
        <button ref={triggerRef} type="button" data-tools-trigger aria-haspopup={mobile ? "dialog" : "menu"}
          aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)}>
          <Icon name="MoreVertical" size={16} /> <span>Thêm</span>
        </button>
        {!mobile && <DesktopDocumentTools open={toolsOpen} doc={doc} onChoose={choose} onManage={manage}
          onClose={closeTools} triggerRef={triggerRef} />}
      </div>
      {mobile && <DocumentToolsSheet open={toolsOpen} doc={doc} onChoose={choose} onManage={manage}
        onClose={closeTools} triggerRef={triggerRef} fallbackFocusRef={fallbackFocusRef} />}
    </article>
  );
}
