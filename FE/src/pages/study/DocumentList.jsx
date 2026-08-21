import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import StudyShell, { EmptyState, StatusTag } from "../../components/study/StudyShell";
import SealMeter from "../../components/study/SealMeter";
import { Icon } from "../../components/ui/Icon";
import Spinner from "../../components/ui/Spinner";
import {
  MASTERY_LABEL,
  formatScore,
  getProgressAttempts,
  getProgressConcepts,
  getProgressOverview,
  listDocuments,
  uploadDocument,
} from "../../utils/studyApi";

const READY = new Set(["completed", "ready", "index_ready"]);

export default function DocumentList() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [documents, setDocuments] = useState([]);
  const [overview, setOverview] = useState(null);
  const [weak, setWeak] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [docs, ov, concepts, history] = await Promise.all([
        listDocuments(),
        getProgressOverview(),
        getProgressConcepts({ weakOnly: true }),
        getProgressAttempts({ limit: 5 }),
      ]);
      setDocuments(docs);
      setOverview(ov);
      setWeak(concepts.slice(0, 4));
      setAttempts(history);
    } catch (e) {
      setError(e?.message || "Không tải được danh sách tài liệu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadDocument(file);
      await load();
    } catch (err) {
      setError(err?.message || "Tải tài liệu lên thất bại.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <StudyShell
      eyebrow="StudyMap"
      title="Tài liệu học tập"
      subtitle="Chọn một tài liệu để tạo quiz chẩn đoán, rồi ôn đúng phần còn yếu."
      backTo="/app"
      backLabel="Phòng đọc"
      loading={loading}
      error={error}
      onRetry={load}
      actions={
        <>
          <input ref={fileRef} type="file" className="hidden" onChange={onPick}
            accept=".pdf,.docx,.txt,.md" />
          <button type="button" className="btn-seal text-[13px] inline-flex items-center gap-2"
            disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <><Spinner size={13} /> Đang tải lên…</> : <><Icon name="Upload" size={14} /> Tải tài liệu</>}
          </button>
        </>
      }
    >
      {overview && <Overview overview={overview} />}

      {weak.length > 0 && (
        <section className="mb-7">
          <SectionTitle>Đang yếu ở</SectionTitle>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {weak.map((c) => (
              <div key={c.concept_name} className="surface-card !p-3.5 flex items-center gap-3">
                <SealMeter score={c.mastery_score} status={c.status} size={40} />
                <div className="min-w-0">
                  <div className="font-display text-[14.5px] font-semibold text-text-primary truncate">
                    {c.concept_name}
                  </div>
                  <div className="text-[12px] text-text-secondary">
                    {MASTERY_LABEL[c.status] || c.status}
                    {c.attempt_count > 1 && ` · ${c.attempt_count} lần làm`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-7">
        <SectionTitle>Tài liệu ({documents.length})</SectionTitle>
        {documents.length === 0 ? (
          <EmptyState
            icon="FileStack"
            title="Chưa có tài liệu nào"
            hint="Tải lên một file PDF, DOCX, TXT hoặc Markdown để bắt đầu."
            action={
              <button type="button" className="btn-seal text-[13px] mt-1"
                onClick={() => fileRef.current?.click()}>
                Tải tài liệu
              </button>
            }
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {documents.map((d) => {
              const ready = READY.has(d.status);
              return (
                <div key={d.document_id} className="surface-card !p-4 flex items-center gap-4">
                  <Icon name="FileText" size={18} className="text-text-muted shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[15px] font-semibold text-text-primary truncate">
                      {d.title}
                    </div>
                    <div className="font-mono text-[11px] text-text-muted mt-0.5">
                      {d.chunk_count ? `${d.chunk_count} đoạn` : "chưa có đoạn nào"}
                      {d.page_count ? ` · ${d.page_count} trang` : ""}
                    </div>
                  </div>
                  <StatusTag status={d.status} />
                  <button
                    type="button"
                    className="btn-secondary text-[13px] shrink-0 disabled:opacity-50"
                    disabled={!ready}
                    title={ready ? "" : "Tài liệu đang được xử lý"}
                    onClick={() => navigate(`/app/study/quiz/new?document=${encodeURIComponent(d.document_id)}`)}
                  >
                    Tạo quiz
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {attempts.length > 0 && (
        <section>
          <SectionTitle>Bài đã làm gần đây</SectionTitle>
          <div className="flex flex-col gap-2">
            {attempts.map((a) => (
              <Link
                key={a.attempt_id}
                to={a.status === "graded" ? `/app/study/result/${a.attempt_id}` : `/app/study/quiz/${a.quiz_id}`}
                className="surface-card !p-3.5 flex items-center gap-3 hover:no-underline"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-text-primary truncate">
                    {a.quiz_title}
                  </div>
                  <div className="font-mono text-[11px] text-text-muted mt-0.5">
                    {a.quiz_type === "practice" ? "luyện tập" : "chẩn đoán"}
                    {a.submitted_at ? ` · ${new Date(a.submitted_at).toLocaleDateString("vi-VN")}` : ""}
                  </div>
                </div>
                <span className="font-mono text-[13px] text-text-secondary shrink-0">
                  {formatScore(a.score, a.max_score)}
                </span>
                <StatusTag status={a.status} />
              </Link>
            ))}
          </div>
        </section>
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

function Overview({ overview }) {
  const items = [
    ["Tài liệu", overview.document_count],
    ["Quiz đã tạo", overview.quiz_count],
    ["Bài đã làm", overview.attempt_count],
    ["Điểm trung bình", overview.average_percentage == null ? "—" : `${overview.average_percentage}%`],
  ];
  return (
    <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-7">
      {items.map(([label, value]) => (
        <div key={label} className="surface-card !p-3.5">
          <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-text-muted">
            {label}
          </div>
          <div className="font-display text-[22px] font-semibold text-text-primary mt-1">
            {value ?? 0}
          </div>
        </div>
      ))}
    </section>
  );
}
