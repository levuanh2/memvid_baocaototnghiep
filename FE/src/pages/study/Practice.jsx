import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import StudyShell from "../../components/study/StudyShell";
import SealMeter from "../../components/study/SealMeter";
import { Icon } from "../../components/ui/Icon";
import Spinner from "../../components/ui/Spinner";
import {
  MASTERY_LABEL,
  QUESTION_TYPE_LABEL,
  formatScore,
  getPractice,
  getPracticeComparison,
  optionLabel,
  submitPractice,
  moTaLoi,
} from "../../utils/studyApi";

const KEYS = ["A", "B", "C", "D", "E", "F"];

export default function Practice() {
  const { quizId } = useParams();
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [graded, setGraded] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await getPractice(quizId);
      setQuiz(body);
      // Đã làm rồi thì vào thẳng phần so sánh, không bắt làm lại từ đầu.
      try {
        setComparison(await getPracticeComparison(quizId));
      } catch (e) {
        if (e?.status !== 409) throw e;
      }
    } catch (e) {
      setError(moTaLoi(e, "Không tải được bài luyện tập."));
    } finally {
      setLoading(false);
    }
  }, [quizId]);

  useEffect(() => { load(); }, [load]);

  // Mảng mới mỗi lần render sẽ làm useMemo bên dưới tính lại vô ích.
  const questions = useMemo(() => quiz?.questions || [], [quiz]);
  const unanswered = useMemo(
    () => questions.filter((q) => !String(answers[q.question_id] ?? "").trim()).length,
    [questions, answers],
  );

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // Bài luyện ngắn: nộp trong MỘT lần gọi, không cần lưu nháp từng câu.
      const result = await submitPractice(quizId, answers);
      setGraded(result);
      // Nộp XONG rồi. So sánh trước/sau chỉ là phần trang trí thêm — hỏng nó mà báo
      // "Nộp bài luyện tập thất bại" thì dòng đỏ đó nằm ngay trên điểm số vừa hiện.
      try {
        setComparison(await getPracticeComparison(quizId));
      } catch {
        setComparison(null);
      }
    } catch (e) {
      setError(moTaLoi(e, "Nộp bài luyện tập thất bại."));
    } finally {
      setSubmitting(false);
    }
  };

  const done = Boolean(graded || comparison);

  return (
    <StudyShell
      eyebrow="Luyện tập"
      title={quiz?.title || "Bài luyện tập"}
      subtitle={done ? null : "Năm câu bám đúng đoạn tài liệu bạn cần ôn."}
      backTo="/app/study"
      loading={loading}
      error={error && !quiz ? error : null}
      onRetry={load}
      width="max-w-[820px]"
      actions={
        quiz?.source_attempt_id && (
          <Link to={`/app/study/review/${quiz.source_attempt_id}`}
            className="text-small text-text-muted hover:text-accent inline-flex items-center gap-1.5">
            <Icon name="BookOpen" size={14} /> Kế hoạch ôn
          </Link>
        )
      }
    >
      {!quiz ? null : (
        <>
          {graded && (
            <section className="surface-card mb-6 flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-4">
                <SealMeter
                  score={(graded.percentage ?? 0) / 100}
                  status={(graded.percentage ?? 0) >= 80 ? "mastered" : undefined}
                  size={58}
                />
                <div>
                  <div className="font-display text-h2 font-semibold text-text-primary leading-none">
                    {formatScore(graded.score, graded.max_score)}
                  </div>
                  <div className="font-mono text-caption text-text-muted mt-1.5">
                    đúng {graded.correct_count}/{graded.total_questions}
                  </div>
                </div>
              </div>
            </section>
          )}

          {comparison && <Comparison comparison={comparison} />}

          <section className="flex flex-col gap-3">
            {questions.map((q, i) => (
              <article key={q.question_id} className="surface-card">
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-mono text-small text-text-muted">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="badge-processing">{QUESTION_TYPE_LABEL[q.question_type]}</span>
                </div>

                <h3 className="font-display text-body-lg text-text-primary mb-4">
                  {q.question_text}
                </h3>

                {q.question_type === "short_answer" ? (
                  <textarea
                    className="input-surface w-full text-body min-h-[96px] resize-y disabled:opacity-70"
                    placeholder="Viết câu trả lời ngắn…"
                    disabled={done}
                    value={answers[q.question_id] ?? ""}
                    onChange={(e) => setAnswers((p) => ({ ...p, [q.question_id]: e.target.value }))}
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    {(q.options || []).map((opt, oi) => {
                      const selected = answers[q.question_id] === opt;
                      return (
                        <button key={opt} type="button" disabled={done}
                          className={`answer-option ${selected ? "answer-option--selected" : ""}`}
                          onClick={() => setAnswers((p) => ({ ...p, [q.question_id]: opt }))}>
                          <span className="answer-option__key">{KEYS[oi] || oi + 1}</span>
                          <span className="text-body">{optionLabel(opt)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </article>
            ))}
          </section>

          {error && (
            <div className="text-small flex items-center gap-1.5 mt-4" style={{ color: "var(--err)" }}>
              <Icon name="AlertCircle" size={14} /> {error}
            </div>
          )}

          {!done && (
            <div className="flex items-center gap-3 mt-5">
              <button type="button" className="btn-seal inline-flex items-center gap-2"
                disabled={submitting} onClick={onSubmit}>
                {submitting ? <><Spinner size={14} /> Đang chấm…</> : "Nộp bài luyện tập"}
              </button>
              {unanswered > 0 && (
                <span className="text-small text-text-muted">
                  còn {unanswered} câu chưa trả lời
                </span>
              )}
            </div>
          )}
        </>
      )}
    </StudyShell>
  );
}

/** Trước/sau — hai con dấu cạnh nhau, mực dâng lên là tiến bộ. */
function Comparison({ comparison }) {
  const rows = comparison.concepts || [];
  if (!rows.length) return null;
  return (
    <section className="surface-card mb-6">
      <h2 className="font-mono text-metadata uppercase text-text-muted mb-4">
        Trước và sau khi luyện
      </h2>
      <div className="flex flex-col gap-4">
        {rows.map((c) => (
          <div key={c.concept_name} className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[150px]">
              <div className="font-display text-body-lg font-semibold text-text-primary">
                {c.concept_name}
              </div>
              <div className="text-small text-text-secondary mt-0.5">
                {c.delta == null
                  ? "Chưa đủ số liệu để so sánh"
                  : c.became_mastered
                    ? "Đã chuyển sang nắm tốt"
                    : c.delta > 0
                      ? `Tiến bộ ${Math.round(c.delta * 100)} điểm phần trăm`
                      : c.delta < 0
                        ? `Giảm ${Math.round(Math.abs(c.delta) * 100)} điểm phần trăm`
                        : "Chưa thay đổi"}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Slot label="Trước" value={c.before} />
              <Icon name="ArrowRight" size={15} className="text-text-muted" />
              <Slot label="Sau" value={c.after} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Slot({ label, value }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-mono text-metadata uppercase text-text-muted">{label}</span>
      {value ? (
        <>
          <SealMeter score={value.mastery_score} status={value.status} size={40} />
          <span className="text-caption text-text-muted">{MASTERY_LABEL[value.status] || ""}</span>
        </>
      ) : (
        // Không có số liệu thì nói thế, đừng vẽ con dấu 0% — 0 điểm khác chưa đo.
        <span className="text-small text-text-muted h-[40px] flex items-center">chưa đo</span>
      )}
    </div>
  );
}
