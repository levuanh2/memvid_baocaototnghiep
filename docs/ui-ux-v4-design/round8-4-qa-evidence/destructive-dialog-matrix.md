# Destructive dialogs in the real app

| Item | Value |
|---|---|
| Source revision | Track B build: `origin/main` `2479a32` plus `fix/studymap-v4-round8-4-qa-hardening`, which includes the collection-focus fix |
| Environment | **Real.** Flask `run_e2e_server.py` with `AUTH_PROTECT_APP_APIS=true`, the Track B production build, disposable Postgres `r82-pg` and disposable SQLite artifact stores, Chromium, `--workers=1`. Disposable, freshly registered accounts only; no production |
| Runs | Agy: collection and chat history, `:8380`/`:4483`, 4 tests passed in 18.8 s (`agy/`). Codex1: map and summary, `:8180`/`:4273` (`codex1-dialogs/`). Both on 2026-11-02 |
| Review | Claude read both reports and specs. Agy and Codex1 each independently found the same map/summary blocker |

The 7 checks for each dialog:

1. Keyboard focus enters the dialog.
2. Escape cancels.
3. No destructive request is sent after cancelling.
4. Focus returns to a meaningful place, not `<body>`.
5. Confirming sends exactly one authorised request, the item disappears, and focus lands on a valid element.
6. A failed request (500, routed for that one request) leaves the dialog open with an error shown, and the item still exists.
7. In dark mode, the title, consequence and acknowledgement text reach a composited contrast of at least 4.5:1.

| Dialog | 1 | 2 | 3 | 4 | 5 | 6 | 7 | Result |
|---|---|---|---|---|---|---|---|---|
| **Delete collection** (Library) | PASS | PASS | PASS (0 non-GET) | PASS: back to "Xoá" | PASS: exactly 1 `DELETE /api/collections/<id>`; **focus moves to the next collection's filter button** (Round 8.4B fix) | PASS: alert "Lỗi máy chủ mẫu"; dialog open | PASS: 11.7 / 6.87 / 6.87 | **PASS** |
| **Clear chat history** (chat menu) | PASS | PASS | PASS (0 non-GET) | **FAIL: focus on `<body>`** | PASS: exactly 1 `DELETE /conversations/<id>`; messages cleared; focus on the composer | PASS: alert "Không xóa được lịch sử chat…"; history kept | PASS: 11.7 / 6.87 / 6.87 | **FAIL: R84-A11Y-02** |
| **Delete map** | — | — | — | — | — | — | — | **NOT APPLICABLE: no reachable trigger** |
| **Delete summary** | — | — | — | — | — | — | — | **NOT APPLICABLE: no reachable trigger** |

## R84-A11Y-02 (P2): focus is lost when "Xóa lịch sử chat" is cancelled

- **Where.** `FE/src/components/Layout/ChatArea.jsx:413-417`.
  `handleDeleteHistory` calls `setMenuOpen(false)` and then opens the dialog.
  The menu item that triggered it unmounts, so on Escape `Modal` has nothing to
  return focus to (`document.contains(prev)` is false), and focus falls to
  `<body>`. This is the same pattern as R82-A11Y-01.
- **Impact.** A keyboard or screen-reader user who cancels loses their place.
  There is no data risk: zero requests are sent and the history is kept.
- **Proposed fix (small, not applied in this round).** On cancel, after the
  dialog closes, focus the conversation-menu toggle
  (`button[aria-label="Tùy chọn cuộc trò chuyện"]`). Add a real-browser test,
  using Agy's spec as the template.
- **Owner and next action.** Frontend Chat: a correction PR.

## Map and summary deletion: NOT APPLICABLE, plus a product gap

Agy and Codex1 each seeded real artifacts on a fresh account. The map came
from `POST /generate-mindmap` and the summary from a disposable SQLite row.
The protected `GET /mindmaps` and `GET /summaries` returned both, yet the
rendered app has **0** `Xóa sơ đồ` and **0** `Xóa tóm tắt` buttons.

The cause is `FE/src/components/Layout/SidebarRight.jsx:32`, which sets
`legacyInspectorSurfacesEnabled = false`. That flag gates the only
saved-artifact list (lines 1089–1241), and the only two delete triggers are
inside it (`:1215` and `:1234`). `SidebarRight.legacyInspectorFlag.test.jsx`
asserts that the surface stays off. Neither agent forced React state, because
that would not be real-app evidence.

- The dialogs cannot run, so the 7 checks are **NOT APPLICABLE** to this
  release.
- **Product gap (decision).** Users cannot delete a saved mind map or summary
  from the current UI. Restore a supported saved-artifact management surface,
  or move the two triggers into the current information architecture. Then
  rerun the 7 checks. Do not just flip the legacy flag without product review.

## Evidence

- `agy/destructive-dialogs-report.md` and `agy/destructive-dialogs.spec.js`.
- `codex1-dialogs/map-summary-report.md`,
  `codex1-dialogs/destructive-map-summary-real.spec.js` and
  `codex1-dialogs/reachability.json`.
