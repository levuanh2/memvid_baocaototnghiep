// Appearance V2 (PR C2) — the single persisted, versioned contract for the
// LIVE canvas's node/connector/background styling, shared by the toolbar
// "Giao diện" editor and (as the inherited base layer) Export Studio.
//
// Scope is deliberately narrow: ONLY properties proven LIVE_SAFE by the C2
// prototype + closure-pass measurement (zero geometry delta across 390
// repeat measurements, p95=0px, 0 invalid connector paths, no linkDiv/layout
// call needed) are part of this persisted contract. Typography, node
// padding, and density all measurably moved the map root on screen (14px to
// 420px, reproduced 8/8 configs in the closure pass) — Mind Elixir centers
// `me-root` against the combined height of both side columns via plain CSS
// flex layout, so ANY property that changes a node's rendered height drags
// the root with it, regardless of whether `linkDiv()` is called. Those
// properties are REFLOW_REQUIRED and intentionally excluded from this
// contract — they only ever apply inside Export Studio's own disposable
// offscreen scene (see mindmapExportAppearance.js), never saved here, never
// touching the live canvas. See .playbook/known-issues.md for the full
// measurement record.
//
// Resolve order (canvas): defaults -> immutable preset V2 -> saved LIVE_SAFE
// overrides. Unknown fields are dropped during resolve, never written back
// — reading an old or future record never rewrites it. "defaults" here
// means the "default" preset, and that preset is a true no-op (every field
// null/0/false) specifically so a map with no saved appearance — every map
// that existed before this feature, and every map nobody has opened the
// editor for — renders EXACTLY as it did before, not a new look nobody
// opted into. `null`/not-set anywhere in a resolved role or canvas field
// means "don't touch this CSS property", not "apply the native default
// value" — the live-apply engine (mindMapAppearanceLiveApply.js) skips an
// element/property entirely rather than writing a no-op-equivalent value.

export const APPEARANCE_VERSION = 2;

export const SHAPES = ["roundedRect", "pill", "card", "underline"];
export const GRIDS = ["none", "dot", "line"];
export const CONNECTOR_COLOR_MODES = ["keep", "monochrome", "fixed"];
export const CONNECTOR_STYLES = ["solid", "dashed"];
export const CONNECTOR_THICKNESS = ["thin", "normal", "thick"];
export const NODE_ROLES = ["root", "branch", "leaf"];
export const PRESET_NAMES = ["default", "minimal", "study", "pastel", "highContrast"];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const isHexColor = (v) => typeof v === "string" && HEX_RE.test(v);
const clampInt = (v, min, max) => Math.max(min, Math.min(max, Math.round(v)));

// Role style: fill/textColor/border are the only geometry-neutral "box"
// properties (border rendered as an INSET box-shadow, never a real `border`
// — a real border changes box size and reproduced broken/NaN connector
// paths even after linkDiv() in the closure pass). radius/shadow are purely
// decorative. `shape` is a named combination of these, overridable field by
// field.
function emptyNodeRoleOverride() {
  return {};
}

function emptyOverrides() {
  return {
    canvas: {},
    node: { root: emptyNodeRoleOverride(), branch: emptyNodeRoleOverride(), leaf: emptyNodeRoleOverride() },
    connector: {},
  };
}

export function defaultAppearanceV2() {
  return { version: APPEARANCE_VERSION, preset: "default", overrides: emptyOverrides() };
}

// Named role bases — what each role looks like under a given preset, before
// any saved override is layered on. Every field defaults to a NO-OP
// sentinel (null/0/false) rather than a concrete value — `shape: null`
// (not "roundedRect") means "apply nothing, leave the canvas's own native
// CSS in full control", not "apply a rounded rectangle". This matters most
// for the "default" preset, which every map with no saved appearance
// resolves to (every pre-C2 map, and every map nobody has opened the new
// editor for): it must be a true visual no-op, or shipping this feature
// would silently restyle every existing map's nodes the moment it deploys.
// Only a genuinely STYLED preset (minimal/study/pastel/highContrast) passes
// concrete values.
function roleBase({ fill = null, textColor = null, borderColor = null, radius = null, shadow = false, shape = null } = {}) {
  return { shape, fill, textColor, borderColor, borderWidth: borderColor ? 1 : 0, radius, shadow };
}

/** True when a resolved role has nothing to apply at all — every field is
 * still its no-op sentinel. Used by the live-apply engine to skip touching
 * an element entirely (not just apply a value equal to the native default). */
export function roleIsNoop(role) {
  return !role.shape && !role.fill && !role.textColor && !role.borderColor && !role.shadow && role.radius == null;
}

// Preset V2 definitions — IMMUTABLE. Never mutate an object returned from
// here; always clone before use (see resolveCanvasAppearance). A new visual
// variant is a NEW preset name, never an edit to an existing one — existing
// saved records reference presets by name, and a mutated preset would
// silently reflow every map that chose it.
export const CANVAS_PRESETS_V2 = Object.freeze({
  // True no-op: a map with no saved appearance (every map that existed
  // before C2, and every map nobody has opened the editor for) must look
  // EXACTLY as it did before this feature shipped.
  default: Object.freeze({
    canvas: { background: null, grid: "none" },
    node: { root: roleBase(), branch: roleBase(), leaf: roleBase() },
    connector: { colorMode: "keep", fixedColor: null, thickness: "normal", style: "solid" },
  }),
  minimal: Object.freeze({
    canvas: { background: null, grid: "none" },
    node: {
      root: roleBase({ textColor: "#2B2620", shape: "underline", radius: 0 }),
      branch: roleBase({ textColor: "#2B2620", shape: "underline", radius: 0 }),
      leaf: roleBase({ textColor: "#2B2620", shape: "underline", radius: 0 }),
    },
    connector: { colorMode: "monochrome", fixedColor: "#2B2620", thickness: "thin", style: "solid" },
  }),
  study: Object.freeze({
    canvas: { background: null, grid: "dot" },
    node: {
      root: roleBase({ fill: "#F4F1EA", textColor: "#2B2620", shape: "card", radius: 10, shadow: true }),
      branch: roleBase({ fill: "#FFFFFF", textColor: "#2B2620", borderColor: "#D8CFC0", shape: "roundedRect", radius: 8 }),
      leaf: roleBase({ fill: null, textColor: "#2B2620", shape: "underline", radius: 0 }),
    },
    connector: { colorMode: "keep", fixedColor: null, thickness: "normal", style: "solid" },
  }),
  pastel: Object.freeze({
    canvas: { background: "#FBF7F2", grid: "none" },
    node: {
      root: roleBase({ fill: "#E9D8F0", textColor: "#4A3B56", shape: "pill", radius: 999 }),
      branch: roleBase({ fill: "#D7E8F0", textColor: "#30424B", shape: "pill", radius: 999 }),
      leaf: roleBase({ fill: "#FDEBD3", textColor: "#5A4420", shape: "roundedRect", radius: 10 }),
    },
    connector: { colorMode: "keep", fixedColor: null, thickness: "thin", style: "dashed" },
  }),
  highContrast: Object.freeze({
    canvas: { background: "#15171C", grid: "none" },
    node: {
      root: roleBase({ fill: "#FFFFFF", textColor: "#000000", shape: "roundedRect", radius: 4 }),
      branch: roleBase({ fill: "#FFE066", textColor: "#000000", shape: "roundedRect", radius: 4 }),
      leaf: roleBase({ fill: "#1A1D24", textColor: "#FFFFFF", borderColor: "#FFFFFF", shape: "roundedRect", radius: 4 }),
    },
    connector: { colorMode: "fixed", fixedColor: "#FFFFFF", thickness: "thick", style: "solid" },
  }),
});

class AppearanceSanitizeError extends Error {}

function sanitizeNodeRoleOverride(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  if (SHAPES.includes(raw.shape)) out.shape = raw.shape;
  if (isHexColor(raw.fill)) out.fill = raw.fill;
  if (isHexColor(raw.textColor)) out.textColor = raw.textColor;
  if (isHexColor(raw.borderColor)) out.borderColor = raw.borderColor;
  if (typeof raw.borderWidth === "number") out.borderWidth = clampInt(raw.borderWidth, 0, 3);
  if (typeof raw.radius === "number") out.radius = clampInt(raw.radius, 0, 999);
  if (typeof raw.shadow === "boolean") out.shadow = raw.shadow;
  return out;
}

function sanitizeCanvasOverride(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  if (isHexColor(raw.background) || raw.background === "light" || raw.background === "dark") {
    out.background = raw.background;
  }
  if (GRIDS.includes(raw.grid)) out.grid = raw.grid;
  return out;
}

function sanitizeConnectorOverride(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  if (CONNECTOR_COLOR_MODES.includes(raw.colorMode)) out.colorMode = raw.colorMode;
  if (isHexColor(raw.fixedColor)) out.fixedColor = raw.fixedColor;
  if (CONNECTOR_THICKNESS.includes(raw.thickness)) out.thickness = raw.thickness;
  if (CONNECTOR_STYLES.includes(raw.style)) out.style = raw.style;
  return out;
}

/**
 * Drops every unrecognized or geometry-affecting field (typography, node
 * padding, density, real border-width, title-wrap — anything not in this
 * module's own allowed-field list) and validates every remaining value
 * against its enum/hex-color/numeric-range rule. Never throws on a
 * malformed payload — an invalid field is simply absent from the result, so
 * a request that only contains junk resolves to an all-empty override
 * (equivalent to "no override"), never a partial write of garbage. Pass
 * `{ strict: true }` to instead throw AppearanceSanitizeError on an empty
 * payload that is itself not a plain object (used by the PATCH route to
 * reject a request body that isn't even shaped like an appearance payload).
 */
export function sanitizeAppearancePayload(raw, { strict = false } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (strict) throw new AppearanceSanitizeError("appearance payload must be an object");
    return defaultAppearanceV2();
  }
  const version = Number.isInteger(raw.version) ? raw.version : APPEARANCE_VERSION;
  if (version > APPEARANCE_VERSION) {
    // Fail-safe per contract: a newer-than-supported version resolves to
    // pure defaults. Never rewritten here — this function never persists.
    return defaultAppearanceV2();
  }
  const preset = PRESET_NAMES.includes(raw.preset) ? raw.preset : "default";
  const rawOverrides = raw.overrides && typeof raw.overrides === "object" ? raw.overrides : {};
  const rawNode = rawOverrides.node && typeof rawOverrides.node === "object" ? rawOverrides.node : {};
  return {
    version: APPEARANCE_VERSION,
    preset,
    overrides: {
      canvas: sanitizeCanvasOverride(rawOverrides.canvas),
      node: {
        root: sanitizeNodeRoleOverride(rawNode.root),
        branch: sanitizeNodeRoleOverride(rawNode.branch),
        leaf: sanitizeNodeRoleOverride(rawNode.leaf),
      },
      connector: sanitizeConnectorOverride(rawOverrides.connector),
    },
  };
}

function deepCloneRoleBase(role) {
  return { ...role };
}

function clonePreset(preset) {
  return {
    canvas: { ...preset.canvas },
    node: { root: deepCloneRoleBase(preset.node.root), branch: deepCloneRoleBase(preset.node.branch), leaf: deepCloneRoleBase(preset.node.leaf) },
    connector: { ...preset.connector },
  };
}

/**
 * defaults(theme) -> immutable preset V2 -> saved LIVE_SAFE overrides.
 * `savedAppearance` may be undefined/null (a record predating Appearance
 * V2) or a malformed/future-versioned payload — both resolve to the
 * "default" preset with no overrides, never an error, never a rewrite.
 */
export function resolveCanvasAppearance({ savedAppearance } = {}) {
  const sanitized = sanitizeAppearancePayload(savedAppearance);
  const presetName = PRESET_NAMES.includes(sanitized.preset) ? sanitized.preset : "default";
  const resolved = clonePreset(CANVAS_PRESETS_V2[presetName]);

  const ov = sanitized.overrides;
  Object.assign(resolved.canvas, ov.canvas);
  Object.assign(resolved.node.root, ov.node.root);
  Object.assign(resolved.node.branch, ov.node.branch);
  Object.assign(resolved.node.leaf, ov.node.leaf);
  Object.assign(resolved.connector, ov.connector);

  // `null` is a real, meaningful value here — "don't touch the container's
  // background at all, leave the canvas's own native/theme CSS in control"
  // (see roleBase's own header comment for the matching node-role rule).
  // Only "light"/"dark" (an explicit, preset-chosen override) resolve to a
  // concrete hex; theme-tracking the ambient light/dark mode is NOT this
  // function's job when background is null — that's "no override" by
  // definition, not "override with whatever the theme happens to be".
  if (resolved.canvas.background === "light") {
    resolved.canvas.background = "#FFFFFF";
  } else if (resolved.canvas.background === "dark") {
    resolved.canvas.background = "#15171C";
  }
  return resolved;
}

/**
 * Export-only resolve order: resolved canvas appearance (the map's own
 * saved LIVE_SAFE look) -> export LIVE_SAFE overrides, when Export Studio's
 * "Tùy chỉnh riêng bản xuất" is chosen. `exportOverride` is the SAME
 * `overrides` shape as a saved appearance payload's own `overrides` — it is
 * sanitized exactly like a saved one (no arbitrary CSS/colors/enums reach
 * the result) and is NEVER persisted by this function; only an explicit
 * "Áp dụng cho sơ đồ" action (a real PATCH call, built elsewhere) saves
 * anything. Typography/padding/density are NOT part of this function's
 * output at all — those stay export-only, resolved separately by
 * mindmapExportAppearance.js against its own disposable offscreen scene,
 * never touching this contract or the live canvas.
 */
export function resolveExportAppearance({ canvasAppearance, exportOverride } = {}) {
  const resolved = resolveCanvasAppearance({ savedAppearance: canvasAppearance });
  if (!exportOverride) return resolved;
  const sanitized = sanitizeAppearancePayload({ version: APPEARANCE_VERSION, preset: "default", overrides: exportOverride }).overrides;
  Object.assign(resolved.canvas, sanitized.canvas);
  for (const role of NODE_ROLES) Object.assign(resolved.node[role], sanitized.node[role]);
  Object.assign(resolved.connector, sanitized.connector);
  if (resolved.canvas.background === "light") resolved.canvas.background = "#FFFFFF";
  else if (resolved.canvas.background === "dark") resolved.canvas.background = "#15171C";
  return resolved;
}

/** Node role by depth — depth 0 (the map root) is "root", depth 1 ("main
 * branch" in mind-elixir's own vocabulary) is "branch", everything deeper is
 * "leaf". Mirrors mindElixirAdapter.js's own `kind` mapping
 * (root/section/idea) one-to-one so the same node is always classified the
 * same way whether read from the live tree or the saved record. */
export function roleForDepth(depth) {
  if (depth === 0) return "root";
  if (depth === 1) return "branch";
  return "leaf";
}

export { AppearanceSanitizeError };
