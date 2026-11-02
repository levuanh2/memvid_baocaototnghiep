# Destructive confirm dialog in the real app

Owner: Claude. Run 2026-11-01 about 18:05Z.

| Item | Value |
|---|---|
| Tree | `c02e2b9` |
| Frontend | Production-equivalent build on `:4173` |
| Backend | Protected Flask on `:8080` |
| Database | Disposable Postgres |
| Browser | Chromium 1440×900, dark theme (`memvid-theme=dark` set before load) |
| Spec | `destructive-dialog-real-app.spec.js` |
| Raw | `results.json` |
| Screenshot | `destructive-dark.png` |

## Flow

1. Register a fresh learner.
2. Create a collection with the real `POST /api/collections`.
3. Go to Library and open "Sửa \<collection\>".
4. Press Tab **11 times** from the autofocused name field to reach the "Xoá" trigger.
5. Press Enter. `DestructiveConfirmDialog` opens: "Xoá bộ sưu tập".
6. Press Escape.

Network was logged for every non-GET request to the backend.

| Check | Expected | Observed | Result |
|---|---|---|---|
| Trigger reached with the keyboard | Real Tab presses | 11 Tab presses reach "Xoá" | PASS |
| Focus moves into the dialog | `dialog.contains(activeElement)` | Focus on "Đóng hộp thoại" | PASS |
| Escape closes the dialog without deleting | 0 DELETE requests; the collection still exists | 0 write requests; `GET /api/collections` still lists it | PASS |
| **Focus returns to the trigger or a safe fallback** | "Xoá", or a documented fallback | **`<body>`**. The trigger is no longer mounted | **FAIL: R82-A11Y-01** |
| Title contrast, dark | ≥ 4.5:1 | `rgb(236,231,219)` on composited `rgb(27,42,65)`: **11.70:1** | PASS |
| Consequence text contrast, dark | ≥ 4.5:1 | `rgb(169,180,194)` on `rgb(27,42,65)`: **6.87:1** | PASS |
| Acknowledgement text contrast, dark | ≥ 4.5:1 | `rgb(169,180,194)` on `rgb(27,42,65)`: **6.87:1** | PASS |

**How contrast was computed.** For each text node, the script takes every
painted layer at that point (`elementsFromPoint`). It alpha-composites them
from the bottom up, including element opacity:

- `body` `rgb(21,35,59)`
- the shell
- `surface-card`
- the backdrop `rgba(0,0,0,0.5)`
- the dialog panel `rgb(27,42,65)`

It then applies the WCAG 2.2 relative-luminance formula. The measurement was
taken after the enter transition finished. A first measurement taken during
the fade-in read 8.2–8.5:1 against a darker mix; that result is discarded.

## R82-A11Y-01: focus lost after dismissing the collection-delete dialog

| Field | Detail |
|---|---|
| Where | `FE/src/components/study/CollectionSidebar.jsx:159` |
| Code | `onXoa={() => { setDangSua(null); onXoa(c); }}` |

Mechanism:

1. Opening the dialog also closes the edit form (`setDangSua(null)`), which
   unmounts the "Xoá" trigger.
2. `Modal` (`FE/src/components/ui/Modal.jsx:41-48`) stores
   `document.activeElement` when it opens.
3. On close it restores focus only `if (document.contains(prev))`. The trigger
   is gone, so focus falls to `<body>`.

**Impact.** A keyboard or screen-reader user who cancels lands at the top of
the document and loses their place in the Library sidebar. This violates
WCAG 2.2 SC 2.4.3 Focus Order (Level A) for this flow. No data is at risk: no
DELETE is sent.

**Severity.** P2 accessibility. Not release-blocking. The flow stays operable
and the user can recover by tabbing.

**Owner.** FE Library.

**Minimal fix.** Do not clear `dangSua` when opening the dialog: change it to
`onXoa={() => onXoa(c)}`. Clear the edit state only on cancel or after the
delete succeeds, when the collection disappears anyway. Escape then returns
focus to "Xoá".

An alternative is to give `Modal` an explicit fallback target, for example the
collection's "Sửa \<name\>" button.

Add a real-browser regression for this flow.

## Not covered here

The other production destructive dialogs were not run in the real app:

- `SidebarRight.jsx:1256`, map and summary delete;
- `ChatArea.jsx:1134`, chat history delete.

Agy ran the harness version on the fixture (`r71qa.html?view=destructive`, a
"Xóa sơ đồ Alpha" trigger that stays mounted). Focus was restored there, but
that is fixture evidence. The run used `trigger.focus()` rather than Tab, and
had no backend.
