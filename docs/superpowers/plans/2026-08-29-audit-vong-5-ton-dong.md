# Audit vòng 5 — dọn nốt tồn đọng của 4 vòng trước

Vòng này gom nhóm 2 (chờ quyết) và nhóm 3 (hàng đợi) sau bốn vòng audit. Soạn plan bằng
cách **đo trước**, và phép đo lại lật đổ hai thứ tao từng viết ra.

---

## E0 — Đính chính: "9 cờ chưa test" thật ra là **5**

Vòng 1 (S7) kết luận 9 cờ chưa từng chạy nhánh không mặc định. Quét lại bằng phép khớp
**hai dạng gán** — `monkeypatch.setenv("K", "v")` VÀ kwarg `base_env(..., K="v")` — thì
4 trong 9 cái đó **đã có test**:

| cờ | vòng 1 nói | thật |
|---|---|---|
| `LATE_CHUNKING` | chưa test | test đặt cả `0` và `1` |
| `CRAG_ENABLED` | chưa test | test đặt cả `0` và `1` |
| `HITL_ENABLED` | chưa test | `test_hitl_graph.py:22` đặt `0`, `_qg_build.py:41` cũng `0` |
| `CONTEXTUAL_EMBEDDINGS` | chưa test | test đặt cả `0` và `1` |
| `HYPO_QA` | chưa test | test đặt cả `0` và `1` |

Regex vòng 1 chỉ khớp dạng `"K", "v"` nên mù hoàn toàn với `base_env(monkeypatch,
HITL_ENABLED="0")` — đúng dạng mà bộ test dùng nhiều nhất.

**Đây là lần thứ TƯ cùng một họ sai trong bốn vòng:**

1. Vòng 1 — `BASE_URL` khớp bên trong `DATABASE_URL` (thiếu ranh giới từ).
2. Vòng 3 — `cmp` báo 7 file y hệt là "khác toàn bộ" (line-ending, không phải nội dung).
3. Vòng 4 — đếm 9/128 khoá rồi gọi `ENV_SETUP.md` là bản sao rỗng (nó là tài liệu thao tác).
4. Vòng 5 — regex một dạng gán, bỏ sót dạng kwarg.

Cả bốn lần công cụ trả lời **đúng câu tao hỏi**. Luật rút ra và phải áp dụng từ đây:
**trước khi tin một phép quét phủ định ("không có X"), tự tìm một ví dụ dương tính đã biết
và kiểm phép quét có bắt được nó không.** Không có ca kiểm chứng thì con số 0 là vô nghĩa.

### Danh sách ĐÚNG — 5 cờ còn hở

| cờ | default | test đặt | nhánh hở |
|---|---|---|---|
| `ENRICH_METADATA` | `1` | chỉ `1` | tắt |
| `USE_LC_VECTOR_STORE` | xem E1 | chỉ `1` | tắt |
| `USE_LC_INGEST` | `1` | không đặt | tắt |
| `SUMMARY_FACTS` | `0` | không đặt | bật |
| `SUMMARY_COVERAGE` | `0` | không đặt | bật |

**Tin tốt:** so env thật với default cho thấy 3 cờ đang chạy nhánh KHÁC default —
`CONVERSATION_CONTEXT_ENABLED=true`, `HITL_ENABLED=0`, `NLI_ENABLED=0` — và **cả ba đều đã
có test ở nhánh đó**. Không lặp lại thảm hoạ `AUTH_PROTECT_APP_APIS`.

---

## E1 — `USE_LC_VECTOR_STORE`: ba tầng, ba default, một tầng nói ngược (LỖI MỚI)

> **ĐÃ SỬA** — gỡ 4 trường `use_lc_*` (0 người đọc) khỏi `Settings`, giữ nguyên default `"0"` của `store` (đó là đường test + guard dim đang chạy), thống nhất `_truthy` cho hai cờ ở `query_graph`. 13 test ở `tests/test_lc_flag_mot_nguon.py`.

Tìm ra khi soạn E0. Cùng một cờ, ba nơi định nghĩa mặc định:

```
shared/config.py:99          use_lc_vector_store: bool = True
shared/env_loader.py:45      os.environ.setdefault("USE_LC_VECTOR_STORE", "1")
vectorstore/store.py:65      os.getenv("USE_LC_VECTOR_STORE", "0")      <-- NGƯỢC
```

`MEMVID_DISABLE_LC_DEFAULTS=1` (chính `tests/conftest.py` đặt) làm tầng giữa im lặng. Khi
đó `config` nói **BẬT** còn `store` nói **TẮT** cho cùng một câu hỏi.

Ai thắng? `store` — vì `hybrid.py:252,338` gọi `_use_lc_vector_store()`. Còn trường trong
config thì:

```
settings.use_lc_vector_store -> 0 người đọc
settings.use_lc_ensemble     -> 0 người đọc
settings.use_lc_qa_chain     -> 0 người đọc
settings.use_lc_ingest       -> 0 người đọc
```

**Cả bốn trường `use_lc_*` trong `shared/config.py` không ai đọc.** Mã thật vẫn
`os.getenv()` rải rác — đúng thứ mà docstring của chính file đó tuyên bố đã dẹp:

> "Settings tập trung — nạp env MỘT lần thay vì os.getenv() rải rác lúc import."

Đây là **lần thứ ba** gặp "trừu tượng dựng xong rồi bị bỏ qua": trước đó là
`shared/paths.default_data_dir()` (0 caller, ba module tự viết lại) và
`__meta__["embedding_dim"]` (ghi 6 lần, đọc 0 lần).

Còn một chỗ lệch nhỏ hơn, hai dòng liền nhau trong `query_graph.py`:

```python
USE_LC_ENSEMBLE = ... not in ("0", "false", "no", "off")   # "maybe" -> True
USE_LC_QA_CHAIN = ... in  ("1", "true", "yes", "on")       # "maybe" -> False
```

Hai cờ anh em, hai ngữ nghĩa truthiness ngược nhau, cho cùng một giá trị lạ.

**Việc cần làm:**

1. Xác định default ĐÚNG cho `USE_LC_VECTOR_STORE` bằng cách **chạy**, không đọc: dựng
   index nhỏ, gọi retrieval với env bỏ trống, xem đường nào chạy.
2. Gom về MỘT nguồn (`shared/config`), y hệt cách `DEFAULT_LOCAL_MODEL` đã gom ở vòng 2 —
   hoặc **xoá 4 trường chết** nếu quyết định giữ `os.getenv` tại chỗ. Chọn một, không để cả hai.
3. `_flag()` trong `shared/config.py` đã có ngữ nghĩa truthy chuẩn; dùng nó cho cả hai cờ
   trong `query_graph`.
4. Test: cùng một giá trị env cho ra cùng một câu trả lời ở MỌI tầng.

**Là lỗi khi:** hai tầng trả lời khác nhau cho cùng một biến.

---

## E2 — Dep BE: `pip show` trả lời xong, không cần thí nghiệm

> **ĐÃ SỬA** — gỡ `pandas` + `pdfplumber`. Giữ `scipy/psutil/tqdm` (có `Required-by`).

Plan vòng 3 (R4.3) đề xuất "gỡ trong venv rồi chạy suite, đỏ thì trả lại". Thừa —
`Required-by` trả lời trong một lệnh:

```
pandas       Required-by: (rỗng)                                    -> GỠ ĐƯỢC
pdfplumber   Required-by: (rỗng)                                    -> GỠ ĐƯỢC
scipy        Required-by: scikit-learn, sentence-transformers       -> GIỮ
psutil       Required-by: pymupdf4llm                               -> GIỮ
tqdm         Required-by: huggingface_hub, sentence-transformers…   -> GIỮ
```

`pdfplumber` không phải bộ đọc PDF của dự án: `fitz` (PyMuPDF) và `pymupdf4llm` mới là
(`ingest_utils.py:2`, `markdown_convert.py:9`). `grep -rn "pdfplumber\|import pandas"` trên
toàn `app services shared evaluation scripts tests` → **rỗng**.

**Việc cần làm:** gỡ 2 dòng khỏi `BE/requirements.txt`, chạy suite một lần.
`scipy/psutil/tqdm` **giữ nguyên** — pin dep bắc cầu mình thật sự dựa vào là cố ý.

**Là lỗi khi:** khai báo một gói không ai import và cũng không ai cần bắc cầu.

---

## E3 — Ba cờ hở còn lại: viết test, không đổi hành vi

> **ĐÃ LÀM** — `tests/test_ingest_flag_branches.py` (5 test) chạy graph thật với cả hai giá trị của `USE_LC_INGEST` và `ENRICH_METADATA`. Cả bốn nhánh đều chạy được. `SUMMARY_FACTS`/`SUMMARY_COVERAGE` giữ nguyên quyết định không test.

Sau E0 còn 5, trừ 2 cái `SUMMARY_*` đã đo tay ở vòng 1:

| cờ | vì sao đáng | chi phí |
|---|---|---|
| `USE_LC_INGEST=0` | rẽ nhánh ở `ingest_graph.py:44,106` — đường ingest thay thế, chưa chạy lần nào | test ingest có sẵn, thêm tham số |
| `ENRICH_METADATA=0` | `ingest_graph.py:142` bỏ gắn metadata; chunk thiếu `section_id`/`category` chảy xuống retrieval | thấp |
| `USE_LC_VECTOR_STORE` | gộp vào E1, đừng làm riêng | — |

`SUMMARY_FACTS` / `SUMMARY_COVERAGE`: **không viết test bật** ở vòng này. Vòng 1 đã đo
thật — bật `SUMMARY_FACTS` làm study mode NGHÈO HƠN trên 7b (facts 0/3→1/3 mục,
key_concepts 13→7, chậm 45%). Khoá cache đã sửa để bật/tắt không trả bản cũ. Viết test cho
một nhánh đã quyết không dùng là làm cho có.

**Là lỗi khi:** cờ có nhánh không mặc định mà 0 test chạm tới **và** nhánh đó là đường
người dùng có thể rơi vào.

---

## E4 — Đo cổng LLM (`MAX_CONCURRENT_LLM_CALLS` 1 → 2)

> **CHƯA ĐO ĐƯỢC — điều kiện tiên quyết không đạt.** `nvidia-smi`: 5331/6141 MiB đã dùng, GPU 40%, trong khi `/api/ps` báo Ollama giữ **0** — tiến trình khác (explorer, msedgewebview2, SystemApps) chiếm 5.3 GB, còn ~810 MiB, không đủ nạp model 4.68 GB. Gần y hệt lần Study Map 487s (5378/6141 MiB). Giữ `MAX_CONCURRENT_LLM_CALLS=1`, đo lại khi máy rảnh.

**Trạng thái thật, không phải giả định:**

```
.env:40        MAX_CONCURRENT_LLM_CALLS=1      <- giá trị đang chạy
BE/.env        (không khai báo) -> rơi xuống root
BE/.env.example:295  MAX_CONCURRENT_LLM_CALLS=2   <- example DEV nói 2, thực tế chạy 1
```

Thêm một chỗ example lệch thực tế, cùng họ với `SLM_MODEL` ở vòng 2. Sửa kèm.

Cổng 1 slot đang kẹp **cả ba** chỗ song song về tuần tự: `mindmap_factory._enrich_parallel`,
`summary_factory._parallel`, `memory/tree.so_worker_tom_tat`. Nâng lên 2 là giảm gần nửa
thời gian tường — **nếu** VRAM chịu được. Card 6.14 GiB, model 4.68 GB: hai lượt gọi đồng
thời KHÔNG nạp hai bản model (Ollama chia sẻ một bản), nhưng KV-cache nhân đôi theo
`num_ctx` và `OLLAMA_NUM_PARALLEL` mới là thứ quyết định.

**Giao thức đo — đo, không suy luận:**

1. `curl -s localhost:11434/api/ps` lúc rảnh (hiện tại: `{"models":[]}`).
2. Chạy tóm tắt `day08-_rag_pipeline_docx` (18 chunk, 3 mục — đã có mốc cũ **60.9s** với
   cổng=1 sau bản vá vòng 2) với `MAX_CONCURRENT_LLM_CALLS=1`, ghi `size_vram` giữa chừng.
3. Lặp lại với `=2`. So **ba** số: tổng thời gian, `size_vram/size`, và có dòng
   `LLM busy (in-process)` nào không.
4. Máy phải RẢNH. Lần 487s của Study Map truy ra nguyên nhân là một game chiếm
   5378/6141 MiB — đo lúc đó là đo cái khác.

**Chốt theo số:** nhanh hơn ≥25% và `size_vram/size` vẫn ~1.0 → đổi thành 2. Ngược lại giữ
1 và ghi kết quả vào `.playbook` để không ai hỏi lại.

**Không đổi mã.** Đây là một dòng env.

---

## E5 — Hai câu hỏi cần mày trả lời (có mặc định nếu im lặng)

1. **Study map probe.** DB có đúng 2 map: `7bf18385` (19 node, 2026-08-27 — tao sinh lúc dò
   lỗi) và `686f8481` (44 node, 2026-08-21 — của mày). **Mặc định của tao: xoá cái
   `7bf18385`**, nó là rác chẩn đoán. Nói giữ thì tao giữ.
2. **`docs/memvid_speed_fix.docx`** — nhị phân 25 KB, tên thời MemVid. **Mặc định: giữ.**
   Tao không xoá tài liệu mà tao không đọc được nội dung.

---

## Không làm — nêu lý do để khỏi hỏi lại

- **Tách `main.py` (4737 dòng).** Vẫn không có bằng chứng nào nối kích thước file với một
  lỗi đã xảy ra. Bốn vòng audit tìm ra ~20 lỗi thật; **không lỗi nào** có nguyên nhân là
  "file quá dài". Muốn có căn cứ thì đo cái khác: đếm số lỗi trên 100 dòng theo từng file
  từ lịch sử `.playbook`. Có số rồi hẵng bàn tách.
- **`quiz_generation` 30%→70% và `ingest` BuildMemoryTree.** Bỏ có chủ ý (vòng 3, nguyên
  tắc "chọn một chỗ"). `ingest` chạy nền không ai nhìn; quiz đứng im 40s nhưng nhãn bước
  vẫn đổi ngay từ đầu.
- **7 file `.mdc` trùng.** Vòng 3 đã chứng minh chúng y hệt nhau; trùng do mỗi công cụ đọc
  thư mục riêng. `.gitattributes` (vòng 3) đã dẹp phần line-ending gây hiểu nhầm.

---

## Thứ tự chạy

| | mũi | vì sao ở đây | rủi ro |
|---|---|---|---|
| 1 | E2 gỡ `pandas` + `pdfplumber` | đã có bằng chứng dứt điểm | thấp |
| 2 | E1 gom default `use_lc_*` | **lỗi thật**, hai tầng nói ngược nhau | trung bình |
| 3 | E3 test 2 cờ ingest | tăng lưới an toàn cho E1 | thấp |
| 4 | E4 đo cổng LLM | cần máy rảnh, không đổi mã | thấp |
| 5 | E5 | chờ mày trả lời | — |

**Điểm dừng bắt buộc:** BE ≥ **894 passed / 4 skipped**; FE build + 212 test.
