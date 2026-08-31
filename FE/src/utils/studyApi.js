// StudyMap API — tài liệu, quiz, làm bài, ôn tập, luyện tập, tiến độ.
//
// Dùng lại `apiFetch` + `_appError` của chat: token, sự kiện 401 và shape lỗi
// (`err.status`) y hệt, nên mọi trang StudyMap xử lý hết phiên giống trang chat.
import { apiFetch, _appError } from "./api";

async function _json(res) {
  if (!res.ok) throw await _appError(res);
  return res.json();
}

// Lỗi cho người đọc, không phải cho console.
//
// Mất mạng thì `fetch` ném TypeError("Failed to fetch") — chuỗi tiếng Anh do trình
// duyệt sinh, người học không hiểu và cũng không biết phải làm gì; 14 chỗ trong
// pages/study từng hiện thẳng nó ra. Nhưng KHÔNG nuốt tất: BE trả nhiều thông báo
// tiếng Việt viết sẵn cho người dùng ("Phạm vi đã chọn không có chunk nào đã index")
// — mất chúng thì người dùng hết đường tự sửa. Vì vậy chỉ thay ba nhóm: lỗi mạng,
// lỗi quyền, và chuỗi "HTTP nnn" trần.
export function moTaLoi(e, duPhong = "Đã có lỗi xảy ra. Vui lòng thử lại.") {
  if (!e) return duPhong;
  if (e.name === "TypeError" || e.status === 0 || !e.status) {
    return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  }
  if (e.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (e.status === 403) return "Bạn không có quyền truy cập tài liệu này.";
  if (e.status === 404) return "Tài nguyên không tồn tại hoặc bạn không có quyền truy cập.";
  const msg = String(e.message || "").trim();
  return msg && !/^HTTP \d+$/.test(msg) ? msg : duPhong;
}

const _get = (path) => apiFetch(path).then(_json);

const _send = (path, method, body) =>
  apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then(_json);

// ── Tài liệu ────────────────────────────────────────────────────────────────
export const listDocuments = () =>
  _get("/api/documents").then((b) => b.documents || []);

export const getDocument = (documentId) =>
  _get(`/api/documents/${encodeURIComponent(documentId)}`);

export const listSections = (documentId) =>
  _get(`/api/documents/${encodeURIComponent(documentId)}/sections`).then((b) => b.sections || []);

export const listDocumentQuizzes = (documentId) =>
  _get(`/api/documents/${encodeURIComponent(documentId)}/quizzes`).then((b) => b.quizzes || []);

export const uploadDocument = async (file) => {
  const form = new FormData();
  form.append("file", file);
  // KHÔNG đặt Content-Type: trình duyệt phải tự sinh boundary cho multipart.
  return apiFetch("/api/documents/upload", { method: "POST", body: form }).then(_json);
};

// ── Sơ đồ kiến thức (FR-04) ─────────────────────────────────────────────────
export const generateStudyMap = (documentId, { force = false } = {}) =>
  _send("/api/study-maps/generate", "POST", { document_id: documentId, force });

export const getStudyMap = (mapId) => _get(`/api/study-maps/${encodeURIComponent(mapId)}`);

export const listStudyMaps = (documentId) =>
  _get(`/api/documents/${encodeURIComponent(documentId)}/study-maps`).then((b) => b.study_maps || []);

// Đoạn văn nguồn để hiện khi bấm một node. Lấy MỘT lần rồi tra theo chunk_id —
// node trỏ tới chunk bằng id, không kèm text.
export const listChunks = (documentId, { limit = 500 } = {}) =>
  _get(`/api/documents/${encodeURIComponent(documentId)}/chunks?limit=${limit}`).then((b) => b.chunks || []);

// ── Quiz ────────────────────────────────────────────────────────────────────
export const generateQuiz = (payload) => _send("/api/quizzes/generate", "POST", payload);

export const getQuiz = (quizId) => _get(`/api/quizzes/${encodeURIComponent(quizId)}`);

export const listQuizAttempts = (quizId) =>
  _get(`/api/quizzes/${encodeURIComponent(quizId)}/attempts`).then((b) => b.attempts || []);

// ── Làm bài ─────────────────────────────────────────────────────────────────
export const openAttempt = (quizId) =>
  _send(`/api/quizzes/${encodeURIComponent(quizId)}/attempts`, "POST");

export const getAttempt = (attemptId) => _get(`/api/attempts/${encodeURIComponent(attemptId)}`);

export const saveAnswers = (attemptId, answers) =>
  _send(`/api/attempts/${encodeURIComponent(attemptId)}/answers`, "PATCH", { answers });

export const submitAttempt = (attemptId) =>
  _send(`/api/attempts/${encodeURIComponent(attemptId)}/submit`, "POST");

export const getResult = (attemptId) =>
  _get(`/api/quizzes/results/${encodeURIComponent(attemptId)}`);

// ── Ôn tập ──────────────────────────────────────────────────────────────────
export const getConceptMasteries = (attemptId, { weakOnly = false } = {}) =>
  _get(`/api/attempts/${encodeURIComponent(attemptId)}/concept-masteries${weakOnly ? "?weak=1" : ""}`)
    .then((b) => b.concept_masteries || []);

export const generateReviewPlan = (attemptId, { force = false } = {}) =>
  _send("/api/review-plans/generate", "POST", { attempt_id: attemptId, force });

export const getReviewPlan = (attemptId) =>
  _get(`/api/review-plans/${encodeURIComponent(attemptId)}`);

// ── Luyện tập ───────────────────────────────────────────────────────────────
export const generatePractice = (payload) => _send("/api/practice/generate", "POST", payload);

export const getPractice = (practiceQuizId) =>
  _get(`/api/practice/${encodeURIComponent(practiceQuizId)}`);

export const submitPractice = (practiceQuizId, answers) =>
  _send(`/api/practice/${encodeURIComponent(practiceQuizId)}/submit`, "POST", { answers });

export const getPracticeComparison = (practiceQuizId) =>
  _get(`/api/practice/${encodeURIComponent(practiceQuizId)}/comparison`);

// ── Tiến độ ─────────────────────────────────────────────────────────────────
export const getProgressOverview = () => _get("/api/progress/overview");

export const getProgressConcepts = ({ weakOnly = false } = {}) =>
  _get(`/api/progress/concepts${weakOnly ? "?weak=1" : ""}`).then((b) => b.concepts || []);

export const getProgressAttempts = ({ limit = 50 } = {}) =>
  _get(`/api/progress/attempts?limit=${encodeURIComponent(limit)}`).then((b) => b.attempts || []);

// ── Job ─────────────────────────────────────────────────────────────────────
// Một endpoint cho MỌI loại job. Trước đây mỗi tính năng có route riêng và mỗi
// lần thêm trạng thái là một chỗ nữa phải nhớ cập nhật (known-issues 2026-07-17).
export const getJob = (jobId) => _get(`/api/jobs/${encodeURIComponent(jobId)}`);

export const cancelJob = (jobId) => _send(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, "POST");

// `jobPoller` đọc `current_node`, còn API mới trả `current_step` — ánh xạ tại đây
// để dùng lại nguyên poller (đã xử lý interrupted/404/mất mạng) thay vì viết mới.
export const fetchJobStatus = async (jobId) => {
  const j = await getJob(jobId);
  return { ...j, current_node: j.current_step ?? j.current_node ?? "" };
};

// ── Hiển thị ────────────────────────────────────────────────────────────────
export const MASTERY_LABEL = {
  mastered: "Đã nắm tốt",
  light_review: "Cần ôn nhẹ",
  review_needed: "Cần ôn lại",
  critical_gap: "Hổng nghiêm trọng",
};

export const VERDICT_LABEL = {
  correct: "Đúng",
  partial: "Đúng một phần",
  incorrect: "Sai",
};

export const QUESTION_TYPE_LABEL = {
  multiple_choice: "Trắc nghiệm",
  true_false: "Đúng / Sai",
  short_answer: "Trả lời ngắn",
};

// Đúng/sai lưu ở DB là "true"/"false"; người học không đọc chuỗi đó.
export const optionLabel = (option) =>
  option === "true" ? "Đúng" : option === "false" ? "Sai" : option;

/** Phần trăm để vẽ con dấu mastery. Ngoài [0,1] thì kẹp lại chứ không vẽ tràn. */
export const masteryPercent = (score) => {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(1, Math.max(0, n)) * 100);
};

/** "3 / 10" — điểm thô, không quy đổi thang 10 (đặc tả 4.8). */
export const formatScore = (score, maxScore) => {
  if (score == null || maxScore == null) return "—";
  const trim = (n) => (Number.isInteger(Number(n)) ? String(Number(n)) : String(Number(n)));
  return `${trim(score)} / ${trim(maxScore)}`;
};

export const formatDuration = (seconds) => {
  // `Number(null)` là 0 — chưa nộp bài mà hiện "0 giây" là bịa số liệu.
  if (seconds == null || seconds === "") return "—";
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return "—";
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return m ? `${m} phút ${s} giây` : `${s} giây`;
};

// Nhãn hiển thị cho sơ đồ kiến thức.
export const NODE_TYPE_LABEL = {
  root: "Tài liệu",
  section: "Chương mục",
  concept: "Khái niệm",
  example: "Ví dụ",
};

export const RELATION_LABEL = {
  parent_child: "chứa",
  prerequisite: "cần học trước",
  supports: "củng cố",
  contrasts: "đối lập",
  related: "liên quan",
};

/**
 * Danh sách node phẳng -> cây cho react-d3-tree.
 *
 * Backend đã sắp cha-trước-con, nhưng KHÔNG tin điều đó ở đây: một node mồ côi
 * (cha bị lọc mất) hay một vòng lặp sẽ làm cây rỗng và người dùng thấy trang
 * trắng không rõ vì sao. Node không gắn được vào đâu thì treo lên gốc.
 */
export function buildMapTree(nodes) {
  const list = Array.isArray(nodes) ? nodes.filter((n) => n && n.node_id) : [];
  if (!list.length) return null;

  const byId = new Map(list.map((n) => [n.node_id, n]));
  const childIds = new Map();
  const rootIds = [];
  for (const n of list) {
    const parent = n.parent_node_id;
    // Cha phải tồn tại và không phải chính nó, nếu không node thành gốc.
    if (parent && parent !== n.node_id && byId.has(parent)) {
      if (!childIds.has(parent)) childIds.set(parent, []);
      childIds.get(parent).push(n.node_id);
    } else {
      rootIds.push(n.node_id);
    }
  }

  // Gắn từ trên xuống, mỗi node gắn ĐÚNG MỘT LẦN. Kiểm `attached` ngay lúc gắn
  // (không lọc trước rồi map) — nếu không, một node đã bị nhánh trước hút vào
  // vẫn được gắn lại ở nhánh sau và cây thành vòng.
  const attached = new Set();
  const makeNode = (id) => {
    attached.add(id);
    const n = byId.get(id);
    const children = [];
    for (const childId of childIds.get(id) || []) {
      if (!attached.has(childId)) children.push(makeNode(childId));
    }
    return { name: n.title || "(không tên)", attributes: n, children };
  };

  const roots = rootIds.map(makeNode);
  // Còn sót = node nằm trong vòng lặp cha-con (không tới được từ gốc nào).
  // Kéo lên gốc: cây phẳng hơn vẫn tốt hơn mất node hoặc treo trình duyệt.
  for (const n of list) {
    if (!attached.has(n.node_id)) roots.push(makeNode(n.node_id));
  }

  if (roots.length === 1) return roots[0];
  return { name: "Sơ đồ", attributes: { node_type: "root" }, children: roots };
}
