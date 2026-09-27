import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import StudyShell from "../../components/study/StudyShell";
import {
  DifficultyControl,
  QuestionBuilderSummary,
  QuestionCountControl,
  QuestionTypeControl,
} from "../../components/study/QuestionBuilder";
import { Icon } from "../../components/ui/Icon";
import Spinner from "../../components/ui/Spinner";
import { useStudyJob } from "../../hooks/useStudyJob";
import {
  generateQuiz,
  getDocument,
  listDocuments,
  listSections,
  moTaLoi,
} from "../../utils/studyApi";

export default function QuizSetup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const documentId = params.get("document") || "";

  const [doc, setDoc] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState("mixed");
  const [types, setTypes] = useState(["multiple_choice", "true_false"]);
  const [sectionIds, setSectionIds] = useState([]);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref, not just the `submitting` state: two rapid clicks in the same
  // tick both dispatch onSubmit before React's first setSubmitting(true)
  // commits, so a state-only guard lets both through (see GuidedMindmapDialog
  // .jsx's submitStartedRef for the same fix). The ref mutates synchronously.
  const submittingRef = useRef(false);

  const job = useStudyJob({
    onDone: (result) => {
      if (!result?.quiz_id) return;
      // Kiểm chất lượng loại bớt câu là chuyện thường, nhưng "xin 5 nhận 3" mà không nói
      // gì thì người dùng tưởng hệ thống hỏng. BE đã trả `rejected_count`; mang nó sang
      // trang làm bài để nói ra đúng một lần.
      navigate(`/app/study/quiz/${result.quiz_id}`, {
        replace: true,
        state: {
          asked: count,
          kept: result.question_count,
          rejected: result.rejected_count ?? 0,
          // Nguyên nhân do BE ĐẾM từ log kiểm chất lượng, không phải câu đoán viết sẵn
          // ở giao diện.
          reason: result.rejected_reason || "",
        },
      });
    },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!documentId) {
        setDocuments(await listDocuments());
      } else {
        const [d, s] = await Promise.all([getDocument(documentId), listSections(documentId)]);
        setDoc(d);
        setSections(s);
      }
    } catch (e) {
      setError(moTaLoi(e, "Không tải được tài liệu."));
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => { load(); }, [load]);

  const toggleSection = (id) =>
    setSectionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const scopeLabel = useMemo(
    () => (sectionIds.length ? `${sectionIds.length} mục đã chọn` : "Toàn bộ tài liệu"),
    [sectionIds],
  );

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    if (!types.length) return setSubmitError("Chọn ít nhất một dạng câu hỏi.");
    // Giữa lúc bấm và lúc 202 về, form không đổi gì — nên bấm thêm là phản xạ đúng của
    // người dùng, và mỗi lần bấm là một job LLM nữa. Máy chỉ có 1 slot: job thừa xếp
    // hàng rồi chết với "LLM busy", kể cả khi quiz thật đã ra xong. Cờ đặt TRƯỚC await,
    // và trên REF (không chỉ state): hai click liên tiếp trong cùng một tick đều đọc
    // `submitting` cũ trước khi setSubmitting(true) đầu tiên kịp commit.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const body = await generateQuiz({
        document_id: documentId,
        question_count: count,
        difficulty,
        question_types: types,
        scope: { section_ids: sectionIds },
      });
      if (body?.job_id) job.start(body.job_id);
      // Không có nhánh này thì nút hết quay và TUYỆT ĐỐI không có gì xảy ra: người dùng
      // bấm lại, và lần này có thể ra job thật — thành hai job cho một ý định.
      else setSubmitError("Máy chủ không trả về mã tiến trình nào. Thử lại.");
    } catch (err) {
      setSubmitError(moTaLoi(err, "Không tạo được quiz."));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  // Chưa chọn tài liệu → cho chọn ngay tại đây thay vì đá về trang trước.
  if (!documentId) {
    return (
      <StudyShell title="Tạo quiz chẩn đoán" subtitle="Chọn tài liệu để ra đề."
        loading={loading} error={error} onRetry={load}>
        <div className="flex flex-col gap-2.5">
          {documents.map((d) => (
            <button key={d.document_id} type="button"
              className="surface-card !p-4 text-left flex items-center gap-3"
              onClick={() => navigate(`/app/study/quiz/new?document=${encodeURIComponent(d.document_id)}`)}>
              <Icon name="FileText" size={17} className="text-text-muted" />
              <span className="font-display text-body-lg font-semibold text-text-primary flex-1 truncate">
                {d.title}
              </span>
              <Icon name="ArrowRight" size={15} className="text-text-muted" />
            </button>
          ))}
        </div>
      </StudyShell>
    );
  }

  return (
    <StudyShell
      title={doc?.title || "Tạo quiz chẩn đoán"}
      subtitle="Đề được ra từ chính tài liệu này. Mỗi câu hỏi giữ liên kết tới đoạn văn nguồn."
      loading={loading}
      error={error}
      onRetry={load}
      width="max-w-[760px]"
    >
      {job.jobId ? (
        <JobProgress job={job} />
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <Field label="Số câu">
            <QuestionCountControl value={count} onChange={setCount} />
          </Field>

          <Field label="Độ khó">
            <DifficultyControl value={difficulty} onChange={setDifficulty} />
          </Field>

          <Field label="Dạng câu hỏi" hint="Trả lời ngắn được chấm bằng AI nên mất thêm ít phút.">
            <QuestionTypeControl value={types} onChange={setTypes} />
          </Field>

          {sections.length > 0 && (
            <Field label="Phạm vi" hint={scopeLabel}>
              <div className="flex flex-col gap-1 max-h-[240px] overflow-y-auto pr-1">
                {sections.map((s) => (
                  <button key={s.section_id} type="button"
                    className={`text-left rounded-[6px] px-3 py-2 text-body transition-all border ${
                      sectionIds.includes(s.section_id)
                        ? "border-accent text-accent"
                        : "border-transparent text-text-secondary hover:text-text-primary"
                    }`}
                    style={{ paddingLeft: `${12 + (s.level - 1) * 14}px` }}
                    onClick={() => toggleSection(s.section_id)}>
                    {s.title}
                  </button>
                ))}
              </div>
              {sectionIds.length > 0 && (
                <button type="button" className="text-small text-text-muted hover:text-accent mt-1"
                  onClick={() => setSectionIds([])}>Bỏ chọn, ra đề toàn tài liệu</button>
              )}
            </Field>
          )}

          <QuestionBuilderSummary count={count} difficulty={difficulty} types={types} scopeLabel={scopeLabel} />

          {submitError && (
            <div className="text-small flex items-center gap-1.5" style={{ color: "var(--err)" }}>
              <Icon name="AlertCircle" size={14} /> {submitError}
            </div>
          )}

          <button type="submit" disabled={submitting}
            className="btn-seal inline-flex items-center justify-center gap-2 self-start disabled:opacity-60 disabled:cursor-not-allowed">
            {submitting ? <Spinner size={15} /> : <Icon name="Zap" size={15} />}
            {submitting ? "Đang gửi yêu cầu…" : "Tạo quiz"}
          </button>
        </form>
      )}
    </StudyShell>
  );
}

// A plain <div>, not <label>: children include real labelable controls
// (QuestionCountControl's custom-count <input>), and a <label> wrapping
// multiple/foreign labelable descendants makes the browser treat the first
// one as this wrapper's implicit target — clicking an unrelated preset pill
// would silently steal focus onto that input.
function Field({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-metadata uppercase text-text-muted">
        {label}
      </span>
      {children}
      {hint && <span className="text-small text-text-muted">{hint}</span>}
    </div>
  );
}

function JobProgress({ job }) {
  const progress = job.status?.progress ?? 0;
  return (
    <div className="surface-card flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        {job.error ? (
          <Icon name="AlertCircle" size={16} style={{ color: "var(--err)" }} />
        ) : (
          <Spinner size={15} />
        )}
        <div className="flex-1">
          <div className="text-body font-semibold text-text-primary">
            {job.error ? "Tạo quiz thất bại" : "Đang ra đề từ tài liệu"}
          </div>
          <div className="font-mono text-caption text-text-muted mt-0.5">
            {job.error || job.status?.current_node || "Đang chuẩn bị"}
          </div>
        </div>
        <span className="font-mono text-small text-text-secondary">{progress}%</span>
      </div>

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex gap-2">
        {job.error ? (
          <button type="button" className="btn-secondary text-small" onClick={job.reset}>
            Sửa cấu hình và thử lại
          </button>
        ) : (
          <button type="button" className="btn-secondary text-small" onClick={job.cancel}>
            Huỷ
          </button>
        )}
      </div>
    </div>
  );
}
