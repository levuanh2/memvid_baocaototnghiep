import { createRoot } from "react-dom/client";
import { useState } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import { StudyContextProvider } from "./study/StudyContextProvider";
import QuizTaking from "./pages/study/QuizTaking";
import QuizResult from "./pages/study/QuizResult";
import ReviewGuide from "./pages/study/ReviewGuide";
import ChatArea from "./components/Layout/ChatArea";
import ProfilePage from "./pages/ProfilePage";
import { AuthContext } from "./auth/context";
import { luuGrant } from "./auth/grantNks";
import DestructiveConfirmDialog from "./components/ui/DestructiveConfirmDialog";

const params = new URLSearchParams(location.search);
const VIEW = params.get("view") || "taking";
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
window.setDark = (on) => document.documentElement.classList.toggle("dark", on);

// Deterministic fixture matching the production API shapes in studyApi.js.
// Wrong answers are at original positions 4 and 9; IDs intentionally do not
// encode an ordinal that presentation code could safely infer.
const ATTEMPT_ID = "attempt-qa-1";
const QUIZ_ID = "quiz-qa-1";
const QUESTIONS = Array.from({ length: 10 }, (_, i) => {
  const n = i + 1;
  const wrong = n === 4 || n === 9;
  const isShort = n === 10;
  return {
    question_id: `qid-r71-${String.fromCharCode(97 + i)}`,
    question_type: isShort ? "short_answer" : n === 7 ? "true_false" : "multiple_choice",
    question_text: `Câu hỏi số ${n}: nội dung minh hoạ cho câu hỏi thứ ${n} trong bài kiểm tra.`,
    concept_tags: [n <= 5 ? "Tiến trình" : "Bộ nhớ"],
    options: isShort ? [] : n === 7 ? ["true", "false"] : ["A", "B", "C", "D"],
    correct_answer: isShort ? "đáp án mẫu" : n === 7 ? "true" : "B",
    user_answer: wrong ? "A" : isShort ? "đáp án mẫu" : n === 7 ? "true" : "B",
    verdict: wrong ? "incorrect" : "correct",
    explanation: `Giải thích chi tiết cho câu ${n}.`,
    chunk_ids: [`chunk-${n}`],
  };
});
const RESULT_QUESTIONS = VIEW === "tones"
  ? QUESTIONS.map((question, index) => (index === 5
    ? { ...question, user_answer: "A", verdict: "partial", explanation: "Giải thích đúng một phần." }
    : question))
  : QUESTIONS;

let savedAnswers = { [QUESTIONS[1].question_id]: "B" };
let attemptStatus = VIEW === "graded" || VIEW === "tones" ? "graded" : VIEW === "pending" ? "submitted" : "in_progress";
let forceNextSaveFail = false;
let forceDeleteFail = false;
let saveCallCount = 0;
let submitCallCount = 0;
const deleteLog = [];
const practiceCalls = [];
if (VIEW === "profile") luuGrant("round7-fixture-grant", Date.now() / 1000 + 3600);

window.__qa = {
  forceNextSaveFail: () => { forceNextSaveFail = true; },
  setDeleteFailure: (on) => { forceDeleteFail = Boolean(on); },
  grade: () => { attemptStatus = "graded"; },
  saveCallCount: () => saveCallCount,
  submitCallCount: () => submitCallCount,
  savedAnswers: () => ({ ...savedAnswers }),
  attemptStatus: () => attemptStatus,
  deleteLog: () => [...deleteLog],
  practiceCalls: () => [...practiceCalls],
};

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

window.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const u = new URL(url, location.origin);
  const path = u.pathname;
  const method = (init.method || "GET").toUpperCase();

  if (method === "POST" && path === `/api/quizzes/${QUIZ_ID}/attempts`) {
    return jsonRes({
      quiz: { title: "Hệ điều hành hiện đại — kiểm tra giữa kỳ", questions: QUESTIONS },
      attempt_id: ATTEMPT_ID,
      answers: Object.entries(savedAnswers).map(([question_id, user_answer]) => ({ question_id, user_answer })),
      status: attemptStatus,
    });
  }
  if (method === "PATCH" && path === `/api/attempts/${ATTEMPT_ID}/answers`) {
    saveCallCount += 1;
    if (forceNextSaveFail) {
      forceNextSaveFail = false;
      return jsonRes({ error: "save_failed", message: "Lỗi giả lập để kiểm thử phục hồi." }, 500);
    }
    const body = JSON.parse(init.body || "{}");
    Object.assign(savedAnswers, body.answers || {});
    return jsonRes({ ok: true });
  }
  if (method === "POST" && path === `/api/attempts/${ATTEMPT_ID}/submit`) {
    submitCallCount += 1;
    attemptStatus = "submitted";
    return jsonRes({ ok: true });
  }
  if (method === "GET" && path === `/api/quizzes/results/${ATTEMPT_ID}`) {
    if (attemptStatus !== "graded") {
      return jsonRes({
        status: "submitted", quiz_title: "Hệ điều hành hiện đại — kiểm tra giữa kỳ",
        score: 8, max_score: 10, percentage: 90, correct_count: 8, incorrect_count: 2,
        total_questions: 10, duration_seconds: 642, questions: QUESTIONS,
      });
    }
    const wrongCount = RESULT_QUESTIONS.filter((question) => question.verdict !== "correct").length;
    return jsonRes({
      status: "graded", quiz_title: "Hệ điều hành hiện đại — kiểm tra giữa kỳ",
      score: 10 - wrongCount, max_score: 10, percentage: (10 - wrongCount) * 10,
      correct_count: 10 - wrongCount, incorrect_count: wrongCount,
      total_questions: 10, duration_seconds: 642, questions: RESULT_QUESTIONS,
    });
  }
  if (method === "GET" && path === `/api/attempts/${ATTEMPT_ID}/concept-masteries`) {
    return jsonRes({ concept_masteries: [
      { concept_mastery_id: "cm-1", concept_name: "Tiến trình", mastery_score: 0.8, status: "proficient", correct_count: 4, total_count: 5 },
      { concept_mastery_id: "cm-2", concept_name: "Bộ nhớ", mastery_score: 0.4, status: "review_needed", correct_count: 2, total_count: 5 },
    ] });
  }
  if (method === "GET" && path === `/api/review-plans/${ATTEMPT_ID}`) {
    return jsonRes({
      summary: "Bạn còn yếu ở phần Bộ nhớ — tập trung ôn hai chủ đề dưới đây trước khi luyện tiếp.",
      items: [{
        review_item_id: "ri-1", topic: "Bộ nhớ: phân trang theo yêu cầu", priority: 1,
        status: "review_needed", mastery_score: 0.4,
        reason: "Hai câu sai liên quan trực tiếp tới chủ đề này.",
        review_tasks: ["Đọc lại phần phân trang theo yêu cầu", "Ôn khái niệm page fault"],
        chunk_ids: ["chunk-4", "chunk-9"],
      }],
    });
  }
  if (method === "GET" && path === "/me/nks/profile") {
    return jsonRes({ profile: {
      firstname: "An", lastname: "Nguyễn", phone: "+84 900 000 071", gender: 1,
      dob: "2000-01-02", pob: "Hà Nội", province: "Hà Nội",
      website: "https://example.test", intro: "Người học kiểm thử Round 7.",
    } });
  }
  if (method === "POST" && path === "/api/practice/generate") {
    practiceCalls.push(JSON.parse(init.body || "{}"));
    return jsonRes({ job_id: "job-qa-1" });
  }
  if (method === "GET" && path === "/api/jobs/job-qa-1") {
    return jsonRes({ status: "done", progress: 100, result: { quiz_id: "practice-qa-1" } });
  }
  if (method === "DELETE" && /^\/(?:api\/)?(conversations|mindmaps|summaries)\//.test(path)) {
    const [, kind, id] = path.match(/^\/(?:api\/)?(conversations|mindmaps|summaries)\/(.+)$/) || [];
    deleteLog.push({ kind, id: decodeURIComponent(id || "") });
    if (forceDeleteFail) return jsonRes({ error: "delete_failed" }, 500);
    return jsonRes({ ok: true });
  }
  return jsonRes({ error: "unhandled_fixture_request", method, path }, 501);
};

function DestructiveDemo() {
  const [target, setTarget] = useState({ kind: "mindmaps", id: "map-alpha", name: "Sơ đồ Alpha" });
  const [open, setOpen] = useState(true);
  const choose = (next) => { setTarget(next); setOpen(true); };
  return (
    <main style={{ minHeight: "100vh", padding: 24, background: "var(--bg-base)" }}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => choose({ kind: "mindmaps", id: "map-alpha", name: "Sơ đồ Alpha" })}>Xóa sơ đồ Alpha</button>
        <button type="button" className="btn-secondary" onClick={() => choose({ kind: "mindmaps", id: "map-beta", name: "Sơ đồ Beta" })}>Xóa sơ đồ Beta</button>
        <button type="button" className="btn-secondary" onClick={() => choose({ kind: "summaries", id: "summary-gamma", name: "Tóm tắt Gamma" })}>Xóa tóm tắt Gamma</button>
      </div>
      <DestructiveConfirmDialog
        open={open}
        title={target.kind === "summaries" ? "Xóa tóm tắt?" : "Xóa sơ đồ?"}
        targetName={target.name}
        consequenceText={target.kind === "summaries"
          ? "Bản tóm tắt này sẽ bị xóa vĩnh viễn. Không thể hoàn tác."
          : "Sơ đồ này và toàn bộ nội dung liên quan sẽ bị xóa vĩnh viễn. Không thể hoàn tác."}
        confirmLabel={target.kind === "summaries" ? "Xóa tóm tắt" : "Xóa sơ đồ"}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          const response = await fetch(`/api/${target.kind}/${target.id}`, { method: "DELETE" });
          if (!response.ok) throw new Error(target.kind === "summaries" ? "Không xóa được tóm tắt!" : "Không xóa được sơ đồ!");
          setOpen(false);
        }}
      />
    </main>
  );
}

function ChatDemo() {
  return <div style={{ height: "100vh", background: "var(--bg-base)" }}><ChatArea selectedSources={[]} sources={[]} onEvidence={() => {}} onHighlight={() => {}} /></div>;
}

function ProfileDemo() {
  return (
    <AuthContext.Provider value={{
      user: {
        id: "profile-qa-1", display_name: "Nguyễn An", email: "qa-round7@example.test",
        phone: "+84 900 000 071", role: "learner", provider: "nks", avatar: null,
      },
      updateUserFields: () => {},
    }}>
      <MemoryRouter initialEntries={["/app/profile"]}>
        <Routes><Route path="/app/profile" element={<ProfilePage />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

function StudyRoutes() {
  const initial = VIEW === "taking" ? `/app/study/quiz/${QUIZ_ID}`
    : VIEW === "review" ? `/app/study/review/${ATTEMPT_ID}`
      : `/app/study/result/${ATTEMPT_ID}`;
  return (
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/app/study/quiz/:quizId" element={<QuizTaking />} />
        <Route path="/app/study/result/:attemptId" element={<QuizResult />} />
        <Route path="/app/study/review/:attemptId" element={<ReviewGuide />} />
        <Route path="/app/study/practice/:practiceId" element={<main className="p-8">Practice fixture complete</main>} />
      </Routes>
    </MemoryRouter>
  );
}

function App() {
  let content;
  if (VIEW === "destructive") content = <DestructiveDemo />;
  else if (VIEW === "chat") content = <ChatDemo />;
  else if (VIEW === "profile") content = <ProfileDemo />;
  else content = <StudyRoutes />;
  return <StudyContextProvider>{content}</StudyContextProvider>;
}

createRoot(document.getElementById("root")).render(<App />);
