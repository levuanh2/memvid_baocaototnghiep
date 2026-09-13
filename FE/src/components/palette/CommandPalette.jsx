import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../ui/Modal";
import { Icon } from "../ui/Icon";
import { useAuth } from "../../auth/useAuth";
import { useStudyContext } from "../../study/useStudyContext";
import { useOpenSurface } from "../../study/useOpenSurface";
import AdvancedSearchPanel from "./AdvancedSearchPanel";
import { getLibrary } from "../../utils/studyApi";
import { OPEN_EVENT } from "../../utils/commandPaletteBus";
import { tenHienThi, sapXep } from "../../utils/thuVienTaiLieu";
import { tiepTucHoc } from "../../utils/tiepTucHoc";
import { timKiemToanCuc } from "../../utils/paletteSearch";
import { phimBang } from "../../utils/paletteKeyboard";
import { docLichSu, ghiLichSu, themTimKiem, themLenh } from "../../utils/commandHistory";

/**
 * Command Palette toàn cục (Phase 7). Ctrl+K/⌘K mở từ BẤT KỲ trang nào trong
 * `/app/*`. Dữ liệu tài liệu/bộ sưu tập tải lại mỗi lần MỞ qua `getLibrary()` —
 * ĐÚNG endpoint `/api/library` mọi trang khác đã dùng, không có tầng cache dùng
 * chung nào ở đây: không component nào trong app này giữ một bản sao sống lâu
 * của `documents` (không Redux, không React Query) — palette theo đúng quy ước
 * đó thay vì tự bịa một tầng đồng bộ hai chiều với DocumentList.jsx.
 *
 * Điều hướng THẬT dùng chung `useOpenSurface()` — CHÍNH hook DocumentList.jsx
 * cũng gọi (xem study/useOpenSurface.js). Không có đường điều hướng thứ hai.
 */

const DANH_SACH_LENH = [
  { id: "tai-len", nhan: "Tải tài liệu", icon: "Upload", moTa: "Mở Thư viện học tập để tải lên" },
  { id: "tao-bo-suu-tap", nhan: "Tạo bộ sưu tập", icon: "FolderOpen", moTa: "Mở Thư viện học tập để tạo" },
  { id: "tiep-tuc-hoc", nhan: "Tiếp tục học", icon: "ArrowRight", moTa: "Về đúng chỗ tài liệu gần nhất đang dở" },
  { id: "mo-gia-su", nhan: "Mở Gia sư AI", icon: "Sparkles", moTa: "Vào Workspace — Ctrl+/ mở Gia sư AI ở đó" },
  { id: "mo-phan-tich", nhan: "Xem phân tích học tập", icon: "TrendingDown", moTa: "Mở Thư viện học tập — mục Tổng quan học tập" },
];

// Bề mặt mở nhanh trên MỘT kết quả tài liệu — đúng bốn khoá `duongDi()` thật đã
// hỗ trợ (BE_MAT trong tiepTucHoc.js), KHÔNG thêm khoá nào mới.
const BE_MAT_NHANH = [
  { khoa: "summary", nhan: "Tóm tắt", icon: "ScrollText" },
  { khoa: "mindmap", nhan: "Sơ đồ tư duy", icon: "Network" },
  { khoa: "studymap", nhan: "Bản đồ học tập", icon: "Spline" },
  { khoa: "quiz", nhan: "Quiz", icon: "BadgeCheck" },
  { khoa: "review", nhan: "Ôn tập", icon: "BookOpen" },
];

function Muc({ chinh, phu, icon, lyDo, coGhim, coYeuThich, hoatDong, onClick, onMouseEnter, refEl }) {
  return (
    <button
      ref={refEl}
      type="button"
      role="option"
      aria-selected={hoatDong}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left rounded-[8px]"
      style={hoatDong
        ? { background: "color-mix(in srgb, var(--accent) 10%, transparent)" }
        : { background: "transparent" }}
    >
      <Icon name={icon} size={16} className="shrink-0 text-text-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-body text-text-primary truncate">{chinh}</span>
          {coGhim && <Icon name="Pin" size={11} className="shrink-0 text-forest" />}
          {coYeuThich && <Icon name="Star" size={11} className="shrink-0 text-forest" />}
        </div>
        {phu && <div className="text-caption text-text-muted truncate">{phu}</div>}
      </div>
      {/* Lý do khớp — Step 7: PHẢI hiện thật, không suy diễn/giả vờ một điểm số
          tương đồng nào. `lyDo` luôn là nhãn từ `universalSearch.js::lyDoKhop`
          hoặc chuỗi phụ ("Lọc theo bộ sưu tập này"…), không phải trang trí. */}
      {lyDo && (
        <span className="shrink-0 font-mono text-metadata uppercase tracking-wide text-text-muted">{lyDo}</span>
      )}
    </button>
  );
}

function TieuDeNhom({ children }) {
  return (
    <div className="px-4 pt-3 pb-1 font-mono text-metadata uppercase text-text-muted">
      {children}
    </div>
  );
}

// UI/UX Polish Issue 2 — Study Workspace needs a VISIBLE, discoverable search
// entry point (not just Ctrl+K). CommandPalette is a single global instance
// (mounted once in App.jsx, lazy-loaded) with no external control today;
// rather than lift its `open` state (would mean prop-drilling a global
// singleton through the whole route tree, or a new state library — neither
// justified for one button), any component can ask it to open via the
// `OPEN_EVENT` DOM CustomEvent in `utils/commandPaletteBus.js` — a plain
// module so callers don't have to statically import (and defeat the lazy
// chunk of) this file just to open it.
const KHOA_MO_RONG = "memvidx.palette.advanced.v1"; // nhớ trạng thái mở/đóng panel nâng cao

export default function CommandPalette() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const moTheoDoi = useOpenSurface();
  const { selectedDocument } = useStudyContext();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [documents, setDocuments] = useState([]);
  const [collections, setCollections] = useState([]);
  const [dangTai, setDangTai] = useState(false);
  const [chiSo, setChiSo] = useState(0);
  const [lichSu, setLichSu] = useState(() => docLichSu(typeof window === "undefined" ? null : window.localStorage));
  const [moRong, setMoRong] = useState(() => {
    try { return typeof window !== "undefined" && window.localStorage.getItem(KHOA_MO_RONG) === "1"; }
    catch { return false; }
  });
  const [scope, setScope] = useState("all"); // "all" | "current" — Issue 3 phạm vi tìm
  const inputRef = useRef(null);

  // Ctrl+K / ⌘K mở hoặc đóng, từ bất kỳ đâu trong app đã đăng nhập. Không phím
  // tắt nào khác được lắng nghe ở tầng này — Escape/mũi tên/Enter là việc của
  // `phimBang` bên trong hộp thoại, đã mở thì bàn phím phải trong tầm với.
  useEffect(() => {
    if (!user) return;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onExternalOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onExternalOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onExternalOpen);
    };
  }, [user]);

  const toggleMoRong = useCallback(() => {
    setMoRong((v) => {
      const next = !v;
      try { window.localStorage.setItem(KHOA_MO_RONG, next ? "1" : "0"); } catch { /* riêng tư/đầy — bỏ qua */ }
      return next;
    });
  }, []);

  const chenToanTu = useCallback((tu) => {
    setQuery((q) => (q.trim() ? `${q.trim()} ${tu} ` : `${tu} `));
    inputRef.current?.focus();
  }, []);
  const cumChinhXac = useCallback(() => {
    setQuery((q) => {
      const t = q.trim();
      if (!t || (t.startsWith('"') && t.endsWith('"'))) return q;
      return `"${t}"`;
    });
    inputRef.current?.focus();
  }, []);

  const taiLieuHienTaiTen = useMemo(() => {
    if (!selectedDocument) return null;
    const d = documents.find((x) => x.document_id === selectedDocument);
    return d ? tenHienThi(d) : null;
  }, [selectedDocument, documents]);

  // Phạm vi "Tài liệu hiện tại" — LỌC trên dữ liệu thư viện đã tải sẵn (Issue 3),
  // không phải một truy vấn mới: mọi thứ dưới đây vẫn chạy qua CHÍNH
  // `timKiemToanCuc` như trước.
  const phamViDocuments = useMemo(() => (
    scope === "current" && selectedDocument
      ? documents.filter((d) => d.document_id === selectedDocument)
      : documents
  ), [scope, selectedDocument, documents]);

  // Tải thư viện MỖI LẦN mở — không tin một bản nhớ từ lần mở trước, tài liệu có
  // thể đã đổi (đổi tên, ghim, upload mới) ở một trang khác trong lúc đóng.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setChiSo(0);
    setScope("all");
    setDangTai(true);
    getLibrary({ kemBoSuuTap: true })
      .then(({ documents: ds, collections: cs }) => { setDocuments(ds); setCollections(cs); })
      .catch(() => { setDocuments([]); setCollections([]); })
      .finally(() => setDangTai(false));
  }, [open]);

  const dong = useCallback(() => setOpen(false), []);

  const ketQua = useMemo(() => {
    const q = query.trim();
    if (!q) return { documents: [], collections: [], topics: [], entities: [] };
    return timKiemToanCuc(phamViDocuments, collections, q, { gioiHan: 6 });
  }, [phamViDocuments, collections, query]);

  const theTanSo = useMemo(() => {
    const seen = new Set();
    for (const d of documents) for (const t of (d.tags || [])) seen.add(t);
    return [...seen];
  }, [documents]);

  const danhSachLenhLoc = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DANH_SACH_LENH;
    return DANH_SACH_LENH.filter((l) => l.nhan.toLowerCase().includes(q));
  }, [query]);

  const dangRong = !query.trim();

  // ── Dồn mọi nhóm thành MỘT mảng phẳng — điều hướng bàn phím không cần biết
  // "nhóm" là gì, chỉ cần một chỉ số duy nhất. ─────────────────────────────
  const dsPhang = useMemo(() => {
    if (dangRong) {
      const gd = lichSu.timKiem.map((q) => ({ loai: "lich_su_tim", key: `lt-${q}`, q }));
      const gl = lichSu.lenh.map((l) => ({ loai: "lich_su_lenh", key: `ll-${l.id}`, ...l }));
      return [...gd, ...gl, ...DANH_SACH_LENH.map((l) => ({ loai: "lenh", key: `c-${l.id}`, ...l }))];
    }
    return [
      ...ketQua.documents.map((r) => ({ loai: "tai_lieu", key: `d-${r.doc.document_id}`, ...r })),
      ...ketQua.collections.map((c) => ({ loai: "bo_suu_tap", key: `bst-${c.collection_id}`, ...c })),
      ...ketQua.topics.map((t) => ({ loai: "chu_de", key: `t-${t.ten}`, ...t })),
      ...ketQua.entities.map((e) => ({ loai: "thuc_the", key: `e-${e.ten}`, ...e })),
      ...danhSachLenhLoc.map((l) => ({ loai: "lenh", key: `c-${l.id}`, ...l })),
    ];
  }, [dangRong, ketQua, danhSachLenhLoc, lichSu]);

  useEffect(() => { setChiSo((c) => Math.min(c, Math.max(0, dsPhang.length - 1))); }, [dsPhang.length]);

  // ── Kích hoạt một mục ──────────────────────────────────────────────────
  const luuLichSu = useCallback((moiState) => {
    setLichSu(moiState);
    ghiLichSu(typeof window === "undefined" ? null : window.localStorage, moiState);
  }, []);

  const moTaiLieu = useCallback((doc, khoa) => {
    moTheoDoi(doc, khoa || doc.last_workspace || "studymap");
    if (query.trim()) luuLichSu(themTimKiem(lichSu, query.trim()));
    dong();
  }, [moTheoDoi, query, lichSu, luuLichSu, dong]);

  const chayLenh = useCallback((lenh) => {
    luuLichSu(themLenh(lichSu, lenh.id, lenh.nhan));
    switch (lenh.id) {
      case "tai-len":
      case "tao-bo-suu-tap":
      case "mo-phan-tich":
        navigate("/app/study");
        break;
      case "mo-gia-su":
        navigate("/app");
        break;
      case "tiep-tuc-hoc": {
        const gioiHan = sapXep(documents.filter((d) => d.last_opened_at), "recently_opened")[0];
        if (!gioiHan) { navigate("/app/study"); break; }
        const resume = tiepTucHoc(gioiHan);
        moTheoDoi(gioiHan, resume?.beMat || gioiHan.last_workspace || "studymap");
        break;
      }
      default:
        break;
    }
    dong();
  }, [navigate, documents, moTheoDoi, lichSu, luuLichSu, dong]);

  /** Chủ đề/Thực thể/Bộ sưu tập KHÔNG điều hướng đi đâu — không có đích thật
   * nào để về (DocumentList.jsx không đọc tham số URL để tự chọn sẵn một bộ
   * lọc). Thay vào đó THU HẸP truy vấn ngay tại đây bằng đúng cú pháp nâng cao
   * đã có (searchQuery.js) — người dùng thấy NGAY những tài liệu khớp, không
   * một đường dẫn giả. */
  const locTheo = useCallback((field, ten) => {
    setQuery(`${field}:"${ten}"`);
    inputRef.current?.focus();
  }, []);

  const kichHoat = useCallback((muc) => {
    if (!muc) return;
    if (muc.loai === "tai_lieu") return moTaiLieu(muc.doc);
    if (muc.loai === "bo_suu_tap") return locTheo("collection", muc.name);
    if (muc.loai === "chu_de") return locTheo("topic", muc.ten);
    if (muc.loai === "thuc_the") return locTheo("entity", muc.ten);
    if (muc.loai === "lenh") return chayLenh(muc);
    if (muc.loai === "lich_su_tim") return setQuery(muc.q);
    if (muc.loai === "lich_su_lenh") {
      const lenh = DANH_SACH_LENH.find((l) => l.id === muc.id);
      return lenh ? chayLenh(lenh) : undefined;
    }
  }, [moTaiLieu, locTheo, chayLenh]);

  const onKeyDown = (e) => {
    const kq = phimBang(e, { chiSo, tongSo: dsPhang.length });
    if (!kq) return;
    e.preventDefault();
    if (kq.loai === "focus") setChiSo(kq.chiSo);
    else if (kq.loai === "kich_hoat") kichHoat(dsPhang[kq.chiSo]);
    else if (kq.loai === "dong") dong();
  };

  if (!user) return null;

  return (
    <Modal open={open} onClose={dong} fullBleed maxWidth={640}>
      <div className="flex flex-col" style={{ maxHeight: "72vh" }}>
        {/* Ô nhập — phần tử focus-được ĐẦU TIÊN trong hộp thoại, Modal.jsx tự
            đưa focus vào đây khi mở (xem ui/Modal.jsx). */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border flex-shrink-0">
          <Icon name="Search" size={16} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-ket-qua"
            aria-activedescendant={dsPhang[chiSo]?.key}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setChiSo(0); }}
            onKeyDown={onKeyDown}
            placeholder='Tìm tài liệu, chủ đề, lệnh… (thử topic:"CPU" AND has:quiz)'
            aria-label="Tìm kiếm toàn cục"
            className="flex-1 bg-transparent outline-none text-body text-text-primary placeholder:text-text-muted"
          />
          <kbd className="font-mono text-caption text-text-muted border border-border rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <AdvancedSearchPanel
          expanded={moRong} onToggle={toggleMoRong}
          onInsertToken={chenToanTu} onExactPhrase={cumChinhXac}
          scope={scope} onScopeChange={setScope} currentDocLabel={taiLieuHienTaiTen}
          tags={theTanSo} collections={collections}
          onPickTag={(t) => locTheo("tag", t)} onPickCollection={(c) => locTheo("collection", c)}
        />

        {/* Kết quả */}
        <div id="command-palette-ket-qua" role="listbox" aria-label="Kết quả tìm kiếm"
             className="flex-1 min-h-0 overflow-y-auto py-1.5">
          {dangTai && (
            <div className="px-4 py-8 text-center text-small text-text-muted">Đang tải thư viện…</div>
          )}

          {!dangTai && dangRong && dsPhang.length === 0 && (
            <div className="px-4 py-8 text-center text-small text-text-muted">
              Gõ để tìm tài liệu, chủ đề, thực thể, bộ sưu tập hoặc một lệnh.
            </div>
          )}

          {!dangTai && !dangRong && dsPhang.length === 0 && (
            <div className="px-4 py-8 text-center text-small text-text-muted">
              Không có kết quả nào khớp “{query}”.
            </div>
          )}

          {!dangTai && dangRong && (lichSu.timKiem.length > 0 || lichSu.lenh.length > 0) && (
            <TieuDeNhom>Gần đây</TieuDeNhom>
          )}
          {!dangTai && dangRong && lichSu.timKiem.map((q, i) => (
            <Muc key={`lt-${q}`} icon="Clock" chinh={q} hoatDong={chiSo === i}
                 onMouseEnter={() => setChiSo(i)} onClick={() => kichHoat({ loai: "lich_su_tim", q })} />
          ))}
          {!dangTai && dangRong && lichSu.lenh.map((l, i) => (
            <Muc key={`ll-${l.id}`} icon="Clock" chinh={l.label} phu="Lệnh gần đây"
                 hoatDong={chiSo === lichSu.timKiem.length + i}
                 onMouseEnter={() => setChiSo(lichSu.timKiem.length + i)}
                 onClick={() => kichHoat({ loai: "lich_su_lenh", id: l.id })} />
          ))}

          {!dangTai && !dangRong && ketQua.documents.length > 0 && (
            <>
              <TieuDeNhom>Tài liệu</TieuDeNhom>
              {ketQua.documents.map((r, i) => {
                const idx = i;
                const hoatDong = chiSo === idx;
                return (
                  <div key={r.doc.document_id}>
                    <Muc icon="FileText" chinh={tenHienThi(r.doc)} lyDo={r.lyDo}
                         coGhim={r.doc.pinned} coYeuThich={r.doc.favorite}
                         hoatDong={hoatDong} onMouseEnter={() => setChiSo(idx)}
                         onClick={() => moTaiLieu(r.doc)} />
                    {hoatDong && (
                      <div className="flex flex-wrap gap-1 px-4 pb-2 pl-11">
                        {BE_MAT_NHANH.map((b) => (
                          <button key={b.khoa} type="button" className="pill-action !text-caption !py-0.5"
                                  onClick={(e) => { e.stopPropagation(); moTaiLieu(r.doc, b.khoa); }}>
                            <Icon name={b.icon} size={11} /> {b.nhan}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {!dangTai && !dangRong && ketQua.collections.length > 0 && (
            <>
              <TieuDeNhom>Bộ sưu tập</TieuDeNhom>
              {ketQua.collections.map((c, i) => {
                const idx = ketQua.documents.length + i;
                return (
                  <Muc key={c.collection_id} icon="FolderOpen" chinh={c.name} phu="Lọc theo bộ sưu tập này"
                       hoatDong={chiSo === idx} onMouseEnter={() => setChiSo(idx)}
                       onClick={() => locTheo("collection", c.name)} />
                );
              })}
            </>
          )}

          {!dangTai && !dangRong && ketQua.topics.length > 0 && (
            <>
              <TieuDeNhom>Chủ đề</TieuDeNhom>
              {ketQua.topics.map((t, i) => {
                const idx = ketQua.documents.length + ketQua.collections.length + i;
                return (
                  <Muc key={t.ten} icon="Tag" chinh={t.ten} phu={`${t.soTaiLieu} tài liệu`}
                       hoatDong={chiSo === idx} onMouseEnter={() => setChiSo(idx)}
                       onClick={() => locTheo("topic", t.ten)} />
                );
              })}
            </>
          )}

          {!dangTai && !dangRong && ketQua.entities.length > 0 && (
            <>
              <TieuDeNhom>Thực thể</TieuDeNhom>
              {ketQua.entities.map((e, i) => {
                const idx = ketQua.documents.length + ketQua.collections.length + ketQua.topics.length + i;
                return (
                  <Muc key={e.ten} icon="Sparkles" chinh={e.ten} phu={`${e.soTaiLieu} tài liệu`}
                       hoatDong={chiSo === idx} onMouseEnter={() => setChiSo(idx)}
                       onClick={() => locTheo("entity", e.ten)} />
                );
              })}
            </>
          )}

          {!dangTai && !dangRong && danhSachLenhLoc.length > 0 && (
            <>
              <TieuDeNhom>Lệnh</TieuDeNhom>
              {danhSachLenhLoc.map((l, i) => {
                const idx = ketQua.documents.length + ketQua.collections.length + ketQua.topics.length
                  + ketQua.entities.length + i;
                return (
                  <Muc key={l.id} icon={l.icon} chinh={l.nhan} phu={l.moTa}
                       hoatDong={chiSo === idx} onMouseEnter={() => setChiSo(idx)}
                       onClick={() => chayLenh(l)} />
                );
              })}
            </>
          )}
        </div>

        {/* Gợi ý bàn phím — cố định đáy */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border flex-shrink-0 font-mono text-caption text-text-muted">
          <span>↑↓ chọn</span>
          <span>↵ mở</span>
          <span>Esc đóng</span>
          <span className="ml-auto">Ctrl+K</span>
        </div>
      </div>
    </Modal>
  );
}
