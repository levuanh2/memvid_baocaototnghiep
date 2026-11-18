import { useCallback, useEffect, useMemo, useState, useRef } from "react";
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
  getResult,
  optionLabel,
  regradePractice,
  submitPractice,
  moTaLoi,
} from "../../utils/studyApi";

// The machine code of HetLuotChamLai (BE/app/application/attempts.py): no regrade is
// left, so the offer ends. Any other failure (network, "đang được chấm") keeps it.
const HET_LUOT_CHAM_LAI = "het_luot_cham_lai";
// The regrade runs in a background job (202, task A): ask for the stored result every
// few seconds, for at most 5 minutes (the grading lease), then say it is taking long.
// Same bounds as the diagnostic result page (QuizResult).
export const REGRADE_POLL_MS = 3000;
const REGRADE_STALL_MS = 5 * 60 * 1000;
const REGRADE_POLL_FAILURES = 3;
import { DANG_CHAM, forgetSubmitKey, submitKeyFor } from "../../utils/practiceSubmitKey";

// The first request is still grading (BE 409 DANG_CHAM): ask again with the SAME key.
const CHO_CHAM_MS = 2000;
const SO_LAN_HOI_LAI = 5;

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
  const submitKeyMemo = useRef(null);
  // "Chấm lại câu còn thiếu": one request at a time, even on a double click.
  const chamLaiRef = useRef(false);
  const [chamLai, setChamLai] = useState({ dangGui: false, loi: null, het: false, chuaXong: false });
  // Focus lands here when the button goes away (agy task38): the banner text while the
  // result stays provisional, the score card once it is complete.
  const banTamRef = useRef(null);
  const ketQuaRef = useRef(null);

  // Set on every setup, not only at creation: StrictMode runs setup, cleanup, setup, and
  // a flag left false stopped the poller after the 202 (Codex task44).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  // The route reuses this component when only the quiz id changes: a wait started for
  // one quiz must never write into the next (Codex task44).
  const quizRef = useRef(quizId);
  quizRef.current = quizId;

  // The stored result once the job is no longer running; "stalled" past the bound; null
  // when the page went away. A few failed reads in a row end the wait with that error.
  const choKetQuaChamLai = async (attemptId, cuaQuiz) => {
    const conHieuLuc = () => mountedRef.current && quizRef.current === cuaQuiz;
    const batDau = Date.now();
    let truot = 0;
    while (Date.now() - batDau < REGRADE_STALL_MS) {
      await new Promise((r) => setTimeout(r, REGRADE_POLL_MS));
      if (!conHieuLuc()) return null;
      try {
        const r = await getResult(attemptId);
        if (!conHieuLuc()) return null;
        truot = 0;
        if (r?.regrade_state !== "running") return r;
      } catch (e) {
        truot += 1;
        if (truot >= REGRADE_POLL_FAILURES) throw e;
      }
    }
    return "stalled";
  };

  const chamLaiCauThieu = async ({ dangChay = false } = {}) => {
    if (chamLaiRef.current || !graded?.attempt_id) return;
    chamLaiRef.current = true;
    setChamLai((s) => ({ ...s, dangGui: true, loi: null }));
    let xong = false;
    let het = false;
    const cuaQuiz = quizId;
    try {
      let result = dangChay ? { grading: "pending" } : await regradePractice(quizId, graded.attempt_id);
      if (quizRef.current !== cuaQuiz) return;
      if (result?.grading === "pending") {
        result = await choKetQuaChamLai(graded.attempt_id, cuaQuiz);
        if (result === null) return;
        if (result === "stalled") {
          setChamLai({ dangGui: false, het: false, chuaXong: false,
                       loi: "Việc chấm lại đang lâu hơn bình thường. Tải lại trang sau ít phút để xem kết quả." });
          return;
        }
      }
      setGraded(result);
      xong = result?.grading_complete !== false && Number(result?.ungraded_count || 0) === 0;
      het = !xong && result?.regrade_state === "exhausted";
      setChamLai({ dangGui: false, loi: null, het, chuaXong: !xong && !het });
    } catch (e) {
      // A failure of quiz A's request, arriving after the page moved to quiz B, is A's.
      if (quizRef.current !== cuaQuiz) return;
      het = e?.status === 409 && e?.body?.ma === HET_LUOT_CHAM_LAI;
      setChamLai({ dangGui: false, loi: het ? null : moTaLoi(e, "Chưa chấm lại được."),
                   het, chuaXong: false });
    } finally {
      // Only this quiz's lock: B may already be regrading when A's request settles.
      if (quizRef.current === cuaQuiz) chamLaiRef.current = false;
    }
    if (quizRef.current !== cuaQuiz) return;
    if (xong || het) {
      // The button is gone: keep the keyboard where the news is.
      setTimeout(() => (xong ? ketQuaRef : banTamRef).current?.focus(), 0);
    }
  };

  const load = useCallback(async () => {
    // Every continuation checks that the page still shows this quiz: a late answer for
    // the previous quiz id must not replace the next one (Codex task46).
    const cuaQuiz = quizId;
    const cu = () => quizRef.current !== cuaQuiz;
    setLoading(true);
    setError(null);
    // A new quiz id starts clean: no result, comparison or regrade state of the last one.
    setGraded(null);
    setComparison(null);
    setChamLai({ dangGui: false, loi: null, het: false, chuaXong: false });
    chamLaiRef.current = false;
    try {
      const body = await getPractice(quizId);
      if (cu()) return;
      setQuiz(body);
      // Đã làm rồi thì vào thẳng phần so sánh, không bắt làm lại từ đầu.
      let cmp = null;
      try {
        cmp = await getPracticeComparison(quizId);
        if (cu()) return;
        setComparison(cmp);
        // A graded attempt exists (perhaps the one whose response was lost): its key is
        // spent, the next attempt needs a new one.
        forgetSubmitKey(quizId, submitKeyMemo);
      } catch (e) {
        if (cu()) return;
        if (e?.status !== 409) throw e;
      }
      // After a reload a provisional result must stay provisional, with its regrade
      // offer or the news that retries are used up (task39). Best effort: the
      // comparison above is already on screen if this read fails.
      // The comparison counts complete results only (409 while provisional): the quiz
      // names its latest graded attempt, provisional or not.
      const latest = body?.latest_attempt_id || cmp?.practice_attempt_id;
      if (latest) {
        try {
          const r = await getResult(latest);
          if (cu()) return;
          if (r?.grading_complete === false || Number(r?.ungraded_count || 0) > 0) {
            setGraded(r);
            setChamLai((c) => ({ ...c, het: r.regrade_state === "exhausted" }));
            // A regrade still running (reload during the job): keep waiting for it.
            if (r.regrade_state === "running") setTiepTucCho(true);
          }
        } catch { /* the comparison alone, as before */ }
      }
    } catch (e) {
      if (!cu()) setError(moTaLoi(e, "Không tải được bài luyện tập."));
    } finally {
      if (!cu()) setLoading(false);
    }
  }, [quizId]);

  useEffect(() => { load(); }, [load]);

  const [tiepTucCho, setTiepTucCho] = useState(false);
  useEffect(() => {
    if (tiepTucCho && graded?.attempt_id) {
      setTiepTucCho(false);
      chamLaiCauThieu({ dangChay: true });
    }
  }, [tiepTucCho, graded]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Same answers = same key: a retry after an error gets the result already graded.
      const idempotencyKey = submitKeyFor(quizId, answers, submitKeyMemo);
      let result;
      for (let lan = 0; ; lan += 1) {
        try {
          result = await submitPractice(quizId, answers, { idempotencyKey });
          break;
        } catch (e) {
          if (e?.status !== 409 || e?.message !== DANG_CHAM || lan >= SO_LAN_HOI_LAI) throw e;
          await new Promise((r) => setTimeout(r, CHO_CHAM_MS));
        }
      }
      forgetSubmitKey(quizId, submitKeyMemo);
      setGraded(result);
      // Nộp XONG rồi. So sánh trước/sau chỉ là phần trang trí thêm — hỏng nó mà báo
      // "Nộp bài luyện tập thất bại" thì dòng đỏ đó nằm ngay trên điểm số vừa hiện.
      try {
        setComparison(await getPracticeComparison(quizId));
      } catch {
        setComparison(null);
      }
    } catch (e) {
      // 422: the stored key belongs to another answer set; keeping it would repeat the
      // same refusal on every retry.
      if (e?.status === 422) forgetSubmitKey(quizId, submitKeyMemo);
      setError(moTaLoi(e, "Nộp bài luyện tập thất bại."));
    } finally {
      setSubmitting(false);
    }
  };

  const done = Boolean(graded || comparison);
  const ungradedCount = Number(graded?.ungraded_count || 0);
  const provisional = Boolean(graded) && (
    graded?.grading_complete === false || ungradedCount > 0
  );
  const noGradedQuestions = provisional && Number(graded?.max_score || 0) === 0;

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
            <section ref={ketQuaRef} tabIndex={-1} aria-label="Kết quả bài luyện tập"
              className="surface-card mb-6 flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-4">
                <SealMeter
                  score={(graded.percentage ?? 0) / 100}
                  status={!provisional && (graded.percentage ?? 0) >= 80 ? "mastered" : undefined}
                  size={58}
                  // PR #137 review: "điểm", not "câu đúng" (percentage = score / max_score,
                  // partial = 0.5 point). Same three states as QuizResult's ScoreBoard:
                  // nothing graded has NO score (never a fabricated 0%), a partial grading
                  // is provisional, otherwise the real score -- a genuine 0% included.
                  label={noGradedQuestions || graded.percentage == null
                    ? "Chưa có điểm"
                    : provisional
                      ? `Kết quả tạm thời ${graded.percentage} phần trăm điểm trên các câu đã chấm`
                      : `Đạt ${graded.percentage} phần trăm điểm`}
                />
                <div>
                  <div className="font-display text-h2 font-semibold text-text-primary leading-none">
                    {noGradedQuestions
                      ? "Chưa chấm được"
                      : provisional ? "Kết quả tạm thời" : formatScore(graded.score, graded.max_score)}
                  </div>
                  <div className="font-mono text-caption text-text-muted mt-1.5">
                    {provisional
                      ? noGradedQuestions
                        ? `${ungradedCount} câu chưa chấm được`
                        : `${graded.percentage}% điểm tạm tính trên ${graded.max_score} câu đã chấm · ${ungradedCount} câu chưa chấm được`
                      : `đúng ${graded.correct_count}/${graded.total_questions}`}
                  </div>
                </div>
              </div>
              {provisional && (
                // Same banner as the diagnostic result page (#190), on its own row of the
                // flex-wrap score card (w-full), the button below the text.
                <div className="w-full flex items-start gap-2.5 rounded-md border p-3"
                  style={{ borderColor: "var(--warn)" }}>
                  <Icon name="AlertCircle" size={16} className="shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p ref={banTamRef} tabIndex={-1} role="status" className="text-body text-text-secondary">
                      <strong className="text-text-primary">Kết quả tạm thời.</strong>{" "}
                      {ungradedCount} câu tự luận chưa chấm được do bộ chấm AI không khả dụng.
                      Các câu này không bị tính là sai.
                      {chamLai.dangGui && (
                        <span className="block mt-1.5">
                          Đang chấm lại các câu còn thiếu. Kết quả sẽ hiện ở đây khi xong.
                        </span>
                      )}
                      {chamLai.chuaXong && !chamLai.het && (
                        <span className="block mt-1.5">
                          Lần chấm lại vừa rồi chưa chấm được các câu này. Bạn có thể thử thêm.
                        </span>
                      )}
                      {chamLai.het && (
                        <span className="block mt-1.5">
                          Đã hết lượt chấm lại cho bài này. Kết quả tạm thời được giữ nguyên.
                        </span>
                      )}
                      {chamLai.loi && (
                        <span className="block text-small mt-1" style={{ color: "var(--err)" }}>{chamLai.loi}</span>
                      )}
                    </p>
                    {!chamLai.het && (
                      <button type="button" className="btn-secondary text-small mt-2.5"
                        onClick={() => chamLaiCauThieu()} disabled={chamLai.dangGui} aria-busy={chamLai.dangGui}>
                        {chamLai.dangGui ? "Đang chấm lại…" : "Chấm lại câu còn thiếu"}
                      </button>
                    )}
                  </div>
                </div>
              )}
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
