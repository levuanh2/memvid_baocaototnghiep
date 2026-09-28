import { useMemo, useState } from "react";
import Modal from "../ui/Modal";
import { Icon } from "../ui/Icon";
import Spinner from "../ui/Spinner";
import {
  resolveExportScope, countIncluded, countHiddenIncluded,
  UnknownNodeIdError, NoSelectionError,
} from "../../utils/mindmapExportScope";
import { exportMindmapImage } from "../../utils/mindmapImageExport";
import { sanitizeExportFilename } from "../../utils/mindmapExportFilename";

const STEPS = ["Phạm vi", "Định dạng", "Giao diện", "Xem trước"];

const IMAGE_FORMATS = [
  ["png", "PNG", "Ảnh raster, nền có thể trong suốt."],
  ["jpeg", "JPEG", "Ảnh raster, nhẹ hơn PNG, không hỗ trợ nền trong suốt."],
  ["svg", "SVG", "Ảnh vector, phóng to không vỡ nét."],
];

const BACKGROUNDS = [
  ["canvas", "Giống canvas"],
  ["white", "Trắng"],
  ["dark", "Tối"],
  ["transparent", "Trong suốt"],
];

const BACKGROUND_COLOR = { white: "#FFFFFF", dark: "#15171C", transparent: "transparent" };

function resolveBackgroundColor(key) {
  if (key === "canvas") {
    return getComputedStyle(document.documentElement).getPropertyValue("--bg-base").trim() || "#ECE7DB";
  }
  return BACKGROUND_COLOR[key] || "#FFFFFF";
}

/**
 * Export Studio, round 1 (client-side image formats). PDF/DOCX/XLSX are
 * backend document-export jobs — a genuinely separate feature (new job
 * type, new download route, three new serializers) — and are intentionally
 * NOT offered here; see the round's own report for exactly what that
 * leaves out rather than presenting a format picker with dead options.
 *
 * Full appearance control (font/palette/connector styling/spacing/legend/
 * notes/citations/source-name/logo toggles) is also not implemented this
 * round — background variant, resolution scale, and "kèm quan hệ" are the
 * real, working subset; see the round's report.
 *
 * "Các nhánh được chọn" composes selected branches via an OFFSCREEN
 * mind-elixir instance (mindmapImageExport.js's exportMindmapImageMultiBranch)
 * — the live canvas is never touched.
 */
export default function ExportStudioDialog({
  open, onClose, mind, title, selectedNodeId, selectedBranchIds, onRequestBranchSelection,
}) {
  const [step, setStep] = useState(0);
  const [scopeType, setScopeType] = useState(selectedNodeId ? "current_branch" : "full");
  const [visibleOnly, setVisibleOnly] = useState(false);
  const [format, setFormat] = useState("png");
  const [background, setBackground] = useState("canvas");
  const [scale, setScale] = useState(2);
  const [filenameOverride, setFilenameOverride] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const hasBranchSelection = (selectedBranchIds?.size || 0) > 0;

  const scopeResult = useMemo(() => {
    if (!mind?.nodeData) return null;
    try {
      const effectiveScopeType = scopeType === "selected_branches" ? "selected_branches" : scopeType;
      const resolved = resolveExportScope({
        nodeData: mind.nodeData, scopeType: effectiveScopeType,
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

  const canAdvanceFromScope = scopeResult?.ok;
  const canExport = scopeResult?.ok;
  const close = () => { if (!exporting) onClose?.(); };

  const runExport = async () => {
    if (!mind || !canExport) return;
    setExporting(true);
    setError(null);
    try {
      const effectiveScopeType = visibleOnly && scopeType === "full" ? "visible" : scopeType;
      const info = await exportMindmapImage({
        mind, scopeType: effectiveScopeType, targetNodeId: selectedNodeId,
        branchRootIds: selectedBranchIds ? [...selectedBranchIds] : [], visibleOnly,
        format, backgroundColor: resolveBackgroundColor(background), scale, title: filename,
      });
      setDone(info);
    } catch (e) {
      setError(e?.message || "Không xuất được sơ đồ.");
    } finally {
      setExporting(false);
    }
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
            <button type="button" className="btn-secondary text-small" disabled={exporting} onClick={close}>{done ? "Đóng" : "Hủy"}</button>
            {step < 3 && (
              <button type="button" className="btn-primary text-small" disabled={step === 0 && !canAdvanceFromScope}
                onClick={() => setStep((s) => s + 1)}>Tiếp tục</button>
            )}
            {step === 3 && !done && (
              <button type="button" className="btn-primary text-small inline-flex items-center gap-1.5" disabled={exporting || !canExport}
                onClick={runExport}>
                {exporting ? <><Spinner size={13} /> Đang xuất…</> : <><Icon name="Download" size={14} /> Xuất</>}
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
          <div className="flex flex-col gap-2">
            {IMAGE_FORMATS.map(([value, label, hint]) => (
              <label key={value} className={`surface-card !p-3 flex items-start gap-3 cursor-pointer ${format === value ? "border-accent" : ""}`}>
                <input type="radio" name="mm-export-format" value={value} checked={format === value} onChange={() => setFormat(value)} className="mt-1" />
                <span>
                  <span className="block text-body font-semibold text-text-primary">{label}</span>
                  <span className="block text-small text-text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-5">
            <div>
              <div className="font-mono text-metadata uppercase text-text-muted mb-2">Nền</div>
              <div className="flex flex-wrap gap-2">
                {BACKGROUNDS.map(([value, label]) => (
                  <button key={value} type="button" className={`pill-tab ${background === value ? "pill-tab-active" : ""}`}
                    disabled={value === "transparent" && format === "jpeg"}
                    onClick={() => setBackground(value)}>{label}</button>
                ))}
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
              <div className="font-mono text-metadata uppercase text-text-muted mb-2">Tên file</div>
              <input type="text" value={filenameOverride} onChange={(e) => setFilenameOverride(e.target.value)}
                placeholder={sanitizeExportFilename(title)} className="input-surface w-full" />
              <div className="text-caption font-mono text-text-muted mt-1">{filename}-YYYYMMDD.{format === "jpeg" ? "jpg" : format}</div>
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
                <span>{format.toUpperCase()} · {BACKGROUNDS.find(([v]) => v === background)?.[1]} · {scale}×</span>
                <span>{filename}-YYYYMMDD.{format === "jpeg" ? "jpg" : format}</span>
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
