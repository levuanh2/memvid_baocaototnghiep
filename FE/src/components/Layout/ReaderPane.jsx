import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { MdProse } from "../ui/Markdown";
import Spinner from "../ui/Spinner";
import { listChunkPage, listDocuments, listSections, moTaLoi } from "../../utils/studyApi";
import {
  CITATION_STALE_MESSAGE,
  citationIdMatchesChunk,
  citationMatchesChunk,
  readerDocumentLabel,
  readerDocumentReady,
  resolveWorkspaceDocument,
} from "../../utils/readerModel";

const PAGE_SIZE = 500;

const safeLink = ({ node, children, href, ...props }) => {
  void node;
  const value = String(href || "").trim();
  if (!/^(https?:|mailto:|\/|#)/i.test(value)) return <span>{children}</span>;
  return <a href={value} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2" {...props}>{children}</a>;
};

function ReaderNotice({ icon, title, children, action, actionLabel }) {
  return (
    <div className="h-full min-h-[280px] flex items-center justify-center p-6 text-center">
      <div className="max-w-[520px]">
        <Icon name={icon} size={28} className="mx-auto mb-3 text-text-muted" aria-hidden="true" />
        <h2 className="font-display text-title font-semibold text-text-primary mb-1.5">{title}</h2>
        <div className="text-small text-text-secondary">{children}</div>
        {action && <button type="button" onClick={action} className="btn-primary mt-4">{actionLabel}</button>}
      </div>
    </div>
  );
}

export default function ReaderPane({ active = false, selectedSources = [], citation = null }) {
  const [documents, setDocuments] = useState([]);
  const [documentsState, setDocumentsState] = useState("loading");
  const [documentsError, setDocumentsError] = useState("");
  const [manualDocumentId, setManualDocumentId] = useState(null);
  const [sections, setSections] = useState([]);
  const [chunks, setChunks] = useState([]);
  const [contentState, setContentState] = useState("idle");
  const [contentError, setContentError] = useState(null);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [loadNonce, setLoadNonce] = useState(0);
  const [citationMessage, setCitationMessage] = useState("");
  const [highlightedChunkId, setHighlightedChunkId] = useState(null);
  const documentsRequestRef = useRef(0);
  const contentRequestRef = useRef(0);
  const scrollRef = useRef(null);
  const chunkRefs = useRef(new Map());
  // Claude review (CI #211): the pane is mounted hidden in every workspace; it must not load
  // the document list, sections or chunk pages until the Reader is first opened.
  const [opened, setOpened] = useState(active);
  useEffect(() => { if (active) setOpened(true); }, [active]);

  const loadOwnedDocuments = useCallback(async () => {
    const request = ++documentsRequestRef.current;
    setDocumentsState("loading");
    setDocumentsError("");
    try {
      const rows = await listDocuments();
      if (request !== documentsRequestRef.current) return;
      setDocuments(rows);
      setDocumentsState("ready");
    } catch (error) {
      if (request !== documentsRequestRef.current) return;
      setDocumentsError(moTaLoi(error, "Không tải được danh sách tài liệu."));
      setDocumentsState("error");
    }
  }, []);

  useEffect(() => {
    if (!opened) return undefined;
    loadOwnedDocuments();
    return () => { documentsRequestRef.current += 1; };
  }, [opened, loadOwnedDocuments]);

  const mappedDocument = useMemo(
    () => resolveWorkspaceDocument(citation?.stem ? [citation.stem] : selectedSources, documents),
    [citation?.stem, documents, selectedSources],
  );
  const currentDocument = useMemo(() => {
    if (manualDocumentId) return documents.find((doc) => String(doc.document_id) === String(manualDocumentId)) || null;
    return mappedDocument;
  }, [documents, manualDocumentId, mappedDocument]);
  const documentId = currentDocument?.document_id || null;

  // A new unambiguous workspace/citation source supersedes an old automatic choice. A manual
  // choice remains intentionally sticky until the learner selects another document.
  useEffect(() => {
    if (manualDocumentId && !documents.some((doc) => String(doc.document_id) === String(manualDocumentId))) {
      setManualDocumentId(null);
    }
  }, [documents, manualDocumentId]);

  useEffect(() => {
    if (!opened) return undefined;
    const request = ++contentRequestRef.current;
    setSections([]);
    setChunks([]);
    setProgress({ loaded: 0, total: 0 });
    setContentError(null);
    setCitationMessage("");
    setHighlightedChunkId(null);
    chunkRefs.current.clear();
    if (!documentId || !readerDocumentReady(currentDocument)) {
      setContentState("idle");
      return () => { contentRequestRef.current += 1; };
    }

    const load = async () => {
      setContentState("loading");
      try {
        const sectionRows = await listSections(documentId);
        if (request !== contentRequestRef.current) return;
        setSections(sectionRows);
      } catch (error) {
        if (request !== contentRequestRef.current) return;
        setContentError({ stage: "sections", message: moTaLoi(error, "Không tải được mục lục.") });
        setContentState("error");
        return;
      }

      let offset = 0;
      let total = 0;
      const all = [];
      do {
        try {
          const page = await listChunkPage(documentId, { limit: PAGE_SIZE, offset });
          if (request !== contentRequestRef.current) return;
          total = Math.max(Number(page.total) || 0, offset + page.chunks.length);
          all.push(...page.chunks);
          offset += page.chunks.length;
          setChunks([...all]);
          setProgress({ loaded: all.length, total });
          if (!page.chunks.length) break;
        } catch (error) {
          if (request !== contentRequestRef.current) return;
          setContentError({ stage: "chunks", offset, message: moTaLoi(error, "Không tải được nội dung tài liệu.") });
          setContentState("error");
          return;
        }
      } while (offset < total);
      if (request !== contentRequestRef.current) return;
      setContentState("ready");
    };
    load();
    return () => { contentRequestRef.current += 1; };
  }, [opened, documentId, currentDocument, loadNonce]);

  useEffect(() => {
    if (!citation || contentState !== "ready") return;
    const idMatched = chunks.find((chunk) => citationIdMatchesChunk(chunk, citation));
    const verified = chunks.find((chunk) => citationMatchesChunk(chunk, citation));
    if (!verified) {
      void idMatched; // An id-only hit is deliberately treated exactly like no hit.
      setHighlightedChunkId(null);
      setCitationMessage(CITATION_STALE_MESSAGE);
      scrollRef.current?.scrollTo?.({ top: 0 });
      return;
    }
    setCitationMessage("");
    setHighlightedChunkId(verified.chunk_id);
    requestAnimationFrame(() => chunkRefs.current.get(String(verified.chunk_id))?.scrollIntoView({ block: "center" }));
  }, [citation, chunks, contentState]);

  const orderedSections = useMemo(
    () => [...sections].sort((a, b) => Number(a.order_index || 0) - Number(b.order_index || 0)),
    [sections],
  );
  const readerBlocks = useMemo(() => {
    const sectionById = new Map(orderedSections.map((section) => [String(section.section_id), section]));
    let previousSectionId = null;
    return chunks.map((chunk) => {
      const sectionId = chunk.section_id == null ? null : String(chunk.section_id);
      const section = sectionId ? sectionById.get(sectionId) || null : null;
      const showHeading = Boolean(section && sectionId !== previousSectionId);
      previousSectionId = sectionId;
      return { chunk, section, showHeading };
    });
  }, [chunks, orderedSections]);

  if (!opened) return null;
  if (documentsState === "loading") {
    return <ReaderNotice icon="BookOpen" title="Đang mở thư viện"><Spinner /> <span className="ml-2">Đang tải tài liệu của bạn…</span></ReaderNotice>;
  }
  if (documentsState === "error") {
    return <ReaderNotice icon="TriangleAlert" title="Không mở được thư viện" action={loadOwnedDocuments} actionLabel="Thử tải lại danh sách">{documentsError}</ReaderNotice>;
  }
  if (!documents.length) {
    return <ReaderNotice icon="BookOpen" title="Chưa có tài liệu">Tải tài liệu vào Thư viện học tập để bắt đầu đọc.</ReaderNotice>;
  }

  const needsPicker = !currentDocument;
  if (needsPicker) {
    return (
      <ReaderNotice icon="BookOpen" title="Chọn tài liệu để đọc">
        <p className="mb-3">Nguồn đang mở không ánh xạ duy nhất tới một tài liệu của bạn. Hãy chọn rõ ràng; StudyMap sẽ không tự đoán.</p>
        <label className="sr-only" htmlFor="reader-document-picker">Chọn tài liệu để đọc</label>
        <select id="reader-document-picker" aria-label="Chọn tài liệu để đọc" defaultValue=""
          onChange={(event) => setManualDocumentId(event.target.value || null)} className="input-surface min-h-11 w-full max-w-[360px]">
          <option value="" disabled>Chọn một tài liệu…</option>
          {documents.map((doc) => <option key={doc.document_id} value={doc.document_id}>{readerDocumentLabel(doc)}{readerDocumentReady(doc) ? "" : " — chưa sẵn sàng"}</option>)}
        </select>
      </ReaderNotice>
    );
  }

  if (!readerDocumentReady(currentDocument)) {
    return (
      <ReaderNotice icon="Clock" title="Tài liệu đang được xử lý">
        <p><strong>{readerDocumentLabel(currentDocument)}</strong> chưa sẵn sàng để đọc.</p>
        <p className="mt-1 text-caption">Trạng thái: {currentDocument.status || currentDocument.ingest_status || "đang xử lý"}</p>
      </ReaderNotice>
    );
  }

  return (
    <div className="reader-pane flex h-full min-h-0 flex-col" data-reader-active={active ? "true" : "false"}>
      <div className="artifact-toolbar flex-shrink-0">
        <Icon name="BookOpen" size={16} className="artifact-toolbar__icon" aria-hidden="true" />
        <div className="artifact-toolbar__identity min-w-0">
          <strong className="truncate">{readerDocumentLabel(currentDocument)}</strong>
          <small>Văn bản đã trích xuất · không phải bản xem trước file gốc</small>
        </div>
        <label className="sr-only" htmlFor="reader-toolbar-picker">Chọn tài liệu để đọc</label>
        <select id="reader-toolbar-picker" aria-label="Chọn tài liệu để đọc" value={documentId}
          onChange={(event) => setManualDocumentId(event.target.value)} className="reader-document-select input-surface min-h-10 max-w-[240px]">
          {documents.map((doc) => <option key={doc.document_id} value={doc.document_id}>{readerDocumentLabel(doc)}{readerDocumentReady(doc) ? "" : " — chưa sẵn sàng"}</option>)}
        </select>
      </div>

      {contentState === "error" ? (
        <ReaderNotice icon="TriangleAlert" title={contentError?.stage === "sections" ? "Không tải được mục lục" : "Không tải được nội dung"}
          action={() => setLoadNonce((value) => value + 1)}
          actionLabel={contentError?.stage === "sections" ? "Thử tải lại mục lục" : `Thử tải lại từ đoạn ${contentError?.offset || 0}`}>
          {contentError?.message}
        </ReaderNotice>
      ) : (
        <div className="flex flex-1 min-h-0">
          <nav aria-label="Mục lục tài liệu" className="reader-toc hidden md:block w-[220px] flex-shrink-0 overflow-y-auto border-r border-border bg-surface-sidebar p-3">
            <div className="font-mono text-metadata uppercase text-text-muted mb-2">Mục lục</div>
            {orderedSections.length ? orderedSections.map((section) => (
              <button key={section.section_id} type="button"
                onClick={() => document.getElementById(`reader-section-${section.section_id}`)?.scrollIntoView({ block: "start" })}
                className="reader-toc__item block w-full rounded-[6px] px-2 py-2 text-left text-small text-text-secondary hover:bg-surface-elevated hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent"
                style={{ paddingLeft: `${Math.min(4, Math.max(1, Number(section.level) || 1)) * 8}px` }}>
                {section.title || "Mục không tên"}
              </button>
            )) : <p className="text-caption text-text-muted">Tài liệu không có mục lục.</p>}
          </nav>

          <div ref={scrollRef} className="reader-scroll flex-1 min-w-0 overflow-y-auto scroll-pt-4" tabIndex={0} aria-label="Nội dung tài liệu">
            {citationMessage && (
              <div role="status" className="sticky top-0 z-10 mx-auto mt-3 max-w-[820px] rounded-[8px] border px-3 py-2.5 text-small"
                style={{ borderColor: "var(--warn)", background: "var(--bg-card)", color: "var(--text-secondary)" }}>
                <Icon name="TriangleAlert" size={14} className="inline mr-1.5 align-[-2px]" aria-hidden="true" />{citationMessage}
              </div>
            )}
            {(contentState === "loading" || (progress.total > progress.loaded)) && (
              <div role="status" className="mx-auto max-w-[820px] px-5 pt-4 text-caption text-text-muted">
                <Spinner /> <span className="ml-2">Đang tải {progress.loaded}{progress.total ? ` / ${progress.total}` : ""} đoạn…</span>
              </div>
            )}
            <article className="reader-paper mx-auto my-4 max-w-[820px] rounded-[10px] border border-border bg-surface-card px-5 py-6 shadow-card sm:px-8 sm:py-8">
              <p className="reader-file-note md:hidden mb-5 rounded-[7px] border border-border bg-surface-elevated px-3 py-2 text-caption text-text-secondary">
                Văn bản đã trích xuất · không phải bản xem trước file gốc
              </p>
              {!chunks.length && contentState === "ready" ? (
                <div className="py-14 text-center">
                  <Icon name="FileText" size={26} className="mx-auto mb-2 text-text-muted" aria-hidden="true" />
                  <h2 className="font-display text-title font-semibold text-text-primary">Tài liệu chưa có nội dung đã trích xuất</h2>
                  <p className="mt-1 text-small text-text-secondary">Không có đoạn văn nào để hiển thị.</p>
                </div>
              ) : (
                <>
                  {readerBlocks.map(({ chunk, section, showHeading }) => (
                    <Fragment key={chunk.chunk_id}>
                      {showHeading && (
                        <div id={`reader-section-${section.section_id}`} className="reader-section scroll-mt-4 mt-9 first:mt-0">
                        <p className="font-mono text-metadata uppercase text-text-muted mb-2">Mục {Number(section.order_index || 0) + 1}</p>
                        <h2 className="font-display text-h2 font-semibold text-text-primary mb-4">{section.title || "Mục không tên"}</h2>
                        </div>
                      )}
                      <div ref={(node) => {
                      const key = String(chunk.chunk_id);
                      if (node) chunkRefs.current.set(key, node); else chunkRefs.current.delete(key);
                    }} data-reader-chunk={chunk.chunk_id}
                        className={`reader-chunk scroll-mt-6 rounded-[7px] px-2 py-1 -mx-2 mb-5 last:mb-0 ${String(highlightedChunkId) === String(chunk.chunk_id) ? "reader-chunk--highlighted" : ""}`}>
                        <MdProse text={chunk.text} components={{ a: safeLink }} />
                      </div>
                    </Fragment>
                  ))}
                </>
              )}
            </article>
          </div>
        </div>
      )}
    </div>
  );
}
