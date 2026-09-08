import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import StudyShell, { EmptyState } from "../../components/study/StudyShell";
import StudyCard from "../../components/study/StudyCard";
import AiInsightCard from "../../components/study/AiInsightCard";
import SealMeter from "../../components/study/SealMeter";
import { Icon } from "../../components/ui/Icon";
import Spinner from "../../components/ui/Spinner";
import {
  MASTERY_LABEL, formatScore, getLibrary, getProgressAttempts, getProgressConcepts,
  getProgressOverview, markOpened, patchDocument, uploadDocument, moTaLoi,
} from "../../utils/studyApi";
import { tim, loc, sapXep, chiaMuc } from "../../utils/thuVienTaiLieu";
import { docJobDangChay } from "../../utils/trangThaiAi";
import { duongDi } from "../../utils/tiepTucHoc";
import { apDungLacQuan } from "../../utils/doiTen";
import { daDong, dongInsight } from "../../utils/aiInsight";

// Thư viện học tập — mọi mục, bộ lọc và chế độ sắp đều là PHÉP CHIẾU của một
// payload `/api/library` duy nhất. Không có endpoint `/sections`, không có tìm
// kiếm phía máy chủ, không có lượt hỏi trạng thái theo từng tài liệu.

const CHE_DO_SAP = [
  ["newest", "Mới nhất"], ["oldest", "Cũ nhất"],
  ["az", "A-Z"], ["za", "Z-A"],
  ["reading_time", "Thời gian đọc"],
  ["recently_opened", "Mở gần đây"], ["recently_uploaded", "Tải lên gần đây"],
];

const NHOM_LOC = [
  ["Trạng thái", [["favorite", "Yêu thích"], ["pinned", "Đã ghim"],
                  ["archived", "Đã lưu trữ"]]],
  ["Định dạng", [["pdf", "PDF"], ["docx", "DOCX"], ["txt", "TXT"], ["image", "Ảnh"]]],
  ["Xử lý", [["completed", "Hoàn tất"], ["processing", "Đang xử lý"], ["failed", "Lỗi"]]],
  ["Đã có AI", [["summary_ready", "Tóm tắt"], ["mindmap_ready", "Sơ đồ tư duy"],
                ["studymap_ready", "Bản đồ học tập"], ["quiz_ready", "Quiz"],
                ["review_ready", "Ôn tập"]]],
];

function DocumentSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="surface-card !py-5 flex flex-col gap-3">
          <div className="h-[14px] rounded bg-surface-elevated animate-pulse"
               style={{ width: `${58 + i * 12}%` }} />
          <div className="h-[11px] w-[80%] rounded bg-surface-elevated animate-pulse" />
          <div className="h-[11px] w-[45%] rounded bg-surface-elevated animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ children, dem }) {
  return (
    <h2 className="font-mono text-[11px] tracking-[0.18em] uppercase text-text-muted mb-3">
      {children}{dem != null ? ` (${dem})` : ""}
    </h2>
  );
}

export default function DocumentList() {
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [documents, setDocuments] = useState([]);
  const [overview, setOverview] = useState(null);
  const [weak, setWeak] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [tenDangTai, setTenDangTai] = useState("");
  const [idVuaTai, setIdVuaTai] = useState(null);

  const [truyVan, setTruyVan] = useState("");
  const [cheDoSap, setCheDoSap] = useState("newest");
  const [boLoc, setBoLoc] = useState([]);
  const [hienLuuTru, setHienLuuTru] = useState(false);
  const [moBangLoc, setMoBangLoc] = useState(false);
  const [dangDoiTen, setDangDoiTen] = useState(null);
  const [dangLuu, setDangLuu] = useState(false);
  const [loiThaoTac, setLoiThaoTac] = useState(null);

  // Job đang chạy ở MÁY NÀY — đọc một lần cho cả danh sách, không đọc theo từng thẻ.
  const [jobs, setJobs] = useState(() => docJobDangChay());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Thư viện là thứ trang này TỒN TẠI để hiện; ba khối tiến độ là phần thêm.
      // `allSettled` để một cú 500 của /api/progress/* không xoá sạch trang.
      const [thuVien, ov, concepts, history] = await Promise.allSettled([
        getLibrary(),
        getProgressOverview(),
        getProgressConcepts({ weakOnly: true }),
        getProgressAttempts({ limit: 5 }),
      ]);
      if (thuVien.status === "rejected") throw thuVien.reason;
      setDocuments(thuVien.value);
      setOverview(ov.status === "fulfilled" ? ov.value : null);
      setWeak(concepts.status === "fulfilled" ? concepts.value.slice(0, 4) : []);
      setAttempts(history.status === "fulfilled" ? history.value : []);
      setJobs(docJobDangChay());
    } catch (e) {
      setError(moTaLoi(e, "Không tải được thư viện tài liệu."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Upload ────────────────────────────────────────────────────────────────
  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setTenDangTai(file.name);
    setError(null);
    let taiLen;
    try {
      taiLen = await uploadDocument(file);
    } catch (err) {
      setError(moTaLoi(err, "Tải tài liệu lên thất bại."));
      setUploading(false);
      return;
    }
    // Lên xong rồi. `load()` hỏng SAU đó là lỗi tải lại, không phải lỗi tải lên —
    // gộp hai cái vào một `catch` thì file đã lên mà màn hình ghi "tải lên thất bại".
    setIdVuaTai(taiLen?.document_id || null);
    try {
      await load();
    } catch (err) {
      setError(moTaLoi(err, "Đã tải lên xong, nhưng chưa làm mới được danh sách."));
    } finally {
      setUploading(false);
    }
  };

  // ── Mở một bề mặt ─────────────────────────────────────────────────────────
  const moBeMat = useCallback((doc, beMat) => {
    const dich = duongDi(doc, beMat);
    if (!dich) return;
    // Bắn-và-quên: ghi mốc mở KHÔNG được chặn điều hướng. Người dùng bấm để đi,
    // không phải để chờ một lượt ghi siêu dữ liệu.
    markOpened(doc.document_id, beMat).catch(() => {});
    setDocuments((prev) => prev.map((d) => d.document_id === doc.document_id
      ? { ...d, last_opened_at: new Date().toISOString(), last_workspace: beMat }
      : d));
    navigate(dich);
  }, [navigate]);

  // ── Sửa siêu dữ liệu (lạc quan, có đường lùi) ─────────────────────────────
  const vaTaiLieu = useCallback(async (doc, thayDoi, hienThi) => {
    setLoiThaoTac(null);
    let hoanTacFn;
    setDocuments((prev) => {
      const { danhSachMoi, hoanTac } = apDungLacQuan(prev, doc.document_id, hienThi);
      hoanTacFn = hoanTac;
      return danhSachMoi;
    });
    try {
      const moi = await patchDocument(doc.document_id, thayDoi);
      setDocuments((prev) => prev.map((d) =>
        d.document_id === doc.document_id ? { ...d, ...moi, ai: d.ai } : d));
    } catch (err) {
      // Lùi về ĐÚNG giá trị cũ và nói ra. Báo thành công rồi để giá trị sai nằm lại
      // là kiểu nói dối rẻ nhất và hay gặp nhất.
      setDocuments((prev) => (hoanTacFn ? hoanTacFn(prev) : prev));
      setLoiThaoTac(moTaLoi(err, "Không lưu được thay đổi."));
    }
  }, []);

  const batTat = useCallback((doc, thayDoi) => {
    const hienThi = { ...thayDoi };
    if ("archived" in thayDoi) {
      hienThi.archived_at = thayDoi.archived ? new Date().toISOString() : null;
      delete hienThi.archived;
    }
    return vaTaiLieu(doc, thayDoi, hienThi);
  }, [vaTaiLieu]);

  const luuTen = useCallback(async (doc, ten) => {
    setDangLuu(true);
    await vaTaiLieu(doc, { display_name: ten }, { display_name: ten });
    setDangLuu(false);
    setDangDoiTen(null);
  }, [vaTaiLieu]);

  // ── Phép chiếu ────────────────────────────────────────────────────────────
  const mucHienThi = useMemo(() => {
    const daLoc = loc(tim(documents, truyVan), boLoc, { hienLuuTru });
    return chiaMuc(sapXep(daLoc, cheDoSap), { hienLuuTru });
  }, [documents, truyVan, boLoc, hienLuuTru, cheDoSap]);

  const docVuaTai = idVuaTai
    ? documents.find((d) => d.document_id === idVuaTai) || null
    : null;
  const hienInsight = (uploading || (docVuaTai && !daDong(idVuaTai)));

  const veThe = (doc) => (
    <StudyCard
      key={doc.document_id}
      doc={doc}
      jobs={jobs}
      dangDoiTen={dangDoiTen === doc.document_id}
      dangLuu={dangLuu}
      onDoiTen={setDangDoiTen}
      onLuuTen={(ten) => luuTen(doc, ten)}
      onHuyDoiTen={() => setDangDoiTen(null)}
      onBatTat={batTat}
      onMo={moBeMat}
    />
  );

  // Mục rỗng KHÔNG được dựng — một mục "Cần tóm tắt" trống chỉ thêm nhiễu.
  const muc = [
    ["Đã ghim", mucHienThi.daGhim],
    ["Yêu thích", mucHienThi.yeuThich],
    ["Học gần đây", mucHienThi.hocGanDay],
    ["Tải lên gần đây", mucHienThi.taiLenGanDay],
    ["Chưa mở bao giờ", mucHienThi.chuaMoBaoGio],
    ["Cần tóm tắt", mucHienThi.canTomTat],
    ["Cần sơ đồ", mucHienThi.canSoDo],
    ["Cần quiz", mucHienThi.canQuiz],
    ["Cần hướng dẫn ôn tập", mucHienThi.canOnTap],
  ].filter(([, ds]) => ds.length > 0);

  return (
    <StudyShell
      eyebrow="StudyMap"
      title="Thư viện học tập"
      subtitle="Mỗi tài liệu đã tải lên là một tài sản học tập — tóm tắt, sơ đồ, quiz và hướng dẫn ôn tập đều nằm ngay trên thẻ của nó."
      backTo="/app"
      backLabel="Phòng đọc"
      loading={loading}
      error={error}
      onRetry={load}
      skeleton={<DocumentSkeleton />}
      actions={
        <>
          {/* Danh sách này phải khớp formats.accept_attribute() của backend —
              BE/tests/test_upload_formats.py khoá lại để hai bên không lệch. */}
          <input ref={fileRef} type="file" className="hidden" onChange={onPick}
            accept=".bmp,.csv,.doc,.docx,.epub,.fb2,.gif,.htm,.html,.jpeg,.jpg,.json,.md,.mobi,.odp,.odt,.pdf,.png,.pptx,.rtf,.txt,.xlsx,.xps" />
          <button type="button" className="btn-seal text-[13px] inline-flex items-center gap-2"
            disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <><Spinner size={13} /> Đang tải lên…</> : <><Icon name="Upload" size={14} /> Tải tài liệu</>}
          </button>
        </>
      }
    >
      {hienInsight && (
        <AiInsightCard
          doc={docVuaTai}
          dangTai={uploading}
          tenTep={tenDangTai}
          onMo={moBeMat}
          onTaiLai={() => fileRef.current?.click()}
          onDong={() => { if (idVuaTai) dongInsight(idVuaTai); setIdVuaTai(null); }}
        />
      )}

      {loiThaoTac && (
        <div role="alert" className="mb-4 text-[12.5px] flex items-start gap-1.5"
             style={{ color: "var(--err)" }}>
          <Icon name="AlertCircle" size={13} className="mt-0.5 shrink-0" />
          <span>{loiThaoTac}</span>
        </div>
      )}

      {overview && <Overview overview={overview} />}

      {/* Thanh công cụ */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="header-search !rounded-[7px] !min-w-0 !px-3 !py-2 flex-1 min-w-[200px]">
          <Icon name="Search" size={14} className="text-text-muted flex-shrink-0" />
          <input
            type="text" value={truyVan} onChange={(e) => setTruyVan(e.target.value)}
            placeholder="Tìm theo tên, thẻ, ý chính, thực thể…"
            aria-label="Tìm trong thư viện"
            className="bg-transparent outline-none text-[13px] text-text-primary placeholder:text-text-muted w-full"
          />
          {truyVan && (
            <button onClick={() => setTruyVan("")} className="text-text-muted hover:text-text-primary"
                    aria-label="Xoá ô tìm kiếm">
              <Icon name="X" size={13} />
            </button>
          )}
        </div>

        <label className="sr-only" htmlFor="che-do-sap">Sắp xếp</label>
        <select id="che-do-sap" value={cheDoSap} onChange={(e) => setCheDoSap(e.target.value)}
                className="rounded-[7px] px-2.5 py-2 text-[13px] outline-none"
                style={{ background: "var(--bg-card)", color: "var(--text-primary)",
                         border: "1px solid var(--border)" }}>
          {CHE_DO_SAP.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>

        <div className="relative">
          <button type="button" onClick={() => setMoBangLoc((v) => !v)}
                  className="pill-action !py-2"
                  aria-expanded={moBangLoc}>
            <Icon name="Filter" size={13} /> Lọc{boLoc.length ? ` (${boLoc.length})` : ""}
          </button>
          {moBangLoc && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMoBangLoc(false)} />
              <div className="absolute right-0 top-10 z-20 w-[230px] rounded-[8px] p-3 shadow-lg"
                   style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
                {NHOM_LOC.map(([nhom, mucLoc]) => (
                  <div key={nhom} className="mb-2.5 last:mb-0">
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted mb-1">
                      {nhom}
                    </div>
                    {mucLoc.map(([khoa, nhan]) => (
                      <label key={khoa} className="flex items-center gap-2 py-[3px] cursor-pointer">
                        <input type="checkbox" className="w-3.5 h-3.5 accent-brand rounded"
                               checked={boLoc.includes(khoa)}
                               onChange={(e) => setBoLoc((prev) => e.target.checked
                                 ? [...prev, khoa] : prev.filter((k) => k !== khoa))} />
                        <span className="text-[12.5px] text-text-secondary">{nhan}</span>
                      </label>
                    ))}
                  </div>
                ))}
                {boLoc.length > 0 && (
                  <button type="button" onClick={() => setBoLoc([])}
                          className="mt-1 text-[12px] text-brand">Xoá bộ lọc</button>
                )}
              </div>
            </>
          )}
        </div>

        <label className="flex items-center gap-2 cursor-pointer px-1">
          <input type="checkbox" checked={hienLuuTru}
                 onChange={(e) => setHienLuuTru(e.target.checked)}
                 className="w-3.5 h-3.5 accent-brand rounded" />
          <span className="text-[12.5px] text-text-secondary">Hiện đã lưu trữ</span>
        </label>
      </div>

      {/* Tiếp tục học */}
      {mucHienThi.tiepTucHoc && (
        <section className="mb-7">
          <SectionTitle>Tiếp tục học</SectionTitle>
          {veThe(mucHienThi.tiepTucHoc)}
        </section>
      )}

      {weak.length > 0 && (
        <section className="mb-7">
          <SectionTitle>Đang yếu ở</SectionTitle>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {weak.map((c) => (
              <div key={c.concept_name} className="surface-card !p-3.5 flex items-center gap-3">
                <SealMeter score={c.mastery_score} status={c.status} size={40} />
                <div className="min-w-0">
                  <div className="font-display text-[14.5px] font-semibold text-text-primary truncate">
                    {c.concept_name}
                  </div>
                  <div className="text-[12px] text-text-secondary">
                    {MASTERY_LABEL[c.status] || c.status}
                    {c.attempt_count > 1 && ` · ${c.attempt_count} lần làm`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {muc.map(([ten, ds]) => (
        <section key={ten} className="mb-7">
          <SectionTitle dem={ds.length}>{ten}</SectionTitle>
          <div className="flex flex-col gap-2.5">{ds.map(veThe)}</div>
        </section>
      ))}

      <section className="mb-7">
        <SectionTitle dem={mucHienThi.tatCa.length}>Tất cả tài liệu</SectionTitle>
        {mucHienThi.tatCa.length === 0 ? (
          documents.length === 0 ? (
            <EmptyState
              icon="FileStack"
              title="Chưa có tài liệu nào"
              hint="Tải lên PDF, Word, PowerPoint, Excel, Markdown, EPUB hoặc ảnh chụp trang sách để bắt đầu."
              action={
                <button type="button" className="btn-seal text-[13px] mt-1 disabled:opacity-60"
                        disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? "Đang tải lên…" : "Tải tài liệu"}
                </button>
              }
            />
          ) : (
            // "Không khớp bộ lọc" và "chưa có gì" là hai màn hình khác nhau — gộp
            // chúng làm người có đủ tài liệu đọc thành "thư viện trống".
            <EmptyState
              icon="Search"
              title="Không có tài liệu nào khớp"
              hint="Thử bớt từ khoá hoặc bỏ bớt bộ lọc."
              action={
                <button type="button" className="pill-action mt-1"
                        onClick={() => { setTruyVan(""); setBoLoc([]); }}>
                  Xoá tìm kiếm và bộ lọc
                </button>
              }
            />
          )
        ) : (
          <div className="flex flex-col gap-2.5">{mucHienThi.tatCa.map(veThe)}</div>
        )}
      </section>

      {mucHienThi.daLuuTru.length > 0 && hienLuuTru && (
        <section className="mb-7">
          <SectionTitle dem={mucHienThi.daLuuTru.length}>Đã lưu trữ</SectionTitle>
          <div className="flex flex-col gap-2.5">{mucHienThi.daLuuTru.map(veThe)}</div>
        </section>
      )}

      {attempts.length > 0 && (
        <section>
          <SectionTitle>Bài đã làm gần đây</SectionTitle>
          <div className="flex flex-col gap-2">
            {attempts.map((a) => (
              <Link
                key={a.attempt_id}
                to={a.status === "graded" ? `/app/study/result/${a.attempt_id}` : `/app/study/quiz/${a.quiz_id}`}
                className="surface-card !p-3.5 flex items-center gap-3 hover:no-underline"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-text-primary truncate">
                    {a.quiz_title}
                  </div>
                  <div className="font-mono text-[11px] text-text-muted mt-0.5">
                    {a.quiz_type === "practice" ? "luyện tập" : "chẩn đoán"}
                    {a.submitted_at ? ` · ${new Date(a.submitted_at).toLocaleDateString("vi-VN")}` : ""}
                  </div>
                </div>
                <span className="font-mono text-[13px] text-text-secondary shrink-0">
                  {formatScore(a.score, a.max_score)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </StudyShell>
  );
}

function Overview({ overview }) {
  const items = [
    ["Tài liệu", overview.document_count],
    ["Quiz đã tạo", overview.quiz_count],
    ["Bài đã làm", overview.attempt_count],
    ["Điểm trung bình", overview.average_percentage == null ? "—" : `${overview.average_percentage}%`],
  ];
  return (
    <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-7">
      {items.map(([label, value]) => (
        <div key={label} className="surface-card !p-3.5">
          <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-text-muted">
            {label}
          </div>
          <div className="font-display text-[22px] font-semibold text-text-primary mt-1">
            {value ?? 0}
          </div>
        </div>
      ))}
    </section>
  );
}
