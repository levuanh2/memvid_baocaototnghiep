# ROUND 8.4B Report: Real Touch Selection on Mobile MindMap (390px)

**Worktree:** `E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch` (detached at `origin/main 2479a32`)  
**Target Spec:** `FE/e2e-fixture/mobile-touch-selection.spec.js`  
**Port Used:** `5341` (`E2E_FIXTURE_PORT=5341`)  
**Product Code:** Untouched (`FE/src/` completely clean)  
**Git Commit / Push:** NOT RUN (by policy; Claude integrates files)

---

## 1. Touch Capabilities Verification

From the browser page evaluation during test execution:
- `navigator.maxTouchPoints`: **`1`** (verified `> 0`)
- `window.matchMedia('(pointer: coarse)').matches`: **`true`**
- Context parameters active in Chromium:
  ```javascript
  {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3
  }
  ```
- Console log: `[TOUCH-CAPS] maxTouchPoints=1, pointerCoarse=true`

---

## 2. Test Flow & Assertions

1. **Open Fixture:** Loads `/fixture-harness.html` (`fixture-map-a`), verifies harness root and root node.
2. **Enter Selection Mode:** Clicks `[aria-label="Xuất sơ đồ"]`, selects `selected_branches` scope, clicks `.export-inline-action`, verifies `.mm-selection-bar`.
3. **Touch-Realistic Pan:** Panned canvas by `dx = 550, dy = 100` via canvas background pointer drag to bring target branch leaf markers `fixture-map-a-m0-s0-l0` and `fixture-map-a-m0-s0-l1` into viewport without toolbar occlusion.
4. **Occlusion Check:** Asserted `document.elementFromPoint(cx, cy)` at each marker centre hits the marker (not intercepted by `.mm-floating-toolbar`, `.mm-selection-bar`, or header).
5. **Real Touch Taps:**
   - Tap 1: `await marker1.tap()` -> `aria-checked="true"`, selection bar: `"1 node đã tick"`.
   - Tap 2: `await marker2.tap()` -> `aria-checked="true"`, selection bar: `"2 node đã tick"`.
6. **Exact Node Membership Assertions:**
   - Checked marker node IDs: `["fixture-map-a-m0-s0-l0", "fixture-map-a-m0-s0-l1"]` (exact match).
7. **Document Invariants:**
   - `scrollWidth <= innerWidth` (`horizontalOverflow === false`).
   - `window.scrollY === initialScrollY` (`0`).
   - `.mm-selection-bar` bounding box fully inside `[0, 0, 390, 844]`.
8. **Export Studio Confirmation:**
   - Clicks "Tiếp tục" on selection bar to open Export Studio dialog.
   - Asserts scope radio is `selected_branches`.
   - Asserts dialog and footer summary: `"2 node đã chọn · 1 node cha tự thêm · 3 node được xuất"`.
   - Asserts configuration summary (`dl[aria-label="Tóm tắt cấu hình xuất"]`): `"3 node"`.
   - Asserts preview stats (`.export-preview__stats`): `"3 node"`.
   - Asserts export footer and controls are inside viewport.

---

## 3. Test Execution Runs & Pass Counts

### Run 1: 5-Repeat Execution (`--repeat-each=5 --workers=1`)
**Exact Command:**
```powershell
cd "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\FE"
$env:E2E_FIXTURE_PORT=5341; npx playwright test -c playwright.fixture.config.js e2e-fixture/mobile-touch-selection.spec.js --workers=1 --repeat-each=5
```

**Results (5 individual repeats):**
- Repeat 1: **PASS** (5.3s)
- Repeat 2: **PASS** (3.6s)
- Repeat 3: **PASS** (3.7s)
- Repeat 4: **PASS** (3.6s)
- Repeat 5: **PASS** (3.6s)
- **Total:** **5 passed (27.0s)**

---

### Run 2: Multi-Spec Suite Run (No Repeat, `--workers=1`)
**Exact Command:**
```powershell
cd "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\FE"
$env:E2E_FIXTURE_PORT=5341; npx playwright test -c playwright.fixture.config.js e2e-fixture/mobile-touch-selection.spec.js e2e-fixture/branch-export-visual.spec.js e2e-fixture/marker-click-resolution.spec.js --workers=1
```

**Results (10 tests total):**
- `branch-export-visual.spec.js`:
  - `visual 1440x1024-light`: **PASS** (8.1s)
  - `visual 1440x1024-dark`: **PASS** (4.9s)
  - `visual 1024x768-light`: **PASS** (4.5s)
  - `visual 1024x768-dark`: **PASS** (4.8s)
  - `visual 390x844-light`: **PASS** (4.0s)
  - `visual 390x844-dark`: **PASS** (4.2s)
- `marker-click-resolution.spec.js`:
  - `real click on each visible dot toggles only that branch at 1440px`: **PASS** (27.4s)
  - `real click on each visible dot toggles only that branch at 1024px`: **PASS** (27.6s)
  - `real click on each visible dot toggles only that branch at 390px`: **PASS** (17.0s)
- `mobile-touch-selection.spec.js`:
  - `real touch selection on mobile 390px MindMap`: **PASS** (4.3s)
- **Total:** **10 passed (1.9m)**

---

## 4. Negative Control (Proving Test Meaningfulness)

**Mutation applied:**  
In Step 7, substituted tapping the second branch (`marker2.tap()`) with tapping `marker1` again (unticking it instead of selecting branch 2), while asserting that `marker2` is checked:
```javascript
// Negative control: tap marker1 again instead of selecting branch 2
await marker1.tap();
await expect(marker2).toHaveAttribute("aria-checked", "true");
```

**Negative Control Output & Exact Failure Message:**
```text
  1) [chromium] › e2e-fixture\mobile-touch-selection.spec.js:64:1 › real touch selection on mobile 390px MindMap 

    Error: expect(locator).toHaveAttribute(expected) failed

    Locator:  locator('me-export-check[data-node-id="fixture-map-a-m0-s0-l1"]')
    Expected: "true"
    Received: "false"
    Timeout:  10000ms

    Call log:
      - Expect "toHaveAttribute" locator('me-export-check[data-node-id="fixture-map-a-m0-s0-l1"]') with timeout 10000ms
      - waiting for locator('me-export-check[data-node-id="fixture-map-a-m0-s0-l1"]')
        23 × locator resolved to <me-export-check tabindex="0" role="checkbox" data-side="left" aria-checked="false" data-node-id="fixture-map-a-m0-s0-l1" aria-label="Chọn node: Ví dụ cụ thể: nguyên lý">…</me-export-check>
           - unexpected value "false"

      121 |   // 7. Negative control: tap wrong marker (marker1 again, unticking it instead of selecting branch 2)
      122 |   await marker1.tap();
    > 123 |   await expect(marker2).toHaveAttribute("aria-checked", "true");
          |                         ^

  1 failed
    [chromium] › e2e-fixture\mobile-touch-selection.spec.js:64:1 › real touch selection on mobile 390px MindMap
```

The test was restored immediately to its valid form (`await marker2.tap();`) and re-verified passing cleanly (`1 passed (10.9s)`).

---

## 5. Comment Fix in `branch-export-visual.spec.js`

In `FE/e2e-fixture/branch-export-visual.spec.js` lines 86-87:
- **Before:**
  ```javascript
  // Real clicks on markers that are inside the viewport (at 390px the canvas may
  // start panned, so some markers sit off-screen until the user pans).
  ```
- **After:**
  ```javascript
  // Keyboard (Space) selection on markers by stable node IDs (at 390px the canvas may
  // start panned, so some markers sit off-screen until the user pans).
  ```
- **Status:** Applied. Pure comment fix, no logic altered.

---

## 6. Screenshots Path & Manifest

All captured visual artifacts are stored in:
`E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\FE\qa-artifacts\mobile-touch-selection\`

1. `01-selection-mode.png` (695 KB) — Selection bar visible on canvas after entering selection mode.
2. `02-after-pan.png` (832 KB) — Target branches panned into clear, unoccluded view.
3. `03-first-branch-tapped.png` (850 KB) — `fixture-map-a-m0-s0-l0` tapped via `locator.tap()`, selection bar shows "1 node đã tick".
4. `04-two-branches-tapped.png` (850 KB) — Both `m0-s0-l0` and `m0-s0-l1` tapped, selection bar shows "2 node đã tick".
5. `05-export-dialog-confirmed.png` (391 KB) — Export Studio open, confirming exact membership: "2 node đã chọn · 1 node cha tự thêm · 3 node được xuất".

---

## 7. Status & Non-Run Items

- **`FE/src` edits:** NOT RUN (0 product code files modified).
- **`git commit` / `git push`:** NOT RUN (per explicit instruction).
- **Other ports:** Port 5341 was used exclusively; ports 5199 and 5311 were untouched.
- **Background processes:** Only processes started during this task were managed; all killed on completion.
