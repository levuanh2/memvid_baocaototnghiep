import { Icon } from "./Icon";

const TONE = {
  ready: "badge-ready",
  processing: "badge-processing",
  error: "badge-error",
};

/** Worded status tag — conveys state by text + color (never color alone). */
export default function Badge({ tone = "ready", children, className = "" }) {
  const isReady = String(children).trim().toLowerCase() === "sẵn sàng";
  if (isReady) {
    return (
      <span
        className={`inline-flex items-center text-[var(--ok)] ${className}`}
        title="Sẵn sàng"
        aria-label="Sẵn sàng"
      >
        <Icon name="CheckCircle2" size={15} className="text-[var(--ok)] flex-shrink-0" />
      </span>
    );
  }
  return <span className={`${TONE[tone] || TONE.ready} ${className}`}>{children}</span>;
}
