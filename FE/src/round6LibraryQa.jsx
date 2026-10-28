import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import "./index.css";
import "./components/study/libraryActionMatrix.css";
import LibraryTaskViews from "./components/study/LibraryTaskViews";
import StudyDocumentActionRow from "./components/study/StudyDocumentActionRow";
import { EmptyState } from "./components/study/StudyShell";
import { TASK_VIEW, projectLibrary } from "./utils/libraryActionMatrix";

const params = new URLSearchParams(window.location.search);
const initialView = Object.values(TASK_VIEW).includes(params.get("view")) ? params.get("view") : TASK_VIEW.ALL;
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

const fixture = Array.from({ length: 42 }, (_, offset) => {
  const index = offset + 1;
  return {
    document_id: `doc-${index}`,
    source_stem: `source-${index}`,
    title: `Tài liệu ${String(index).padStart(2, "0")}`,
    file_type: "pdf",
    reading_minutes: 8 + (index % 15),
    created_at: `2026-01-${String(Math.min(index, 28)).padStart(2, "0")}T00:00:00Z`,
    last_opened_at: index === 2 ? "2026-10-01T00:00:00Z" : null,
    last_workspace: index === 2 ? "review" : null,
    ai: {
      index: "ready",
      summary: { state: index % 7 === 1 ? "ready" : "not_generated" },
      quiz: { ready: index % 6 === 1, latest_quiz_id: index % 6 === 1 ? `quiz-${index}` : null },
      review: { latest_attempt_id: index === 2 ? "attempt-2" : null },
    },
  };
});

export function Round6LibraryQa() {
  const [view, setView] = useState(initialView);
  const [query, setQuery] = useState(params.get("query") || "");
  const [selected, setSelected] = useState(() => new Set());
  const projection = useMemo(() => projectLibrary(fixture, { view, query, sort: "az" }), [view, query]);
  useEffect(() => {
    const visibleIds = new Set(projection.rows.map((doc) => doc.document_id));
    setSelected((current) => new Set([...current].filter((id) => visibleIds.has(id))));
  }, [projection.rows]);
  return (
    <main data-testid="round6-library-qa" className="mx-auto max-w-[1180px] px-4 py-6">
      <header className="mb-5">
        <p className="font-mono text-metadata uppercase text-text-muted">StudyMap · deterministic QA</p>
        <h1 className="font-display text-h2 text-text-primary">Thư viện học tập</h1>
      </header>
      <div className="header-search mb-4 max-w-[420px]">
        <input aria-label="Tìm trong thư viện QA" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tài liệu" />
      </div>
      <LibraryTaskViews value={view} counts={projection.counts} onChange={setView} />
      <p data-testid="result-count" className="mb-3 text-small text-text-muted">{projection.rows.length} tài liệu phù hợp</p>
      {projection.rows.length === 0 ? (
        <EmptyState icon="Search" title="Không có tài liệu phù hợp"
          hint="Hãy đổi mục tiêu học tập, bộ sưu tập, bộ lọc hoặc từ khoá tìm kiếm."
          action={<button type="button" className="pill-action mt-1" onClick={() => { setView(TASK_VIEW.ALL); setQuery(""); }}>Xem tất cả tài liệu</button>} />
      ) : (
        <section className="study-document-matrix" aria-label="Danh sách tài liệu QA">
          {projection.rows.map((doc, index) => <StudyDocumentActionRow key={doc.document_id}
            doc={doc} view={view} primaryTabIndex={index === 0 ? 0 : -1}
            onOpen={(item, surface) => { window.__round6LastOpen = [item.document_id, surface]; }}
            onDetails={() => {}} onRename={() => {}} onPatch={() => {}}
            selected={selected.has(doc.document_id)}
            onSelect={(id) => setSelected((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })} />)}
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<Round6LibraryQa />);
