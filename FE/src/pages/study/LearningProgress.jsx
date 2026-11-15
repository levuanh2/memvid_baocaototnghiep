import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import StudyShell from "../../components/study/StudyShell";
import {
  MASTERY_LABEL,
  formatDuration,
  getLibrary,
  getProgressAttempts,
  getProgressConcepts,
  getProgressOverview,
  masteryPercent,
  moTaLoi,
} from "../../utils/studyApi";
import { baiLam, locKhaiNiem, moTaKhaiNiem, ngayLam, nhomTheoTaiLieu, tomTatTienDo } from "../../utils/tienDoHoc";
import "./learningProgress.css";

const LOC = [
  { id: "can-on", nhan: "Cần ôn" },
  { id: "da-nam", nhan: "Đã nắm tốt" },
  { id: "tat-ca", nhan: "Tất cả" },
];

// First result (hollow) and the latest (filled) on one 0–100 track. Decorative: the row's
// text says the same numbers, so the track is hidden from assistive technology.
function MasteryTrack({ first, current }) {
  const dau = masteryPercent(first);
  const nay = masteryPercent(current);
  const huong = nay > dau ? "up" : nay < dau ? "down" : "flat";
  return (
    <div className="lp-track" data-trend={huong} aria-hidden="true">
      <span className="lp-track__rail" />
      {huong !== "flat" && (
        <span className="lp-track__span" style={{ left: `${Math.min(dau, nay)}%`, width: `${Math.abs(nay - dau)}%` }} />
      )}
      {huong !== "flat" && <span className="lp-track__first" style={{ left: `${dau}%` }} />}
      <span className="lp-track__now" style={{ left: `${nay}%` }} />
    </div>
  );
}

export default function LearningProgress() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loc, setLoc] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overview, concepts, attempts, documents] = await Promise.all([
        getProgressOverview(),
        getProgressConcepts(),
        getProgressAttempts({ limit: 20 }),
        // Titles only; a library failure must not hide the learner's own results.
        getLibrary().catch(() => []),
      ]);
      setData({ overview, concepts, attempts, documents });
    } catch (e) {
      setError(moTaLoi(e, "Không tải được tiến độ học."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const concepts = useMemo(() => data?.concepts || [], [data]);
  const soCanOn = concepts.filter((c) => c.status !== "mastered").length;
  const locDangChon = loc || (soCanOn ? "can-on" : "tat-ca");
  const nhom = useMemo(
    () => nhomTheoTaiLieu(locKhaiNiem(concepts, locDangChon), data?.documents),
    [concepts, locDangChon, data],
  );
  const dem = { "can-on": soCanOn, "da-nam": concepts.length - soCanOn, "tat-ca": concepts.length };
  const attempts = data?.attempts || [];
  const thesis = data ? tomTatTienDo(data.overview, concepts) : null;

  return (
    <StudyShell
      eyebrow="Tiến độ"
      title="Tiến độ học"
      subtitle={null}
      backTo="/app/study"
      loading={loading}
      error={error && !data ? error : null}
      onRetry={load}
      width="max-w-[880px]"
    >
      {data && (
        <div className="lp-page">
          {thesis ? (
            <p className="lp-thesis font-display">{thesis}</p>
          ) : (
            <div className="lp-empty">
              <p className="lp-thesis font-display">Chưa có bài nào được chấm.</p>
              <p className="text-body text-text-secondary">
                Làm một bài kiểm tra từ tài liệu: mức nắm từng khái niệm sẽ hiện ở đây sau khi chấm.
              </p>
              <Link to="/app/study" className="btn-seal mt-4 inline-flex">Chọn tài liệu để kiểm tra</Link>
            </div>
          )}

          {concepts.length > 0 && (
            <section className="lp-section" aria-labelledby="lp-concepts">
              <div className="lp-section__head">
                <h2 id="lp-concepts" className="lp-h2 font-display">Mức nắm từng khái niệm</h2>
                <div role="group" aria-label="Lọc khái niệm" className="lp-filter">
                  {LOC.map((o) => (
                    <button key={o.id} type="button" aria-pressed={locDangChon === o.id}
                      className="lp-filter__opt" onClick={() => setLoc(o.id)}>
                      {o.nhan} <span className="lp-filter__n">{dem[o.id]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <p className="lp-legend text-small text-text-muted">
                Chấm rỗng: lần đầu làm bài. Chấm đặc: kết quả gần nhất.
              </p>
              {nhom.length === 0 && (
                <p className="text-body text-text-secondary">Không có khái niệm nào trong mục này.</p>
              )}
              {nhom.map((g) => (
                <div key={g.documentId || g.ten} className="lp-doc">
                  <h3 className="lp-doc__title">
                    {g.documentId
                      ? <Link to={`/app/study/map/${encodeURIComponent(g.documentId)}`}>{g.ten}</Link>
                      : g.ten}
                  </h3>
                  <ul className="lp-concepts">
                    {g.khaiNiem.map((c) => (
                      <li key={c.concept_name} className="lp-concept" data-status={c.status}>
                        <div className="lp-concept__text">
                          <span className="lp-concept__name">{c.concept_name}</span>
                          <span className="lp-concept__meta">
                            {MASTERY_LABEL[c.status] || c.status}. {moTaKhaiNiem(c)}
                          </span>
                        </div>
                        <MasteryTrack first={c.first_mastery_score} current={c.mastery_score} />
                        {c.status !== "mastered" && c.last_attempt_id && (
                          <Link className="lp-concept__action"
                            to={`/app/study/review/${encodeURIComponent(c.last_attempt_id)}`}
                            aria-label={`Ôn lại ${c.concept_name}`}>
                            Ôn lại
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}

          {attempts.length > 0 && (
            <section className="lp-section" aria-labelledby="lp-attempts">
              <h2 id="lp-attempts" className="lp-h2 font-display">Bài đã làm</h2>
              <ol className="lp-attempts">
                {attempts.map((a) => {
                  const b = baiLam(a);
                  return (
                    <li key={a.attempt_id} className="lp-attempt">
                      <span className="lp-attempt__date">{ngayLam(a)}</span>
                      <span className="lp-attempt__title">
                        {a.quiz_title || "Bài không tên"}
                        <span className="lp-attempt__type">{b.loai}</span>
                      </span>
                      <span className="lp-attempt__result" data-provisional={b.tamTinh || undefined}>
                        {b.ketQua}
                        {a.duration_seconds != null && a.status === "graded" && (
                          <span className="lp-attempt__time">{formatDuration(a.duration_seconds)}</span>
                        )}
                      </span>
                      {b.den && (
                        <Link className="lp-attempt__action" to={b.den}
                          aria-label={`${b.nhanDen}: ${a.quiz_title || "bài không tên"}`}>
                          {b.nhanDen}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </div>
      )}
    </StudyShell>
  );
}
