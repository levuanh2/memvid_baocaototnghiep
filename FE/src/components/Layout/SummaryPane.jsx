// Summary — Workspace mode content (Workspace architecture, approved audit
// point 3). Same content SummaryModal used to render, minus the `Modal`
// dialog wrapper: rendered directly inside WorkspaceContainer's central
// region now, not portaled as a focus-trapped overlay. Summary GENERATION
// logic (SidebarRight's job/poller) is untouched — this component only ever
// displays a finished record, exactly as SummaryModal did.
import { useCallback, useEffect, useState } from "react";
import { MdProse } from "../ui/Markdown";
import EvidenceDrawer from "../mindmap/EvidenceDrawer";
import { Icon } from "../ui/Icon";
import { normalizeSummaryRecord } from "../../utils/summaryJob";
import { useStudyContext } from "../../study/useStudyContext";

const CHIP_CAP = 6;

const LENGTH_LABELS = { short: "Ngắn", medium: "Vừa", detailed: "Chi tiết" };

// Danh sách bullet có tiêu đề — dùng cho các block study; rỗng → không render.
function StudyList({ title, items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="text-[13px] font-semibold text-text-primary mb-1.5">{title}</div>
      <ul className="pl-5 list-disc marker:text-slate text-[14px] text-text-primary">
        {items.map((it, i) => <li key={i} className="mb-1 leading-[1.6]">{String(it)}</li>)}
      </ul>
    </div>
  );
}

export default function SummaryPane({ data }) {
  const [drawerNode, setDrawerNode] = useState(null);
  const closeDrawer = useCallback(() => setDrawerNode(null), []);
  // Study Context (Phase 4A.2) — cùng khoá STEM mà StudyMapView dùng. `rec.sources`
  // là mảng vì API hỗ trợ tóm tắt nhiều nguồn, nhưng luồng dùng thật của app luôn
  // đúng một tài liệu mỗi lượt mở — lấy phần tử đầu là đủ.
  const { selectDocument, selectSummary, selectEntity, selectedSummary } = useStudyContext();

  const rec = normalizeSummaryRecord(data);

  useEffect(() => {
    selectDocument(rec?.sources?.[0] || null, { source: "summary" });
  }, [rec?.sources, selectDocument]);

  if (!rec) {
    return (
      <div className="h-full flex items-center justify-center text-center px-6">
        <div>
          <Icon name="ScrollText" size={26} className="mx-auto mb-2.5 opacity-50 text-text-muted" />
          <p className="text-[12.5px] text-text-secondary">Chưa có tóm tắt nào được mở.</p>
        </div>
      </div>
    );
  }

  const degraded = Boolean(rec.generator?.degraded);
  const missing = Array.isArray(rec.generator?.missing) ? rec.generator.missing : [];
  const lengthLabel = LENGTH_LABELS[rec.lengthMode];

  const openEvidence = (section) =>
    setDrawerNode({
      id: section.id,
      title: section.title,
      note: "",
      chunkRefs: Array.isArray(section.chunk_refs) ? section.chunk_refs : [],
    });

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="px-3 py-2 border-b border-border flex-shrink-0 sticky top-0 z-10" style={{ background: "var(--bg-sidebar)" }}>
        <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-text-secondary">Tóm tắt tài liệu</div>
        <div className="font-display text-[14px] font-semibold truncate text-text-primary">{rec.title || "Tóm tắt tài liệu"}</div>
        {(rec.sources?.length || lengthLabel) && (
          <div className="text-[11.5px] text-text-muted mt-0.5">
            {[rec.sources?.length ? `${rec.sources.length} tài liệu` : null, lengthLabel ? `độ dài: ${lengthLabel}` : null]
              .filter(Boolean).join(" · ")}
          </div>
        )}
      </div>

      <div className="p-5 max-w-[840px] mx-auto">
        {degraded && (
          <div className="mb-4 rounded-[7px] border px-3 py-2.5 text-[12.5px]"
            style={{ borderColor: "var(--warn)", background: "color-mix(in srgb, var(--warn) 8%, transparent)", color: "var(--text-secondary)" }}>
            <Icon name="TriangleAlert" size={13} className="inline-block mr-1.5 align-[-2px]" />
            Một số phần chưa tóm tắt được{missing.length ? `: ${missing.join(", ")}` : "."} Bạn có thể tạo lại để thử lần nữa.
          </div>
        )}

        {rec.sections.length > 0 ? (
          <>
            {rec.overview && (
              <>
                <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted mb-2">Tổng quan</div>
                <div className="surface-card font-display mb-4">
                  <MdProse text={rec.overview} />
                </div>
              </>
            )}

            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted mb-2">Theo mục</div>
            <div className="flex flex-col gap-3">
              {rec.sections.map((s) => {
                const refs = Array.isArray(s.chunk_refs) ? s.chunk_refs : [];
                const daChon = selectedSummary === s.id;
                return (
                  <section key={s.id} className="surface-card font-display"
                           style={daChon ? { borderColor: "var(--accent)" } : undefined}>
                    <h3 className="mb-2">
                      <button type="button" onClick={() => selectSummary(s.id, { source: "summary" })}
                              className="font-display text-[15.5px] font-semibold text-left"
                              style={{ color: daChon ? "var(--accent)" : "var(--text-primary)" }}>
                        {s.title}
                      </button>
                    </h3>
                    {s.summary
                      ? <MdProse text={s.summary} />
                      : <p className="text-[13px] italic text-text-muted">Mục này chưa tóm tắt được.</p>}
                    {Array.isArray(s.key_points) && s.key_points.length > 0 && (
                      <ul className="pl-5 mt-2.5 list-disc marker:text-slate text-[14px] text-text-primary">
                        {s.key_points.map((p, i) => <li key={i} className="mb-1 leading-[1.6]">{p}</li>)}
                      </ul>
                    )}
                    {refs.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        {refs.slice(0, CHIP_CAP).map((r) => (
                          <button
                            key={r}
                            onClick={() => openEvidence(s)}
                            className="cite-chip !text-[11px]"
                            title={`Xem bằng chứng: đoạn ${r}`}
                          >
                            đoạn {r}
                          </button>
                        ))}
                        {refs.length > CHIP_CAP && (
                          <button onClick={() => openEvidence(s)} className="text-[11px] text-text-muted hover:text-accent underline">
                            +{refs.length - CHIP_CAP} đoạn
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>

            {rec.entities.length > 0 && (
              <div className="mt-4">
                <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted mb-2">Khái niệm then chốt</div>
                <div className="flex flex-wrap gap-1.5">
                  {rec.entities.map((e, i) => (
                    <button key={i} type="button" onClick={() => selectEntity(e, { source: "summary" })}
                            className="pill-tab !px-2.5 !py-1">{e}</button>
                  ))}
                </div>
              </div>
            )}

            {rec.mode === "study" && rec.study && (
              <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border-color)" }}>
                <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted mb-3">Ôn tập</div>
                <StudyList title="Khái niệm then chốt" items={rec.study.key_concepts} />
                <StudyList title="Định nghĩa" items={rec.study.definitions} />
                <StudyList title="Công thức" items={rec.study.formulas} />
                <StudyList title="Ví dụ" items={rec.study.examples} />
                <StudyList title="Lỗi thường gặp" items={rec.study.common_mistakes} />

                {Array.isArray(rec.study.self_check) && rec.study.self_check.length > 0 && (
                  <div className="mb-3">
                    <div className="text-[13px] font-semibold text-text-primary mb-1.5">Tự kiểm tra</div>
                    <ol className="pl-5 list-decimal marker:text-slate text-[14px] text-text-primary">
                      {rec.study.self_check.map((q, i) => (
                        <li key={i} className="mb-1 leading-[1.6]">
                          {typeof q === "string" ? q : q?.q}
                          {q?.a_hint ? <span className="text-text-muted"> — gợi ý: {q.a_hint}</span> : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {Array.isArray(rec.study.recommended_review) && rec.study.recommended_review.length > 0 && (
                  <div>
                    <div className="text-[13px] font-semibold text-text-primary mb-1.5">Nên ôn lại</div>
                    <ul className="flex flex-col gap-1.5">
                      {rec.study.recommended_review.map((r, i) => (
                        <li key={i} className="text-[13px] text-text-secondary">
                          <span className="text-text-primary">{r?.title || r?.section_title || "Mục"}</span>
                          {r?.page != null ? <span className="text-text-muted"> · trang {r.page}</span> : null}
                          {r?.reason ? <span className="text-text-muted"> — {r.reason}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted mb-2">Bản tóm tắt</div>
            <div className="surface-card font-display">
              <MdProse text={rec.legacyMd || "Không có tóm tắt."} />
            </div>
          </>
        )}
      </div>

      {drawerNode && <EvidenceDrawer node={drawerNode} onClose={closeDrawer} />}
    </div>
  );
}
