import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import StudyShell, { EmptyState } from "../../components/study/StudyShell";
import SealMeter from "../../components/study/SealMeter";
import {
  DifficultyControl,
  QuestionBuilderSummary,
  QuestionCountControl,
  QuestionTypeControl,
} from "../../components/study/QuestionBuilder";
import Modal from "../../components/ui/Modal";
import { Icon } from "../../components/ui/Icon";
import Spinner from "../../components/ui/Spinner";
import { useStudyJob } from "../../hooks/useStudyJob";
import { MASTERY_LABEL, moTaLoi, generatePractice, generateReviewPlan, getReviewPlan } from "../../utils/studyApi";

// "Luyện ngay" smart defaults — byte-identical to the prior hardcoded
// request (question_types intentionally OMITTED, exactly as before: BE's
// cau_hinh_quiz() defaults an absent field to all question types, so leaving
// it out here is what preserves that behavior, not naming all three).
const PRACTICE_QUICK_DEFAULTS = { question_count: 5, difficulty: "easy" };
// The Customize dialog needs an explicit starting value for every field
// (it's a real controlled form) — mirrors PRACTICE_QUICK_DEFAULTS's effective
// behavior (all three types allowed) rather than inventing a new default.
const PRACTICE_CUSTOM_DEFAULTS = { question_count: 5, difficulty: "easy", question_types: ["multiple_choice", "true_false", "short_answer"] };

export default function ReviewGuide() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [practiceFor, setPracticeFor] = useState(null);
  const [customizeItem, setCustomizeItem] = useState(null);

  const job = useStudyJob({
    onDone: (result) => {
      if (result?.quiz_id) navigate(`/app/study/practice/${result.quiz_id}`);
    },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPlan(await getReviewPlan(attemptId));
    } catch (e) {
      // Chưa có plan (404) không phải lỗi — chỉ là chưa tạo. Trang tự tạo giúp.
      if (e?.status === 404) setPlan(null);
      else setError(moTaLoi(e, "Không tải được kế hoạch ôn tập."));
    } finally {
      setLoading(false);
    }
  }, [attemptId]);

  useEffect(() => { load(); }, [load]);

  // Job luyện tập hỏng thì onDone không chạy, không có điều hướng nào — phải tự mở khoá
  // nút, nếu không trang này khoá vĩnh viễn cho tới khi F5.
  useEffect(() => { if (job.error) setPracticeFor(null); }, [job.error]);

  const build = async ({ force = false } = {}) => {
    setBusy(true);
    setError(null);
    try {
      setPlan(await generateReviewPlan(attemptId, { force }));
    } catch (e) {
      setError(moTaLoi(e, "Không tạo được kế hoạch ôn tập."));
    } finally {
      setBusy(false);
    }
  };

  // `config` defaults to the exact prior hardcoded body ("Luyện ngay"); the
  // Customize dialog calls this with a user-built config instead. Either way
  // it's the same job-start path, so job/error handling doesn't fork.
  const practise = async (item, config = PRACTICE_QUICK_DEFAULTS) => {
    // Cờ đặt TRƯỚC await và nút đọc chính cờ này, không đọc `job.running`: `job.jobId`
    // chỉ có SAU khi 202 về, nên giữa lúc bấm và lúc đó nút vẫn bấm được và mỗi lần bấm
    // là một job luyện tập nữa tranh 1 slot LLM. Đúng lỗi Q1 vòng 7, chưa vá ở đây.
    if (practiceFor) return;
    setPracticeFor(item.review_item_id);
    setCustomizeItem(null);
    setError(null);
    try {
      const body = await generatePractice({ review_item_id: item.review_item_id, ...config });
      if (body?.job_id) job.start(body.job_id);
      else {
        setError("Máy chủ không trả về mã tiến trình nào. Thử lại.");
        setPracticeFor(null);
      }
    } catch (e) {
      setError(moTaLoi(e, "Không tạo được câu luyện tập."));
      setPracticeFor(null);
    }
  };

  return (
    <StudyShell
      eyebrow="Hướng dẫn ôn tập"
      title={plan?.summary ? "Phần cần ôn lại" : "Kế hoạch ôn tập"}
      backTo={`/app/study/result/${attemptId}`}
      backLabel="Kết quả"
      loading={loading}
      error={error}
      onRetry={load}
      width="max-w-[820px]"
      actions={
        plan && (
          <button type="button" className="btn-secondary text-small inline-flex items-center gap-1.5"
            disabled={busy} onClick={() => build({ force: true })}>
            {busy ? <Spinner size={13} /> : <Icon name="RotateCcw" size={14} />} Viết lại
          </button>
        )
      }
    >
      {!plan ? (
        <EmptyState
          icon="BookOpen"
          title="Chưa có kế hoạch ôn tập"
          hint="Hệ thống sẽ lấy các chủ đề bạn làm chưa tốt và chỉ đúng đoạn tài liệu cần đọc lại."
          action={
            <button type="button" className="btn-seal text-small mt-1 inline-flex items-center gap-2"
              disabled={busy} onClick={() => build()}>
              {busy ? <><Spinner size={13} /> Đang lập kế hoạch…</> : "Lập kế hoạch ôn tập"}
            </button>
          }
        />
      ) : (
        <>
          <p className="font-display text-title text-text-primary mb-6">
            {plan.summary}
          </p>

          {job.jobId && (
            <div className="surface-card !p-3.5 mb-5 flex items-center gap-2.5">
              {job.error
                ? <Icon name="AlertCircle" size={15} style={{ color: "var(--err)" }} />
                : <Spinner size={14} />}
              <span className="text-body text-text-secondary flex-1">
                {job.error || `Đang soạn câu luyện tập… ${job.status?.progress ?? 0}%`}
              </span>
              {job.error && (
                <button type="button" className="btn-secondary text-small"
                  onClick={() => { job.reset(); setPracticeFor(null); }}>Đóng</button>
              )}
            </div>
          )}

          {plan.items.length === 0 ? (
            <EmptyState
              icon="BookOpen"
              title="Không còn chủ đề nào cần ôn"
              hint="Bài làm này không để lại lỗ hổng nào. Thử một quiz khó hơn hoặc tài liệu khác."
              action={<Link to="/app/study" className="btn-secondary text-small mt-1">Về danh sách tài liệu</Link>}
            />
          ) : (
            <ol className="flex flex-col gap-3">
              {plan.items.map((item) => (
                <ReviewItem
                  key={item.review_item_id}
                  item={item}
                  busy={practiceFor === item.review_item_id}
                  disabled={Boolean(practiceFor) || job.running}
                  onPractise={() => practise(item)}
                  onCustomize={() => setCustomizeItem(item)}
                />
              ))}
            </ol>
          )}
        </>
      )}

      {customizeItem && (
        <PracticeCustomizeDialog
          item={customizeItem}
          submitting={practiceFor === customizeItem.review_item_id}
          onClose={() => setCustomizeItem(null)}
          onSubmit={(config) => practise(customizeItem, config)}
        />
      )}
    </StudyShell>
  );
}

function ReviewItem({ item, busy, disabled, onPractise, onCustomize }) {
  return (
    <li className="surface-card">
      <div className="flex items-start gap-4">
        <SealMeter score={item.mastery_score} status={item.status} size={46} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {/* Số thứ tự là ƯU TIÊN thật (mastery thấp trước), không phải đánh số cho đẹp. */}
            <span className="font-mono text-caption text-text-muted">Ưu tiên {item.priority}</span>
            <span className="font-mono text-caption text-text-muted">·</span>
            <span className="font-mono text-caption" style={{ color: "var(--accent)" }}>
              {MASTERY_LABEL[item.status] || item.status}
            </span>
          </div>

          <h3 className="font-display text-title font-semibold text-text-primary">
            {item.topic}
          </h3>
          <p className="text-body text-text-secondary mt-1.5">{item.reason}</p>

          {item.review_tasks?.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">
              {item.review_tasks.map((task, i) => (
                <li key={i} className="flex items-start gap-2 text-body text-text-primary">
                  <Icon name="ArrowRight" size={13} className="mt-1 shrink-0 text-text-muted" />
                  <span>{task}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3 mt-4">
            {item.chunk_ids?.length > 0 && (
              <span className="inline-flex items-center gap-1.5 font-mono text-caption text-text-muted">
                <Icon name="Quote" size={12} />
                {item.chunk_ids.length} đoạn cần đọc lại
              </span>
            )}
            <button type="button" className="btn-seal text-small inline-flex items-center gap-1.5"
              disabled={disabled} onClick={onPractise}>
              {busy ? <><Spinner size={12} /> Đang soạn…</> : <><Icon name="Zap" size={13} /> Luyện ngay (5 câu)</>}
            </button>
            <button type="button" className="btn-secondary text-small inline-flex items-center gap-1.5"
              disabled={disabled} onClick={onCustomize}>
              <Icon name="Sliders" size={13} /> Tùy chỉnh
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

// Pre-filled with the SAME reusable Question Builder controls QuizSetup
// uses. The weak topic / authoritative chunk source is fixed context, shown
// read-only — the user tunes count/difficulty/types, never re-picks the
// topic (that would let a client request questions from chunks outside the
// review item's authoritative scope).
function PracticeCustomizeDialog({ item, submitting, onClose, onSubmit }) {
  const [count, setCount] = useState(PRACTICE_CUSTOM_DEFAULTS.question_count);
  const [difficulty, setDifficulty] = useState(PRACTICE_CUSTOM_DEFAULTS.difficulty);
  const [types, setTypes] = useState(PRACTICE_CUSTOM_DEFAULTS.question_types);
  const [typeError, setTypeError] = useState(null);

  const submit = () => {
    if (!types.length) { setTypeError("Chọn ít nhất một dạng câu hỏi."); return; }
    onSubmit({ question_count: count, difficulty, question_types: types });
  };

  return (
    <Modal open title="Tùy chỉnh luyện tập" subtitle={item.topic} onClose={submitting ? undefined : onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-small" disabled={submitting} onClick={onClose}>Huỷ</button>
          <button type="button" className="btn-seal text-small inline-flex items-center gap-1.5"
            disabled={submitting} onClick={submit}>
            {submitting ? <><Spinner size={13} /> Đang soạn…</> : <><Icon name="Zap" size={13} /> Tạo câu luyện tập</>}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5 p-5">
        <div className="surface-card !p-3 flex items-center gap-2 font-mono text-caption text-text-muted">
          <Icon name="Quote" size={12} />
          Nguồn: {item.chunk_ids?.length || 0} đoạn từ chủ đề "{item.topic}" — cố định, không đổi được ở đây.
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-mono text-metadata uppercase text-text-muted">Số câu</span>
          <QuestionCountControl value={count} onChange={setCount} />
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-mono text-metadata uppercase text-text-muted">Độ khó</span>
          <DifficultyControl value={difficulty} onChange={setDifficulty} />
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-mono text-metadata uppercase text-text-muted">Dạng câu hỏi</span>
          <QuestionTypeControl value={types} onChange={(v) => { setTypeError(null); setTypes(v); }} />
          {typeError && (
            <span className="text-small flex items-center gap-1.5" style={{ color: "var(--err)" }}>
              <Icon name="AlertCircle" size={14} /> {typeError}
            </span>
          )}
        </div>

        <QuestionBuilderSummary count={count} difficulty={difficulty} types={types} scopeLabel={`Chủ đề: ${item.topic}`} />
      </div>
    </Modal>
  );
}
