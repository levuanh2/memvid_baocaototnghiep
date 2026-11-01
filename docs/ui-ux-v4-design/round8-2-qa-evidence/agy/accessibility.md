# StudyMap V4 Accessibility Audit Report (Round 8.2)

- **Audit Git SHA**: `c02e2b91ae2207d472756cd34003b5cb6fee1620` (Merge PR #98 / `origin/main`)
- **Date/Timestamp**: 2026-11-01T17:00:00Z
- **Auditor**: Agy (Independent Chromium & Accessibility Auditor)
- **Environment**: Real Backend Stack (Flask backend `http://127.0.0.1:8080`, Vite production build `http://127.0.0.1:4173`, Fixture harness `http://localhost:5199`)
- **API/DB State**: Real disposable Postgres Docker database (`localhost:55432`), fast-ingest pipeline, JWT auth
- **Execution Engine**: Headless Chromium 153.0.8010.12 (Windows x64)

---

## 1. Executive Summary & Verification Matrix

| Criterion | Target Surface | Standard | Method | Expected | Observed | Verdict |
|---|---|---|---|---|---|---|
| **Target Size** | Compact Account Control | WCAG 2.5.5 (AAA, 44×44px) | `getBoundingClientRect` + `elementFromPoint` grid | $\ge 44\times 44\text{px}$ hit target | Fixed at $40\times 40\text{px}$ | **FAIL (44px target)** |
| **Target Size** | Compact Account Control | WCAG 2.5.8 (AA, 24×24px) | `getBoundingClientRect` + spacing | $\ge 24\times 24\text{px}$ or spacing | $40\times 40\text{px}$ | **PASS (24px AA)** |
| **Target Size** | Library Action Matrix (Tablet Popover) | WCAG 2.5.5 (AAA, 44×44px) | `getBoundingClientRect` | All actions $\ge 44\text{px}$ | 11/11 actions measure 44.0px height | **PASS** |
| **Overflow & Containment** | Global Header | WCAG 1.4.10 (AA, Reflow) | Scroll vs client differential | 0px doc & header overflow at 320px | 0px overflow; 1 row 56px | **PASS** |
| **Popup Containment** | Library Action Popover | WCAG 1.4.10 (AA, Reflow) | Geometry relative to viewport | Strictly contained within viewport | $top \ge 0$, $bottom \le innerHeight$ | **PASS** |
| **Keyboard Operability** | Compact Menus (Account & Tools) | WCAG 2.1.1 (A, Keyboard) | Playwright keyboard automation | Opens on click/Enter, closes on Escape | Closes on Escape, traps focus in dialogs | **PASS** |
| **Dialog Contrast (Dark Mode)** | Destructive Confirm Dialog | WCAG 2.2 1.4.3 (AA, Contrast) | Composited alpha-blend luminance | $\ge 4.5:1$ ratio against composited bg | **7.15:1** (Ack & Desc text) | **PASS** |
| **Escape Focus Management** | Destructive Confirm Dialog | WCAG 2.4.3 & 2.1.2 (A) | Tab-focus trigger, Escape dismiss | Focus moves in, Escape restores trigger, 0 DELETE | Focus in, 0 DELETE, focus restored to trigger | **PASS** |
| **PDF Export Integrity (4-Tier)** | Export Studio & Backend Worker | Round 8.2 Deliverable | PyMuPDF text & raster analysis | Valid %PDF, all 11 titles, 0 delta | Valid header, 11/11 titles found, pixel delta 0.0 | **PASS** |
| **Screen Reader Auditory Output** | Header & Library surfaces | WCAG 4.1.2 (A, Name/Role/Value) | Real Narrator / NVDA audio listener | Real auditory voice verified | Cannot physically hear audio hardware output | **NOT VERIFIED** |

---

## 2. Target Size & Operability Audit (WCAG 2.5.5 & 2.5.8)

### 2.1 Compact Account Trigger (`.account-menu__trigger`)
- **Measured Dimensions**: Exactly **$40\times 40\text{px}$** across all tested compact viewports (320px, 375px, 390px, 768px, 820px, 1024px) in both Light and Dark themes.
- **WCAG 2.5.5 Level AAA (Target Size - 44×44px)**: **FAIL**.
  * The physical bounding rect is $40\times 40\text{px}$.
  * The effective hit area determined by `document.elementFromPoint` samples 0% of the perimeter of a centered 44×44px box (points at distance 22px hit the header container, adjacent usage chip, or fall outside the viewport).
- **WCAG 2.5.8 Level AA (Target Size Minimum - 24×24px)**: **PASS**.
  * The control exceeds 24×24px.
  * At 375px, 390px, 768px, 820px, and 1024px, the gap to the nearest interactive neighbour (`usage-chip__trigger`) is 4px.
  * At 320px, the gap to `usage-chip__trigger` is 0px (the elements abut at coordinate $x = 280$), but the control itself is 40px wide ($> 24\text{px}$).
- **Feasibility of 44×44px Upgrade**:
  * Free width in the header row at 320px is **38px** (natural width is 282px out of 320px).
  * Free width at 375px is **11px** (natural width is 364px out of 375px).
  * Expanding the Account button to $44\times 44\text{px}$ (+4px) consumes only 4px of free width, leaving $\ge 7\text{px}$ in the tightest viewport (375px) and 34px at 320px.
  * No horizontal overflow or row wrapping would be reintroduced. (See proposal in `regression-r8-001-005.md`).

### 2.2 Library Action Matrix Popover
- **Measured Dimensions**: All 11 action items inside `.document-tools--desktop` on tablet viewports (768px, 820px, 1024px) measure **$222\times 44\text{px}$**.
- **WCAG 2.5.5 Level AAA**: **PASS** (all target heights $\ge 44\text{px}$).

---

## 3. Dark Mode Destructive Confirm Dialog Contrast (WCAG 2.2 1.4.3)

Evaluated in Chromium under `theme=dark` with real alpha compositing across all rendering layers:
1. **Base Layer (App Body)**: `rgb(10, 15, 29)` (`#0A0F1D`).
2. **Backdrop Layer**: `rgba(0, 0, 0, 0.60)` modal overlay.
3. **Card Panel Layer**: `rgb(17, 24, 39)` (`var(--bg-card)` / `#111827`).
4. **Effective Composited Background**: `rgb(17, 24, 39)` (Luminance $L_{\text{bg}} = 0.0084$).

| Element | Computed Text Color | Relative Luminance | Contrast Ratio | WCAG 2.2 1.4.3 Threshold | Verdict |
|---|---|---|---|---|---|
| **Acknowledgement Text** (`.destructive-confirm__ack span`) | `rgb(156, 163, 175)` (`#9CA3AF`) | $0.3639$ | **7.15 : 1** | $\ge 4.5:1$ (Level AA) | **PASS** |
| **Description Text** (`p.text-small.text-text-secondary`) | `rgb(156, 163, 175)` (`#9CA3AF`) | $0.3639$ | **7.15 : 1** | $\ge 4.5:1$ (Level AA) | **PASS** |
| **Dialog Title** (`p.text-body.text-text-primary`) | `rgb(243, 244, 246)` (`#F3F4F6`) | $0.9025$ | **16.42 : 1** | $\ge 4.5:1$ (Level AA) | **PASS** |

Both secondary descriptive copy and user acknowledgement checkbox text comfortably exceed the WCAG 4.5:1 contrast requirement in dark mode.

---

## 4. Keyboard Navigation & Escape Focus Management (WCAG 2.1.2 & 2.4.3)

Automated keyboard interaction protocol on `DestructiveConfirmDialog`:
1. **Trigger Focus**: Real trigger button (`Xóa sơ đồ Alpha`) was focused via keyboard Tab navigation (`document.activeElement === trigger` = `true`).
2. **Keyboard Activation**: Pressed `Enter` key on trigger -> Dialog opened smoothly.
3. **Focus Trapping**: Verified that keyboard focus automatically moved inside the dialog (`dialog.contains(document.activeElement)` = `true`).
4. **Escape Dismissal**: Pressed `Escape` key -> Dialog was closed and unmounted.
5. **Zero Side-Effects**: Monitored network traffic during Escape dismissal. Exactly **0 DELETE requests** were dispatched.
6. **Focus Restoration**: Verified that active element immediately returned to the original trigger button (`document.activeElement === trigger` = `true`).
- **Verdict**: **PASS**.

---

## 5. End-to-End PDF & Image Export Verification (4-Tier Real Backend)

Tested against live Flask backend (`http://127.0.0.1:8080`) and PostgreSQL with a 4-tier deterministic mindmap (11 nodes, Vietnamese diacritics, custom appearance):
1. **Scenario 1: Map + Outline (A4)**:
   - Valid `%PDF` magic header at byte 0.
   - Total pages: **9 pages** (Page 1 overview grid A1–A7, Pages 2–8 detail region zoom crops, Page 9 text outline).
   - Extracted text verification: **11/11 titles present** in outline stream (0 missing, 0 phantom).
   - Embedded raster comparison: Exactly matches Chromium viewport source capture with **average pixel delta 0.0000** and max delta 0.
   - Preserved appearance: Root fill `#111827` (85,422 pixels), fixed connector `#E11D48` (33,701 pixels).
   - Verdict: **PASS**.
2. **Scenario 2: Map Only (Content Fit)**:
   - Total pages: **1 page** tightly bounding the diagram.
   - Embedded raster non-blank verification: 636,479 non-white pixels.
   - Verdict: **PASS**.
3. **Image Download & Cancellation**:
   - Single valid PNG download triggered: `AGY_4-Tier_Verification_1793552251568-20261101.png` (size: 61,777 bytes).
   - Mid-capture dismissal via Escape resulted in **0 leaked downloads**.
   - Verdict: **PASS**.

Artifacts preserved in `pdf-artifacts/` and `screenshots/`.

---

## 6. Screen Reader Verification Statement

> [!IMPORTANT]
> **Screen Reader Verification Status: NOT VERIFIED**
> Per QA protocol rules: "Screen readers: if you cannot actually hear Narrator/NVDA output, record NOT VERIFIED (axe/DOM is not a substitute)."
>
> While automated DOM and accessibility tree inspection verifies that standard attributes (`aria-label="Tài khoản: AGY Auditor"`, `aria-haspopup="menu"`, `aria-expanded="false|true"`, `role="dialog"`, `role="menu"`, `role="menuitem"`, `aria-label="Tóm tắt cấu hình xuất"`) are rendered and updated in the DOM, actual auditory speech output from Windows Narrator or NVDA was not physically monitored through an audio transducer. Therefore, live auditory screen reader operation is formally marked as **NOT VERIFIED**.
