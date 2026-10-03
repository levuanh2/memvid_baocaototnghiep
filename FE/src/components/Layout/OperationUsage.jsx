const number = (value) => new Intl.NumberFormat("vi-VN").format(Number(value || 0));

export default function OperationUsage({ usage, className = "" }) {
  if (!usage || typeof usage !== "object") return null;
  const total = Number(usage.total_tokens || 0);
  const seconds = usage.latency_ms == null ? null : Number(usage.latency_ms) / 1000;
  const cacheHit = Boolean(usage.cache_hit);
  const estimated = Boolean(usage.estimated) || usage.usage_source === "estimated";
  const label = cacheHit
    ? "Đã dùng bộ nhớ đệm · không tính thêm token"
    : `${estimated ? "Ước tính · " : ""}${number(total)} token${seconds == null ? "" : ` · ${seconds.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} giây`}`;
  const details = [
    `Đầu vào: ${number(usage.input_tokens)}`,
    `Đầu ra: ${number(usage.output_tokens)}`,
    Number(usage.embedding_tokens || 0) ? `Embedding: ${number(usage.embedding_tokens)}` : null,
    Number(usage.cached_input_tokens || 0) ? `Đầu vào cache: ${number(usage.cached_input_tokens)}` : null,
  ].filter(Boolean).join(" · ");
  return <span className={`text-caption font-mono text-text-muted ${className}`.trim()} title={details} aria-label={`${label}. ${details}`}>{label}</span>;
}
