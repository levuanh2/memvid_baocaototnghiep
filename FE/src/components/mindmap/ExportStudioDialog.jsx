import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "../ui/Modal";
import { Icon } from "../ui/Icon";
import Spinner from "../ui/Spinner";
import {
  resolveExportScope, countIncluded, countHiddenIncluded,
  UnknownNodeIdError, NoSelectionError,
} from "../../utils/mindmapExportScope";
import { exportMindmapImage, estimateExportDimensions, captureMapImageBase64 } from "../../utils/mindmapImageExport";
import { sanitizeExportFilename } from "../../utils/mindmapExportFilename";
import { PRESETS, DEFAULT_APPEARANCE } from "../../utils/mindmapExportAppearance";
import { getExportFormatCapabilities, isDocumentFormat } from "../../utils/mindmapExportFormatCapabilities";
import { createMindmapExport, pollMindmapExportUntilDone, cancelMindmapExport, triggerMindmapExportDownload } from "../../utils/mindmapDocumentExport";

const STEPS = ["Phạm vi", "Định dạng", "Giao diện", "Xem trước"];

const IMAGE_FORMATS = [
  ["png", "PNG", "Ảnh raster, nền có thể trong suốt."],
  ["jpeg", "JPEG", "Ảnh raster, nhẹ hơn PNG, không hỗ trợ nền trong suốt."],
  ["svg", "SVG", "Ảnh vector, phóng to không vỡ nét."],
];
const DOCUMENT_FORMATS = [
  ["pdf", "PDF", "Tài liệu phân trang, có thể kèm ảnh sơ đồ."],
  ["docx", "DOCX", "Văn bản Word, phân cấp theo tiêu đề."],
  ["xlsx", "XLSX", "Bảng tính, mỗi node một dòng."],
];

const BACKGROUNDS = [
  ["canvas", "Giống canvas"],
  ["white", "Trắng"],
  ["dark", "Tối"],
  ["transparent", "Trong suốt"],
  ["custom", "Tuỳ chỉnh"],
];
const DOC_BACKGROUNDS = [["white", "Trắng"], ["dark", "Tối"], ["custom", "Tuỳ chỉnh"]];

const BACKGROUND_COLOR = { white: "#FFFFFF", dark: "#15171C", transparent: "transparent" };

function resolveBackgroundColor(key, customColor) {
  if (key === "canvas") {
    return getComputedStyle(document.documentElement).getPropertyValue("--bg-base").trim() || "#ECE7DB";
  }
  if (key === "custom") return customColor || "#FFFFFF";
  return BACKGROUND_COLOR[key] || "#FFFFFF";
}

const PRESET_OPTIONS = [
  ["canvas", "Giống canvas", PRESETS.canvas],
  ["study", "Tài liệu học tập", PRESETS.study],
  ["minimal", "Tối giản", PRESETS.minimal],
  ["presentation", "Trình bày", PRESETS.presentation],
];

const FONT_OPTIONS = [["canvas", "Giống canvas"], ["sans", "Sans (Inter)"], ["serif", "Serif (Spectral)"]];
const DOC_FONT_OPTIONS = [["sans", "Sans"], ["serif", "Serif"]];
const BRANCH_COLOR_OPTIONS = [["keep", "Giữ nguyên"], ["monochrome", "Đơn sắc"], ["customPalette", "Bảng màu riêng"]];
const SPACING_OPTIONS = [["compact", "Gọn"], ["normal", "Vừa"], ["spacious", "Rộng"]];
const THICKNESS_OPTIONS = [["thin", "Mảnh"], ["normal", "Vừa"], ["thick", "Đậm"]];
const MARGIN_OPTIONS = [["narrow", "Hẹp"], ["normal", "Vừa"], ["wide", "Rộng"]];
const PAGE_SIZE_OPTIONS = [["A4", "A4"], ["A3", "A3"]];
const ORIENTATION_OPTIONS = [["portrait", "Dọc"], ["landscape", "Ngang"]];
const PDF_MODE_OPTIONS = [["outline", "Chỉ dàn ý"], ["map", "Chỉ sơ đồ"], ["map_and_outline", "Sơ đồ + dàn ý"]];
const CONTENT_LABELS = {
  notes: "Ghi chú", citations: "Trích dẫn", sourceNames: "Tên nguồn",
  relations: "Đường quan hệ", legend: "Chú giải màu nhánh", branding: "Nhãn StudyMap",
};

/** The value-key a format's "color mode" control lives under — see
 * BE/services/mindmap/export/capabilities.py's own _VALUE_KEY_TO_FLAG_KEY
 * for why these three differ (pdf: branch color; docx: heading color;
 * xlsx: header style) even though they're the same underlying keep/
 * monochrome/customPalette control conceptually. */
function colorModeKeyFor(format) {
  if (format === "docx") return "headingColorMode";
  if (format === "xlsx") return "headerStyleMode";
  return "branchColorMode";
}

/**
 * Export Studio, final hardening round. Client-side image formats (PNG/
 * JPEG/SVG) capture in-browser via mindmapImageExport.js. Document formats
 * (PDF/DOCX/XLSX) are real backend jobs (mindmapDocumentExport.js): create
 * -> poll queued/running -> download on done, retry (same idempotency key)
 * on error, cancel while running. Every appearance/content control shown
 * for a format comes from mindmapExportFormatCapabilities.js's
 * getExportFormatCapabilities() — the SAME format_capabilities.json the
 * backend validates against (contract-tested byte-identical) — never a
 * hand-rolled per-format conditional here.
 */
export default function ExportStudioDialog({
  open, onClose, mind, mapId, title, selectedNodeId, selectedBranchIds, onRequestBranchSelection,
}) {
  const [step, setStep] = useState(0);
  const [scopeType, setScopeType] = useState(selectedNodeId ? "current_branch" : "full");
  const [visibleOnly, setVisibleOnly] = useState(false);
  const [format, setFormat] = useState("png");
  const [background, setBackground] = useState("canvas");
  const [customColor, setCustomColor] = useState("#FFFFFF");
  const [scale, setScale] = useState(2);
  const [filenameOverride, setFilenameOverride] = useState("");
  const [appearance, setAppearance] = useState(DEFAULT_APPEARANCE);
  const [presetName, setPresetName] = useState("canvas");
  const [docOptions, setDocOptions] = useState(() => getExportFormatCapabilities("pdf").defaults);
  const [includeMapImage, setIncludeMapImage] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [jobStatus, setJobStatus] = useState(null); // null | "queued" | "running" | "done" | "error" | "cancelled"
  const [jobProgress, setJobProgress] = useState(0);
  const [jobId, setJobId] = useState(null);
  const abortRef = useRef(null);

  const isDoc = isDocumentFormat(format);
  const capabilities = useMemo(() => getExportFormatCapabilities(format), [format]);
  const colorModeKey = colorModeKeyFor(format);

  const changeFormat = (nextFormat) => {
    setFormat(nextFormat);
    if (isDocumentFormat(nextFormat)) {
      setDocOptions(getExportFormatCapabilities(nextFormat).defaults);
      setIncludeMapImage(false);
    }
  };

  const updateDocOption = (key, value) => setDocOptions((o) => ({ ...o, [key]: value }));
  const updateDocContent = (key, value) => setDocOptions((o) => ({ ...o, content: { ...o.content, [key]: value } }));

  const hasBranchSelection = (selectedBranchIds?.size || 0) > 0;

  const applyPreset = (name) => {
    setPresetName(name);
    setAppearance(PRESETS[name]);
  };
  const updateAppearance = (patch) => { setPresetName(null); setAppearance((a) => ({ ...a, ...patch })); };
  const updateContent = (key, value) => { setPresetName(null); setAppearance((a) => ({ ...a, content: { ...a.content, [key]: value } })); };

  const scopeResult = useMemo(() => {
    if (!mind?.nodeData) return null;
    try {
      const resolved = resolveExportScope({
        nodeData: mind.nodeData, scopeType,
        selectedNodeId, selectedBranchRootIds: selectedBranchIds ? [...selectedBranchIds] : [],
        visibleOnly,
      });
      return {
        ok: true,
        count: countIncluded(resolved.includedIds),
        hidden: countHiddenIncluded(mind.nodeData, resolved.includedIds),
      };
    } catch (e) {
      if (e instanceof NoSelectionError) return { ok: false, message: "Chưa có lựa chọn cho phạm vi này." };
      if (e instanceof UnknownNodeIdError) return { ok: false, message: "Lựa chọn không còn hợp lệ trên sơ đồ này." };
      return { ok: false, message: e.message };
    }
  }, [mind, scopeType, selectedNodeId, selectedBranchIds, visibleOnly]);

  const scopeLabel = {
    full: "Toàn bộ sơ đồ", current_branch: "Nhánh hiện tại",
    selected_branches: "Các nhánh được chọn", visible: "Phần đang hiển thị",
  }[scopeType];

  const filename = sanitizeExportFilename(filenameOverride || title);

  const estimatedDimensions = useMemo(() => {
    if (!mind?.map || !scopeResult?.ok || isDoc) return null;
    return estimateExportDimensions({
      mind, scopeType, targetNodeId: selectedNodeId,
      branchRootIds: selectedBranchIds ? [...selectedBranchIds] : [], scale,
    });
  }, [mind, scopeType, selectedNodeId, selectedBranchIds, scale, scopeResult, isDoc]);

  // Same idempotency key across re-renders while the request is unchanged
  // (so a "Thử lại" click on a failed job reuses it — the backend's own
  // idempotent-job contract then either resumes or safely re-runs the
  // SAME request), and a FRESH one whenever scope/format/options actually
  // change (so an edited request is never rejected as a stale-key conflict).
  const branchIdsKey = selectedBranchIds ? [...selectedBranchIds].sort().join(",") : "";
  const idempotencyKey = useMemo(() => (
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  ), [format, scopeType, selectedNodeId, branchIdsKey, visibleOnly, JSON.stringify(docOptions), includeMapImage]); // eslint-disable-line react-hooks/exhaustive-deps

  const canAdvanceFromScope = scopeResult?.ok;
  const canExport = scopeResult?.ok && !(isDoc && !mapId);
  const close = () => {
    if (exporting) return;
    abortRef.current?.abort();
    onClose?.();
  };

  useEffect(() => () => abortRef.current?.abort(), []);

  // Map A<->B isolation: neither MindElixirView nor this dialog remounts on
  // a map switch (WorkspaceContainer.jsx renders MindElixirView with no
  // `key` — mind-elixir re-inits internally via its own `data?.id`-keyed
  // effect instead), so without this, a completed/failed/in-flight
  // document-export job's status would keep showing after switching to a
  // DIFFERENT map — a stale "Đã xuất" banner naming the wrong file, or a
  // "Huỷ xuất" button that would cancel a job belonging to a different map
  // entirely. Aborts any in-flight poll and clears every export-RUN-
  // specific field the moment the map identity changes; deliberately
  // leaves format/scope/appearance/docOptions alone (a chosen preference
  // carrying over between maps is a convenience, not a correctness bug the
  // way a wrong completed-job banner is).
  useEffect(() => {
    abortRef.current?.abort();
    setExporting(false);
    setError(null);
    setDone(null);
    setJobStatus(null);
    setJobProgress(0);
    setJobId(null);
  }, [mapId]);

  const effectiveScopeType = visibleOnly && scopeType === "full" ? "visible" : scopeType;

  const captureMapImageForBackend = async () => {
    return captureMapImageBase64({
      mind, scopeType: effectiveScopeType, targetNodeId: selectedNodeId,
      branchRootIds: selectedBranchIds ? [...selectedBranchIds] : [], visibleOnly,
    });
  };

  const runImageExport = async () => {
    const info = await exportMindmapImage({
      mind, scopeType: effectiveScopeType, targetNodeId: selectedNodeId,
      branchRootIds: selectedBranchIds ? [...selectedBranchIds] : [], visibleOnly,
      format, backgroundColor: resolveBackgroundColor(background, customColor), scale, title: filename,
      appearance,
    });
    setDone(info);
  };

  const runDocumentExport = async () => {
    setJobStatus("queued");
    setJobProgress(0);
    setJobId(null);
    let mapImageBase64;
    const needsMapImage = (format === "pdf" && docOptions.mode !== "outline") || (format === "docx" && includeMapImage);
    if (needsMapImage) mapImageBase64 = await captureMapImageForBackend();

    const created = await createMindmapExport(mapId, {
      format,
      scope: {
        scope_type: effectiveScopeType, selected_node_id: selectedNodeId,
        selected_branch_root_ids: selectedBranchIds ? [...selectedBranchIds] : [],
        include_descendants: true,
      },
      options: docOptions,
      mapImageBase64,
      idempotencyKey,
    });
    setJobId(created.job_id);

    const controller = new AbortController();
    abortRef.current = controller;
    const final = await pollMindmapExportUntilDone(created.job_id, {
      signal: controller.signal,
      onUpdate: (s) => { setJobStatus(s.status); setJobProgress(s.progress || 0); },
    });

    if (final.status === "done") {
      setDone({ filename: `${filename}.${format}` });
      if (final.download_url) triggerMindmapExportDownload(final.download_url);
    } else if (final.status === "cancelled") {
      throw new Error("Đã huỷ xuất tài liệu.");
    } else {
      throw new Error(final.error || "Xuất tài liệu thất bại.");
    }
  };

  const runExport = async () => {
    if (!mind || !canExport) return;
    setExporting(true);
    setError(null);
    try {
      if (isDoc) await runDocumentExport();
      else await runImageExport();
    } catch (e) {
      if (e?.name !== "AbortError") setError(e?.message || "Không xuất được sơ đồ.");
      setJobStatus((s) => (s === "queued" || s === "running" ? "error" : s));
    } finally {
      setExporting(false);
    }
  };

  const cancelRunningJob = async () => {
    abortRef.current?.abort();
    if (jobId) {
      try { await cancelMindmapExport(jobId); } catch { /* best-effort — status poll already stopped */ }
    }
    setJobStatus("cancelled");
    setExporting(false);
  };

  return (
    <Modal open={open} title="Xuất sơ đồ" onClose={exporting ? undefined : close} maxWidth={960}
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1.5" role="tablist" aria-label="Các bước xuất sơ đồ">
            {STEPS.map((s, i) => (
              <span key={s} className={`w-2 h-2 rounded-full ${i === step ? "bg-accent" : "bg-border-color"}`} aria-hidden="true" />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && !done && (
              <button type="button" className="btn-secondary text-small" disabled={exporting} onClick={() => setStep((s) => s - 1)}>Quay lại</button>
            )}
            {exporting && (jobStatus === "queued" || jobStatus === "running") ? (
              <button type="button" className="btn-secondary text-small" onClick={cancelRunningJob}>Huỷ xuất</button>
            ) : (
              <button type="button" className="btn-secondary text-small" disabled={exporting} onClick={close}>{done ? "Đóng" : "Hủy"}</button>
            )}
            {step < 3 && (
              <button type="button" className="btn-primary text-small" disabled={step === 0 && !canAdvanceFromScope}
                onClick={() => setStep((s) => s + 1)}>Tiếp tục</button>
            )}
            {step === 3 && !done && (
              <button type="button" className="btn-primary text-small inline-flex items-center gap-1.5" disabled={exporting || !canExport}
                onClick={runExport}>
                {exporting
                  ? <><Spinner size={13} /> {jobStatus === "queued" ? "Đang xếp hàng…" : jobStatus === "running" ? `Đang xuất… ${jobProgress}%` : "Đang xuất…"}</>
                  : (jobStatus === "error" ? <><Icon name="RotateCcw" size={14} /> Thử lại</> : <><Icon name="Download" size={14} /> Xuất</>)}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="p-5">
        <div className="font-mono text-caption uppercase text-text-muted mb-4">Bước {step + 1}/4 · {STEPS[step]}</div>

        {step === 0 && (
          <div className="flex flex-col gap-3">
            {[
              ["full", "Toàn bộ sơ đồ", "Bao gồm toàn bộ cây, không phụ thuộc nhánh đang thu gọn."],
              ["current_branch", "Nhánh hiện tại", selectedNodeId ? "Xuất từ node đang chọn trên canvas." : "Chọn một node trên canvas trước."],
              ["selected_branches", "Các nhánh được chọn", hasBranchSelection ? `Đã chọn ${selectedBranchIds.size} nhánh.` : "Chưa chọn nhánh nào."],
              ["visible", "Phần đang hiển thị", "Chỉ node đang hiện trên canvas — không phải toàn bộ dữ liệu."],
            ].map(([value, label, hint]) => (
              <label key={value} className={`surface-card !p-3 flex items-start gap-3 cursor-pointer ${scopeType === value ? "border-accent" : ""}`}>
                <input type="radio" name="mm-export-scope" value={value} checked={scopeType === value}
                  onChange={() => setScopeType(value)} className="mt-1" />
                <span>
                  <span className="block text-body font-semibold text-text-primary">{label}</span>
                  <span className="block text-small text-text-muted">{hint}</span>
                </span>
              </label>
            ))}
            {scopeType === "selected_branches" && (
              <button type="button" className="btn-secondary text-small self-start" onClick={onRequestBranchSelection}>
                <Icon name="MousePointerClick" size={14} /> {hasBranchSelection ? "Chọn lại trên sơ đồ" : "Chọn nhánh trên sơ đồ"}
              </button>
            )}
            {scopeType !== "visible" && (
              <label className="flex items-center gap-2 text-small text-text-secondary mt-1">
                <input type="checkbox" checked={visibleOnly} onChange={(e) => setVisibleOnly(e.target.checked)} />
                Chỉ các node đang hiển thị
              </label>
            )}
            {scopeResult && !scopeResult.ok && (
              <div className="text-small flex items-center gap-1.5" style={{ color: "var(--err)" }}>
                <Icon name="AlertCircle" size={14} /> {scopeResult.message}
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="font-mono text-metadata uppercase text-text-muted mb-2">Ảnh</div>
              <div className="flex flex-col gap-2">
                {IMAGE_FORMATS.map(([value, label, hint]) => (
                  <label key={value} className={`surface-card !p-3 flex items-start gap-3 cursor-pointer ${format === value ? "border-accent" : ""}`}>
                    <input type="radio" name="mm-export-format" value={value} checked={format === value} onChange={() => changeFormat(value)} className="mt-1" />
                    <span>
                      <span className="block text-body font-semibold text-text-primary">{label}</span>
                      <span className="block text-small text-text-muted">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-metadata uppercase text-text-muted mb-2">Tài liệu</div>
              {!mapId && (
                <div className="text-small text-text-muted mb-2 flex items-center gap-1.5">
                  <Icon name="AlertCircle" size={14} /> Lưu sơ đồ trước khi xuất định dạng tài liệu.
                </div>
              )}
              <div className="flex flex-col gap-2">
                {DOCUMENT_FORMATS.map(([value, label, hint]) => (
                  <label key={value} className={`surface-card !p-3 flex items-start gap-3 cursor-pointer ${format === value ? "border-accent" : ""} ${!mapId ? "opacity-50 pointer-events-none" : ""}`}>
                    <input type="radio" name="mm-export-format" value={value} checked={format === value} onChange={() => changeFormat(value)} className="mt-1" disabled={!mapId} />
                    <span>
                      <span className="block text-body font-semibold text-text-primary">{label}</span>
                      <span className="block text-small text-text-muted">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 2 && !isDoc && (
          <div className="flex flex-col gap-5">
            <div>
              <div className="font-mono text-metadata uppercase text-text-muted mb-2">Mẫu dựng sẵn</div>
              <div className="flex flex-wrap gap-2">
                {PRESET_OPTIONS.map(([value, label]) => (
                  <button key={value} type="button" className={`pill-tab ${presetName === value ? "pill-tab-active" : ""}`}
                    onClick={() => applyPreset(value)}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-metadata uppercase text-text-muted mb-2">Nền</div>
              <div className="flex flex-wrap items-center gap-2">
                {BACKGROUNDS.map(([value, label]) => (
                  <button key={value} type="button" className={`pill-tab ${background === value ? "pill-tab-active" : ""}`}
                    disabled={value === "transparent" && format === "jpeg"}
                    onClick={() => setBackground(value)}>{label}</button>
                ))}
                {background === "custom" && (
                  <input type="color" value={customColor} onChange={(e) => setCustomColor(e.target.value)}
                    aria-label="Màu nền tuỳ chỉnh" className="w-8 h-8 rounded border border-border-color" />
                )}
              </div>
            </div>
            <div>
              <div className="font-mono text-metadata uppercase text-text-muted mb-2">Độ phân giải</div>
              <div className="flex gap-2">
                {[1, 2, 4].map((s) => (
                  <button key={s} type="button" className={`pill-tab ${scale === s ? "pill-tab-active" : ""}`} onClick={() => setScale(s)}>{s}×</button>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-metadata uppercase text-text-muted mb-2">Phông chữ</div>
              <div className="flex gap-2">
                {FONT_OPTIONS.map(([value, label]) => (
                  <button key={value} type="button" className={`pill-tab ${appearance.font === value ? "pill-tab-active" : ""}`}
                    onClick={() => updateAppearance({ font: value })}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-metadata uppercase text-text-muted mb-2">Màu nhánh & đường nối</div>
              <div className="flex gap-2">
                {BRANCH_COLOR_OPTIONS.map(([value, label]) => (
                  <button key={value} type="button" className={`pill-tab ${appearance.branchColorMode === value ? "pill-tab-active" : ""}`}
                    onClick={() => updateAppearance({ branchColorMode: value })}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-metadata uppercase text-text-muted mb-2">Khoảng cách</div>
              <div className="flex gap-2">
                {SPACING_OPTIONS.map(([value, label]) => (
                  <button key={value} type="button" className={`pill-tab ${appearance.spacing === value ? "pill-tab-active" : ""}`}
                    onClick={() => updateAppearance({ spacing: value })}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-metadata uppercase text-text-muted mb-2">Độ dày đường nối</div>
              <div className="flex gap-2">
                {THICKNESS_OPTIONS.map(([value, label]) => (
                  <button key={value} type="button" className={`pill-tab ${appearance.connectorThickness === value ? "pill-tab-active" : ""}`}
                    onClick={() => updateAppearance({ connectorThickness: value })}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-metadata uppercase text-text-muted mb-2">Nội dung kèm theo</div>
              <div className="flex flex-col gap-1.5">
                {["relations", "citations", "legend", "branding"].map((key) => (
                  <label key={key} className="flex items-center gap-2 text-small text-text-secondary">
                    <input type="checkbox" checked={appearance.content[key]} onChange={(e) => updateContent(key, e.target.checked)} />
                    {CONTENT_LABELS[key]}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-metadata uppercase text-text-muted mb-2">Tên file</div>
              <input type="text" value={filenameOverride} onChange={(e) => setFilenameOverride(e.target.value)}
                placeholder={sanitizeExportFilename(title)} className="input-surface w-full" />
              <div className="text-caption font-mono text-text-muted mt-1">{filename}-YYYYMMDD.{format === "jpeg" ? "jpg" : format}</div>
            </div>
          </div>
        )}

        {step === 2 && isDoc && (
          <div className="flex flex-col gap-5" data-testid="doc-appearance">
            {capabilities.controls.font && (
              <div>
                <div className="font-mono text-metadata uppercase text-text-muted mb-2">Phông chữ</div>
                <div className="flex gap-2">
                  {DOC_FONT_OPTIONS.map(([value, label]) => (
                    <button key={value} type="button" className={`pill-tab ${docOptions.font === value ? "pill-tab-active" : ""}`}
                      onClick={() => updateDocOption("font", value)}>{label}</button>
                  ))}
                </div>
              </div>
            )}
            {capabilities.controls.background && (
              <div>
                <div className="font-mono text-metadata uppercase text-text-muted mb-2">Nền</div>
                <div className="flex flex-wrap items-center gap-2">
                  {DOC_BACKGROUNDS.map(([value, label]) => (
                    <button key={value} type="button" className={`pill-tab ${docOptions.background === value ? "pill-tab-active" : ""}`}
                      onClick={() => updateDocOption("background", value)}>{label}</button>
                  ))}
                  {docOptions.background === "custom" && (
                    <input type="color" value={customColor} onChange={(e) => { setCustomColor(e.target.value); updateDocOption("background", e.target.value); }}
                      aria-label="Màu nền tuỳ chỉnh" className="w-8 h-8 rounded border border-border-color" />
                  )}
                </div>
              </div>
            )}
            {(capabilities.controls.branchColor || capabilities.controls.headingColor || capabilities.controls.headerStyle) && (
              <div>
                <div className="font-mono text-metadata uppercase text-text-muted mb-2">
                  {format === "docx" ? "Màu tiêu đề" : format === "xlsx" ? "Màu tiêu đề bảng" : "Màu nhánh"}
                </div>
                <div className="flex gap-2">
                  {BRANCH_COLOR_OPTIONS.map(([value, label]) => (
                    <button key={value} type="button" className={`pill-tab ${docOptions[colorModeKey] === value ? "pill-tab-active" : ""}`}
                      onClick={() => updateDocOption(colorModeKey, value)}>{label}</button>
                  ))}
                </div>
              </div>
            )}
            {capabilities.controls.margins && (
              <div>
                <div className="font-mono text-metadata uppercase text-text-muted mb-2">Lề</div>
                <div className="flex gap-2">
                  {MARGIN_OPTIONS.map(([value, label]) => (
                    <button key={value} type="button" className={`pill-tab ${docOptions.margins === value ? "pill-tab-active" : ""}`}
                      onClick={() => updateDocOption("margins", value)}>{label}</button>
                  ))}
                </div>
              </div>
            )}
            {capabilities.controls.pageSize && (
              <div>
                <div className="font-mono text-metadata uppercase text-text-muted mb-2">Khổ giấy</div>
                <div className="flex gap-2">
                  {PAGE_SIZE_OPTIONS.map(([value, label]) => (
                    <button key={value} type="button" className={`pill-tab ${docOptions.pageSize === value ? "pill-tab-active" : ""}`}
                      onClick={() => updateDocOption("pageSize", value)}>{label}</button>
                  ))}
                </div>
              </div>
            )}
            {capabilities.controls.orientation && (
              <div>
                <div className="font-mono text-metadata uppercase text-text-muted mb-2">Hướng trang</div>
                <div className="flex gap-2">
                  {ORIENTATION_OPTIONS.map(([value, label]) => (
                    <button key={value} type="button" className={`pill-tab ${docOptions.orientation === value ? "pill-tab-active" : ""}`}
                      onClick={() => updateDocOption("orientation", value)}>{label}</button>
                  ))}
                </div>
              </div>
            )}
            {capabilities.controls.mode && (
              <div>
                <div className="font-mono text-metadata uppercase text-text-muted mb-2">Chế độ</div>
                <div className="flex gap-2 flex-wrap">
                  {PDF_MODE_OPTIONS.map(([value, label]) => (
                    <button key={value} type="button" className={`pill-tab ${docOptions.mode === value ? "pill-tab-active" : ""}`}
                      onClick={() => updateDocOption("mode", value)}>{label}</button>
                  ))}
                </div>
              </div>
            )}
            {capabilities.controls.singlePage && (
              <label className="flex items-center gap-2 text-small text-text-secondary">
                <input type="checkbox" checked={docOptions.singlePage} onChange={(e) => updateDocOption("singlePage", e.target.checked)} />
                Một trang dài duy nhất (không phân trang)
              </label>
            )}
            {capabilities.controls.mapImage && (
              <label className="flex items-center gap-2 text-small text-text-secondary">
                <input type="checkbox" checked={includeMapImage} onChange={(e) => setIncludeMapImage(e.target.checked)} />
                Kèm ảnh sơ đồ
              </label>
            )}
            {capabilities.controls.content?.length > 0 && (
              <div>
                <div className="font-mono text-metadata uppercase text-text-muted mb-2">Nội dung kèm theo</div>
                <div className="flex flex-col gap-1.5">
                  {capabilities.controls.content.map((key) => (
                    <label key={key} className="flex items-center gap-2 text-small text-text-secondary">
                      <input type="checkbox" checked={!!docOptions.content?.[key]} onChange={(e) => updateDocContent(key, e.target.checked)} />
                      {CONTENT_LABELS[key]}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="font-mono text-metadata uppercase text-text-muted mb-2">Tên file</div>
              <input type="text" value={filenameOverride} onChange={(e) => setFilenameOverride(e.target.value)}
                placeholder={sanitizeExportFilename(title)} className="input-surface w-full" />
              <div className="text-caption font-mono text-text-muted mt-1">{filename}.{format}</div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            {done ? (
              <div className="surface-card !p-4 flex items-center gap-3">
                <Icon name="CheckCircle2" size={20} className="text-forest" />
                <div>
                  <div className="text-body font-semibold text-text-primary">Đã xuất: {done.filename}</div>
                  <div className="text-small text-text-muted">File đã tải xuống trình duyệt.</div>
                </div>
              </div>
            ) : (
              <div className="surface-card !p-3.5 flex flex-col gap-1 font-mono text-caption text-text-secondary">
                <span>{scopeLabel}{scopeResult?.ok ? ` · ${scopeResult.count} node${scopeResult.hidden ? ` · gồm ${scopeResult.hidden} node đang thu gọn` : ""}` : ""}</span>
                {!isDoc && (
                  <span>{format.toUpperCase()} · {BACKGROUNDS.find(([v]) => v === background)?.[1]} · {scale}×{estimatedDimensions ? ` · ≈${estimatedDimensions.width}×${estimatedDimensions.height}px` : ""}</span>
                )}
                {!isDoc && (
                  <span>Phông: {FONT_OPTIONS.find(([v]) => v === appearance.font)?.[1]} · Màu nhánh: {BRANCH_COLOR_OPTIONS.find(([v]) => v === appearance.branchColorMode)?.[1]} · Khoảng cách: {SPACING_OPTIONS.find(([v]) => v === appearance.spacing)?.[1]}</span>
                )}
                {isDoc && (
                  <span>{format.toUpperCase()} · Phông: {DOC_FONT_OPTIONS.find(([v]) => v === docOptions.font)?.[1] || docOptions.font}
                    {capabilities.controls.pageSize ? ` · ${docOptions.pageSize} ${ORIENTATION_OPTIONS.find(([v]) => v === docOptions.orientation)?.[1] || ""}` : ""}
                    {capabilities.controls.mode ? ` · ${PDF_MODE_OPTIONS.find(([v]) => v === docOptions.mode)?.[1]}` : ""}
                  </span>
                )}
                <span>{filename}.{format === "jpeg" && !isDoc ? "jpg" : format}</span>
                {isDoc && jobStatus && (
                  <span className="flex items-center gap-1.5">
                    {(jobStatus === "queued" || jobStatus === "running") && <Spinner size={12} />}
                    Trạng thái: {{
                      queued: "Đang xếp hàng", running: `Đang xử lý (${jobProgress}%)`,
                      done: "Hoàn tất", error: "Thất bại", cancelled: "Đã huỷ",
                    }[jobStatus] || jobStatus}
                  </span>
                )}
              </div>
            )}
            {error && (
              <div className="text-small flex items-center gap-1.5" style={{ color: "var(--err)" }}>
                <Icon name="AlertCircle" size={14} /> {error}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
