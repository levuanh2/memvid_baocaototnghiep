import { loc, sapXep, tim } from "./thuVienTaiLieu";
import { tiepTucHoc } from "./tiepTucHoc";
import { thanRequest } from "./chonNhieu";

export const ARTIFACT_STATE = Object.freeze({
  READY: "ready",
  MISSING: "missing",
  UNKNOWN: "unknown",
});

export const TASK_VIEW = Object.freeze({
  ALL: "all",
  CONTINUE: "continue",
  NEEDS_QUIZ: "needs_quiz",
  NEEDS_SUMMARY: "needs_summary",
});

export const TASK_VIEWS = Object.freeze([
  TASK_VIEW.ALL,
  TASK_VIEW.CONTINUE,
  TASK_VIEW.NEEDS_QUIZ,
  TASK_VIEW.NEEDS_SUMMARY,
]);

function summaryState(doc) {
  const state = doc?.ai?.summary?.state;
  if (state === "ready") return ARTIFACT_STATE.READY;
  if (state === "not_generated" && doc?.ai?.index === "ready") return ARTIFACT_STATE.MISSING;
  return ARTIFACT_STATE.UNKNOWN;
}

function quizState(doc) {
  // `ready` is not independently actionable: the production library payload
  // pairs it with `latest_quiz_id`, which is the destination the row opens.
  if (doc?.ai?.quiz?.ready === true && doc?.ai?.quiz?.latest_quiz_id) {
    return ARTIFACT_STATE.READY;
  }
  if (doc?.ai?.quiz?.ready === true) return ARTIFACT_STATE.UNKNOWN;
  if (doc?.ai?.quiz?.ready === false && doc?.ai?.index === "ready") return ARTIFACT_STATE.MISSING;
  return ARTIFACT_STATE.UNKNOWN;
}

export function deriveLearningState(doc) {
  return {
    ...doc,
    summaryState: summaryState(doc),
    quizState: quizState(doc),
    continuing: Boolean(tiepTucHoc(doc)),
  };
}

export function matchesTaskView(doc, view) {
  if (view === TASK_VIEW.CONTINUE) return doc.continuing;
  if (view === TASK_VIEW.NEEDS_QUIZ) return doc.quizState === ARTIFACT_STATE.MISSING;
  if (view === TASK_VIEW.NEEDS_SUMMARY) return doc.summaryState === ARTIFACT_STATE.MISSING;
  return true;
}

function canonicalDocuments(documents) {
  const seen = new Set();
  return (documents || []).filter((doc) => {
    const id = doc?.document_id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function projectLibrary(documents, {
  query = "",
  collectionIndex = null,
  collectionId = null,
  tags = [],
  filterKeys = [],
  includeArchived = false,
  view = TASK_VIEW.ALL,
  sort = "newest",
} = {}) {
  const canonical = canonicalDocuments(documents);
  const searched = tim(canonical, query, collectionIndex);
  const filtered = loc(searched, filterKeys, {
    hienLuuTru: includeArchived,
    collectionId,
    tags,
  }).map(deriveLearningState);
  const counts = Object.fromEntries(TASK_VIEWS.map((taskView) => [
    taskView,
    filtered.filter((doc) => matchesTaskView(doc, taskView)).length,
  ]));
  const rows = sapXep(filtered.filter((doc) => matchesTaskView(doc, view)), sort);
  return { base: filtered, rows, counts };
}

export function primaryActionFor(view, doc) {
  if (!doc) return null;
  if (view === TASK_VIEW.NEEDS_SUMMARY) {
    return doc.summaryState === ARTIFACT_STATE.MISSING
      ? { label: "Tạo tóm tắt", surface: "summary" }
      : null;
  }
  if (view === TASK_VIEW.NEEDS_QUIZ) {
    return doc.quizState === ARTIFACT_STATE.MISSING
      ? { label: "Tạo quiz", surface: "quiz" }
      : null;
  }
  const resume = tiepTucHoc(doc);
  if (resume) {
    return {
      label: `Tiếp tục · ${resume.nhanBeMat}`,
      surface: resume.beMat || "studymap",
    };
  }
  return { label: "Bắt đầu · Tóm tắt", surface: "summary" };
}

export function pruneSelection(selectedIds, visibleDocuments) {
  const visible = new Set((visibleDocuments || []).map((doc) => doc?.document_id).filter(Boolean));
  return new Set([...(selectedIds || [])].filter((id) => visible.has(id)));
}

export function sameSelection(a, b) {
  if (a === b) return true;
  if ((a?.size || 0) !== (b?.size || 0)) return false;
  for (const id of a || []) if (!b?.has(id)) return false;
  return true;
}

export function effectiveBulkRequest(action, selectedIds, visibleDocuments, options) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  const orderedVisibleIds = (visibleDocuments || [])
    .map((doc) => doc?.document_id)
    .filter((id) => id && selected.has(id));
  return thanRequest(action, orderedVisibleIds, options);
}

export function resolveRovingDocumentId(visibleDocuments, currentId) {
  const ids = (visibleDocuments || []).map((doc) => doc?.document_id).filter(Boolean);
  if (!ids.length) return null;
  return currentId && ids.includes(currentId) ? currentId : ids[0];
}

export function moveRovingDocumentId(visibleDocuments, currentId, key) {
  const ids = (visibleDocuments || []).map((doc) => doc?.document_id).filter(Boolean);
  if (!ids.length) return null;
  const currentIndex = Math.max(0, ids.indexOf(resolveRovingDocumentId(visibleDocuments, currentId)));
  if (key === "Home") return ids[0];
  if (key === "End") return ids.at(-1);
  if (key === "ArrowDown") return ids[Math.min(ids.length - 1, currentIndex + 1)];
  if (key === "ArrowUp") return ids[Math.max(0, currentIndex - 1)];
  return ids[currentIndex];
}
