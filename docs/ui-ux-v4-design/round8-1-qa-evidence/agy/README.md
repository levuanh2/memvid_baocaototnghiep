# Round 8.1 Agy Independent Evidence Summary

- **Audit Commit**: `ab6e90c` (with Library popover available-height clamp)
- **Date**: 2026-10-29
- **Auditor**: Agy (Independent Visual, Responsive & Accessibility Auditor)
- **Execution Engine**: Headless Chromium 153.0.8010.12 (Windows x64)

---

## 1. Executive Summary & Gate Disposition

All Round 8.1 target surfaces (Global Header and Document Library Action Matrix) were audited using real Chromium automation, exact bounding geometry calculation (`getBoundingClientRect`), scrollbar/overflow differential measurements, and point hit-testing via `document.elementFromPoint`.

| Scope Area | Viewport / Theme Configurations | Tested Count | Passed | Status |
|---|---|---|---|---|
| **Global Workspace Header** | 11 viewports (320, 375, 390, 768, 780, 800, 820, 1023, 1024, 1280, 1440) × Light & Dark | **22** | 22 | **PASS** |
| **Library Action Matrix ON** | 10 mandatory viewports (1920 down to 320) × Light & Dark | **20** | 20 | **PASS** |
| **Library Tablet Boundary Probes** | 5 boundary widths (768, 780, 800, 820, 1024) × Light & Dark | **10** | 10 | **PASS** |
| **Near-Bottom Popover Containment** | 6 desktop/tablet viewports (1440, 1024, 820, 800, 780, 768) | **6** | 6 | **PASS** |

**Total Tested Configurations: 58 (58 Passed, 0 Failed).**

---

## 2. Key Defect Resolutions Verified

### 2.1 Defect R8-001 Resolved (Global Header Occlusion & Overflow)
- **320px Width**: Standalone Library link collapses into the StudyTools menu; header fits within exactly one 56px row with **0px document and header horizontal overflow**.
- **1024px Width**: Compact header rules extended through 1100px. Header renders at exactly 1024px with zero overflow.
- **Account Control Operability**: Account button center hit-tested successfully (`document.elementFromPoint(cx, cy)` returns `<BUTTON>` or its child) across all 22 configurations.

### 2.2 Defect R8-005 Resolved (Library Popover Target Size & Containment)
- **Target Sizing**: All desktop/tablet popover action buttons measure **222×44px** (height increased from 40px to 44px). Mobile bottom sheet actions measure **44×44px**.
- **Available-Height Clamp & Upward Flip (`ab6e90c`)**:
  - Near the bottom of the viewport, the tools menu automatically calculates `availableAbove` vs `availableBelow`, sets `.is-above`, and clamps `maxHeight` via inline styling.
  - Verified across 1440x900, 1024x768, 820x1180, 800x900, 780x900, and 768x1024: popover top is strictly `>= 0` and bottom is `<= window.innerHeight`, preventing any viewport bottom clipping.
