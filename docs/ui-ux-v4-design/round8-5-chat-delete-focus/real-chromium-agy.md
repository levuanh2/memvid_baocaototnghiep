# Round 8.5 Real-App Destructive Dialogs Verification Report

**Author / Runner:** Agy (Round 8.5 Real-App Chromium QA)  
**Date:** 2026-11-02  
**Target Branch / Commit:** `fix/studymap-v4-chat-delete-focus` at `9b09814` (`E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/r85-chat-delete-focus`)  
**Frontend Build Tested:** Production build from `r85-chat-delete-focus/FE` (`npx vite build --outDir E:/memvid_NCKH/r85-agy-chat/dist --emptyOutDir` with `VITE_API_URL='http://127.0.0.1:8380'`), served on `http://localhost:4483`  
**Backend:** Real (Flask+Postgres) — Real Flask (`BE/scripts/run_e2e_server.py`, port 8380) + disposable Postgres container (`localhost:55432/studymap_test`, `r82-pg`) with `AUTH_PROTECT_APP_APIS=true` and `CONVERSATION_CONTEXT_ENABLED=true`  
**Heavy Lock:** `E:/memvid_NCKH/r84-heavy.lock` (acquired "agy", verified released)  
**Spec Location:** Copied outside `FE/` to `E:/memvid_NCKH/r85-agy-chat/destructive-dialogs.spec.js` (Playwright config: `E:/memvid_NCKH/r85-agy-chat/playwright.config.js`)  
**Run Count:** 2 test runs executed against real stack, 2/2 passed on all runs (Run 1: 17.2s, Run 2: 14.0s)  

---

## Executive Summary

| Dialog | Surface / File | Trigger Accessible | Focus Enters (1) | Escape Cancels (2) | 0 Non-GET on Cancel (3) | Focus on Cancel (4) | Confirm 1 Req (5) | Failure 500 State (6) | Contrast Light + Dark >=4.5:1 (7) | Verdict |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Clear Chat History** (R84-A11Y-02 Fix) | Chat (`ChatArea.jsx`) | Yes (Kebab menu click) | **PASS** | **PASS** | **PASS** | **PASS** (returns to menu button after Escape AND after Huỷ, never `<body>`) | **PASS** (exactly 1 `DELETE`, double-click safe, focuses composer) | **PASS** (alert renders, Escape returns to menu button) | **PASS** (Dark: 11.7 / 6.87 / 6.87; Light: 13.9 / 5.0 / 5.0) | **PASS** |
| **Collection Delete** (Regression) | Library (`DocumentList.jsx`) | Yes (Tab + Enter) | **PASS** | **PASS** | **PASS** | **PASS** (returns to trigger `button "Xoá"`) | **PASS** (exactly 1 `DELETE`, item removed from API) | **PASS** (alert renders, stays open) | **PASS** (Dark: 11.7 / 6.87 / 6.87; Light: 13.9 / 5.0 / 5.0) | **PASS** |

---

## Detailed Check-by-Check Results

### 1. Clear Chat History Dialog (`src/components/Layout/ChatArea.jsx` — R84-A11Y-02 Verification)

- **Trigger:** Chat header menu toggle `button[aria-label="Tùy chọn cuộc trò chuyện"]` -> menu item `button:has-text("Xóa lịch sử chat")`.
- **Seeding:** User posted query `"Xin chào hệ thống StudyMap"`, received streaming response `"mock answer"`.

| Check # | Description | Expected | Observed | Status |
|:---:|---|---|---|:---:|
| **1** | Focus enters dialog on open | Focus inside `[role="dialog"]` | Focused: `button[aria-label="Đóng hộp thoại"].icon-btn.w-8 ""` (`focusEnters: true`) | **PASS** |
| **2** | Escape cancels dialog | Dialog closes immediately | Dialog hidden upon pressing `Escape` | **PASS** |
| **3** | Zero destructive / non-GET requests on cancel | 0 non-GET requests in network log | Network slice on Escape: `[]`<br>Network slice on Huỷ: `[]` | **PASS** |
| **4** | Focus lands after cancel (Escape AND Huỷ button) | Focus returns to `button[aria-label="Tùy chọn cuộc trò chuyện"]`, NOT `<body>` | **After Escape:** `focus= button[aria-label="Tùy chọn cuộc trò chuyện"].icon-btn.w-10 ""` (`isMenuFocused: true`, `isBody: false`)<br>**After Huỷ button:** `focus= button[aria-label="Tùy chọn cuộc trò chuyện"].icon-btn.w-10 ""` (`isMenuFocused: true`, `isBody: false`) | **PASS** |
| **5** | Confirm deletion (double-click safety) | Exactly one `DELETE /conversations/<id>`, chat cleared, focus lands on composer | Double-click (`dblclick`): Exactly 1 request: `['DELETE /conversations/ba96b866-8155-4502-aa9b-2f74c2daec66']`.<br>Message count reduced to 0.<br>Focus landed on: `textarea.w-full.bg-transparent ""` (`isComposerFocused: true`). | **PASS** |
| **6** | Failure state handling (500) and recovery | Dialog stays open, `p[role="alert"]` visible, then Escape returns focus to menu button | 500 error triggered.<br>Alert rendered: `"Không xóa được lịch sử chat trên máy chủ. Lịch sử vẫn còn, hãy thử lại."`.<br>Dialog remained visible.<br>Escape pressed -> Dialog closed, focus returned to: `button[aria-label="Tùy chọn cuộc trò chuyện"].icon-btn.w-10 ""` (`isMenuFocused: true`). | **PASS** |
| **7** | Contrast in BOTH Dark and Light modes (>= 4.5:1) | Title, consequence, acknowledgement >= 4.5:1 | **Dark Mode:**<br>- Title: **11.7:1** (fg: `rgb(236, 231, 219)`, bg: `rgb(27, 42, 65)`)<br>- Consequence: **6.87:1** (fg: `rgb(169, 180, 194)`, bg: `rgb(27, 42, 65)`)<br>- Ack: **6.87:1** (fg: `rgb(169, 180, 194)`, bg: `rgb(27, 42, 65)`)<br>**Light Mode:**<br>- Title: **13.9:1** (fg: `rgb(16, 42, 93)`, bg: `rgb(255, 255, 255)`)<br>- Consequence: **5.0:1** (fg: `rgb(91, 112, 150)`, bg: `rgb(255, 255, 255)`)<br>- Ack: **5.0:1** (fg: `rgb(91, 112, 150)`, bg: `rgb(255, 255, 255)`) | **PASS** |

---

### 2. Collection Delete Dialog (`src/pages/study/DocumentList.jsx` — Regression Verification)

- **Trigger:** Reached via Tab key navigation inside collection edit popover: `button.ml-auto.text-caption "Xoá"`, opened with `Enter`.
- **Seeding:** Seeded two collections via API `POST /api/collections` (`Bộ sưu tập Alpha...` and `Bộ sưu tập Beta...`).

| Check # | Description | Expected | Observed | Status |
|:---:|---|---|---|:---:|
| **1** | Focus enters dialog on open | Focus inside `[role="dialog"]` | Focused: `button[aria-label="Đóng hộp thoại"].icon-btn.w-8 ""` (`focusEnters: true`) | **PASS** |
| **2** | Escape cancels dialog | Dialog closes immediately | Dialog hidden upon pressing `Escape` | **PASS** |
| **3** | Zero destructive / non-GET requests on cancel | 0 non-GET / DELETE requests | Network slice on Escape: `[]` | **PASS** |
| **4** | Focus lands after cancel | Restored to trigger `button "Xoá"` | `button.ml-auto.text-caption "Xoá"` (`restoredToTrigger: true`) | **PASS** |
| **5** | Confirm deletion | Exactly one `DELETE /api/collections/<id>`, item removed from API | Network: `['DELETE /api/collections/e3cc6ae9-2f72-44fe-a571-7b31c26ada7c']`.<br>Item deleted from backend API. | **PASS** |
| **6** | Failure state handling (500) | Dialog stays open, `p[role="alert"]` visible, item preserved | Server returned 500 `{"error": "Lỗi máy chủ mẫu"}`.<br>Alert rendered: `"Lỗi máy chủ mẫu"`.<br>Dialog remained visible. | **PASS** |
| **7** | Contrast in BOTH Dark and Light modes (>= 4.5:1) | Title, consequence, acknowledgement >= 4.5:1 | **Dark Mode:**<br>- Title: **11.7:1** (fg: `rgb(236, 231, 219)`, bg: `rgb(27, 42, 65)`)<br>- Consequence: **6.87:1** (fg: `rgb(169, 180, 194)`, bg: `rgb(27, 42, 65)`)<br>- Ack: **6.87:1** (fg: `rgb(169, 180, 194)`, bg: `rgb(27, 42, 65)`)<br>**Light Mode:**<br>- Title: **13.9:1** (fg: `rgb(16, 42, 93)`, bg: `rgb(255, 255, 255)`)<br>- Consequence: **5.0:1** (fg: `rgb(91, 112, 150)`, bg: `rgb(255, 255, 255)`)<br>- Ack: **5.0:1** (fg: `rgb(91, 112, 150)`, bg: `rgb(255, 255, 255)`) | **PASS** |

---

## Exact Environment Commands

```powershell
# 1. Acquire heavy lock
Set-Content -Path "E:\memvid_NCKH\r84-heavy.lock" -Value "agy"

# 2. Build production frontend from fix/studymap-v4-chat-delete-focus (9b09814)
cd "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r85-chat-delete-focus\FE"
$env:VITE_API_URL='http://127.0.0.1:8380'
npx vite build --outDir "E:\memvid_NCKH\r85-agy-chat\dist" --emptyOutDir

# 3. Start real backend on port 8380 (Real Flask + Postgres)
cd "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\BE"
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:55432/studymap_test"
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:55432/studymap_test"
$env:SKIP_MODEL_LOAD="1"
$env:MEMVID_DISABLE_LC_DEFAULTS="1"
$env:GUIDED_MINDMAP_V3_ENABLED="true"
$env:GUIDED_JOB_STORE_BACKEND="sqlite"
$env:AUTH_PROTECT_APP_APIS="true"
$env:CONVERSATION_CONTEXT_ENABLED="true"
$env:PORT="8380"
python scripts/run_e2e_server.py

# 4. Serve production frontend on port 4483
npx serve -s "E:\memvid_NCKH\r85-agy-chat\dist" -l 4483

# 5. Execute Playwright E2E test suite (workers=1)
cd "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\FE"
npx playwright test -c playwright.r85.config.js --workers=1

# 6. Copy spec outside FE and clean up all temporary directories
Copy-Item "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\FE\e2e-r85-temp\destructive-dialogs.spec.js" "E:\memvid_NCKH\r85-agy-chat\destructive-dialogs.spec.js" -Force
Remove-Item -Recurse -Force "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\FE\e2e-r85-temp"
Remove-Item -Force "E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\r84-agy-touch\FE\playwright.r85.config.js"

# 7. Stop servers (8380 and 4483) and release heavy lock
Remove-Item -Force "E:\memvid_NCKH\r84-heavy.lock"
```

---

## Verification & Integrity Summary

1. **Stack Label:** **Real (Flask+Postgres)** — Tested against live backend running Flask with `studymap_test` in Postgres (`r82-pg` Docker container on port 55432), and production-bundled frontend on port 4483.
2. **Product Code Integrity:**
   - `E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/r85-chat-delete-focus`: **0 files modified**, working tree clean.
   - `E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/r84-agy-touch`: **0 product files modified**, all temporary runner dirs under `FE/` cleaned up.
   - **No git commits or pushes made.**
3. **Process & Lock Hygiene:**
   - Server processes on port 8380 and port 4483 stopped and verified closed.
   - `E:/memvid_NCKH/r84-heavy.lock` deleted after confirming ownership was `"agy"`.
