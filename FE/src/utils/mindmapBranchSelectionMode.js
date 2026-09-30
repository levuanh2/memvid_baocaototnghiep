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

function decorateParent(parentEl, { isSelectedFn, onToggle }) {
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
    check.setAttribute("role", "checkbox");
    check.tabIndex = 0;
    check.setAttribute("aria-label", `Chọn nhánh: ${tpc.nodeObj.topic || ""}`);
    const toggle = (e) => { e.stopPropagation(); onToggle(id); };
    check.addEventListener("click", toggle);
    check.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggle(e);
    });
    parentEl.insertBefore(check, tpc);
  }
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
    containerEl.querySelectorAll("me-parent, me-root").forEach((el) => decorateParent(el, { isSelectedFn, onToggle }));
  };
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(containerEl, { childList: true, subtree: true });

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
      containerEl.removeEventListener("pointerdown", suppress, true);
      containerEl.removeEventListener("click", suppress, true);
      containerEl.querySelectorAll("me-export-check").forEach((el) => el.remove());
    },
  };
}
