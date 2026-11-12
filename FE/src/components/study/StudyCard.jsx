import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { chipHienThi, READY, GENERATING } from "../../utils/trangThaiAi";
import { tenHienThi, thoiGianDoc, nhanThoiGianDoc } from "../../utils/thuVienTaiLieu";
import { tiepTucHoc } from "../../utils/tiepTucHoc";
import { hexMau } from "../../utils/boSuuTap";
import { nhanOChon } from "../../utils/chonNhieu";
import { getQuestions, moTaLoi } from "../../utils/studyApi";
import KnowledgePanel from "./KnowledgePanel";
import InlineDocumentNameEditor from "./InlineDocumentNameEditor";
import "./studyCard.css";

/**
 * Thẻ tài liệu của Thư viện học tập.
 *
 * Thứ bậc (V6): tên tài liệu → có học được chưa → điều AI đã chuẩn bị (AI Overview,
 * tóm tắt xem trước) → dữ kiện → MỘT nút chính "Tiếp tục" và nhóm công cụ học. Trạng thái
 * "đã có / đang tạo" nằm ngay trên từng công cụ thay cho hàng chip lặp lại tên chúng.
 *
 * Không có: ảnh thu nhỏ sơ đồ, và không có hành động "Mở tệp".
 *
 * Phase 1B thêm: huy hiệu bộ sưu tập, ô chọn để thao tác hàng loạt, và một dòng
 * hoạt động gần đây GỘP vào hàng siêu dữ liệu — không phải một khối riêng. Thẻ đã
 * mang bảy thông tin; thêm một khối nữa là biến nó thành bảng biểu.
 */

export default function StudyCard({
  doc, documents, chiMucBst, jobs, boSuuTap, dangDoiTen, dangLuu, onDoiTen, onLuuTen,
  onHuyDoiTen, onBatTat, onMo, daChon, onChon, tabIndex, onKeyDown, refThe,
  matDo = "comfortable",
}) {
  // Frontend V2, Library wave — density is a display variant only: same doc,
  // same props, same actions, just fewer of them rendered/visible at once.
  // Không đổi thứ bậc thị giác đã có (tên → AI Overview → …), chỉ rút gọn nó.
  const gon = matDo === "compact";
  // The same document is drawn in several sections of the Library ("Đã ghim", "Hôm nay",
  // "Tất cả"…), so an id built from `document_id` alone repeats in one page and
  // `aria-controls` / `aria-describedby` stop pointing at one element. Unique per instance.
  const uid = useId();
  const [menuMo, setMenuMo] = useState(false);
  const nutMenuRef = useRef(null);
  const menuRef = useRef(null);
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

  useEffect(() => {
    if (menuMo) menuRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [menuMo]);

  const dongMenuVaTraFocus = () => {
    setMenuMo(false);
    requestAnimationFrame(() => nutMenuRef.current?.focus());
  };

  const xuLyPhimMenu = (e) => {
    // Không để phím của menu nổi bọt lên roving-tabindex của thẻ tài liệu.
    e.stopPropagation();
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    if (e.key === "Escape") {
      e.preventDefault();
      dongMenuVaTraFocus();
      return;
    }
    if (!items.length || !["ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const hienTai = items.indexOf(document.activeElement);
    const buoc = e.key === "ArrowDown" ? 1 : -1;
    const keTiep = hienTai < 0
      ? (buoc > 0 ? 0 : items.length - 1)
      : (hienTai + buoc + items.length) % items.length;
    items[keTiep].focus();
  };

  // Facts a learner uses to decide what to open: how long it is, and when they last had it
  // open. The chunk count and the open counter are internal bookkeeping and stay off the card.
  const suKien = [
    phut != null ? ["Clock", nhanThoiGianDoc(phut)] : null,
    doc.page_count ? ["FileText", `${doc.page_count} trang`] : null,
    tiepTuc?.nhanThoiGian ? ["RotateCcw", `Mở ${tiepTuc.nhanThoiGian}`] : null,
  ].filter(Boolean);

  // The study tools. Each carries its own "prepared" state, which used to be a separate row of
  // chips repeating the same five names.
  const trangThaiCua = Object.fromEntries(chips.map((c) => [c.khoa, c]));
  const congCu = [
    { khoa: "summary", nhan: "Tóm tắt", icon: "ScrollText" },
    { khoa: "studymap", nhan: "Bản đồ kiến thức", icon: "Network" },
    { khoa: "quiz", nhan: "Quiz", icon: "BadgeCheck" },
    { khoa: "review", nhan: "Ôn tập", icon: "BookOpen" },
    { khoa: "chat", nhan: "Hỏi AI", icon: "MessageSquare" },
  ]
    // "Tiếp tục · Quiz" already goes to Quiz: the same destination is not offered twice.
    .filter(({ khoa }) => !(tiepTuc?.beMat && tiepTuc.beMat === khoa));
  const coSoDoTuDuy = trangThaiCua.mindmap?.trangThai === READY;
  const dangDungSoDo = trangThaiCua.mindmap?.trangThai === GENERATING;

  // Why the tools are not offered, in words. `hong` = the server marked processing as failed.
  const hong = doc.ingest_status === "error" || doc.status === "failed";

  return (
    <div
      ref={refThe}
      // `tabIndex` do danh sách cấp phát (roving tabindex): đúng MỘT thẻ nhận Tab,
      // mũi tên đi giữa các thẻ. Cho mọi thẻ `tabIndex=0` thì người dùng bàn phím
      // phải Tab qua 300 lần để tới thanh dưới.
      tabIndex={tabIndex}
      // The list's keys (arrows, Space = select, Enter = open) belong to the CARD. A key
      // pressed on a button, the checkbox or a menu item inside it is that control's own: it
      // used to bubble here too, so Enter on "Tóm tắt" also opened the card's last workspace
      // and Space on a tool selected the card.
      onKeyDown={onKeyDown ? (e) => { if (e.target === e.currentTarget) onKeyDown(e); } : undefined}
      aria-selected={onChon ? Boolean(daChon) : undefined}
      className="surface-card study-card"
      data-density={gon ? "compact" : "comfortable"}
      data-selected={daChon ? "true" : undefined}
      data-archived={doc.archived_at ? "true" : undefined}
    >
      <div className="study-card__head">
        {onChon ? (
          <label className="study-card__select">
            <input
              type="checkbox"
              checked={Boolean(daChon)}
              onChange={() => onChon(doc.document_id)}
              aria-label={nhanOChon(ten, Boolean(daChon))}
            />
          </label>
        ) : (
          <Icon name="FileText" size={18} className="text-text-muted shrink-0 mt-[3px]" aria-hidden="true" />
        )}

        {dangDoiTen ? (
          <InlineDocumentNameEditor initialValue={doc.display_name || doc.title}
                                    saving={dangLuu} onSave={onLuuTen} onCancel={onHuyDoiTen} />
        ) : (
          <div className="min-w-0">
            <h3 className="study-card__title" title={ten}>{ten}</h3>
            {(boSuuTap || doc.pinned || doc.favorite || doc.archived_at) && (
              <div className="study-card__badges">
                {/* Flags are words, not bare icons: an unlabelled star says nothing to a
                    screen reader and little to anyone else. */}
                {doc.pinned && <span className="study-card__badge study-card__badge--flag"><Icon name="Pin" size={11} aria-hidden="true" /> Đã ghim</span>}
                {doc.favorite && <span className="study-card__badge study-card__badge--flag"><Icon name="Star" size={11} aria-hidden="true" /> Yêu thích</span>}
                {doc.archived_at && <span className="study-card__badge"><Icon name="Archive" size={11} aria-hidden="true" /> Đã lưu trữ</span>}
                {/* Huy hiệu bộ sưu tập: TÊN lấy từ danh sách chung, không từ tài liệu —
                    tài liệu chỉ mang `collection_id`, nên đổi tên là một lượt ghi. */}
                {boSuuTap && (
                  <span className="study-card__badge">
                    <i aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: hexMau(boSuuTap.color) }} />
                    <span>{boSuuTap.name}</span>
                  </span>
                )}
              </div>
            )}
            {/* Tên tệp gốc: giữ lại vì người dùng nhận ra nó, nhưng mờ và nhỏ. */}
            {doc.display_name && !gon && <div className="study-card__file" title={doc.title}>{doc.title}</div>}
          </div>
        )}

        <div className="relative">
          <button ref={nutMenuRef} type="button" className="icon-btn study-card__menu-trigger"
                  aria-label="Tuỳ chọn tài liệu"
                  aria-haspopup="menu"
                  aria-expanded={menuMo}
                  onKeyDown={(e) => e.stopPropagation()}
                  onClick={() => setMenuMo((v) => !v)}>
            <Icon name="MoreVertical" size={15} aria-hidden="true" />
          </button>
          {menuMo && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuMo(false)} />
              <div ref={menuRef} role="menu" onKeyDown={xuLyPhimMenu}
                   className="absolute right-0 top-9 z-20 min-w-[180px] rounded-[8px] py-1 shadow-card-hover"
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
                  <button key={nhan} type="button" role="menuitem"
                          onClick={() => { setMenuMo(false); ham(); }}
                          className="w-full min-h-[40px] px-3 py-1.5 text-left text-small text-text-primary
                                     hover:bg-surface-elevated inline-flex items-center gap-2">
                    <Icon name={icon} size={13} aria-hidden="true" /> {nhan}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Cannot be studied yet: say why, once, instead of five greyed-out buttons. */}
      {!daIndex && (
        <p className="study-card__state" data-state={hong ? "failed" : "waiting"}>
          <Icon name={hong ? "TriangleAlert" : "Clock"} size={15} aria-hidden="true" />
          <span>
            {hong ? "Xử lý tài liệu này bị lỗi." : "Tài liệu chưa được lập chỉ mục."}
            <small>{hong
              ? "Chưa mở được tóm tắt, quiz hay hỏi đáp với tài liệu này."
              : "Tóm tắt, quiz và hỏi đáp mở được khi lập chỉ mục xong."}</small>
          </span>
        </p>
      )}

      {/* AI Overview — khối chữ LỚN NHẤT trên thẻ. Chỉ hiện khi có tóm tắt thật.
          Gọn: chỉ dòng đầu. */}
      {yChinh.length > 0 && (
        <ul className="study-card__overview">
          {(gon ? yChinh.slice(0, 1) : yChinh).map((y, i) => (
            <li key={i}><Icon name="Sparkles" size={12} aria-hidden="true" /><span>{y}</span></li>
          ))}
        </ul>
      )}

      {!gon && ai.summary?.preview && <p className="study-card__preview">{ai.summary.preview}</p>}

      {/* Chưa có tóm tắt: nói đúng là chưa có. Không bao giờ hiện "đang tạo…" khi
          không có job nào đang chạy. */}
      {ai.summary?.state === "not_generated" && daIndex && yChinh.length === 0
        && trangThaiCua.summary?.trangThai !== GENERATING && (
        <p className="study-card__hint">Chưa có tóm tắt cho tài liệu này.</p>
      )}

      {!gon && (suKien.length > 0 || coSoDoTuDuy || dangDungSoDo) && (
        <ul className="study-card__facts">
          {suKien.map(([icon, nhan]) => (
            <li key={nhan}><Icon name={icon} size={12} aria-hidden="true" />{nhan}</li>
          ))}
          {/* The mind map has no tool button on the card, so its state is a fact. */}
          {coSoDoTuDuy && <li><Icon name="GitBranch" size={12} aria-hidden="true" />Có sơ đồ tư duy</li>}
          {dangDungSoDo && <li><Icon name="Clock" size={12} aria-hidden="true" />{trangThaiCua.mindmap.nhan}</li>}
        </ul>
      )}

      {!gon && Array.isArray(doc.tags) && doc.tags.length > 0 && (
        <div className="study-card__tags">
          {doc.tags.map((t) => (
            <span key={t} className="study-card__badge"><Icon name="Tag" size={10} aria-hidden="true" /><span>{t}</span></span>
          ))}
        </div>
      )}

      <div className="study-card__foot">
        {/* One filled button at most: it exists only when there is somewhere to continue. */}
        {tiepTuc && daIndex && (
          <button type="button" className="btn-seal !text-small inline-flex items-center gap-1.5 study-card__resume"
                  onClick={() => onMo(doc, tiepTuc.beMat || "studymap")}>
            <Icon name="ArrowRight" size={13} aria-hidden="true" /> Tiếp tục · {tiepTuc.nhanBeMat}
          </button>
        )}
        {daIndex && (
          <div className="study-card__tools" role="group" aria-label={`Học với ${ten}`}>
            {congCu.map(({ khoa, nhan, icon }) => {
              const tt = trangThaiCua[khoa];
              const sanSang = tt?.trangThai === READY;
              const dangTao = tt?.trangThai === GENERATING;
              // The button's NAME stays the tool's name ("Tóm tắt"), so it is what people say
              // and what tests look for. The state is its DESCRIPTION: the marks are hidden
              // from assistive technology and the words live in a described-by element.
              const moTa = [
                sanSang ? (tt?.soLuong ? `đã có ${tt.soLuong}` : "đã có") : null,
                dangTao ? "đang tạo" : null,
              ].filter(Boolean).join(", ");
              const idMoTa = `cong-cu-${khoa}-${uid}`;
              return (
                <button key={khoa} type="button" className="study-card__tool"
                        data-ready={sanSang ? "true" : undefined}
                        aria-describedby={moTa ? idMoTa : undefined}
                        onClick={() => onMo(doc, khoa)}>
                  <Icon name={icon} size={13} aria-hidden="true" />
                  {nhan}
                  {tt?.soLuong ? <span aria-hidden="true">({tt.soLuong})</span> : null}
                  {sanSang && (
                    <span className="study-card__tool-mark" aria-hidden="true">
                      <Icon name="Check" size={12} strokeWidth={2.5} />
                    </span>
                  )}
                  {dangTao && <span className="study-card__tool-note" aria-hidden="true">đang tạo…</span>}
                  {/* `hidden`: referenced by aria-describedby, never read on its own. A <span>
                      inside the button would have become part of its name. */}
                  {moTa && <span id={idMoTa} hidden data-tool-description>{moTa}</span>}
                </button>
              );
            })}
          </div>
        )}
        <button type="button" className="pill-action study-card__details"
                aria-expanded={moTriThuc}
                aria-controls={`tri-thuc-${uid}`}
                onClick={batTatTriThuc}>
          <Icon name="ChevronDown" size={13} aria-hidden="true"
                style={{ transform: moTriThuc ? "rotate(180deg)" : undefined,
                         transition: "transform 180ms ease" }} />
          Chi tiết
        </button>
      </div>

      {daTungMo && (
        <div id={`tri-thuc-${uid}`}
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
