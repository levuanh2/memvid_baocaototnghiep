import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Tree from "react-d3-tree";
import StudyShell, { EmptyState } from "../../components/study/StudyShell";
import { Icon } from "../../components/ui/Icon";
import Spinner from "../../components/ui/Spinner";
import { useStudyJob } from "../../hooks/useStudyJob";
import { nenChanLan } from "../../utils/wheelGate";
import { LAYOUT_IDS, nhanLayout, thongSoReactD3Tree } from "../../utils/studyMapLayout";
import { docPrefs, writeDocPref } from "../../utils/studyMapPreference";
import { lienQuanCuaNode } from "../../utils/studyMapGraph";
import { diChuyenKetQua, phimTimKiemStudyMap, timStudyMap } from "../../utils/studyMapSearch";
import { exportImage } from "../../utils/studyMapExport";
// Toán zoom + phím tắt THUẦN, không riêng cho mind-elixir (mindmapViewport.js không
// import thư viện nào) — dùng lại nguyên, không viết lại phép kẹp/scale lần hai.
import { formatZoom, nextScale, viewportKeyAction, ZOOM_STEP } from "../../utils/mindmapViewport";
import { useStudyContext } from "../../study/useStudyContext";
import {
  NODE_TYPE_LABEL,
  RELATION_LABEL,
  buildMapTree,
  generateStudyMap,
  getDocument,
  getStudyMap,
  listChunks,
  listStudyMaps,
  moTaLoi,
} from "../../utils/studyApi";

// Khớp NGUYÊN VĂN giá trị cứng trước Phase 2 (`zoom={0.8}` / `scaleExtent={{min:0.25,
// max:2}}`) — bật zoom bàn phím không được đổi điểm bắt đầu hay biên kẹp đã có.
const ZOOM_MAC_DINH = 0.8;
const SCALE_MIN = 0.25;
const SCALE_MAX = 2;

// Bốn loại node là phân tầng THẬT của tài liệu (tài liệu > chương mục > khái
// niệm > ví dụ), nên nét vẽ mã hoá đúng tầng đó chứ không tô cho đẹp: càng gần
// gốc càng đậm và càng to.
const MARK = {
  root:    { r: 9, fill: "var(--brand)",       stroke: "var(--brand)",        text: 15.5, weight: 600 },
  section: { r: 7, fill: "var(--bg-card)",     stroke: "var(--brand)",        text: 14,   weight: 600 },
  concept: { r: 5, fill: "var(--bg-card)",     stroke: "var(--text-muted)",   text: 13,   weight: 500 },
  example: { r: 3, fill: "var(--bg-base)",     stroke: "var(--border-color)", text: 12,   weight: 400 },
};
const markOf = (t) => MARK[t] || MARK.concept;

export default function StudyMapView() {
  const { documentId } = useParams();
  // Study Context (Phase 4A.2) — PHÁT lựa chọn, không thay `selected`/`focusedId`
  // cục bộ ở dưới. `selectedDocument` lưu STEM (không phải document_id UUID): đó là
  // khoá DUY NHẤT mà cả hai thế giới cùng có — Summary (SidebarRight/SummaryModal)
  // chỉ biết stem (`rec.sources`), StudyMap chỉ biết document_id qua route; `doc`
  // (đã fetch qua `getDocument`) mang cả hai, `source_stem` là cầu nối chung.
  const { selectDocument, selectNode } = useStudyContext();
  const [doc, setDoc] = useState(null);
  const [map, setMap] = useState(null);
  const [chunks, setChunks] = useState(new Map());
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [dangDung, setDangDung] = useState(false);
  const canvasRef = useRef(null);
  const [translate, setTranslate] = useState({ x: 120, y: 300 });

  // Layout (Phase 2 #1) — id RENDERER-ĐỘC-LẬP, đọc tuỳ chọn đã lưu của CHÍNH tài liệu
  // này. Lazy init đọc ngay lần render đầu (không nhấp nháy về mặc định rồi mới nhảy
  // sang layout đã chọn); effect bên dưới đọc LẠI khi `documentId` đổi mà component
  // không remount — `load()` ở trên đã đổi khoá theo đúng cách này rồi.
  const [layoutId, setLayoutId] = useState(
    () => docPrefs(window.localStorage, documentId).layout);
  useEffect(() => {
    setLayoutId(docPrefs(window.localStorage, documentId).layout);
  }, [documentId]);
  const doiLayout = useCallback((id) => {
    setLayoutId(id);
    writeDocPref(window.localStorage, documentId, { layout: id });
  }, [documentId]);

  // Trình chiếu (Phase 2 #9) — cùng khoá lưu trữ và cùng nhịp đọc-lại-khi-đổi-tài-liệu
  // với layout ở trên, không phải một cơ chế riêng.
  const [trinhChieu, setTrinhChieu] = useState(
    () => docPrefs(window.localStorage, documentId).presentation);
  useEffect(() => {
    setTrinhChieu(docPrefs(window.localStorage, documentId).presentation);
  }, [documentId]);
  const doiTrinhChieu = useCallback((v) => {
    setTrinhChieu(v);
    writeDocPref(window.localStorage, documentId, { presentation: v });
  }, [documentId]);

  // Focus mode (Phase 2 #4) — click một node vừa CHỌN (bảng chi tiết, hành vi cũ)
  // vừa FOCUS (làm mờ nhánh không liên quan). Cùng một cú bấm, hai việc bổ sung
  // nhau, không phải hai cử chỉ tranh nhau.
  const [focusedId, setFocusedId] = useState(null);
  const focusInfo = useMemo(
    () => (focusedId ? lienQuanCuaNode(focusedId, map?.nodes) : null), [focusedId, map]);
  const boFocus = useCallback(() => setFocusedId(null), []);

  // Tìm kiếm (Phase 2 #6). `ketQuaTho` tính lại mỗi lần gõ (44 node hiện tại rẻ tới
  // mức không cần debounce; sơ đồ lớn hơn nhiều thì thêm debounce ở ĐÂY mà không đổi
  // hình dạng state phía dưới). `chiSoTim` là state RIÊNG cho mũi tên di chuyển được
  // mà không phải tính lại danh sách khớp — gộp lại thành `ketQuaTim` để nơi dùng chỉ
  // thấy đúng MỘT mô hình {matches, activeIndex, total}.
  const [truyVan, setTruyVan] = useState("");
  const [chiSoTim, setChiSoTim] = useState(0);
  const ketQuaTho = useMemo(() => timStudyMap(map?.nodes, truyVan), [map, truyVan]);
  // Không có khớp nào thì `ketQuaTho.activeIndex` đã đúng là -1 — không đụng vào.
  // Có khớp thì kẹp `chiSoTim` (có thể lệch khỏi phạm vi mới sau khi truy vấn đổi
  // số lượng khớp) về đúng vòng bằng chính công thức `diChuyenKetQua` dùng cho
  // mũi tên, không viết lại phép chia dư ở đây lần nữa.
  const ketQuaTim = useMemo(() => (ketQuaTho.total
    ? diChuyenKetQua({ ...ketQuaTho, activeIndex: chiSoTim }, 0)
    : ketQuaTho), [ketQuaTho, chiSoTim]);
  const nodeIdChon = ketQuaTim.activeIndex >= 0 ? ketQuaTim.matches[ketQuaTim.activeIndex] : null;
  const tapKhopTim = useMemo(() => new Set(ketQuaTim.matches), [ketQuaTim]);

  const doiTruyVan = useCallback((q) => { setTruyVan(q); setChiSoTim(0); }, []);

  const xuLyPhimTim = useCallback((e) => {
    const kq = phimTimKiemStudyMap(e);
    if (!kq) return;
    e.preventDefault();
    if (kq.loai === "tiep") setChiSoTim((i) => diChuyenKetQua({ ...ketQuaTho, activeIndex: i }, 1).activeIndex);
    else if (kq.loai === "truoc") setChiSoTim((i) => diChuyenKetQua({ ...ketQuaTho, activeIndex: i }, -1).activeIndex);
    else if (kq.loai === "xoa") doiTruyVan("");
    else if (kq.loai === "nhay" && nodeIdChon) {
      // "Nhảy" KHÔNG cuộn/căn giữa camera tới node — react-d3-tree v3.6.6 không có
      // API pan-tới-node công khai, và giả lập bằng cách sửa `__rd3t` nội bộ là đúng
      // thứ approval của phase này cấm ("không vá bằng cách sửa nội bộ thư viện").
      // Thay vào đó: chọn node để mở bảng chi tiết (đọc được nội dung ngay cả khi
      // node đang nằm trong nhánh còn gập) VÀ focus nó (làm nổi bật đường tổ tiên).
      const n = (map?.nodes || []).find((x) => x.node_id === nodeIdChon);
      if (n) { setSelected(n); setFocusedId(n.node_id); }
    }
  }, [nodeIdChon, map, ketQuaTho, doiTruyVan]);

  // Zoom bàn phím (Phase 2 #12) — trước Phase 2, phóng to/nhỏ CHỈ qua Ctrl+lăn (chuột).
  // `zoom` của react-d3-tree LÀ điều khiển được sau khi mount: `componentDidUpdate` so
  // `props.zoom` với giá trị cũ và tự re-bind d3-zoom nếu khác (verified
  // node_modules/react-d3-tree/lib/esm/Tree/index.js) — không phải chỉ đọc lúc mount
  // như JSDoc gợi ý. `onUpdate` đọc NGƯỢC lại scale thật (kể cả khi người dùng tự lăn
  // chuột) để bước bấm phím tiếp theo tính từ đúng vị trí hiện tại, không phải giá trị
  // state đã cũ.
  const [zoom, setZoom] = useState(ZOOM_MAC_DINH);
  const onTreeUpdate = useCallback(({ zoom: z }) => {
    if (Number.isFinite(z)) setZoom((prev) => (Math.abs(prev - z) > 0.001 ? z : prev));
  }, []);
  const zoomBy = useCallback((delta) => {
    setZoom((z) => nextScale(z, delta, { min: SCALE_MIN, max: SCALE_MAX }));
  }, []);
  const zoomReset = useCallback(() => setZoom(ZOOM_MAC_DINH), []);

  useEffect(() => {
    const onKey = (e) => {
      const ae = document.activeElement;
      const isEditing = Boolean(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName));
      const action = viewportKeyAction(e, { isEditing });
      if (!action || action === "fit") return;   // "fit" (F) không có tương đương react-d3-tree
      e.preventDefault();
      if (action === "in") zoomBy(ZOOM_STEP);
      else if (action === "out") zoomBy(-ZOOM_STEP);
      else if (action === "reset") zoomReset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, zoomReset]);

  // Xuất ảnh (Phase 2 #10) — bọc trong `studyMapExport.js`, trang này không biết
  // "snapdom" tồn tại. `element` là `.map-canvas`-tương-đương ở đây: chính `canvasRef`,
  // vì react-d3-tree vẽ trọn SVG trong container đó, không có lớp con cần nhắm riêng
  // như `mind.map` của mind-elixir.
  const [dangXuat, setDangXuat] = useState(false);
  const [loiXuat, setLoiXuat] = useState(null);
  const xuatAnh = useCallback(async (format, { transparent = false } = {}) => {
    if (!canvasRef.current || dangXuat) return;
    setDangXuat(true);
    setLoiXuat(null);
    try {
      const nen = getComputedStyle(document.documentElement).getPropertyValue("--bg-base").trim()
        || "#ECE7DB";
      await exportImage(canvasRef.current, {
        title: doc?.title || doc?.filename, format, transparent, nenMacDinh: nen, scale: 2,
      });
    } catch (err) {
      setLoiXuat(moTaLoi(err, "Không xuất được ảnh."));
    } finally {
      setDangXuat(false);
    }
  }, [doc, dangXuat]);

  const openMap = useCallback(async (mapId, documentIdForChunks) => {
    const body = await getStudyMap(mapId);
    setMap(body);
    // Đoạn nguồn lấy một lần cho cả sơ đồ; node chỉ giữ chunk_id.
    try {
      const list = await listChunks(documentIdForChunks);
      setChunks(new Map(list.map((c) => [c.chunk_id, c])));
    } catch {
      // Không có đoạn nguồn thì sơ đồ vẫn xem được — chỉ mất phần trích dẫn.
    }
  }, []);

  const job = useStudyJob({
    onDone: (result) => {
      if (result?.map_id) openMap(result.map_id, documentId).catch(() => {});
    },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, maps] = await Promise.all([getDocument(documentId), listStudyMaps(documentId)]);
      setDoc(d);
      selectDocument(d?.source_stem || null);
      const newest = maps.find((m) => m.status === "completed") || null;
      if (newest) await openMap(newest.map_id, documentId);
      else setMap(null);
      // Có job đang dựng (tab khác, hoặc vừa F5) mà trang hiện "Chưa dựng sơ đồ cho
      // tài liệu này" kèm nút mời dựng thì người dùng bấm, và job thứ hai tranh slot
      // LLM với job thứ nhất.
      setDangDung(Boolean(maps.find((m) => m.status === "processing" || m.status === "pending")));
    } catch (e) {
      setError(moTaLoi(e, "Không tải được sơ đồ kiến thức."));
    } finally {
      setLoading(false);
    }
  }, [documentId, openMap, selectDocument]);

  useEffect(() => { load(); }, [load]);

  // Điểm neo phụ thuộc HƯỚNG: cây ngang neo mép trái - giữa chiều cao (gốc mọc sang
  // phải); cây dọc neo giữa chiều rộng - gần đỉnh (gốc mọc xuống dưới). Dùng công
  // thức của cây ngang cho cây dọc thì gốc kẹt ở giữa-trái, quá nửa khung trống phía
  // trên — đúng loại lỗi "layout đổi nhưng khung nhìn thì không" nếu bỏ qua bước này.
  const rd3tProps = useMemo(
    () => thongSoReactD3Tree(layoutId, map?.nodes), [layoutId, map]);
  // Chỉ neo lại khi HƯỚNG đổi thật (đổi step→diagonal giữ nguyên khung nhìn) — trừ
  // `trinhChieu`: bật/tắt trình chiếu đổi HẲN kích thước khung (`calc(100vh-120px)`
  // so với `min(70vh,640px)`), không neo lại thì góc neo cũ trỏ vào toạ độ đã hết
  // đúng trên khung mới.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !map) return;
    const { width, height } = el.getBoundingClientRect();
    setTranslate(rd3tProps.orientation === "vertical"
      ? { x: width / 2, y: Math.min(80, height * 0.12) }
      : { x: Math.min(160, width * 0.18), y: height / 2 });
  }, [map, rd3tProps.orientation, trinhChieu]);

  // Trả con lăn về cho TRANG. d3-zoom (do react-d3-tree gắn lên <svg> con) nghe `wheel`
  // rồi preventDefault, mà canvas cao 70vh nên con trỏ gần như luôn nằm trên nó — kết
  // quả là trang sơ đồ không bao giờ cuộn được. Nghe ở pha CAPTURE để chạy TRƯỚC d3, và
  // chỉ stopPropagation; KHÔNG preventDefault, vì đó chính là thứ trình duyệt cần để cuộn.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    const chan = (e) => { if (nenChanLan(e)) e.stopPropagation(); };
    el.addEventListener("wheel", chan, { capture: true });
    return () => el.removeEventListener("wheel", chan, { capture: true });
  }, [map]);

  // Esc — khi bàn phím KHÔNG ở ô tìm kiếm (ô đó tự xử lý Esc riêng, cùng lúc với việc
  // điều hướng kết quả): thoát trình chiếu TRƯỚC (trạng thái "to" nhất, giống đóng một
  // lớp phủ), rồi mới tới xoá focus. Trang này trước Phase 2 không có phím tắt nào,
  // nên đây không đụng vào hành vi Esc nào đã có.
  useEffect(() => {
    if (!trinhChieu && !focusedId) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
      if (trinhChieu) doiTrinhChieu(false);
      else setFocusedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedId, trinhChieu, doiTrinhChieu]);

  // Bản đồ MỚI (tải lần đầu hoặc "Dựng lại") có tập node_id khác — focus/tìm kiếm cũ
  // trỏ vào id không còn tồn tại thì focus sẽ làm mờ HẾT (không node nào khớp `all`),
  // trông như sơ đồ vỡ. Dọn theo đúng mốc `map` đổi, không đợi người dùng tự bấm "Bỏ
  // focus" sau một lần dựng lại.
  useEffect(() => {
    setFocusedId(null);
    setTruyVan("");
    setChiSoTim(0);
  }, [map]);

  const tree = useMemo(() => buildMapTree(map?.nodes), [map]);
  const nodeById = useMemo(
    () => new Map((map?.nodes || []).map((n) => [n.node_id, n])),
    [map],
  );

  // Cạnh chéo không vẽ trên cây (cây là cây, cung chéo làm rối layout) — hiện ở
  // bảng bên khi node được chọn có liên kết ngang.
  const edgesOf = useCallback(
    (nodeId) => (map?.edges || []).filter(
      (e) => e.source_node_id === nodeId || e.target_node_id === nodeId,
    ),
    [map],
  );

  const build = async ({ force = false } = {}) => {
    setStarting(true);
    setError(null);
    try {
      const body = await generateStudyMap(documentId, { force });
      if (body?.job_id) job.start(body.job_id);
      else if (body?.map_id) await openMap(body.map_id, documentId);
      // FE#18: không có nhánh này thì response thiếu cả hai khoá = nút hết quay và
      // TUYỆT ĐỐI không có gì xảy ra, không một chữ nào.
      else setError("Máy chủ không trả về sơ đồ hay mã tiến trình nào. Thử lại.");
    } catch (e) {
      setError(moTaLoi(e, "Không tạo được sơ đồ kiến thức."));
    } finally {
      setStarting(false);
    }
  };

  const renderNode = useCallback(
    ({ nodeDatum, toggleNode }) => {
      const attrs = nodeDatum.attributes || {};
      const m = markOf(attrs.node_type);
      const isSel = selected && attrs.node_id === selected.node_id;
      const isMatch = attrs.node_id && tapKhopTim.has(attrs.node_id);
      const isActiveMatch = attrs.node_id && attrs.node_id === nodeIdChon;
      // Focus: không có focus nào ⇒ mọi node sáng bình thường (không phải mờ-hết-rồi-
      // không-ai-sáng). Có focus ⇒ chỉ tổ tiên/chính node/hậu duệ giữ độ sáng đầy đủ.
      const daMo = !focusInfo || focusInfo.all.has(attrs.node_id);
      // Cây mở sẵn ở tầng 1, nên MỘT cú bấm phải làm cả hai việc: chọn node để
      // đọc chi tiết, và bung/thu nhánh — VÀ (Phase 2 #4) focus nó, làm nổi bật
      // đường tổ tiên/hậu duệ — VÀ (Phase 4A.2) phát lên Study Context, để module
      // khác (khi cùng mở) biết node nào đang được xem. Bốn việc, một cử chỉ.
      const hasBranch = Boolean(nodeDatum.children?.length || nodeDatum._children?.length);
      const onPick = () => {
        if (attrs.node_id) { setSelected(attrs); setFocusedId(attrs.node_id); selectNode(attrs.node_id); }
        if (hasBranch) toggleNode();
      };
      return (
        <g onClick={onPick} style={{ cursor: "pointer", opacity: daMo ? 1 : 0.22 }}>
          <circle
            r={m.r}
            fill={isSel ? "var(--brand)" : m.fill}
            stroke={isActiveMatch ? "var(--accent)" : isSel ? "var(--brand)" : m.stroke}
            strokeWidth={isActiveMatch ? 3.5 : isSel ? 3 : 1.6}
          />
          {/* Khớp tìm kiếm (không phải kết quả đang chọn): vòng ngoài mảnh, để phân
              biệt "có khớp" khỏi "đang xem" (viền accent đậm ở trên). */}
          {isMatch && !isActiveMatch && (
            <circle r={m.r + 3} fill="none" stroke="var(--accent)" strokeWidth={1.2}
                    strokeDasharray="2 2" />
          )}
          {/* Nhánh đang thu: chấm đặc bên trong = "còn nội dung bên dưới".
              Không có dấu này thì lá và nhánh đã thu trông y hệt nhau. */}
          {nodeDatum.__rd3t?.collapsed && (
            <circle r={Math.max(1.5, m.r - 3)} fill={m.stroke} opacity="0.55" />
          )}
          <text
            x={m.r + 7}
            // Nhãn nằm TRÊN node, không nằm ngang: link `step` chạy ngang đúng
            // tầm tâm node nên chữ đặt ngang sẽ bị gạch xuyên qua.
            y={-9}
            style={{
              fontSize: m.text,
              fontWeight: m.weight,
              fill: "var(--text-primary)",
              fontFamily: "var(--font-display, Spectral), serif",
              // Viền cùng màu nền vẽ TRƯỚC chữ = quầng che nét link cắt ngang.
              paintOrder: "stroke",
              stroke: "var(--bg-card)",
              strokeWidth: 3.5,
              strokeLinejoin: "round",
            }}
          >
            {String(nodeDatum.name).slice(0, 46)}
          </text>
        </g>
      );
    },
    [selected, focusInfo, tapKhopTim, nodeIdChon, selectNode],
  );

  const counts = useMemo(() => {
    const c = {};
    for (const n of map?.nodes || []) c[n.node_type] = (c[n.node_type] || 0) + 1;
    return c;
  }, [map]);

  return (
    <StudyShell
      eyebrow="Sơ đồ kiến thức"
      title={doc?.title || doc?.filename || "Sơ đồ kiến thức"}
      subtitle={map ? null : "Hệ thống đọc tài liệu và dựng cây khái niệm để bạn thấy được cấu trúc."}
      backTo="/app/study"
      loading={loading}
      error={error && !map ? error : null}
      onRetry={load}
      width="max-w-[1400px]"
      actions={
        map && (
          <button
            type="button"
            className="btn-secondary text-[13px] inline-flex items-center gap-1.5"
            disabled={starting || job.running}
            onClick={() => build({ force: true })}
          >
            {starting || job.running ? <Spinner size={13} /> : <Icon name="RotateCcw" size={14} />} Dựng lại
          </button>
        )
      }
    >
      {job.jobId && job.running && (
        <section className="surface-card mb-5">
          <div className="flex items-center gap-2.5 mb-2.5">
            <Spinner size={14} />
            <span className="text-[13.5px] text-text-secondary flex-1">
              {job.status?.current_node || "Đang dựng sơ đồ"} · {job.status?.progress ?? 0}%
            </span>
            <button type="button" className="btn-secondary text-[12.5px]" onClick={job.cancel}>
              Huỷ
            </button>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${job.status?.progress ?? 0}%` }} />
          </div>
          <p className="text-[12.5px] text-text-muted mt-2.5">
            Tài liệu dài mất vài phút. Bạn có thể rời trang, sơ đồ vẫn được dựng tiếp.
          </p>
        </section>
      )}

      {job.error && (
        <div className="surface-card !p-3.5 mb-5 flex items-center gap-2.5">
          <Icon name="AlertCircle" size={15} style={{ color: "var(--err)" }} />
          <span className="text-[13.5px] flex-1" style={{ color: "var(--err)" }}>{job.error}</span>
          <button type="button" className="btn-secondary text-[12.5px]" onClick={job.reset}>Đóng</button>
        </div>
      )}

      {loiXuat && (
        <div role="alert" className="surface-card !p-3.5 mb-5 flex items-center gap-2.5">
          <Icon name="AlertCircle" size={15} style={{ color: "var(--err)" }} />
          <span className="text-[13.5px] flex-1" style={{ color: "var(--err)" }}>{loiXuat}</span>
          <button type="button" className="btn-secondary text-[12.5px]" onClick={() => setLoiXuat(null)}>Đóng</button>
        </div>
      )}

      {!map && !job.running && dangDung ? (
        <EmptyState
          icon="Clock"
          title="Sơ đồ đang được dựng"
          hint="Một tiến trình dựng sơ đồ cho tài liệu này đang chạy (có thể từ tab khác). Bấm dựng thêm sẽ tạo job thứ hai tranh cùng một chỗ xử lý."
          action={
            <button type="button" className="btn-secondary text-[13px] mt-1" onClick={load}>
              Kiểm tra lại
            </button>
          }
        />
      ) : !map && !job.running ? (
        <EmptyState
          icon="Network"
          title="Chưa dựng sơ đồ cho tài liệu này"
          hint="Sơ đồ tách tài liệu thành cây khái niệm, mỗi khái niệm neo về đúng đoạn văn sinh ra nó."
          action={
            <button
              type="button"
              className="btn-seal text-[13px] mt-1 inline-flex items-center gap-2"
              disabled={starting}
              onClick={() => build()}
            >
              {starting ? <><Spinner size={13} /> Đang bắt đầu…</> : "Dựng sơ đồ kiến thức"}
            </button>
          }
        />
      ) : map ? (
        <>
          {/* Trình chiếu (Phase 2 #9): ẩn số liệu/thanh công cụ/bảng chi tiết, CHỈ còn
              sơ đồ. Không đụng tới chrome của StudyShell (tiêu đề/back/"Dựng lại") —
              đó là khung điều hướng dùng chung cho mọi trang study, không phải thứ
              trang này sở hữu để tắt riêng. */}
          {!trinhChieu && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mb-4 font-mono text-[11.5px] text-text-muted">
              {["root", "section", "concept", "example"].map((t) =>
                counts[t] ? (
                  <span key={t} className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block rounded-full"
                      style={{
                        width: markOf(t).r * 1.6, height: markOf(t).r * 1.6,
                        background: markOf(t).fill,
                        boxShadow: `inset 0 0 0 1.5px ${markOf(t).stroke}`,
                      }}
                    />
                    {counts[t]} {NODE_TYPE_LABEL[t]?.toLowerCase()}
                  </span>
                ) : null,
              )}
              {map.edges?.length > 0 && <span>· {map.edges.length} liên kết ngang</span>}
            </div>
          )}

          {!trinhChieu && (
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="hidden lg:block coord text-text-muted">
                Ctrl + lăn để phóng sơ đồ · lăn thường để cuộn trang · kéo để di chuyển
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => zoomBy(-ZOOM_STEP)}
                          aria-label="Thu nhỏ" title="Thu nhỏ (−)"
                          className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-text-secondary">
                    <Icon name="ZoomOut" size={14} />
                  </button>
                  <button type="button" onClick={zoomReset}
                          aria-label="Đặt lại thu phóng" title="Đặt lại thu phóng (0)"
                          className="px-1 py-1 rounded hover:bg-[var(--bg-hover)] font-mono text-[11px] tabular-nums text-text-secondary min-w-[38px]">
                    {formatZoom(zoom)}
                  </button>
                  <button type="button" onClick={() => zoomBy(ZOOM_STEP)}
                          aria-label="Phóng to" title="Phóng to (+)"
                          className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-text-secondary">
                    <Icon name="ZoomIn" size={14} />
                  </button>
                </div>
                {focusedId && (
                  <button type="button" onClick={boFocus}
                          className="pill-action !py-1 !text-[11.5px] inline-flex items-center gap-1">
                    <Icon name="X" size={12} /> Bỏ focus
                  </button>
                )}
                <div className="relative">
                  <Icon name="Search" size={13}
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    value={truyVan}
                    onChange={(e) => doiTruyVan(e.target.value)}
                    onKeyDown={xuLyPhimTim}
                    placeholder="Tìm theo tên khái niệm…"
                    aria-label="Tìm trong sơ đồ kiến thức"
                    className="rounded-[6px] border pl-7 pr-2 py-1 text-[12px] bg-transparent w-[190px]"
                    style={{ borderColor: "var(--border-color)" }}
                  />
                </div>
                {truyVan && (
                  <span className="text-[11px] text-text-muted tabular-nums" aria-live="polite">
                    {ketQuaTim.total
                      ? `${ketQuaTim.activeIndex + 1}/${ketQuaTim.total}`
                      : "Không có kết quả"}
                  </span>
                )}
                <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                  Bố cục
                  <select
                    value={layoutId}
                    onChange={(e) => doiLayout(e.target.value)}
                    aria-label="Bố cục sơ đồ"
                    className="rounded-[6px] border px-2 py-1 text-[12px] bg-transparent"
                    style={{ borderColor: "var(--border-color)" }}
                  >
                    {LAYOUT_IDS.map((id) => (
                      <option key={id} value={id}>{nhanLayout(id)}</option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => xuatAnh("png")}
                        disabled={dangXuat}
                        title="Xuất PNG (nền theo giao diện hiện tại, x2 độ phân giải)"
                        className="pill-action !py-1 !text-[11.5px] inline-flex items-center gap-1 disabled:opacity-50">
                  {dangXuat ? <Spinner size={11} /> : <Icon name="Download" size={12} />} PNG
                </button>
                <button type="button" onClick={() => xuatAnh("png", { transparent: true })}
                        disabled={dangXuat}
                        title="Xuất PNG nền trong suốt"
                        className="pill-action !py-1 !text-[11.5px] disabled:opacity-50">
                  PNG trong suốt
                </button>
                <button type="button" onClick={() => xuatAnh("svg")}
                        disabled={dangXuat}
                        title="Xuất SVG"
                        className="pill-action !py-1 !text-[11.5px] disabled:opacity-50">
                  SVG
                </button>
                <button type="button" onClick={() => doiTrinhChieu(true)}
                        title="Chế độ trình chiếu (Esc để thoát)"
                        className="pill-action !py-1 !text-[11.5px] inline-flex items-center gap-1">
                  <Icon name="Maximize" size={12} /> Trình chiếu
                </button>
              </div>
            </div>
          )}

          <div className={`flex gap-4 items-start ${trinhChieu ? "" : "flex-col lg:flex-row"}`}>
            <div
              ref={canvasRef}
              className="surface-card !p-0 overflow-hidden w-full relative"
              style={{ height: trinhChieu ? "calc(100vh - 120px)" : "min(70vh, 640px)",
                       flex: trinhChieu ? "1 1 auto" : undefined }}
            >
              {tree && (
                <Tree
                  data={tree}
                  orientation={rd3tProps.orientation}
                  translate={translate}
                  nodeSize={{ x: 300, y: 42 }}
                  separation={{ siblings: 1, nonSiblings: 1.25 }}
                  zoom={zoom}
                  scaleExtent={{ min: SCALE_MIN, max: SCALE_MAX }}
                  onUpdate={onTreeUpdate}
                  collapsible
                  // 44 node không vừa một khung 640px. Mở sẵn tới tầng chương
                  // mục thôi, người đọc bấm để bung nhánh mình quan tâm — hơn
                  // là đổ hết ra rồi bắt cuộn tìm.
                  initialDepth={1}
                  pathFunc={rd3tProps.pathFunc}
                  renderCustomNodeElement={renderNode}
                  pathClassFunc={() => "study-map__link"}
                />
              )}
              {/* Luật mới phải nói ra: không ai đoán được "Ctrl + lăn". Chỉ hiện ở khổ
                  rộng — máy cảm ứng không có con lăn nên câu này vô nghĩa ở đó. */}
              {trinhChieu && (
                <button type="button" onClick={() => doiTrinhChieu(false)}
                        title="Thoát trình chiếu (Esc)"
                        aria-label="Thoát trình chiếu"
                        className="icon-btn absolute top-3 right-3 z-10"
                        style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}>
                  <Icon name="X" size={16} />
                </button>
              )}
            </div>

            {!trinhChieu && (
              <aside className="surface-card w-full lg:w-[340px] shrink-0">
                {selected ? (
                  <NodeDetail
                    node={selected}
                    chunks={chunks}
                    edges={edgesOf(selected.node_id)}
                    nodeById={nodeById}
                  />
                ) : (
                  <div className="text-center py-8">
                    <Icon name="Spline" size={20} className="text-text-muted mx-auto mb-2.5" />
                    <p className="text-[13.5px] text-text-secondary leading-[1.65]">
                      Bấm một khái niệm trên sơ đồ để đọc tóm tắt và đoạn tài liệu sinh ra nó.
                      Bấm vào node có nhánh con để bung, kéo nền để di chuyển.
                    </p>
                  </div>
                )}
              </aside>
            )}
          </div>
        </>
      ) : null}
    </StudyShell>
  );
}

function NodeDetail({ node, chunks, edges, nodeById }) {
  const sources = (node.chunk_ids || []).map((id) => chunks.get(id)).filter(Boolean);
  return (
    <div>
      <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-text-muted mb-1.5">
        {NODE_TYPE_LABEL[node.node_type] || node.node_type} · tầng {node.level}
      </div>
      <h2 className="font-display text-[18px] font-semibold text-text-primary leading-[1.35]">
        {node.title}
      </h2>
      {node.summary && (
        <p className="text-[13.5px] leading-[1.65] text-text-secondary mt-2.5">{node.summary}</p>
      )}

      {edges.length > 0 && (
        <div className="mt-5">
          <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-text-muted mb-2">
            Liên kết ngang
          </div>
          <ul className="flex flex-col gap-1.5">
            {edges.map((e) => {
              const outgoing = e.source_node_id === node.node_id;
              const other = nodeById.get(outgoing ? e.target_node_id : e.source_node_id);
              return (
                <li key={e.edge_id} className="text-[13px] leading-[1.55] text-text-primary">
                  <span className="font-mono text-[11px]" style={{ color: "var(--accent)" }}>
                    {outgoing ? "→" : "←"} {RELATION_LABEL[e.relation_type] || e.relation_type}
                  </span>{" "}
                  {other?.title || "(node đã bị xoá)"}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-5">
        <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-text-muted mb-2">
          Đoạn tài liệu nguồn
        </div>
        {sources.length === 0 ? (
          // Khái niệm không neo được về đoạn nào thì nói thẳng — im lặng để trống
          // khiến người đọc tưởng trang lỗi.
          <p className="text-[13px] text-text-muted">
            {node.chunk_ids?.length
              ? "Không tải được nội dung đoạn nguồn."
              : "Khái niệm này không neo về đoạn văn cụ thể nào."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {sources.map((c) => (
              <li key={c.chunk_id} className="cite-block">
                {c.heading && (
                  <div className="font-mono text-[10.5px] text-text-muted mb-1">
                    {c.heading}{c.page_number ? ` · trang ${c.page_number}` : ""}
                  </div>
                )}
                <p className="text-[12.5px] leading-[1.6] text-text-secondary">
                  {String(c.text || "").slice(0, 320)}
                  {String(c.text || "").length > 320 ? "…" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
