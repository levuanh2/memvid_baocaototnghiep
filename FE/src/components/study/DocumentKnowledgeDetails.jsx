import { useCallback, useEffect, useRef, useState } from "react";
import { chipHienThi } from "../../utils/trangThaiAi";
import { getQuestions, moTaLoi } from "../../utils/studyApi";
import KnowledgePanel from "./KnowledgePanel";

export default function DocumentKnowledgeDetails({
  open, doc, documents, chiMucBst, jobs, onOpen,
}) {
  const [everOpened, setEverOpened] = useState(false);
  const [questions, setQuestions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);

  const loadQuestions = useCallback(() => {
    if (inFlight.current || questions != null) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    getQuestions(doc.document_id)
      .then((items) => setQuestions(items))
      .catch((reason) => setError(moTaLoi(reason, "Không tải được câu hỏi gợi ý.")))
      .finally(() => { inFlight.current = false; setLoading(false); });
  }, [doc.document_id, questions]);

  useEffect(() => {
    if (!open) return;
    setEverOpened(true);
    loadQuestions();
  }, [open, loadQuestions]);

  if (!everOpened && !open) return null;
  return (
    <div id={`matrix-details-${doc.document_id}`}
      className={`knowledge-panel study-document-row__details${open ? " knowledge-panel--open" : ""}`}
      aria-hidden={!open} inert={!open ? "" : undefined}
      onKeyDown={(event) => event.stopPropagation()}>
      <KnowledgePanel doc={doc} documents={documents} chiMucBst={chiMucBst}
        chips={chipHienThi(doc, jobs)} cauHoi={questions} dangTaiCauHoi={loading}
        loiCauHoi={error} onThuLai={loadQuestions} onMo={onOpen} />
    </div>
  );
}
