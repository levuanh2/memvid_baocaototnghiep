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

## 3. Real Export Pipeline Architecture & Technical Guardrails

> [!CAUTION]
> **CRITICAL ARCHITECTURAL GUARDRAIL**: The MindMap export pipeline (`ExportStudioDialog.jsx`, `mindmapImageExport.js`, `pdf_serializer.py`, and `image_guard.py`) has undergone extensive regression hardening. Any visual change that alters offscreen DOM layout geometry, font metrics, or connector serialization will break export fidelity.

### 3.1 Real Dependency Chain: `@zumer/snapdom` (Not `html2canvas`)

> [!NOTE]
> **Correction of Prior Design Drafts**: Earlier design drafts mistakenly referenced `html2canvas` as the client-side rasterization engine. A direct codebase audit confirms that `html2canvas` is **not installed or used anywhere** in MemVidX. The true rasterization dependency is **`@zumer/snapdom`** (`FE/src/utils/mindmapImageExport.js`, imported on line 21 as `realSnapdom`).

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        REAL END-TO-END EXPORT PIPELINE ARCHITECTURE                    │
└────────────────────────────────────────────────────────────────────────────────────────┘

 [ExportStudioDialog.jsx]
       │
       ├─ (1) Scope & Appearance Configuration
       │      • Scopes: full, current_branch, selected_branches, visible
       │      • Context: minimal, suppressedContextIds
       │      • Appearance: saved canvas appearance vs exportStyleOverride
       │
       ▼
 [mindmapImageExport.js]
       │
       ├─ (2) Offscreen Canonical Scene Mount
       │      • Constructs detached DOM container: .mm-export-offscreen
       │      • Seeds new MindElixir instance with recordToMindElixir(fullTitles: true)
       │      • Applies visual roles: markSourceVisualRoles(instance)
       │      • Applies appearance: applyLiveCanvasAppearance(resolvedStyle)
       │      • Crops container to contentBoundsRelativeTo() + EXPORT_PADDING_PX (32px)
       │      • Re-bakes connectors post-crop: instance.linkDiv()
       │      • Font Warmup: warmUpExportFonts() primes Spectral & Inter
       │
       ├─ (3) Client-Side Rasterization via @zumer/snapdom
       │      • Calls snapdom(mountEl, { backgroundColor, scale, quality, embedFonts: true })
       │      • SnapDOM deep-clones DOM, inlines computed styles via getComputedStyle()
       │      • Wraps cloned HTML tree in SVG <foreignObject>
       │      • Draws SVG data URL onto internal HTML5 <canvas>
       │      • Extracts geometryManifest (node & connector bounding boxes in bitmap px)
       │      • Converts to Blob (PNG, JPEG, WebP, SVG) or base64 (for PDF/DOCX)
       │
       ▼
 [Backend Serialization]
       │
       ├─ (4) Image Gating: image_guard.py (Clamps MAX_DIMENSION 12000px, MAX_PIXELS 40M)
       │
       ├─ (5) PDF Serializer: pdf_serializer.py (PyMuPDF / fitz)
       │      • "map" mode: embeds client-supplied PNG bytes (never server re-renders DOM)
       │      • Readability assessment: uses geometryManifest (TARGET_MIN_PT = 4.5pt)
       │      • Generates overview + detail tiles if map exceeds single-page readability
       │      • "outline" mode: renders vector text using bundled DejaVuSans.ttf
```

---

### 3.2 Seven Non-Negotiable Export Invariants

Any visual grammar or Export Studio UI enhancement must preserve these seven code-level contracts:

#### 1. Exact-Node Export V3 (`assertOffscreenMembership`)
- In `mindmapImageExport.js`, offscreen export strictly enforces that the rendered DOM node set matches `expectedIds` 1:1.
- Both tree data (`instance.nodeData`) and DOM elements (`me-tpc`) are counted and validated.
- If a node is missing, duplicate, or unexpected, export throws an immediate structural exception to prevent leaking unselected user data.

#### 2. Explicit vs AutoContext vs Suppressed Semantics
- In `ExportStudioDialog.jsx` and `mindmapExportScope.js`:
  - `includedIds`: nodes explicitly checked or in the target branch.
  - `contextIds`: ancestor nodes automatically retained for semantic tree continuity.
  - `suppressedContextIds`: ancestor nodes the learner has explicitly suppressed.
- Ancestor nodes carry `data-export-source-role="context"`. In `pdf_serializer.py`, contextual nodes render with muted gray text (`CONTEXT_TEXT_RGB = (0.55, 0.55, 0.55)`), visually distinguishing context from selected study material.

#### 3. Saved vs Export-Only Appearance Separation
- `canvasAppearance` represents the saved live styling stored on the database record.
- `exportStyleOverride` represents ephemeral user choices inside Export Studio Step 3 ("Tùy chỉnh riêng bản xuất").
- `resolveExportAppearance()` merges the two. The live canvas appearance is **never mutated** during export.
- Symmetrically, `handleApplyAppearanceToMap()` allows learners to intentionally promote their export styling back to the live map via `patchMindmapAppearance()`.

#### 4. ROOT and Promoted-Branch Styling
- When exporting a sub-branch (`selected_branches` or `current_branch`), the sub-branch root is re-parented to `null` or a synthetic anchor.
- However, `sourceProjection` preserves its true lineage role (`sourceRoles`).
- The CSS rule `.mm-export-offscreen me-root me-tpc[data-export-source-role=branch]` styles promoted sub-branch roots with their original branch colors and borders, rather than letting them morph into the primary map root style.

#### 5. Connector Geometry Re-Baking
- Mind Elixir calculates SVG connector paths (`.lines path`) based on node DOM coordinates during `linkDiv()`.
- Cropping the offscreen container to content bounds changes flex centering, causing initial SVG bezier paths to go stale.
- `mindmapImageExport.js` explicitly invokes `instance.linkDiv?.()` **after** container dimensions are finalized, ensuring connectors perfectly meet their node endpoints.

#### 6. Webfont Embedding via SnapDOM
- SVG `<foreignObject>` context in browsers is sandboxed: it cannot fetch external webfonts over the network during canvas rasterization.
- `warmUpExportFonts()` preloads `Spectral` and `Inter` via `document.fonts.load()`.
- `@zumer/snapdom` with `embedFonts: true` converts font rules into base64 data URIs inside the SVG `<style>`, guaranteeing that exported images never fall back to system fonts.

#### 7. Backend PDF Contracts (`pdf_serializer.py`)
- Backend PDF export relies entirely on PyMuPDF (`fitz`).
- In "map" mode, PyMuPDF embeds the client-captured PNG bitmap directly.
- In "outline" mode, PyMuPDF renders vector text using **bundled repository fonts** (`BE/assets/fonts/DejaVuSans.ttf` and `DejaVuSerif.ttf`). Built-in base-14 fonts are forbidden because they mangle Vietnamese diacritics.

---

### 3.3 SnapDOM Engine Capabilities vs Limitations

Understanding SnapDOM's true rendering model dictates which styles may be applied in the export pipeline:

| Feature / Behavior | `@zumer/snapdom` Real Support | Underlying Architectural Reason |
| :--- | :--- | :--- |
| **`color-mix()`** | **SUPPORTED** | SnapDOM calls `window.getComputedStyle()`. Modern browsers (Chromium/WebKit/Firefox) evaluate `color-mix()` into standard `rgb()`/`rgba()` values prior to DOM cloning. |
| **`box-shadow`** | **SUPPORTED (Mapped)** | SnapDOM's internal parser (`qi()`) automatically converts CSS `box-shadow` declarations into SVG `drop-shadow()` filters. |
| **CSS `line-clamp` & Flexbox** | **SUPPORTED** | Rendered natively by the browser engine inside SVG `<foreignObject>`. |
| **Webfont Embedding** | **SUPPORTED** | Automatically converts `@font-face` src URLs to base64 `data:` URIs when `embedFonts: true` is passed. |
| **Detached CSS Variables** | **RESTRICTED** | CSS custom properties declared on `:root` outside the captured container are not inherited if the clone is detached. Appearance styling must inject resolved static values. |
| **Canvas Dimension Ceiling** | **HARD LIMIT** | HTML5 Canvas has a hard browser ceiling (16,384px per side). Guarded by `MAX_CAPTURE_DIMENSION_PX = 12000` and `MAX_CAPTURE_PIXELS = 40_000_000`. |
| **External Network Assets** | **PROHIBITED** | Browser security prevents SVGs inside `<img>` or `<canvas>` from issuing network requests. All assets must be inlined. |
| **Nested `<foreignObject>`** | **PROHIBITED** | Prohibited by SVG specification; browsers skip nested `<foreignObject>` tags entirely. |

---

### 3.4 Style Reuse Matrix: Preview UI (`surfaces.html`) vs Real Export Path

```
┌────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────┐
│        SAFE TO REUSE IN REAL EXPORT PATH               │        MUST REMAIN PRESENTATION-ONLY IN PREVIEW        │
├────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────┤
│ • Resolved hex color tokens (#126CF2, #15171C, etc.)   │ • Unresolved CSS variable cascades (var(--bg-base))    │
│ • Discrete border-radius values (8px, 12px)            │ • Complex canvas textures (radial-gradient dot lattice)│
│ • Explicit stroke widths (1.5px, 2.0px, 2.5px)         │ • Viewport transforms (pan/zoom scale & translate)     │
│ • Bundled webfonts (Inter, Spectral, DejaVuSans)       │ • Paper drop-shadow overlays (0 12px 32px rgba(...))   │
│ • Node padding and margin geometry                     │ • Interactive UI controls (zoom buttons, progress bars)│
└────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────┘
```

1. **Safe for Real Export**:
   - Resolved hex colors (`#126CF2`, `#E67E22`, `#10B981`, `#8B5CF6`).
   - Node radii (`8px` section, `12px` root, `6px` concept).
   - Connector stroke widths (`2.0px` trunk, `1.5px` branch).
   - Typography families: `Inter` / `Spectral` on client, `DejaVu Sans` on backend PDF.
2. **Presentation-Only in Preview (`surfaces.html`)**:
   - `radial-gradient(var(--dot) .8px, transparent .8px)` dot lattice texture: Export requires clean solid (`#ffffff`, `#15171C`) or transparent background (`backgroundColor: "transparent"`).
   - Dynamic viewport pan/zoom transforms: Export container must be strictly reset to `translate3d(0, 0, 0) scale(1)`.
   - Paper preview container decorations (zoom indicator `78%`, preview captions, step headers).

---

### 3.5 Automated Verification Checklist Before Merging Code

1. `npm test -- src/utils/mindmapImageExport.test.js` (Must pass all tests, verifying `snapdom` call parameters, font warmup, and geometry manifest extraction).
2. `npm test -- src/components/mindmap/ExportStudioDialog.*` (Format gating, scope freshness, and appearance overrides must pass).
3. `python -m pytest BE/tests/test_mindmap_export_*.py` (Verifies PyMuPDF `fitz` image embedding and DejaVu font rendering).
4. `playwright test e2e-fixture/mindmap-toolbar-occlusion.spec.js` (Verifies 320px floor and zero pointer interception).
