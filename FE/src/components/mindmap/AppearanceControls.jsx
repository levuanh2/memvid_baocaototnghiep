// PR C2 — shared LIVE_SAFE appearance controls, used identically by the
// toolbar "Giao diện" editor (AppearanceEditorDrawer.jsx) and Export
// Studio's "Tùy chỉnh riêng bản xuất" override step. One set of controls,
// one visual language — never two hand-rolled copies drifting apart.
import { Icon } from "../ui/Icon";
import { SHAPES, GRIDS, CONNECTOR_COLOR_MODES, CONNECTOR_STYLES, CONNECTOR_THICKNESS } from "../../utils/mindMapAppearanceV2";
import "./appearanceEditor.css";

const SHAPE_LABELS = { roundedRect: "Chữ nhật tròn góc", pill: "Viên thuốc", card: "Thẻ", underline: "Gạch chân" };
const GRID_LABELS = { none: "Không", dot: "Chấm", line: "Lưới" };
const CONNECTOR_COLOR_LABELS = { keep: "Giữ nguyên", monochrome: "Đơn sắc", fixed: "Màu cố định" };
const CONNECTOR_STYLE_LABELS = { solid: "Liền", dashed: "Đứt nét" };
const CONNECTOR_THICKNESS_LABELS = { thin: "Mảnh", normal: "Vừa", thick: "Đậm" };
const ROLE_LABELS = { root: "Gốc", branch: "Nhánh", leaf: "Lá" };

export function Segmented({ options, value, onChange, disabled = () => false }) {
  return (
    <div className="export-segments">
      {options.map(([key, label]) => (
        <button key={key} type="button" className={`pill-tab ${value === key ? "is-selected pill-tab-active" : ""}`}
          aria-pressed={value === key} disabled={disabled(key)} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Control({ label, children }) {
  return <div className="export-control"><div className="export-control__label">{label}</div>{children}</div>;
}

export function Accordion({ id, title, icon, open, onToggle, children }) {
  return (
    <section className="export-accordion">
      <button type="button" className="export-accordion__trigger" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span><Icon name={icon} size={17} />{title}</span>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={17} />
      </button>
      {open && <div id={id} className="export-accordion__body">{children}</div>}
    </section>
  );
}

function ColorField({ label, value, onChange, allowNone = true }) {
  return (
    <Control label={label}>
      <div className="appearance-color-field">
        {allowNone && <button type="button" className={`pill-tab ${!value ? "is-selected pill-tab-active" : ""}`} onClick={() => onChange(null)}>Giữ nguyên</button>}
        <input type="color" aria-label={label} value={value || "#FFFFFF"} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      </div>
    </Control>
  );
}

/** One role's (root/branch/leaf) shape/fill/text/border/radius/shadow controls. */
export function NodeRoleEditor({ role, value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <section className="appearance-role-editor" aria-label={`Kiểu node: ${ROLE_LABELS[role] || role}`}>
      <Control label="Hình dạng">
        <Segmented options={SHAPES.map((s) => [s, SHAPE_LABELS[s]])} value={value.shape} onChange={(shape) => set({ shape })} />
      </Control>
      <ColorField label="Màu nền" value={value.fill} onChange={(fill) => set({ fill })} />
      <ColorField label="Màu chữ" value={value.textColor} onChange={(textColor) => set({ textColor })} />
      <ColorField label="Màu viền" value={value.borderColor} onChange={(borderColor) => set({ borderColor, borderWidth: borderColor ? (value.borderWidth || 1) : 0 })} />
      <Control label="Độ cong góc">
        <input type="range" min={0} max={24} step={2} value={value.radius ?? 0}
          onChange={(e) => set({ radius: Number(e.target.value) })} aria-label="Độ cong góc" />
      </Control>
      <label className="export-check">
        <input type="checkbox" checked={Boolean(value.shadow)} onChange={(e) => set({ shadow: e.target.checked })} />
        <span><strong>Đổ bóng</strong></span>
      </label>
    </section>
  );
}

export function ConnectorEditor({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <section className="appearance-connector-editor" aria-label="Đường nối">
      <Control label="Màu"><Segmented options={CONNECTOR_COLOR_MODES.map((m) => [m, CONNECTOR_COLOR_LABELS[m]])} value={value.colorMode} onChange={(colorMode) => set({ colorMode })} /></Control>
      {value.colorMode !== "keep" && <ColorField label="Màu cố định" allowNone={false} value={value.fixedColor} onChange={(fixedColor) => set({ fixedColor })} />}
      <Control label="Độ dày"><Segmented options={CONNECTOR_THICKNESS.map((t) => [t, CONNECTOR_THICKNESS_LABELS[t]])} value={value.thickness} onChange={(thickness) => set({ thickness })} /></Control>
      <Control label="Kiểu nét"><Segmented options={CONNECTOR_STYLES.map((s) => [s, CONNECTOR_STYLE_LABELS[s]])} value={value.style} onChange={(style) => set({ style })} /></Control>
    </section>
  );
}

export function CanvasEditor({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <section className="appearance-canvas-editor" aria-label="Nền sơ đồ">
      <ColorField label="Màu nền" value={value.background} onChange={(background) => set({ background })} />
      <Control label="Lưới"><Segmented options={GRIDS.map((g) => [g, GRID_LABELS[g]])} value={value.grid} onChange={(grid) => set({ grid })} /></Control>
    </section>
  );
}

/** Icon-labelled role tabs — "Màu & kiểu node" group, shared progressive-disclosure shell. */
export function RoleTabs({ active, onChange }) {
  return (
    <div className="export-segments" role="tablist" aria-label="Vai trò node">
      {["root", "branch", "leaf"].map((role) => (
        <button key={role} type="button" role="tab" aria-selected={active === role}
          className={`pill-tab ${active === role ? "is-selected pill-tab-active" : ""}`} onClick={() => onChange(role)}>
          {ROLE_LABELS[role]}
        </button>
      ))}
    </div>
  );
}
