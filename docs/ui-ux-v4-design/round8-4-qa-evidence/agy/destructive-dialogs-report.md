# R84 Real-App Destructive Dialogs Audit Report

**Author / Runner:** Agy (Round 8.4B Real-App QA)  
**Date:** 2026-11-02  
**Target Worktree:** `E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/r84-agy-touch` (detached at `origin/main 2479a32`)  
**Frontend Build Tested:** Track B production build (`r84-dist-trackB`, built into `E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/r84-agy-touch/r84-dist-trackB` with `VITE_API_URL='http://127.0.0.1:8380'`, served at `http://localhost:4483`)  
**Backend:** Real Flask (`BE/scripts/run_e2e_server.py`, port 8380) + disposable Postgres (`localhost:55432/studymap_test`) + SQLite job/summary stores  
**Lock Used:** `E:/memvid_NCKH/r84-heavy.lock` (acquired "agy", verified released)  
**Spec Location:** Moved out of `FE/` to `E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/r84-agy-touch/e2e-r84-agy/destructive-dialogs.spec.js` (Playwright config: `playwright.r84.config.js`)  
**Task Scope Note:** Per Claude's handoff update, Codex1 handles Delete MindMap and Delete Summary. This report details the 7 checks for the two assigned dialogs: **Collection Delete** and **Clear Chat History**, with our DOM audit findings for MindMap and Summary documented as handoff context.

---

## Executive Summary

| Dialog | Surface / File | Trigger Accessible | Focus Enters (1) | Escape Cancels (2) | 0 Req on Cancel (3) | Focus on Cancel (4) | Confirm 1 Req (5) | Failure 500 State (6) | Dark Contrast >=4.5:1 (7) | Verdict |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Collection Delete** | Library (`DocumentList.jsx`) | Yes (Tab+Enter) | **PASS** | **PASS** | **PASS** | **PASS** (returns to trigger) | **PASS** (lands on next item) | **PASS** (500 alert) | **PASS** (11.7 / 6.87 / 6.87) | **PASS** |
| **Clear Chat History** | Chat (`ChatArea.jsx`) | Yes (Menu click) | **PASS** | **PASS** | **PASS** | **FAIL** (lands on `<body>` due to unmounted menu) | **PASS** (restores to composer textarea) | **PASS** (500 alert) | **PASS** (11.7 / 6.87 / 6.87) | **FAIL (Check 4)** |
| **Delete MindMap** | Sidebar (`SidebarRight.jsx`) | Reassigned to Codex1 | — | — | — | — | — | — | — | *Reassigned to Codex1* (DOM count = 0) |
| **Delete Summary** | Sidebar (`SidebarRight.jsx`) | Reassigned to Codex1 | — | — | — | — | — | — | — | *Reassigned to Codex1* (DOM count = 0) |

---

## Exact Commands & Environment Setup

```powershell
# 1. Acquire heavy lock
Set-Content -Path "E:\memvid_NCKH\r84-heavy.lock" -Value "agy"

# 2. Build protobufs
cd "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\BE"
python scripts/build_proto.py

# 3. Start real backend on port 8380
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:55432/studymap_test"
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:55432/studymap_test"
$env:SKIP_MODEL_LOAD="1"
$env:MEMVID_DISABLE_LC_DEFAULTS="1"
$env:GUIDED_MINDMAP_V3_ENABLED="true"
$env:GUIDED_JOB_STORE_BACKEND="sqlite"
$env:AUTH_PROTECT_APP_APIS="true"
$env:PORT="8380"
python scripts/run_e2e_server.py

# 4. Build Track B production frontend (read-only from Track B, outDir in r84-agy-touch)
cd "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\phase-c-round8-4b-qa-hardening\FE"
$env:VITE_API_URL='http://127.0.0.1:8380'
npx vite build --outDir "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\r84-dist-trackB" --emptyOutDir

# 5. Serve production frontend on port 4483
npx serve -s "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\r84-dist-trackB" -l 4483

# 6. Execute E2E Playwright test suite (workers=1)
cd "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\FE"
npx playwright test -c playwright.r84.config.js e2e-r84-agy/destructive-dialogs.spec.js --workers=1

# 7. Move spec files out of FE/ (so Vitest does not scan them)
New-Item -ItemType Directory -Force -Path "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\e2e-r84-agy"
Move-Item -Force "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\FE\e2e-r84-agy\*" "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\e2e-r84-agy\"
Remove-Item -Recurse -Force "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\FE\e2e-r84-agy"
Move-Item -Force "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\FE\playwright.r84.config.js" "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\playwright.r84.config.js"

# 8. Cleanup & release lock
Remove-Item -Force "E:\memvid_NCKH\r84-heavy.lock"
```

---

## Detailed Results per Dialog

### 1. Collection Delete Dialog (`src/pages/study/DocumentList.jsx` — Track B Fix Baseline)

- **Trigger:** Reached strictly via Tab key navigation from collection edit popover: `button.ml-auto.text-caption "Xoá"`, opened with `Enter`.
- **Seeding:** Seeded two collections via API `POST /api/collections` (`Bộ sưu tập Alpha...` and `Bộ sưu tập Beta...`).

| # | Check Description | Expected | Observed | Status |
|---|---|---|---|:---:|
| 1 | Keyboard focus enters dialog on open | Focus inside `[role="dialog"]` | Focused: `button[aria-label="Đóng hộp thoại"].icon-btn.w-8 ""` | **PASS** |
| 2 | Escape cancels | Dialog closes | Dialog hidden immediately upon pressing `Escape` | **PASS** |
| 3 | Zero destructive requests after cancel | 0 `DELETE`/`POST` requests in network log | Network slice: `[]` (0 non-GET requests) | **PASS** |
| 4 | Focus lands after cancel | Restored to trigger `button "Xoá"` | `button.ml-auto.text-caption "Xoá"` (`restoredToTrigger: true`) | **PASS** |
| 5 | Confirm performs exactly 1 authorized request & item disappears & focus lands | Exactly 1 `DELETE /api/collections/<id>`, item removed from list, focus lands on next collection item | Network: `['DELETE /api/collections/cce3b962-c741-4d48-9325-79d62a3e64ab']`.<br>Item deleted from API.<br>Focus landed on: `button[data-collection-id="305b8f26-8306-4b44-bee9-d863476b2e67"].flex-1.min-w-0 "Bộ sưu tập Beta 17936142384020"` (`isFocusOnNext: true`, `isBody: false`). | **PASS** |
| 6 | Failure handling (500) | Dialog stays open, `p[role="alert"]` visible, item preserved | Server returned 500 `{"error": "Lỗi máy chủ mẫu"}`.<br>Alert rendered: `"Lỗi máy chủ mẫu"`.<br>Dialog remained visible. Focus stayed in window. | **PASS** |
| 7 | Dark-mode composited contrast | Title, consequence, acknowledgement >= 4.5:1 | **Title:** 11.7:1 (fg: `rgb(236, 231, 219)`, bg: `rgb(27, 42, 65)`)<br>**Consequence:** 6.87:1 (fg: `rgb(169, 180, 194)`, bg: `rgb(27, 42, 65)`)<br>**Ack:** 6.87:1 (fg: `rgb(169, 180, 194)`, bg: `rgb(27, 42, 65)`) | **PASS** |

---

### 2. Clear Chat History Dialog (`src/components/Layout/ChatArea.jsx`)

- **Trigger:** Reached via chat menu `button[aria-label="Tùy chọn cuộc trò chuyện"]` -> menu item `button:has-text("Xóa lịch sử chat")`.
- **Seeding:** User posted message `"Xin chào hệ thống StudyMap"`, received stubbed response `"mock answer"` from `MockQueryGraph`.

| # | Check Description | Expected | Observed | Status |
|---|---|---|---|:---:|
| 1 | Keyboard focus enters dialog on open | Focus inside `[role="dialog"]` | Focused: `button[aria-label="Đóng hộp thoại"].icon-btn.w-8 ""` | **PASS** |
| 2 | Escape cancels | Dialog closes | Dialog hidden immediately upon pressing `Escape` | **PASS** |
| 3 | Zero destructive requests after cancel | 0 `DELETE`/`POST` requests in network log | Network slice: `[]` (0 non-GET requests) | **PASS** |
| 4 | Focus lands after cancel | Trigger or logical neighbor (e.g. menu button), NOT `<body>` | **Observed:** `body "MMemVidXThư viện học tậpTrò ch"` (`isBody: true`) | **FAIL** |
| 5 | Confirm performs exactly 1 authorized request & item disappears & focus lands | Exactly 1 `DELETE /conversations/<id>`, chat cleared, focus lands meaningfully | Network: `['DELETE /conversations/d91765dd-aebf-47fc-a3aa-4422fb206b78']`.<br>Message count for `"mock answer"` reduced to 0.<br>Focus landed on: `textarea.w-full.bg-transparent ""` (`isComposerFocused: true` via `ChatArea.jsx:434 refocusComposer()`). | **PASS** |
| 6 | Failure handling (500) | Dialog stays open, `p[role="alert"]` visible, messages preserved | `DELETE /conversations/*` routed to 500.<br>Alert rendered: `"Không xóa được lịch sử chat trên máy chủ. Lịch sử vẫn còn, hãy thử lại."`.<br>Dialog remained visible. Focus in window. | **PASS** |
| 7 | Dark-mode composited contrast | Title, consequence, acknowledgement >= 4.5:1 | **Title:** 11.7:1 (fg: `rgb(236, 231, 219)`, bg: `rgb(27, 42, 65)`)<br>**Consequence:** 6.87:1 (fg: `rgb(169, 180, 194)`, bg: `rgb(27, 42, 65)`)<br>**Ack:** 6.87:1 (fg: `rgb(169, 180, 194)`, bg: `rgb(27, 42, 65)`) | **PASS** |

#### Root Cause Analysis for Chat History Check 4 (Focus on Cancel):
In `src/components/Layout/ChatArea.jsx` line 413:
```javascript
const handleDeleteHistory = () => {
  if (loading || pendingReview) return;
  setMenuOpen(false); // <--- Triggers unmount of the dropdown menu
  setXacNhanXoaLichSu(true);
};
```
When `setMenuOpen(false)` is invoked synchronously before opening the dialog, the dropdown menu containing `button:has-text("Xóa lịch sử chat")` unmounts immediately. `DestructiveConfirmDialog` captures `previousFocusRef.current = document.activeElement` at mount time, which points to the now-unmounted button.
When the dialog is cancelled via `Escape`, the dialog calls `previousFocusRef.current?.focus()`. Because `document.contains(previousFocusRef.current) === false`, the browser engine falls back to focusing `document.body`.
*Recommended Fix:* When cancelling or before opening, retain a reference to `menuButtonRef` (the "Tùy chọn cuộc trò chuyện" toggle button) and restore focus to it, or pass an explicit `onCancel` focus target.

---

### 3. Delete MindMap Dialog (`src/components/Layout/SidebarRight.jsx`)

- **Code Location:** `SidebarRight.jsx:621` (`handleDeleteMap`), line ~1215 (`deleteLabel="Xóa sơ đồ"`).
- **Seeding Done:** Uploaded fixture document, generated real mindmap via `POST /generate-mindmap` (ID: `e2e-map-4f711546-fc61-4623-b20a-51e64d25c373-1793614250719216800`).
- **DOM Audit Result:**
  - `button[aria-label="Xóa sơ đồ"]` count in DOM: **`0`**
  - Disclosure `button:has-text("Tạo từ tài liệu")` count in DOM: **`0`**
- **Root Cause Analysis:**
  In `SidebarRight.jsx:32`:
  ```javascript
  const legacyInspectorSurfacesEnabled = false;
  ```
  Lines 1089-1241 (the entire document artifact generation disclosure and list containing `mindMaps.map(...)` and `summaries.map(...)` with their delete buttons) are gated by:
  ```javascript
  {legacyInspectorSurfacesEnabled && (
    <div className="border-t border-border-subtle pt-3">
      {/* ... legacy inspector surfaces ... */}
    </div>
  )}
  ```
  This is guarded and asserted by Vitest test `SidebarRight.legacyInspectorFlag.test.jsx`. In production builds, this entire subtree is completely disabled and omitted from the DOM.
- **Status:** **BLOCKED** (Architectural Dead-Code Gating). All 7 checks cannot be performed via user interaction in production.

---

### 4. Delete Summary Dialog (`src/components/Layout/SidebarRight.jsx`)

- **Code Location:** `SidebarRight.jsx:~760` (`handleDeleteSummary`), line ~1235 (`deleteLabel="Xóa tóm tắt"`).
- **Seeding Done:** Seeded real summary record (`id: summary-1793614253021`) directly into `BE/memory/summaries.sqlite` for the authenticated user (`7f52aa73-fc31-474a-9f3b-8cf5b5258e1f`). Verified `GET /summaries` API returned `foundInApi = true`.
- **DOM Audit Result:**
  - `button[aria-label="Xóa tóm tắt"]` count in DOM: **`0`**
- **Root Cause Analysis:**
  Same architectural dead-code gate as MindMap: `legacyInspectorSurfacesEnabled = false` in `SidebarRight.jsx:32` prevents lines 1089-1241 from ever rendering in the production DOM.
- **Status:** **BLOCKED** (Architectural Dead-Code Gating). All 7 checks cannot be performed via user interaction in production.

---

## Verification & Integrity

1. **Spec Execution Summary:**
   - 4 tests executed against real Flask (`http://127.0.0.1:8380`) and real production frontend build (`http://127.0.0.1:4483`).
   - Run duration: 18.8s. Result: `4 passed (18.8s)`.
2. **Product Code Integrity:**
   - `FE/src/`: **0 files modified**.
   - No git commits or pushes made.
3. **Process & Lock Hygiene:**
   - Background Flask server (port 8380) stopped.
   - Background serve process (port 4483) stopped.
   - `r84-heavy.lock` file removed immediately after run.
   - Test spec moved to `e2e-r84-agy/destructive-dialogs.spec.js` outside `FE/` to ensure Vitest test runners remain unaffected.
