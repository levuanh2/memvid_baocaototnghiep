// Export Studio appearance controls (Round 2, section 5/6) — the "essential
// subset" the round asked for, kept strictly to options that can ACTUALLY
// change the exported artifact. Two library facts (verified by reading
// node_modules/mind-elixir/dist/MindElixir.js, not assumed) shaped what's
// here and what isn't:
//
// - Connector color comes from `nodeObj.branchColor || theme.palette[i]`,
//   read ONLY from each ROOT-LEVEL child at render time (MindElixir.js's
//   `renderTree`/`generateMainBranch` call site: `a.nodeObj.branchColor ||
//   g[c % g.length]`). Sub-branches inherit that resolved color unless
//   their OWN branchColor is set. So "branch colors" and "connector color"
//   are the same one knob in this library, not two — this module exposes
//   ONE `branchColorMode` control (not a separate connector-color toggle)
//   plus a genuinely separate `connectorThickness` (stroke-width is a
//   presentation attribute on the connector <path>s; a real stylesheet
//   rule with `!important` legitimately overrides it, same as color).
// - Theme cssVar values (spacing, radii, etc.) are applied by mind-elixir
//   as literal `container.style.setProperty(varName, value)` calls on its
//   OWN root element (`mind.container`) — see MindElixir.js's `changeTheme`
//   (`this.container.style.setProperty(l, o[l])`). Overriding them from an
//   ancestor wouldn't work (closer wins); they must be set directly on
//   `mind.container` (or the offscreen instance's own container), which is
//   exactly what `applyAppearance` below does, then reverts.
//
// Deliberately NOT exposed as a control this round (would violate "don't
// show an option that can't affect the artifact yet"): rendering note text
// into the image itself. Nothing in the live canvas currently renders note
// bodies as visible node content (notes only surface in the side drawer on
// click), so there is no existing DOM to toggle and no cheap, honest way to
// add real note rendering without also building a text-layout pass — left
// for a follow-up round.

export const SPACING_VARS = {
  compact: { "--main-gap-x": "40px", "--main-gap-y": "20px", "--node-gap-x": "18px", "--node-gap-y": "4px", "--map-padding": "36px 60px" },
  normal: { "--main-gap-x": "72px", "--main-gap-y": "36px", "--node-gap-x": "32px", "--node-gap-y": "8px", "--map-padding": "60px 100px" },
  spacious: { "--main-gap-x": "110px", "--main-gap-y": "56px", "--node-gap-x": "48px", "--node-gap-y": "14px", "--map-padding": "90px 140px" },
};

// Already loaded globally via index.css's Google Fonts import — reusing
// the app's own bundled faces rather than adding a new font dependency.
export const FONT_STACKS = {
  sans: "Inter, system-ui, sans-serif",
  serif: "'Spectral', Georgia, serif",
};

export const MONOCHROME_COLOR = "#2B2620"; // archival-ink, matches this app's --text-primary family
export const CUSTOM_PALETTE = ["#126CF2", "#8C4DFF", "#16A085", "#F2353A"]; // curated 4-tone rotation, distinct from the live canvas's own 8-tone THEME.palette

export const STROKE_WIDTH = { thin: "1.5", normal: "2", thick: "3.5" };

export const DEFAULT_APPEARANCE = {
  font: "canvas", // "canvas" | "sans" | "serif"
  branchColorMode: "keep", // "keep" | "monochrome" | "customPalette"
  spacing: "normal", // "compact" | "normal" | "spacious"
  connectorThickness: "normal", // "thin" | "normal" | "thick"
  content: { relations: true, citations: true, legend: false, branding: false },
};

export const PRESETS = {
  canvas: { ...DEFAULT_APPEARANCE, content: { relations: true, citations: true, legend: false, branding: false } },
  study: { font: "serif", branchColorMode: "keep", spacing: "normal", connectorThickness: "normal", content: { relations: true, citations: true, legend: true, branding: false } },
  minimal: { font: "sans", branchColorMode: "monochrome", spacing: "compact", connectorThickness: "thin", content: { relations: false, citations: false, legend: false, branding: false } },
  presentation: { font: "sans", branchColorMode: "customPalette", spacing: "spacious", connectorThickness: "thick", content: { relations: true, citations: false, legend: true, branding: true } },
};

/** True when the appearance change can move node box metrics (font width, gap/padding) — callers must re-run mind.layout()+linkDiv() and let a settle tick pass before capture, exactly like the existing force-expand path already does. */
export function needsRelayout(appearance) {
  return appearance.font !== "canvas" || appearance.spacing !== "normal";
}

function resolveBranchColor(mode, index) {
  if (mode === "monochrome") return MONOCHROME_COLOR;
  if (mode === "customPalette") return CUSTOM_PALETTE[index % CUSTOM_PALETTE.length];
  return null; // "keep" — no override
}

/**
 * Applies the part of `appearance` that only needs `mind.container` — font,
 * spacing, branch/connector color. Safe to call BEFORE a force-expand +
 * relayout, because `mind.container` itself is never replaced by that
 * relayout (only its descendants are rebuilt wholesale — confirmed by this
 * codebase's own lifecycle audit: `refresh()`/layout rebuilds swap child
 * elements, not the container). mind-elixir's OWN `changeTheme` sets its
 * cssVars on exactly this element (see this module's header comment), so
 * it's the only place a relayout will actually pick a new value up from.
 * Returns a `restore()` — call it in a `finally`.
 */
export function applyContainerAppearance({ mind, appearance }) {
  const container = mind.container;
  const restoreFns = [];

  if (appearance.font !== "canvas") {
    const prev = container.style.fontFamily;
    container.style.fontFamily = FONT_STACKS[appearance.font];
    restoreFns.push(() => { container.style.fontFamily = prev; });
  }

  const spacingVars = SPACING_VARS[appearance.spacing];
  if (appearance.spacing !== "normal" && spacingVars) {
    const prevValues = {};
    Object.entries(spacingVars).forEach(([k, v]) => {
      prevValues[k] = container.style.getPropertyValue(k);
      container.style.setProperty(k, v);
    });
    restoreFns.push(() => {
      Object.entries(prevValues).forEach(([k, v]) => {
        if (v) container.style.setProperty(k, v); else container.style.removeProperty(k);
      });
    });
  }

  if (appearance.branchColorMode !== "keep") {
    const children = mind.nodeData?.children || [];
    const snapshot = children.map((c) => c.branchColor);
    children.forEach((c, i) => { c.branchColor = resolveBranchColor(appearance.branchColorMode, i); });
    restoreFns.push(() => { children.forEach((c, i) => { c.branchColor = snapshot[i]; }); });
  }

  return function restore() {
    restoreFns.reverse().forEach((fn) => fn());
  };
}

/**
 * Applies the part of `appearance` that must land on the EXACT element
 * about to be captured — connector-thickness/citations style class,
 * relations visibility, legend/branding overlay. MUST be called with the
 * fresh `target` resolved AFTER any force-expand + relayout has already
 * happened (a stale pre-relayout reference would be a detached element —
 * see mindmapImageExport.test.js's own comment on why 'current_branch'
 * re-resolves `target` post-relayout, not before). Returns a `restore()`.
 */
export function applyTargetAppearance({ mind, target, appearance }) {
  const restoreFns = [];

  const styleEl = document.createElement("style");
  const rules = [];
  if (appearance.connectorThickness !== "normal") {
    rules.push(`.mm-export-appearance path[stroke]:not([stroke="transparent"]) { stroke-width: ${STROKE_WIDTH[appearance.connectorThickness]} !important; }`);
  }
  if (!appearance.content.citations) {
    rules.push(`.mm-export-appearance .tags span.mm-tag-citations { display: none !important; }`);
  }
  if (rules.length) {
    styleEl.textContent = rules.join("\n");
    target.appendChild(styleEl);
    target.classList.add("mm-export-appearance");
    restoreFns.push(() => { target.classList.remove("mm-export-appearance"); styleEl.remove(); });
  }

  const hadHideArrows = target.classList.contains("me-hide-arrows");
  if (!appearance.content.relations && !hadHideArrows) {
    target.classList.add("me-hide-arrows");
    restoreFns.push(() => target.classList.remove("me-hide-arrows"));
  } else if (appearance.content.relations && hadHideArrows) {
    target.classList.remove("me-hide-arrows");
    restoreFns.push(() => target.classList.add("me-hide-arrows"));
  }

  let overlay = null;
  if (appearance.content.legend || appearance.content.branding) {
    overlay = document.createElement("div");
    overlay.className = "mm-export-overlay";
    overlay.style.cssText = "position:absolute; left:12px; bottom:12px; display:flex; flex-direction:column; gap:4px; font-family:Inter,system-ui,sans-serif; font-size:12px; color:#2B2620; pointer-events:none;";
    if (appearance.content.legend) {
      const children = mind.nodeData?.children || [];
      const legend = document.createElement("div");
      legend.style.cssText = "display:flex; flex-wrap:wrap; gap:8px; background:rgba(255,255,255,0.85); padding:4px 8px; border-radius:4px;";
      children.forEach((c, i) => {
        const item = document.createElement("span");
        const dotColor = resolveBranchColor(appearance.branchColorMode, i) || c.branchColor || mind.theme?.palette?.[i % (mind.theme?.palette?.length || 1)] || "#666";
        item.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};margin-right:4px;"></span>${c.topic || ""}`;
        legend.appendChild(item);
      });
      overlay.appendChild(legend);
    }
    if (appearance.content.branding) {
      const brand = document.createElement("div");
      brand.textContent = "StudyMap";
      brand.style.cssText = "font-weight:600; opacity:0.6;";
      overlay.appendChild(brand);
    }
    const prevPosition = target.style.position;
    if (!prevPosition) target.style.position = "relative";
    target.appendChild(overlay);
    const finalOverlay = overlay;
    restoreFns.push(() => { finalOverlay.remove(); if (!prevPosition) target.style.position = prevPosition; });
  }

  return function restore() {
    restoreFns.reverse().forEach((fn) => fn());
  };
}
