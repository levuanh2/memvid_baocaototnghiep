import { Icon } from "../ui/Icon";
import Disclosure from "../ui/Disclosure";
import SealMeter from "./SealMeter";
import { MASTERY_LABEL } from "../../utils/studyApi";
import { tenHienThi } from "../../utils/thuVienTaiLieu";
import {
  baoPhuArtifact, hoanThanhTongThe, chuDeChuaDanhGia, taiLieuItMo, taiLieuChuaXong,
  thoiLuongDocUocTinh, insightThuVien,
} from "../../study/learningAnalytics";
import { hangDoiOnTap, taiLieuDaOnXong } from "../../study/reviewQueue";
import { hanhTrinhHoc } from "../../study/learningJourney";

/**
 * Bảng tổng quan học tập (Phase 5) — HOÀN TOÀN suy diễn từ `documents`
 * (`/api/library`, đã tải ở `DocumentList.jsx`) + `mucHienThi` (kết quả
 * `chiaMuc` trang đó ĐÃ tính) + `overview`/`weak`/`attempts` (ba lượt gọi
 * `/api/progress/*` trang đó ĐÃ tải). KHÔNG fetch gì thêm, KHÔNG tính lại
 * `chiaMuc`/`overview`/`weak`/`attempts` — chỉ đọc và trình bày.
 */
export default function LearningDashboard({ documents, overview, weak, attempts, mucHienThi, onMo }) {
  const coverage = baoPhuArtifact(documents);
  const hoanThanh = hoanThanhTongThe(documents);
  const chuaDanhGia = chuDeChuaDanhGia(documents, { gioiHan: 4 });
  const itMo = taiLieuItMo(documents, { gioiHan: 4 });
  const chuaXong = taiLieuChuaXong(documents, { gioiHan: 4 });
  const phutDoc = thoiLuongDocUocTinh(documents);
  const insight = insightThuVien(documents);
  const hangDoi = hangDoiOnTap(mucHienThi.canOnTap, taiLieuDaOnXong(documents));
  const changGanNhatDoc = mucHienThi.tiepTucHoc || mucHienThi.hocGanDay[0] || null;

  return (
    <section className="surface-card !p-0 mb-7">
      <Disclosure title="Tổng quan học tập" dense>
        <div className="p-4 flex flex-col gap-5">

          {/* ── Tiến độ ── */}
          <div>
            <TieuDeNho>Tiến độ</TieuDeNho>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <ThanhTienDo nhan="Hoàn thành" phanTram={hoanThanh} />
              <ThanhTienDo nhan="Tóm tắt" phanTram={coverage.summary.phanTram}
                           phu={`${coverage.summary.co}/${coverage.summary.tong}`} />
              <ThanhTienDo nhan="Sơ đồ" phanTram={coverage.mindmap.phanTram}
                           phu={`${coverage.mindmap.co}/${coverage.mindmap.tong}`} />
              <ThanhTienDo nhan="Quiz" phanTram={coverage.quiz.phanTram}
                           phu={`${coverage.quiz.co}/${coverage.quiz.tong}`} />
            </div>
            {overview?.average_percentage != null && (
              <p className="text-[12px] text-text-muted mt-2">
                Điểm quiz trung bình: <span className="text-text-secondary font-medium">{overview.average_percentage}%</span>
                {" · "}Thời lượng đọc ước tính đã mở: <span className="text-text-secondary font-medium">{phutDoc} phút</span>
              </p>
            )}
          </div>

          {/* ── Chủ đề & tài liệu cần chú ý (Step 3, bổ sung `weak` từ máy chủ) ── */}
          {(chuaDanhGia.length > 0 || itMo.length > 0 || chuaXong.length > 0) && (
            <div>
              <TieuDeNho>Cần chú ý</TieuDeNho>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {itMo.length > 0 && (
                  <MiniDanhSach icon="EyeOff" tieuDe="Ít/chưa mở">
                    {itMo.map((d) => (
                      <button key={d.document_id} type="button" className="mini-item"
                              onClick={() => onMo(d, d.last_workspace || "studymap")}>
                        {tenHienThi(d)}
                      </button>
                    ))}
                  </MiniDanhSach>
                )}
                {chuaXong.length > 0 && (
                  <MiniDanhSach icon="CircleDashed" tieuDe="Học dở dang">
                    {chuaXong.map((d) => (
                      <button key={d.document_id} type="button" className="mini-item"
                              onClick={() => onMo(d, d.last_workspace || "studymap")}>
                        {tenHienThi(d)} · {Math.round(d.knowledge.readiness.total)}%
                      </button>
                    ))}
                  </MiniDanhSach>
                )}
                {chuaDanhGia.length > 0 && (
                  <MiniDanhSach icon="HelpCircle" tieuDe="Chủ đề chưa đánh giá">
                    {chuaDanhGia.map((t, i) => (
                      <span key={i} className="mini-item mini-item--static">{t.name}</span>
                    ))}
                  </MiniDanhSach>
                )}
              </div>
            </div>
          )}

          {/* ── Hàng đợi ôn tập (Step 4) ── */}
          {(hangDoi.homNay.length + hangDoi.ngayMai.length + hangDoi.sau.length) > 0 && (
            <div>
              <TieuDeNho>Hàng đợi ôn tập</TieuDeNho>
              <div className="grid gap-2.5 sm:grid-cols-3">
                <CotOnTap nhan="Hôm nay" docs={hangDoi.homNay} onMo={onMo} nhan_mau="var(--err)" />
                <CotOnTap nhan="Ngày mai" docs={hangDoi.ngayMai} onMo={onMo} nhan_mau="var(--warn)" />
                <CotOnTap nhan="Sau" docs={hangDoi.sau} onMo={onMo} nhan_mau="var(--text-muted)" />
              </div>
            </div>
          )}

          {/* ── Hành trình gần nhất (Step 1) ── */}
          {changGanNhatDoc && (
            <div>
              <TieuDeNho>Hành trình — {tenHienThi(changGanNhatDoc)}</TieuDeNho>
              <HanhTrinh doc={changGanNhatDoc} />
            </div>
          )}

          {/* ── Insight thư viện (Step 6) ── */}
          <div>
            <TieuDeNho>Insight</TieuDeNho>
            <ul className="grid gap-1.5 sm:grid-cols-2 text-[12.5px] text-text-secondary">
              {insight.chuDeHocNhieuNhat && <li>Chủ đề học nhiều nhất: <b className="text-text-primary">{insight.chuDeHocNhieuNhat}</b></li>}
              {insight.chuDeItHocNhat && insight.chuDeItHocNhat !== insight.chuDeHocNhieuNhat && (
                <li>Chủ đề ít khám phá nhất: <b className="text-text-primary">{insight.chuDeItHocNhat}</b></li>
              )}
              {insight.taiLieuLonNhat && <li>Tài liệu lớn nhất: <b className="text-text-primary">{tenHienThi(insight.taiLieuLonNhat)}</b></li>}
              {insight.taiLieuHoatDongNhat && <li>Tài liệu hoạt động nhất: <b className="text-text-primary">{tenHienThi(insight.taiLieuHoatDongNhat)}</b></li>}
              <li>Lượt quiz đã chấm: <b className="text-text-primary">{insight.luotQuizDaCham}</b></li>
              <li>Sơ đồ đã tạo: <b className="text-text-primary">{insight.soMindmapDaXem}</b></li>
              <li>Bao phủ tóm tắt: <b className="text-text-primary">{insight.baoPhuTomTat}%</b></li>
            </ul>
          </div>

          {/* ── Câu hỏi/quiz gần đây (Step 5 — cùng dữ liệu với mục "Bài đã làm gần đây" bên dưới, chỉ rút gọn 3 dòng) ── */}
          {(weak?.length > 0 || attempts?.length > 0) && (
            <div>
              <TieuDeNho>Gần đây</TieuDeNho>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {weak?.length > 0 && (
                  <MiniDanhSach icon="TrendingDown" tieuDe="Đang yếu ở">
                    {weak.slice(0, 3).map((c) => (
                      <span key={c.concept_name} className="mini-item mini-item--static">
                        {c.concept_name} · {MASTERY_LABEL[c.status] || c.status}
                      </span>
                    ))}
                  </MiniDanhSach>
                )}
                {attempts?.length > 0 && (
                  <MiniDanhSach icon="ScrollText" tieuDe="Bài quiz gần đây">
                    {attempts.slice(0, 3).map((a) => (
                      <span key={a.attempt_id} className="mini-item mini-item--static">{a.quiz_title}</span>
                    ))}
                  </MiniDanhSach>
                )}
              </div>
            </div>
          )}
        </div>
      </Disclosure>

      <style>{`
        .mini-item { display: block; width: 100%; text-align: left; padding: 3px 0;
          font-size: 12.5px; color: var(--text-secondary); border: none; background: transparent; }
        button.mini-item:hover { color: var(--accent); text-decoration: underline; cursor: pointer; }
        .mini-item--static { color: var(--text-muted); }
      `}</style>
    </section>
  );
}

function TieuDeNho({ children }) {
  return (
    <h3 className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-text-muted mb-2">
      {children}
    </h3>
  );
}

/** Thanh tiến độ — ARIA đầy đủ (Step 9), con số luôn in ra bằng chữ, không chỉ
 * bằng độ dài thanh (màu/độ dài không bao giờ là kênh thông tin duy nhất). */
function ThanhTienDo({ nhan, phanTram, phu }) {
  return (
    <div className="rounded-[7px] p-2.5" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[11px] text-text-muted">{nhan}</span>
        <span className="font-display text-[15px] font-semibold text-text-primary">{phanTram}%</span>
      </div>
      <div
        role="progressbar" aria-label={nhan} aria-valuenow={phanTram} aria-valuemin={0} aria-valuemax={100}
        className="h-[6px] rounded-full overflow-hidden" style={{ background: "var(--bg-base)" }}
      >
        <div className="h-full rounded-full" style={{ width: `${phanTram}%`, background: "var(--accent)" }} />
      </div>
      {phu && <div className="text-[10.5px] text-text-muted mt-1">{phu}</div>}
    </div>
  );
}

function MiniDanhSach({ icon, tieuDe, children }) {
  return (
    <div className="rounded-[7px] p-2.5" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-1.5 text-[11px] text-text-muted mb-1.5">
        <Icon name={icon} size={12} /> {tieuDe}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function CotOnTap({ nhan, docs, onMo, nhan_mau }) {
  return (
    <div className="rounded-[7px] p-2.5" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
      <div className="text-[11px] font-medium mb-1.5" style={{ color: nhan_mau }}>{nhan} ({docs.length})</div>
      {docs.length === 0 ? (
        <span className="text-[12px] text-text-muted">—</span>
      ) : (
        <div className="flex flex-col gap-1.5">
          {docs.slice(0, 4).map((d) => (
            <button key={d.document_id} type="button" className="flex items-center gap-2 text-left"
                    onClick={() => onMo(d, "review")}>
              <SealMeter score={(d.knowledge?.readiness?.mastery || 0) / 100} size={22} />
              <span className="mini-item !p-0 truncate">{tenHienThi(d)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Chuỗi chặng ngang, gọn — mỗi chặng là một chấm + nhãn, chặng đạt được tô đậm. */
function HanhTrinh({ doc }) {
  const chang = hanhTrinhHoc(doc);
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Hành trình học của tài liệu">
      {chang.map((c, i) => (
        <li key={c.key} className="flex items-center gap-1">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px]"
            style={c.dat
              ? { background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)" }
              : { color: "var(--text-muted)", border: "1px solid var(--border)" }}
          >
            {c.dat && <Icon name="Check" size={10} strokeWidth={2.5} />}
            {c.nhan}
          </span>
          {i < chang.length - 1 && <Icon name="ArrowRight" size={12} className="text-text-muted" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}
