# Citation navigation: scoped design and technical proposal

| Item | Value |
|---|---|
| Status | **Proposal only. Not implemented.** It needs product approval and its own PR, separate from the deploy-safety and P2 fixes |
| Source revision | `origin/main` `2479a32` |
| Author | Claude |

## Current behaviour

- `FE/src/pages/study/QuizResult.jsx:319-325` shows
  "Nguồn: N đoạn trong tài liệu".
- `FE/src/pages/study/ReviewGuide.jsx:221-226` shows "N đoạn cần đọc lại", and
  `:273` shows "Nguồn: N đoạn từ chủ đề …".

These are plain counts. The learner is told to reread N passages but cannot
see which ones.

## Data that already exists

| Data | Where |
|---|---|
| `chunk_ids` on every result question | Result API, used at `QuizResult.jsx:319` |
| `chunk_ids` on every review-plan item | `ReviewGuide.jsx:221,273` |
| The document that owns the chunks | The quiz's `document_id` (the attempt belongs to the quiz, the quiz to the document) |
| Chunk text for an **owned** document | `GET /api/documents/<document_id>/chunks?limit&offset` (`BE/app/main.py:3621`). Guarded by `_require_app_user`; `limit` is at most 500 |
| A proven pattern for resolving `chunk_ids` | `FE/src/pages/study/StudyMapView.jsx:259-260,819`: builds `new Map(list.map(c => [c.chunk_id, c]))`, then `NodeDetail` renders excerpts |
| Server-side by-id lookup | `BE/app/domains/quiz/repository.py:194 chunks_by_ids`, not exposed over HTTP |

## Recommended interaction: inline disclosure

Each question or review item gets one button: **"Xem N đoạn nguồn"**. It sets
`aria-expanded` and expands the excerpts in place, under that question or
item.

- **Each excerpt shows:**
  - its position or page if the chunk has one;
  - roughly the first 300 characters;
  - "Xem thêm" to show the full chunk text.
- **Loading.** Chunks are fetched once per document and cached for the page.
  While loading, show a small spinner, set `aria-busy` on the region, and
  keep the button usable.
- **Missing excerpt.** An id that is not found (the document was re-ingested,
  or the chunk was deleted) shows one line: "Đoạn nguồn này không còn trong
  tài liệu."
- **Pagination.** Fetch pages of 500 until every requested id is resolved, or
  the list ends. Most documents need one page. If more than about 2 pages
  become common, add a by-id endpoint wrapping `chunks_by_ids`. That is a
  contract change and needs separate approval.
- **Access errors.** On 401, follow the normal session-expiry flow. On 403
  or 404, show "Không thể hiển thị nguồn của tài liệu này" and never show
  partial content.
- **Ownership.** Only fetch through the owned-document endpoint, using the
  `document_id` of the learner's own attempt. Never accept a `document_id`
  from the URL or query string. No other account's content can appear,
  because the endpoint enforces ownership.
- **Accessibility.**
  - The disclosure is a real `<button>` with `aria-expanded` and
    `aria-controls`.
  - The excerpt region is a list.
  - Focus stays on the button.
  - The count text stays the same in the collapsed state, so screen-reader
    output is stable.

### Other options considered

| Option | Why not first |
|---|---|
| Link to the StudyMap with the chunk highlighted (`/app/study/map/:documentId?chunk=`) | Takes the learner out of the review. Needs deep-link and highlight logic in `StudyMapView` |
| Side drawer with excerpts plus "Mở tài liệu" through the signed file URL | Largest change. Opening a PDF without page anchoring adds little |

## Scope and files (when approved)

| File | Change |
|---|---|
| New `FE/src/components/study/SourceExcerpts.jsx` | The disclosure, fetching, cache and states |
| `FE/src/utils/studyApi.js` | Reuse the existing chunk list call (`:120`); add a paginating resolver |
| `QuizResult.jsx`, `ReviewGuide.jsx` | Replace the count text with `<SourceExcerpts documentId chunkIds>` |
| Tests | Vitest for resolved, missing, paginated, 403 and keyboard cases; one real-backend Playwright test that the excerpts belong to the learner's own document; a cross-account 404 test |

No backend change, no migration and no new endpoint.

**Estimate:** about 1 day of development plus 0.5 day of QA.
