// Advanced Search — UI/UX Polish, Issue 3. Collapsed by default, expands into
// a panel of discrete controls that WRITE the exact same advanced query text
// `searchQuery.js` already parses (AND/OR/NOT/field:value) — no second query
// engine, no backend change. Controls with no real backend/data support
// (semantic/heading-only/definitions-only/examples-only/date) render VISIBLY
// but disabled, per the phase's own "disable gracefully" instruction, rather
// than being hidden (hiding would look like a bug, not a documented gap).
import { Icon } from "../ui/Icon";

const Chip = ({ children, onClick, title, active }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className="px-2 py-1 rounded-[6px] border text-[11.5px] transition-colors"
    style={active
      ? { borderColor: "var(--accent)", color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 8%, transparent)" }
      : { borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
  >
    {children}
  </button>
);

const Disabled = ({ children, title }) => (
  <span
    title={title || "Chưa hỗ trợ ở backend"}
    aria-disabled="true"
    className="px-2 py-1 rounded-[6px] border text-[11.5px] opacity-40 cursor-not-allowed select-none"
    style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
  >
    {children}
  </span>
);

export default function AdvancedSearchPanel({
  expanded, onToggle, onInsertToken, onExactPhrase,
  scope, onScopeChange, currentDocLabel,
  tags, collections, onPickTag, onPickCollection,
}) {
  return (
    <div className="border-b border-border flex-shrink-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls="advanced-search-panel"
        className="w-full flex items-center gap-1.5 px-4 py-2 text-[11.5px] text-text-secondary hover:text-text-primary"
      >
        <Icon name="Filter" size={12} />
        Tìm nâng cao
        <Icon name="ChevronDown" size={12} className={expanded ? "ml-auto rotate-180 transition-transform" : "ml-auto transition-transform"} />
      </button>

      {expanded && (
        <div id="advanced-search-panel" className="px-4 pb-3 flex flex-col gap-3">
          {/* Toán tử — chèn thẳng vào cú pháp nâng cao đã có, không phải ngôn ngữ truy vấn thứ hai */}
          <div>
            <div className="text-[10.5px] font-mono uppercase tracking-[0.1em] text-text-muted mb-1.5">Toán tử</div>
            <div className="flex flex-wrap gap-1.5">
              <Chip onClick={() => onInsertToken("AND")}>AND</Chip>
              <Chip onClick={() => onInsertToken("OR")}>OR</Chip>
              <Chip onClick={() => onInsertToken("NOT")}>NOT</Chip>
              <Chip onClick={onExactPhrase} title='Bọc từ khoá trong dấu ngoặc kép để tìm đúng cụm'>"Cụm chính xác"</Chip>
            </div>
          </div>

          {/* Phạm vi — LỌC THẬT trên dữ liệu thư viện đã tải, không cần endpoint mới */}
          <div>
            <div className="text-[10.5px] font-mono uppercase tracking-[0.1em] text-text-muted mb-1.5">Phạm vi</div>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={scope === "all"} onClick={() => onScopeChange("all")}>Tất cả tài liệu</Chip>
              {currentDocLabel ? (
                <Chip active={scope === "current"} onClick={() => onScopeChange("current")} title={currentDocLabel}>
                  Tài liệu hiện tại
                </Chip>
              ) : (
                <Disabled title="Chưa chọn tài liệu nào trong phiên học hiện tại">Tài liệu hiện tại</Disabled>
              )}
            </div>
          </div>

          {tags?.length > 0 && (
            <div>
              <div className="text-[10.5px] font-mono uppercase tracking-[0.1em] text-text-muted mb-1.5">Thẻ</div>
              <div className="flex flex-wrap gap-1.5">
                {tags.slice(0, 8).map((t) => <Chip key={t} onClick={() => onPickTag(t)}>{t}</Chip>)}
              </div>
            </div>
          )}

          {collections?.length > 0 && (
            <div>
              <div className="text-[10.5px] font-mono uppercase tracking-[0.1em] text-text-muted mb-1.5">Bộ sưu tập</div>
              <div className="flex flex-wrap gap-1.5">
                {collections.slice(0, 8).map((c) => (
                  <Chip key={c.collection_id} onClick={() => onPickCollection(c.name)}>{c.name}</Chip>
                ))}
              </div>
            </div>
          )}

          {/* Chưa có dữ liệu/endpoint hỗ trợ — hiện RÕ nhưng khoá, không giả vờ hoạt động */}
          <div>
            <div className="text-[10.5px] font-mono uppercase tracking-[0.1em] text-text-muted mb-1.5">Cần dữ liệu AI sâu hơn</div>
            <div className="flex flex-wrap gap-1.5">
              <Disabled>Tìm ngữ nghĩa</Disabled>
              <Disabled>Chỉ tiêu đề</Disabled>
              <Disabled>Chỉ định nghĩa</Disabled>
              <Disabled>Chỉ ví dụ</Disabled>
              <Disabled title="Thư viện chưa lọc theo ngày">Ngày</Disabled>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
