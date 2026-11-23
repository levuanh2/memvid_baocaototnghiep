import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import StudyShell, { EmptyState } from "../../components/study/StudyShell";
import StudyCard from "../../components/study/StudyCard";
import AiInsightCard from "../../components/study/AiInsightCard";
import CollectionSidebar from "../../components/study/CollectionSidebar";
import BulkBar from "../../components/study/BulkBar";
import UploadQueue from "../../components/study/UploadQueue";
import { kiemTraTep } from "../../utils/taiLenTep";
import LibraryTaskViews from "../../components/study/LibraryTaskViews";
import StudyDocumentActionRow from "../../components/study/StudyDocumentActionRow";
import DocumentKnowledgeDetails from "../../components/study/DocumentKnowledgeDetails";
import DestructiveConfirmDialog from "../../components/ui/DestructiveConfirmDialog";
import { Icon } from "../../components/ui/Icon";
import Spinner from "../../components/ui/Spinner";
import {
  bulkDocuments, createCollection, deleteCollection, getLibrary,
  patchCollection, patchDocument, uploadDocument, moTaLoi,
} from "../../utils/studyApi";
import { tim, loc, sapXep, chiaMuc, NHOM_THU_VIEN, laNhomThuVien, taiLieuTheoNhom, demTheoNhom, tenHienThi } from "../../utils/thuVienTaiLieu";
import { tiepTucHoc } from "../../utils/tiepTucHoc";
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
import {
  TASK_VIEW, effectiveBulkRequest, moveRovingDocumentId, projectLibrary, pruneSelection,
  resolveRovingDocumentId, sameSelection,
} from "../../utils/libraryActionMatrix";
import { isLibraryActionMatrixEnabled } from "../../utils/libraryActionMatrixFlag";
import {
  DEFAULT_LIBRARY_STATE, libraryStateStorageKey, parseLibraryState, serializeLibraryState,
} from "../../utils/libraryActionMatrixState";
import { useAuth } from "../../auth/useAuth";
import "../../components/study/libraryActionMatrix.css";

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
                ["studymap_ready", "Bản đồ kiến thức"], ["quiz_ready", "Quiz"],
                ["review_ready", "Ôn tập"]]],
];

// Frontend V2, Library wave — flat lookup so active filters can render as
// dismissable chips (Find-Open-Study-Review artifact, Phase A) without a
// second copy of the label list.
const NHAN_LOC = new Map(NHOM_LOC.flatMap(([, mucLoc]) => mucLoc));

// Same localStorage discipline as `memvidx.panels.v1` (hooks/panelLayout.js) and
// `memvidx.inspector.collapsed.v1` (knowledgeParts.jsx) — try/catch, fails silent.
const KHOA_MAT_DO = "memvidx.library.density.v1";
// Card renderer (V6): the chosen view, the search text and the scroll position survive leaving
// the Library (opening a document) and coming back, for this tab only.
const TIEN_TO_TRANG_THAI_THE = "memvidx.library.cards.v1";
function docTrangThaiThe(userId) {
  const macDinh = { nhom: "tat_ca", truyVan: "", scrollY: 0 };
  if (!userId) return macDinh;
  try {
    const raw = JSON.parse(sessionStorage.getItem(`${TIEN_TO_TRANG_THAI_THE}:${encodeURIComponent(userId)}`) || "{}");
    return {
      nhom: laNhomThuVien(raw.nhom) ? raw.nhom : "tat_ca",
      truyVan: typeof raw.truyVan === "string" ? raw.truyVan : "",
      scrollY: Number.isFinite(raw.scrollY) && raw.scrollY > 0 ? raw.scrollY : 0,
    };
  } catch { return macDinh; }
}
const LIBRARY_ACTION_MATRIX = isLibraryActionMatrixEnabled();

function docMatrixState(storageKey) {
  if (!LIBRARY_ACTION_MATRIX || !storageKey) return DEFAULT_LIBRARY_STATE;
  try { return parseLibraryState(sessionStorage.getItem(storageKey)); }
  catch { return DEFAULT_LIBRARY_STATE; }
}

function docBool(khoa, macDinh) {
  try {
    const raw = localStorage.getItem(khoa);
    return raw === null ? macDinh : raw === "1";
  } catch { return macDinh; }
}
function ghiBool(khoa, gia) {
  try { localStorage.setItem(khoa, gia ? "1" : "0"); } catch { /* riêng tư/đầy — bỏ qua */ }
}

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

export default function DocumentList() {
  const { user } = useAuth();
  const moTheoDoi = useOpenSurface();
  const fileRef = useRef(null);
  const matrixStorageKey = libraryStateStorageKey(user?.id);
  const matrixInitial = useRef(docMatrixState(matrixStorageKey)).current;
  const matrixPrimaryRefs = useRef(new Map());
  const matrixFallbackRef = useRef(null);
  const matrixListRef = useRef(null);
  const matrixScrollRestoredRef = useRef(false);

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [tenDangTai, setTenDangTai] = useState("");
  const [idVuaTai, setIdVuaTai] = useState(null);

  const theInitial = useRef(LIBRARY_ACTION_MATRIX ? null : docTrangThaiThe(user?.id)).current;
  const theScrollRestoredRef = useRef(false);
  const [nhom, setNhom] = useState(theInitial?.nhom || "tat_ca");
  const [truyVan, setTruyVan] = useState(theInitial ? theInitial.truyVan : matrixInitial.query);
  const [cheDoSap, setCheDoSap] = useState(matrixInitial.sort);
  const [boLoc, setBoLoc] = useState(matrixInitial.filterKeys);
  const [hienLuuTru, setHienLuuTru] = useState(matrixInitial.includeArchived);
  const [taskView, setTaskView] = useState(matrixInitial.view || TASK_VIEW.ALL);
  const [moBangLoc, setMoBangLoc] = useState(false);
  // Frontend V2, Library wave — density is a per-browser display preference
  // (Find-Open-Study-Review artifact, Phase B: "Denser cards? Yes, default
  // stays Comfortable"), read once at init like every other localStorage flag
  // in this app (panelLayout.js's own comment explains why init-time, not
  // an effect, is safe here: this is a pure SPA, no server render to fight).
  const [matDo, setMatDo] = useState(() => (docBool(KHOA_MAT_DO, false) ? "compact" : "comfortable"));
  const doiMatDo = useCallback(() => {
    setMatDo((prev) => {
      const next = prev === "compact" ? "comfortable" : "compact";
      ghiBool(KHOA_MAT_DO, next === "compact");
      return next;
    });
  }, []);
  const [dangDoiTen, setDangDoiTen] = useState(null);
  const [dangLuu, setDangLuu] = useState(false);
  const [loiThaoTac, setLoiThaoTac] = useState(null);
  // Its own state (Codex, #202): only a quiet refresh sets it and the next one clears it, so a
  // later successful refresh cannot leave a false "not refreshed" alert, and an unrelated
  // action error is never cleared by a refresh.
  const [loiLamMoi, setLoiLamMoi] = useState(null);

  // Job đang chạy ở MÁY NÀY — đọc một lần cho cả danh sách, không đọc theo từng thẻ.
  const [jobs, setJobs] = useState(() => docJobDangChay());

  // Phase 1B. `collections` là nguồn DUY NHẤT của tên/màu bộ sưu tập — tài liệu chỉ
  // mang `collection_id`, nên không có bản sao nào để lệch.
  const [collections, setCollections] = useState([]);
  const [chonBoSuuTap, setChonBoSuuTap] = useState(matrixInitial.collectionId);
  const [chonThe, setChonThe] = useState(matrixInitial.tags);
  const [daChon, setDaChon] = useState(() => new Set());
  const [dangChayBulk, setDangChayBulk] = useState(false);
  const [chiSoFocus, setChiSoFocus] = useState(-1);
  const [matrixFocusId, setMatrixFocusId] = useState(null);
  const [boSuuTapCanXoa, setBoSuuTapCanXoa] = useState(null);
  const [chiTietDoc, setChiTietDoc] = useState(null);

  // `yen` (quiet): refresh after an upload without the skeleton, and if it fails say so inline
  // instead of the page error. Both used to unmount the list, the upload queue with it, and
  // drop keyboard focus, and the page error made a successful upload look failed (Codex, #202).
  const load = useCallback(async ({ yen = false } = {}) => {
    setLoiLamMoi(null);
    if (!yen) { setLoading(true); setError(null); }
    try {
      // V9.3 P3b: the practice numbers, weak concepts and recent attempts live on the
      // dashboard now (/app/study/dashboard); the Library loads the library only.
      const thuVien = await getLibrary({ kemBoSuuTap: true });
      setDocuments(thuVien.documents);
      setCollections(thuVien.collections);
      setJobs(docJobDangChay());
    } catch (e) {
      if (yen) setLoiLamMoi(`Đã tải lên xong, nhưng chưa làm mới được danh sách. ${moTaLoi(e, "Hãy tải lại trang.")}`);
      else setError(moTaLoi(e, "Không tải được thư viện tài liệu."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Upload ────────────────────────────────────────────────────────────────
  // V9.3 P3a: several files per pick, each checked before sending (kiemTraTep), sent ONE AT
  // A TIME, each with its own status/error, and a failed one retried alone. A failed upload
  // no longer replaces the whole library with a page error: the other files and the list stay.
  const [hangTai, setHangTai] = useState([]);
  const tepTaiRef = useRef(new Map());
  const nutTaiRef = useRef(null);
  const capNhatTep = (khoa, thayDoi) =>
    setHangTai((prev) => prev.map((m) => (m.khoa === khoa ? { ...m, ...thayDoi } : m)));

  const chayHangTai = async (khoas) => {
    setUploading(true);
    // Codex P1 (#202): the insight card is about THIS batch. Left set, it named the previous
    // upload while a later file was sending, and stayed after a later batch failed entirely.
    setIdVuaTai(null);
    let idMoi = null;
    for (const khoa of khoas) {
      const tep = tepTaiRef.current.get(khoa);
      setTenDangTai(tep.name);
      capNhatTep(khoa, { trangThai: "dang_tai", loi: null });
      try {
        const taiLen = await uploadDocument(tep);
        idMoi = taiLen?.document_id || idMoi;
        capNhatTep(khoa, { trangThai: "xong" });
      } catch (err) {
        capNhatTep(khoa, { trangThai: "loi", loi: moTaLoi(err, "Tải lên thất bại.") });
      }
    }
    if (idMoi) {
      setIdVuaTai(idMoi);
      await load({ yen: true });
    }
    setUploading(false);
  };

  const onPick = (e) => {
    const tepChon = [...(e.target.files || [])];
    const accept = e.target.accept;
    e.target.value = "";
    if (!tepChon.length || uploading) return;
    // Codex P1 (#202): a file the server refused keeps its row and its File across a new pick,
    // so its "Thử lại" still works. Finished and refused-before-sending rows are replaced.
    const conLoi = hangTai.filter((m) => m.trangThai === "loi");
    const tepCu = tepTaiRef.current;
    tepTaiRef.current = new Map(conLoi.map((m) => [m.khoa, tepCu.get(m.khoa)]));
    const moi = tepChon.map((tep, i) => {
      const khoa = `${Date.now()}-${i}`;
      tepTaiRef.current.set(khoa, tep);
      const loi = kiemTraTep(tep, accept);
      return { khoa, ten: tep.name, trangThai: loi ? "tu_choi" : "cho", loi };
    });
    setHangTai([...conLoi, ...moi]);
    const guiDuoc = moi.filter((m) => m.trangThai === "cho").map((m) => m.khoa);
    if (guiDuoc.length) chayHangTai(guiDuoc);
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

  // Both renderers consume the same fetch/state owner. The rollout flag changes
  // only projection and presentation; it never starts a second library request.
  const chiMucBst = useMemo(() => chiMucBoSuuTap(collections), [collections]);
  const mucHienThi = useMemo(() => {
    const daLoc = loc(tim(documents, truyVan, chiMucBst), boLoc,
                      { hienLuuTru, collectionId: chonBoSuuTap, tags: chonThe });
    return chiaMuc(sapXep(daLoc, cheDoSap), { hienLuuTru });
  }, [documents, truyVan, chiMucBst, boLoc, hienLuuTru, chonBoSuuTap, chonThe, cheDoSap]);
  // V6: the one list of the card renderer is the chosen view of `tatCa`.
  const danhSachHien = useMemo(() => taiLieuTheoNhom(mucHienThi.tatCa, nhom), [mucHienThi.tatCa, nhom]);
  const demNhom = useMemo(() => demTheoNhom(mucHienThi.tatCa), [mucHienThi.tatCa]);
  // Same condition the learning home uses for its filled "Tiếp tục".
  const coTiepTuc = Boolean(mucHienThi.tiepTucHoc && mucHienThi.tiepTucHoc.ai?.index === "ready");
  const matrixProjection = useMemo(() => projectLibrary(documents, {
    query: truyVan,
    collectionIndex: chiMucBst,
    collectionId: chonBoSuuTap,
    tags: chonThe,
    filterKeys: boLoc,
    includeArchived: hienLuuTru,
    view: taskView,
    sort: cheDoSap,
  }), [documents, truyVan, chiMucBst, chonBoSuuTap, chonThe, boLoc,
    hienLuuTru, taskView, cheDoSap]);
  const documentsDangHien = LIBRARY_ACTION_MATRIX ? matrixProjection.rows : mucHienThi.tatCa;
  const daChonHieuLuc = useMemo(
    () => pruneSelection(daChon, documentsDangHien),
    [daChon, documentsDangHien],
  );

  useEffect(() => {
    if (!LIBRARY_ACTION_MATRIX) return;
    setDaChon((prev) => {
      const next = pruneSelection(prev, matrixProjection.rows);
      return sameSelection(prev, next) ? prev : next;
    });
  }, [matrixProjection.rows]);

  useEffect(() => {
    if (!LIBRARY_ACTION_MATRIX) return;
    const save = () => { try {
      if (!matrixStorageKey) return;
      sessionStorage.setItem(matrixStorageKey, serializeLibraryState({
        view: taskView, query: truyVan, sort: cheDoSap, collectionId: chonBoSuuTap,
        tags: chonThe, filterKeys: boLoc, includeArchived: hienLuuTru,
        scrollY: window.scrollY,
      }));
    } catch { /* storage unavailable */ } };
    save();
    window.addEventListener("scroll", save, { passive: true });
    return () => { save(); window.removeEventListener("scroll", save); };
  }, [matrixStorageKey, taskView, truyVan, cheDoSap, chonBoSuuTap, chonThe, boLoc, hienLuuTru]);

  useEffect(() => {
    if (!LIBRARY_ACTION_MATRIX || loading || matrixScrollRestoredRef.current
        || !matrixInitial.scrollY || !matrixListRef.current) return undefined;
    matrixScrollRestoredRef.current = true;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: matrixInitial.scrollY }));
    return () => cancelAnimationFrame(frame);
  }, [loading, matrixInitial.scrollY, matrixProjection.rows.length]);

  useEffect(() => {
    if (LIBRARY_ACTION_MATRIX || !user?.id) return undefined;
    const khoa = `${TIEN_TO_TRANG_THAI_THE}:${encodeURIComponent(user.id)}`;
    const save = () => {
      try { sessionStorage.setItem(khoa, JSON.stringify({ nhom, truyVan, scrollY: window.scrollY })); }
      catch { /* storage unavailable */ }
    };
    save();
    window.addEventListener("scroll", save, { passive: true });
    return () => { save(); window.removeEventListener("scroll", save); };
  }, [user?.id, nhom, truyVan]);

  useEffect(() => {
    if (LIBRARY_ACTION_MATRIX || loading || theScrollRestoredRef.current || !theInitial?.scrollY) return undefined;
    theScrollRestoredRef.current = true;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: theInitial.scrollY }));
    return () => cancelAnimationFrame(frame);
  }, [loading, theInitial]);

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
    try {
      await deleteCollection(c.collection_id);
    } catch (err) {
      const message = moTaLoi(err, "Không xoá được bộ sưu tập.");
      setLoiThaoTac(message);
      throw new Error(message);
    }
    setCollections((prev) => prev.filter((x) => x.collection_id !== c.collection_id));
    // Tài liệu rơi về "chưa phân loại" — phản chiếu ngay `ON DELETE SET NULL` của
    // máy chủ để màn hình không hiện một bộ sưu tập vừa biến mất.
    setDocuments((prev) => prev.map((d) =>
      d.collection_id === c.collection_id ? { ...d, collection_id: null } : d));
    if (chonBoSuuTap === c.collection_id) setChonBoSuuTap(null);
    setBoSuuTapCanXoa(null);
  }, [chonBoSuuTap]);

  // ── Hàng loạt ─────────────────────────────────────────────────────────────
  const chayBulk = useCallback(async (hanhDong, kem) => {
    const than = LIBRARY_ACTION_MATRIX
      ? effectiveBulkRequest(hanhDong, daChon, matrixProjection.rows, kem)
      : thanRequest(hanhDong, [...daChonHieuLuc], kem);
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
  }, [daChon, daChonHieuLuc, matrixProjection.rows, load]);

  const luuTen = useCallback(async (doc, ten) => {
    setDangLuu(true);
    await vaTaiLieu(doc, { display_name: ten }, { display_name: ten });
    setDangLuu(false);
    setDangDoiTen(null);
  }, [vaTaiLieu]);

  // ── Phép chiếu ────────────────────────────────────────────────────────────
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
    if (LIBRARY_ACTION_MATRIX) return;
    setDaChon((prev) => (prev.size ? locTheoHienThi(prev, mucHienThi.tatCa) : prev));
  }, [mucHienThi.tatCa]);

  const docVuaTai = idVuaTai
    ? documents.find((d) => d.document_id === idVuaTai) || null
    : null;
  const hienInsight = (uploading || (docVuaTai && !daDong(idVuaTai)));

  // Roving tabindex: đúng MỘT thẻ nhận Tab, mũi tên đi giữa các thẻ. Cho mọi thẻ
  // `tabIndex=0` thì người dùng bàn phím phải Tab 300 lần để đi qua thư viện.
  const xuLyPhim = (e, doc, chiSo) => {
    const kq = phimDanhSach(e, { chiSo, tong: danhSachHien.length });
    if (!kq) return;
    e.preventDefault();
    if (kq.loai === "focus") {
      setChiSoFocus(kq.chiSo);
      // Move the real focus too. Only the tabindex used to change, so the arrow keys left
      // focus on the card that had just become untabbable.
      theRefs.current.get(kq.chiSo)?.focus();
    }
    else if (kq.loai === "chon") setDaChon((prev) => batTatChon(prev, doc.document_id));
    else if (kq.loai === "mo") moBeMat(doc, doc.last_workspace || "studymap");
    else if (kq.loai === "xoa_chon") setDaChon(xoaChon());
  };

  const matrixFocusHieuLuc = resolveRovingDocumentId(matrixProjection.rows, matrixFocusId);
  const xuLyPhimMatrix = (e, docId) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const nextId = moveRovingDocumentId(matrixProjection.rows, docId, e.key);
    setMatrixFocusId(nextId);
    matrixPrimaryRefs.current.get(nextId)?.focus();
  };

  useEffect(() => {
    if (!LIBRARY_ACTION_MATRIX) return;
    setMatrixFocusId((current) => resolveRovingDocumentId(matrixProjection.rows, current));
  }, [matrixProjection.rows]);

  // Cards of the list by index, for the arrow keys above.
  const theRefs = useRef(new Map());
  // A filter or a view can shorten the list under the remembered index; without this no card
  // had tabindex 0 and Tab skipped the whole list.
  const soThe = danhSachHien.length;
  useEffect(() => {
    setChiSoFocus((hienTai) => (hienTai >= soThe ? Math.max(-1, soThe - 1) : hienTai));
  }, [soThe]);

  const veThe = (doc, chiSo = null) => (
    <StudyCard
      key={doc.document_id}
      refThe={chiSo == null ? undefined : (node) => {
        if (node) theRefs.current.set(chiSo, node); else theRefs.current.delete(chiSo);
      }}
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
      matDo={matDo}
      // The learning home above the list holds the page's filled "Tiếp tục".
      nutTiepTuc="secondary"
    />
  );

  // Mục rỗng KHÔNG được dựng — một mục "Cần tóm tắt" trống chỉ thêm nhiễu.

  return (
    <StudyShell
      eyebrow="StudyMap"
      title="Thư viện học tập"
      subtitle="Mỗi tài liệu đã tải lên là một tài sản học tập — tóm tắt, sơ đồ, quiz và hướng dẫn ôn tập đều nằm ngay trên thẻ của nó."
      backTo="/app"
      backLabel="Phòng đọc"
      loading={loading}
      error={error}
      onRetry={() => load()}
      skeleton={<DocumentSkeleton />}
      stackActionsOnMobile
      actions={
        <>
          {/* Danh sách này phải khớp formats.accept_attribute() của backend —
              BE/tests/test_upload_formats.py khoá lại để hai bên không lệch. */}
          <input ref={fileRef} type="file" className="hidden" onChange={onPick} multiple
            accept=".bmp,.csv,.doc,.docx,.epub,.fb2,.gif,.htm,.html,.jpeg,.jpg,.json,.md,.mobi,.odp,.odt,.pdf,.png,.pptx,.rtf,.txt,.xlsx,.xps" />
          {/* V6: one filled button above the list. When the learning home offers "Tiếp tục",
              that is the page's main action and uploading is secondary; otherwise uploading is. */}
          <button type="button" ref={nutTaiRef}
            className={`${coTiepTuc ? "btn-secondary" : "btn-seal"} text-small inline-flex items-center gap-2`}
            data-emphasis={coTiepTuc ? "secondary" : "primary"}
            disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <><Spinner size={13} /> Đang tải lên…</> : <><Icon name="Upload" size={14} /> Tải tài liệu lên</>}
          </button>
          {/* V9.3 P3b: the dashboard's entry while the bottom navigation keeps four items. */}
          <Link to="/app/study/dashboard" className="pill-action text-small inline-flex items-center gap-1.5">
            <Icon name="LayoutDashboard" size={13} aria-hidden="true" /> Tổng quan
          </Link>
          {/* Demo Mode — chỉ hiện khi có tài liệu THẬT đủ sẵn sàng; không có thì
              không vẽ nút, không hứa một bản xem thử không tồn tại. */}
          {taiLieuDemo && (
            <button type="button" className="pill-action text-small inline-flex items-center gap-1.5"
              // V4.1 W5-1 (owner A7): say that the document is picked automatically.
              title={`Tự động chọn tài liệu đã sẵn sàng nhất của bạn (${taiLieuDemo.display_name || taiLieuDemo.title || "không tên"}) và mở để xem Tóm tắt, Sơ đồ tư duy, Gia sư AI`}
              onClick={() => moBeMat(taiLieuDemo, beMatDemoDauTien(taiLieuDemo))}>
              <Icon name="Sparkles" size={13} /> Mở một tài liệu
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
        chon={{ collectionId: chonBoSuuTap, tags: chonThe }}
        onChon={(v) => {
          // Collection and tags only. The sidebar used to carry the state filters too and
          // echoed them back on every click, so picking a collection cleared an active
          // "Yêu thích" / "Đã ghim" filter.
          setChonBoSuuTap(v.collectionId ?? null);
          setChonThe(v.tags || []);
        }}
        onTao={taoBoSuuTap}
        onSua={suaBoSuuTap}
        onXoa={setBoSuuTapCanXoa}
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

      <UploadQueue hang={hangTai} dangChay={uploading}
        onThuLai={(khoa) => { if (!uploading) chayHangTai([khoa]); }}
        // Codex P2 (#202): closing removes the focused button; hand focus back to the upload button.
        onDong={() => { setHangTai([]); nutTaiRef.current?.focus(); }} />

      {loiLamMoi && (
        <div role="alert" className="mb-4 text-small flex items-start gap-1.5"
             style={{ color: "var(--err)" }}>
          <Icon name="AlertCircle" size={13} className="mt-0.5 shrink-0" />
          <span>{loiLamMoi}</span>
        </div>
      )}

      {loiThaoTac && (
        <div role="alert" className="mb-4 text-small flex items-start gap-1.5"
             style={{ color: "var(--err)" }}>
          <Icon name="AlertCircle" size={13} className="mt-0.5 shrink-0" />
          <span>{loiThaoTac}</span>
        </div>
      )}

      <BulkBar
        so={daChonHieuLuc.size}
        boSuuTap={thanhBen.boSuuTap}
        dangChay={dangChayBulk}
        onHanhDong={chayBulk}
        onXoaChon={() => setDaChon(xoaChon())}
      />

      {/* Thanh công cụ */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {/* Frontend V3 (Responsive, §7) — `!min-w-0` and `min-w-[200px]` were
            both on this element, fighting over the same property: Tailwind's
            `!` compiles to `!important`, so `!min-w-0` always won regardless
            of source order, making `min-w-[200px]` dead code. Effective floor
            was 0, not 200px — confirmed live at 390px width (the input
            rendered ~2 characters of its own placeholder). One value now:
            enough to stay usable on a phone without starving `Mới nhất`/
            `Lọc`/`Đủ` next to it, wider on anything roomier. Nothing inside
            this div depends on `min-width:0` for truncation (the input is
            `w-full`, no `overflow-hidden`/`truncate` descendant). */}
        <div className="header-search !rounded-control !px-3 !py-2 flex-1 min-w-[140px] sm:min-w-[220px]">
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
                        <input type="checkbox" className="w-3.5 h-3.5 accent-accent rounded"
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
                          className="mt-1 text-small text-accent">Xoá bộ lọc</button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Frontend V2, Library wave — density toggle (Find-Open-Study-Review
            artifact, Phase B). Same CSS-variant-only contract as StudyCard's
            own `matDo` prop: no new data, no new fetch. */}
        <button type="button" onClick={doiMatDo} className="pill-action !py-2"
                aria-pressed={matDo === "compact"}
                title={matDo === "compact" ? "Đang xem gọn — bấm để xem đầy đủ" : "Đang xem đầy đủ — bấm để xem gọn"}>
          <Icon name={matDo === "compact" ? "AlignJustify" : "Rows3"} size={13} />
          {/* V4.1 W5-1: one constant name for a toggle button; aria-pressed carries the state. */}
          Xem gọn
        </button>

        <label className="flex items-center gap-2 cursor-pointer px-1">
          <input type="checkbox" checked={hienLuuTru}
                 onChange={(e) => setHienLuuTru(e.target.checked)}
                 className="w-3.5 h-3.5 accent-accent rounded" />
          <span className="text-small text-text-secondary">Hiện đã lưu trữ</span>
        </label>

        {documentsDangHien.length > 0 && (
          <label className="flex items-center gap-2 cursor-pointer px-1">
            <input
              type="checkbox"
              checked={daChonHet(daChonHieuLuc, documentsDangHien)}
              onChange={(e) => setDaChon(e.target.checked
                ? chonTatCa(documentsDangHien) : xoaChon())}
              className="w-3.5 h-3.5 accent-accent rounded"
            />
            {/* Nói rõ phạm vi: "tất cả" ở đây là những gì ĐANG hiện, không phải cả
                thư viện — chọn 300 tài liệu đang ẩn rồi xoá là mất dữ liệu. */}
            <span className="text-small text-text-secondary">
              Chọn {documentsDangHien.length} đang hiện
            </span>
          </label>
        )}
      </div>

      {/* Frontend V2, Library wave — active filters as dismissable chips
          (Find-Open-Study-Review artifact, Phase A): "you can't see what's
          currently filtering without opening it" was the exact finding. Same
          `boLoc` state, same `setBoLoc` toggle — rendering layer only. */}
      {boLoc.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {boLoc.map((khoa) => (
            <button key={khoa} type="button"
                    onClick={() => setBoLoc((prev) => prev.filter((k) => k !== khoa))}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-caption font-medium"
                    style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)",
                             border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
                             color: "var(--accent)" }}
                    aria-label={`Bỏ lọc ${NHAN_LOC.get(khoa) || khoa}`}>
              {NHAN_LOC.get(khoa) || khoa} <Icon name="X" size={11} />
            </button>
          ))}
          <button type="button" onClick={() => setBoLoc([])}
                  className="text-caption text-text-muted hover:text-text-primary">
            Xoá tất cả
          </button>
        </div>
      )}

      {/* V9.3 P3b: the full learning home (recent, coverage, review) moved to the dashboard.
          Until the five-item navigation reaches it, the Library keeps one compact way back
          into the document in progress, so continuing costs no extra step. */}
      {coTiepTuc && <ResumeLine doc={mucHienThi.tiepTucHoc} onMo={moBeMat} />}

      {LIBRARY_ACTION_MATRIX && (
        <section ref={matrixListRef} className="mb-7" aria-label="Ma trận hành động học tập">
          <div ref={matrixFallbackRef} tabIndex={-1} data-matrix-focus-fallback>
            <LibraryTaskViews value={taskView} counts={matrixProjection.counts} onChange={setTaskView} />
          </div>
          <p className="text-small text-text-muted mb-3" aria-live="polite">
            {matrixProjection.rows.length} tài liệu phù hợp
          </p>
          {matrixProjection.rows.length === 0 && documents.length === 0 ? (
            // A library with no documents at all is not "nothing matches your filters":
            // that message sent people to change filters they had never set.
            <EmptyState
              icon="Upload"
              title="Chưa có tài liệu nào"
              hint="Tải một tài liệu lên để bắt đầu: tóm tắt, sơ đồ và quiz đều dựng từ nó."
              action={<button type="button" className="pill-action mt-1" disabled={uploading}
                              onClick={() => fileRef.current?.click()}>Tải tài liệu lên</button>}
            />
          ) : matrixProjection.rows.length === 0 ? (
            <EmptyState
              icon="Search"
              title="Không có tài liệu phù hợp"
              hint="Hãy đổi mục tiêu học tập, bộ sưu tập, bộ lọc hoặc từ khoá tìm kiếm."
              action={(
                <button type="button" className="pill-action mt-1" onClick={() => {
                  setTaskView(TASK_VIEW.ALL);
                  setTruyVan(""); setBoLoc([]); setChonBoSuuTap(null); setChonThe([]);
                }}>Xem tất cả tài liệu</button>
              )}
            />
          ) : (
            <div className="study-document-matrix" aria-label="Danh sách tài liệu">
              {matrixProjection.rows.map((doc) => (
                <div key={doc.document_id}>
                  <StudyDocumentActionRow
                    doc={doc}
                    view={taskView}
                    onOpen={moBeMat}
                    onDetails={() => setChiTietDoc((current) => current === doc.document_id ? null : doc.document_id)}
                    onRename={setDangDoiTen}
                    onPatch={batTat}
                    renaming={dangDoiTen === doc.document_id}
                    saving={dangLuu}
                    onSaveRename={(name) => luuTen(doc, name)}
                    onCancelRename={() => setDangDoiTen(null)}
                    selected={daChonHieuLuc.has(doc.document_id)}
                    onSelect={(id) => setDaChon((prev) => batTatChon(prev, id))}
                    primaryTabIndex={doc.document_id === matrixFocusHieuLuc ? 0 : -1}
                    primaryRef={(node) => {
                      if (node) matrixPrimaryRefs.current.set(doc.document_id, node);
                      else matrixPrimaryRefs.current.delete(doc.document_id);
                    }}
                    onPrimaryKeyDown={(event) => xuLyPhimMatrix(event, doc.document_id)}
                    fallbackFocusRef={matrixFallbackRef}
                  />
                  <DocumentKnowledgeDetails open={chiTietDoc === doc.document_id} doc={doc}
                    documents={documents} chiMucBst={chiMucBst} jobs={jobs} onOpen={moBeMat} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {!LIBRARY_ACTION_MATRIX && <section className="mb-7" aria-labelledby="library-list-title">
        <h2 id="library-list-title" className="sr-only">Danh sách tài liệu</h2>
        {/* V6: one list. A view picks which documents it holds; a document is never drawn twice.
            These used to be up to twelve sections plus "Tất cả", the same card repeated. */}
        {documents.length > 0 && (
          <div className="library-views" role="group" aria-label="Xem tài liệu">
            {NHOM_THU_VIEN.map(([khoa, nhan]) => (
              <button key={khoa} type="button" className="library-views__item"
                      aria-pressed={nhom === khoa}
                      onClick={() => { setNhom(khoa); setChiSoFocus(-1); }}>
                {nhan} <span className="library-views__count">{demNhom[khoa]}</span>
              </button>
            ))}
          </div>
        )}
        {mucHienThi.tatCa.length === 0 ? (
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
                  // Frontend V3 (Workspace hierarchy, §2) — this used to also
                  // render as `btn-seal` when the action is "upload," which put
                  // two seal-red primary buttons on screen at once (this one +
                  // StudyShell's own "Tải tài liệu" in the header actions slot,
                  // always rendered, doing the exact same thing). One primary
                  // per screen: the header owns it, this stays a secondary
                  // shortcut into the same file picker.
                  <button
                    type="button"
                    className="pill-action mt-1 disabled:opacity-60"
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
        ) : danhSachHien.length === 0 ? (
          <EmptyState
            icon="FileText"
            title={`Không có tài liệu nào ở mục “${(NHOM_THU_VIEN.find(([khoa]) => khoa === nhom) || [])[1]}”`}
            hint="Các tài liệu khác vẫn ở mục Tất cả."
            action={<button type="button" className="pill-action mt-1" onClick={() => setNhom("tat_ca")}>Xem tất cả</button>}
          />
        ) : (
          <div className="flex flex-col gap-2.5" role="listbox"
               aria-label="Danh sách tài liệu" aria-multiselectable="true">
            {danhSachHien.map((d, i) => veThe(d, i))}
          </div>
        )}
      </section>}

      <DestructiveConfirmDialog
        open={Boolean(boSuuTapCanXoa)}
        title="Xoá bộ sưu tập"
        targetName={boSuuTapCanXoa?.name}
        consequenceText="Bộ sưu tập sẽ bị xoá vĩnh viễn. Tài liệu bên trong không bị xoá; chúng sẽ trở về mục Chưa phân loại."
        confirmLabel="Xoá bộ sưu tập"
        onCancel={() => setBoSuuTapCanXoa(null)}
        onConfirm={() => xoaBoSuuTap(boSuuTapCanXoa)}
      />
      </div>
      </div>
    </StudyShell>
  );
}

// V9.3 P3b: the one compact "continue" the Library keeps (the full learning home is on the
// dashboard). It is the page's filled action when present; upload is then secondary.
function ResumeLine({ doc, onMo }) {
  const tt = tiepTucHoc(doc);
  return (
    <section className="library-resume surface-card" aria-labelledby="library-resume-title">
      <div className="library-resume__text">
        <h2 id="library-resume-title" className="library-resume__label">Học tiếp</h2>
        <p className="library-resume__name">{tenHienThi(doc)}</p>
      </div>
      <button type="button" className="btn-seal library-resume__cta"
              onClick={() => onMo(doc, tt?.beMat || "studymap")}>
        Tiếp tục{tt?.nhanBeMat ? ` · ${tt.nhanBeMat}` : ""}
      </button>
    </section>
  );
}
