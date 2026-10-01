import { useEffect, useState } from "react";
import { apiFetch } from "../../utils/api";
import { Icon } from "../ui/Icon";

const formatTokens = (value) => new Intl.NumberFormat("vi-VN").format(Number(value || 0));

export default function UsageChip() {
  const [usage, setUsage] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch("/usage/me").then((response) => response.ok ? response.json() : null).then((data) => {
      if (active && data?.limit) setUsage(data);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  if (!usage) return null;
  const warning = usage.percentage >= 80;
  return (
    <div className="relative hidden sm:block">
      <button type="button" className="icon-btn h-9 px-2.5 gap-1.5 inline-flex" aria-expanded={open} aria-haspopup="dialog" title="Mức sử dụng AI" onClick={() => setOpen((value) => !value)}>
        <Icon name="Activity" size={15} />
        <span className={warning ? "text-warn" : ""}>AI {Math.round(usage.percentage)}%</span>
      </button>
      {open && <div role="dialog" aria-label="Mức sử dụng AI" className="absolute right-0 top-[calc(100%+8px)] z-50 w-[280px] rounded-[10px] border border-border bg-card p-3 shadow-card-hover">
        <div className="flex items-center justify-between"><strong className="text-small">Gói {usage.plan}</strong><button type="button" className="icon-btn w-7 h-7" aria-label="Đóng" onClick={() => setOpen(false)}><Icon name="X" size={14} /></button></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-elevated"><div className={warning ? "h-full bg-warn" : "h-full bg-accent"} style={{ width: `${Math.min(100, usage.percentage)}%` }} /></div>
        <p className="mt-2 text-caption text-text-secondary">{formatTokens(usage.used)} / {formatTokens(usage.limit)} token tháng</p>
        <p className="mt-1 text-caption text-text-muted">Đặt lại: {new Date(usage.reset_at).toLocaleDateString("vi-VN")}</p>
        <div className="mt-3 border-t border-border pt-2 text-caption text-text-muted">{Object.entries(usage.breakdown || {}).map(([feature, total]) => <div key={feature} className="flex justify-between"><span>{feature}</span><span>{formatTokens(total)}</span></div>)}</div>
      </div>}
    </div>
  );
}
