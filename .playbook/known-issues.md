# Known Issues

## Mind Map export had two triggers and a square checkbox marker (fixed 2026-10-06)

**Symptom:** the Export Studio opened from two places: the toolbar "Xuất" and an
overflow menu item "Mở Export Studio". The branch selection marker was an 18px
square, which covered node text, and its dialog subtitle showed "Export Studio".

**Root cause:** the overflow item was a duplicate of the toolbar trigger
(both call `setExportOpen(true)`). The marker was a single square box at the
parent's top-left, with no side awareness and no separate hit target.

**Fix:** remove the overflow export item and its group. Subtitle copy changes to
"Chọn phạm vi, định dạng và cách trình bày". The marker becomes a 20px circle
inside a 40x40 hitbox, anchored from the topic's own offsets on the outer top
corner (root: top-right), using mind-elixir's `me-main` lhs/rhs class for side.
The selection bar becomes a floating pill above the legend; on narrow screens it
is a bottom bar with safe-area padding, and the legend hides only in selection mode.

**Regression:** `MindElixirView.exportEntry.test.jsx` (fails on origin/main at the
overflow item and the subtitle), `mindmapBranchSelectionMarker.test.js` (side
attribute), `e2e-fixture/mindmap-branch-marker.spec.js` (20px/40px, placement,
click, keyboard, transform), `e2e-fixture/branch-export-visual.spec.js` (visual
states and measurements).

**Prevention:** one trigger per action. A new entry point must replace an old one,
not sit beside it. Measure overlays from the element they anchor to, not from a
wrapper that mind-elixir pads.

## Mind Map repair banner stayed after a long hidden Chat dwell (fixed 2026-10-06)

**Symptom:** a map that initialised while the Chat tab was active showed the
"Không thể dựng connector" error banner once the user switched to Mind Map,
and the map never became ready. Production reproduction: 7/7 at a hidden dwell
of 10000 ms or more; 3/3 ready at 9950 ms or less (QA account, 1440x1024).

**Root cause:** two parts.
- The NaN precursor is vendor-level. mind-elixir `linkDiv` writes
  `M NaN 0 Q NaN` connector paths when the container is 0x0. The sanitizer
  then neutralises them to `d=""`. Confirmed by stack trace.
- The banner is app lifecycle. `startFitPoll` used an absolute 10 s deadline
  counted from mount. The deadline expired while the pane was still hidden, and
  `setRenderState("error")` ran. Nothing restarted the poll when the pane became
  visible, so the error stayed until the user pressed Thử lại.
- The code comment said the ceiling was "2 minutes", but the code used 10 s.

**Fix:** the repair budget (`VISIBLE_REPAIR_TIMEOUT_MS`, still 10 s) counts only
time the container has real size. The budget starts on the first sized tick and
resets when the container drops back to 0x0. The poll stays at 16 ms while hidden.
Rejected: raising the deadline to 120 s only postpones the failure.

**Regression:** `MindElixirView.visibleRepairDeadline.test.jsx` (cases A and C
fail on `origin/main`, pass after the fix). `MindElixirView.renderLifecycle.test.jsx`
now asserts the visible-but-invalid error case, and a separate test asserts that a
never-sized container stays in `waiting_for_size` with no error.
`FE/e2e-fixture/mindmap-visible-repair-deadline.spec.js` holds Chat for 11 s
at three widths in light and dark (base fails at 1440 light, state `error`).

**Prevention:** a repair budget must count only time the output can actually be
repaired. Do not hide a timeout behind an absolute clock that starts before the
output is visible.

## Guided "Tạo sơ đồ mới" could take the legacy path before capability loaded (fixed 2026-10-05)

**Symptom:** on production, clicking "Tạo sơ đồ mới" sometimes did not open the
Guided dialog at widths 1023, 1024, and 1025 alike. The same width gave both
outcomes across repeat runs, so it was never a breakpoint issue.

**Root cause:** `SidebarRight` initialised `guidedCapability` to `false`. That
value means "guided is off", but it is also the value before
`GET /mindmaps/capability` resolves. A click in that window took
`runMindmapGeneration` (the legacy path) instead of waiting for the server
answer. With no source selected it only showed the toast "Vui lòng chọn ít nhất
một tài liệu", but with sources selected it would POST `/generate-mindmap`.

**Interim fix (superseded):** starting the state as `null` and opening Guided
unless capability was a confirmed `false`. That opened Guided before the server
confirmed it, which broke the server-authoritative rollout: non-QA and global-OFF
users could briefly receive Guided UI. Replaced by the state machine below.

**Fix:** capability is one of `loading | enabled | disabled | error` (the
request starts on mount, so there is no separate "unknown" state). A click
decides from the settled value only:
- `enabled`: open Guided once.
- `disabled` or `error`: run the legacy path once (error keeps the fail-closed
  policy, and the source validation still applies).
- `loading`: park ONE create intent, show "Đang kiểm tra tính năng…" with
  `aria-busy`, open nothing, POST nothing. Repeated clicks reuse the same
  intent. The request resolves once and runs the parked intent once.

The request runs once per mount, guarded by a ref. React StrictMode runs
effects twice in dev, and without the guard that issued a duplicate
`/mindmaps/capability` request. The settle path checks `mountedRef`, so an
unmount while loading never opens a dialog.

**Regression:** `SidebarRight.guidedCapabilityPending.test.jsx` (11 cases:
pending/true/false/error, rapid click, already enabled/disabled, non-QA mount
observer, unmount, validation toast) and `e2e-fixture/guided-capability-delay.spec.js`
(held capability response at 390, 1023, 1024, 1025, 1440).

**Prevention:** a tri-state gate needs a distinct value for "not known yet".
Do not reuse the `false` default as "off". Any action that depends on a server
flag must wait for the server answer and must not render the gated UI in the
meantime. Use the StrictMode-safe request guard for effects that fire requests.

## MindMap duplicate ownership, root-only collapse, and stale A↔B selection (fixed 2026-10-04)

The global workspace tabs had accumulated map/summary counts, dropdown state,
selection, and create actions even though MindMap already owned the same map
library in its contextual row. This produced two owners and a duplicate `+`
create trigger. Global tabs now switch modes only; the single 48px MindMap
artifact toolbar owns map identity, library/select/create, status, export, and
grouped overflow actions.

Mind Elixir 5.13 renders root children unconditionally: `expandNodeAll(root,
false)` collapses descendants but deliberately leaves level-one topics. The
application adapter now renders a root-only presentation by temporarily
withholding `root.children` for one synchronous `refresh()`, restoring the
same array immediately. It never recreates the instance, changes persisted
data, calls `scaleFit()`/`toCenter()`, or overwrites per-node `expanded` flags.
Real-package and Chromium tests assert one topic, zero tree connectors, exact
restore, and byte-identical viewport transform.

A real A→B fixture switch also exposed a separate render crash: the controller
selection still referred to an A node for one render, while Mind Elixir's
`findEle()` throws for missing/collapsed ids instead of returning null. Derived
toolbar state now uses a safe lookup and treats that transition as no
selection until the controller's id-keyed reset completes.

## PR #47 Guided idempotency could orphan a new usage reservation (fixed 2026-10-03)

`POST /generate-mindmap` reserved quota before the PostgreSQL Guided store
resolved `(user_id, idempotency_key)`. An `existing` or `conflict` outcome then
returned immediately. Historical jobs created before usage metering have no
`usage_reservation_id`, so their first retry created a fresh 8,000-token
reservation that remained `reserved` until lease expiry even though no worker
ran. The same audit found a query single-flight follower could return after a
failed admission retry without closing its reservation.

The route now releases only a reservation whose persisted `job_id` proves it
was created by the current losing submission and which the winning durable row
did not attach. This double check prevents releasing a concurrent winner's or
an existing in-flight job's legitimate reservation. Query readmission rejection
releases immediately because that path never reaches a provider. PostgreSQL
route tests cover historical completed/queued/running jobs, conflicts, exact
retries, two-process identical submissions, cache hits, and reservation/event
totals.

## PR #47 terminal usage publication and inactive gateway limit (2026-10-02)

Job pollers stop as soon as they observe `done`. Publishing that state before
the reservation aggregate was stored caused Chat/Summary/MindMap inline usage
to disappear nondeterministically. Usage-aware jobs now hold at
`UsageFinalize`, persist the safe aggregate, and publish their terminal state
last. Pure cache hits remain zero-charge; a semantic cache judge that actually
calls a provider is reported as provider usage instead of being disguised as a
free hit. The optional gRPC LLM gateway still has no usage fields in its
protobuf and must remain outside hard quota enforcement until that contract is
extended.

## PR #47 usage metering quota (2026-10-01)

The first implementation stored the usage ledger in `usage.sqlite`, created its
tables from request code, and protected quota with a process-local `RLock`.
That is not safe for multiple web/worker processes. The replacement uses the
existing SQLAlchemy/PostgreSQL infrastructure and an Alembic-owned ledger;
SQLite remains only as an explicit local unit-test adapter. The implementation
also records `period_start`/`period_end`, lease expiry, terminal reservation
statuses, and provider actual overage events. End-to-end reservation propagation
through every provider/worker execution path still needs separate verification.

## (2026-10-01) Usage metering rollout boundary

The durable usage ledger and quota API are additive and fail closed for usage
requests, but existing LangChain graph workers do not yet carry a user-scoped
reservation context through every streaming/retry path. Do not enable hard
quota enforcement globally until those call sites emit provider usage and
commit/release the reservation exactly once. Local/Ollama and embedding paths
must remain `estimated` or unmetered unless the provider returns official token
usage; never present an estimate as actual.

## (2026-10-01) Compact StudyMap workspace ownership

The workspace already keeps Chat/MindElixir/Summary mounted and uses overlay
surfaces for the inspector and map library. During the compact redesign, two
secondary collapse buttons were found on both source and inspector surfaces;
they duplicated the header owner and made the canvas chrome feel denser than
the available laptop viewport. Keep one close/collapse affordance per surface,
keep the inspector mounted, and change only presentation/offsets around the
existing state owners. Regression coverage lives in
`FE/src/components/Layout/compactWorkspace.test.js`.

## (2026-09-29) Export Studio document-export storage readiness — full audit

Consolidates and supersedes the Section 7 audit entry below for anything
specific to the NEW `mindmap_export` job type this round added. Read that
entry first for the general jobs-infrastructure findings (render.yaml is a
decoy, real production is AWS EC2 + docker-compose.prod.yml, no queue/Redis
anywhere); this entry is the export-file-specific follow-up.

**Where generated files are written**: `BE/app/domains/jobs/export_jobs.py`'s
`export_output_dir()` resolves `MEMORY_DIR` env var, falling back to
`BE_ROOT/memory` — the EXACT same resolution `app/domains/mindmap/store.py`'s
`db_path()` already uses for `mindmaps.sqlite`. Files land at
`<that>/exports/<job_id>.<ext>`, keyed by a server-generated UUID only.

**Do web and worker share this path?** There is no separate "worker"
process for this job type — `QUEUE_ENABLED=false` everywhere (Render and
AWS both), so export jobs run as an in-process daemon thread inside the
SAME Gunicorn worker that received the HTTP request (via the existing
`app.jobs.queue.enqueue_job` single switch point). No cross-process file
sharing is needed for this job type today. (The separate `mindmap-worker`
container in `docker-compose.prod.yml` is Guided Mind Map V3-only, a
different job type entirely, and does NOT run export jobs.)

**Does the production path survive a container restart?** Yes, on the
real AWS deployment — confirmed by reading `docker-compose.prod.yml`:
`backend`'s `JOBS_DB_PATH=/app/memory/jobs.sqlite` sits under the
`/opt/memvid/data/memory:/app/memory` HOST bind mount, and
`export_output_dir()`'s fallback (`BE_ROOT/memory` = `/app/memory` inside
the container, since `DATA_DIR=/app` and `BE_ROOT` resolves relative to
the app's own working directory) lands on that exact same durable volume.
**On Render Free** (the decoy backend, not real production — see the
Section 7 entry below), `DATA_DIR=/tmp/studymap` is explicitly ephemeral,
so export files there do NOT survive a deploy/restart/spin-down. This
distinction matters and is not hidden behind passing serializer tests.

**Token-signing mechanism**: `itsdangerous.URLSafeTimedSerializer`, reusing
`app.domains.auth.tokens._get_secret()` (same `AUTH_SECRET` resolution,
including its fail-closed behavior under `AUTH_REQUIRE_SECRET=true`) with
a dedicated salt (`mv-export-download-v1`) so the download-token namespace
can never collide with the bearer-token namespace.

**Token TTL**: 300 seconds (`DOWNLOAD_TOKEN_TTL_SEC`), re-minted fresh on
every `GET /mindmaps/exports/<job_id>` poll once status is `done` — a
client that keeps polling always has a valid token; one that stops polling
has ~5 minutes before it needs a fresh poll to download.

**File TTL / cleanup trigger**: no dedicated TTL on the file itself — it is
deleted the same moment its job ROW is pruned by the existing
`jobs_store.cleanup_terminal_jobs()` (default `JOB_RETENTION_DAYS=7`,
piggybacked onto the same rate-limited (`JOB_SWEEP_INTERVAL_SECONDS=300`)
maintenance sweep every job type already uses — see
`export_jobs.cleanup_terminal_export_files()`, wired into
`_run_jobs_maintenance()` in `app/main.py`). Verified with a real test
(`test_cleanup_removes_orphaned_export_file_once_its_job_row_is_pruned`).

**Maximum artifact size**: not explicitly capped beyond Flask's existing
global `MAX_CONTENT_LENGTH` (100 MB, `MAX_UPLOAD_MB` env-configurable) on
the REQUEST (map_image_base64 upload) — there is no separate cap on the
GENERATED output file size. A pathological map (very deep, very many
nodes) could in principle produce a very large PDF/DOCX/XLSX; nothing here
bounds that today. Flagged as a real gap, not fixed this round (would need
either a node-count ceiling on the request or a post-generation size check
before writing to disk).

**Maximum node count**: none enforced by the export path itself. The
mindmap GENERATION pipeline already caps map size (`MAX_NODES` in
`services/mindmap/pipeline/schema.py`'s `sanitize_nodes`), so in practice
every map reaching export already went through that ceiling — but the
export code path has no INDEPENDENT limit of its own if that upstream cap
were ever bypassed (e.g. a manually-edited record via `PUT /mindmaps/<id>`,
which does call `sanitize_nodes` too, so this is currently covered
transitively, not directly).

**Behavior when storage is unavailable**: if `export_output_dir()` can't be
created/written (disk full, permissions), the exception propagates up
through `run_export_job`'s own `except Exception` catch-all and lands the
job in `status="error"` with a generic message — never a silently "done"
job with no file, and never an unhandled thread crash that leaves the job
stuck at `running` forever (that class of failure is instead caught by
`sweep_stuck_jobs()`, see below). Not explicitly tested this round (would
need a real disk-full simulation); the code path is the same generic
exception handler already covering every other export failure mode.

**Lease recovery / worker restart** — the one real limitation: this job
type has NO dedicated lease-recovery/auto-resume path (unlike Guided Mind
Map V3, which has `recover_expired_jobs()` + re-enqueue logic in
`app/main.py`'s `_recover_guided_jobs`). If the process hosting an export
job's daemon thread crashes or restarts mid-export, the job row is left at
`status="running"` with a stale `updated_at`. The ONLY thing that catches
this is the generic `jobs_store.sweep_stuck_jobs()` (`JOB_STUCK_AFTER_
SECONDS=900` default — confirmed to have no `job_type` filter, so export
jobs ARE caught, verified by
`test_stuck_export_job_is_swept_like_any_other_job_type`), which marks it
`interrupted` — but nothing then automatically retries or resumes it. A
user whose export job died mid-flight sees `running` for up to 15 minutes,
then `interrupted`, and must manually resubmit. **This is an honest,
documented gap, not something to hide behind passing tests.**

**Verdict: PRODUCTION STORAGE GATE — PASS for durability of the file
itself (real bind mount, confirmed path resolution, real cleanup), but
WITH the lease-recovery gap above as a known, undocumented-until-now
limitation.** Given the durability question specifically (does the file
survive a restart) is answered yes on real production, and the recovery
gap is a availability/UX limitation rather than a data-loss risk (the
underlying mindmap data is never touched — only the export job's own
transient state), this does not block the release candidate on its own,
but should be read alongside the rest of this round's report before any
release decision.

## (ĐÃ SỬA 2026-09-28) MindElixirView's background-pan pointer capture hijacked clicks on the Export Studio selection bar

`MindElixirView.jsx`'s background-pan `pointerdown` handler (added to make left-click-drag
pan the canvas, working around a mind-elixir 5.13.0 internal bug — see that handler's own
long comment) calls `wrap.setPointerCapture(e.pointerId)` for any pointerdown whose target
doesn't match an exclusion list (`me-tpc, me-epd, .mm-floating-toolbar, .mm-legend,
.mm-fullscreen-corner`). The Export Studio multi-branch selection bar (`.mm-selection-bar`,
rendered as a descendant of the same pan-listening wrapper) was **not** in that list.

Effect verified with real Chromium (Playwright against `FE/fixture-harness.html`, NOT
jsdom): a `pointerdown` on the bar's "Tiếp tục"/"Xóa chọn"/"Hủy" buttons correctly hits the
button, but Chromium then redirects the synthesized `click` that follows to the
pointer-captured element (`wrap`) instead of the button — so the button's own `onClick`
never fires. No error, no console warning; the UI just silently does nothing. Confirmed by
instrumenting capture-phase `pointerdown`/`click` listeners on `document`: `pointerdown`
logged the `<BUTTON>` as target, `click` logged the `.mm-canvas-wrap` `<DIV>` as target.

**Root cause**: exclusion list incompleteness — a floating overlay added later
(`.mm-selection-bar`, part of this round's multi-branch export work) was never added to the
pan handler's target-exclusion selector.

**Why no existing test caught it**: every prior test of the selection bar's buttons ran in
jsdom (`MindElixirView.exportStudio.test.jsx`), and jsdom does not implement
pointer-capture-based click-target redirection — clicks there always land on the literal
button regardless of `setPointerCapture` calls. The behavior is Chromium-(and likely other
real-browser-)specific, invisible without driving an actual browser.

**Fix**: added `.mm-selection-bar` to the pan handler's exclusion selector
(`MindElixirView.jsx`'s `onDown`).

**Prevention**: any new floating/overlay UI rendered inside `canvasWrapRef` (toolbars,
selection bars, context menus, drawers) MUST be added to that same pointerdown exclusion
list, or its buttons will silently stop responding to clicks in a real browser while still
appearing to work in every jsdom-based test. This class of bug is exactly why the round's
own Section 10 mandate ("real files, real browser") exists — added a Playwright regression
test (`FE/e2e-fixture/export-studio.spec.js`, "regression: selection-bar buttons are not
hijacked by the canvas's background-pan pointer capture") against the real fixture harness
to guard it going forward.

## Guided durable worker integration: annotations must be available at module import (2026-09-21)

The first integration placed a typed dispatch helper above the `typing.Any` import
in `BE/app/main.py`. Python evaluates that annotation during module import, so the
application failed with `NameError: Any is not defined` before the existing release
hardening tests could load it. The fix imports `Any` before the helper. Prevention:
when adding module-level helpers during a split/import refactor, run an import smoke
test (or the narrowest existing pytest file) before running broader checks.

## (MỘT PHẦN ĐÃ SỬA 2026-09-03) Ba món nợ lộ ra khi wire retriever (Phase 2A)

**Mục 2 và 3 đã dọn** trong commit cleanup 2026-09-03: bỏ hẳn hai tham số chết khỏi
`build_query_graph` và chuỗi truyền `main.py -> wiring.py`. Lưu ý phân biệt: hàm
`store.search_index` VẪN SỐNG (có `test_store_precomputed` gọi thẳng) — thứ đã chết
chỉ là đường truyền tham số. `wiring.build_graphs` cũng VẪN giữ `index_meta_path`
vì mindmap/summary graph thật sự đọc nó.

**Mục 1 vẫn chưa sửa.**

Phase 2A gỡ đoạn `query_graph` tự dựng `HybridRetriever` và bắt buộc tiêm từ
`main.py`. Trong lúc làm, ba thứ lộ ra. Cả ba **cố ý chưa sửa**, vì sửa là ra
ngoài phạm vi "wire cái đã có".

### 1. `Retriever` Protocol hẹp hơn hợp đồng thật

`shared/interfaces/retriever.py` khai đúng một phương thức:

```python
def retrieve(self, query, *, selected_sources=None, top_k=6) -> List[RetrievedChunk]
```

Nhưng khi `USE_LC_ENSEMBLE=1`, node truy hồi đi qua
`ensemble_retriever.hybrid_retrieve_with_ensemble`, và hàm đó gọi tiếp
`retrieve_bm25_only` / `retrieve_faiss_only` — hai phương thức **không có trong
Protocol**. Nghĩa là một object khớp `Retriever` vẫn chết ở nhánh ensemble.

Nợ này **có từ trước** Phase 2A: injection đã được hỗ trợ từ lâu, chỉ chưa ai
dùng nên chưa ai va phải. Test hiện tại không bắt được vì `_qg_build.base_env`
đặt `USE_LC_ENSEMBLE=0`.

Sửa đúng cách là mở rộng Protocol cho đủ ba phương thức, hoặc để ensemble nhận
một Protocol riêng. Cả hai đều đụng `shared/interfaces` — việc của phase sau.

### 2. `search_index` đi qua bốn file để không làm gì

```text
main.py:29 (import) -> main.py:1423 -> wiring.py:42,83 -> query_graph.py:62
```

Trong thân `query_graph.py`, `search_index` xuất hiện **đúng một lần**: chính
dòng khai báo tham số. `grep -c search_index app/graphs/query_graph.py` = 1.

Chưa xoá: dọn tham số chết là task riêng, và trộn nó vào một commit refactor
kiến trúc làm diff khó đọc.

### 3. `index_meta_path` vừa trở thành tham số chết thứ hai — do chính Phase 2A

Trong `build_query_graph`, `index_meta_path` **chỉ** được dùng để dựng
`HybridRetriever`. Gỡ đoạn dựng đó đi thì nó còn đúng một lần xuất hiện: dòng khai
báo tham số. Đây là nợ MỚI, không phải nợ có sẵn — ghi rõ để lần sau không ai
tưởng nó vốn thế.

Chưa xoá vì cùng lý do với `search_index`, và vì xoá là đổi chữ ký, kéo theo
`wiring.py` + `tests/_qg_build.py`. Ba tham số chết (`search_index`,
`index_meta_path`, và bất kỳ cái nào lộ ra sau đó) nên dọn CÙNG một commit riêng.


## (CHƯA SỬA — ghi nhận 2026-09-02) `test_queue.py` có test phụ thuộc THỨ TỰ chạy

Trong lúc rút 6 job runner khỏi `main.py` (Phase 1), sau khi sửa 5 test stale thì chạy
riêng `pytest tests/test_queue.py` vẫn thấy 2 test đỏ:

- `test_stats_has_queue_block` — nhận 401 trong khi chờ 200
- `test_query_path_still_returns_job_id_not_queued`

Chạy cả bộ (`pytest -q`) thì cả hai xanh. Đây **không phải hồi quy của Phase 1**. Kiểm
chứng bằng cách lấy đúng file ở commit trước rồi chạy cô lập:

```bash
git show HEAD:BE/tests/test_queue.py > /tmp/test_queue_HEAD.py
# chạy riêng file này -> 3 test đỏ, gồm cả 2 test trên
```

Nguyên nhân: hai test đó dựa vào trạng thái mà test khác trong bộ dựng sẵn (phiên đăng
nhập / cờ hàng đợi), không tự dựng lấy. Chạy một mình thì trạng thái đó chưa có.

**Quy tắc cho các phase sau:** thấy test đỏ lúc chạy cô lập thì **đối chiếu với `HEAD`
trước khi đổ cho refactor** — `git show HEAD:<file>` rồi chạy đúng file đó. Đỏ ở cả hai
nghĩa là nợ có sẵn, không phải do thay đổi vừa làm.

Cố ý **chưa sửa** trong Phase 1: sửa fixture của 2 test này là đụng vào phần ngoài phạm
vi "chỉ di chuyển mã", và sẽ trộn lẫn thay đổi hành vi test vào một commit refactor
thuần. Để lại cho một commit riêng.


## (ĐÃ SỬA 2026-09-02) "Kết quả bài thi sai" — hoá ra một câu hỏng, một câu trả lời sai thật

Người dùng gửi link trang kết quả và nói kết quả sai. Tra thẳng DB attempt
`01597551-7868-481a-8eff-1c1dd01b1689`: `graded · 0.0/2.0 = 0% · đúng 0 / sai 2`.

**Trước khi kết luận, tôi đã đoán sai HAI lần. Ghi lại cả hai vì cách sai giống nhau:
kết luận từ một phép đo tóm tắt thay vì nhìn dữ liệu thật.**

1. *"Cả bốn lựa chọn gần như y hệt nhau, câu hỏi không trả lời được"* — dựa trên 34 ký
   tự đầu bị cắt khi in ra. In đủ thì thấy phần phân biệt nằm ở ĐUÔI và khác nhau thật.
2. *"Giao diện cắt mất phần đuôi nên không đọc được"* — grep `truncate`/`line-clamp`
   trong `QuizTaking.jsx` và `.answer-option`: **không có**. Chữ xuống dòng đầy đủ.

### Sự thật sau khi in đủ hai câu

**Câu 2 KHÔNG hỏng.** Bốn lựa chọn khác nhau rõ (kiến thức chung / dữ liệu nội bộ /
creative writing / citation). Người dùng chọn *"kiến thức chung, không cần citation"* —
sai thật với RAG. Chấm đúng.

**Câu 1 hỏng, nhưng không phải vì "nhìn giống nhau":**

```
[ĐÚNG] Retrieval-Augmented Generation là kỹ thuật kết hợp truy xuất thông tin từ kho dữ liệu…
[    ] RAG là kỹ thuật dùng LLM trả lời câu hỏi dựa trên dữ liệu nội bộ.
[    ] RAG là kỹ thuật dùng LLM trả lời câu hỏi dựa trên dữ liệu từ internet.
[    ] RAG là kỹ thuật dùng LLM trả lời câu hỏi dựa trên dữ liệu từ kho dữ liệu.  ← người dùng chọn
```

Ba "đáp án nhiễu" **đều là mô tả đúng về RAG**. Người học chọn một câu đúng nhưng không
phải chuỗi model chỉ định → bị chấm sai. Điểm 0% ở đây là **nửa do đề hỏng, nửa do trả
lời sai** — không phải "kết quả sai".

### Ngưỡng: đo, thấy không có khoảng trống, đo tiếp, rồi mới chọn

Lần đo đầu (max Jaccard giữa các cặp lựa chọn, 8 câu MC trong DB) cho một dải **liên
tục** 0.467 → 1.000, không có chỗ cắt. Đo thêm "tỉ lệ từ đầu giống nhau" cũng không tách
được (câu lành nhất lại có tiền tố chung 0.667).

Chỉ khi **đọc tận mắt** các ca ở ranh giới mới thấy đường phân chia thật:

```
dùng được : 0.467 · 0.700 · 0.722
hỏng      : 0.864 · 0.900 · 0.905 · 1.000 · 1.000
```

Khoảng trống nằm giữa **0.722 và 0.864** → `NGUONG_LUA_CHON_GIONG = 0.80`.

Con số 0.72 trong plan ban đầu **sẽ loại nhầm** câu 2 — câu hoàn toàn dùng được.

### Trần đã biết, viết thẳng vào mã

Đây là phép đo **CHỮ**, không phải nghĩa. Ca hỏng thật bị bắt vì ba nhiễu **tình cờ**
cũng giống nhau về chữ. Một bộ nhiễu diễn đạt khác hẳn nhưng cùng đúng về nghĩa thì luật
này **không bắt được** — muốn bắt phải kiểm bằng nghĩa (NLI/embedding), đắt hơn nhiều,
chưa làm.

### Regression

`test_quiz_lua_chon_trung.py` +3: ca hỏng thật (0.905) phải bị loại, ca dùng được (0.722)
phải được giữ, và một ca khoá **ngưỡng nằm trong khoảng trống đo được** —
`0.722 < NGUONG < 0.864`. Đổi ngưỡng ra ngoài khoảng đó là đỏ. `demo()` của
`rules.py` có cả hai ca biên.

### Phòng ngừa

**In đủ trước khi kết luận.** Hai lần đoán sai đều đến từ việc đọc bản in bị cắt 34 ký
tự. Khi so sánh chuỗi, in đủ chuỗi — hoặc in phần KHÁC NHAU, đừng in phần đầu.

**Không có khoảng trống trong dữ liệu = chưa được phép chọn ngưỡng.** Dải liên tục nghĩa
là chỉ số đang dùng chưa tách được hai nhóm. Hoặc tìm chỉ số khác, hoặc đọc tận mắt vài
ca ranh giới để biết nhóm thật nằm đâu — đừng cắt giữa cho có.

## (ĐÃ SỬA 2026-09-02) Quiz ra 2/10: ba nguyên nhân, và giả thuyết ban đầu của tôi sai

Người dùng báo *"Ra được 2 câu trên 10 câu đã chọn"*. Job `e31ace34`:

```
quiz_bu_cau job_id=e31ace34 co=2 thieu=8
quiz_bu_cau_xong tong=2                  <- vòng bù thêm được 0 câu
FR-13.7  Trùng câu hỏi đã nhận   12 câu
FR-13.2  Đáp án không khớp        2 câu
```

### Nguyên nhân 1 — lượt bù bị giấu mất 12/14 thứ model vừa viết

Prompt lượt bù chỉ liệt kê câu **được nhận**:

```
Đã có sẵn 2 câu dưới đây. Ra thêm 8 câu KHÁC HẲN, không lặp ý:
- Cau A?
- Cau B?
```

12 câu bị loại không có trong danh sách, nên model không biết mình vừa viết chúng và
viết lại y hệt → lại bị loại vì trùng. Bảo model "đừng lặp" trong khi giấu phần lớn thứ
nó vừa viết là **thông tin thiếu**, không phải model bướng.

**Fix:** `gom_da_co(accepted, tho)` — gộp câu được nhận + câu thô lượt trước, khử trùng,
câu được nhận đứng trước (vừa là thứ cần tránh, vừa là ví dụ tốt về hình dạng đạt yêu cầu).

### Nguyên nhân 2 — JSON hỏng thì VỨT CẢ LƯỢT

Đây là cái đắt nhất, và **phép đo đã bác bỏ giả thuyết đầu tiên của tôi**.

Tôi nghi "output vượt trần `num_predict=3000`". Đo thật trên gemma2:2b, cùng ngữ liệu
3801 ký tự:

```
 xin  ký tự ra   ~token  câu JSON  kết quả
   3      2019      747         3  OK
   5      2485      920         0  HỎNG      <- ca hỏng là ca NGẮN NHẤT
   8      5029     1862         7  OK
```

Một câu tốn ~230 token → 10 câu ≈ 2300–2500, **nằm trong** trần 3000. Hỏng **không theo
độ dài**. Nếu tin giả thuyết mà nâng `num_predict` hoặc cắt ngữ liệu thì đã đánh đổi ngân
sách để chữa một thứ không hỏng.

Sự thật: model nhỏ thỉnh thoảng trả JSON không hợp lệ, ngẫu nhiên. Và hậu quả mới là chỗ
đắt — `repair_json_text` đòi một khối `{...}` **cân bằng cho cả tài liệu**, nên 2485 ký tự
output bị ném đi **toàn bộ** dù bên trong có những object câu hỏi đã viết xong đàng hoàng.
Người dùng nhận 0 câu sau một phút CPU.

**Fix:** `vot_cau_hoan_chinh(raw)` — quét có nhận biết chuỗi, dùng **NGĂN XẾP** chứ không
phải bộ đếm mức ngoài cùng. Khi output bị cắt thì object ngoài cùng (`{"questions": […`)
không bao giờ đóng, nên gom ở mức 0 sẽ ra rỗng — đúng thứ cần cứu nằm **lồng bên trong**.
Parse riêng từng object cân bằng, chỉ giữ object có `question_text` (object `meta` lồng
bên trong cũng parse được nhưng không phải câu hỏi). Gọi TRƯỚC khi báo lỗi.

### Nguyên nhân 3 — `chunk_refs` bị bỏ (75% ở lần chạy trước đó)

Job `e4bfd2dd`: 9/12 câu mất vì FR-13.5. Đã siết prompt: `chunk_refs` ghi **BẮT BUỘC ở
MỌI câu** kèm hậu quả và một dòng nói thẳng "đây là lỗi bị loại NHIỀU NHẤT" — cùng khuôn
đã dùng cho `explanation`.

### Hai chỗ tự làm hỏng rồi tự sửa, ghi lại vì dễ lặp

1. **`cat >>` đẩy hàm mới xuống DƯỚI `if __name__ == "__main__": demo()`.** Test xanh
   (test import module, không chạy `__main__`) còn `python -m app.domains.quiz.generator`
   thì `NameError`. **Test xanh không chứng minh module chạy được.** Kho này có lệ
   `demo()` self-check đúng để bắt loại lỗi đó — phải chạy nó, không chỉ chạy pytest.
2. Lỡ commit `BE/_do_ngan_sach_tam.py` (script đo tạm) ở `e6b591a`; gỡ ở `e2fca45`.

### Phòng ngừa

**Đo trước khi sửa — kể cả khi giả thuyết nghe rất hợp lý.** "Output vượt num_predict"
giải thích được mọi triệu chứng, có con số ngân sách sẵn trong comment để hậu thuẫn, và
sai. Ba dòng đo (3/5/8 câu) tốn ba phút và đổi hướng toàn bộ bản sửa.

**Khi tầng phân tích cú pháp thất bại, hỏi "còn cứu được gì không" trước khi vứt.** Một
lượt gọi LLM là một phút CPU và một lần chờ của người dùng. `json.loads` hỏng không có
nghĩa là *mọi thứ* trong chuỗi đó đều hỏng.

## (ĐÃ SỬA 2026-09-01) CORS thiếu PATCH/PUT — mọi lần chọn đáp án đều hỏng, và log BE trông vẫn bình thường

Người dùng báo: chọn đáp án trong quiz thì hiện "Không kết nối được máy chủ. Kiểm tra
mạng rồi thử lại." Máy chủ vẫn chạy, `/health` 200.

**Bằng chứng quyết định — đếm trong log BE:**

```
OPTIONS /api/attempts/<id>/answers  200   x4
PATCH   /api/attempts/<id>/answers        x0
```

Bốn lần preflight, **không lần nào** request thật tới nơi.

```python
# main.py:130 — trước khi sửa
CORS(app, resources={...}, methods=["GET", "POST", "DELETE", "OPTIONS"], ...)
```

Thiếu `PATCH` và `PUT`. Trình duyệt đọc `Access-Control-Allow-Methods`, không thấy method
mình cần, và **chặn request thật trước khi gửi**. `fetch` ném `TypeError`; `moTaLoi` dịch
đúng theo thứ nó thấy thành "Không kết nối được máy chủ".

**Vì sao khó thấy:** preflight trả **200**. Nhìn log BE chỉ thấy `OPTIONS ... 200` nối
nhau, trông như mọi thứ bình thường. Không có dòng lỗi nào, không có 4xx/5xx. Thứ duy
nhất tố cáo là **cái không có mặt**: không có dòng `PATCH` nào.

**Hai tính năng chết hoàn toàn qua trình duyệt:**

| route | tính năng |
|---|---|
| `PATCH /api/attempts/<id>/answers` | lưu nháp đáp án — mọi lần chọn đáp án |
| `PUT /mindmaps/<id>` | lưu mindmap đã sửa |

**Đáng ghi:** cùng ngày, khi rà plan `mindmap-ux-v3`, Task 8 ("Edit → nút Lưu → PUT") được
đánh dấu ĐÃ LÀM vì route tồn tại ở `main.py:4616` và `updateMindmap` tồn tại ở
`utils/api.js`. Cả hai đều có thật — và trình duyệt **chưa bao giờ gọi được**. Kiểm sự
tồn tại của file/route không phải là kiểm hành vi.

### Regression

`BE/tests/test_cors_methods.py` — 4 test. Ca chính khoá hợp đồng bằng **hành vi**, không
bằng đọc mã nguồn: duyệt `app.url_map` (nguồn sự thật lúc chạy) lấy mọi method đang dùng,
rồi tự hỏi preflight và so. Thêm route `PATCH`/`PUT` mới mà quên CORS sẽ đỏ ngay. Kèm một
ca chặn hướng ngược lại: không được nới `Allow-Methods` thành `*`.

### Bẫy gặp lúc xác minh — ghi lại vì suýt kết luận sai

Sửa xong, test xanh, nhưng `curl` vào server thật **vẫn không có** header
`Access-Control-Allow-Methods`. Suýt kết luận "flask_cors không hoạt động như test".

Sự thật: tiến trình BE cũ **chưa bị dừng**, nó vẫn giữ cổng 8080, còn tiến trình mới in
"Running on http://127.0.0.1:8080" rồi ngồi im (Werkzeug không báo lỗi bind rõ ràng ở
đây). Đo được: test client trên app import trực tiếp trả đủ header, còn cổng 8080 thì
không — hai kết quả khác nhau cho cùng một mã là dấu hiệu **hai tiến trình khác nhau**.

Sau khi dừng tiến trình cũ, server thật trả:
`Access-Control-Allow-Methods: DELETE, GET, OPTIONS, PATCH, POST, PUT`.

### Phòng ngừa

**Preflight 200 không có nghĩa là request qua được.** Khi FE báo lỗi mạng mà BE vẫn sống,
hãy đếm **cặp** OPTIONS/method-thật trong log. Thiếu vế thứ hai là CORS chặn, không phải
mạng.

**Khởi động lại server thì phải DỪNG cái cũ trước.** Hai tiến trình cùng cổng cho ra một
hệ thống mà bản vá "không có tác dụng" một cách bí ẩn — và cách phân biệt rẻ nhất là so
kết quả qua cổng với kết quả qua test client trên cùng mã.

## (ĐÃ SỬA 2026-09-01) Giao diện tự bịa nguyên nhân câu hỏi bị loại — và chính tôi viết câu đó

Người dùng chạy thật, giao diện hiện:

> Ra được 7 câu trên 10 câu đã chọn. 12 câu bị loại vì không đạt kiểm chất lượng —
> **thường là do đoạn tài liệu tương ứng quá ngắn để ra đề.**

Vế sau là một **phỏng đoán trình bày như sự thật**, do tôi viết ở vòng 7 khi thêm dòng
thông báo này. Không có gì đo nó cả.

Lý do THẬT, tra từ `ai_validation_logs` của đúng job đó (e4bfd2dd):

```
FR-13.5  Thiếu chunk_refs                            9 câu  (75%)
FR-13.7  Trùng câu hỏi đã nhận                       2 câu
FR-13.1  multiple_choice cần ≥2 lựa chọn phân biệt   1 câu
```

**Không câu nào vì đoạn tài liệu ngắn.** Ba phần tư mất vì model không trích nhãn nguồn.

Nghịch lý đáng ghi: dữ liệu để nói đúng đã nằm sẵn trong DB từ FR-13.11 (log giữ nguyên
văn item bị loại + `rule_code`), và `count_by_rule` cũng có sẵn. Giao diện đoán trong khi
câu trả lời thật cách đó một truy vấn.

### Đã sửa

- `rules.ly_do_loai(rejections)` — đếm theo `rule_code`, trả câu mô tả nguyên nhân
  **chiếm đa số**. Mã lạ (luật mới thêm mà quên cập nhật bảng) vẫn trả một câu có nghĩa
  kèm mã, không im lặng — im lặng ở đây là quay lại đúng chỗ vừa sửa.
- `result` của job thêm `rejected_reason` + `rejected_by_rule`; `QuizSetup` chuyển sang
  router state; `QuizTaking` hiện "phần lớn do <nguyên nhân>" và **bỏ hẳn** câu đoán.
  Không có nguyên nhân thì kết thúc câu bằng dấu chấm, không bịa thêm.

### Và một số liệu nữa từ cùng lần chạy

```
quiz_bu_cau job_id=e4bfd2dd co=0 thieu=10
quiz_bu_cau_xong tong=7
quiz_job_done kept=7 rejected=12
```

**Lượt đầu ra 0 câu dùng được.** Cả 7 câu đều đến từ vòng bù (V8-3). Không có vòng bù thì
job này đã chết với "Không câu hỏi nào qua kiểm chất lượng" — người dùng thấy thất bại
hoàn toàn thay vì 7 câu.

Cũng trong lần này, luật gộp lựa chọn trùng (V8-1) bắt được **1 ca thật** ngoài đời, đúng
thứ người dùng báo lúc đầu.

Vì FR-13.5 chiếm 75%, đã siết prompt: `chunk_refs` giờ ghi **BẮT BUỘC ở MỌI câu** kèm hậu
quả và một dòng nói thẳng "đây là lỗi bị loại NHIỀU NHẤT" — cùng khuôn đã dùng cho
`explanation` ở V8-2.

### Phòng ngừa

**Đừng viết nguyên nhân vào giao diện nếu không đo nó.** Một câu "thường là do X" nghe
rất tự nhiên và không ai chất vấn — nhưng nó dạy người dùng một mô hình sai về hệ thống,
và khi họ làm theo (rút ngắn/kéo dài tài liệu) thì không có gì khá hơn.

**Có log rồi thì đọc log.** FR-13.11 sinh ra đúng để trả lời câu này. Khoảng cách giữa
"dữ liệu có sẵn" và "giao diện dùng nó" là chỗ phỏng đoán chui vào.

## (ĐÃ SỬA 2026-09-01) Nút "Huỷ" trong chat giờ huỷ thật — và nhả được slot LLM

Đóng phần trần còn lại của FE#12. Bản vòng 8 mới chỉ sửa LỜI (không hứa việc không làm);
lần này sửa VIỆC.

### Trước

Bấm Huỷ chỉ `abort()` request phía trình duyệt. BE không có đường huỷ cho job `query`:
`_CANCELLABLE_JOB_TYPES` không có `"query"`, và `query_graph` không gọi
`is_cancel_requested` ở bất kỳ đâu. Job chạy tới xong và **vẫn giữ slot LLM duy nhất** —
câu hỏi tiếp theo phải xếp hàng sau một truy vấn người dùng đã bỏ.

### Thứ tự bắt buộc, và vì sao

`main.py` có một comment cấm rất rõ: *"Thêm job_type vào đây CHỈ SAU KHI executor của nó
thật sự gọi `is_cancel_requested`"* — vì route trả `cancel_requested=True` cho một loại
job không ai đọc cờ sẽ làm FE hiện "Đang huỷ…" rồi treo tới hết TTL (known-issues
2026-07-17). Nên làm theo đúng thứ tự: graph đọc cờ **trước**, mở cổng **sau**, nối FE
**sau cùng**.

### Đã làm

1. `build_query_graph(da_huy=...)` — `_boc_huy(ten, fn)` bọc **cả 18 node**, đọc cờ TRƯỚC
   khi chạy node. State trả về trùng hình dạng nhánh dừng sớm sẵn có ở
   `retrieve_faiss_node` (`done=True` + `payload` + `status_code`), nhờ vậy mọi cạnh điều
   kiện xử lý nó y như một kết thúc bình thường — không phải sửa routing.
2. `QueryState.cancelled: NotRequired[bool]`. **Không có dòng này thì cờ rơi ngay ở cạnh
   kế tiếp** — LangGraph chỉ giữ field có trong schema. Bẫy đã ghi cho `IngestState`,
   lặp lại nguyên vẹn: `payload` sống sót vì có khai, `cancelled` biến mất vì không.
   Test đầu tiên đỏ đúng vì lý do này chứ không phải vì logic sai.
3. `_finalize_query_job` đọc `cancelled` **TRƯỚC** mọi nhánh lỗi. Lượt bị huỷ không có
   `answer` và cũng không có `error`, nên rơi xuống dưới là khối
   `not has_ans and not has_err` gán `"Unknown error"` → màn hình đổ lỗi cho hệ thống về
   việc người dùng vừa bấm dừng. Đúng bẫy đã gặp ở quiz vòng 8, ở một file khác.
   Và **không ghi lịch sử hội thoại** cho lượt bị huỷ: nó không có câu trả lời, ghi vào
   là bịa ra một lượt chưa từng hoàn thành rồi mang sang ngữ cảnh lượt sau.
4. `"query"` vào `_CANCELLABLE_JOB_TYPES`; `_query_da_huy` nối qua `wiring.py` vào graph
   production. **Mở cổng mà không nối dây thì đúng là thứ comment kia cấm** — cổng mở,
   route trả 200, và không có gì dừng cả.
5. FE `handleCancel` gọi `cancelJob(jobIdRef.current)`, lời báo theo đúng kết quả thật.

### Trần còn lại — nói ra, đừng giấu

Huỷ tới được ở **ranh giới node**, không cắt được node đang chạy: node là một request
HTTP tới Ollama, Python không cắt ngang được. Worst case = thời lượng node đó
(`AI_TIMEOUT_SEC=180` với `GenerateAnswer`). Muốn xuống nữa thì phải huỷ ở tầng HTTP
client, không phải ở đây. Lời trong giao diện viết đúng phạm vi này: *"Đã yêu cầu dừng
truy vấn. Bước đang chạy sẽ kết thúc rồi job dừng hẳn."*

### Regression

`BE/tests/test_query_cancel.py` — 11 test: dừng ngay khi cờ bật từ đầu; dừng ở ranh giới
node kế tiếp khi huỷ giữa chừng; không huỷ thì chạy bình thường; không truyền `da_huy`
thì hành vi y như cũ; **`da_huy` ném lỗi KHÔNG được biến thành huỷ** (sqlite khoá không
được giết job đang chạy tốt); không có `job_id` thì không tra cờ; finalize ghi
`cancelled` chứ không `error`; lượt bình thường vẫn `done`; không lưu lịch sử cho lượt bị
huỷ; `"query"` có trong danh sách huỷ được; và `ingest`/`short_answer_grading` **vẫn bị
từ chối** — đừng mở cổng cho loại job không ai đọc cờ.

### Phòng ngừa

**Đăng ký "huỷ được" và thật sự huỷ được là hai việc khác nhau.** Thứ tự đúng: executor
đọc cờ → mở cổng → nối FE. Làm ngược lại cho ra một nút bấm trả 200 và không dừng gì,
tệ hơn không có nút.

**Field không khai trong TypedDict của LangGraph thì biến mất giữa hai node.** Lần thứ
hai trong cùng kho (lần đầu: `IngestState`). Khi thêm một khoá state mới, khai schema là
bước một, không phải bước dọn dẹp sau.

## (ĐÃ ĐÓNG 2026-09-01) Ablation E0–E7: số hợp lệ ĐÃ CÓ SẴN trên R1, và "BM25 thắng dense" là kết luận sai

Đóng hai mục CHẶN. Hoá ra phần lớn công việc đã làm xong từ trước và không ai đọc lại.

### Đính chính hai chỗ playbook nói sai

1. Mục "(CHẶN — CẦN NGƯỜI QUYẾT) Ablation E0–E7 không chạy được" ghi *"`reports/
   evaluation/runs/` KHÔNG TỒN TẠI. Bộ ablation chưa chạy lần nào."* — **sai**. Thư mục
   có **20 run**, trong đó **thang E0–E7 đầy đủ trên `R1_structure`, mỗi thí nghiệm đủ
   30/30 truy vấn**.
2. Hàng rào `canonical extraction changed` nằm ở `index_builder.py:71` — nó chặn **dựng
   index**, không chặn **chạy thang**. Index `R1_structure` đã dựng sẵn nên nó không
   chặn gì cả. Mục cũ mô tả nó như cửa cuối cùng chặn mọi thứ.

### Số hợp lệ (25 truy vấn CÓ nhãn vàng — câu không nhãn không vào mẫu số)

| thí nghiệm | recall@6 | MRR | nDCG@6 |
|---|---|---|---|
| E0_bm25 · R2 | 0.8371 | 0.7467 | 0.7331 |
| **E0_bm25 · R1** | **0.8371** | 0.7467 | 0.7331 |
| E1_faiss · R2 | 0.2286 | 0.1213 | 0.1460 |
| **E1_faiss · R1** | **0.6971** | 0.6727 | 0.6379 |
| E2_hybrid · R2 | 0.4686 | 0.3313 | 0.3638 |
| **E2_hybrid · R1** | **0.7829** | 0.8213 | 0.7654 |
| E3_rerank · R2 | 0.6229 | 0.6080 | 0.5963 |
| **E3_rerank · R1** | **0.9029** | 0.9200 | 0.8917 |
| E4_nli · R1 | 0.9029 | 0.9200 | 0.8930 |
| E5_crag · R1 | 0.9029 | 0.9200 | 0.8930 |
| E6_full · R2 | 0.1114 | 0.0533 | 0.0657 |
| **E6_full · R1** | **0.9029** | 0.9200 | 0.8930 |
| E7_full_hitl · R1 | 0.9029 | 0.9200 | 0.8930 |

**Ba phép tự kiểm cho thấy bảng R1 đáng tin:**
- `E0_bm25` **giống hệt nhau ở cả hai index** (0.8371). Đúng như phải thế — BM25 thuần từ
  vựng, không đụng vector. Đây là biến chứng nội tại.
- `E1 < E2 < E3` đơn điệu tăng trên R1: hybrid hơn từng thành phần, rerank hơn hybrid.
  Đó là hình dạng của một hệ thống chạy đúng.
- Trên R2, `E6_full` = 0.1114, **tệ hơn cả E1**. Thang mà càng thêm thành phần càng tệ là
  dấu hiệu nền hỏng, không phải dấu hiệu thành phần vô dụng.

**Kết luận "BM25 thắng dense retrieval" là SAI.** Trên nền lành: dense 0.6971, hybrid
0.7829, rerank 0.9029. BM25 (0.8371) chỉ thắng dense đơn lẻ và thua hẳn khi có rerank.

E4/E5/E6/E7 trùng khít E3 ở chỉ số **truy hồi** là đúng: NLI/CRAG/HITL tác động ở tầng
sinh câu trả lời, không đổi thứ hạng truy hồi trong các cấu hình này. Đừng đọc đó là
"không đóng góp gì" — phải nhìn chỉ số QA.

**Cảnh báo khi viết báo cáo:** `n=50` ở E0–E3_R1 là **25 truy vấn × 2 lần chạy trùng**,
không phải 50 truy vấn. Trung bình không đổi (hai lần ra số y hệt) nhưng đừng viết 50.

### Sụp không gian: đo lại đủ bốn index, và phát biểu cũ chưa chính xác

```
index           n     cosine TB   canh nhau
production     188      0.6622      0.7820
R0_recursive   171      0.5091      0.5970
R1_structure   142      0.5117      0.6246
R2_late        142      0.9262      0.9950   <- sup
```

Production **cũng dùng late chunking** (`ingest_graph.py:165` gọi `embed_document`, y hệt
`index_builder.py:108`) mà **không sụp** — nhưng cạnh-nhau 0.7820 cao hơn R0/R1 (~0.60)
rõ rệt, tức một phiên bản NHẸ của cùng hiện tượng.

Nên phát biểu đúng không phải *"late chunking làm sụp không gian vector"* mà: **late
chunking làm span cạnh nhau giống nhau, mức độ tăng theo độ dài tài liệu, tới ngưỡng nào
đó thì sụp hẳn.** Corpus nghiên cứu có tài liệu 14550 token (vượt cửa sổ 8192); tài liệu
production ngắn hơn nhiều.

Phần "mean-pool vs CLS" trong mục cũ vẫn đúng cho **đường đánh giá** (truy vấn nhúng qua
sentence-transformers = CLS, tài liệu mean-pool), nhưng nó KHÔNG giải thích được vế
doc-side: production cùng mean-pool cả hai đầu mà vẫn có hiện tượng nhẹ.

### Hàng rào đã thêm

`BE/evaluation/suc_khoe_index.py` + gọi từ `evaluation/runner.py` trước `validate_dataset`.
Đo cosine trung bình và cosine chunk-cạnh-nhau của index sắp dùng; vượt 0.90 thì in cảnh
báo nêu rõ mọi số liệu rút ra sẽ vô nghĩa. Ngưỡng 0.90 nằm giữa khoảng trống đo được
(production 0.7820 ↔ R2 0.9950) nên không cần tinh chỉnh.

Đây **không phải** bản sửa late chunking. Nó không làm index hết sụp; nó làm việc sụp
**kêu lên** trước khi ai đó tiêu 15 giờ máy vào nó. Fail-open: hàng rào hỏng không được
chặn thang đo.

Regression: `BE/tests/test_suc_khoe_index.py` — 5 test, dựng IndexFlatL2 thật chứ không
mock faiss, gồm ca "không đo được KHÔNG phải là sụp" và ca khoá ngưỡng nằm giữa hai số
thật đã đo.

### Phòng ngừa

**Trước khi lên kế hoạch chạy lại, kiểm xem đã chạy chưa.** Hai mục CHẶN đứng một tuần
trong khi kết quả hợp lệ nằm sẵn trên đĩa. `ls reports/evaluation/runs/` là một lệnh.

**Một chỉ số hỏng thì im, một THANG hỏng thì lộ.** Bảng R2 tự tố cáo ở chỗ E6_full tệ hơn
E1 — thêm thành phần mà tệ đi là điều không hệ thống đúng nào làm được. Khi đọc kết quả
ablation, kiểm tính đơn điệu trước khi kiểm từng con số.

**Chỉ số không đổi giữa hai cấu hình không có nghĩa là thành phần vô dụng** — có thể nó
tác động ở tầng khác. E4/E5/E6/E7 trùng E3 ở truy hồi vì NLI/CRAG/HITL làm việc ở tầng
sinh câu trả lời.

## (ĐÃ ĐO + SỬA 2026-09-01) NLI nhanh hơn 764 lần sau khi đổi model — và phép đo đầu của chính tôi đã sai

Đóng mục "(CHƯA SỬA) NLI mDeBERTa chậm gấp ~250 lần dự toán FLOP".

**Đính chính trước:** mục cũ ghi "(CHƯA SỬA)" nhưng `BE/.env` **đã có** `NLI_ENABLED=0`
kèm đủ chú thích từ trước — đường (a) đã làm rồi. Phần thật sự còn treo là đường (b):
đổi sang model nhẹ hơn để **bật lại được**, vì ablation E4_nli của luận văn cần NLI bật.

### Số đo (`scripts/do_model_nli.py`, CPU, batch 2)

```
mDeBERTa-v3-base (279M, 12 lớp) : 128t  39.61s · 256t  69.39s · 512t 137.51s
MiniLMv2-L6      (107M,  6 lớp) : 128t   0.05s · 256t   0.09s · 512t   0.18s
```

**Nhanh hơn 764 lần trong khi chỉ ít hơn 2.6 lần tham số.** Đây là bằng chứng thẳng cho
chẩn đoán cũ: nút thắt không phải khối lượng tính toán mà là các phép gather/index tuần
tự của attention tách rời trong DeBERTa-v3. Kiến trúc attention thường không dính.

Một truy vấn (`NLI_MAX_PAIRS=3` × 512 token): **412.5s → 0.5s**.

(mDeBERTa đo được 137.5s ở đây so với 94s trong mục cũ — máy đang chạy BE và các việc
khác. Không đổi kết luận.)

### Chất lượng — và một phép đo sai của chính tôi

Lần thử đầu dùng tiếng Việt **KHÔNG DẤU**, ra kết quả đáng lo: mâu thuẫn chỉ đạt
0.489/0.529 (dưới ngưỡng 0.6, tức là sẽ không bao giờ kích), còn một cặp hoàn toàn không
liên quan lại được 0.387 và bị gán nhãn `entailment`. Suýt kết luận "model nhẹ hiệu chỉnh
kém, phải hạ ngưỡng".

Chạy lại với tiếng Việt **CÓ DẤU** — 6/6 đúng, tách bạch rất rộng:

```
mâu thuẫn : 0.997  0.992  0.997
kéo theo  : 0.002
trung lập : 0.019  0.178
```

`NLI_CONTRADICTION_THRESHOLD=0.6` nằm gọn trong khoảng trống giữa 0.178 và 0.992 —
**không cần chỉnh**. Lỗi nằm ở phép đo, không ở model: bỏ dấu là bỏ mất phần lớn tín hiệu
cho một model đa ngữ, và nó đẩy mọi phân phối về giữa.

### Đã đổi

- `NLI_MODEL` → `MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli` ở `shared/config.py`
  (cả hằng số lẫn `os.getenv` mặc định), `BE/.env`, hai `.env.example`,
  `docker-compose.yml`. `render.yaml` sửa chú thích cỡ model (~1.1GB → ~0.4GB).
- `NLI_TIMEOUT_SEC` 90 → 15. Hạn 90s là hạn cho model 137s/lượt; giờ 3 cặp mất ~0.5s nên
  90s không còn là hàng rào mà là một con số bỏ quên.
- `NLI_ENABLED` **giữ 0**. Bật hay không là quyết định về hành vi sản phẩm (NLI lọc chunk
  mâu thuẫn — dương tính giả sẽ cắt mất ngữ liệu đúng), và 6 mẫu chưa đủ để tôi tự quyết
  thay. Nhưng lý do cũ để tắt (quá chậm) đã hết.
- **`reports/evaluation/configs/*.yaml` — SÁU file, không chỉ E4.** `runner.py:59` đặt
  `os.environ["NLI_MODEL"]` từ YAML nên **YAML thắng `.env`** (đúng luật đã ghi ở mục
  "Ablation E0–E7 rò `.env`"): đổi model trong `.env` KHÔNG tới được thang đo. Đã đổi
  trong `E4_nli`, `E5_crag`, `E6_full_automatic`, `E7_full_hitl`, `source_tags_off`,
  `source_tags_on` — tất cả đều `nli: {enabled: true, ...}`. Thư mục `reports/` không nằm
  trong git (gỡ 2026-08-24) nên thay đổi này KHÔNG có trong commit; ghi ở đây là dấu vết
  duy nhất.

  Đây chính là mặt trái của luật "YAML là nguồn quyết định duy nhất": nó chặn được rò
  `.env` vào số liệu, và cũng chặn luôn mọi cải thiện đi qua `.env`. Sửa cấu hình
  production thì phải hỏi ngay: thang đo có bản sao riêng không?

### Phòng ngừa

**Phép đo sai trông y hệt phát hiện thật.** "Model nhẹ hiệu chỉnh kém, cần hạ ngưỡng" là
một kết luận hoàn toàn hợp lý, có số kèm theo, và sai — chỉ vì dữ liệu thử bị bỏ dấu.
Trước khi kết luận về một model đa ngữ, kiểm dữ liệu thử có đúng ngôn ngữ đích không, kể
cả dấu.

**Một hạn giờ phải theo model, không theo lịch sử.** `NLI_TIMEOUT_SEC=90` từng đúng và
thành vô nghĩa ngay khi model đổi. Mọi hằng số thời gian nên ghi kèm con số nó được suy
ra từ đâu, để lần sau biết nó còn hiệu lực hay không.

## (ĐÃ ĐO + SỬA 2026-09-01) Hạn rerank: nâng 10s lên 15s, và index production KHÔNG sụp như R2_late

Hai mục treo được đóng bằng hai phép đo. Script đo giữ lại trong `BE/scripts/`, chạy lại
được bất cứ lúc nào.

### Hạn rerank 10s — đo trên chunk THẬT, không phải văn bản tổng hợp

Mục cũ "(CẦN ĐỂ Ý) Hạn rerank 10s sát mép" đo bằng chunk tổng hợp 979 ký tự và kết luận
"chưa quyết". Đo lại bằng chunk thật lấy từ `index/chunks.sqlite`
(`scripts/do_han_rerank.py`) — 40 đoạn, TB **314 ký tự**, p95 496, max 498:

```
   k   p50 (s)   ket luan
   5      1.70   OK
  10      3.58   OK
  15      5.71   OK
  20      7.56   SAT MEP   (76% cua han 10s)
  30     11.51   VUOT HAN
```

Tuyến tính **~0.38s mỗi ứng viên**. Với độ dài này, hạn 10s bị chạm ở **~26 ứng viên**.
Đối chiếu đo cũ (979 ký tự, k=20 = 12.95s): chunk dài gấp ~3 thì chậm gấp ~1.7.

**Quyết: nâng `RERANK_TIMEOUT_SEC` 10 → 15, GIỮ `RERANK_CANDIDATE_K=20`.**

Vì sao nâng hạn chứ không giảm pool:
- Timeout ở đây là thời gian **vứt đi hoàn toàn** — hết giờ thì rơi về thứ tự gốc, đã
  tốn trọn 10 giây mà không đổi gì. Hạn đặt quá sát biến một tính năng thành một khoản
  phạt thời gian.
- Giảm `RERANK_CANDIDATE_K` là làm yếu đúng thứ đang muốn giữ: lessons-learned đã có mục
  "Rerank (Two-Stage Retrieval) cần candidate pool RỘNG ở Stage 1 mới có tác dụng".
- 15s cho k=20 ở độ dài hiện tại = 7.56s, còn **50% biên** — đủ cho tài liệu có đoạn dài
  gấp đôi.

Con số để lần sau chỉnh bằng số học chứ không đoán: `thời gian ≈ 0.38s × k` ở ~314 ký
tự/đoạn; nhân ~1.7 khi độ dài đoạn gấp 3.

### Index production KHÔNG dính lỗi sụp không gian của R2_late

Mục "(CHẶN) Late chunking mean-pool trong khi bge-m3 dùng CLS" để mở một câu hỏi: đó là
lỗi của riêng bộ đánh giá, hay index đang chạy cũng vậy? Đo
(`scripts/do_do_sup_khong_gian_vector.py`, chỉ đọc, không gọi model):

```
index production : 188 vector, dim 1024
cosine TB        : 0.6622   p50 0.6650   p95 0.8681
chunk canh nhau  : TB 0.7820

doi chieu: nhung thuong (R0/R1) 0.53-0.68 | late chunking (R2) 0.967-0.995, canh nhau 0.9999
```

**Không gian còn phân biệt được** — nằm đúng vùng của nhúng thường, không phải vùng sụp.

Thêm một nửa nữa của câu trả lời, đọc từ mã: `LateChunkEncoder.embed_query` cũng
mean-pool (`late_chunk.py`, `_mean_pool_texts`), nên trong production **truy vấn và tài
liệu cùng một không gian**. Lỗi "hai không gian" (tài liệu mean-pool vs truy vấn CLS qua
sentence-transformers) là chuyện của đường đánh giá, không phải của app.

**Nên phạm vi thiệt hại thu hẹp lại rõ ràng:** app truy hồi bình thường; thứ hỏng là
index `R2_late` mà thang E0–E7 dùng, và hậu quả không phải "chạy đánh giá bị lỗi" mà là
**kết luận rút ra từ nó sai** — bảng cũ (BM25 0.8371 vs FAISS 0.2286) dễ viết thành "BM25
thắng dense retrieval", trong khi sự thật là dense đang đo nhiễu trên một index sụp.

Ghi chú nhỏ: `cosine max = 1.0000` nghĩa là có vector trùng khít — nhiều khả năng một tài
liệu upload hai lần hoặc đoạn lặp. Không hại truy hồi, nhưng đáng để ý nếu số chunk phình.

### Phòng ngừa

**"Sát mép" không phải một kết luận, nó là một lời hẹn đo lại.** Mục cũ dừng ở "chưa
quyết" suốt một tuần vì thiếu đúng một bảng số. Khi ghi một mục CẦN ĐỂ Ý, ghi luôn phép
đo cần chạy để đóng nó.

**Đo trên dữ liệu thật, không trên văn bản tổng hợp.** Số cũ (979 ký tự) mô tả một kho
không tồn tại và làm vấn đề trông nặng gấp đôi thực tế.

**Một hạn giờ bọc công việc "được thì tốt" phải rộng hơn trường hợp bình thường khá
nhiều** — vì khi nó cắn, ta trả trọn thời gian chờ và không nhận lại gì.

## (ĐÃ SỬA 2026-09-01) Mười ba chỗ giao diện còn lại: hứa việc không làm, và coi hỏng là rỗng

Audit vòng 8, FE#8–#20 — nốt bảng frontend. Hai họ lỗi, và họ thứ nhất nặng hơn nhiều.

### Họ 1 — nói đã làm một việc chưa hề xảy ra

**FE#12 — nút "Huỷ" trong chat không gọi route nào.** BE **không có** `/query-cancel`:
`_CANCELLABLE_JOB_TYPES = {"mindmap", "summary", "quiz_generation", "study_map_generation"}`,
không có `"query"`, và `query_graph` không gọi `is_cancel_requested` ở bất kỳ đâu. Bấm
Huỷ chỉ `abort()` request phía trình duyệt — job vẫn chạy tới xong và vẫn **giữ slot LLM
duy nhất**. UI thì ghi "Đã huỷ truy vấn.", nên người dùng hỏi câu mới và không hiểu vì
sao phải chờ lâu.

Kèm theo: `setMessages(prev => [...prev.slice(0, -1), …])` xoá luôn **câu hỏi của người
dùng**. Lúc gửi chỉ tin nhắn `role: "user"` được đẩy vào (không có bong bóng AI giữ chỗ),
nên phần tử cuối chính là câu vừa gõ.

**Fix:** bỏ `slice(0, -1)`; đổi lời thành "Đã ngừng chờ câu trả lời. Máy chủ vẫn chạy nốt
truy vấn này, nên câu hỏi tiếp theo có thể phải đợi thêm một lúc."

**Trần còn lại, nói thẳng:** đây là huỷ phía máy người dùng. Huỷ thật cần
`query_graph` gọi `is_cancel_requested` giữa các node rồi mới thêm `"query"` vào
`_CANCELLABLE_JOB_TYPES` — comment ở `main.py:3509` đã ghi đúng thứ tự đó và cố ý chưa
làm.

**FE#13 — "Đã xóa" cho việc BE trả 500.** `try { await clearConversationContext(...) }
catch {}` rồi vẫn `showNotice("Đã xóa ngữ cảnh...")`; `handleDeleteHistory` còn tệ hơn —
`catch {}` rồi vẫn `setMessages([])`, nên người dùng tin đã xoá trong khi máy chủ giữ
nguyên lịch sử và vẫn đưa nó vào ngữ cảnh lượt sau. **Fix:** hỏng thì nói hỏng, và
**không** dọn khung chat.

**FE#9 — nộp bài luyện THÀNH CÔNG mà hiện dòng đỏ "Nộp bài luyện tập thất bại".** Một
`catch` bọc cả `submitPractice` lẫn `getPracticeComparison`; cái thứ hai chỉ là phần so
sánh trước/sau. **Fix:** bọc riêng, hỏng thì `setComparison(null)`.

**FE#10 — upload xong, `load()` hỏng → "Tải tài liệu lên thất bại" và mất cả danh sách**,
trong khi file ĐÃ lên. **Fix:** tách hai `try`; lỗi tải lại có lời riêng ("Đã tải lên
xong, nhưng chưa làm mới được danh sách").

### Họ 2 — coi "hỏng" là "rỗng"

**FE#11** — `Promise.all` bốn endpoint: một cú 500 của `/api/progress/overview` xoá sạch
danh sách tài liệu. **Fix:** `Promise.allSettled`, chỉ lỗi ở `listDocuments()` mới là lỗi
thật; ba khối tiến độ hỏng thì để trống chúng.

**FE#14** — `/mindmaps` hoặc `/summaries` hỏng → `setMindMaps([])` → "Chưa có sơ đồ nào
được lưu" cho người có đủ sơ đồ, và họ dựng lại từ đầu. Tab Tóm tắt còn không có cờ tải
nào nên hiện "Chưa có tóm tắt nào" **trong lúc đang tải lần đầu**. **Fix:** giữ nguyên
danh sách đang có, hiện lỗi kèm "Thử lại"; thêm `dangTaiSummary`.

**FE#15** — `StudyMapView` chỉ nhận map `status === "completed"`. Có job đang dựng ở tab
khác (hoặc vừa F5) thì trang hiện "Chưa dựng sơ đồ cho tài liệu này" **kèm nút mời dựng**
— bấm là job thứ hai tranh slot LLM với job thứ nhất. **Fix:** thấy map `processing`/
`pending` thì hiện trạng thái "Sơ đồ đang được dựng" + nút "Kiểm tra lại".

**FE#16** — poll `/sources/<id>/status` gặp lỗi mạng hoặc `!res.ok` là `stopPolling` im
lặng: thẻ đứng mãi ở "Đang phân tích tài liệu…" với thanh tiến trình đóng băng, không
lỗi, không bao giờ hết. **Fix:** cờ `matDauVet` — nói ra là đã hết theo dõi, kèm nút
"Theo dõi lại".

**FE#17** — tài liệu đang xử lý **biến mất** sau khi thu/mở lại cột trái hoặc F5:
`SidebarLeft` unmount thật, và `/list-indexed` chỉ trả về tài liệu đã index XONG. Người
dùng đọc là upload hỏng. **Fix:** `utils/nguonDangXuLy.js` — nhớ `source_id` + tên file
vào localStorage ngay khi nhận được id, dựng lại thẻ và theo dõi tiếp khi mount, quên khi
`ready`/`error`, tự hết hạn sau 6 giờ. Cùng bài học với `makeActiveJobStore`.

**FE#8** — job chấm tự luận chết ở BE thì attempt kẹt `submitted` **vĩnh viễn**: poll
thành công mọi lần, chỉ là trạng thái không bao giờ đổi, nên trần đếm-lỗi thêm ở commit
trước không cứu được. **Fix:** trần thời gian 5 phút (khớp `STALL_MS` của `jobPoller`),
hết thì nói thật là có thể việc chấm đã dừng, kèm nút "Chờ thêm".

### Nhóm nhẹ

**FE#18** — `if (body?.job_id) job.start(...)` không có nhánh `else` ở `QuizSetup` và
`ReviewGuide`: response thiếu `job_id` thì nút hết quay và tuyệt đối không có gì xảy ra —
người dùng bấm lại, lần này ra job thật, thành hai job cho một ý định.
**FE#19** — "Không xóa được tài liệu, kiểm tra console!" đổi thành lời cho người học.
**FE#20** — nút "Tải tài liệu" trong `EmptyState` thiếu `disabled={uploading}` (nút ở
thanh công cụ thì có), nên chọn file lần hai lúc đang tải tạo upload chồng.

### Regression

`FE/src/utils/nguonDangXuLy.test.js` — 6 test: nhớ được nguồn, quên khi xong, không tạo
bản trùng, quá hạn thì bỏ, localStorage rác trả rỗng không ném, thiếu `sourceId` thì bỏ
qua. Kho không có testing-library nên phần nối dây component dựa vào build + đọc lại
diff; phần logic tách được thì đã tách và test.

FE 230 passed (mốc 224), build OK, lint 70 (mốc 72 — giảm 2, không thêm).

### Phòng ngừa

**`Promise.all` biến mọi endpoint phụ thành endpoint bắt buộc.** Trang có một thứ chính
và vài thứ phụ thì dùng `allSettled` và chỉ ném khi thứ CHÍNH hỏng — nếu không, một cú
500 ở khối thống kê xoá sạch nội dung người dùng đến để xem.

**Một `catch` bọc hai lời gọi là một `catch` nói dối về một trong hai.** Lời báo lỗi mang
tên hành động đầu tiên, còn thứ hỏng là hành động thứ hai — và hành động đầu tiên thì đã
thành công.

## (ĐÃ SỬA 2026-09-01) Một khẩu súng đã lên đạn, một tài liệu nói ngược, một cờ xoá không ai đọc

Audit vòng 8, BE#10 và #11. Không cái nào đang hại ai **hôm nay** — đó chính là lý do
chúng sống lâu.

### BE#10 — nhánh điểm số chết trong `grading.py`, và nó đảo ngược

`_numeric_score` + hai field `vector_score` / `bm25_score`: **0 caller production**
(`query_graph` truyền `list[str]` ở mọi đường), **0 test nào đặt hai field đó**.

Nhưng nếu ai nối lại:

```python
# hybrid.py:428 — dist từ faiss.IndexFlatL2  => KHOẢNG CÁCH, nhỏ = tốt
RetrievedChunk(..., vector_score=dist)

# grading.py — gộp bằng max(), lớn = tốt, và kẹp trần 1.0
return max([lexical, *extras], default=lexical)
```

Hai quy ước ngược nhau gặp nhau: `min(1.0, max(0.0, score))` biến **mọi** khoảng cách
lớn hơn 1 thành `1.0` — "liên quan tuyệt đối". Chunk càng XA càng được chấm cao, và mọi
chunk đều ra `correct`.

Comment cũ còn ghi *"Sau Rerank, chunk là str"* — sai: nó là `str` từ **trước** rerank,
`RetrieveFAISS` đã đổi rồi. Và `tests/test_grading.py` truyền `RetrievedChunk` — một hình
dạng runtime không bao giờ sinh ra.

**Fix:** gỡ hẳn `_numeric_score` và nhánh gộp. `_relevance` giờ thuần lexical, đúng như
production vẫn chạy. `rerank_scores` giữ nguyên — nó là tín hiệu số DUY NHẤT được tin ở
đây, và nó vốn đã là điểm liên quan 0-1 chứ không phải khoảng cách. Comment ghi rõ: muốn
dùng điểm vector thật thì phải **đổi dấu và chuẩn hoá**, không phải kẹp trần.

### BE#11a — docstring `auth/service.py` nói ngược với mã

*"The @require_auth decorator is provided for FUTURE protected endpoints; it is NOT
applied to any existing app route in this phase (the app APIs stay open)."*

Route giờ gác bằng `_require_app_user()`. Câu đó đúng ở giai đoạn viết ra, sai từ khi
route bắt đầu gọi hàm kia — và nó nằm ngay đầu file mà người sửa auth đọc đầu tiên.

`require_auth` vẫn 0 caller. **Giữ lại nhưng nói thật vì sao:** `_require_app_user` trả
`(uid, error_response)` nên route quyết định được mã lỗi (404 thay vì 403 ở những chỗ
không được lộ sự tồn tại của tài nguyên) — decorator không làm được điều đó. Đây là lý do
kỹ thuật, không phải bỏ quên.

### BE#11b — "Xóa lịch sử chat" chỉ là một cái nhãn

`conversations.deleted_at`: ghi ở **đúng một chỗ** (`store.soft_delete`), đọc ở **không
chỗ nào**.

- `get_conversation` trả nó ra nhưng không route nào lọc.
- `ensure_conversation` upsert không xoá nó → hội thoại "đã xoá" vẫn nhận tin nhắn mới.
- `context_builder` chỉ đọc `context_reset_at` → lượt trước khi xoá **vẫn chảy vào
  prompt**.

Nên bấm "Xóa lịch sử chat" xong, gõ tiếp trong cùng phiên, và model vẫn nhớ những gì vừa
được yêu cầu xoá.

**Fix hai đầu:**

1. `context_builder.moc_chan(conv)` — lấy mốc **muộn hơn** giữa `context_reset_at` và
   `deleted_at`. Đường đọc không được phụ thuộc vào việc hàng đã được "sống lại" hay
   chưa: hàng bị xoá rồi để yên vẫn phải sạch.
2. `ensure_conversation` — hàng đã xoá mà có tin nhắn mới nghĩa là người dùng đang gõ
   tiếp: cho hàng sống lại (`deleted_at=NULL`) nhưng **đẩy `context_reset_at` tới thời
   điểm xoá**. Không làm bước này thì hàng mang cờ xoá vĩnh viễn trong khi vẫn tích tin
   nhắn — và bất kỳ đường đọc nào sau này bắt đầu tôn trọng `deleted_at` sẽ âm thầm giấu
   mất dữ liệu đang sống.

### Regression

`BE/tests/test_audit_vong8_hai_muc_cuoi.py` — 7 test: `_numeric_score` phải biến mất,
chunk lạc đề mang `vector_score=42.0` không được thành `correct`, chunk liên quan vẫn
`correct`, docstring auth hết khẳng định app API đang mở, hội thoại xoá rồi nhận tin mới
phải sống lại kèm mốc chặn, `moc_chan` lấy đúng cái muộn hơn, và đường đọc chặn đúng từ
mốc xoá — bắt tham số `after_ts` chứ **không** đọc mã nguồn bằng `inspect.getsource`.

### Phòng ngừa

**Mã chết mang hai quy ước ngược nhau là bẫy, không phải rác.** "Không ai gọi" chỉ đúng
tới lần refactor sau. Khi thấy một nhánh 0 caller mà nó trộn hai thang đo (khoảng cách vs
tương đồng, giây vs mili-giây, 0-1 vs 0-100), gỡ hẳn — hoặc sửa cho đúng — chứ đừng để
lại cho người sau tin rằng nó đã được kiểm.

**Một cột chỉ có đường ghi mà không có đường đọc thì tính năng đó chưa tồn tại.** Grep cả
hai chiều cho mọi cột trạng thái: `deleted_at`, `archived_at`, `disabled_at`. Ghi được mà
không ai đọc nghĩa là nút bấm trên giao diện đang nói dối.

## (ĐÃ SỬA 2026-09-01) Bốn chỗ hệ thống mất dấu: memory tree, sổ cái job, quiz đã xoá, câu chưa chấm

Audit vòng 8, BE#5–#8.

### BE#5 — memory tree im lặng tụt về chunk search khi kho lớn

`query_with_memory_tree` dựng `filtered_indices` (hai lần, có cả nhánh nới lỏng
`preferred_node_type`) rồi **không ai đọc nó**. Khối comment ghi "Build mask" nhưng không
có mask nào được dùng:

```python
search_k = min(strategy_top_k * 3, len(nodes_meta))   # hằng số, không liên quan tới mask
D, I = idx.search(qv, search_k)                        # quét TOÀN BỘ index
... lọc chủ sở hữu SAU khi search ...
if not scored:
    return None                                        # im lặng
```

FAISS xếp hạng trên toàn index. Ai sở hữu 2 trong 200 node thì 15 node gần nhất hầu như
đều của người khác, `scored` rỗng, hàm trả `None`, và chat tụt về chunk search — **không
log, không lỗi**, chỉ là câu trả lời tệ hơn. Overview / "nội dung chính" mất đường đi mà
không ai biết.

**Fix:** `_be_rong_tim(strategy_top_k, tong_node, so_node_duoc_phep)` — bề rộng tính
theo tỉ lệ: cần `k` node của một người sở hữu `p/n` thì trung bình phải quét `k*n/p`.
Giữ `k*3` làm sàn, chặn trên bằng `n`. Quét rộng ở đây rẻ: index memory-tree là node tóm
tắt, không phải chunk.

Và `return None` giờ in ra `memory_tree_khong_co_node_phu_hop duoc_phep=… tong=… quet=…`
— im lặng chính là thứ giúp lỗi này sống lâu.

### BE#6 — sổ cái `jobs` (Postgres) tồn đọng hàng `running` vĩnh viễn

`close_job` chỉ được gọi từ đường job chạy xong bình thường. **Bốn** đường kết thúc còn
lại — `sweep_stuck_jobs`, `mark_interrupted_jobs`, `reconcile_interrupted`,
`request_cancel` — chỉ ghi SQLite. Hàng Postgres tương ứng nằm `running` mãi.

Đó là sổ **kiểm toán**, và `ai_validation_logs.job_id` là FK trỏ vào nó: sổ nói job vẫn
đang chạy trong khi nó chết từ tuần trước.

Thêm: `close_job` map `"interrupted"` không có trong `STATUS_MAP` nên rơi về default
`"failed"` — kết quả đúng, nhưng không ai phân biệt được cố ý với bỏ sót.

**Fix:** `ledger.dong_theo_jobs_store()` gọi từ `_run_jobs_maintenance`, **trước**
`cleanup_terminal_jobs` (prune xoá hàng SQLite là mất thứ để đối chiếu). Hai luật, cả hai
nói được thành lời:

1. SQLite còn hàng và đã ở trạng thái cuối → đóng theo đúng trạng thái đó, mang theo
   `error_text`.
2. SQLite không còn hàng (đã prune) và hàng sổ cái cũ hơn 24h → đóng `failed`, kèm lý do
   ghi rõ **là suy ra chứ không quan sát được**.

Hàng `running` mới mà SQLite chưa có thì để yên: job vừa mở, chưa kịp ghi.

`STATUS_MAP["interrupted"] = "failed"` giờ tường minh (CHECK của Postgres không có
`interrupted`, không thêm status mới).

### BE#7 — xem lại kế hoạch ôn của một bài làm cũ → 500 traceback trống

`review/service._persist`:

```python
attempt = s.get(QuizAttempt, str(attempt_id))
if attempt is None:
    return None                                    # CÓ guard
document_id = s.get(Quiz, str(quiz_id)).document_id   # KHÔNG có guard
```

Quiz bị xoá (hoặc tài liệu gỡ) → `AttributeError` → 500. Hai dòng cạnh nhau, một dòng
cẩn thận một dòng không.

**Fix:** guard `None` → `return None`, đúng như dòng trên nó.

### BE#8 — 66.7% mà không biết vì sao, và sau 7 ngày thì không còn cách nào biết

`ungraded_count` (số câu tự luận LLM chấm hỏng) **chỉ nằm trong `result` của job**. Job
bị prune sau `JOB_RETENTION_DAYS=7`. Còn `QuizAttempt.percentage` thì ở lại DB vĩnh viễn
và chảy vào `progress.overview.avg_percentage`.

`/api/quizzes/results/<id>` không trả khoá này, nên mở lại trang kết quả là mất dấu ngay
cả trong 7 ngày đó.

**Phần TOÁN là cố ý, không đổi:** câu chưa chấm vẫn nằm ở mẫu số —
`tests/test_quiz_attempt.py:311` khoá `max_score == 3.0` với chú thích "câu chưa chấm
vẫn tính vào mẫu số". Docstring `grade_attempt` ghi "không bị cho 0 oan": verdict đúng là
`None`, nhưng **phần trăm thì y hệt như cho 0**. Chỗ hỏng là BÁO CÁO, không phải công
thức.

**Fix:** `save_grades(..., ungraded_count=)` ghi vào `QuizAttempt.metadata_json` — sống
lâu bằng attempt; `_attempt_public` lộ `ungraded_count` ra mọi endpoint đọc attempt.
Không có metadata = 0, không phải "không biết": trước khi có trường này thì mọi bài hoặc
chấm đủ hoặc đã mất dấu.

### Regression

`BE/tests/test_audit_vong8_bon_muc.py` — 10 test: bốn ca cho `_be_rong_tim` (nở ra khi sở
hữu ít, giữ nguyên khi sở hữu hết, không chia cho 0, không vượt kích thước index),
`STATUS_MAP` biết `interrupted`, `dong_theo_jobs_store` tồn tại, `_persist` không lấy
thuộc tính thẳng trên `s.get(Quiz, ...)`, `save_grades` nhận `ungraded_count`, và
`_attempt_public` lộ đúng số — kể cả ca không có metadata thì trả 0 chứ không bịa.

### Phòng ngừa

**Biến dựng ra rồi không ai đọc là một lỗi, không phải rác vô hại.** `filtered_indices`
tính đúng phần được phép — đúng thứ cần để chặn lỗi — rồi bị bỏ. Comment "Build mask"
làm người đọc sau tin rằng mask đã được dùng.

**Hai nơi giữ trạng thái thì phải có một đường đồng bộ, không chỉ một đường ghi.**
`jobs_store` và `jobs` cố ý tách nhau (đã ghi trong docstring của `ledger`), nhưng chỉ có
đường ghi lúc mở và lúc đóng-đẹp. Mọi đường kết thúc khác đều bỏ quên nơi thứ hai.

**Số đo ở lại vĩnh viễn thì lý do của nó cũng phải ở lại vĩnh viễn.** `percentage` sống
mãi trong DB còn `ungraded_count` chết sau 7 ngày — hai thứ giải thích cho nhau mà tuổi
thọ khác nhau thì phần giải thích luôn là phần mất trước.

## (ĐÃ SỬA 2026-09-01) CRAG không bao giờ kích nhánh sửa sai — thước đo tự cộng điểm cho chính nó

Audit vòng 8, BE#4. `INCLUDE_CHUNK_SOURCE_TAGS=1` (`.env:183`, đang bật) khiến
`RetrieveFAISS` dán nhãn lên đầu mọi chunk:

```python
chunks_with_citation.append(f"[Nguồn: {item.video_stem}, đoạn {item.chunk_id}]\n{txt}")
```

`state["retrieved_chunks"]` sau đó đi thẳng vào `grade_documents`, và `_relevance`
tokenize **cả cái nhãn**. "nguồn" và "đoạn" là hai từ cực phổ biến trong câu hỏi tiếng
Việt, nên chunk lạc đề ăn điểm chỉ nhờ thứ **chính hệ thống vừa dán vào nó**.

Đo lại trên máy (`CRAG_RELEVANCE_THRESHOLD=0.25`):

```
câu hỏi : "đoạn nào trong nguồn nói về tích phân"
chunk   : "Công ty ABC thành lập năm 1998 tại Hải Phòng, chuyên vận tải biển."

trước sửa   không nhãn -> 0.0   wrong        có nhãn -> 0.25  correct   (vừa đúng ngưỡng)
sau sửa     không nhãn -> 0.0   wrong        có nhãn -> 0.0   wrong
```

Grade luôn ra `correct` thì `RewriteQuery` và `CRAGFallback` **không bao giờ chạy**. Cả
tầng CRAG thành trang trí, và câu hỏi lạc đề vẫn được trả lời từ ngữ liệu không liên quan
— đúng thứ CRAG sinh ra để chặn.

### Vì sao lỗi này sống lâu

Mọi test trong `tests/test_grading.py` đều truyền **chuỗi trần**. Không test nào đưa vào
một chuỗi có tiền tố `[Nguồn: ...]`, tức là không test nào chạy đúng hình dạng dữ liệu mà
production luôn tạo ra. Lưới có, nhưng giăng ở chỗ không ai đi qua.

### Fix

`app/domains/retrieval/citation.py` — **hai chiều nằm cùng một chỗ**: `nhan_nguon()` dựng
nhãn (query_graph gọi), `bo_nhan_nguon()` gỡ nhãn ở ĐẦU chuỗi (grading gọi trong
`_chunk_text`). Trước đây chiều dán nằm trong `query_graph` còn chiều gỡ **không tồn
tại**; giờ đổi hình dạng nhãn là đổi một chỗ.

Chỉ gỡ nhãn ở **đầu** chunk: nhãn nằm giữa thân bài là nội dung của tài liệu, không phải
thứ ta dán vào.

Không đụng `rerank_scores` — đó là tín hiệu độc lập từ cross-encoder, và nó vẫn phải
thắng được lexical như thiết kế.

**KHÔNG tắt `INCLUDE_CHUNK_SOURCE_TAGS`.** Nhãn có ích thật ở prompt: nó là thứ cho model
trích nguồn. Vấn đề chưa bao giờ là cái nhãn, mà là chấm điểm trên chuỗi đã bị mình thêm
chữ vào.

### Regression

`BE/tests/test_grading_nhan_nguon.py` — 6 test: round-trip dán/gỡ, không có nhãn thì giữ
nguyên, chỉ gỡ ở đầu, **chunk lạc đề có nhãn phải ra `wrong`** (ca chính), chunk thật sự
liên quan vẫn `correct`, và gỡ nhãn không làm mất điểm rerank.

### Phòng ngừa

**Đừng chấm điểm trên chuỗi mình vừa thêm chữ vào.** Bất cứ khi nào một tầng làm đẹp dữ
liệu cho tầng sau (nhãn trích dẫn, tiền tố vai trò, header markdown), hỏi ngay: còn ai
khác đọc chuỗi này để **đo** cái gì không? Nếu có, tầng đo phải nhận bản gốc.

**Và test phải mang đúng hình dạng dữ liệu của production.** Chuỗi trần trong test còn
production luôn có tiền tố thì bộ test đang đo một hệ thống khác.

## (ĐÃ SỬA 2026-09-01) Bảy chỗ giao diện nói sai về việc vừa xảy ra

Audit vòng 8, phần frontend. Bảy lỗi, một họ: **giao diện báo cáo một thứ khác với thứ
thật sự xảy ra.** Nặng nhất là hai cái ăn mất câu trả lời của người học.

### FE#5 + FE#6 — lưu nháp hỏng thì mất lô đáp án, rồi nộp bài thiếu mà vẫn báo xong

`QuizTaking` dọn sổ nháp NGAY TRƯỚC `await`:

```js
const batch = pendingRef.current;
pendingRef.current = {};          // <- mất trắng nếu request hỏng
await saveAnswers(attemptId, batch);
```

Gửi hỏng thì lô ấy biến mất, nhưng ô vẫn tô mực và bộ đếm vẫn ghi "N/M đã trả lời" —
giao diện nói đã lưu, server không có.

Và lỗi thứ hai chồng lên: sau một lần lưu hỏng, bấm "Nộp bài" thì `pendingRef` đã rỗng
nên submit đi **không kèm mấy câu đó**. `submitAttempt` trả 200, điều hướng sang trang
kết quả như một lần nộp bình thường. Câu bị chấm như chưa trả lời, không ai nói gì.

**Fix:** `FE/src/utils/soNhap.js` — sổ nháp có `traLai(lo)`. Gửi hỏng thì lô quay lại sổ;
lần gửi sau, hoặc lúc nộp, mang nó đi lại. `traLai` KHÔNG đè giá trị người dùng vừa đổi
trong lúc request còn bay (`{...lo, ...cho}`) — trả một đáp án cũ đè lên đáp án mới hơn
cũng là mất dữ liệu, chỉ khó thấy hơn.

Lúc nộp, `saveAnswers` hỏng thì **ném tiếp**, không nộp: nộp khi chưa chắc server có đủ
đáp án là biến một lỗi mạng thành một điểm số sai.

Bộ đếm hết nói dối: có câu chưa lên được server thì nó ghi "N câu chưa lưu được" thay vì
"N/M đã trả lời".

### FE#7 — một cú poll trượt mạng xoá sạch trang kết quả đã chấm

`error={error}` không kẹp `!result` (khác `QuizTaking` và `StudyMapView` ngay cạnh), nên
lần hỏi NỀN hỏng là cả trang thành thẻ đỏ "Không tải được kết quả" — kể cả khi kết quả đã
chấm xong và đang hiển thị.

Tệ hơn: effect poll phụ thuộc `[result, load]`. Lần hỏi nền hỏng thì `result` **không
đổi**, effect không chạy lại, vòng hỏi chết lặng — trang đứng mãi ở "đang chấm".

**Fix:** lỗi nền tách khỏi lỗi tải đầu (`loiNen`, hiện thành một dòng kèm nút "Thử lại",
không thay cả trang); `error && !result` cho khung; thêm `nhip` vào dependency để vòng
hỏi tự lên lịch lại; và trần `MAX_CONSECUTIVE_FETCH_FAILURES` mượn từ `jobPoller` để năm
lần trượt liên tiếp thì thôi, đừng nện mãi.

### FE#4 — "Luyện thêm 5 câu" bấm ba lần ra ba job

Đúng lỗi Q1 vòng 7, chưa vá ở trang này: `disabled={job.running}` mà `job.jobId` chỉ có
SAU khi 202 về. Giữa lúc bấm và lúc đó nút vẫn bấm được, và không có spinner (`busy`
cũng phụ thuộc `job.running`). Mỗi lần bấm là một job tranh 1 slot LLM.

**Fix:** nút đọc chính cờ `practiceFor` — đặt TRƯỚC `await` — chứ không đọc `job.running`.
Kèm `useEffect` mở khoá khi `job.error`: job hỏng thì `onDone` không chạy, không có điều
hướng nào, và trang sẽ khoá vĩnh viễn cho tới khi F5.

### FE#1 — thu cột trái lại thì vẫn nã server mỗi 1.5 giây, mãi mãi

`SidebarLeft` unmount thật khi thu cột (MainLayout thay nó bằng `PanelSpine`), nhưng
`pollingIntervalsRef` **không có `useEffect` cleanup nào**. Mỗi tài liệu từng ở trạng
thái đang xử lý để lại một interval sống sót.

**Fix:** effect cleanup dọn hết interval khi unmount.

### FE#2 — `/list-indexed` hỏng thì báo "Chưa có tài liệu nào" và XOÁ LUÔN lựa chọn

`.then((res) => res.json())` không kiểm `res.ok`. Body của 500/401 cũng là JSON hợp lệ,
nên `data.sources || []` biến lỗi thành danh sách rỗng: người có đủ tài liệu đọc được
"Chưa có tài liệu nào. Nhấn Thêm tài liệu để bắt đầu", và dòng
`setSelectedSources(prev => prev.filter(...))` ngay dưới xoá sạch lựa chọn nguồn của họ.

**Mất mạng không phải là "chưa có gì".** Cùng họ với `None` khác `0` ở backend.

**Fix:** `if (!res.ok) throw await _appError(res)`; trạng thái lỗi riêng kèm nút "Thử
lại"; không đụng vào `selectedSources` khi chưa biết server nói gì.

### FE#3 — upload hỏng vì 413/415/500 thì không có gì hiện ra

`alert` chỉ chạy cho 401/403/404; còn lại `continue` trong im lặng. Nút hết quay, danh
sách không thêm gì, không một chữ nào. Người dùng đọc là "bấm không ăn".

**Fix:** mọi mã lỗi đều để lại một dòng `<tên file>: <lời giải thích>` trong cột.

### Regression

`FE/src/utils/soNhap.test.js` — 6 test cho sổ nháp, gồm ca `traLai` không đè giá trị mới
hơn và ca `traLai(undefined)`. Sáu lỗi còn lại là nối dây trong component; kho chưa có
testing-library và **không thêm phụ thuộc chỉ để test chúng** — phần logic có thể tách
thì đã tách ra thành hàm thuần và test rồi.

### Phòng ngừa

Khi bắt lỗi, hỏi ba câu trước khi viết `catch`: (1) người dùng có mất dữ liệu gì không —
nếu có thì phải trả lại, không được nuốt; (2) màn hình sau `catch` có đang khẳng định
điều gì không còn đúng không; (3) vòng lặp hay timer nào vừa chết theo và ai bật lại.

Và: `res.json()` sau `fetch` **không** đảm bảo request thành công. `fetch` chỉ ném khi
mạng hỏng; 4xx/5xx là "thành công" với body lỗi. Thiếu `res.ok` là cách phổ biến nhất để
một lỗi máy chủ hoá trang thành "không có dữ liệu".

## (ĐÃ SỬA 2026-09-01) Ba cách job quiz kẹt: khoá vĩnh viễn, tự bị quét, huỷ không ăn

Audit vòng 8, phần vòng đời job. Ba lỗi khác nhau, cùng một hậu quả với người dùng: bấm
"Tạo quiz" rồi ngồi nhìn một thứ không bao giờ xong.

### BE#2 — giữ chỗ dedupe biến thành cửa khoá vĩnh viễn

Dedupe vòng 7 giữ chỗ TRƯỚC khi xếp hàng, kèm comment tự trấn an:

```python
# Giữ chỗ TRƯỚC khi enqueue: enqueue hỏng thì job nằm 'pending' và `sweep_stuck_jobs`
# dọn, chấp nhận được.
```

Comment nói dối. `sweep_stuck_jobs` docstring ghi rõ *"Pending KHÔNG bị đụng (job queue
có thể chờ lâu hợp lệ)"*, và `tests/test_jobs_retention.py::test_fresh_running_and_old_
pending_untouched` **khoá đúng hành vi ngược đó**. Pending mồ côi chỉ được dọn bởi
`reconcile_interrupted` lúc khởi động.

Nên: job xếp hàng xong mà không worker nào nhận (RQ bật nhưng không có worker, hoặc
`Thread.start()` ném) sẽ nằm `pending` mãi. Dedupe thấy `pending` ∈ `_QUIZ_JOB_SONG` nên
trả lại **đúng job chết đó** cho mọi lần bấm sau. Người dùng vĩnh viễn không tạo lại được
quiz cùng cấu hình; giao diện poll một job không bao giờ nhúc nhích.

**Fix hai lớp:**
- `_job_pending_da_chet()` — `pending` quá `QUIZ_PENDING_TOI_DA_GIAY` (mặc định 120s) thì
  dedupe không coi là đang sống nữa. Chỉ `pending`: `running` cũ là việc của
  `sweep_stuck_jobs`, đừng giẫm chân.
- `_quiz_job_nha_cho()` — route trả chỗ lại nếu `create_job`/`enqueue_job` ném. Chỉ xoá
  khi chỗ VẪN là của mình; request khác có thể đã chiếm, xoá nhầm thì mở lại đúng cửa sổ
  đua mà dedupe sinh ra để đóng.

Comment nói dối đã thay bằng comment nói đúng thứ đang xảy ra.

### BE#3 — job đang chạy tử tế tự bị quét thành `interrupted`

Giữa `progress=30` và `progress=70` là trọn lời gọi model. Không nhịp tim nào.

```
QUIZ_LLM_TIMEOUT_SEC=900  ×  MAX_ATTEMPTS=2   = tối đa 1800s im lặng
JOB_STUCK_AFTER_SECONDS=900                     ngưỡng quét
```

`_run_jobs_maintenance()` nằm ngay trong route poll của chính giao diện, nên chính cú
poll của người dùng quét job của họ. Sau khi bị quét, `interrupted` ∉ `_QUIZ_JOB_SONG`
nên dedupe mở cửa cho job mới — người dùng bấm lại và job thứ hai tranh 1 slot LLM. Đúng
lỗi vòng 7 quay lại bằng cửa khác.

Study map có `progress_cb` từng item; quiz là ngoại lệ duy nhất.

**Fix:** `_nhip_tim_job(job_id, moi_giay=120)` — context manager, thread daemon chạm
`updated_at` đều đặn, `finally` tắt. Bọc cả lượt chính lẫn lượt bù.

Thêm `jobs_store.touch_job()` thay vì `update_job(job_id, progress=...)`: báo một con số
tiến trình không có thật để giữ job sống là nói dối đúng chỗ người dùng đang nhìn.
(`update_job` không kwargs thì return sớm, nên không dùng thẳng được.)

Nhịp tim là việc phụ — hỏng thì im, không ném vào luồng job. Có test cho đúng ca đó.

### BE#9 — bấm Huỷ, "Đang huỷ…" đứng 15-30 phút

`quiz_generation` có trong `_CANCELLABLE_JOB_TYPES` và executor **có** gọi
`is_cancel_requested` — nhưng chỉ ở hai điểm kẹp NGOÀI `generate_questions`. Cùng họ với
known-issues 2026-07-17 ("Đang huỷ… 36% mãi"), đã sửa cho summary, chưa sửa cho quiz.

**Fix:** `generate_questions(..., da_huy=...)` kiểm cờ trước MỖI lượt.

**Trần còn lại, nói thẳng:** huỷ vẫn không cắt được một lời gọi đang chạy — đó là request
HTTP tới Ollama, Python không cắt ngang được. Worst case đi từ **hai** lượt xuống **một**
(`QUIZ_LLM_TIMEOUT_SEC`). Muốn xuống nữa thì phải huỷ ở tầng HTTP client, không phải ở đây.

**Và một lỗi kèm theo, phát hiện lúc nối dây:** job đọc `err` TRƯỚC khi đọc cờ huỷ.
`generate_questions` trả `err="Đã huỷ trước khi gọi model."`, rơi vào nhánh `err` →
`raise ValueError` → job `error` → màn hình hiện **"Tạo quiz thất bại"** cho một việc
chính người dùng bấm dừng. Đã đảo thứ tự: đọc cờ huỷ trước.

### Regression

- `BE/tests/test_quiz_job_ket.py` — 10 test: pending còn mới vẫn dedupe (không phá vòng
  7), pending quá cũ nhường chỗ, running cũ KHÔNG bị đụng, nhả chỗ đúng và không giẫm
  vào chỗ người khác đã chiếm, nhịp tim chạm `updated_at`, dừng hẳn khi ra khỏi khối,
  không làm hỏng job khi `touch_job` ném, và huỷ chặn được lượt gọi model tiếp theo.
- `test_quiz_generation.py::test_huy_giua_luc_goi_model_ra_cancelled_chu_khong_phai_that_bai`
  — khoá thứ tự đọc cờ huỷ trước `err`.

### Phòng ngừa

**Comment hứa một cơ chế thì phải grep xem cơ chế đó có thật không.** Comment vòng 7 hứa
`sweep_stuck_jobs` dọn pending; docstring của chính hàm đó nói ngược, và có hẳn một test
khoá hành vi ngược. Ba nguồn trong cùng một kho, hai nguồn nói thật, một nguồn nói dối —
và nguồn nói dối là nguồn người sửa sau đọc.

**Bước dài không có tiến trình để báo vẫn phải báo là mình còn sống.** Bất cứ chỗ nào có
thể chạy lâu hơn `JOB_STUCK_AFTER_SECONDS` mà không gọi `update_job` đều là ứng viên bị
quét. Đếm: thời lượng tối đa của bước × số lần thử.


## (ĐÃ SỬA 2026-09-01) Biết `session_id` của người khác là đọc được lịch sử chat của họ

Audit vòng 8, phần backend. Bảng `sessions` (`BE/sessions.sqlite`) chỉ có ba cột:

```sql
CREATE TABLE sessions (session_id TEXT PRIMARY KEY, updated_at REAL, history_json TEXT)
```

Không có `user_id`. Chữ ký hàm cũng không có chỗ để truyền:

```
get_history(session_id: str, *, limit_messages: int = 8) -> list[dict[str, str]]
append_messages(session_id: str, messages: list[dict[str, str]]) -> None
```

**Rào cản duy nhất:** `session_id` là `uuid4()` server sinh — không dò được. Nhưng nó
không phải bí mật: đi qua body request, localStorage, log proxy, link chia sẻ. Qua rào
đó thì không còn lớp nào chặn.

### Vì sao chốt kiểm chủ đã có không cứu được

`main.py` **có** kiểm chủ, nhưng nó nằm trong khối `if _conversation_enabled()`:

```python
history = _ss_get(session_id, limit_messages=8)      # đọc KHÔNG phạm vi
if _conversation_enabled() and ...:
    ...
    history = []      # chốt kiểm chủ — CHỈ chạy khi cờ bật
```

`CONVERSATION_CONTEXT_ENABLED` mặc định `False` (`shared/config.py:124`) và `BE/.env`
không khai khoá này → **đang chạy tắt** → chốt không bao giờ chạy. Cấu hình mặc định là
cấu hình rò.

Bật cờ thì rò bị chặn phần lớn, nhưng **do ngẫu nhiên**: `cache_key` được đặt nên chốt
chống cache-poisoning ở `query_graph.py:581` ném lịch sử đi. Không có logic quyền sở hữu
nào tham gia. Rò mở lại mỗi khi `cache_key` rơi về `None` — nguồn của chính người hỏi còn
`status=processing` (`query_graph.py:167`), hoặc Redis chết (`:207`).

### Và một tầng nữa ghi đè lên quyết định đã có phạm vi

`RetrieveFAISS` (`query_graph.py:312`) đọc lại `sessions_store` rồi **ghi đè**
`conversation_history` trong state — kể cả khi tầng route vừa quyết định để rỗng.

State của graph **không mang `user_id`** (kiểm: `grep user_id app/graphs/query_graph.py`
ra rỗng), nên node đó không có cách nào tự giới hạn phạm vi, kể cả nếu muốn. Lần đọc lại
ấy chỉ mua thêm những lượt vừa ghi vài giây trước.

### Chiều GHI cũng hổng

`main.py` (đường leader) và đường single-flight follower đều gọi `_ss_append(session_id,
...)` không kèm chủ. B hỏi trên phiên của A thì câu của B nằm luôn trong lịch sử của A —
lượt sau của A mang theo ngữ cảnh của người lạ.

### Fix

- `sessions_store`: thêm cột `user_id` + `ALTER TABLE` idempotent trong `init_db()` cho DB
  đã tồn tại (`CREATE TABLE IF NOT EXISTS` bỏ qua cả cột mới — dễ tưởng là đã xong).
  `get_history`/`append_messages` nhận `user_id` và kiểm chủ ở **cả hai chiều**.
- Hàng cũ chủ `NULL` chỉ khớp lời gọi cũng không có chủ, tức chế độ mở. Coi `NULL` là "của
  mọi người" thì rò vẫn nguyên với đúng những hàng đang tồn tại. `SESSION_TTL_HOURS=24`
  dọn hết trong một ngày.
- 5 call site trong `main.py` truyền chủ xuống. `get_session_history` gỡ hẳn khỏi
  `build_query_graph`, `wiring.py` và điểm nối ở `main.py`; `hist_patch` chết theo.

**Một guard trong hai hàm của store phủ cả 5 call site.** Vá ở từng route thì diff to hơn
mà vẫn sót đường nào chưa ai nghĩ tới.

### Regression

`BE/tests/test_sessions_store_chu_so_huu.py` — 9 test: chữ ký có chỗ truyền chủ, người
khác không đọc được, chính chủ đọc được, người khác không ghi đè được (chiều ghi), chế độ
mở không tự dựng rào, hàng cũ `NULL` không mở cho người đã đăng nhập, DB cũ chưa có cột
vẫn mở được và không mất dữ liệu, `session_id` rỗng không nổ, và `build_query_graph` không
còn nhận hàm đọc lịch sử.

**Không dùng `inspect.getsource`** trong nhóm test này — xem mục dưới về bẫy dịch dòng.

### Phòng ngừa

Kiểm quyền sở hữu **không được nằm sau một cờ tính năng**. Cờ tắt là đường mặc định, và
đường mặc định phải là đường an toàn. Nếu một chốt bảo mật chỉ chạy khi bật cờ, nó không
phải chốt — nó là hiệu ứng phụ.

Và: tầng dưới không được ghi đè quyết định của tầng đang giữ phạm vi. Muốn ghi đè thì phải
mang theo đủ ngữ cảnh để tự quyết — không mang được thì đừng ghi đè.

## (GHI NHỚ 2026-09-01) Test dùng `inspect.getsource` không chạy được song song với việc sửa chính file đó

Hai ca đỏ giả trong một lần chạy suite:

```
FAILED tests/test_upload_pipeline_holes.py::test_route_v2_co_goi_buoc_xoa_storage
FAILED tests/test_quiz_attempt.py::test_short_answer_quiz_is_graded_in_background
```

Chạy lại riêng: `2 passed`. Mã không sai. `inspect.getsource` lấy `co_firstlineno` từ
module đã nạp trong RAM rồi đọc **dòng hiện tại trên đĩa** qua `linecache`. Sửa
`app/main.py` (+50 dòng) giữa lúc suite chạy → nó trả về thân của hàm khác.

Suite BE mất ~22 phút. Cửa sổ đó đủ rộng để dính thường xuyên.

Hai luật rút ra:
- Đừng chạy suite đầy đủ trong lúc còn đang sửa mã. Số ra không dùng được.
- Đừng chạy **hai** lần pytest chồng nhau: chúng dùng chung Postgres/sqlite, và ca
  `test_progress_concepts_uses_latest_snapshot_not_a_running_sum` đỏ đúng vì lý do đó
  (chạy riêng thì xanh).
- Test khẳng định-cấu-trúc thì ưu tiên `inspect.signature` thay vì `getsource`: nó đọc từ
  object trong RAM, không đụng `linecache`, nên không dính bẫy này.


## (ĐÃ SỬA 2026-09-01) Quiz: đáp án trùng nhau, xin 10 nhận 5, lỗi mạng nói tiếng Anh

Audit vòng 8 — người dùng báo ba thứ trong một lần dùng: *"tạo ra đáp án có trùng A B C D
thì có thêm C hoặc D"*, *"tạo 10 câu như chỉ tạo ra 5 câu"*, *"fetch to failed"*.

Ba triệu chứng, **ba nguyên nhân gốc khác nhau**. Bằng chứng lấy từ log server và bảng
`ai_validation_logs` chứ không đoán:

```
quiz_job_done job_id=7ae6eb87 kept=5 rejected=5   -> 5x FR-13.3 "Thiếu explanation"
quiz_job_done job_id=a16c1454 kept=2 rejected=8   -> 7x FR-13.1 "question_type
                                                    'short_answer' không nằm trong
                                                    dạng đã yêu cầu" + 1x FR-13.2
quiz_job_done job_id=f97dc5d6 kept=3 rejected=2   -> 2x FR-13.1 (short_answer)
```

### V8-1 — tầng luật không soi mảng `options` một dòng nào

`validate_questions` kiểm `correct_answer` có nằm trong `options` không, nhưng **không hề
kiểm các lựa chọn có khác nhau không**. Chứng minh trực tiếp:

```python
q = {..., "options": ["A", "B", "C", "C"], "correct_answer": "C"}
validate_questions([q], allowed_chunk_refs=["c0"])
# -> accepted: 1, options giữ nguyên ['A','B','C','C']
```

Người học thấy C và D y hệt nhau. Nếu đáp án đúng là C thì câu đó không chấm công bằng
được — chọn "D" cũng là chọn đúng nội dung.

Một dòng thật từ `ai_validation_logs` cho thấy hình dạng output của model lỏng đến mức
nào: `type: true_false` mà `opts: ['Không có hạn chế', 'Hạn chế về độ chính xác',
'Hạn chế về hiệu suất']`.

**Fix:** gộp lựa chọn trùng theo `norm_text` (bỏ dấu, bỏ hoa/thường) **trước** khi đếm và
trước khi so đáp án; gộp xong còn dưới 2 lựa chọn phân biệt thì mới loại cả câu. Gộp chứ
không loại — câu 3 lựa chọn phân biệt vẫn dùng được, loại đi là người dùng mất câu hỏi
vốn dùng được (đúng nguyên tắc đã ghi ở đầu `rules.py`).

**Đừng đổ cho model.** gemma2:2b yếu là điều kiện vận hành đã chọn ở vòng 7 để đổi lấy
tốc độ (30 tok/s thay vì 3.66). Tầng luật sinh ra chính là để đỡ cho nó.

### V8-2 — system prompt dạy cả ba dạng, kể cả dạng người dùng đã tắt

`_SYSTEM` là **hằng số**, luôn mô tả đủ ba dạng kèm định dạng riêng cho `short_answer`.
Cấu hình thật (`question_types`) chỉ xuất hiện **một dòng** trong prompt người dùng:
`- Dạng câu hỏi được phép: multiple_choice, true_false`.

Model 2B nghe system prompt. Job a16c1454: người dùng tắt short_answer, model trả 7/10 câu
short_answer, tầng luật loại sạch 7 câu. **Xin 10 nhận 2.**

Tầng luật làm đúng việc của nó. Vấn đề là nó chỉ còn việc đếm xác.

**Fix:** `build_system(allowed_types)` — dạng nào không được phép thì **không xuất hiện**
trong chỉ dẫn, kể cả trong khối JSON mẫu (`"question_type": "{{TYPES}}"`). Prompt và luật
giờ sinh từ cùng một danh sách `question_types`. Nhân tiện siết hai chỗ model hay bỏ:
`explanation` ghi rõ BẮT BUỘC + hậu quả, `multiple_choice` ghi rõ 4 lựa chọn KHÁC HẲN NHAU.

### V8-3 — thiếu câu thì không có gì bù lại

`accepted[:question_count]` chỉ **cắt xuống**, không bao giờ bù lên. Job 7ae6eb87 mất 5/10
câu vì model bỏ `explanation` — V8-2 không chữa ca này, model 2B bỏ trường bắt buộc là
chuyện thường.

**Fix:** **MỘT** lượt bù, không hơn. Sau khi lọc, còn thiếu thì gọi lại đúng phần thiếu,
kèm danh sách câu đã có (`da_co`) để model không ra lại y hệt rồi bị loại vì trùng
(FR-13.7). Câu bù đi qua đúng tầng luật đó, đúng bộ `allowed_types` đó.

**Vì sao chỉ một lượt:** máy có 1 slot LLM (`MAX_CONCURRENT_LLM_CALLS=1`), mỗi lượt là ~1
phút người dùng ngồi chờ. Bù xong vẫn thiếu thì trả đúng số có được — `result` thêm khoá
`asked_count` để chênh lệch nói ra được, không im lặng.

Bù hỏng **không** làm hỏng cả job: quiz 5 câu vẫn dùng được, còn hơn ném đi 5 câu đã qua
kiểm chất lượng. `update_job(progress=80, current_node="BuSoCauThieu")` giữa hai lượt vừa
là báo tiến trình vừa là nhịp tim — không có nó, lượt bù kéo dài tổng thời gian im lặng
vượt `JOB_STUCK_AFTER_SECONDS=900` và job bị quét thành `interrupted`.

### V8-4 — `Failed to fetch` hiện nguyên văn cho người học

Chuỗi đó do **trình duyệt** sinh khi `fetch` không tới được máy chủ (`TypeError`). Tiếng
Anh, và không nói được phải làm gì.

`getUserFriendlyApiError` trong `FE/src/utils/api.js` xử lý đúng ca `TypeError` **từ lâu**.
Grep ra: **0 trang StudyMap nào gọi nó**. 14 chỗ trong `pages/study/*` hiện thẳng
`e?.message`. Không phải thiếu code — code có sẵn không ai nối vào.

**Fix:** `moTaLoi(e, duPhong)` trong `studyApi.js`, thay vào cả 14 chỗ. Không dùng thẳng
`getUserFriendlyApiError`: hàm đó đổi **mọi** lỗi lạ thành "Đã có lỗi xảy ra", nuốt luôn
thông báo tiếng Việt BE đã viết sẵn cho người dùng ("Phạm vi đã chọn không có chunk nào đã
index") — mất chúng thì người dùng hết đường tự sửa. `moTaLoi` chỉ thay ba nhóm: lỗi mạng,
lỗi quyền (401/403/404), và chuỗi `HTTP nnn` trần.

### Regression

- `BE/tests/test_quiz_lua_chon_trung.py` — 5 test: gộp trùng, trùng chỉ khác dấu/hoa
  thường, gộp xong còn 1 lựa chọn thì loại, đáp án đúng phải sống sót sau khi gộp, và
  lựa chọn khác nhau thì giữ nguyên thứ tự.
- `BE/tests/test_quiz_prompt_va_bu_cau.py` — 8 test: system prompt không được chứa dạng đã
  tắt (kể cả ở **lượt retry**), danh sách lạ/rỗng thì quay về đủ ba dạng, prompt bù nói
  đúng số còn thiếu và liệt kê câu đã có.
- `FE/src/utils/studyApiLoi.test.js` — 6 test, gồm ca khoá thẳng: chuỗi trả về **không**
  được khớp `/failed to fetch/i`.

### Phòng ngừa

Prompt và luật kiểm phải sinh từ **cùng một danh sách**. Hằng số prompt tả nhiều hơn cấu
hình cho phép thì tầng luật phía sau chỉ còn việc đếm xác — và người dùng chịu phần chênh.


## (ĐÃ SỬA 2026-08-29) Xoá tài liệu xong, bản gốc vẫn nằm trong bucket private

Audit vòng 6 — trace đường đi của một file từ lúc nhận tới lúc nằm yên.

Có **hai** route xoá, làm khác nhau:

```
POST   /delete-source     main.py:4064  -> CÓ gọi _storage.delete(obj)
DELETE /sources/<id>      main.py:4576  -> 6 bước dọn, KHÔNG bước nào chạm Storage
```

6 bước của route v2: backup -> xoá `input_docs` -> xoá chunk index -> xoá memory tree ->
xoá registry row -> xoá mindmap. Bản gốc trong bucket **không có trong danh sách**.

Tệ hơn: docstring của chính route đó ghi *"Xóa: 1. File gốc trong input_docs/ **và object
trên Supabase Storage**"*. Tài liệu hứa, mã không làm.

FE dùng route nào? `SidebarLeft.jsx:126` gọi `DELETE /sources/<id>` **trước**, chỉ rơi về
`POST /delete-source` khi cái kia hỏng. **Đường mặc định là đường không dọn.**

- **Hậu quả:** người dùng bấm xoá, giao diện sạch, file gốc nằm lại **vĩnh viễn** trong
  bucket private. Không đường nào dọn về sau. Với tài liệu học tập cá nhân thì "đã xoá"
  mà còn lưu là một lời hứa bị phá, không chỉ là tốn dung lượng.
- **Fix:** helper `_delete_storage_object(source_info)` dùng chung, gọi ở bước 2 của route
  v2. Guard `obj != input_path` **giống hệt `_don_file_tam`**: khi Storage chưa cấu hình
  hoặc upload lỗi thì `documents.file_path` chính là đường local, và bước xoá file local đã
  lo — gọi `storage.delete` với một đường dẫn đĩa là vô nghĩa.
- **Không nuốt im:** xoá hỏng thì in cảnh báo (bài học C5 vòng 2 — rác tồn kho có tính tiền).
  Response thêm `deleted_items.storage_object`: `None` = không có gì để xoá, `True/False` =
  đã thử và kết quả.
- **KHÔNG đụng route cũ.** `POST /delete-source` đang làm ĐÚNG HƠN route mới; việc cần làm
  là kéo route mới lên bằng nó.
- **Regression:** `tests/test_upload_pipeline_holes.py` — 5 test cho P1, gồm một khẳng định
  cấu trúc rằng route v2 có gọi bước này.

---

## (ĐÃ SỬA 2026-08-29) Ghi chunk vào Postgres hỏng thì im, tài liệu vẫn báo "xong"

`ingest_graph._persist_sections_and_chunks` bọc toàn bộ trong `try/except` với lý do đúng:

> "Lỗi ở đây KHÔNG chặn pipeline — index đã ghi xong, chat vẫn chạy."

Fail-open đó **đúng cho chat**. Nhưng trạng thái tài liệu không phản ánh gì:

- FAISS đã có chunk -> hỏi đáp chạy ngon.
- `document_chunks` **rỗng** -> quiz (`chunks_for_scope`), study map, review, gap analysis
  đều mất nguồn. Chúng đọc Postgres, không đọc FAISS.
- `set_counts(chunk_count=n)` nằm TRONG `try` -> hỏng thì `chunk_count` giữ `None`.
- Tài liệu vẫn đi tiếp tới `Finalize` -> `status = ready`.

Người dùng thấy "xử lý xong", chat chạy tốt, rồi tạo quiz thì gặp lỗi vô nghĩa. Chỉ có một
dòng `print` ở server. So sánh: mindmap/summary có `degraded_missing` để nói "xong nhưng
thiếu phần nào"; ingest không có gì tương đương.

- **Fix:** `_persist_sections_and_chunks` trả `bool`; kết quả đi vào
  `capabilities.structured_query`. Fail-open **giữ nguyên** — chỉ sửa phần BÁO CÁO.
- `chunk_count = 0` khi hỏng, thay vì để `None`: `None` là "chưa đo", `0` là "đã đo, rỗng".
- **Bẫy đã dính khi sửa:** `update_status` ghi `meta["capabilities"] = capabilities` —
  **THAY, không gộp**. Node `BuildMemoryTree` ghi capabilities sau nên xoá mất cờ. Không
  gộp ở tầng repository (gộp thì không caller nào tắt được một capability nữa) mà truyền cờ
  qua state.
- **Bẫy thứ hai:** `state.py` có sẵn comment *"LangGraph merge state chỉ giữ field có trong
  TypedDict"*. Thiếu dòng khai `structured_query: NotRequired[bool]` là cờ bị loại giữa hai
  node. Comment đó cứu đúng một lần.
- **Regression:** 3 test — hỏng thì `structured_query=False` + `chunk_count=0`, chạy tốt thì
  `True`, và một test khoá rằng field có trong `IngestState`.

---

## (ĐÃ SỬA 2026-08-30) Bấm "Tạo quiz" 5 lần = 5 job, 3 job chết vì tranh 1 slot LLM

Audit vòng 7 — trace một HÀNH ĐỘNG (bấm một nút) thay vì một FILE. Người dùng báo:

```
Tạo quiz thất bại
Gọi model thất bại: LLM busy (in-process): all 1 slots in use, waited 180.0s
```

Log server nói rõ hơn — **5 POST trong 2 giây**:

```
00:24:40 POST /api/quizzes/generate 202  x3
00:24:41 POST /api/quizzes/generate 202  x2
quiz_job_done   f97dc5d6 kept=3 rejected=2
quiz_job_failed 43e873d3 / 8ebf370b / 488b300d  err=... LLM busy: all 1 slots in use
```

**Một quiz ĐÃ RA XONG** (f97dc5d6) nhưng giao diện bám vào một job khác nên báo thất bại.

- **Q1 — FE không chặn bấm lặp.** `QuizSetup.onSubmit` không có cờ đang-gửi, nút submit
  không bao giờ `disabled`. Giữa lúc bấm và lúc 202 về, form **không đổi gì** — bấm thêm
  là phản xạ đúng. `job.jobId` (thứ thay form bằng `JobProgress`) chỉ được đặt SAU `await`.
  **Fix:** cờ `submitting` đặt TRƯỚC `await`, nút `disabled` + đổi nhãn "Đang gửi yêu cầu…".
  Mượn đúng khuôn `submitting` đã có sẵn ở `QuizTaking.jsx`.
- **Q2 — BE nhận job trùng vô điều kiện.** Cờ ở FE **không đủ**: F5, hai tab, app khác đều
  đi vòng qua nó. **Fix:** `_quiz_job_giu_cho()` — dedupe theo `(user_id, document_id,
  config)`; job cũ còn sống (`pending|running|processing`, cùng từ vựng với
  `list_active_jobs`) thì trả lại đúng `job_id` đó + `deduped: true`, không tạo job mới.
  **Kiểm-rồi-giữ nằm TRONG một lần khoá** — tách hai bước thì hai request cùng lúc đều
  thấy trống, đúng lỗi cần chặn. Test dùng `threading.Barrier(2)` khoá luật này.
  Giữ chỗ TRƯỚC khi enqueue (enqueue hỏng thì `sweep_stuck_jobs` dọn); giữ chỗ SAU thì
  cửa sổ đua quay lại.
  **Trần đã biết:** dict trong tiến trình, đúng cho `WEB_CONCURRENCY=1` mà compose đang ép.
- **Q4 — xin 5 câu, nhận 3, không ai nói gì.** `result` của job **có** `rejected_count`
  (`main.py:2590`) nhưng FE chưa bao giờ đọc khoá đó. Cùng họ với P2 vòng 6: chạy một
  phần thì phải nói ra là phần nào. **Fix:** `QuizSetup` gửi `{asked, kept, rejected}` qua
  router state, `QuizTaking` hiện một dòng khi `rejected > 0`.
- **Regression:** `tests/test_quiz_job_dedupe.py` — 6 test, gồm ca đua hai luồng và ca
  `get_job` trả `None` (job bị dọn) không được biến thành cửa khoá vĩnh viễn.

**Không đụng `MAX_CONCURRENT_LLM_CALLS=1`.** Một slot là ĐÚNG cho CPU không GPU: hai lời
gọi song song trên cùng CPU không nhanh hơn, chỉ chia đôi tốc độ và gấp đôi bộ nhớ.

- **Q3 — ba con số của cửa sổ ngữ cảnh không khớp nhau.** `QUIZ_CONTEXT_CHARS=18000`
  (~6500 token tiếng Việt) nhồi vào `num_ctx=4096`, trong khi `num_predict=8192` **lớn hơn
  cả cửa sổ**. Ollama không báo lỗi — nó **cắt bớt prompt trong im lặng**, nên quiz lâu nay
  ra đề từ một phần ngữ liệu mà không ai biết. `build_context` cắt theo KÝ TỰ, không biết
  gì về cửa sổ token của model đang chạy.
  **Fix:** cho ba số khớp nhau — `QUIZ_CONTEXT_CHARS=12000` (~4400 token) +
  chỉ dẫn (~300) + `QUIZ_LLM_MAX_OUT=3000` = ~7700 < `QUIZ_LLM_CTX=8192` (trần của
  gemma2:2b; qwen2.5 chịu 32k). Truyền `num_ctx`/`num_predict` xuống ĐÚNG lời gọi quiz —
  đặt hằng mà quên truyền thì Ollama vẫn dùng `LLM_CTX_SIZE=4096` toàn cục.
  `build_context` in `quiz_context_cat_bot giu=N bo=M` khi bỏ đoạn.
  **Test khoá BẤT ĐẲNG THỨC giữa ba số, không khoá từng số** — đổi một cái mà quên hai cái
  kia thì đỏ, còn chỉnh cả ba cho khớp thì vẫn xanh.
- **Q5 — hàng đợi bận và model không kịp nói cùng một câu.** Cả hai tới người dùng dưới
  dạng `Gọi model thất bại: ...`, trong khi chúng đòi hai hành động ngược nhau: "chờ rồi
  thử lại" và "máy không kham nổi, giảm tải hoặc đổi model".
  **Fix:** bảng `_LOI_AI_DE_HIEU` trong `_job_error_text` — bộ định dạng lỗi **dùng chung**
  của mọi job, nên sửa một chỗ thì mindmap/summary/study-map được luôn. Nguyên văn kỹ thuật
  giữ trong ngoặc `(chi tiết: ...)`, không mất gì cho người sửa lỗi.
- **Regression (Q3+Q5):** `tests/test_quiz_ngan_sach_va_loi.py` — 9 test.

---

## (ĐÃ SỬA 2026-08-29) Tạo quiz chết: CPU 3.66 tok/s không lọt 180s, gemini 401 vì token lạ

Hai nguyên nhân ĐỘC LẬP, không cái nào là lỗi logic:

```
[llm] provider 'ollama' thất bại (feature=quiz): TimeoutError: LLM call timed out after 180s
[llm] provider 'gemini' thất bại (feature=quiz): Unauthenticated: 401 ... ACCESS_TOKEN_TYPE_UNSUPPORTED
```

**1. Ollama trên CPU không thể xong trong 180s.** Đo thật (`/api/generate`, qwen2.5:7b-instruct Q4):

```
eval_count 260  eval_duration 71.1s  load_duration 11.1s   ->  3.66 token/giây
```

Quiz mặc định `question_count=10`; JSON tiếng Việt kèm 4 lựa chọn + giải thích ≈ 1500–2500
token đầu ra ≈ **7–11 phút**. `QUIZ_LLM_TIMEOUT_SEC` mặc định 180s, hụt ~4 lần.
`MAX_ATTEMPTS=2` nên hỏng hai lần rồi mới báo. Máy không GPU (`TORCH_DEVICE: cpu`), model
còn bị ollama unload khi rảnh (`/api/ps` rỗng) nên cộng thêm 11s nạp lại mỗi lần.
**Fix (đã chọn):** `QUIZ_MODEL=gemma2:2b` — đo được **30.28 token/giây**, nhanh hơn 8.3
lần, 10 câu còn ~1 phút. Knob `QUIZ_MODEL` đã có sẵn (`llm_factory._model_map:158`), không
phải viết thêm gì. Kèm `QUIZ_LLM_TIMEOUT_SEC=900` làm đệm. Không đổi mặc định trong mã —
180s và 7b đều đúng cho máy có GPU. Đánh đổi: chất lượng ra đề tiếng Việt của 2b kém hơn.

**Còn treo, CHƯA sửa — `num_ctx` nhỏ hơn ngữ liệu quiz gửi vào:**

| | giá trị | ở đâu |
|---|---|---|
| cửa sổ ngữ cảnh | `num_ctx=4096` | `LLM_CTX_SIZE`, `llm_factory.py:223` |
| số token sinh tối đa | `num_predict=8192` | `LLM_MAX_TOKENS`, `llm_factory.py:46` |
| ngữ liệu quiz nhồi vào | 18000 **ký tự** ≈ 5000–7000 token | `QUIZ_CONTEXT_CHARS`, `generator.py:19` |

`num_predict` **lớn gấp đôi** `num_ctx` là vô nghĩa với Ollama — cửa sổ chứa cả prompt lẫn
phần sinh ra. Và ngữ liệu một mình đã vượt cửa sổ, nên Ollama **cắt bớt prompt trong im
lặng**: quiz lâu nay ra đề từ một phần ngữ liệu chứ không phải toàn bộ, không có cảnh báo
nào. `build_context` có cắt theo `max_chars` nhưng cắt theo KÝ TỰ, không biết gì về cửa sổ
token của model đang dùng. Chưa sửa vì phải chọn: nâng `LLM_CTX_SIZE` (chậm hơn, và
gemma2:2b trần 8192) hay hạ `QUIZ_CONTEXT_CHARS` (ít ngữ liệu hơn, nhưng thật thà).

**2. Gemini 401 vì một biến môi trường KHÔNG PHẢI của dự án.** `BE/.env:10` là
`GEMINI_API_KEY=` **rỗng**, nhưng Windows User environment có
`GEMINI_API_KEY=AQ.Ab8RN...` (53 ký tự). `AQ.` + 53 ký tự là **access token OAuth** của
Google (Gemini CLI / Antigravity đặt lúc đăng nhập), không phải API key AI Studio
(`AIza...`, 39 ký tự) — đúng thứ `ACCESS_TOKEN_TYPE_UNSUPPORTED` đang nói. Token loại đó
sống ~1 giờ.

`load_project_env(override=False)` -> **os.environ thắng `.env`**, nên đặt gì trong
`BE/.env` cũng vô ích. Provider gemini vào `PROVIDERS`, và mỗi lần fallback langchain
retry 401 năm lần (2+4+8+16+32 = **62 giây**) cho một lỗi không bao giờ retry được.
**Fix:** gỡ biến ở tầng User Windows, hoặc chạy BE với biến đó bỏ trống. Không sửa mã.

**3. Nhặt được trên đường: `AI_TIMEOUT_SEC` khai HAI lần** trong `BE/.env.example` (dòng
83 = 600, dòng 349 = 180) và trong `.env` copy từ nó. dotenv lấy dòng SAU -> 600 chưa bao
giờ có hiệu lực. Ai sửa dòng 600 sẽ thấy "sửa xong không có gì đổi".
**Regression:** `tests/test_env_example_khong_trung_khoa.py` — quét trùng khoá cả hai file
mẫu. `.env` thật bị gitignore nên không test được; chặn ở file mẫu là chặn tại nguồn sao chép.

**4. Docstring `load_project_env` ghi NGƯỢC thứ tự ưu tiên**: "BE/.env > ../.env >
os.environ" trong khi `override=False` nghĩa là os.environ thắng. Chính câu đó làm mất
20 phút đi tìm "vì sao `.env` rỗng mà vẫn có key". Sửa docstring, **không** sửa hành vi:
docker-compose truyền cấu hình bằng biến môi trường thật và phải thắng `.env` trong image.

---

## (ĐÃ SỬA 2026-08-29) `_safe_save_path` chỉ KIỂM tên, không giành tên

Audit vòng 6 — P4. Vòng trước ghi "chưa tái hiện được ca đua, chưa vá". Tái hiện được, và
khe không hẹp như tưởng:

```python
while os.path.exists(path):      # chỉ kiểm
    path = f"{root}_{n}{ext}"
return path                      # KHÔNG tạo gì -> file mãi tới file.save() mới ra đời
```

Hai luồng gọi cùng lúc **luôn** nhận cùng một đường dẫn — không phải "cửa sổ rất hẹp", mà
là toàn bộ khoảng từ lúc trả chuỗi tới lúc `file.save()`. Test dùng `threading.Barrier(2)`,
không cần sleep giả, hỏng ngay lần đầu:

```
AssertionError: hai luồng chọn cùng một đường dẫn: ['...ao_cao.pdf', '...ao_cao.pdf']
```

- **Hậu quả:** hai upload trùng tên cùng lúc, bản lưu sau đè bản trước. Người thứ nhất
  thấy tài liệu "xong" nhưng nội dung là file của người thứ hai. Gunicorn nhiều worker
  dùng chung `input_docs/` nên là nhiều **tiến trình**, khoá trong tiến trình vô dụng.
- **Fix:** `os.open(path, O_CREAT|O_EXCL|O_WRONLY)` trong vòng lặp — giành tên atomic ở
  tầng hệ điều hành, đúng ranh giới nhiều tiến trình. `FileExistsError` -> thử `_2`, `_3`.
- **KHÔNG dùng `tempfile.mkstemp`** như plan gốc đề xuất: nó phá hình dạng tên
  (`bao_cao_2.pdf` -> `tmp8f2x.pdf`), mà tên đọc được là thứ `_unique_display_filename` và
  cả FE đang dựa vào. `O_EXCL` giữ nguyên tên, cùng stdlib, ít dòng hơn.
- **Kéo theo:** `os.makedirs(INPUT_DIR)` phải chuyển VÀO trong hàm — hàm giờ ghi đĩa thật,
  gọi nó trước khi thư mục tồn tại sẽ chết.
- **Đánh đổi đã cân:** `save` ném thì còn file 0 byte. Giống hệt hành vi cũ (file ghi dở),
  `_don_file_tam` trong `finally` của job ingest dọn.
- **Regression:** `tests/test_upload_pipeline_holes.py::test_hai_upload_trung_ten_cung_luc_*`

---

## (ĐÃ SỬA 2026-08-29) Chế độ mở: `sources` rỗng = quét toàn kho, gồm cả tài liệu đã xoá

Audit vòng 6 — P3. `soft_delete` chỉ đổi `documents.status`, chunk trong FAISS nằm nguyên
(đúng đặc tả 8.10 "giữ dữ liệu con"). `_resolve_owned_query_sources` với
`AUTH_PROTECT_APP_APIS=false` trả thẳng `[]`, và `[]` xuống tầng truy hồi nghĩa là **tìm
toàn bộ kho** — không tầng nào lọc `deleted`.

Cùng lớp lỗi "nhánh chế độ mở" của vòng 1 (Study Map vỡ 100% ở đúng nhánh này).

- **Fix một dòng:** rỗng -> `sorted(owned_stems(user_id))`. Chế độ mở `owned_stems` bỏ qua
  chủ sở hữu nhưng vẫn lấy từ `all_rows()`, mà `all_rows()` **đã** lọc `status != deleted`.
  Không thêm tầng lọc mới, chỉ dùng cái đã có.
- **Registry rỗng vẫn trả `[]`** (= toàn kho) như cũ: cài mới hoặc kho chưa đăng ký không
  được biến thành "không tìm gì cả".
- **Mặt trái đã cân:** stem có trong index mà KHÔNG có trong registry (index nhập từ
  ngoài, registry mất) sẽ không được tìm ở chế độ mở nữa. Đo được từ mã thì không, nhưng
  cấu hình thật đang bật auth nên bán kính nổ nhỏ.
- **Test cũ phải sửa theo:** `test_source_ownership.py` khẳng định `flag off + [] -> []`.
  Đó chính là hành vi vừa đổi; sửa khẳng định, không phải sửa mã.
- **Regression:** `test_upload_pipeline_holes.py::test_che_do_mo_*` (3 test: liệt kê,
  registry rỗng, có chọn nguồn).

---

## (2026-08-29) ĐÃ ĐO: tài liệu ingest hỏng tồn đọng — 1 dòng, 8.7 MB

Audit vòng 6 — P6. Ingest lỗi thì object trên Storage và dòng `documents` giữ nguyên. Giữ
là **đúng** (ingest lại thì phải còn file), nhưng không có gì đo được đống đó lớn cỡ nào.

`BE/scripts/dem_tai_lieu_loi.py` — chỉ đọc, không xoá. Chạy thật trên DB:

```
1 tài liệu hỏng cũ hơn 0 ngày (8.7 MB, cũ nhất 2026-08-25).
lý do hỏng thường gặp:  1  disk I/O error
```

**Quy mô nhỏ -> chưa cần cơ chế dọn.** Đo trước, quyết sau; đó là toàn bộ mục đích.

**Bẫy chữ `status`, suýt trả lời sai:** `ck_documents_status` chỉ nhận
`uploaded|processing|completed|failed|deleted`. Pipeline gọi trạng thái này là `error`, cột
DB lưu `failed` (`repository._STATUS_TO_DB`). Truy vấn `status = 'error'` trả **0 hàng** và
kết luận "không có gì tồn đọng" — sai theo cách im lặng nhất. Plan vòng 6 viết `status=error`
đúng theo từ vựng pipeline; script phải dịch sang từ vựng DB.

---

## (2026-08-29) Pipeline upload — những chỗ ĐÃ ĐÚNG, đừng "sửa"

Trace đầy đủ rồi mới kết luận. Ghi lại để vòng sau khỏi đụng nhầm:

| | bằng chứng |
|---|---|
| Chặn đuôi file TRƯỚC khi ghi bất cứ gì | `_ingest_uploaded_file` gọi `is_supported()` dòng đầu -> 415 kèm danh sách đuôi hợp lệ |
| Giới hạn dung lượng | `main.py:56` `MAX_UPLOAD_MB=100` -> `MAX_CONTENT_LENGTH`, có handler 413 riêng |
| Chống path traversal | **hai lớp**: `_safe_save_path` (`os.path.basename` + fold `[<>:"/\|?*\x00-\x1f]`) và `storage.object_path` (`PurePosixPath(...).name`) |
| Khoá Storage hợp lệ | `_safe_key_part` NFKD -> ASCII -> fold (Supabase từ chối khoảng trắng/dấu tiếng Việt) |
| KHÔNG lộ storage path | `_doc_public` không có `file_path`; mở file phải qua `/api/documents/<id>/file` -> signed URL, ttl kẹp 60–3600s (NFR-04.3) |
| Xoá bản tạm an toàn | `_don_file_tam` so `file_path` với đường local, **bằng nhau thì không xoá** |
| Gắn chủ sở hữu | `uid = _current_user_id()` lúc `create`; `_owned_document` trả **404** chứ không 403 (không tạo oracle đoán id) |
| Tài liệu xoá mềm | `all_rows()` lọc `status != "deleted"` + `invalidate_cache()` trong `soft_delete` |

**Một nghi ngờ đã RÚT LẠI:** `_load_source_registry()` nghe như đọc file JSON và tao đã
định ghi nó là "nguồn sự thật thứ hai cho quyền sở hữu". Đọc kỹ thì nó là
`_docs.all_rows()` (Postgres); tên cũ giữ cho back-compat. **Không có hai nguồn sự thật.**

**Bảy nơi dữ liệu nằm lại, phân vai đúng:** Storage = bản gốc, Postgres = dữ liệu nghiệp
vụ, FAISS + `chunks.sqlite` = chỉ mục, `memory/` = cây nhớ, `input_docs/` = tạm.

---

## (2026-08-29) CHƯA SỬA, đã xét: 1 điểm còn lại của pipeline upload

(Hai điểm kia — chế độ mở thấy tài liệu đã xoá, và khe TOCTOU của `_safe_save_path` — đã
sửa cùng ngày, xem hai mục ĐÃ SỬA ở trên.)

- **Chỉ kiểm ĐUÔI file, không kiểm nội dung.** Đổi tên `a.exe` -> `a.pdf` là qua cổng.
  Mức độ **thấp**: bucket private, file không bao giờ phục vụ trực tiếp (chỉ signed URL),
  không đường nào thực thi nội dung. Hậu quả thật là thông báo lỗi tệ, không phải lỗ bảo
  mật. Không thêm dep sniff MIME.

## (ĐÃ SỬA 2026-08-29) `USE_LC_VECTOR_STORE`: ba tầng, ba default, một tầng nói ngược

Tìm ra khi soạn plan vòng 5, không phải do ai báo lỗi. Cùng một cờ, ba nơi định nghĩa
mặc định:

```
shared/config.py:98        use_lc_vector_store: bool = True
shared/env_loader.py:45    os.environ.setdefault("USE_LC_VECTOR_STORE", "1")
vectorstore/store.py:65    os.getenv("USE_LC_VECTOR_STORE", "0")      <-- NGƯỢC
```

`tests/conftest.py` đặt `MEMVID_DISABLE_LC_DEFAULTS=1` nên tầng giữa im lặng. Khi đó
`config` trả **True** còn `store` trả **False** cho cùng một câu hỏi.

Ai thắng: `store`, vì `hybrid.py:252,338` và 5 chỗ trong `store.py` gọi
`_use_lc_vector_store()`. Còn trường trong config:

```
settings.use_lc_vector_store -> 0 người đọc
settings.use_lc_ensemble     -> 0 người đọc
settings.use_lc_qa_chain     -> 0 người đọc
settings.use_lc_ingest       -> 0 người đọc
```

**Cả bốn trường `use_lc_*` không ai đọc.** Mã thật vẫn `os.getenv()` rải rác — đúng thứ mà
docstring của chính `shared/config.py` tuyên bố đã dẹp: *"Settings tập trung — nạp env MỘT
lần thay vì os.getenv() rải rác lúc import."* Ví dụ minh hoạ trong docstring đó còn dùng
`s.use_lc_vector_store` — dạy người đọc dùng đúng trường không ai đọc.

- **Root cause:** trường được thêm vào config như một "sẽ chuyển sang dùng sau", nhưng bước
  chuyển không bao giờ xảy ra. Không ai xoá, nên nó thành nguồn sự thật giả.
- **Fix:** gỡ 4 trường + 4 kwarg khỏi `Settings`, đổi ví dụ docstring sang `s.crag_enabled`
  (trường có người đọc thật), và dán khối giải thích tại `store._use_lc_vector_store()` nêu
  rõ nó là ĐIỂM ĐỌC DUY NHẤT + vì sao default "0" là cố ý.
- **KHÔNG đổi default "0" thành "1".** Đó là đường LEGACY mà toàn bộ test retrieval đang
  chạy, và cũng là đường có guard dim của `hybrid._load_faiss_index` (vòng 3). Đổi default
  là đổi đường mà cả bộ test đi qua — sửa một cái lệch trên giấy, tạo một cái lệch thật.
- **Kèm:** hai cờ anh em ở `query_graph.py` đọc theo hai ngữ nghĩa ngược nhau —
  `USE_LC_ENSEMBLE` dùng `not in (falsy)` nên `"maybe"` ra **True**, `USE_LC_QA_CHAIN` dùng
  `in (truthy)` nên `"maybe"` ra **False**. Thống nhất về một hàm `_truthy` dùng chung;
  `"1"/"0"` không đổi kết quả, chỉ giá trị rác đổi và đổi theo hướng an toàn (TẮT).
- **Regression:** `tests/test_lc_flag_mot_nguon.py` (13 test): config không còn trường
  `use_lc_*`, bảng truthy đầy đủ 10 ca, default không-env về legacy, và khẳng định cấu trúc
  rằng hai cờ anh em cùng đi qua `_truthy`.
- **Prevention:** đây là **lần thứ ba** gặp "trừu tượng dựng xong rồi bị bỏ qua", sau
  `shared/paths.default_data_dir()` (0 caller, 3 module tự viết lại) và
  `__meta__["embedding_dim"]` (ghi 6 lần, đọc 0 lần). Luật: thêm một trường vào `config`
  thì **cùng commit đó** phải có ít nhất một chỗ đọc nó; nếu không thì đừng thêm.

---

## (ĐÃ SỬA 2026-08-29) Hai nhánh cấu hình của ingest chưa từng chạy

`USE_LC_INGEST` và `ENRICH_METADATA` đều mặc định BẬT và **không test nào từng đặt về
tắt**. Đúng lớp lỗi đã làm Study Map vỡ 100% ở chế độ mở.

- **Fix:** `tests/test_ingest_flag_branches.py` (5 test) chạy `build_ingest_graph` thật với
  cả hai giá trị của cả hai cờ. Mọi dependency nặng đã là seam inject sẵn
  (`extract_text`, `split_text`, `append_to_index`, `build_memory_tree_for_sources`) nên
  không đụng model, FAISS hay Postgres.
- **Kết quả:** cả bốn nhánh đều chạy được, không nhánh nào hỏng. Khác Study Map — lần đó
  nhánh chưa chạy vỡ 100%.
- **Bẫy khi viết:** graph có checkpointer sqlite nên `invoke()` bắt buộc
  `config={"configurable": {"thread_id": ...}}`, thiếu là
  `ValueError: Checkpointer requires one or more of the following 'configurable' keys`.

**Một test của chính đợt này từng XANH mà không đo gì.** Bản đầu khẳng định
`assert m_bat != m_tat or not m_bat` trên `out["chunk_metadatas"]` — **khoá không tồn tại**
(khoá thật là `doc_meta`, `ingest_graph.py:186`). Cả hai phía ra `{}`, vế `or not m_bat`
nuốt trọn, test xanh. Đã đọc đúng khoá và **bỏ vế thoát**: giờ khẳng định `doc_meta` có nội
dung khi bật và rỗng khi tắt.

**Prevention:** khẳng định dạng `assert A != B or not A` là mùi — vế `or` biến test thành
hằng đúng khi cả hai phía rỗng. Và khoá state phải đối chiếu với mã, đừng đoán theo tên.

---

## (2026-08-29) Dep BE: `pip show Required-by` trả lời, không cần thí nghiệm

Plan vòng 3 (R4.3) đề xuất "gỡ trong venv rồi chạy suite, đỏ thì trả lại" cho 5 gói nghi
thừa. Thừa công — một lệnh là xong:

```
pandas       Required-by: (rỗng)                                  -> GỠ
pdfplumber   Required-by: (rỗng)                                  -> GỠ
scipy        Required-by: scikit-learn, sentence-transformers     -> GIỮ
psutil       Required-by: pymupdf4llm                             -> GIỮ
tqdm         Required-by: huggingface_hub, sentence-transformers  -> GIỮ
```

`pdfplumber` không phải bộ đọc PDF của dự án — `fitz` (PyMuPDF) và `pymupdf4llm` mới là
(`ingest_utils.py:2`, `markdown_convert.py:9`).

- **Fix:** gỡ 2 dòng khỏi `BE/requirements.txt`, kèm comment nêu lý do giữ `psutil` (không
  có dòng import nào nhưng `pymupdf4llm` cần).
- **Prevention:** "không có dòng `import`" KHÔNG đủ để kết luận thừa — `gunicorn`,
  `grpcio-tools`, `psycopg`, `psutil` đều sống mà không có import. Hỏi `pip show`, đừng
  hỏi `grep`.

---

## (2026-08-29) CHƯA ĐO ĐƯỢC: cổng LLM 1 -> 2, vì GPU đang bị chiếm

Plan vòng 5 (E4) đặt điều kiện tiên quyết "máy phải RẢNH". Kiểm lúc chạy:

```
nvidia-smi   5331 MiB / 6141 MiB đã dùng, GPU 40%
/api/ps      {"models":[]}          <- Ollama KHÔNG giữ gì
```

Tức 5.3 GB đang bị tiến trình khác giữ (explorer.exe, msedgewebview2.exe, các
SystemApps), còn trống ~810 MiB — không đủ nạp model 4.68 GB. Đo lúc này chỉ đo tốc độ
CPU offload, không đo được điều cần biết.

**Gần y hệt lần trước:** sự cố Study Map 487 giây truy ra là do GPU bị chiếm
5378/6141 MiB. Cùng ngưỡng, cùng kiểu.

**Chưa đổi gì.** `MAX_CONCURRENT_LLM_CALLS` giữ `1`. Đo lại khi `nvidia-smi` báo dưới
~1 GB đang dùng, theo giao thức trong plan vòng 5.

**Ghi thêm — example lệch thực tế:** `BE/.env.example:295` ghi
`MAX_CONCURRENT_LLM_CALLS=2` trong khi giá trị đang chạy là `1` (từ `.env:40`, vì `BE/.env`
không khai báo khoá này nên rơi xuống root). Cùng họ với `SLM_MODEL` ở vòng 2: file mẫu
mô tả một cấu hình không ai chạy.

## (ĐÃ SỬA 2026-08-28) `BE/ENV_SETUP.md` chứa lệnh xoá NHẦM DỰ ÁN KHÁC

Nặng nhất vòng 4, và không phải lỗi mã — lỗi **tài liệu hướng dẫn thao tác phá huỷ**.

Mục "Rebuild FAISS Index khi đổi Embedding Model" có khối PowerShell mở đầu bằng:

```powershell
$base = "e:/memvid_NCKH/MemVid_New/BE"
Remove-Item -Recurse -Force "$base/index"
Remove-Item -Force "$base/memory/memory_index.faiss"
...
```

`MemVid_New` là **dự án KHÁC và CÓ THẬT trên máy này** (`ls -d /e/memvid_NCKH/MemVid_New`
trả về đường dẫn). Ai làm theo tài liệu là xoá `index/` cùng toàn bộ memory artifact của
dự án đó, còn dự án đang làm thì không đụng tới — vừa mất dữ liệu chỗ khác, vừa tưởng đã
rebuild xong.

Đây đúng là cái bẫy đã cắn một lần rồi: `BE/.env` có comment ghi `DATA_DIR` từng trỏ sang
`MemVid_New/BE` suốt nhiều tháng, toàn bộ trạng thái chạy rơi ra ngoài repo. Cùng một
đường dẫn tuyệt đối, cùng một dự án nhầm, ở hai file khác nhau.

Tên artifact trong khối lệnh cũng đã lỗi thời: `mindmaps.json` -> `mindmaps.sqlite`,
`summaries.json` -> `summaries.sqlite`, `mindmap_content_cache.json` không còn. Nên kể cả
sửa đúng `$base` thì lệnh vẫn không xoá được thứ cần xoá.

- **Fix:** khối lệnh chạy **tương đối theo `BE/`**, không còn đường dẫn tuyệt đối nào để gõ
  nhầm; tên artifact cập nhật theo thực tế; thêm mục "Quên rebuild thì sao?" trỏ tới guard
  dim mới (vòng 3) — giờ có câu báo rõ thay vì `AssertionError` rỗng.
- **Prevention:** **KHÔNG đường dẫn tuyệt đối trong tài liệu**, nhất là tài liệu có
  `Remove-Item -Recurse -Force` / `rm -rf`. Lệnh phá huỷ phải neo vào thư mục hiện tại.
- Sửa kèm: bảng "Biến quan trọng nhất" ghi `SLM_MODEL_CHAT` mặc định `qwen3.5:9b` và
  `SLM_MODEL_SUMMARY` mặc định `qwen2.5:14b` — cả hai đã gom về `DEFAULT_LOCAL_MODEL` ở
  vòng 2; `ollama pull qwen3.5:9b` ở mục troubleshooting đổi thành `qwen2.5:7b-instruct`
  (6.59 GB không vừa card 6.14 GiB); `videos/` bỏ khỏi danh sách "file an toàn".

**Đính chính phương pháp — lần thứ BA cùng một họ sai.** Plan vòng 4 kết luận
`ENV_SETUP.md` là "nguồn sự thật thứ hai, rỗng 93%" vì nó chỉ nhắc 9/128 khoá env, và đề
xuất rút nó thành một con trỏ. SAI. Nó không hề định làm danh sách khoá — nó là tài liệu
**thao tác** (rebuild index, thứ tự nạp env, troubleshooting), và phần nội dung đó không
có ở `.env.example`. Rút thành con trỏ là xoá mất thứ duy nhất có giá trị, và sẽ bỏ luôn
cái lệnh xoá nhầm dự án mà không ai phát hiện.

Đếm khoá là **phép đo sai câu hỏi** — cùng họ với `cmp` báo khác vì line-ending, và với
`BASE_URL` khớp trong `DATABASE_URL`. Trước khi đo, hỏi: file này định làm gì? Đo đúng thứ
nó định làm.

---

## (ĐÃ SỬA 2026-08-28) `README.md` mô tả một dự án khác — 75% đường dẫn sai

Đếm máy, không đếm mắt.

**Mục "Cấu trúc dự án":**

```
72 mục liệt kê | 54 SAI  (41 đã DI CHUYỂN, 13 KHÔNG CÒN)
```

13 mục không còn đều thuộc thời MemVid mã hoá bộ nhớ vào video QR: `core_modules/`,
`video_utils.py`, `chunk_processor.py`, `rebuild_index_from_video.py`, `videos/`,
`mindmap_utils.py`, `vector_store.py`, `memory_tree.py`, `summarize_advanced.py`,
`ai_provider.py`, `ollama_utils.py`, `storage/`, `lc_memory_tree.py`.

41 mục đã di chuyển: `main.py` -> `app/main.py`, `graphs/` -> `app/graphs/`, `retrieval/`
-> `app/domains/retrieval/`, `env_loader.py` -> `shared/env_loader.py`. Cây trong README là
ảnh chụp TRƯỚC đợt tái cấu trúc sang `app/domains/`.

**Mục "API Endpoints":**

```
README 27 endpoint | main.py 78 route
  5 endpoint README nói mà KHÔNG tồn tại
 56 route có thật mà README KHÔNG nhắc
```

5 endpoint ma: `/process-doc`, `/summarize-file`, `/summarize-documents`, `/rebuild-index`,
`/rebuild-status/<job_id>`. 56 route thiếu là toàn bộ bề mặt Phase 6–7 (study map, quiz,
attempt, progress, review, gap analysis, auth).

Thêm: tiêu đề vẫn là "MemVidX - Hệ thống Trí nhớ Thị giác"; cây bắt đầu bằng `MemVid_New/`
— **tên dự án khác**, đúng thư mục mà `.env` từng trỏ nhầm; 18 dòng nói về "video".

- **Fix:** viết lại ĐÚNG HAI MỤC, giữ nguyên phần còn lại (Cài đặt / Tính năng / Kiến trúc
  phần lớn còn đúng — đụng vào là tự tạo việc). Đổi tiêu đề + Tổng quan sang StudyMap AI,
  kèm một ghi chú lịch sử nói rõ hướng video QR đã bỏ.
- **Cách chống lệch lại: SINH, không gõ tay.** Cây dừng ở **2 tầng** sinh từ `git ls-files`;
  bảng API sinh từ `grep @app.route BE/app/main.py`. Cây 4 tầng liệt kê từng file gõ tay
  chính là thứ vừa lệch 54 chỗ. Cả hai lệnh sinh được dán ngay trong README.
- **Tự kiểm sau khi viết** (chạy lại đúng phép đếm đã phát hiện lỗi):
  `cây 29 mục | sai 0` · `api: README 80 | ma 0 | thiếu 0`.

---

## (ĐÃ SỬA 2026-08-28) Rác được git theo dõi + `.gitignore` hụt tiền tố backup

| file | bằng chứng | xử |
|---|---|---|
| `BE/scratch_cut.txt` | **0 dòng**, nội dung `1395 1594` | xoá |
| `BE/package-lock.json` | lockfile npm **rỗng** (`"packages": {}`), KHÔNG có `package.json` cạnh nó, nằm trong backend Python | xoá |
| `FE/db.json` | mock json-server, 3 hội thoại rỗng | xoá |
| `FE/src/db.json` | mock json-server KHÁC (khác md5), hội thoại giả `"Chat với GPT"` | xoá |

Xác minh trước khi xoá: `grep -rn "db.json" FE/src FE/vite.config.js FE/package.json` rỗng;
không có `json-server` trong `package.json`; `grep -rn "scratch_cut"` chỉ trúng plan vòng 4 và một ghi chú cá
nhân KHÔNG được git theo dõi (`06_Resume_States/`) — không mã, build hay tài liệu nào dùng.

**`.gitignore` hụt:** `BE/.gitignore:5` có `index_backup_*/` nhưng thư mục thật tên
`_backup-20260824-173248/` (1.3M sqlite runtime thật). Tiền tố không khớp, nên nó nằm trần
trong cây mã — thoát commit chỉ vì may, trong khi phiên này đã chạy `git add -A` ba lần.
Thêm `_backup-*/`. KHÔNG xoá thư mục: nó chứa sqlite thật, không sinh lại được.

**Prevention:** luật ignore phải khớp tên THẬT đang có trên đĩa. Viết luật xong thì
`git check-ignore -v <đường dẫn thật>` để xác nhận, đừng tin mẫu nhìn có vẻ đúng.

---

## (ĐÃ SỬA 2026-08-28) `docs/` — file kế hoạch nằm ngoài `plans/`

`docs/mindmap_generation_optimization_plan.md` là kế hoạch, trong khi mọi kế hoạch khác ở
`docs/superpowers/plans/`. `git mv` vào đó.

**CỐ Ý không làm:** 8 file spec còn lại để phẳng trong `docs/`. Dựng thêm `docs/specs/` chỉ
để cho gọn là việc tự tạo ra. `docs/memvid_speed_fix.docx` (nhị phân, tên thời MemVid) để
nguyên — xoá tài liệu không đọc được nội dung là quyết định của người dùng.

## (ĐÃ SỬA 2026-08-28) Index FAISS lệch dim: `AssertionError` RỖNG, truy hồi âm thầm tụt về BM25

**Chính xác hoá phạm vi.** Plan vòng 3 viết "index tài liệu không kiểm dim". Không đủ
chính xác — đường **GHI** có guard: `store._load_index(dim)` so `idx.d` với dim model, lệch
thì xoá index và build lại. Đường **ĐỌC** mới là chỗ hở: `hybrid._load_faiss_index()` đọc
file rồi `idx.search(qv, k)` thẳng.

Cửa sổ hở: đổi `EMBEDDING_MODEL_NAME` rồi **truy vấn TRƯỚC khi ingest lại lần nào**. Ingest
lại là index tự rebuild và cửa sổ đóng.

**Tái hiện (chạy được, không cần model thật):**

```python
idx = faiss.IndexFlatIP(384); idx.add(np.random.rand(5, 384).astype('float32'))
faiss.read_index(path).search(np.random.rand(1, 1024).astype('float32'), 3)
# AssertionError :          <- message RỖNG
```

**Vì sao nặng hơn vẻ ngoài:** cả hai chỗ search trong `hybrid.py` đều bắt rồi log
`logger.warning("... legacy FAISS search failed: %s", exc)`. `exc` không có message, nên
dòng log ra cụt ngủn — và chỗ thứ nhất tiếp tục chạy với `faiss_ids` rỗng (truy hồi tụt về
**BM25-only**), chỗ thứ hai `return []`. Người dùng vẫn nhận được câu trả lời, dựng từ nửa
số nguồn, không có dấu hiệu gì. Đúng lớp "hỏng mà không kêu".

- **Bất đối xứng giữa hai anh em** — hình dạng lỗi lặp lại của dự án này. `memory/tree.py`
  làm ĐÚNG: `_tree_matches_current_embedding()` so cả `embedding_model_name` lẫn
  `embedding_dim`, in `Drop legacy tree for <stem>: model=… dim=… != current …`, và
  `_rebuild_memory_index` đếm `skipped_mismatched`. Module anh em không có gì.
- **`__meta__["embedding_dim"]` ghi 6 lần, đọc 0 lần** (`store.py` 410/481/663/882).
  Metadata có sẵn từ lâu, chưa ai dùng.
- **Fix:** guard trong `hybrid._load_faiss_index(expected_dim=...)`, ném `ValueError` nêu
  CẢ HAI số chiều + tên model + cách dựng lại. Đặt ở đó vì cả hai đường search đi qua nó,
  và nó có cache theo `(mtime_ns, size)` nên guard chạy một lần mỗi khi index đổi, KHÔNG
  phải mỗi query. `expected_dim` lấy từ `qv.shape[1]` — không phụ thuộc metadata có đúng
  hay không.
- **Tham số tuỳ chọn, không bắt buộc:** caller cũ không truyền gì thì hành vi y hệt.
- **Regression:** `tests/test_retrieval_dim_guard.py` (5 test). Trong đó có một test khoá
  lại chính LÝ DO guard tồn tại — `AssertionError` của faiss phải rỗng; faiss đổi hành vi
  thì test đỏ và bắt đọc lại lời giải thích.
- **Prevention:** metadata ghi ra mà không ai đọc là mã chết trá hình. `grep` chiều ghi
  và chiều đọc của mọi khoá `__meta__` trước khi thêm khoá mới.

**Bẫy Windows gặp lúc viết test:** đặt tên test có dấu tiếng Việt (`test_lech_dim_thi_ném…`)
làm `tmp_path` của pytest chứa ký tự non-ASCII, và `faiss.write_index` không mở được file
đó: `could not open ... for writing: No such file or directory`. Tên hàm test giữ ASCII;
docstring thì thoải mái.

---

## (ĐÃ SỬA 2026-08-28) Job chấm tự luận đứng im 20% tới khi xong

Vòng 2 đo và kết luận: tiêu chí "khoảng im ĐẦU TIÊN > 5 giây" không job nào vi phạm — mọi
job báo mốc đầu ngay lúc bắt đầu. Còn lại là biến thể nhẹ hơn: **thanh đứng yên giữa
chừng**. Bốn chỗ:

| job | cửa sổ đứng im | trong đó chạy gì | tổng thật |
|---|---|---|---|
| `short_answer_grading` | 20% → 100% | 1 LLM mỗi câu tự luận | — |
| `quiz_generation` | 30% → 70% | `generate_questions` + retry | 43–70s |
| `study_map_generation` | 75% → 85% | `pipeline.relations()` | 106s / job 487–633s |
| `ingest` | trong `BuildMemoryTree` | 1 LLM mỗi section | job tới 410s |

**Chỉ sửa MỘT.** `short_answer_grading` được chọn vì người học đang NGỒI CHỜ màn hình điểm
(khác `ingest` chạy nền), và vòng lặp theo câu hỏi đã có sẵn nên diff nhỏ nhất.

- **Fix:** `grade_attempt(..., progress_cb=...)` kêu **TRƯỚC** mỗi lời gọi LLM. Đặt sau thì
  dòng đầu chỉ xuất hiện khi câu đầu đã chấm xong — đúng lỗi đã mắc ở summary 2026-08-27.
- **Mẫu số chỉ đếm câu TỰ LUẬN.** Trắc nghiệm chấm bằng so chuỗi, xong tức thì; đưa vào
  mẫu số thì thanh nhảy vọt rồi đứng im — mô tả sai chỗ thời gian thật sự trôi.
- **`study_map` Relations chỉ đổi NHÃN**, không chia nhỏ: `pipeline.relations()` là MỘT lời
  gọi LLM đơn. Nhãn giờ là `Đang tìm quan hệ giữa {n} khái niệm...`. Chia nhỏ một lời gọi
  LLM để thanh chạy mượt là làm đẹp bằng cách làm chậm.
- **KHÔNG làm `ingest`:** chạy nền, không ai ngồi nhìn.
- **Regression:** `tests/test_grading_progress.py` (5 test). Test chính đo **số mốc progress
  đã kêu TẠI THỜI ĐIỂM lời gọi LLM đầu tiên bắt đầu**, không đếm tổng lúc xong — tổng vẫn
  đúng ngay cả khi dồn hết về cuối.

---

## (ĐÃ SỬA 2026-08-28) `.gitattributes`: line-ending trộn đã đẻ ra một kết luận sai

Kho không có `.gitattributes`, `core.autocrlf=true`, nên git tự đoán file nào là text.
Kết quả: `.claude/rules/*.mdc` là CRLF còn `.cursor/rules/*.mdc` là LF **dù nội dung y hệt**.

Hậu quả thật, không phải giả định: `cmp` báo cả 7 cặp "khác nội dung", tao viết kết luận đó
vào plan vòng 2 và vào `README.md`. Phải đính chính cả hai. `diff --strip-trailing-cr` ra
0 dòng khác.

- **Fix:** `.gitattributes` với `* text=auto`, đánh dấu `binary` cho docx/faiss/pkl/ảnh, và
  `-diff` cho `FE/package-lock.json`.
- **CỐ Ý không chạy `git add --renormalize .`:** nó đụng ~470 file và tạo một diff che mất
  mọi thay đổi mã khác. Từng file tự chuẩn hoá khi có người sửa nó.
- **Prevention:** khi hai file "giống hệt mà công cụ báo khác", nghi line-ending TRƯỚC khi
  nghi nội dung. `diff --strip-trailing-cr` là câu hỏi đúng.

## (ĐÃ SỬA 2026-08-28) Audit vòng 2 — file cấu hình trùng tên nhưng nói khác nhau

Ba cặp file "trùng" mà mỗi cặp có một bản THẮNG và một bản NÓI DỐI. Không phải rác — là
bẫy, vì người đọc bản thua tin rằng mình đang chỉnh thứ có hiệu lực.

### 1. `requirements.txt` ở gốc vs `BE/requirements.txt`

Gốc 64 dòng KHÔNG pin gì (`langchain`, `langgraph`); BE pin `langchain>=0.3.27,<0.4`,
`langgraph>=0.2.57,<0.3` kèm lý do: langgraph 1.x kéo `ormsgpack`, binary đó bị Windows
Application Control chặn.

- **Hậu quả:** `pip install -r requirements.txt` ở thư mục gốc cài đúng bản đang cấm.
  CI chưa dính vì `.github/workflows/ci.yml:32` ưu tiên `BE/requirements.txt`; người mới
  clone thì dính.
- **Fix:** file gốc còn ĐÚNG MỘT dòng `-r BE/requirements.txt` + comment nêu lý do.

### 2. `.env.example` gốc vs `BE/.env.example`

**Chỉnh lại phán đoán ban đầu:** lúc quét tao đếm "12 khoá khác giá trị" rồi kết luận cả
12 đều là lỗi. Đọc kỹ thì 11/12 là CỐ Ý — hai file là hai HỒ SƠ khác nhau, không phải hai
bản sao: gốc = docker/prod (docker-compose thay thế 102 chỗ `${VAR}` từ đó, nên
`OLLAMA_HOST=host.docker.internal`, `REDIS_URL=redis://redis:6379/0`, `QUEUE_ENABLED=true`
đều đúng), BE = dev trên máy.

Chỉ MỘT khoá là lỗi thật, và nó đúng là khoá đã hành dự án hai lần:

```
SLM_MODEL   gốc: qwen2.5:7b-instruct   BE: qwen3.5:9b   <- BE THẮNG, 6.59 GB / card 6.14 GiB
```

Nguyên nhân gốc tìm ra ở đây: `BE/.env.example` **lặp key `SLM_MODEL` hai lần**, dòng thứ
hai chú thích "Alias backward-compatible" — người viết định đặt `SLM_MODEL_CHAT` nhưng gõ
lại `SLM_MODEL`. Vì vậy `SLM_MODEL_CHAT` KHÔNG BAO GIỜ có trong `BE/.env.example`, kéo
theo không có trong `BE/.env`, nên giá trị an toàn chỉ tồn tại ở `.env` gốc — file ưu tiên
THẤP hơn. Đây là toàn bộ cơ chế của "biến an toàn nằm ở file thua" mà vòng 1 phát hiện.

- **Fix:** `BE/.env` và `BE/.env.example` đặt `SLM_MODEL_CHAT=qwen2.5:7b-instruct` và
  `SLM_MODEL=qwen2.5:7b-instruct` (hết lặp key). Cả hai file example thêm khối đầu nói rõ
  **hai hồ sơ, và BE/.env thắng khi trùng khoá**.
- **Prevention:** khác giá trị giữa hai file KHÔNG mặc nhiên là lỗi. Phân loại theo HỒ SƠ
  trước; chỉ khoá nào cùng hồ sơ mà lệch mới là lỗi.

### 3. `frontend-design/SKILL.md` có hai bản y hệt (cùng md5)

`.claude/rules/frontend-design/` và `.claude/rules/skills/frontend-design/`. Cả hai được
nạp vào context mỗi phiên nên trả gấp đôi token cho cùng một nội dung. `README.md` lại ghi
vị trí chuẩn là `.agents/rules/skills/...` mà thư mục `.agents/` **rỗng**; README cũng
viện dẫn `CLAUDE.md` (không tồn tại) và `.cursor/rules/project-rules.mdc` (file đó nằm ở
`.claude/rules/`). Ba nguồn sự thật, không cái nào đúng.

- **Fix:** giữ bản trong `skills/`, xoá bản kia, viết lại README theo bố cục thật.

**Đính chính 2026-08-28 (kèm):** README cũ ghi 7 file `.mdc` trùng tên giữa `.claude/rules/`
và `.cursor/rules/` là "cả 7 đều khác nội dung". SAI — `cmp` báo khác vì **line-ending**:
`.claude/rules/*.mdc` là CRLF, `.cursor/rules/*.mdc` là LF. So bằng
`diff --strip-trailing-cr` thì cả 7 cặp ra **0 dòng khác**.

Chúng là bản sao y hệt. Bài học giống hệt lần `BASE_URL` khớp trong `DATABASE_URL`: công cụ
trả lời đúng câu hỏi mình HỎI, không phải câu hỏi mình NGHĨ. `cmp` so byte, mà byte khác
không có nghĩa nội dung khác. Chuẩn hoá trước khi so.

Chưa gộp vì mỗi công cụ đọc thư mục riêng của nó — trùng lặp ở đây là do tooling ép, không
phải do ai đó quên. Cần `.gitattributes` để hai bên hết lệch CRLF/LF.

---

## (ĐÃ SỬA 2026-08-28) Mã chết: 1460 dòng, 0 người gọi

Quét bằng một lượt đọc `git ls-files '*.py'` rồi tìm tên module/hàm không xuất hiện ở file
nào khác (bỏ `scripts/` và `alembic/versions/` — dương tính giả: entry point và revision id).

| xoá | dòng | ghi chú |
|---|---|---|
| `services/mindmap/utils.py` | 1414 | pipeline iterative-prompting CŨ, 40 `def`, 0 importer |
| `app/clients/provider_factory.py` | 19 | factory 2 hàm, 0 caller |
| `app/domains/memory/lc_memory_tree.py` | 9 | re-export "cho thống nhất roadmap" |
| `FE/src/components/ui/Button.jsx` | 18 | 0 import |
| 9 hàm chết trong file còn sống | ~70 | xem danh sách trong plan vòng 2 |
| 5 import chết ở `main.py` | 5 | `Callable`, `ask_ai`, `fcntl`, `send_from_directory`, `unicodedata` — đã chết TRƯỚC đợt này |
| 4 dep FE | — | `@heroicons/react`, `axios`, `react-icons`, `uuid` — 0 hit toàn `src/` |

Hai thứ đáng chú ý hơn phần còn lại:

- `accept_attribute()` có docstring nói "test `test_upload_formats.py` khoá chuỗi này khớp
  với FE". Test đó CÓ THẬT và vẫn chạy — nhưng nó đọc thẳng `DocumentList.jsx` rồi so với
  `SUPPORTED_EXTENSIONS`, không hề gọi hàm này. Docstring nói sai về chính người dùng nó.
- `shared/paths.py` sinh ra để gom đường dẫn về một chỗ, nhưng helper `default_data_dir()`
  0 caller: ba module (`cache/llm_cache.py:180`, `conversation/store.py:31`,
  `jobs/jobs_store.py:21`) tự viết lại `Path(os.environ.get("DATA_DIR", str(BE_ROOT)))`
  tại chỗ. Trừu tượng dựng xong rồi không ai dùng.

**Còn hở, CHƯA sửa:** `validate_vector_index_compatibility()` bị xoá vì 0 caller. Nghĩa là
**không có chỗ nào kiểm dim của FAISS index lúc load**, dù `.env` cảnh báo "đổi
EMBEDDING_MODEL_NAME thì PHẢI rebuild index". Đổi model xong query sẽ ném AssertionError
khó hiểu từ faiss thay vì một câu báo rõ ràng. Có 5+ chỗ `faiss.read_index`, nối guard vào
chỗ nào là một quyết định riêng, không phải việc của đợt dọn.

---

## (ĐÃ SỬA 2026-08-28) Default model viết cứng 12 chỗ — gom về một hằng

Vòng 1 đếm 7 chỗ. Quét lại kỹ ra **12**: `qwen2.5:14b` x8, `qwen3.5:9b` x3,
`qwen3.6:35b-a3b` x2 (`memory/tree.py:23` và `main.py:37` — cùng một dòng copy sang nhau,
và tag 35B **chưa bao giờ được pull về máy** nên gọi vào là 404, không phải chậm).

- **Fix:** `shared/config.DEFAULT_LOCAL_MODEL = "qwen2.5:7b-instruct"`, mọi chỗ tham chiếu
  hằng đó. Xác minh: bỏ hết env thì `chat/summary/mindmap/quiz` và memory tree đều ra
  `qwen2.5:7b-instruct`.
- **Regression:** `tests/test_default_model_khong_hardcode.py` — quét mã (bỏ dòng comment)
  tìm ba tên model nặng; `test_mindmap_modelcfg.py` đổi từ so chuỗi cứng sang so hằng.
- **Vì sao cần test chứ không phải comment:** `main.py:1255` ĐÃ có comment "một nguồn sự
  thật `_model_map` — hết stale default kiểu qwen3.5:9b hardcode". Comment không chặn được
  lần tái phát nào.
- **Miễn trừ có chủ ý:** `vision/transcribe.py:27` giữ `DEFAULT_MODEL="qwen3.5:9b"` — tác vụ
  đọc ảnh cần model có khả năng thị giác, không dùng chung `DEFAULT_LOCAL_MODEL` (7b-instruct
  KHÔNG có vision).

  **Đính chính 2026-08-28:** lúc đầu tao kết luận "chức năng ảnh gần như chắc chắn đang
  hỏng vì máy chưa pull model VL nào". SAI. Hỏi `/api/show` cho biết:

  ```
  qwen3.5:9b          ['completion', 'vision', 'tools', 'thinking']
  gemma4:e4b          ['completion', 'vision', 'audio', 'tools', 'thinking']
  qwen2.5:7b-instruct ['completion', 'tools']          <- không có vision
  ```

  Default đang dùng ĐÚNG là model có vision, và `is_available()` còn probe `capabilities`
  rồi fail-closed nên FE ẩn nút ảnh khi không dùng được. Không có lỗi ở đây.

  Bài học: suy ra "không có model VL" từ việc nhìn TÊN model trong `/api/tags` là đoán.
  `/api/show` trả thẳng `capabilities` — hỏi cái đó, đừng đoán theo tên.

  Còn lại đúng một điều: 6.59 GB trên card 6.14 GiB nên lượt đọc ảnh tràn xuống CPU và
  chậm. Chậm, không phải hỏng.

---

## (ĐÃ SỬA 2026-08-28) `/api/jobs/<id>/cancel` hứa suông với 3 loại job

Route nhận MỌI `job_id` và luôn trả `cancel_requested: true`. Nhưng
`grep -rn is_cancel_requested BE/app BE/services` chỉ trúng mindmap, summary, quiz,
study map. `ingest`, `query`, `short_answer_grading` không đọc cờ ở đâu cả.

Đo thật (tạo job running rồi `request_cancel`):

```
ingest                 status=running    cancel_requested=True
short_answer_grading   status=running    cancel_requested=True
query                  status=running    cancel_requested=True
summary                status=running    cancel_requested=True   <- chỉ cái này có ai ack
```

`sweep_stuck_jobs` không cứu được: nó chỉ đụng job ngừng heartbeat quá
`JOB_STUCK_AFTER_SECONDS`, mà job đang chạy vẫn `update_job` đều.

- **Chưa nổ vì:** FE chỉ gọi `cancelJob` từ hook `useStudyJob`, và hook đó chỉ dùng ở
  QuizSetup / ReviewGuide / StudyMapView — cả ba đều là loại CÓ ack. `QuizTaking` nộp bài
  xong không theo dõi job chấm. Nối nút huỷ cho ingest là kẹt "Đang huỷ…" ngay.
- **Fix:** KHÔNG dựng đường huỷ mới cho ingest (chưa ai gọi = việc suy đoán). Sửa chỗ nói
  dối: route trả **409** cho `job_type` không nằm trong `_CANCELLABLE_JOB_TYPES`, và
  **không bật cờ**. Bật cờ rồi bỏ đó chính là cách sinh ra "Đang huỷ…" kẹt.
- **Regression:** `tests/test_job_cancel_contract.py` (8 test, parametrize cả hai phía).
- **Prevention:** thêm `job_type` vào `_CANCELLABLE_JOB_TYPES` CHỈ SAU KHI executor của nó
  thật sự gọi `is_cancel_requested`.

---

## (ĐÃ SỬA 2026-08-28) Nuốt lỗi im lặng: 81 chỗ, chỉ 3 chỗ đáng sửa

`grep -rn -A1 "except Exception" | grep -c "pass$"` ra 81 (40 trong `main.py`). Phân loại
theo NỘI DUNG khối `try` thay vì sửa đồng loạt:

| nhóm | số chỗ | xử lý |
|---|---|---|
| import động (đường dự phòng thật) | 24 | giữ nguyên |
| log / telemetry / cache | 5 | giữ nguyên |
| có ghi DB/file trong khối | 12 | soi từng chỗ |
| còn lại | 36 | giữ nguyên |

Trong 12 chỗ "có ghi", chỉ 3 chỗ là vấn đề:

1. **`mindmap_graph._set_job` và `summary_graph._set_job`** — MỌI trạng thái của hai graph
   đi qua đây, kể cả `status="done"` kèm `result`. Ghi hỏng thì job không bao giờ tới done,
   FE poll tới hết TTL, không log nào giải thích. Đúng lớp lỗi known-issues 2026-07-06.
   **Fix:** in ra `set_job_failed job_id=... keys=... err=...`, KHÔNG ném (ném ở đây làm
   hỏng cả pipeline vì một lần ghi SQLite bị khoá).
2. **`store.py:469`** — `emb_dim` giữ 0 rồi ghi thẳng vào `__meta__`. Đọc lại không phân
   biệt được "chưa đo" với "model 0 chiều". **Fix:** in cảnh báo.

Chỗ thứ ba (`store.py:143`, `_save_meta` lúc migrate `__meta__`) fail-open là **đúng** —
dict trong bộ nhớ đã có `__meta__`, lần load sau thử lại, không mất dữ liệu. Đã thêm
comment `ponytail:` nói rõ để lần sau không ai "sửa" nó.

**Prevention:** đừng sửa gộp cả 81 chỗ. Fail-open quanh log/cache/import là thiết kế đúng;
sửa mù là cách nhanh nhất tạo sự cố tiếp theo.

## (ĐÃ SỬA 2026-08-28) Memory tree — bản sao THỨ BA của lỗi song song không kẹp theo cổng LLM

Tìm ra khi soạn kế hoạch audit toàn dự án, quét theo LỚP LỖI chứ không theo thư mục.
Sau `mindmap_factory._enrich_parallel` (2026-08-26) và `summary_factory._parallel`
(2026-08-27), chỗ thứ ba là `BE/app/domains/memory/tree.py:481`:

```python
max_workers = min(4, int(os.environ.get("MAX_SUMMARIZE_WORKERS", "3")))
with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
    for result in executor.map(_summarize_section, section_raw_data):
```

`_summarize_section` gọi `_llm_summarize_for_memory`, tức 3 lời gọi LLM song song đâm vào
`MAX_CONCURRENT_LLM_CALLS=1`. Hai luồng sau xếp hàng, chờ quá
`LLM_QUEUE_WAIT_TIMEOUT_SECONDS=180` thì ném `LLM busy (in-process): all 1 slots in use`.

- **Root cause:** giống hệt hai lần trước — số worker đoán từ một biến env riêng thay vì
  hỏi tầng đang giới hạn thật sự (cổng LLM in-process).
- **Vì sao NẶNG hơn hai lần trước:** `executor.map` ném lại lỗi lúc duyệt kết quả, không
  bắt riêng từng worker. `ingest_graph.BuildMemoryTree` bắt exception rồi đánh dấu CẢ tài
  liệu `memory_tree_failed` + `memory_query: False`, và để lại cây dở dang
  `status="building"` trong `memory_trees.json`. Summary chỉ mất một mục; đây mất cả cây.
- **Tái hiện rẻ:** hạ `LLM_QUEUE_WAIT_TIMEOUT_SECONDS` xuống 5 — 2/3 worker chết trong 40
  giây thay vì phải chờ 180s. Cùng mẹo đã dùng cho summary.
- **Fix:** hàm public `so_worker_tom_tat()` kẹp `min(4, MAX_SUMMARIZE_WORKERS, inproc_slots())`,
  sàn 1. Public để test gọi thẳng, không phải dựng cả pipeline ingest.
- **Hệ quả chấp nhận:** cổng đang là 1 slot nên cây ký ức giờ dựng TUẦN TỰ — chậm hơn,
  nhưng trước đó không phải nhanh hơn mà là hỏng.
- **Regression:** `BE/tests/test_memory_tree_parallel.py` (4 test: kẹp theo cổng, tôn trọng
  cổng rộng, giữ trần cứng 4, sàn 1).
- **Prevention:** mọi `max_workers=` mới trong `BE/app`, `BE/services`, `BE/shared` mà hàm
  worker có gọi `ask_ai` PHẢI lấy trần từ `llm_factory.inproc_slots()`. Quét bằng
  `grep -rn "max_workers=" BE/app BE/services BE/shared --include=*.py | grep -v test`.

## (ĐÃ SỬA 2026-08-28) Quiz / attempt / progress cũng vỡ ở chế độ mở — cùng bẫy `str(None)`

Phần còn lại của mục Study Map ngay dưới. Quét cả `BE/app` tìm `str(user_id)` rồi GỌI THẬT
từng hàm với `None` (không đọc mã suy đoán) — 6 chỗ vỡ, tất cả cùng một thông báo
`invalid input syntax for type uuid: "None"`:

| file:dòng | kiểu | hàm | hậu quả |
|---|---|---|---|
| `quiz/repository.py:25` | GHI | `create_quiz` | job tạo quiz chết |
| `attempts/repository.py:45` | GHI | `open_attempt` | mở quiz để làm bài chết |
| `attempts/repository.py:33` | LỌC | `open_attempt` | cùng hàm, vỡ trước dòng 45 |
| `progress/service.py:73,76,82,88,93` | LỌC | `overview` | `/api/progress/overview` 500 |
| `progress/service.py:124` | LỌC | `concept_progress` | `/api/progress/concepts` 500 |
| `progress/service.py:170` | LỌC | `attempt_history` | `/api/progress/attempts` 500 |
| `progress/service.py:198` | LỌC | `latest_graded_attempt` | so mastery trước/sau chết |

**Không dính:** `review/service.py:223` và `gap_analysis/service.py:129` lấy user_id từ
hàng DB đã có (`attempt.user_id`, `row.user_id`) nên không bao giờ None.
`documents`, `quiz.list_by_document`, `attempts.list_by_quiz`, `studymap.list_by_document`
đều đã có sẵn `if user_id is not None`.

**Fix — ba loại, KHÔNG sửa đồng loạt.** Codebase có sẵn hai quy ước cho uid None, chọn sai
là rò dữ liệu:

- *Loại A — GHI vào cột NOT NULL uuid:* quy về user ẩn danh (`ensure_anonymous_user()`).
  `quiz.create_quiz`, `attempts.open_attempt`. Riêng `open_attempt` giải MỘT lần rồi dùng
  cho cả truy vấn tra attempt đang mở lẫn hàng ghi — hai chỗ hai giá trị thì mỗi lần F5
  đẻ một attempt mới.
- *Loại B — LỌC đã có phạm vi tài liệu:* bỏ lọc chủ sở hữu (quy ước `list_by_document`).
  Đã dùng cho `studymap.latest_completed`.
- *Loại C — LỌC theo TÀI KHOẢN, không phạm vi nào khác:* quy None về user ẩn danh rồi lọc
  theo đó (`progress._chu_so_huu`). **Bê loại B sang đây là rò dữ liệu** —
  `/api/progress/overview` sẽ trả gộp số liệu của cả 12 user trong DB cho một người gọi
  ẩn danh. Đo trước khi sửa: 12 tài liệu trong DB; sau khi sửa đúng: `document_count: 0`.

**Regression:** `test_practice_and_progress.py::test_che_do_mo_chay_het_chuoi_quiz_attempt_progress`
(chạy nguyên chuỗi upload → quiz → attempt → review plan → 3 endpoint progress với uid None)
và `::test_che_do_mo_khong_thay_du_lieu_cua_user_dang_nhap` (chốt đúng điểm loại C: dựng cả
một bộ dữ liệu cho user CÓ đăng nhập rồi khẳng định overview ẩn danh KHÔNG đổi). 14 passed.

Khẳng định trong hai test đó là **độ lệch so với mốc đo**, không phải số tuyệt đối: user ẩn
danh dùng chung giữa các test và `pytest-randomly` đổi thứ tự chạy mỗi lần.

## (ĐÃ SỬA 2026-08-27) Study Map vỡ HOÀN TOÀN ở chế độ mở — `str(None)` thành chuỗi `"None"`

- **Triệu chứng:** `AUTH_PROTECT_APP_APIS` tắt (chế độ mở, `_require_app_user` trả
  `(None, None)`) thì `/api/study-maps/generate` **500 ngay**, hoặc job chết với nguyên
  văn lỗi psycopg lọt ra tận UI:
  `(psycopg.errors.InvalidTextRepresentation) invalid input syntax for type uuid: "None"`
- **Root cause:** `knowledge_maps.user_id` là `NOT NULL uuid` (`fk()` mặc định
  `nullable=False`). Hai chỗ ép thẳng `str(user_id)`, mà `str(None)` ra CHUỖI `"None"` —
  không phải NULL, nên Postgres không báo "thiếu giá trị" mà báo "uuid sai cú pháp":
  1. `studymap/repository.latest_completed` — chạy TRONG route (`if not force:` tra cache),
     nên đây là chỗ vỡ TRƯỚC, job còn chưa kịp tạo.
  2. `studymap/repository.create_map` — chỗ vỡ thứ hai, job chết sau ~25s.
  `documents/repository.create` đã quy `user_id=None` về user ẩn danh
  (`ensure_anonymous_user()`) từ Phase 2; studymap không làm theo.
- **Fix:** `create_map` quy None về user ẩn danh (cột NOT NULL nên phải có uuid thật);
  `latest_completed` KHÔNG lọc theo chủ sở hữu khi `user_id is None` — đúng quy ước
  `list_by_document` vốn đã có sẵn ngay trong cùng file đó.
- **Vì sao 8 test cũ không bắt được:** cả 8 đều gọi `_protect(be, monkeypatch, owner)`,
  tức chỉ chạy nhánh CÓ đăng nhập. Nhánh `_require_app_user` trả None chưa test bao giờ.
- **Regression:** `test_studymap_generate.py::test_che_do_mo_van_tao_duoc_map` và
  `::test_che_do_mo_van_dung_cache_va_force` (10 passed).
- **Cùng lỗi, CHƯA sửa (ngoài phạm vi lần này, cùng chuỗi màn hình):**
  `quiz/repository.py:25` (`create_quiz`) và `attempts/repository.py:33,45`
  (`open_attempt`) cũng ép `str(user_id)` trên uid có thể None. Chế độ mở đi qua được
  Study Map rồi vẫn chết ở màn tạo quiz. Cách sửa y hệt.
- **Prevention:** cột `NOT NULL uuid` + `str()` là cái bẫy im lặng — `str(None)` KHÔNG
  thành NULL. Chỗ nào nhận uid từ `_require_app_user()` thì phải xử lý None tường minh,
  vì hàm đó trả None là hành vi ĐÚNG theo tài liệu, không phải lỗi.

## (KHÔNG PHẢI LỖI 2026-08-27) Study Map chạy 487 giây — GPU đang bị game chiếm

Đo trên `Day08- RAG Pipeline.docx` (18 chunk): job `done`, 19 node, 7 cạnh, 37 chunk link,
**487,3 giây**. Cùng tài liệu đó chạy mindmap hôm 26 chỉ mất 833s cho 20 node, và tóm tắt
mất 60,9s — nên 487s cho một job 3 nhánh là chậm bất thường.

Nguyên nhân không nằm trong mã. `curl /api/ps` lúc đó:

```
qwen2.5:7b-instruct 5.12 GB, vram 0.19
```

Model 7b (vốn vừa VRAM) chỉ được cấp **0,19 GB VRAM** — phần còn lại chạy CPU.
`nvidia-smi` cho thấy 5378/6141 MiB đã bị chiếm và tiến trình
`TheIsleClient-Win64-Shipping.exe` (game trên Steam) đang giữ GPU ở 100%.

Trước khi kết luận "pipeline chậm", kiểm tra `nvidia-smi --query-compute-apps` và
`curl -s localhost:11434/api/ps`. `size_vram` thấp hơn `size` nhiều = model đang chạy CPU,
và không có bản vá mã nguồn nào chữa được điều đó.

## (ĐÃ SỬA 2026-08-27) Tóm tắt chậm gấp 4 và im lặng 82 giây — cùng bộ lỗi đã sửa cho mindmap

- **Triệu chứng:** tạo tóm tắt tài liệu 18 chunk mất **241,6 giây**; chip tiến trình đứng
  im ở 30% suốt **82,5 giây đầu** rồi mới nhích. Không có lỗi nào, `missing=[]`, bản tóm
  tắt vẫn đúng — nên không ai gọi đây là bug, chỉ thấy "nó chậm".
- **Root cause (3 cái, độc lập):**
  1. `BE/.env` để `SLM_MODEL_SUMMARY=qwen2.5:14b`. Model nặng 9,95 GB, card 6 GiB → Ollama
     chỉ nhét 4,07 GB vào VRAM, phần còn lại chạy CPU, tụt còn ~2,6 tok/s. Root `.env` đã
     là `qwen2.5:7b-instruct`, nhưng `shared/env_loader.load_project_env` nạp `BE/.env`
     TRƯỚC với `override=False` nên BE/.env thắng. **Đúng y hệt lỗi mindmap ngày 2026-08-26.**
  2. `summarize_sections` chỉ gọi `progress_cb` BÊN TRONG vòng `as_completed` — dòng
     progress đầu tiên chỉ đến khi một mục CHẠY XONG.
  3. `summary_factory.summarize` truyền `max_workers=int(os.getenv("SUMMARY_PARALLEL","2"))`
     mà không kẹp theo cổng LLM in-process (`MAX_CONCURRENT_LLM_CALLS=1`). Mục thứ hai
     không chạy song song mà xếp hàng; chờ quá `LLM_QUEUE_WAIT_TIMEOUT_SECONDS` (180s) thì
     ném "LLM busy (in-process)". **Trên tài liệu 18 chunk lỗi này KHÔNG nổ** (mục đầu chỉ
     mất 82s < 180s) — nó là bom hẹn giờ theo kích thước tài liệu.
     Tái hiện được cơ chế mà không cần tài liệu to: hạ `LLM_QUEUE_WAIT_TIMEOUT_SECONDS`
     xuống 5s rồi chạy cùng 3 mục đó —
     `max_workers=2` → 2/3 mục chết (`LLM busy (in-process): all 1 slots in use, waited
     5.0s`), job "xong" sau **14,7s** với bản tóm tắt thiếu 2 mục;
     `max_workers=1` (đã kẹp) → 35,5s, `missing=[]`. Job nhanh hơn ở đây là job HỎNG.
     Hệ quả phụ cùng gốc: `budget = timeout_sec * ceil(n/max_workers) + 15` tính theo số
     worker DANH NGHĨA. Với 3 mục, `max_workers=2` cho budget 615s trong khi thực tế chạy
     tuần tự cần tới 3×300 = 900s → mục cuối có thể degraded dù chưa hề vượt timeout riêng.
- **Fix:** (1) `SLM_MODEL_SUMMARY=qwen2.5:7b-instruct` trong `BE/.env` + `BE/.env.example`,
  kèm comment nói rõ vì sao không phải 14b. (2) `progress_cb` gọi TRƯỚC `ctx_submit`.
  (3) `LocalSummaryPipeline._parallel()` lấy trần từ `llm_factory.inproc_slots()` — cùng
  cách đã dùng cho `mindmap_factory._enrich_parallel`.
- **Đo lại (cùng tài liệu `day08-_rag_pipeline_docx`, 18 chunk, 3 mục):**

  |                   | trước  | sau   |
  |-------------------|--------|-------|
  | tổng              | 241,6s | 60,9s |
  | riêng summarize   | 211,1s | 51,8s |
  | riêng synthesize  | 30,5s  | 9,1s  |
  | progress đầu tiên | 82,5s  | 0,03s |
  | mục degraded      | 0      | 0     |
  | overview          | 335 ký tự | 581 ký tự |

  7b không hề tóm tắt tệ hơn 14b ở đây — chunk_refs mục 3 tăng 7→13, entities 8→10.
- **Regression:** `tests/test_summary_factory.py` (3 test kẹp song song),
  `tests/test_summary_summarize.py::test_bao_progress_TRUOC_khi_muc_dau_chay_xong` (đếm số
  lần progress ĐÃ kêu tại thời điểm lời gọi LLM đầu tiên, không đếm tổng lúc xong).
- **Prevention:** đừng để hai biến env phải khớp tay nhau — lấy trần từ chính cái cổng.
  Và khi sửa một pipeline, grep pipeline anh em ngay: `summarize.py` vốn ghi rõ trong
  docstring là "clone shape enrich.py", nên nó clone luôn cả ba lỗi.

## (2026-08-27) Bật `SUMMARY_FACTS` làm study mode TỆ HƠN trên qwen2.5:7b — đừng bật

Có hai vấn đề tách bạch ở đây.

**(a) Đã sửa — cờ không nằm trong khoá cache.** `content_hash` gồm `PIPELINE_VERSION`,
`length_mode`, `mode`, cờ `coverage`, nhưng KHÔNG gồm cờ `facts`. Phase 5 đã chặn đúng lỗi
này cho `coverage` mà không ai làm cho `facts`. Hậu quả: bật `SUMMARY_FACTS=1` lên thì bản
đã cache lúc cờ tắt vẫn khớp hash và được trả về — `mode=study` âm thầm rơi về fallback
key_points, không có dấu hiệu gì. Đã thêm tham số `facts` vào `content_hash`; cả
`main._summary_input_and_hash` LẪN `summary_graph.collect_node` đều mirror (bài học Phase 5:
thiếu một trong hai là cache lệch).

**(b) CHƯA sửa và không định sửa — cờ vẫn nên để TẮT.** Đo thật trên
`day08-_rag_pipeline_docx` với `qwen2.5:7b-instruct`:

|                        | FACTS=0 | FACTS=1 |
|------------------------|---------|---------|
| thời gian summarize    | 40,7s   | 59,0s   |
| mục trả được facts     | 0/3     | **1/3** |
| study.key_concepts     | 13      | 7       |
| study.self_check       | 10      | 7       |
| definitions/formulas/examples/common_mistakes | 0 | 0 |

7b không kham nổi JSON 7 khoá facts — 2/3 mục trả về không có facts, và study block dựng từ
đó NGHÈO HƠN đường fallback key_points. Chậm hơn 45% để nhận kết quả tệ hơn.

Ghi chú cho người đọc sau: 4 mục `definitions/formulas/examples/common_mistakes` trong
modal tóm tắt hiện đang LUÔN rỗng ở chế độ study. Đó là hệ quả của cờ tắt, không phải lỗi
render. Muốn lấp thì cần model mạnh hơn cho riêng bước này, không phải bật cờ lên.

## (ĐÃ SỬA 2026-08-21) `QUERY_GRAPH chưa khởi tạo` — site-packages global trôi khỏi MỌI pin

- **Triệu chứng:** `/health` trả `query_graph_ready: false` +
  `ModuleNotFoundError("No module named 'langchain_core.pydantic_v1')`. Ingest và toàn bộ
  StudyMap chạy bình thường, riêng `/query` (chat) chết. FE hiện "QUERY_GRAPH chưa khởi tạo".
- **Root cause:** Python global không còn khớp `requirements.txt` ở BẤT KỲ dòng nào —
  langchain 0.2.17 (pin >=0.3.27), langchain-core 1.4.8 (pin <0.4), langchain-community
  0.2.19, langchain-text-splitters 0.2.4, langgraph 1.0.1 (pin <0.3), pydantic 2.12.5
  (pin <2.11). langchain 0.2.x gọi `langchain_core.pydantic_v1`, thứ langchain-core 1.x
  đã bỏ. Đây chính là mục "Global python site-packages trôi khỏi requirements.txt pin"
  bên dưới, lần này đủ nặng để làm chết một pipeline.
- **Fix:** venv riêng `BE/.venv` + `pip install -r requirements.txt`. KHÔNG cài đè lên
  Python global: hạ langgraph 1.x xuống 0.2.x ở phạm vi máy sẽ đụng mọi project khác, và
  langgraph 1.x kéo ormsgpack vốn bị Windows Application Control chặn.
  Chạy BE: `BE/.venv/Scripts/python.exe -m app.main`.
- **Prevention:** `/health` đã phơi `query_graph_error` — nhưng không ai đọc /health trước
  khi kết luận "chat hỏng". Kiểm tra /health TRƯỚC khi đọc log. Và đừng chạy BE bằng Python
  global nữa; global sẽ trôi tiếp.

## (KHÔNG PHẢI LỖI 2026-08-21) `/query-stream/<job_id>` trả 401 khi bật AUTH_PROTECT_APP_APIS

`EventSource` của trình duyệt KHÔNG gửi được header `Authorization` — đây là giới hạn của
Web API, không phải bug. Nên khi bật bảo vệ app API, SSE luôn 401.

FE đã xử lý: `es.onerror` gắn cờ `sseConnectionLost`, `shouldPollFallback` cho qua, rồi
`pollQueryStatus` gọi `/query-status` qua `apiFetch` (có Bearer). Có comment "Phase F.1"
tại `ChatArea.jsx`. Thấy 401 này trong Network tab thì BỎ QUA — chữa nó (nhét token vào
query string) là tự tạo lỗ hổng rò token qua log server.

## (KHÔNG PHẢI LỖI 2026-08-21) Study map 44 node nhưng `knowledge_edges` chỉ có 2 hàng

Đọc `edges: 2` rồi kết luận "bước Relations rớt cạnh" là SAI. Cây cha-con nằm ở cột
`knowledge_nodes.parent_node_id`, KHÔNG nằm ở `knowledge_edges`. Đo thật trên map
686f8481: 43/44 node có `parent_node_id` (chỉ root không có), phân tầng 1 root → 6 section
→ 27 concept → 10 example. `knowledge_edges` chỉ giữ liên kết NGANG (ngoài cây) — 2 cạnh
đó đều là quan hệ thật.

Muốn biết graph có đầy đủ không thì đếm `parent_node_id`, đừng đếm `knowledge_edges`.

## (2026-08-21) `PATCH /api/attempts/<id>/answers` nuốt im lặng khoá lạ

Route nhận `answers` dạng list và đọc `a.get("user_answer")`. Gửi nhầm tên trường (ví dụ
`answer_text`) thì mọi đáp án lưu thành `None`, route vẫn trả **200**, bài chấm ra 0 điểm
và không có lỗi nào ở đâu cả. Mất hai vòng thử ~5 phút mới tìm ra khi viết script seed.

CHƯA SỬA. Hướng sửa: dict item không có khoá `user_answer` thì trả 400 kèm tên khoá lạ,
thay vì mặc định None.


## (ĐÃ SỬA 2026-08-21) Smoke end-to-end với LLM thật — 3 lỗi mà 696 unit test không bắt được

Chạy đúng kịch bản demo PRD mục 19 (upload tài liệu Toán → quiz 10 câu → làm sai phần
"quy tắc hàm hợp" → báo yếu → chỉ về mục 2.3 → luyện 5 câu) trên **Ollama thật + bge-m3
thật + Postgres thật**. Toàn bộ unit test đều dùng LLM giả nên cả ba lỗi dưới đây lọt lưới.

### 1. `/api/documents/*` trả status NGOÀI tập đặc tả

- **Triệu chứng:** ingest xong hoàn toàn (4 chunk, progress 1.0) nhưng
  `GET /api/documents/{id}` trả `status="ready"`. Client chờ `completed` theo đúng tài
  liệu thì chờ vĩnh viễn — smoke treo 600s rồi bỏ cuộc.
- **Root cause:** `repository._row()` trả trạng thái PIPELINE (`processing/index_ready/
  ready/error`) ở khoá `status` để call site cũ (`/list-indexed`, `/sources/<id>/status`)
  không phải sửa. API mới `/api/documents/*` dùng lại nguyên dict đó, nên nó phát ra
  `ready` — giá trị không có trong `uploaded|processing|completed|failed|deleted` (đặc tả
  3.2.4 / 8.3). Cột DB thì vẫn đúng.
- **Fix:** `_row()` thêm khoá `spec_status` (cột `documents.status`); `_doc_public()` trả
  `status = spec_status` và đưa trạng thái pipeline sang `ingest_status`. Route cũ không đổi.
- **Prevention:** API mới KHÔNG được tái dùng nguyên dict của tầng cũ chỉ vì tiện — hai
  API có hai hợp đồng khác nhau. Test `test_documents_api.py` giờ khẳng định `status` luôn
  nằm trong tập đặc tả, không chỉ khẳng định nó "không rỗng".

### 2. Lỗi provider LLM đầu tiên bị nuốt, báo nhầm hoàn toàn

- **Triệu chứng:** tạo quiz hỏng với thông báo `All AI providers failed (tried ['ollama',
  'gemini']): 401 ... ACCESS_TOKEN_TYPE_UNSUPPORTED`. Đọc xong đi kiểm tra key Gemini —
  sai hướng. Nguyên nhân thật là **Ollama timeout** (model 14B sinh 10 câu vượt 180s mặc
  định của `QUIZ_LLM_TIMEOUT_SEC`), rồi mới rơi sang Gemini vốn không có key hợp lệ.
- **Root cause:** vòng fallback trong `ask_ai` chỉ giữ `last_error`, nên lỗi của provider
  ĐẦU biến mất hoàn toàn khỏi thông báo lẫn log.
- **Fix:** log từng provider ngay khi nó hỏng (kèm `feature` + `model`) và gộp TẤT CẢ lỗi
  vào exception cuối.
- **Prevention:** chuỗi fallback nào cũng phải báo cáo mọi mắt xích. "Thông báo lỗi cuối"
  của một chuỗi fallback gần như luôn là mắt xích ÍT liên quan nhất tới nguyên nhân thật.

### 3. So sánh trước/sau luyện tập im lặng không đo được (FR-11.10)

- **Triệu chứng:** làm bài luyện đúng 100% mà màn hình tiến bộ hiện
  `hàm hợp: 0.0 -> None (delta None)` — tức "chưa đo". Tiêu chí MVP #10 và #12 hỏng.
- **Root cause:** `concept_tags` do LLM tự đặt. Bài chẩn đoán ra tag `"hàm hợp"`, bài
  luyện sinh sau đó ra `"quy tắc hàm hợp"`. `compare_masteries` lọc theo topic của review
  item nên hai bên không bao giờ khớp. Không có ngoại lệ nào được ném — chỉ là số liệu rỗng.
- **Fix:** khi sinh practice quiz, **rule ép** tag chủ đề của review item vào mọi câu hỏi
  (`config["practice_topic"]`). Chủ đề đã biết chắc từ review item, không có lý do để model
  quyết định lại — cùng nguyên tắc "rule quyết định liên kết, LLM chỉ viết lời" ở Phase 6.
- **Regression:** `test_practice_and_progress.py::test_practice_tags_are_forced_to_the_
  review_topic` — LLM giả cố tình trả tag `"ten khac hoan toan"`, test khẳng định tag chủ
  đề bị ép vào đầu VÀ comparison có số ở cả hai phía.
- **Prevention:** hai phía của một phép so sánh không được lấy khoá từ hai nguồn tự do
  khác nhau. Và **kiểm tra im lặng là kiểm tra vô dụng**: script smoke ban đầu vẫn in
  "SMOKE PASS" trong khi cột "sau" toàn rỗng — giờ nó fail nếu mọi `delta` đều None.

### Số liệu đo được (Ollama qwen2.5:7b-instruct, máy local)

| Bước | Thời gian | Kết quả |
| --- | --- | --- |
| Ingest (chunk + bge-m3 + FAISS + memory tree) | ~70s | 4 chunk, 6 section đúng cây |
| Tạo quiz 10 câu | ~55s | 10/10 giữ, 0 câu bị FR-13 loại, 1 lần gọi model |
| Chấm 10 câu trắc nghiệm | <1s | đúng 8, sai 2 |
| Review plan | ~11s | chỉ đúng "mục 2.3 Quy tắc hàm hợp" |
| Tạo 5 câu luyện | ~42s | 5/5 giữ, 0 loại |

Phát hiện chất lượng còn để mở: tài liệu 1300 ký tự chỉ chia được **4 chunk**, nên
`/api/search` với truy vấn "quy tắc đạo hàm hàm hợp" trả top-1 là đoạn Chương 1 (không
chứa "hàm hợp"). Chunk quá thô làm truy hồi kém — chưa sửa, cần đo thêm trên tài liệu dài.


## (ĐÃ SỬA 2026-07-17) Huỷ tóm tắt kẹt "Đang huỷ… (36%)" mãi — cancel job không còn executor + FE poller không biết "interrupted"

- **Triệu chứng:** Đang tạo tóm tắt, bấm Huỷ → chip kẹt "Đang huỷ… (36%)" vĩnh viễn, %
  đứng yên, không bao giờ thoát trạng thái huỷ. (Huỷ khi executor còn sống hoạt động đúng —
  đã chứng minh bằng repro graph thật.)
- **Root cause (2 tầng, đo bằng repro trực tiếp):**
  1. BE: `jobs_store.request_cancel` CHỈ set cờ `cancel_requested=1` và trông chờ executor
     đang sống ack giữa các node. Job KHÔNG còn executor — `pending` trong queue, hoặc
     `interrupted` (BE restart → `mark_interrupted_jobs` đánh dấu job mồ côi, GIỮ progress 36)
     — thì không ai ack cờ → status không bao giờ terminal.
  2. FE: `jobPoller.js` chỉ coi done/error/timeout/cancelled là terminal — "interrupted"
     KHÔNG có trong tập (queryPolling.js CÓ, jobPoller quên) → poll vô hạn, label bị khoá
     "Đang huỷ…" (cancelRequestedRef) + progress đóng băng đúng như user thấy.
- **Fix:** (1) `request_cancel` chuyển THẲNG `pending`/`interrupted` → `cancelled` trong cùng
  UPDATE (running/processing giữ cooperative; terminal giữ nguyên → idempotent). Sửa MỘT chỗ
  ở store → summary LẪN mindmap cancel hưởng chung. (2) `/summary-cancel` 404 job lạ (cùng
  contract `/summary-status`), trả `status` sau cancel. (3) `summary_graph.assemble_node`
  thêm 2 cancel checkpoint: trước coverage judge (LLM dài) + trước persist — cancel đến sau
  entry-guard vẫn KHÔNG persist/done (done-with-result vẫn atomic). (4) FE `jobPoller` coi
  "interrupted" là terminal (onError, message riêng qua `messages.interrupted`).
- **Regression:** BE `test_jobs_cancel.py` (running cooperative / pending+interrupted →
  cancelled ngay / terminal idempotent), `test_summary_graph.py::test_cancel_mid_summarize_
  reaches_terminal_cancelled` + `test_cancel_during_coverage_judge_does_not_persist_or_done`,
  `test_summary_routes.py` (cancel 404 job lạ/khác type, interrupted → "cancelled", done →
  safe no-op). FE `summaryJob.test.js` (cancelled → onCancelled dừng hẳn; interrupted →
  onError, không poll vô hạn).
- **Prevention:** Cancel theo cờ cooperative PHẢI có đường terminal cho job không còn
  executor — endpoint cancel không được chỉ "ghi cờ rồi hy vọng". FE poller: tập status
  terminal phải khớp ĐỦ tập status BE có thể ghi (interrupted sinh ra ở startup-reconcile,
  không chỉ trong flow chạy bình thường); thêm status mới phía BE → rà mọi poller.
- **Tái điều tra 2026-07-17 (user báo "vẫn kẹt" SAU commit fix):** code fix ĐÚNG — nguyên nhân
  còn lại là DEPLOYMENT STALE: stack thật user mở (compose project `memvid_auth_smoke`,
  FE :3000 / BE :8080, `QUEUE_ENABLED=true` + rq-worker) build từ image 2026-07-14, TRƯỚC
  commit `0bd4624` 3 ngày. Verify trực tiếp: `docker exec <backend|rq-worker> grep
  "pending','interrupted'" jobs_store.py` → FIX_ABSENT; FE bundle không có message
  "gián đoạn trên server". Sau `docker compose -p memvid_auth_smoke --profile worker up -d
  --build backend rq-worker frontend`: smoke Playwright trên UI thật PASS — cancel lúc
  running (45%, mục 3/8) → `/summary-cancel` 200 `{ok,status:"running"}` → 8s sau
  `/summary-status` trả `cancelled`, chip thoát "Đang huỷ…", notice "Đã huỷ tạo tóm tắt.",
  `summary_active_job` localStorage cleared, không summary nào bị lưu, tạo lại ngay OK.
  RQ path đã rà: queued-rồi-worker-nhặt được entry-guard chặn (không persist), cancel_cb
  check sau MỖI section LLM call → trễ tối đa 1 call. Bẫy phụ khi rebuild: root `.env`
  KHÔNG có `COMPOSE_PROJECT_NAME` → `docker compose` trần build/chạy project `memvid_new`
  KHÁC stack user đang mở và đụng port 8080 — phải `-p memvid_auth_smoke` (hoặc set
  COMPOSE_PROJECT_NAME vào .env như .env.example).
- **Prevention (ops):** "fix rồi mà user vẫn thấy bug" → bước 1 LUÔN so runtime user mở
  với code: `docker ps` xem project/created-time, `docker exec grep <chuỗi đặc trưng fix>`
  trong container + FE bundle. Đừng đọc lại code trước khi chứng minh code đó ĐANG chạy.

## (ĐÃ SỬA 2026-07-06) Cache hit trả "Không có phản hồi." — race job done-trước-result + 4 lỗ contract

- **Triệu chứng:** Câu hỏi bị cache HIT (nhanh <1s) → FE hiện "Không có phản hồi." dù Redis
  có answer đầy đủ; câu MISS (chậm 30s+) trả lời bình thường. User thấy: "noi dung la gi"
  OK nhưng "nội dung là gì"/"nọi dung là gì" rỗng. Reproduce 3/3 bằng smoke script.
- **Root cause (đo trực tiếp, không đoán):** `finalize_node` set `status="done"` vào jobs_store
  NGAY TRONG graph; `result` được `_finalize_query_job` (main.py) gắn SAU khi `graph.invoke`
  trả về — giữa 2 bước còn `_detect_query_interrupt` đọc checkpoint sqlite (chậm, state to).
  Job nhanh → FE poll trúng cửa sổ `status=done, result=None` → answer rỗng. Job chậm không
  bao giờ trúng → asymmetry đánh lừa chẩn đoán về phía diacritics/cache-logic.
- **Fix:** finalize_node KHÔNG set status nữa (chỉ progress); "done" đi CÙNG result trong một
  update duy nhất ở `_finalize_query_job`. + Bịt 4 lỗ contract (codex audit xác nhận):
  1. cache_lookup_node: hit phải có answer non-empty mới `done=True`; lookup exception →
     đi tiếp pipeline (trước đây → ErrorHandler, chặn đường trả lời).
  2. Mọi hit path trong llm_cache (`_answer_ok`): entry answer rỗng = không tồn tại.
  3. Mọi write path (semantic_store, _set_cached_query L1, finalize): answer rỗng/whitespace
     không được ghi (`cache_write_skipped_empty_answer`).
  4. `gen_fallback` flag: message chẩn đoán "Không nhận được phản hồi từ model..." KHÔNG
     được cache (trước đây cache như answer thật → poisoning mọi câu tương đương).
- **Regression:** `test_llm_cache.py` — empty_cached_answer_treated_as_miss_all_paths,
  store_skips_empty_answer, vn_variant_flow_same_document, graph_cache_hit_empty_answer_falls_through,
  graph_cache_lookup_exception_falls_back_to_llm, graph_finalize_skips_store_when_answer_empty
  (31 test). Smoke: `python BE/scripts/smoke_semantic_cache.py` — 6/6 PASS.
- **Prevention:** (1) Trạng thái terminal của job PHẢI được ghi atomically cùng payload kết quả
  — không bao giờ set "done" ở một tầng rồi gắn result ở tầng khác. (2) Bug "lúc có lúc không"
  tương quan với TỐC ĐỘ response = nghĩ ngay đến race polling, đừng chỉ soi logic nghiệp vụ.
  (3) Cache lookup exception không bao giờ được route sang error-terminal — cache là tối ưu.

## (2026-07-06) bge-m3: câu Việt CÓ dấu vs KHÔNG dấu embed rất khác nhau (cosine 0.558) — đừng gác diacritics bằng cosine

- **Triệu chứng:** Nâng cấp semantic cache, thiết kế đầu: alias không-dấu hit phải verify
  cosine ≥ threshold (chống đồng tự "bán"/"bàn"). Smoke Docker thật: "noi dung chinh cua
  tai lieu la gi" KHÔNG hit entry "Nội dung chính của tài liệu là gì?" — đo trực tiếp
  trong container: cosine 2 form = **0.558** (threshold 0.85).
- **Nguyên nhân:** bge-m3 mean-pool tokenize 2 form khác hẳn nhau → cặp CÙNG nghĩa
  có/không dấu sim thấp; ngược lại cặp homograph KHÁC nghĩa (lệch 1 ký tự) sim rất cao
  → cosine verify gác NGƯỢC chiều đe doạ: chặn true-positive, cho qua false-positive.
- **Cách xử lý (đã làm):** bỏ cosine verify ở alias path; gác bằng **LLM judge** (so intent
  2 câu dạng chữ — judge thấy dấu, phân biệt được nghĩa). Judge tắt → alias hit thẳng
  (toàn câu normalized trùng modulo dấu = tín hiệu mạnh, đánh đổi ghi rõ trong DR-2).
  Regression: `test_nodia_variant_hits_via_alias`, `test_nodia_reverse_direction_hits`,
  `test_nodia_alias_homograph_judge_denies`. Smoke live: hit `kind=exact_nodia` 5.1s vs cold 39.7s.
- **Prevention:** guard dựa trên embedding phải CALIBRATE bằng số đo thật trên đúng encoder
  + đúng loại text trước khi tin — trực giác "cùng nghĩa thì sim cao" sai với cross-form
  (có dấu/không dấu, viết tắt, ngôn ngữ trộn). Unit test vector giả không thay được số đo thật.
- **Quan sát phụ (chưa sửa, ghi nhận):** finalize re-store answer vào cache MỖI lần hit
  (3 dòng cache_write cho 3 hit trong smoke) — idempotent, chỉ tốn 1 SETEX + refresh TTL,
  hành vi có từ v1. Muốn tối ưu: skip set_cached khi payload lấy từ cache.

## (ĐÃ SỬA 2026-07-06) 'LateChunkEmbeddings' object is not callable — LC FAISS path chết mỗi query

- **Triệu chứng:** Mỗi query log 2 dòng: langchain warning "`embedding_function` is expected
  to be an Embeddings object, support for passing in a function will soon be removed" +
  `HybridRetriever.retrieve_faiss_only: LC path failed: 'LateChunkEmbeddings' object is not
  callable`. Retrieval VẪN ra kết quả (rơi về legacy FAISS im lặng) nên dễ bỏ qua.
- **Nguyên nhân:** `llm_factory.py::LateChunkEmbeddings` là plain class, KHÔNG kế thừa
  `langchain_core.embeddings.Embeddings`. LangChain FAISS check
  `isinstance(embedding_function, Embeddings)` — fail → coi nó là callable (đường deprecated),
  gọi `obj(text)` → TypeError not callable → LC path fail mọi `similarity_search_with_score`.
  Cả 2 dòng log cùng MỘT gốc. Duck-typing (có đủ embed_query/embed_documents) KHÔNG đủ —
  langchain phân nhánh bằng isinstance.
- **Cách xử lý (đã làm):** 1 dòng — `class LateChunkEmbeddings(_LCEmbeddings)` (import
  `Embeddings` module-level). 2 method abstract đã có sẵn.
- **Regression:** `test_embedding_late_chunk.py::test_late_chunk_embeddings_is_langchain_embeddings`
  (assert isinstance). Đã chạy kèm `test_store_precomputed.py` + `test_llm_cache.py` — xanh.
- **Prevention:** Viết adapter cho interface langchain → PHẢI subclass base class thật
  (`Embeddings`, `BaseRetriever`…), đừng duck-type; langchain rẽ nhánh isinstance ở nhiều chỗ.
  Test wiring assert `isinstance(..., Embeddings)` chứ không chỉ `hasattr`.
- **Lưu ý liên quan (ĐÃ XỬ LÝ cùng ngày):** hiện tượng "hỏi lại y hệt vẫn soạn mới" trong CÙNG
  phiên chat không phải bug này — trước đây `cache_lookup_node` bypass MỌI câu khi có
  `conversation_history`. Đã đổi: chỉ bypass câu FOLLOW-UP; câu STANDALONE
  (`llm_cache.is_standalone_question` — heuristic conservative: câu <4 từ, anaphora
  nó/này/đó/that/it..., mở đầu còn/thế/vậy/what about... → follow-up) vẫn cache.
  Điều kiện an toàn: `generate_answer_node` BỎ history khỏi prompt khi `cache_key` được set
  → answer context-free → store không poisoning (lookup/store nhất quán). Metric mới
  `standalone_with_history`. Regression: `test_llm_cache.py::test_is_standalone_question_heuristic`
  + `test_standalone_question_with_history_uses_cache`. Heuristic nghiêng về bypass —
  sai hướng đó chỉ mất cache, sai hướng ngược lại mới sinh answer thiếu ngữ cảnh.

## (ĐÃ SỬA 2026-07-05) Mindmap viewer + PNG export vỡ hoàn toàn — thiếu import MindElixir.css

- **Triệu chứng:** Mở sơ đồ tư duy: toàn bộ text node dồn thành MỘT dòng góc trên-trái
  ("Tổng quan tài liệuPhát hiện xâm phạm…"), root lơ lửng, 2 đường bezier bay lạc, canvas
  trống khổng lồ. PNG export y hệt (snapdom chụp trung thực DOM đang vỡ).
- **Nguyên nhân (3 lớp):**
  1. `mind-elixir/style` (dist/MindElixir.css) KHÔNG được import ở đâu cả — mind-elixir v5
     layout HOÀN TOÀN bằng CSS (`me-nodes` flex, `me-tpc` block...). Thiếu nó, custom elements
     rơi về `display:inline` → sụp toàn bộ. Bundle build cũng không có (verified grep dist).
  2. THEME custom chỉ set 4/22 cssVar; MindElixir.css dùng `var(--map-padding)`,
     `--main-gap-x/y`, `--node-gap-x/y`, `--root-radius`… KHÔNG có fallback → declaration
     invalid, spacing sụp dù đã import CSS.
  3. Export chụp `mind.nodes` (element `me-nodes`) TÁCH khỏi `.map-canvas` — rule then chốt
     là descendant selector `.map-canvas me-nodes{display:flex}` không match trong clone
     snapdom → PNG vỡ kể cả khi viewer đúng. Không có `scale` → ảnh mờ.
- **Cách xử lý (đã làm):** import `"mind-elixir/style"` trong `MindElixirView.jsx`; THEME
  PhongDoc set đủ 22 var (guard bằng `theme.test.js` — thiếu var nào test đỏ); export chụp
  `mind.map` (`.map-canvas`) + `scale: 2`.
- **Prevention:** dùng thư viện render bằng CSS-file riêng → kiểm tra CSS có vào bundle
  (`grep <rule đặc trưng> dist/assets/*.css`). Chụp DOM bằng snapdom/html2canvas → target
  phải CHỨA đủ tổ tiên mà CSS selector cần. Theme override một thư viện → set đủ TOÀN BỘ
  bộ var nó tiêu thụ, đừng set một phần.

## (ĐÃ SỬA 2026-07-05) Mindmap docx nông: heading_path rỗng → skeleton filler "Tổng quan tài liệu"

- **Triệu chứng:** Tạo sơ đồ cho docx → cây chỉ có root → 1 section "Tổng quan tài liệu"
  → vài idea; không sâu hơn, relations luôn rỗng (skip khi <2 section).
- **Nguyên nhân (chuỗi 4 khâu):**
  1. mammoth chỉ sinh `#`/`##`/`###` cho Word Heading styles thật — docx sinh viên dùng
     bold/đánh số tay → markdown 0 heading → mọi chunk `heading_path=""`.
  2. Chỉ `_from_headings` tạo được chiều sâu; tree_sections/clusters đều FLAT. Fallback
     tree_sections với ≤18 chunk trả đúng 1 section size-based tên "Tổng quan tài liệu".
  3. Kể cả khi có heading: `embed_index_node` cũ yêu cầu `len(headings)==len(entries)` —
     QR sub-split 1 chunk là lệch → rớt TOÀN BỘ heading_path của doc.
  4. `content_hash` không hash heading metadata → re-ingest phục hồi heading (text không đổi)
     vẫn trúng cache cũ, trả mãi map nông.
- **Cách xử lý (đã làm, PIPELINE_VERSION → skeleton_v2):**
  - `clean.py::promote_headings`: promote heuristic (dòng bold đứng một mình ≤90 ký tự không
    kết thúc ".", `Chương/Phần/Bài/Mục`, `1.`→##, `1.1`→###, La Mã→#) — CHỈ khi doc chưa có
    heading nào; item list sát nhau không bị promote (yêu cầu blank 2 phía).
  - `ingest_graph.py`: map heading qua `entry["chunk_index"]` (đã có sẵn cho late chunking)
    thay vì alignment 1:1 — sub-split không rớt heading nữa.
  - `skeleton.py::_from_tree_sections` yêu cầu ≥2 section (1 section = filler, bỏ).
  - MỚI `outline.py::build_outline`: skeleton "single" → 1 LLM call sinh mục lục 2 tầng
    (chunk_keys validate theo id thật); thành công → method "llm_outline", lỗi → root-only
    + degraded_missing "skeleton".
  - `content_hash(..., chunk_headings)` hash cả heading (prefix `\x02`); `generator.skeleton_method`
    được persist để chẩn đoán record đã lưu.
  - SKIP_MODEL_LOAD giờ khai `degraded=True` ở enrich/relations (trước im lặng trả skeleton
    như bản hoàn chỉnh).
- **Regression:** `test_promote_headings.py`, `test_mindmap_outline.py`, `test_mindmap_skeleton.py::
  test_single_tree_section_is_rejected_as_filler`, `test_late_chunk_ingest.py::test_heading_path_
  survives_subsplit`, `test_mindmap_schema_v2.py` (hash headings + skeleton_method).
- **Lưu ý:** dữ liệu đã index TRƯỚC fix vẫn heading_path rỗng — muốn map sâu phải re-upload
  (re-ingest) tài liệu; hash mới sẽ tự bypass cache cũ.
- **Regression cùng ngày (đã vá, skeleton_v3):** bản đầu của `promote_headings` chỉ match
  `**bold**` — mammoth THẬT sinh `__bold__` VÀ escape punctuation (`1\.` chứ không phải `1.`)
  → doc Q&A re-upload vẫn trượt promote. Vá: `_BOLD_LINE_RE` nhận cả `__`/`**` (backreference
  `(\*\*|__)...\1`), thêm `unescape_mammoth` (bỏ `\` trước bộ punctuation AN TOÀN `. ( ) ! ? , : ; … " '`
  — KHÔNG đụng `# * - [ ]` tránh tạo markdown giả) chạy TRƯỚC promote trong `clean_markdown`.
  Bài học: viết heuristic parse markdown phải kiểm bằng OUTPUT THẬT của converter (đọc chunk
  từ sqlite), đừng viết theo markdown "chuẩn" trong đầu. Test: `test_promote_headings.py`
  (case mammoth dialect), FE mirror `evidence.js::unescapeMd` cho data cũ.
- **Regression vòng 2 cùng ngày (đo qua smoke Docker thật, đã vá):**
  1. Cap heading 90 ký tự chặn câu hỏi Q&A tiếng Việt bold (đo thật: 203 ký tự) → tách cap:
     bold đứng một mình (tín hiệu mạnh) = 250, dòng đánh số trần = 90.
  2. `MINDMAP_LLM_TIMEOUT_SEC` mặc định 120s không đủ cho enrich prompt nested-detail trên
     qwen3.5:9b CPU (3/4 nhánh degraded) → compose set 240s (cả backend + mindmap-service;
     lưu ý pipeline chạy trong mindmap-service khi `MINDMAP_SERVICE_ADDR` bật — set env đúng container).
  3. qwen thi thoảng trả JSON hỏng delimiter (~1/4 nhánh) → `enrich._ask_json` retry đúng 1 lần
     trước khi degraded. Regression: `test_enrich_retries_once_on_malformed_json`.

## Late chunking + EMBEDDING_MODEL_NAME chưa set → tách không gian embedding (MiniLM vs bge-m3)

- **Triệu chứng:** Bật late chunking nhưng query/memory/một số path lại embed bằng
  all-MiniLM (384) trong khi chunk index là bge-m3 (1024) → cosine vô nghĩa, retrieve trật.
  Trong Docker: log `model=sentence-transformers/all-MiniLM-L6-v2 dim=384`.
- **Nguyên nhân:** `get_embedding_model(model_name)` tôn trọng tên caller truyền; nhiều nơi
  truyền `store.MODEL_NAME` (đóng băng lúc import = default all-MiniLM khi env chưa set).
  Late chunking là scheme TOÀN CỤC nhưng lại nhận model ngắn-context → vỡ.
- **Cách xử lý (đã làm):** dưới late chunking, `get_embedding_model` BỎ QUA `model_name`
  caller, luôn resolve `get_late_chunk_encoder(os.getenv("EMBEDDING_MODEL_NAME") or None)`
  (env hoặc bge-m3) — đồng nhất với `get_embeddings`. ⇒ memory tree / mindmap /
  `_optional_prefix_embedding_list` / query đều dùng MỘT encoder. Regression:
  `test_embedding_late_chunk::test_get_embedding_model_ignores_caller_minilm_default`.
- **Prevention:** Docker vẫn nên set `EMBEDDING_MODEL_NAME=BAAI/bge-m3` (đã thêm vào compose)
  cho rõ ràng. Đổi model → rebuild index. (Phát hiện qua **codex audit** + Docker log thật.)

## (KHÔNG CÒN ÁP DỤNG 2026-09-01 — lớp QR/video là của dự án khác, đã gỡ khỏi kho)
## Video QR ghi 0 frame trong container headless (opencv-python-headless)

- **Triệu chứng:** `Completed: 0/N frames written successfully` / `Failed to write frame`;
  file .mp4 tạo ra rỗng/hỏng. Local Windows cũng từng in 0/N dù video vẫn tạo.
- **Nguyên nhân:** `writer.isOpened()` chỉ chứng minh writer mở được, KHÔNG chứng minh
  codec↔container encode được; `cv2.VideoWriter.write()` trả None (không tin được làm
  tín hiệu thành công). Code cũ thử XVID/DIVX/MJPG nhưng ghi vào `.mp4` (sai cặp).
- **Cách xử lý (đã làm):** `video_utils.save_qr_frames_to_video` ghép codec↔đuôi (mp4v/avc1→.mp4,
  MJPG/XVID→.avi), ghi xong rồi `_video_is_valid()` (tồn tại + size + `VideoCapture.read()`
  đọc được ≥1 frame) mới chấp nhận; không thì thử codec/đuôi khác. Và video là LƯU TRỮ PHỤ →
  `chunk_processor` nuốt lỗi save (video_path="") để KHÔNG chặn indexing (text đã ở FAISS).
  Regression: `test_video_codec.py`, `test_chunk_processor_index::test_video_failure_is_non_fatal`.

## UnboundLocalError 'get_embeddings' ở append_chunks_to_lc_index (LangChain FAISS path)

- **Triệu chứng:** Khi `USE_LC_VECTOR_STORE=1`, append chunk in `[vector_store] LangChain
  vector store failed, fallback legacy FAISS: cannot access local variable 'get_embeddings'`
  → âm thầm rơi về raw FAISS (vẫn chạy nhưng sai backend dự kiến). Phát hiện qua WORKFLOW
  SMOKE THẬT, không phải unit (unit raw-path không chạm nhánh LC).
- **Nguyên nhân:** Trong `append_chunks_to_lc_index` có `from app.clients.llm_factory import
  get_embeddings` Ở GIỮA hàm (khối __meta__) → Python coi `get_embeddings` là biến CỤC BỘ cho
  CẢ hàm → `emb = get_embeddings()` ở đầu hàm ném UnboundLocalError.
- **Cách xử lý (đã làm):** bỏ import lồng trong hàm; dùng lại `emb` (đã gán từ get_embeddings
  module-level ở đầu hàm) để lấy `emb_dim`. Regression: `test_store_precomputed.py::
  test_lc_path_precomputed_no_get_embeddings_shadow` (ép USE_LC_VECTOR_STORE=1 + embeddings).
- **Prevention:** KHÔNG `from x import y` giữa hàm nếu `y` đã dùng như tên module-level trong
  cùng hàm — sẽ shadow toàn hàm. Có test chạm nhánh LC FAISS (không chỉ raw).

## AutoModel.from_pretrained nạp .bin bị chặn với torch 2.5.x (late chunking) → dùng safetensors

- **Triệu chứng:** `LateChunkEncoder` nạp bge-m3 qua `AutoModel.from_pretrained` ném
  `ValueError: Due to a serious vulnerability issue in torch.load ... require torch >= v2.6`
  (CVE-2025-32434). Late chunking không tạo được vector → ingest rơi về fallback naive.
- **Nguyên nhân:** transformers chặn `torch.load` file `pytorch_model.bin` khi torch < 2.6.
  Repo PIN `torch==2.5.1+cpu` (xem lý do CUDA/Docker) → không nâng. Cache bge-m3 có CẢ
  `model.safetensors` lẫn `pytorch_model.bin`; mặc định transformers thử .bin → bị chặn.
- **Cách xử lý (đã làm):** `AutoModel.from_pretrained(name, use_safetensors=True)` trong
  `late_chunk.py::_ensure_backend` → buộc nạp .safetensors (không dính torch.load guard).
- **Verify:** smoke thật `scratchpad/smoke_late_chunk.py` (hoặc bất kỳ ingest có model) phải
  nạp bge-m3 OK, trả vector (n,1024). Model mới thêm vào hệ PHẢI có .safetensors trên HF.

## ormsgpack DLL bị Windows Application Control chặn (langgraph 1.x không import được)

- **Triệu chứng:** `import langgraph.graph` → `ImportError: DLL load failed while importing ormsgpack: An Application Control policy has blocked this file.` Toàn bộ tầng graph (query/ingest/mindmap) không import được → app không chạy.
- **Nguyên nhân:** langgraph 1.x phụ thuộc cứng `langgraph-checkpoint>=3` → `ormsgpack`. Binary `ormsgpack.cp311-win_amd64.pyd` bị Windows Application Control (Smart App Control/WDAC) chặn trên máy dev này. (pydantic-core Rust load OK → policy chỉ chặn riêng binary ormsgpack.)
- **Cách xử lý (đã chốt):** Pin về stack 0.3.x/0.2.x dùng `msgpack` thuần:
  - `langgraph>=0.2.57,<0.3` (0.2.57+ có `interrupt()` động cho HITL; dùng 0.2.76)
  - `langgraph-checkpoint==2.0.21` — **bản msgpack cuối cùng**. Lưu ý: checkpoint ≤2.0.21 dùng `msgpack`; **≥2.0.22 chuyển sang `ormsgpack`** (đã verify qua PyPI `requires_dist`).
  - `langgraph-checkpoint-sqlite==2.0.10` cần `checkpoint>=2.0.21` → giao điểm duy nhất msgpack-thuần là **đúng 2.0.21**.
  - *(Quan sát:* trên máy này ormsgpack 1.12.1 có lúc lại load được — policy có thể chuyển audit→allow. Nhưng vẫn pin msgpack-thuần để miễn nhiễm nếu bị tái chặn.)
  - `langchain*` về 0.3.x (core>=0.3.66 để thỏa community 0.3.27).
- **Verify sau mọi thay đổi dependency:** `python -c "import app.graphs.query_graph"` phải thành công. `import ormsgpack` vẫn fail là bình thường (msgpack không chạm tới nó).

## Rerank/NLI lazy-load NẰM TRONG timeout → query đầu âm thầm fallback (no-op)

- **Triệu chứng:** Bật `RERANK_ENABLED=1`/`NLI_ENABLED=1`, query ĐẦU TIÊN sau khi
  khởi động process: rerank không đổi thứ tự (như chưa bật), NLI trả
  `context_conflicts=[]` dù có cặp chunk mâu thuẫn rõ ràng. Query #2+ lại đúng.
  Test suite KHÔNG bắt được (graph-test monkeypatch `rerank_texts`/`detect_conflicts`
  → không có model load thật — đúng bài học "conftest mock che lỗi").
- **Nguyên nhân:** `RerankDocuments`/`VerifyContext` bọc lời gọi engine trong
  `ThreadPoolExecutor(...).result(timeout=RERANK_TIMEOUT/NLI_TIMEOUT)` (mặc định 10s).
  Engine load model **lazy** (`_ensure_model`) nên LẦN ĐẦU việc tải model chạy NGAY
  TRONG block timeout. Trên CPU/cache nguội, **chỉ riêng load weights mDeBERTa đã ~12.7s > 10s**
  → `TimeoutError` → nuốt im lặng thành identity/[] ở query đầu. Singleton cache model
  nên query sau (cùng process) mới đúng.
- **Cách xử lý (đã làm):** thêm `warmup()` ở `rerank.py`/`nli.py` — nạp weights **và**
  chạy 1 forward mồi (warm JIT/trace), gọi trong node **TRƯỚC** block timeout. Có timeout
  riêng rộng (120s) để model lỗi không treo vô hạn; `SKIP_MODEL_LOAD`/identity/null/lỗi → no-op.
  Timeout của node giờ chỉ bao inference thực. Regression: `test_*_warmup_loads_model_outside_timeout`
  (mô phỏng load chậm deterministic). `base_env` test set `SKIP_MODEL_LOAD=1` để warmup
  không kéo model thật trong unit test.
- **Verify:** smoke build graph THẬT với cờ bật + timeout MẶC ĐỊNH → rerank đảo thứ tự đúng
  ở query đầu (chunk vô quan bị loại).

## NLI (mDeBERTa) trên CPU ~7s/cặp → `NLI_TIMEOUT_SEC=10` mặc định KHÔNG đủ

- **Triệu chứng:** Sau khi đã fix warmup ở trên, rerank chạy tốt trong 10s nhưng NLI vẫn
  `context_conflicts=[]` ở timeout mặc định. Đo trực tiếp trên CPU máy dev (đã warm):
  `predict 6 cặp ≈ 42.8s` (~7s/cặp). `NLI_MAX_PAIRS=10` (mặc định) → tới 20 forward ≈ ~140s.
- **Nguyên nhân:** Đây là **giới hạn hiệu năng phần cứng**, không phải bug. mDeBERTa-v3-base
  inference rất chậm trên CPU; `detect_conflicts` chấm cả 2 chiều mỗi cặp nên số forward = 2×pairs.
- **Cách xử lý (đã chốt):** đổi default cho CPU chạy được: `NLI_MAX_PAIRS=3` + `NLI_TIMEOUT_SEC=90`.
  Đo THỰC trên CPU máy dev: 3 cặp chunk DÀI (6 forward) ≈ **66s** (câu ngắn ~42s nên ban đầu ước
  lượng thấp) → để 90s có đệm. Có GPU/model nhanh hơn thì hạ cả hai xuống qua env. Passthrough an
  toàn khi quá hạn vẫn giữ nguyên (không vỡ).
- **Lưu ý:** rerank (`bge-reranker-v2-m3`) trên cùng CPU lại kịp trong 10s với pool ~4–10 ứng viên
  → mặc định rerank giữ nguyên; chỉ NLI cần cân nhắc.

## Query-theo-file trả rỗng với tên file có space/dấu/ký tự đặc biệt (stem phân mảnh)

- **Triệu chứng:** chọn file để hỏi → "Không tìm thấy dữ liệu phù hợp", dù file đã index. Đặc biệt
  với tên có KHOẢNG TRẮNG (rất phổ biến), dấu tiếng Việt, hoặc ký tự đặc biệt.
- **Nguyên nhân:** định danh "stem" được suy ra ở ~6 nơi với quy tắc KHÁC NHAU. Mấu chốt: upload
  lưu `source_stem` GIỮ khoảng trắng (`Path(filename.replace('.','_')).stem.lower()` → "my report_pdf"),
  còn chunk `index.json["video"]` = video_path đã SANITIZE (space→'_' → "my_report_pdf") + timestamp.
  Retrieval `hybrid._filter_by_sources` so khớp 2 phía qua `_norm_stem` (NFKD, GIỮ space) → "my report_pdf"
  (selected) ≠ "my_report_pdf" (chunk) → `allowed_idx=[]` → retrieve [] . (NFKD KHÔNG bỏ dấu kết hợp.)
- **Cách xử lý (đã chốt):** MỘT canonicalizer dùng chung `shared/source_id.py::canonical_source_stem`,
  MIRROR đúng cách ingest đặt tên video_path (bỏ '.mp4' container có timestamp → fold '.'→'_' qua
  sanitize → bỏ timestamp → NFC + lower). Áp vào: `hybrid._norm_stem`, `memory/tree._normalize_video_stem`,
  `upload_file`/`ingest_graph` (source_stem), `/list-indexed` (trả `video_stem` canonical + `filename`).
  Ghi thêm `source_stem`/`source_id` canonical vào chunk metadata (ingest_graph) để retrieval khớp CHÍNH
  XÁC (ưu tiên field này, fallback suy từ `video` cho data cũ → không cần re-ingest).
- **Verify:** `python -m pytest tests/test_source_id.py tests/test_retrieval_filter.py tests/test_source_stem_sync.py
  tests/test_upload_query_e2e.py` — test space/dấu/ký-tự-đặc-biệt khớp đúng.
- **Hardening kèm theo:** lưu file vật lý an toàn (`_safe_save_path`: chặn ký tự cấm Windows + path
  traversal); chống trùng tên (`_unique_display_filename` gắn " (n)"); `/delete-source` khớp canonical +
  BỎ glob `{stem}*` nguy hiểm (xóa nhầm), dọn registry + file input; `/upload-multiple` đi cùng luồng
  async với `/upload-file` (source_id + registry + background ingest → FE poll được).

## pydantic 2.11+ làm vỡ StateGraph(QueryState) (langgraph 0.2.x)

- **Triệu chứng:** `build_query_graph` ném `pydantic.errors.PydanticForbiddenQualifier: ... 'NotRequired[Union[str, NoneType]]' contains the 'typing.NotRequired' type qualifier`. (Test cũ KHÔNG bắt được vì `conftest.py` mock `QUERY_GRAPH` → không bao giờ gọi `StateGraph(QueryState)` thật.)
- **Nguyên nhân:** pydantic ≥2.11 kéo `typing_inspection`, raise `ForbiddenQualifier('not_required')` khi `langchain_core.utils.pydantic.create_model_v2` build model từ `QueryState` TypedDict (có nhiều field `NotRequired[Optional[...]]`). langgraph 0.2.x truyền nguyên annotation kèm `NotRequired`.
- **Cách xử lý:** pin `pydantic>=2.7.4,<2.11` (dùng 2.10.6, không có typing_inspection).
- **Verify:** build graph thật (không mock) với cả 3 cờ CRAG/Supervisor/HITL bật phải compile được.

## Global python site-packages trôi khỏi requirements.txt pin (langchain/langgraph/pydantic)

- **Triệu chứng:** `pytest tests/` báo lỗi collection ở các file dùng `ensemble_retriever`
  (`test_crag_graph.py`, `test_hitl_graph.py`, `test_nli_graph.py`, `test_rerank_graph.py`,
  `test_supervisor_graph.py`, và trực tiếp `python -c "import app.graphs.query_graph"`):
  `ModuleNotFoundError: No module named 'langchain_core.pydantic_v1'`.
- **Nguyên nhân:** Global Python (dùng chung cho nhiều project trên máy dev — thấy cả
  `day08-langgraph-agent-lab` trong `pip list`) đã bị một lần `pip install` KHÔNG pin cài đè
  lên site-packages: `langchain==0.2.17` + `langchain-core==1.4.8` (lệch pha nặng — 0.2.x code
  gọi API chỉ có ở core cũ `pydantic_v1` shim, core 1.4.8 đã bỏ) + `langgraph==1.0.1` +
  `pydantic==2.13.4`, đều NGOÀI pin của `requirements.txt`
  (`langchain>=0.3.27,<0.4`, `langgraph>=0.2.57,<0.3`, ngụ ý pydantic<2.11 qua known-issue khác).
  Đã verify bằng `git stash` — lỗi tồn tại TRƯỚC bất kỳ thay đổi nào trong task hiện tại → môi
  trường trôi độc lập với code.
- **Quan sát phụ:** dù `langgraph` đã lên 1.0.1 (khác pin 0.2.x) và `pydantic` lên 2.13.4 (khác
  pin <2.11), `StateGraph(MindmapState)` với nhiều field `NotRequired[...]` VẪN build và chạy
  được (xem `tests/test_mindmap_graph.py`) — có thể lỗi `PydanticForbiddenQualifier` cũ (xem
  known-issue "pydantic 2.11+ làm vỡ StateGraph") đã được vá ở nhánh mới hơn của
  langchain_core/langgraph. KHÔNG coi đây là "đã an toàn để nâng pin" — chỉ là quan sát, chưa
  test đủ rộng (rerank/NLI/ensemble vẫn vỡ vì lý do khác — thiếu `pydantic_v1` shim ở core mới).
- **Cách xử lý:** CHƯA sửa (ngoài phạm vi task mindmap) — sửa bằng cách nào cũng đụng vào global
  site-packages dùng chung, rủi ro phá project khác trên máy. Test suite chạy OK khi loại 5 file
  trên: `pytest tests/ --ignore=tests/test_crag_graph.py --ignore=tests/test_hitl_graph.py
  --ignore=tests/test_nli_graph.py --ignore=tests/test_rerank_graph.py
  --ignore=tests/test_supervisor_graph.py`.
- **Prevention:** Trước khi bắt đầu 1 session dài, `pip show langchain langchain-core langgraph
  pydantic` đối chiếu `requirements.txt`; nếu lệch, cân nhắc venv riêng cho repo này thay vì
  global python (đánh đổi với lesson "dùng global python" cũ — lesson đó giả định global site-
  packages KHỚP pin; giờ không còn đúng). Nếu phải sửa global site-packages: `pip install -r
  BE/requirements.txt` rồi chạy lại toàn bộ suite của MỌI project dùng chung global python đó,
  không chỉ repo này.

## chunks.sqlite bị mất hoặc hỏng dữ liệu

- **Triệu chứng:** Không thể thực hiện tìm kiếm lexical (BM25 trả kết quả kém) hoặc tìm kiếm/tóm tắt thất bại khi đọc text của chunk, mặc dù các vector search qua FAISS vẫn trả về các ID tương ứng.
- **Nguyên nhân:** File cơ sở dữ liệu runtime `chunks.sqlite` (lưu text của các chunk) bị
  xoá nhầm, lỗi quyền ghi, hoặc hỏng. `index.json` chỉ còn pointer + metadata, không lưu
  text inline mặc định nữa.
- **Cách xử lý: INGEST LẠI TÀI LIỆU GỐC. Không có công cụ khôi phục nào.**

  > **Sửa 2026-09-01.** Mục này trước đây chỉ dẫn chạy
  > `python -m app.scripts.rebuild_sqlite_from_videos` để "giải mã lại các frame video QR".
  > **Lệnh đó không tồn tại** (`app/scripts/rebuild_sqlite_from_videos.py` chưa bao giờ
  > được viết), và lớp lưu trữ QR/video mà nó dựa vào là của một dự án khác, đã gỡ khỏi
  > kho này. Ai gặp sự cố mất dữ liệu rồi làm theo hướng dẫn cũ sẽ mất thêm thời gian đi
  > tìm một công cụ không có, trong lúc dữ liệu vẫn đang mất.

- **Phòng ngừa:** `chunks.sqlite` là nguồn văn bản DUY NHẤT (`chunk_text_store.get_text`
  chỉ có hai tầng: sqlite → inline `index.json` của index cũ). Nó phải nằm trong phạm vi
  sao lưu, ngang hàng với `index.faiss`.

## (ĐÃ SỬA 2026-07-04) Xoá nguồn khi index lớn → re-embed toàn bộ bằng bge-m3, block toàn bộ API vài phút

> **Resolved 2026-07-04:** Delete flow giờ ưu tiên remove-by-id trên index hiện có:
> `remove_chunks_from_lc_index` map `chunk_id -> docstore_id` rồi gọi `FAISS.delete(ids=...)`,
> `remove_chunks_from_raw_index` gọi `IndexIDMap.remove_ids(...)`. `rebuild_chunk_index(...)`
> chỉ còn là fallback khi delete-by-id lỗi, để ưu tiên toàn vẹn index/meta hơn hiệu năng.
> Giữ mục này làm lịch sử; phần dưới mô tả trạng thái TRƯỚC khi sửa.

- **Triệu chứng:** Bấm xoá nguồn khi index còn nhiều chunk → mọi endpoint (kể cả `/health`, `/list-indexed`) timeout vài phút; log in `[vector_store] rebuilt LC FAISS vectors=N (model=BAAI/bge-m3)` sau mỗi lần xoá. Quan sát thật ngày 2026-07-04 trên Docker: xoá lần lượt các nguồn khi index còn `245 → 240 → 237` vectors, mỗi lần đều block; xoá khi chỉ còn `2` chunks thì mất `0.35s`.
- **Nguyên nhân:** Flow xoá (`BE/app/domains/vectorstore/store.py::delete_chunks_by_source` / `delete_source_from_index`) gọi `rebuild_chunk_index(meta)`; nhánh LangChain gọi tiếp `rebuild_lc_index_from_meta` (`store.py:385`) = `FAISS.from_documents` trên TOÀN BỘ docs còn lại → re-embed tất cả bằng `BAAI/bge-m3` trên CPU. Cộng thêm gunicorn mặc định chỉ có `1` sync worker (`BE/Dockerfile:65`, `WEB_CONCURRENCY` mặc định `1`) nên 1 request nặng chặn cả app. Đây là nợ thiết kế cũ: trước còn rẻ với MiniLM 384, nay đắt vì late-chunking `bge-m3`.
- **Cách xử lý tạm:** Đặt `WEB_CONCURRENCY=2+` trong compose để app còn thở khi rebuild; xoá nguồn lúc rảnh.
- **Prevention:** Fix thật là bỏ re-embed khi xoá, chuyển sang delete-by-id trên index hiện có và chỉ rebuild ở nhánh fallback an toàn; xem plan `docs/superpowers/plans/2026-07-04-delete-source-no-reembed.md`.

## (ĐÃ SỬA 2026-07-04) `/generate-mindmap` cache-hit không có `job_id` → FE ném lỗi "Server không trả job_id"

> **Resolved 2026-07-04 (Task 16, commit aec6017):** FE `SidebarRight.jsx::runMindmapGeneration`
> giờ nhánh theo `startData.status === "done" && startData.result` TRƯỚC khi kiểm `job_id`
> (SidebarRight.jsx ~dòng 222-226) — cache-hit dùng thẳng `result`, bỏ polling. Phía BE trả
> `{"status":"done","result",...}` không có job_id là THIẾT KẾ của cache thật, không phải bug.
> Giữ mục này làm lịch sử; phần dưới mô tả trạng thái TRƯỚC khi sửa.

- **Triệu chứng:** Bấm "Tạo sơ đồ" (KHÔNG force) cho nguồn đã có mindmap cache theo `content_hash`
  → thay vì hiện lại map cũ ngay, FE alert lỗi "Không tạo được sơ đồ: Server không trả job_id."
- **Nguyên nhân:** `POST /generate-mindmap` khi cache hit (`force=False` + `mindmap_store.get_by_hash`
  trúng) trả THẲNG `{"status":"done","result":cached,"cached":true}` (200, KHÔNG có `job_id`) —
  xem `BE/app/main.py` quanh dòng 1742-1745. FE (`SidebarRight.jsx::runMindmapGeneration`, trước đây
  `handleGenerateMindMap`) luôn giả định response có `job_id` rồi mới poll: `if (!startData.job_id)
  throw new Error("Server không trả job_id.")` — không có nhánh xử lý response cache-hit.
- **Phát hiện:** đọc code khi làm Task 14 (tách MindMapModal.jsx), KHÔNG phải qua test/smoke thật —
  chưa xác nhận tần suất trúng cache trên dữ liệu thật (phụ thuộc `content_hash` có trùng không).
- **Cách xử lý:** CHƯA sửa — ngoài phạm vi Task 14 (tách file + render v2 relations). Hướng sửa gợi ý:
  FE nhánh theo `startData.status === "done"` (dùng `startData.result` thẳng, bỏ qua polling) TRƯỚC khi
  kiểm `job_id`, y hệt cách `onDone` xử lý kết quả job thường.

## (ĐÃ SỬA 2026-07-04) FE mindmap poll có hard-timeout 180s+10s → job thật chạy vài phút bị FE bỏ cuộc giữa chừng

- **Triệu chứng:** Tạo sơ đồ cho tài liệu lớn/nhiều nhánh (enrich+relations thật ~100s–vài phút, xem
  lessons-learned "skeleton-first") → FE tự báo lỗi "Quá thời gian chờ tạo Sơ đồ (frontend timeout)."
  dù job BE vẫn đang chạy và sẽ xong bình thường. User phải F5 rồi mở lại từ danh sách mới thấy map.
- **Nguyên nhân:** `SidebarRight.jsx::startPolling` (cũ) tự đặt `maxElapsedMs = jobTimeoutMs (180s) +
  maxExtraMs (10s)` và chủ động bắn `onError` khi vượt — một giá trị đoán, không theo thời gian chạy
  thật của pipeline (đo thật: enrich 3 nhánh ≈86s, nhưng tài liệu lớn/nhiều nhánh hơn dễ vượt 190s).
  Ngoài ra khi đang chờ, FE mở overlay fullscreen sớm với skeleton `partial` preview — trải nghiệm rối
  (overlay bật tắt nhiều lần) và không có cách nào phục hồi theo dõi job nếu user lỡ F5 (không có gì
  lưu `job_id` để resume).
- **Cách xử lý (đã làm, Task 1-4 nhánh mindmap-ux-v3):** thay `startPolling`/`stopPolling` (poller cũ,
  hard-timeout) bằng `utils/mindmapJob.js::createMindmapPoller` — KHÔNG hard-timeout (chỉ có stall-flag
  hiển thị UI sau `STALL_MS=5 phút` không đổi tiến độ, không tự huỷ). Bỏ overlay fullscreen sớm với
  skeleton preview; thay bằng progress chip nhỏ trong sidebar (`mindmapJobUi` state: running/label/
  progress/stalled). Thêm resume-after-reload: `utils/activeMindmapJob.js` lưu `{jobId, sources,
  startedAt}` vào localStorage khi job bắt đầu, `SidebarRight` mount-effect đọc lại và tự start poller
  mới (cờ `resumed=true` → done chỉ toast, không tự mở overlay, tránh giật user vào fullscreen cho job
  họ có thể không nhớ đã bấm). `clearActiveMindmapJob()` gọi ở mọi nhánh terminal (done/error/cancelled).
- **Prevention:** KHÔNG đặt hard-timeout FE cho job chạy nền dựa trên số đo TRUNG BÌNH — nếu cần phát
  hiện "kẹt", dùng stall-detection (không đổi tiến độ trong N phút, chỉ cảnh báo UI, không tự huỷ) thay
  vì tự ý coi là lỗi. Mọi job chạy nền dài (mindmap và tương lai các job tương tự) nên lưu định danh job
  vào localStorage ngay khi có `job_id` để F5 giữa chừng vẫn resume được, không bắt user "tưởng lỗi".
  `createMindmapPoller` là instance-per-run KHÔNG tự guard double-start — caller (`SidebarRight`) phải
  `pollerRef.current?.stop()` trước khi gán poller mới vào ref, nếu không sẽ rò rỉ vòng lặp polling cũ
  khi user bấm tạo/tạo lại liên tiếp.
- **Verify:** `cd FE && npm run build && npx vitest run` xanh (23 test, unit `mindmapJob.test.js`/
  `activeMindmapJob.test.js` cover poller + localStorage helper thuần, không cần BE thật). Manual smoke
  cần BE chạy thật (F5 giữa chừng lúc đang sinh → chip tự hiện lại) — dời qua đợt smoke thủ công riêng,
  chưa chạy trong phiên sửa này.

## Tạo lại xong ghi đè chỉnh sửa chưa lưu trong viewer

- **Triệu chứng:** Đang mở sơ đồ, sửa tay (đổi tên node, kéo, vẽ arrow — chưa bấm Lưu) rồi bấm "Tạo
  lại" (force=true, banner degraded) cho CÙNG map đang mở → khi job nền xong, bản chỉnh sửa tay biến
  mất, viewer hiện bản mới do LLM sinh lại thay vì hỏi trước.
- **Nguyên nhân:** `SidebarRight.jsx::handleMindmapDone` (được gọi khi poller báo `done`, kể cả với
  `isRegenerate: true`) build lại `record` từ kết quả job rồi gọi `setShowModalMap(record)` — thay
  thẳng object `data` mà `MindElixirView.jsx` đang render. `MindElixirView` re-init mind-elixir mỗi
  khi `data.id` đổi (`useEffect(..., [data?.id])`) — vì record mới có `id` mới (mindmap record UUID
  khác, xem mục 5 pipeline: force luôn tạo bản ghi mới) nên effect này chạy lại, gọi
  `recordToMindElixir(data)` mới và ghi đè toàn bộ instance, kể cả state `dirty`/nội dung chưa lưu
  của phiên sửa trước đó. `dirty` chỉ sống trong state của `MindElixirView`, không được đẩy lên
  `SidebarRight` nên `handleMindmapDone` không có cách nào biết viewer đang có thay đổi chưa lưu để
  chặn lại.
- **Cách xử lý (đã làm, mitigation không phải fix thật):** `MindElixirView.jsx` banner "Đang tạo lại
  sơ đồ…" hiện thêm dòng cảnh báo khi `dirty === true`: "— thay đổi chưa lưu sẽ bị thay thế khi bản
  mới sẵn sàng." (xem comment tại banner generating, ngay trước JSX `{dirty ? "..." : ""}`). Không
  chặn hành vi, chỉ báo trước để user tự bấm Lưu trước khi tạo lại nếu muốn giữ bản sửa.
- **Fix thật (chưa làm):** thread trạng thái `dirty` từ `MindElixirView` lên `SidebarRight` (ví dụ
  qua callback `onDirtyChange` giống `onSaved`/`onCancel` hiện có), rồi trong
  `SidebarRight.jsx::handleMindmapDone` (nhánh `isRegenerate`) kiểm cờ đó TRƯỚC khi
  `setShowModalMap(record)` — nếu đang dirty, hỏi xác nhận (hoặc giữ nguyên bản đang mở + chỉ toast
  "Có bản mới, xem?") thay vì tự động swap.
- **Tham chiếu code:** `FE/src/components/mindmap/MindElixirView.jsx` (banner generating, dòng có
  comment "Honest mitigation"), `FE/src/components/Layout/SidebarRight.jsx::handleMindmapDone`.


## (ĐÃ SỬA 2026-08-24) 17 test evaluation-review fail vì đường dẫn dataset tương đối sai gốc

- **Triệu chứng:** `cd BE && pytest tests/test_evaluation_review.py tests/test_evaluation_review_app.py`
  → 17 failed, đều chết ở `shutil.copytree(SOURCE_DATASET, root)` với `FileNotFoundError`. Nằm im
  trong nhóm "29 test BE fail sẵn" nên không ai truy.
- **Nguyên nhân:** hai file khai báo `Path("reports/evaluation/datasets/corpus_v1")` — đường dẫn
  TƯƠNG ĐỐI theo CWD. Nhưng `evaluation.review_app` chỉ import được khi CWD = `BE/`, còn `reports/`
  lại nằm ở gốc repo (`BE/../reports`). Hai ràng buộc mâu thuẫn: CWD nào cũng hỏng một nửa. Không có
  CWD nào từng chạy được cả hai.
- **Cách xử lý:** thêm guard module-level ngay sau chỗ khai báo hằng — `if not SOURCE.exists():
  pytest.skip(..., allow_module_level=True)`. Cùng lúc `reports/` đã gỡ khỏi git (báo cáo NCKH là dự
  án riêng, xem `.gitignore`), nên bản clone sạch cũng không có dataset và guard này là đường sống
  duy nhất. 17 failed → 17 skipped.
- **Prevention:** đường dẫn dữ liệu trong test KHÔNG dùng chuỗi tương đối trần. Neo theo file test:
  `Path(__file__).resolve().parents[2] / "reports" / ...` — không phụ thuộc CWD. Nếu dữ liệu nằm
  ngoài git (dataset nặng, tài sản dự án khác), test phải skip có thông báo chứ đừng fail: fail giả
  làm loãng danh sách fail thật, đúng như trường hợp này (ẩn 4 tháng trong 29 fail).
- **Verify:** `cd BE && .venv/Scripts/python.exe -m pytest tests/test_evaluation_review.py
  tests/test_evaluation_review_app.py -q` → `2 skipped`.

## (ĐÃ SỬA 2026-08-24) Upload .html luôn hỏng — gọi thư viện không có trong requirements

- **Triệu chứng:** tải file `.html` lên → tài liệu chuyển sang `failed`, log ingest ghi
  `Cannot read file content`. Không có dòng lỗi nào nói vì sao.
- **Nguyên nhân:** `document_loader.load_document` (bản cũ) gọi `UnstructuredHTMLLoader`, mà gói
  `unstructured` **chưa bao giờ có trong `BE/requirements.txt`**. `ModuleNotFoundError` rơi vào
  `except Exception: pass` ở cuối hàm, tụt xuống `ingest_utils.extract_text` — hàm này chỉ biết
  pdf/docx/doc/txt/ảnh nên trả `''`. Rỗng → `extract_text_node` ném `ValueError`. Chua ở chỗ
  `markdown_convert.py` đã dùng `markdownify` (đã cài) cho đúng việc đó, chỉ là hai file không dùng
  chung đường.
- **Cách xử lý:** `_load_html()` dùng `markdownify`, bỏ hẳn `UnstructuredHTMLLoader`.
- **Prevention:** `except Exception: pass` bao quanh một chuỗi loader là chỗ trốn hoàn hảo cho lỗi
  thiếu dependency. Mọi thư viện được gọi trong nhánh loader phải có test đọc file thật của định
  dạng đó (`test_upload_formats.py`), nếu không "hỗ trợ định dạng X" chỉ là một dòng `if` chứ không
  phải khả năng thật.
- **Verify:** `cd BE && .venv/Scripts/python.exe -m pytest tests/test_upload_formats.py -q` → 11 passed.

## (ĐÃ SỬA 2026-08-24) `/upload-file` nhận mọi loại file và không giới hạn dung lượng

- **Triệu chứng:** tải `.exe`/`.zip`/`.mp4` lên vẫn được nhận. File được lưu đĩa, đẩy lên Supabase
  Storage, tạo dòng trong `documents`, rồi vài phút sau ingest mới chết. Người dùng không thấy lỗi
  lúc bấm — chỉ thấy một tài liệu hỏng trong danh sách. Ngoài ra không có `MAX_CONTENT_LENGTH` ở
  bất kỳ đâu nên Flask nhận file lớn tuỳ ý.
- **Nguyên nhân:** ba route upload (`/upload-file`, `/upload-multiple`, `/api/documents/upload`) chỉ
  kiểm `file` có tồn tại và tên khác rỗng. Việc lọc định dạng bị phó mặc cho thuộc tính `accept` của
  FE — thứ chỉ là gợi ý hộp thoại chọn file, gọi thẳng API là qua mặt được.
- **Cách xử lý:** `app/domains/ingest/formats.py` giữ `SUPPORTED_EXTENSIONS` dùng chung.
  `_ingest_uploaded_file` kiểm đuôi **trước khi ghi bất cứ thứ gì** và ném `UnsupportedFileType`;
  ba route trả 415 kèm `supported_extensions`. Thêm `MAX_CONTENT_LENGTH` đọc từ `MAX_UPLOAD_MB`
  (mặc định 100) và handler 413 trả JSON.
- **Prevention:** thuộc tính `accept` của FE KHÔNG phải kiểm tra. Mọi ràng buộc đầu vào phải nằm ở
  backend; FE chỉ là tiện ích chọn file. Đặt cổng chặn trong hàm dùng chung
  (`_ingest_uploaded_file`) chứ không phải ở từng route — ba route cùng đi qua đó nên một guard
  che hết, thêm route thứ tư cũng tự có.
- **Verify:** `test_upload_tu_choi_duoi_la_va_khong_ghi_dia` khẳng định 415 VÀ thư mục lưu vẫn rỗng.

## (ĐÃ SỬA 2026-08-24) Trạng thái bố cục tự xoá chính nó — đọc localStorage trong useEffect + StrictMode

- **Triệu chứng:** thu gọn cột bên, `localStorage` ghi đúng `{"collapsed":{"left":true}}`, tải lại
  trang thì cột mở lại và giá trị đã lưu bị thay bằng mặc định. Đo bằng playwright: đặt sẵn
  `{left:true,right:true}` rồi vào `/app` → `.panel-spine` đếm được **0**, và giá trị trong
  localStorage đổi thành `{left:false,right:false}`.
- **Nguyên nhân:** hook nạp trạng thái trong `useEffect` (đọc) và ghi trong một `useEffect` khác.
  React chạy effect theo thứ tự khai báo trong CÙNG một commit: effect-đọc gọi `setState` (mới xếp
  hàng, chưa có hiệu lực) rồi bật cờ `hydrated`, ngay sau đó effect-ghi thấy cờ đã bật nên ghi
  **giá trị mặc định của lần render đầu** đè lên. Với `StrictMode` (dev gọi effect hai lượt), lượt
  đọc thứ hai đọc đúng cái mặc định vừa bị ghi đè — dữ liệu mất hẳn, không phải chỉ nhấp nháy.
- **Cách xử lý:** đọc `localStorage` NGAY trong initializer của `useState` (qua một `useRef` giữ
  kết quả để không đọc lại mỗi lần render), bỏ hẳn effect-đọc, và bỏ qua lượt ghi đầu tiên bằng
  `firstWrite` ref. Không còn lần render nào tồn tại trước khi trạng thái được nạp, nên không còn
  gì để ghi đè.
- **Prevention:** trong SPA thuần (không render phía máy chủ) thì đọc storage trong initializer của
  `useState` là cách ĐÚNG, không phải cách tắt. Chỉ dùng effect khi thật sự có SSR và phải khớp
  HTML lần đầu. Nếu buộc phải nạp bằng effect thì effect-ghi phải bỏ qua mọi lượt chạy lúc gắn, và
  phải thử với StrictMode bật — bug này vô hình nếu chỉ nhìn một lượt mount.
- **Verify:** kịch bản playwright đặt sẵn trạng thái, vào `/app`, đếm `.panel-spine` = 2 và
  localStorage giữ nguyên; thêm vòng thu gọn → tải lại → vẫn 1 gáy sách.

## (KHÔNG PHẢI LỖI) `status: interrupted` của /query-status là HITL đang chờ duyệt, không phải job chết

- **Nhầm lẫn:** thấy `/query-status/<id>` trả `{"status": "interrupted"}` sau vài giây rồi kết luận
  pipeline truy vấn hỏng. Sai.
- **Sự thật:** `main.py:1421 _mark_query_interrupted()` — "HITL: đánh dấu job chờ người duyệt (SSE
  coi 'interrupted' là terminal)". Với `HITL_ENABLED=1`, graph dừng ở cổng duyệt và job mang đúng
  trạng thái đó, kèm `result.payload.review = {answer, job_id, type: "review"}`. Câu trả lời đã có
  sẵn trong payload, chỉ chờ người bấm duyệt qua `/query-resume/<job_id>`.
- **Cách phân biệt:** job chết thật thì `result` rỗng hoặc `error` khác None. Job chờ duyệt thì
  `result.payload.review` tồn tại. Đừng coi `interrupted` là mã lỗi — nó nằm trong `TERMINAL_STATUSES`
  của `jobs_store` nhưng CỐ Ý không bị xoá `token_buffer` vì còn resume được.
- **Lưu ý khi viết script kiểm thử:** vòng lặp poll mà dừng ở `interrupted` rồi báo "thất bại" sẽ
  báo động giả mỗi lần HITL bật. Phải đọc `result.payload.review` trước khi kết luận.
- **Trạng thái hiện tại:** `HITL_ENABLED=0` trong `BE/.env` và trong `render.yaml` (mặc định của
  `shared/config.py` là `1`, nên phải đặt tường minh). Query đi thẳng `running` → `done`.

## (ĐÃ SỬA 2026-08-24) Không có chữ chảy dần trong chat — EventSource không gửi được Bearer

- **Triệu chứng:** hỏi xong ngồi im vài phút rồi câu trả lời hiện MỘT CỤC. Console báo
  `GET /query-stream/<job_id> 401 UNAUTHORIZED`.
- **Nguyên nhân:** `ChatArea.jsx` dùng `new EventSource(...)`. Đặc tả EventSource KHÔNG cho đặt
  header, nên không có cách nào đính `Authorization: Bearer`. Backend `/query-stream` gọi
  `_require_app_user()` ngay dòng đầu → 401 → `onerror` → cờ `sseConnectionLost` → tụt về
  `pollQueryStatus`. Polling chỉ lấy kết quả cuối nên mất sạch token chảy dần. Đường ống backend
  luôn đúng: `query_graph.py:595` gọi `_append_token` từng mẩu, `/query-stream` đọc `token_buffer`
  mỗi `SSE_POLL_INTERVAL_SEC=0.4` rồi đẩy `{"type":"token"}`.
- **Cách xử lý:** `utils/sseStream.js` — `fetch()` + `ReadableStream`, tự tách khung SSE
  (`parseSseChunk`, hàm thuần, 9 ca test). `fetch` gửi được header và huỷ được bằng
  `AbortController`. Endpoint backend KHÔNG đổi một dòng. Đường polling giữ nguyên làm lưới an toàn.
- **Hai cách đã cân nhắc và bỏ:** nhét token vào query string (`?token=`) làm rò bearer vào log máy
  chủ và referrer; cấp vé dùng-một-lần thì đúng nhưng phải thêm route + bảng + hạn dùng.
- **Cửa gác thứ hai cần biết:** `query_graph.py:89` ép `QUERY_STREAM_TOKENS = False` khi
  `HITL_ENABLED` — "tắt stream token để không lộ bản nháp chưa duyệt". Bật HITL thì dù sửa vận
  chuyển vẫn KHÔNG có token. Hai chỗ chặn độc lập nhau.
- **Verify:** gọi thẳng SSE có Bearer → HTTP 200 `text/event-stream`, nhận 14 sự kiện token / 525
  ký tự; không Bearer → 401. `npx vitest run` 27 file, 212 passed.

## (KHÔNG PHẢI LỖI) Truy vấn mặc định KHÔNG đi đường RAG — `use_memory_tree` mặc định True

- **Nhầm lẫn:** thấy chuỗi node `RetrieveMemory -> Finalize` (13–20s, không có `GenerateAnswer`,
  `sources: 0`) rồi tưởng pipeline bị cắt hoặc streaming hỏng.
- **Sự thật:** `main.py` route `/query` đọc `use_memory_tree = data.get('use_memory_tree', True)`.
  Mặc định BẬT, nên câu hỏi đi đường cây-nhớ và trả lời từ tóm tắt cây, payload có
  `query_type` + `memory_nodes`, KHÔNG có `sources`. Đường RAG đầy đủ
  (`RerankDocuments -> VerifyContext -> GenerateAnswer -> Finalize`) chỉ chạy khi gửi
  `use_memory_tree: false`. `_append_token` nằm trong `GenerateAnswer`, nên đường cây-nhớ
  KHÔNG BAO GIỜ stream token — đúng thiết kế, không phải lỗi.
- **Ba đường đo được cho cùng một câu hỏi:**
  | Đường | Chuỗi node | Thời gian | Token |
  |---|---|---|---|
  | Cache trúng (Redis) | `CheckSources -> RetrieveMemory -> Finalize` | 40s | 0 |
  | Cây nhớ (mặc định) | `RetrieveMemory -> Finalize` | 13–20s | 0 |
  | RAG đầy đủ | `RerankDocuments -> VerifyContext -> GenerateAnswer -> Finalize` | 225s | 14 |
- **Prevention:** khi đo hay so sánh chất lượng truy hồi, PHẢI ghi rõ đường nào — ba đường cho ba
  câu trả lời khác nhau với cùng một câu hỏi. Kịch bản benchmark quên `use_memory_tree: false` sẽ
  đo nhầm cây nhớ mà tưởng đang đo RAG.

## (ĐÃ SỬA 2026-08-24) `DATA_DIR` trỏ sang DỰ ÁN KHÁC — toàn bộ trạng thái chạy nằm ngoài repo

- **Triệu chứng:** đi tìm timeline node của một truy vấn vừa chạy, `BE/logs.sqlite` đứng im từ
  2026-08-11. Tưởng instrumentation không tồn tại, suýt viết lại từ đầu.
- **Nguyên nhân:** `BE/.env` đặt `DATA_DIR=e:/memvid_NCKH/MemVid_New/BE` — thư mục của một dự án
  KHÁC. `logger.log_db_path()`, index FAISS, cây nhớ, `checkpoints.sqlite`, `conversations.sqlite`,
  `jobs.sqlite`, `sessions.sqlite` đều neo theo `DATA_DIR`, nên mọi thứ sinh ra lúc chạy rơi vào
  `MemVid_New/BE`. Kiểm chứng bằng dấu thời gian: các file bên đó mang giờ 17:21 hôm nay trong khi
  bản trong repo dừng ở tháng 7.
- **Vì sao ẩn được lâu:** trỏ sai KHÔNG gây lỗi nào. App chạy bình thường, upload được, hỏi được,
  trả lời đúng — chỉ là đọc và ghi ở một cây thư mục khác. Không có exception, không có log đỏ.
  Chỉ lộ ra khi đi tìm một file cụ thể và thấy nó cũ.
- **Cách xử lý:** dừng BE, sao lưu bản trong repo sang `BE/_backup-<timestamp>/`, chép
  `index/ memory/ input_docs/` và các `*.sqlite` (KÈM `-wal` và `-shm`, nếu không mất phần ghi chưa
  checkpoint) từ thư mục cũ về, rồi đặt
  `DATA_DIR=e:/memvid_NCKH/MemVid_BaoCaoTotNghiep/BE`.
- **Phòng ngừa (đã thêm):** `main.py` in `DATA_DIR` mỗi lần khởi động và kêu to khi nó nằm ngoài
  `BE_ROOT`. Một dòng in rẻ hơn nhiều so với vài tháng đo nhầm chỗ.
- **Verify:** `BE/logs.sqlite` 185 bản ghi, mới nhất trùng giờ truy vấn vừa chạy; log bên
  `MemVid_New` dừng hẳn ở thời điểm chuyển. Truy vấn RAG sau khi chuyển vẫn chạy trọn (index còn
  nguyên, 19 sự kiện token).
- **Còn lại:** `BE/_backup-<timestamp>/` chứa bản CŨ tháng 7 (đã bị thay). Thư mục
  `e:/memvid_NCKH/MemVid_New/BE` vẫn nguyên vẹn làm bản gốc. Xoá được khi đã yên tâm.

## (ĐÃ SỬA 2026-08-24) MỌI timeout trong query_graph đều vô hiệu — `with ThreadPoolExecutor` chặn lúc thoát

- **Triệu chứng:** `NLI_TIMEOUT_SEC=90` nhưng node `VerifyContext` chạy 197 giây. Kiểm log node
  thấy đây là số thật, lặp lại: 5 lần chạy, trung vị 197 691 ms, max 226 979 ms.
- **Nguyên nhân:** khuôn `with ThreadPoolExecutor(max_workers=1) as ex: ex.submit(fn).result(timeout=T)`.
  `result()` ném `TimeoutError` đúng hạn, NHƯNG `__exit__` của executor gọi `shutdown(wait=True)`
  nên nó chặn tới khi worker chạy xong, rồi ngoại lệ mới tới được `except`. Đo tách bạch: việc 8
  giây với `timeout=2` thì khối `with` thoát ở giây **8.0**, không phải 2.0; bỏ `with` và
  `shutdown(wait=False)` thì thoát đúng giây **2.0**.
- **Phạm vi:** 5 chỗ trong `query_graph.py`, tức TOÀN BỘ hạn giờ của pipeline truy vấn —
  `MEMORY_TREE_TIMEOUT`, `RERANK_TIMEOUT`, `NLI_TIMEOUT`, `AI_TIMEOUT` (hạn gọi LLM), và một chỗ
  chạy hai việc song song.
- **Cách xử lý:** thêm `run_with_timeout(fn, timeout, propagate_ctx=)` — tạo executor, submit,
  `result(timeout=)`, rồi `shutdown(wait=False)` trong `finally`. Thay 4 chỗ một-việc. Chỗ thứ 5
  (hai việc song song) để lại kèm comment `ponytail:` nêu rõ trần và đường nâng cấp — thiệt hại nhỏ
  vì truy hồi đo được 727ms so với hạn 60s.
- **Prevention:** `shutdown(wait=False)` KHÔNG giết được thread (Python không cho) — công việc bỏ
  lại vẫn chạy tới hết rồi thread mới tự thu. Đó đúng là ý nghĩa của timeout ở đây: thôi chờ, đi
  tiếp bằng đường dự phòng. Đừng bao giờ đặt `.result(timeout=)` bên trong `with ThreadPoolExecutor`
  và mong hạn giờ có tác dụng.
- **Verify:** `BE/tests/test_query_timeout.py` — ca `test_bo_cho_dung_han_chu_khong_doi_viec_xong`
  khẳng định việc 6 giây với hạn 0.5s phải trả quyền dưới 3 giây (bản cũ trả ở ~6s). 5 passed;
  `test_crag_graph` + `test_hitl_graph` + ca mới: 22 passed.

## (ĐÃ ĐÓNG 2026-09-01 — xem mục đầu file, đã đổi sang MiniLMv2-L6) NLI mDeBERTa chậm gấp ~250 lần dự toán FLOP và chưa từng bắt được mâu thuẫn nào

- **Số đo (máy để yên, lặp 3 lần đều nhau):** một lượt forward `mDeBERTa-v3-base-mnli-xnli`,
  batch 2 × 512 token → **94 giây**. Theo độ dài: 128 token 28.2s, 256 token 47.7s.
  `detect_conflicts` với `max_pairs=1` (đúng 2 chiều) → **91.3s**. Nạp model một lần → 17.9s.
- **Không phải do torch:** matmul thuần trên cùng máy đạt **400 GFLOPS**, MKL 2024.2 + oneDNN đủ,
  8 luồng. Dự toán FLOP cho một forward là ~0.1s. Lệch ~250 lần.
- **Nút thắt là công việc ĐƠN LUỒNG, không phải tính toán** — hai phép đo cùng chỉ một hướng:
  1. Scale theo luồng gần như PHẲNG (512 token, batch 2): 1 luồng 96.5s · 4 luồng 94.8s ·
     8 luồng 86.7s · 16 luồng 88.7s. Gấp 16 lần luồng chỉ nhanh hơn 10%. Việc nghẽn ở matmul
     thì phải scale 6–8 lần (matmul thuần trên chính máy này scale đúng như vậy).
  2. Thời gian TUYẾN TÍNH theo độ dài: 128 token 28.2s · 256 token 47.7s · 512 token 92.8s
     (gấp đôi token = gấp 1.9 lần thời gian). Không phải bậc hai, nên KHÔNG phải ma trận
     attention O(n²).
  Kết luận: thời gian nằm ở các phép gather/index tuần tự của attention tách rời DeBERTa-v3
  trong `transformers`. Hệ quả thực dụng: **thêm luồng hay gom lô đều không cứu được**.
- **Hiệu quả thực tế:** `VerifyContext` chạy 5 lần trong các truy vấn thật, **0 lần** phát hiện mâu
  thuẫn, tiêu tổng 1008 giây.
- **Cảnh báo về dữ liệu lịch sử:** `logs.sqlite` có 46 bản ghi `VerifyContext` cũ với trung vị 1ms
  và 16 lần "bắt được mâu thuẫn" — TOÀN BỘ có `job_id='j1'`, tức là của unit test với engine giả
  (có cả ca `{"error": "nli down"}`). ĐỪNG dùng chúng làm số liệu vận hành.
- **Hệ quả sau khi sửa timeout:** hạn 90s nay cắn thật, nên NLI sẽ hết giờ ở gần như mọi truy vấn
  và trả `[]` — tức là vẫn mất 90 giây mà không đóng góp gì. Trạng thái đó tệ hơn tắt hẳn.
- **Lựa chọn, chưa quyết:** (a) `NLI_ENABLED=0` cho chạy thường, giữ cờ cho ablation E4_nli của
  luận văn; (b) đổi sang model NLI nhỏ hơn nhiều (họ MiniLM đa ngữ) rồi đo lại; (c) giữ nguyên và
  chấp nhận NLI luôn hết giờ.

## (ĐÃ SỬA 2026-08-24) Ablation E0–E7 rò `.env` — E4_nli âm thầm biến thành E3_rerank

- **Triệu chứng (chưa xảy ra, bắt được lúc rà):** chạy `E4_nli` trên máy có `NLI_ENABLED=0` trong
  `BE/.env` sẽ ra kết quả TRÙNG KHÍT `E3_rerank`, và hiệu số "đóng góp của NLI" bằng 0 — vì lý do
  sai. Không có lỗi nào nổ ra.
- **Nguyên nhân:** `evaluation/adapters.py:178` gác đúng bằng `cfg["nli"]["enabled"]` từ YAML, cổng
  mở nên `nli_filter` vẫn chạy. Nhưng bên trong nó gọi `nli.get_nli()`, và hàm đó (nli.py:120)
  đọc `NLI_ENABLED` từ MÔI TRƯỜNG rồi trả `NullNli` khi cờ tắt. `NullNli` chấm mọi cặp là neutral
  → không bao giờ có xung đột → không chunk nào bị loại. Cùng cái bẫy với `rerank.get_reranker()`
  (rerank.py:193 → `_IDENTITY` khi `RERANK_ENABLED=0`).
- **Vì sao nguy hiểm:** đây là số liệu đi thẳng vào chương 4 luận văn. Một biến môi trường trên máy
  chạy thí nghiệm có thể vô hiệu hoá một thành phần mà bảng kết quả vẫn trông hoàn toàn hợp lệ.
- **Cách xử lý:** `evaluation/runner.py` đặt `NLI_ENABLED` / `RERANK_ENABLED` (và `NLI_MODEL` /
  `RERANK_MODEL` nếu cfg có) từ YAML, ngay cạnh `INDEX_DIR`/`MEMORY_DIR` và **trước** dòng import
  production — đặt sau khi import thì vô tác dụng vì settings đã đọc env rồi.
- **Prevention:** trong một bộ chạy ablation, YAML phải là nguồn quyết định DUY NHẤT cho mọi cờ
  thành phần. Cổng ở tầng điều phối (`if cfg[...]["enabled"]`) là CHƯA ĐỦ khi hàm bên dưới còn tự
  đọc env — phải ép env khớp cfg trước khi import. Quy tắc chung: mỗi cờ mà production đọc từ env
  thì runner phải ghi đè tường minh, không dựa vào máy chạy sạch.
- **Verify:** `tests/test_evaluation_env_isolation.py` — khoá cả hành vi bẫy (`NLI_ENABLED=0` →
  `NullNli`, `RERANK_ENABLED=0` → `_IDENTITY`) lẫn việc runner đặt cờ TRƯỚC import production.
  6 passed; harness + timeout + crag-config: 23 passed.

## (ĐÃ SỬA 2026-08-24) Câu hỏi ĐẦU TIÊN trả giá nạp model rerank — 13 giây không ai thấy

- **Triệu chứng:** node `RerankDocuments` chiếm 50% thời gian truy vấn (18–22 giây), trông như
  cross-encoder chậm.
- **Sự thật:** phần lớn là NẠP MODEL, không phải suy luận. Đo trong cùng một tiến trình:
  | | câu 1 (nguội) | câu 2 (ấm) |
  |---|---|---|
  | RerankDocuments | 21 958 ms | 8 844 ms |
  | tổng truy vấn | 62.6s | 26.1s |
  `rerank.warmup()` được gọi trong node và cố ý nằm NGOÀI vùng timeout (đúng — nếu không, lần
  nạp đầu vượt hạn 10s làm rerank âm thầm fallback ở câu đầu). Nhưng thế nghĩa là người dùng đầu
  tiên sau mỗi lần khởi động trả trọn giá nạp.
- **Suy luận thì bình thường:** tuyến tính 0.65–0.69s mỗi ứng viên (5 ứng viên 3.39s · 10 ứng viên
  6.85s · 20 ứng viên 12.95s). Khác hẳn NLI — bge-reranker chạy đúng như dự toán cho một model
  568M tham số trên CPU. Và nó THẬT SỰ đổi thứ hạng: `[0,1,2,3,4,5]` thành `[17,16,13,19,14,7]`.
- **Cách xử lý:** thêm `RETRIEVAL_WARMUP_ENABLED` (mặc định 0, opt-in như `EMBEDDING_WARMUP_ENABLED`
  và cùng lý do RAM: mỗi worker gunicorn giữ một bản ~2.2GB). Bật thì luồng warm nền lúc khởi động
  gọi `rerank.warmup()` và `nli.warmup()`, tôn trọng `RERANK_ENABLED`/`NLI_ENABLED`.
- **Verify:** bật cờ, khởi động lại, câu ĐẦU TIÊN cho `RerankDocuments 9519 ms` (số ấm) thay vì
  21 958 ms; tổng 40.7s thay vì 62.6s. Log có `[warmup] rerank model ready`.
- **Bẫy khi kiểm:** dòng print của luồng warm nằm trong bộ đệm stdout nên `grep` ngay sau đó KHÔNG
  thấy, dù nó đã chạy. Suýt kết luận nhầm là cờ không ăn. Bằng chứng đáng tin là SỐ ĐO của câu đầu,
  không phải dòng log.
- **Còn lại:** log node của `RerankDocuments` trước đây không ghi `rerank_status`, nên nhìn log
  không phân biệt được một lượt rerank thành công với một lượt chạm hạn rồi giữ nguyên thứ tự. Đã
  thêm `status` và `timeout_sec` vào metadata.

## (ĐÃ ĐÓNG 2026-09-01 — xem mục đầu file, đã nâng hạn lên 15s) Hạn rerank 10s sát mép — chunk dài hơn là chạm

- Đo với chunk tổng hợp 979 ký tự: 20 ứng viên mất **12.95s**, vượt `RERANK_TIMEOUT_SEC=10` → rơi
  về thứ tự gốc, tốn trọn 10 giây mà không đổi gì.
- Chunk THẬT hiện tại ngắn hơn (~316 ký tự/đoạn, đo từ `ContextBuilder chars=1896` cho 6 đoạn) nên
  còn lọt: log thật cho `status: "applied"`.
- Nghĩa là biên an toàn mỏng. Tài liệu có đoạn dài hơn, hoặc `RERANK_CANDIDATE_K` tăng, là chạm hạn
  ngay — và trước khi sửa lỗi `with ThreadPoolExecutor` thì hạn này còn không cắn nên chưa ai thấy.
- Ba đường khi cần: giảm `RERANK_CANDIDATE_K` (20 xuống 10 = 6.85s), nâng `RERANK_TIMEOUT_SEC`, hoặc
  cắt ngắn text đưa vào cross-encoder. Chưa quyết.

## (ĐÃ SỬA 2026-08-24) bge-m3 không nạp được qua sentence-transformers — torch.load bị chặn

- **Triệu chứng:** `python -m evaluation.index_builder` chết ngay ở `get_embeddings()`:
  `ValueError: Due to a serious vulnerability issue in torch.load ... require torch >= 2.6
  (CVE-2025-32434). This version restriction does not apply when loading files with safetensors.`
- **Nguyên nhân:** `transformers` bản mới từ chối `torch.load` mọi checkpoint `.bin` khi torch < 2.6
  (ở đây torch 2.5.1+cpu). Kho bge-m3 có CẢ HAI định dạng nhưng sentence-transformers chọn `.bin`.
- **Vì sao app vẫn chạy được mà chỉ bộ dựng index chết:** đường ingest của app dùng LATE_CHUNKING=1,
  đi qua `late_chunk.py` với loader riêng. Chỉ nhánh nào gọi `get_embeddings()` với
  `LATE_CHUNKING=0` mới dính — và đó đúng là cách config R0/R1 chạy. Một lỗi ẩn sau cờ.
- **Cách xử lý:** `llm_factory.get_embeddings()` truyền
  `model_kwargs={"device": "cpu", "model_kwargs": {"use_safetensors": True}}`. Kiểm riêng: nạp
  được, dim 1024, 20.3s.
- **Prevention:** đừng nâng torch để chữa (kéo theo cả stack langchain). Ép safetensors là đúng
  hướng và rẻ. Khi thêm model mới, kiểm nó có `model.safetensors` trước khi ghim vào config.

## (ĐÃ ĐÓNG 2026-09-01 — xem mục đầu file; thang ĐÃ chạy xong trên R1) Ablation E0–E7 không chạy được: canonical extraction đã lệch

- **Trạng thái:** `reports/evaluation/runs/` KHÔNG TỒN TẠI. Bộ ablation chưa chạy lần nào, nên chưa
  có một con số recall/precision nào cho chương 4.
- **Ba cửa đã qua:** (1) lỗi safetensors ở trên — đã sửa; (2) builder giải đường dẫn nguồn theo CWD
  nên phải chạy TỪ GỐC REPO với `PYTHONPATH=BE`, không phải từ `BE/`; (3) `corpus_version:
  REPLACE_BEFORE_BUILD` — thực ra builder tự lấy từ manifest khi dùng `--dataset`.
- **Cửa còn lại:** `ValueError: canonical extraction changed after coordinate bridge:
  cv1_ragas_guardrails`. Dataset ghi bản trích xuất chuẩn kèm hash, người gán nhãn đánh dấu span
  bằng chứng TRÊN ĐÚNG bản đó. Trích lại bây giờ ra text khác nên toạ độ span không còn bảo đảm.
- **Đo mức lệch:** độ dài Y HỆT (41619 = 41619), `SequenceMatcher.ratio()` = **1.0000**, khác biệt
  duy nhất là VỊ TRÍ của dấu tổ hợp `U+0338`. Không bằng nhau kể cả sau NFC lẫn NFD
  (`normalize_evidence_text` vốn đã áp NFC), nên đây là đổi thứ tự ký tự thật, không phải đổi dạng
  chuẩn. Nghi PyMuPDF đổi cách phát dấu tổ hợp giữa các phiên bản. 1/3 tài liệu có canonical bị lệch.
- **KHÔNG được phá hàng rào này.** Nó tồn tại đúng để chặn việc tính số liệu luận văn trên annotation
  không còn khớp text. Độ dài giống hệt nên span "gần như chắc chắn" vẫn đúng — nhưng "gần như" không
  phải tiêu chuẩn cho ground truth.
- **Ba đường, cần người quyết:** (a) chạy lại coordinate bridge cho tài liệu đó theo
  `PHASE_4C_COMMANDS.md` mục 3 rồi phân xử thủ công các span lệch; (b) loại tài liệu đó khỏi corpus;
  (c) ghim đúng phiên bản PyMuPDF đã tạo bản gốc — nhưng không biết là bản nào.
- **ĐÃ XÁC MINH (2026-08-24), tác động NHỎ HƠN NHIỀU so với dự đoán ban đầu:**
  - 3/12 tài liệu là ĐÚNG VÀ ĐỦ: 9 tài liệu còn lại `eligible_for_study=False` (smoke-test
    payload, demo sản phẩm, tài liệu thiết kế nội bộ). Cả 3/3 tài liệu đủ điều kiện đều có
    canonical. Coordinate bridge KHÔNG dở dang.
  - Kiểm từng span bằng `locator.char_start/char_end` (hệ `canonical-document-v1`, 89/89 span
    dùng chung hệ này) và so text đã gộp khoảng trắng:
    | | bản CŨ (đóng băng) | bản MỚI |
    |---|---|---|
    | cv1_ragas_guardrails (canonical ĐỔI) | 44/44 | **43/44** |
    | cv1_social_engineering | 28/28 | 28/28 |
    | cv1_vector_feature_store | 17/17 | 17/17 |
    | **tổng** | **89/89** | **88/89** |
  - Dataset gốc NHẤT QUÁN HOÀN TOÀN (89/89). Toàn bộ thiệt hại là **ĐÚNG MỘT span**: `R17_s01`.
  - Span đó: mong `'Eval ̸= optional. RAGAS 4 metrics + LLM-Judge là baseline.'`, lấy được
    `'Eval̸ = optional. RAGAS 4 metrics + LLM-Judge là baseline.'` — chữ Y HỆT, dấu gạch chéo
    tổ hợp dịch một vị trí. Cả hai đều hiển thị 'Eval ≠ optional'. Khác biệt RỖNG về ngữ nghĩa.
  - Nên việc cần người làm thu về: phân xử ĐÚNG MỘT span, không phải gán nhãn lại.

- **BỐN LẦN ĐO SAI LIÊN TIẾP trước khi ra được bảng trên — ghi lại để lần sau khỏi lặp:**
  1. Kiểm chồng lấn bằng `char_start`/`char_end` ở cấp span → field đó KHÔNG tồn tại ở cấp đó,
     `.get()` trả None nên mọi so sánh ra False. Kết luận '0 span bị chạm' hoàn toàn vô nghĩa.
  2. Hash `canonical_text[start_offset:end_offset]` → `start_offset` là offset TRONG TRANG,
     không phải trong tài liệu. Toạ độ tài liệu nằm ở `locator.char_start/char_end`.
  3. Hash thô đoạn text → `evidence_text` lưu ở dạng ĐÃ GỘP khoảng trắng, còn canonical giữ
     nguyên xuống dòng. Ra '6/17 khớp' và suýt báo dataset hỏng — thực ra 17/17.
  4. Chỉ khi đọc TRỌN một bản ghi span (thay vì đoán tên field) mới thấy đủ `locator`,
     `coordinate_system`, và quan hệ giữa `start_offset` với `locator.char_start`.
  **Bài học:** với dữ liệu nghiên cứu có lược đồ lạ, ĐỌC TRỌN một bản ghi TRƯỚC khi viết phép
  kiểm. Mỗi lần đoán tên field đều cho một con số trông hợp lý mà sai — và con số sai kiểu đó
  nguy hiểm hơn lỗi ném ra, vì nó không kêu.

## (ĐÃ SỬA 2026-08-25) qrel của R1/R2 không sinh được: chunk Markdown không định vị được trong canonical

- **Trạng thái sau khi đã phá 4 hàng rào provenance:** 3 index dựng xong.
  | index | chunk | tb ký tự | trung vị | chunk có toạ độ canonical |
  |---|---|---|---|---|
  | R0_recursive | 171 | 300 | 310 | **167 / 171** |
  | R1_structure | 142 | 388 | 450 | **1 / 142** |
  | R2_late | 142 | 388 | 450 | **1 / 142** |
  R0 sinh được **91 qrel**. R1 và R2 chết ở `span V01_s01 has unresolved chunk alignment`.
- **Nguyên nhân THẬT (không phải span khó phân xử):** `map_span_to_chunks` trả `relevant: None`
  khi CHUNK thiếu `canonical_char_start/end`, chứ không phải khi span không chồng lấn. Mà
  `locate_chunks` dùng TÌM CHUỖI CON CHÍNH XÁC trong canonical text. R0 cắt trên text thô nên chunk
  là chuỗi con thật → khớp. R1/R2 cắt trên bản Markdown do `pymupdf4llm` sinh, ví dụ:
  `'#### <mark>Sau buổi học này, bạn sẽ:</mark>\n**1.** Hiểu vector embeddings...'`
  Có thẻ HTML `<mark>`, đánh số thành `**1.**`, heading `####`. Đó là VIẾT LẠI CẤU TRÚC, không phải
  thêm dấu.
- **Đã thử và KHÔNG đủ:** `locate_chunks` vốn đã bóc dấu heading `^#{1,6}\s+`. Bóc thêm nhấn mạnh
  (`**đậm**`, `_nghiêng_`, `*nghiêng*`) chỉ nâng từ **1/142 lên 6/142**. Bóc dấu không phải hướng đúng.
- **Mức lan: TOÀN BỘ.** Cả 8 config E0–E7 đều `index_dir: reports/evaluation/indexes/R2_late`. Nên
  cả thang ablation chặn ở đúng chỗ này.
- **Ba đường, cần người quyết:**
  - (a) Đổi 8 config E sang `R0_recursive` — chạy được NGAY (qrel đã có). Đổi lại: E0–E7 sẽ đo biểu
    diễn cắt-đệ-quy chứ không phải late chunking. Trục so sánh R0/R1/R2 vốn là trục riêng.
  - (b) Sửa đúng gốc: `chunk_markdown_spans` ĐÃ trả `start`/`end` trong hệ toạ độ Markdown. Thay vì
    tìm chuỗi con từng chunk sau khi cắt, hãy căn Markdown↔canonical MỘT LẦN cho mỗi tài liệu rồi
    quy đổi offset. Đúng hơn nhiều nhưng là việc lớn và đổi `MAPPING_RULE_VERSION`.
  - (c) Phân xử tay 141 chunk — không khả thi.
- **ĐÃ SỬA — chọn đường (b), sửa gốc:** `evaluation/evidence.py` thêm `project_offsets(source,
  target)` (bảng quy đổi offset: vùng giống ánh xạ 1-1, vùng khác nội suy tuyến tính giữa hai
  mốc, đơn điệu không giảm) và `locate_chunks_by_spans(canonical, doc_text, spans)`.
  `index_builder` dùng đường mới khi có span hợp lệ, GIỮ `locate_chunks` cho chế độ đệ quy — ở
  đó chunk LÀ chuỗi con thật của text thô nên tìm chuỗi vẫn đúng.
- **Vì sao hướng này đúng:** `chunk_markdown_spans` đã bảo đảm `doc_text[start:end] == text`,
  nên thông tin luôn có sẵn. Harness cũ vứt nó đi rồi đi tìm lại bằng chuỗi trong MỘT HỆ TOẠ ĐỘ
  KHÁC. Giờ chỉ căn hai văn bản một lần mỗi tài liệu rồi quy đổi.
- **Kết quả đo được:** R1_structure từ **1/142** lên **141/142** chunk có toạ độ canonical
  (`span_projection` 141, `unresolved` 1). qrel R1 sinh ra **91**, bằng R0.
- **Chi phí:** căn văn bản tốn 32.9s cho tài liệu lớn nhất (48k ký tự md ↔ 41.6k canonical,
  5317 opcode, 81.4% giống), dưới 1s cho hai tài liệu còn lại. Một lần lúc dựng index.
- **Đánh dấu provenance:** chunk chiếu bằng span mang `canonical_alignment: "span_projection"`,
  phân biệt được với `exact_normalized` của đường tìm chuỗi. Không trộn hai cách trong dữ liệu.
- **Verify:** `BE/tests/test_evidence_span_projection.py` 12 passed — gồm một ca dựng đúng tình
  huống thật: cùng dữ liệu thì `locate_chunks` trả `unresolved` còn `locate_chunks_by_spans`
  chiếu được, và hai hàm trả CÙNG bộ khoá (builder ghi chung một chỗ).
- **Lưu ý:** R0 cũng có 4/171 chunk `unresolved` (chunk có khối code, ví dụ `RAGAS Code Setup — Quick
  Start\nfrom ragas import evaluate...`). Ít nhưng không phải không có.

## (ĐÃ ĐÓNG 2026-09-01 — xem mục đầu file; đã đo lại đủ 4 index + thêm hàng rào) Late chunking mean-pool trong khi bge-m3 dùng CLS — không gian vector sụp, E1–E7 vô hiệu

- **Triệu chứng:** chạy ablation lần đầu ra kết quả khó tin — BM25 THUẦN thắng mọi thứ:
  | thí nghiệm | recall@6 | MRR | nDCG@6 |
  |---|---|---|---|
  | E0_bm25 | **0.8371** | 0.7467 | 0.7331 |
  | E1_faiss | 0.2286 | 0.1213 | 0.1460 |
  | E2_hybrid | 0.4686 | 0.3313 | 0.3638 |
  | E3_rerank | 0.6229 | 0.6080 | 0.5963 |
  (25 truy vấn có chunk vàng, index R2_late)
- **Nguyên nhân gốc — đo được, không suy đoán:**
  1. Độ tương đồng cosine TRONG cùng một tài liệu, cùng bộ 142 chunk, chỉ khác cách nhúng:
     | index | sim TB trong tài liệu | sim chéo tài liệu |
     |---|---|---|
     | R0_recursive (nhúng thường) | 0.53–0.68 | 0.447 |
     | R1_structure (nhúng thường) | 0.53–0.64 | 0.470 |
     | **R2_late (late chunking)** | **0.967–0.995** | **0.805** |
     Hai chunk CẠNH NHAU trong R2 giống nhau tới **0.9999**. Không gian vector SỤP — FAISS không
     phân biệt nổi chunk nào với chunk nào, kể cả giữa các tài liệu khác nhau.
  2. `~/.cache/huggingface/.../bge-m3/1_Pooling/config.json` ghi rõ:
     `"pooling_mode_cls_token": true`, `"pooling_mode_mean_tokens": false`.
     bge-m3 sinh vector câu từ token **CLS**. Còn `late_chunk.embed_document` **mean-pool
     `last_hidden_state`**. Đó là HAI KHÔNG GIAN KHÁC NHAU.
  3. Hệ quả: vector TÀI LIỆU (mean-pool, dị hướng) và vector TRUY VẤN (CLS, chuẩn hoá qua
     sentence-transformers) không so sánh được. Truy hồi dense đang đo nhiễu.
- **KHÔNG phải do cắt cửa sổ:** có cảnh báo `14550 > 8192` lúc dựng, nhưng
  `accumulate_token_embeddings` có cửa sổ trượt + overlap nên xử lý đúng. Và tài liệu NHỎ NHẤT
  (4722 ký tự ≈ 1500 token, dưới xa 8192) vẫn sụp 0.995.
- **Mức lan: TOÀN BỘ THANG.** Cả 8 config E0–E7 đều `index_dir: R2_late`. Nên E1–E7 đo trên một
  nền hỏng. E0 không dính vì BM25 thuần từ vựng — và đó CHÍNH LÀ lý do nó "thắng".
  **Kết luận "BM25 thắng dense retrieval" là SAI.** Sự thật là dense retrieval đang hỏng.
- **Đã suýt mất 15 giờ:** thang đang chạy tiếp E4–E7 (NLI 298 giây/truy vấn) thì dừng lại kiểm.
  Chạy hết sẽ cho một kết luận luận văn hoàn toàn sai.
- **Ba đường, cần người quyết:**
  - (a) Chạy thang E trên `R1_structure` (nhúng thường, cùng chunk với R2) — số hợp lệ ngay, và
    trục R0/R1/R2 vốn là trục riêng.
  - (b) Sửa late chunking cho khớp không gian: hoặc pool tài liệu bằng CLS theo từng span (khó —
    CLS là một token cho cả chuỗi), hoặc nhúng TRUY VẤN cũng bằng mean-pool (nhất quán nội bộ
    nhưng lệch đường production), hoặc đổi sang model có pooling mặc định là mean (họ e5).
  - (c) Giữ nguyên và báo cáo "late chunking làm sụp không gian vector" như một kết quả âm — nó LÀ
    một phát hiện thật, miễn là nói rõ nguyên nhân là lệch pooling chứ không phải late chunking
    về nguyên lý.

## (ĐÃ SỬA 2026-08-25) `aggregate` chết vì một run dở dang — bảng kết quả THIẾU SỐ mà không báo gì

- **Triệu chứng:** bảng đối chiếu R1/R2 hiện `n=0` cho `E2_hybrid_R1` và `E3_rerank_R1`, dù cả hai
  đã chạy xong và có đủ 30 dòng `per_query.jsonl`. `E1_faiss_R1` chỉ có 23/30 dòng.
- **Nguyên nhân:** `aggregate()` duyệt `runs/*` và gọi thẳng `load_jsonl(run_dir / "retrieval.jsonl")`.
  Một thí nghiệm bị DỪNG TAY (E4 lúc dừng thang) để lại thư mục có `manifest.json` nhưng chưa kịp
  ghi `retrieval.jsonl`/`qa.jsonl`. Hàm ném `FileNotFoundError` và dừng hẳn — kéo theo MỌI run xếp
  sau nó (theo `sorted()`) không được gộp.
- **Vì sao đây là lỗi nguy hiểm nhất trong cả đợt:** nó không làm chương trình chết trước mắt người
  đọc — nó làm **bảng kết quả thiếu số một cách im lặng**. Số cụt trông y hệt số thật. Tao đã đọc
  bảng thiếu và báo cáo nó như bảng đầy đủ. Chỉ tình cờ thấy `n=0` mới lần ra.
- **Cách xử lý:** kiểm `retrieval.jsonl`/`qa.jsonl` có tồn tại trước khi đọc; thiếu thì bỏ qua run
  đó VÀ IN RA: `[aggregate] BỎ QUA 1 run dở dang: 75793f7f94d0 (thiếu retrieval.jsonl, qa.jsonl)`.
- **Prevention:** công cụ gộp số liệu KHÔNG được dừng vì một mục hỏng — nhưng cũng không được bỏ
  qua im lặng. Hai nửa đều bắt buộc: bỏ qua để phần còn lại dùng được, và kêu ra để người đọc biết
  bảng không đầy đủ. Dừng-tay giữa chừng là chuyện bình thường khi chạy thí nghiệm dài.
- **Verify:** `BE/tests/test_aggregate_partial_runs.py` 6 passed — gồm ca run dở dang nằm GIỮA (đúng
  thứ tự `sorted()` gây lỗi thật), ca nằm đầu, ca thiếu một trong hai file, và ca khẳng định có in
  cảnh báo.
- **Số liệu ĐÚNG sau khi sửa (25 truy vấn có chunk vàng):**
  | nấc | R2_late recall/MRR/nDCG | R1_structure recall/MRR/nDCG |
  |---|---|---|
  | E0 bm25 | 0.8371 / 0.7467 / 0.7331 | 0.8371 / 0.7467 / 0.7331 |
  | E1 faiss | 0.2286 / 0.1213 / 0.1460 | 0.6971 / 0.6727 / 0.6379 |
  | E2 hybrid | 0.4686 / 0.3313 / 0.3638 | 0.7829 / 0.8213 / 0.7654 |
  | E3 rerank | 0.6229 / 0.6080 / 0.5963 | **0.9029 / 0.9200 / 0.8917** |
  Trên nền nhúng ĐÚNG, thang tăng đơn điệu như thiết kế và rerank vượt BM25 thuần 6.6 điểm recall.
  Trên nền hỏng, thang đi xuống rồi bò lên và BM25 "thắng" — kết luận ngược hoàn toàn.

## (ĐÃ SỬA 2026-08-25) Pooler transaction 6543 + psycopg3 → `DuplicatePreparedStatement`

- **Triệu chứng:** `sqlalchemy.exc.ProgrammingError: (psycopg.errors.DuplicatePreparedStatement)
  prepared statement "_pg3_0" already exists`. Test đậu khi chạy RIÊNG, rớt khi chạy CHUNG với test
  khác — dấu hiệu kinh điển của trạng thái phía server bị chia sẻ.
- **Nguyên nhân:** Supavisor ở chế độ TRANSACTION (cổng 6543) tái dùng connection backend giữa các
  client. psycopg3 tự chuyển sang prepared statement phía server sau vài lần lặp cùng một câu lệnh,
  và tên `_pg3_N` đụng nhau giữa các client dùng chung backend.
- **Vì sao nguy hiểm:** lỗi chỉ nổ khi CÙNG một câu lệnh chạy đủ nhiều lần, tức là khi tải tăng.
  Smoke test một vài request sẽ qua sạch, rồi chết ở môi trường thật. Và `.env.example` của chính
  dự án khuyến nghị 6543 cho runtime.
- **Cách xử lý:** `app/db/__init__.py` truyền `connect_args={"prepare_threshold": None}` khi DSN có
  `:6543/`. Chỉ cho cổng đó — session pooler (5432) và kết nối trực tiếp giữ một connection riêng
  cho mỗi client nên không đụng, và giữ được lợi ích của prepared statement.
- **Prevention:** dùng pooler transaction-mode với psycopg3 thì PHẢI tắt prepared statement. Đây là
  ràng buộc của Supavisor/PgBouncer, không phải tuỳ chọn hiệu năng.
- **Verify:** `pytest tests/test_ingest_temp_cleanup.py tests/test_documents_api.py` — trước khi sửa
  2 failed, sau khi sửa 19 passed. Bộ rộng hơn (upload + documents + delete + schema): 42 passed.

## (GHI NHỚ) Đường tới Supabase đổi hai lần trong một ngày — pooler rồi trực tiếp rồi lại pooler

- **Sáng:** pooler `aws-0` trả `{:error, :nxdomain}` ở cả 5432 lẫn 6543 → tạm chuyển sang kết nối
  trực tiếp `db.<ref>.supabase.co:5432`, chạy được.
- **Chiều:** kết nối trực tiếp CHẾT — `ping -6` mất 100% gói. Đường trực tiếp của Supabase chỉ có
  **IPv6**, và IPv6 trên máy này mất. Cùng lúc đó pooler đã sống lại.
- **Đã chuyển về pooler** `aws-0-ap-northeast-2.pooler.supabase.com:6543`, kèm bản sửa
  `prepare_threshold` ở trên.
- **Hai điều cần nhớ khi dò lại:**
  1. Pooler cần username dạng `postgres.<project_ref>`; kết nối trực tiếp dùng `postgres` trơn.
     Đưa nhầm dạng nào cũng cho lỗi gây hiểu lầm: `ENOIDENTIFIER: no tenant identifier provided`
     (đưa user trơn cho pooler) hoặc `ENOTFOUND: tenant/user not found` (đưa nhầm vùng).
     Tao đã tưởng Supabase hỏng vì đúng lỗi này, thực ra là probe của mình sai.
  2. Kết nối trực tiếp phụ thuộc IPv6 → **không dùng được trên Render** và không bền ở mạng gia
     đình. Pooler có IPv4, bền hơn cho cả hai.

## (ĐÃ SỬA 2026-08-26) Trung bình gộp cả truy vấn KHÔNG có nhãn vàng — mọi chỉ số truy hồi bị hạ ~14 điểm phần trăm

- **Triệu chứng:** `aggregate_metrics.json` của mọi run báo recall thấp hơn con số tính
  tay. Cụ thể `E0_bm25_R1`: file ghi **0.6976**, tính lại đúng ra **0.8371**. Không có
  lỗi, không có cảnh báo — chỉ là một con số nhỏ hơn sự thật.
- **Root cause:** `retrieval_metrics(ranked, relevant_ids, k)` trả `recall = 0.0` khi
  `relevant_ids` rỗng, và `runner.py` gộp thẳng 30/30 hàng vào trung bình. Bộ dữ liệu
  cố ý cài 5 câu (**V11–V15**) KHÔNG trả lời được: `gold_status` là
  `insufficient_evidence` (V11, V12, V13, V15) hoặc `ambiguous` (V14). Tài liệu không
  chứa đáp án, hành vi đúng là từ chối, nên không có chunk vàng để gán. Năm số 0 đó là
  **đo sai thước** — chấm điểm truy hồi cho câu không có gì để truy hồi.
- **Fix:** `retrieval_metrics` trả thêm `n_relevant`; `runner.py` chỉ trung bình trên
  hàng `n_relevant > 0` và ghi kèm `n_queries` / `n_scored` / `n_no_gold` /
  `no_gold_query_ids` để việc loại trừ **nhìn thấy được**, không phải quy ước ngầm.
  Run cũ không phải chạy lại: `BE/scripts/tinh_lai_aggregate.py` bù cột `n_relevant`
  vào `retrieval.jsonl` rồi tính lại file gộp (14 run, khớp từng chữ số với bảng trong
  `docs/KET_QUA_THUC_NGHIEM.md`).
- **Còn thiếu:** 5 câu này cần thước riêng — **tỷ lệ từ chối** — chứ không phải bị bỏ
  im lặng. Chưa đo (xem `docs/KET_QUA_THUC_NGHIEM.md`).
- **Prevention:** chỉ số truy hồi phải đi kèm **mẫu số**. Một `mean` trần trụi không nói
  được nó trung bình trên bao nhiêu câu và bỏ câu nào — và cái bị bỏ thầm lặng luôn là
  cái làm sai kết luận. Đã có test: `tests/test_evaluation_harness.py` chốt
  `n_relevant == 0` cho truy vấn không nhãn.

## (GHI NHỚ 2026-08-26) `temperature=0` + `seed` KHÔNG đủ để Ollama tất định

Bộ chấm `evaluation/judge.py` đặt `temperature: 0` và `seed` cố định. Chấm lại cùng một
run hai lần liên tiếp ra **giống hệt 50/50 điểm**. Nhưng giữa hai lần chạy cách nhau
(máy đã dùng GPU cho việc khác giữa chừng) thì **1/50 điểm đổi** — `faithfulness` trung
bình 1.720 xuống 1.680.

Nguyên nhân: Ollama quyết định số layer đẩy lên GPU **lúc nạp model**, theo VRAM còn
trống tại thời điểm đó. Phân bổ layer khác nhau thì thứ tự cộng dồn dấu phẩy động trong
llama.cpp khác nhau, và ở một câu sát ngưỡng quyết định thì logit lật.

Hệ quả khi báo cáo số: nói "tái lập được" thì phải nói kèm **cùng một lần nạp model**.
Muốn chặt hơn thì `ollama stop <model>` trước khi chạy và đừng dùng GPU cho việc khác
trong lúc chấm — vẫn không đảm bảo tuyệt đối.

Không sửa được từ phía mình. Ghi lại để đừng mất thời gian đi tìm bug trong code chấm.

## (ĐÃ SỬA 2026-08-26) Sơ đồ tư duy ra 4 node khung xương sau 9 phút — hai lỗi chồng nhau

- **Triệu chứng:** Bấm tạo sơ đồ, đợi 9 phút, job báo **`done`** nhưng sơ đồ chỉ có
  root + 3 section, không ý nào, không quan hệ nào. Không có lỗi đỏ ở đâu cả.

- **Root cause 1 — model không vừa VRAM.** `BE/.env` đặt `MINDMAP_MODEL=qwen2.5:14b`
  (9.95 GB) trong khi GPU chỉ 6 GiB: Ollama giữ được 4.07 GB, phần còn lại rơi xuống
  CPU, tốc độ tụt còn **2.6 tok/s**. Mỗi nhánh enrich xin JSON ~5 ý × 3 chi tiết
  (800–1500 token) nên cần 300–580 giây, chạm `MINDMAP_LLM_TIMEOUT_SEC=300` và rơi về
  skeleton. Đáng chú ý: `.env` ở gốc repo vốn ghi `qwen2.5:7b-instruct` — `BE/.env`
  trôi khỏi nó lúc nào không rõ, và `BE/.env` được nạp ĐÈ lên.

- **Root cause 2 — hai cấu hình song song đá nhau.** `MINDMAP_ENRICH_PARALLEL` mặc
  định **2**, còn cổng LLM in-process `MAX_CONCURRENT_LLM_CALLS` là **1**. Nhánh thứ
  hai không chạy nhanh hơn, nó XẾP HÀNG; chờ quá `LLM_QUEUE_WAIT_TIMEOUT_SECONDS`
  (180s) thì ném `LLM busy (in-process): all 1 slots in use, waited 180.0s`. Đo thật:
  cả 3 nhánh **và** bước quan hệ đều chết đúng kiểu đó.

  Lỗi này **lúc được lúc không**, nên rất khó bắt: chạy enrich riêng lẻ, nhánh 2 chờ
  **179 giây** rồi lọt — sát mép 180 giây đúng 1 giây. Máy bận hơn một chút là hỏng.

- **Vì sao job vẫn báo `done`:** enrich nuốt lỗi từng nhánh và chỉ bật cờ `degraded`;
  graph vẫn ghi bản ghi và đóng job thành công. "Xong" ở đây nghĩa là "chạy hết
  đường", không phải "ra được sơ đồ".

- **Fix:**
  1. `MINDMAP_MODEL=qwen2.5:7b-instruct` (4.68 GB, vừa VRAM, 27 tok/s) ở cả `.env`,
     `BE/.env` và hai file `.env.example`.
  2. `LocalMindmapPipeline._enrich_parallel()` **kẹp** số nhánh song song theo
     `llm_factory.inproc_slots()`. Lấy trần từ chính cổng LLM thay vì bắt hai biến
     env khớp tay — chỉnh một chỗ là đủ, không cấu hình nào tự mâu thuẫn được nữa.
  3. Enrich báo progress NGAY khi nhánh đầu bắt đầu (trước đó im 166 giây, FE hiện
     chip đứng yên và người dùng đọc là treo).

- **Prevention:** cấu hình song song KHÔNG được đoán — phải hỏi tầng đang giới hạn.
  Và khi một `.env` con đè `.env` cha, giá trị thật phải in ra lúc khởi động, nếu
  không thì hai file lệch nhau âm thầm hàng tháng.

## (ĐÃ SỬA 2026-08-26) 14 biến `MINDMAP_*` trong `.env` không có dòng code nào đọc

`MINDMAP_TIMEOUT_SEC`, `MINDMAP_MODEL_FAST/BALANCED/QUALITY/FALLBACK`,
`MINDMAP_SCHEMA_STRICT`, `MINDMAP_MAX_NODES`, `MINDMAP_JOB_TTL_MINUTES`,
`MINDMAP_LLM_TIMEOUT_FAST/BALANCED/QUALITY`, `MINDMAP_JOB_TIMEOUT_FAST/BALANCED/QUALITY`
— grep toàn bộ `app/`, `services/`, `shared/` ra **rỗng**.

Chỉ 4 biến sống: `MINDMAP_MODEL` (`services/mindmap/pipeline/modelcfg.py`),
`MINDMAP_LLM_TIMEOUT_SEC` và `MINDMAP_ENRICH_PARALLEL` (`app/clients/mindmap_factory.py`),
`MINDMAP_SERVICE_ADDR` (`shared/config.py`).

Nguy hiểm ở chỗ chúng trông rất hợp lý. Ai gặp sơ đồ chạy chậm sẽ mở `.env`, thấy
`MINDMAP_TIMEOUT_SEC=240` và `MINDMAP_MODEL_QUALITY`, chỉnh hai cái đó, rồi kết luận
"chỉnh rồi mà vẫn chậm" — trong khi chưa hề chạm vào biến thật.

Đã gỡ hết khỏi `.env` và `.env.example`, thay bằng một khối chú thích liệt kê đúng
4 biến sống kèm file đọc chúng.

## Render free: `SKIP_MODEL_LOAD=1` chặn mọi đường truy vấn có retrieval (2026-09-03)

`SKIP_MODEL_LOAD=1` bật CI mode: ingest ghi log `[vector_store] Skipped append_to_index
(CI mode)` và **không ghi** `/tmp/studymap/index/index.json`. Hệ quả trên production:

- `POST /query` luôn trả `"Không tìm thấy dữ liệu phù hợp trong file đã chọn."` —
  guard chặn TRƯỚC khi gọi LLM, nên đường này không dùng để smoke test provider được.
- `POST /generate-summary` trả 500 `"Không đọc được dữ liệu nguồn: [Errno 2] No such
  file or directory: '/tmp/studymap/index/index.json'"`.
- `POST /api/quizzes/generate` **vẫn chạy**: chunk nằm trong Postgres, không qua FAISS.
  Đây là đường duy nhất chứng minh được LLM production hoạt động khi CI mode đang bật.

Ngoài ra `sources` trong `POST /query` là **stem** (`quang_hop_txt`), không phải
`source_id` UUID — truyền UUID nhận 403 `forbidden_source`, dễ nhầm là lỗi phân quyền.

Instance free 512MB thỉnh thoảng restart giữa chừng khi ingest: request đang bay nhận
502. Script smoke test cần thử lại khi gặp 502, đừng coi là hỏng thật.

## Rerank/embedding trên Render: `SKIP_MODEL_LOAD` chặn nhầm cả provider từ xa (2026-09-04)

`SKIP_MODEL_LOAD=1` có nghĩa "đừng nạp weight vào tiến trình này" — nó tồn tại vì
Render free chỉ có 512MB. Nhưng `rerank.get_reranker()` và `llm_factory.get_embeddings()`
dùng nó như công tắc TẮT HẲN năng lực, nên backend gọi API từ xa (không nạp gì) cũng
bị chặn theo. Kết quả: bật FPT rerank/embedding ở production xong vẫn không có tác dụng.

Đã sửa: cờ chỉ áp cho backend nạp weight cục bộ. `cross_encoder` giữ nguyên hành vi cũ,
có test khoá cả hai chiều.

Còn một cổng NỮA cho rerank: `RERANK_ENABLED`. Production đặt `0` (vì cross-encoder
~2.3GB sẽ OOM giữa request). Backend FPT không nạp gì nên cờ đó đã bật lại thành `1`
kèm giải thích trong `render.yaml`. `NLI_ENABLED` vẫn `0` — NLI vẫn nạp weight thật và
marketplace không có model NLI/zero-shot nào để thay.

## `ask_ai(model=...)` chỉ có tác dụng với Ollama (2026-09-04)

`effective_model = model or _model_map(feature)` chỉ được truyền vào nhánh `ollama`.
Ba provider từ xa (fpt/gemini/groq) dùng biến env model riêng của chúng. Dưới FPT:

    SLM_MODEL_CHAT, SLM_MODEL_SUMMARY, SLM_MODEL_INTENT, MINDMAP_MODEL, QUIZ_MODEL
    -> KHÔNG còn tác dụng, mọi feature dùng chung FPT_AI_CHAT_MODEL

Không phải lỗi, nhưng ai đọc `.env` sẽ tưởng năm biến kia đang điều khiển cái gì đó.
Muốn chọn model theo từng tác vụ trên FPT thì phải thêm `FPT_AI_QUIZ_MODEL`… — chưa làm.

## Index truy hồi trên Render free: ephemeral, và chunk chưa có `embedding_id` (2026-09-04)

Hai chuyện tách biệt, cùng chặn việc bật embedding ở production:

1. `INDEX_DIR` nằm trên đĩa PHÙ DU. Dựng lại index xong thì nó mất sau lần khởi động
   kế tiếp. Đã thấy instance restart nhiều lần trong một phiên làm việc.
2. Mọi chunk ở production có `document_chunks.embedding_id = NULL`, vì `SKIP_MODEL_LOAD=1`
   bỏ qua đường ghi index nên chưa có id FAISS nào được gán. `semantic_search` tra
   ngược kết quả FAISS về chunk QUA cột này. Nên dựng lại index bắt buộc kèm một lượt
   ghi cột đó — nếu không thì index có vector mà không ai tra ngược được.

`app/domains/vectorstore/rebuild.py` xử lý cả hai (ghi `embedding_id` SAU khi thăng cấp
thành công), nhưng KHÔNG có gì tự gọi nó. Chạy tay:
`python -m scripts.dung_lai_index_tu_postgres --dry-run`.

Persistence: `app/domains/documents/storage.py` (Supabase Storage) là cơ chế lưu bền
DUY NHẤT có sẵn trong kho — nhưng production thiếu `SUPABASE_URL`/`SUPABASE_SECRET_KEY`
nên nó chưa dùng được, và nó cũng chưa được nối vào vòng đời index.

## Lưu bền index: có mã, chưa bật, và còn thiếu đúng hai biến (2026-09-04)

`app/domains/vectorstore/persistence.py` dựng xong hai giai đoạn còn thiếu của vòng
đời index — lưu bền sau khi thăng cấp, và khôi phục lúc khởi động. Nhưng nó TẮT ở
production, và bật được cần ba thứ, thiếu bất kỳ cái nào là no-op:

    INDEX_PERSISTENCE_ENABLED=1     (chưa đặt)
    SUPABASE_URL                    (chưa đặt)
    SUPABASE_SECRET_KEY             (chưa đặt)

`SUPABASE_STORAGE_BUCKET=documents` đã có sẵn.

**Kho object KHÔNG có thao tác nguyên tử nhiều object.** Supabase Storage không có
commit nhiều file, cũng không có rename nguyên tử. Nên tính nguyên tử phải dựng bằng
tay và THỨ TỰ là toàn bộ tài sản an toàn:

    file artifact  ->  manifest.json  ->  đọc lại kiểm  ->  current.json

`manifest.json` tồn tại là bằng chứng version ấy đủ file; `current.json` chỉ đổi sau
khi manifest đã đọc lại được. Upload đứt giữa chừng để lại một version MỒ CÔI (vô hại,
không ai trỏ tới) chứ không bao giờ để lại một con trỏ trỏ vào artifact thiếu file.

**Một bẫy đã mắc khi thiết kế:** bản đầu đưa số chiều vào slug từ xa
(`..._d1024__v1.2`). Lúc khôi phục thì chưa biết số chiều — phải tải index về mới biết
— nên hai bên tính ra hai tiền tố khác nhau và không bao giờ gặp nhau. Slug giờ chỉ
gồm provider + model + strategy; số chiều là HỆ QUẢ của bộ ba đó, và vẫn được kiểm
lúc thẩm định (đối chiếu cả metadata lẫn manifest).

**Đường LC cần `index.pkl`.** ĐÃ GIẢI QUYẾT 2026-09-04 — xem mục "Định dạng index
canonical" bên dưới. Ghi lại nguyên trạng vấn đề để hiểu vì sao có mục ấy: `env_loader`
setdefault `USE_LC_VECTOR_STORE=1` nên app thật đi đường LangChain và `FAISS.load_local`
đòi `index.faiss` + `index.pkl`, trong khi `rebuild.py` chỉ sinh `index.faiss` +
`index.json`. Index dựng lại vì thế đọc qua nhánh fallback legacy — chạy được, nên
trông như ổn.


## Định dạng index CANONICAL: LangChain FAISS, ba file (2026-09-04)

Kho từng có HAI định dạng index ghi vào CÙNG tên file `index.faiss`:

| Đường ghi | Sinh ra | Số trong `index.faiss` nghĩa là gì |
|---|---|---|
| `append_chunks_to_lc_index` (ingest thật) | `index.faiss` + `index.pkl` | vị trí trong `IndexFlatL2` |
| `rebuild._ghi_staging` (bản cũ) | `index.faiss` | `chunk_id`, vì là `IndexIDMap` |

Hai nghĩa khác nhau, một tên file, và không chỗ nào đối chiếu. Chúng trùng khớp được
chỉ vì rebuild đánh id 0..N-1 đúng theo thứ tự khoá trong `index.json`.

**Chốt: canonical = LangChain FAISS**, bộ ba `index.faiss` + `index.pkl` +
`index.json`. Lý do chọn nó chứ không chọn legacy: đó đã là thứ đường ingest của ứng
dụng sinh ra, là thứ `USE_LC_VECTOR_STORE=1` (mặc định của `env_loader`) đọc, và
LangChain vốn đã là dependency. Chọn legacy thì phải sửa loader ở nhiều nơi và bỏ
`similarity_search_with_score`.

`rebuild.py` giờ ghi đúng bộ canonical. `chunks.sqlite` là file tuỳ chọn thật
(`index.json` đã có text inline). `index.pkl` KHÔNG tuỳ chọn.

### Ba lỗ mất dữ liệu bịt được cùng lúc

1. **Ingest đè mất index.** `append_chunks_to_lc_index` gọi `load_vectorstore()`,
   nhận `None`, rồi dựng vectorstore MỚI chỉ từ chunk đang thêm và `save_local` đè lên
   `index.faiss`. `load_vectorstore()` trả `None` cho BA lý do khác hẳn nhau: chưa có
   index (bình thường), thiếu `index.pkl`, và lệch danh tính. Hai lý do sau mà đi tiếp
   là mất sạch vector cũ trong khi `index.json` vẫn liệt kê chúng. Giờ: có file index
   trên đĩa mà không nạp được thì ném `IndexIdentityMismatch`.
2. **Hàng rào danh tính bị đường LC lách.** `append_to_index` rẽ sang
   `append_chunks_to_lc_index` TRƯỚC khi tới chỗ kiểm danh tính, nên hàng rào thêm ở
   33d9059 chỉ bảo vệ nhánh legacy. Giờ nhánh LC kiểm trước khi ghi, và
   `IndexIdentityMismatch` KHÔNG bị `except Exception` nuốt để rơi xuống legacy —
   rơi xuống đó thì `_load_index` thấy file không phải `IndexIDMap` và dựng một cái
   rỗng đè lên, đúng cái vừa ngăn theo đường khác.
3. **Thẩm định không chạm pickle.** `faiss.read_index` mở được `index.faiss` KHÔNG
   chứng minh artifact dùng được: pickle hỏng chỉ lộ ra lúc `FAISS.load_local` giải
   mã. Bản đầu dừng ở `read_index` nên một `index.pkl` hỏng đi lọt, được thăng cấp,
   rồi hỏng về sau. Giờ thẩm định NẠP THỬ bằng đúng loader production dùng, ở thư mục
   staging, trước khi thăng cấp.

### `SKIP_MODEL_LOAD` chặn nhầm — lần thứ BA

`hybrid.retrieve_faiss_only` mở đầu bằng `if os.getenv("SKIP_MODEL_LOAD") == "1":
return []`. Production chạy đúng cờ đó, nên kể cả khi bật FPT embedding và có index
hợp lệ, nửa FAISS của truy hồi lai vẫn biến mất — chỉ còn BM25, không một lỗi nào.
Đây là chỗ thứ ba mắc cùng lỗi (trước đó: `get_reranker`, `get_embeddings`). Luật:
cờ ấy nghĩa là "đừng nạp weight vào tiến trình này", KHÔNG phải "đừng dùng năng lực
này"; provider từ xa không nạp gì nên không bị nó áp.

### Tương thích ngược

Index legacy (thiếu `index.pkl`) KHÔNG bị xoá, KHÔNG bị tự chuyển đổi. Nó chỉ bị từ
chối ở hai chỗ cần canonical: `doc_artifact` không cho đẩy lên kho (đẩy một artifact
thiếu `index.pkl` là gài mìn cho mọi instance khôi phục nó), và ingest không cho ghi
đè lên nó. Muốn dùng tiếp thì dựng lại:
`python -m scripts.dung_lai_index_tu_postgres --dry-run`.

## Còn 6 chỗ `SKIP_MODEL_LOAD` chặn nhầm — CHƯA sửa, ngoài phạm vi (2026-09-04)

Quét cả kho sau khi mắc lỗi này lần thứ ba. Đường truy hồi đã sửa xong (`retrieve`,
`retrieve_scored`, `retrieve_faiss_only`, `retrieve_bm25_only`, `get_reranker`,
`get_embeddings`, `_skip_faiss_in_ci`). Sáu chỗ dưới đây **vẫn chặn theo cờ**, và mỗi
chỗ là một tính năng lặng lẽ suy giảm ở production dù chat FPT chạy tốt:

| Chỗ | Hậu quả khi `SKIP_MODEL_LOAD=1` |
|---|---|
| `services/summary/pipeline/summarize.py:125` | trả section rỗng + `missing`, tóm tắt luôn degraded |
| `services/summary/pipeline/synthesize.py:27` | không tổng hợp |
| `services/mindmap/pipeline/outline.py:32` | không dựng mục lục bằng LLM |
| `services/mindmap/pipeline/relations.py:28` | không sinh quan hệ giữa nhánh |
| `services/mindmap/pipeline/enrich.py:111` | không làm giàu nút |
| `domains/cache/llm_cache.py:354` | cache ngữ nghĩa tắt (chỗ này ĐÚNG — nó cần embedding) |

Năm chỗ đầu gọi `ask_ai`, tức chat — **không nạp weight nào**. Cờ ở đó nói về RAM
nhưng đang được đọc như "không có model nào để dùng". Production hiện chưa lộ ra vì
summary/mindmap còn tắc ở chỗ thiếu index; sửa xong index thì chúng vẫn degraded.

KHÔNG sửa trong phase định dạng index: đổi hành vi summary/mindmap là thay đổi ngữ
nghĩa của tính năng khác, cần phase riêng và bộ test riêng.

### Bảng chi tiết 6 chỗ còn lại (audit 2026-09-04, KHÔNG sửa)

| File:dòng | Hàm | Hành vi khi `SKIP_MODEL_LOAD=1` | Vì sao cờ chặn sai | Ảnh hưởng |
|---|---|---|---|---|
| `services/summary/pipeline/summarize.py:125` | `summarize_sections` | trả section rỗng + `missing["section:<title>"]` | gọi `ask_ai` (chat), không nạp weight nào | tóm tắt |
| `services/summary/pipeline/synthesize.py:27` | `synthesize` | trả `fallback, True` (degraded) | như trên | tóm tắt |
| `services/mindmap/pipeline/outline.py:32` | `build_outline` | trả `None`, skeleton giữ nguyên "single" | như trên | mindmap, study map |
| `services/mindmap/pipeline/relations.py:28` | `extract_relations` | trả `[], True` — không có quan hệ giữa nhánh | như trên | mindmap, study map |
| `services/mindmap/pipeline/enrich.py:111` | `enrich_branches` | trả skeleton chưa làm giàu | như trên | mindmap, study map |
| `app/domains/cache/llm_cache.py:354` | `judge_reuse` | trả `False` (không tái dùng cache biên) | **ĐÚNG** — judge cần embedding để so ngữ nghĩa | /query (chỉ giảm tỉ lệ trúng cache) |

Năm hàng đầu đều gọi `ask_ai`, tức CHAT — không nạp weight nào, và chat FPT đang chạy
tốt ở production. Chúng bị chặn bởi một cờ nói về RAM.

KHÔNG ảnh hưởng `/query`: đường sinh đáp án RAG đi qua `summary/qa_chain`, không qua
`services/summary/pipeline`.

Chưa lộ ra ở production vì summary/mindmap còn tắc ở chỗ thiếu index. Sửa xong index
thì chúng vẫn degraded — cần một phase riêng với bộ test riêng, vì đổi hành vi của
chúng là đổi ngữ nghĩa tính năng khác.

## (ĐÃ SỬA 2026-09-04) Bộ test chạy thẳng vào database PRODUCTION

Suốt nhiều tuần, mọi lượt `pytest` **cục bộ** đọc `DATABASE_URL` từ `BE/.env` và nối
vào database Supabase production. Fixture tạo user/tài liệu thật ở đó, và bước dọn dẹp
của conftest chạy `sa_delete(Document)` — **xoá cứng**.

**Vì sao không ai thấy:** `BE/.env` dùng cổng **6543**, production dùng **5432**. Hai
URL trông khác nhau. Chúng là **cùng một database** — Supabase mở nó ở cả hai cổng
(session pooler / transaction pooler). So chuỗi URL thì thấy khác; so host + tên
database thì giống hệt.

**Bằng chứng:** 8 user mới nhất trong database production đều là fixture pytest
(`search_o_*`, `owner_*`, `quiz_o_*`, `att_o_*`, `prac_o_*`, `gap_o_*`, `smap_o_*`),
tạo lúc 03:18–03:38 UTC ngày 2026-09-04 — đúng khoảng một lượt chạy suite đầy đủ. Hai
trong 11 tài liệu production (`cua nguoi khac.md`, `own (2).md`) là fixture của chính
lượt chạy ấy.

CI thì **không** dính: nó vốn đã dùng Postgres service container riêng.

**Cách sửa:** `app/db.database_url()` — điểm DUY NHẤT resolve URL, alembic cũng đi qua
đây — giờ đòi `TEST_DATABASE_URL` khi đang chạy dưới pytest và **KHÔNG rơi về**
`DATABASE_URL`. Thiếu nó thì ném `DatabaseNotConfigured` chứ không nối bừa.

Ba chi tiết đáng giữ:

1. **Nhận diện pytest qua `sys.modules`, không qua một cờ do conftest đặt.** Conftest
   chạy sau khi pytest đã import vài thứ, nên một cờ để lại cửa sổ mà một import sớm
   mở kết nối trước khi cờ kịp có.
2. **Danh tính đích chỉ gồm host + tên database.** Bỏ cổng (đó là cái đã che mắt) và
   bỏ cả user/mật khẩu — chúng nói AI kết nối, không nói kết nối tới ĐÂU. Bản đầu tôi
   đưa user vào và test bắt được ngay: hai tài khoản khác nhau trỏ cùng một database
   sẽ bị coi là hai đích, và hàng rào im lặng không nổ.
3. **CI không đặt `DATABASE_URL` ở mức job nữa** — chỉ đặt cho bước migration và bước
   smoke boot. Trong bước `pytest` không có gì để rơi về thì không có đường nào rơi.

Guard `pytest.skip` của 11 module test đổi sang đọc `TEST_DATABASE_URL`: không có
database test thì các test cần DB **skip**, không phải chạy vào production.

Dựng database test: `python -m scripts.setup_test_db` (script chỉ đọc
`TEST_DATABASE_URL`, không bao giờ lấy đích từ `DATABASE_URL`, và từ chối chạy nếu hai
biến trỏ cùng một database).

## Allowlist tường minh cho ngữ liệu vào index production (2026-09-04)

Luật DUY NHẤT: **không tài liệu nào vào index production trừ khi có bản ghi tường minh
với `classification = CONFIRMED_PRODUCTION` VÀ `eligible_for_index = true`.** Vắng mặt
không bao giờ là cho phép.

Vì sao allowlist chứ không phải blocklist: trong 11 tài liệu production, **5 tài liệu
(184/189 chunk — 97%) không phân loại được** bằng bằng chứng trực tiếp. Với tỉ lệ ấy,
danh sách chặn để lọt mọi thứ chưa nghĩ ra; danh sách cho phép chặn mọi thứ chưa nghĩ
ra. Đó là khác biệt giữa an toàn và may.

Nguồn: `BE/config/production_index_allowlist.json` — file trong kho mã, KHÔNG phải
bảng DB. Quyết định "tài liệu này được index" là quyết định của con người, cần review
như mã (pull request, git blame), và không cần migration chạm schema production.

**Phân loại ≠ được index.** `CONFIRMED_PRODUCTION` + `eligible_for_index=false` là
trạng thái hợp lệ. Mã không được coi "không phải test" là "an toàn để index".

**Chỗ đặt hàng rào:** trong `rebuild_index_tu_postgres`, lọc `ban_ghi` KỂ CẢ khi người
gọi truyền sẵn. Nếu lọc chỉ nằm ở `doc_chunks_tu_db` thì ai truyền danh sách của mình
sẽ lách được — mà lách được nghĩa là hàng rào không tồn tại. Không có sentinel "bỏ qua
kiểm tra": test phải khai allowlist tường minh, y như production.

**Trạng thái hôm nay:** 0 tài liệu eligible, 189 chunk bị chặn, 184 chunk mơ hồ.
`test_allowlist_that_KHONG_cho_phep_tai_lieu_nao` sẽ ĐỎ khi ai đó thêm mục eligible
đầu tiên — cố ý, để việc ấy được nhìn thấy chứ không lặng lẽ.

### Đường ingest KHÔNG đi qua allowlist — cố ý, đã cân nhắc

`store.append_to_index()` (upload → FAISS) vẫn index mọi tài liệu người dùng tải lên.
Đưa nó qua allowlist sẽ làm hỏng sản phẩm: người dùng upload xong không tìm được tài
liệu của chính mình. Allowlist chỉ quản đường **dựng lại hàng loạt từ Postgres** —
nơi một lần chạy quét toàn bộ kho và biến mọi thứ có sẵn thành vector.

### Bằng chứng phân loại (mẫu để lần sau làm theo)

Chỉ hai tài liệu có bằng chứng TRỰC TIẾP TRONG MÃ:
`tests/test_search_api.py:122` sinh `search_o_{uuid4().hex[:8]}@example.com`, và
`tests/test_source_ownership.py:98` sinh `owner_{uuid4().hex[:8]}@example.com` — khớp
đúng hai chủ sở hữu, với dấu thời gian nằm trong lượt chạy suite 03:18–03:38 UTC.

Email chứa chữ "test"/"demo", tên file trông chính đáng, hay nội dung trông như tài
liệu thật đều **không** phải bằng chứng, và không được dùng để phân loại.

---

## Không hàng nào trong "DB production" do production nạp (2026-09-04)

Điều tra nguồn gốc 5 tài liệu AMBIGUOUS, chỉ đọc, không sửa dữ liệu. Trường quyết định
không nằm ở email, tên file hay nội dung mà ở `documents.metadata_json->>'input_path'`:

```
9/11 hàng:  e:\memvid_NCKH\...\BE\input_docs\<tên file>
2/11 hàng:  C:\Users\...\Temp\pytest-of-...\data_dir0\input_docs\<tên file>
```

Ổ `E:` là máy trạm Windows. Render chạy Linux, không có ổ `E:`. Nên **cả 11 hàng đều do
máy dev nạp, không hàng nào do service production nạp** — `CONFIRMED_PRODUCTION` bị loại
bằng bằng chứng ngược, chứ không phải vì thiếu bằng chứng.

Trường này tin được vì **server ghi, không phải client gửi**: `main.py:1880` truyền
`input_path=save_path`, mà `save_path = _safe_save_path(filename)` chạy `os.path.basename`
rồi fold `[<>:"/\|?*]` trước khi `os.path.join(INPUT_DIR, ...)`. Client không có cách nào
chèn `e:\...\` vào đó.

Hai chuỗi nhân quả đầy đủ tìm được:

| tài liệu | lệnh gây ra nó |
|---|---|
| `thu-don-tam-f3633a.html` | commit `56a276f` ghi nguyên văn "Smoke thật: upload .html mới -> input_docs có 1 file -> ingest completed"; hàng này là .html duy nhất tạo 18:37:44 +07, **2 phút trước** commit; tên = chủ đề commit |
| 4 tài liệu `smoke+11ffbb29` | commit `d3d5eb8` "9 định dạng tài liệu mới" (11:49 +07); 4 upload .pptx/.xlsx/.html/.epub lúc 12:22 +07 cùng ngày |

Cùng commit `56a276f` còn ghi `don_input_docs.py` "Đã chạy: **9/9 file** đối chiếu được" —
đúng bằng 9 tài liệu có trong DB lúc đó, tức `input_docs/` của máy dev khớp 1:1 với kho.

**4 hàng vẫn AMBIGUOUS.** Loại được "dữ liệu người dùng thật" KHÔNG đồng nghĩa chứng minh
được "do test/smoke sinh ra". `Day08- RAG Pipeline.docx` là ca sát nhất mà vẫn không đủ:
commit `7683e3b` gọi tên nó với đúng 18 chunk, và `knowledge_maps` có hàng probe
`7bf18385-…` mà plan vòng 3 tự nhận "do tao sinh ra lúc dò lỗi" — nhưng tất cả đều diễn ra
**sau** lượt upload, nên chỉ chứng minh nó ĐƯỢC DÙNG để đo, không chứng minh lượt upload.

---

## CHƯA XÁC ĐỊNH: Render production đang trỏ vào database nào (2026-09-04)

`DATABASE_URL` khai `sync: false` trong `render.yaml`, tức chỉ tồn tại trong dashboard
Render. Không API đọc nào của Render trả về giá trị biến môi trường, nên **không đọc
được từ đây**. Đo gián tiếp cho hai kết quả NGƯỢC NHAU, và cả hai đều chắc:

**Từng là database dev — ít nhất tới 2026-09-03 ~13:33 UTC.** Hai lượt đăng ký khớp
đến từng giây, từ hai thiết bị khác nhau:

| log production | `users.created_at` trong DB dev |
|---|---|
| `09:20:14.546Z POST /auth/register 201` (Chrome/Windows) | `levuanhhihihi@gmail.com` `09:20:14.266Z` |
| `13:33:01.968Z POST /auth/register 201` (Android/Zalo) | `sunny@gmail.com` `13:33:01.696Z` |

Hàng nằm trước dòng log ~0,27 s — đúng thứ tự insert rồi mới trả lời.

**Không còn là database đó từ 2026-09-03 ~17:17 UTC.** Sáu lượt `POST /auth/register`
trả `201` trong khoảng 17:17–17:23 (`fpt-smoke-<hex>@example.com`,
`verify-<hex>@example.com`, do script smoke của chính tôi gọi). `users_store.create_user`
KHÔNG có store dự phòng — `201` nghĩa là một hàng Postgres đã commit. Trong DB dev:
`SELECT count(*) FROM users WHERE email LIKE 'verify-%'` = **0**, và không mã nào trong
kho hay trong script smoke xoá user. Giữa hai mốc có một deploy `trigger: api` lúc
`2026-09-03T17:06:52`.

Alembic CHƯA BAO GIỜ in dòng `Running upgrade` trên bất kỳ build Render nào, kể cả build
đầu tiên — nên database mà production nói chuyện đã ở head trước khi Render kết nối lần
đầu. Điều đó loại giả thuyết "trỏ sang một Supabase project trống mới tạo".

**Không đoán tiếp.** Bước tiếp theo phải do người làm: mở dashboard Render, đọc host và
tên database của `DATABASE_URL`, ghi vào `docs/deployment/database-boundary.md`. Cách duy
nhất để máy tự trả lời là gọi `/auth/register` với một email đã có — trả 409 nếu chung DB,
nhưng trả 201 và TẠO một hàng nếu khác DB. Đó là ghi vào production, nên không làm.

## Hostname pooler của Supabase KHÔNG phân biệt được project (2026-09-04)

Mọi project Supabase cùng vùng dùng chung một hostname pooler
(`aws-0-<region>.pooler.supabase.com`) và cùng tên database `postgres`. Thứ chọn project
nằm trong USERNAME: `postgres.<project_ref>`.

`app/db._danh_tinh_dich()` cố ý bỏ username, nên nó coi **hai project Supabase khác nhau
là cùng một đích**. Hệ quả: dùng một project Supabase riêng làm `TEST_DATABASE_URL` sẽ bị
chặn. Đó là phía an toàn của sai số — chặn nhầm thì mất công, cho qua nhầm thì mất dữ liệu.

**Không được "sửa" bằng cách đưa username vào danh tính.** Làm thế là mở lại đúng cái lỗ
hai tài khoản cùng trỏ một database bị coi là hai đích — chính là lỗ đã để pytest xoá cứng
dữ liệu suốt nhiều tuần. Muốn DB test riêng thì dùng Postgres cục bộ hoặc container CI
(`scripts/setup_test_db.py`).

Regression: `test_db_isolation.py::test_hai_du_an_supabase_khac_nhau_bi_coi_la_MOT_dich`.

---

## (SỬA LẠI KẾT LUẬN 2026-09-04) Render production DÙNG CHUNG database với máy dev

Mục "CHƯA XÁC ĐỊNH: Render production đang trỏ vào database nào" ở trên kết luận sai ở
nửa sau. Người dùng đã mở dashboard Render đọc `DATABASE_URL`: host, cổng, tên database và
project ref của Supabase **trùng khớp hoàn toàn** với `DATABASE_URL` của máy dev.

```
host      aws-0-ap-northeast-2.pooler.supabase.com
port      5432          (BE/.env dùng 6543 — pooler còn lại của CÙNG database)
database  postgres
project   cùng project ref với dev (đối chiếu bằng so sánh, không in ra)
```

**Chỉ có một database.** Render production, app cục bộ, và — cho tới `3058272` — cả bộ
pytest đều ghi vào đó.

### Lập luận sai ở chỗ nào

Tôi suy ra "production không còn ghi vào DB này" từ chỗ sáu lượt `POST /auth/register`
trả `201` lúc 17:17–17:23 UTC ngày 2026-09-03 mà không có hàng `users` nào khớp.

Sai vì **vắng mặt không chứng minh được gì trong database này — hàng ở đây bị xoá cứng
thường xuyên.** Đo lại, chỉ đọc:

```
document_id riêng biệt từng xuất hiện trong jobs   1401
jobs còn trỏ tới một tài liệu còn tồn tại             4
documents hiện có                                    11
document_chunks mồ côi                                0
```

Khoảng 1.397 tài liệu đã được tạo rồi xoá cứng trong vòng đời DB này — bộ pytest chạy
thẳng vào đó suốt nhiều tuần. Một hàng biến mất là trạng thái BÌNH THƯỜNG ở đây, không
phải tín hiệu.

Hai lượt đăng ký khớp đến từng giây (09:20:14 và 13:33:01) vẫn đứng vững — chúng là bằng
chứng KHẲNG ĐỊNH. Chỉ suy luận PHỦ ĐỊNH là sai.

**Quy tắc rút ra:** trong một kho dữ liệu có xoá cứng, chỉ suy luận từ cái CÓ MẶT. Muốn
dùng cái vắng mặt làm bằng chứng thì phải chứng minh trước rằng kho đó không xoá.

### Ngữ liệu production, kiểm kê 2026-09-04

`users 24 · documents 11 · document_chunks 189` (completed 8, processing 2, failed 1;
1 tài liệu 0 chunk). Cả 11 vẫn `eligible_for_index=false`. Không tài liệu nào do service
production nạp — xem mục "Không hàng nào trong 'DB production' do production nạp".
Chi tiết bảng ở `docs/deployment/database-boundary.md`.

---

## `ingest_origin`: điều kiện thứ ba để một tài liệu vào index (2026-09-04)

Bốn manh mối từng dùng để đoán nguồn gốc tài liệu đều hỏng theo một kiểu khác nhau:

| manh mối | hỏng ở đâu |
|---|---|
| tên file, email chủ sở hữu | người dùng đặt — `demo@local.test` có thể là người thật |
| `metadata_json.input_path` | server ghi nên tin được, nhưng trả lời "chạy trên MÁY nào", không phải "với VAI TRÒ gì". Container Linux của CI và của production cho đường dẫn giống hệt |
| dấu thời gian | nói "gần nhau", không nói "vì nhau" |
| hàng còn hay mất | vô nghĩa ở kho này — ~1.397 tài liệu đã bị xoá cứng |

Nên thêm `metadata_json.ingest_origin`, ghi MỘT lần lúc tạo hàng, bởi chính tiến trình
đang chạy: `production` | `test` | `local`.

**Client không chạm được.** `repository.create()` KHÔNG có tham số nhận nguồn — nó tự gọi
`provenance.nguon_ingest()`. Không có tham số thì không route nào chuyền được giá trị từ
request vào. Regression: `test_route_upload_KHONG_chuyen_gi_ve_nguon_xuong_repository`
bắn một request mang nhãn giả ở form field, JSON, header và query string cùng lúc rồi
bắt lấy kwargs thật mà route truyền xuống.

**pytest thắng cấu hình.** Thứ tự kiểm trong `nguon_ingest()` không đổi được: cờ pytest
trước, `INGEST_ORIGIN` sau. Một biến còn sót trong shell hay một `.env` bê nhầm từ
production về sẽ khiến mọi tài liệu do bộ test sinh ra mang nhãn production — mà nhãn đó
là thứ duy nhất cho phép một tài liệu vào index.

**Mặc định đóng.** Thiếu biến, biến rỗng, sai chính tả (`prod`, `producton`) → `local`.
Không đoán hộ lỗi gõ: đoán hộ là cách một tài liệu thử nghiệm lọt vào index production.

`allowlist.duoc_index()` giờ đòi BA điều kiện, là VÀ:

```
classification == CONFIRMED_PRODUCTION   (con người quyết, ghi trong file)
eligible_for_index is True               (con người quyết, ghi trong file)
ingest_origin == "production"            (MÁY ghi lúc tạo hàng)
```

Hai điều kiện đầu nằm trong một file người ta sửa được; điều kiện thứ ba thì không. Người
viết sai file thì hàng rào vẫn đứng.

Nguồn gốc đi cùng chunk từ `doc_chunks_tu_db` xuống tận `loc_ban_ghi`, KHÔNG tra DB lại ở
tầng lọc: tra hai lần là hai lần có thể lệch, mà lệch về phía nào cũng là một tài liệu
vào nhầm index.

**11 tài liệu hiện có đều không mang nhãn** (tạo trước khi có trường này) nên vẫn bị chặn.
KHÔNG được UPDATE chúng để gắn nhãn — đó là ngụy tạo bằng chứng, không phải sửa dữ liệu.
Regression: `test_11_tai_lieu_hien_tai_van_KHONG_the_vao_index`.

## `/api/config/status`: production tự khai cấu hình đang chạy (2026-09-04)

Suốt hai phase kiểm toán, câu hỏi "production ĐANG chạy cấu hình gì" chỉ trả lời được
bằng suy đoán: `render.yaml` khai `sync: false` cho mọi biến nhạy cảm, và không API đọc
nào của Render trả về giá trị biến môi trường. Một lần suy đoán sai đã dẫn tới kết luận
ngược hẳn về việc production dùng database nào (xem mục "SỬA LẠI KẾT LUẬN").

Rẻ hơn nhiều là để chính tiến trình đó tự khai. `GET /api/config/status`, không xác thực,
trả TÊN và CỜ:

```
ingest_origin · llm_providers · embedding{enabled,provider,model,strategy}
rerank{enabled,backend} · vision{available,model} · index_persistence_enabled
skip_model_load · fpt_api_key_present
```

**Không bao giờ giá trị bí mật.** Khoá API chỉ báo có/không — cùng quy ước với
`fpt_api_key()`. Regression `test_config_status_KHONG_lo_gia_tri_khoa` đặt một khoá giả
vào env rồi khẳng định nó không xuất hiện ở bất kỳ đâu trong body.

Không xác thực có chủ đích: nếu phải có token thì phải tạo user để dùng, mà tạo user là
ghi vào production — đúng thứ mà endpoint này sinh ra để khỏi phải làm. Bề mặt lộ ra
tương đương `/api/vision/status` vốn đã không xác thực.

`tests/snapshots/url_map.json` +1 rule (83). Đó là điểm chính của ảnh chụp đó: một route
mới phải hiện ra trong code review.

---

## Tài liệu production ĐẦU TIÊN — và ba thứ chặn ở mắt xích embedding (2026-09-04)

Nạp qua đường thật: `POST /auth/register` → `POST /upload-file` tới
`studymap-api-keq6.onrender.com`. Không pytest, không script ghi thẳng DB, không seed.

```
document_id   7a70a7d0-a678-4fcb-b983-9df66b49cbba
filename      production-embedding-smoke-2026-09-04.txt
ingest_origin production          <- server ghi, client không đặt được
input_path    /tmp/studymap/input_docs/...   <- POSIX của Render, không phải ổ E:
status        completed · 3 chunk (index 0..2) · 2.806 B / 2.220 ký tự
```

Allowlist: `CONFIRMED_PRODUCTION` + `eligible_for_index=true`. Kiểm kê ra đúng
**1 tài liệu / 3 chunk eligible**, 10 tài liệu / 189 chunk vẫn blocked.

### 1. Xem trước của rebuild nói SAI quy mô — đã sửa

`--dry-run` in tổng số chunk đọc từ DB (192) trong khi hàng rào allowlist nằm bên trong
`rebuild_index_tu_postgres`, tức việc thật chỉ embed 3. Sai theo hướng nguy hiểm nhất:
người đọc tưởng sắp trả tiền cho 192 lượt gọi, hoặc tệ hơn, tưởng 189 chunk cũ sắp vào
index. Nay dry-run áp allowlist trước khi in:

```
Qua allowlist : 1 tài liệu / 3 chunk SẼ được embed
Bị chặn       : 10 tài liệu / 189 chunk
  + 7a70a7d0-…  3 chunk
```

Và `--thuc-hien` với danh sách rỗng thì dừng hẳn thay vì đi tiếp vào `rebuild`.

### 2. `document_chunks.embedding_model` ghi NHÃN CẤU HÌNH, không phải model đã dùng

Chunk mới ghi `sentence-transformers/all-MiniLM-L6-v2` trong khi production embed bằng
FPT `Vietnamese_Embedding`. Nguồn: `ingest_graph.py:235` lấy `s_cfg.embedding_model_name`
— tức `EMBEDDING_MODEL_NAME` env hoặc hằng mặc định, **không hỏi** đối tượng embeddings
thật đang dùng. `embedding_dim` để trống.

Không sửa ở phase này (đổi hành vi ingest cần bộ test riêng), nhưng phải biết: cột đó
KHÔNG dùng để nhận diện không gian vector được. Danh tính thật nằm ở `index.json`, do
`embedding_identity()` ghi.

### 3. DỪNG ở mắt xích embedding: máy dev không có khoá FPT

`FPT_AI_API_KEY` chỉ tồn tại trên Render (đặt làm secret env var, cố ý không nằm trong
kho mã và không có trong `.env` nào cục bộ). Nên **không dựng được index FPT từ máy này**:

```
Danh tính embedding: {'embedding_provider': 'local', 'embedding_model_name': 'BAAI/bge-m3',
                      'embedding_strategy': 'mean_late'}
Lưu ý: FPT embedding CHƯA bật — index sẽ mang danh tính model cục bộ.
```

Hàng rào hoạt động đúng: thiếu khoá thì `fpt_embedding_enabled()` False và script nói
thẳng rằng index sẽ mang danh tính sai. Dựng tiếp lúc này là tạo một index `bge-m3` rồi
gọi nó là index production — đúng loại nhầm mà cả chuỗi phase này sinh ra để chặn.

### 4. Retrieval production không kiểm được vì đĩa phù du + phạm vi quyền

Ingest production có dựng FAISS trong `/tmp` (chunk được gán `embedding_id` 0..2,
`can_query=true`). Nhưng instance restart lúc 12:4x (502 rồi lên lại) là `/tmp` sạch.
Thêm nữa `/query` lọc theo quyền sở hữu, nên một tài khoản khác hỏi tài liệu này nhận
`403 forbidden_source` — đúng thiết kế.

Muốn kiểm retrieval trên production thì phải có `INDEX_PERSISTENCE_ENABLED` + khôi phục
lúc khởi động. Chưa bật, và bật nó là quyết định riêng.

---

## Danh tính embedding của chunk lấy từ CẤU HÌNH, không phải provider thật (2026-09-04)

Tài liệu production đầu tiên embed bằng FPT `Vietnamese_Embedding`, còn
`document_chunks.embedding_model` ghi `sentence-transformers/all-MiniLM-L6-v2`.

Không ai nói dối. `ingest_graph._persist_sections_and_chunks` lấy nhãn từ
`shared.config.embedding_model_name` — tức biến `EMBEDDING_MODEL_NAME`, thứ NGƯỜI TA
ĐẶT — thay vì hỏi đối tượng mà `get_embeddings()` thật sự trả về. Biến đó chưa ai đặt
nên rơi về mặc định, và mặc định là một model không hề tham gia.

Một cột nói sai model còn tệ hơn cột trống: cột trống thì người đọc đi tìm, cột sai thì
người đọc tin.

**Sửa:** node hỏi `llm_factory.embedding_identity()` — cùng hàm mà `index.json` dùng.
Ghi `embedding_model` từ đó, và ghi cả bộ ba vào `document_chunks.metadata_json`:

```
metadata_json.embedding_identity = {embedding_provider, embedding_model_name,
                                    embedding_strategy}
```

Ba khoá này ĐÚNG BẰNG `store.INDEX_IDENTITY_KEYS`, để chunk và index so được với nhau.
Không migration: cột `metadata_json` đã có sẵn. Không hard-code provider nào trong
`ingest_graph` — hàm kia tự khai. Không thêm lượt gọi embedding nào chỉ để điền nhãn:
với provider từ xa đó là tiền thật.

`embedding_dim` giữ nguyên cách cũ (chỉ có khi late chunking đã sinh vector). Số chiều
KHÔNG BAO GIỜ đủ để nhận diện không gian vector — bge-m3 và Vietnamese_Embedding đều
1024, đó là cả lý do `check_index_identity` tồn tại.

### KHÔNG đụng `embedding_id` — và vì sao

Kế hoạch ban đầu của phase nói `ingest_graph` lấy `EMBEDDING_MODEL_NAME` để ghi
`embedding_id`. Không phải. `embedding_id` là **id hàng FAISS** dạng chuỗi số:

| | |
|---|---|
| ghi | `ingest_graph` (`faiss_ids` từ lượt append) và `repository.set_chunk_embedding_id` (sau khi rebuild thăng cấp) |
| đọc | `repository.lookup_by_embedding_ids` → `retrieval/search.py:65` |
| vai trò | khoá tra ngược FAISS hit → chunk, có index Postgres `ix_document_chunks_embedding_id` |

Nhồi provider/model/strategy vào đó sẽ phá truy hồi ở mọi lượt hit và làm mồ côi 192
hàng đang có. Danh tính đi vào `metadata_json`; `embedding_id` giữ nguyên vai trò con trỏ.

Không backfill 189 chunk cũ, không sửa 3 chunk production. Nhãn cũ sai vẫn nằm đó — sửa
nó là ngụy tạo dữ liệu; chỗ đúng để sửa là lần ingest sau.

Regression: `tests/test_chunk_embedding_identity.py` (8 test). Đã kiểm ngược: 5/8 đỏ
trên mã cũ.

---

## Ngữ liệu production SẠCH đầu tiên — và vì sao tài liệu production cũ bị thu hồi quyền index (2026-09-04)

`f01ac8c1-830e-45e1-a802-7713c20982c3` · `prod-fpt-embedding-smoke-2026-09-04.txt` ·
3 chunk · nạp qua `POST /upload-file` tới studymap-api-keq6.onrender.com, SAU commit
`373f388`.

Đây là bằng chứng chạy thật của fix danh tính chunk. Cả 3 chunk mang:

```
metadata_json.embedding_identity = {embedding_provider: fpt,
                                    embedding_model_name: Vietnamese_Embedding,
                                    embedding_strategy: api_pooled}
embedding_model = Vietnamese_Embedding      (trước fix: all-MiniLM-L6-v2)
embedding_id    = '0','1','2'               (vẫn là con trỏ hàng FAISS, không đổi vai trò)
ingest_origin   = production
input_path      = /tmp/studymap/input_docs/...   POSIX của Render
```

### Tài liệu production ĐẦU TIÊN (`7a70a7d0-…`) bị THU HỒI quyền index

`eligible_for_index` true → **false**. Phân loại GIỮ NGUYÊN `CONFIRMED_PRODUCTION` —
nguồn gốc là sự thật lịch sử, không thu hồi được; thứ thu hồi được là quyền vào index.

Lý do là kỹ thuật, không phải hành chính: 3 chunk của nó ingest TRƯỚC `373f388` nên
`embedding_identity` NULL và `embedding_model` ghi nhãn sai. Đưa chunk không rõ danh
tính không gian vector vào một index FPT là đúng thứ `check_index_identity` sinh ra để
chặn. Và vì cấm backfill (ngụy tạo dữ liệu), danh tính ấy **không bao giờ xác lập lại
được** cho ba hàng đó — muốn nội dung ấy vào index thì phải upload lại qua production.

Bài học vận hành: một hàng dữ liệu tạo ra trước khi hàng rào tồn tại thì vĩnh viễn
không qua được hàng rào ấy, trừ khi tạo lại. Đó là cái giá của việc không backfill, và
nó rẻ hơn cái giá của việc tin một nhãn do người sau điền hộ.

### Trạng thái allowlist

```
ELIGIBLE_DOCUMENTS 1   ELIGIBLE_CHUNKS 3     (chỉ f01ac8c1-…)
BLOCKED_DOCUMENTS 11   BLOCKED_CHUNKS 192
KHÔNG CÓ BẢN GHI   0
```

Dry-run rebuild in đúng `1 tài liệu / 3 chunk SẼ được embed`, chặn 11 tài liệu / 192 chunk.

### Vẫn DỪNG ở embedding

`FPT_AI_API_KEY` chưa có ở máy dev (`.env`, `BE/.env`, shell: absent) nên không dựng
được index FPT cục bộ. Production thì có khoá và đã embed 3 chunk này lúc ingest, nhưng
index đó nằm trên `/tmp` phù du và không có đường nào lấy ra.

---

## Index FPT production ĐẦU TIÊN — dựng, thẩm định, lưu bền, khôi phục (2026-09-04)

Chuỗi chạy thật, từ ngữ liệu `f01ac8c1-…` (3 chunk, danh tính đúng ngay từ ingest):

```
Kết quả rebuild: promoted True · chunks 3 · dim 1024 · embedding_id_da_ghi 3
                 danh_tinh {fpt, Vietnamese_Embedding, api_pooled}
                 allowlist chặn 192/195 chunk
index.json v1.2  num_chunks 3 · embedding_dim 1024 · vectors_normalized true
FAISS            ntotal 3 · d 1024 · load_local OK · chuẩn L2 = 1.0 · không NaN/Inf
không lẫn        bge-m3 / mean_late / MiniLM / FakeEmbeddings — cả 4 đều vắng
Supabase         index/fpt__Vietnamese_Embedding__api_pooled/
                   current.json  -> version 20260904_215256_8db1b12f8508
                   <version>/{index.faiss,index.pkl,index.json,manifest.json}
                 sha256 remote khớp bytes 3/3 · không credential trong metadata
restore          vào thư mục tạm cô lập: 3 file, identity khớp, ntotal 3, dim 1024
index cũ         BE/index sha256 4/4 KHỚP — không đụng, không append
```

Index mới dựng ở thư mục RIÊNG (`BE/index_production_fpt`), không thăng cấp đè lên
`BE/index` cũ. Đó là cách duy nhất chắc chắn không append vector FPT vào index bge-m3.

### `embedding_id` VA CHẠM khi hai index cùng tồn tại — CHƯA SỬA

`embedding_id` là vị trí hàng FAISS, chỉ duy nhất TRONG MỘT index. Nhưng nó nằm ở một
cột toàn cục và `lookup_by_embedding_ids` tra toàn cục. Sau khi dựng index FPT:

```
emb='0' -> 3 hàng: 2-day24-ragas-guardrails.pdf | prod-fpt-…txt | production-…txt
emb='1' -> 3 hàng   (như trên)
emb='2' -> 3 hàng
tổng embedding_id bị trùng: 3 / 195 hàng có embedding_id
```

`lookup_by_embedding_ids` trả `dict` khoá theo `embedding_id`, nên mỗi khoá chỉ MỘT hàng
sống sót — và truy vấn không có `ORDER BY`, tức hàng nào thắng là **không xác định**.
Văn bản hiển thị lấy từ FAISS (đúng), còn `document_id`/`title`/`chunk_id` lấy từ đây
(có thể sai) → trích dẫn trỏ nhầm tài liệu.

Đo thật hôm nay: cả 3 khoá ra ĐÚNG tài liệu mới. Đó là may, không phải đảm bảo.

Ở production `AUTH_PROTECT_APP_APIS=true` nên `user_id` lọc bớt (ba tài liệu khác chủ),
nhưng chế độ mở truyền `user_id=None` thì không còn gì đỡ.

Kho mã đã biết vấn đề này: `repository.clear_chunk_embedding_ids` có docstring "dùng khi
index bị vứt đi — để `embedding_id` trỏ vào một index không còn tồn tại thì
`lookup_by_embedding_ids` trả về chunk cho những hit không có thật". Nhưng rebuild hiện
chỉ GHI id cho chunk được index, không XOÁ id của chunk bị loại.

KHÔNG sửa ở phase này: xoá `embedding_id` của 192 chunk cũ là ghi vào dữ liệu cũ, mà
phase này cấm. Cần một phase riêng, và lựa chọn đúng có lẽ là dọn trong chính vòng đời
rebuild (thăng cấp xong thì mọi chunk ngoài index mới phải mất `embedding_id`).

## Supabase Storage CHƯA cấu hình ở production — bản gốc người dùng nằm trên đĩa phù du (2026-09-04)

Bật `INDEX_PERSISTENCE_ENABLED=1` xong, log khởi động Render nói:

```
[index_persistence] restore skipped: not configured
                    (Kho object chưa cấu hình (thiếu SUPABASE_URL / SUPABASE_SECRET_KEY).)
```

Đo tiếp trong DB thì lộ ra hậu quả lớn hơn nhiều so với chuyện index:

```
production-embedding-smoke-2026-09-04.txt
  file_path  = /tmp/studymap/input_docs/...
  input_path = /tmp/studymap/input_docs/...      -> BẰNG NHAU
prod-fpt-embedding-smoke-2026-09-04.txt          -> BẰNG NHAU
```

`_ingest_uploaded_file` đẩy bản gốc lên bucket rồi mới ghi `file_path`; đẩy hỏng thì nó
`except` và giữ đường local (`⚠️ [Storage] Không đẩy được file lên bucket, dùng bản local`).
Hai giá trị bằng nhau nghĩa là **mọi lượt upload production đều rơi vào nhánh dự phòng**.

Hệ quả:

1. **Bản gốc người dùng tải lên biến mất sau mỗi lần khởi động lại** — `/tmp` của Render
   free bị xoá sạch. Hàng `documents` còn, file thì không. `/api/documents/<id>/file` sẽ
   trỏ vào đường dẫn chết.
2. Index không khôi phục được lúc boot, nên `/query` trả "Không tìm thấy dữ liệu phù hợp"
   dù index đã nằm sẵn trên Supabase.

`render.yaml` khai `SUPABASE_URL` và `SUPABASE_SECRET_KEY` là `sync: false` — Render hỏi
lúc tạo blueprint. Rõ ràng chúng chưa từng được điền, hoặc đã bị xoá.

Vì sao im lặng lâu thế: fail-open ở nhánh upload là CỐ Ý (mất bucket thì đừng chặn người
dùng), nhưng nó chỉ `print` một dòng cảnh báo rồi đi tiếp. Không có gì ở tầng cấu hình
nhìn ra được. Nay `/api/config/status` khai thẳng `supabase_storage_configured`.

**Sửa: điền hai biến đó trong dashboard Render.** Không phải việc của mã.

---

## Ingest production nay TỪ CHỐI khi kho object chưa sẵn sàng (2026-09-04)

Trước đây `_ingest_uploaded_file` có hai đường im lặng đưa tài liệu production về `/tmp`:

```python
stored_path = save_path
if _storage.is_configured():        # False -> đi thẳng qua, KHÔNG một dòng cảnh báo
    try:
        ...
    except Exception as exc:        # hỏng -> chỉ print, vẫn trả 200
        print("⚠️ [Storage] ... dùng bản local")
```

Nhánh `False` là nhánh đã chạy ở production suốt: cả hai tài liệu đều có
`file_path == input_path == /tmp/studymap/input_docs/...`. Render free xoá sạch `/tmp`
mỗi lần khởi động lại, nên tài liệu `completed` mà bản gốc chỉ nằm đó là tài liệu **sẽ
mất** — chỉ chưa ai biết. Hàng `documents` còn, file thì không, và
`GET /api/documents/<id>/file` trỏ vào đường dẫn chết.

Nay tiến trình mang nhãn `ingest_origin=production` ném `DurableStorageRequired` → HTTP
**503** (hạ tầng chưa sẵn sàng, không phải request sai), kèm gợi ý kiểm
`SUPABASE_URL`/`SUPABASE_SECRET_KEY` và trỏ tới `GET /api/config/status`. Ném TRƯỚC
`_docs.create` nên không để lại hàng `documents` ma, và dọn luôn file tạm.

Dev/test **giữ nguyên** fallback: ở đó bản local chính là kho lưu. Siết cả hai môi
trường là phá mọi lượt chạy không có Supabase. Cùng một hàm `provenance.nguon_ingest()`
quyết định, nên không có cờ thứ hai để lệch nhau.

Regression: `tests/test_storage_durability.py` (14 test). Kiểm ngược: 3/14 đỏ trên mã cũ
— đúng ba ca fail-closed.

### Khoá lưu trữ đã đúng sẵn, không cần đổi

`storage.object_path` lấy `PurePosixPath(name).name` sau khi đổi `\` thành `/`, rồi fold
mọi ký tự ngoài `[A-Za-z0-9._-]`. Nên khoá luôn có dạng `<user>/<doc>/<file>`, không mang
đường tuyệt đối, không mang ổ đĩa Windows, không traversal được. Không đổi schema, không
đổi format khoá.

`file_path` = khoá object (bền); `input_path` = đường tạm để `_don_file_tam` dọn. Hai vai
trò khác nhau, giữ nguyên cả hai.

## CHƯA SỬA — `embedding_id` va chạm (ghi cho phase sau, 2026-09-04)

Đã đo, KHÔNG đụng trong phase này:

```
emb='0' -> 3 hàng ở 3 tài liệu khác nhau
emb='1' -> 3 hàng
emb='2' -> 3 hàng
```

`embedding_id` là vị trí hàng FAISS — chỉ duy nhất TRONG MỘT index. Nhưng nó nằm ở cột
toàn cục và `lookup_by_embedding_ids` tra toàn cục, trả `dict` khoá theo `embedding_id`,
nên mỗi khoá chỉ MỘT hàng sống sót. Truy vấn không có `ORDER BY` → hàng nào thắng là
**không xác định**. Hôm nay ra đúng cả ba; đó là may, không phải đảm bảo.

Kho mã đã biết: `repository.clear_chunk_embedding_ids` có docstring đúng cho việc này,
nhưng rebuild chỉ GHI id cho chunk được index, không XOÁ id của chunk bị loại.

Không xoá, không viết lại hàng cũ, không migration, không đổi format trong phase này.

---

## Bản gốc production đã BỀN — và mắt xích tiếp theo đứt ở khoá FPT (2026-09-04)

Sau khi điền `SUPABASE_URL` + `SUPABASE_SECRET_KEY` trên Render:

```
/api/config/status  supabase_storage_configured true · index_persistence_enabled true
```

**Bản gốc bền — ĐẠT.** Tài liệu production mới `873ea272-7c91-4d25-81b2-c8df95e7362d`:

```
file_path   bb9b3690-…/873ea272-…/prod-storage-durable-2026-09-04.txt   ← khoá object
input_path  /tmp/studymap/input_docs/…                                  ← chỉ là bản tạm
object trong bucket `documents`: tồn tại · 2.809 byte · sha256 khớp bản gốc từng byte
signed_url cấp được
```

Lần đầu một tài liệu production có định danh lưu trữ bền. Trước đó `file_path` luôn bằng
`input_path`, tức bản gốc chết theo `/tmp` ở lần khởi động kế tiếp.

**Khôi phục index lúc khởi động — ĐẠT.** Log Render:

```
[index_persistence] restore started   slug=fpt__Vietnamese_Embedding__api_pooled
[index_persistence] restore completed slug=… version=20260904_215256_8db1b12f8508
                    files=3 elapsed=3.49s
```

Không còn `restore skipped: not configured`. Đáng chú ý: khôi phục KHÔNG cần khoá FPT hợp
lệ — nó chỉ cần tên danh tính để dựng slug, còn artifact thì tải thẳng về.

### Đứt ở mắt xích D: khoá FPT trên Render không hợp lệ

```
ingest tài liệu mới -> status=failed
  FPT embeddings HTTP 401: {"code":401,"description":"Invalid API Key"}
/query trên tài liệu đã có trong index -> cùng lỗi 401
```

Phân lập theo đúng sáu mắt xích:

| | mắt xích | kết quả |
|---|---|---|
| A | bản gốc lên kho object | **ĐẠT** — object tồn tại, sha256 khớp |
| B | khôi phục index | **ĐẠT** — restore completed, 3 file |
| C | phân quyền | **ĐẠT** — login 200, không `403 forbidden_source`, `/query` nhận 202 |
| D | embedding câu hỏi | **HỎNG** — FPT 401 Invalid API Key |
| E | ánh xạ truy hồi | chưa tới |
| F | sinh câu trả lời | chưa tới |

Một nguyên nhân gốc duy nhất, ở tầng cấu hình, không phải mã.

### Thông báo lỗi cho người dùng CHẨN ĐOÁN SAI — chưa sửa

Với lỗi 401, payload trả về người dùng là:

> "Chỉ mục tài liệu đang không tương thích với embedding model hiện tại.
> Vui lòng rebuild index hoặc upload lại tài liệu."

Đó là chẩn đoán sai và tốn kém: nó đẩy người đọc đi dựng lại một index hoàn toàn lành
lặn, trong khi việc cần làm là đổi một biến môi trường. Trường `error` bên ngoài có chứa
nguyên văn 401, nhưng payload thì không. Cần tách "index không tương thích" khỏi "provider
từ chối xác thực" — hai thứ này sửa bằng hai hành động khác hẳn nhau. Phase riêng.

## CHUỖI ĐÃ ĐÓNG: upload production → Storage bền → restart → restore → truy hồi (2026-09-04)

Sau khi khoá FPT trên Render được thay bằng khoá dùng được, cả sáu mắt xích đều đo được:

| | mắt xích | bằng chứng |
|---|---|---|
| A | bản gốc → Supabase Storage | object tồn tại, 2.809 byte, sha256 khớp bản gốc từng byte, signed_url cấp được |
| B | sống qua restart | vẫn tải về được sau ≥2 lượt deploy kể từ lúc upload |
| C | khôi phục index lúc boot | `restore completed slug=fpt__Vietnamese_Embedding__api_pooled files=3 elapsed=3.37s` |
| D | embedding câu hỏi | FPT trả vector, không còn 401 |
| E | ánh xạ truy hồi | 3/3 chunk trả về đều thuộc `prod-fpt-embedding-smoke-2026-09-04_txt`, KHÔNG lẫn 189 chunk cũ |
| F | sinh câu trả lời | trả lời đúng nội dung tài liệu (điện trở suất nicrom, công thức P=I²R) |

Dấu hiệu rẻ nhất để biết khoá FPT có thông không: `/api/config/status` →
`vision.available`. Nó gọi `GET /v1/models` bằng CHÍNH khoá đó, nên `false` nghĩa là khoá
bị từ chối — không cần thử embedding. Đã dùng đúng dấu hiệu này để phân biệt "khoá hỏng"
với "endpoint embedding hỏng" trong lượt chẩn đoán.

### Hai chi tiết ghi lại, chưa sửa

**1. `chunk_id` rỗng trong payload `/query`.** Không phải lỗi ánh xạ `embedding_id`.
`main.py:1505` lấy `chunk_id` từ TIỀN TỐ TRÍCH DẪN nhúng trong văn bản chunk
(`_CITE_PREFIX_RE`), mà chunk dựng lại từ Postgres không mang tiền tố đó. `stem` vẫn đúng
nên câu trả lời vẫn quy được về tài liệu; chỉ là không deep-link tới từng chunk được.
Ảnh hưởng: trích dẫn ở FE kém chi tiết với mọi index dựng lại.

**2. Tài liệu `873ea272-…` có 0 chunk.** Nó được upload đúng lúc khoá FPT đang hỏng, nên
ingest chết ở bước embedding. Bản gốc của nó ĐÃ bền trên Storage (đó là thứ phase này cần
chứng minh); chỉ thiếu chunk. Kho mã KHÔNG có endpoint ingest lại — muốn có chunk thì phải
upload lại thành một tài liệu mới. Để nguyên, `status=failed`, allowlist chặn.

### Một quan sát về dữ liệu cũ

11 tài liệu cũ đều CÓ khoá object trên Storage — vì máy trạm dev có sẵn credential
Supabase. Chỉ 3 tài liệu nạp qua production là rơi về `/tmp`, vì Render thiếu credential.
Nghĩa là lỗ hổng này chỉ tồn tại đúng ở môi trường mà nó nguy hiểm nhất.

---

## Upload production đi hết chuỗi — trừ một mắt xích: index KHÔNG được publish sau ingest (2026-09-05)

Kiểm sau khi khoá FPT trên Render đã dùng được. Tài liệu
`fa460d39-aa1f-46b1-9bc7-55ddcb495040` (`production-ingest-smoke-2026-09-05.txt`, 245 B):

```
upload            HTTP 200 · ingest_origin=production · status completed
bản gốc bền       file_path = bb9b3690-…/fa460d39-…/production-ingest-smoke-2026-09-05.txt
                  object tồn tại · 245 B · sha256 khớp bản gốc từng byte · signed_url cấp được
                  input_path chỉ là /tmp (bản tạm), KHÔNG phải kho lưu
chunk             1 chunk · embedding_id='3' · model=Vietnamese_Embedding
                  metadata_json.embedding_identity = {fpt, Vietnamese_Embedding, api_pooled}
                  không dấu vết MiniLM / bge-m3 / mean_late / FakeEmbeddings
truy hồi          trả đúng 1 chunk của tài liệu này, KHÔNG lẫn 189 chunk cũ,
                  câu trả lời đúng nội dung (điện trở suất lớn, P = I²R)
```

### Mắt xích thiếu: không ai publish index sau khi ingest append

Chỉ `scripts/dung_lai_index_tu_postgres.py` gọi `ps.publish_sau_rebuild()`. Đường
upload/ingest gọi `append_to_index` — ghi vào FAISS cục bộ rồi thôi. Đo được:

```
chunk mới           embedding_id = '3'      (index cục bộ có 4 vector)
Supabase current    version 20260904_215256_8db1b12f8508
manifest num_chunks 3                        (tạo 21:52 hôm trước, chưa có tài liệu này)
```

Nghĩa là vector của tài liệu mới **chỉ tồn tại trên `/tmp` của Render**. Container bị thay
(deploy, spin-down) là mất, còn hàng `document_chunks` vẫn giữ `embedding_id='3'` trỏ vào
một ô không còn.

### Vì sao truy hồi vẫn chạy sau lần khởi động lại vừa rồi

Log ba mốc, đọc theo thứ tự:

```
18:30:30  restore completed  version=20260904_215256  files=3     <- boot, kéo 3 vector về
(sau đó)  upload tài liệu mới -> append -> 4 vector trong /tmp
18:34:33  restore skipped: đã có index cục bộ hợp lệ              <- boot lại, KHÔNG đè
```

`restore()` cố ý không đè một index cục bộ còn hợp lệ — đúng, vì đè là xoá mất phần mới
hơn. Lần khởi động lại đó chỉ thay tiến trình, `/tmp` còn nguyên nên vector mới sống sót.
**Đó là may mắn của một lần restart nhẹ, không phải cơ chế bền.** Deploy thật sẽ thay
container.

### Không sửa trong phase này

Phase này là VERIFY. Cách sửa đúng cần quyết định thiết kế, ít nhất ba lựa chọn:

1. publish sau mỗi lượt ingest — đơn giản nhưng mỗi upload là một lượt tải lên kho
2. publish theo lô / có debounce
3. giữ nguyên và coi index production là thứ dựng lại được từ Postgres + allowlist
   (lúc đó phải chấp nhận: tài liệu mới không tìm được cho tới lần rebuild kế tiếp)

Lựa chọn 3 gần với thiết kế hiện tại nhất, nhưng nó mâu thuẫn với việc `append_to_index`
đang gán `embedding_id` — gán một con trỏ vào index sẽ biến mất.

---

## (ĐÃ SỬA 2026-09-05) Ingest append vào FAISS nhưng không xuất bản — index bền tụt lại phía sau

Đo trên production: `append_to_index` đưa index runtime từ 3 lên 4 vector và gán
`embedding_id='3'` cho chunk mới, nhưng Supabase vẫn giữ version 3 vector. Tài liệu được
báo `completed`. Container bị thay là vector mới mất, còn `document_chunks` vẫn trỏ vào
ô số 3 không tồn tại.

Nguyên nhân: chỉ `scripts/dung_lai_index_tu_postgres.py` gọi `publish_sau_rebuild()`.
Đường ingest gọi `append_to_index` rồi dừng.

### Sửa

`EmbedAndIndex` nay làm BA việc trong MỘT khoá:

```
with _KHOA_INDEX:
    faiss_ids = append_to_index(...)          # gán vị trí trong FAISS
    _persist_sections_and_chunks(...)         # ghi vị trí ấy xuống Postgres
    _ps.cong_bo_sau_ingest()                  # đẩy chính index ấy lên kho bền
```

Tách ba việc này ra là mở cửa cho trạng thái mà chunk trỏ vào một vector không tồn tại
ở đâu cả — đúng bug vừa đo.

### Hai hàm xuất bản, hai ngữ nghĩa, và vì sao KHÔNG gộp

| | `publish_sau_rebuild` | `cong_bo_sau_ingest` (mới) |
|---|---|---|
| gọi từ | script rebuild | node ingest |
| hỏng thì | nuốt, trả `published: False` | **NÉM** `PublishFailed` |

Khác nhau vì hậu quả khác nhau. Sau rebuild, index cục bộ vừa dựng vẫn dùng được nên một
lần đứt mạng không được biến thành lượt rebuild thất bại. Sau ingest thì `embedding_id`
ĐÃ ghi xuống Postgres — nuốt lỗi ở đó là tạo một tài liệu "xong" sẽ hỏng lặng lẽ ở lần
khởi động sau.

Chưa bật persistence → no-op, không ném (máy dev, CI). Bật rồi mà thiếu credential →
NÉM: đó là cấu hình sai, không phải chế độ chạy — im lặng ở đây tạo ra đúng tình trạng
production hôm 2026-09-04.

### Khi xuất bản hỏng thì tài liệu KHÔNG thành `completed`

Node trả `error` → `_route_err_or_continue` → `ErrorHandler` → `status=error` → DB
`failed`, kèm nguyên văn "index đã cập nhật trong tiến trình nhưng CHƯA xuất bản được
lên kho bền: …".

**KHÔNG xoá chunk để "rollback".** Kiến trúc hiện tại không có giao dịch chung giữa FAISS
và Postgres, và xoá dữ liệu thật để che một lỗi mạng thì tệ hơn cái nó che. Chunk ở lại,
trạng thái nói thật.

### Đồng thời

Ingest chạy trong daemon thread (`QUEUE_ENABLED=false`), nên hai lượt upload cùng lúc có
thể cùng đọc index, cùng append, rồi cùng xuất bản — lượt sau đè lượt trước.
`_KHOA_INDEX` (`threading.Lock`) bao trọn đoạn trên.

Phạm vi CỐ Ý là trong-tiến-trình: Render chạy `WEB_CONCURRENCY=1` và index nằm trên đĩa
cục bộ của chính tiến trình đó. Nhiều tiến trình cùng ghi một index là bài toán khác
(khoá phân tán / một worker chuyên trách) và chưa có yêu cầu.

Regression: `tests/test_ingest_publishes_index.py` (8 test). Kiểm ngược: 7/8 đỏ trên mã
cũ. Khẳng định "xuất bản nằm cùng khoá với append" đọc bằng AST, không phải grep chuỗi.

## (ĐÃ SỬA 2026-09-11) `thang_cap()` đổi tên chính `active` — vỡ trên Docker bind mount (EBUSY)

**Triệu chứng production (EC2, `docker-compose.prod.yml`):** `/opt/memvid/data/index`
bind-mount vào `/app/index`. Khôi phục index lúc khởi động (`INDEX_PERSISTENCE_ENABLED=1`)
chết với:

```
OSError: [Errno 16] Device or resource busy: rename('/app/index', '/app/index_backup_xxx')
```

Lỗi không được bọc ở đúng chỗ nó ném (xem dưới), nên tiến trình chạy tiếp với
`/app/index` RỖNG. Request kế tiếp chạm `FileNotFoundError: /app/index/index.json`.
Giao diện báo "indexing failure" dù upload tài liệu (ghi Postgres + Supabase Storage)
đã xong — hai bước khác nhau, lỗi nằm ở bước sau.

**Nguyên nhân:** `app/domains/vectorstore/rebuild.py::thang_cap()` (bước D — thăng cấp
staging thành active) dùng:

```python
active.rename(backup)     # đổi tên CHÍNH active
staging.rename(active)    # rồi đổi tên staging thành active
```

`active` là `/app/index` — MỘT MOUNT POINT trên production. Linux từ chối
`rename()`/`unlink()` trên mount point dù nó rỗng — không phải lỗi tạm thời, không retry
được, luôn xảy ra trên đúng bố cục bind-mount mà `docker-compose.prod.yml` dùng. Đây là
điểm gọi DUY NHẤT trong toàn bộ backend đổi tên nguyên thư mục index —
`store.py::save_index_with_backup` (đường ghi index khi ingest bình thường) đã dùng
`shutil.copytree` từ trước, không đụng lỗi này.

**Cách xử lý:** `thang_cap()` không còn đổi tên `active` nữa — nó LUÔN tồn tại nguyên
vẹn, chỉ NỘI DUNG bên trong đổi:

1. Nếu `active` có nội dung cũ: tạo thư mục backup SIBLING (`active_backup_<ts>`,
   không phải chính `active`), chuyển từng file cũ vào đó bằng `shutil.move`.
2. Chuyển từng file trong `staging` vào `active` (cũng bằng `shutil.move`).
3. Hỏng giữa chừng bước 2: gỡ những file vừa chuyển, đưa backup về lại — index cũ
   không mất.

Dùng `shutil.move` thay vì `Path.rename`/`os.rename` cho MỌI lượt chuyển: `active` và
`staging`/backup thường khác filesystem (bind-mount host khác layer overlay của
container), rename trực tiếp giữa hai thiết bị ném `OSError EXDEV`; `shutil.move` tự
copy-rồi-xoá khi không rename được.

Đổi lại: mất tính nguyên-tử-MỘT-LỆNH của rename thư mục (giờ là nhiều lượt chuyển
file). Đây là cách DUY NHẤT chạy được trên một thư mục bị mount — không có lựa chọn
nào khác giữ được atomicity đó mà vẫn tôn trọng ràng buộc của kernel.

**Prevention:** bất cứ hàm nào thao tác một thư mục có thể là bind-mount điểm gắn
(`INDEX_DIR`, `DATA_DIR`, hay bất kỳ path nào `docker-compose*.yml` liệt trong
`volumes:`) — không được `rename()`/`unlink()` chính thư mục đó. Chỉ được tạo/đọc/xoá
NỘI DUNG bên trong. Grep `\.rename\(` / `shutil.move\(` mỗi khi thêm một thư mục mới
vào danh sách bind-mount.

Regression: `tests/test_index_rebuild.py::test_thang_cap_khong_bao_gio_rename_active_mount_point`
— vá `Path.rename` ném `OSError(16, "Device or resource busy")` bất cứ khi nào gọi
TRÊN CHÍNH `active`; đỏ ngay trên mã cũ, xanh trên mã mới vì `thang_cap` không còn gọi
`.rename()` trên `active` ở đâu cả. `test_thang_cap_hong_thi_TRA_LAI_ban_cu` cập nhật
để vá `shutil.move` (cơ chế mới) thay vì `Path.rename` (cơ chế cũ đã bỏ).

### Cập nhật 2026-09-11 — hai lỗ rollback bị bỏ sót trong bản vá đầu

Audit sau khi vá phát hiện `thang_cap()` bản đầu (thay directory-rename bằng per-file
move) còn HAI khoảng hở rollback, cả hai đều là "khoảng hở KHÔNG có try/except", không
phải lỗi logic:

- **Giai đoạn sao lưu** (`active` → `backup`, chuyển file cũ ra) không có try/except
  nào. Hỏng giữa chừng (ví dụ file thứ hai trong ba) thì `active` bị RÚT RUỘT một
  phần — vài file cũ đã sang `backup`, số còn lại vẫn ở `active` — và không ai đưa
  lại. Đo trực tiếp trên mã trước khi vá: `a_index.faiss` biến mất khỏi `active`
  sau lượt gọi hỏng, không phục hồi.
- **Rollback của thăng cấp** (`backup` → `active`, khi bước staging→active hỏng)
  cũng không có try/except theo từng file. Hỏng thêm MỘT file trong lúc rollback thì
  exception PHỤ đó thay thế luôn exception GỐC đã kích hoạt rollback — người gọi
  thấy nhầm lỗi. Đo trực tiếp: lỗi `"loi phu: rollback a.faiss hong"` che mất lỗi
  gốc `"loi goc: thang cap b.json hong"`.

**Sửa:** cả hai giai đoạn giờ bọc try/except riêng.
- Giai đoạn sao lưu: hỏng giữa chừng thì đưa lại NHỮNG GÌ đã kịp chuyển sang
  `backup`, rồi mới ném lại lỗi gốc.
- Rollback của thăng cấp: mỗi lượt chuyển `backup` → `active` bọc riêng, hỏng một
  file chỉ LOG (`print("[thang_cap] rollback ... không đưa lại được ...")`), không
  ném — cố gắng hết sức đưa lại từng file còn lại, rồi mới `raise` (bare) để lỗi GỐC
  luôn là lỗi người gọi thấy. File nào rollback không đưa lại được thì KHÔNG MẤT —
  vẫn nằm nguyên trong thư mục `backup`, khôi phục tay được.

**Prevention:** một khối "hỏng thì rollback" mà chính lượt CHUYỂN dữ liệu ra chỗ
tạm (backup) không có try/except thì rollback không bảo vệ được đúng bước đó — kiểm
TỪNG bước ghi/chuyển trong một chuỗi rollback, không chỉ bước cuối cùng hay dễ thấy
nhất. Và rollback CHÍNH NÓ có thể hỏng: bọc riêng từng đơn vị phục hồi, log lỗi phụ,
đừng để nó thay thế lỗi gốc — nếu không, log sản xuất sẽ chỉ ra nguyên nhân sai.

Regression: `test_thang_cap_sao_luu_hong_giua_chung_khong_rut_ruot_active` (giai đoạn
sao lưu hỏng ở file thứ hai — `active` phải còn đủ cả ba file cũ) và
`test_thang_cap_rollback_hong_khong_che_loi_goc` (rollback hỏng một file — lỗi GỐC
vẫn phải là lỗi propagate ra, file rollback hỏng vẫn còn trong `backup`, không mất).
Cả hai đo trực tiếp trên mã TRƯỚC bản vá này (chạy cô lập ngoài pytest, không sửa
working tree): cả hai đỏ đúng như dự đoán, xanh trên mã sau vá. Suite đầy đủ: 2191
passed, 234 skipped, 0 failed.

## (ĐÃ SỬA 2026-09-05) Lỗi 401 của nhà cung cấp embedding bị báo thành "chỉ mục không tương thích"

`query_graph` phân loại lỗi bằng cách dò chuỗi trong thông báo:

```python
if any(kw in err_lower for kw in ["dim mismatch", "shape", "embedding", "dimension"]):
    user_msg = "Chỉ mục tài liệu đang không tương thích... Vui lòng rebuild index"
```

`RuntimeError("FPT embeddings HTTP 401: Invalid API Key")` có chữ "embedding", nên nó
rơi đúng vào nhánh đó. Mọi hỏng hóc của tầng embedding — khoá sai, hết hạn, 429, 502,
đứt mạng — đều mang chữ ấy trong thông báo, nên **không có lỗi provider nào thoát được**.

Hậu quả không dừng ở chữ nghĩa. Thông điệp bảo người đọc đi dựng lại một index hoàn toàn
lành lặn: vài nghìn lượt gọi embedding trả tiền, trong khi việc cần làm là sửa một biến
môi trường. Và sau khi dựng lại xong, lỗi vẫn y nguyên.

### Sửa: phân loại bằng KIỂU, không bằng chuỗi

`shared/interfaces/errors.py` (mới) giữ hợp đồng lỗi ở tầng port. Mỗi ngoại lệ tự khai mã
ở `MA_LOI`; hàm phân loại chỉ đọc thuộc tính ấy, không so kiểu — nhờ vậy lớp lỗi phía chỉ
mục nằm lại ở `app/domains/vectorstore` mà `shared` không phải import ngược lên `app`.

| Tình huống | Mã | Chữa bằng |
|---|---|---|
| 401/403 từ nhà cung cấp | `EMBEDDING_PROVIDER_AUTH_FAILED` | sửa khoá/quyền — thử lại vô ích |
| 429, 5xx còn sót sau khi đã thử lại, hết giờ chờ, đứt kết nối/DNS | `EMBEDDING_PROVIDER_UNAVAILABLE` | chờ rồi thử lại |
| 4xx còn lại, thân không phải JSON, số vector trả về không khớp số đầu vào | `EMBEDDING_REQUEST_FAILED` | sửa payload/tên model |
| Danh tính index không khớp cấu hình (`IndexIdentityMismatch`) | `INDEX_INCOMPATIBLE` | **dựng lại index** |
| Không có index để dùng (`IndexMissing`) | `INDEX_MISSING` | dựng hoặc khôi phục |

`INDEX_INCOMPATIBLE` là lớp DUY NHẤT mà thông điệp được phép khuyên rebuild — đúng lớp
duy nhất mà rebuild thật sự chữa được.

### Còn đúng một chỗ đọc chuỗi, và nó hẹp có chủ đích

`_phan_loai_loi` xét `MA_LOI` trước. Chỉ khi không ai khai mới xét tới hình dạng chuỗi,
và CHỈ cho `ValueError` về số chiều/hình dạng do numpy/FAISS ném (`dim mismatch`,
`dimension`, `shape`, `not aligned`) — lỗi chỉ mục thật, không có lớp riêng để bắt. Vì
bước một đã bắt hết lỗi provider trước, bước hai không còn cách nào chạm tới chúng nữa.

### `IndexMissing` hiện CHƯA có nơi nào ném

Lớp và mã đã có, thông điệp đã có, `ma_loi()` nhận ra. Nhưng `grep IndexMissing app/` chỉ
ra đúng dòng khai báo — chưa đường nào ném nó. Ghi rõ để lần sau không ai tưởng thiếu
index đang được phân loại: hiện nó vẫn rơi vào nhánh "không mã" và hiện nguyên văn lỗi
kỹ thuật. Nối dây là việc của phase sau.

### Tương thích ngược

`payload["error"]` giữ nguyên vai trò cũ (thông điệp cho người dùng). `payload["code"]`
là khoá THÊM, và chỉ xuất hiện khi phân loại được — client đang đọc `error` chạy y nguyên.
Không mã thì hiện nguyên văn lỗi kỹ thuật, KHÔNG đoán bừa sang một lớp cụ thể.

Lỗi auth cố ý không kèm `r.text`: thân phản hồi của tầng xác thực là chỗ dễ lọt thông tin
nhạy cảm nhất trong cả nhóm. Mã trạng thái đã đủ để chẩn đoán. Hành vi retry của
`FptEmbeddings` giữ nguyên — chỉ đổi lớp ngoại lệ ném ra ở cuối.

Regression: `tests/test_error_classification.py` (30 test). Khẳng định "không còn dò chuỗi
để phân loại" đọc bằng AST, không phải grep — chính docstring của test có chữ "embedding".

### Không đụng gì tới đường production đang chạy

Chuỗi upload → Storage bền → ingest → publish → truy hồi (đóng ngày 2026-09-04/09-05)
không đổi một bước nào. Đây thuần là đổi cách TRÌNH BÀY lỗi khi có lỗi.

## (ĐÃ SỬA 2026-09-05) Một cú 502 lẻ của gateway làm thẻ tài liệu thành "Mất liên lạc"

`SidebarLeft` poll `/sources/{id}/status` mỗi 1.5s. Lần hỏng ĐẦU TIÊN — bất kể vì sao —
là dừng poll và đổi thẻ sang "Mất liên lạc khi đang theo dõi".

Render/proxy trả 502/503/504 lẻ tẻ trong khi Gunicorn vẫn ghi `200` cho đúng request đó.
Nghĩa là một cú nhiễu đường truyền được trình bày cho người dùng thành tài liệu chết,
trong khi backend đang ingest bình thường và sẽ xong sau vài giây.

Lỗi VẬN CHUYỂN và lỗi XỬ LÝ là hai chuyện khác nhau và phải hiện ra khác nhau.

### Sửa

Logic chịu lỗi tách ra `utils/theoDoiNguon.js` (thuần, test ở env node); component chỉ nối
callback vào state.

| Nhóm | Mã | Xử lý |
|---|---|---|
| tạm thời | 408, 429, 502, 503, 504, và fetch ném (mất mạng/DNS/CORS đứt) | thử lại, backoff có trần 3s → 6s → 10s → 10s |
| không tạm thời | 401, 403, 404, **500** | dừng ngay |

**500 CỐ Ý không nằm nhóm thử lại.** Đó là ứng dụng tự ném lỗi; thử lại 5 lần cũng ra đúng
lỗi ấy, và giấu nó sau banner "đang thử lại" là nói dối. Lỗi xử lý thật của backend vẫn là
ingest hỏng thật, hiện đúng như trước.

Ba mức hiển thị, thay cho hai:

- hỏng 1–2 lần: **không hiện gì**. Cả mục đích đợt sửa là một cú 502 lẻ phải vô hình.
- hỏng ≥ 3 lần liên tiếp (`NGUONG_CANH_BAO`): một dòng màu `--warn` — "Không thể kết nối
  tạm thời. Đang thử theo dõi lại…". Trạng thái ingest và thanh tiến trình GIỮ NGUYÊN.
- vượt `MAX_CONSECUTIVE_FETCH_FAILURES` (= 5, lấy lại từ `jobPoller` để cả ứng dụng chỉ có
  MỘT con số): dừng theo dõi, màu `--err`, kèm nút "Thử lại". Câu chữ nói rõ là đã ngừng
  THEO DÕI chứ không phải tài liệu hỏng — ingest vẫn có thể đang chạy ở server.

Hỏi được một lượt là xoá sạch bộ đếm, banner tạm thời biến mất.

### `setInterval` → tự hẹn `setTimeout`

Thân poll là async. Với `setInterval(poll, 1500)`, một lượt chậm hơn 1.5s thì lượt sau vẫn
bắn: hai request cùng bay, phản hồi về trễ ghi đè phản hồi mới hơn. Tự hẹn giờ SAU khi lượt
trước kết thúc thì không bao giờ có hai lượt cùng lúc — cùng khuôn với `createJobPoller`.

`start()` gọi hai lần được guard: không guard là dựng hai vòng lặp trên cùng một bộ, số
request nhân đôi và chỉ giữ được MỘT `hen` nên không cách nào dừng cái thứ nhất.

Regression: `src/utils/theoDoiNguon.test.js` (19 test). Đường production không đổi: đây là
thay đổi thuần phía trình bày, `/sources/{id}/status` giữ nguyên hợp đồng.

## (ĐÃ SỬA MỘT PHẦN 2026-09-05) Ingest chạy trong tiến trình web làm OOM giết cả dịch vụ — 502 không phải lỗi Flask

Triệu chứng người dùng thấy: `GET /sources/<id>/status` trả **502 Bad Gateway**, lặp lại,
`Server: cloudflare`, `X-Render-Origin-Server: Render`.

### Đo được gì

Render free, 1 instance, trần **536.870.900 byte** (512 MiB), `-w 1`, worker `sync`,
không `--threads`. Ngày 2026-09-05, instance `m7kfd`:

```
03:09:06  ==> Running 'gunicorn ...'          cold start #1 (sau spin-down)
03:10:03  Listening at 0.0.0.0:10000          -> 57 giây
03:10:34  POST /upload 200 ; ingest source=b68beaf3 mode=thread
03:10:35-54  GET /sources/b68beaf3/status 200  x12
03:10:55-03:11:03   ← tiến trình CHẾT, không một dòng log
03:11:04  ==> Running 'gunicorn ...'
03:11:55  Booting worker with pid: 50          -> 51 giây
```

Bộ nhớ cùng lúc: `135 MB → 287 → 333 → **425 MB** → 137 MB`. Các instance trước còn sát
hơn: `9bwvg` chạm 534.839.300 B, `crlht` chạm 533.520.400 B — 99,6% trần.

**Nền nhàn rỗi đã là 332 MB** dù `skip_model_load: true`. Chỉ còn ~180 MB cho toàn bộ
việc ingest.

Cùng một file (`phase2-day01-...-fuller.pdf`, 190.136 byte) giết tiến trình **hai lần**,
hai ngày khác nhau (19:18 và 19:23 ngày 04/09; 03:11 ngày 05/09).

### 502 đến từ đâu

**Không phải từ Flask.** Toàn bộ `app/` có đúng một chỗ trả 502 (`main.py:2308`, link tải).
Endpoint status chỉ có 401/404/200; `_get_source_status` còn bọc `except Exception:
return None`, nên DB chết cũng ra 404.

**Không phải từ gunicorn.** Trong 61 giây đó không có MỘT dòng log request nào — kể cả
`/health`. Không `WORKER TIMEOUT`, không `SIGTERM`, không traceback. Chết đột ngột =
`SIGKILL` từ OOM killer.

502 là do **proxy Render trả khi không có tiến trình nào lắng nghe**. Cây quyết định:
502 ở trình duyệt + KHÔNG có log gunicorn tương ứng ⇒ hạ tầng, không phải mã ứng dụng.

### Vì sao FE polling KHÔNG phải nguyên nhân gốc

Phase trước (`1ed4c0c`) làm FE chịu được 502 lẻ. Đó là đúng việc, nhưng nó chữa CÁCH
TRÌNH BÀY, không chữa cái chết. Hai con số phải đặt cạnh nhau:

```
ngân sách thử lại của poller mới   1,5 + 3 + 6 + 10 + 10  ≈ 29 giây
thời gian ngừng thật đo được                              ≈ 61 giây
```

Nới thêm số lần thử chỉ kéo dài thời gian nói dối. Nguyên nhân nằm ở chỗ khác.

### Vì sao ingest bằng daemon thread là sai cho production

```
gunicorn worker (sync, -w 1)
  └── threading.Thread(daemon=True)
       └── ingest: đọc PDF → chunk → FPT embedding → FAISS → publish
```

Bộ nhớ của ingest tính vào ĐÚNG tiến trình đang phục vụ HTTP. Ingest phình lên là cả
`/health` lẫn `/sources/<id>/status` chết theo. Và tiến trình chết là thread bay theo,
không ai ghi lại trạng thái.

### Đã sửa gì trong phase này

**1. Bật queue thì việc nặng KHÔNG được chạy trong web.** `enqueue_job` có thêm
`fail_closed`; đường ingest truyền `True`. Bật `QUEUE_ENABLED` mà đẩy hỏng thì ném
`EnqueueFailed` → upload trả **503** kèm lý do, thay vì âm thầm chạy ingest trong
gunicorn. Các đường khác (summary/mindmap) GIỮ NGUYÊN fallback — ở đó hỏng chỉ mất một
tính năng, còn ingest hỏng thì sập dịch vụ. `QUEUE_ENABLED=false` không đổi một chút
nào: thread ở đó là chế độ chạy được chọn (máy dev, demo), không phải lượt dự phòng.

**2. Tài liệu gián đoạn không còn kẹt vĩnh viễn.** `reconcile_interrupted` trước đây chỉ
chạm `jobs.sqlite`; hàng `documents` nằm lại `processing` mãi mãi và FE poll không bao
giờ dừng. Nay gọi thêm `repository.reconcile_interrupted_documents()`, hạ
`processing → error` (DB `failed`) với lý do nói rõ tiến trình dừng giữa chừng.

Hai hàng rào để không hạ nhầm:
- chỉ `ingest_status == "processing"`. **`index_ready` KHÔNG bị đụng** — FAISS đã xong,
  tài liệu truy vấn được, chỉ còn cây nhớ dang dở.
- ở queue mode, bỏ qua id có trong registry RQ (`job_id == source_id` cho ingest), nên
  web khởi động lại không hạ tài liệu mà worker đang làm. RQ không đọc được → không đụng gì.

Không thêm trạng thái mới: dùng đúng từ vựng sẵn có (`error` → `_STATUS_TO_DB` → `failed`).

### Hai điều đã cân nhắc và CỐ Ý không làm trong phase này

**Bản gốc ở lại kho object khi enqueue fail-closed.** `DurableStorageRequired` ném
TRƯỚC `_docs.create` nên không để lại gì; `IngestQueueRequired` thì không thể — job phải
được đẩy sau khi có hàng `documents`, nếu không worker có thể chạy trước khi hàng ấy tồn
tại. Nên một lượt upload bị từ chối vì hàng đợi vẫn để lại object trong bucket.

KHÔNG coi đây là rò rỉ: hàng `documents` vẫn còn và vẫn trỏ vào object ấy (`file_path`),
nên đường xoá tài liệu bình thường dọn được nó. Cái sẽ thành rò rỉ là xoá hàng documents
mà giữ object — chính vì thế ở đây chọn hạ trạng thái xuống `failed` chứ không xoá hàng.
Không đổi gì ở `DurableStorageRequired` trong phase này.

**`_don_tai_lieu_ket` ghi N+1 session và không có trần (C2, CHƯA SỬA).** Nó chạy lúc
import `app.main` và trong `_handle_sigterm`: một `SELECT` mọi document `processing`, rồi
`update_status` một session mỗi tài liệu qua pooler Supabase (~50–100 ms/lượt). Hôm nay
2–3 hàng nên không đáng kể. Không có `LIMIT`, không gộp, nên nhiều hàng kẹt sẽ kéo dài
thời gian khởi động — và trong signal handler thì nó tiêu vào quỹ ân hạn trước `SIGKILL`
của Render. Sửa là gộp thành một session hoặc đặt trần cho lượt dọn lúc khởi động. Để
phase riêng: đo được là nhỏ, và trộn nó vào đây làm diff khó đọc.

### CHƯA sửa — vì sao production vẫn để `QUEUE_ENABLED=false`

Bật queue với một Render service worker riêng sẽ tách được bộ nhớ, nhưng **chưa dùng
được**, vì hai lý do đo được chứ không phải phỏng đoán:

1. **Index của web sẽ ôi.** `store._VS_CACHE` khoá theo `mtime+size` của `index.faiss`
   trên đĩa CỤC BỘ. Worker ở service khác ghi index trên đĩa của nó và publish lên
   Supabase; đĩa của web không đổi ⇒ khoá cache không đổi ⇒ **web tiếp tục phục vụ index
   cũ**. `persistence.restore_luc_khoi_dong()` chỉ chạy lúc khởi động, không có đường nạp
   lại. Tài liệu mới ingest xong sẽ không truy vấn được cho tới lần restart kế.
2. **Không có gì đảm bảo chỉ một worker ghi index.** `_KHOA_INDEX` là `threading.Lock` —
   chỉ hiệu lực trong MỘT tiến trình. Một worker RQ xử lý job tuần tự nên hiện tại là an
   toàn *do cấu hình*, không phải *do thiết kế*: nâng lên 2 worker là hai tiến trình cùng
   append rồi cùng publish, lượt sau đè lượt trước. Không thêm khoá phân tán trong phase
   này.

Cả hai là phase riêng. Đến lúc đó mới bật `QUEUE_ENABLED` ở production.

### Bộ nhớ — quan sát, KHÔNG sửa trong phase này

- Đòn bẩy lớn nhất **không** nằm ở pipeline mà ở **nền 332 MB lúc nhàn rỗi**: import
  torch/faiss/transformers vào chính tiến trình web, dù `SKIP_MODEL_LOAD=1`.
- `ingest_graph` compile **có checkpointer SQLite** (`ingest_graph.py:480`). LangGraph
  ghi toàn bộ state ở mỗi ranh giới node, mà `state["text"]` (toàn văn tài liệu) không
  bao giờ được bỏ ra sau khi chunk xong (`ingest_graph.py:148`). Bỏ `text` khỏi state sau
  `ChunkText` là thay đổi nhỏ, rủi ro thấp. Nhưng phải nói thật quy mô: với PDF 190 KB
  thì đây là cỡ MB, không phải cỡ trăm MB — nó KHÔNG phải nguyên nhân OOM.
- Các node trả `{**state, ...}` (12 chỗ) là copy NÔNG, không nhân đôi dữ liệu lớn.

## (ĐÃ SỬA 2026-09-05) Hai lỗ hổng của index khi ingest chạy ở tiến trình khác

Phase trước tách ingest sang worker RQ để bộ nhớ ingest không giết tiến trình web. Việc
tách ấy để lại hai lỗ hổng **chỉ tồn tại khi có từ hai tiến trình** — và cả hai đều hỏng
IM LẶNG, không sinh lỗi nào.

### 1. Index của web ôi đi mà không ai biết

```
worker:  ingest tài liệu A  →  publish V2 lên Supabase
web:     vẫn V1 trên đĩa của nó  →  A không tìm thấy  →  tới khi web restart
```

Cơ chế: `store._VS_CACHE` khoá theo `mtime+size` của `index.faiss` trên đĩa **cục bộ**
(`store.py:365`). Worker ở container khác không chạm đĩa ấy, nên khoá cache không bao giờ
đổi. `persistence.restore_luc_khoi_dong()` chỉ chạy lúc khởi động, không có đường nạp lại.

**Cách phát hiện version mới.** Nguồn sự thật KHÔNG đổi: `index/<slug>/current.json` trên
kho object. Thêm `vectorstore/dong_bo.py`:

- `phien_ban_tu_xa()` tải đúng `current.json` — vài trăm byte, không phải cả index.
- `phien_ban_cuc_bo()` đọc mốc `.phien_ban` nằm TRONG thư mục index. Nằm trong là có lý
  do: `thang_cap` đổi tên cả thư mục, nên thay index là thay luôn mốc — không có cửa sổ
  nào mốc nói một đằng còn file nằm một nẻo. Mốc là **bản ghi nhớ cục bộ**, không phải
  nguồn sự thật thứ hai.
- `dong_bo()` gọi ở đường ĐỌC (`load_vectorstore(use_cache=True)`, tức retrieval), có TTL
  `INDEX_SYNC_TTL_SEC` mặc định 60 giây. Version khác thì mới `restore(ghi_de=True)` rồi
  `xoa_cache()`. Không tải index mỗi query — chỉ hỏi con trỏ, tối đa mỗi phút một lần.
- Đường GHI dùng `dong_bo_truoc_khi_ghi()`: bỏ qua TTL, và **ném khi không xác nhận
  được**. Khác biệt này là bản chất chứ không phải phòng xa: đọc hỏng thì phục vụ bản cũ
  (mất tính mới); ghi hỏng mà đi tiếp thì append lên bản cũ rồi publish đè — **xoá vector
  của lượt ingest khác**.

**Hỏng thì giữ nguyên bản đang chạy.** Kho không hỏi được, tải hỏng, hoặc artifact từ xa
lệch danh tính → log rồi trả về, index cục bộ không bị đụng. `restore` vốn thẩm định
trong thư mục staging rồi mới thăng cấp, nên một bản từ xa hỏng không bao giờ chạm tới
bản đang phục vụ. Supabase chập chờn không được phép làm chết `/query`.

Kho chưa có con trỏ = chưa ai publish (cài mới) → **không chặn** lượt ingest đầu tiên.
Phân biệt bằng `exists()` chứ không đoán mã lỗi của `download()`: 404 và timeout không
được lẫn vào nhau ở chỗ này.

### 2. Hai worker ghi đè nhau

```
worker A: đọc V1 → append A → publish V2
worker B: đọc V1 → append B → publish V3     ← V3 không có A
```

`_KHOA_INDEX` là `threading.Lock` — chỉ có nghĩa trong MỘT tiến trình. Nay `EmbedAndIndex`
giữ HAI khoá, hai phạm vi:

```python
with _KHOA_INDEX, _db_index.khoa_ghi_index():   # thread trong 1 tiến trình + giữa các tiến trình
    _db_index.dong_bo_truoc_khi_ghi()           # PHẢI cầm bản mới nhất TRƯỚC khi append
    append_to_index(...)
    _persist_sections_and_chunks(...)
    cong_bo_sau_ingest()
```

Đoạn tới hạn bao **cả bốn việc**. Khoá riêng `append` hoặc riêng `publish` đều vô dụng:
đúng cái kịch bản mất vector ở trên xảy ra giữa hai lời gọi ấy. Và `dong_bo_truoc_khi_ghi`
phải nằm trong khoá, trước `append` — đồng bộ sau khi append là đã append lên bản cũ mất rồi.

Khoá là `redis.lock.Lock` (redis-py 5 có sẵn, RQ vốn đã cần Redis), tên
`studymap:index:ghi:<slug>` nên hai không gian vector khác nhau không chặn nhau. Có HẠN
(`INDEX_LOCK_TIMEOUT_SEC`, mặc định 900s): worker bị OOM giết giữa lúc giữ khoá mà khoá
không tự hết hạn thì mọi lượt ingest sau đứng vĩnh viễn — đúng kiểu hỏng đang đi dọn, chỉ
đổi chỗ.

### Lấy khoá không được thì sao

Ném `KhongLayDuocKhoa` **trước khi** chạm vào index. Node trả `error` → ErrorHandler →
tài liệu `failed`, thông điệp "Chưa ghi được vào chỉ mục lúc này, hãy thử lại". Không ghi
đè, không giả vờ thành công, không tụt về thread trong web.

Redis chết ở chế độ nhiều tiến trình cũng ném — vì lúc đó **không còn gì bảo vệ index**,
và chạy tiếp là cược vào việc worker kia đang rảnh. Lưu ý cài đặt: `acquire()` phải nằm
trong cùng `try` với `from_url` — redis-py chỉ mở kết nối ở lệnh đầu tiên, nên lỗi mạng
rơi vào `acquire`.

### Nhiều worker RQ giờ đã an toàn chưa

**Rồi, với điều kiện có Redis.** Có test chạy thật hai luồng qua đúng context manager: một
bên vào được, bên kia ném `KhongLayDuocKhoa`, không bên nào lọt vào đoạn tới hạn cùng lúc.
Cộng với `dong_bo_truoc_khi_ghi` trong khoá, lượt sau luôn append lên đúng cái mà lượt
trước vừa xuất bản. 1 worker hay 2 worker đều đúng.

Không có `REDIS_URL`, hoặc `QUEUE_ENABLED=false` → khoá phân tán là **no-op có chủ đích**:
lúc ấy chỉ một tiến trình ingest, `threading.Lock` là bảo vệ đủ và đúng. Dựng một hàng rào
giả chỉ để "trông an toàn" thì tệ hơn không có.

### Còn lại gì trước khi bật `QUEUE_ENABLED=true`

Không còn blocker về tính đúng đắn của index. Còn lại là **bộ nhớ**: worker phải nạp đúng
bộ import đã chiếm 332 MB ở web, cộng phần ingest đã đo tới >425 MB. Gói Render free
512 MiB cho worker gần như chắc chắn vẫn OOM — chỉ khác là OOM ở nơi không kéo `/health`
và `/sources/<id>/status` chết theo. **Tách tiến trình chữa được sự lan của lỗi, không
chữa được bản thân lỗi thiếu bộ nhớ.**

### Lần thứ BA: `.env` của máy dev quyết định kết quả test

`BE/.env` ở máy này có `QUEUE_ENABLED=true` và `REDIS_URL` trỏ localhost. Từ khi ingest có
khoá phân tán, cờ ấy quyết định ingest có đòi Redis hay không — và không có Redis chạy thì
**10 test ingest đỏ** với `Error 10061 connecting to localhost:6379`, trong khi CI xanh.

Cùng lớp với `DATABASE_URL` (3058272) và `FPT_AI_API_KEY` (2026-09-04). `conftest.py` nay
trung hoà `QUEUE_ENABLED` ở mức session; test hàng đợi tự bật cờ bằng monkeypatch.

Và một lỗi thiết kế của chính bản sửa, đã sửa lại: điều kiện bật khoá phân tán ban đầu chỉ
là `REDIS_URL`. Sai — `REDIS_URL` có mặt vì cache ngữ nghĩa, không phải vì có worker. Điều
kiện đúng là `QUEUE_ENABLED` **và** `REDIS_URL`: rủi ro hai tiến trình cùng ghi chỉ tồn
tại khi thật sự có worker RQ.

### MindMap chrome phải có một chủ sở hữu hiển thị

MindMap có Inspector dạng overlay trong canvas nhưng vẫn dùng SidebarRight cho các
luồng tạo map, chọn map và dữ liệu nền. Không được ẩn toàn bộ SidebarRight chỉ vì
`workspaceMode === "mindmap"`: thao tác tạo/chọn map sẽ biến mất và overlay không còn
được mở qua đường dẫn UI bình thường. Quy tắc phòng ngừa: MainLayout luôn giữ một
right-column owner; Inspector contextual phải dùng absolute positioning bên trong
canvas, còn toolbar/context-row là hai vùng chức năng khác nhau và không được nhân
bản menu overflow.

### Vitest tự nhặt luôn file `.spec.js` của Playwright

Thêm `FE/e2e/**/*.spec.js` (Playwright, 2026-09-27) làm `npm test` (Vitest) vỡ ngay:
Vitest mặc định include glob `**/*.spec.js`, không phân biệt runner nào sở hữu file
đó. Playwright's `test()` gọi ngoài runner của nó ném lỗi rối (`_TestTypeImpl` stack),
không phải lỗi cú pháp — dễ đoán nhầm là bug trong spec.

**Fix:** `FE/vite.config.js` thêm `test.exclude` — GIỮ NGUYÊN danh sách exclude mặc
định của Vitest (`node_modules`, `dist`, `.git`, các file `*.config.*`, ...) rồi thêm
`'e2e/**'` vào, không thay hẳn bằng một mảng chỉ có `e2e/**` (làm vậy sẽ vô tình bỏ
loại trừ `vite.config.js`/`vitest.config.js` chính nó ra khỏi bộ lọc).

**Phòng ngừa:** bất cứ bộ test thứ hai nào thêm vào repo (Playwright, Cypress, ...)
đặt trong thư mục riêng (`e2e/`) và phải tự kiểm `npm test` (Vitest) còn xanh trước khi
coi là xong — không chỉ chạy runner mới rồi dừng.

### ESLint: file chạy dưới Node (không phải browser) báo `'process' is not defined`

`FE/eslint.config.js` chỉ có một block `languageOptions.globals: globals.browser` áp
dụng cho MỌI `*.js`/`*.jsx` — đúng cho code app (chạy trong browser), sai cho file cấu
hình/script chạy dưới Node (`playwright.config.js`, `scripts/*.mjs`, `e2e/**`, và
`tailwind.config.js` cũ vốn đã có nợ lint kiểu này với `module`/`require`).

**Fix:** thêm một block `files: ['playwright.config.js', 'e2e/**/*.js',
'scripts/**/*.mjs']` với `languageOptions.globals: globals.node`, KHÔNG sửa rule chung
— giữ browser code lint chặt như cũ, chỉ mở đúng phạm vi file chạy dưới Node.

**Phòng ngừa:** file mới chạy dưới Node (script CLI, config tool) luôn kiểm `npx eslint
<file>` trước khi commit — `no-undef` trên `process`/`__dirname`/`require` là dấu hiệu
file đó cần vào block `globals.node`, không phải dấu hiệu cần disable rule.

### Guided dialog "Yêu cầu riêng" label không gắn với textarea — Playwright `getByLabel` treo tới hết test timeout

`GuidedMindmapDialog.jsx` có `<label>Yêu cầu riêng...</label>` và `<textarea>` là hai
phần tử SIBLING, không có `htmlFor`/`id` nối nhau, textarea cũng không nằm lồng trong
label. Về accessible-name resolution, hai phần tử này KHÔNG liên kết — ảnh hưởng cả
Playwright's `getByLabel` lẫn screen reader thật, không chỉ test.

Hậu quả trong CI (`E2E Critical Flows`, run 36314116607, 2026-09-27): test "A -> B ->
A -> B map switching" gọi `dialog.getByLabel(/Yêu cầu riêng/).fill(...)` — locator
không bao giờ resolve, treo tới khi hết `Test timeout of 45000ms exceeded`, teardown
đóng page giữa lúc đang chờ nên lỗi hiển thị ra là `locator.fill: Target page, context
or browser has been closed` (triệu chứng, không phải nguyên nhân). Vì
`test.describe.serial` có retry, thất bại này kéo theo chạy lại TOÀN BỘ file, và lần
chạy lại lại bắt trúng "happy path" test giữa lúc đang poll job → báo thất bại thứ hai
trông như không liên quan (`aria-selected` vẫn `false` sau 20s).

**Fix:** thêm `htmlFor="guided-instruction"` vào `<label>` và `id="guided-instruction"`
vào `<textarea>` (commit `bc92574`). Không đổi test timeout, không đổi cấu hình retry —
gốc bệnh nằm ở markup, sửa test/CI-config sẽ không giải quyết được.

**Phòng ngừa:** field nào dùng `<label>` + input riêng (không lồng nhau) đều PHẢI có
`htmlFor`/`id` khớp cặp. Một lỗi accessible-name loại này thường lộ ra qua `getByLabel`
treo vô thời hạn (không phải lỗi rõ ràng) — nếu một test Playwright bị "Test timeout
exceeded" ở đúng bước `.fill()`/`.click()` trên `getByLabel(...)`, kiểm tra ngay
markup label/input trước khi nghi ngờ timing hay backend.

### `run_e2e_server.py`'s force-fail mock đọc sai tầng state — `__E2E_FORCE_FAIL__` không bao giờ trúng cho job Guided thật

Sau khi sửa lỗi label ở trên, `E2E Critical Flows` (run 36318766819, 2026-09-27) lộ ra
lỗi thứ hai, KHÁC hẳn: test "Guided create failure surfaces a visible error" chờ 20s
một banner lỗi (`/lỗi|thất bại|failed/i`) không bao giờ xuất hiện.

`MockMindmapGraph.invoke` (`BE/scripts/run_e2e_server.py`) tìm marker bằng
`state.get("instruction")` / `state.get("generation_intent")` ở TẦNG NGOÀI CÙNG của
state. Nhưng state thật do `run_mindmap_job`
(`BE/app/application/mindmap_generation.py` dòng ~62) dựng ra chỉ có
`job_id/source_names/mm_input/content_hash/user_id/progress/current_node/error` — chữ
`instruction` của Guided nằm lồng ở `mm_input["generation_intent"]["instruction"]`.
Kết quả: `text_blob` luôn rỗng cho một job Guided thật, marker không bao giờ khớp, job
luôn chạy xong `"done"` thay vì `"failed"` — banner lỗi phía FE vì vậy không bao giờ có
gì để hiển thị.

**Fix:** đọc thêm `(state.get("mm_input") or {}).get("generation_intent") or
{}).get("instruction")` vào `text_blob` (commit `663e3a2`). Không đổi
`FE/e2e/critical-flows.spec.js`, không đổi timeout — lỗi nằm ở mock đọc sai field, test
đã viết đúng.

**Phòng ngừa:** khi viết/sửa một double/mock đọc field từ một state dict lớn (LangGraph
state, job payload, ...), luôn đối chiếu với NƠI THẬT dựng ra state đó (ở đây là
`run_mindmap_job`'s `_langgraph_invoke(graph, {...})` call), không suy đoán tên field từ
tên tham số phía trên (route, request body). Field trùng tên ở tầng ngoài (`q`) không
có nghĩa field khác cũng ở tầng ngoài.

### `e2e-critical` khai `needs:` vào hai job có `if:` HẸP HƠN chính nó — PR chỉ đổi FE bị cascade-skip cả E2E

PR #39 (chỉ đổi file FE — `SidebarRight.jsx`, `MindElixirView.jsx`,
`WorkspaceEmptyState.jsx`, ...) chạy CI (run 36322729264, 2026-09-27):
`backend-integration-and-smoke` SKIP đúng (không có gì backend đổi — if của nó chỉ xét
`backend`/`shared`). Nhưng `e2e-critical` cũng SKIP theo, dù `if:` của chính nó liệt
`needs.detect-changes.outputs.frontend == 'true'` như một điều kiện ĐỦ để chạy. Kết quả:
gate "e2e-critical = success" người dùng yêu cầu chưa từng thực sự thực thi cho PR này —
`CI / required` vẫn báo success vì aggregator (`ci-success`) chỉ fail khi có
`failure`/`cancelled`, coi `skipped` là ổn.

**Nguyên nhân:** GitHub Actions — một job bị SKIP thì MỌI job có `needs:` trỏ tới nó
cũng tự động SKIP, bất kể `if:` riêng của job phụ thuộc nói gì. `e2e-critical` khai
`needs: [detect-changes, frontend-build, backend-integration-and-smoke]` nhưng đọc hết
các step của nó (checkout riêng, pip install riêng, npm build riêng, migrate riêng —
`BE/scripts/run_e2e_server.py` tự set DATABASE_URL) thì KHÔNG hề dùng artifact nào từ
hai job đó — hai `needs` này thuần túy dư, không có lý do chức năng. `if:` của
`e2e-critical` (chạy khi frontend HOẶC backend HOẶC shared đổi) rộng hơn if của cả hai
job kia (mỗi job chỉ xét đúng một domain của nó), nên bất cứ PR chỉ đổi một phía
(chỉ FE hoặc chỉ BE) đều khiến job còn lại SKIP rồi cascade-skip luôn E2E.

**Fix:** bỏ `frontend-build` và `backend-integration-and-smoke` khỏi `needs:` của
`e2e-critical`, chỉ giữ `detect-changes` (dùng cho `if:` của chính nó). Không đổi logic
test, không đổi `if:`, không đổi job nào khác.

**Phòng ngừa:** một `needs:` chỉ nên tồn tại nếu job hiện tại THẬT SỰ dùng artifact/output
của job kia. Nếu không, kiểm tra `if:` của job được `needs` — nếu nó HẸP HƠN `if:` của
job đang khai `needs`, thêm nó vào chắc chắn tạo cascade-skip sai cho đúng những PR mà
`if:` của job hiện tại nói là NÊN chạy. Việc thêm `needs:` chỉ để "sắp thứ tự chạy" (không
dùng artifact) phải kiểm lại `if:` hai bên trước, không thêm tùy ý.

### `<input type="number" max="…">` hiển thị giá trị CHƯA kẹp — form submit im lặng không chạy

Xây `QuestionCountControl` (Question Builder, tái dùng ở `QuizSetup` và practice
Customize dialog, 2026-09-28): bản đầu `commit(raw)` gọi `onChange(kẹp(n))` đúng, nhưng
`setDraft(raw)` lưu CHUỖI GỐC chưa kẹp làm giá trị hiển thị của input. Test tích hợp
(submit thật qua `<form onSubmit>`, không phải gọi thẳng hàm) bắt được: gõ "500" với
`max={50}` → React state `count` đúng là 50, nhưng DOM `<input>` vẫn hiển thị "500" —
vi phạm `max` của chính nó, trình duyệt (và jsdom) CHẶN native form validation, sự kiện
`submit` không bao giờ bắn, `onSubmit` không chạy, `generateQuiz` 0 lần gọi. Không lỗi,
không thông báo, nút chỉ im lặng không làm gì — đúng kiểu lỗi "bấm mà tuyệt đối không có
gì xảy ra" file này đã ghi nhận ở chỗ khác.

**Fix:** `commit()` kẹp SỐ TRƯỚC, rồi dùng chính số đã kẹp cho CẢ `draft` (hiển thị) lẫn
`onChange` (giá trị thật) — chỉ giữ chuỗi thô khi `parseInt` thất bại (ô đang rỗng/gõ dở),
vì "" không vi phạm constraint validation.

**Phòng ngừa:** input HTML có `min`/`max`/`pattern` riêng (không chỉ dựa vào validate ở
tầng JS) mà tách "giá trị hiển thị" (draft/local state) khỏi "giá trị đã xử lý" (báo lên
qua onChange) — luôn kẹp/chuẩn hoá TRƯỚC khi gán vào state hiển thị, không chỉ trước khi
gọi callback. Test phải submit qua đường THẬT (`<form>` + click nút submit), không gọi
thẳng handler — gọi thẳng bỏ qua đúng bước native constraint validation nơi lỗi này nằm.

### Double-submit guard đọc `state`, không phải `ref` — hai click cùng tick đều lọt qua

`QuizSetup.jsx`'s `onSubmit` gốc: `if (submitting) return; setSubmitting(true);` — cùng
hình dạng bug `GuidedMindmapDialog.jsx` đã vá trước đó trong session này
(`submitStartedRef`), nhưng KHÔNG được áp dụng lại ở đây khi `QuizSetup` được viết. Test
tích hợp bấm nút submit HAI LẦN LIÊN TIẾP trong cùng một `act()` (mô phỏng double-click
thật) bắt được: cả hai lần gọi `onSubmit` đều đọc `submitting === false` (React batch hai
`setSubmitting(true)` lại, chưa commit giữa hai lần đọc) → `generateQuiz` bị gọi 2 lần cho
một lần người dùng có ý định bấm — đúng lỗi máy chỉ có 1 slot LLM mà comment ngay phía
trên dòng code đó đã cảnh báo, nhưng bảo vệ bằng `state` không đủ nhanh để chặn.

**Fix:** thêm `submittingRef` (ref, không phải state) — đọc/ghi TRƯỚC `await`, cùng kỹ
thuật `GuidedMindmapDialog.jsx` đã dùng.

**Phòng ngừa:** bảo vệ "đừng gọi hai lần" cho một hành động async luôn cần một REF đọc/ghi
đồng bộ, không phải `state` — `setState` không commit ngay trong cùng tick, nên hai lệnh
gọi liên tiếp (double-click thật, hoặc test bấm 2 lần) đều thấy giá trị CŨ. Khi thêm một
form submit mới có gọi API, chép lại đúng pattern `submitStartedRef`/`submittingRef` đã có
sẵn trong repo thay vì viết lại bằng `state`. Test double-submit phải bấm 2 LẦN LIÊN TIẾP
TRONG CÙNG MỘT tick (không `await` giữa hai lần bấm) — bấm rồi `await` rồi bấm lại không
bao giờ bắt được lớp bug này.
# (ĐÃ SỬA 2026-10-01) MindElixir render lifecycle could expose stale connectors

## Root cause

`MindElixirView` previously treated `mind.init()`/`refresh()` as sufficient even
when the map container was still 0×0, and the theme observer only called
`changeTheme()`. That left connector paths unvalidated after hidden-canvas load
or light/dark changes. The depth action also mutated `nodeData` directly before
calling layout/linking, which did not guarantee that stale descendant wrappers
were removed in every Mind Elixir render path.

## Fix and regression coverage

The viewer now exposes an explicit idle → mounting → waiting_for_size →
laying_out → linking → validating → ready/error lifecycle. Connector paths are
validated for finite geometry and a plausible count; the bounded retry ends in
an actionable “Thử lại” error instead of an infinite spinner. Theme changes
run `changeTheme()` followed by layout/linking and validation without
`scaleFit()`/`toCenter()`. Depth expansion uses the public `expandNodeAll()` API
to rebuild visible descendant DOM and connectors.

Regression coverage lives in
`FE/src/components/mindmap/MindElixirView.renderLifecycle.test.jsx` and the
real Chromium fixture suite. Prevention: any renderer lifecycle change must
test hidden-canvas load, repeated theme toggles, visible node/connector counts,
map switching, and transform preservation in a real browser.

## Node detail reopens after MindMap -> Chat -> MindMap (2026-10-04)

- Symptom: close the contextual node detail, switch to Chat and back to MindMap,
  and the detail reopens for the old node.
- Root cause: the open-on-selection effect in `MainLayout` runs whenever the
  overlay mode returns. The manual close only set `rightOpen=false`, so the
  controller's `selected` survived and re-opened the detail. Leaving MindMap
  never cleared it either. `MindElixirView` stays mounted while hidden, so the
  canvas selection also survived.
- Regression tests: `FE/src/hooks/useMindMapController.selectionLifecycle.test.jsx`
  and `FE/src/components/Layout/MainLayout.selectionLifecycle.test.jsx`.
- Prevention: any close or mode-exit path that hides a contextual surface must
  clear its source of truth (the controller selection), not just the visibility
  flag. Tests must cover the reopen-on-return path, not only the immediate close.

## Mobile first tap on a topic lands on the overflow menu (2026-10-04)

- Symptom: on a 390px canvas, open the contextual overflow menu (⋮), dismiss it
  with Escape or a tap outside, then tap a topic: the first tap does not select
  it; a second tap does.
- Root cause: the overflow menu had no Escape or outside-pointer dismissal. The
  open menu stayed on top of the canvas, so the first tap reached a menu item.
- Also fixed in this PR: the node-detail close control was named "Thu gọn bộ kiểm
  tra ngữ cảnh" (collapse) at 36px; the mobile initial fit left a 390px map at
  about 27% (unreadable labels); toolbar zoom and "Tạo lại" targets were below 40px.
- Regression tests: `FE/e2e-fixture/mindmap-responsive-interactions.spec.js`
  (real MindElixirView, fixture harness) and
  `FE/src/components/Layout/ContextPanelCloseButton.test.jsx`.
- Prevention: any popover or menu over the canvas must dismiss on Escape and on
  outside pointerdown, and tests must click through the real canvas after dismissal.

## Mobile node-detail close hid the sheet but kept the selection (2026-10-04)

- Symptom: on 390px, closing the node-detail bottom sheet (X, Escape or backdrop)
  hides it, but the node stays selected; tapping the same node does not reopen it.
- Root cause: on mobile `panel.drawer` is true. The close handler took the generic
  drawer branch, which only hid the sheet. Escape was also blocked by a
  `.me-container` guard that is present for the whole MindMap mode.
- Fix: one `closeRightPanel` in MainLayout for X, backdrop and Escape. Closing the
  MindMap node detail clears the controller and canvas selection on desktop and
  mobile. Chat, Summary, the generic drawer and Guided restore are unchanged.
- Regression tests: `FE/src/components/Layout/MainLayout.mobileClose.test.jsx`.
- Prevention: every close path of a contextual surface must clear its source of
  truth, not only its visibility. Test each path under the drawer layout as well as
  the overlay layout.

## Phone mode switch tabs were 32px and clipped in Mind Map mode (2026-10-05)

- Symptom: on 390px, Chat / Mind Map / Summary tabs were 32px wide. In Mind Map
  mode the header row overflowed, the nav collapsed to 11px and its tabs were
  clipped, so taps landed on the StudyMap trigger or the header.
- Root cause: mobile CSS made the nav `flex: 1 1 auto; overflow-x: auto`, so a
  squeezed scroll container clipped its own tabs. Tab padding gave 32px targets.
  The phone header also carried five separate right-side owners.
- Fix: fixed-width nav with 40px icon tabs; one 40px workspace-tools owner whose
  menu holds the source library and inspector actions on phones; compact 40px usage
  control with a status dot (numbers stay in the popover, now pinned to the
  viewport on phones); avatar-only 40px account control; brand mark as a 40px home link.
- Known, outside this change: at 768px the header row is wider than the viewport
  (desktop classes, unchanged here). Tracked separately.
- Regression tests: `FE/e2e-fixture/mobile-header.spec.js` (hit tests in each mode),
  `FE/e2e-fixture/mobile-header-visual.spec.js` (captures and measurements).

## Full header overflowed between 768 and 1023px; usage warning colours never rendered (2026-10-05)

- Full desktop header needs 956px (measured with `header-width-audit.spec.js`). At
  768 to 912 it overflowed the viewport. Fix: compact header below `lg` (1024px),
  full header from 1024px. Breakpoint moved from sm/md to lg for header classes only;
  the mindmap overlay and library-menu mobile rules keep their 767px breakpoint.
- `text-warn`, `text-danger` and `bg-warn`/`bg-danger` were never generated (no such
  colours in tailwind.config.js), so the usage warning and exhausted states had no
  colour in the popover bar or the header. Fixed by using the defined `--warn` and
  `--err` variables directly.
- Regression tests: `FE/e2e-fixture/mobile-header.spec.js` (breakpoints, targets, hit
  tests in each mode, usage states, menu dismissal, lifecycle invariants) and
  `FE/src/components/Layout/UsageChip.test.jsx`.
- Known, not changed: desktop usage button is 36px tall and the account chip about 38px
  (pre-existing desktop sizes, outside the compact target floor).
