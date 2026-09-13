import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import StudyShell, { EmptyState } from "../../components/study/StudyShell";
import StudyCard from "../../components/study/StudyCard";
import AiInsightCard from "../../components/study/AiInsightCard";
import LearningDashboard from "../../components/study/LearningDashboard";
import CollectionSidebar from "../../components/study/CollectionSidebar";
import BulkBar from "../../components/study/BulkBar";
import SealMeter from "../../components/study/SealMeter";
import { Icon } from "../../components/ui/Icon";
import Spinner from "../../components/ui/Spinner";
import {
  MASTERY_LABEL, bulkDocuments, createCollection, deleteCollection, formatScore,
  getLibrary, getProgressAttempts, getProgressConcepts, getProgressOverview,
  patchCollection, patchDocument, uploadDocument, moTaLoi,
} from "../../utils/studyApi";
import { tim, loc, sapXep, chiaMuc } from "../../utils/thuVienTaiLieu";
import { docJobDangChay } from "../../utils/trangThaiAi";
import { chonTaiLieuDemo, beMatDemoDauTien } from "../../utils/demoMode";
import { useOpenSurface } from "../../study/useOpenSurface";
import { apDungLacQuan } from "../../utils/doiTen";
import { daDong, dongInsight } from "../../utils/aiInsight";
import { chiMucBoSuuTap, boSuuTapCua, boSuuTapChoThanhBen, theChoThanhBen }
  from "../../utils/boSuuTap";
import {
  batTat as batTatChon, chonTatCa, daChonHet, locTheoHienThi, phimDanhSach,
  thanRequest, thayDoiLacQuan, xoaChon,
} from "../../utils/chonNhieu";
import { trangThaiRong, nguCanhTuBoLoc } from "../../utils/trangThaiRong";

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
    <h2 className="font-mono text-metadata uppercase text-text-muted mb-3">
      {children}{dem != null ? ` (${dem})` : ""}
    </h2>
  );
}

export default function DocumentList() {
  const moTheoDoi = useOpenSurface();
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

  // Phase 1B. `collections` là nguồn DUY NHẤT của tên/màu bộ sưu tập — tài liệu chỉ
  // mang `collection_id`, nên không có bản sao nào để lệch.
  const [collections, setCollections] = useState([]);
  const [chonBoSuuTap, setChonBoSuuTap] = useState(null);
  const [chonThe, setChonThe] = useState([]);
  const [daChon, setDaChon] = useState(() => new Set());
  const [dangChayBulk, setDangChayBulk] = useState(false);
  const [chiSoFocus, setChiSoFocus] = useState(-1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Thư viện là thứ trang này TỒN TẠI để hiện; ba khối tiến độ là phần thêm.
      // `allSettled` để một cú 500 của /api/progress/* không xoá sạch trang.
      const [thuVien, ov, concepts, history] = await Promise.allSettled([
        getLibrary({ kemBoSuuTap: true }),
        getProgressOverview(),
        getProgressConcepts({ weakOnly: true }),
        getProgressAttempts({ limit: 5 }),
      ]);
      if (thuVien.status === "rejected") throw thuVien.reason;
      setDocuments(thuVien.value.documents);
      setCollections(thuVien.value.collections);
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
  // Định tuyến + ghi mốc mở sống trong `useOpenSurface()` (Phase 7 — Command
  // Palette dùng CHUNG hook này, đúng một chỗ định nghĩa "mở nghĩa là gì"). Còn
  // lại ở đây CHỈ là cập nhật lạc quan cho danh sách trang này đang hiển thị.
  const moBeMat = useCallback((doc, beMat, context) => {
    if (!moTheoDoi(doc, beMat, context)) return;
    setDocuments((prev) => prev.map((d) => d.document_id === doc.document_id
      ? { ...d, last_opened_at: new Date().toISOString(), last_workspace: beMat }
      : d));
  }, [moTheoDoi]);

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

  // ── Bộ sưu tập ────────────────────────────────────────────────────────────
  const taiLaiBoSuuTap = useCallback(async (ham, thongBaoLoi) => {
    setLoiThaoTac(null);
    try {
      return await ham();
    } catch (err) {
      setLoiThaoTac(moTaLoi(err, thongBaoLoi));
      return null;
    }
  }, []);

  const taoBoSuuTap = useCallback(async (v) => {
    const moi = await taiLaiBoSuuTap(() => createCollection(v),
                                     "Không tạo được bộ sưu tập.");
    if (moi) setCollections((prev) => [...prev, { ...moi, hien_thi_count: 0 }]);
  }, [taiLaiBoSuuTap]);

  const suaBoSuuTap = useCallback(async (c, v) => {
    const moi = await taiLaiBoSuuTap(() => patchCollection(c.collection_id, v),
                                     "Không lưu được bộ sưu tập.");
    if (moi) {
      setCollections((prev) => prev.map((x) =>
        x.collection_id === c.collection_id ? { ...x, ...moi } : x));
    }
  }, [taiLaiBoSuuTap]);

  const xoaBoSuuTap = useCallback(async (c) => {
    if (!window.confirm(
      `Xoá bộ sưu tập "${c.name}"? Tài liệu bên trong KHÔNG bị xoá, chúng trở về "chưa phân loại".`)) {
      return;
    }
    const ok = await taiLaiBoSuuTap(() => deleteCollection(c.collection_id),
                                    "Không xoá được bộ sưu tập.");
    if (!ok) return;
    setCollections((prev) => prev.filter((x) => x.collection_id !== c.collection_id));
    // Tài liệu rơi về "chưa phân loại" — phản chiếu ngay `ON DELETE SET NULL` của
    // máy chủ để màn hình không hiện một bộ sưu tập vừa biến mất.
    setDocuments((prev) => prev.map((d) =>
      d.collection_id === c.collection_id ? { ...d, collection_id: null } : d));
    if (chonBoSuuTap === c.collection_id) setChonBoSuuTap(null);
  }, [taiLaiBoSuuTap, chonBoSuuTap]);

  // ── Hàng loạt ─────────────────────────────────────────────────────────────
  const chayBulk = useCallback(async (hanhDong, kem) => {
    const than = thanRequest(hanhDong, [...daChon], kem);
    if (!than) return;
    setDangChayBulk(true);
    setLoiThaoTac(null);
    const lac = thayDoiLacQuan(hanhDong, kem);
    try {
      await bulkDocuments(than);
      if (lac) {
        // Áp được ngay thì áp — đỡ một vòng tải lại cho thao tác thường dùng nhất.
        const ids = new Set(than.document_ids);
        setDocuments((prev) => prev.map((d) =>
          ids.has(d.document_id) ? { ...d, ...lac } : d));
      } else {
        // Thẻ hợp nhất theo TẬP ở máy chủ và xoá đổi cả danh sách — đoán ở client là
        // đoán sai, nên tải lại thay vì hiện một trạng thái bịa.
        await load();
      }
      setDaChon(xoaChon());
    } catch (err) {
      setLoiThaoTac(moTaLoi(err, "Không áp dụng được thao tác."));
      await load().catch(() => {});
    } finally {
      setDangChayBulk(false);
    }
  }, [daChon, load]);

  const luuTen = useCallback(async (doc, ten) => {
    setDangLuu(true);
    await vaTaiLieu(doc, { display_name: ten }, { display_name: ten });
    setDangLuu(false);
    setDangDoiTen(null);
  }, [vaTaiLieu]);

  // ── Phép chiếu ────────────────────────────────────────────────────────────
  const chiMucBst = useMemo(() => chiMucBoSuuTap(collections), [collections]);

  const mucHienThi = useMemo(() => {
    const daLoc = loc(tim(documents, truyVan, chiMucBst), boLoc,
                      { hienLuuTru, collectionId: chonBoSuuTap, tags: chonThe });
    return chiaMuc(sapXep(daLoc, cheDoSap), { hienLuuTru });
  }, [documents, truyVan, chiMucBst, boLoc, hienLuuTru, chonBoSuuTap, chonThe, cheDoSap]);

  // Demo Mode (Phase 6, Step 4) — tài liệu THẬT tốt nhất để xem thử ngay, từ
  // TOÀN BỘ thư viện (không qua bộ lọc/tìm kiếm đang bật — "Xem thử" phải luôn
  // hoạt động bất kể người dùng đang lọc gì). `null` → ẩn nút, không demo rỗng.
  const taiLieuDemo = useMemo(() => chonTaiLieuDemo(documents), [documents]);

  const thanhBen = useMemo(
    () => boSuuTapChoThanhBen(collections, documents, { hienLuuTru }),
    [collections, documents, hienLuuTru]);
  const theThanhBen = useMemo(
    () => theChoThanhBen(documents, { hienLuuTru }), [documents, hienLuuTru]);

  // Lựa chọn phải theo kịp bộ lọc: một tài liệu đã lọc đi mà còn trong lựa chọn thì
  // "Xoá 3 tài liệu" xoá một thứ người dùng không nhìn thấy.
  useEffect(() => {
    setDaChon((prev) => (prev.size ? locTheoHienThi(prev, mucHienThi.tatCa) : prev));
  }, [mucHienThi.tatCa]);

  const docVuaTai = idVuaTai
    ? documents.find((d) => d.document_id === idVuaTai) || null
    : null;
  const hienInsight = (uploading || (docVuaTai && !daDong(idVuaTai)));

  // Roving tabindex: đúng MỘT thẻ nhận Tab, mũi tên đi giữa các thẻ. Cho mọi thẻ
  // `tabIndex=0` thì người dùng bàn phím phải Tab 300 lần để đi qua thư viện.
  const xuLyPhim = (e, doc, chiSo) => {
    const kq = phimDanhSach(e, { chiSo, tong: mucHienThi.tatCa.length });
    if (!kq) return;
    e.preventDefault();
    if (kq.loai === "focus") setChiSoFocus(kq.chiSo);
    else if (kq.loai === "chon") setDaChon((prev) => batTatChon(prev, doc.document_id));
    else if (kq.loai === "mo") moBeMat(doc, doc.last_workspace || "studymap");
    else if (kq.loai === "xoa_chon") setDaChon(xoaChon());
  };

  const veThe = (doc, chiSo = null) => (
    <StudyCard
      key={doc.document_id}
      doc={doc}
      documents={documents}
      chiMucBst={chiMucBst}
      jobs={jobs}
      boSuuTap={boSuuTapCua(doc, chiMucBst)}
      dangDoiTen={dangDoiTen === doc.document_id}
      dangLuu={dangLuu}
      onDoiTen={setDangDoiTen}
      onLuuTen={(ten) => luuTen(doc, ten)}
      onHuyDoiTen={() => setDangDoiTen(null)}
      onBatTat={batTat}
      onMo={moBeMat}
      daChon={daChon.has(doc.document_id)}
      onChon={(id) => setDaChon((prev) => batTatChon(prev, id))}
      tabIndex={chiSo == null ? undefined : (chiSo === Math.max(0, chiSoFocus) ? 0 : -1)}
      onKeyDown={chiSo == null ? undefined : (e) => xuLyPhim(e, doc, chiSo)}
    />
  );

  // Mục rỗng KHÔNG được dựng — một mục "Cần tóm tắt" trống chỉ thêm nhiễu.
  const muc = [
    ["Đã ghim", mucHienThi.daGhim],
    ["Yêu thích", mucHienThi.yeuThich],
    ["Hôm nay", mucHienThi.homNay],
    ["Hôm qua", mucHienThi.homQua],
    ["Tuần này", mucHienThi.tuanNay],
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
          <button type="button" className="btn-seal text-small inline-flex items-center gap-2"
            disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <><Spinner size={13} /> Đang tải lên…</> : <><Icon name="Upload" size={14} /> Tải tài liệu</>}
          </button>
          {/* Demo Mode — chỉ hiện khi có tài liệu THẬT đủ sẵn sàng; không có thì
              không vẽ nút, không hứa một bản xem thử không tồn tại. */}
          {taiLieuDemo && (
            <button type="button" className="pill-action text-small inline-flex items-center gap-1.5"
              title="Mở ngay một tài liệu đã sẵn sàng để xem thử Tóm tắt/Sơ đồ/Gia sư AI"
              onClick={() => moBeMat(taiLieuDemo, beMatDemoDauTien(taiLieuDemo))}>
              <Icon name="Sparkles" size={13} /> Xem thử
            </button>
          )}
        </>
      }
    >
      <div className="flex gap-6 items-start">
      <CollectionSidebar
        boSuuTap={thanhBen.boSuuTap}
        chuaPhanLoai={thanhBen.chuaPhanLoai}
        the={theThanhBen}
        chon={{ collectionId: chonBoSuuTap, tags: chonThe, khoa: boLoc }}
        onChon={(v) => {
          setChonBoSuuTap(v.collectionId ?? null);
          setChonThe(v.tags || []);
          if (v.khoa) setBoLoc((prev) => (prev.join() === v.khoa.join() ? [] : v.khoa));
        }}
        onTao={taoBoSuuTap}
        onSua={suaBoSuuTap}
        onXoa={xoaBoSuuTap}
        hienLuuTru={hienLuuTru}
        onHienLuuTru={setHienLuuTru}
      />

      <div className="min-w-0 flex-1">
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
        <div role="alert" className="mb-4 text-small flex items-start gap-1.5"
             style={{ color: "var(--err)" }}>
          <Icon name="AlertCircle" size={13} className="mt-0.5 shrink-0" />
          <span>{loiThaoTac}</span>
        </div>
      )}

      {overview && <Overview overview={overview} />}

      <BulkBar
        so={daChon.size}
        boSuuTap={thanhBen.boSuuTap}
        dangChay={dangChayBulk}
        onHanhDong={chayBulk}
        onXoaChon={() => setDaChon(xoaChon())}
      />

      {/* Thanh công cụ */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="header-search !rounded-control !min-w-0 !px-3 !py-2 flex-1 min-w-[200px]">
          <Icon name="Search" size={14} className="text-text-muted flex-shrink-0" />
          <input
            type="text" value={truyVan} onChange={(e) => setTruyVan(e.target.value)}
            placeholder="Tìm theo tên, thẻ, ý chính, thực thể…"
            aria-label="Tìm trong thư viện"
            className="bg-transparent outline-none text-small text-text-primary placeholder:text-text-muted w-full"
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
                className="rounded-control px-2.5 py-2 text-small outline-none"
                style={{ background: "var(--bg-card)", color: "var(--text-primary)",
                         border: "1px solid var(--border-color)" }}>
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
              <div className="absolute right-0 top-10 z-20 w-[230px] rounded-[8px] p-3 shadow-card-hover"
                   style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}>
                {NHOM_LOC.map(([nhom, mucLoc]) => (
                  <div key={nhom} className="mb-2.5 last:mb-0">
                    <div className="font-mono text-metadata uppercase text-text-muted mb-1">
                      {nhom}
                    </div>
                    {mucLoc.map(([khoa, nhan]) => (
                      <label key={khoa} className="flex items-center gap-2 py-[3px] cursor-pointer">
                        <input type="checkbox" className="w-3.5 h-3.5 accent-forest rounded"
                               checked={boLoc.includes(khoa)}
                               onChange={(e) => setBoLoc((prev) => e.target.checked
                                 ? [...prev, khoa] : prev.filter((k) => k !== khoa))} />
                        <span className="text-small text-text-secondary">{nhan}</span>
                      </label>
                    ))}
                  </div>
                ))}
                {boLoc.length > 0 && (
                  <button type="button" onClick={() => setBoLoc([])}
                          className="mt-1 text-small text-forest">Xoá bộ lọc</button>
                )}
              </div>
            </>
          )}
        </div>

        <label className="flex items-center gap-2 cursor-pointer px-1">
          <input type="checkbox" checked={hienLuuTru}
                 onChange={(e) => setHienLuuTru(e.target.checked)}
                 className="w-3.5 h-3.5 accent-forest rounded" />
          <span className="text-small text-text-secondary">Hiện đã lưu trữ</span>
        </label>

        {mucHienThi.tatCa.length > 0 && (
          <label className="flex items-center gap-2 cursor-pointer px-1">
            <input
              type="checkbox"
              checked={daChonHet(daChon, mucHienThi.tatCa)}
              onChange={(e) => setDaChon(e.target.checked
                ? chonTatCa(mucHienThi.tatCa) : xoaChon())}
              className="w-3.5 h-3.5 accent-forest rounded"
            />
            {/* Nói rõ phạm vi: "tất cả" ở đây là những gì ĐANG hiện, không phải cả
                thư viện — chọn 300 tài liệu đang ẩn rồi xoá là mất dữ liệu. */}
            <span className="text-small text-text-secondary">
              Chọn {mucHienThi.tatCa.length} đang hiện
            </span>
          </label>
        )}
      </div>

      {documents.length > 0 && (
        <LearningDashboard
          documents={documents}
          overview={overview}
          weak={weak}
          attempts={attempts}
          mucHienThi={mucHienThi}
          onMo={moBeMat}
        />
      )}

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
                  <div className="font-display text-body font-semibold text-text-primary truncate">
                    {c.concept_name}
                  </div>
                  <div className="text-small text-text-secondary">
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
          // "Chưa có gì", "không khớp bộ lọc" và "mục này trống" là BA màn hình khác
          // nhau. Gộp chúng làm người có đủ tài liệu đọc thành "thư viện trống" rồi
          // đi tải lên lại từ đầu.
          (() => {
            const rong = trangThaiRong(
              documents.length === 0
                ? "thu_vien"
                : nguCanhTuBoLoc({ collectionId: chonBoSuuTap, tags: chonThe,
                                   khoa: boLoc, truyVan }),
              { coTaiLieu: documents.length > 0 });
            return (
              <EmptyState
                icon={rong.icon}
                title={rong.tieuDe}
                hint={rong.goiY}
                action={rong.hanhDong ? (
                  <button
                    type="button"
                    className={rong.khoaHanhDong === "tai_len"
                      ? "btn-seal text-small mt-1 disabled:opacity-60" : "pill-action mt-1"}
                    disabled={rong.khoaHanhDong === "tai_len" && uploading}
                    onClick={() => {
                      if (rong.khoaHanhDong === "tai_len") return fileRef.current?.click();
                      setTruyVan("");
                      setBoLoc([]);
                      setChonBoSuuTap(null);
                      setChonThe([]);
                    }}
                  >
                    {rong.khoaHanhDong === "tai_len" && uploading
                      ? "Đang tải lên…" : rong.hanhDong}
                  </button>
                ) : null}
              />
            );
          })()
        ) : (
          <div className="flex flex-col gap-2.5" role="listbox"
               aria-label="Danh sách tài liệu" aria-multiselectable="true">
            {mucHienThi.tatCa.map((d, i) => veThe(d, i))}
          </div>
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
                  <div className="text-body font-semibold text-text-primary truncate">
                    {a.quiz_title}
                  </div>
                  <div className="font-mono text-caption text-text-muted mt-0.5">
                    {a.quiz_type === "practice" ? "luyện tập" : "chẩn đoán"}
                    {a.submitted_at ? ` · ${new Date(a.submitted_at).toLocaleDateString("vi-VN")}` : ""}
                  </div>
                </div>
                <span className="font-mono text-small text-text-secondary shrink-0">
                  {formatScore(a.score, a.max_score)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      </div>
      </div>
    </StudyShell>
  );
}

/* Sprint J (Hallmark critical finding C1): four equal `.surface-card` tiles,
   each a mono-uppercase label over a big number, is the single most
   recognizable "admin dashboard stat row" shape — independent of any
   color/font choice layered on top. Replaced with a status line: document
   count gets real visual priority (it's the number that orients the page),
   the other three read as a natural inline sentence, not a second row of
   boxes. Numbers stay mono/tabular per the Signature Contract's "numbers
   are the one cross-screen constant" rule — bronze, not the accent color,
   since these are data, not an action. */
function Overview({ overview }) {
  const items = [
    ["Quiz đã tạo", overview.quiz_count ?? 0],
    ["Bài đã làm", overview.attempt_count ?? 0],
    ["Điểm trung bình", overview.average_percentage == null ? "—" : `${overview.average_percentage}%`],
  ];
  return (
    <section className="mb-7 pb-5 border-b border-border flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
      <span className="font-mono text-h1 font-semibold tabular-nums" style={{ color: "var(--bronze)" }}>
        {overview.document_count ?? 0}
      </span>
      <span className="text-body-lg text-text-secondary mr-2">tài liệu</span>
      {items.map(([label, value], i) => (
        <span key={label} className="text-small text-text-muted">
          {i > 0 && <span className="mx-2.5" aria-hidden="true">·</span>}
          {label}{" "}
          <span className="font-mono tabular-nums" style={{ color: "var(--bronze)" }}>{value}</span>
        </span>
      ))}
    </section>
  );
}
