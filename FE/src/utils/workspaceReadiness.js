// Learning Canvas structural refactor — the same "how many selected sources
// are actually ready to query" count LessonHeader and ChatArea's goal banner
// both need. Pure so it's actually testable (this codebase has no React
// component-render test infra — see docs/VISUAL_IDENTITY_WORKSPACE_REDESIGN.md
// — pulling the real logic out into a pure function is how a change like this
// gets real test coverage instead of none).
export function computeReadyCount(sources, selectedSources) {
  const selected = Array.isArray(selectedSources) ? selectedSources : [];
  const list = Array.isArray(sources) ? sources : [];
  return list.filter((s) => {
    const key = s?.video_stem || s?.video;
    return selected.includes(key) && s?.can_query === true;
  }).length;
}
