// PR C2 — toolbar "Giao diện" editor. Draft state previewed directly on the
// LIVE canvas via applyLiveCanvasAppearance (0 linkDiv/layout/refresh/fit/
// center — see mindMapAppearanceLiveApply.js), Escape/Hủy rolls back,
// "Áp dụng" PATCHes and keeps the preview as the new saved look. No
// typography/padding/density control exists here — see
// mindMapAppearanceV2.js's header for why those are export-only.
import { useEffect, useRef, useState } from "react";
import Modal from "../ui/Modal";
import { Icon } from "../ui/Icon";
import {
  defaultAppearanceV2, resolveCanvasAppearance, PRESET_NAMES,
} from "../../utils/mindMapAppearanceV2";
import { applyLiveCanvasAppearance } from "../../utils/mindMapAppearanceLiveApply";
import { patchMindmapAppearance } from "../../utils/api";
import { Segmented, Accordion, NodeRoleEditor, ConnectorEditor, CanvasEditor, RoleTabs } from "./AppearanceControls";
// Shares exportStudio.css's generic .export-* primitives (segments,
// accordion, control, check, message) — a plain global stylesheet, not CSS
// modules, so importing it here too is a safe, idempotent dedupe, not a
// second copy.
import "./exportStudio.css";

const PRESET_LABELS = { default: "Mặc định", minimal: "Tối giản", study: "Học tập", pastel: "Pastel", highContrast: "Tương phản cao" };

/** `mapId` doubles as this component's React `key` at the call site
 * (MindElixirView.jsx) — switching maps remounts the editor fresh, so a
 * draft never survives into a different map (A -> B -> A always starts
 * B's own draft from B's own saved appearance, never A's leftovers). */
export default function AppearanceEditorDrawer({ open, onClose, mind, mapId, savedAppearance, onSaved }) {
  const [draft, setDraft] = useState(() => savedAppearance || defaultAppearanceV2());
  const [history, setHistory] = useState([]);
  const [openSection, setOpenSection] = useState("preset");
  const [activeRole, setActiveRole] = useState("root");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const restoreRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setDraft(savedAppearance || defaultAppearanceV2());
    setHistory([]);
    setError(null);
    setOpenSection("preset");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Live preview: every draft change restores whatever the PREVIOUS preview
  // applied first, then applies the new one fresh — never stacks, never
  // calls layout/linkDiv/refresh/fit/center (see applyLiveCanvasAppearance's
  // own guarantees, verified by spy in mindMapAppearanceLiveApply.test.js).
  useEffect(() => {
    if (!open || !mind) return;
    restoreRef.current?.();
    const resolved = resolveCanvasAppearance({ savedAppearance: draft });
    restoreRef.current = applyLiveCanvasAppearance({ mind, resolved });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft, mind]);

  useEffect(() => () => { restoreRef.current?.(); restoreRef.current = null; }, []);

  const pushDraft = (next) => { setHistory((h) => [...h, draft]); setDraft(next); };
  const setOverrides = (patch) => pushDraft({ ...draft, overrides: { ...draft.overrides, ...patch } });

  const requestClose = () => { if (saving) return; restoreRef.current?.(); restoreRef.current = null; onClose?.(); };
  const handleUndo = () => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setDraft(prev);
  };
  const handleReset = () => pushDraft(defaultAppearanceV2());
  const handlePreset = (preset) => pushDraft({ ...draft, preset });
  const handleApply = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await patchMindmapAppearance(mapId, draft);
      restoreRef.current = null; // keep the just-applied look — don't roll back on close
      onSaved?.(res.appearance);
      onClose?.();
    } catch (e) {
      restoreRef.current?.();
      restoreRef.current = null;
      setDraft(savedAppearance || defaultAppearanceV2());
      setError(e?.message || "Không lưu được giao diện.");
    } finally {
      setSaving(false);
    }
  };

  const resolvedPreview = resolveCanvasAppearance({ savedAppearance: draft });

  return (
    <Modal open={open} title="Giao diện" subtitle="Màu, hình dạng node và đường nối — chỉ áp dụng cho sơ đồ này" onClose={requestClose} maxWidth={420} className="appearance-editor-drawer"
      footer={
        <div className="export-footer__actions">
          <button type="button" className="btn-secondary" disabled={!history.length || saving} onClick={handleUndo}><Icon name="RotateCcw" size={15} />Hoàn tác</button>
          <button type="button" className="btn-secondary" disabled={saving} onClick={handleReset}>Đặt lại</button>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" disabled={saving} onClick={requestClose}>Hủy</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={handleApply}>{saving ? "Đang lưu…" : "Áp dụng"}</button>
        </div>
      }>
      <div className="export-step">
        {error && <div className="export-message export-message--error" role="alert"><Icon name="AlertCircle" size={16} />{error}</div>}
        <Accordion id="appearance-preset" title="Mẫu dựng sẵn" icon="Sliders" open={openSection === "preset"} onToggle={() => setOpenSection(openSection === "preset" ? null : "preset")}>
          <Segmented options={PRESET_NAMES.map((p) => [p, PRESET_LABELS[p]])} value={draft.preset} onChange={handlePreset} />
        </Accordion>
        <Accordion id="appearance-node" title="Màu & kiểu node" icon="Square" open={openSection === "node"} onToggle={() => setOpenSection(openSection === "node" ? null : "node")}>
          <RoleTabs active={activeRole} onChange={setActiveRole} />
          <NodeRoleEditor role={activeRole} value={resolvedPreview.node[activeRole]}
            onChange={(roleValue) => setOverrides({ node: { ...draft.overrides?.node, [activeRole]: roleValue } })} />
        </Accordion>
        <Accordion id="appearance-connector" title="Đường nối" icon="Spline" open={openSection === "connector"} onToggle={() => setOpenSection(openSection === "connector" ? null : "connector")}>
          <ConnectorEditor value={resolvedPreview.connector} onChange={(connector) => setOverrides({ connector })} />
        </Accordion>
        <Accordion id="appearance-canvas" title="Nền" icon="Image" open={openSection === "canvas"} onToggle={() => setOpenSection(openSection === "canvas" ? null : "canvas")}>
          <CanvasEditor value={resolvedPreview.canvas} onChange={(canvas) => setOverrides({ canvas })} />
        </Accordion>
      </div>
    </Modal>
  );
}
