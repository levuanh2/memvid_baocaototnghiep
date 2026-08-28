# Audit vòng 2 — dọn mã, dọn thư mục, soát lại logic

**Khác gì vòng 1?** Vòng 1 (`2026-08-28-audit-toan-du-an.md`) quét theo **lớp lỗi đã tái
diễn** — tìm bản sao thứ ba của một khiếm khuyết đã biết. Vòng này quét theo **thứ nói dối**:
file trùng nhau nhưng nội dung lệch, mã không ai gọi, khai báo không ai đọc, và chỗ nuốt lỗi
im lặng. Cả hai loại đều vô hình với test xanh, nhưng vì lý do khác nhau: vòng 1 vô hình vì
test giả LLM; vòng này vô hình vì **test không bao giờ đọc file cấu hình thứ hai**.

**Nguyên tắc:** mỗi phát hiện kèm một lệnh chạy được. Xoá cái gì thì phải chứng minh
0 người gọi, không phải "trông có vẻ cũ".

---

## C1 — Mã chết (xoá được ngay, 0 rủi ro)

Quét bằng một lượt đọc toàn bộ file `git ls-files '*.py'` rồi tìm tên module/hàm không
xuất hiện ở bất kỳ file nào khác.

| đường dẫn | dòng | bằng chứng |
|---|---|---|
| `BE/services/mindmap/utils.py` | **1414** | 40 `def`, 0 importer. Pipeline mindmap iterative-prompting CŨ, đã bị `services/mindmap/pipeline/` (skeleton→enrich→relations) thay thế |
| `BE/app/clients/provider_factory.py` | 19 | factory 2 hàm, 0 caller |
| `BE/app/domains/memory/lc_memory_tree.py` | 9 | chỉ re-export "cho thống nhất roadmap", 0 caller |
| `FE/src/components/ui/Button.jsx` | 18 | 0 import |

Hàm chết trong file còn sống (9 hàm):

```
app/clients/llm_factory.py:536                  get_sentence_transformer
app/domains/ingest/formats.py:54                accept_attribute
app/domains/vectorstore/embedding_utils.py:129  validate_vector_index_compatibility
app/main.py:260                                 _cleanup_old_jobs
app/main.py:1093                                user_data_root
services/mindmap/worker.py:39                   attach_mindmap_job_context
services/mindmap/worker.py:43                   _notify_progress
shared/paths.py:21                              default_data_dir
shared/source_id.py:65                          display_filename
```

`worker.py` xoá 2 hàm đó thì `contextvars`, `Callable`, và import
`repair_json_text as _repair_json_text` (import mù, không dùng) cũng chết theo — file
57 dòng còn ~22.

**Lệnh xác minh trước khi xoá:**

```bash
grep -rn "\bTEN_HAM\b" --include=*.py --include=*.md --include=*.yml . | grep -v '\.venv'
```

Rỗng (trừ chính dòng `def`) thì mới xoá.

**KHÔNG xoá:** `scripts/*.py` và `alembic/versions/*.py` — cũng "0 importer" nhưng là
entry point / được gọi theo revision id. Đây là dương tính giả của phép quét.

---

## C2 — File cấu hình trùng nhau nhưng NÓI KHÁC NHAU (nguy hiểm nhất vòng này)

Không phải rác — là **bẫy**. Cả ba cặp đều có bản "thắng" và bản "nói dối".

### C2.1 `requirements.txt` ở gốc vs `BE/requirements.txt`

Gốc: 64 dòng, **không pin gì cả** (`langchain`, `langgraph`…).
BE: pin chặt `langchain>=0.3.27,<0.4`, `langgraph>=0.2.57,<0.3` kèm comment:

> KHÔNG nâng lên 1.x: langgraph 1.x kéo ormsgpack, mà binary ormsgpack bị Windows
> Application Control chặn

`pip install -r requirements.txt` từ thư mục gốc cài đúng cái bản pin đang cấm.
`.github/workflows/ci.yml:32` ưu tiên `BE/requirements.txt` nên CI chưa dính; người mới
clone thì dính.

### C2.2 `.env.example` gốc vs `BE/.env.example`

```
gốc: 78 khoá | BE: 129 khoá | chung 68, trong đó 12 khoá GIÁ TRỊ KHÁC NHAU
AUTH_REQUIRE_SECRET  AUTH_SECRET  CACHE_ENV  CONVERSATION_CONTEXT_ENABLED
LLM_QUEUE_WAIT_TIMEOUT_SECONDS  MAX_CONCURRENT_LLM_CALLS  OLLAMA_HOST  QUEUE_ENABLED
REDIS_URL  SEMANTIC_CACHE_ENABLED  SLM_MODEL  SUMMARY_LLM_TIMEOUT_SEC
```

**SỬA LẠI SAU KHI THI HÀNH — kết luận trên SAI.** Đọc kỹ từng khoá thì 11/12 chỗ lệch là
**cố ý**: hai file là hai HỒ SƠ, không phải hai bản sao. Gốc = docker/prod (compose thay
102 chỗ `${VAR}` từ đó, nên `host.docker.internal`, `redis://redis:6379/0`,
`QUEUE_ENABLED=true` đều đúng); BE = dev trên máy. Ép hai file giống nhau là PHÁ cấu hình
docker.

Chỉ **một** khoá sai thật: `SLM_MODEL` (gốc 7b an toàn, BE 9b = 6.59 GB trên card 6.14 GiB,
và BE thắng). Truy được nguyên nhân gốc: `BE/.env.example` **lặp key `SLM_MODEL` hai lần**,
dòng thứ hai ghi chú "alias backward-compatible" — người viết định đặt `SLM_MODEL_CHAT`
nhưng gõ lại tên cũ. Vì thế `SLM_MODEL_CHAT` chưa bao giờ có mặt ở file THẮNG. Đây là cơ
chế đầy đủ của triệu chứng mà vòng 1 chỉ mô tả được.

**Đã làm:** sửa `SLM_MODEL_CHAT`/`SLM_MODEL` ở cả `BE/.env` và `BE/.env.example`; thêm
khối đầu ở CẢ HAI file nói rõ hai hồ sơ và ai thắng khi trùng khoá.

### C2.3 `frontend-design/SKILL.md` tồn tại HAI bản y hệt

```
md5 f5c3db69... .claude/rules/frontend-design/SKILL.md
md5 f5c3db69... .claude/rules/skills/frontend-design/SKILL.md
```

Cả hai đều được nạp vào context mỗi phiên → tốn gấp đôi cho cùng một nội dung.
Tệ hơn: `.claude/rules/README.md` ghi vị trí chuẩn là
`.agents/rules/skills/frontend-design/SKILL.md` — **thư mục `.agents/` rỗng**, đường dẫn
đó không tồn tại. Ba nguồn sự thật, không cái nào đúng.

**Việc cần làm:** giữ MỘT bản mỗi cặp, bản còn lại thành con trỏ một dòng (không xoá hẳn
nếu có công cụ khác đọc), và sửa `README.md` trỏ đúng chỗ thật.

---

## C3 — Phụ thuộc khai báo mà không ai import

FE (`FE/package.json`), 0 hit trên toàn `src/` + `index.html` + `vite.config.js`:

```
@heroicons/react   axios   react-icons   uuid
```

BE: `pandas scipy pdfplumber psutil tqdm` không có dòng `import` nào.
**Cảnh báo dương tính giả:** `scipy` là dependency bắc cầu của `sentence-transformers`;
`gunicorn` (Dockerfile), `grpcio-tools` (`scripts/build_proto.py`), `psycopg` (driver
trong URL `postgresql+psycopg://`) đều SỐNG dù không có dòng import.

**Cách quyết:** chỉ gỡ FE (4 gói, đo bằng build). BE thì gỡ thử trong venv rồi chạy
suite; suite đỏ là trả lại. KHÔNG gỡ mù theo kết quả grep.

---

## C4 — Bố cục kho

- `01_Project_Playbooks/`, `03_Decision_Records/`, `04_General_Skills/` nằm ở thư mục gốc
  kho mã. Nội dung hợp lệ (RQ worker, semantic cache Redis — cả hai có thật trong
  `docker-compose.yml`), nhưng chỗ đứng thì không: 11 file `.md` chen giữa `BE/` và `FE/`.
  Số thứ tự `01_/03_/04_` nhảy cóc — `02_` không tồn tại.
- `.agents/` rỗng nhưng được `README.md` viện dẫn.
- `.cursor/rules/*.mdc` và `.claude/rules/*.mdc`: 7 file trùng TÊN, **cả 7 đều khác nội
  dung**. Không biết bản nào mới hơn — cần đối chiếu rồi hợp nhất, không phải xoá bừa.

**Việc cần làm:** gom vào `docs/`, giữ nguyên nội dung, cập nhật mọi đường dẫn viện dẫn.
Đây là `git mv`, không phải viết lại.

---

## C5 — Bề mặt nuốt lỗi im lặng

```bash
grep -rn -A1 "except Exception" --include=*.py BE/app BE/services BE/shared | grep -c "pass$"
# 81
```

40/81 nằm trong `BE/app/main.py`. Nhiều chỗ là fail-open cố ý và đúng (ghi log, cache,
telemetry). Nhưng đây chính là lớp làm ba sự cố vừa rồi khó tìm: hỏng mà không kêu.

**Việc cần làm — KHÔNG sửa cả 81.** Phân loại rồi chỉ chạm nhóm nguy hiểm:

1. Nuốt quanh **ghi DB / ghi file / persist** → phải kêu (đây là mất dữ liệu im lặng).
2. Nuốt quanh **log / telemetry / cache** → giữ nguyên, thêm comment `ponytail:` nói rõ
   fail-open là cố ý.
3. Nuốt quanh **import động** → giữ nguyên (đường dự phòng thật).

Sửa mù cả 81 chỗ là cách nhanh nhất tạo ra sự cố thứ tư.

---

## C6 — Soát lại logic ở đúng chỗ vừa dọn

Dọn xong mới soát, vì xoá mã chết làm lộ ra đường thật.

1. `services/mindmap/utils.py` chết nghĩa là **`MINDMAP_MODEL` cũ, prompt cũ, timeout cũ**
   trong đó cũng chết. Đối chiếu với `pipeline/modelcfg.py` xem có tham số nào vòng 1
   tưởng còn dùng.
2. `worker.py` mất contextvar job → xác nhận `_notify_progress` không phải đường progress
   duy nhất của mindmap (`server.py:40` có `progress_cb` riêng — đã kiểm, còn sống).
3. Chạy lại toàn bộ suite sau MỖI nhóm xoá, không dồn.

---

## Kết quả thi hành (2026-08-28)

| mũi | trạng thái |
|---|---|
| C2 | xong — 3 cặp file, chi tiết + đính chính ở trên |
| C1 | xong — 4 file + 9 hàm + 5 import chết; `main.py` 4745 -> 4726 dòng |
| C3 | xong — gỡ 4 dep FE, `npm run build` xanh, 27 file test / 212 test FE xanh |
| C4 | xong — `git mv` 11 file `.md` vào `docs/{playbooks,decisions,skills}`; xoá `.agents/` rỗng |
| S2 | xong — **12** chỗ hardcode (không phải 7), gom về `shared.config.DEFAULT_LOCAL_MODEL` |
| S6 | xong — sửa chỗ NÓI DỐI (409) thay vì dựng đường huỷ cho ingest mà FE chưa gọi |
| C5 | xong — phân loại 81 chỗ, chỉ sửa 3 |
| C6 | xong — xem "phát hiện phụ" dưới |
| S1 | xong từ vòng 1, chưa commit |
| S5 | **chưa làm** — tiêu chí "im > 5 giây" thực ra KHÔNG chỗ nào vi phạm; cái còn lại là thanh đứng yên giữa chừng, UX chứ không phải lỗi |

### Phát hiện phụ khi soát logic (C6) — CHƯA sửa

1. **Không có chỗ nào kiểm dim FAISS index lúc load.** `validate_vector_index_compatibility`
   bị xoá vì 0 caller; `.env` thì cảnh báo "đổi `EMBEDDING_MODEL_NAME` là PHẢI rebuild
   index". Đổi model xong query ném AssertionError khó hiểu từ faiss. Có 5+ chỗ
   `faiss.read_index`; chọn chỗ nối guard là quyết định riêng.
2. **Chức năng đọc ảnh gần như chắc chắn đang hỏng.** `vision/transcribe.py:27` đặt
   `DEFAULT_MODEL="qwen3.5:9b"` — không phải model thị giác, và `ollama /api/tags` cho thấy
   máy **chưa pull model VL nào**. Cần biết model VL nào là ý định mới sửa được.
3. **`.cursor/rules/*.mdc` vs `.claude/rules/*.mdc`:** 7 file trùng tên, cả 7 khác nội
   dung. Chưa biết bản nào mới hơn nên chưa hợp nhất.

---

## Tồn từ vòng 1 (chưa quyết)

| | việc | rủi ro | trạng thái |
|---|---|---|---|
| S1 | `memory/tree.py` kẹp worker + 4 test | đã xong, suite 871 | **chưa commit** |
| S2 | gom default model về `qwen2.5:7b-instruct` (6 chỗ `14b` + 1 chỗ `35B`), đưa `SLM_MODEL_CHAT` vào `BE/.env` | thấp — model NHỎ hơn, chỉ đổi đường mặc định khi thiếu env | chờ quyết |
| S6 | `ingest`/`query`/`grading` nhận cancel nhưng không ack | tiềm ẩn — FE chưa nối nút huỷ | chờ quyết |
| S5 | quiz 30%→70% và studymap 75%→85% đứng im giữa chừng | UX | chờ quyết |

---

## Thứ tự chạy

| | mũi | vì sao ở đây | rủi ro |
|---|---|---|---|
| 1 | C2 file cấu hình nói dối | bẫy đang sống, sửa là sửa văn bản | thấp |
| 2 | C1 mã chết | 1460 dòng, chứng minh được 0 caller | thấp |
| 3 | C3 gỡ dep FE | đo bằng build | thấp |
| 4 | C4 bố cục | `git mv`, đụng đường dẫn viện dẫn | trung bình |
| 5 | S1 commit + S2 default model | đã đo, đã test | thấp |
| 6 | C5 phân loại nuốt lỗi | chỉ nhóm 1 mới sửa | trung bình |
| 7 | C6 soát logic + suite | cổng cuối | — |

**Điểm dừng bắt buộc:** suite giữ ≥ 871 passed sau mỗi mũi. Đỏ là dừng, không đi tiếp.

---

## Cái kế hoạch này CỐ Ý không làm

- **Không tách `main.py` 4745 dòng.** Đó là viết lại, không phải dọn; và không có bằng
  chứng nào nói kích thước file là nguyên nhân của lỗi nào đã xảy ra.
- **Không đụng `.playbook/`** dù nó dài 2996 dòng — đó là bộ nhớ của dự án, dài là đúng.
- **Không gỡ dep BE theo grep.** `scipy`, `psycopg`, `gunicorn`, `grpcio-tools` đều không
  có dòng import mà vẫn sống.
- **Không sửa gộp 81 chỗ `except: pass`.**
