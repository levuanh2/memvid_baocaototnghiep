// Markdown render cho TRÍCH ĐOẠN bằng chứng (EvidenceDrawer, lề bằng chứng) —
// chữ nhỏ hơn answer prose, không citation-chip. Chat answer vẫn dùng
// makeMdComponents riêng trong ChatArea (có citation logic + highlight state).
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { unescapeMd } from "../../utils/evidence";

const SM = {
  p: (p) => <p className="mb-1.5 last:mb-0 leading-[1.6]" {...p} />,
  ul: (p) => <ul className="pl-4 my-1.5 list-disc marker:text-slate" {...p} />,
  ol: (p) => <ol className="pl-4 my-1.5 list-decimal marker:text-slate" {...p} />,
  li: (p) => <li className="mb-1 leading-[1.55]" {...p} />,
  strong: (p) => <strong className="font-semibold text-text-primary" {...p} />,
  em: (p) => <em className="italic" {...p} />,
  code: ({ inline, children, ...props }) =>
    <code className="font-mono text-[11px] bg-surface-elevated px-1 rounded" {...props}>{children}</code>,
  // heading trong snippet hạ cấp thành đoạn đậm — trích đoạn không cần cấp bậc to
  h1: (p) => <p className="font-semibold mb-1.5" {...p} />,
  h2: (p) => <p className="font-semibold mb-1.5" {...p} />,
  h3: (p) => <p className="font-semibold mb-1.5" {...p} />,
  a: ({ children }) => <span>{children}</span>, // snippet không cần link sống
};

export function MdSnippet({ text, className = "" }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={SM}>
        {unescapeMd(text)}
      </ReactMarkdown>
    </div>
  );
}

// Prose cỡ đọc (SummaryModal) — chuyển từ mdComponents inline của SummaryModal
// vào đây để mọi text dài render qua MỘT đường (bài học "một đường render").
// Wave 4: sizes now come from the named scale (docs/DESIGN_TOKEN_AUDIT.md §1)
// instead of three arbitrary pixel values with no relationship to each other
// or to the rest of the app. h1/h2 share `text-h3` (both are "a sub-head
// inside a block of prose", the SAME semantic role, previously differentiated
// by 2px for no reason); h3 collapses into `text-body` since 15px was already
// body-adjacent, and it's still visually distinct via weight + secondary color.
const PROSE = {
  p: ({ node, ...p }) => <p className="mb-2.5 last:mb-0 text-body leading-[1.72] text-text-primary" {...p} />,
  ul: ({ node, ...p }) => <ul className="pl-5 my-2.5 list-disc marker:text-slate text-body text-text-primary" {...p} />,
  ol: ({ node, ...p }) => <ol className="pl-5 my-2.5 list-decimal marker:text-slate text-body text-text-primary" {...p} />,
  li: ({ node, ...p }) => <li className="mb-1.5 leading-[1.7]" {...p} />,
  strong: ({ node, ...p }) => <strong className="text-text-primary font-semibold" {...p} />,
  em: ({ node, ...p }) => <em className="italic" {...p} />,
  h1: ({ node, ...p }) => <h1 className="font-display text-h3 font-semibold my-3 text-text-primary" {...p} />,
  h2: ({ node, ...p }) => <h2 className="font-display text-h3 font-semibold my-2.5 text-text-primary" {...p} />,
  h3: ({ node, ...p }) => <h3 className="font-display text-body font-semibold my-2 text-text-secondary" {...p} />,
  code: ({ node, inline, children, ...props }) => inline
    ? <code className="bg-surface-elevated border border-border px-1.5 py-0.5 rounded text-[12.5px] font-mono text-text-secondary" {...props}>{children}</code>
    : <pre className="bg-surface-elevated border border-border rounded-[7px] p-3 overflow-x-auto my-2.5"><code className="text-[12.5px] font-mono text-text-secondary" {...props}>{children}</code></pre>,
  blockquote: ({ node, ...p }) => <blockquote className="border-l-2 border-brand/50 pl-3.5 my-2.5 text-text-secondary italic" {...p} />,
};

/** `dropCap` — the opening-paragraph editorial flourish from the redesign
 * spec (§07): use on ONE reading surface's first block, never repeated per
 * section (see index.css's `.prose-drop-cap` for exactly what it draws). */
export function MdProse({ text, className = "", dropCap = false }) {
  return (
    <div className={dropCap ? `prose-drop-cap ${className}` : className}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={PROSE}>
        {unescapeMd(text)}
      </ReactMarkdown>
    </div>
  );
}

export default MdSnippet;
