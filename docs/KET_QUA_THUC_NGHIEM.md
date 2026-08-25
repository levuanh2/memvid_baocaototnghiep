# Kết quả thực nghiệm — thang ablation E0–E7

> Tài liệu này giữ **số liệu** để dùng cho chương 4. Dữ liệu thô nằm ở
> `reports/evaluation/` — thư mục đó **không theo git**, nên bảng ở đây là bản lưu
> duy nhất trong repo.
>
> Cập nhật lần cuối: 2026-08-25. Trạng thái: **E0–E3 xong trên cả hai nền; E4–E7 đang chạy.**

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
| Python | 3.11.9 · torch 2.5.1+cpu |
| Embedding | `BAAI/bge-m3` (1024 chiều) |
| Reranker | `BAAI/bge-reranker-v2-m3` |
| NLI | `MoritzLaurer/mDeBERTa-v3-base-mnli-xnli` |
| Sinh câu trả lời | `qwen2.5:7b-instruct` (Ollama, CPU) |

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

`evaluation/metrics.py` **không loại** nhóm này. Gộp cả 30 thì E0 tụt từ `0.8371` xuống `0.6976` — **mất 14 điểm oan**.

> **Mọi bảng dưới đây tính trên n = 25** (chỉ truy vấn có chunk vàng). Nếu chương 4 muốn báo cả 30 thì phải nói rõ, và nên tách một chỉ số riêng cho nhóm không-có-bằng-chứng.

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
| E4 | + NLI | *đang chạy* | | |
| E5 | + CRAG | *đang chạy* | | |
| E6 | đầy đủ, tự động | *chưa chạy* | | |
| E7 | đầy đủ + người duyệt | *chưa chạy* | | |

### Đọc bảng

- **Vector thuần yếu hơn BM25 thuần** (0.697 vs 0.837). Corpus nhỏ, bộ truy vấn nặng loại `exact-term factual` (7/30) — sân của khớp từ vựng.
- **Lai vượt vector nhưng chưa vượt BM25 ở recall** (0.783 vs 0.837), **nhưng MRR vọt lên 0.821** so với 0.747. Nghĩa là RRF không tìm được nhiều tài liệu đúng hơn, mà **xếp chúng lên cao hơn**.
- **Rerank là nấc đóng góp mạnh nhất**: +12 điểm recall so với lai, và **vượt BM25 thuần 6.6 điểm**. MRR 0.920 nghĩa là bằng chứng đúng gần như luôn nằm ở hạng 1–2.
- Khoảng tin cậy còn rộng (n=25). Kết luận về **thứ tự** các nấc thì vững; kết luận về **độ lớn chênh lệch** thì cần corpus lớn hơn.

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

`VerifyContext` chạy **5 lần trong truy vấn thật, 0 lần phát hiện mâu thuẫn**, tiêu tổng 1008 giây. E4 sẽ cho biết trên bộ nghiên cứu nó có đóng góp gì đo được không.

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

- [ ] E4–E7 trên `R1_structure` — đang chạy, ~12–15 giờ vì NLI
- [ ] Chốt cách báo cáo nhóm 5 truy vấn không có chunk vàng (mục 2)
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
