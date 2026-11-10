// Upload controls live in layout-specific places: the tablet source rail ("+"), the desktop
// source panel upload button and the workspace empty state ("Tải tài liệu lên"). Crossing a
// responsive boundary (768px, 1280px) unmounts the rail or the panel. If the control being
// unmounted held keyboard focus, focus fell to <body> and a keyboard user lost their place.
//
// React detaches a ref (calls it with null) BEFORE it removes the DOM node, so the ref callback
// can still tell that the node was focused. On the next frame, once the new layout is mounted,
// focus moves to the first usable upload control. With documents already in the library there
// may be no upload control on screen (no empty-state CTA, drawer closed, panel collapsed): then
// focus goes to the control that opens the source panel/drawer, where uploading continues.
// Nothing happens if something else has taken focus meanwhile.
export const UPLOAD_CTA_ATTR = "data-upload-cta";
export const SOURCE_ENTRY_ATTR = "data-source-entry";

export function uploadFocusHandoffRef() {
  let last = null;
  return (node) => {
    if (node) {
      last = node;
      return;
    }
    const wasFocused = last !== null && last === document.activeElement;
    last = null;
    if (!wasFocused) return;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const next = [...document.querySelectorAll(`[${UPLOAD_CTA_ATTR}]`)].find(isUsable)
        || [...document.querySelectorAll(`[${SOURCE_ENTRY_ATTR}]`)].find(isUsable);
      next?.focus();
    });
  };
}

// A closed mobile drawer is only translated off-screen, so its controls still have boxes:
// require a control the user can actually see and reach in the viewport.
function isUsable(el) {
  if (!el.isConnected || el.disabled || el.closest('[inert], [aria-hidden="true"]')) return false;
  if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0
    && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
}
