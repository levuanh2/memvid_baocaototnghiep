# StudyMap AI — Architecture Refactoring Plan v1

> **Trạng thái:** PLAN. Chưa sửa một dòng mã nào.
> Baseline: BE 1030 passed / 4 skipped · FE 234 passed · lint 70 · `main` tại `a96f7b6`.

## ⚠ CONFLICT PHẢI GIẢI TRƯỚC KHI THỰC THI

**Context nói FastAPI. Codebase là Flask.**

```
BE/app/main.py:23   from flask import Flask, request, jsonify, Response, stream_with_context
BE/app/main.py:24   from flask_cors import CORS
```

Context bổ sung §2 liệt kê `FastAPI` trong danh sách domain không được import, và §8 viết
`FastAPI route → invoke use case`. Không có FastAPI trong kho; 81 route đều là
`@app.get/post/...` của Flask.

**Ảnh hưởng thật, không phải chuyện chữ nghĩa:**
- Flask không có `APIRouter` → Phase 3 phải dùng `Blueprint`, khác hẳn về cách tách file.
- Flask không có dependency-injection theo request → wiring phải làm ở module scope
  (kho đã có `app/wiring.py` làm sẵn kiểu đó).
- Flask sync WSGI; các job chạy bằng thread/RQ, không phải `async def`.

**Cần bạn xác nhận một trong hai:** (a) giữ Flask, plan này viết theo Flask — đó là giả
định của toàn bộ tài liệu dưới đây; hoặc (b) có kế hoạch chuyển FastAPI, khi đó thứ tự
phase phải khác hẳn và việc chuyển framework phải là một phase riêng, đứng trước tất cả.

---

## 1. Current Architecture

```
main.py  (5077 dòng · 81 route · 6 job runner)      API + Application trộn
      ↓
app/domains/<domain>/{service,repository,generator}.py   Domain + Repository trộn
      ↓
app/clients/ · app/graphs/ · services/ · app/jobs/        Infrastructure
```

`app/wiring.py` là composition root — nhưng chỉ cho LangGraph, không cho domain.

**Đo được:**
- 10/69 file domain import `sqlalchemy`/`app.db` — chấp nhận được, phần lớn là repository.
- **13 file domain import thẳng LLM/FAISS** — đây mới là chỗ thủng ranh giới:
  `attempts/grading.py` · `quiz/generator.py` · `review/service.py` · `retrieval/*` ·
  `memory/tree.py` · `vectorstore/store.py` · `cache/llm_cache.py` · `ingest/enrich.py` ·
  `conversation/rewrite.py` · `summary/qa_chain.py` · `vision/transcribe.py`

**Một seam đã có sẵn, đừng bỏ qua:** `quiz/generator.generate_questions(ask=...)` và
`attempts/grading` đã nhận hàm gọi model qua tham số, chỉ fallback về `llm_factory` khi
không truyền. Đó chính là LLM Port ở dạng phôi — Phase 2 nên chuẩn hoá nó, không phát
minh lại.

## 2. Target Architecture

Giữ tên thư mục hiện có, đổi ranh giới:

```
app/
  main.py          → chỉ bootstrap + đăng ký blueprint
  api/             → Blueprint theo bounded context (Flask, KHÔNG phải APIRouter)
  application/     → use case = orchestration (6 job runner chuyển về đây)
  domains/         → domain logic thuần, không biết FAISS/Ollama/Flask
  ports/           → LlmPort · EmbeddingPort · SearchPort · JobQueuePort · StoragePort
  adapters/        → OllamaLlmAdapter · FaissSearchAdapter · RqJobQueueAdapter …
  wiring.py        → nơi duy nhất nối Port ↔ Adapter
```

## 3. Dependency Direction

```
api → application → domains → ports
adapters → ports          (adapter phụ thuộc port, không ngược lại)
wiring → tất cả           (composition root, chỗ DUY NHẤT được biết mọi thứ)
```

Luật kiểm được bằng test: `domains/` và `application/` không được xuất hiện
`import faiss`, `flask`, `ollama`, `llm_factory`.

## 4. Module Ownership

| Tầng | Module |
|---|---|
| StudyMap domain | `studymap` `quiz` `attempts` `review` `gap_analysis` `progress` `documents` `ai_validation` |
| Hạ tầng dùng chung | `ingest` `vectorstore` `retrieval` `jobs` `auth` `clients` `services/llm_gateway` |
| MemvidX feature | `memory` `mindmap` `summary` `conversation` `cache` `vision` |

## 5. MemvidX → StudyMap Extraction Boundary

**REUSE nguyên trạng** (chỉ bọc Port, không rewrite): `ingest` · `vectorstore` ·
`retrieval` · `clients/llm_factory` · `services/llm_gateway` · `jobs`.

**REFACTOR:** `memory/tree.py` → hạ xuống thành **retrieval strategy** sau `SearchPort`,
không phải domain (§4 context). `graphs/query_graph.py` (1000+ dòng, trộn retrieval +
CRAG + NLI + HITL + cache) → tách dần, **không** trong v1.

**KHÔNG lấy:** domain model MemvidX. Đã đúng — 19/19 bảng là của StudyMap.

## 6. Application Layer Design

Sáu use case, tách nguyên vẹn hành vi từ `main.py`:

| Use case | Nguồn | Dòng |
|---|---|---|
| `StudyMapGenerationUseCase` | `run_study_map_job` | 2333 |
| `QuizGenerationUseCase` | `run_quiz_generation_job` | 2559 |
| `ShortAnswerGradingUseCase` | `run_short_answer_grading_job` | 3025 |
| `MemoryTreeUseCase` | `run_memory_tree_job` | 1708 |
| `SummaryUseCase` | `run_summary_job` | 4124 |
| `MindmapUseCase` | `run_mindmap_job` | 4477 |

Mỗi use case nhận dependency qua constructor (jobs_store, ledger, repository, generator,
validator). Không đọc `os.environ` trực tiếp — cấu hình truyền vào.

## 7. Search Port / Adapter Design

```python
class SearchPort(Protocol):
    def search(self, query: str, *, document_id: str | None,
               top_k: int, user_id: str | None) -> list[RetrievedChunk]: ...
```

`FaissSearchAdapter` bọc `vectorstore` + `retrieval.hybrid` hiện có. `MemoryTreeStrategy`
là **adapter thứ hai** của cùng Port — đó là cách hạ Memory Tree xuống hạ tầng mà không
xoá nó.

Domain gọi `SearchPort`; `wiring.py` quyết định adapter nào.

## 8. Study Map Semantic Layer Design

Hiện: `quiz_questions.knowledge_node_id` **suy ngược từ chunk** sau khi sinh câu hỏi.
Target: Map **dẫn dắt** sinh câu hỏi.

```
KnowledgeNode → knowledge_node_chunks → chunks → context cho MỘT node
                                                      ↓
                                   quiz_questions.knowledge_node_id  (biết TRƯỚC)
```

Lợi ích kép: mỗi câu gắn đúng một node (§8 context), và **ngữ liệu mỗi lượt gọi nhỏ hơn**
— đúng thứ đang làm gemma2:2b trả JSON hỏng.

**Đây là PROPOSAL**, không phải requirement. Nó đổi hành vi sinh quiz nên phải đo trước
(so tỉ lệ câu bị loại giữa hai đường).

## 9. Legacy Route Strategy

Đo bằng grep trên `FE/src` — **12/14 nhóm route legacy đang ACTIVE**:

| Trạng thái | Route |
|---|---|
| **ACTIVE** | `/query*` (13) · `/conversations/*` (6) · `/list-indexed` (5) · `/mindmaps*` (4) · `/generate-mindmap` (2) · `/summaries` (2) · `/generate-summary` (2) · `/sources/*` (2) · `/api/vision/*` (2) · `/upload` (1) · `/delete-source` (1) · `/chunk-text` (1) |
| **OPTIONAL** | `/stats` `/ready` `/jobs/<id>/timeline` — vận hành, không phải FE |
| **DEPRECATED?** | `/memory-tree*` — FE không gọi, nhưng `query_graph` có thể dùng nội bộ. Phải kiểm trước khi kết luận |
| **REMOVE** | *(trống — chưa có route nào đủ điều kiện xoá)* |

**Kết luận: không xoá route nào trong v1.** Chỉ dán nhãn.

## 10. Auth Compatibility Strategy

`/auth/*` (code + FE) vs `/api/auth/*` (spec §17). **Không đổi trong v1** — context §11
nói rõ không phải ưu tiên. Khi cần: đăng ký blueprint ở CẢ hai prefix, FE chuyển dần, gỡ
prefix cũ sau. Không đổi một lần.

---

## 11–13. Refactoring Phases · Risk · Test Strategy

### Phase 0 — Đóng băng baseline (không sửa mã)

- **Files:** `docs/` (bản ghi), `.playbook/`
- **Moves:** không gì
- **Preservation:** tuyệt đối
- **Tests:** chạy full BE + FE, ghi lại con số làm mốc
- **Risk:** không
- **Rollback:** không cần

### Phase 1 — Rút 6 job runner sang `application/` ★ ưu tiên

- **Files:** `main.py` (−~800 dòng), `app/application/*.py` (mới)
- **What moves:** thân 6 hàm `run_*_job`
- **What does NOT move:** route, schema, tên hàm được `enqueue_job` tham chiếu (giữ
  wrapper cùng tên trong `main.py` trỏ sang use case — RQ serialize theo đường dẫn hàm)
- **Preservation:** 100% — không đổi chữ ký, không đổi thứ tự gọi
- **Tests:** `test_quiz_generation` · `test_quiz_job_ket` · `test_query_cancel` ·
  `test_jobs_*` · full suite
- **Risk: TRUNG BÌNH.** Cạm bẫy thật: `run_quiz_generation_job` đóng gói biến từ scope
  ngoài (`_quiz_gen`, `_rules`, `_ledger`) và `process_query_job` là **hàm lồng** trong
  `query()` — nó đọc `req_user_id` từ closure. Hàm lồng **không rút ra được** nếu không
  truyền tường minh.
- **Rollback:** một commit, `git revert`

### Phase 2 — `SearchPort` + `FaissSearchAdapter`

- **Files:** `app/ports/search.py` · `app/adapters/faiss_search.py` · `wiring.py` ·
  các chỗ gọi trong `quiz` `review` `studymap`
- **Does NOT move:** `vectorstore/store.py`, `retrieval/hybrid.py` — chỉ bị bọc
- **Preservation:** kết quả truy hồi phải **giống hệt**; so bằng test trên index thật
- **Tests:** `test_retrieval_filter` · `test_query*` · thêm test khoá hướng phụ thuộc
- **Risk: TRUNG BÌNH** — đổi truy hồi là đổi ngữ liệu là đổi chất lượng quiz
- **Rollback:** giữ đường cũ sau cờ env một vòng phát hành

### Phase 3 — Tách Blueprint theo bounded context

- **Files:** `app/api/{documents,quiz,attempts,review,practice,progress,studymap,legacy}.py`
- **Does NOT move:** đường dẫn URL — **giữ nguyên từng ký tự**
- **Tests:** một test liệt kê toàn bộ `url_map` và so với ảnh chụp trước refactor
- **Risk: THẤP** nếu có test ảnh chụp url_map; **CAO** nếu không

### Phase 4 — Wiring hạ tầng, gỡ 13 chỗ domain import thẳng LLM/FAISS

- **Risk: TRUNG BÌNH–CAO** — chạm `graphs/`
- Thêm test kiến trúc: `domains/` không được chứa `import faiss|flask|ollama`

### Phase 5 — `main.py` chỉ còn bootstrap

- **Risk: THẤP** (phần khó đã xong ở 1–4)

**Nguyên tắc test xuyên suốt (context §10):** không sửa test chỉ vì kiến trúc mới làm nó
đỏ. Test đỏ = một trong hai: hành vi đã đổi (phải dừng), hoặc test khoá cách viết thay vì
hành vi (sửa test, ghi lý do). Kho này đã có tiền lệ đúng: `test_job_cancel_contract`
đỏ khi hợp đồng huỷ đổi thật, và đã cập nhật kèm bằng chứng.

## 14. Definition of Done

Mỗi phase xong khi: BE ≥1030 passed / 0 failed · FE 234 passed · lint ≤70 · URL map
không đổi · `.playbook` ghi nguyên nhân + phòng ngừa · một commit lùi được.

Toàn dự án xong khi: `main.py` < 400 dòng · `domains/` + `application/` không import
FAISS/Ollama/Flask · đổi FAISS→vector DB chỉ cần viết adapter mới.

## 15. First Implementation Task

**Phase 1, bước 1: test ảnh chụp `url_map` + hành vi 6 job runner.**

Trước khi di chuyển bất cứ thứ gì, dựng lưới: một test chụp toàn bộ 81 route (path +
method) và một bộ test khoá hành vi từng job runner ở mức use case. Không có lưới này
thì mọi phase sau là bay mù — 1030 test hiện có phủ *tính năng*, không phủ *hình dạng
API*.
