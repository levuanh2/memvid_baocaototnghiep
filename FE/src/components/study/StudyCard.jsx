import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { chipHienThi, READY, GENERATING } from "../../utils/trangThaiAi";
import { tenHienThi, thoiGianDoc, nhanThoiGianDoc } from "../../utils/thuVienTaiLieu";
import { tiepTucHoc } from "../../utils/tiepTucHoc";
import { kiemTraTen } from "../../utils/doiTen";
import { hexMau } from "../../utils/boSuuTap";
import { nhanOChon } from "../../utils/chonNhieu";
import { getQuestions, moTaLoi } from "../../utils/studyApi";
import KnowledgePanel from "./KnowledgePanel";

/**
 * Thẻ tài liệu của Thư viện học tập.
 *
 * Thứ bậc thị giác CỐ Ý: tên hiển thị → tên tệp (mờ, nhỏ) → **AI Overview là khối
 * chữ lớn nhất** → tóm tắt xem trước → chip trạng thái → siêu dữ liệu → hành động.
 * Thứ AI đã chuẩn bị đứng trên thứ người dùng đã tải lên; tên tệp không bao giờ
 * lấn át nội dung được sinh ra.
 *
 * Không có: ảnh thu nhỏ sơ đồ, và không có hành động "Mở tệp".
 *
 * Phase 1B thêm: huy hiệu bộ sưu tập, ô chọn để thao tác hàng loạt, và một dòng
 * hoạt động gần đây GỘP vào hàng siêu dữ liệu — không phải một khối riêng. Thẻ đã
 * mang bảy thông tin; thêm một khối nữa là biến nó thành bảng biểu.
 */

const MAU_CHIP = {
  [READY]: { bg: "var(--ok-bg)", fg: "var(--ok)" },
  [GENERATING]: { bg: "rgba(120,120,120,0.14)", fg: "var(--text-secondary)" },
};

function ChipAi({ chip }) {
  const dangChay = chip.trangThai === GENERATING;
  const sanSang = chip.trangThai === READY;
  const mau = MAU_CHIP[chip.trangThai];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-caption font-medium"
      style={mau
        ? { background: mau.bg, color: mau.fg }
        : { background: "transparent", color: "var(--text-muted)",
            border: "1px solid var(--border-color)" }}
    >
      {sanSang && <Icon name="Check" size={11} strokeWidth={2.5} />}
      {dangChay && <Icon name="Clock" size={11} />}
      {chip.nhan}{chip.soLuong ? ` (${chip.soLuong})` : ""}
    </span>
  );
}

/** Đổi tên tại chỗ: Enter lưu, Esc huỷ, bấm ra ngoài huỷ. */
function DoiTenTaiCho({ giaTriDau, dangLuu, onLuu, onHuy }) {
  const [nhap, setNhap] = useState(giaTriDau ?? "");
  const [loi, setLoi] = useState(null);
  const oRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    oRef.current?.focus();
    oRef.current?.select();
  }, []);

  // Bấm ra ngoài = HUỶ, không phải lưu. Lưu ngầm một giá trị người dùng chưa xác
  // nhận là đổi dữ liệu sau lưng họ.
  useEffect(() => {
    const ngoai = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) onHuy();
    };
    document.addEventListener("mousedown", ngoai);
    return () => document.removeEventListener("mousedown", ngoai);
  }, [onHuy]);

  const guiDi = () => {
    const kq = kiemTraTen(nhap, giaTriDau);
    if (kq.khongDoi) return onHuy();
    if (!kq.hopLe) return setLoi(kq.loi);
    onLuu(kq.giaTri);
  };

  return (
    <div ref={boxRef} className="min-w-0 flex-1">
      <input
        ref={oRef}
        value={nhap}
        disabled={dangLuu}
        onChange={(e) => { setNhap(e.target.value); setLoi(null); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); guiDi(); }
          if (e.key === "Escape") { e.preventDefault(); onHuy(); }
        }}
        aria-label="Tên hiển thị của tài liệu"
        className="w-full rounded-control px-2 py-1 text-body-lg font-semibold outline-none"
        style={{ background: "var(--bg-card)", color: "var(--text-primary)",
                 border: "1px solid var(--accent)" }}
      />
      <p className="mt-1 text-caption text-text-muted">
        {loi
          ? <span style={{ color: "var(--err)" }} role="alert">{loi}</span>
          : "Enter để lưu · Esc để huỷ · để trống để dùng lại tên tệp"}
      </p>
    </div>
  );
}

export default function StudyCard({
  doc, documents, chiMucBst, jobs, boSuuTap, dangDoiTen, dangLuu, onDoiTen, onLuuTen,
  onHuyDoiTen, onBatTat, onMo, daChon, onChon, tabIndex, onKeyDown, refThe,
  matDo = "comfortable",
}) {
  // Frontend V2, Library wave — density is a display variant only: same doc,
  // same props, same actions, just fewer of them rendered/visible at once.
  // Không đổi thứ bậc thị giác đã có (tên → AI Overview → …), chỉ rút gọn nó.
  const gon = matDo === "compact";
  const [menuMo, setMenuMo] = useState(false);
  const ten = tenHienThi(doc);
  const chips = chipHienThi(doc, jobs);
  const ai = doc.ai || {};
  const yChinh = Array.isArray(ai.summary?.ai_overview) ? ai.summary.ai_overview : [];
  const phut = thoiGianDoc(doc);
  const tiepTuc = tiepTucHoc(doc);
  const daIndex = ai.index === "ready";

  // Bảng tri thức (Phase 1C.2b). Cache và trạng thái tải sống Ở ĐÂY, không trong
  // KnowledgePanel — panel chỉ trình bày. `null` = chưa từng tải; `[]` = đã tải,
  // rỗng thật. Gập lại rồi mở ra dùng lại đúng cache này, không gọi lại mạng.
  const [moTriThuc, setMoTriThuc] = useState(false);
  const [daTungMo, setDaTungMo] = useState(false);
  const [cauHoi, setCauHoi] = useState(null);
  const [dangTaiCauHoi, setDangTaiCauHoi] = useState(false);
  const [loiCauHoi, setLoiCauHoi] = useState(null);

  // MỘT đường tải duy nhất — lần mở đầu tiên và nút "Thử lại" đều gọi đúng hàm này.
  const taiCauHoi = useCallback(() => {
    if (dangTaiCauHoi || cauHoi != null) return;
    setDangTaiCauHoi(true);
    setLoiCauHoi(null);
    getQuestions(doc.document_id)
      .then((ds) => setCauHoi(ds))
      .catch((err) => setLoiCauHoi(moTaLoi(err, "Không tải được câu hỏi gợi ý.")))
      .finally(() => setDangTaiCauHoi(false));
  }, [doc.document_id, dangTaiCauHoi, cauHoi]);

  // Đọc `moTriThuc` trực tiếp từ closure của lần render này, KHÔNG qua hàm cập
  // nhật của setState: đây là handler bấm nút (một sự kiện rời rạc, không phải
  // effect), nên closure luôn đúng. Gọi `taiCauHoi()` — một tác dụng phụ mạng —
  // bên trong hàm cập nhật của setState là sai: StrictMode gọi hàm đó hai lần ở
  // môi trường dev, và lần gọi thứ hai chạy TRƯỚC KHI state của lần đầu commit,
  // nên guard `cauHoi != null` chưa kịp chặn — bắn hai request GET trùng nhau.
  const batTatTriThuc = () => {
    const moi = !moTriThuc;
    setMoTriThuc(moi);
    if (moi) {
      setDaTungMo(true);
      taiCauHoi();
    }
  };

  // Hoạt động gần đây nằm CHUNG hàng siêu dữ liệu, không phải một khối riêng —
  // "mở 2 giờ trước · Sơ đồ tư duy" nói đủ chuyện mà không tốn thêm một dòng.
  const hoatDong = tiepTuc
    ? `mở ${tiepTuc.nhanThoiGian}${tiepTuc.beMat ? ` · ${tiepTuc.nhanBeMat}` : ""}`
    : null;

  const sieuDuLieu = [
    nhanThoiGianDoc(phut),
    doc.page_count ? `${doc.page_count} trang` : null,
    doc.chunk_count ? `${doc.chunk_count} đoạn` : null,
    doc.language || null,
    hoatDong,
    doc.open_count > 1 ? `${doc.open_count} lần mở` : null,
  ].filter(Boolean);

  const hanhDong = [
    { khoa: "summary", nhan: "Tóm tắt", icon: "ScrollText" },
    { khoa: "studymap", nhan: "Sơ đồ", icon: "Network" },
    { khoa: "quiz", nhan: "Quiz", icon: "BadgeCheck" },
    { khoa: "review", nhan: "Ôn tập", icon: "BookOpen" },
    { khoa: "chat", nhan: "Hỏi AI", icon: "MessageSquare" },
  ];

  return (
    <div
      ref={refThe}
      // `tabIndex` do danh sách cấp phát (roving tabindex): đúng MỘT thẻ nhận Tab,
      // mũi tên đi giữa các thẻ. Cho mọi thẻ `tabIndex=0` thì người dùng bàn phím
      // phải Tab qua 300 lần để tới thanh dưới.
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      aria-selected={onChon ? Boolean(daChon) : undefined}
      className={`surface-card flex flex-col outline-none
                 focus-visible:ring-2 focus-visible:ring-offset-2
                 ${gon ? "!p-2.5 gap-1.5" : "!p-4 gap-3"}`}
      style={{
        ...(doc.archived_at ? { opacity: 0.62 } : null),
        ...(daChon ? { borderColor: "var(--accent)" } : null),
        "--tw-ring-color": "var(--accent)", "--tw-ring-offset-color": "var(--bg-card)",
      }}
    >

      {/* Tên + cờ + menu */}
      <div className="flex items-start gap-3">
        {onChon ? (
          <input
            type="checkbox"
            checked={Boolean(daChon)}
            onChange={() => onChon(doc.document_id)}
            aria-label={nhanOChon(ten, Boolean(daChon))}
            className="w-[15px] h-[15px] mt-[4px] accent-forest rounded cursor-pointer shrink-0"
          />
        ) : (
          <Icon name="FileText" size={18} className="text-text-muted shrink-0 mt-[3px]" />
        )}

        {dangDoiTen ? (
          <DoiTenTaiCho giaTriDau={doc.display_name || doc.title}
                        dangLuu={dangLuu} onLuu={onLuuTen} onHuy={onHuyDoiTen} />
        ) : (
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-display text-title font-semibold text-text-primary truncate">
                {ten}
              </span>
              {doc.pinned && <Icon name="Pin" size={13} className="shrink-0 text-forest" />}
              {doc.favorite && <Icon name="Star" size={13} className="shrink-0 text-forest" />}
              {doc.archived_at && (
                <span className="shrink-0 text-caption text-text-muted">· đã lưu trữ</span>
              )}
            </div>
            {/* Huy hiệu bộ sưu tập: TÊN lấy từ danh sách chung, không từ tài liệu —
                tài liệu chỉ mang `collection_id`, nên đổi tên là một lượt ghi. */}
            {boSuuTap && (
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-[2px]
                               text-caption max-w-full"
                    style={{ background: "var(--bg-sidebar)", color: "var(--text-secondary)",
                             border: "1px solid var(--border-color)" }}>
                <span aria-hidden className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: hexMau(boSuuTap.color) }} />
                <span className="truncate">{boSuuTap.name}</span>
              </span>
            )}
            {/* Tên tệp gốc: giữ lại vì người dùng nhận ra nó, nhưng mờ và nhỏ —
                nó không phải thứ quan trọng nhất trên thẻ này. */}
            {doc.display_name && (
              <div className="font-mono text-caption text-text-muted truncate mt-0.5">
                {doc.title}
              </div>
            )}
          </div>
        )}

        <div className="relative shrink-0">
          <button type="button" className="icon-btn w-7 h-7"
                  aria-label="Tuỳ chọn tài liệu"
                  onClick={() => setMenuMo((v) => !v)}>
            <Icon name="MoreVertical" size={15} />
          </button>
          {menuMo && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuMo(false)} />
              <div className="absolute right-0 top-8 z-20 min-w-[170px] rounded-[8px] py-1 shadow-card-hover"
                   style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}>
                {[
                  ["Đổi tên", "Pencil", () => onDoiTen(doc.document_id)],
                  [doc.favorite ? "Bỏ yêu thích" : "Yêu thích", "Star",
                    () => onBatTat(doc, { favorite: !doc.favorite })],
                  [doc.pinned ? "Bỏ ghim" : "Ghim", "Pin",
                    () => onBatTat(doc, { pinned: !doc.pinned })],
                  [doc.archived_at ? "Bỏ lưu trữ" : "Lưu trữ",
                    doc.archived_at ? "ArchiveRestore" : "Archive",
                    () => onBatTat(doc, { archived: !doc.archived_at })],
                ].map(([nhan, icon, ham]) => (
                  <button key={nhan} type="button"
                          onClick={() => { setMenuMo(false); ham(); }}
                          className="w-full px-3 py-1.5 text-left text-small text-text-primary
                                     hover:bg-surface-elevated inline-flex items-center gap-2">
                    <Icon name={icon} size={13} /> {nhan}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* AI Overview — khối chữ LỚN NHẤT trên thẻ. Chỉ hiện khi có tóm tắt thật.
          Gọn: chỉ dòng đầu — vẫn là điều AI chuẩn bị, chỉ ít dòng hơn, không đổi
          nội dung. */}
      {yChinh.length > 0 && (
        <ul className="flex flex-col gap-1 pl-0.5">
          {(gon ? yChinh.slice(0, 1) : yChinh).map((y, i) => (
            <li key={i} className="flex gap-2 text-body text-text-primary">
              <Icon name="Sparkles" size={12} className="mt-[4px] shrink-0 text-forest" />
              <span>{y}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Tóm tắt xem trước — kẹp 2 dòng. Ẩn ở chế độ gọn: AI Overview một dòng
          đã đủ định vị thẻ, xem trước đầy đủ có ở "Chi tiết". */}
      {!gon && ai.summary?.preview && (
        <p className="text-small text-text-secondary"
           style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                    overflow: "hidden" }}>
          {ai.summary.preview}
        </p>
      )}

      {/* Chưa có tóm tắt: nói đúng là chưa có, kèm một hành động THẬT. Không bao giờ
          hiện "đang tạo…" khi không có job nào đang chạy. */}
      {ai.summary?.state === "not_generated" && daIndex && yChinh.length === 0 && (
        <p className="text-small text-text-muted">
          Chưa có tóm tắt cho tài liệu này.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => <ChipAi key={c.khoa} chip={c} />)}
      </div>

      {!gon && sieuDuLieu.length > 0 && (
        <div className="font-mono text-caption text-text-muted">{sieuDuLieu.join(" · ")}</div>
      )}

      {!gon && Array.isArray(doc.tags) && doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {doc.tags.map((t) => (
            <span key={t}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-caption"
                  style={{ background: "var(--bg-sidebar)", color: "var(--text-secondary)",
                           border: "1px solid var(--border-color)" }}>
              <Icon name="Tag" size={10} /> {t}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {/* Nút Tiếp tục chỉ xuất hiện khi thật sự có chỗ để tiếp tục. */}
        {tiepTuc && (
          <button type="button" className="btn-seal !py-1.5 !text-small inline-flex items-center gap-1.5"
                  onClick={() => onMo(doc, tiepTuc.beMat || "studymap")}>
            <Icon name="ArrowRight" size={13} /> Tiếp tục · {tiepTuc.nhanBeMat}
          </button>
        )}
        {hanhDong.map(({ khoa, nhan, icon }) => (
          <button key={khoa} type="button"
                  className="pill-action disabled:opacity-45 disabled:cursor-not-allowed"
                  disabled={!daIndex}
                  title={daIndex ? undefined : "Tài liệu chưa được lập chỉ mục"}
                  onClick={() => onMo(doc, khoa)}>
            <Icon name={icon} size={13} /> {nhan}
          </button>
        ))}
        <button type="button" className="pill-action ml-auto"
                aria-expanded={moTriThuc}
                aria-controls={`tri-thuc-${doc.document_id}`}
                onClick={batTatTriThuc}>
          <Icon name="ChevronDown" size={13}
                style={{ transform: moTriThuc ? "rotate(180deg)" : undefined,
                         transition: "transform 180ms ease" }} />
          Chi tiết
        </button>
      </div>

      {daTungMo && (
        <div id={`tri-thuc-${doc.document_id}`}
             className={`knowledge-panel${moTriThuc ? " knowledge-panel--open" : ""}`}
             aria-hidden={!moTriThuc} inert={!moTriThuc ? "" : undefined}
             // Chặn nảy bọt: bàn phím ở đây là của các nút BÊN TRONG panel (mở câu
             // hỏi, mở tài liệu liên quan…), không phải của lưới thẻ. Không chặn thì
             // Enter/Space bấm trên MỘT nút trong panel sẽ nảy lên `onKeyDown` của
             // thẻ ngoài và bị `xuLyPhim` diễn dịch lại thành "mở thẻ"/"chọn thẻ" —
             // đúng cơ chế roving-tabindex vẫn dùng cho 5 nút hành động sẵn có, nhưng
             // panel này có QUÁ NHIỀU nút lồng nhau để chịu chung giới hạn đó.
             onKeyDown={(e) => e.stopPropagation()}>
          <KnowledgePanel
            doc={doc}
            documents={documents}
            chiMucBst={chiMucBst}
            chips={chips}
            cauHoi={cauHoi}
            dangTaiCauHoi={dangTaiCauHoi}
            loiCauHoi={loiCauHoi}
            onThuLai={taiCauHoi}
            onMo={onMo}
          />
        </div>
      )}
    </div>
  );
}
