// Export Selection Mode (section 5C) — lets the user pick MULTIPLE branch
// roots on the live canvas for a "Các nhánh được chọn" export.
//
// Same MutationObserver architecture as mindElixirExpandDecorator.js (mind-
// elixir replaces, not mutates, its DOM on every re-render), but this one
// also has to SUPPRESS mind-elixir's own click-to-select/open-drawer
// behavior while active ("Node detail drawer không tự mở trong selection
// mode"). mind-elixir's pointer handling starts its own state machine on
// `pointerdown` (box-select/drag — see MindElixirView.jsx's background-pan
// fix comment for the exact mechanism) and finalizes select/edit on
// `click`, both via container/document-level listeners; a capture-phase
// listener on the SAME container that calls `stopPropagation()` runs
// before those (capture happens before the target/bubble phases mind-
// elixir's own bubble-phase handlers rely on) and halts the ENTIRE rest of
// that event's propagation, not just the capture phase — the standard DOM
// Event contract, not something specific to this library. Pan (dragging
// empty canvas) is untouched: the suppressor only fires for clicks that hit
// `<me-tpc>` itself.
//
// A brand-new `<me-export-check>` element is inserted as a sibling of
// `<me-tpc>` (mirroring exactly how mind-elixir positions its own
// `<me-epd>` — see mindElixirExpandDecorator.js) rather than reusing any
// existing element, since there is no built-in multi-select affordance to
// decorate. Clicking either the checkbox OR the topic label toggles
// selection ("Clicking label có thể chọn node; checkbox phải là target rõ
// ràng") — both routes call the same `onToggle`, the checkbox is just the
// dedicated, always-visible target.

function decorateParent(parentEl, { isSelectedFn, onToggle, resolveClickId }) {
  const tpc = parentEl.querySelector("me-tpc");
  if (!tpc?.nodeObj) return;
  const id = tpc.nodeObj.id;
  // Creation is idempotent (skip if this exact element instance already has
  // one), but the checked state below is NOT skipped — it's re-synced on
  // every call. Selection can change for reasons that never touch the DOM
  // (a "Xóa chọn" clear-all button, driven by React state), which the
  // MutationObserver in attachBranchSelectionMode has no way to see; only
  // re-reading `isSelectedFn(id)` on every scan keeps an already-rendered
  // checkbox truthful.
  let check = parentEl.querySelector(":scope > me-export-check");
  if (!check) {
    check = document.createElement("me-export-check");
    // Structure: a 40x40 focusable host (the hitbox) with a 20x20 visible indicator
    // child. The host is what assistive tech and pointer hit-tests see.
    const dot = document.createElement("span");
    dot.className = "mm-export-check__dot";
    dot.setAttribute("aria-hidden", "true");
    check.appendChild(dot);
    check.setAttribute("role", "checkbox");
    check.tabIndex = 0;
    check.setAttribute("aria-label", `Chọn nhánh: ${tpc.nodeObj.topic || ""}`);
    check.dataset.nodeId = id;
    // A click lands on whichever 40px host is painted topmost, and at low zoom a
    // neighbour's host can cover this dot. Resolve the click to the nearest dot
    // instead, so the visible dot always toggles its own branch.
    check.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = resolveClickId ? resolveClickId(e) : id;
      if (target) onToggle(target);
    });
    check.addEventListener("keydown", (e) => {
      // Tab moves between markers in DOM order. Native sequential navigation skipped from one
      // marker to the next inside the canvas, so step to the neighbour explicitly. At the first
      // and last marker the event is left alone and focus leaves the map natively.
      // stopPropagation keeps mind-elixir's editable container from cancelling the key.
      if (e.key === "Tab") {
        e.stopPropagation();
        const list = [...(check.closest(".me-container") || document).querySelectorAll("me-export-check")];
        const next = list[list.indexOf(check) + (e.shiftKey ? -1 : 1)];
        if (next) { e.preventDefault(); next.focus(); }
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      onToggle(id);
    });
    parentEl.insertBefore(check, tpc);
  }
  // Side comes from mind-elixir's own `me-main` container (`lhs` / `rhs`); the
  // root has no `me-main` ancestor. Read on every scan: cheap, and it stays
  // correct if the node is re-parented.
  const main = parentEl.closest("me-main");
  const side = !main ? "root" : main.className.includes("lhs") ? "left" : "right";
  check.dataset.side = side;
  // Horizontal anchor comes from the topic's own offsets, not from the wrapper:
  // mind-elixir pads <me-parent> beyond the topic, so a CSS 100%/0 anchor would
  // drift outward. offsetLeft/offsetWidth are map units and ignore canvas zoom.
  // The host is 40 screen px = 40 * (1/zoom) map units, centred on the topic's
  // outer top corner, so its offset is half that, scaled by the same variable.
  const edge = side === "left" ? tpc.offsetLeft : tpc.offsetLeft + tpc.offsetWidth;
  check.style.left = `calc(${edge}px - 20px * var(--mm-marker-inv, 1))`;
  const selected = isSelectedFn(id);
  check.setAttribute("aria-checked", String(selected));
  check.classList.toggle("is-checked", selected);
}

/**
 * Attaches Export Selection Mode to a mounted mind-elixir container.
 * `isActiveRef` is a ref (not a boolean) so the caller can flip it without
 * detaching/reattaching — the suppressor reads it fresh on every event.
 * Returns `{ detach, resync }`: `detach` tears everything down (and removes
 * every injected checkbox); `resync` re-reads `isSelectedFn` against every
 * currently-rendered checkbox — call it whenever selection changes through
 * a path that isn't a click on the checkbox itself (e.g. a "Xóa chọn"
 * clear-all button).
 */
export function attachBranchSelectionMode(containerEl, { isActiveRef, isSelectedFn, onToggle }) {
  if (!containerEl) return { detach: () => {}, resync: () => {} };

  const scan = () => {
    if (!isActiveRef.current) {
      // Mode just went inactive (or a re-render fired mid-inactive, a no-op
      // once this has already run): sweep any leftover checkboxes. Turning
      // the mode off previously only stopped `decorateParent` from creating
      // NEW ones — existing `<me-export-check>` elements were never told to
      // leave, so they kept rendering (and, once pointer-events was fixed,
      // stayed fully clickable) on the canvas after "Tiếp tục"/"Hủy" closed
      // the selection bar. Same removal `detach()` already does on unmount,
      // just triggered by mode-off instead of component teardown.
      containerEl.querySelectorAll("me-export-check").forEach((el) => el.remove());
      return;
    }
    containerEl.querySelectorAll("me-parent, me-root").forEach((el) => decorateParent(el, { isSelectedFn, onToggle, resolveClickId }));
  };
  // Click resolver: start from the host that received the click, then switch only
  // to a marker whose dot centre is strictly nearer the pointer. A click on the
  // clicked marker's own dot keeps it; a click on a neighbour's dot goes to that dot.
  const resolveClickId = (e) => {
    const own = e.currentTarget;
    const centreDist = (el) => {
      const dot = el.querySelector(".mm-export-check__dot") || el;
      const r = dot.getBoundingClientRect();
      return Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    };
    let best = own;
    let bestDist = centreDist(own);
    containerEl.querySelectorAll("me-export-check").forEach((el) => {
      if (el === own) return;
      const d = centreDist(el);
      if (d < bestDist) { bestDist = d; best = el; }
    });
    return best.dataset.nodeId || null;
  };
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(containerEl, { childList: true, subtree: true });

  // Keep markers a stable on-screen size: the canvas zoom is in its inline
  // transform, so mirror 1/zoom onto the container as a CSS variable. Attribute
  // changes on the style attribute are the only signal pan and zoom send.
  const syncZoom = () => {
    const canvas = containerEl.querySelector(".map-canvas");
    const m = canvas && /scale\(([-0-9.]+)\)/.exec(canvas.style.transform || "");
    const zoom = m ? parseFloat(m[1]) : 1;
    containerEl.style.setProperty("--mm-marker-inv", String(1 / (zoom > 0 ? zoom : 1)));
  };
  syncZoom();
  const zoomObserver = new MutationObserver(syncZoom);
  zoomObserver.observe(containerEl, { attributes: true, attributeFilter: ["style"], subtree: true });

  const suppress = (e) => {
    if (!isActiveRef.current) return;
    const tpc = e.target.closest?.("me-tpc");
    if (!tpc) return;
    e.stopPropagation();
    if (e.type === "click" && tpc.nodeObj?.id) onToggle(tpc.nodeObj.id);
  };
  containerEl.addEventListener("pointerdown", suppress, true);
  containerEl.addEventListener("click", suppress, true);

  return {
    resync: scan,
    detach: () => {
      observer.disconnect();
      zoomObserver.disconnect();
      containerEl.removeEventListener("pointerdown", suppress, true);
      containerEl.removeEventListener("click", suppress, true);
      containerEl.querySelectorAll("me-export-check").forEach((el) => el.remove());
    },
  };
}
