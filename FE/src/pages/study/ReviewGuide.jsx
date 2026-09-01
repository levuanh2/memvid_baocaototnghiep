import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import StudyShell, { EmptyState } from "../../components/study/StudyShell";
import SealMeter from "../../components/study/SealMeter";
import { Icon } from "../../components/ui/Icon";
import Spinner from "../../components/ui/Spinner";
import { useStudyJob } from "../../hooks/useStudyJob";
import { MASTERY_LABEL, moTaLoi, generatePractice, generateReviewPlan, getReviewPlan } from "../../utils/studyApi";

export default function ReviewGuide() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [practiceFor, setPracticeFor] = useState(null);

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

  const practise = async (item) => {
    // Cờ đặt TRƯỚC await và nút đọc chính cờ này, không đọc `job.running`: `job.jobId`
    // chỉ có SAU khi 202 về, nên giữa lúc bấm và lúc đó nút vẫn bấm được và mỗi lần bấm
    // là một job luyện tập nữa tranh 1 slot LLM. Đúng lỗi Q1 vòng 7, chưa vá ở đây.
    if (practiceFor) return;
    setPracticeFor(item.review_item_id);
    setError(null);
    try {
      const body = await generatePractice({
        review_item_id: item.review_item_id,
        question_count: 5,
        difficulty: "easy",
      });
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
          <button type="button" className="btn-secondary text-[13px] inline-flex items-center gap-1.5"
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
            <button type="button" className="btn-seal text-[13px] mt-1 inline-flex items-center gap-2"
              disabled={busy} onClick={() => build()}>
              {busy ? <><Spinner size={13} /> Đang lập kế hoạch…</> : "Lập kế hoạch ôn tập"}
            </button>
          }
        />
      ) : (
        <>
          <p className="font-display text-[17px] leading-[1.6] text-text-primary mb-6">
            {plan.summary}
          </p>

          {job.jobId && (
            <div className="surface-card !p-3.5 mb-5 flex items-center gap-2.5">
              {job.error
                ? <Icon name="AlertCircle" size={15} style={{ color: "var(--err)" }} />
                : <Spinner size={14} />}
              <span className="text-[13.5px] text-text-secondary flex-1">
                {job.error || `Đang soạn câu luyện tập… ${job.status?.progress ?? 0}%`}
              </span>
              {job.error && (
                <button type="button" className="btn-secondary text-[12.5px]"
                  onClick={() => { job.reset(); setPracticeFor(null); }}>Đóng</button>
              )}
            </div>
          )}

          {plan.items.length === 0 ? (
            <EmptyState
              icon="BookOpen"
              title="Không còn chủ đề nào cần ôn"
              hint="Bài làm này không để lại lỗ hổng nào. Thử một quiz khó hơn hoặc tài liệu khác."
              action={<Link to="/app/study" className="btn-secondary text-[13px] mt-1">Về danh sách tài liệu</Link>}
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
                />
              ))}
            </ol>
          )}
        </>
      )}
    </StudyShell>
  );
}

function ReviewItem({ item, busy, disabled, onPractise }) {
  return (
    <li className="surface-card">
      <div className="flex items-start gap-4">
        <SealMeter score={item.mastery_score} status={item.status} size={46} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {/* Số thứ tự là ƯU TIÊN thật (mastery thấp trước), không phải đánh số cho đẹp. */}
            <span className="font-mono text-[11px] text-text-muted">Ưu tiên {item.priority}</span>
            <span className="font-mono text-[11px] text-text-muted">·</span>
            <span className="font-mono text-[11px]" style={{ color: "var(--accent)" }}>
              {MASTERY_LABEL[item.status] || item.status}
            </span>
          </div>

          <h3 className="font-display text-[17px] font-semibold text-text-primary">
            {item.topic}
          </h3>
          <p className="text-[13.5px] leading-[1.65] text-text-secondary mt-1.5">{item.reason}</p>

          {item.review_tasks?.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">
              {item.review_tasks.map((task, i) => (
                <li key={i} className="flex items-start gap-2 text-[13.5px] text-text-primary">
                  <Icon name="ArrowRight" size={13} className="mt-1 shrink-0 text-text-muted" />
                  <span className="leading-[1.6]">{task}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3 mt-4">
            {item.chunk_ids?.length > 0 && (
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-text-muted">
                <Icon name="Quote" size={12} />
                {item.chunk_ids.length} đoạn cần đọc lại
              </span>
            )}
            <button type="button" className="btn-seal text-[12.5px] inline-flex items-center gap-1.5"
              disabled={disabled} onClick={onPractise}>
              {busy ? <><Spinner size={12} /> Đang soạn…</> : <><Icon name="Zap" size={13} /> Luyện thêm 5 câu</>}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
