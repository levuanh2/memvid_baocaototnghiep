import { Icon } from "../ui/Icon";
import { tenHienThi } from "../../utils/thuVienTaiLieu";
import { tiepTucHoc } from "../../utils/tiepTucHoc";
import { baoPhuArtifact } from "../../study/learningAnalytics";
import { hangDoiOnTap, taiLieuDaOnXong } from "../../study/reviewQueue";
import { hanhTrinhHoc } from "../../study/learningJourney";
import "./learningHome.css";

/**
 * V6 — the top of the Library: where to pick up, what was open lately, and how far along the
 * library is. It answers "what do I do now?" before the list answers "where is that document?".
 *
 * Nothing here is new data or a new request: the resume point and the recent list come from
 * `mucHienThi` (already computed by the page), coverage and the review queue from `documents`,
 * the quiz average from the `overview` the page already loaded. The detailed dashboard stays
 * below, in its disclosure.
 */
export default function LearningHome({ documents, mucHienThi, overview, onMo }) {
  const dangHoc = mucHienThi?.tiepTucHoc || null;
  const tiepTuc = dangHoc ? tiepTucHoc(dangHoc) : null;
  const coTheHoc = dangHoc?.ai?.index === "ready";

  const ganDay = (mucHienThi?.hocGanDay || [])
    .filter((d) => d.document_id !== dangHoc?.document_id)
    .slice(0, 3);

  const baoPhu = baoPhuArtifact(documents);
  const hangDoi = hangDoiOnTap(mucHienThi?.canOnTap || [], taiLieuDaOnXong(documents));
  const canOnNgay = hangDoi.homNay;
  const diemTrungBinh = overview?.average_percentage;

  return (
    <section className="learning-home surface-card" aria-labelledby="learning-home-title">
      <div className="learning-home__resume">
        <h2 id="learning-home-title" className="learning-home__label">Học tiếp</h2>
        {tiepTuc ? (
          <>
            <p className="learning-home__title" title={tenHienThi(dangHoc)}>{tenHienThi(dangHoc)}</p>
            <p className="learning-home__meta">
              Mở lần cuối {tiepTuc.nhanThoiGian || "gần đây"}
              {tiepTuc.beMat ? <>, ở <strong>{tiepTuc.nhanBeMat}</strong></> : null}.
            </p>
            <Journey doc={dangHoc} />
            {coTheHoc ? (
              <button type="button" className="btn-seal learning-home__cta"
                      onClick={() => onMo(dangHoc, tiepTuc.beMat || "studymap")}>
                <Icon name="ArrowRight" size={14} aria-hidden="true" /> Tiếp tục · {tiepTuc.nhanBeMat}
              </button>
            ) : (
              <p className="learning-home__meta">Tài liệu này chưa lập chỉ mục xong nên chưa mở tiếp được.</p>
            )}
          </>
        ) : (
          <>
            <p className="learning-home__title">Chưa có tài liệu nào đang học dở</p>
            <p className="learning-home__meta">
              Mở một tài liệu ở danh sách bên dưới bằng Tóm tắt, Quiz hoặc Hỏi AI; lần sau nó sẽ nằm ở đây để bạn học tiếp.
            </p>
          </>
        )}
      </div>

      <div className="learning-home__side">
        {ganDay.length > 0 && (
          <div>
            <h3 className="learning-home__label">Mở gần đây</h3>
            <ul className="learning-home__recent">
              {ganDay.map((d) => {
                const tt = tiepTucHoc(d);
                const mo = d.ai?.index === "ready";
                return (
                  <li key={d.document_id}>
                    <button type="button" disabled={!mo}
                            onClick={() => onMo(d, tt?.beMat || "studymap")}>
                      <span className="learning-home__recent-name">{tenHienThi(d)}</span>
                      <span className="learning-home__recent-meta">
                        {tt?.nhanThoiGian || ""}{tt?.beMat ? `, ${tt.nhanBeMat}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div>
          <h3 className="learning-home__label">Tiến độ thư viện</h3>
          <dl className="learning-home__progress">
            <div>
              <dt>Có tóm tắt</dt>
              <dd>{baoPhu.summary.co}/{baoPhu.summary.tong} <span>tài liệu</span></dd>
            </div>
            <div>
              <dt>Có quiz</dt>
              <dd>{baoPhu.quiz.co}/{baoPhu.quiz.tong} <span>tài liệu</span></dd>
            </div>
            {diemTrungBinh != null && (
              <div>
                <dt>Điểm quiz trung bình</dt>
                <dd>{diemTrungBinh}% <span>điểm</span></dd>
              </div>
            )}
          </dl>
          {canOnNgay.length > 0 && (
            <button type="button" className="learning-home__review"
                    onClick={() => onMo(canOnNgay[0], "review")}>
              <Icon name="BookOpen" size={14} aria-hidden="true" />
              <span>
                <strong>{canOnNgay.length} tài liệu cần ôn ngay</strong>
                <span>Bắt đầu với {tenHienThi(canOnNgay[0])}</span>
              </span>
              <Icon name="ArrowRight" size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** The stages this document has been through, in order: a real sequence, so it is a list. */
function Journey({ doc }) {
  const chang = hanhTrinhHoc(doc);
  const daQua = chang.filter((c) => c.dat).length;
  // Nothing recorded yet: eight grey stage names would say nothing, so the list is left out.
  if (!daQua) return null;
  return (
    <ol className="learning-home__journey" aria-label={`Hành trình học: đã qua ${daQua} trên ${chang.length} chặng`}>
      {chang.map((c) => (
        <li key={c.key} data-done={c.dat ? "true" : undefined}>
          {c.dat && <Icon name="Check" size={11} strokeWidth={2.5} aria-hidden="true" />}
          {c.nhan}
          <span className="sr-only">{c.dat ? ", đã qua" : ", chưa tới"}</span>
        </li>
      ))}
    </ol>
  );
}
