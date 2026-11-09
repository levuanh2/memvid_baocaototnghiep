import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { MAX_CONSECUTIVE_FETCH_FAILURES } from "../../utils/jobPoller";
import "./quizJourney.css";

const KEYS = ["A", "B", "C", "D", "E", "F"];
// O5/A3 (owner revision): the review-plan CTA's "(N chủ đề)" count must
// mirror BE's own definition of "weak" exactly -- BE/app/domains/
// gap_analysis/service.py's `WEAK_STATUSES = ("light_review",
// "review_needed", "critical_gap")`. Not "anything not mastered": pending/
// ungraded/unknown/missing statuses are excluded by construction (not in
// this allow-list), same as `mastered`.
const WEAK_MASTERY_STATUSES = new Set(["light_review", "review_needed", "critical_gap"]);
const REGRADE_POLL_MS = 3000;
// Job chấm tự luận chết ở BE thì attempt kẹt `submitted` VĨNH VIỄN — poll thành công
// mọi lần, chỉ là trạng thái không bao giờ đổi, nên trần đếm-lỗi không cứu được.
// 5 phút khớp STALL_MS của jobPoller: quá đó thì nói thật là đang kẹt.
const REGRADE_STALL_MS = 5 * 60 * 1000;

export default function QuizResult() {
  const { attemptId } = useParams();
  const [result, setResult] = useState(null);
  const [masteries, setMasteries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Lỗi của lần hỏi NỀN (đang chờ chấm tự luận) tách khỏi lỗi của lần tải đầu: một cú
  // poll trượt mạng không được biến cả trang kết quả đã chấm thành thẻ đỏ.
  const [loiNen, setLoiNen] = useState(null);
  const [nhip, setNhip] = useState(0);
  const [ketChamBai, setKetChamBai] = useState(false);
  const [reviewingWrong, setReviewingWrong] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const truotRef = useRef(0);
  const batDauChoRef = useRef(null);
  const timerRef = useRef(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) { setLoading(true); setError(null); }
    try {
      const body = await getResult(attemptId);
      setResult(body);
      if (body.status === "graded") {
        setMasteries(await getConceptMasteries(attemptId));
      }
      truotRef.current = 0;
      setLoiNen(null);
      return body.status;
    } catch (e) {
      truotRef.current += 1;
      if (quiet) setLoiNen(moTaLoi(e, "Chưa hỏi lại được trạng thái chấm bài."));
      else setError(moTaLoi(e, "Không tải được kết quả."));
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [attemptId]);

  useEffect(() => { load(); }, [load]);

  // Bài có câu tự luận được chấm bằng job nền: attempt dừng ở `submitted` một
  // lúc rồi mới sang `graded`. Hỏi lại theo nhịp cho tới khi chấm xong thay vì
  // bắt người học tự F5.
  //
  // `nhip` phải nằm trong dependency: lần hỏi nền hỏng thì `result` KHÔNG đổi, effect
  // không chạy lại, và vòng hỏi chết lặng — trang đứng mãi ở "đang chấm".
  useEffect(() => {
    if (result?.status !== "submitted") { batDauChoRef.current = null; return undefined; }
    if (truotRef.current >= MAX_CONSECUTIVE_FETCH_FAILURES) return undefined;
    if (batDauChoRef.current === null) batDauChoRef.current = Date.now();
    if (Date.now() - batDauChoRef.current > REGRADE_STALL_MS) {
      setKetChamBai(true);
      return undefined;
    }
    timerRef.current = setTimeout(async () => {
      await load({ quiet: true });
      setNhip((n) => n + 1);
    }, REGRADE_POLL_MS);
    return () => clearTimeout(timerRef.current);
  }, [result, nhip, load]);

  const graded = result?.status === "graded";
  // Fail closed for any current or future non-final status: completed-result
  // presentation is authorized only by the explicit graded state.
  const grading = Boolean(result) && !graded;
  const ungradedCount = Number(result?.ungraded_count || 0);
  const provisional = graded && (
    result?.grading_complete === false || ungradedCount > 0
  );
  // `.filter()` alone loses the question's position in the original ten-question
  // quiz — the wrong-answer review must label question 4 and 9 as "Câu 4"/"Câu 9",
  // not "Câu 1"/"Câu 2" (their position inside the filtered subset). Stamp the
  // real ordinal in BEFORE filtering, while every question still sits at its real
  // index. Never derived from question_id — nothing guarantees that's numeric or
  // ordered.
  const wrongQuestions = useMemo(
    () => (graded
      ? (result.questions || [])
          .map((question, i) => ({ ...question, _originalOrder: i + 1 }))
          .filter((question) => question.verdict && question.verdict !== "correct")
      : []),
    [graded, result],
  );
  const openWrongReview = () => { setReviewIndex(0); setReviewingWrong(true); };
  // `masteries` only populates once graded (see `load()` above), so an empty
  // array here means "not computed yet", and the header action below falls
  // back to the count-less label for it.
  // A3 (owner correction): dedup by the normalized (trimmed, lower-cased)
  // concept name FIRST, falling back to `concept_mastery_id` only when a row
  // has no name. A row with neither is not counted at all (not fabricated as
  // its own topic) -- two rows for the same concept must never inflate the
  // count just because they disagree on casing or one is missing its id.
  const weakTopicCount = new Set(
    masteries
      .filter((m) => WEAK_MASTERY_STATUSES.has(m?.status))
      .map((m) => {
        const name = String(m?.concept_name || "").trim().toLowerCase();
        return name ? `name:${name}` : m?.concept_mastery_id != null ? `id:${m.concept_mastery_id}` : null;
      })
      .filter(Boolean),
  ).size;

  return (
    <StudyShell
      eyebrow="Kết quả"
      title={result?.quiz_title || "Kết quả bài làm"}
      backTo="/app/study"
      loading={loading}
      error={error && !result ? error : null}
      onRetry={load}
      width={reviewingWrong ? "max-w-[1120px]" : "max-w-[1050px]"}
      actions={
        graded && (
          wrongQuestions.length > 0 ? (
            <Link to={`/app/study/review/${attemptId}`} className="btn-primary text-small inline-flex items-center gap-2">
              <Icon name="BookOpen" size={14} />
              {weakTopicCount > 0 ? `Kế hoạch ôn tập (${weakTopicCount} chủ đề)` : "Kế hoạch ôn tập"}
            </Link>
          ) : (
            <Link to="/app/study" className="btn-primary text-small inline-flex items-center gap-2">
              <Icon name="ArrowLeft" size={14} /> Về Thư viện
            </Link>
          )
        )
      }
    >
      {!result ? null : (
        <>
          {ketChamBai && (
            <div className="text-small flex items-center gap-1.5 mb-3" style={{ color: "var(--err)" }}>
              <Icon name="AlertCircle" size={14} />
              Bài chưa được chấm xong sau 5 phút — có thể việc chấm đã dừng giữa chừng.
              <button type="button" className="underline"
                onClick={() => { batDauChoRef.current = Date.now(); setKetChamBai(false); setNhip((n) => n + 1); }}>
                Chờ thêm
              </button>
            </div>
          )}
          {loiNen && (
            <div className="text-small flex items-center gap-1.5 mb-3" style={{ color: "var(--err)" }}>
              <Icon name="AlertCircle" size={14} />
              {loiNen}
              <button type="button" className="underline" onClick={() => { truotRef.current = 0; setNhip((n) => n + 1); }}>
                Thử lại
              </button>
            </div>
          )}
          {reviewingWrong ? (
            <WrongAnswerReview questions={wrongQuestions} index={reviewIndex} onIndex={setReviewIndex}
              onClose={() => setReviewingWrong(false)} reviewPlanTo={`/app/study/review/${attemptId}`} />
          ) : <>
          <ScoreBoard result={result} grading={grading} provisional={provisional}
            ungradedCount={ungradedCount} wrongCount={wrongQuestions.length}
            onReviewWrong={openWrongReview} />

          {grading && (
            <div className="surface-card !p-3.5 flex items-center gap-2.5 mb-6">
              <Spinner size={14} />
              <span className="text-body text-text-secondary">
                Đang chấm các câu trả lời ngắn. Điểm trắc nghiệm sẽ hiện ngay khi chấm xong.
              </span>
            </div>
          )}

          {provisional && (
            <div className="surface-card !p-3.5 flex items-start gap-2.5 mb-6"
              role="status" style={{ borderColor: "var(--warn)" }}>
              <Icon name="AlertCircle" size={16} className="shrink-0 mt-0.5" />
              <span className="text-body text-text-secondary">
                <strong className="text-text-primary">Kết quả tạm thời.</strong>{" "}
                {ungradedCount} câu chưa chấm được do bộ chấm AI không khả dụng.
                Các câu này không bị tính là sai và không nằm trong điểm, mức nắm
                hay phân tích lỗ hổng hiện tại.
              </span>
            </div>
          )}

          {graded && masteries.length > 0 && (
            <section className="mb-7">
              <SectionTitle>Mức nắm theo chủ đề</SectionTitle>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {masteries.map((m) => (
                  <div key={m.concept_mastery_id} className="surface-card !p-3.5 flex items-center gap-3">
                    <SealMeter score={m.mastery_score} status={m.status} size={40} />
                    <div className="min-w-0">
                      <div className="font-display text-body font-semibold text-text-primary truncate">
                        {m.concept_name}
                      </div>
                      <div className="text-small text-text-secondary">
                        {MASTERY_LABEL[m.status] || m.status} · đúng {m.correct_count}/{m.total_count}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {graded && <section>
            <SectionTitle>Từng câu</SectionTitle>
            <div className="flex flex-col gap-3">
              {(result.questions || []).map((q, i) => (
                <ReviewedQuestion key={q.question_id} question={q} order={i + 1} />
              ))}
            </div>
          </section>}
          </>}
        </>
      )}
    </StudyShell>
  );
}

function SectionTitle({ children }) {
  return (
    <h2 className="font-mono text-metadata uppercase text-text-muted mb-3">
      {children}
    </h2>
  );
}

function ScoreBoard({ result, grading, provisional, ungradedCount, wrongCount, onReviewWrong }) {
  const percent = result.percentage;
  const noGradedQuestions = provisional && Number(result.max_score || 0) === 0;
  const gradedCount = Number(result.correct_count || 0) + Number(result.incorrect_count || 0);
  const headline = grading
    ? "Đang chấm"
    : noGradedQuestions
      ? "Chưa chấm được"
      : provisional
        ? "Kết quả tạm thời"
        : formatScore(result.score, result.max_score);
  const scoreCaption = grading
    ? "đang chấm"
    : noGradedQuestions
      ? `${ungradedCount} câu chưa chấm được`
      : provisional
        ? `${percent}% điểm tạm tính trên ${gradedCount} câu đã chấm`
        : percent == null ? "chưa chấm" : `${percent}% điểm`;
  return (
    <section className="quiz-score-hero">
      <div className="flex items-center gap-4">
        <SealMeter
          score={grading || percent == null ? 0 : percent / 100}
          status={!grading && !provisional && percent != null && percent >= 80 ? "mastered" : undefined}
          size={64}
          label={grading || noGradedQuestions
            ? "Chưa có điểm"
            : provisional
              ? `Kết quả tạm thời ${percent} phần trăm điểm trên các câu đã chấm`
              : percent == null ? "Chưa có điểm" : `Đạt ${percent} phần trăm điểm`}
        />
        <div>
          <div className="font-display text-h2 font-semibold text-text-primary leading-none">
            {headline}
          </div>
          <div className="font-mono text-caption text-text-muted mt-1.5">
            {scoreCaption}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-7 gap-y-2 text-small">
        <Stat label="Đúng" value={grading ? "—" : result.correct_count ?? "—"} />
        <Stat label="Sai" value={grading ? "—" : result.incorrect_count ?? "—"} />
        {provisional && <Stat label="Chưa chấm" value={ungradedCount} />}
        <Stat label="Số câu" value={result.total_questions} />
        <Stat label="Thời gian" value={formatDuration(result.duration_seconds)} />
      </div>
      {!grading && wrongCount > 0 && <button type="button" className="btn-secondary quiz-review-wrong" onClick={onReviewWrong}>Xem lại câu sai</button>}
    </section>
  );
}

function WrongAnswerReview({ questions, index, onIndex, onClose, reviewPlanTo }) {
  const current = questions[index];
  if (!current) return <section className="surface-card text-center"><h2 className="font-display text-title text-text-primary">Không có câu sai cần xem lại</h2><button type="button" className="btn-secondary mt-4" onClick={onClose}>Về kết quả</button></section>;
  return (
    <div className="quiz-wrong-review">
      <aside className="quiz-wrong-review__rail" aria-label="Câu cần xem lại">
        <header><strong>Ôn lại bài làm</strong><span>{questions.length} câu cần xem</span></header>
        {questions.map((question, itemIndex) => <button type="button" key={question.question_id} className={itemIndex === index ? "is-active" : ""} aria-current={itemIndex === index ? "true" : undefined} onClick={() => onIndex(itemIndex)}><span>{question._originalOrder}</span><div><strong>Câu {question._originalOrder}</strong><small>{VERDICT_LABEL[question.verdict] || "Cần xem lại"}</small></div></button>)}
      </aside>
      <section className="quiz-wrong-review__content">
        <div className="quiz-wrong-review__nav"><button type="button" className="btn-secondary" onClick={onClose}><Icon name="ArrowLeft" size={14} /> Kết quả</button><span>Câu cần ôn {index + 1} / {questions.length}</span><div><button type="button" aria-label="Câu cần ôn trước" disabled={index === 0} onClick={() => onIndex(index - 1)}>←</button><button type="button" aria-label="Câu cần ôn tiếp theo" disabled={index === questions.length - 1} onClick={() => onIndex(index + 1)}>→</button></div></div>
        <ReviewedQuestion question={current} order={current._originalOrder} />
        <Link className="btn-secondary quiz-wrong-review__compact-review-link" to={reviewPlanTo}>Mở kế hoạch ôn tập</Link>
      </section>
      <aside className="quiz-wrong-review__next"><Icon name="Target" size={20} /><h2>Tiếp tục học</h2><p>Đây là phần xem lại câu trả lời. Kế hoạch ôn tập riêng vẫn được tạo và quản lý ở bước tiếp theo.</p><Link className="btn-primary" to={reviewPlanTo}>Mở kế hoạch ôn tập</Link></aside>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="font-mono text-metadata uppercase text-text-muted">{label}</div>
      <div className="text-body-lg font-semibold text-text-primary mt-0.5">{value}</div>
    </div>
  );
}

function ReviewedQuestion({ question, order }) {
  const { verdict } = question;
  const tone =
    verdict === "correct" ? "var(--quiz-status-correct)" : verdict === "partial" ? "var(--quiz-status-partial)" : "var(--quiz-status-incorrect)";
  return (
    <article className="surface-card">
      <div className="flex items-start gap-3 mb-3">
        <span className="font-mono text-small text-text-muted mt-1">{String(order).padStart(2, "0")}</span>
        <h3 className="font-display text-body-lg text-text-primary flex-1">
          {question.question_text}
        </h3>
        <span className="quiz-verdict-badge rounded-[4px] text-metadata px-2 py-[2px] font-semibold uppercase font-mono shrink-0"
          data-verdict={verdict}
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
                <span className="text-body flex-1">{optionLabel(opt)}</span>
                {isPicked && (
                  <span className="font-mono text-metadata uppercase shrink-0">bạn chọn</span>
                )}
                {isCorrect && !isPicked && (
                  <span className="font-mono text-metadata uppercase shrink-0">đáp án</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(question.feedback || question.explanation) && (
        <p className="text-body text-text-secondary border-l-2 pl-3"
          style={{ borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)" }}>
          {question.feedback || question.explanation}
        </p>
      )}

      {question.chunk_ids?.length > 0 && (
        <div className="flex items-center gap-1.5 mt-3">
          <Icon name="Quote" size={12} className="text-text-muted" />
          <span className="font-mono text-caption text-text-muted">
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
      <div className="font-mono text-metadata uppercase text-text-muted mb-1">
        {label}
      </div>
      <div className="text-body text-text-primary">{children}</div>
    </div>
  );
}
