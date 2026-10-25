# 08 — Independent Product & Architecture Review (Agy)

**Reviewer**: Independent Product and Architecture Reviewer (Antigravity / Agy)  
**Baseline**: `main` @ `4f228ef9d1e34f8bac59f37a3792fc859400cb64`  
**Worktree**: `E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\ui-ux-audit-v4`  
**Branch**: `docs/ui-ux-audit-v4`  
**Live Environment Tested**: FE `http://localhost:5180` (Vite / React 18), BE `http://127.0.0.1:8090` (Flask E2E server, offline deterministic mock AI, test Postgres)  
**Verification Method**: Independent code auditing across `FE/src`, Playwright headless Chromium live browser automation (viewport 1440x900, 390x844, 375x667), DOM bounding box measurement, element-from-point pointer interception calculation, live disposable account registration, and CSS computed value verification.  
**Auditor Isolation Guarantee**: Conducted strictly independently prior to reading parallel audit deliverables (`03-visual-design-audit.md`, `04-usability-flow-audit.md`, `05-duplication-matrix.md`, `06-accessibility-responsive-audit.md`, `07-design-system-inventory.md`).

---

## Independent findings (pre-adjudication)

### 1. Executive Summary & Core Verdict

The core product mission of **StudyMap / MemVidX** is to serve as an **AI-powered learning workspace**: users upload sources, converse with AI with verifiable citations, synthesize visual mind-maps, and practice/master material through quizzes and reviews.

Our independent audit reveals that while individual engineering accomplishments in the app are extraordinarily high-caliber (e.g., accessible keyboard splitters, zero Framer Motion bloat, hand-crafted dark mode, and rigorous headless export pipelines), the **systemic product experience suffers from severe fragmentation**:
1. **The Navigation Black Hole**: The app is bifurcated into two disconnected route trees (`/app` vs `/app/study/*`). Due to a code-vs-comment discrepancy, there is **zero visible navigation link** from the main AI workspace (`/app`) into the Study system (`/app/study/*`).
2. **Physical UI Occlusion**: When a node is selected in the MindMap, the floating `mindmap-tools-overlay` (Knowledge Inspector) physically overlaps and intercepts pointer events on the MindMap toolbar's **Export**, **Appearance**, and **Overflow** buttons.
3. **The Dual-Engine Map Schism**: The product ships **two completely separate graph visualization engines** (`mind-elixir` in `/app` vs `react-d3-tree` in `/app/study/map/:id`) with divergent visual languages, data models, and zero interoperability.
4. **Interrupted Design Identity Seams**: Following the partial reversal of the "Paper & Graphite" design back to "Learning Canvas Blue" (`#126CF2`), several unmigrated seams remain: MindMap node selection still renders in dark muddy forest green (`#1F4033`), `.btn-seal` classes carry blue styling, and undeclared CSS font variables break typography rules in `.artifact-toolbar__identity`.
5. **Command Palette Accessibility Glitches**: `CommandPalette` fails to focus its search input on `Ctrl+K` (focus is stolen by the Modal close button) and renders a completely blank, ghost container when opened without a search query.

---

### 2. Shared Component & Architectural Blast Radius Map

Before any redesign touches existing UI primitives, the following component dependency graph must be respected. Modifying these shared primitives without an architectural safety plan risks catastrophic regressions across unrelated features:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               SHARED COMPONENT BLAST RADIUS                            │
└────────────────────────────────────────────────────────────────────────────────────────┘

 [components/ui/Modal.jsx] (10 consumers across 3 route boundaries)
    ├── CommandPalette.jsx (Global search overlay)
    ├── AppearanceEditorDrawer.jsx (MindMap customizer)
    ├── ExportStudioDialog.jsx (MindMap export engine)
    ├── ShortcutsOverlay.jsx (Keyboard cheat sheet)
    ├── ChangePasswordDialog.jsx, ProfileView.jsx, NksVerifyDialog.jsx (Auth/Account)
    └── Practice.jsx, QuizSetup.jsx (Study workflow)
    ⚠️ BLAST RISK: Modal owns focus-trapping and initial element focus. Modifying its
       header structure or children ordering breaks keyboard focus across all 10 dialogs.

 [study/useStudyContext.js & StudyContextProvider.jsx] (18 consumers)
    ├── MainLayout.jsx, ChatArea.jsx, SidebarRight.jsx, SummaryPane.jsx (Workspace)
    ├── CommandPalette.jsx (Global Search)
    └── StudyShell.jsx, StudyBreadcrumb.jsx, StudyCard.jsx, DocumentList.jsx, StudyMapView.jsx
    ⚠️ BLAST RISK: Dual-identity pointer contract! In Workspace, `selectedDocument` stores
       the string source stem; in Study routes, it stores the UUID `document_id`.

 [components/Layout/WorkspaceContainer.jsx] (Central Workspace Shell)
    ├── ChatArea.jsx (Mounted & kept live)
    ├── MindElixirView.jsx (Mounted & kept live)
    └── SummaryPane.jsx (Mounted & kept live)
    ⚠️ BLAST RISK: Non-negotiable architectural invariant! Panes toggle via `hidden`
       attribute to preserve canvas state, active LLM streaming, and scroll position.
       Naive React Router route splitting would destroy user session continuity.

 [components/Layout/ContextPanelCloseButton.jsx] (Workspace Right Rail)
    ├── Persistent Rail Mode (Collapses right panel to PanelSpine)
    └── MindMap Overlay Mode (Clears node selection & hides floating overlay)
    ⚠️ BLAST RISK: Naively simplifying this button breaks the contextual selection
       lifecycle between Chat and MindMap.
```

---

### 3. Detailed Finding Log (Pre-Adjudication)

#### UX-001: Complete Navigation Disconnect — `/app/study/*` Route Tree is Orphaned in the Workspace Header
- **Severity**: **P0 (Critical)**
- **Type**: **Confirmed**
- **Affected Surface**: `FE/src/components/Layout/MainLayout.jsx`, Global Header (`/app`)
- **Evidence**:
  - `MainLayout.jsx` lines 503–507 contains an explicit comment:
    `Round 11 (mockup parity) — "StudyMap" moved here, right next to the wordmark, matching the approved reference image's brand cluster; it's still the SAME real <Link to="/app/study"> (Alt+S, quiz/practice mode) that used to sit in the right-side icon cluster, just relocated — not duplicated there anymore.`
  - Immediately following that comment (lines 508–520), the rendered JSX is:
    ```jsx
    <Link to="/app" aria-label="MemVidX — trang chủ" className="...">
      <span ...>M</span>
      <span ...>MemVid<span className="text-seal">X</span></span>
    </Link>
    ```
  - The actual `<Link to="/app/study">` was completely omitted from the DOM!
  - Meanwhile, on the right side of the header (line 562), a button labelled `"StudyMap"` exists (`.study-tools-trigger`), but clicking it does **not** navigate to `/app/study`. It triggers `StudyToolsMenu` (opening in-workspace tools: Gia sư AI, Dòng thời gian, Kiến thức).
  - Live inspection confirmed: there is **zero visible link or button** anywhere in `/app` that takes the user to `/app/study` (DocumentList, Quiz, Practice, Review).
  - The only ways a user can reach `/app/study` are:
    1. Manually typing `http://localhost:5180/app/study` into the address bar.
    2. Pressing the hidden keyboard shortcut `Alt+S`.
    3. Typing a specific command into `CommandPalette` (`Ctrl+K`).
- **User Impact**: 50% of the entire product (all study documents, quiz generation, practice modes, and review guides) is completely undiscoverable to normal mouse/touch users.
- **Remediation**: Restore the visible `<Link to="/app/study">` in the header adjacent to the brand logo or mode tabs, clearly labelled "Thư viện học tập" or "Study Library".

---

#### UX-002: Physical Pointer Occlusion — Floating `mindmap-tools-overlay` Blocks MindMap Toolbar Controls
- **Severity**: **P0 (Critical)**
- **Type**: **Confirmed**
- **Affected Surface**: `FE/src/components/Layout/MainLayout.jsx`, `FE/src/components/mindmap/MindElixirView.jsx`
- **Evidence**:
  - Live measurement in Playwright at 1440x900 viewport:
    - Export button (`.mm-export-trigger`): `top: 59.5px`, `bottom: 99.5px`, `left: 1303.89px`, `right: 1378px`.
    - Appearance button (`.mm-appearance-trigger`): `top: 59.5px`, `bottom: 99.5px`, `left: 1205px`, `right: 1300px`.
    - Overflow menu (`.mm-overflow-trigger`): `top: 59.5px`, `bottom: 99.5px`, `left: 1382px`, `right: 1420px`.
    - Floating Inspector overlay (`.mindmap-tools-overlay`): `top: 56px`, `bottom: 888px`, `left: 1088px`, `right: 1428px`, `z-index: 40`.
  - Element-from-point at the center of the Export button (`cx: 1340`, `cy: 79`):
    `document.elementFromPoint(1340, 79)` resolves to `DIV.study-surface-header` inside `aside.mindmap-tools-overlay`!
  - `isInterceptedByOverlay: true`. Playwright intercepted pointer click error:
    `<div class="study-surface-header">...</div> from <aside class="mindmap-tools-overlay ..."> subtree intercepts pointer events`.
- **User Impact**: Whenever any node is selected on the MindMap canvas, the entire right section of the MindMap toolbar (Export, Appearance, and Overflow options including Save and Depth Presets) is **physically unclickable and covered**. If a user selects a branch specifically intending to export that branch, they cannot click Export.
- **Remediation**: Adjust the MindMap toolbar position or the overlay anchoring so that the toolbar remains outside/below the overlay boundary, or provide a dedicated export action directly inside the Knowledge Inspector header.

---

#### UX-003: Command Palette Initial Focus Hijacking by Modal Close Button
- **Severity**: **P1 (High)**
- **Type**: **Confirmed**
- **Affected Surface**: `FE/src/components/palette/CommandPalette.jsx`, `FE/src/components/ui/Modal.jsx`
- **Evidence**:
  - `CommandPalette.jsx` line 356 carries an explicit code comment:
    `{/* Ô nhập — phần tử focus-được ĐẦU TIÊN trong hộp thoại, Modal.jsx tự đưa focus vào đây khi mở (xem ui/Modal.jsx). */}`
  - However, `Modal.jsx` renders a modal header containing a close button (`button.icon-btn[aria-label="Đóng hộp thoại"]`) *before* the children container in the DOM tree.
  - Live Playwright evaluation on pressing `Ctrl+K`:
    `document.activeElement` is:
    ```json
    {
      "tagName": "BUTTON",
      "ariaLabel": "Đóng hộp thoại",
      "className": "icon-btn w-8 h-8 flex-shrink-0"
    }
    ```
  - The search input (`input[role="combobox"]`) is **not focused**.
- **User Impact**: A user pressing `Ctrl+K` and immediately typing finds their keystrokes completely ignored. Pressing Space or Enter accidentally triggers the close button and closes the palette immediately.
- **Remediation**: Add `autoFocus` or an explicit `useEffect` inside `CommandPalette.jsx` that calls `inputRef.current?.focus()` after the modal mounts, rather than relying on DOM ordering assumptions in `Modal.jsx`.

---

#### UX-004: Command Palette Renders Blank Ghost Container on Empty Query
- **Severity**: **P1 (High)**
- **Type**: **Confirmed**
- **Affected Surface**: `FE/src/components/palette/CommandPalette.jsx` lines 388–420 & 506–515
- **Evidence**:
  - When opened with an empty query (`dangRong === true`), `dsPhang` initializes with:
    `return [...gd, ...gl, ...DANH_SACH_LENH.map(...)];` (length = 6).
  - Because `dsPhang.length > 0`, the empty prompt check `{!dangTai && dangRong && dsPhang.length === 0}` evaluates to `false`.
  - When the user has no prior search history (`lichSu.timKiem` and `lichSu.lenh` are empty), the history sections render nothing.
  - The JSX section for commands (`DANH_SACH_LENH`) at line 506 is guarded by:
    `{!dangTai && !dangRong && danhSachLenhLoc.length > 0 && (`
    Notice `!dangRong`! It is explicitly blocked when the query is empty!
  - Live inspection confirmed: `#command-palette-ket-qua` renders with `innerHTML: ""` (completely empty listbox).
  - Arrow navigation still navigates through invisible items in `dsPhang`.
- **User Impact**: Opening the Command Palette presents an eerie, blank white box with no instructions or discoverable command list. Users have no way of knowing what commands exist unless they start randomly typing letters.
- **Remediation**: Allow `DANH_SACH_LENH` to render under `dangRong` when history is empty, providing an immediate list of common actions ("Tải tài liệu", "Tiếp tục học", "Phím tắt").

---

#### UX-005: Two Competing Map Visualization Engines with Zero Interoperability
- **Severity**: **P1 (High)**
- **Type**: **Confirmed**
- **Affected Surface**: `FE/src/components/mindmap/MindElixirView.jsx` vs `FE/src/pages/study/StudyMapView.jsx`
- **Evidence**:
  - The application maintains two separate map implementations:
    1. `/app` (MindMap tab): Powered by `mind-elixir`. Node pills, full editing, rich export studio, Knowledge Inspector, relation arrows, and dynamic coloring.
    2. `/app/study/map/:documentId`: Powered by `react-d3-tree`. Pure SVG rendering, circle nodes with plain text, read-only layout, fixed `MARK` sizes, and completely separate SVG export logic.
  - Data models are completely siloed:
    - MindMap in `/app` reads from `/mindmaps` (job-generated outline, enrich, relations).
    - StudyMapView reads from `/api/study/map` / `/study/documents/:id`.
  - There is no way to open a mind map generated in `/app` within `StudyMapView`, or vice-versa.
- **User Impact**: Severe user confusion. Users do not understand why the app has "Sơ đồ tư duy" in one tab and "Bản đồ học tập / Sơ đồ kiến thức" in another, why they look completely different, and why edits/annotations in one don't reflect in the other.
- **Remediation**: Unify on a single primary graph visualization engine (`mind-elixir` or a single shared graph canvas) with consistent node visual semantics and data storage.

---

#### UX-006: Incomplete Accent Reversal Seam — Muddy Forest Green Selection Ring on Blue Interface
- **Severity**: **P1 (High)**
- **Type**: **Confirmed**
- **Affected Surface**: `FE/src/components/mindmap/mindElixirTheme.js` lines 52–57
- **Evidence**:
  - The application-wide interactive accent was migrated from forest (`#1F4033`) to Learning Canvas Blue (`#126CF2`).
  - Active tabs, primary buttons, links, and input focus rings all render in `#126CF2`.
  - The root node of MindMap renders in `var(--accent)` (`#126CF2` blue).
  - However, in `mindElixirTheme.js`:
    ```javascript
    "--selected": "var(--forest)",
    "--accent-color": "var(--forest)",
    ```
  - Live computed style of a selected node on canvas:
    `selectedOutlineColor: 'rgb(31, 64, 51)'` (`#1F4033` - dark forest green).
- **User Impact**: Visual inconsistency and lack of contrast. In light mode, `#1F4033` looks like a dirty, near-black muddy green that clashes with the bright `#126CF2` blue accent used everywhere else in the interface.
- **Remediation**: Update `--selected` and `--accent-color` in `mindElixirTheme.js` to reference `var(--accent)` (`#126CF2`).

---

#### UX-007: Undeclared Phantom CSS Variables in `index.css` Breaking Artifact Identity Typography
- **Severity**: **P2 (Medium)**
- **Type**: **Confirmed**
- **Affected Surface**: `FE/src/index.css` lines 1029–1030
- **Evidence**:
  - In `index.css`:
    ```css
    .artifact-toolbar__identity strong { color: var(--text-primary); font: 600 14px/1.15 var(--font-display); }
    .artifact-toolbar__identity small { margin-top: 2px; color: var(--text-muted); font: 11px/1.1 var(--font-mono); }
    ```
  - AST scanning of `index.css` confirms neither `--font-display` nor `--font-mono` is declared in `:root` or `html.dark`.
  - In CSS shorthand `font: ...`, an unresolvable custom property without a fallback causes the entire shorthand declaration to be **invalid at computed-value time**, falling back to user-agent default or inherited font!
- **User Impact**: The artifact toolbar header fails to apply the intended Spectral serif and IBM Plex Mono typography, rendering in standard sans-serif fallback.
- **Remediation**: Declare `--font-display: 'Spectral', Georgia, serif;` and `--font-mono: 'IBM Plex Mono', monospace;` in `:root` of `index.css`, or replace the shorthand with explicit `font-family: var(...)` and tailwind classes.

---

#### UX-008: Non-Interactive Breadcrumb Trail in `StudyBreadcrumb`
- **Severity**: **P2 (Medium)**
- **Type**: **Confirmed**
- **Affected Surface**: `FE/src/components/study/StudyBreadcrumb.jsx`
- **Evidence**:
  - `StudyBreadcrumb.jsx` renders hierarchy indicators:
    ```jsx
    <nav aria-label="Đường dẫn học tập" className="...">
      {segments.map((nhan, i) => (
        <span key={i} className="...">
          {i > 0 && <span aria-hidden="true">›</span>}
          <span className="truncate ...">{nhan}</span>
        </span>
      ))}
    </nav>
    ```
  - All breadcrumb segments are plain `<span>` tags. There are zero `<Link>` or `<button>` elements.
  - When deep in `/app/study/map/:id` or `/app/study/review/:id`, users see "DocumentName.pdf › Sơ đồ › Khái niệm", but clicking any parent segment does nothing.
- **User Impact**: Violates standard Web breadcrumb affordance. Users expect breadcrumbs to be clickable parent navigation links.
- **Remediation**: Render interactive `<Link>` tags for antecedent breadcrumb segments that map to known routes.

---

#### UX-009: Leaked Internal Code Names & Brand Identity Drift ("Phòng đọc" vs "StudyMap" vs "MemVidX")
- **Severity**: **P2 (Medium)**
- **Type**: **Confirmed**
- **Affected Surface**: `FE/src/pages/Register.jsx:47`, `FE/src/pages/study/DocumentList.jsx:406`, Header Wordmark
- **Evidence**:
  - In `Register.jsx:47`:
    `<div className="font-mono text-metadata uppercase text-text-muted mb-2">Phòng đọc</div>`
  - In `DocumentList.jsx:406`:
    `backTo="/app" backLabel="Phòng đọc"`
  - Header Wordmark:
    `MemVidX` (logo with rotated 'M' seal).
  - Header Dropdown:
    `StudyMap` (trigger for study tools).
- **User Impact**: Cognitive confusion for new users. A user registering for "MemVidX" or "StudyMap" is suddenly confronted with the heading "PHÒNG ĐỌC" on the registration form and "Về Phòng đọc" on document lists, which reflects internal development milestones ("Phòng Đọc identity") rather than customer-facing branding.
- **Remediation**: Standardize consumer-facing terminology across all route headers and authentication screens.

---

#### UX-010: Legacy Hardcoded Color Hexes (`AccountMenu.jsx`)
- **Severity**: **P2 (Medium)**
- **Type**: **Confirmed**
- **Affected Surface**: `FE/src/components/Layout/AccountMenu.jsx` line 62
- **Evidence**:
  - `AccountMenu.jsx` line 62 defines:
    `className="... hover:border-[rgba(178,58,46,0.30)]"`
  - `rgba(178,58,46,...)` is the old light-mode seal-red hex (`#B23A2E`) from the pre-blue redesign phase.
  - While other header buttons hover with `var(--accent)` (blue) or subtle borders, hovering over the account avatar produces a faint reddish-orange border.
- **User Impact**: Minor visual inconsistency that betrays an incomplete token migration.
- **Remediation**: Replace the bracketed hex with `hover:border-[var(--accent)]` or standard token hover styling.

---

#### UX-011: Touch Target Undersizing on Mobile Header Mode Tabs
- **Severity**: **P2 (Medium)**
- **Type**: **Confirmed**
- **Affected Surface**: `FE/src/components/Layout/MainLayout.jsx` lines 544–553
- **Evidence**:
  - Tested on 375x667 and 390x844 viewports via Playwright:
  - Header mode tabs (Trò chuyện / Sơ đồ tư duy / Tóm tắt) render as icon-only buttons with dimensions:
    `width: 40px`, `height: 40px`.
  - WCAG 2.5.5 (Target Size - Level AAA) and standard mobile platform human interface guidelines (Apple HIG / Android Material) specify a minimum hit target of **44x44px** (or 48x48px).
- **User Impact**: Tapping mode tabs on mobile devices produces tap-target accuracy errors, especially when placed tightly side-by-side in a pill container.
- **Remediation**: Increase mobile button padding or container size to ensure a minimum 44x44px hit bounding box.

---

#### UX-012: Desktop Escape Key Ignored in MindMap Overlay
- **Severity**: **P2 (Medium)**
- **Type**: **Confirmed**
- **Affected Surface**: `FE/src/components/Layout/MainLayout.jsx` lines 420–429
- **Evidence**:
  - In `MainLayout.jsx`:
    ```javascript
    useEffect(() => {
      const onKey = (e) => {
        if (e.key !== "Escape" || !panel.drawer || !rightOpen) return;
        if (document.querySelector('[aria-modal="true"]')) return;
        closeRightPanel();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [panel.drawer, rightOpen, closeRightPanel]);
    ```
  - Note the condition: `!panel.drawer`.
  - On desktop viewports (`width >= 1024px`), `panel.drawer` is `false`.
  - Therefore, pressing `Escape` while the Knowledge Inspector overlay is open returns immediately and **does nothing**.
  - Verified live in Playwright: pressing Escape failed to dismiss the overlay, requiring a mouse click on `button[aria-label="Đóng chi tiết nhánh"]`.
- **User Impact**: Desktop power users and accessibility keyboard users cannot dismiss the inspector overlay using the standard `Escape` key, despite tooltips indicating `Đóng (Esc)`.
- **Remediation**: Update the keyboard listener condition to allow Escape to close the overlay when `mindmapToolOverlay && rightOpen` is active on desktop.

---

#### UX-013: Misleading Cognitive Labeling on Header "StudyMap" Button
- **Severity**: **P3 (Low)**
- **Type**: **Likely**
- **Affected Surface**: `FE/src/components/Layout/MainLayout.jsx:562`
- **Evidence**:
  - The header button is labelled `"StudyMap"` with a dropdown chevron.
  - The application itself is named StudyMap.
  - The documents/quiz section is at `/app/study`.
  - But clicking this button opens a popover titled `"Công cụ học"` containing Gia sư AI, Dòng thời gian, and Kiến thức.
- **User Impact**: Three distinct concepts share the name "StudyMap", misleading users looking for their study documents or quiz practice.
- **Remediation**: Relabel the button to `"Công cụ học"` ("Study Tools") to match the internal title of the dropdown.

---

#### UX-014: Stale Audit Finding Invalidation — `var(--brand)` in StudyMapView is Already Fixed
- **Severity**: **Informational / Invalidation**
- **Type**: **Confirmed (Debunked)**
- **Affected Surface**: `FE/src/pages/study/StudyMapView.jsx:45-48`
- **Evidence**:
  - Historical audit documents (`DESIGN_TOKEN_AUDIT.md:167`, `UI_AUDIT_V2.md:59`) claimed that `StudyMapView.jsx` uses undeclared `var(--brand)` for root/section node fill and stroke, representing a high-severity rendering bug.
  - Direct inspection of current live code in `StudyMapView.jsx` lines 45–48 confirms:
    ```javascript
    const MARK = {
      root:    { r: 9, fill: "var(--accent)",       stroke: "var(--accent)",        text: 17,   weight: 600 },
      section: { r: 7, fill: "var(--bg-card)",     stroke: "var(--accent)",        text: 14,   weight: 600 },
      concept: { r: 5, fill: "var(--bg-card)",     stroke: "var(--text-muted)",   text: 13,   weight: 500 },
      example: { r: 3, fill: "var(--bg-base)",     stroke: "var(--border-color)", text: 11.5, weight: 400 },
    };
    ```
  - All four node types use declared tokens: `var(--accent)`, `var(--bg-card)`, `var(--text-muted)`, and `var(--border-color)`.
  - Live SVG inspection confirmed nodes render with valid computed hex/rgba values.
- **Auditor Assessment**: Prior claims of broken `var(--brand)` in StudyMapView are **stale and obsolete**. Any suggestion that StudyMapView is currently failing to render due to `var(--brand)` must be rejected.

---

### 4. User Journey Evaluation Summary

| # | Journey | Tested Experience | Result / Friction Observed |
|---|---|---|---|
| **J1** | **First-Time Learner** | Visits `/`, registers account, lands on `/app`. | ✅ Smooth auth. ⚠️ Eyebrow calls app "Phòng đọc". Empty state has clear CTA. |
| **J2** | **Research Workflow** | Uploads text document, asks AI in Chat, receives answer with citations. | ✅ Fast deterministic mock response. Citations link to Evidence Drawer. Resizable splitter works smoothly. |
| **J3** | **Mind Map Workflow** | Switches to MindMap tab, generates mindmap, selects node, views Knowledge Inspector. | ❌ **UX-002 Blocker**: Inspector overlay covers toolbar Export/Appearance buttons. ⚠️ **UX-006**: Node selection outline is dark forest green instead of blue. |
| **J4** | **Export Workflow** | Opens Export Studio, selects formats (PNG, PDF, WebP), configures scope. | ✅ Export Studio modal is comprehensive with preview canvas and scope toggles. ❌ Unreachable when a node is selected unless inspector is closed first. |
| **J5** | **Study Workflow** | Attempts to open Study Library, Quiz, Practice, Review. | ❌ **UX-001 Blocker**: No visible link in Workspace to `/app/study`. Once in `/app/study`, documents and quizzes work, but breadcrumbs are non-interactive (UX-008). |
| **J6** | **Returning User** | Switches between Chat, MindMap, and Summary tabs; tests shortcuts & palette. | ✅ State across tabs is preserved (`WorkspaceContainer`). ❌ **UX-003 & UX-004**: Command Palette focuses close button and shows blank list on empty search. |
| **J7** | **Mobile User** | Exercises mobile viewports (375x667 & 390x844). | ✅ Responsive layout collapses sidebars into slide-over bottom sheets. ⚠️ **UX-011**: Mode switch tabs are 40x40px (under 44px touch target). |

---

### 5. Architectural "Do Not Touch" Guardrails

Any subsequent redesign proposals from Codex or other agents must be evaluated against these architectural guardrails:

1. **Do NOT convert `WorkspaceContainer` into separate route mounts**:
   `WorkspaceContainer.jsx` deliberately mounts Chat, MindMap, and Summary simultaneously and toggles them with `hidden`. This is critical for preserving mind-elixir canvas state, canvas viewport transforms, and active AI chat context. Replacing this with React Router unmounts will cause major state-loss regressions.
2. **Do NOT touch the `useStudyContext` stem-vs-UUID abstraction**:
   The dual-role pointer where `selectedDocument` stores a string stem in `/app` and a UUID in `/app/study` is required by the backend API contract. Unifying them naively will break DocumentList cross-navigation.
3. **Do NOT remove `ContextPanelCloseButton`'s dual-mode lifecycle**:
   Closing the right panel in MindMap mode must clear the contextual node selection (`mmClearSelectedNode({ preserveExportIntent: true })`), whereas in Chat mode it only collapses the splitter width. Collapsing these two into a single blind handler breaks MindMap node re-selection.
4. **Do NOT replace custom CSS keyframes with external animation libraries**:
   The codebase intentionally has **zero Framer Motion imports** and uses lightweight, hardware-accelerated CSS transitions with `prefers-reduced-motion` guards. Introducing heavy animation libraries is unjustified.

---

## Adjudication against Codex/Claude findings

### 1. Adjudication Framework & Method

This adjudication synthesizes the findings of:
- **Audit Lead (Claude)**: `01-product-inventory.md`
- **Visual & Design System Reviewer (Codex 1)**: `03-visual-design-audit.md`, `07-design-system-inventory.md`
- **Usability, Duplication & Accessibility Reviewer (Codex 2)**: `04-usability-flow-audit.md`, `05-duplication-matrix.md`, `06-accessibility-responsive-audit.md`
- **Independent Product & Architecture Reviewer (Agy)**: `08-independent-agy-review.md` (Section 1)

Every claim has been adjudicated against three strict criteria:
1. **Empirical Ground Truth**: Does the bug reproduce in the live running application (`:5180` FE / `:8090` BE) and match the exact source code AST, or is it an artifact of a stale document or test harness mock?
2. **Blast Radius & Non-Regression**: Would a proposed simplification break critical state persistence, accessibility trees, or background jobs?
3. **Severity Calibration**: Distinguishing true workflow blockers (P0/P1) from cosmetic preferences or contextual shortcuts (P2/P3).

---

### 2. Cross-Agent Consensus Matrix (100% Unanimous Findings)

| Finding Theme | Codex 1 Tag | Codex 2 Tag | Agy Tag | Adjudicated Consensus |
|---|---|---|---|---|
| **MindMap Toolbar Occlusion** | — | UX-008 | UX-002 | **P0 Blocker**. When a node is selected, `mindmap-tools-overlay` physically intercepts pointer clicks on the MindMap toolbar's Export, Appearance, and Overflow controls. Verified by DOM bounding rects in both audits. |
| **Workspace ⇄ Study Navigation Disconnect** | — | UX-007 / UX-018 | UX-001 | **P0 Blocker**. The header button labelled "StudyMap" opens an in-panel tool menu; the actual `<Link to="/app/study">` was omitted from JSX despite comment claims. Users in `/app` cannot discover or access `/app/study`. |
| **Dark Mode Primary CTA Contrast Failure** | UX-VIS-001 | — | — | **P1 Defect**. In dark mode, `.btn-primary` and `.btn-seal` render white text on `#5B9DF5` at a measured **2.77:1** ratio, severely failing WCAG AA (minimum 4.5:1). |
| **Muted Copy Contrast Failure** | UX-VIS-002 | — | — | **P1 Defect**. Muted copy (`#8294B1` light / `#6B7689` dark) measures **2.89–3.43:1** on cards, making timestamps, breadcrumbs, and hints unreadable. |
| **Repeated Document Cards (50,000px DOM)** | UX-VIS-007 | UX-004 / UX-017 / UX-025 | — | **P1 Defect**. `DocumentList.jsx` repeats identical actionable cards across multiple sections, creating 823 interactive controls and an unnavigable keyboard/screen-reader experience. |
| **Dual Map Engine Schism** | UX-VIS-008 | Matrix §13, 21 | UX-005 | **P1 Defect**. Two incompatible graph engines (`mind-elixir` in `/app` vs `react-d3-tree` in `/app/study`) with divergent visual styling, data formats, and zero interoperability. |
| **Paper & Graphite Reversal Seams** | UX-VIS-006 / Inv §2 | — | UX-006 / UX-010 | **P1 Defect**. Partial revert to blue `#126CF2` left behind dark forest-green selection rings (`mindElixirTheme.js`), `.btn-seal` class aliases, and hardcoded seal-red hexes (`AccountMenu.jsx`). |
| **Mobile Touch Target Undersizing** | Inv §4 | UX-028 | UX-011 | **P2 Defect**. Header mode tabs (40x40px) and kebab buttons (28x28px) fail the 44x44px mobile touch target standard. |
| **Closed Drawer Focus Leak on Mobile** | — | UX-021 / UX-022 | — | **P1 Defect**. Off-canvas mobile source drawer leaves invisible controls in the active sequential keyboard Tab order. |

---

### 3. Critical Challenges & Calibrations on Codex Findings

#### Challenge 1: Severity Upgrade on Navigation Disconnect (Codex 2 UX-007 vs Agy UX-001)
- **Codex 2 Assessment**: Scored UX-007 / UX-018 as **P2**, calling it a "usability friction / navigation guessing" issue because StudyMap menu opens tools instead of the library.
- **Agy Adjudication**: **UPGRADE TO P0 (CRITICAL)**.
- **Rationale**: This is not just a misleading menu label. Agy's AST analysis revealed that in `MainLayout.jsx:503-520`, the developer wrote a comment stating that `<Link to="/app/study">` was moved next to the wordmark, but **failed to render the link in the JSX**. Because there is no visible link anywhere in the workspace chrome to `/app/study`, the entire Study subsystem (documents, quiz, review, practice) is **completely unreachable** via the primary interface. An orphaned half of the product is an undeniable P0.

#### Challenge 2: Contextualization of API Ownership "Fails Open" (Codex 2 UX-001)
- **Codex 2 Assessment**: Scored UX-001 as **P1**, stating that cross-account documents were exposed.
- **Agy Adjudication**: **CALIBRATE TO P2 (Deployment Hardening / Test Artifact)**.
- **Rationale**: Codex 2 honestly notes that this occurred because `BE/scripts/run_e2e_server.py` sets `AUTH_PROTECT_APP_APIS=false` for the local test runner, whereas `render.yaml` sets it to `"true"`. In production, `_auth_protect_enabled()` filters via `owned_stems(uid)`. The visible symptom (seeing 19 test documents from prior runs) is a test fixture artifact. We uphold the recommendation to fail secure by default on all server startups, but reject the notion that this represents a current production data leak.

#### Challenge 3: Invalidation of Historical Phantom Variable Claims (`var(--brand)`)
- **Historical Claim (Claude 01-product-inventory.md §4, DESIGN_TOKEN_AUDIT.md)**: Claimed `StudyMapView.jsx` was broken by undeclared `var(--brand)`.
- **Agy Adjudication**: **DEFINITIVELY DEBUNKED & INVALIDATED**.
- **Rationale**: Neither Codex 1 nor Codex 2 reproduced `var(--brand)` errors. Agy verified `StudyMapView.jsx:45-48` directly: the code now correctly references `var(--accent)`, `var(--bg-card)`, `var(--text-muted)`, and `var(--border-color)`. This finding was resolved in prior PRs and must not be included in the remediation scope.

#### Challenge 4: Offline Mock Limitations vs Product Bugs
- **Codex Findings**: UX-002 (Quiz chunk missing), UX-003 (Chat citation missing), UX-011, UX-012, UX-013.
- **Agy Adjudication**: **CONCUR WITH CODEX 2's "LIKELY ISSUE NEEDING VALIDATION" CLASSIFICATION**.
- **Rationale**: In the local test stack, AI providers are mocked and documents uploaded during tests were not chunked/indexed by a background Celery worker. Attributing missing chat citations or quiz generation failure to frontend UI defects is incorrect; they are deterministic mock constraints. Remediation must include a rich seeded Postgres test fixture.

---

### 4. Critical Blind Spots in Codex Audits (Caught Exclusively by Agy)

The following high-impact defects were completely missed by Codex 1 and Codex 2, but caught through Agy's independent code-level AST and Playwright testing:

#### Blind Spot 1: Command Palette Focus Hijacking by Modal Close Button (UX-003 — P1)
- **What Codex Missed**: Codex 1 only noted mobile vertical centering (UX-VIS-010); Codex 2 did not test `CommandPalette` focus trapping.
- **Agy Finding**: `CommandPalette.jsx:356` assumes the `<input>` is the first focusable element. However, `Modal.jsx` injects its header close button (`button[aria-label="Đóng hộp thoại"]`) *before* the children container in DOM order. On pressing `Ctrl+K`, focus lands on the close button, not the search input. Immediate typing fails, and pressing Space/Enter closes the modal.

#### Blind Spot 2: Command Palette Empty Query Blank Ghost State (UX-004 — P1)
- **What Codex Missed**: Both Codex 1 and Codex 2 captured screenshot states with typed queries or test fixtures, missing the initial empty state.
- **Agy Finding**: When opened with an empty query, `DANH_SACH_LENH` is populated into the keyboard array `dsPhang` (suppressing the empty message), but the JSX mapping for commands at line 506 is guarded by `!dangRong`. Consequently, opening `CommandPalette` with no query history displays a **completely blank white box** with zero visible commands, while arrow keys navigate phantom invisible items.

#### Blind Spot 3: MindMap Node Selection Outline Stuck on Forest Green (UX-006 — P1)
- **What Codex Missed**: Codex 1 noted general color identity conflicts, but did not inspect the computed CSS of selected nodes on canvas.
- **Agy Finding**: While the app flipped its primary accent to `#126CF2` (blue), `FE/src/components/mindmap/mindElixirTheme.js:56` still declares `"--selected": "var(--forest)"`. When a node is selected, its outline is dark muddy forest green (`rgb(31, 64, 51)`), visually clashing with the bright blue root node and blue UI tabs.

#### Blind Spot 4: Undeclared CSS Variables in `index.css` (UX-007 — P2)
- **What Codex Missed**: Both Codex audits assumed CSS variables in `index.css` were valid.
- **Agy Finding**: Lines 1029–1030 of `index.css` define `.artifact-toolbar__identity` using `var(--font-display)` and `var(--font-mono)`. Neither variable is declared in `:root`, causing the CSS shorthand `font: 600 14px/1.15 var(--font-display)` to fail computed value resolution and fall back to system sans-serif.

#### Blind Spot 5: Desktop Escape Key Ignored in MindMap Overlay (UX-012 — P2)
- **What Codex Missed**: Codex 2 tested Escape inside modals, but not on the desktop Knowledge Inspector overlay.
- **Agy Finding**: In `MainLayout.jsx:421`, the Escape listener is guarded by `if (... || !panel.drawer || !rightOpen) return;`. On desktop (`!panel.drawer` is true), pressing Escape does nothing, forcing desktop users to click the X icon to dismiss the overlay.

---

### 5. Unified Master Priority Matrix (Adjudicated)

This master matrix reconciles all confirmed findings across Codex 1, Codex 2, and Agy into a single authoritative roadmap:

| Adjudicated ID | Severity | Problem Title | Primary Affected Files | Consensus Origin | Migration Risk |
|---|---|---|---|---|---|
| **UX-ADJ-001** | **P0** | **Workspace Header Omits `<Link to="/app/study">` (Route Black Hole)** | `MainLayout.jsx:503-520` | Agy UX-001 (Upgraded from Codex 2 UX-007) | Low: Re-render visible nav link |
| **UX-ADJ-002** | **P0** | **Floating Knowledge Inspector Occludes MindMap Toolbar (Export/Appearance)** | `MainLayout.jsx:772`, `MindElixirView.jsx:1160-1175` | Agy UX-002, Codex 2 UX-008 | Medium: Re-anchor toolbar or overlay |
| **UX-ADJ-003** | **P1** | **Command Palette Focus Theft by Modal Close Button** | `CommandPalette.jsx:356`, `Modal.jsx` | Agy UX-003 | Low: Add explicit `inputRef.current?.focus()` |
| **UX-ADJ-004** | **P1** | **Command Palette Renders Blank Container on Empty Query** | `CommandPalette.jsx:388-420, 506` | Agy UX-004 | Low: Render `DANH_SACH_LENH` when `dangRong` |
| **UX-ADJ-005** | **P1** | **Dark Mode Primary CTA Text Fails WCAG Contrast (2.77:1)** | `index.css:126, 271-276` | Codex 1 UX-VIS-001 | Low: Adjust text color to dark navy or deepen accent |
| **UX-ADJ-006** | **P1** | **Muted Copy Fails Contrast Across Both Themes (2.89–3.43:1)** | `index.css:29, 137` | Codex 1 UX-VIS-002 | Low: Darken light muted / brighten dark muted |
| **UX-ADJ-007** | **P1** | **Repeated Document Cards Across Multiple Sections (823 Interactive Controls)** | `pages/study/DocumentList.jsx:75-400` | Codex 2 UX-004, UX-017, UX-025, Codex 1 UX-VIS-007 | High: Requires consolidating card list while keeping filters |
| **UX-ADJ-008** | **P1** | **Dual Map Engine Fragmentation (`mind-elixir` vs `react-d3-tree`)** | `MindElixirView.jsx` vs `StudyMapView.jsx` | Agy UX-005, Codex 1 UX-VIS-008, Codex 2 Matrix §13 | Very High: Architectural unification of graph model |
| **UX-ADJ-009** | **P1** | **MindMap Node Selection Ring Remains Muddy Forest Green (`#1F4033`)** | `mindElixirTheme.js:56` | Agy UX-006 | Low: Point `--selected` to `var(--accent)` |
| **UX-ADJ-010** | **P1** | **Closed Mobile Source Drawer Leaves Invisible Controls in Tab Order** | `SidebarLeft.jsx`, `MainLayout.jsx` | Codex 2 UX-021, UX-022 | Medium: Add `inert` or unmount off-canvas drawer |
| **UX-ADJ-011** | **P2** | **Mobile Touch Targets Below 44x44px Minimum (Mode Tabs 40x40px, Kebabs 28x28px)** | `MainLayout.jsx:544-553`, `SidebarRight.jsx` | Agy UX-011, Codex 1 Inv §4, Codex 2 UX-028 | Low: Adjust hit padding |
| **UX-ADJ-012** | **P2** | **Undeclared `--font-display` and `--font-mono` in `index.css` Shorthand** | `index.css:1029-1030` | Agy UX-007 | Low: Declare tokens in `:root` |
| **UX-ADJ-013** | **P2** | **Non-Interactive Breadcrumbs in `StudyBreadcrumb`** | `StudyBreadcrumb.jsx:32-45` | Agy UX-008 | Low: Convert spans to links |
| **UX-ADJ-014** | **P2** | **Desktop Escape Key Ignored in MindMap Overlay** | `MainLayout.jsx:420-429` | Agy UX-012 | Low: Allow Escape on desktop overlay |
| **UX-ADJ-015** | **P2** | **Mobile Export Studio Quick-Format Row Clipped Without Affordance** | `ExportStudioDialog.jsx` | Codex 1 UX-VIS-004 | Low: Add visual scroll cue or wrap |
| **UX-ADJ-016** | **P2** | **Mobile StudyMap Canvas Crops Graph on Initial Load** | `StudyMapView.jsx` | Codex 1 UX-VIS-005 | Medium: Auto-fit viewport bounds on mobile |
| **UX-ADJ-017** | **P2** | **Radius Token Fragmentation (Mixing 3px, 6-10px, and Full)** | `tailwind.config.js`, `index.css` | Codex 1 UX-VIS-011, Inv §5 | Medium: Consolidate to semantic scale |
| **UX-ADJ-018** | **P2** | **Legacy Brand Terminology Leak ("Phòng đọc" vs "MemVidX" vs "StudyMap")** | `Register.jsx:47`, `DocumentList.jsx:406` | Agy UX-009, Codex 2 UX-018 | Low: Normalize user-facing string tokens |
| **UX-ADJ-019** | **P3** | **Relabel Header "StudyMap" Dropdown to "Công cụ học"** | `MainLayout.jsx:562`, `StudyToolsMenu.jsx` | Agy UX-013, Codex 2 UX-018 | Low: String update |
| **UX-ADJ-020** | **P3** | **Export Studio Workflow Redundancy (7 Steps for Quick SVG)** | `ExportStudioDialog.jsx` | Codex 2 UX-009, UX-016 | Low: Provide "Quick Export Last Preset" |

---

### 6. Architectural Guardrails for the Remediation Team

To ensure that upcoming refactor sprints do not introduce regressions while fixing the findings above, all agents and developers must adhere to these non-negotiable architectural invariants:

1. **Do NOT convert `WorkspaceContainer` into separate route mounts**:
   `WorkspaceContainer.jsx` deliberately mounts Chat, MindMap, and Summary simultaneously and toggles them via the `hidden` class. This preserves the live WebGL/DOM canvas, pan/zoom coordinates, and in-flight AI streaming. Unmounting them will destroy user state.
2. **Do NOT remove `useStudyContext`'s dual-identity contract**:
   In `/app`, `selectedDocument` holds the document stem string (`rec.sources`). In `/app/study`, it holds the UUID `document_id`. This duality is baked into backend endpoints; touching it without a database migration will break cross-navigation.
3. **Do NOT merge `ContextPanelCloseButton` into a naive toggle**:
   In MindMap mode, closing the panel must invoke `mmClearSelectedNode({ preserveExportIntent: true })` so that node detail closes while preserving the user's branch selection for Export Studio.
4. **Do NOT delete contextual shortcuts in the name of "de-duplication"**:
   As proven in `05-duplication-matrix.md`, launching chat from a document card or opening mindmap from search are valuable contextual handoffs. De-duplication must target *repeated rendering of full cards* in `DocumentList.jsx`, NOT contextual shortcuts.
5. **Zero Framer Motion**:
   The codebase strictly uses CSS keyframes and hardware-accelerated transitions. External runtime animation libraries must not be introduced.

