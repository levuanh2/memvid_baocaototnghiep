# AUDIT CHƯƠNG 4 TRƯỚC THỰC NGHIỆM

## 1. Phạm vi, nguyên tắc và kết luận chính

Audit này đối chiếu `chapter-4-thuc-nghiem-danh-gia-va-thao-luan.md` với Chương 1–3, mã nguồn production, evaluation harness, dataset candidate, cấu hình benchmark và các artifact vận hành hiện có tại ngày 14/08/2026. Audit không bổ sung kết quả thực nghiệm và không dùng candidate review, software test hoặc historical load test để trả lời RQ1–RQ5.

Các nhãn được dùng như sau:

- **VERIFIED:** claim được source/code/artifact hiện có hỗ trợ đúng phạm vi.
- **NEED DATA:** code đo đã có nhưng input, run output hoặc human label bắt buộc chưa tồn tại.
- **NEED CODE:** workflow hiện tại chưa thể tạo đúng evidence cần thiết hoặc có mismatch phải sửa.
- **NEED ENVIRONMENT:** exact frozen dependency/model không thể load trong môi trường hiện tại; không được tự thay checkpoint.
- **NEED EXPERIMENT:** protocol đã xác định nhưng chưa có run hợp lệ.
- **NEED CLARIFICATION:** cần chốt định nghĩa/thủ tục trước khi code hoặc chạy.

Kết luận chính:

1. Chương 4 giữ đúng RQ1–RQ5, methodology và các ranh giới thuật ngữ của Chương 1–3. Không có benchmark result hoặc kết luận RQ bị bịa.
2. Candidate review R1 đã được import: final query/evidence/citation/contradiction/artifact JSONL không còn rỗng và corpus membership đã freeze. Dataset chưa freeze cuối vì chưa có R0–R2 qrels; chưa có index hợp lệ, `runs/` hoặc `results/`.
3. Coordinate bridge P0.0 đã được implement và validate 89/89 imported spans. P0.0 hiện bị chặn tại exact BAAI/bge-m3 environment preflight: cache chính chỉ có PyTorch binary, trong khi Transformers hiện tại yêu cầu PyTorch ≥2.6 để load định dạng này; không có model thay thế nào được dùng.
4. E2–E3 hiện không cô lập riêng reranker vì `retrieval.top_k` đồng thời đổi từ 6 lên 20. YAML fusion parameters cũng chưa được adapter truyền tường minh.
5. Runner hiện tính được retrieval metrics cuối run. Paired ablation, QA/citation, NLI confusion, summary, mind map, quality–cost và runtime HITL chưa có pipeline tổng hợp hoàn chỉnh.
6. Các số hiệu năng ngày 07/07/2026 là historical operational measurements có source, nhưng không phải frozen research benchmark.

Một lệnh read-only đã được chạy trong audit:

```powershell
$env:PYTHONPATH = "BE"
python -m evaluation.dataset validate reports/evaluation/datasets/corpus_v1
```

Lần validate ban đầu xác nhận candidate package hợp lệ nhưng final files còn rỗng. Sau P0.0 import, cùng validator xác nhận 55 final queries, 89 canonical spans, 77 citation annotations, 3 contradictions và 3 artifact annotations; representation qrels vẫn 0. `validate` không tương đương final `freeze` và không cấp quyền chạy benchmark.

## 2. Đối chiếu Chương 1–3

### 2.1. Research questions

| RQ | Phát biểu nhất quán giữa Chương 1 và Chương 4 | Kết quả audit |
|---|---|---|
| RQ1 | Ảnh hưởng của structure-aware representation và conditional late chunking so với recursive/independent embedding | Nhất quán; Chương 4 dùng R0–R2 và không kết luận hướng tác động. |
| RQ2 | Ảnh hưởng của BM25, FAISS, fusion và cross-encoder reranking | Nhất quán về mục tiêu; thiết kế E2–E3 hiện còn confound cần sửa trước khi chạy. |
| RQ3 | Ảnh hưởng của NLI, CRAG heuristic adaptation và query rewriting trên evidence mơ hồ, thiếu hoặc mâu thuẫn | Nhất quán; không mô tả grader là full CRAG reproduction. |
| RQ4 | Khả năng truy vết của QA, section-first summary và skeleton-first mind map | Nhất quán; provenance kỹ thuật được tách khỏi semantic/citation correctness. |
| RQ5 | Trade-off giữa quality, unsupported claims, latency/model cost và human effort của full pipeline/HITL | Nhất quán về câu hỏi; evaluation harness hiện chưa đủ để đo runtime HITL và đầy đủ cost. |

### 2.2. Methodology, architecture và terminology

- Chương 4 giữ đúng ba answer path của Chương 3: semantic cache, Memory Tree và full retrieval. Không mô tả mọi query đi tuần tự qua cả ba.
- Memory Tree được gọi đúng tên và không bị đồng nhất với RAPTOR.
- `CRAG heuristic adaptation`/bộ chấm evidence lấy cảm hứng từ CRAG được dùng đúng phạm vi; không có claim full CRAG reproduction.
- Section-first summary và skeleton-first mind map khớp runtime graph. Two-pass summary và CMGN/three-critic không bị mô tả là baseline production.
- HITL được tách khỏi candidate-data review. Tuy nhiên, Chương 4 trước audit chưa nói rõ E7 runner không chạy qua backend ReviewGate; lỗi factual này đã được sửa.
- Source/chunk pointer được mô tả là technical provenance, không phải citation correctness.
- Software tests được tách khỏi method evaluation. Claim 34/34 chỉ được ghi như assertion lịch sử của Chương 3; repository không có raw pytest log/JUnit artifact độc lập để tái kiểm chứng lần chạy đó.

## 3. Audit theo từng section 4.1–4.10

### 3.1. Section 4.1 — Mục tiêu thực nghiệm và giả thuyết nghiên cứu

| Nội dung audit | Kết quả |
|---|---|
| Claim hiện tại | H1–H5 là giả thuyết cần kiểm chứng; không RQ nào đã được xác nhận; software verification khác method evaluation. |
| Evidence hiện có | Chương 1 mục 1.4 và Bảng 1.1; Chương 3; R0–R2/E0–E7 configs; graph/test source files. |
| Evidence còn thiếu | Frozen benchmark và run outputs cho mọi RQ; raw test-result artifact cho claim 34/34 nếu muốn dùng ngoài phạm vi “Chương 3 ghi nhận”. |
| Có thể đo bằng | `evaluation.runner`, `evaluation.metrics`, quality annotations và experiments liệt kê tại Mục 7 của audit. |
| Trạng thái | **VERIFIED** cho mục tiêu/ranh giới; **NEED CLARIFICATION** cho khả năng truy nguyên độc lập của số 34/34. |

Ý nghĩa: section này trung thực và không biến giả thuyết thành kết quả. Không cần benchmark để giữ phần phát biểu mục tiêu, nhưng số test lịch sử không nên được nâng thành evidence nghiên cứu.

### 3.2. Section 4.2 — Thiết kế thực nghiệm

| Nội dung audit | Kết quả |
|---|---|
| Claim hiện tại | Candidate corpus/query package, annotation separation, R0–R2/E0–E7, FULL METHOD v1, metrics và freeze gates đã được định nghĩa. |
| Evidence hiện có | `dataset_manifest.json`, `study_manifest.json`, review export R1, `baseline_manifest.json`, `configs/*.yaml`, `dataset.py`, `review.py`, `index_builder.py`, `metrics.py`, `runner.py`. |
| Evidence còn thiếu | R0–R2/qrels và frozen dataset hash cuối; clean benchmark snapshot; hardware; runnable system-output annotation workflow. |
| Blocker code/environment | Import/corpus approval/coordinate bridge đã tự động hóa và Phase 4C đã có lệnh chính xác. Exact BAAI/bge-m3 chưa load được trong môi trường khóa; YAML fusion weights/RRF cho P0.2 vẫn chưa được adapter wire tường minh. |
| Có thể đo bằng | `dataset import-review/validate/freeze-corpus/freeze`; index manifests; run manifests. |
| Trạng thái | **NEED DATA + NEED CODE + NEED CLARIFICATION**. |

Các con số 12 inventory, 3 eligible, 60 candidate queries, 92 spans, 83 claims, 3 contradiction pairs và 3 artifact records là VERIFIED ở trạng thái candidate-only; chúng không phải sample size cuối cho benchmark.

### 3.3. Section 4.3 — Đánh giá biểu diễn và phân đoạn tài liệu

| Nội dung audit | Kết quả |
|---|---|
| Claim hiện tại | R0–R1 tách chunking; R1–R2 tách conditional late chunking; cần phân tầng fallback và query/document type. |
| Evidence hiện có | `R0_recursive.yaml`, `R1_structure.yaml`, `R2_late.yaml`; `index_builder.py` ghi per-document eligibility/application/fallback và index manifest. |
| Evidence còn thiếu | R0–R2 indexes, qrels, paired E3 runs và stratum analysis. Imported canonical spans đã có và đã validate. |
| Blocker environment | Bridge đã chuyển source-unit coordinates sang canonical half-open offsets, giữ original locator/text/hash và reject mismatch. Index build bị chặn bởi compatibility của exact embedding checkpoint; chưa được phép thay model. |
| Có thể đo bằng | Sau khi chốt môi trường checkpoint: `index_builder`, `evaluation.evidence`, ba RQ1 runner commands, `metrics.paired_bootstrap` hoặc analyzer mới. |
| Trạng thái | **VERIFIED** cho coordinate bridge/import/corpus freeze; **NEED CLARIFICATION + NEED ENVIRONMENT + NEED DATA + NEED EXPERIMENT** cho index/qrels/RQ1. |

Coordinate TODO đã hoàn tất. Vẫn chưa thể “chỉ chạy rồi điền” vì môi trường exact embedding và paired comparison của P0.1 chưa hoàn tất.

### 3.4. Section 4.4 — Đánh giá truy hồi bằng chứng nhiều giai đoạn

| Nội dung audit | Kết quả |
|---|---|
| Claim hiện tại | E0–E5 đánh giá sparse/dense/hybrid/rerank/NLI/CRAG heuristic adaptation; E5–E6 đánh giá Memory Tree routing; fallback phải được phân tích riêng. |
| Evidence hiện có | Production retriever/reranker/NLI/grading/rewrite/Memory Tree; `adapters.py`; E0–E6 configs; per-query trace schema. |
| Evidence còn thiếu | Frozen E0–E6 runs, contradiction labels, calibration decision, failure/fallback annotations, paired comparison. |
| Blocker/confound | E2 dùng hybrid `top_k=6`, E3 dùng hybrid `top_k=20` rồi rerank xuống 6; direct E2–E3 delta không cô lập reranker. Adapter không truyền `bm25_weight`, `faiss_weight`, `rrf_k`; effective defaults hiện trùng manifest nhưng không được enforce bởi config. Aggregate không tạo paired/stratified/NLI-confusion reports. |
| Có thể đo bằng | E0–E6 runner traces sau khi sửa; analyzer cho candidate recall@20, post-rerank metrics, NLI confusion, CRAG rounds/query drift, routing/fallback. |
| Trạng thái | **NEED CODE + NEED DATA + NEED EXPERIMENT**. |

TODO E0–E2 là tương đối rõ sau freeze. TODO E2–E3, NLI, CRAG và fallback chưa execution-ready vì còn thiếu đối chứng/analyzer/calibration tooling.

### 3.5. Section 4.5 — Đánh giá grounded QA và provenance

| Nội dung audit | Kết quả |
|---|---|
| Claim hiện tại | Correctness, faithfulness, context relevance và claim-level citation support phải được đo riêng; pointer existence không chứng minh support. |
| Evidence hiện có | Runner ghi `qa.jsonl` và per-query evidence IDs; runtime source/chunk pointers; `quality_metrics.py`; QUALITY protocol. |
| Evidence còn thiếu | System-output claim segmentation, human support labels, QA rubric labels, controlled outputs theo cache/Memory Tree/full path. |
| Blocker code | Runner luôn ghi `human_labels: null`; `aggregate.py` chỉ gom rows, không gọi `quality_metrics`; chưa có exporter/importer cho annotation của system answers; citation parser chỉ nhận một marker format và không xác nhận semantic support. |
| Có thể đo bằng | QA/citation annotation package mới, `quality_metrics.citation_metrics`, `rubric_summary`, paired path analyzer. |
| Trạng thái | **NEED CODE + NEED DATA + NEED EXPERIMENT**. |

TODO hiện mô tả đúng dữ liệu cần có nhưng chưa nêu công cụ tạo/nhập label. Không thể chỉ chạy E0–E7 rồi điền Bảng 4.5.

### 3.6. Section 4.6 — Đánh giá tóm tắt và mind map

| Nội dung audit | Kết quả |
|---|---|
| Claim hiện tại | Production đã có section-first summary và skeleton-first mind map; cần chấm coverage/faithfulness/structure/relation/provenance và degraded paths. |
| Evidence hiện có | Summary/mind-map graphs, pipelines, stores, route/tests; candidate artifact rubric records; quality dimension constants. |
| Evidence còn thiếu | System artifacts trên frozen corpus, fixed generation configs, reviewer labels, repeated-run/failure outputs nếu đo stability/degradation. |
| Blocker code | `BE/evaluation` không có summary/mind-map experiment runner, artifact output schema, annotation exporter/importer hoặc aggregate command. `quality_metrics.py` chỉ có hàm tổng hợp khi records đã tồn tại. |
| Có thể đo bằng | Cần xây artifact runner dùng production pipelines, manifest, raw artifact store, rubric annotation package và aggregator. |
| Trạng thái | **NEED CODE + NEED DATA + NEED EXPERIMENT**. |

Ba candidate artifact records là gold/rubric aids cho data curation, không phải outputs và không được dùng làm runtime result.

### 3.7. Section 4.7 — Đánh giá Human-in-the-Loop

| Nội dung audit | Kết quả |
|---|---|
| Claim hiện tại | Runtime app có ReviewGate approve/edit/reject; RQ5 cần paired draft/final quality, actions, review time, edit magnitude và agreement. |
| Evidence hiện có | Production query graph và resume endpoint; E7 config; `HITL_PROTOCOL.md`; `evaluation.hitl` CLI. |
| Evidence còn thiếu | Runtime ReviewGate session data, evidence shown to reviewer, final answer record, reviewer overlap, blind pre/post labels. |
| Blocker code/protocol | E7 adapter chỉ gắn `awaiting_real_human_review`; CLI review không gọi backend resume, không hiển thị evidence, ghi output vào run directory thay vì path protocol, nhận quality dưới dạng chuỗi tự do và không tạo complete final-answer record cho mọi action. |
| Có thể đo bằng | Cần chốt “runtime HITL” hay “offline post-edit”; với RQ hiện tại phải xây E7 driver qua interrupt/resume và annotation workflow tách reviewer/editor khỏi quality judge. |
| Trạng thái | **NEED CLARIFICATION + NEED CODE + NEED DATA + NEED EXPERIMENT**. |

Review R1 (46 approve, 9 edit, 5 reject) vẫn chỉ là candidate-data review. Không có tỷ lệ runtime HITL nào trong repository.

### 3.8. Section 4.8 — Đánh giá hiệu năng và chi phí

| Nội dung audit | Kết quả |
|---|---|
| Claim hiện tại | Research benchmark cần stage latency, calls/tokens/resources, path/fallback rates và quality–cost trên cùng query; operational history chỉ là tham khảo. |
| Evidence hiện có | Timing fields trong trace; node logs/gateway logs; `baseline_concurrency.py`, `cache_latency.py`; Phase 2–4 reports và baseline JSON/MD. |
| Evidence còn thiếu | Frozen-run percentiles, per-round stage timings, complete token/call counts, CPU/RAM/GPU measurements, controlled cache/path experiment, paired quality–cost. |
| Blocker code | Repeated corrective rounds có thể ghi đè các key timing chung; token fields hiện `None`; Memory Tree/internal model calls không được ghi đầy đủ; fallback flags chưa được aggregate; `aggregate.py` không tạo percentile/path/cost report. |
| Có thể đo bằng | Mở rộng trace instrumentation và aggregator; dùng performance scripts chỉ cho operational benchmark riêng, không trộn với research runs. |
| Trạng thái | **VERIFIED** cho historical operational table; **NEED CODE + NEED DATA + NEED EXPERIMENT** cho RQ5. |

Các số lịch sử ở Bảng tham khảo 4.8-O khớp `phase2-gateway-semaphore.md`, `phase3-single-flight.md`, `phase4-overload-protection.md` và baseline `20260707-143610`. Chúng không trả lời retrieval quality, QA, citation, artifact hoặc HITL.

### 3.9. Section 4.9 — Thảo luận và trả lời RQ1–RQ5

| Nội dung audit | Kết quả |
|---|---|
| Claim hiện tại | Mọi RQ đều pending; chỉ thảo luận readiness, provenance distinction, limitations và threats to validity. |
| Evidence hiện có | Trạng thái dataset/run directories, code/config inventory, Chapter 1–3, historical reports. |
| Evidence còn thiếu | Toàn bộ benchmark evidence liệt kê trong ma trận RQ và experiment list. |
| Có thể đo bằng | P0/P1 experiments tại Mục 7–9. |
| Trạng thái | **VERIFIED** cho kết luận “chưa đủ evidence”; **NEED DATA** để trả lời RQ. |

Claim “workflow executable” trước audit là quá mạnh vì các blocker code nêu trên. Chương 4 đã được sửa thành “một phần executable contracts”.

### 3.10. Section 4.10 — Tổng kết chương

| Nội dung audit | Kết quả |
|---|---|
| Claim hiện tại | Repository có khung protocol/tooling nhưng chưa có frozen research results; operational evidence không thay benchmark. |
| Evidence hiện có | Toàn bộ inventory được audit. |
| Evidence còn thiếu | Không thiếu để mô tả trạng thái hiện tại; thiếu toàn bộ outputs để nâng phần tổng kết thành kết luận thực nghiệm. |
| Có thể đo bằng | Execution plan cuối file. |
| Trạng thái | **VERIFIED** sau khi sửa câu “giao thức có thể thực thi” thành phạm vi thận trọng hơn. |

## 4. Ma trận RQ1–RQ5

| RQ | Metric | Required dataset | Existing artifact | Experiment command | Status |
|---|---|---|---|---|---|
| RQ1 | Recall@6, Precision@6, MRR, nDCG@6; paired delta/CI; late-chunk apply/fallback count | Frozen queries, canonical spans, R0/R1/R2 qrels, same document split | Imported/bridged canonical data, R0–R2 configs và index builder | `evaluation.index_builder`; `evaluation.evidence`; ba RQ1 `evaluation.runner run` trong `PHASE_4C_COMMANDS.md` | **NEED ENVIRONMENT + NEED DATA + NEED EXPERIMENT**: bridge sẵn sàng; exact embedding/index/qrels và paired analyzer chưa có. |
| RQ2 | Candidate Recall@20; final Recall/Precision/MRR/nDCG@6; paired rerank delta/CI; per-stratum errors | Frozen test queries và R2 qrels | E0–E3 configs, production-aware adapter, trace schema | E0–E3 runner commands; source-tag pair | **NEED CODE + NEED DATA + NEED EXPERIMENT**: E2–E3 confound và config-fusion wiring. |
| RQ3 | NLI pair confusion; false removal/retained contradiction; evidence delta; grade/rewrite/refusal/fallback/query-drift; downstream QA | Reviewed contradiction/ambiguous/insufficient labels mapped to R2; frozen QA gold | E3–E5 configs, 3 reviewed/imported contradiction pairs, CRAG calibration protocol, traces | E3/E4/E5 runner commands after dev calibration | **NEED CODE + NEED DATA + NEED EXPERIMENT**: ba contradiction pair đã import nhưng chưa map qua R2; chưa có calibration/analyzer pipeline hoặc runtime outputs. |
| RQ4 | QA correctness/faithfulness/context relevance; citation precision/completeness/unsupported rate; summary and mind-map rubrics; pointer resolution + semantic support | Frozen queries/gold/evidence; system-output claim labels; system summary/mind-map annotations | Production provenance, QA runner output shell, `quality_metrics.py`, candidate rubric aids | QA E0–E7 plus **no current executable artifact/annotation command** | **NEED CODE + NEED DATA + NEED EXPERIMENT**. |
| RQ5 | Quality delta; approve/edit/reject; edit distance; review time/agreement; p50/p95/p99; model calls/tokens/resources; path/fallback/cache rates | Paired E6/E7 system drafts/finals and reviewer logs on frozen test set; locked hardware/config | Runtime ReviewGate, E6/E7 configs, partial CLI review, operational history | E6/E7 runner + `evaluation.hitl` are documented but insufficient for runtime HITL | **NEED CLARIFICATION + NEED CODE + NEED DATA + NEED EXPERIMENT**. |

## 5. Artifact, code và command hiện có

### 5.1. Dataset/reproducibility

- `BE/evaluation/dataset.py`: validate, import-review, freeze-corpus, freeze; freeze mới là research gate.
- `BE/evaluation/review.py`: import reviewed query/citation/contradiction/artifact candidates.
- `BE/evaluation/index_builder.py`: build immutable namespaced R0–R2 indexes và per-document manifest.
- `BE/evaluation/evidence.py`: bridge source-unit coordinates sang canonical character offsets và derive representation qrels; coordinate schema đã được kiểm thử, còn qrel generation chờ index hợp lệ.
- `BE/evaluation/reproducibility.py`: index/run manifests và content hashes.
- `reports/evaluation/PHASE_4C_COMMANDS.md`: command order đã có `import-review`, automatic corpus approval/coordinate bridge và hai pha freeze; không cần sửa final JSONL thủ công.

### 5.2. Evaluation/metrics

- `BE/evaluation/runner.py`: chạy retrieval/QA skeleton và ghi `manifest.json`, `per_query.jsonl`, `retrieval.jsonl`, `qa.jsonl`, `timing.jsonl`, `aggregate_metrics.json`.
- `BE/evaluation/adapters.py`: production retrieval, rerank, NLI, grading/rewrite, Memory Tree và generation observer.
- `BE/evaluation/metrics.py`: binary Recall@k, Precision@k, MRR, nDCG@k, summary statistics, bootstrap CI và paired bootstrap.
- `BE/evaluation/quality_metrics.py`: aggregate human-labeled citation/rubric records; không tạo labels.
- `BE/evaluation/aggregate.py`: gom retrieval/QA/ablation rows; chưa tạo paired, stratified, quality hoặc cost analysis.
- `BE/evaluation/hitl.py`: offline interactive review tối thiểu; chưa phải runtime ReviewGate study driver.

### 5.3. Operational evidence

- `BE/scripts/perf/baseline_concurrency.py`: operational concurrency/load workload qua backend đang chạy.
- `BE/scripts/perf/cache_latency.py`: operational cache miss/hit workload.
- `BE/scripts/smoke_semantic_cache.py`: stack smoke invariant, không phải quality benchmark.
- `reports/performance/phase2-gateway-semaphore.md`, `phase3-single-flight.md`, `phase4-overload-protection.md`, `baseline-20260707-143610.{json,md}`: historical operational artifacts.

## 6. Kiểm tra độ rõ của TODO hiện tại

| Nhóm TODO | Đánh giá | Điều cần bổ sung để execution-ready |
|---|---|---|
| Freeze dữ liệu và hardware (4.2) | Khá rõ về data; chưa đủ về procedure | Thêm exact `import-review` command, bước áp corpus approval vào `documents.jsonl`, clean snapshot command và success criteria. |
| R0–R2/qrels (4.3) | Chưa đủ | Fix coordinate bridge; test qrel mapping; exact paired-analysis command/output schema. |
| E0–E2 (4.4.1) | Gần đủ sau freeze | Chốt candidate budget semantics và config wiring; thêm expected output checks. |
| E2–E3 rerank (4.4.2) | Không đủ | Tạo hybrid top-20/no-rerank control hoặc within-trace pre/post comparator. |
| NLI/CRAG (4.4.3–4.4.4) | Không đủ | Thêm dev calibration command, frozen calibrated config, mapping contradiction span→chunk pair và confusion/query-drift analyzer. |
| Memory Tree/fallback (4.4.5–4.4.6) | Một phần | Thêm routing/fallback aggregator và quality annotation join. |
| QA/citation (4.5) | Đúng về data nhưng thiếu workflow | Tạo system-output annotation export/import, claim segmentation policy, blind review và aggregate command. |
| Summary/mind map (4.6) | Không execution-ready | Tạo artifact experiment runner, fixed configs, output manifests, annotation UI/files và aggregator. |
| HITL (4.7) | Không execution-ready | Chốt runtime vs offline; với runtime phải dùng interrupt/resume, show evidence, preserve final answer/timestamps và double-review subset. |
| Performance/cost (4.8) | Đúng về mục tiêu; thiếu instrumentation | Per-round timing keys, complete calls/tokens, resource sampler, path/fallback aggregator và join với quality. |
| RQ table/case analysis/generalization (4.9) | Phụ thuộc hợp lý | Chỉ điền sau P0/P1; predeclare case-selection criteria trước khi nhìn kết quả. |

Kết luận: TODO hiện tại bảo vệ tốt khỏi việc bịa số, nhưng nhiều TODO là “research requirement” chứ chưa phải “runnable instruction”. Không thể chỉ chạy Phase 4C hiện tại rồi điền toàn bộ Bảng 4.4–4.9.

## 7. Các experiment còn thiếu và file cần dùng

### P0 — bắt buộc để trả lời RQ

#### P0.0. Hoàn thiện benchmark gate và coordinate bridge

- Mục tiêu: import review hợp lệ, freeze corpus, build R0–R2, map qrels và freeze dataset.
- File/code: `review.py`, `dataset.py`, `evidence.py`, `index_builder.py`; review export R1; `documents.jsonl`; R0–R2 configs.
- Đã hoàn tất: exact import command; automatic corpus approval; non-empty final JSONL; canonical documents; 89/89 span bridge; `review_import_manifest.json`; `coordinate_bridge_manifest.json`; corpus/split hash.
- Còn thiếu: resolve exact BAAI/bge-m3 load compatibility bằng một quyết định môi trường được khóa; build ba index; sinh qrels; freeze dataset và tự động cập nhật study manifest.
- Expected artifacts còn lại: ba `evaluation_index_manifest.json`; `qrel_manifest.json`; complete R0–R2 qrels; frozen dataset/annotation hashes.
- RQ: điều kiện tiên quyết cho RQ1–RQ5.

Snapshot gate ngày 14/08/2026:

- Corpus hash: `671cee787bca9e0c34f0d281227163112c17ebcdb002a010f27e820dacfd7b31`; split hash: `5728e0e8e6f4c5911e89d8295f85af3aa372d9efe3e909e823e73a7f6f97050f`.
- Import có 55 final queries, 89 canonical spans, 77 citation annotations, 3 contradiction pairs và 3 artifact annotations. Đây là data-curation artifacts, không phải runtime result.
- `freeze` dừng đúng ở `representation qrels incomplete`; R0/R1/R2 namespaces, `qrel_manifest.json`, `runs/` và `results/` không tồn tại.
- Targeted validation: 34 tests pass cho coordinate bridge, review import/UI và evaluation harness smoke; đây là software verification, không phải research benchmark.
- Exact environment ghi nhận PyTorch `2.5.1+cpu`, Transformers `5.9.0`, sentence-transformers `5.5.1`. Checkpoint cache chính dùng `pytorch_model.bin`; Transformers từ chối load qua `torch.load` nếu PyTorch <2.6. Không tự dùng snapshot `model.safetensors` khác revision vì chưa có quyết định khóa revision/hash tương đương.

#### P0.1. Representation ablation R0–R2

- Mục tiêu: chạy cùng E3 method components trên R0/R1/R2.
- File/code: `R0_recursive.yaml`, `R1_structure.yaml`, `R2_late.yaml`, `E3_rerank.yaml`, `runner.py`, `metrics.py`.
- Thiếu: paired analyzer và validation rằng only representation changed.
- Expected artifacts: `runs/RQ1_R*_FINAL/`; paired table; late-chunking application/fallback report.
- RQ: RQ1.

#### P0.2. Retrieval/reranker ablation E0–E3

- Mục tiêu: sparse vs dense vs hybrid và tác động riêng của reranker.
- File/code: E0–E3 configs, `adapters.py`, `ensemble_retriever.py`, `runner.py`.
- Thiếu: wire fusion config; tạo top-20 no-rerank control hoặc within-trace comparator; paired/stratum analyzer.
- Expected artifacts: E0–E3/control run directories; candidate-recall và final-ranking comparison.
- RQ: RQ2.

#### P0.3. NLI và CRAG heuristic adaptation E3–E5

- Mục tiêu: đo contradiction handling, false removal, evidence change, rewrite/refusal/fallback và query drift.
- File/code: E3–E5 configs, `nli.py`, `grading.py`, `query_rewrite.py`, `CRAG_CALIBRATION_PROTOCOL.md`, contradiction/query strata.
- Thiếu: development calibration command/config; span-to-pair join; NLI confusion và CRAG analysis scripts.
- Expected artifacts: frozen calibration decision; E3–E5 runs; NLI confusion report; corrective-round report.
- RQ: RQ3.

#### P0.4. Grounded QA và claim-level citation evaluation

- Mục tiêu: chấm system outputs, không chấm candidate gold claims thay cho outputs.
- File/code: E0–E7 `qa.jsonl`/traces, `quality_metrics.py`, QUALITY protocol, final gold answers/spans.
- Thiếu: claim segmentation, annotation export/import, blind human labels, join/aggregate command.
- Expected artifacts: versioned QA/citation annotation JSONL; rubric/citation aggregates; unsupported-claim analysis.
- RQ: RQ4 và quality side của RQ5.

#### P0.5. Summary và mind-map artifact evaluation

- Mục tiêu: sinh artifacts bằng production pipelines và chấm nội dung/cấu trúc/provenance.
- File/code: summary/mind-map graphs/pipelines/stores, final `artifact_annotations.jsonl`, `quality_metrics.py`.
- Thiếu: experiment runner, fixed configs, output manifest, annotation workflow và aggregator.
- Expected artifacts: system summaries/mind maps, raw provenance/degraded state, human rubric labels, aggregate report.
- RQ: RQ4.

#### P0.6. Runtime HITL E6–E7

- Mục tiêu: đo ReviewGate thực với draft/evidence/action/final answer/time và paired blind quality.
- File/code: query graph, resume endpoint, E6/E7 configs, HITL protocol, jobs/checkpoints.
- Thiếu: runtime driver, evidence display, persistent review schema, final-answer capture, double-review subset và agreement calculator.
- Expected artifacts: versioned runtime HITL review JSONL, paired quality labels, action/edit/time/agreement report.
- RQ: RQ5.

#### P0.7. Research performance và quality–cost join

- Mục tiêu: đo latency/calls/tokens/resources/path/fallback trên chính frozen queries và ghép với quality.
- File/code: `trace.py`, `runner.py`, gateway/node logs, resource sampler cần bổ sung, quality outputs P0.4–P0.6.
- Thiếu: per-round instrumentation, token/call completeness, resource sampling, percentile/path/fallback/cost aggregator.
- Expected artifacts: locked hardware manifest, per-query performance records, aggregate percentiles, quality–cost table/plot.
- RQ: RQ5.

### P1 — quan trọng

1. Source-tag sensitivity với config fidelity đã sửa; hỗ trợ RQ2/RQ3 và provenance prompt sensitivity.
2. Controlled Memory Tree E5–E6 routing/quality/provenance comparison; hỗ trợ RQ4/RQ5.
3. Insufficient/ambiguous/contradictory answerability and refusal analysis; hỗ trợ RQ3/RQ4.
4. Fallback/degraded-path analysis bằng run traces hoặc fault injection có kiểm soát; hỗ trợ limitations và RQ5.
5. Semantic cache experiment tách riêng khỏi method ablation; hỗ trợ operational part của RQ5.

### P2 — optional

1. Repeated summary/mind-map runs để đo stability.
2. External/out-of-domain corpus evaluation sau khi core benchmark hoàn tất.
3. Fault-injection matrix cho timeout, invalid JSON, unavailable reranker/NLI và service restart.
4. Rerun historical concurrency workloads trên clean locked snapshot để so sánh vận hành, vẫn không thay research benchmark.

## 8. Citation và evidence consistency

1. Các citation số xuất hiện trong Chương 4 đều có entry tương ứng trong danh mục Chương 2. Các range như [26]–[28] tiếp tục mapping toàn cục đã có; không tạo citation mới.
2. [7] chỉ hỗ trợ nền tảng corrective retrieval; Chương 4 giữ claim ở mức CRAG heuristic adaptation.
3. [8], [9] hỗ trợ distinction giữa groundedness/citation và pointer existence; không dùng source ID làm semantic evidence.
4. [10], [11] hỗ trợ thiết kế human review/agreement ở mức khái niệm; không hỗ trợ claim rằng HITL của dự án đã cải thiện quality.
5. [13], [14], [35], [36] hỗ trợ phân tách QA dimensions và giới hạn LLM judge; không có judge score nào được coi là ground truth.
6. Citation về retrieval, NLI, summary và mind map chỉ làm cơ sở methodology; không được dùng để suy ra project benchmark result.
7. Historical performance numbers có local report source và được gắn đúng phạm vi operational. Không có external academic citation nào được dùng thay runtime artifact.
8. Claim 34/34 chỉ có textual record trong Chương 3; không tìm thấy raw test log. Giữ nó ở phạm vi historical software verification, hoặc bổ sung test report nếu muốn audit độc lập.
9. Không có `[CITATION NEEDED]` trong Chương 4. Audit không phát hiện citation giả, nhưng local implementation claims nên tiếp tục giữ claim–source ledger khi code thay đổi.

## 9. Các lỗi factual/logic đã sửa trong Chương 4

Audit chỉ sửa các lỗi vượt quá evidence sau, không thêm result:

1. Sửa mô tả workflow từ “executable contracts/giao thức có thể thực thi” thành “một phần executable”, vì còn blocker end-to-end.
2. Audit ban đầu phát hiện mismatch giữa coordinate schema của imported spans và qrel mapper. P0.0 sau đó đã sửa bằng deterministic canonical coordinate bridge; TODO hiện chỉ còn index/qrel data và environment gate.
3. Bổ sung confound E2–E3 do `retrieval.top_k` đổi đồng thời với rerank; yêu cầu control phù hợp.
4. Bổ sung việc fusion weights/RRF trong YAML chưa được adapter truyền tường minh.
5. Làm rõ E7 evaluation runner chưa đi qua runtime ReviewGate/resume; đổi TODO HITL thành `NEED CODE + DATA` và yêu cầu chốt runtime vs offline.

Không sửa Chương 1–3.

## 10. EXECUTION PLAN

- **Experiment 1 — Benchmark gate/R0–R2 build:** import/freeze data, sửa coordinate bridge, build indexes và qrels. **Output:** frozen hashes, index manifests, representation qrels. **RQ:** prerequisite RQ1–RQ5.
- **Experiment 2 — RQ1 representation ablation:** chạy E3 trên R0/R1/R2 và paired analysis. **Output:** RQ1 run directories, paired retrieval table, late-chunk fallback report. **RQ:** RQ1.
- **Experiment 3 — RQ2 retrieval ablation:** chạy E0–E3 với reranker control hợp lệ. **Output:** candidate/final ranking metrics và error strata. **RQ:** RQ2.
- **Experiment 4 — RQ3 evidence correction:** dev calibration rồi chạy E3–E5. **Output:** NLI confusion, CRAG rounds, evidence delta, query-drift/refusal/fallback report. **RQ:** RQ3.
- **Experiment 5 — QA/citation evaluation:** sinh QA outputs và human-label system claims. **Output:** QA rubric, citation precision/completeness và unsupported-claim artifacts. **RQ:** RQ4, RQ5.
- **Experiment 6 — Summary/mind-map evaluation:** chạy production artifact pipelines với fixed manifests và human rubric. **Output:** system artifacts, provenance/degradation records, rubric aggregates. **RQ:** RQ4.
- **Experiment 7 — Runtime HITL:** chạy E6/E7 qua ReviewGate/resume với reviewer thật và blind paired scoring. **Output:** draft/final/action/time/edit/agreement records. **RQ:** RQ5.
- **Experiment 8 — Performance/quality–cost:** thu instrumentation trên cùng frozen runs. **Output:** stage latency percentiles, calls/tokens/resources, path/fallback rates và quality–cost analysis. **RQ:** RQ5.

Cho đến khi P0.0 hoàn tất, không chạy hoặc báo cáo E0–E7 như research benchmark. Cho đến khi P0.4–P0.7 có human/system-output data, không điền Bảng 4.5–4.9.
