// Feature epic M1 (Multi-Document Intelligence) — Concept Merge (mục 5) +
// Compare Documents (mục 6). THUẦN: no DOM/React, same convention as every
// other utils/*.js in this pack series.
//
// "Identical concept" means EXACT name match after the SAME normalization
// `taiLieuLienQuan.js` already uses for "related documents" (`boDau` — fold
// diacritics, lowercase, trim). This is a deterministic TEXT transform, not
// a semantic one: "CPU" only merges with another literal "CPU" (or "cpu",
// "Cpu" — same string, different case/accents), never with "bộ xử lý" or
// any other word a human might consider the same idea. That restriction is
// the epic's own hard rule ("Only deterministic merge... No semantic
// merging"), not a shortfall.
import { boDau } from "./thuVienTaiLieu";
import { normStem, parseCiteKey } from "./evidence";

const conceptKey = (kind, name) => `${kind}::${boDau(name)}`;

/** Real per-document concept data — `doc.knowledge.topics[].name` and
 * `doc.knowledge.entities[]` (a string array), the SAME two fields
 * `taiLieuLienQuan.js`/`KnowledgePanel.jsx` already read from the existing
 * `/api/library` payload. No new fetch shape, no new backend field. */
export function extractConcepts(doc) {
  const topics = Array.isArray(doc?.knowledge?.topics) ? doc.knowledge.topics : [];
  const entities = Array.isArray(doc?.knowledge?.entities) ? doc.knowledge.entities : [];
  const out = [];
  for (const t of topics) if (t?.name) out.push({ kind: "topic", name: t.name });
  for (const e of entities) if (e) out.push({ kind: "entity", name: String(e) });
  return out;
}

/**
 * `docs`: `[{ id, label, concepts: [{kind,name}] }]` — pure input shape, so
 * callers build it however they have the data (real `document_id`+`extractConcepts`
 * result, or a test fixture). A concept repeated twice inside the SAME
 * document counts once for that document (presence, not frequency).
 *
 * Returns `{ shared, uniquePerDoc }`:
 *   - `shared`: concepts present in 2+ of the given docs, each with every
 *     contributing `docId` — real provenance, never collapsed to a count.
 *   - `uniquePerDoc`: `Map(docId -> [{kind,name}])`, concepts present in
 *     exactly one of the given docs.
 * A concept in ZERO of the given docs never appears anywhere (nothing to
 * report) — this function only ever describes docs it was actually given.
 */
export function compareConcepts(docs) {
  const list = Array.isArray(docs) ? docs : [];
  const byKey = new Map();
  for (const d of list) {
    if (!d?.id) continue;
    const seenInDoc = new Set();
    for (const c of d.concepts || []) {
      if (!c?.name) continue;
      const key = conceptKey(c.kind, c.name);
      if (seenInDoc.has(key)) continue;
      seenInDoc.add(key);
      let entry = byKey.get(key);
      if (!entry) { entry = { kind: c.kind, name: c.name, docIds: [] }; byKey.set(key, entry); }
      entry.docIds.push(d.id);
    }
  }

  const shared = [];
  const uniquePerDoc = new Map(list.filter((d) => d?.id).map((d) => [d.id, []]));
  for (const entry of byKey.values()) {
    if (entry.docIds.length >= 2) shared.push(entry);
    else if (entry.docIds.length === 1) uniquePerDoc.get(entry.docIds[0])?.push({ kind: entry.kind, name: entry.name });
  }
  shared.sort((a, b) => b.docIds.length - a.docIds.length || a.name.localeCompare(b.name));
  for (const arr of uniquePerDoc.values()) arr.sort((a, b) => a.name.localeCompare(b.name));

  return { shared, uniquePerDoc };
}

/**
 * Match real `/api/library` document records to a workspace's selected
 * stems (`selectedSources`, from SidebarLeft's checkboxes). Uses the SAME
 * `normStem` every other stem-comparison in this codebase already uses
 * (evidence highlighting, citation matching) — `source_stem` and a
 * `selectedSources` entry can carry different trailing-timestamp suffixes
 * for the same underlying document, and comparing them raw would silently
 * miss matches.
 */
export function matchDocumentsToStems(documents, stems) {
  const wanted = new Set((stems || []).map((s) => normStem(typeof s === "string" ? s : s?.name || s?.id)));
  return (documents || []).filter((d) => d?.source_stem && wanted.has(normStem(d.source_stem)));
}

/**
 * Knowledge Dashboard extension (mục 8) — per-document vs. cross-document
 * coverage. "evidence" is the only history kind whose `id` encodes a
 * document (a `citeKey`) — see ResearchTimeline.jsx's `goiYNguon` for the
 * same honest constraint. Returns which of the given `stems` have at least
 * one opened citation this session (`covered`) and which have none
 * (`uncovered`) — real presence/absence, not an estimate.
 */
export function evidenceCoverage(history, stems) {
  const wanted = (stems || []).map((s) => (typeof s === "string" ? s : s?.name || s?.id)).filter(Boolean);
  const citedStems = new Set(
    (history || []).filter((e) => e.kind === "evidence").map((e) => normStem(parseCiteKey(e.id).stem))
  );
  const covered = wanted.filter((s) => citedStems.has(normStem(s)));
  const uncovered = wanted.filter((s) => !citedStems.has(normStem(s)));
  return { covered, uncovered };
}
