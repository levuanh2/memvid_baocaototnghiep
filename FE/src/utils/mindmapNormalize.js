// Pure normalizer for BE mindmap records → single FE model.
//
// The BE emits two record shapes:
//   - v2 (schema_version === 2): { title, nodes:[{id,parent,kind,title,note,chunk_refs,order}],
//     relations:[{source,target,type,label}], generator:{degraded,missing} }
//   - v1/legacy: { title, nodes:[{id,parent,title}], diagram?:{nodes:[...], edges:[...]} }
//     (v1 unify logic ported from MindMapModal.jsx::normalizeHierarchyFromData)
//
// Output model (both paths):
//   { title, nodes:[{id,parent,title,note,kind,chunkRefs,order}],
//     relations:[{source,target,type,label}], degraded, missing }
//
// No React imports, no side effects — safe to unit test in isolation.
//
// M2.5 (Provenance Adoption) — v2 nodes may additionally carry `source_stems`
// (BE/services/provenance.py, see docs/PROVENANCE_CONTRACT.md). The previous
// version of this normalizer's node mapper was an explicit field allowlist
// that silently dropped any field not named here — `source_stems` included.
// Fixed below via `normalizeSourceStems` (utils/evidence.js): present only
// when BE resolved it to a real, non-empty, deduped stem list; absent
// (key omitted from the node entirely) otherwise — never `[]`, never a
// fabricated fallback. v1/legacy records never carry this field (it did not
// exist before M2) and are not touched here.
import { normalizeSourceStems } from "./evidence";
import { generationProfileFor, layoutVersionFor } from "./mindmapLayout";

const KIND_ROOT = "root";
const KIND_DEFAULT = "idea";

const emptyModel = () => ({
  title: "", nodes: [], relations: [], degraded: false, missing: [], schemaVersion: 1,
  layoutVersion: "", generationProfile: "", upgradeRequired: true,
});

const normalizeV2 = (record) => {
  const rawNodes = Array.isArray(record.nodes) ? record.nodes : [];
  const rawRelations = Array.isArray(record.relations) ? record.relations : [];
  const generator = record.generator && typeof record.generator === "object" ? record.generator : {};
  const schemaVersion = Number(record.schema_version) || 1;
  const relationsMissing = !Object.prototype.hasOwnProperty.call(record, "relations");
  const enrichmentMissing = rawNodes.some((node) => !Object.prototype.hasOwnProperty.call(node || {}, "enrichment"));

  const nodes = rawNodes
    .filter((n) => n && n.id != null)
    .map((n) => {
      const parent = n.parent == null ? null : String(n.parent);
      const node = {
        id: String(n.id),
        parent,
        title: n.title || "",
        note: n.note || "",
        kind: n.kind || (parent == null ? KIND_ROOT : KIND_DEFAULT),
        chunkRefs: Array.isArray(n.chunk_refs) ? n.chunk_refs : [],
        order: Number.isFinite(Number(n.order)) ? Number(n.order) : 0,
        // Renderer V2 (Task 3/4) — additive passthrough of fields the BE
        // already sends (Phase 1: number/level; Phase 2B: enrichment) but
        // this normalizer previously dropped. v1/legacy records never have
        // these — safe defaults below, never undefined.
        number: n.number || "",
        level: Number.isFinite(Number(n.level)) ? Number(n.level) : 0,
        enrichment: Array.isArray(n.enrichment) ? n.enrichment : [],
      };
      // M2.5 — deliberately NOT defaulted to `[]` like every field above.
      // `sourceStems` absent means "unresolved", a real distinct state from
      // "resolved to zero sources" (which cannot happen — BE never emits an
      // empty array either). A caller must be able to tell the two apart.
      const sourceStems = normalizeSourceStems(n.source_stems);
      if (sourceStems) node.sourceStems = sourceStems;
      return node;
    });

  const relations = rawRelations
    .filter((r) => r && r.source != null && r.target != null)
    .map((r) => ({
      source: String(r.source),
      target: String(r.target),
      type: r.type || "relates_to",
      label: r.label || "",
    }));

  return {
    title: record.title || "",
    nodes,
    relations,
    degraded: Boolean(generator.degraded),
    missing: Array.isArray(generator.missing) ? generator.missing : [],
    schemaVersion,
    layoutVersion: layoutVersionFor(record),
    generationProfile: generationProfileFor(record),
    upgradeRequired: schemaVersion < 2 || relationsMissing || enrichmentMissing
      || generator.missing?.includes?.("enrich") || generator.missing?.includes?.("relations"),
  };
};

// Ported from MindMapModal.jsx::normalizeHierarchyFromData (unify nodes+diagram,
// id coercion, parent map, root detect). Adapted to the shared output shape:
// note/chunkRefs are empty for v1 (legacy records never carried them), and
// relations are the diagram's semantic edges only (tree structure is implied
// by each node's `parent` field, not re-emitted as relations).
const normalizeV1 = (record) => {
  const flatNodes = Array.isArray(record.nodes) ? record.nodes : [];
  const diagramNodes = Array.isArray(record?.diagram?.nodes) ? record.diagram.nodes : [];
  const diagramMap = new Map(diagramNodes.map((n) => [String(n.id), n]));

  let nodes;
  if (flatNodes.length > 0) {
    nodes = flatNodes
      .filter((n) => n && n.id != null)
      .map((n, index) => {
        const id = String(n.id);
        const extra = diagramMap.get(id) || {};
        const parent = n.parent == null ? null : String(n.parent);
        const kind = extra.type === "root" || (!extra.type && parent == null)
          ? KIND_ROOT
          : (extra.type || KIND_DEFAULT);
        return {
          id,
          parent,
          title: extra.title || n.title || `Node ${index + 1}`,
          note: "",
          kind,
          chunkRefs: [],
          order: Number.isFinite(Number(extra.order)) ? Number(extra.order) : index,
          number: "", level: 0, enrichment: [],
        };
      });
  } else if (diagramNodes.length > 0) {
    nodes = diagramNodes
      .filter((n) => n && n.id != null)
      .map((n, index) => {
        const parent = n.parent == null ? null : String(n.parent);
        const kind = n.type === "root"
          ? KIND_ROOT
          : (n.type ? n.type : (index === 0 ? KIND_ROOT : KIND_DEFAULT));
        return {
          id: String(n.id),
          parent,
          title: n.title || `Node ${index + 1}`,
          note: "",
          kind,
          chunkRefs: [],
          order: Number.isFinite(Number(n.order)) ? Number(n.order) : index,
          number: "", level: 0, enrichment: [],
        };
      });
  } else {
    nodes = [];
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const diagramEdges = Array.isArray(record?.diagram?.edges) ? record.diagram.edges : [];
  const seen = new Set();
  const relations = diagramEdges
    .filter((e) => e && e.source != null && e.target != null)
    .map((e) => ({
      source: String(e.source),
      target: String(e.target),
      type: e.type || "relates_to",
      label: e.label || "",
    }))
    .filter((r) => {
      if (!nodeIds.has(r.source) || !nodeIds.has(r.target)) return false;
      if (r.source === r.target) return false;
      const key = `${r.source}->${r.target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return {
    // diagram title first for v1 legacy; empty string contract for garbage inputs
    title: record?.diagram?.title || record.title || "",
    nodes,
    relations,
    degraded: false,
    missing: [],
    schemaVersion: 1,
    layoutVersion: "",
    generationProfile: "",
    upgradeRequired: true,
  };
};

export const normalizeMindmapRecord = (record) => {
  if (!record || typeof record !== "object") return emptyModel();

  if (Number(record.schema_version) === 2) return normalizeV2(record);

  return normalizeV1(record);
};
