# Kết quả thực nghiệm — thang ablation E0–E7

> Tài liệu này giữ **số liệu** để dùng cho chương 4. Dữ liệu thô nằm ở
> `reports/evaluation/` — thư mục đó **không theo git**, nên bảng ở đây là bản lưu
> duy nhất trong repo.
>
> Cập nhật lần cuối: 2026-08-26. Trạng thái: **thang E0–E7 đã chạy đủ trên `R1_structure`,
> cả 8 nấc trên cùng một phần cứng (GPU).**

---

## 1. Điều kiện chạy

Mọi số dưới đây gắn với đúng bộ dữ liệu và index này. Đổi bất kỳ hash nào thì số không so sánh được nữa.

| | |
|---|---|
| `corpus_version` | `corpus_v1.0` |
| `dataset_hash` | `7e9fe96fa1af82469e7016044b0c6035dd059602fbf9cb1b0a4eee1dfda375ae` |
| `split_hash` | `e258da3e0b93b86faeba00e831e80f3e30553e05c4e6ba04aa6b6d54fc7e2f0e` |
| `annotation_hash` | `32ce6d4d36df21cd26751b19011284c51cbb716dd6adfe6093f3e1424d4ca5f9` |
| `frozen_at` | 2026-08-25T06:45:48Z |
| Python | 3.11.9 · torch 2.5.1+cu124 |
| Embedding | `BAAI/bge-m3` (1024 chiều) |
| Reranker | `BAAI/bge-reranker-v2-m3` |
| NLI | `MoritzLaurer/mDeBERTa-v3-base-mnli-xnli` |
| Sinh câu trả lời | `qwen2.5:7b-instruct` (Ollama) |
| Thiết bị | bge-m3 + reranker + NLI trên **GPU** (RTX 4050 Laptop, 6 GiB); Ollama bị đẩy xuống CPU vì hết VRAM |

### Corpus

3 tài liệu đủ điều kiện (9 tài liệu còn lại `eligible_for_study=false`: smoke-test payload, demo sản phẩm, tài liệu thiết kế nội bộ).

| | truy vấn | đoạn bằng chứng | qrel |
|---|---|---|---|
| toàn bộ | 55 | 89 | 273 (91 × 3 biểu diễn) |
| **bộ test dùng để đo** | **30** | | |

`leakage_check: pass`.

### Ba biểu diễn

| index | chunk | tb ký tự | trung vị | late chunking | `index_hash` |
|---|---|---|---|---|---|
| `R0_recursive` | 171 | 300 | 310 | 0.0 | `f2c647b708c86b99` |
| `R1_structure` | 142 | 388 | 450 | 0.0 | `1879d38c6a324938` |
| `R2_late` | 142 | 388 | 450 | **1.0** | `81a502ec18a9c9bc` |

`R1` và `R2` có **cùng 142 chunk**, chỉ khác cách nhúng. Đó là điều kiện giúp cô lập tác động của late chunking ở mục 4.

---

## 2. Cách tính — ĐỌC TRƯỚC KHI DÙNG SỐ

Bộ test có 30 truy vấn, nhưng **5 truy vấn không có chunk vàng nào theo thiết kế**:

| truy vấn | `gold_status` | loại |
|---|---|---|
| V11 | `insufficient_evidence` | main-points |
| V12 | `insufficient_evidence` | compare |
| V13 | `insufficient_evidence` | how/why |
| V14 | `ambiguous` | ambiguous |
| V15 | `insufficient_evidence` | insufficient evidence |

Với chúng, `recall@6 = 0` là **hành vi ĐÚNG** — hệ thống lẽ ra không được tìm thấy gì. Chúng dùng để đo **khả năng từ chối**, không phải khả năng truy hồi.

Trước commit `bcd3917`, `evaluation/metrics.py` **không loại** nhóm này. Gộp cả 30 thì E0
tụt từ `0.8371` xuống `0.6976` — **mất 14 điểm oan**. Nay harness tự loại: mỗi hàng mang
theo `n_relevant`, và `aggregate_metrics.json` ghi kèm `n_queries` / `n_scored` /
`n_no_gold` / `no_gold_query_ids` để việc loại trừ đọc được ngay từ file kết quả.

> **Mọi bảng dưới đây tính trên n = 25** (chỉ truy vấn có chunk vàng). Nhóm 5 câu còn lại
> được đo riêng bằng **tỷ lệ từ chối** ở mục 3c.

Khoảng tin cậy: bootstrap 2000 lần lặp, `seed=20260811`.

---

## 3. Kết quả — thang ablation trên nền nhúng ĐÚNG (`R1_structure`)

**Đây là bảng dùng cho chương 4.**

| nấc | thành phần thêm vào | recall@6 [CI95] | MRR [CI95] | nDCG@6 [CI95] |
|---|---|---|---|---|
| **E0** | BM25 thuần | 0.8371 [0.700–0.957] | 0.7467 [0.607–0.873] | 0.7331 [0.607–0.847] |
| **E1** | vector thuần (FAISS) | 0.6971 [0.540–0.840] | 0.6727 [0.487–0.828] | 0.6379 [0.476–0.788] |
| **E2** | lai BM25+vector (RRF) | 0.7829 [0.643–0.906] | 0.8213 [0.667–0.960] | 0.7654 [0.625–0.889] |
| **E3** | + rerank cross-encoder | **0.9029 [0.800–0.983]** | **0.9200 [0.820–1.000]** | **0.8917 [0.791–0.974]** |
| E4 | + NLI | 0.9029 [0.800–0.983] | 0.9200 [0.820–1.000] | 0.8930 [0.785–0.970] |
| E5 | + CRAG | 0.9029 [0.800–0.983] | 0.9200 [0.820–1.000] | 0.8930 [0.785–0.970] |
| E6 | đầy đủ, tự động | 0.9029 [0.800–0.983] | 0.9200 [0.820–1.000] | 0.8930 [0.785–0.970] |
| E7 | đầy đủ + người duyệt | 0.9029 [0.800–0.983] | 0.9200 [0.820–1.000] | 0.8930 [0.785–0.970] |

### Đọc bảng

- **Vector thuần yếu hơn BM25 thuần** (0.697 vs 0.837). Corpus nhỏ, bộ truy vấn nặng loại `exact-term factual` (7/30) — sân của khớp từ vựng.
- **Lai vượt vector nhưng chưa vượt BM25 ở recall** (0.783 vs 0.837), **nhưng MRR vọt lên 0.821** so với 0.747. Nghĩa là RRF không tìm được nhiều tài liệu đúng hơn, mà **xếp chúng lên cao hơn**.
- **Rerank là nấc đóng góp mạnh nhất**: +12 điểm recall so với lai, và **vượt BM25 thuần 6.6 điểm**. MRR 0.920 nghĩa là bằng chứng đúng gần như luôn nằm ở hạng 1–2.
- **Thang truy hồi bão hoà ở E3.** E4, E5, E6, E7 ra **đúng cùng một con số** với E3 ở
  recall và MRR, và chỉ lệch nDCG ở chữ số thứ ba (0.8917 → 0.8930). Điều này không phải
  lỗi cấu hình — ba nấc trên cùng **không đụng vào thứ hạng**: NLI kiểm mâu thuẫn sau khi
  đã chọn xong bằng chứng, CRAG có viết lại truy vấn nhưng bộ 6 đoạn cuối không đổi, và
  memory tree không có dữ liệu cho corpus này (mục 3b). Muốn thấy giá trị của E4–E7 thì
  phải đo **chất lượng câu trả lời**, không phải chỉ số truy hồi (mục 3c).
- Khoảng tin cậy còn rộng (n=25). Kết luận về **thứ tự** các nấc thì vững; kết luận về **độ lớn chênh lệch** thì cần corpus lớn hơn.
- **Tái lập được qua hai phần cứng.** E0–E3 chạy lần đầu trên CPU, chạy lại trên GPU ra
  **giống từng chữ số** ở cả ba chỉ số. Đường truy hồi không phụ thuộc thiết bị; khác biệt
  duy nhất là thời gian.

---

## 3b. Ba nấc trên cùng làm gì trong 30 truy vấn

Chỉ số truy hồi không đổi, nhưng ba thành phần đó **có chạy**. Đây là những gì trace ghi lại:

| thành phần | hoạt động | kết quả |
|---|---|---|
| NLI (E4) | chạy đủ 30 truy vấn | 0 mâu thuẫn được báo |
| CRAG (E5) | 26/30 dừng ở vòng 1 (`correct`); **4/30 đi 3 vòng** (`ambiguous-generate`, tức 2 lần viết lại) | bộ bằng chứng cuối **không đổi** ở cả 4 câu (V03, V07, V08, V15) |
| memory tree (E6) | thử 30/30 | **hit 0/30**, rơi hết về `full_retrieval` |

Về memory tree, đây là **giới hạn của phép đo chứ không phải kết luận về thành phần**:
kho cây nhớ (`BE/memory/memory_trees.json`) chứa 11 cây dựng từ tài liệu của ứng dụng,
**không có cây nào cho 3 tài liệu của corpus nghiên cứu**. Truy vấn trong bộ test cũng
không có `selected_sources`, nên bước định tuyến tìm trên một kho không liên quan và
đúng ra phải trượt. **E6 hiện tại bằng đúng E5.** Muốn đo E6 thật thì phải dựng cây nhớ
cho 3 tài liệu đó trước — và cần tách kho, vì cây nhớ hiện dùng chung một chỗ với ứng dụng.

E7 thêm cờ `awaiting_real_human_review` vào trace chứ không đổi đường chạy tự động, nên
số truy hồi của nó bằng E6 theo thiết kế. Phần người duyệt chưa làm.

---

## 3c. Khả năng từ chối trên 5 truy vấn không trả lời được

Đây là thước đúng cho nhóm V11–V15 (mục 2). Chấm bằng tay, đọc nguyên văn 40 câu trả lời;
tiêu chí: câu trả lời có **nói rõ tài liệu không chứa đáp án** hay không.

| | V11 | V12 | V13 | V14 | V15 | từ chối đúng |
|---|---|---|---|---|---|---|
| E0 bm25 | ✗ | ✗ | ✗ | rào rồi vẫn chọn | ✓ | 1/5 |
| E1 faiss | ✗ | ✗ | ✗ | ✓ | ✓ | 2/5 |
| E2 hybrid | ✗ | ✗ | ✗ | ✓ | ✓ | 2/5 |
| E3 rerank | ✗ | ✗ | ✗ | **✗ bịa** | ✓ | 1/5 |
| E4–E7 | ✗ | ✗ | ✗ | ✓ | ✓ | 2/5 |

Ba điều đọc được:

1. **V11, V12, V13 không nấc nào từ chối.** Cả 8 cấu hình đều viết ra một câu trả lời trôi
   chảy cho câu hỏi mà tài liệu không trả lời được. Đây là tỷ lệ ảo giác 3/5 trên nhóm bẫy,
   và **rerank không cứu được** — nó chỉ làm bằng chứng sai được xếp cao hơn.
2. **E3 là nấc DUY NHẤT bịa ở V14.** Hỏi "nên dùng store nào", E3 trả lời "nên dùng
   **Arize Phoenix (TruLens)**" — một công cụ quan sát, không phải store, và không phải
   nội dung được hỏi. E0/E1/E2 và E4–E7 đều không mắc.
3. **NLI vá đúng chỗ đó.** E4 khác E3 duy nhất ở tầng NLI, và V14 là câu duy nhất đổi hành
   vi. Đây là **bằng chứng đo được đầu tiên** cho thấy tầng NLI có tác dụng — nhưng n = 1,
   nên là quan sát, chưa phải kết quả.

> Chấm tay, một người chấm, không có người chấm chéo. Muốn đưa vào chương 4 thì cần
> ít nhất một người thứ hai chấm độc lập, hoặc một bộ quy tắc chấm công bố kèm.

---

## 4. Phát hiện: late chunking làm sụp không gian vector

Đây là kết quả đáng viết thành một mục riêng trong chương 4.

### Số đo

Độ tương đồng cosine **trong cùng một tài liệu**, cùng bộ 142 chunk, chỉ khác cách nhúng:

| index | sim TB trong tài liệu | sim chéo tài liệu |
|---|---|---|
| `R0_recursive` (nhúng thường) | 0.53 – 0.68 | 0.447 |
| `R1_structure` (nhúng thường) | 0.53 – 0.64 | 0.470 |
| **`R2_late` (late chunking)** | **0.967 – 0.995** | **0.805** |

Hai chunk **cạnh nhau** trong `R2` giống nhau tới **0.9999**.

### Nguyên nhân

`~/.cache/huggingface/.../bge-m3/1_Pooling/config.json`:

```json
"pooling_mode_cls_token":   true,
"pooling_mode_mean_tokens": false
```

`bge-m3` sinh vector câu từ token **CLS**. `late_chunk.embed_document` thì **mean-pool `last_hidden_state`**. Vector tài liệu và vector truy vấn nằm ở **hai không gian khác nhau**, nên độ tương đồng không mang nghĩa.

**Không phải do cắt cửa sổ:** `accumulate_token_embeddings` có cửa sổ trượt kèm overlap, và tài liệu nhỏ nhất (≈1500 token, dưới xa 8192) vẫn sụp 0.995.

### Hệ quả lên số liệu

Cùng thang, chạy trên `R2_late`:

| nấc | R2_late (nhúng hỏng) | R1_structure (nhúng đúng) | chênh |
|---|---|---|---|
| E0 bm25 | 0.8371 | 0.8371 | 0 |
| E1 faiss | 0.2286 | 0.6971 | **+0.469** |
| E2 hybrid | 0.4686 | 0.7829 | +0.314 |
| E3 rerank | 0.6229 | 0.9029 | +0.280 |

E0 **giống hệt nhau tới từng chữ số** — đúng như phải thế, vì BM25 chỉ đọc text chunk mà hai index có cùng 142 chunk. Đây là phép kiểm chéo cho thấy khác biệt đến từ nhánh vector chứ không từ nhiễu.

> **Kết luận quan trọng:** trên nền hỏng, thang đi **xuống rồi bò lên** và BM25 thuần "thắng mọi thứ". Nếu tin bảng đó, chương 4 sẽ kết luận **ngược hoàn toàn** với sự thật. Late chunking không sai về nguyên lý — nó **ghép sai với model có pooling CLS**.

---

## 5. Chi phí thời gian mỗi thành phần

Đo trên truy vấn thật của ứng dụng (không phải bộ ablation), trung vị:

| node | ms | % |
|---|---|---|
| `VerifyContext` (NLI mDeBERTa) | 197 691 | **88%** |
| `RerankDocuments` (bge-reranker) | 18 327 | 8% |
| `GenerateAnswer` (LLM sinh chữ) | 7 427 | 3% |
| `RetrieveFAISS` | 727 | 0.3% |
| còn lại | < 30 | ~0% |

Trong bộ ablation, NLI đo được **298 giây mỗi truy vấn** (`max_pairs=3` → 6 cặp có hướng).

Nút thắt của NLI là **công việc đơn luồng**, không phải tính toán: tăng từ 1 lên 16 luồng chỉ nhanh hơn 10%, trong khi matmul thuần trên cùng máy đạt 400 GFLOPS. Thời gian tuyến tính theo độ dài chuỗi (128 token 28.2s · 256 token 47.7s · 512 token 92.8s) nên cũng không phải ma trận attention O(n²).

`VerifyContext` chạy **5 lần trong truy vấn thật, 0 lần phát hiện mâu thuẫn**, tiêu tổng 1008 giây.

### Sau khi chuyển sang GPU

Nút thắt biến mất. Đo lại trên RTX 4050 Laptop (6 GiB), cùng model, cùng fp32:

| | CPU | GPU | nhanh hơn |
|---|---|---|---|
| NLI mDeBERTa | ~298 giây/truy vấn | **0.50 s / 3 cặp** | ~600× |
| rerank 20 cặp | 9.52 s | **1.49 s** | 6.4× |
| sinh `qwen2.5:7b` | 9.1 tok/s | 27.3 tok/s | 3× |

Cả ba model torch nạp cùng lúc ăn **5.21 / 6.0 GiB**, nên Ollama không còn chỗ và tự đẩy
layer xuống CPU. Đổi 22 giây mỗi truy vấn ở khâu sinh để lấy lại ~298 giây ở khâu NLI:
**thang E4–E7 từ ~10 giờ xuống 34 phút.**

Thời gian mỗi truy vấn trong bộ ablation (trung vị, cùng phần cứng GPU):

| nấc | s/truy vấn |
|---|---|
| E0 bm25 | 6.5 |
| E1 faiss | 6.3 |
| E2 hybrid | 8.0 |
| E3 rerank | 19.9 |
| E4 nli | 13.0 |
| E5 crag | 22.2 |
| E6 full | 21.8 |
| E7 full+hitl | 22.3 |

E4 thấp hơn E3 là **nhiễu độ dài câu trả lời**, không phải NLI làm nhanh lên: khâu sinh
chiếm phần lớn thời gian và độ dài câu trả lời dao động giữa các lần chạy. Đừng đọc cột
này như chi phí biên của từng thành phần — chỉ đọc mức: rerank là nấc đắt (+12 giây),
CRAG là nấc đắt thứ hai khi nó viết lại truy vấn (4/30 câu, mỗi câu 3 vòng).

---

## 6. Cách tái lập

```bash
cd E:/memvid_NCKH/MemVid_BaoCaoTotNghiep

# Dựng index (chạy TỪ GỐC REPO, không phải từ BE/)
PYTHONPATH=BE BE/.venv/Scripts/python.exe -m evaluation.index_builder \
  --config reports/evaluation/configs/R1_structure.yaml \
  --dataset reports/evaluation/datasets/corpus_v1

# Sinh qrel
PYTHONPATH=BE BE/.venv/Scripts/python.exe -m evaluation.evidence \
  --dataset reports/evaluation/datasets/corpus_v1 \
  --index reports/evaluation/indexes/R1_structure --representation R1

# Chạy một nấc trên nền R1
PYTHONPATH=BE BE/.venv/Scripts/python.exe -m evaluation.runner run \
  --config reports/evaluation/configs/E3_rerank.yaml \
  --dataset reports/evaluation/datasets/corpus_v1 \
  --reports-root reports/evaluation \
  --index-dir reports/evaluation/indexes/R1_structure \
  --representation-id R1 --experiment-id E3_rerank_R1

# Gộp kết quả
PYTHONPATH=BE BE/.venv/Scripts/python.exe -m evaluation.aggregate reports/evaluation
```

Sản phẩm: `reports/evaluation/results/{retrieval_results,qa_results,ablation_results}.csv` và `aggregate_metrics.json`.

---

## 7. Việc còn lại

- [x] ~~E4–E7 trên `R1_structure`~~ — xong 2026-08-26, 34 phút trên GPU
- [x] ~~Chốt cách báo cáo nhóm 5 truy vấn không có chunk vàng~~ — loại khỏi mẫu số recall
      (harness tự làm từ commit `bcd3917`), đo riêng bằng tỷ lệ từ chối ở mục 3c
- [ ] **Đo chất lượng câu trả lời.** Đây là việc lớn còn thiếu: `qa.jsonl` có
      `human_labels: null` và `judge_raw: null` ở mọi run. Không có nó thì E4–E7 không có
      gì để hơn E3, vì chỉ số truy hồi đã bão hoà. Bộ dữ liệu **có sẵn `gold_answer`** cho
      cả 25 câu trả lời được — đủ nguyên liệu cho một bộ chấm
- [ ] **Dựng cây nhớ cho corpus nghiên cứu** rồi chạy lại E6 (mục 3b) — hiện E6 = E5
- [ ] Người duyệt thật cho E7 (`reports/evaluation/annotations/HITL_PROTOCOL.md`)
- [ ] Chấm chéo phần từ chối ở mục 3c — hiện chỉ một người chấm
- [ ] Trục R0 vs R1 vs R2: mới có R1 và R2; chưa chạy thang trên R0
- [ ] Cụm truy vấn BM25 trượt sạch (`V03`, `S11` — loại `compare`, `exact-term`) chưa phân tích riêng
- [ ] `reports/` nằm ngoài git: dữ liệu thô chỉ có trên máy. Cân nhắc sao lưu `runs/` ra nơi khác

## 8. Ghi chú kỹ thuật

Chín lỗi phải sửa trước khi thang chạy được, và cách phòng từng cái, nằm ở
`.playbook/known-issues.md` và `.playbook/lessons-learned.md`. Đáng chú ý nhất:

- `aggregate` từng **chết vì một run dở dang** và làm bảng kết quả **thiếu số im lặng**
- cờ thành phần từng **rò từ `.env`** vào thí nghiệm, có thể biến E4 thành E3 mà không báo
- `content_hash` từng nghẹn thư mục `memory/`, làm **cả 8 thí nghiệm** chết trước khi chạy truy vấn nào
- qrel `R1`/`R2` từng chỉ định vị được **1/142 chunk** vì tìm chuỗi con trên text Markdown
