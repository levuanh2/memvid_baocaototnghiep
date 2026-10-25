# 05.3 — Engine Boundaries, Technical Incompatibilities & Export Fidelity Guardrails

**Author**: Independent Product & Architecture Reviewer (Antigravity / Agy)
**Mandate**: Guard the exact-node export V3 fidelity and preserve engine-specific strengths while enforcing shared grammar.
**Baseline**: Option B Design Principles (§Hard Constraints & §Done).

---

## 1. Engine Capability Boundary Matrix

Option B explicitly rejects unifying `mind-elixir` and `react-d3-tree` into a single engine (that is Option C). Each engine serves a distinct technical role and has unique architectural strengths:

```
┌───────────────────────────────────────────────┬───────────────────────────────────────────────┐
│           MindElixirView (mind-elixir)        │         StudyMapView (react-d3-tree)          │
├───────────────────────────────────────────────┼───────────────────────────────────────────────┤
│ • Primary Workspace synthesis (/app)          │ • Dedicated Study Curriculum (/app/study)     │
│ • Rich interactive DOM editing                │ • Pure SVG declarative tree rendering        │
│ • Multi-colored branch radial layout          │ • Multi-layout options (top-down, left-right) │
│ • Docked Knowledge Inspector integration     │ • Soft lineage focus / dimming (0.22 opacity) │
│ • Exact-Node V3 raster/vector export engine   │ • High-performance SVG snapshot export       │
└───────────────────────────────────────────────┴───────────────────────────────────────────────┘
```

### Detailed Boundary Classification

| Capability / Rule | Classification | Architectural Justification |
| :--- | :--- | :--- |
| **Token System & Colors** | **Shared Rule** | Both engines must consume `--bg-base`, `--accent`, `--text-primary`, `--border-color`. Zero isolated color palettes. |
| **Typography Family** | **Shared Rule** | Both engines use the shared sans-serif stack (`Aptos / Segoe UI`). Serif (`Spectral/Georgia`) is reserved for prose. |
| **Selection Indicator** | **Shared Rule** | Both engines use `var(--accent)` (`#126CF2` / `#6EA8FF`) + subtle halo. The old `--forest` (`#1F4033`) is retired. |
| **Canvas Background** | **Shared Rule** | Both engines use `var(--bg-base)` with 24px subtle dot lattice. |
| **Branch Color Palette** | **Engine-Specific** | MindElixir assigns distinct colors per root branch (`PALETTE`). StudyMapView uses hierarchy-based stroke weights with optional branch tints. |
| **Layout Orientation** | **Engine-Specific** | MindElixir uses radial dual-sided horizontal layout (`side: 2`). StudyMapView allows user-selected layouts (`step` vs `diagonal`, vertical vs horizontal). |
| **Lineage Dimming** | **Engine-Specific** | StudyMapView dims unrelated nodes to `0.22` opacity on focus. MindElixir uses single-node selection with Inspector reveal. |
| **Node Editing / Drag** | **Intentionally Different** | MindElixir in `/app` supports editing, node rearrangement, and dirty-state saving. StudyMapView in `/app/study` is a read-only curriculum visualizer. |
| **Inspector Surface** | **Intentionally Different** | MindElixir pairs with the persistent/overlay Knowledge Inspector (`320px` floor). StudyMapView embeds a compact inline `NodeDetail` card. |

---

## 2. Technical Incompatibilities Between Engines

Engineers implementing this visual spec must understand that certain features **cannot be naively copied** between engines due to underlying DOM vs SVG architecture:

1. **HTML Flexbox vs SVG Coordinates**:
   - `mind-elixir` nodes are HTML custom elements (`<me-tpc>`) positioned via CSS flexbox and absolute transforms. Text wraps naturally using standard CSS box model (`word-break: break-word`).
   - `react-d3-tree` nodes are SVG `<g>` groups. SVG `<text>` elements have **no native multiline word-wrapping** and do not participate in CSS flexbox. Word wrapping requires explicit `<tspan>` calculation or `<foreignObject>` embedding (which has notorious cross-browser export issues in Safari/headless Chromium).
   - *Spec Directive*: Do not attempt to force `<foreignObject>` into `StudyMapView`. Use calculated `<tspan>` multi-row SVG text to maintain fast, clean SVG rendering.

2. **Caretator / Decorator Lifecycle**:
   - MindElixir uses dynamic DOM injection (`attachExpandDecorator.js`) to append caret buttons (`<me-epd>`) to HTML nodes.
   - `react-d3-tree` manages expand/collapse natively through D3 node data mutation (`nodeDatum.__rd3t.collapsed`).
   - *Spec Directive*: Keep collapse handling native to each engine. StudyMapView uses inner concentric SVG dots, while MindElixir uses its HTML decorator button.

3. **Backend Document Identity**:
   - `MindElixirView` operates on `mindmap` records loaded via source stem in `/app`.
   - `StudyMapView` operates on `document_id` (UUID) via `/app/study/map/:documentId`.
   - *Spec Directive*: Preserve the `useStudyContext` dual-identity contract. Do not assume document identifiers are interchangeable between the two views.

---

## 3. MindMap V3 Export Fidelity Guardrail (High Risk)

> [!CAUTION]
> **CRITICAL ARCHITECTURAL GUARDRAIL**: The MindMap V3 export pipeline (`ExportStudioDialog.jsx`, `mindmapImageExport.js`, `pdf_serializer.py`, and `playwright.fixture.config.js`) has undergone extensive regression hardening. Any visual change that alters the DOM layout geometry or breaks connector serialization will fail automated CI gates.

### Export Pipeline Dependency Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          MINDMAP V3 EXPORT PIPELINE DEPENDENCIES                       │
└────────────────────────────────────────────────────────────────────────────────────────┘

 [MindElixirView.jsx]
       │
       ▼
 [mindElixirTheme.js] ─── CSS Variables ───> [mind-elixir SVG topiclinks]
       │                                                    │
       ├────────────────────────────────────────────────────┤
       │                                                    │
       ▼                                                    ▼
 [mindmapImageExport.js] (Clones DOM & rasterizes)    [DOM Bounding Rects]
       │                                                    │
       ├────────────────────────────────────────────────────┘
       ▼
 [ExportStudioDialog.jsx] (PNG, JPEG, SVG, WebP, PDF Preview)
       │
       ▼
 [pdf_serializer.py] (Backend Exact-Node Layout Engine)
```

### Export Risk Assessment Matrix

| Proposed Grammar Change | Risk Level | Potential Breaking Impact | Mandatory Verification / Guardrail |
| :--- | :--- | :--- | :--- |
| **Change `--selected` to `var(--accent)`** | **LOW** | Selection outline is transient. Offscreen export cleans selection before capturing (`clearSelection()`). | Verify `mindmapImageExport.test.js` passes without selection artifacts. |
| **Change Root / Node Padding or Radius** | **HIGH** | Alters bounding boxes of `<me-tpc>` elements. SVG connector endpoints (`topiclinks`) depend on exact topic width/height. | If `--topic-padding` or `--main-radius` changes, connector paths recalculate. Must run `test_mindmap_export_rendering_v3.py`. |
| **Change Font Family in MindElixir** | **CRITICAL**| Server-side PDF export (`pdf_serializer.py`) relies on bundled `DejaVuSans.ttf` font metrics. Changing web font metrics without backend sync causes text clipping in PDF. | Keep primary font metric compatible with standard sans-serif (`Aptos` / `Segoe UI` on client, `DejaVu Sans` on backend PDF serializer). |
| **Add Dot Lattice to Canvas** | **ZERO** | Canvas lattice is rendered on `.shared-map-canvas` wrapper. Export pipeline targets `.me-container` or clones nodes with transparent background option. | Verify "PNG trong suốt" (transparent export) preserves transparent background without dot grid artifacts. |
| **Change Connector Stroke Width / Opacity** | **MEDIUM** | Prior rounds hardened connector opacity. Changing connector opacity or blend modes can cause invisible lines in exported SVG/PDF. | Ensure connectors maintain 100% opacity in exported vector payloads. |

### Verification Checklist Before Merging Any Future Code Based on this Spec
1. `npm test -- src/utils/mindmapImageExport.test.js` (Must pass 25/25 tests).
2. `npm test -- src/components/mindmap/ExportStudioDialog.*` (All format gating and scope freshness tests must remain green).
3. `python -m pytest BE/tests/test_mindmap_export_*.py` (All backend PDF/PNG serializers must pass exact-node tests).
4. `playwright test e2e-fixture/mindmap-toolbar-occlusion.spec.js` (Must maintain zero pointer interception).
