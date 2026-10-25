# 08 — Independent Architecture & Usability Review (Agy)

**Reviewer**: Independent Product & Architecture Reviewer (Antigravity / Agy)
**Baseline**: `main` @ `fb0c2f4dec90b6bb8aea62e71e1aa9a63db2a1c3`
**Target Branch**: `docs/ui-ux-v4-design`
**Reviewed Artifacts**:
- Codex 1: [`03-visual-mockups/README.md`](./03-visual-mockups/README.md) (commit `647ac08`), `workspace.html`, `workspace.css`, rendered screenshots in `screenshots/`.
- Codex 2: [`04-document-library-redesign/alternative-a-canonical-learning-queue.md`](./04-document-library-redesign/alternative-a-canonical-learning-queue.md) (commit `82ea744`), [`prototype-alternative-a.html`](./04-document-library-redesign/prototype-alternative-a.html), raw measurements in `evidence/`.

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
   - Clean, lightweight HTML/CSS rendered across 1440×900, 820×1180, 390×844, and a 320px stress viewport in both light and dark themes. The dark theme (`#15233B` canvas, `#1B2C49` surface, `#ECE7DB` ink) achieves strong visual balance.
4. **Prudent Rejection of Focus Transcript as Default**:
   - Codex 1 explored "Focus Transcript" (`?layout=focus`, expanding citations inline as blockquotes) and correctly decided against making it the default. Persistent side-by-side evidence inspection is the core product promise of MemVidX; inlining citations fragments reading flow and weakens cross-verification.

---

### 2.2 Critical Challenges & Architectural Defects in Codex 1

#### Critique 1: Right Panel Architectural Floor Violation (`292px` vs `320px` Floor)
- **The Evidence**:
  - In `workspace.css` line 202, the tablet layout (`768px – 1100px`) is specified as:
    ```css
    .workspace, html[data-layout="focus"] .workspace {
      grid-template-columns: 56px minmax(360px, 1fr) 292px;
    }
    ```
  - The right column is hardcoded to **`292px`**.
- **The Defect**:
  - `ContextInspector` / `SidebarRight` has an established, load-bearing system floor of **`min: 320px`** explicitly codified in [`FE/src/hooks/panelLayout.js`](file:///E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/round0-toolbar-occlusion/FE/src/hooks/panelLayout.js#L9) (`PANELS.right: { min: 320, max: 480 }`).
  - PR #88 (commit `5eb65d3`, merged into `main` at `fb0c2f4`) previously reverted shrinking the inspector to 280px specifically because ContextInspector's internal components (`CitationCard`, `EnrichmentCard`, `knowledgeParts.jsx`) break down below 320px.
  - Squeezing the right panel down to 292px violates this contract: `evidence-frame` drops to ~236px net width, clipping provenance chips and squeezing relevance bars.
- **Remediation**:
  - The tablet right column must clamp to **`320px`** (the design system floor).
  - At 820px tablet width: `820px - 56px (rail) - 320px (evidence floor) = 444px` for the conversation column. This is still exceptionally spacious and well above the `minmax(360px, 1fr)` floor.

#### Critique 2: The Mobile Dock vs Virtual Software Keyboard Trap
- **The Evidence**:
  - In `workspace.css` lines 226 & 251:
    ```css
    .workspace { height: calc(100% - var(--header-h) - 62px); }
    .mobile-dock {
      height: 62px;
      position: fixed;
      left: 0; right: 0; bottom: 0;
      background: var(--surface);
    }
    ```
- **The Defect**:
  - On iOS Safari and Android Chrome, focusing `<textarea>` in `.composer` automatically opens the on-screen virtual keyboard (~300px height).
  - A fixed 62px bottom dock (`.mobile-dock`) either hovers above the software keyboard, crushing the visible conversation transcript down to less than 120px, or occludes the Send button entirely.
  - Adding a persistent 62px bottom navigation strip on mobile chat runs counter to modern chat UX (e.g. WhatsApp, Claude mobile), where screen real estate during active typing is paramount.
- **Remediation**:
  - Eliminate the persistent 62px bottom dock on mobile.
  - Move the document count and evidence indicators directly into the conversation header (`2 nguồn · 2 dẫn chứng`), or embed them as compact action pills inside the composer toolbar adjacent to the `+` attach button.

#### Critique 3: Design Token Alias Drift
- **The Evidence**:
  - `workspace.css` declares token variables in `:root`:
    `--canvas: #f4f8fc; --ink: #102a5d; --accent-soft: #eaf3ff; --line: #d7e2ef;`
- **The Defect**:
  - While the hex values match `01-option-b-design-principles.md`, Codex 1 invented arbitrary new variable names (`--canvas`, `--ink`, `--accent-soft`, `--line`) instead of adopting the canonical tokens (`--bg-base`, `--text-primary`, `--accent-subtle`, `--border-color`).
  - This introduces token fragmentation across `workspace.css`, `mindmap.css`, and the shared map grammar.
- **Remediation**:
  - Harmonize with the standardized design token names declared in [`05-shared-map-visual-grammar/visual-grammar-spec.md`](./05-shared-map-visual-grammar/visual-grammar-spec.md).

---

## 3. Review of Codex 2: Document Library Redesign (Commit `82ea744`)

### 3.1 Verified Strengths & Measurable Triumphs
Codex 2's Alternative A (*Canonical Learning Queue*) represents an exceptional technical achievement in data modeling, measurement rigor, and structural consolidation:

1. **Empirical Verification of Clutter Elimination**:
   - Rather than relying on Phase A estimates, Codex 2 captured a real 42-document test database and measured **1,755 visible controls on desktop** and **1,750 on mobile** (5.14 repeated cards per unique document).
   - Alternative A collapses this to **144 controls on desktop** and **138 on mobile** — an independently verified **91.8% reduction in interactive clutter**.
   - Page scroll height drops from **41,651px to 4,608px** (−88.9%), entirely eliminating the 40,000px infinite-scroll nightmare.
2. **Flawless State-Transition Contract (§6)**:
   - The contract between STEM in `/app` and UUID in `/app/study` is rigorously formalized.
   - It explicitly forbids hand-building URLs, prohibits keying rows by transient display titles, preserves `useOpenSurface()` / `duongDi()`, and protects the boundary between bulk-management UUID selections and Workspace AI source scopes.
3. **Runnable Prototype Verification**:
   - `prototype-alternative-a.html` runs cleanly in headless Chromium. Keyboard down-arrow traversal from `doc-1` to `doc-2` succeeds deterministically. Zero horizontal overflow was detected at 1440px or 390px.

---

### 3.2 Critical Challenges & Unresolved Usability Gaps in Codex 2

#### Critique 1: The "Context Menu Trap" — 100% Click Inflation for Multi-Modal Learners
- **The Finding**: In production, although 6 actions per card created visual chaos, every study modality (Summary, Mind Map, Quiz, Review, Ask AI) was accessible in **1 click** (`0.0s` discovery). In Alternative A, each document row exposes only **one** primary CTA (e.g. *"Tiếp tục quiz"*). All remaining actions are buried inside a 42×42px `...` trigger.
- **Cognitive Penalty**:
  - A user who wants to open the Mind Map for a document currently prioritized for a Quiz must:
    1. Scan to the far-right edge and click `...`.
    2. Wait for the popup menu to render.
    3. Re-scan a 6-item vertical menu.
    4. Click *"Sơ đồ tư duy"*.
  - This imposes a **2-click sequence (100% inflation)** on routine study activities. In academic workflows, students frequently switch between Mind Map and Summary in parallel; forcing one of them into a secondary dropdown creates unnecessary friction.
- **Directive for Alternative B**:
  - Alternative B must explore a **Dual-Action Cluster** or **Split Button** architecture. The top 2 most frequent study actions (e.g. Primary Resume + quick icon button for MindMap/Summary) should remain immediately clickable on hover/desktop, reserving the `...` menu for lower-frequency management tools (Rename, Delete, Details).

#### Critique 2: Semantic Disconnect Between Smart Views and Primary CTA
- **The Finding**: Alternative A introduces four mutually exclusive smart-view filter tabs: `Tất cả (42)`, `Tiếp tục học (18)`, `Cần quiz (12)`, `Cần tóm tắt (8)`.
- **The Defect**:
  - When the user selects `Cần tóm tắt (8)`, the document list filters to those 8 documents.
  - However, in `prototype-alternative-a.html`, the row's primary action button remains hardcoded to whatever `tiepTucHoc(doc)` decided globally (e.g. *"Tiếp tục quiz"* or *"Học tài liệu"*).
  - A student explicitly clicking into the **"Cần tóm tắt"** queue to batch-create summaries is greeted by rows whose primary blue action says *"Tiếp tục quiz"*.
- **Directive for Alternative B**:
  - When a task-oriented Smart View is active, the row's primary CTA must **contextually adapt to match the filter's intent** (e.g., in `Cần tóm tắt`, the primary CTA becomes *"Tạo tóm tắt"*). In the neutral `Tất cả` view, it defaults back to `tiepTucHoc(doc)`.

#### Critique 3: Roving Tabindex & Nested Interactive Elements (WAI-ARIA Violation)
- **The Finding**:
  - In `prototype-alternative-a.html`, the container `<div class="document-row" tabindex="0">` participates in roving tabindex.
  - However, it contains three native interactive children: `<input type="checkbox">`, `<a class="primary resume">`, and `<button class="more">`.
- **The Defect**:
  - Having a focusable container wrapping native links and buttons causes severe accessibility issues with screen readers (NVDA / VoiceOver). The screen reader announces the entire row content when the row gains gain focus, and then repeats the announcement when tabbing to the inner button.
- **Directive**:
  - Use the standard WAI-ARIA Grid pattern (`role="grid"`, `role="row"`, `role="gridcell"`) where navigation occurs between grid cells, OR keep the row unfocusable (`tabindex="-1"`) and apply roving tabindex strictly to the primary action button.

#### Critique 4: Aggressive Single-Line Title Truncation
- **The Finding**:
  - In `prototype-alternative-a.html`, `.doc-title strong` has `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`.
- **The Defect**:
  - On a 1440px desktop, the available inline room for the document title is only ~520px. Real Vietnamese university textbook titles truncate after ~40 characters, making it impossible to distinguish between chapters of the same course.
- **Directive**:
  - Expand title display to a calibrated **2-line responsive clamp** (`line-clamp: 2`) with explicit `title={doc.title}` tooltip fallbacks.

#### Critique 5: Mobile Context Menu Collision
- **The Finding**:
  - On mobile (390×844), clicking `.more` opens `.menu` with `position: absolute; right: 14px; top: 64px; z-index: 5;`.
- **The Defect**:
  - The floating menu hovers directly over adjacent document rows, creating touch conflicts during scrolling.
- **Directive**:
  - On viewports `< 768px`, secondary actions should render inside a standard **Bottom Sheet Drawer** (matching the app's established mobile pattern in `MainLayout.jsx`).

---

## 4. Synthesis & Cross-Agent Directives for Remaining Deliverables

| Area | Current Draft Finding | Mandatory Requirement for Next Checkpoint |
| :--- | :--- | :--- |
| **Codex 1 (Workspace)** | Right panel set to 292px on tablet | **Clamp right panel to 320px** minimum (respecting `hooks/panelLayout.js`). |
| **Codex 1 (Workspace)** | Persistent 62px bottom dock on mobile | **Relocate dock actions** into composer bar or header chips to avoid virtual keyboard collision. |
| **Codex 1 (Tokens)** | Custom variable names (`--canvas`, `--ink`) | **Normalize to canonical tokens** (`--bg-base`, `--text-primary`, `--accent-subtle`). |
| **Codex 2 (Library)** | 1 Primary CTA + hidden `...` menu | **Deliver Alternative B with Dual-Action Cluster** (1-click access for top study modalities). |
| **Codex 2 (Library)** | Static CTA in filtered Smart Views | **Contextual CTA**: Active Smart View updates primary row action to match filter intent. |
| **Codex 2 (A11y)** | Focusable row with nested interactive children | **Implement WAI-ARIA grid cell navigation** or direct button roving focus. |
