# Round 8.2 Regression Audit: R8-001, R8-005 & Compact Account Target

- **Audit Git SHA**: `c02e2b91ae2207d472756cd34003b5cb6fee1620` (Merge PR #98 / `origin/main`)
- **Date/Timestamp**: 2026-11-01T16:24:10Z
- **Auditor**: Agy (Independent Chromium & Accessibility Auditor)
- **Environment**: Vite Fixture Harness (`http://localhost:5199`, port 5199)
- **API/DB State**: Mocked API network fixtures (`/auth/me`, `/usage/me`, `/mindmaps`, `/api/documents`)
- **Execution Engine**: Headless Chromium 153.0.8010.12 (Windows x64)

---

## 1. Executive Summary & Verdicts

| Scope / Verification Area | Configurations | Expected | Observed | Status |
|---|---|---|---|---|
| **Compact Account Control Target (44x44)** | 12 viewports (320, 375, 390, 768, 820, 1024 × Light/Dark) | Hit target meets 44×44px | Fixed at 40×40px; perimeter test fails (0% resolution on 44px box) | **FAIL (44px target)** |
| **Account Feasibility & Free Width** | 6 viewports (320, 375, 390, 768, 820, 1024) | Free width $\ge$ 4px to accommodate 44px | Free width ranges from 11px to 644px; 44px physically fits without overflow | **FEASIBLE** |
| **R8-001 Survival: 320px & 1024px Header** | 4 configurations (320 & 1024 × Light/Dark) | 56px row, 0px doc/header overflow, Account reachable | Height 56px, 0px overflow, center hit pass, account menu operates | **PASS** |
| **R8-001 Survival: Compact Theme Switch** | 4 configurations (320 & 1024 × Light/Dark) | Theme toggle operational via StudyToolsMenu | Toggles `<html>.dark` class and `localStorage` key reliably | **PASS** |
| **R8-005 Survival: Tablet Popover Action Targets** | 6 configurations (768, 820, 1024 × Light/Dark) | All action rows $\ge$ 44px height | 11/11 actions measure exactly 44px height | **PASS** |
| **R8-005 Survival: Near-Bottom Containment** | 6 configurations (768, 820, 1024 × Light/Dark) | Flips `.is-above`, clamps `maxHeight`, strictly contained | Flips `.is-above`, $top \ge 0$, $bottom \le vh$, zero clipping | **PASS** |

---

## 2. Compact Account Trigger Target Measurement & Free Width Audit

### 2.1 Full Viewport & Theme Measurement Matrix

Target element: `header button[aria-haspopup="menu"][aria-label^="Tài khoản"]` (`.account-menu__trigger`).
Points on a 44×44px box centered on trigger center $(cx, cy)$ were sampled along all 4 perimeter edges (176 points) and across a 1px dense 2D grid (2025 points) using `document.elementFromPoint`.

| Viewport | Theme | Bounding Box | Center $(cx, cy)$ | Effective Hit Area | Nearest Neighbour Gap | Viewport Right Margin | Header Natural Width | Header Free Width | 44px Target Met |
|---|---|---|---|---|---|---|---|---|---|
| **320×720** | Light | 40 × 40 px [280, 7.5, 320, 47.5] | (300, 27.5) | 39 × 40 px | 0 px (`usage-chip__trigger` [240, 280]) | 0 px | 282 px | **38 px** | **NO** (0/176) |
| **320×720** | Dark | 40 × 40 px [280, 7.5, 320, 47.5] | (300, 27.5) | 39 × 40 px | 0 px (`usage-chip__trigger` [240, 280]) | 0 px | 282 px | **38 px** | **NO** (0/176) |
| **375×812** | Light | 40 × 40 px [327, 7.5, 367, 47.5] | (347, 27.5) | 40 × 40 px | 4 px (`usage-chip__trigger` right: 323) | 8 px | 364 px | **11 px** | **NO** (0/176) |
| **375×812** | Dark | 40 × 40 px [327, 7.5, 367, 47.5] | (347, 27.5) | 40 × 40 px | 4 px (`usage-chip__trigger` right: 323) | 8 px | 364 px | **11 px** | **NO** (0/176) |
| **390×844** | Light | 40 × 40 px [342, 7.5, 382, 47.5] | (362, 27.5) | 40 × 40 px | 4 px (`usage-chip__trigger` right: 338) | 8 px | 364 px | **26 px** | **NO** (0/176) |
| **390×844** | Dark | 40 × 40 px [342, 7.5, 382, 47.5] | (362, 27.5) | 40 × 40 px | 4 px (`usage-chip__trigger` right: 338) | 8 px | 364 px | **26 px** | **NO** (0/176) |
| **768×1024** | Light | 40 × 40 px [720, 7.5, 760, 47.5] | (740, 27.5) | 40 × 40 px | 4 px (`usage-chip__trigger` right: 716) | 8 px | 364 px | **404 px** | **NO** (0/176) |
| **768×1024** | Dark | 40 × 40 px [720, 7.5, 760, 47.5] | (740, 27.5) | 40 × 40 px | 4 px (`usage-chip__trigger` right: 716) | 8 px | 364 px | **404 px** | **NO** (0/176) |
| **820×1180** | Light | 40 × 40 px [772, 7.5, 812, 47.5] | (792, 27.5) | 40 × 40 px | 4 px (`usage-chip__trigger` right: 768) | 8 px | 364 px | **456 px** | **NO** (0/176) |
| **820×1180** | Dark | 40 × 40 px [772, 7.5, 812, 47.5] | (792, 27.5) | 40 × 40 px | 4 px (`usage-chip__trigger` right: 768) | 8 px | 364 px | **456 px** | **NO** (0/176) |
| **1024×768** | Light | 40 × 40 px [976, 7.5, 1016, 47.5] | (996, 27.5) | 40 × 40 px | 4 px (`usage-chip__trigger` right: 972) | 8 px | 380 px | **644 px** | **NO** (0/176) |
| **1024×768** | Dark | 40 × 40 px [976, 7.5, 1016, 47.5] | (996, 27.5) | 40 × 40 px | 4 px (`usage-chip__trigger` right: 972) | 8 px | 380 px | **644 px** | **NO** (0/176) |

### 2.2 Hit Area & Perimeter Failure Root Cause
- The trigger button is enforced by `FE/src/index.css:1176` via:
  ```css
  .account-menu__trigger { width: 40px !important; min-width: 40px; height: 40px !important; padding: 0 !important; justify-content: center !important; }
  ```
- Because the button is physically 40×40px without hit target expansion (`::before` / padding offset), any point beyond distance 20px from center resolves to `header.workspace-global-header`, the adjacent `.usage-chip__trigger`, or falls off the viewport boundary (at 320px).
- In the 44×44px perimeter test, 0 of 176 sampled points resolve to the Account button (0.0%).
- In the 2D grid test, 1322 of 2025 points resolve (65.3%), representing only the inner circle/square of the 40px boundary.

### 2.3 Feasibility Analysis: Can 44×44 Fit Without Reintroducing R8-001 Overflow?
**Yes, completely feasible across all viewports.**
1. **Vertical Space**: The header row has a fixed height of 56px (`height: 56px`). A 44px tall control centered vertically leaves exactly $(56 - 44) / 2 = 6\text{px}$ padding at top and bottom. No vertical expansion or height clipping occurs.
2. **Horizontal Space (Free Width Analysis)**:
   - At **320px**: The standalone library link is hidden (`@media (max-width: 340px) { ... .study-library-link { display: none !important; } }`). Total natural width of controls is 282px, leaving **38px of free width**. Expanding Account width from 40px to 44px consumes only 4px, leaving 34px of free width.
   - At **375px** (tightest mobile viewport where library link is present): Total natural width is 364px, leaving **11px of free width**. Expanding Account width from 40px to 44px consumes 4px, leaving **7px of free width** with zero overflow.
   - At **390px, 768px, 820px, 1024px**: Free width is 26px, 404px, 456px, and 644px respectively.
3. **Conclusion**: Expanding the Account control to 44×44px will **not** trigger horizontal overflow or break the single 56px row contract at any viewport.

### 2.4 Proposed CSS-Only Follow-Up (Recommendation Only — Not Applied)
To meet WCAG 2.5.5 / 2.5.8 while maintaining visual harmony and avoiding regression of R8-001:

```css
/* Proposed modification in FE/src/index.css */
@media (max-width: 1100px) {
  /* Expand the account control target to 44x44px */
  .account-menu__trigger {
    width: 44px !important;
    min-width: 44px !important;
    height: 44px !important;
    padding: 0 !important;
    justify-content: center !important;
  }
}

@media (max-width: 340px) {
  /* Maintain 4px separation from the usage chip at 320px */
  .workspace-header-actions {
    gap: 4px !important;
  }
}
```
*Rationale*:
- At 320px, total actions width = 40px (usage) + 4px (gap) + 44px (account) = 88px. Left content = 200px. Total = 288px < 320px (leaves 32px free space).
- At 375px, total content = 368px < 375px (leaves 7px free space).
- Completely solves the 44px hit-target requirement with 0px overflow risk.

---

## 3. Defect R8-001 Survival Verification

| Check | Viewport / Theme | Expected | Observed | Verdict |
|---|---|---|---|---|
| **One 56px row** | 320px (Light & Dark) | Height = 56px | Height = 56px | **PASS** |
| **Zero doc/header overflow** | 320px (Light & Dark) | `scrollWidth <= clientWidth` | Doc: 320 $\le$ 320, Header: 320 $\le$ 320 | **PASS** |
| **One 56px row** | 1024px (Light & Dark) | Height = 56px | Height = 56px | **PASS** |
| **Zero doc/header overflow** | 1024px (Light & Dark) | `scrollWidth <= clientWidth` | Doc: 1024 $\le$ 1024, Header: 1024 $\le$ 1024 | **PASS** |
| **Account control operability** | 320px & 1024px | Center hit returns button; click opens menu | Center hit = true; menu opens; contained within viewport | **PASS** |
| **Compact theme switch operability** | 320px & 1024px | Theme toggle item visible in StudyToolsMenu; toggles theme | Item found; toggles `<html>.dark` class and `localStorage("memvid-theme")` | **PASS** |

Screenshots generated:
- `screenshots/header-320-light.png`
- `screenshots/header-320-dark.png`
- `screenshots/header-1024-light.png`
- `screenshots/header-1024-dark.png`

---

## 4. Defect R8-005 Survival Verification (Tablet Popover)

Tested on `/round6-library-qa.html` across 768×1024, 820×1180, and 1024×768 in both light and dark themes.

### 4.1 Target Sizing ($\ge 44\text{px}$)
- Total actions audited per popover: **11 actions** (Gia sư AI, Đọc tóm tắt, Luyện tập Quiz, Ôn tập ngắt quãng, Sơ đồ tư duy, Xem StudyMap, Chi tiết tài liệu, và 4 quản lý tác vụ).
- Action height measurement across all 6 configurations:
  * Minimum height: **44.0 px**
  * Maximum height: **44.0 px**
  * Sample action: `Tóm tắt (44px)`
- Verdict: **PASS** (100% of popover action controls satisfy $\ge 44\text{px}$ target height).

### 4.2 Near-Bottom Containment & Upward Flip
- Triggered on bottom-edge document rows:
  * **768×1024**: Popover top: 171px, bottom: 708px ($vh=1024$). `.is-above` applied, `maxHeight` clamped to 706.188px.
  * **820×1180**: Popover top: 261px, bottom: 798px ($vh=1180$). `.is-above` applied, `maxHeight` clamped to 796.188px.
  * **1024×768**: Popover top: 2px, bottom: 528px ($vh=768$). `.is-above` applied, `maxHeight` clamped to 526.188px.
- In all tested configurations:
  * $top \ge 0$
  * $bottom \le window.innerHeight$
  * Viewport clipping: **0px**
- Verdict: **PASS**.

Screenshots generated:
- `screenshots/library-popover-768.png`, `screenshots/library-bottom-containment-768.png`
- `screenshots/library-popover-820.png`, `screenshots/library-bottom-containment-820.png`
- `screenshots/library-popover-1024.png`, `screenshots/library-bottom-containment-1024.png`
