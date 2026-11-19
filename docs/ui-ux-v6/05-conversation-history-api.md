# Conversation history — API design (proposal only, 2026-11-15)

Status: **design approved for review only**. No route, migration or frontend code exists for
this. Owner decision D (2026-11-15): API design, data model, ownership/security, contracts,
pagination, retention, migration and frontend plan; no backend route or production migration.

## 1. What exists today (verified in code)

| Piece | Where | Fact |
|---|---|---|
| Store | `BE/app/domains/conversation/store.py` | **SQLite** file `conversations.sqlite` in `DATA_DIR` (Docker volume `/app/memory`), WAL, not PostgreSQL |
| Tables | same, `init_db()` | `conversations(conversation_id PK, created_at, updated_at, context_reset_at, deleted_at, title, active_source_scope, user_id)`; `conversation_messages(message_id PK, conversation_id, role, content, created_at, selected_source_ids, source_context_hash, cited_chunk_ids, rewritten_query, answer_summary, metadata_json)` |
| Indexes | same | `(conversation_id, created_at)` on messages; `(user_id, conversation_id)` on conversations |
| Retention | `cleanup_expired()` | **hard-deletes** conversations untouched for `CONVERSATION_TTL_HOURS` (default **24 h**) and their messages; `CONVERSATION_MAX_MESSAGES` default 80 |
| Routes | `BE/app/main.py` | `GET /conversations/<id>/messages`, `DELETE /conversations/<id>`, `POST /conversations/<id>/clear-context`; owner mismatch answers **404** ("no oracle") |
| Ownership | `owner_check`, `_owner_blocks` | `user_id` nullable (added later); enforced only when auth protection is on |
| Missing | — | no route lists a learner's conversations; no cursor; the FE keeps a conversation only while the tab knows its id |

Consequence: a "history" list built on today's store would show at most one day. **Retention
is the first decision, not the endpoint.**

## 2. Endpoint contracts

All under the existing auth (`_require_app_user`); every query filters by the caller's
`user_id`. Unknown id and someone else's id both answer **404** with the same body, as the
current routes do.

### `GET /api/conversations?limit=20&before=<cursor>`
List the caller's conversations, newest activity first.

```json
200 {
  "conversations": [
    {
      "conversation_id": "c_9f…",
      "title": "Cung cầu và giá cân bằng",
      "updated_at": "2026-11-15T09:12:44Z",
      "created_at": "2026-11-14T20:01:02Z",
      "message_count": 12,
      "sources": [{"source_id": "kinh-te-vi-mo", "label": "Kinh tế vi mô.pdf"}],
      "last_question": "Độ co giãn chéo là gì?"
    }
  ],
  "next_cursor": "MTczMTY2MjM2NC4xMjN8Y185Zg"
}
```
- `limit` 1–50, default 20; outside: 400.
- `next_cursor` null at the end.
- `title`: the stored title, else the first question truncated to 80 characters (server
  side, so every client shows the same text).
- `last_question` is the learner's own text; no answer content in the list (smaller payload,
  less exposure in logs).
- Soft-deleted conversations (`deleted_at` set) never appear.

### `GET /api/conversations/<id>/messages?limit=50&before=<message cursor>`
The existing route, extended with the same cursor scheme (today it returns everything up to
`CONVERSATION_MAX_MESSAGES`). Response keeps its current shape plus `next_cursor`.

### `PATCH /api/conversations/<id>` `{ "title": "..." }`
Rename (1–120 characters, trimmed). 200 with the updated list item; 400 on length; 404 as
above. Optional, phase 2.

### `DELETE /api/conversations/<id>`
Already exists (soft delete + message removal). Unchanged.

## 3. Pagination

Keyset, not offset: `(updated_at DESC, conversation_id DESC)`. The cursor is an opaque
base64url of `"<updated_at>|<conversation_id>"`; the query is
`WHERE user_id = ? AND deleted_at IS NULL AND (updated_at, conversation_id) < (?, ?)
ORDER BY updated_at DESC, conversation_id DESC LIMIT ?+1`. Stable while new messages arrive
(a conversation that moves to the top is not shown twice on the next page; it may be missed
on the current scroll, which the FE fixes by refetching page 1 on focus). Needs index
`(user_id, deleted_at, updated_at, conversation_id)`.

A malformed cursor: 400, never a 500 and never "start from the top" silently.

## 4. Data model changes

Minimal, additive:
1. `conversations.message_count INTEGER NOT NULL DEFAULT 0`, maintained in `append_message`
   (avoids a `COUNT(*)` per row in the list).
2. Index above.
3. Backfill `user_id` where it is NULL: **not possible safely**. Rows created before ownership
   have no owner; they stay invisible to the list (they also expire under today's TTL).

Store choice (owner decision): keep SQLite for the first version (one EC2 host, one volume),
or move conversations to PostgreSQL with the rest of the learner data. SQLite is enough for one
host; it blocks a second backend instance and is not in the existing backups/migrations
(`alembic` covers PostgreSQL only). Recommendation: PostgreSQL, because history becomes durable
user data once retention exceeds a day.

## 5. Ownership and security review

- Every list/read/rename/delete filters by `user_id` from the token, never from the request.
- 404 for both "missing" and "not yours" (existing convention; no existence oracle).
- Open mode (auth protection off) shares one anonymous owner between every client, exactly as
  in the quiz flow (`task19-codex-183-review.md`, finding 4). **The list must be disabled in
  open mode** (404 `conversation_history_disabled`), or every anonymous visitor would see
  everyone's questions.
- `last_question`/`title` are learner text: escape on render (React does), never put them in
  URLs or analytics events.
- Rate limit: reuse the existing per-user limiter; the list is cheap but enumerable.
- Deletion: `DELETE` removes messages immediately; the soft-deleted row keeps only ids and
  timestamps and is purged by the cleanup job.

## 6. Retention options (owner decision)

| Option | Effect | Note |
|---|---|---|
| Keep 24 h | History = "today" only | Honest label required in the UI ("Hội thoại trong 24 giờ qua") |
| 30 days rolling | Useful study history | Raise `CONVERSATION_TTL_HOURS` to 720; disk grows with messages |
| Until deleted, with a per-user cap (e.g. 200 conversations) | Durable | Needs PostgreSQL and a delete-all control |

Whatever is chosen, the profile page needs "Xoá toàn bộ lịch sử hội thoại" before retention
goes beyond a day.

## 7. Migration proposal (not run anywhere)

SQLite path: extend `_ensure_columns` (add `message_count`, backfill it with one
`UPDATE … SET message_count = (SELECT COUNT(*) …)`), create the index in `init_db()`; both
idempotent, run at first use as today.

PostgreSQL path: Alembic revision creating `conversations` and `conversation_messages` with
`user_id` NOT NULL FK `users.id`, the index above, and a one-off copy script from SQLite that
skips rows without an owner; deploy order migration, then backend dual-write for one release,
then switch reads.

## 8. Frontend integration plan

- Entry: the workspace's existing "Cuộc trò chuyện mới" control gains a history list (left
  drawer section on phones, popover on desktop), loaded on open, first page only.
- Each row: title, sources, relative time; Enter/click opens `/app?conversation=<id>`, which
  loads `GET …/messages` and restores the source scope.
- States: loading skeleton rows; empty "Chưa có cuộc trò chuyện nào được lưu"; error with a
  retry; open mode hides the entry entirely.
- Delete from the row with the existing confirm dialog; optimistic removal, restored on error.
- Stale responses: the same attempt-identity guard as `/query` (#163) so a slow page 2 cannot
  land in a newer list.
- Tests: route contract tests on PostgreSQL/SQLite for owner filter, cursor stability and
  404-on-foreign-id; FE fixture spec for list, open, delete, empty, error, 390 px.
