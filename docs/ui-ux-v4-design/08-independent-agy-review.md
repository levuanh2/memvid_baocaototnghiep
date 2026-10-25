# 08 — Independent Architecture & Usability Review (Agy)

**Reviewer**: Independent Product & Architecture Reviewer (Antigravity / Agy)
**Baseline**: `main` @ `fb0c2f4dec90b6bb8aea62e71e1aa9a63db2a1c3`
**Target Branch**: `docs/ui-ux-v4-design`
**Reviewed Artifacts**:
- Codex 2: [`04-document-library-redesign/alternative-a-canonical-learning-queue.md`](./04-document-library-redesign/alternative-a-canonical-learning-queue.md) (commit `82ea744`), [`prototype-alternative-a.html`](./04-document-library-redesign/prototype-alternative-a.html), raw measurements in `evidence/`.
- Codex 1: [`03-visual-mockups/README.md`](./03-visual-mockups/README.md), `workspace.html`, `workspace.css`.

---

## 1. Review Mandate & Guiding Standard

In accordance with Option B principles ([`01-option-b-design-principles.md`](./01-option-b-design-principles.md)), this review provides an **independent, evidence-based challenge** rather than consensus by default. Proposals are evaluated on:
1. **Measured Control Bloat Elimination**: Does the design realistically resolve `UX-ADJ-007` without hiding critical workflows?
2. **Ergonomic & Cognitive Trade-offs**: Does solving visual repetition introduce click penalties, hunting behavior, or modal traps?
3. **Architectural & State Invariants**: Does the proposal respect `useStudyContext` (STEM in `/app` vs UUID in `/app/study`), `WorkspaceContainer` live tab preservation, and exact-node export safety?
4. **Accessibility (WAI-ARIA) Integrity**: Are keyboard contracts, roving tabindex semantics, and screen reader announcements compliant?

---

## 2. Review of Codex 2: Document Library Redesign (Alternative A)

### 2.1 Verified Strengths & Measurable Triumphs
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

### 2.2 Critical Challenges & Unresolved Usability Gaps

Despite the strong foundation, our independent analysis identified five concrete usability and interaction defects in Alternative A that require remediation:

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
  - Having a focusable container wrapping native links and buttons causes severe accessibility issues with screen readers (NVDA / VoiceOver). The screen reader announces the entire row content when the row gains focus, and then repeats the announcement when tabbing to the inner button.
  - Furthermore, pressing `Enter` on the row triggers the resume action, but if focus is on the checkbox, `Space` must toggle the checkbox without triggering row activation.
- **Directive**:
  - Use the standard WAI-ARIA Grid pattern (`role="grid"`, `role="row"`, `role="gridcell"`) where navigation occurs between grid cells, OR keep the row unfocusable (`tabindex="-1"`) and apply roving tabindex strictly to the primary action button.

#### Critique 4: Aggressive Single-Line Title Truncation
- **The Finding**:
  - In `prototype-alternative-a.html`, `.doc-title strong` has `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`.
- **The Defect**:
  - On a 1440px desktop (with 210px sidebar, padding, 158px resume button, and 42px menu button), the available inline room for the document title is only ~520px.
  - Real Vietnamese university textbook titles (e.g., *"Giáo trình Triết học Mác - Lênin (Dành cho bậc đại học hệ không chuyên lý luận chính trị) - Tái bản 2024.pdf"*) truncate after ~40 characters.
  - Students cannot distinguish between Chapter 1, Chapter 2, and Chapter 3 of the same subject.
- **Directive**:
  - Expand title display to a calibrated 2-line clamp (`line-clamp: 2; max-height: 2.8em;`) and ensure `title={doc.title}` is present on the anchor for immediate native tooltip discovery.

#### Critique 5: Mobile Context Menu Collision
- **The Finding**:
  - On mobile (390×844), clicking `.more` opens `.menu` with `position: absolute; right: 14px; top: 64px; z-index: 5;`.
- **The Defect**:
  - The menu hovers directly over the next document row's title and actions.
  - If a user attempts to scroll while the menu is open, touch events can unintentionally register on either the menu buttons or the underlying row.
- **Directive**:
  - On viewports `< 768px`, secondary actions should render inside a standard **Bottom Sheet Drawer** (matching the app's established mobile pattern in `MainLayout.jsx`), rather than a floating absolute desktop popover.

---

## 3. Review of Codex 1: Workspace Chat & Global Navigation (Batch 1)

### 3.1 Verified Strengths
1. **Preservation of Live Workspace Invariant**:
   - Codex 1's "Learning Desk" layout strictly adheres to the Option B constraint: Chat, MindMap, and Summary remain simultaneously mounted in `WorkspaceContainer`, preserving active LLM streams and canvas coordinates.
2. **Resolution of 820px Tablet Squeeze**:
   - The proposed compression of the left source shelf to a 56px icon rail at tablet width reclaims ~196px for the central conversation column, preventing the unreadable 250px chat bottleneck identified in Phase A.

### 3.2 Usability Challenge: Thumb-Dock Reachability vs Mobile Keyboard
- **The Finding**: On mobile (390×844), Codex 1 places a fixed dock at the screen bottom (`[sources | ask | evidence]`).
- **The Defect**:
  - On iOS Safari and Android Chrome, focusing the text composer brings up the virtual software keyboard (`interactive-widget=resizes-content`).
  - A fixed bottom dock will either be pushed above the keyboard (eating 50px of visible transcript space) or occlude the input field.
- **Directive**:
  - The mobile dock must be integrated directly into the composer input wrapper (as toolbar icons above the keyboard) rather than a detached viewport-fixed bottom dock.

---

## 4. Synthesis & Requirements for Alternative B

Codex 2 must incorporate the following evidence-based requirements into the upcoming **Alternative B** draft:

| Dimension | Alternative A (Baseline) | Required in Alternative B |
| :--- | :--- | :--- |
| **Action Density** | 1 Primary Button + `...` Menu (2 clicks for secondary tools) | **Split Action / Dual Cluster**: Primary action + visible 1-click icon buttons for top modalities (MindMap / Summary). |
| **Smart View Context**| Static CTA regardless of active filter | **Context-Aware CTA**: Primary action dynamically mirrors the active smart-view intent (e.g. `Cần tóm tắt` -> *"Tạo tóm tắt"*). |
| **Title Typography** | 1-line truncation (`nowrap`) | **2-line responsive clamp** with full title tooltip. |
| **Mobile Secondary Menu**| Absolute desktop-style popover | **Mobile Bottom Sheet** matching existing mobile UI primitives. |
| **Accessibility Contract**| Focusable row container with nested interactive elements | **WAI-ARIA roving tabindex on buttons**, clean keyboard escape handling. |
