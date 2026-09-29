// Per-node branch caret accessibility decorator (Round: Export Studio +
// expand/collapse redesign).
//
// mind-elixir already renders a per-node expand/collapse element
// (`<me-epd>`, only for nodes with children — dist/MindElixir.js's node-
// wrapper builder: `if (!isRoot && e.children && e.children.length > 0)`
// appends it) and already wires its click to `expandNode`/`expandNodeAll`
// via a document-level delegated handler keyed off the RAW click target's
// tagName (dist/MindElixir.js: `const y = f.target; y.tagName === "ME-EPD"
// && (...expandNode(y.previousSibling)...)`) — no `.closest()`, the literal
// event target. That delegated handler is the existing, working,
// viewport-preserving toggle mechanism (see `expandCollapseAll`'s own
// comment in MindElixirView.jsx for the identical reuse-not-reimplement
// rationale applied to the toolbar's whole-branch actions) — this file
// deliberately never touches it.
//
// Because the click check is the raw event target's tagName, this decorator
// MUST NOT insert any child element inside `<me-epd>` — a click landing on
// an injected child would make `event.target` that child, not `<me-epd>`,
// and silently break the toggle. Every visual addition here (the chevron
// icon, the hidden-descendant-count badge, the enlarged hit target) is done
// via CSS on `<me-epd>` itself (background/mask-image, `::before`,
// `::after` — see mindmap.css) using `data-*` attributes as the only
// payload, never DOM children.
//
// mind-elixir replaces (not mutates) these DOM nodes on every internal
// re-render (init/refresh/expandNode/expandNodeAll/theme change/edit —
// there is no single public "after render" hook to hang a one-shot
// decoration pass off), so attributes set on one render's `<me-epd>` are
// gone on the next. A MutationObserver watching for `<me-epd>` being added
// anywhere in the container sidesteps needing to enumerate every possible
// trigger: it fires once per real re-render regardless of cause, and needs
// no cleanup logic for removed nodes (they simply stop existing).

function countDescendants(nodeObj) {
  if (!nodeObj?.children?.length) return 0;
  let n = 0;
  for (const child of nodeObj.children) n += 1 + countDescendants(child);
  return n;
}

function decorateOne(epd) {
  // `<me-epd>` is always a direct child of `<me-parent>`, appended right
  // after that same `<me-parent>`'s `<me-tpc>` — verified in
  // dist/MindElixir.js's node-wrapper builder (createParent appends
  // `<me-tpc>` first, then the caller appends the epd as its next sibling).
  const tpc = epd.parentElement?.querySelector("me-tpc");
  const nodeObj = tpc?.nodeObj;
  const expanded = epd.classList.contains("minus");
  const topic = nodeObj?.topic || "";

  epd.setAttribute("role", "button");
  epd.tabIndex = 0;
  epd.setAttribute("aria-expanded", String(expanded));
  epd.setAttribute("aria-label", expanded ? `Thu nhánh: ${topic}` : `Mở nhánh: ${topic}`);
  epd.classList.add("mm-epd");

  const hidden = expanded ? 0 : countDescendants(nodeObj);
  if (hidden > 0) epd.dataset.hiddenCount = String(hidden);
  else delete epd.dataset.hiddenCount;

  // Idempotent: MutationObserver batches can re-scan elements this function
  // already ran on (e.g. an unrelated sibling subtree changed) — attributes
  // above are safe to reset every time, but the keydown listener must only
  // ever be attached once per element instance.
  if (epd.dataset.mmKeyboardBound === "1") return;
  epd.dataset.mmKeyboardBound = "1";
  epd.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    e.preventDefault();
    epd.click(); // reuses mind-elixir's own existing delegated click handler
  });
}

/** Attaches the decorator to a mounted mind-elixir container. Returns a cleanup function. */
export function attachExpandDecorator(containerEl) {
  if (!containerEl) return () => {};
  const scan = () => { containerEl.querySelectorAll("me-epd").forEach(decorateOne); };
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(containerEl, { childList: true, subtree: true });
  return () => observer.disconnect();
}
