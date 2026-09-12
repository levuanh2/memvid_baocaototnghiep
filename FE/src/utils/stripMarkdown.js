// MindMap V2 Phase 4, Task 1 — markdown normalization for surfaces that
// canvas-render plain text (mind-elixir's node `topic`), not a React tree.
//
// WHY a strip function and not a renderer here specifically: mind-elixir
// sets `node.textContent = topic` for a node with no `markdown` option
// configured (confirmed in node_modules/mind-elixir/dist/MindElixir.js) —
// it is not a React component, so `MdSnippet`/`MdProse` (the ONE markdown
// renderer this project has, Task 7 — no second implementation added here)
// cannot mount inside it. The only way to stop raw `**`/`##`/`<li>` from
// appearing literally on the canvas is to remove the syntax BEFORE it
// reaches mind-elixir — "Normalize once. Render consistently." (Task 1)
// means exactly this: one strip, here, at the adapter boundary — nowhere
// else needs to touch node-title text again (EvidenceDrawer's node.title
// comes from this SAME already-stripped string, see mindElixirAdapter.js).
//
// ponytail: this is stripping, not parsing — **bold** becomes `bold`, not
// styled bold (the canvas has no bold rendering path without a markdown
// renderer, which Task 7 forbids adding). Good enough for "never show raw
// syntax"; recovering actual emphasis on the canvas is a renderer-level
// capability outside this phase's scope.

const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const BOLD_RE = /(\*\*|__)(.+?)\1/g;
const ITALIC_RE = /(\*|_)(.+?)\1/g;
const HEADING_RE = /^#{1,6}\s+/gm;
const INLINE_CODE_RE = /`([^`]*)`/g;
const LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;
const LIST_MARKER_RE = /^\s*[-*+]\s+/gm;

export function stripMarkdown(text) {
  const s = String(text ?? "");
  if (!s) return "";
  return s
    .replace(HTML_TAG_RE, "")
    .replace(HEADING_RE, "")
    .replace(LINK_RE, "$1")
    .replace(BOLD_RE, "$2")
    .replace(ITALIC_RE, "$2")
    .replace(INLINE_CODE_RE, "$1")
    .replace(LIST_MARKER_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default stripMarkdown;
