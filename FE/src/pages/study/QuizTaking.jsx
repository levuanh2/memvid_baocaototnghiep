import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import StudyShell from "../../components/study/StudyShell";
import Modal from "../../components/ui/Modal";
import { Icon } from "../../components/ui/Icon";
import Spinner from "../../components/ui/Spinner";
import {
  QUESTION_TYPE_LABEL,
  openAttempt,
  optionLabel,
  saveAnswers,
  submitAttempt,
  moTaLoi,
} from "../../utils/studyApi";
import { taoSoNhap } from "../../utils/soNhap";
import "./quizJourney.css";

const KEYS = ["A", "B", "C", "D", "E", "F"];

export default function QuizTaking() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  // Trang tạo quiz gửi kèm số câu đã xin / giữ / bị loại. Chỉ có ở lần điều hướng ngay
  // sau khi ra đề; mở lại quiz từ chỗ khác thì không có và cũng không cần.
  const raDe = useLocation().state;

  const [quiz, setQuiz] = useState(null);
  const [attemptId, setAttemptId] = useState(null);
  const [answers, setAnswers] = useState({});
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const soNhapRef = useRef(null);
  if (soNhapRef.current === null) soNhapRef.current = taoSoNhap();
  const flushRef = useRef(null);
  const saveTailRef = useRef(Promise.resolve());
  const saveErrorRef = useRef(null);
  const attemptRef = useRef(null);
  const attemptGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const submittingRef = useRef(false);
  // Số câu đã chọn nhưng CHƯA lên được server. Bộ đếm "N/M đã trả lời" đọc state
  // trong máy, nên nếu không nói riêng ra thì nó báo đã lưu cho cả những câu server
  // chưa hề nhận.
  const [choLuu, setChoLuu] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Mở quiz TẠO attempt ngay (FR-07.10); mở lại thì BE trả đúng attempt đang
      // dở nên đáp án nháp cũ hiện lại nguyên vẹn.
      const body = await openAttempt(quizId);
      setQuiz(body.quiz);
      setAttemptId(body.attempt_id);
      const restored = {};
      for (const a of body.answers || []) {
        if (a.user_answer != null) restored[a.question_id] = a.user_answer;
      }
      setAnswers(restored);
      if (body.status !== "in_progress") {
        navigate(`/app/study/result/${body.attempt_id}`, { replace: true });
      }
    } catch (e) {
      setError(moTaLoi(e, "Không mở được quiz."));
    } finally {
      setLoading(false);
    }
  }, [quizId, navigate]);

  useEffect(() => { load(); }, [load]);

  // Mảng mới mỗi lần render sẽ làm useMemo bên dưới tính lại vô ích.
  const questions = useMemo(() => quiz?.questions || [], [quiz]);
  const current = questions[index];
  const unanswered = useMemo(
    () => questions.filter((q) => !String(answers[q.question_id] ?? "").trim()),
    [questions, answers],
  );
  const answeredCount = questions.length - unanswered.length;
  // Handing in is the main action on the last question, or once nothing is left unanswered.
  const nenNop = index >= questions.length - 1 || unanswered.length === 0;
  const topicCounts = useMemo(() => {
    const counts = new Map();
    questions.forEach((question) => {
      const topic = question.concept_tags?.[0];
      if (topic) counts.set(topic, (counts.get(topic) || 0) + 1);
    });
    return [...counts.entries()].slice(0, 4);
  }, [questions]);

  const flushPending = useCallback(({ forSubmit = false, expectedAttemptId = attemptId } = {}) => {
    const generation = attemptGenerationRef.current;
    const so = soNhapRef.current;
    const operation = saveTailRef.current.then(async () => {
      const isCurrentAttempt = () => (
        mountedRef.current
        && attemptGenerationRef.current === generation
        && attemptRef.current === expectedAttemptId
      );
      if (!expectedAttemptId || !isCurrentAttempt()) {
        throw new DOMException("Attempt changed", "AbortError");
      }
      // A failed autosave is a failed submission barrier. Keep its batch in
      // the draft and require an explicit retry instead of silently grading.
      if (forSubmit && saveErrorRef.current) {
        const previousError = saveErrorRef.current;
        saveErrorRef.current = null;
        throw previousError;
      }

      setSaving(true);
      try {
        // Submission owns this serialized section until every newer local
        // answer version has also been acknowledged by the server.
        do {
          const batch = so.layDeGui();
          if (!Object.keys(batch).length) break;
          try {
            await saveAnswers(expectedAttemptId, batch);
          } catch (saveError) {
            if (isCurrentAttempt()) {
              so.traLai(batch);
              saveErrorRef.current = saveError;
              setChoLuu(so.demCho());
              setError(moTaLoi(saveError, "Không lưu được câu trả lời."));
            }
            throw saveError;
          }
        } while (forSubmit && isCurrentAttempt() && so.coGi());
        if (!isCurrentAttempt()) throw new DOMException("Attempt changed", "AbortError");
        saveErrorRef.current = null;
        setChoLuu(so.demCho());
      } finally {
        if (isCurrentAttempt()) setSaving(false);
      }
    });
    // A rejected write must reject its caller but must not poison the queue.
    saveTailRef.current = operation.catch(() => undefined);
    return operation;
  }, [attemptId]);

  // Lưu nháp gộp lô: mỗi lần bấm đáp án mà gọi API ngay thì bấm nhanh 10 câu là
  // 10 request chồng nhau, và request về trễ có thể ghi đè lựa chọn mới hơn.
  const queueSave = useCallback((questionId, value) => {
    const so = soNhapRef.current;
    so.dat(questionId, value);
    setChoLuu(so.demCho());
    if (flushRef.current) clearTimeout(flushRef.current);
    const scheduledAttemptId = attemptId;
    flushRef.current = setTimeout(() => {
      if (!attemptId || !so.coGi()) return;
      void flushPending({ expectedAttemptId: scheduledAttemptId }).catch(() => undefined);
    }, 600);
  }, [attemptId, flushPending]);

  useEffect(() => {
    attemptRef.current = attemptId;
    attemptGenerationRef.current += 1;
    saveErrorRef.current = null;
    submittingRef.current = false;
    setSubmitting(false);
    setConfirming(false);
    setSaving(false);
    if (flushRef.current) clearTimeout(flushRef.current);
    soNhapRef.current = taoSoNhap();
    setChoLuu(0);
  }, [attemptId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attemptGenerationRef.current += 1;
      if (flushRef.current) clearTimeout(flushRef.current);
    };
  }, []);

  const choose = (questionId, value) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    queueSave(questionId, value);
  };

  const onSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    const submittingAttemptId = attemptId;
    const submittingGeneration = attemptGenerationRef.current;
    try {
      // Gửi nốt nháp còn treo trước khi nộp — nếu không, câu vừa chọn sẽ mất. Gồm cả
      // lô của một lần lưu đã hỏng trước đó: nộp mà thiếu nó thì mấy câu ấy bị chấm
      // như chưa trả lời, và trang kết quả hiện ra y như một lần nộp bình thường.
      if (flushRef.current) clearTimeout(flushRef.current);
      await flushPending({ forSubmit: true, expectedAttemptId: submittingAttemptId });
      if (!mountedRef.current || attemptGenerationRef.current !== submittingGeneration || attemptRef.current !== submittingAttemptId) {
        throw new DOMException("Attempt changed", "AbortError");
      }
      await submitAttempt(submittingAttemptId);
      if (!mountedRef.current || attemptGenerationRef.current !== submittingGeneration || attemptRef.current !== submittingAttemptId) return;
      navigate(`/app/study/result/${submittingAttemptId}`, { replace: true });
    } catch (e) {
      if (e?.name === "AbortError") return;
      saveErrorRef.current = null;
      setError(moTaLoi(e, "Nộp bài thất bại."));
      setSubmitting(false);
      setConfirming(false);
      submittingRef.current = false;
    }
  };

  return (
    <StudyShell
      eyebrow={`Câu ${questions.length ? index + 1 : 0} / ${questions.length}`}
      title={quiz?.title || "Làm quiz"}
      backTo="/app/study"
      loading={loading}
      error={error && !quiz ? error : null}
      onRetry={load}
      width="max-w-[1220px]"
      actions={
        // Phase 6, Step 2: đếm câu đã trả lời/đang lưu đổi liên tục trong lúc
        // làm bài — không có aria-live thì chỉ ai NHÌN thấy mới biết trạng thái
        // lưu vừa đổi; người dùng đọc màn hình sẽ không hay autosave vừa hỏng.
        <span className="font-mono text-caption text-text-muted" aria-live="polite">
          {saving
            ? "đang lưu…"
            : choLuu > 0
              ? `${choLuu} câu chưa lưu được`
              : `${questions.length - unanswered.length}/${questions.length} đã trả lời`}
        </span>
      }
    >
      {raDe?.rejected > 0 && (
        <div className="surface-card !py-3 !px-4 mb-4 flex items-start gap-2.5 text-small text-text-secondary">
          <Icon name="AlertCircle" size={15} className="text-text-muted mt-0.5 shrink-0" />
          <span>
            Ra được <strong className="text-text-primary">{raDe.kept}</strong> câu trên{" "}
            {raDe.asked} câu đã chọn. {raDe.rejected} câu bị loại vì không đạt kiểm chất
            lượng{raDe.reason ? <> — phần lớn do {raDe.reason}.</> : "."}
          </span>
        </div>
      )}
      {!current ? (
        // A quiz that opened with no questions used to leave the page blank under its title.
        quiz && !loading ? (
          <div className="surface-card max-w-[560px]" role="status">
            <p className="text-body text-text-primary">Quiz này không có câu hỏi nào.</p>
            <p className="mt-1 text-small text-text-secondary">Về Thư viện để tạo một quiz khác từ tài liệu.</p>
            <Link to="/app/study" className="btn-secondary text-small inline-flex items-center gap-1.5 mt-4 min-h-[44px]">
              <Icon name="ArrowLeft" size={14} /> Về Thư viện
            </Link>
          </div>
        ) : null
      ) : (
        <>
          <div className="quiz-taking-layout">
            <aside className="quiz-question-rail" aria-label="Danh sách câu hỏi">
              <div className="quiz-question-rail__head">
                <strong>{questions.length} câu hỏi</strong>
                <span>{answeredCount} đã trả lời</span>
              </div>
              <ProgressStrip questions={questions} answers={answers} index={index} onJump={setIndex} />
              <div className="quiz-question-rail__legend" aria-hidden="true">
                <span><i className="is-answered" />Đã trả lời</span>
                <span><i className="is-current" />Đang làm</span>
              </div>
              {/* V6: what the questions are about, moved here from a third column that otherwise
                  only repeated the progress count. The rail no longer has its own submit
                  button: "Nộp bài" under the question is the one way to hand in. */}
              {topicCounts.length > 0 && (
                <div className="quiz-question-rail__topics">
                  <h2>Nội dung</h2>
                  {topicCounts.map(([topic, count]) => (
                    <div className="quiz-topic-row" key={topic}><span>{topic}</span><strong>{count} câu</strong></div>
                  ))}
                </div>
              )}
              <p className="quiz-question-rail__help">Bạn có thể quay lại mọi câu trước khi nộp bài.</p>
            </aside>

            <section className="quiz-question-stage">
              <div className="quiz-mobile-progress" aria-label={`Đã trả lời ${answeredCount} trên ${questions.length} câu`}>
                <span>Câu {index + 1} / {questions.length}</span><span>{answeredCount} đã trả lời</span>
                <i><b style={{ width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%` }} /></i>
              </div>
          <article className="surface-card quiz-question-card">
            <div className="flex items-center gap-2 mb-3">
              <span className="badge-processing">{QUESTION_TYPE_LABEL[current.question_type]}</span>
              {current.concept_tags?.slice(0, 2).map((t) => (
                <span key={t} className="text-caption text-text-muted">{t}</span>
              ))}
            </div>

            <h2 className="font-display text-h3 text-text-primary mb-5">
              {current.question_text}
            </h2>

            {current.question_type === "short_answer" ? (
              <textarea
                className="input-surface w-full text-body min-h-[120px] resize-y"
                placeholder="Viết câu trả lời ngắn của bạn…"
                value={answers[current.question_id] ?? ""}
                disabled={submitting}
                onChange={(e) => choose(current.question_id, e.target.value)}
              />
            ) : (
              <div className="quiz-answer-list" role="radiogroup" aria-label={`Đáp án câu ${index + 1}`}>
                {(current.options || []).map((opt, i) => {
                  const selected = answers[current.question_id] === opt;
                  return (
                    <label
                      key={opt}
                      className={`answer-option ${selected ? "answer-option--selected" : ""}`}
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name={`question-${current.question_id}`}
                        value={opt}
                        checked={selected}
                        disabled={submitting}
                        onChange={() => choose(current.question_id, opt)}
                      />
                      <span className="answer-option__key">{KEYS[i] || i + 1}</span>
                      <span className="text-body">{optionLabel(opt)}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </article>

          {error && (
            <div className="text-small flex items-center gap-1.5 mb-4" style={{ color: "var(--err)" }} role="alert">
              <Icon name="AlertCircle" size={14} /> {error}
            </div>
          )}

          {/* Dính đáy: câu hỏi dài (nhất là trả lời ngắn) đẩy cụm nút xuống dưới màn hình,
              nên người làm bài phải cuộn mới bấm được "Câu sau" — mỗi câu một lần cuộn
              thừa. Nền đặc + đường kẻ trên để chữ phía sau không lộ qua khi cuộn. */}
          <div className="quiz-question-nav">
            <button type="button" className="btn-secondary text-small inline-flex items-center gap-1.5"
              disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
              <Icon name="ArrowLeft" size={14} /> Câu trước
            </button>
            {/* V6: one primary action at a time. While there is a next question to go to and
                something is still unanswered, "Câu sau" is the step; on the last question, or
                once everything is answered, handing in is. */}
            <button type="button" className={`${nenNop ? "btn-secondary" : "btn-primary"} text-small inline-flex items-center gap-1.5`}
              disabled={index >= questions.length - 1}
              onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}>
              Câu sau <Icon name="ArrowRight" size={14} />
            </button>
            <div className="flex-1" />
            <button type="button" className={`${nenNop ? "btn-seal" : "btn-secondary"} text-small inline-flex items-center gap-2`}
              data-primary={nenNop ? "true" : undefined}
              disabled={submitting} onClick={() => setConfirming(true)}>
              {submitting ? <><Spinner size={13} /> Đang nộp…</> : "Nộp bài"}
            </button>
          </div>
            </section>
          </div>

          {confirming && (
            <ConfirmSubmit
              unanswered={unanswered.length}
              total={questions.length}
              onCancel={() => setConfirming(false)}
              onConfirm={onSubmit}
              submitting={submitting}
            />
          )}
        </>
      )}
    </StudyShell>
  );
}

/** Dải câu hỏi — ô đã trả lời được tô mực, ô đang xem có viền. */
function ProgressStrip({ questions, answers, index, onJump }) {
  return (
    <div className="quiz-question-grid">
      {questions.map((q, i) => {
        const done = String(answers[q.question_id] ?? "").trim().length > 0;
        const active = i === index;
        return (
          <button
            key={q.question_id}
            type="button"
            onClick={() => onJump(i)}
            aria-label={`Câu ${i + 1}${done ? " đã trả lời" : " chưa trả lời"}`}
            aria-current={active ? "true" : undefined}
            className="quiz-question-index"
            style={{
              background: done ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "var(--bg-elevated)",
              border: `1px solid ${active ? "var(--accent)" : done ? "color-mix(in srgb, var(--accent) 35%, transparent)" : "var(--border-color)"}`,
              color: done ? "var(--quiz-question-complete-fg)" : "var(--text-muted)",
              boxShadow: active ? "0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent)" : "none",
            }}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}

// Phase 6, Step 2/11: từng dựng tay một lớp <div role="dialog" aria-modal>
// riêng — trùng đúng việc `ui/Modal.jsx` đã làm, mà lại THIẾU bẫy Tab/auto-
// focus/trả focus mà Modal.jsx vừa được bổ sung. Dùng lại Modal.jsx: hết
// trùng lặp, và hộp thoại này tự động có luôn ba thứ đó, không cần chép lại.
function ConfirmSubmit({ unanswered, total, onCancel, onConfirm, submitting }) {
  return (
    <Modal open title="Nộp bài?" onClose={onCancel} maxWidth={420}
      footer={
        <div className="quiz-submit-confirm__actions flex gap-2">
          <button type="button" className="btn-secondary text-small flex-1" onClick={onCancel}>
            Quay lại làm tiếp
          </button>
          <button type="button" className="btn-seal text-small flex-1 inline-flex items-center justify-center gap-2"
            disabled={submitting} onClick={onConfirm}>
            {submitting ? <><Spinner size={13} /> Đang nộp…</> : "Nộp bài"}
          </button>
        </div>
      }>
      <p className="text-body text-text-secondary p-5">
        {unanswered > 0
          ? `Còn ${unanswered}/${total} câu chưa trả lời. Câu bỏ trống được tính là sai.`
          : `Đã trả lời đủ ${total} câu. Sau khi nộp không sửa được đáp án nữa.`}
      </p>
    </Modal>
  );
}
