// Reconciling the local "sources" list against /list-indexed once a document
// finishes processing. Pulled out of SidebarLeft.jsx so the merge/selection
// logic is independently testable (this codebase has no React
// component-render test infra — see
// docs/VISUAL_IDENTITY_WORKSPACE_REDESIGN.md).
//
// Defensive hardening, not a confirmed-bug fix: investigated a reported
// "selection gets cleared after answering" symptom by tracing upload ->
// indexing completion -> selection end to end with isolated, correctly-
// scoped Playwright runs (ambiguous test selectors had produced a false
// signal in earlier rounds - see the doc above for the full trace). Live
// testing did not reproduce a backend video_stem mismatch: /list-indexed
// returned a stable, identical stem across repeated calls for the same
// document in every isolated run. The underlying pattern this file guards
// against — matching a selection by a recomputed string value instead of a
// stable identity — is still architecturally fragile (the app has no
// source_id in /list-indexed's response to correlate by), so
// reconcileSelectedSources migrates a selection to a same-filename entry
// instead of silently dropping it, rather than assuming the fragility can
// never manifest.
export function keyOfSource(s) {
  return s?.video_stem || s?.video;
}

export function mergeSources(prevSources, backendSources, formatFileName) {
  const prev = Array.isArray(prevSources) ? prevSources : [];
  const list = Array.isArray(backendSources) ? backendSources : [];
  const activeSources = prev.filter((s) => s.status === "processing" || s.status === "index_ready");
  const readySources = list.map((s) => {
    const previous = prev.find((item) => keyOfSource(item) === keyOfSource(s));
    return {
      source_id: null,
      filename: s.filename || formatFileName(keyOfSource(s)),
      video_stem: keyOfSource(s),
      status: "ready",
      progress: 1.0,
      substatus: null,
      capabilities: { chunk_query: true, memory_query: true },
      can_query: true,
      num_chunks: s.num_chunks,
      // /sources/:id/status owns the per-upload aggregate. Preserve it when
      // /list-indexed replaces the optimistic row after completion.
      ...(previous?.usage ? { usage: previous.usage } : {}),
    };
  });
  const combined = [...activeSources];
  readySources.forEach((rs) => {
    if (!combined.some((ps) => keyOfSource(ps) === rs.video_stem)) combined.push(rs);
  });
  return combined;
}

export function reconcileSelectedSources(prevSources, backendSources, prevSelected) {
  const prev = Array.isArray(prevSources) ? prevSources : [];
  const list = Array.isArray(backendSources) ? backendSources : [];
  const selected = Array.isArray(prevSelected) ? prevSelected : [];
  const backendStems = new Set(list.map(keyOfSource));

  const migrated = selected.map((stem) => {
    if (backendStems.has(stem)) return stem;
    const oldEntry = prev.find((s) => keyOfSource(s) === stem);
    const renamed = oldEntry?.filename ? list.find((s) => s.filename === oldEntry.filename) : null;
    return renamed ? keyOfSource(renamed) : stem;
  });

  // De-dupe (two old stems could in principle migrate to the same new one)
  // and drop anything still not present in the backend list — a genuinely
  // deleted source, not a rename.
  return [...new Set(migrated)].filter((stem) => backendStems.has(stem));
}
