import { createRoot } from "react-dom/client";
import { useMemo, useState } from "react";
import "./index.css";
import "./components/study/libraryActionMatrix.css";
import LibraryTaskViews from "./components/study/LibraryTaskViews";
import StudyDocumentActionRow from "./components/study/StudyDocumentActionRow";
import { TASK_VIEW, projectLibrary } from "./utils/libraryActionMatrix";

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
  const [view, setView] = useState(TASK_VIEW.ALL);
  const [query, setQuery] = useState("");
  const projection = useMemo(() => projectLibrary(fixture, { view, query, sort: "az" }), [view, query]);
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
      <section className="study-document-matrix" aria-label="Danh sách tài liệu QA">
        {projection.rows.map((doc, index) => <StudyDocumentActionRow key={doc.document_id}
          doc={doc} view={view} primaryTabIndex={index === 0 ? 0 : -1}
          onOpen={(item, surface) => { window.__round6LastOpen = [item.document_id, surface]; }}
          onDetails={() => {}} onRename={() => {}} onPatch={() => {}}
          selected={false} onSelect={() => {}} />)}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<Round6LibraryQa />);
