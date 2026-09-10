import { Link } from "react-router-dom";
import { Icon } from "../ui/Icon";
import Disclosure from "../ui/Disclosure";
import { useStudyContext } from "../../study/useStudyContext";
import { danhSachHanhDong, xayRecap } from "../../study/tutorActions";

const NHAN_MODE = { focus: "Tập trung", reader: "Đọc", tutor: "Gia sư" };

/** Một dòng của Thẻ ngữ cảnh — chỉ vẽ khi có giá trị thật (Step 2: không bịa). */
function DongNguCanh({ icon, nhan, giaTri }) {
  if (!giaTri) return null;
  return (
    <div className="flex items-start gap-2 text-[12.5px]">
      <Icon name={icon} size={13} className="text-text-muted mt-[2px] flex-shrink-0" />
      <div className="min-w-0">
        <span className="text-text-muted">{nhan}: </span>
        <span className="text-text-primary font-medium">{giaTri}</span>
      </div>
    </div>
  );
}

/**
 * Gia sư AI (Phase 4C) — thẻ ngữ cảnh + hành động nhanh + câu hỏi gợi ý, đọc
 * THUẦN từ Study Context + Tutor Memory (session-only). Không tự fetch gì,
 * không tự điều hướng gì ngoài hai callback được truyền vào:
 *
 * - `askDirect(text)`: gửi một câu hỏi THẲNG vào ô chat đang mở — CHÍNH LÀ
 *   `setAskAboutDraft` của MainLayout, bộ phát DUY NHẤT mà Câu hỏi gợi ý/"Hỏi
 *   về đoạn này" đã dùng từ Phase 4A.3 (Step 6: một bộ phát, không tạo thêm).
 * - `openArtifact(tab)`: chuyển tab "Sơ đồ"/"Tóm tắt" ở cột Lề bằng chứng —
 *   tái dùng đúng cơ chế tạo/xem đã có, không thêm route (xem tutorActions.js).
 */
export default function TutorPanel({ askDirect, openArtifact, memory }) {
  const ctx = useStudyContext();
  const { selectedDocument, selectedTopic, selectedEntity, selectedNode, selectedSummary, selectedQuestion, learningMode } = ctx;

  if (!selectedDocument) {
    // Step 7 — trạng thái rỗng "chưa có tài liệu": nói rõ việc làm được ngay,
    // không vẽ khung ngữ cảnh/hành động giả cho một phiên chưa bắt đầu.
    return (
      <div className="flex flex-col items-center text-center px-5 py-10 gap-3">
        <Icon name="Sparkles" size={24} className="text-text-muted opacity-70" />
        <p className="text-[13px] text-text-secondary leading-[1.6] max-w-[260px]">
          Gia sư AI cần một tài liệu đang xem. Mở một tài liệu ở Thư viện học tập,
          hoặc chọn nguồn ở cột trái rồi đặt câu hỏi trong khung chat.
        </p>
        <Link to="/app/study" className="pill-action !text-[12.5px]">
          <Icon name="Library" size={13} /> Thư viện học tập
        </Link>
      </div>
    );
  }

  const hanhDong = danhSachHanhDong(ctx);
  const recap = xayRecap(memory);
  const goiY = memory.recentQuestions.filter((q) => q.id !== selectedQuestion);

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* ── Thẻ ngữ cảnh (Step 2) ── */}
      <section className="surface-card !p-3 flex flex-col gap-1.5" aria-label="Đang xem">
        <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-text-muted mb-0.5">
          Đang xem
        </div>
        <DongNguCanh icon="FileText" nhan="Tài liệu" giaTri={selectedDocument} />
        <DongNguCanh icon="Tag" nhan="Chủ đề" giaTri={selectedTopic} />
        <DongNguCanh icon="BookOpen" nhan="Khái niệm" giaTri={selectedEntity} />
        <DongNguCanh icon="Network" nhan="Node" giaTri={selectedNode} />
        <DongNguCanh icon="ScrollText" nhan="Mục tóm tắt" giaTri={selectedSummary} />
        <DongNguCanh icon="MessageCircleQuestion" nhan="Câu hỏi" giaTri={selectedQuestion} />
        {learningMode && (
          <DongNguCanh icon="Zap" nhan="Chế độ" giaTri={NHAN_MODE[learningMode] || learningMode} />
        )}
      </section>

      {/* ── Hành động nhanh (Step 3) ── */}
      <section aria-label="Hành động nhanh">
        <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-text-muted mb-2">
          Hành động nhanh
        </div>
        <div className="flex flex-wrap gap-1.5">
          {hanhDong.map((a) => (
            <button
              key={a.key}
              type="button"
              disabled={!a.enabled}
              onClick={() => (a.artifact ? openArtifact(a.artifact) : askDirect(a.prompt))}
              className="pill-action !text-[12px] disabled:opacity-40"
            >
              <Icon name={a.icon} size={13} /> {a.label}
            </button>
          ))}
          {recap && (
            <button type="button" onClick={() => askDirect(recap)} className="pill-action !text-[12px]">
              <Icon name="RotateCcw" size={13} /> Ôn lại phiên này
            </button>
          )}
        </div>
      </section>

      {/* ── Câu hỏi gợi ý (Step 4) — từ Study Context + Tutor Memory, KHÔNG
          tự tải câu hỏi mới: Workspace không có `document_id` để gọi Question
          Engine (xem tutorActions.js) — đây là câu ĐÃ chọn qua nơi khác trong
          phiên này, không phải một bộ Top-3 sinh mới. */}
      <section aria-label="Câu hỏi gợi ý">
        <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-text-muted mb-2">
          Câu hỏi trong phiên này
        </div>
        {selectedQuestion || goiY.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {selectedQuestion && (
              <button type="button" onClick={() => askDirect(selectedQuestion)}
                      className="pill-tab pill-tab-active !justify-start !text-left !text-[12.5px] !py-1.5">
                {selectedQuestion}
              </button>
            )}
            {goiY.length > 0 && (
              <Disclosure title={`Câu hỏi khác đã xem (${goiY.length})`} defaultOpen={false}>
                <div className="flex flex-col gap-1.5">
                  {goiY.map((q) => (
                    <button key={q.id} type="button" onClick={() => askDirect(q.text)}
                            className="pill-tab !justify-start !text-left !text-[12.5px] !py-1.5">
                      {q.text}
                    </button>
                  ))}
                </div>
              </Disclosure>
            )}
          </div>
        ) : (
          <p className="text-[12.5px] text-text-muted leading-[1.6]">
            Chưa có câu hỏi nào được chọn trong phiên này. Mở tài liệu này ở{" "}
            <Link to="/app/study" className="underline hover:text-accent">Thư viện học tập</Link>{" "}
            để xem câu hỏi gợi ý từ Question Engine.
          </p>
        )}
      </section>
    </div>
  );
}
