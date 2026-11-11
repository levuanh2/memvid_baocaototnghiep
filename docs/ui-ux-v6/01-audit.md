# V6 audit — live site and frontend bug inventory

Baseline: `origin/main` `db005ab` (2026-11-11). Live audit: https://studymap.space in Chrome at a 1496×702 window, light theme, signed in as the QA browser account (4 documents). Read-only: nothing was uploaded, generated or deleted.

Classes used: **BUG CONFIRMED**, **DESIGN DEFECT**, **ACCESSIBILITY**, **UNVERIFIED**. A finding is "confirmed" only when it was seen in the browser or traced in code with a concrete reproduction.

## 1. Screens reached

| Screen | Route | Reached on live | Notes |
|---|---|---|---|
| Landing | `/` | yes | |
| Workspace: chat | `/app` | yes | empty conversation only |
| Workspace: mind map | `/app?tab=mindmap` | yes | existing map rendered |
| Workspace: summary | `/app?tab=summary` | yes | empty state only |
| Study tools menu | header | yes | Gia sư AI, Dòng thời gian, Kiến thức |
| Command palette | Ctrl+K | yes | |
| Library | `/app/study` | yes | |
| Profile | `/app/profile` | yes | |
| Login, Register | `/login`, `/register` | no | browser was signed in; not signed out to avoid ending the owner's session |
| Knowledge map, Quiz setup/taking/result, Review, Practice | `/app/study/...` | no | covered by fixture specs, not re-audited live in this pass |

## 2. Findings from the browser

| # | Screen | Finding | Class | Evidence |
|---|---|---|---|---|
| L1 | Landing | Feature names are internal: "Summary v2", "Mindmap v3", "Background Queue", "Source-grounded Answer", "Job nền" | DESIGN DEFECT | page text; `evidence/before/landing-1440-light.png` |
| L2 | Landing | The same five capabilities are listed three times (solutions, four steps, feature list) | DESIGN DEFECT | same capture |
| L3 | Landing | Quiz, review, knowledge map and the library are not mentioned at all, although they are half of the product | DESIGN DEFECT | page text |
| L4 | Landing | The hero illustration is grey placeholder bars; it shows no product content | DESIGN DEFECT | same capture |
| L5 | Landing | The chat sample is about a water filter, not a study document | DESIGN DEFECT | same capture |
| W1 | Chat | On load, the source panel says "0 tài liệu" and "Chưa có tài liệu nào", and the chat shows the first-upload call to action, for an account that has 4 documents. It corrects itself once `/list-indexed` answers (several seconds on the live backend) | BUG CONFIRMED (misleading empty state while loading) | live screenshot at 4s after navigation, then 4 documents listed |
| W2 | Summary | Empty state shows a disabled primary button with two lines of explanation ("Chưa chọn tài liệu nào", "Chọn tài liệu bên trái trước") | DESIGN DEFECT | live screenshot |
| W3 | Header | Seven separate controls at 1496px: library link, three mode tabs, study tools, shortcuts, two theme buttons, usage, account | DESIGN DEFECT (density) | live screenshot; to be resolved with the action inventory |
| W4 | Palette | Opens with the advanced search panel expanded above an empty result list | DESIGN DEFECT | live screenshot |
| S1 | Library | Skeleton stayed for more than 4 seconds before content | UNVERIFIED (backend latency, not measured) | live screenshots |
| S2 | Library | A document card carries a primary button, four secondary buttons, six status chips, a details toggle and a menu | DESIGN DEFECT (density) | live screenshot |
| P1 | Profile | One card with three fields and a large empty page | DESIGN DEFECT | live screenshot |

No console errors were recorded on `/app`, `/app/study` or `/app/profile` (console capture started after first load, so load-time errors are not covered).

## 3. Frontend bug inventory (code review)

Source: Codex read-only review of `FE/src/**` at `db005ab` (static control-flow review; none of these has a failing test yet). Full reproductions and proposed fixes are in the QA workspace report `v6/results/task1-codex-bughunt.md`.

| # | Sev | File | Finding | Class |
|---|---|---|---|---|
| 1 | P1 | `Layout/ChatArea.jsx` | A cancelled chat attempt can resume and overwrite the next attempt (one shared `cancelledRef`) | BUG CONFIRMED (by reading) |
| 2 | P1 | `Layout/SidebarLeft.jsx` | An upload that finishes after the panel unmounts starts a status poller nobody owns | BUG CONFIRMED (by reading) |
| 3 | P1 | `Layout/SidebarRight.jsx` | Mind map / summary start responses can start pollers after unmount | BUG CONFIRMED (by reading) |
| 4 | P1 | `study/StudyMapView.jsx` | Changing document while loading can show the previous document's map | BUG CONFIRMED (by reading) |
| 5 | P1 | `study/ReviewGuide.jsx` | "Luyện ngay" can be double-submitted in one tick | BUG CONFIRMED (by reading) |
| 6 | P1 | `study/Practice.jsx` | Practice submission can be graded twice | BUG CONFIRMED (by reading) |
| 7 | P2 | `study/StudyMapView.jsx` | Knowledge map nodes are pointer-only (no focus, role or key handler) | ACCESSIBILITY |
| 8 | P2 | `study/StudyMapView.jsx` | "Dựng sơ đồ kiến thức" can enqueue duplicate jobs | BUG CONFIRMED (by reading) |
| 9 | P2 | `study/StudyMapView.jsx` | Image export can download twice | BUG CONFIRMED (by reading) |
| 10 | P2 | `mindmap/AppearanceEditorDrawer.jsx` | "Áp dụng" can send two competing PATCH requests | BUG CONFIRMED (by reading) |
| 11 | P2 | `Layout/ChatArea.jsx` | Review-resume polling cannot be cancelled and survives unmount | BUG CONFIRMED (by reading) |
| 12 | P2 | `Layout/SidebarLeft.jsx` | Source list refreshes are unordered; a 500ms timer outlives the component | BUG CONFIRMED (by reading) |
| 13 | P2 | `Layout/SidebarRight.jsx` | Library refreshes can roll back newer mind map / summary lists | BUG CONFIRMED (by reading) |
| 14 | P2 | `study/QuizTaking.jsx` | A slow load of quiz A can attach A's attempt to quiz B's URL | BUG CONFIRMED (by reading) |
| 15 | P3 | `Layout/SidebarLeft.jsx` | Escape in the filter popover or row menu drops focus to `<body>` | ACCESSIBILITY |

"Confirmed (by reading)" means the race is visible in the code path; each one still needs a failing regression test before its fix, as Phase 4 requires.

## 4. Not audited yet

- Action inventory and duplicate matrix (agy, in progress).
- The eight end-to-end journeys in Phase 2.3.
- Responsive pass of the signed-in app at 320–1920px (only the landing has before/after captures).
