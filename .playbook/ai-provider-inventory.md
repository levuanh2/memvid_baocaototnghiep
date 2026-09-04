# Kiểm kê provider AI — StudyMap AI

Chốt ngày **2026-09-04**. Mọi dòng dưới đây đo từ mã và từ production đang chạy, không
suy đoán. Chỗ nào chưa đo được thì ghi thẳng là chưa đo.

Ba trạng thái phải phân biệt, vì nhầm chúng là cách báo cáo sai mà nghe vẫn xuôi:

- **chưa có** — mã không hề tồn tại
- **có mã, đang TẮT** — mã chạy được, đã kiểm, nhưng production không bật
- **đang CHẠY ở production** — đã gọi thật và có bằng chứng

## 1. Bảng kiểm kê

| Năng lực | Điểm vào | Provider hiện tại | Trạng thái production | FPT có tương đương? | Model FPT | Đang bật? | Fallback |
|---|---|---|---|---|---|---|---|
| Chat LLM (chung) | `llm_factory.ask_ai` | FPT | **ĐANG CHẠY** | có | `gpt-oss-120b` | ✅ | vòng `PROVIDERS` |
| Chat LLM (chain) | `llm_factory.get_llm` | FPT | **ĐANG CHẠY** | có | `gpt-oss-120b` | ✅ | chọn provider dựng được đầu tiên; lỗi lúc gọi ném lên |
| Sinh đáp án RAG | `summary/qa_chain.answer_with_document_context(+_stream)` | FPT | có mã, **không tới được** — chặn bởi thiếu index | có | `gpt-oss-120b` | ✅ (nhưng node không chạy) | không |
| Viết lại truy vấn | `retrieval/query_rewrite` | FPT | như trên | có | `gpt-oss-120b` | ✅ | node bọc timeout |
| Viết lại câu hỏi nối tiếp | `conversation/rewrite` | FPT | **TẮT** — `CONVERSATION_CONTEXT_ENABLED` mặc định 0, production chưa đặt | có | `gpt-oss-120b` | — | `_default(..., "llm_error")` |
| Judge cache ngữ nghĩa | `cache/llm_cache` | FPT | có mã, chỉ chạy ở ca biên | có | `gpt-oss-120b` | ✅ | try/except → không tái dùng cache |
| Tóm tắt | `services/summary/pipeline/summarize` | FPT | có mã, **hỏng ở production** — 500 vì thiếu `index.json` | có | `gpt-oss-120b` | ✅ | vòng `PROVIDERS` |
| Mindmap / Study Map | `services/mindmap/pipeline/*` | FPT | như tóm tắt — `collect_mindmap_input` đọc `index.json` | có | `gpt-oss-120b` | ✅ | vòng `PROVIDERS` |
| Sinh quiz | `domains/quiz/generator` | FPT | **ĐANG CHẠY** — đã kiểm production | có | `gpt-oss-120b` | ✅ | vòng `PROVIDERS` |
| Sinh đề luyện tập | cùng generator, `quiz_type=practice` | FPT | **ĐANG CHẠY** | có | `gpt-oss-120b` | ✅ | vòng `PROVIDERS` |
| Chấm tự luận | `domains/attempts/grading` | FPT | có mã, chạy khi có câu tự luận | có | `gpt-oss-120b` | ✅ | vòng `PROVIDERS` |
| Cây nhớ (memory tree) | `domains/memory/tree` | FPT | **ĐANG CHẠY** — dựng lúc ingest | có | `gpt-oss-120b` | ✅ | vòng `PROVIDERS` |
| Làm giàu ngữ cảnh khi ingest | `domains/ingest/enrich` | FPT | **TẮT** — `contextual_embeddings`/`hypo_qa` mặc định false | có | `gpt-oss-120b` | — | vòng `PROVIDERS` |
| **Embedding** | `llm_factory.get_embeddings` / `get_embedding_model` | `FakeEmbeddings(384)` ở production | **có mã FPT, đang TẮT** | có | `Vietnamese_Embedding` (1024) | ❌ | không |
| **Reranker** | `retrieval/rerank.get_reranker` | FPT | **đã BẬT, chưa tới được** — node chỉ chạy khi có kết quả truy hồi | có | `bge-reranker-v2-m3` | ✅ | `rerank_texts` → giữ nguyên thứ tự |
| NLI / kiểm mâu thuẫn | `retrieval/nli.get_nli` | `NullNli` ở production | **KHÔNG có tương đương trên FPT** | không | — | — | passthrough |
| Vision / VLM | `domains/vision/transcribe` | FPT | **ĐANG CHẠY** — đã kiểm production | có | `Qwen2.5-VL-7B-Instruct` | ✅ | `VISION_BACKEND=ollama` |
| OCR ảnh khi ingest | `domains/ingest/ingest_utils` (pytesseract) | Tesseract | **HỎNG ở production** — nhị phân không được cài | không có API OCR riêng; VLM thay được | — | ❌ | trả chuỗi rỗng |
| TTS | — | **chưa có trong mã** | — | có trên marketplace (`FPT.AI-VITs`, `FPT.TTS-pro`) | — | — | — |
| STT | — | **chưa có trong mã** | — | có trên marketplace (`whisper-large-v3-turbo`, `FPT.AI-whisper-*`) | — | — | — |

## 2. Vì sao nhiều thứ "đang bật" mà vẫn không chạy

Một dây chuyền, đứt ở mắt xích đầu:

```
SKIP_MODEL_LOAD=1  →  ingest bỏ qua ghi index  →  không có index.json / index.faiss
                                                        │
                          ┌─────────────────────────────┼─────────────────────────────┐
                          ▼                             ▼                             ▼
                  /query trả "không tìm         /generate-summary 500        mindmap / study map
                  thấy dữ liệu" (200,           (thiếu index.json)           cùng lý do
                  chưa gọi LLM)
```

Quiz, practice, grading và memory tree **không** đi qua mắt xích đó: chunk của chúng
nằm trong Postgres (`document_chunks`), không qua FAISS. Đó là lý do quiz chạy được ở
production trong khi `/query` thì không — cùng một ứng dụng, hai kết cục, và không có
gì ở tầng cấu hình để nhìn ra.

## 3. Một hệ quả của việc dùng FPT mà chưa ai ghi lại

`ask_ai(..., model=...)` và `_model_map(feature)` chỉ có tác dụng với **Ollama**. Ba
provider từ xa (fpt/gemini/groq) bỏ qua tham số `model` và dùng biến env riêng của
chúng. Nghĩa là dưới FPT:

- `SLM_MODEL_CHAT`, `SLM_MODEL_SUMMARY`, `MINDMAP_MODEL`, `QUIZ_MODEL`, `SLM_MODEL_INTENT`
  **không còn tác dụng** — mọi feature dùng chung `FPT_AI_CHAT_MODEL`.
- Chọn model theo từng tác vụ là thứ đã mất khi chuyển sang FPT. Không phải lỗi, nhưng
  ai đọc `.env` sẽ tưởng bốn biến kia đang điều khiển cái gì đó.

Muốn lấy lại thì cần `FPT_AI_QUIZ_MODEL` / `FPT_AI_SUMMARY_MODEL`… — chưa làm.

## 4. Các danh sách provider trong kho — đã hợp nhất

Từng có **ba** nơi tự quyết định "provider nào":

| Nơi | Có `fpt`? | Ai dùng |
|---|---|---|
| `llm_factory.PROVIDERS` | có | `ask_ai`, `get_llm` — đường production |
| `shared/config._compute_providers()` | **không** | chỉ `ProviderPool` |
| `clients/local_providers.ProviderPool.ask` | **không** | chỉ `services/llm_gateway` (chưa deploy) |

Hai cái sau là mã chết ở production (`LLM_GATEWAY_ADDR` rỗng), nhưng để chúng lệch
nhau chính là kiểu sai đã tạo ra bug `get_llm` hardcode Ollama. Xem
`.playbook/lessons-learned.md`.

## 5. Không migrate — và vì sao

- **NLI** (`MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli`): marketplace không có
  model phân loại suy luận (NLI/zero-shot). Giữ nguyên bản cục bộ; ở production nó là
  `NullNli` do `SKIP_MODEL_LOAD=1`, tức tầng khử mâu thuẫn hiện không hoạt động.
- **OCR**: FPT không có API OCR chuyên dụng. VLM đọc được chữ trong ảnh (đã kiểm), nên
  về nguyên tắc thay được — nhưng đường ingest ảnh và đường `/api/vision/transcribe`
  là hai chỗ khác nhau, và gộp chúng là một thay đổi kiến trúc chưa được yêu cầu.
- **TTS / STT**: ứng dụng không có tính năng nào cần chúng. Marketplace có model,
  không có nghĩa là phải dùng.

## 6. Hai cổng, không phải một

Bật một năng lực FPT thường cần HAI biến, và quên biến thứ hai thì hỏng im lặng:

| Năng lực | Cổng bật/tắt | Chọn backend | Hậu quả khi thiếu cổng |
|---|---|---|---|
| Rerank | `RERANK_ENABLED=1` | `RERANK_BACKEND=fpt` | `get_reranker()` trả Identity trước khi nhìn tới backend |
| Vision | `VISION_ENABLED` (không đặt = bật) | `VISION_BACKEND=auto\|fpt` | `auto` tự chọn FPT khi có khoá |
| Embedding | `FPT_AI_EMBEDDING_MODEL` (không rỗng) | — | opt-in kép: thiếu là dùng provider cũ |
| Chat | — | có khoá là dùng | — |

Production từng có `RERANK_ENABLED=0` (vì cross-encoder ~2.3 GB sẽ OOM), nên đặt
`RERANK_BACKEND=fpt` một mình không có tác dụng gì. Xem `.playbook/lessons-learned.md`.

## 7. Smoke production đã chạy (2026-09-04)

16/16 PASS trên `studymap-api-keq6.onrender.com`:

| Đường | HTTP | Provider/model | Thời gian |
|---|---|---|---|
| `/health`, `/ready` | 200 | — | <1s |
| `/auth/register` | 201 | — | 1.1s (93s khi instance nguội) |
| `/upload-file` + ingest | 200 | — | 2.2s + 19s |
| `/api/vision/transcribe` | 200 | fpt / `Qwen2.5-VL-7B-Instruct` | 0.9s |
| `/api/quizzes/generate` | 202 → done | fpt / `gpt-oss-120b` | 14s |
| `/api/attempts/<id>/answers` (PATCH) + submit | 200 | — | 1.8s + 4.5s |
| `/api/review-plans/generate` | 201 | fpt / `gpt-oss-120b` | 3.7s |
| `/api/practice/generate` | 202 → done | fpt / `gpt-oss-120b` | 9.8s |
| chấm tự luận (nền) | 202 → `graded` | fpt / `gpt-oss-120b` | 7.4s |
| `/query` | 202 → done | — | 1.4s, trả `"Không tìm thấy dữ liệu phù hợp"` |

Dòng cuối là **đúng như thiết kế**, không phải lỗi: chưa có index nên guard trả lời
trước khi gọi LLM. Đó cũng là lý do reranker chưa chạy được end-to-end ở production.

## 8. Vòng đời index — sáu giai đoạn, hai giai đoạn cuối chưa bật

```
PostgreSQL document_chunks
        │
   A. SINH        embed theo lô, kiểm số chiều          rebuild.py
        │
   B. GHI TẠM     index_staging, không chạm active      rebuild.py
        │
   C. THẨM ĐỊNH   đọc LẠI từ đĩa, so danh tính          rebuild.py
        │
   D. THĂNG CẤP   đổi tên, giữ bản cũ làm backup        rebuild.py
        │
   E. LƯU BỀN     đẩy lên kho object (TUỲ CHỌN)         persistence.py   ← TẮT
        │
   F. KHÔI PHỤC   lúc khởi động nếu đĩa trống           persistence.py   ← TẮT
```

Định dạng CANONICAL (chốt 2026-09-04): **LangChain FAISS**, bộ ba bắt buộc
`index.faiss` + `index.pkl` + `index.json`; `chunks.sqlite` tuỳ chọn. Cả đường ingest
lẫn đường rebuild giờ sinh CÙNG một bộ — trước đó chúng ghi hai định dạng khác nhau
vào cùng tên file. Xem `.playbook/known-issues.md`.

E và F cần **ba** biến, production chưa có biến nào: `INDEX_PERSISTENCE_ENABLED=1`,
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`. Thiếu bất kỳ cái nào là no-op im lặng — app
vẫn boot, chỉ in `[index_persistence] restore skipped: ...`.

Layout từ xa (kho object không có commit nguyên tử nhiều file, nên thứ tự là tất cả):

```
index/<provider>__<model>__<strategy>/<version>/index.faiss
index/<provider>__<model>__<strategy>/<version>/index.json
index/<provider>__<model>__<strategy>/<version>/manifest.json   ghi SAU artifact
index/<provider>__<model>__<strategy>/current.json              ghi SAU CÙNG
```

## 9. Chưa đo

- Độ trễ và hạn mức của FPT dưới tải thật (mới chỉ gọi lẻ và lô 20 chunk).
- Hành vi thật khi FPT trả 429 (client có retry + tôn trọng `Retry-After`, nhưng chưa
  gặp 429 thật để xác nhận header trả về ra sao).
- Chi phí mỗi lượt gọi.
