# Round 8.5 — Saved MindMap / Summary deletion investigation

Read-only investigation against `origin/main` commit `2479a32a1c020c31be83fd2eacbaee7836b19fde`. No code changes or commits were made.

## Executive conclusion

The release finding is correct: there is no current, selective user path to delete a saved legacy MindMap or Summary. The only cards wired to `DELETE /mindmaps/:id` and `DELETE /summaries/:id` are inside the retired Inspector block gated by `legacyInspectorSurfacesEnabled = false` (`FE/src/components/Layout/SidebarRight.jsx:32`, `:1086-1241`). The confirmation dialog remains mounted (`:1255-1268`), but nothing reachable can set its state.

Do not re-enable the retired Inspector. Restore lifecycle controls in the current center-pane IA. Recommended: add a small reusable artifact switcher/action menu to the existing MindMap and Summary toolbars, with the existing `SidebarRight` data owner continuing to execute list/open/delete and own the destructive confirmation.

The codebase also has a distinct **Study Map** system (`knowledge_maps` in Postgres/Supabase). It has list/open APIs but no delete API. It should not be silently folded into this fix because deleting a Study Map has learning-history implications and different FK behavior.

## 1. Storage and ownership

### Legacy MindMaps (`/mindmaps`)

- Stored in local SQLite, not Supabase Storage: `MINDMAPS_DB_PATH`, else `MEMORY_DIR/mindmaps.sqlite`, else `BE/memory/mindmaps.sqlite` (`BE/app/domains/mindmap/store.py:15-23`). Docker persists `/app/memory` on the host bind mount (`docker-compose.yml:9-15`). Render Free has ephemeral disk (`render.yaml:112-124`), so this legacy store is not a durable cloud database there.
- Table: `mindmaps(id, content_hash, sources_json, created_at, record_json, user_id)` (`store.py:37-55`). `sources_json` is only a denormalized list of canonical stems; there is no FK to documents (`:68-75`, `:110-120`).
- `user_id` is nullable because it was added additively for auth hardening (`:61-65`). New writes store the caller ID passed by the route/job (`:102-120`). Legacy NULL-owner rows are intentionally hidden when ownership enforcement is enabled (`:127-130`).
- Owner-enforced reads/list use `... WHERE user_id=?` (`:138-151`, `:156-175`, `:180-198`). Owner-enforced deletion uses `DELETE ... WHERE id=? AND user_id=?` (`:201-215`).

### Summaries (`/summaries`)

- Stored in a separate local SQLite database: `SUMMARIES_DB_PATH`, else `MEMORY_DIR/summaries.sqlite`, else `BE/memory/summaries.sqlite` (`BE/app/domains/summary/store.py:16-24`). It is not an object in Supabase Storage.
- Table mirrors MindMap: `summaries(id, content_hash, sources_json, created_at, record_json, user_id)` (`store.py:45-63`). The owner column is nullable/additive (`:38-42`), and writes persist the supplied `user_id` (`:103-121`).
- Owner-enforced hash lookup/list/read/delete all include `user_id=?`; NULL-owner legacy records are hidden under enforcement (`:128-152`, `:157-176`, `:181-216`).

### Study Maps (`/api/study-maps`), a separate artifact type

- Stored in the configured SQLAlchemy Postgres database (production configuration points `DATABASE_URL` at Supabase Postgres), not in the legacy SQLite files and not in Supabase Storage. `knowledge_maps` has `document_id NOT NULL`, `user_id NOT NULL`, title/status/generator/timestamps (`BE/alembic/versions/102c36a01548_initial_studymap_schema.py:112-126`).
- Map ownership is a first-class `user_id`; document and user deletion both cascade to the map (`:122-123`). Nodes and edges cascade from the map (`:171-189`, `:226-239`), and node/chunk links cascade from nodes/chunks (`:244-250`). Quiz `map_id` becomes NULL (`:194-217`); quiz questions, mastery records, and review items retain their history but their `knowledge_node_id` becomes NULL (`:283-307`, `:311-335`, `:392-410`).
- Repository creation binds the map to the authenticated user (or a deliberate anonymous user in open mode) (`BE/app/domains/studymap/repository.py:26-43`). `get_map` returns `user_id` specifically so the route can enforce ownership (`:96-145`); list/latest queries add `KnowledgeMap.user_id == user_id` when a user is supplied (`:148-189`).
- RLS is enabled on these tables, but the migration explicitly does not FORCE it because the backend DB owner is the access boundary (`102c36a01548_initial_studymap_schema.py:24-32`, `:430-433`). Therefore route/repository owner checks remain material.

## 2. Delete APIs and cascade behavior

`AUTH_PROTECT_APP_APIS` is the switch: when off, `_require_app_user` deliberately allows anonymous/open operation; when on, missing/invalid auth is 401 (`BE/app/main.py:1492-1519`).

| API | What it deletes | Auth/owner behavior | Cascades / leftovers |
|---|---|---|---|
| `DELETE /mindmaps/<mindmap_id>` | One legacy MindMap row | Always calls `_require_app_user`; under protection, deletes with `id + user_id`; foreign IDs become 404 (`BE/app/main.py:5977-5986`). | No DB FK/cascade. It does **not** delete generation jobs, export jobs, export files, source links, or documents. Jobs are in separate `jobs.sqlite` with plain `map_id` text (`BE/app/domains/jobs/jobs_store.py:28-74`). A queued export re-fetches the map and terminates `map_not_found` if deletion wins the race (`BE/app/application/mindmap_export.py:64-78`). A completed export file survives until independent job-retention cleanup (`BE/app/domains/jobs/export_jobs.py:100-120`; `jobs_store.py:481-507`). |
| `DELETE /summaries/<summary_id>` | One Summary row | Same pattern: auth gate, owner-scoped delete under protection, foreign/missing is 404 (`BE/app/main.py:5339-5349`). | No FK/cascade. Jobs/source/document records are untouched. |
| `DELETE /sources/<source_id>` | Broad source cleanup used by the current Workspace source sidebar | Auth gate plus owner check/404 (`BE/app/main.py:6532-6560`). Hard-deletes the document (`:6470-6479`), so Postgres Study Maps/nodes/edges cascade; removes source files/Storage/index/memory; explicitly deletes legacy MindMaps by source (`:6600-6617`). | It does **not** call `summary_store.delete_by_source`, so Summaries remain orphaned. It may delete a multi-source MindMap merely because one source matches. This is an indirect, high-blast-radius path, not artifact lifecycle UX. Current UI invokes it for normal source rows (`FE/src/components/Layout/SidebarLeft.jsx:256-277`, `:598-610`). |
| `POST /delete-source` (legacy) | Broad cleanup by source stem | Auth gate plus source-owner check/404 (`BE/app/main.py:5356-5369`). | Hard-deletes matching documents/storage and calls both `mindmap_store.delete_by_source` and `summary_store.delete_by_source` (`:5405-5436`). Current Sidebar only falls back to this when a row lacks `source_id` (`SidebarLeft.jsx:263-267`). |
| `DELETE /api/documents/<document_id>` | Soft-deletes a Document | Auth gate plus `_owned_document` (`BE/app/main.py:3078-3089`). | Explicitly retains children; it does not remove MindMaps, Summaries, or Study Maps. |
| Study Map delete | **No route exists** | List/get/generate/cancel only (`BE/app/main.py:3723-3806`). | The repository deliberately creates new maps rather than overwriting old ones because learning objects may point to their nodes (`BE/app/domains/studymap/repository.py:1-6`). Any future delete contract must decide how to communicate the SET NULL effects above. |

Security assessment: the two artifact DELETE APIs are correctly owner-checked when `AUTH_PROTECT_APP_APIS=true`, and unauthenticated requests are rejected. When the flag is off they intentionally retain the old global/open behavior, including unscoped list/delete. That is consistent with the flag's documented semantics, but it means deployment must keep the flag on for multi-user safety.

## 3. Current user-visible routes and reachability

### Route inventory

- `/app` is the protected Workspace; its center pane switches among Chat, MindMap and Summary (`FE/src/App.jsx:63-74`; `FE/src/components/Layout/MainLayout.jsx:590-610`, `:807-837`).
- `/app/study` is the protected document learning library; `/app/study/map/:documentId` is the protected Study Map viewer (`FE/src/App.jsx:72-79`).
- The library payload exposes only the newest legacy `summary_id`/`mindmap_id` matched by source stem (`BE/app/domains/documents/thu_vien.py:159-170`, `:372-389`). Library actions for summary/mindmap navigate back to `/app?source=<stem>`, not to an artifact ID (`FE/src/utils/tiepTucHoc.js:39-55`).
- `StudyMapView` lists maps for one document internally, chooses the newest completed one, then opens it; it exposes no map picker or delete action (`FE/src/pages/study/StudyMapView.jsx:254-285`, `:388-403`).

### What can actually be opened/listed today

- The current MindMap canvas has a reachable map selector that lists all loaded legacy maps and opens one (`FE/src/components/mindmap/MindElixirView.jsx:1132-1162`). It has no delete affordance.
- Workspace auto-opens the newest legacy MindMap after `/mindmaps` loads (`FE/src/components/Layout/SidebarRight.jsx:436-457`), so the selector is usable once a map is present.
- There is no equivalent reachable Summary selector. Existing summaries are fetched into state (`SidebarRight.jsx:275-291`), but the center Summary pane receives only `showSummaryModal` (`:858-860`), which is set by fresh generation or the dead list card. On a fresh session, an old Summary can be marked “ready” in `/api/library`, yet the library navigation only returns to `/app?source=...`; it does not open that `summary_id`.
- `ModeLibraryMenu` is not production-mounted. Its only non-test consumer is `GuidedMindmapHarness.testonly.jsx`; the compact-workspace test explicitly asserts the production mode switch does not contain it (`FE/src/components/Layout/compactWorkspace.test.js:42`).

### Can the user delete a saved map or summary today?

- **Selective MindMap delete:** no.
- **Selective Summary delete:** no.
- **Selective Study Map delete:** no API and no UI.
- **Indirect deletion:** deleting a source from the current Workspace can remove associated legacy MindMaps and Postgres Study Maps as a broad side effect, but not Summaries on the normal `DELETE /sources/:id` path. This is not an acceptable substitute: it destroys the source and related learning data, and a multi-source map can be removed when any one source is deleted.

## 4. User-visible impact

- **Privacy and user control:** cross-user confidentiality is protected when auth protection is on, but a user cannot exercise ordinary deletion over retained derived content without deleting source data. The UI's existing dialog copy says “deleted permanently,” establishing a product expectation that selective deletion was intended (`SidebarRight.jsx:1255-1266`).
- **Clutter:** MindMaps accumulate in the current selector with no pruning. Summaries are worse: they accumulate server-side but old ones are not reopenable from the current IA, while `/api/library` can still advertise a summary as ready.
- **Retention inconsistency:** the same “delete source” gesture has different legacy behavior depending on whether the source has a modern `source_id`: the primary path deletes MindMaps but leaves Summaries; the fallback deletes both. Soft document deletion retains all children. Users cannot infer these distinctions.
- **Quota/cost:** no artifact-count/storage quota was found for these stores, and deletion does not refund already-metered model usage. Therefore the immediate impact is not quota recovery; it is unmanaged disk growth (where persistent volumes are used), clutter, and inability to meet expected data-retention control. On Render Free the SQLite stores are ephemeral, which is a durability problem, not a valid retention policy.
- **Exports/jobs:** deleting a map would not erase already-produced export files immediately and would not cancel jobs. UX copy must not claim “all related data” unless backend semantics are expanded; current dialog copy for MindMap does claim that (`SidebarRight.jsx:1259-1261`) and is broader than the API implementation.

## 5. UX options inside the current IA

### Option A — Reusable artifact switcher/action menu in the center toolbars (recommended)

Add a compact switcher to the existing MindMap toolbar and a matching one to `SummaryPane`. Each row can open the artifact and expose a kebab/trash action; the currently open artifact also gets “Delete” in the toolbar overflow. Keep `SidebarRight` mounted as the data/controller owner and reuse its existing `DestructiveConfirmDialog`; only surface its list/select/delete actions through the already-present `libraries` bridge.

Files likely touched:

- `FE/src/components/Layout/SidebarRight.jsx`: expose `onSelect`/`onRequestDelete`; correctly clear/fallback the open item after deletion.
- `FE/src/components/Layout/MainLayout.jsx` and `WorkspaceContainer.jsx`: pass current library/action objects to the center panes (the library bridge already exists at `MainLayout.jsx:293-301`, `:826-835`).
- `FE/src/components/mindmap/MindElixirView.jsx`: extend its existing selector; stop propagation so delete does not also open.
- `FE/src/components/Layout/SummaryPane.jsx`: add the matching switcher/overflow.
- Prefer a small new shared component such as `FE/src/components/Layout/ArtifactLibraryMenu.jsx`; update scoped CSS and tests.

Risk: medium-low. Main risks are stale selection after delete, accidentally deleting while clicking a row, and mobile focus/overflow. Backend contract does not change. Keep Study Maps out of this component for now.

Test plan:

1. Component tests for both modes: list reachable with `legacyInspectorSurfacesEnabled=false`; open another artifact; delete opens the existing destructive dialog; cancel preserves data; confirm sends the encoded correct endpoint exactly once; focus returns to trigger.
2. State tests: deleting current artifact selects the next newest or shows the existing empty state; deleting a non-current artifact keeps the current canvas/pane; 404 refreshes the list without a false success.
3. Mock Playwright from `/app`: seed two maps/two summaries, open and delete each through visible controls at desktop and 390px; assert retired Inspector remains absent.
4. Backend regression: owner A can list/delete own; owner B receives 404; missing token receives 401 with protection enabled; open-mode behavior remains explicit. Assert map delete does not imply export/job deletion, or change the dialog copy accordingly.

### Option B — “Saved outputs” lightweight drawer from the current Workspace header

Add one header/Study tools entry opening a small drawer with two tabs (MindMaps, Summaries), list/open/delete, and reuse the same data/actions. This restores management in one place without resurrecting Inspector.

Files: `MainLayout.jsx`, `StudyToolsMenu` (or its owner), a new `SavedArtifactsDrawer.jsx`, `SidebarRight.jsx` action bridge, scoped CSS/tests.

Risk: medium. It creates another global surface and can duplicate the MindMap selector; ownership/focus behavior across header popover + drawer is more complex. It is useful if product wants bulk/search later, but larger than needed for this release.

Test plan: keyboard/focus trap and Escape/return-focus; desktop/mobile drawer; list/open/delete parity; no duplicate requests when both drawer and center panes are mounted; the same backend auth regression tests as Option A.

### Option C — Per-document artifact actions in `/app/study`

Use the IDs already projected into each library document (`summary_id`, `mindmap_id`) to add “Open” and “Delete output” actions in the existing document knowledge details/action row.

Files: `DocumentList.jsx`, `StudyDocumentActionRow.jsx` and/or `DocumentKnowledgeDetails.jsx`, `useOpenSurface.js`/`tiepTucHoc.js` so navigation carries an artifact ID, plus Workspace handling and tests.

Risk: medium-high. The library projection exposes only the newest record per stem, so older and multi-source artifacts remain unmanaged. It also risks conflating legacy MindMaps with Postgres Study Maps. This is a useful secondary entry point, not a complete fix by itself.

Test plan: ensure the exact ID opens/deletes (not merely newest-by-stem); multi-source mapping; foreign IDs never appear; navigation survives refresh; no Study Map action is mislabeled as legacy MindMap.

## Recommendation and bounded implementation scope

Choose **Option A**. It fits the current IA already visible to users, completes both list/open/delete for both legacy artifact types, reuses the existing controller and confirmation rather than reviving the retired Inspector, and avoids the source/stem ambiguity of the document library.

For this release, scope deletion semantics honestly:

1. Delete exactly the selected legacy MindMap or Summary via the existing owner-scoped endpoint.
2. Change MindMap confirmation copy from “and all related content” to wording that does not promise job/export cleanup, unless backend cleanup is explicitly added and tested.
3. Do not add Study Map deletion in the same patch. Treat it as a separate product/API decision because its nodes are referenced by quiz/mastery/review history and the existing repository explicitly preserves old maps for that reason.
4. Add a follow-up backend issue for the inconsistent source cleanup (`DELETE /sources/:id` omits Summary cleanup while the legacy fallback includes it); do not couple that broad retention fix to restoring selective artifact controls.
