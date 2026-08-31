import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import StudyShell from "../../components/study/StudyShell";
import SealMeter from "../../components/study/SealMeter";
import { Icon } from "../../components/ui/Icon";
import Spinner from "../../components/ui/Spinner";
import {
  MASTERY_LABEL,
  VERDICT_LABEL,
  formatDuration,
  formatScore,
  getConceptMasteries,
  getResult,
  optionLabel,
  moTaLoi,
} from "../../utils/studyApi";

const KEYS = ["A", "B", "C", "D", "E", "F"];
const REGRADE_POLL_MS = 3000;

export default function QuizResult() {
  const { attemptId } = useParams();
  const [result, setResult] = useState(null);
  const [masteries, setMasteries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) { setLoading(true); setError(null); }
    try {
      const body = await getResult(attemptId);
      setResult(body);
      if (body.status === "graded") {
        setMasteries(await getConceptMasteries(attemptId));
      }
      return body.status;
    } catch (e) {
      setError(moTaLoi(e, "Không tải được kết quả."));
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [attemptId]);

  useEffect(() => { load(); }, [load]);

  // Bài có câu tự luận được chấm bằng job nền: attempt dừng ở `submitted` một
  // lúc rồi mới sang `graded`. Hỏi lại theo nhịp cho tới khi chấm xong thay vì
  // bắt người học tự F5.
  useEffect(() => {
    if (result?.status !== "submitted") return undefined;
    timerRef.current = setTimeout(() => { load({ quiet: true }); }, REGRADE_POLL_MS);
    return () => clearTimeout(timerRef.current);
  }, [result, load]);

  const grading = result?.status === "submitted";

  return (
    <StudyShell
      eyebrow="Kết quả"
      title={result?.quiz_title || "Kết quả bài làm"}
      backTo="/app/study"
      loading={loading}
      error={error}
      onRetry={load}
      width="max-w-[860px]"
      actions={
        result?.status === "graded" && (
          <Link to={`/app/study/review/${attemptId}`} className="btn-seal text-[13px] inline-flex items-center gap-2">
            <Icon name="BookOpen" size={14} /> Xem phần cần ôn
          </Link>
        )
      }
    >
      {!result ? null : (
        <>
          <ScoreBoard result={result} grading={grading} />

          {grading && (
            <div className="surface-card !p-3.5 flex items-center gap-2.5 mb-6">
              <Spinner size={14} />
              <span className="text-[13.5px] text-text-secondary">
                Đang chấm các câu trả lời ngắn. Điểm trắc nghiệm sẽ hiện ngay khi chấm xong.
              </span>
            </div>
          )}

          {masteries.length > 0 && (
            <section className="mb-7">
              <SectionTitle>Mức nắm theo chủ đề</SectionTitle>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {masteries.map((m) => (
                  <div key={m.concept_mastery_id} className="surface-card !p-3.5 flex items-center gap-3">
                    <SealMeter score={m.mastery_score} status={m.status} size={40} />
                    <div className="min-w-0">
                      <div className="font-display text-[14.5px] font-semibold text-text-primary truncate">
                        {m.concept_name}
                      </div>
                      <div className="text-[12px] text-text-secondary">
                        {MASTERY_LABEL[m.status] || m.status} · đúng {m.correct_count}/{m.total_count}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionTitle>Từng câu</SectionTitle>
            <div className="flex flex-col gap-3">
              {(result.questions || []).map((q, i) => (
                <ReviewedQuestion key={q.question_id} question={q} order={i + 1} />
              ))}
            </div>
          </section>
        </>
      )}
    </StudyShell>
  );
}

function SectionTitle({ children }) {
  return (
    <h2 className="font-mono text-[11px] tracking-[0.18em] uppercase text-text-muted mb-3">
      {children}
    </h2>
  );
}

function ScoreBoard({ result, grading }) {
  const percent = result.percentage;
  return (
    <section className="surface-card mb-6 flex flex-wrap items-center gap-6">
      <div className="flex items-center gap-4">
        <SealMeter
          score={percent == null ? 0 : percent / 100}
          status={percent != null && percent >= 80 ? "mastered" : undefined}
          size={64}
          label={percent == null ? "Chưa có điểm" : `Đạt ${percent} phần trăm`}
        />
        <div>
          <div className="font-display text-[26px] font-semibold text-text-primary leading-none">
            {formatScore(result.score, result.max_score)}
          </div>
          <div className="font-mono text-[11.5px] text-text-muted mt-1.5">
            {grading ? "đang chấm" : percent == null ? "chưa chấm" : `${percent}% · điểm thô`}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-7 gap-y-2 text-[13px]">
        <Stat label="Đúng" value={result.correct_count ?? "—"} />
        <Stat label="Sai" value={result.incorrect_count ?? "—"} />
        <Stat label="Số câu" value={result.total_questions} />
        <Stat label="Thời gian" value={formatDuration(result.duration_seconds)} />
      </div>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-text-muted">{label}</div>
      <div className="text-[15px] font-semibold text-text-primary mt-0.5">{value}</div>
    </div>
  );
}

function ReviewedQuestion({ question, order }) {
  const { verdict } = question;
  const tone =
    verdict === "correct" ? "var(--ok)" : verdict === "partial" ? "var(--warn)" : "var(--err)";
  return (
    <article className="surface-card">
      <div className="flex items-start gap-3 mb-3">
        <span className="font-mono text-[12px] text-text-muted mt-1">{String(order).padStart(2, "0")}</span>
        <h3 className="font-display text-[16px] leading-[1.5] text-text-primary flex-1">
          {question.question_text}
        </h3>
        <span className="rounded-[4px] text-[10.5px] px-2 py-[2px] font-semibold uppercase font-mono shrink-0"
          style={{ color: tone, border: `1px solid ${tone}`, background: `color-mix(in srgb, ${tone} 12%, transparent)` }}>
          {VERDICT_LABEL[verdict] || "Chưa chấm"}
        </span>
      </div>

      {question.question_type === "short_answer" ? (
        <div className="flex flex-col gap-2 mb-3">
          <Labeled label="Bạn trả lời">{question.user_answer || <em className="text-text-muted">bỏ trống</em>}</Labeled>
          <Labeled label="Đáp án mẫu">{question.correct_answer}</Labeled>
        </div>
      ) : (
        <div className="flex flex-col gap-2 mb-3">
          {(question.options || []).map((opt, i) => {
            const isCorrect = opt === question.correct_answer;
            const isPicked = opt === question.user_answer;
            const cls = isCorrect
              ? "answer-option--correct"
              : isPicked ? "answer-option--wrong" : "";
            return (
              <div key={opt} className={`answer-option ${cls}`}>
                <span className="answer-option__key">{KEYS[i] || i + 1}</span>
                <span className="text-[14px] leading-[1.5] flex-1">{optionLabel(opt)}</span>
                {isPicked && (
                  <span className="font-mono text-[10.5px] uppercase shrink-0">bạn chọn</span>
                )}
                {isCorrect && !isPicked && (
                  <span className="font-mono text-[10.5px] uppercase shrink-0">đáp án</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(question.feedback || question.explanation) && (
        <p className="text-[13.5px] leading-[1.65] text-text-secondary border-l-2 pl-3"
          style={{ borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)" }}>
          {question.feedback || question.explanation}
        </p>
      )}

      {question.chunk_ids?.length > 0 && (
        <div className="flex items-center gap-1.5 mt-3">
          <Icon name="Quote" size={12} className="text-text-muted" />
          <span className="font-mono text-[11px] text-text-muted">
            Nguồn: {question.chunk_ids.length} đoạn trong tài liệu
          </span>
        </div>
      )}
    </article>
  );
}

function Labeled({ label, children }) {
  return (
    <div>
      <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-text-muted mb-1">
        {label}
      </div>
      <div className="text-[14px] leading-[1.6] text-text-primary">{children}</div>
    </div>
  );
}
