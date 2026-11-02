# Destructive dialogs in the real app

| Item | Value |
|---|---|
| Source revision | Track B build: `origin/main` `2479a32` plus `fix/studymap-v4-round8-4-qa-hardening`, which includes the collection-focus fix |
| Environment | Real Flask `run_e2e_server.py` (`:8380`, `AUTH_PROTECT_APP_APIS=true`), the Track B production build (`:4483`), disposable Postgres `r82-pg`, Chromium. Disposable accounts only |
| Owner | Agy runs the tests; Claude reviews them |
| Status | **IN PROGRESS.** Results are added in a follow-up commit to this PR. Until then every row is NOT VERIFIED |

The 7 checks for each dialog:

1. Keyboard focus enters the dialog.
2. Escape cancels.
3. No destructive request is sent after cancelling.
4. Focus returns to a meaningful place, not `<body>`.
5. Confirming sends exactly one authorised request, and the item disappears.
6. A failed request (500) leaves the dialog open with an error shown, and the item still exists.
7. In dark mode, the title, consequence and acknowledgement text reach a composited contrast of at least 4.5:1.

| Dialog | Trigger | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| Delete collection (Library) | `CollectionSidebar` "Xoá" | pending | pending | pending | pending | pending | pending | pending |
| Delete map | `SidebarRight.jsx:621` `handleDeleteMap` | pending | pending | pending | pending | pending | pending | pending |
| Delete summary | `SidebarRight.jsx:~760` | pending | pending | pending | pending | pending | pending | pending |
| Clear chat history | `ChatArea.jsx:413` `handleDeleteHistory` | pending | pending | pending | pending | pending | pending | pending |

## Known from code reading (to be confirmed in Chromium)

**Clear chat history.** `handleDeleteHistory` calls `setMenuOpen(false)` and
then opens the dialog. The menu item that triggered it is therefore unmounted
before the dialog closes. This is the same pattern as R82-A11Y-01: after
Escape, `Modal` has no trigger to return focus to, so focus is expected to fall
to `<body>`. The real run decides.

**Round 8.2 baseline.** On `c02e2b9` (Round 8.2), the collection-delete
cancellation measured contrast 11.70 and 6.87 and sent 0 DELETE requests, but
focus went to `<body>`. Round 8.3 fixed the focus for cancellation. Round 8.4B
adds a focus fallback after a successful delete.
