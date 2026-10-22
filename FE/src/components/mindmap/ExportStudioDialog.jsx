import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "../ui/Modal";
import { Icon } from "../ui/Icon";
import Spinner from "../ui/Spinner";
import { resolveExportScope, countRendered, countHiddenIncluded, deriveOpeningScope, UnknownNodeIdError, NoSelectionError } from "../../utils/mindmapExportScope";
import { isRootOnly } from "../../utils/mindElixirRootOnly";
import { exportMindmapImage, estimateExportDimensions, captureMapImageBase64, captureMapImageWithGeometry } from "../../utils/mindmapImageExport";
import { sanitizeExportFilename } from "../../utils/mindmapExportFilename";
import { PRESETS, DEFAULT_APPEARANCE } from "../../utils/mindmapExportAppearance";
import { getExportFormatCapabilities, isDocumentFormat } from "../../utils/mindmapExportFormatCapabilities";
import { createMindmapExport, pollMindmapExportUntilDone, cancelMindmapExport, triggerMindmapExportDownload } from "../../utils/mindmapDocumentExport";
import { buildDocumentScopePayload } from "../../utils/mindmapDocumentScopePayload";
// PR C2: Segmented/Control/Accordion moved to AppearanceControls.jsx so the
// toolbar "Giao diện" editor and this dialog's appearance override step
// share the exact same primitives — never two hand-rolled copies.
import { Segmented, Control, Accordion, NodeRoleEditor, ConnectorEditor, RoleTabs } from "./AppearanceControls";
import { resolveCanvasAppearance, resolveExportAppearance } from "../../utils/mindMapAppearanceV2";
import { patchMindmapAppearance } from "../../utils/api";
import "./exportStudio.css";

const STEPS = [["Nội dung", "Chọn phạm vi xuất", "BookOpen"], ["Định dạng", "Chọn loại file", "FileStack"], ["Giao diện", "Tùy chỉnh hiển thị", "Sliders"], ["Kiểm tra", "Xem trước và xuất", "CheckCircle2"]];
const SCOPES = [["full", "Toàn bộ sơ đồ", "Bao gồm toàn bộ cây, kể cả nhánh đang thu gọn.", "Network"], ["current_branch", "Nhánh hiện tại", "Xuất toàn bộ cây con từ node đang chọn trên canvas.", "GitBranch"], ["selected_branches", "Các node được chọn", "Chỉ node đã tick và tổ tiên tối thiểu cần để kết nối.", "MousePointerClick"], ["visible", "Phần đang hiển thị", "Chỉ các node đang hiện trên canvas.", "EyeOff"]];
// PR C1: public create formats are exactly these 5. DOCX/XLSX are gone from
// this picker — a job for either still reads/downloads fine if it already
// exists (created before this change, or finished by the worker directly),
// but a NEW one can no longer be started from here; the BE route enforces
// the same restriction independently (app/main.py's _EXPORT_FORMATS).
const IMAGE_FORMATS = [["png", "PNG", "Ảnh sắc nét, hỗ trợ nền trong suốt.", "Image"], ["jpeg", "JPEG", "Ảnh nhẹ, phù hợp để chia sẻ.", "Image"], ["svg", "SVG", "Ảnh vector, phóng to không vỡ nét.", "Spline"], ["webp", "WebP", "Ảnh nhẹ, hỗ trợ nền trong suốt.", "Image"]];
const DOCUMENT_FORMATS = [["pdf", "PDF", "Sơ đồ và dàn ý để học hoặc in.", "FileText"]];
const BACKGROUNDS = [["canvas", "Giống canvas"], ["white", "Trắng"], ["dark", "Tối"], ["transparent", "Trong suốt"], ["custom", "Tùy chỉnh"]];
const DOC_BACKGROUNDS = [["white", "Trắng"], ["dark", "Tối"], ["custom", "Tùy chỉnh"]];
const PRESET_OPTIONS = [["canvas", "Giống canvas"], ["study", "Tài liệu học tập"], ["minimal", "Tối giản"], ["presentation", "Trình bày"]];
const FONT_OPTIONS = [["canvas", "Giống canvas"], ["sans", "Sans (Inter)"], ["serif", "Serif (Spectral)"]];
const DOC_FONT_OPTIONS = [["sans", "Sans (Inter)"], ["serif", "Serif (Spectral)"]];
const COLOR_OPTIONS = [["keep", "Giữ nguyên"], ["monochrome", "Đơn sắc"], ["customPalette", "Bảng màu riêng"]];
const SPACING_OPTIONS = [["compact", "Gọn"], ["normal", "Vừa"], ["spacious", "Rộng"]];
const THICKNESS_OPTIONS = [["thin", "Mảnh"], ["normal", "Vừa"], ["thick", "Đậm"]];
const MARGIN_OPTIONS = [["narrow", "Hẹp"], ["normal", "Vừa"], ["wide", "Rộng"]];
const PAGE_OPTIONS = [["A4", "A4 — In tài liệu"], ["A3", "A3 — In sơ đồ lớn"], ["content_fit", "Vừa nội dung — Xem trên màn hình"]];
const ORIENTATION_OPTIONS = [["portrait", "Dọc"], ["landscape", "Ngang"]];
const PDF_MODE_OPTIONS = [["outline", "Chỉ dàn ý"], ["map", "Chỉ sơ đồ"], ["map_and_outline", "Sơ đồ + dàn ý"]];
const CONTENT_LABELS = { notes: "Ghi chú", citations: "Trích dẫn", sourceNames: "Tên nguồn", relations: "Đường quan hệ", legend: "Chú giải màu nhánh", branding: "Nhãn StudyMap" };
const includeDescendantsFor = (scopeType) => scopeType !== "selected_branches";

const documentDefaults = () => ({ pdf: getExportFormatCapabilities("pdf").defaults, docx: getExportFormatCapabilities("docx").defaults, xlsx: getExportFormatCapabilities("xlsx").defaults });
const colorKey = (format) => format === "docx" ? "headingColorMode" : format === "xlsx" ? "headerStyleMode" : "branchColorMode";
function backgroundColor(key, custom) { if (key === "canvas") return getComputedStyle(document.documentElement).getPropertyValue("--bg-base").trim() || "#fff"; if (key === "custom") return custom; return { white: "#fff", dark: "#15171C", transparent: "transparent" }[key] || "#fff"; }

function liveTreeSnapshot(node) {
  return [
    node.id,
    node.topic,
    node.expanded !== false,
    node.direction ?? null,
    node.style ?? null,
    (node.children || []).map(liveTreeSnapshot),
  ];
}

function liveTreeSignature(node) {
  return node ? JSON.stringify(liveTreeSnapshot(node)) : "";
}

function resolveScopePreview({ mind, mapId, scopeType, selectedNodeId, selectedBranchIds, visibleOnly }) {
  try {
    const resolved = resolveExportScope({
      nodeData: mind.nodeData,
      scopeType,
      selectedNodeId,
      selectedBranchRootIds: selectedBranchIds ? [...selectedBranchIds] : [],
      includeDescendants: includeDescendantsFor(scopeType),
      visibleOnly,
      visibleIdsOverride: isRootOnly(mind) ? new Set([mind.nodeData.id]) : null,
    });
    const includedIds = [...resolved.includedIds].sort();
    return {
      ok: true,
      mapId,
      scopeKey: includedIds.join("\u0000"),
      treeKey: liveTreeSignature(mind.nodeData),
      count: countRendered(resolved.includedIds, resolved.contextIds),
      explicitCount: resolved.explicitSelectedIds.length,
      hidden: countHiddenIncluded(mind.nodeData, resolved.includedIds),
    };
  } catch (e) {
    if (e instanceof NoSelectionError) return { ok: false, message: scopeType === "selected_branches" ? "Chọn ít nhất một node để tiếp tục." : "Chọn một node trên canvas để tiếp tục." };
    if (e instanceof UnknownNodeIdError) return { ok: false, message: "Lựa chọn không còn hợp lệ trên sơ đồ này." };
    return { ok: false, message: e.message };
  }
}

export default function ExportStudioDialog({ open, onClose, mind, record, mapId, canvasReadyId, title, selectedNodeId, selectedBranchIds, onRequestBranchSelection, savedAppearance, onAppearanceSaved }) {
  const [step, setStep] = useState(0), [furthest, setFurthest] = useState(0);
  // PR C2 — "Dùng giao diện của sơ đồ" (default) vs "Tùy chỉnh riêng bản
  // xuất". `styleOverride` is lazily seeded from the map's OWN resolved
  // appearance the first time the user switches to custom, so editing
  // starts from "what the map already looks like", not a blank slate; it
  // is the LIVE_SAFE-only layer (node/connector) — never persisted unless
  // "Áp dụng cho sơ đồ" is pressed, never affects the live canvas.
  const [useMapAppearance, setUseMapAppearance] = useState(true);
  const [styleOverride, setStyleOverride] = useState(null);
  const [styleRole, setStyleRole] = useState("root");
  const [applyingToMap, setApplyingToMap] = useState(false);
  const [applyToMapError, setApplyToMapError] = useState(null);
  // PR G — real initial value comes from the closed->open edge effect below
  // (deriveOpeningScope), not this useState call: a plain initializer only
  // ever runs once, at this component's first mount, which happens with no
  // selection yet (see this file's PR G comment on that effect for why that
  // was the bug).
  const [scopeType, setScopeType] = useState("full"), [visibleOnly, setVisibleOnly] = useState(false), [advanced, setAdvanced] = useState(false);
  const [format, setFormat] = useState("png"), [background, setBackground] = useState("canvas"), [customColor, setCustomColor] = useState("#FFFFFF"), [scale, setScale] = useState(2);
  // Immutable for one open confirmation session. The live Set belongs to the
  // canvas selection UI; format/preset changes and unrelated parent rerenders
  // must not rewrite the ids the user confirmed by pressing "Tiếp tục".
  const [selectedBranchSnapshot, setSelectedBranchSnapshot] = useState([]);
  const selectedBranchSnapshotSet = useMemo(() => new Set(selectedBranchSnapshot), [selectedBranchSnapshot]);
  const [filenameOverride, setFilenameOverride] = useState(""), [appearance, setAppearance] = useState(DEFAULT_APPEARANCE), [appearancePreset, setAppearancePreset] = useState("canvas"), [quickPreset, setQuickPreset] = useState(null);
  const [docs, setDocs] = useState(documentDefaults), [includeMapImage, setIncludeMapImage] = useState(false), [openSection, setOpenSection] = useState("colors");
  const [exporting, setExporting] = useState(false), [error, setError] = useState(null), [done, setDone] = useState(null), [jobStatus, setJobStatus] = useState(null), [jobProgress, setJobProgress] = useState(0), [jobId, setJobId] = useState(null);
  const abortRef = useRef(null), isDoc = isDocumentFormat(format), capabilities = useMemo(() => getExportFormatCapabilities(format), [format]), docOptions = docs[format] || docs.pdf, branchCount = selectedBranchSnapshot.length;
  const custom = () => setQuickPreset(null);
  const changeFormat = (next, manual = true) => { setFormat(next); setOpenSection(isDocumentFormat(next) ? (next === "xlsx" ? "content" : "layout") : "colors"); if (manual) custom(); };
  const updateDoc = (key, value) => { custom(); setAppearancePreset(null); setDocs((all) => ({ ...all, [format]: { ...all[format], [key]: value } })); };
  const updatePdfMode = (mode) => {
    custom();
    setAppearancePreset(null);
    setDocs((all) => {
      const current = all[format];
      return {
        ...all,
        [format]: {
          ...current,
          mode,
          // content_fit shapes a map page around its raster. A standalone
          // outline has no map page, so keep the serializer's intentional
          // A4 fallback visible in the UI instead of retaining a misleading
          // screen-layout selection.
          pageSize: mode === "outline" && current.pageSize === "content_fit" ? "A4" : current.pageSize,
        },
      };
    });
  };
  const updateDocContent = (key, value) => { custom(); setAppearancePreset(null); setDocs((all) => ({ ...all, [format]: { ...all[format], content: { ...all[format].content, [key]: value } } })); };
  const updateAppearance = (patch) => { custom(); setAppearancePreset(null); setAppearance((old) => ({ ...old, ...patch })); };
  const updateContent = (key, value) => { custom(); setAppearancePreset(null); setAppearance((old) => ({ ...old, content: { ...old.content, [key]: value } })); };
  const applyQuick = (name) => { setQuickPreset(name); if (name === "png") { changeFormat("png", false); setBackground("canvas"); setScale(2); setAppearance(PRESETS.canvas); setAppearancePreset("canvas"); } else if (name === "pdf") { changeFormat("pdf", false); setAppearancePreset("study"); const base = getExportFormatCapabilities("pdf").defaults; setDocs((all) => ({ ...all, pdf: { ...base, mode: "map_and_outline", content: { ...base.content, notes: true } } })); } else { changeFormat("webp", false); setBackground("canvas"); setScale(2); setAppearance(PRESETS.canvas); setAppearancePreset("canvas"); } };
  const applyAppearancePreset = (name) => { custom(); setAppearancePreset(name); if (!isDoc) return setAppearance(PRESETS[name]); const visual = PRESETS[name]; setDocs((all) => { const next = { ...all[format], font: visual.font === "serif" ? "serif" : "sans" }; if (capabilities.controls.branchColor || capabilities.controls.headingColor || capabilities.controls.headerStyle) next[colorKey(format)] = visual.branchColorMode; const content = { ...next.content }; Object.keys(content).forEach((key) => { if (key in visual.content) content[key] = visual.content[key]; }); return { ...all, [format]: { ...next, content } }; }); };

  // H3A (A6) — "Chỉ giữ node đang hiển thị..." only has a real, end-to-end
  // contract for scopeType "full" (it maps to the server's own "visible"
  // scope, which snapshots an explicit client-supplied node-id list — see
  // services/mindmap/export/scope.py's docstring). For "current_branch" and
  // "selected_branches" the record-based resolver has no visible-only
  // concept: current_branch keeps its subtree behavior and selected_branches
  // uses exact checked membership. The LIVE preview used to apply an unrelated
  // filter for those scopes, so the
  // preview count could promise a smaller export than what actually got
  // generated. Clamping here (never raw `visibleOnly`) keeps the preview,
  // the checkbox's own enabled state, and the real export in agreement.
  const visibleOnlyApplies = scopeType === "full";
  const effectiveVisibleOnly = visibleOnlyApplies && visibleOnly;
  // MindElixirView reuses one instance and refreshes nodeData in place, so
  // object identity is not a freshness signal. canvasReadyId proves that
  // init/refresh has committed for this map; until then the previous tree
  // must not be previewed. The open edge snapshots same-map mutations too,
  // without traversing the tree on unrelated renders. The readiness prop is
  // optional for direct dialog callers that own their mind fixture.
  const mindReady = canvasReadyId === undefined || canvasReadyId === mapId;
  const [previewRevision, setPreviewRevision] = useState(0);
  const scopeResult = useMemo(() => {
    void previewRevision;
    if (!open || !mindReady || !mind?.nodeData) return null;
    return resolveScopePreview({ mind, mapId, scopeType, selectedNodeId, selectedBranchIds: selectedBranchSnapshotSet, visibleOnly: effectiveVisibleOnly });
  }, [open, mind, mindReady, mapId, scopeType, selectedNodeId, selectedBranchSnapshotSet, effectiveVisibleOnly, previewRevision]);
  const scopeLabel = { full: "Toàn bộ sơ đồ", current_branch: "Nhánh hiện tại", selected_branches: "Các node được chọn", visible: "Phần đang hiển thị" }[scopeType], filename = sanitizeExportFilename(filenameOverride || title), extension = format === "jpeg" ? "jpg" : format;
  const estimated = useMemo(() => !open || !mindReady || !mind?.map || !scopeResult?.ok || isDoc ? null : estimateExportDimensions({ mind, scopeType, targetNodeId: selectedNodeId, branchRootIds: selectedBranchSnapshot, includeDescendants: includeDescendantsFor(scopeType), scale }), [open, mind, mindReady, scopeType, selectedNodeId, selectedBranchSnapshot, scale, scopeResult, isDoc]);
  // One idempotency key per export ATTEMPT (each click of export/retry/re-export), never per configuration: a re-export is a new job.
  const attemptKeyRef = useRef(null);
  const newAttemptKey = () => { attemptKeyRef.current = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`; return attemptKeyRef.current; };
  const inFlightRef = useRef(false);
  const canAdvance = scopeResult?.ok, canExport = canAdvance && !(isDoc && !mapId), effectiveScope = effectiveVisibleOnly ? "visible" : scopeType;
  const close = () => { if (!exporting) { abortRef.current?.abort(); onClose?.(); } };
  useEffect(() => () => { attemptKeyRef.current = null; abortRef.current?.abort(); }, []);
  useEffect(() => { attemptKeyRef.current = null; abortRef.current?.abort(); inFlightRef.current = false; setExporting(false); setError(null); setDone(null); setJobStatus(null); setJobProgress(0); setJobId(null); setSelectedBranchSnapshot([]); }, [mapId]);
  // Clears everything tied to one attempt (artifact, job, error, in-flight guard). Configuration is kept.
  const resetTransient = () => { attemptKeyRef.current = null; abortRef.current?.abort(); inFlightRef.current = false; setExporting(false); setError(null); setDone(null); setJobStatus(null); setJobProgress(0); setJobId(null); };
  // Reopening always starts at the configuration step with no leftover artifact or job.
  useEffect(() => { if (open) { resetTransient(); setStep(0); setFurthest(0); setUseMapAppearance(true); setStyleOverride(null); setApplyToMapError(null); } }, [open]);
  // PR G — re-derive the scope radio ONLY on the closed->open edge (a ref,
  // not just the `[open]` dependency array, so this stays correct even if a
  // future caller ever adds another effect that also depends on `open`).
  // Never fires again while the dialog stays open, even if the selection
  // changes under it or the user flips the radio by hand — both must stick
  // for the rest of this open session.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setSelectedBranchSnapshot([...(selectedBranchIds || [])]);
      setScopeType(deriveOpeningScope({ selectedBranchIds, selectedNodeId }));
    }
    wasOpenRef.current = open;
  }, [open, selectedBranchIds, selectedNodeId]);
  const startNewExport = () => { resetTransient(); setStep(0); setFurthest(0); setUseMapAppearance(true); setStyleOverride(null); setApplyToMapError(null); };
  // PR C2 — lazily seeds the draft from the map's OWN resolved appearance
  // (not a blank slate) the first time the user switches to custom.
  const switchAppearanceMode = (useMap) => { custom(); setUseMapAppearance(useMap); if (!useMap && !styleOverride) setStyleOverride(resolveCanvasAppearance({ savedAppearance })); };
  const patchStyleOverride = (patch) => { custom(); setStyleOverride((prev) => ({ ...(prev || resolveCanvasAppearance({ savedAppearance })), ...patch })); };
  const resolvedStyle = useMemo(
    () => resolveExportAppearance({ canvasAppearance: savedAppearance, exportOverride: useMapAppearance ? null : styleOverride }),
    [savedAppearance, useMapAppearance, styleOverride],
  );
  const handleApplyAppearanceToMap = async () => {
    if (!mapId || !styleOverride) return;
    setApplyingToMap(true);
    setApplyToMapError(null);
    try {
      const res = await patchMindmapAppearance(mapId, { version: 2, preset: "default", overrides: styleOverride });
      onAppearanceSaved?.(res.appearance);
      setUseMapAppearance(true);
      setStyleOverride(null);
    } catch (e) {
      setApplyToMapError(e?.message || "Không lưu được giao diện cho sơ đồ.");
    } finally {
      setApplyingToMap(false);
    }
  };
  const completed = Boolean(done) || jobStatus === "done";

  const exportAppearanceParams = { canvasAppearance: savedAppearance, exportStyleOverride: useMapAppearance ? null : styleOverride };
  const runImage = async () => setDone(await exportMindmapImage({ mind, record, scopeType: effectiveScope, targetNodeId: selectedNodeId, branchRootIds: selectedBranchSnapshot, includeDescendants: includeDescendantsFor(effectiveScope), visibleOnly: effectiveVisibleOnly, format, backgroundColor: backgroundColor(background, customColor), scale, title: filename, appearance, ...exportAppearanceParams }));
  const runDocument = async (attemptKey, controller) => {
    const { signal } = controller;
    const assertActive = () => {
      if (signal.aborted || attemptKeyRef.current !== attemptKey) throw new DOMException("aborted", "AbortError");
    };
    setJobStatus("queued"); setJobProgress(0); setJobId(null);
    let mapImageBase64, mapGeometryManifest;
    if (format === "pdf" && docOptions.mode !== "outline") {
      // PR H2 — same capture lifecycle as before, now also returns a
      // geometry manifest built from the SAME DOM snapdom just captured
      // (never a second render just to measure geometry).
      const captured = await captureMapImageWithGeometry({ mind, record, scopeType: effectiveScope, targetNodeId: selectedNodeId, branchRootIds: selectedBranchSnapshot, includeDescendants: includeDescendantsFor(effectiveScope), visibleOnly: effectiveVisibleOnly, ...exportAppearanceParams });
      assertActive();
      mapImageBase64 = captured.base64;
      mapGeometryManifest = captured.geometryManifest;
    } else if (format === "docx" && includeMapImage) {
      mapImageBase64 = await captureMapImageBase64({ mind, record, scopeType: effectiveScope, targetNodeId: selectedNodeId, branchRootIds: selectedBranchSnapshot, includeDescendants: includeDescendantsFor(effectiveScope), visibleOnly: effectiveVisibleOnly, ...exportAppearanceParams });
      assertActive();
    }
    assertActive();
    const scope = buildDocumentScopePayload({ mind, scopeType, selectedNodeId, selectedBranchRootIds: selectedBranchSnapshot, visibleOnly: effectiveVisibleOnly });
    const created = await createMindmapExport(mapId, { format, scope, options: docOptions, mapImageBase64, mapGeometryManifest, idempotencyKey: attemptKey, signal });
    if (signal.aborted || attemptKeyRef.current !== attemptKey) {
      if (created?.job_id) try { await cancelMindmapExport(created.job_id); } catch { /* best effort */ }
      assertActive();
    }
    setJobId(created.job_id);
    const final = await pollMindmapExportUntilDone(created.job_id, { signal, onUpdate: (s) => { if (!signal.aborted && attemptKeyRef.current === attemptKey) { setJobStatus(s.status); setJobProgress(s.progress || 0); } } });
    assertActive();
    if (final.status === "done") {
      // PR H2 — the ceiling-exceeded warning (when present) lives inside
      // the job's own `result` dict, never at the top level of the status
      // payload (see app/application/mindmap_export.py's run_export_job).
      setDone({ filename: `${filename}.${format}`, warning: final.result?.warning || null });
      if (final.download_url) triggerMindmapExportDownload(final.download_url);
    } else if (final.status === "cancelled") throw new Error("Đã hủy xuất tài liệu.");
    else throw new Error(final.error || "Xuất tài liệu thất bại.");
  };
  const runExport = async () => {
    if (!mind || !canExport || inFlightRef.current) return;
    // Re-resolve at the confirmation click. If the live tree changed while
    // the modal was open, update the displayed snapshot and require one more
    // confirmation instead of exporting a scope different from the preview.
    const latest = mindReady && mind.nodeData
      ? resolveScopePreview({ mind, mapId, scopeType, selectedNodeId, selectedBranchIds: selectedBranchSnapshotSet, visibleOnly: effectiveVisibleOnly })
      : null;
    if (!latest?.ok || latest.mapId !== scopeResult?.mapId || latest.scopeKey !== scopeResult?.scopeKey || latest.treeKey !== scopeResult?.treeKey) {
      setPreviewRevision((value) => value + 1);
      setError("Sơ đồ vừa thay đổi. Phạm vi xem trước đã được cập nhật; vui lòng xác nhận lại.");
      return;
    }
    inFlightRef.current = true;
    setExporting(true);
    setError(null);
    const attemptKey = newAttemptKey();
    const controller = isDoc ? new AbortController() : null;
    if (controller) abortRef.current = controller;
    try { if (isDoc) await runDocument(attemptKey, controller); else await runImage(); }
    catch (e) { if (e?.name !== "AbortError") setError(e?.message || "Không xuất được sơ đồ."); setJobStatus((s) => ["queued", "running"].includes(s) ? "error" : s); }
    finally { if (attemptKeyRef.current === attemptKey) { inFlightRef.current = false; setExporting(false); } }
  };
  const cancel = async () => { attemptKeyRef.current = null; abortRef.current?.abort(); inFlightRef.current = false; if (jobId) try { await cancelMindmapExport(jobId); } catch { /* best effort */ } setJobStatus("cancelled"); setExporting(false); };
  const next = () => { if (step === 0 && !canAdvance) return; setStep((old) => { const value = Math.min(3, old + 1); setFurthest((seen) => Math.max(seen, value)); return value; }); };
  const summary = `${scopeLabel} · ${format.toUpperCase()}${scopeResult?.ok ? ` · ${scopeType === "selected_branches" ? `${scopeResult.explicitCount} node đã tick · ` : ""}${scopeResult.count} node thực tế` : ""}`, cta = format === "pdf" ? "Tạo PDF" : format === "docx" ? "Tạo DOCX" : format === "xlsx" ? "Tạo XLSX" : `Xuất ${format.toUpperCase()}`;

  const contentStep = <div className="export-step"><header className="export-step__header"><h3>Nội dung xuất</h3><p>Chọn nhanh một cấu hình hoặc tự thiết lập phạm vi.</p></header>{!scopeResult && <div className="export-message" role="status"><Spinner size={14} />Đang đồng bộ phạm vi từ sơ đồ hiện tại…</div>}<section><div className="export-section-title"><span>Xuất nhanh</span>{!quickPreset && <small>Tùy chỉnh</small>}</div><div className="export-quick-grid">{[["png", "Ảnh PNG", "Image"], ["pdf", "PDF học tập", "FileText"], ["webp", "Ảnh WebP", "Image"]].map(([key, label, icon]) => <button key={key} type="button" className={quickPreset === key ? "is-selected" : ""} aria-pressed={quickPreset === key} onClick={() => applyQuick(key)}><Icon name={icon} size={17} />{label}</button>)}</div></section><section><div className="export-section-title"><span>Phạm vi xuất</span></div><div className="export-choice-list" role="radiogroup" aria-label="Phạm vi xuất">{SCOPES.map(([key, label, hint, icon]) => <label key={key} className={scopeType === key ? "is-selected" : ""}><Icon name={icon} size={18} /><span className="export-choice-list__copy"><strong>{label}</strong><small id={`scope-${key}-desc`}>{key === "current_branch" && !selectedNodeId ? "Chưa chọn node. Chọn một node trên canvas trước." : hint}</small></span>{key === "selected_branches" && <><span className="export-count">{branchCount} node đã tick</span><button type="button" className="export-inline-action" onClick={(e) => { e.preventDefault(); onRequestBranchSelection?.(); }}>Chọn trên canvas<span className="sr-only"> {branchCount ? "Chọn lại node trên sơ đồ" : "Chọn node trên sơ đồ"}</span></button></>}<input type="radio" name="mm-export-scope" value={key} checked={scopeType === key} aria-describedby={`scope-${key}-desc`} onChange={() => { custom(); setScopeType(key); }} /></label>)}</div></section><section className="export-advanced"><button type="button" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}><Icon name="Sliders" size={16} />Nâng cao<Icon name={advanced ? "ChevronUp" : "ChevronDown"} size={16} /></button>{advanced && <div className="export-advanced__body"><label className={`export-check ${!visibleOnlyApplies ? "is-disabled" : ""}`}><input name="mm-export-visible-only" type="checkbox" checked={visibleOnly} disabled={!visibleOnlyApplies} aria-describedby="visible-only-desc" onChange={(e) => { custom(); setVisibleOnly(e.target.checked); }} /><span><strong>Chỉ giữ node đang hiển thị trong phạm vi đã chọn</strong><small id="visible-only-desc">{visibleOnlyApplies ? "Áp dụng thêm bộ lọc hiển thị cho phạm vi hiện tại." : "Chỉ áp dụng được cho phạm vi \"Toàn bộ sơ đồ\" — không ảnh hưởng tới nhánh hiện tại hoặc các node được chọn."}</small></span></label></div>}</section>{scopeResult && !scopeResult.ok && <div className="export-message export-message--error" role="alert"><Icon name="AlertCircle" size={16} />{scopeResult.message}</div>}</div>;

  const formatStep = <div className="export-step"><header className="export-step__header"><h3>Chọn định dạng</h3><p>Mỗi định dạng chỉ hiển thị các tùy chọn mà hệ thống hỗ trợ.</p></header>{[["Ảnh", IMAGE_FORMATS], ["Tài liệu", DOCUMENT_FORMATS]].map(([group, formats]) => <section key={group}><div className="export-section-title"><span>{group}</span></div>{group === "Tài liệu" && !mapId && <p className="export-helper">Lưu sơ đồ trước khi xuất định dạng tài liệu.</p>}<div className="export-format-grid" role="radiogroup" aria-label={`Định dạng ${group.toLowerCase()}`}>{formats.map(([key, label, hint, icon]) => <label key={key} className={`${format === key ? "is-selected" : ""} ${group === "Tài liệu" && !mapId ? "is-disabled" : ""}`}><Icon name={icon} size={20} /><span><strong>{label}</strong><small>{hint}</small></span><input type="radio" name="mm-export-format" value={key} checked={format === key} disabled={group === "Tài liệu" && !mapId} onChange={() => changeFormat(key)} /></label>)}</div></section>)}</div>;

  const imageColors = <><Control label="Nền"><Segmented options={BACKGROUNDS} value={background} disabled={(v) => v === "transparent" && format === "jpeg"} onChange={(v) => { custom(); setBackground(v); }} />{background === "custom" && <input type="color" aria-label="Màu nền tùy chỉnh" value={customColor} onChange={(e) => { custom(); setCustomColor(e.target.value); }} />}</Control><Control label="Phông chữ"><Segmented options={FONT_OPTIONS} value={appearance.font} onChange={(v) => updateAppearance({ font: v })} /></Control><Control label="Màu nhánh"><Segmented options={COLOR_OPTIONS} value={appearance.branchColorMode} onChange={(v) => updateAppearance({ branchColorMode: v })} /></Control><Control label="Độ dày đường nối"><Segmented options={THICKNESS_OPTIONS} value={appearance.connectorThickness} onChange={(v) => updateAppearance({ connectorThickness: v })} /></Control></>;
  const imageLayout = <><Control label="Khoảng cách"><Segmented options={SPACING_OPTIONS} value={appearance.spacing} onChange={(v) => updateAppearance({ spacing: v })} /></Control><Control label="Độ phân giải"><Segmented options={[[1, "1×"], [2, "2×"], [4, "4×"]]} value={scale} onChange={(v) => { custom(); setScale(v); }} /></Control></>;
  const docColors = <>{capabilities.controls.font && <Control label="Phông chữ"><Segmented options={DOC_FONT_OPTIONS} value={docOptions.font} onChange={(v) => updateDoc("font", v)} /></Control>}{capabilities.controls.background && <Control label="Nền"><Segmented options={DOC_BACKGROUNDS} value={docOptions.background} onChange={(v) => updateDoc("background", v)} /></Control>}{(capabilities.controls.branchColor || capabilities.controls.headingColor || capabilities.controls.headerStyle) && <Control label={format === "docx" ? "Màu tiêu đề" : format === "xlsx" ? "Màu tiêu đề bảng" : "Màu nhánh"}><Segmented options={COLOR_OPTIONS} value={docOptions[colorKey(format)]} onChange={(v) => updateDoc(colorKey(format), v)} /></Control>}</>;
  const docLayout = <>{capabilities.controls.mode && <Control label="Chế độ"><Segmented options={PDF_MODE_OPTIONS} value={docOptions.mode} onChange={updatePdfMode} /></Control>}{capabilities.controls.pageSize && <Control label="Khổ giấy"><Segmented options={PAGE_OPTIONS} value={docOptions.pageSize} disabled={(v) => docOptions.mode === "outline" && v === "content_fit"} onChange={(v) => updateDoc("pageSize", v)} />{docOptions.mode === "outline" && <span className="export-helper">“Vừa nội dung” chỉ áp dụng cho trang sơ đồ; khi chọn “Chỉ dàn ý”, khổ này chuyển về A4.</span>}</Control>}{capabilities.controls.orientation && (docOptions.mode === "map" || docOptions.mode === "map_and_outline" ? <Control label="Hướng trang"><span className="export-helper">Tự động theo nội dung</span></Control> : <Control label="Hướng trang"><Segmented options={ORIENTATION_OPTIONS} value={docOptions.orientation} onChange={(v) => updateDoc("orientation", v)} /></Control>)}{capabilities.controls.margins && <Control label="Lề"><Segmented options={MARGIN_OPTIONS} value={docOptions.margins} onChange={(v) => updateDoc("margins", v)} /></Control>}{capabilities.controls.singlePage && <label className="export-check"><input type="checkbox" checked={docOptions.singlePage} onChange={(e) => updateDoc("singlePage", e.target.checked)} /><span><strong>Một trang dài duy nhất</strong></span></label>}</>;
  const contentKeys = isDoc ? capabilities.controls.content : ["relations", "citations", "legend", "branding"];
  const appearanceModeSection = <section data-testid="appearance-mode-section"><div className="export-section-title"><span>Giao diện node & đường nối</span></div><div className="export-choice-list" role="radiogroup" aria-label="Giao diện node và đường nối"><label className={useMapAppearance ? "is-selected" : ""}><span className="export-choice-list__copy"><strong>Dùng giao diện của sơ đồ</strong><small>Màu, hình dạng node và đường nối đã lưu cho sơ đồ này.</small></span><input type="radio" name="mm-appearance-mode" checked={useMapAppearance} onChange={() => switchAppearanceMode(true)} /></label><label className={!useMapAppearance ? "is-selected" : ""}><span className="export-choice-list__copy"><strong>Tùy chỉnh riêng bản xuất</strong><small>Các tùy chỉnh chữ và khoảng cách chỉ áp dụng cho tệp xuất.</small></span><input type="radio" name="mm-appearance-mode" checked={!useMapAppearance} onChange={() => switchAppearanceMode(false)} /></label></div>{!useMapAppearance && <><RoleTabs active={styleRole} onChange={setStyleRole} /><NodeRoleEditor role={styleRole} value={resolvedStyle.node[styleRole]} onChange={(roleValue) => patchStyleOverride({ node: { ...(styleOverride?.node), [styleRole]: roleValue } })} /><ConnectorEditor value={resolvedStyle.connector} onChange={(connector) => patchStyleOverride({ connector })} />{applyToMapError && <div className="export-message export-message--error" role="alert"><Icon name="AlertCircle" size={16} />{applyToMapError}</div>}<button type="button" className="btn-secondary" disabled={applyingToMap || !mapId} onClick={handleApplyAppearanceToMap}>{applyingToMap ? "Đang lưu…" : "Áp dụng cho sơ đồ"}</button></>}</section>;
  const appearanceStep = <div className="export-step" data-testid={isDoc ? "doc-appearance" : "image-appearance"}><header className="export-step__header"><h3>Giao diện</h3><p>Các tùy chỉnh được gom theo nhóm để dễ quét.</p></header>{appearanceModeSection}<section><div className="export-section-title"><span>Mẫu dựng sẵn</span>{!appearancePreset && <small>Tùy chỉnh</small>}</div><Segmented options={PRESET_OPTIONS} value={appearancePreset} onChange={applyAppearancePreset} /></section><div className="export-preview" aria-label="Xem trước giao diện"><div className="export-preview__canvas"><span className="export-preview__root" /><i /><span /><i /><span /></div><div><strong>{PRESET_OPTIONS.find(([v]) => v === appearancePreset)?.[1] || "Tùy chỉnh"}</strong><small>{format.toUpperCase()} · {isDoc ? docOptions?.font : appearance.font}</small></div></div><div className="export-accordions"><Accordion id="export-colors" title="Màu và kiểu chữ" icon="Sliders" open={openSection === "colors"} onToggle={() => setOpenSection(openSection === "colors" ? null : "colors")}>{isDoc ? docColors : imageColors}</Accordion><Accordion id="export-layout" title="Bố cục" icon="Rows3" open={openSection === "layout"} onToggle={() => setOpenSection(openSection === "layout" ? null : "layout")}>{isDoc ? docLayout : imageLayout}</Accordion><Accordion id="export-content" title="Nội dung kèm theo" icon="FileStack" open={openSection === "content"} onToggle={() => setOpenSection(openSection === "content" ? null : "content")}><div className="export-check-grid">{contentKeys.map((key) => <label className="export-check" key={key}><input type="checkbox" checked={isDoc ? !!docOptions.content?.[key] : appearance.content[key]} onChange={(e) => isDoc ? updateDocContent(key, e.target.checked) : updateContent(key, e.target.checked)} /><span><strong>{CONTENT_LABELS[key]}</strong></span></label>)}{isDoc && capabilities.controls.mapImage && <label className="export-check"><input type="checkbox" checked={includeMapImage} onChange={(e) => { custom(); setIncludeMapImage(e.target.checked); }} /><span><strong>Kèm ảnh sơ đồ</strong></span></label>}</div></Accordion><Accordion id="export-filename" title="Tên file" icon="FileText" open={openSection === "filename"} onToggle={() => setOpenSection(openSection === "filename" ? null : "filename")}><label className="export-filename"><span>Tên file</span><div><input type="text" value={filenameOverride} onChange={(e) => { custom(); setFilenameOverride(e.target.value); }} placeholder={sanitizeExportFilename(title)} /><b>.{extension}</b></div><small>Tên không hợp lệ sẽ được tự động làm sạch.</small></label></Accordion></div></div>;

  const included = (isDoc ? Object.entries(docOptions?.content || {}) : Object.entries(appearance.content)).filter(([, value]) => value).map(([key]) => CONTENT_LABELS[key]);
  const reviewStep = <div className="export-step"><header className="export-step__header"><h3>Kiểm tra trước khi xuất</h3><p>Xác nhận cấu hình. Xem trước không thay đổi canvas hiện tại.</p></header>{done ? <><div className="export-success"><Icon name="CheckCircle2" size={22} /><div><strong>Đã xuất: {done.filename}</strong><span>File đã tải xuống trình duyệt.</span></div></div>{done.warning?.code === "detail_pages_skipped_ceiling_exceeded" && <div className="export-message export-message--warning" role="status"><Icon name="TriangleAlert" size={16} />Sơ đồ quá lớn để tạo trang chi tiết đọc được trong giới hạn hệ thống. Bản xuất chỉ gồm trang tổng quan.</div>}</> : <div className="export-review" aria-label="Tóm tắt cấu hình xuất"><div className="export-review__thumb"><div className="export-preview__canvas"><span className="export-preview__root" /><i /><span /><i /><span /></div><small>{format.toUpperCase()}</small></div><dl><div><dt>Phạm vi</dt><dd>{scopeLabel}</dd></div><div><dt>Định dạng</dt><dd>{format.toUpperCase()}</dd></div><div><dt>Số node/nhánh</dt><dd>{scopeResult?.ok ? (scopeType === "selected_branches" ? `${scopeResult.explicitCount} node đã tick · ${scopeResult.count} node thực tế${scopeResult.count > scopeResult.explicitCount ? " (bao gồm node context)" : ""}` : `${scopeResult.count} node`) : "Chưa hợp lệ"}</dd></div><div><dt>Mẫu giao diện</dt><dd>{PRESET_OPTIONS.find(([v]) => v === appearancePreset)?.[1] || "Tùy chỉnh"}</dd></div><div><dt>Nội dung kèm theo</dt><dd>{included.join(", ") || "Không có"}</dd></div><div><dt>Tên file</dt><dd>{filename}.{extension}</dd></div>{estimated && <div><dt>Kích thước</dt><dd>≈{estimated.width}×{estimated.height}px</dd></div>}</dl></div>}{isDoc && jobStatus && <div className="export-message"><Spinner size={14} />{{ queued: "Đang xếp hàng", running: `Đang xử lý (${jobProgress}%)`, done: "Hoàn tất", error: "Thất bại", cancelled: "Đã hủy" }[jobStatus]}</div>}{error && <div className="export-message export-message--error" role="alert"><Icon name="AlertCircle" size={16} />{error}</div>}</div>;

  return <Modal open={open} title="Xuất sơ đồ" subtitle="Chọn phạm vi, định dạng và cách trình bày" onClose={exporting ? undefined : close} maxWidth={1080} fullBleed className="export-studio-modal"><div className="export-studio"><nav className="export-rail" aria-label="Tiến trình xuất sơ đồ"><ol>{STEPS.map(([label, description, icon], index) => { const state = index === step ? "current" : index < furthest ? "completed" : "pending"; return <li key={label} data-state={state}><button type="button" disabled={index > furthest || exporting} aria-current={index === step ? "step" : undefined} onClick={() => index <= furthest && setStep(index)}><span className="export-rail__marker">{state === "completed" ? <Icon name="Check" size={16} /> : <Icon name={icon} size={17} />}</span><span><strong>{label}</strong><small>{description}</small></span></button></li>; })}</ol></nav><div className="export-workspace"><main className="export-workspace__scroll">{step === 0 ? contentStep : step === 1 ? formatStep : step === 2 ? appearanceStep : reviewStep}</main><footer className="export-footer"><div className="export-footer__summary">{summary}</div><div className="export-footer__actions">{step > 0 && !done && <button type="button" className="btn-secondary" disabled={exporting} onClick={() => setStep((v) => v - 1)}>Quay lại</button>}{exporting && ["queued", "running"].includes(jobStatus) ? <button type="button" className="btn-secondary" onClick={cancel}>Hủy xuất</button> : <button type="button" className="btn-secondary" disabled={exporting} onClick={close}>{done ? "Đóng" : "Hủy"}</button>}{step < 3 && <button type="button" className="btn-primary" disabled={(step === 0 && !canAdvance) || exporting} onClick={next}>Tiếp tục</button>}{step === 3 && completed && <><button type="button" className="btn-secondary" disabled={exporting || !canExport} onClick={runExport}><Icon name="RotateCcw" size={15} />Xuất lại</button><button type="button" className="btn-primary" disabled={exporting} onClick={startNewExport}>Tạo bản xuất mới</button></>}{step === 3 && !completed && <button type="button" className="btn-primary" disabled={exporting || !canExport} onClick={runExport}>{exporting ? <><Spinner size={14} />Đang xuất…</> : jobStatus === "error" ? <><Icon name="RotateCcw" size={15} />Thử lại</> : <><Icon name="Download" size={15} />{cta}</>}</button>}</div></footer></div></div></Modal>;
}
