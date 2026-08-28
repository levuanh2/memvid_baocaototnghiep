# Kế hoạch audit toàn dự án StudyMap AI

**Mục tiêu:** tìm nốt các sai sót còn lại, theo ĐÚNG những lớp lỗi đã tự lặp lại ba lần
trong hai ngày qua — chứ không quét mù cả repo.

**Vì sao quét theo lớp lỗi, không quét theo thư mục:** ba đợt sửa gần nhất (mindmap
2026-08-26, summary 2026-08-27, studymap/quiz/progress 2026-08-28) đều là **cùng một khiếm
khuyết nhân bản sang module anh em**, và cả ba đều **vô hình với bộ test xanh** vì test giả
LLM và chỉ chạy một nhánh cấu hình. Quét theo lớp lỗi bắt được bản sao thứ tư; quét theo
thư mục thì không.

**Nguyên tắc chung cho mọi mũi quét:**
- Quét bằng cách **GỌI THẬT**, không đọc mã suy đoán. Bài học 2026-08-28: `grep` ra 21 chỗ,
  gọi thật cho biết đúng 8 chỗ vỡ.
- Mỗi phát hiện phải có **một dòng bằng chứng chạy được** dán kèm.
- Trước khi sửa: đọc `.playbook/known-issues.md` + `.playbook/lessons-learned.md` (luật dự án).
- Sau khi sửa: test hồi quy + cập nhật `.playbook` (nguyên nhân gốc + cách phòng).
- Suite đầy đủ phải chạy bằng `BE/.venv/Scripts/python.exe`, KHÔNG phải Python global
  (global đã trôi khỏi pin `requirements.txt` — xem known-issues 2026-08-21).
  Mốc hiện tại: **867 passed, 4 skipped**.

---

## S0 — Vệ sinh bí mật (5 phút, chạy trước tiên)

Luật dự án: secret key Supabase và mật khẩu DB CHỈ được nằm trong `.env` và `BE/.env`
(cả hai đã gitignore). Mật khẩu chứa ký tự `#`, phải mã hoá thành `%23`.

```bash
git ls-files -z | xargs -0 grep -lI -E 'eyJhbGciOi|service_role|postgresql://[^ ]*:[^ @]*@'
git log --all --oneline -S 'service_role' | head
```

**Là lỗi khi:** bất kỳ file ĐANG THEO DÕI nào chứa khoá thật, hoặc lịch sử git từng chứa.
**Không phải lỗi:** placeholder trong `.env.example`.

---

## S1 — Song song LLM không kẹp theo cổng in-process

**Bằng chứng đã có:** hai chỗ đã sửa (`mindmap_factory._enrich_parallel`,
`summary_factory._parallel`). Chỗ thứ ba đã tìm thấy khi soạn kế hoạch này và CHƯA sửa:

`BE/app/domains/memory/tree.py:481`

```python
max_workers = min(4, int(os.environ.get("MAX_SUMMARIZE_WORKERS", "3")))
with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
    for result in executor.map(_summarize_section, section_raw_data):
```

`_summarize_section` gọi `_llm_summarize_for_memory` — tức 3 lời gọi LLM song song đâm vào
`MAX_CONCURRENT_LLM_CALLS=1`. Hai luồng sau xếp hàng, chờ quá
`LLM_QUEUE_WAIT_TIMEOUT_SECONDS=180` thì ném `LLM busy (in-process)`.

**Việc cần làm:**

1. Liệt kê mọi chỗ song song có gọi LLM:
   ```bash
   grep -rn "max_workers=" BE/app BE/services BE/shared --include=*.py | grep -v test
   ```
   Loại bỏ `max_workers=1` (tuần tự, chỉ để có timeout) và `query_graph.py:301`
   (chạy history + retrieval, KHÔNG gọi LLM — đã có comment ponytail giải thích).
2. Với mỗi chỗ còn lại, kẹp theo `llm_factory.inproc_slots()` y hệt hai chỗ đã sửa.
3. Tái hiện lỗi rẻ tiền TRƯỚC khi sửa: hạ `LLM_QUEUE_WAIT_TIMEOUT_SECONDS` xuống 5 rồi chạy
   — cách này đã bắt được 2/3 mục chết ở summary trong 15 giây thay vì 15 phút.

**Là lỗi khi:** `max_workers > inproc_slots()` và hàm worker gọi `ask_ai`.

---

## S2 — Model mặc định hard-code không vừa VRAM

**Bằng chứng đã có:** `BE/.env` từng để `qwen2.5:14b` (9,95 GB) trên card 6 GiB cho CẢ
mindmap lẫn summary — hai lần, hai ngày liên tiếp. Đã sửa ở file env, nhưng **giá trị mặc
định trong mã vẫn là 14b ở 6 chỗ**:

```
app/clients/llm_factory.py:152   "summary": os.getenv("SLM_MODEL_SUMMARY", "qwen2.5:14b")
app/clients/llm_factory.py:153   "mindmap": os.getenv("MINDMAP_MODEL",    "qwen2.5:14b")
app/clients/llm_factory.py:156   "quiz":    os.getenv("QUIZ_MODEL", os.getenv("SLM_MODEL_SUMMARY", "qwen2.5:14b"))
app/graphs/summary_graph.py:136  model=os.getenv("SLM_MODEL_SUMMARY", "qwen2.5:14b")
shared/config.py:167             model_summary=os.getenv("SLM_MODEL_SUMMARY", "qwen2.5:14b")
shared/config.py:168             model_mindmap=os.getenv("MINDMAP_MODEL",    "qwen2.5:14b")
```

Hôm nay chúng không nổ vì cả 4 file env đều đặt biến. Một lần clone repo thiếu env là chạy
thẳng vào model 9,95 GB — đúng thứ đã tốn của dự án này hai buổi.

**Việc cần làm:**

1. Quyết định MỘT giá trị mặc định an toàn cho máy 6 GiB (`qwen2.5:7b-instruct`).
2. Sửa cả 6 chỗ. Đây là thay đổi đụng cả chat/quiz — **cần người dùng đồng ý trước**.
3. `summary_graph.py:136` còn một vấn đề riêng: nó ghi giá trị ENV vào
   `record.generator.model`, tức ghi lại "model nào ĐƯỢC CẤU HÌNH" chứ không phải "model
   nào ĐÃ CHẠY". Nếu gateway định tuyến sang Gemini/Groq thì record nói dối.

**Là lỗi khi:** default trong mã > 6 GiB, hoặc provenance ghi khác model thật đã chạy.

---

## S3 — Env trôi giữa `.env` và `BE/.env`, và biến chết

**Bằng chứng đã có:** `BE/.env` nạp TRƯỚC với `override=False` nên nó THẮNG `.env` gốc
(`shared/env_loader.load_project_env`). Đã trúng bẫy này 2 lần. Ngoài ra đợt mindmap tìm
thấy **14 biến `MINDMAP_*` chết** — không dòng mã nào đọc, nhưng tên nghe rất hợp lý nên
người debug sẽ chỉnh chúng rồi kết luận "sửa rồi vẫn chậm".

**Việc cần làm:** dựng 3 tập hợp rồi in phần giao/hiệu.

```bash
# A = khoá mã ĐỌC
grep -rhoE 'os\.(getenv|environ\.get)\("[A-Z_0-9]+"' BE/app BE/services BE/shared --include=*.py |
  grep -oE '"[A-Z_0-9]+"' | tr -d '"' | sort -u > /tmp/doc.txt
grep -rhoE '_(flag|int|float)\("[A-Z_0-9]+"' BE/shared/config.py |
  grep -oE '"[A-Z_0-9]+"' | tr -d '"' | sort -u >> /tmp/doc.txt

# B = khoá KHAI BÁO trong từng file env
for f in .env BE/.env .env.example BE/.env.example; do
  grep -hoE '^[A-Z_0-9]+=' "$f" | tr -d '=' | sort -u > "/tmp/env_$(basename $f).txt"
done
```

Ba báo cáo:

- **Trôi:** khoá có ở CẢ `.env` lẫn `BE/.env` nhưng khác giá trị → `BE/.env` thắng, im lặng.
- **Chết:** khoá khai báo trong env nhưng không nằm trong tập A.
- **Ngầm:** khoá trong tập A nhưng không khai báo ở đâu → default trong mã đang chạy.

**Là lỗi khi:** trôi (giá trị khác nhau) hoặc chết. "Ngầm" chỉ là lỗi nếu default không an toàn.

---

## S4 — Nhánh chế độ mở (`uid=None`) ở phần còn lại của app

**Bằng chứng đã có:** 8 chỗ vỡ, đã sửa (studymap ×2, quiz ×1, attempts ×2, progress ×4 hàm).
Còn MỘT chỗ chưa xác minh vì lúc quét tao đoán sai tên hàm:

`BE/app/domains/documents/storage.py:90`

```python
return f"{_safe_key_part(str(user_id))}/{_safe_key_part(str(document_id))}/{_safe_key_part(name)}"
```

`str(None)` ở đây không ném lỗi DB — nó tạo thư mục Supabase Storage tên `"None"`. Im lặng
hoàn toàn, và mọi upload ẩn danh dồn chung một thư mục.

**Việc cần làm:**

1. Gọi thật hàm đó với `user_id=None`, xem key sinh ra.
2. Quét nốt các đường còn lại: mọi route gọi `_require_app_user()` rồi truyền `uid` xuống.
   ```bash
   grep -n "_require_app_user()" BE/app/main.py | wc -l
   ```
   Với mỗi route, lần theo `uid` xem nó đi tới đâu.
3. Quyết: `documents._row()` đã có quy ước quy user ẩn danh ngược về `None`; khoá lưu trữ
   nên dùng id user ẩn danh thật, không dùng chuỗi `"None"`.

**Là lỗi khi:** `str(None)` lọt vào uuid, khoá lưu trữ, tên file, hoặc cache key.

---

## S5 — Im lặng tiến trình ở pipeline dài

**Bằng chứng đã có:** mindmap im 166 giây, summary im 82,5 giây — cả hai vì `progress_cb`
chỉ được gọi BÊN TRONG vòng `as_completed`, tức dòng đầu tiên chỉ đến khi một đơn vị CHẠY
XONG. Người dùng đọc đó là treo rồi bấm huỷ đúng lúc job đang chạy bình thường.

**Việc cần làm:** với mỗi pipeline nhận `progress_cb`, kiểm chứng bằng test đếm
**số lần progress ĐÃ kêu tại thời điểm lời gọi LLM đầu tiên bắt đầu** — không đếm tổng lúc
xong, vì tổng vẫn đúng ngay cả khi dồn hết về cuối. Mẫu có sẵn:
`BE/tests/test_summary_summarize.py::test_bao_progress_TRUOC_khi_muc_dau_chay_xong`.

Danh sách cần soi: ingest, quiz generation, gap analysis, review plan, memory tree.
Riêng `run_study_map_job` bước `Relations` không có progress nào — nó nhảy 70% → 75% rồi
đứng im suốt cả lời gọi LLM cuối (đo được 106 giây ở lần chạy 2026-08-28).

**Là lỗi khi:** khoảng im lặng đầu tiên > ~5 giây trên máy này.

---

## S6 — Hợp đồng job: done-kèm-result, cancel, và đường lỗi

**Bằng chứng đã có:** `.playbook` ghi ba lỗi riêng biệt ở đúng chỗ này — race
"done trước result" (2026-07-06), huỷ kẹt "Đang huỷ… (36%)" (2026-07-17), và job lỗi để
artifact kẹt `processing` mãi.

**Việc cần làm:** với MỖI `job_type`, kiểm ba tính chất:

1. `status="done"` và `result` ghi trong CÙNG một `update_job` (không tách hai lệnh).
2. Có ít nhất một điểm kiểm huỷ TRƯỚC mỗi lời gọi LLM dài và TRƯỚC khi persist.
3. Đường lỗi đánh dấu artifact `failed`, không để kẹt `processing`.

```bash
grep -rn 'job_type="' BE/app/main.py | sed 's/.*job_type="\([a-z_]*\)".*/\1/' | sort -u
```

`test_studymap_generate.py::test_failed_job_marks_map_failed_not_stuck_processing` là mẫu
test cho tính chất 3.

**Là lỗi khi:** thiếu bất kỳ tính chất nào trong ba.

---

## S7 — Cờ tính năng chưa từng chạy nhánh không mặc định

**Bằng chứng đã có:** toàn bộ sự cố 2026-08-28 nằm gọn trong lớp này — 20 test Study Map
đều mở đầu bằng `_protect(...)`, nhánh `AUTH_PROTECT_APP_APIS` tắt chưa chạy lần nào và
nó vỡ 100%. Coverage nhìn đẹp vì đếm theo SỐ CA, không theo NHÁNH CẤU HÌNH.

**Việc cần làm:**

1. Liệt kê mọi cờ:
   ```bash
   grep -n '_flag("' BE/shared/config.py
   ```
2. Với mỗi cờ, tìm test nào đặt nó sang giá trị KHÔNG mặc định.
3. Cờ nào có 0 test ở nhánh kia → xếp vào hàng đợi, ưu tiên theo mức độ người dùng chạm tới.

Đã biết trước: `SUMMARY_FACTS` bật lên thì study mode ra NGHÈO HƠN trên qwen2.5:7b
(đo 2026-08-27: 1/3 mục trả được facts, key_concepts 13→7, chậm hơn 45%). Cờ đó phải giữ
TẮT — nhưng khoá cache đã được sửa để việc bật/tắt không còn trả bản cũ.

**Là lỗi khi:** cờ có nhánh không mặc định mà 0 test chạm tới.

---

## Thứ tự chạy

| | mũi | vì sao ở vị trí này | chi phí |
|---|---|---|---|
| 1 | S0 bí mật | rẻ nhất, hậu quả nặng nhất | 5 phút |
| 2 | S1 song song LLM | đã có 1 phát hiện chắc chắn | ~30 phút |
| 3 | S4 chế độ mở | đã có 1 phát hiện chắc chắn | ~20 phút |
| 4 | S3 env trôi | đã trúng bẫy 2 lần | ~30 phút |
| 5 | S6 hợp đồng job | 3 lỗi cũ cùng chỗ | ~45 phút |
| 6 | S5 im lặng tiến trình | ảnh hưởng UX, không mất dữ liệu | ~45 phút |
| 7 | S7 cờ chưa test | tạo hàng đợi việc, không sửa ngay | ~30 phút |
| — | S2 model mặc định | **CẦN ĐỒNG Ý TRƯỚC** (đụng chat/quiz) | ~15 phút |

**Sau mỗi mũi:** dừng, báo phát hiện kèm bằng chứng chạy được, hỏi có sửa không. KHÔNG
gộp cả 7 mũi thành một đợt sửa — ba đợt vừa rồi cho thấy mỗi lớp lỗi cần một cách sửa
khác nhau, và sửa đồng loạt cùng một kiểu là chỗ dễ tạo lỗ rò dữ liệu nhất (loại C ở
`progress`, 2026-08-28).

**Điểm dừng bắt buộc:** suite đầy đủ giữ ≥ 867 passed sau mỗi mũi có sửa mã.

---

## Cái kế hoạch này CỐ Ý không làm

- **Không "review toàn bộ 4600 dòng `main.py`".** Không có bằng chứng dẫn đường thì đó là
  đọc mã lấy lệ, và ba lỗi thật vừa rồi đều không tìm ra bằng cách đọc.
- **Không đụng hiệu năng.** 487 giây của Study Map đã truy ra nguyên nhân ngoài mã: GPU bị
  một game chiếm, Ollama chỉ được cấp 0,19 GB VRAM. Đo lại khi máy rảnh, không sửa mã.
- **Không đụng `review`/`gap_analysis`.** Hai domain đó lấy `user_id` từ hàng DB đã có nên
  miễn nhiễm với lớp lỗi `str(None)`; đã kiểm ở đợt 2026-08-28.
- **Không đụng FE.** Chưa có triệu chứng nào trỏ về đó trong ba đợt vừa rồi.
