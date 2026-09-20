import { useEffect, useMemo, useState } from "react";
import { suggestMindmapTopics } from "../../utils/api";
import { Icon } from "../ui/Icon";

const PURPOSES = [["overview", "Tổng quan"], ["concepts", "Khái niệm chính"], ["process", "Quy trình"], ["comparison", "So sánh"], ["study", "Ôn tập"]];
const DETAILS = [["compact", "Gọn"], ["balanced", "Cân bằng"], ["detailed", "Chi tiết"]];

export default function GuidedMindmapDialog({ sources = [], onClose, onSubmit, loading = false, error = null }) {
  const sourceIds = useMemo(() => sources.map((s) => typeof s === "string" ? s : s.id || s.name || s.source_stem).filter(Boolean), [sources]);
  const sourceKey = sourceIds.join("|");
  const [instruction, setInstruction] = useState("");
  const [purpose, setPurpose] = useState("overview");
  const [detailLevel, setDetailLevel] = useState("balanced");
  const [topics, setTopics] = useState([]);
  const [selected, setSelected] = useState([]);
  const [topicLoading, setTopicLoading] = useState(Boolean(sourceIds.length));
  const [topicError, setTopicError] = useState(null);
  const loadTopics = async () => { setTopicLoading(true); setTopicError(null); try { const data = await suggestMindmapTopics(sourceIds); const next = Array.isArray(data?.suggestions) ? data.suggestions : []; setTopics(next); setSelected(next.slice(0, 1).map((item) => item.id)); } catch (e) { setTopicError(e); } finally { setTopicLoading(false); } };
  // sourceKey is the stable identity for the selected source set; loading a
  // new set should reset server-derived topics, not the user's form choices.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (sourceIds.length) loadTopics(); else { setTopicLoading(false); setTopics([]); setSelected([]); } }, [sourceKey]);
  const submit = (event) => { event.preventDefault(); if (!sourceIds.length || loading) return; const selectedTopics = topics.filter((topic) => selected.includes(topic.id)); const idempotencyKey = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${sourceKey}`; onSubmit({ sourceIds, instruction, selectedTopicIds: selected, selectedTopics, preset: purpose, detailLevel, locale: "vi", idempotencyKey }); };
  return <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/35 p-0 sm:p-6" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
    <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="guided-mindmap-title" className="w-full sm:max-w-[620px] max-h-[92vh] overflow-y-auto rounded-t-[18px] sm:rounded-[16px] border border-border bg-surface-card shadow-card-hover p-5 sm:p-6">
      <div className="flex items-start gap-3 mb-5"><div className="flex-1"><h2 id="guided-mindmap-title" className="font-display text-title font-semibold text-text-primary">Tạo sơ đồ tư duy</h2><p className="text-small text-text-secondary mt-1">Định hướng nội dung trước khi tạo từ {sourceIds.length} tài liệu đã chọn.</p></div><button type="button" onClick={onClose} className="icon-btn w-10 h-10" aria-label="Đóng"><Icon name="X" size={17} /></button></div>
      <div className="surface-card p-3 mb-4"><div className="text-caption uppercase font-mono text-text-muted mb-1">Tài liệu đang dùng</div><div className="text-small text-text-primary">{sourceIds.join(" · ") || "Chưa có nguồn"}</div></div>
      <label className="block text-small font-semibold text-text-primary mb-1">Yêu cầu riêng <span className="font-normal text-text-muted">(tuỳ chọn)</span></label><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={3} placeholder="Ví dụ: Tập trung vào quy trình triển khai..." className="input-surface w-full resize-y mb-4" />
      <section className="mb-4" aria-labelledby="guided-topics"><div id="guided-topics" className="text-small font-semibold text-text-primary mb-2">Chủ đề gợi ý từ tài liệu</div>{topicLoading ? <div className="text-small text-text-muted animate-pulse">Đang phân tích nội dung…</div> : topicError ? <div className="flex items-center gap-2 text-small text-warning"><span>Không tải được gợi ý.</span><button type="button" onClick={loadTopics} className="text-accent hover:underline">Thử lại</button></div> : topics.length ? <div className="flex flex-wrap gap-2">{topics.map((topic) => <button key={topic.id} type="button" onClick={() => setSelected((prev) => prev.includes(topic.id) ? prev.filter((id) => id !== topic.id) : [...prev, topic.id])} className={`px-3 py-2 rounded-full border text-small ${selected.includes(topic.id) ? "border-accent bg-accent/10 text-accent" : "border-border text-text-secondary"}`} title={topic.rationale}>{topic.title}</button>)}</div> : <div className="text-small text-text-muted">Chưa tìm thấy chủ đề nổi bật. Bạn vẫn có thể dùng yêu cầu riêng.</div>}</section>
      <div className="grid sm:grid-cols-2 gap-4 mb-5"><fieldset><legend className="text-small font-semibold text-text-primary mb-2">Mục đích</legend><div className="flex flex-wrap gap-2">{PURPOSES.map(([id, label]) => <label key={id} className={`cursor-pointer px-3 py-2 rounded-lg border text-small ${purpose === id ? "border-accent text-accent bg-accent/10" : "border-border text-text-secondary"}`}><input className="sr-only" type="radio" name="guided-purpose" value={id} checked={purpose === id} onChange={() => setPurpose(id)} />{label}</label>)}</div></fieldset><fieldset><legend className="text-small font-semibold text-text-primary mb-2">Độ chi tiết</legend><div className="flex flex-wrap gap-2">{DETAILS.map(([id, label]) => <label key={id} className={`cursor-pointer px-3 py-2 rounded-lg border text-small ${detailLevel === id ? "border-accent text-accent bg-accent/10" : "border-border text-text-secondary"}`}><input className="sr-only" type="radio" name="guided-detail" value={id} checked={detailLevel === id} onChange={() => setDetailLevel(id)} />{label}</label>)}</div></fieldset></div>
      {error && <p className="text-small text-warning mb-3">{error}</p>}<div className="sticky bottom-0 pt-3 bg-surface-card"><button type="submit" disabled={!sourceIds.length || loading} className="btn-primary w-full justify-center !py-3 disabled:opacity-40">{loading ? "Đang tạo…" : "Tạo sơ đồ"}<Icon name="ArrowRight" size={15} /></button></div>
    </form>
  </div>;
}
