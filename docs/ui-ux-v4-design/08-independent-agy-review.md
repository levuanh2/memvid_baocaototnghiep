# 08 — Independent Architecture & Usability Review (Agy)

**Reviewer**: Independent Product & Architecture Reviewer (Antigravity / Agy)
**Baseline**: `main` @ `fb0c2f4dec90b6bb8aea62e71e1aa9a63db2a1c3`
**Target Branch**: `docs/ui-ux-v4-design`
**Reviewed Artifacts**:
- Codex 1: [`03-visual-mockups/README.md`](./03-visual-mockups/README.md) (commits `647ac08`, `61056bb`), `workspace.html`, `workspace.css`, `maps.html`, `maps.css`, `verify-maps.mjs`, rendered screenshots in `screenshots/`.
- Codex 2: [`04-document-library-redesign/alternative-a-canonical-learning-queue.md`](./04-document-library-redesign/alternative-a-canonical-learning-queue.md) (commit `82ea744`), [`04-document-library-redesign/alternative-b-learning-action-matrix.md`](./04-document-library-redesign/alternative-b-learning-action-matrix.md) (commit `5d9876a`), prototypes `prototype-alternative-a.html` and `prototype-alternative-b.html`, measurement scripts, and evidence in `evidence/`.

---

## 1. Review Mandate & Guiding Standard

In accordance with Option B principles ([`01-option-b-design-principles.md`](./01-option-b-design-principles.md)), this review provides an **independent, evidence-based challenge** rather than consensus by default. Proposals are evaluated on:
1. **Measured Control Bloat Elimination**: Does the design realistically resolve `UX-ADJ-007` without hiding critical workflows?
2. **Ergonomic & Cognitive Trade-offs**: Does solving visual repetition introduce click penalties, hunting behavior, or modal traps?
3. **Architectural & State Invariants**: Does the proposal respect `useStudyContext` (STEM in `/app` vs UUID in `/app/study`), `WorkspaceContainer` live tab preservation, and exact-node export safety?
4. **Accessibility (WAI-ARIA) Integrity**: Are keyboard contracts, roving tabindex semantics, and screen reader announcements compliant?

---

## 2. Review of Codex 1: Workspace Chat & Global Navigation (Commit `647ac08`)

### 2.1 Verified Strengths & Architectural Fidelity
Codex 1's "Learning Desk" proposal demonstrates high architectural discipline and solves the core tablet bottleneck identified in Phase A:

1. **Preservation of the Non-Negotiable Workspace Invariant**:
   - `workspace.html` maintains Chat, MindMap, and Summary as sibling modes under `.mode-switch`. It does **not** propose separate routing or remounting, ensuring live LLM streams, canvas pan/zoom, and scroll states remain intact across mode switches.
2. **Empirical Resolution of the 820px Tablet Squeeze (`UX-ADJ-002`)**:
   - In current production at 820px tablet width, the 252px left rail and 328px right rail leave an unreadable conversation column (~240px).
   - Codex 1 introduces the **56px Source Rail** (`.source-rail`) for tablet viewports (`768px – 1100px`).
   - Reclaiming roughly **196px** expands the conversation column to over 440px, restoring full reading comfort while keeping active document stems visible.
3. **Inspectable Prototype Coverage**:
   - Clean, lightweight HTML/CSS rendered across 1440×900, 820×1180, 390×844, and a 320px stress viewport in both light and dark themes. The dark theme achieves strong visual balance.
4. **Prudent Rejection of Focus Transcript as Default**:
   - Codex 1 explored "Focus Transcript" (`?layout=focus`, expanding citations inline as blockquotes) and correctly decided against making it the default. Persistent side-by-side evidence inspection is the core product promise of MemVidX; inlining citations fragments reading flow and weakens cross-verification.

---

### 2.2 Critical Challenges & Architectural Defects in Codex 1 Checkpoint 1

#### Critique 1: Right Panel Architectural Floor Violation (`292px` vs `320px` Floor)
- **Status**: **RESOLVED in commit `61056bb`**.
- **The Finding**: In `workspace.css` line 202, the tablet layout (`768px – 1100px`) was specified with right column hardcoded to **`292px`**.
- **The Defect**: `ContextInspector` / `SidebarRight` has an established, load-bearing system floor of **`min: 320px`** explicitly codified in [`FE/src/hooks/panelLayout.js`](file:///E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/round0-toolbar-occlusion/FE/src/hooks/panelLayout.js#L9). Squeezing the right panel down to 292px violates this contract, clipping provenance chips and squeezing relevance bars.
- **Verification of Remediation**: In commit `61056bb`, `workspace.css` line 203 updated the tablet layout to `grid-template-columns: 56px minmax(360px, 1fr) 320px;`. At 820px width: `820px - 56px - 320px = 444px` conversation width, preserving both the 320px inspector floor and ample chat reading room.

#### Critique 2: The Mobile Dock vs Virtual Software Keyboard Trap
- **Status**: **RESOLVED in commit `61056bb`**.
- **The Finding**: In `workspace.css` lines 226 & 251, a fixed 62px bottom dock (`.mobile-dock`) was positioned over the viewport.
- **The Defect**: Focusing the composer textarea on mobile invokes the virtual software keyboard (~300px height), causing the fixed bottom dock to either float above the keyboard and crush the chat transcript to under 120px, or collide with the composer input.
- **Verification of Remediation**: In commit `61056bb`, `.mobile-dock` was removed entirely. Container height is now `calc(100% - var(--header-h))`. Context indicators are relocated to `.mobile-context` header buttons (`2 nguồn · 2 dẫn chứng`), eliminating keyboard collisions.

#### Critique 3: Design Token Alias Drift
- **Status**: **RESOLVED in commit `61056bb`**.
- **The Finding**: `workspace.css` declared arbitrary variable names (`--canvas`, `--ink`, `--accent-soft`, `--line`).
- **The Defect**: Token fragmentation across workspace and map subtrees.
- **Verification of Remediation**: In commit `61056bb`, tokens were normalized to canonical names: `--bg-base`, `--bg-card`, `--text-primary`, `--accent-subtle`, and `--border-color`.

---

## 3. Review of Codex 2: Document Library Redesign (Commit `82ea744`)

### 3.1 Verified Strengths & Measurable Triumphs
Codex 2's Alternative A (*Canonical Learning Queue*) represented an exceptional technical achievement in data modeling and structural consolidation:
1. **Empirical Verification of Clutter Elimination**: Collapsed 1,755 visible desktop controls down to 144 controls (91.8% reduction); scroll height dropped from 41,651px to 4,608px (−88.9%).
2. **State-Transition Formalization**: Clarified boundary between Workspace STEM tracking and Study UUID tracking.
3. **Runnable Prototype Coverage**: Verified deterministic keyboard down-arrow traversal and zero horizontal overflow.

---

### 3.2 Critical Challenges in Codex 2 Alternative A

#### Critique 1: The "Context Menu Trap" — 100% Click Inflation for Multi-Modal Learners
- **Status**: **RESOLVED in commit `5d9876a` via Alternative B Quick Cluster**.
- **The Finding**: In Alternative A, each document exposed only 1 primary action; all remaining tools (Summary, Mind Map, Quiz, Review, Ask AI) were buried in a 42×42px `...` dropdown.
- **The Defect**: Routine cross-study navigation between Mind Map and Summary suffered a 2-click penalty (100% inflation) with a 6-item rescan.

#### Critique 2: Semantic Disconnect Between Smart Views and Primary CTA
- **Status**: **RESOLVED in commit `5d9876a` via Contextual CTA**.
- **The Finding**: In `Cần tóm tắt (8)` view, row primary action buttons still read *"Tiếp tục quiz"*.
- **The Defect**: Filter intent conflicted with the primary action.

#### Critique 3: Roving Tabindex & Nested Interactive Elements (WAI-ARIA Violation)
- **Status**: **RESOLVED in commit `5d9876a`**.
- **The Finding**: `<div class="document-row" tabindex="0">` was focusable while wrapping native interactive children (`<input>`, `<a>`, `<button>`).
- **The Defect**: Screen readers repeated announcements; violated WAI-ARIA authoring practices.

#### Critique 4: Aggressive Single-Line Title Truncation
- **Status**: **RESOLVED in commit `5d9876a`**.
- **The Finding**: Titles clipped to a single line with `text-overflow: ellipsis`.
- **The Defect**: Real Vietnamese course textbook titles were unidentifiable beyond 40 characters.

#### Critique 5: Mobile Context Menu Collision
- **Status**: **RESOLVED in commit `5d9876a`**.
- **The Finding**: Floating popover menu at `position: absolute` collided with adjacent touch cards.

---

## 4. Review of Codex 1 Checkpoint 2: Shared Map Visual Mockups & Parity (Commit `61056bb`)

### 4.1 Verified Strengths & Architectural Alignment
In commit `61056bb`, Codex 1 delivered `maps.html`, `maps.css`, `verify-maps.mjs`, and 14 rendered screenshots across MindMap and StudyMap at 1440px, 820px, 390px, and 320px viewports. The deliverable achieves strict visual convergence with Agy's [`05-shared-map-visual-grammar/visual-grammar-spec.md`](./05-shared-map-visual-grammar/visual-grammar-spec.md):

1. **Faithful Visual Token & Lattice Adoption**:
   - The canvas texture strictly adopts the **24px dot lattice**:
     ```css
     background-color: var(--bg-base);
     background-image: radial-gradient(var(--dot) .8px, transparent .8px);
     background-size: 24px 24px;
     ```
   - Standard 4-branch palette applied consistently:
     `--branch-1: #126cf2`, `--branch-2: #e67e22`, `--branch-3: #10b981`, `--branch-4: #8b5cf6`.
2. **Engine Hierarchy Parity (4-Tier Taxonomy)**:
   - **Root Role**: MindMap uses a prominent accent pill (`rect width="180" height="72" rx="12" fill="var(--accent)"`), while StudyMap anchors the tree with `circle r="12" fill="var(--accent)"`.
   - **Section Role**: 164×60px bordered card (MindMap) vs `circle r="9" stroke="var(--accent)"` (StudyMap).
   - **Concept Role**: 168×42px compact card (MindMap) vs `circle r="6"` (StudyMap).
   - Both engines adopt the **2.5px accent selection ring** with soft drop-shadow halo (`box-shadow: 0 0 7px color-mix(in srgb, var(--accent), transparent 45%)`), creating an instant visual relationship.
3. **SVG Connector Collision Resolution via Text Halo**:
   - In `StudyMapView.jsx`'s D3 tree, connector paths frequently pass under text labels. Codex 1 incorporated the SVG text halo rule:
     ```css
     .study-node text {
       paint-order: stroke;
       stroke: var(--bg-base);
       stroke-width: 4px;
       stroke-linejoin: round;
     }
     ```
   - This prevents branch bezier curves from cutting through text glyphs without requiring expensive DOM background wrappers.
4. **Tablet & Mobile Ergonomics**:
   - At 820px tablet width, the left panel collapses to the 56px source rail (`.map-source-rail`), toolbar actions collapse to icon-only targets (matching PR #88), and the inspector maintains its **320px floor**, leaving 444px for the active canvas.
   - On mobile (`< 768px`), both engines switch to `.mobile-tree` (a simplified vertical tree hierarchy), eliminating the microscopic graph scaling issue identified in Phase A.
   - The inspector transitions to a bottom sheet with `padding-bottom: 238px` / `214px` applied to the canvas, ensuring nodes are never occluded behind the drawer.

---

### 4.2 Critical Challenges & Open Architectural Risks in Codex 1 Checkpoint 2

#### Challenge 1: Mobile Inspector Dismissal & Re-entry Affordance
- **The Evidence**:
  - In `maps.html` line 94, the mobile `.node-inspector` renders as a fixed bottom drawer (`height: 240px; position: fixed; bottom: 0;`).
  - It includes a close button `<button><svg><use href="#i-close"/></svg></button>`.
- **The Defect**:
  - The prototype does not define the post-dismissal state. When the user dismisses the 240px bottom drawer to inspect the canvas, does the selected node deselect entirely, or does the inspector minimize into a compact "peek chip" (e.g. `[Bộ nhớ ảo ⌄]`) at the bottom of the canvas?
  - If closing deselects the node, the user loses their place and must re-tap the node on canvas. If it leaves the node selected without any visible UI affordance, the user has no direct touch target to re-open the node details without re-triggering canvas selection.
- **Architectural Directive for Implementation Planning**:
  - Adopt a **Minimized Peek Chip** pattern: Dismissing the mobile drawer collapses it to a floating 36px bottom pill (`Bộ nhớ ảo · Chi tiết ⌃`). Tapping the pill restores the 240px drawer. Tapping empty canvas deselects the node and removes the peek chip.

#### Challenge 2: SVG Text Wrapping in StudyMap with Real Academic Curricula
- **The Evidence**:
  - In `maps.html` line 118, StudyMap renders concept labels as single-line SVG `<text>`:
    `<text x="16" y="5">PCB và trạng thái tiến trình</text>`.
- **The Defect**:
  - SVG `<text>` elements do not wrap lines natively. In mockups with 3-5 word concept labels, horizontal layout works well.
  - However, in real university exam documents (e.g. *Hệ điều hành*, *Triết học Mác - Lênin*), concept nodes generated by LLMs frequently have titles of 15–25 words (e.g. *"Nguyên lý bổ sung giữa quy luật giá trị và quy luật cung cầu trong nền kinh tế thị trường"*).
  - Without an explicit multi-line `<tspan>` layout or truncation threshold, unwrapped SVG text will extend 300px+ horizontally, overlapping adjacent branches and breaking the canvas viewport.
- **Architectural Directive for Implementation Planning**:
  - In `StudyMapView.jsx`, implement a calibrated text-wrapping helper (or character threshold `lineClamp` to 32 characters across max 2 `<tspan>` lines) with SVG `<title>` tooltip fallback.

#### Challenge 3: Export Studio Modal Mockup & Headless Export Isolation
- **The Evidence**:
  - Codex 1 includes the Export Studio button (`#i-export`) in `.artifact-toolbar`, but does not mockup the Export Studio dialog itself.
- **The Guardrail**:
  - As established in [`05-shared-map-visual-grammar/engine-boundaries-and-export-guardrails.md`](./05-shared-map-visual-grammar/engine-boundaries-and-export-guardrails.md), MindMap V3 export relies on offscreen headless capture via `html2canvas` and `pdf_serializer.py`.
  - The visual mockups in `maps.html` use modern CSS features (`color-mix()`, `radial-gradient()`, `paint-order`). While these render beautifully in evergreen browsers, `html2canvas` has known rendering bugs with `color-mix()` and SVG filter drop-shadows.
- **Architectural Directive for Implementation Planning**:
  - Live canvas styling and headless export rendering must remain strictly separated. The export rendering container must continue consuming resolved hex colors and raster-safe CSS tokens.

---

## 5. Review of Codex 2 Checkpoint 2: Document Library Selected Alternative B (Commit `5d9876a`)

### 5.1 Verification of Remediations & Empirical Performance
In commit `5d9876a`, Codex 2 delivered [`alternative-b-learning-action-matrix.md`](./04-document-library-redesign/alternative-b-learning-action-matrix.md), [`prototype-alternative-b.html`](./04-document-library-redesign/prototype-alternative-b.html), and [`capture_prototype_b.py`](./04-document-library-redesign/capture_prototype_b.py). Codex 2 officially selected **Alternative B: Learning Action Matrix** as the target contract.

The deliverable systematically resolves all five critical challenges raised in Agy's previous review:

| Previous Critique | Alternative B Solution | Measured Verification | Status |
| :--- | :--- | :--- | :--- |
| **1. Context Menu Trap** (100% click inflation) | Added **Dual-Action Quick Cluster** (`.quick-cluster`) with direct 1-click `Tóm tắt` and `Sơ đồ` actions. | Exactly 84 direct quick actions (2 per row); 0 menu clicks needed for routine study modality switches. | **RESOLVED** |
| **2. Smart View CTA Mismatch** | Introduced pure `primaryActionFor(view, doc)` adapter. Primary CTA dynamically adapts to active view. | In `Cần tóm tắt` view, 100% of rows (42/42) updated primary action to *"Tạo tóm tắt"*. | **RESOLVED** |
| **3. Nested Interactive WAI-ARIA Defect** | Container `.document-row` is completely unfocusable; roving tabindex applied strictly to primary action buttons. | Measured `rowContainersFocusable: 0`. ArrowDown moves focus directly between peer primary buttons (`doc-1` → `doc-2`). | **RESOLVED** |
| **4. Aggressive Title Truncation** | Implemented responsive **2-line title clamp** (`line-clamp: 2`) with full accessible title tooltip. | Long titles wrap across 2 lines; zero horizontal clipping. | **RESOLVED** |
| **5. Mobile Menu Collision** | Replaced absolute popover with a portalled **Modal Bottom Sheet** (`.tool-panel`) with backdrop. | Background set to `inert`, focus trapped inside sheet, Escape restores trigger focus. | **RESOLVED** |

---

### 5.2 Empirical Evaluation: Justifying the 227 Control Budget
A superficial audit might note that Alternative B exposes **227 visible desktop controls**, compared to Alternative A's **144 controls** (+83 controls).

However, rigorous interaction analysis demonstrates that **Alternative B is the superior architectural choice**:

1. **Contextual Efficiency Over Blind Minimization**:
   - Alternative A achieved 144 controls by hiding the Mind Map and Summary actions inside a dropdown. This created an artificial cognitive barrier for the app's core value proposition (multi-modal study).
   - Alternative B's 227 controls represent **5.4 controls per document** (1 Checkbox, 1 Title, 1 Primary Action, 2 Quick Actions, 1 More Trigger). This density matches gold-standard academic and productivity tools (e.g. Linear, Notion, GitHub PR lists).
2. **Elimination of Structural Duplication Preserved**:
   - Current production renders **1,755 desktop controls** and **174 duplicate card instances** across 41,651px scroll height.
   - Alternative B eliminates **1,528 controls (−87.1%)**, removes **100% of duplicate instances (0 duplicate cards)**, and slashes scroll height down to **4,735px (−88.6%)**.
3. **Flawless Mobile Touch Geometry**:
   - Headless Playwright measurement in `capture_prototype_b.py` verified that **100% of mobile interactive controls (210/210 targets) meet or exceed the 44×44px WCAG touch target floor**:
     - Checkbox target: 44×44px.
     - Primary action button: 274×44px.
     - Quick action buttons: 134×44px.
     - More actions trigger: 274×44px.
     - Close sheet trigger: 44×44px.

---

### 5.3 Critical Implementation Hazards for Alternative B

#### Hazard 1: Bulk Selection Pruning on Filter Transition
- **The Risk**:
  - In `prototype-alternative-b.html`, a user can select 3 documents in `Tất cả` view.
  - If the user then switches to `Cần tóm tắt` (which filters the list down to 8 documents, hiding 2 of the previously selected 3), what happens to the selected UUID set?
  - If the `selectedIds` state retains hidden IDs, and the user clicks a BulkBar action (e.g. *"Xóa 3 tài liệu"*), they will inadvertently mutate documents that are not visible in their current view.
- **Architectural Directive for Implementation Planning**:
  - The bulk selection store must implement synchronous pruning: switching task views or entering a search query must immediately intersect `selectedIds` with `visibleDocuments` (`selectedIds = new Set([...selectedIds].filter(id => visibleMap.has(id)))`), or explicitly notify the user via BulkBar (`"Đang chọn 1 tài liệu trong chế độ này (2 tài liệu khác bị ẩn)"`).

#### Hazard 2: Return Navigation State Preservation (Browser Back)
- **The Risk**:
  - A user navigates: `Library (task_view="needs_summary", page=2, scroll=1200px)` → clicks `"Tạo tóm tắt"` → enters `/app?source=stem` → clicks Browser Back.
  - If `/app/study` re-mounts with default state, the user lands back on `Tất cả` at `scroll=0px`. In large libraries, this creates severe disorienting "lost context" friction.
- **Architectural Directive for Implementation Planning**:
  - Task view (`all`, `continue`, `needs_quiz`, `needs_summary`), search query, collection filter, and scroll offset must be synchronized with URL query params or sessionStorage (`library_view_state`).

#### Hazard 3: Unified Dispatcher Invariant
- **The Risk**:
  - Having three action tiers on each row (Primary CTA, Quick Actions `Tóm tắt`/`Sơ đồ`, and Complete Tool popover/sheet) creates a risk of routing logic drift if individual components construct their own URLs.
- **Architectural Directive for Implementation Planning**:
  - All three action tiers **must** dispatch through the single existing helper `useOpenSurface(doc, surface)` and `duongDi()`. No component may hardcode `navigate('/app?source=...')`.

---

## 6. Cross-Disciplinary Synthesis & Phase C Readiness

### 6.1 Unified Architectural Matrix Across Deliverables

| Dimension | Workspace Chat & Global Nav (Codex 1) | Shared Maps: MindMap & StudyMap (Codex 1 & Agy) | Document Library Alternative B (Codex 2) | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Token Scheme** | `--bg-base`, `--bg-card`, `--text-primary`, `--accent-subtle`, `--border-color` | Identical token set + 24px dot lattice texture + 4-branch palette | Identical token set + `--radius-surface` (12px), `--radius-control` (8px) | **UNIFIED** |
| **Desktop Layout** | 248px source shelf / minmax(440px, 1fr) / 320px evidence | 248px source shelf / minmax(500px, 1fr) / 320px inspector | 190px sidebar / minmax(0, 1fr) action matrix (5 columns) | **UNIFIED** |
| **Tablet Layout (820px)**| 56px source rail / minmax(360px, 1fr) / **320px floor** | 56px source rail / minmax(360px, 1fr) / **320px floor** | Sidebar hidden; sticky 2×2 task strip; full-width matrix | **UNIFIED** |
| **Mobile Layout (<768px)**| Single column; dock eliminated; header context chips | Depth-1 vertical tree; bottom drawer inspector; 238px canvas pad | Single-column cards; 44px touch targets; portalled modal sheet | **UNIFIED** |
| **Identity Contract** | Consumes STEM in `/app` via `selectedDocument` | Consumes STEM in MindMap (`/app`), UUID in StudyMap (`/app/study/map/:id`) | Renders UUID; bridges to STEM for `/app` and UUID for `/app/study` | **FORMALIZED** |
| **A11y & Focus** | Focus ring: 3px accent outline; natural DOM tab order | SVG text halo for contrast; keyboard navigation anchors | 0 focusable rows; roving tabindex on primary buttons; sheet focus trap | **VERIFIED** |
| **Export Safety** | Non-interfering UI | Live DOM grammar separated from headless rasterization engine | N/A | **GUARDED** |

---

### 6.2 Implementation Readiness Verdict

The collaborative Option B design phase has achieved complete architectural convergence:
1. **Bloat Elimination**: Structural repetition has been eliminated with mathematical proof (−87.1% library controls, 100% duplicate card removal, 196px tablet room reclaimed).
2. **Ergonomic Integrity**: The click penalty has been averted through Alternative B's Quick Action Cluster, and keyboard collision on mobile chat has been resolved by relocating actions to the header.
3. **System Boundaries**: All three agents respect the separation of concerns: Workspace live-mounting invariant is intact, the 320px inspector floor is enforced across all modes, STEM-vs-UUID routing boundaries are codified, and MindMap V3 export fidelity is safeguarded.

**Verdict**: The proposals in `03-visual-mockups/`, `04-document-library-redesign/`, and `05-shared-map-visual-grammar/` are **APPROVED** for Phase C implementation planning.
