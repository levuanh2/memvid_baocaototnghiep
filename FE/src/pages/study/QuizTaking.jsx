import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import StudyShell from "../../components/study/StudyShell";
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

  // Lưu nháp gộp lô: mỗi lần bấm đáp án mà gọi API ngay thì bấm nhanh 10 câu là
  // 10 request chồng nhau, và request về trễ có thể ghi đè lựa chọn mới hơn.
  const queueSave = useCallback((questionId, value) => {
    const so = soNhapRef.current;
    so.dat(questionId, value);
    setChoLuu(so.demCho());
    if (flushRef.current) clearTimeout(flushRef.current);
    flushRef.current = setTimeout(async () => {
      if (!attemptId || !so.coGi()) return;
      const batch = so.layDeGui();
      setSaving(true);
      try {
        await saveAnswers(attemptId, batch);
        setChoLuu(so.demCho());
      } catch (e) {
        // Gửi hỏng thì trả lô về sổ: mất nó là mất câu trả lời của người học trong
        // khi ô vẫn tô mực. Lần gửi sau, hoặc lúc bấm Nộp bài, sẽ mang nó đi lại.
        so.traLai(batch);
        setChoLuu(so.demCho());
        setError(moTaLoi(e, "Không lưu được câu trả lời."));
      } finally {
        setSaving(false);
      }
    }, 600);
  }, [attemptId]);

  useEffect(() => () => { if (flushRef.current) clearTimeout(flushRef.current); }, []);

  const choose = (questionId, value) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    queueSave(questionId, value);
  };

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // Gửi nốt nháp còn treo trước khi nộp — nếu không, câu vừa chọn sẽ mất. Gồm cả
      // lô của một lần lưu đã hỏng trước đó: nộp mà thiếu nó thì mấy câu ấy bị chấm
      // như chưa trả lời, và trang kết quả hiện ra y như một lần nộp bình thường.
      if (flushRef.current) clearTimeout(flushRef.current);
      const so = soNhapRef.current;
      const batch = so.layDeGui();
      if (Object.keys(batch).length) {
        try {
          await saveAnswers(attemptId, batch);
          setChoLuu(0);
        } catch (e) {
          so.traLai(batch);
          setChoLuu(so.demCho());
          throw e;   // KHÔNG nộp khi chưa chắc server đã có đủ đáp án
        }
      }
      await submitAttempt(attemptId);
      navigate(`/app/study/result/${attemptId}`, { replace: true });
    } catch (e) {
      setError(moTaLoi(e, "Nộp bài thất bại."));
      setSubmitting(false);
      setConfirming(false);
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
      width="max-w-[820px]"
      actions={
        <span className="font-mono text-[11.5px] text-text-muted">
          {saving
            ? "đang lưu…"
            : choLuu > 0
              ? `${choLuu} câu chưa lưu được`
              : `${questions.length - unanswered.length}/${questions.length} đã trả lời`}
        </span>
      }
    >
      {raDe?.rejected > 0 && (
        <div className="surface-card !py-3 !px-4 mb-4 flex items-start gap-2.5 text-[13px] text-text-secondary">
          <Icon name="AlertCircle" size={15} className="text-text-muted mt-0.5 shrink-0" />
          <span>
            Ra được <strong className="text-text-primary">{raDe.kept}</strong> câu trên{" "}
            {raDe.asked} câu đã chọn. {raDe.rejected} câu bị loại vì không đạt kiểm chất
            lượng — thường là do đoạn tài liệu tương ứng quá ngắn để ra đề.
          </span>
        </div>
      )}
      {!current ? null : (
        <>
          <ProgressStrip
            questions={questions}
            answers={answers}
            index={index}
            onJump={setIndex}
          />

          <article className="surface-card mt-5 mb-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="badge-processing">{QUESTION_TYPE_LABEL[current.question_type]}</span>
              {current.concept_tags?.slice(0, 2).map((t) => (
                <span key={t} className="font-mono text-[11px] text-text-muted">#{t}</span>
              ))}
            </div>

            <h2 className="font-display text-[19px] leading-[1.5] text-text-primary mb-5">
              {current.question_text}
            </h2>

            {current.question_type === "short_answer" ? (
              <textarea
                className="input-surface w-full text-[14.5px] min-h-[120px] resize-y"
                placeholder="Viết câu trả lời ngắn của bạn…"
                value={answers[current.question_id] ?? ""}
                onChange={(e) => choose(current.question_id, e.target.value)}
              />
            ) : (
              <div className="flex flex-col gap-2">
                {(current.options || []).map((opt, i) => {
                  const selected = answers[current.question_id] === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      className={`answer-option ${selected ? "answer-option--selected" : ""}`}
                      onClick={() => choose(current.question_id, opt)}
                    >
                      <span className="answer-option__key">{KEYS[i] || i + 1}</span>
                      <span className="text-[14.5px] leading-[1.5]">{optionLabel(opt)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </article>

          {error && (
            <div className="text-[13px] flex items-center gap-1.5 mb-4" style={{ color: "var(--err)" }}>
              <Icon name="AlertCircle" size={14} /> {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary text-[13px] inline-flex items-center gap-1.5"
              disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
              <Icon name="ArrowLeft" size={14} /> Câu trước
            </button>
            <button type="button" className="btn-secondary text-[13px] inline-flex items-center gap-1.5"
              disabled={index >= questions.length - 1}
              onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}>
              Câu sau <Icon name="ArrowRight" size={14} />
            </button>
            <div className="flex-1" />
            <button type="button" className="btn-seal text-[13px] inline-flex items-center gap-2"
              disabled={submitting} onClick={() => setConfirming(true)}>
              {submitting ? <><Spinner size={13} /> Đang nộp…</> : "Nộp bài"}
            </button>
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
    <div className="flex flex-wrap gap-1.5">
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
            className="w-8 h-8 rounded-[5px] font-mono text-[11.5px] font-semibold transition-all"
            style={{
              background: done ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "var(--bg-elevated)",
              border: `1px solid ${active ? "var(--accent)" : done ? "color-mix(in srgb, var(--accent) 35%, transparent)" : "var(--border-color)"}`,
              color: done ? "var(--accent)" : "var(--text-muted)",
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

function ConfirmSubmit({ unanswered, total, onCancel, onConfirm, submitting }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-5"
      style={{ background: "rgba(15,23,42,0.45)" }} role="dialog" aria-modal="true">
      <div className="surface-card w-full max-w-[420px]">
        <h3 className="font-display text-[17px] font-semibold text-text-primary">Nộp bài?</h3>
        <p className="text-[13.5px] text-text-secondary mt-2">
          {unanswered > 0
            ? `Còn ${unanswered}/${total} câu chưa trả lời. Câu bỏ trống được tính là sai.`
            : `Đã trả lời đủ ${total} câu. Sau khi nộp không sửa được đáp án nữa.`}
        </p>
        <div className="flex gap-2 mt-5">
          <button type="button" className="btn-secondary text-[13px] flex-1" onClick={onCancel}>
            Quay lại làm tiếp
          </button>
          <button type="button" className="btn-seal text-[13px] flex-1 inline-flex items-center justify-center gap-2"
            disabled={submitting} onClick={onConfirm}>
            {submitting ? <><Spinner size={13} /> Đang nộp…</> : "Nộp bài"}
          </button>
        </div>
      </div>
    </div>
  );
}
