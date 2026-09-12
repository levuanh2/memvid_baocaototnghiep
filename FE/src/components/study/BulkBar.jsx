import { useState } from "react";
import { Icon } from "../ui/Icon";
import { HANH_DONG, CAN_XAC_NHAN, thongBaoDaChon } from "../../utils/chonNhieu";

/**
 * Thanh thao tác hàng loạt — hiện khi đã chọn ít nhất một tài liệu.
 *
 * Không có hành động AI ở đây, và đó là một quyết định: sinh tóm tắt cho 200 tài
 * liệu một lúc là câu chuyện về chi phí và hàng đợi, không phải một mục trong
 * thanh công cụ.
 *
 * `aria-live` thông báo số đã chọn để người dùng trình đọc màn hình biết thanh này
 * vừa xuất hiện và đang nói về bao nhiêu tài liệu.
 */
export default function BulkBar({ so, boSuuTap, onHanhDong, onXoaChon, dangChay }) {
  const [moChuyen, setMoChuyen] = useState(false);
  const [moThe, setMoThe] = useState(null);     // "add_tags" | "remove_tags"
  const [nhapThe, setNhapThe] = useState("");

  if (!so) return null;

  const chay = (khoa, kem) => {
    if (CAN_XAC_NHAN.has(khoa)
        && !window.confirm(`Xoá ${so} tài liệu? Thao tác này ẩn chúng khỏi thư viện.`)) {
      return;
    }
    setMoChuyen(false);
    setMoThe(null);
    setNhapThe("");
    onHanhDong(khoa, kem);
  };

  const guiThe = () => {
    const tags = nhapThe.split(",").map((t) => t.trim()).filter(Boolean);
    if (!tags.length) return;
    chay(moThe, { tags });
  };

  const nut = (khoa) => {
    const h = HANH_DONG.find((x) => x.khoa === khoa);
    return (
      <button key={khoa} type="button" disabled={dangChay}
              onClick={() => chay(khoa)}
              className="pill-action disabled:opacity-50"
              style={h.nguyHiem ? { color: "var(--err)" } : undefined}>
        <Icon name={h.icon} size={13} /> {h.nhan}
      </button>
    );
  };

  return (
    <div className="sticky top-2 z-30 mb-4 surface-card !p-3 flex flex-wrap items-center gap-2"
         style={{ borderColor: "var(--accent)" }}>
      <span aria-live="polite" className="text-[13px] font-semibold text-text-primary">
        {thongBaoDaChon(so)}
      </span>

      <div className="flex flex-wrap items-center gap-1.5 flex-1">
        {["pin", "favorite", "archive"].map(nut)}

        <div className="relative">
          <button type="button" disabled={dangChay} onClick={() => { setMoThe(null); setMoChuyen((v) => !v); }}
                  className="pill-action disabled:opacity-50" aria-expanded={moChuyen}>
            <Icon name="FolderOpen" size={13} /> Chuyển
          </button>
          {moChuyen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMoChuyen(false)} />
              <div className="absolute left-0 top-9 z-20 min-w-[180px] max-h-[240px] overflow-y-auto
                              rounded-[8px] py-1 shadow-card-hover"
                   style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}>
                <button type="button"
                        onClick={() => chay("move_collection", { collectionId: null })}
                        className="w-full px-3 py-1.5 text-left text-[12.5px] text-text-secondary
                                   hover:bg-surface-elevated">
                  Bỏ khỏi bộ sưu tập
                </button>
                {boSuuTap.map((c) => (
                  <button key={c.collection_id} type="button"
                          onClick={() => chay("move_collection", { collectionId: c.collection_id })}
                          className="w-full px-3 py-1.5 text-left text-[12.5px] text-text-primary
                                     hover:bg-surface-elevated truncate">
                    {c.name}
                  </button>
                ))}
                {boSuuTap.length === 0 && (
                  <p className="px-3 py-1.5 text-[12px] text-text-muted">
                    Chưa có bộ sưu tập nào.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button type="button" disabled={dangChay}
                  onClick={() => { setMoChuyen(false); setMoThe((v) => (v ? null : "add_tags")); }}
                  className="pill-action disabled:opacity-50" aria-expanded={Boolean(moThe)}>
            <Icon name="Tag" size={13} /> Thẻ
          </button>
          {moThe && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMoThe(null)} />
              <div className="absolute left-0 top-9 z-20 w-[240px] rounded-[8px] p-2.5 shadow-card-hover"
                   style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}>
                <div className="flex gap-1 mb-2">
                  {[["add_tags", "Gắn"], ["remove_tags", "Bỏ"]].map(([k, n]) => (
                    <button key={k} type="button" onClick={() => setMoThe(k)}
                            aria-pressed={moThe === k}
                            className={moThe === k ? "btn-seal !py-1 !text-[12px]"
                              : "btn-secondary !py-1 !text-[12px]"}>
                      {n}
                    </button>
                  ))}
                </div>
                <input
                  autoFocus value={nhapThe}
                  onChange={(e) => setNhapThe(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); guiThe(); }
                    if (e.key === "Escape") { e.preventDefault(); setMoThe(null); }
                  }}
                  placeholder="AI, Exam"
                  aria-label="Thẻ, cách nhau bằng dấu phẩy"
                  className="w-full rounded-control px-2 py-1 text-[12.5px] outline-none"
                  style={{ background: "var(--bg-sidebar)", color: "var(--text-primary)",
                           border: "1px solid var(--border-color)" }}
                />
                <p className="mt-1 text-[11px] text-text-muted">
                  Cách nhau bằng dấu phẩy. Enter để áp dụng.
                </p>
              </div>
            </>
          )}
        </div>

        {nut("delete")}
      </div>

      <button type="button" onClick={onXoaChon} className="btn-secondary !py-1.5 !text-[12.5px]">
        Bỏ chọn
      </button>
    </div>
  );
}
