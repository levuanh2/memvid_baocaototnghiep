import { useMemo, useState } from "react";
import { Icon } from "../ui/Icon";
import { tenHienThi, thoiGianDoc, nhanThoiGianDoc } from "../../utils/thuVienTaiLieu";
import { tiepTucHoc } from "../../utils/tiepTucHoc";
import { taiLieuLienQuan } from "../../utils/taiLieuLienQuan";
import { chuDeNoiBat, nhanSanSang } from "../../utils/triThuc";
import { nhanLyDoCauHoi, nhomTheoDanhMuc, trangThaiRongCauHoi } from "../../utils/cauHoiGoiY";
import { masteryPercent, MASTERY_LABEL } from "../../utils/studyApi";
import { useStudyContext } from "../../study/useStudyContext";

/**
 * Bảng tri thức trong thẻ (Phase 1C.2b) — HOÀN TOÀN trình bày.
 *
 * Không gọi mạng, không tự giữ trạng thái tải: `cauHoi` / `dangTaiCauHoi` /
 * `loiCauHoi` đều do `StudyCard` sở hữu và truyền xuống — panel chỉ vẽ props và
 * phát lại sự kiện (`onThuLai`, `onMo`). Đóng/mở lại panel không mất dữ liệu đã
 * tải vì cái CACHE nằm ở component cha, không nằm ở đây.
 *
 * Không có điểm tương đồng cho "Tài liệu liên quan": tầng này chưa có FAISS/embedding
 * similarity, và bịa một con số sẽ đọc như một phép đo thật trong khi không phải —
 * xem `taiLieuLienQuan.js`. Thay vào đó là lý do có cấu trúc {source, value}, và
 * CHÍNH FILE NÀY (tầng UI) chịu trách nhiệm dịch nó ra chữ hiển thị.
 */

const MAU_MASTERY = {
  mastered: { bg: "var(--ok-bg, rgba(34,150,94,0.12))", fg: "var(--ok, #22965e)" },
  critical_gap: { bg: "rgba(220,38,38,0.10)", fg: "var(--err, #dc2626)" },
};

const TIEU_DE = "font-mono text-[10.5px] tracking-[0.16em] uppercase text-text-muted";
const GIOI_HAN_CHU_DE = 8;

function nhanLyDoLienQuan({ source, value }) {
  if (source === "collection") return `Cùng bộ sưu tập: ${value}`;
  if (source === "topic") return `Cùng chủ đề: ${value}`;
  if (source === "tag") return `Cùng thẻ: ${value}`;
  return value;
}

function KhungXuong({ soDong = 3 }) {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden="true">
      {Array.from({ length: soDong }, (_, i) => (
        <div key={i} className="h-[22px] rounded-[6px] bg-surface-elevated animate-pulse"
             style={{ width: `${70 - i * 14}%` }} />
      ))}
    </div>
  );
}

export default function KnowledgePanel({
  doc, documents, chiMucBst, chips, cauHoi, dangTaiCauHoi, loiCauHoi, onThuLai, onMo,
}) {
  const { selectQuestion } = useStudyContext();
  const tri = doc?.knowledge || {};
  const entities = Array.isArray(tri.entities) ? tri.entities : [];

  // Sắp xếp yếu-trước / trọng-số cao-trước là quyết định ĐÃ CÓ (và đã test) ở
  // `triThuc.js` — không viết lại ở đây. `gioiHan` không giới hạn để "Xem thêm"
  // luôn có đủ danh sách, panel chỉ cắt hiển thị.
  const chuDeDayDu = useMemo(
    () => chuDeNoiBat(doc, { gioiHan: Number.POSITIVE_INFINITY }), [doc]);
  const [hienHetChuDe, setHienHetChuDe] = useState(false);
  const chuDeHien = hienHetChuDe ? chuDeDayDu : chuDeDayDu.slice(0, GIOI_HAN_CHU_DE);
  const chuDeAn = chuDeDayDu.length - chuDeHien.length;

  const sanSang = useMemo(() => nhanSanSang(tri.readiness), [tri.readiness]);

  const lienQuan = useMemo(
    () => taiLieuLienQuan(doc, documents, { chiMucBst }),
    [doc, documents, chiMucBst]);

  // Tiếp tục học: tài liệu hiện tại luôn có sẵn qua `doc`, không cần thêm một prop
  // suy ra được từ đúng thứ panel đã nhận.
  const tiepTuc = useMemo(() => tiepTucHoc(doc), [doc]);

  const nhomCauHoi = useMemo(() => nhomTheoDanhMuc(cauHoi), [cauHoi]);
  const trangThaiCauHoi = trangThaiRongCauHoi(cauHoi, { dangTai: dangTaiCauHoi });

  const phut = thoiGianDoc(doc);
  const trangThaiTomTat = chips?.find((c) => c.khoa === "summary")?.trangThai;

  return (
    <div className="flex flex-col gap-4 pt-1">

      {/* Tri thức: huy hiệu sẵn sàng, chủ đề (yếu trước, gập bớt nếu dài), thực thể */}
      {(chuDeDayDu.length > 0 || entities.length > 0) && (
        <section className="flex flex-col gap-2">
          <h4 className={TIEU_DE}>Tri thức</h4>

          {sanSang.phanTram > 0 && (
            <span className="self-start inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px]"
                  style={{ background: "var(--bg-card)", color: "var(--text-secondary)",
                           border: "1px solid var(--border)" }}>
              {sanSang.nhan} · {sanSang.phanTram}%
            </span>
          )}

          {chuDeDayDu.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chuDeHien.map((t) => {
                const mau = t.status ? MAU_MASTERY[t.status] : null;
                return (
                  <span
                    key={t.name}
                    title={t.status ? MASTERY_LABEL[t.status] || undefined : undefined}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px]"
                    style={mau
                      ? { background: mau.bg, color: mau.fg }
                      : { background: "var(--bg-card)", color: "var(--text-secondary)",
                          border: "1px solid var(--border)" }}
                  >
                    {t.name}
                    {t.mastery != null && <span className="opacity-80">· {masteryPercent(t.mastery)}%</span>}
                  </span>
                );
              })}
              {chuDeAn > 0 && (
                <button type="button"
                        className="text-[11px] text-brand hover:underline"
                        onClick={() => setHienHetChuDe(true)}>
                  +{chuDeAn} chủ đề khác
                </button>
              )}
              {hienHetChuDe && chuDeDayDu.length > GIOI_HAN_CHU_DE && (
                <button type="button"
                        className="text-[11px] text-text-muted hover:underline"
                        onClick={() => setHienHetChuDe(false)}>
                  Thu gọn
                </button>
              )}
            </div>
          )}

          {entities.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {entities.slice(0, 10).map((e) => (
                <span key={e}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px]"
                      style={{ background: "var(--bg-card)", color: "var(--text-muted)",
                               border: "1px solid var(--border)" }}>
                  <Icon name="Tag" size={10} /> {e}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Tài liệu liên quan — không có điểm số, chỉ lý do có căn cứ */}
      {lienQuan.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className={TIEU_DE}>Tài liệu liên quan</h4>
          <ul className="flex flex-col gap-1.5">
            {lienQuan.map(({ doc: d, reason }) => (
              <li key={d.document_id}
                  className="flex items-center justify-between gap-2 rounded-[7px] px-2.5 py-1.5"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] text-text-primary">{tenHienThi(d)}</div>
                  <div className="truncate text-[10.5px] text-text-muted">
                    {reason.map(nhanLyDoLienQuan).join(" · ")}
                  </div>
                </div>
                <button type="button" className="pill-action !py-1 !text-[11.5px] shrink-0"
                        onClick={() => onMo(d, d.last_workspace || "studymap")}>
                  Mở
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Câu hỏi gợi ý — LƯỜI: dữ liệu do StudyCard tải, panel chỉ hiện trạng thái */}
      <section className="flex flex-col gap-2">
        <h4 className={TIEU_DE}>Câu hỏi gợi ý</h4>

        {dangTaiCauHoi && <KhungXuong soDong={3} />}

        {!dangTaiCauHoi && loiCauHoi && (
          <div className="flex flex-wrap items-center gap-2 text-[12px]" role="alert"
               style={{ color: "var(--err)" }}>
            <Icon name="AlertCircle" size={13} />
            <span>{loiCauHoi}</span>
            <button type="button" className="pill-action !py-0.5 !text-[11px] inline-flex items-center gap-1"
                    onClick={onThuLai}>
              <Icon name="RotateCcw" size={11} /> Thử lại
            </button>
          </div>
        )}

        {!dangTaiCauHoi && !loiCauHoi && trangThaiCauHoi.loai === "rong" && (
          <p className="text-[12px] text-text-muted">{trangThaiCauHoi.goiY}</p>
        )}

        {!dangTaiCauHoi && !loiCauHoi && nhomCauHoi.length > 0 && (
          <div className="flex flex-col gap-3">
            {nhomCauHoi.map((nhom) => (
              <div key={nhom.category} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <Icon name={nhom.icon} size={12} /> {nhom.nhan}
                </div>
                <div className="flex flex-col gap-1.5">
                  {nhom.cauHoi.map((q) => {
                    const lyDo = nhanLyDoCauHoi(q.reason);
                    return (
                      <button
                        key={q.id} type="button"
                        className="flex items-start gap-2 rounded-[7px] px-2.5 py-1.5 text-left"
                        style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
                        onClick={() => {
                          // Phase 4A.3: "nhớ" câu hỏi vừa bấm lên Study Context TRƯỚC khi
                          // điều hướng — id sống qua cả lượt đổi route sang Workspace.
                          selectQuestion(q.id);
                          onMo(doc, q.target, { prompt: q.text });
                        }}
                      >
                        <Icon name={nhom.icon} size={13} className="shrink-0 mt-[2px] text-brand" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] text-text-primary">{q.text}</span>
                          {lyDo && <span className="block text-[10.5px] text-text-muted mt-0.5">{lyDo}</span>}
                        </span>
                        {Number.isFinite(Number(q.confidence)) && (
                          <span className="shrink-0 text-[10.5px] text-text-muted"
                                title="Độ tin cậy của câu hỏi này">
                            {masteryPercent(q.confidence)}%
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tóm tắt AI — LUÔN hiện, ba trạng thái thật: có bản, đang tạo, chưa có.
          "Chưa có" đi kèm một hành động THẬT (route /summary sẵn có, cùng nút mà
          `AiInsightCard` đã dùng) — không phải một khối trống im lặng. */}
      <section className="flex flex-col gap-2">
        <h4 className={TIEU_DE}>Tóm tắt AI</h4>
        <div className="rounded-[7px] px-2.5 py-2 flex flex-col gap-1.5"
             style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
          {doc?.ai?.summary?.preview ? (
            <>
              <p className="text-[12.5px] leading-[1.5] text-text-secondary line-clamp-3">
                {doc.ai.summary.preview}
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-text-muted">{nhanThoiGianDoc(phut)}</span>
                <button type="button" className="pill-action !py-1 !text-[11.5px] shrink-0"
                        onClick={() => onMo(doc, "summary")}>
                  Mở tóm tắt
                </button>
              </div>
            </>
          ) : trangThaiTomTat === "generating" ? (
            <span className="text-[12px] text-text-muted">Đang tóm tắt…</span>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-text-muted">Chưa có tóm tắt cho tài liệu này.</span>
              <button type="button" className="pill-action !py-1 !text-[11.5px] shrink-0"
                      onClick={() => onMo(doc, "summary")}>
                Tạo tóm tắt
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Tiếp tục học — điểm quay lại, hoạt động gần nhất, lần mở cuối */}
      {tiepTuc && (
        <section className="flex flex-col gap-2">
          <h4 className={TIEU_DE}>Tiếp tục học</h4>
          <div className="flex items-center justify-between gap-2 rounded-[7px] px-2.5 py-2"
               style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <span className="text-[12px] text-text-secondary">
              {tiepTuc.nhanBeMat} · mở {tiepTuc.nhanThoiGian}
            </span>
            <button type="button"
                    className="btn-seal !py-1 !text-[12px] inline-flex items-center gap-1.5 shrink-0"
                    onClick={() => onMo(doc, tiepTuc.beMat || "studymap")}>
              <Icon name="ArrowRight" size={12} /> Tiếp tục
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
