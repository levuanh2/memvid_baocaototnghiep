// IA pass round 5, item 4 — the ONE contextual next-action decision, pulled
// out of ChatArea's JSX so it's a real, testable pure function instead of an
// inline ternary (this codebase has no React component-render test infra,
// see docs/VISUAL_IDENTITY_WORKSPACE_REDESIGN.md, so extracting the actual
// decision logic is how a change like this gets real coverage).
export function computeNextAction({ messagesCount, selectedCount }) {
  if (messagesCount > 0) return null;
  if (!selectedCount) return "select-sources";
  return "ask-question";
}
