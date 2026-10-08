// Live-apply engine for Appearance V2's LIVE_SAFE subset (PR C2). Reusable
// against BOTH the real live canvas instance and an export offscreen scene
// instance — same shape (`mind.nodeData`, `mind.findEle`, `mind.container`),
// same function. Deliberately contains ZERO calls to layout()/linkDiv()/
// refresh()/scaleFit()/toCenter() — every property this module touches was
// measured LIVE_SAFE (0 geometry delta, p95=0px across 390 repeat
// measurements) specifically because a direct style write never needs one.
// Do not add a property here that the C2 closure pass didn't clear — see
// .playbook/known-issues.md for the measurement record and why typography/
// padding/density are excluded (they move `me-root` itself via plain CSS
// flex reflow, independent of whether linkDiv() runs).
import { roleForDepth, roleIsNoop } from "./mindMapAppearanceV2";

const STROKE_WIDTH = { thin: "1.5", normal: "2", thick: "3.5" };

function composeBoxShadow(role) {
  const parts = [];
  if (role.borderWidth > 0 && role.borderColor) parts.push(`inset 0 0 0 ${role.borderWidth}px ${role.borderColor}`);
  if (role.shape === "underline") parts.push(`inset 0 -2px 0 0 ${role.borderColor || role.textColor || "currentColor"}`);
  if (role.shadow) parts.push("0 2px 6px rgba(0,0,0,0.15)");
  return parts.length ? parts.join(", ") : "none";
}

function roleRadiusPx(role) {
  if (role.shape === "pill") return "999px";
  if (role.shape === "underline") return "0px";
  return `${role.radius ?? 6}px`;
}

function gridBackgroundImage(grid) {
  if (grid === "dot") return "radial-gradient(circle, rgba(0,0,0,0.08) 1px, transparent 1px)";
  if (grid === "line") return "linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)";
  return "none";
}

/**
 * Applies `resolved` (the output of resolveCanvasAppearance/resolveExportAppearance)
 * directly to an already-rendered mind-elixir instance — node fill/text/
 * border/radius/shadow per role, connector color/thickness/style via one
 * scoped <style> tag, canvas background/grid on the container. Returns a
 * `restore()` that reverses every change (snapshotted inline styles, the
 * style tag removed) — call it on Cancel/Escape, or before applying a new
 * draft on top of a previous preview.
 */
// mind-elixir's `findEle` THROWS (never returns null/undefined) for a node
// that isn't currently rendered — most commonly one inside a collapsed
// branch (verified by reading dist/mind-elixir.js: `throw new Error`, not a
// null return). A collapsed branch is completely ordinary on any real map,
// so this isn't an edge case to special-case around — it's the normal
// shape of findEle itself, same as MindElixirView.jsx's own
// `findTopicSafely` helper already treats it. Caught before merge: an
// earlier draft used `mind.findEle?.(id)` (optional-chaining only guards a
// MISSING method, not one that throws), which crashed the whole React tree
// — real-browser Playwright QA against a map with a collapsed branch is
// what caught it; jsdom-based unit tests never exercise a real collapsed
// node here.
function findEleSafely(mind, id) {
  try { return mind.findEle?.(id) || null; } catch { return null; }
}

export function applyLiveCanvasAppearance({ mind, resolved }) {
  const touchedNodes = [];
  const walk = (node, depth) => {
    const role = resolved.node[roleForDepth(depth)];
    if (!roleIsNoop(role)) {
      const el = findEleSafely(mind, node.id);
      if (el) {
        touchedNodes.push({
          el,
          prev: { background: el.style.background, color: el.style.color, boxShadow: el.style.boxShadow, borderRadius: el.style.borderRadius },
        });
        el.style.background = role.shape === "underline" ? "transparent" : (role.fill || "");
        el.style.color = role.textColor || "";
        el.style.boxShadow = composeBoxShadow(role);
        el.style.borderRadius = roleRadiusPx(role);
      }
    }
    (node.children || []).forEach((c) => walk(c, depth + 1));
  };
  if (mind.nodeData) walk(mind.nodeData, 0);

  // Canvas background/grid: background null AND grid "none" is the
  // "default" preset's own no-op shape — skip the container entirely so
  // the native/theme CSS stays in exclusive control, exactly like a
  // no-op node role above.
  const container = mind.container;
  const touchesContainer = Boolean(resolved.canvas.background) || resolved.canvas.grid !== "none";
  const prevContainer = container && touchesContainer
    ? { backgroundColor: container.style.backgroundColor, backgroundImage: container.style.backgroundImage, backgroundSize: container.style.backgroundSize }
    : null;
  if (container && touchesContainer) {
    if (resolved.canvas.background) container.style.backgroundColor = resolved.canvas.background;
    container.style.backgroundImage = gridBackgroundImage(resolved.canvas.grid);
    container.style.backgroundSize = resolved.canvas.grid === "none" ? "" : "20px 20px";
  }

  let styleEl = null;
  const rules = [];
  if (resolved.connector.thickness !== "normal") {
    rules.push(`.lines path[stroke], .subLines path[stroke] { stroke-width: ${STROKE_WIDTH[resolved.connector.thickness]} !important; }`);
  }
  if (resolved.connector.style === "dashed") {
    rules.push(`.lines path[stroke], .subLines path[stroke] { stroke-dasharray: 6 4 !important; }`);
  }
  if (resolved.connector.colorMode !== "keep") {
    const color = resolved.connector.fixedColor || (resolved.connector.colorMode === "monochrome" ? "#2B2620" : "#126CF2");
    rules.push(`.lines path[stroke], .subLines path[stroke] { stroke: ${color} !important; }`);
  }
  if (rules.length && container) {
    styleEl = document.createElement("style");
    styleEl.setAttribute("data-mm-appearance-connector", "true");
    styleEl.textContent = rules.join("\n");
    container.appendChild(styleEl);
  }

  return function restore() {
    touchedNodes.forEach(({ el, prev }) => {
      el.style.background = prev.background;
      el.style.color = prev.color;
      el.style.boxShadow = prev.boxShadow;
      el.style.borderRadius = prev.borderRadius;
    });
    if (prevContainer) {
      container.style.backgroundColor = prevContainer.backgroundColor;
      container.style.backgroundImage = prevContainer.backgroundImage;
      container.style.backgroundSize = prevContainer.backgroundSize;
    }
    styleEl?.remove();
  };
}
