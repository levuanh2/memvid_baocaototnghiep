import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import StudyShell, { EmptyState } from "../../components/study/StudyShell";
import LearningHome from "../../components/study/LearningHome";
import { useAuth } from "../../auth/useAuth";
import { useOpenSurface } from "../../study/useOpenSurface";
import {
  MASTERY_LABEL, attemptScoreLabel, getLibrary, getProgressAttempts, getProgressConcepts,
  getProgressOverview, moTaLoi,
} from "../../utils/studyApi";
import { chiaMuc, coTheTiepTuc, loc, sapXep } from "../../utils/thuVienTaiLieu";
import "./dashboard.css";

// V9.3 P3b — Tổng quan: what to do next, from real data only (owner brief; docs/StudyMap-V9.3
// 01, 05, 12). The library answers "where is it", this page "what now". Sources: /api/library
// and /api/progress/{overview,concepts,attempts}. Deliberately absent: reading time (no API
// records it), a mastery percentage (concept statuses are words), a weekly chart (attempts
// come capped, so a "week" from them would be a partial history presented as a whole one).

const SO_BAI_GAN_NHAT = 5;

export default function Dashboard() {
  const { user } = useAuth();
  const moBeMat = useOpenSurface();
  const [thuVien, setThuVien] = useState({ dangTai: true, loi: null, documents: [] });
  const [tienDo, setTienDo] = useState({ dangTai: true });
  // One counter per source: a response that comes back after a newer request for the same
  // source (a retry, or another account) is dropped instead of overwriting the newer one.
  const luotThuVien = useRef(0);
  const luotTienDo = useRef(0);

  const taiThuVien = useCallback(async () => {
    const luot = ++luotThuVien.current;
    setThuVien((t) => ({ ...t, dangTai: true, loi: null }));
    try {
      const { documents } = await getLibrary({ kemBoSuuTap: true });
      if (luot === luotThuVien.current) setThuVien({ dangTai: false, loi: null, documents });
    } catch (e) {
      if (luot === luotThuVien.current) {
        setThuVien({ dangTai: false, loi: moTaLoi(e, "Không tải được thư viện tài liệu."), documents: [] });
      }
    }
  }, []);

  const taiTienDo = useCallback(async () => {
    const luot = ++luotTienDo.current;
    setTienDo({ dangTai: true });
    const [ov, kn, bl] = await Promise.allSettled([
      getProgressOverview(),
      getProgressConcepts({ weakOnly: true }),
      getProgressAttempts({ limit: SO_BAI_GAN_NHAT }),
    ]);
    if (luot !== luotTienDo.current) return;
    const gia = (r) => (r.status === "fulfilled" ? r.value : null);
    setTienDo({ dangTai: false, overview: gia(ov), concepts: gia(kn), attempts: gia(bl) });
  }, []);

  useEffect(() => {
    taiThuVien();
    taiTienDo();
  }, [user?.id, taiThuVien, taiTienDo]);

  const documents = thuVien.documents;
  const mucHienThi = useMemo(() => chiaMuc(sapXep(loc(documents), "newest")), [documents]);
  const coTiepTuc = Boolean(mucHienThi.tiepTucHoc && coTheTiepTuc(mucHienThi.tiepTucHoc));
  const ten = user?.display_name?.trim();

  return (
    <StudyShell
      title="Tổng quan"
      subtitle={`Chào ${ten || "bạn"}. Đây là việc nên làm tiếp với các tài liệu của bạn.`}
      backTo="/app/study"
      backLabel="Thư viện"
      loading={thuVien.dangTai}
      error={thuVien.loi}
      onRetry={() => taiThuVien()}
      actions={documents.length > 0 && (
        // One filled action per page: the resume button below when there is one to continue.
        <Link to="/app/study" className={`${coTiepTuc ? "btn-secondary" : "btn-seal"} text-small`}>
          Mở thư viện
        </Link>
      )}
    >
      {documents.length === 0 ? (
        <EmptyState
          icon="Upload"
          title="Chưa có tài liệu nào"
          hint="Tóm tắt, sơ đồ và quiz đều dựng từ tài liệu bạn tải lên ở Thư viện."
          action={<Link to="/app/study" className="btn-seal text-small mt-1">Tải tài liệu lên ở Thư viện</Link>}
        />
      ) : (
        // No `overview`: the quiz average is shown once, in "Kết quả luyện tập" below.
        <LearningHome documents={documents} mucHienThi={mucHienThi}
          overview={null} onMo={(doc, beMat) => moBeMat(doc, beMat)} />
      )}

      <KetQuaLuyenTap tienDo={tienDo} onThuLai={taiTienDo} />
      {!tienDo.dangTai && <CanCungCo tienDo={tienDo} />}
      {!tienDo.dangTai && tienDo.attempts?.length > 0 && <BaiGanNhat attempts={tienDo.attempts} />}
    </StudyShell>
  );
}

function KetQuaLuyenTap({ tienDo, onThuLai }) {
  const ov = tienDo.overview;
  return (
    <section className="dash-section" aria-labelledby="dash-practice" aria-busy={tienDo.dangTai || undefined}>
      <h2 id="dash-practice" className="dash-h2">Kết quả luyện tập</h2>
      {tienDo.dangTai ? (
        <p className="dash-note">Đang tải số liệu luyện tập…</p>
      ) : !ov ? (
        <div className="dash-note dash-note--error" role="alert">
          <span>Chưa tải được số liệu luyện tập. Phần tài liệu ở trên vẫn dùng được.</span>
          <button type="button" className="btn-secondary text-small" onClick={onThuLai}>Thử lại</button>
        </div>
      ) : !ov.attempt_count ? (
        <p className="dash-note">
          Chưa làm bài nào. Tạo một quiz từ tài liệu đã sẵn sàng để thấy kết quả ở đây.{" "}
          <Link to="/app/study/quiz/new" className="dash-link">Tạo quiz</Link>
        </p>
      ) : (
        <>
          <dl className="dash-stats">
            <div>
              <dt>Bài đã làm</dt>
              <dd className="dash-num">{ov.attempt_count}</dd>
              <dd className="dash-def">Mọi lần làm quiz, kể cả bài chưa chấm xong.</dd>
            </div>
            <div>
              <dt>Điểm trung bình</dt>
              <dd className="dash-num">
                {ov.average_percentage != null ? `${ov.average_percentage}% điểm` : "Chưa có bài chấm xong"}
              </dd>
              <dd className="dash-def">Chỉ tính các bài đã chấm xong.</dd>
            </div>
            {(ov.mastered_concept_count != null || ov.weak_concept_count != null) && <div>
              <dt>Khái niệm</dt>
              <dd className="dash-num">
                {ov.mastered_concept_count ?? 0} đã nắm, {ov.weak_concept_count ?? 0} cần củng cố
              </dd>
              <dd className="dash-def">Theo kết quả quiz mới nhất của từng khái niệm.</dd>
            </div>}
          </dl>
          <Link to="/app/study/progress" className="dash-link">Xem tiến độ từng khái niệm</Link>
        </>
      )}
    </section>
  );
}

function CanCungCo({ tienDo }) {
  if (tienDo.concepts === null) {
    // The overview may have loaded; only this list failed. Say which part is missing.
    return tienDo.overview ? (
      <section className="dash-section" aria-labelledby="dash-weak">
        <h2 id="dash-weak" className="dash-h2">Cần củng cố</h2>
        <p className="dash-note">Chưa tải được danh sách khái niệm cần củng cố.</p>
      </section>
    ) : null;
  }
  if (!tienDo.concepts.length) return null;
  return (
    <section className="dash-section" aria-labelledby="dash-weak">
      <h2 id="dash-weak" className="dash-h2">Cần củng cố</h2>
      <ul className="dash-list">
        {tienDo.concepts.slice(0, 4).map((c) => (
          <li key={c.concept_name}>
            <span className="dash-list__name">{c.concept_name}</span>
            <span className="dash-list__meta">
              {MASTERY_LABEL[c.status] || c.status}
              {c.attempt_count > 1 ? `, qua ${c.attempt_count} lần làm` : ""}
            </span>
          </li>
        ))}
      </ul>
      <div className="dash-actions">
        <Link to="/app/study/quiz/new" className="btn-secondary text-small">Luyện tập</Link>
        <Link to="/app/study/progress" className="dash-link">Xem tất cả khái niệm</Link>
      </div>
    </section>
  );
}

function BaiGanNhat({ attempts }) {
  return (
    <section className="dash-section" aria-labelledby="dash-attempts">
      <h2 id="dash-attempts" className="dash-h2">Bài làm gần nhất</h2>
      <p className="dash-def">Tối đa {SO_BAI_GAN_NHAT} bài mới nhất, không phải toàn bộ lịch sử.</p>
      <ul className="dash-list">
        {attempts.map((a) => (
          <li key={a.attempt_id}>
            <Link className="dash-list__row"
              to={a.status === "graded" ? `/app/study/result/${a.attempt_id}` : `/app/study/quiz/${a.quiz_id}`}>
              <span className="dash-list__name">{a.quiz_title}</span>
              <span className="dash-list__meta">
                {a.status === "graded" ? attemptScoreLabel(a) : "Chưa nộp"}
                {a.submitted_at ? `, ${new Date(a.submitted_at).toLocaleDateString("vi-VN")}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
