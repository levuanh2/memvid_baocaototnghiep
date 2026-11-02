import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { hexMau, MAU, kiemTraTenBoSuuTap } from "../../utils/boSuuTap";
import { KHONG_PHAN_LOAI } from "../../utils/thuVienTaiLieu";

/**
 * Thanh bên thư viện — PHẲNG, không cây.
 *
 * Không có cha-con và cố ý: cây thư mục là thứ Phase 1A bỏ công tránh, và một cây
 * hai tầng chỉ dời câu hỏi "cái này nằm ở đâu" xuống một tầng nữa.
 *
 * Bốn nhóm: Bộ sưu tập · Thẻ · Lối tắt (Yêu thích/Ghim) · Lưu trữ. Nhóm nào rỗng
 * thì không dựng — một danh sách thẻ trống chỉ thêm nhiễu.
 *
 * Đây KHÔNG phải `SidebarLeft` của Workspace: chỗ này chọn để LỌC, chỗ kia chọn để
 * đặt phạm vi câu hỏi. Hai nghĩa khác nhau nên hai component khác nhau.
 */

function MucLoc({ nhan, so, dangChon, mau, icon, onClick, onSua, collectionId }) {
  return (
    <div className="group flex items-center gap-1">
      <button
        type="button"
        data-collection-id={collectionId}
        onClick={onClick}
        aria-pressed={dangChon}
        className="flex-1 min-w-0 flex items-center gap-2 rounded-control px-2 py-1.5 text-left
                   transition-theme hover:bg-surface-elevated"
        style={dangChon ? { background: "var(--bg-elevated)" } : undefined}
      >
        {mau
          ? <span aria-hidden className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: mau }} />
          : <Icon name={icon || "Tag"} size={13} className="text-text-muted shrink-0" />}
        <span className="flex-1 min-w-0 truncate text-small text-text-primary">{nhan}</span>
        {so != null && (
          <span className="font-mono text-caption text-text-muted shrink-0">{so}</span>
        )}
      </button>
      {onSua && (
        <button type="button" onClick={onSua}
                aria-label={`Sửa ${nhan}`}
                className="icon-btn w-6 h-6 opacity-0 group-hover:opacity-100
                           focus-visible:opacity-100 shrink-0">
          <Icon name="Pencil" size={12} />
        </button>
      )}
    </div>
  );
}

function Nhom({ tieuDe, children, hanhDong }) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between px-2 mb-1">
        <span className="font-mono text-metadata uppercase text-text-muted">
          {tieuDe}
        </span>
        {hanhDong}
      </div>
      {children}
    </div>
  );
}

/** Form tạo/sửa bộ sưu tập. Enter lưu, Esc huỷ — cùng quy ước với đổi tên tài liệu. */
function FormBoSuuTap({ ban_dau, onLuu, onHuy, onXoa }) {
  const [ten, setTen] = useState(ban_dau?.name || "");
  const [mau, setMau] = useState(ban_dau?.color || MAU[0].khoa);
  const [loi, setLoi] = useState(null);

  const gui = () => {
    const kq = kiemTraTenBoSuuTap(ten, ban_dau?.name ?? null);
    if (kq.khongDoi && mau === (ban_dau?.color || MAU[0].khoa)) return onHuy();
    if (!kq.hopLe && !kq.khongDoi) return setLoi(kq.loi);
    onLuu({ name: kq.giaTri || ten.trim(), color: mau });
  };

  return (
    <div className="px-2 py-2 rounded-[7px] mb-2"
         style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}>
      <input
        autoFocus value={ten}
        onChange={(e) => { setTen(e.target.value); setLoi(null); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); gui(); }
          if (e.key === "Escape") { e.preventDefault(); onHuy(); }
        }}
        placeholder="Tên bộ sưu tập"
        aria-label="Tên bộ sưu tập"
        className="w-full bg-transparent outline-none text-small text-text-primary
                   placeholder:text-text-muted"
      />
      <div className="flex flex-wrap gap-1 mt-2">
        {MAU.map((m) => (
          <button key={m.khoa} type="button" onClick={() => setMau(m.khoa)}
                  aria-label={m.nhan} aria-pressed={mau === m.khoa}
                  className="w-4 h-4 rounded-full transition-theme"
                  style={{ background: m.hex,
                           outline: mau === m.khoa ? "2px solid var(--text-primary)" : "none",
                           outlineOffset: "1px" }} />
        ))}
      </div>
      {loi && <p role="alert" className="mt-1 text-caption" style={{ color: "var(--err)" }}>{loi}</p>}
      <div className="flex items-center gap-1.5 mt-2">
        <button type="button" onClick={gui} className="btn-seal !py-1 !text-small">Lưu</button>
        <button type="button" onClick={onHuy} className="btn-secondary !py-1 !text-small">Huỷ</button>
        {onXoa && (
          <button type="button" onClick={onXoa}
                  className="ml-auto text-caption" style={{ color: "var(--err)" }}>
            Xoá
          </button>
        )}
      </div>
    </div>
  );
}

export default function CollectionSidebar({
  boSuuTap, chuaPhanLoai, the, chon, onChon, onTao, onSua, onXoa,
  hienLuuTru, onHienLuuTru,
}) {
  const [dangTao, setDangTao] = useState(false);
  const [dangSua, setDangSua] = useState(null);
  const rootRef = useRef(null);
  const idsTruocRef = useRef([]);

  // The collection being edited vanished from the list: it was deleted, so its
  // form and "Xoá" button are gone and Modal had nothing to return focus to.
  // Only then (never while the DELETE is in flight or after a failure, when the
  // list is unchanged) move focus to the next collection, the previous one, or
  // the create button — and only if focus was actually lost to <body>.
  useEffect(() => {
    const ids = boSuuTap.map((c) => c.collection_id);
    const truoc = idsTruocRef.current;
    idsTruocRef.current = ids;
    if (!dangSua || ids.includes(dangSua)) return;
    setDangSua(null);
    if (document.activeElement && document.activeElement !== document.body) return;
    const i = truoc.indexOf(dangSua);
    const keTiep = i >= 0 ? (ids[i] ?? ids[i - 1]) : null;
    const dich = keTiep
      ? rootRef.current?.querySelector(`[data-collection-id="${keTiep}"]`)
      : rootRef.current?.querySelector('[aria-label="Tạo bộ sưu tập"]');
    dich?.focus();
  }, [boSuuTap, dangSua]);

  const dangChon = chon || {};
  const chonBst = (id) => onChon({ ...dangChon, collectionId: dangChon.collectionId === id ? null : id, tags: dangChon.tags });
  const chonThe = (t) => {
    const co = (dangChon.tags || []).includes(t);
    onChon({
      ...dangChon,
      tags: co ? (dangChon.tags || []).filter((x) => x !== t) : [...(dangChon.tags || []), t],
    });
  };

  return (
    <aside ref={rootRef} className="w-[210px] shrink-0 hidden lg:block" aria-label="Bộ lọc thư viện">
      <div className="sticky top-4">
        <Nhom
          tieuDe="Bộ sưu tập"
          hanhDong={
            <button type="button" onClick={() => { setDangSua(null); setDangTao(true); }}
                    className="icon-btn w-6 h-6" aria-label="Tạo bộ sưu tập">
              <Icon name="Plus" size={13} />
            </button>
          }
        >
          {dangTao && (
            <FormBoSuuTap
              onLuu={(v) => { setDangTao(false); onTao(v); }}
              onHuy={() => setDangTao(false)}
            />
          )}
          {boSuuTap.map((c) => (
            dangSua === c.collection_id ? (
              <FormBoSuuTap
                key={c.collection_id}
                ban_dau={c}
                onLuu={(v) => { setDangSua(null); onSua(c, v); }}
                onHuy={() => setDangSua(null)}
                // Keep the form (and its delete button) mounted while the confirm dialog is
                // open, so cancelling returns focus to the button instead of <body>.
                onXoa={() => onXoa(c)}
              />
            ) : (
              <MucLoc
                key={c.collection_id}
                collectionId={c.collection_id}
                nhan={c.name}
                so={c.hien_thi_count}
                mau={hexMau(c.color)}
                dangChon={dangChon.collectionId === c.collection_id}
                onClick={() => chonBst(c.collection_id)}
                onSua={() => { setDangTao(false); setDangSua(c.collection_id); }}
              />
            )
          ))}
          {chuaPhanLoai > 0 && (
            <MucLoc
              nhan="Chưa phân loại" so={chuaPhanLoai} icon="FolderOpen"
              dangChon={dangChon.collectionId === KHONG_PHAN_LOAI}
              onClick={() => chonBst(KHONG_PHAN_LOAI)}
            />
          )}
          {boSuuTap.length === 0 && !dangTao && (
            <p className="px-2 text-caption text-text-muted">
              Chưa có bộ sưu tập. Nhóm các tài liệu cùng một môn để tìm lại nhanh hơn.
            </p>
          )}
        </Nhom>

        {the.length > 0 && (
          <Nhom tieuDe="Thẻ">
            {the.slice(0, 12).map((t) => (
              <MucLoc
                key={t.khoa} nhan={t.ten} so={t.so} icon="Tag"
                dangChon={(dangChon.tags || []).includes(t.ten)}
                onClick={() => chonThe(t.ten)}
              />
            ))}
          </Nhom>
        )}

        <Nhom tieuDe="Lối tắt">
          <MucLoc nhan="Yêu thích" icon="Star"
                  dangChon={(dangChon.khoa || []).includes("favorite")}
                  onClick={() => onChon({ ...dangChon, khoa: ["favorite"] })} />
          <MucLoc nhan="Đã ghim" icon="Pin"
                  dangChon={(dangChon.khoa || []).includes("pinned")}
                  onClick={() => onChon({ ...dangChon, khoa: ["pinned"] })} />
          <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer">
            <input type="checkbox" checked={hienLuuTru}
                   onChange={(e) => onHienLuuTru(e.target.checked)}
                   className="w-3.5 h-3.5 accent-accent rounded" />
            <span className="text-small text-text-primary">Hiện đã lưu trữ</span>
          </label>
        </Nhom>
      </div>
    </aside>
  );
}
