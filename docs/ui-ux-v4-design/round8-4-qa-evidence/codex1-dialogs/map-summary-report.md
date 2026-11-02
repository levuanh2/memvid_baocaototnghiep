# Round 8.4 — Real-app destructive dialogs: map + summary

## Verdict

**BLOCK / FAIL at trigger reachability.**

This was a **Real** local-app run: Track B production frontend build, real Flask
routes/auth, disposable PostgreSQL at
`postgresql://postgres:postgres@localhost:55432/studymap_test`, and
user-scoped artifact stores redirected to disposable SQLite under
`E:\memvid_NCKH\r84-codex1-dialogs\data\memory`. No production URL or
credential was used.

Both artifacts were genuinely seeded and returned by their protected APIs, but
neither destructive trigger exists in the rendered app:

| Evidence | Observed |
|---|---|
| Owned map | `e2e-map-19ef5144-fb03-4b5e-85e8-17f975b3082a-1793614662960727500`; present via `GET /mindmaps` |
| Owned summary | `r84-summary-1793614663094`; present via `GET /summaries` |
| Inspector | visible |
| `button[name="Xóa sơ đồ"]` | 0 |
| `button[name="Xóa tóm tắt"]` | 0 |
| dialogs | 0 |

Root cause: `FE/src/components/Layout/SidebarRight.jsx:32` sets
`legacyInspectorSurfacesEnabled = false`. The only saved-artifact UI block is
guarded by that flag at line 1089. The only map and summary delete triggers are
inside it at lines 1215 and 1234. Repository search found no alternative
trigger. Consequently the dialogs at lines 1255–1268 are dead/unreachable in
the real built app.

I did not alter application code or force React state from the test. Doing so
would not be real-app evidence.

## Acceptance matrix — DELETE MAP

| # | Expected | Observed | Result |
|---|---|---|---|
| 1 | Focus enters dialog | No rendered map-delete trigger; dialog cannot open | **FAIL/BLOCKED** |
| 2 | Escape cancels | Dialog unreachable | **FAIL/BLOCKED** |
| 3 | Zero destructive requests after cancel | No DELETE occurred, but cancel path cannot be exercised | **FAIL/BLOCKED** |
| 4 | Exact focus target after cancel | Trigger absent; cannot measure | **FAIL/BLOCKED** |
| 5 | Confirm sends exactly one DELETE, item gone, valid focus | Confirm unreachable; seeded map remains | **FAIL/BLOCKED** |
| 6 | Routed 500 keeps dialog, shows error, keeps item | No request can be initiated from UI | **FAIL/BLOCKED** |
| 7 | Dark composited title/consequence/ack ≥4.5:1 | No dialog pixels exist to measure | **FAIL/BLOCKED** |

## Acceptance matrix — DELETE SUMMARY

| # | Expected | Observed | Result |
|---|---|---|---|
| 1 | Focus enters dialog | No rendered summary-delete trigger; dialog cannot open | **FAIL/BLOCKED** |
| 2 | Escape cancels | Dialog unreachable | **FAIL/BLOCKED** |
| 3 | Zero destructive requests after cancel | No DELETE occurred, but cancel path cannot be exercised | **FAIL/BLOCKED** |
| 4 | Exact focus target after cancel | Trigger absent; cannot measure | **FAIL/BLOCKED** |
| 5 | Confirm sends exactly one DELETE, item gone, valid focus | Confirm unreachable; seeded summary remains | **FAIL/BLOCKED** |
| 6 | Routed 500 keeps dialog, shows error, keeps item | No request can be initiated from UI | **FAIL/BLOCKED** |
| 7 | Dark composited title/consequence/ack ≥4.5:1 | No dialog pixels exist to measure | **FAIL/BLOCKED** |

These are not contrast/focus implementation failures inside an opened dialog;
they are untestable acceptance requirements caused by the earlier reachability
failure.

## Network excerpts

Browser non-GET log from the passing reachability probe:

```text
POST /auth/register
POST /api/documents/upload
```

APIRequestContext/backend log used for the required real map seed:

```text
POST /generate-mindmap -> 202
GET /mindmap-status/<job-id> -> done
```

Destructive requests after both real artifacts existed:

```text
DELETE /mindmaps/<id>    0
DELETE /summaries/<id>  0
```

The zero DELETE count is caused by absent triggers, not a successful Escape
exercise.

## Summary seed SQL

The summary store is the app's disposable SQLite artifact store, scoped to the
fresh registered user's real `user_id`. The probe executed:

```sql
CREATE TABLE IF NOT EXISTS summaries (
  id TEXT PRIMARY KEY,
  content_hash TEXT,
  sources_json TEXT,
  created_at TEXT,
  record_json TEXT,
  user_id TEXT
);

INSERT OR REPLACE INTO summaries
  (id, content_hash, sources_json, created_at, record_json, user_id)
VALUES (?, ?, ?, ?, ?, ?);
```

The bound owner was the fresh run user
`4a800cf9-5d62-4db0-892e-b5df9ac6fd40`. The protected `GET /summaries`
returned the inserted ID before DOM inspection.

## Commands and results

```text
VITE_API_URL=http://127.0.0.1:8180 npx vite build +  --outDir E:/memvid_NCKH/r84-codex1-dialogs/dist --emptyOutDir
Result: PASS, 2409 modules transformed.

python scripts/run_e2e_server.py
Env: DATABASE_URL=TEST_DATABASE_URL=...localhost:55432/studymap_test,
     AUTH_PROTECT_APP_APIS=true, PORT=8180,
     DATA_DIR/MEMORY_DIR under r84-codex1-dialogs
Result: real Flask server healthy.

npx serve -s E:/memvid_NCKH/r84-codex1-dialogs/dist -l 4273
Result: frontend served.

npx playwright test +  --config E:/memvid_NCKH/r84-codex1-dialogs/playwright.config.mjs --workers=1
Result: 1 passed (real seeded reachability probe).
```

The probe passes because it asserts the confirmed blocker: both protected API
records exist while both delete-trigger counts are zero. Full raw evidence is
in `reachability.json`.

## Required follow-up

Restore a supported, user-visible saved-artifact management surface (or move
the two delete triggers into the current IA). Then rerun the seven checks for
each dialog. The existing dead legacy surface should not simply be enabled
without product review because the constant and nearby comments explicitly
mark it permanently dead.
