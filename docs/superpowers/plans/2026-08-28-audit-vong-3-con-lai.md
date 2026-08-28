# Audit vòng 3 — phần còn lại, sau khi đã đính chính hai kết luận sai

**Bối cảnh.** Vòng 1 quét theo lớp lỗi tái diễn, vòng 2 quét theo "thứ nói dối". Vòng này
gom nốt những gì hai vòng trước để lại — **và bắt đầu bằng việc sửa hai chỗ chính tao
kết luận sai**, vì `.playbook` là bộ nhớ của dự án và một mục sai còn hại hơn không có.

---

## R0 — Hai đính chính (ĐÃ LÀM, ghi lại để không lặp)

### R0.1 "Chức năng đọc ảnh gần như chắc chắn đang hỏng" — SAI

Tao suy từ TÊN model trong `/api/tags` rằng máy chưa có model thị giác nào.
`/api/show` trả thẳng `capabilities`:

```
qwen3.5:9b           ['completion', 'vision', 'tools', 'thinking']
gemma4:e4b           ['completion', 'vision', 'audio', 'tools', 'thinking']
qwen2.5:7b-instruct  ['completion', 'tools']            <- không có vision
```

`vision/transcribe.py` đang dùng đúng model có vision, lại còn `is_available()` probe
`capabilities` rồi fail-closed nên FE ẩn nút ảnh khi không dùng được. Không có lỗi.
Còn đúng một điều: 6.59 GB trên card 6.14 GiB nên lượt đọc ảnh tràn CPU và chậm.

### R0.2 "7 file `.mdc` đều khác nội dung" — SAI

`cmp` báo khác vì line-ending: `.claude/rules/*.mdc` là CRLF, `.cursor/rules/*.mdc` là LF.

```bash
for f in .claude/rules/*.mdc; do
  b=".cursor/rules/$(basename "$f")"
  [ -f "$b" ] && diff --strip-trailing-cr "$f" "$b"
done   # rỗng -> giống hệt nhau
```

**Cùng một kiểu sai với `BASE_URL` khớp trong `DATABASE_URL` ở vòng 1:** công cụ trả lời
đúng câu mình HỎI, không phải câu mình NGHĨ. Chuẩn hoá trước khi so.

---

## R1 — Index tài liệu không kiểm dim, trong khi memory tree thì có

**Bất đối xứng giữa hai anh em — đúng hình dạng lỗi lặp lại của dự án này.**

`memory/tree.py` có guard đầy đủ:

- `_tree_matches_current_embedding()` (dòng ~574): tree thiếu metadata, khác `model_name`,
  hoặc khác `embedding_dim` đều bị coi là không khớp.
- `build_memory_tree_for_sources` in ra `Drop legacy tree for <stem>: model=… dim=… != current …` rồi bỏ tree đó.
- `_rebuild_memory_index` đếm `skipped_mismatched`.

Index tài liệu thì **ghi 6 lần, đọc 0 lần**:

```bash
grep -n "embedding_dim" BE/app/domains/vectorstore/store.py
# 410, 481, 663, 882  -> ghi vào __meta__
# 195                 -> _get_current_embedding_dim(), không so với __meta__
grep -rn "embedding_dim" BE/app/domains/retrieval/hybrid.py   # rỗng
```

`validate_vector_index_compatibility()` từng tồn tại ở `embedding_utils.py` để làm đúng
việc này, nhưng 0 caller nên vòng 2 đã xoá.

**Hậu quả:** đổi `EMBEDDING_MODEL_NAME` mà quên rebuild index thì query ném AssertionError
từ faiss, không phải một câu báo rõ ràng. `.env` có cảnh báo bằng comment — comment không
chặn được gì (bài học S2).

**Việc cần làm:**

1. Tái hiện trước: build index nhỏ với `all-MiniLM-L6-v2` (384) rồi query bằng `bge-m3`
   (1024). Ghi lại thông báo lỗi THẬT — chưa có bằng chứng thì chưa biết đang sửa gì.
2. Nối guard vào MỘT chỗ: chỗ đọc index cho retrieval, không phải cả 5 chỗ
   `faiss.read_index`. Ứng viên: `retrieval/hybrid.py:120` (đọc mỗi query, có cache) hoặc
   `store.py:294` (`FAISS.load_local`, có cache per-process).
3. Thông điệp phải nói ĐƯỢC VIỆC: model nào đang cấu hình, index build bằng model nào,
   và lệnh rebuild cụ thể.

**Là lỗi khi:** dim lệch mà không có câu báo nêu tên hai model.

**Rủi ro:** đường đọc index là hot path. Guard phải chạy MỘT lần lúc load, không phải mỗi
query. Cache đã có sẵn ở cả hai ứng viên — bám vào đó.

---

## R2 — Thanh tiến trình đứng yên giữa chừng

Vòng 2 đã kiểm và kết luận: tiêu chí cũ ("khoảng im ĐẦU TIÊN > 5 giây") **không chỗ nào
vi phạm** — mọi job báo mốc đầu ngay lúc bắt đầu. Cái còn lại nhẹ hơn nhưng có thật:

| job | cửa sổ đứng im | trong đó chạy gì | tổng thật đo được |
|---|---|---|---|
| `quiz_generation` | 30% → 70% | `generate_questions` + retry | 43–70s |
| `study_map_generation` | 75% → 85% | `pipeline.relations()` | 106s / job 487–633s |
| `short_answer_grading` | 20% → 100% | 1 LLM mỗi câu tự luận | — |
| `ingest` | trong `BuildMemoryTree` | 1 LLM mỗi section, giờ tuần tự | job tới 410s |

Chỉ `mindmap` và `summary` có `progress_cb` đi vào tới bên trong (`grep -rn progress_cb`).

**Việc cần làm — chọn ĐÚNG một, không làm cả bốn:**

`short_answer_grading` là ứng viên tốt nhất: vòng lặp theo câu hỏi đã có sẵn, thêm
`progress_cb` là cộng thêm chỉ số vòng lặp, và người dùng đang ngồi CHỜ màn hình kết quả
(khác ingest, chạy nền).

`study_map Relations` đứng thứ hai: 106 giây một cục, nhưng `pipeline.relations()` là một
lời gọi LLM đơn — không chia nhỏ được, chỉ đổi được nhãn (`75% → "Đang tìm quan hệ giữa
19 khái niệm…"`). Đổi nhãn là thay đổi rẻ nhất và thành thật nhất.

**Không làm:** ép chia nhỏ một lời gọi LLM chỉ để thanh chạy mượt. Đó là làm đẹp bằng cách
làm chậm.

**Đo bằng gì:** mẫu có sẵn `test_summary_summarize.py::test_bao_progress_TRUOC_khi_muc_dau_chay_xong`
— đếm số lần progress kêu TẠI THỜI ĐIỂM lời gọi LLM đầu bắt đầu, không đếm tổng lúc xong.

---

## R3 — `.gitattributes` cho line-ending

R0.2 cho thấy repo đang trộn CRLF và LF trong cùng loại file. Triệu chứng đã gặp:

- `cmp`/`diff` báo hai file y hệt là "khác toàn bộ" → dẫn tới một kết luận sai trong plan.
- `git add` in cảnh báo `LF will be replaced by CRLF` cho 7 file ở commit `e632e90`.

**Việc cần làm:** một file `.gitattributes` ở gốc, `* text=auto` cộng vài dòng `binary`
cho `.faiss`, `.docx`, `.svg` nếu cần. KHÔNG chạy renormalize toàn kho trong cùng commit
với thay đổi mã — nó tạo một diff khổng lồ che mất mọi thứ khác.

**Là lỗi khi:** hai file cùng nội dung mà công cụ so sánh báo khác.

---

## R4 — Quyết định hạ tầng, không phải lỗi

Ba thứ đã đo xong ở các vòng trước, chỉ chờ chốt. Không cái nào là bug.

### R4.1 `MAX_CONCURRENT_LLM_CALLS` 1 → 2

Cổng đang 1 slot. Vì cổng là 1, ba chỗ song song vừa sửa (mindmap enrich, summary
sections, memory tree) đều bị kẹp về **tuần tự**. Nâng lên 2 là gần như giảm nửa thời gian
tường của cả ba — nhưng hai model 7b cùng lúc trên card 6.14 GiB thì Ollama phải đẩy bớt
xuống CPU, và đó đúng là thứ đã tạo ra 529 giây ở mindmap.

**Cách quyết:** đo, đừng đoán. Chạy một job tóm tắt với `MAX_CONCURRENT_LLM_CALLS=1` rồi
`=2`, xem `ollama /api/ps` báo bao nhiêu GB nằm trong VRAM ở mỗi lần. Ước lượng lý thuyết
vô dụng ở đây vì Ollama tự quyết chuyện tải/đuổi model.

### R4.2 Dọn dữ liệu probe

Study map `7bf18385-…` (19 node, Day08) do tao sinh ra lúc dò lỗi 2026-08-28, còn nằm
trong DB. Xoá hay giữ làm dữ liệu demo cho luận văn — tuỳ mày.

### R4.3 Dep BE nghi thừa

`pandas scipy pdfplumber psutil tqdm` không có dòng `import` nào. **Chưa gỡ** vì `scipy`
là dep bắc cầu của `sentence-transformers`, và grep đã sai một lần rồi (`gunicorn`,
`grpcio-tools`, `psycopg` đều sống mà không có dòng import). Cách duy nhất đáng tin: gỡ
trong venv, chạy suite, đỏ thì trả lại.

---

## Thứ tự chạy

| | mũi | vì sao ở đây | rủi ro |
|---|---|---|---|
| 1 | R3 `.gitattributes` | rẻ, chặn nguồn gây kết luận sai | thấp |
| 2 | R1 guard dim index | lỗ thật, có anh em làm đúng để bắt chước | trung bình (hot path) |
| 3 | R2 progress `short_answer_grading` | UX, phạm vi hẹp | thấp |
| 4 | R4.1 đo cổng LLM | chỉ đo, chưa đổi | thấp |
| — | R4.2 / R4.3 | cần mày chốt | — |

**Điểm dừng bắt buộc:** BE suite ≥ **884 passed / 4 skipped** sau mỗi mũi có sửa mã.
FE: `npm run build` + 212 test.

---

## Cái kế hoạch này CỐ Ý không làm

- **Không nối progress cho cả 4 job.** `ingest` chạy nền, không ai ngồi nhìn; ép thêm
  progress vào đó là làm cho có.
- **Không dựng đường huỷ cho `ingest`/`query`/`grading`.** Vòng 2 đã chọn sửa chỗ nói dối
  (409) thay vì dựng chức năng FE chưa gọi. Giữ nguyên quyết định đó cho tới khi có nút thật.
- **Không renormalize line-ending toàn kho.** Nó tạo diff che mất mọi thứ.
- **Không tách `main.py`.** Vẫn chưa có bằng chứng nào nói kích thước file gây ra lỗi nào.
- **Không đụng `vision/`.** R0.1 cho thấy nó đang đúng.
