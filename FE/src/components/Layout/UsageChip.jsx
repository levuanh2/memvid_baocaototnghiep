import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../utils/api";
import { Icon } from "../ui/Icon";

const formatTokens = (value) => new Intl.NumberFormat("vi-VN").format(Number(value || 0));

export default function UsageChip() {
  const [usage, setUsage] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const rootRef = useRef(null);
  const mountedRef = useRef(false);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    apiFetch("/usage/me").then((response) => {
      if (!response.ok) throw new Error("usage request failed");
      return response.json();
    }).then((data) => { if (mountedRef.current && data?.limit) setUsage(data); })
      .catch(() => { if (mountedRef.current) setError(true); })
      .finally(() => { if (mountedRef.current) setLoading(false); });
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);

  if (loading && !usage) return <span className="text-caption text-text-muted" aria-label="Đang tải mức sử dụng">…</span>;
  if (error && !usage) return <button type="button" className="text-caption text-warn" onClick={load}>Usage ↻</button>;
  if (!usage) return null;
  const warning = usage.percentage >= 80 && usage.remaining > 0;
  const exhausted = usage.remaining <= 0;
  return (
    <div ref={rootRef} className="relative z-[60]">
      <button type="button" className="icon-btn h-9 px-2.5 gap-1.5 inline-flex" aria-expanded={open} aria-haspopup="dialog" title="Mức sử dụng AI" onClick={() => setOpen((value) => !value)}>
        <Icon name="Activity" size={15} />
        <span className={exhausted ? "text-danger" : warning ? "text-warn" : ""}>AI {Math.round(usage.percentage)}%</span>
      </button>
      {open && <div role="dialog" aria-label="Mức sử dụng AI" className="absolute right-0 md:right-[120px] top-[calc(100%+8px)] z-50 w-[min(280px,calc(100vw-16px))] rounded-[10px] border border-border bg-card p-3 shadow-card-hover">
        <div className="flex items-center justify-between"><strong className="text-small">Gói {usage.plan}</strong><button type="button" className="icon-btn w-7 h-7" aria-label="Đóng" onClick={() => setOpen(false)}><Icon name="X" size={14} /></button></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-elevated"><div className={exhausted ? "h-full bg-danger" : warning ? "h-full bg-warn" : "h-full bg-accent"} style={{ width: `${Math.min(100, usage.percentage)}%` }} /></div>
        <p className="mt-2 text-caption text-text-secondary">{formatTokens(usage.used)} dùng · {formatTokens(usage.reserved)} giữ · {formatTokens(usage.limit)} token tháng</p>
        <p className={exhausted ? "mt-1 text-caption text-danger" : "mt-1 text-caption text-text-secondary"}>Còn lại: {formatTokens(usage.remaining)}</p>
        <p className="mt-1 text-caption text-text-muted">Đặt lại: {new Date(usage.reset_at).toLocaleDateString("vi-VN")}</p>
        <div className="mt-3 border-t border-border pt-2 text-caption text-text-muted">{Object.entries(usage.breakdown || {}).map(([feature, total]) => <div key={feature} className="flex justify-between"><span>{feature}</span><span>{formatTokens(total)}</span></div>)}</div>
      </div>}
    </div>
  );
}
