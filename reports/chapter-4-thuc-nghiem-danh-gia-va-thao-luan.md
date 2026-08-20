# A. TOÀN VĂN CHƯƠNG 4

# CHƯƠNG 4. THỰC NGHIỆM, ĐÁNH GIÁ VÀ THẢO LUẬN

Chương này xác lập giao thức đánh giá cho quy trình trí tuệ tài liệu đa tầng đã trình bày ở Chương 3, đồng thời báo cáo đúng phạm vi bằng chứng hiện có trong repository. Tại thời điểm cập nhật P0.0, review R1 đã được import, canonical coordinate bridge đã validate toàn bộ span được chấp nhận và corpus membership đã freeze; tuy nhiên, R0–R2 chưa build do môi trường chưa load được đúng checkpoint BAAI/bge-m3, dataset chưa thể freeze cuối vì chưa có qrels và chưa có run E0–E7. Vì vậy, chương phân biệt bốn lớp nội dung: trạng thái hiện thực, thiết kế đánh giá, quan sát vận hành lịch sử và kết quả nghiên cứu còn chờ dữ liệu. Mọi vị trí chưa có benchmark hợp lệ được đánh dấu `[TODO/NEED ...]` theo blocker thực tế thay vì điền số giả định.

## 4.1. Mục tiêu thực nghiệm và giả thuyết nghiên cứu

### 4.1.1. Mục tiêu đánh giá theo năm câu hỏi nghiên cứu

Mục tiêu của đánh giá là kiểm tra từng quyết định phương pháp bằng một biến quan sát phù hợp, thay vì suy ra hiệu quả từ việc mô-đun đã tồn tại trong mã nguồn. Theo RQ1, đánh giá so sánh ba cách biểu diễn R0, R1 và R2 để đo ảnh hưởng của structure-aware chunking và late chunking có điều kiện. Theo RQ2, đánh giá tách đóng góp của BM25, FAISS, hybrid retrieval, rank fusion và cross-encoder reranking. Theo RQ3, đánh giá NLI, CRAG heuristic adaptation và query rewriting trên các truy vấn có bằng chứng mơ hồ, thiếu hoặc mâu thuẫn. Theo RQ4, đánh giá provenance của grounded QA, tóm tắt section-first và mind map skeleton-first ở cấp claim hoặc thành phần artifact. Theo RQ5, đánh giá sự đánh đổi giữa chất lượng, độ trễ, số lần gọi mô hình, tài nguyên và công sức Human-in-the-Loop (HITL).

Năm mục tiêu trên tiếp tục các ranh giới khái niệm đã thiết lập ở Chương 2 và Chương 3. Memory Tree là biểu diễn phân cấp của dự án, không được đồng nhất với RAPTOR. Bộ chấm bằng chứng của hệ thống là một CRAG heuristic adaptation lấy cảm hứng từ corrective retrieval [7], không phải bản tái hiện đầy đủ CRAG. Tương tự, việc một đầu ra giữ được `source_id` hoặc `chunk_id` chỉ xác nhận provenance kỹ thuật; citation correctness vẫn cần đánh giá support ở cấp claim [9].

### 4.1.2. Các giả thuyết cần kiểm chứng

Các giả thuyết dưới đây là mục tiêu thực nghiệm, chưa phải kết luận của nghiên cứu.

- **H1 — biểu diễn tài liệu:** structure-aware chunking và late chunking có điều kiện có thể làm thay đổi Recall@k, MRR và nDCG@k so với recursive chunking và embedding từng đoạn độc lập. Hướng và độ lớn của thay đổi phải được xác định trên cùng corpus, query set và candidate budget.
- **H2 — truy hồi nhiều giai đoạn:** hybrid retrieval và cross-encoder reranking có thể cải thiện xếp hạng bằng chứng so với BM25-only, FAISS-only hoặc hybrid chưa rerank. Giả thuyết này chỉ được chấp nhận nếu kết quả cặp trên cùng truy vấn hỗ trợ.
- **H3 — hiệu chỉnh bằng chứng:** NLI và vòng CRAG heuristic adaptation–query rewriting có thể giúp xử lý truy vấn mâu thuẫn, mơ hồ hoặc thiếu bằng chứng. Việc kiểm chứng cần đo đồng thời chất lượng evidence, số vòng hiệu chỉnh, fallback và query drift.
- **H4 — provenance:** các pipeline QA, summary và mind map có thể duy trì liên kết kỹ thuật tới chunk nguồn. Việc liên kết tồn tại không đủ để xác nhận nội dung được nguồn hỗ trợ; cần thêm citation/rubric annotation.
- **H5 — chất lượng và chi phí:** full pipeline và HITL có thể thay đổi chất lượng đầu ra với chi phí về latency, model calls và công sức người duyệt. Cần đo cả hai phía của sự đánh đổi trên cùng protocol.

Không giả thuyết nào trong số H1–H5 được xem là đã xác nhận ở thời điểm hiện tại. Repository chưa chứa aggregate metrics của các cấu hình nghiên cứu và chưa có dữ liệu trước–sau HITL.

### 4.1.3. Phân biệt xác minh phần mềm và đánh giá phương pháp

Xác minh phần mềm trả lời câu hỏi các thành phần có tồn tại và có tuân theo contract đã thiết kế hay không. Mã nguồn hiện có bốn LangGraph cho ingest, query, summary và mind map; evaluation harness import trực tiếp các thành phần production; các test mô tả contract cho graph topology, fallback, ownership, resume, persistence và API. Chương 3 ghi nhận một lần chạy kiểm thử mục tiêu ngày 11/08/2026 đạt 34/34 test cho CRAG config, rerank, NLI, corrective graph, HITL graph và query resume. Kết quả này chỉ xác nhận hành vi phần mềm tại trạng thái mã và môi trường khi chạy; working tree hiện tại đã có thay đổi nên không được xem là chứng nhận mới cho toàn bộ repository.

Đánh giá phương pháp trả lời câu hỏi các quyết định thiết kế có cải thiện chất lượng trên dữ liệu nghiên cứu hay không. Câu hỏi này đòi hỏi frozen dataset, representation-specific qrels, system outputs, human labels và các run có manifest. Test pass, endpoint hoạt động hoặc graph chứa một node không thể thay thế các bằng chứng đó. Do đó, các phần 4.3–4.7 mô tả protocol và implementation support trước, rồi đánh dấu rõ kết quả còn thiếu.

## 4.2. Thiết kế thực nghiệm

### 4.2.1. Bộ tài liệu và phân tầng loại truy vấn

Bộ dữ liệu đang ở trạng thái candidate, chưa phải benchmark đóng băng. `dataset_manifest.json` ghi nhận 12 tài liệu trong inventory và 3 tài liệu đủ điều kiện sơ bộ, gồm 2 PDF về AI/RAG và 1 DOCX về an toàn thông tin. Ba tài liệu đều được mô tả là tiếng Việt có thuật ngữ kỹ thuật tiếng Anh. Proposed split dùng một tài liệu AI/RAG cho development và hai tài liệu còn lại cho test; cách chia ở cấp tài liệu nhằm giảm nguy cơ cùng một tài liệu xuất hiện ở cả hai tập.

Gói candidate chứa 60 truy vấn: 28 cho development và 32 cho test theo proposed split. Phân tầng candidate gồm exact-term factual, paraphrase factual, multi-chunk, compare, how/why, cross-section, ambiguous, citation-sensitive, overview, main-points, insufficient evidence và contradictory evidence. Trong đó, 53 truy vấn được tạo với trạng thái answerable, 4 ambiguous và 3 insufficient evidence. Các con số này mô tả gói ứng viên dùng cho human review, không phải số lượng query cuối của benchmark.

**Bảng 4.1. Trạng thái bộ dữ liệu ứng viên tại thời điểm soạn thảo**

| Thành phần | Trạng thái có trong repository | Trạng thái nghiên cứu |
|---|---:|---|
| Tài liệu trong inventory | 12 | Chưa phải toàn bộ đều đủ điều kiện |
| Tài liệu eligible sơ bộ | 3 | Đã được review trong export R1, chưa freeze |
| Candidate queries | 60 | 55 record approve/edit đã import; 5 bị reject |
| Candidate canonical evidence spans | 92 | 89 span thuộc query được giữ đã import và bridge canonical |
| Candidate citation claims | 83 | 77 claim thuộc query được giữ đã import |
| Candidate contradiction pairs | 3 | 3 record đã import |
| Candidate artifact records | 3 | 3 record đã import |
| Representation-specific qrels | 0 | Chưa tạo vì R0–R2 chưa build |

Nguồn: `dataset_manifest.json`, các file candidate JSONL và review export R1. Bảng không biểu diễn kết quả của hệ thống.

Quy mô ba tài liệu nhỏ hơn mục tiêu 6–10 tài liệu nêu trong tài liệu readiness. Nó cũng tạo lệch miền: an toàn thông tin chỉ xuất hiện ở proposed test split. Vì vậy, ngay cả sau khi freeze, khả năng khái quát hóa giữa miền vẫn phải được trình bày thận trọng.

### 4.2.2. Gán nhãn relevance, evidence, answer và artifact

Quy trình gán nhãn tách candidate generation khỏi human validation. Candidate có thể được tạo tự động để giảm công sức chuẩn bị, nhưng chỉ record được người duyệt approve hoặc edit mới đủ điều kiện nhập vào ground truth. Relevance được xác định từ canonical evidence span ở văn bản nguồn trước khi ánh xạ sang chunk của từng representation; cách này tránh lấy chunk boundary của một cấu hình làm chuẩn cho cấu hình khác. Gold answer, ambiguity, insufficient evidence và contradiction cũng được review như các loại nhãn riêng.

Review export R1 ngày 13/08/2026 ghi 46 candidate query được approve, 9 được edit và 5 bị reject; 83 citation claims, 3 contradiction pairs, 3 artifact records và 3 quyết định corpus đã được review, không còn item pending trong giao diện. Import gate đã materialize 55 query, 89 canonical spans, 77 claim annotations, 3 contradiction records và 3 artifact records; các record bị reject không được đưa vào ground truth. Đây là bằng chứng về data curation, không phải runtime HITL evaluation, và các tỷ lệ approve/edit/reject này không được dùng ở Mục 4.7.

Dataset hiện ở trạng thái hai pha `corpus_frozen_annotation_in_progress`: corpus hash và document split đã khóa, còn dataset hash/annotation hash cuối phải chờ R0–R2 qrels. `review_import_manifest.json` và `coordinate_bridge_manifest.json` lưu source/review/code hashes; final benchmark vẫn chưa được phép chạy.

`[TODO/NEED ENVIRONMENT + DATA]` Import, coordinate validation và corpus freeze đã hoàn tất. Cần giải quyết tương thích an toàn của exact BAAI/bge-m3 checkpoint với môi trường PyTorch/Transformers đã khóa, build R0–R2, sinh qrels và chỉ sau đó freeze dataset để ghi `dataset_hash`, `split_hash` và `annotation_hash`.

### 4.2.3. Baseline và cấu hình ablation

Thiết kế biểu diễn gồm ba cấu hình có namespace index riêng. R0 dùng recursive chunking và embedding từng chunk; R1 dùng markdown-header/structure-aware chunking nhưng không late chunking; R2 giữ structure-aware chunking và bật late chunking có điều kiện. Cả ba đặt chunk size 500, overlap 50 và dùng BAAI/bge-m3 theo manifest nghiên cứu. Khi điều kiện căn chỉnh span không thỏa, R2 phải ghi nhận fallback sang embedding độc lập thay vì mặc định rằng late chunking đã được áp dụng.

Thiết kế retrieval và generation gồm chuỗi E0–E7. E0 là BM25-only; E1 là FAISS-only; E2 là hybrid; E3 thêm cross-encoder reranking; E4 thêm NLI; E5 thêm CRAG heuristic adaptation và query rewriting; E6 thêm Memory Tree để tạo full automatic configuration; E7 giữ full configuration và thêm review của con người. Source-tag sensitivity được đo bằng một cặp cấu hình giống nhau ngoài biến `source_tags`.

**Bảng 4.2. Ma trận baseline và ablation đã định nghĩa**

| Cấu hình | Representation/retrieval | Rerank | NLI | CRAG heuristic adaptation | Memory Tree | HITL |
|---|---|---:|---:|---:|---:|---:|
| R0 | Recursive, independent embedding | — | — | — | — | — |
| R1 | Structure-aware, independent embedding | — | — | — | — | — |
| R2 | Structure-aware, conditional late chunking | — | — | — | — | — |
| E0 | BM25 | Tắt | Tắt | Tắt | Tắt | Tắt |
| E1 | FAISS | Tắt | Tắt | Tắt | Tắt | Tắt |
| E2 | Hybrid | Tắt | Tắt | Tắt | Tắt | Tắt |
| E3 | Hybrid | Bật | Tắt | Tắt | Tắt | Tắt |
| E4 | Hybrid | Bật | Bật | Tắt | Tắt | Tắt |
| E5 | Hybrid | Bật | Bật | Bật | Tắt | Tắt |
| E6 | Hybrid | Bật | Bật | Bật | Bật | Tắt |
| E7 | Hybrid | Bật | Bật | Bật | Bật | Bật |

Các so sánh phải giữ cố định dataset split, index tương ứng, candidate budget, model checkpoint và seed. RQ1 dùng cùng thành phần ở mức E3 và chỉ thay representation R0–R2, nhằm tránh trộn ảnh hưởng của chunking với NLI hoặc corrective retrieval.

### 4.2.4. Môi trường, mô hình và tham số

`baseline_manifest.json` đóng băng FULL METHOD v1 ngày 11/08/2026 ở mức cấu hình. Manifest ghi Python 3.11.9; Flask 3.1.2; LangChain 0.3.30; LangGraph 0.2.76; FAISS CPU 1.13.1; sentence-transformers 5.5.1; Transformers 5.9.0 và PyTorch 2.5.1+cpu. Các checkpoint chính gồm BAAI/bge-m3, BAAI/bge-reranker-v2-m3, MoritzLaurer/mDeBERTa-v3-base-mnli-xnli, qwen2.5:7b-instruct và gemma2:2b.

FULL METHOD v1 đặt trọng số BM25/FAISS là 0,4/0,6, candidate count 20, retrieval top-k 6 và hằng số RRF 60 cho đường thay thế dùng RRF thủ công. Reranker lấy tối đa 20 ứng viên và trả 6 kết quả. NLI kiểm tra tối đa 3 cặp hai chiều với ngưỡng contradiction 0,6. CRAG heuristic adaptation dùng ngưỡng `correct=0,25`, `wrong=0,10` và tối đa hai lần rewrite; các ngưỡng này là heuristic chưa được calibration trên test set. Generation dùng factual temperature 0,0 và context window 4096 theo manifest.

Docker Compose mô tả frontend, Flask backend, LLM gateway, mind map service và Redis; RQ worker là profile tùy chọn. Kiến trúc triển khai này là cấu hình phần mềm, không phải mô tả đầy đủ môi trường thực nghiệm cuối.

`[TODO/NEED DATA]` Cần ghi cấu hình phần cứng của máy chạy benchmark cuối, gồm CPU, RAM, GPU nếu có, hệ điều hành, phiên bản Ollama, số worker và giới hạn concurrency. Cũng cần chụp commit sạch hoặc content hash của source dùng cho run; manifest hiện ghi commit `9c157f682e89bf29f840b41392a77abc0faef341` nhưng working tree tại lúc capture đã dirty.

### 4.2.5. Metrics, quy trình đo và khả năng tái lập

Retrieval được đánh giá bằng Recall@k, Precision@k, MRR và nDCG@k như đã định nghĩa tại Mục 2.8.1 [34]. `evaluation.metrics` hiện thực các metric này trên binary relevant chunk IDs, đồng thời tổng hợp số mẫu, mean, median, standard deviation, interquartile range và bootstrap confidence interval. Hàm paired bootstrap báo mean difference và confidence interval, nhưng không tự chuyển interval thành tuyên bố significance.

Grounded QA được tách thành answer correctness, faithfulness và context relevance [13], [14]. Citation được đánh giá ở cấp claim bằng citation precision, citation recall/completeness và unsupported claim rate [8], [9]. Summary rubric gồm coverage, faithfulness, redundancy, section organization và provenance validity. Mind-map rubric gồm concept coverage, hierarchy correctness, relation correctness, redundancy và provenance validity. HITL cần đo approve/edit/reject, thay đổi claim, chất lượng trước–sau, review time và agreement [10], [11].

**Bảng 4.3. Metric và điều kiện dữ liệu**

| Nhóm | Metric | Dữ liệu bắt buộc |
|---|---|---|
| Retrieval | Recall@k, Precision@k, MRR, nDCG@k | Frozen queries và representation-specific qrels |
| Grounded QA | Correctness, faithfulness, context relevance | System answers, gold answer/evidence và human labels |
| Citation | Precision, recall/completeness, unsupported claim rate | Claim segmentation và claim–evidence support labels |
| Summary | Coverage, faithfulness, redundancy, organization, provenance validity | System summaries và rubric annotations |
| Mind map | Concept/hierarchy/relation correctness, redundancy, provenance validity | System mind maps và rubric annotations |
| HITL | Approve/edit/reject, edit magnitude, quality delta, review time/agreement | Paired draft/final outputs và reviewer logs |
| Hiệu năng | Stage latency, model calls, tokens, cache/fallback/corrective rates | Run traces trên cùng frozen benchmark |

Runner chỉ cho phép chạy research dataset khi manifest có trạng thái frozen và representation manifest khớp corpus hash. Mỗi run dự kiến ghi manifest, per-query trace, retrieval, QA, timing và aggregate metrics. Trace giữ riêng candidate của BM25, FAISS, fusion, rerank, NLI, corrective rounds, Memory Tree, provenance, model calls và errors. Tuy nhiên, audit mã nguồn cho thấy các trường `bm25_weight`, `faiss_weight` và `rrf_k` trong YAML chưa được adapter truyền tường minh xuống hàm fusion; giá trị mặc định hiện trùng với manifest nhưng chưa tạo thành contract cấu hình độc lập. Các gate hỗ trợ một phần khả năng tái lập, nhưng chưa đủ để xem toàn bộ workflow là executable end-to-end và hiện chưa có run directory để kiểm tra đầu ra thực tế.

## 4.3. Đánh giá biểu diễn và phân đoạn tài liệu

### 4.3.1. Recursive chunking và structure-aware chunking

Mục tiêu của so sánh R0–R1 là tách ảnh hưởng của chunk boundary khỏi các tầng retrieval phía sau. R0 tạo chunk theo cửa sổ đệ quy với kích thước và overlap cố định. R1 ưu tiên heading path và cấu trúc Markdown, sau đó mới dùng recursive fallback. Cả hai dùng embedding độc lập, cùng checkpoint, cùng candidate budget và cùng thành phần E3 để chỉ thay đổi cách biểu diễn.

Implementation support cho phép xây index riêng cho mỗi representation và ghi manifest gồm corpus version, chunking parameters, embedding model và thông tin theo tài liệu. Coordinate bridge hiện giữ original source locator/offset/text/hash, đồng thời tạo `locator.char_start`/`char_end` trên canonical document bằng exact unit mapping; mọi span imported đã vượt boundary, document-identity và text/hash validation. Mapper có thể dùng canonical coordinates này sau khi đúng index tồn tại.

`[TODO/NEED ENVIRONMENT + DATA]` Coordinate schema và bridge đã được kiểm thử, nhưng exact embedding checkpoint chưa load được trong môi trường khóa nên chưa có R0/R1 index hoặc representation qrels. Sau khi giải quyết blocker môi trường mà không thay model, cần build R0/R1, ánh xạ evidence span, rồi mới chạy cùng query set ở cấu hình E3 và báo cáo metric. Không thể kết luận structure-aware chunking tốt hơn recursive chunking từ trạng thái gate hiện tại.

### 4.3.2. Ảnh hưởng của late chunking

Mục tiêu của so sánh R1–R2 là đo tác động của late chunking trong khi giữ nguyên chunk boundary theo cấu trúc. R2 chỉ áp dụng late chunking khi Markdown chunks có document span hợp lệ và encoder khả dụng; trường hợp không thỏa điều kiện phải quay về independent embedding và ghi `late_chunking_applied=false`. Vì vậy, phân tích cần tách tài liệu thực sự dùng late chunking khỏi tài liệu đi qua fallback.

Implementation đã có bộ mã hóa BAAI/bge-m3 cho document context, mean pooling theo span và đường fallback sang embedding từng chunk. Evaluation index manifest dự kiến lưu trạng thái áp dụng theo tài liệu. Đây là bằng chứng về khả năng chạy ablation, không phải bằng chứng về chất lượng retrieval.

`[TODO/NEED DATA]` Chưa có index R2 hoặc per-document late-chunking manifest trên frozen corpus. Cần chạy R1 và R2 trên cùng query set, báo cáo số tài liệu/chunk thực sự dùng late chunking, metric retrieval theo cặp và failure/fallback count. Không được gộp các tài liệu fallback vào nhóm “late chunking đã áp dụng” mà không phân tầng.

### 4.3.3. Phân tích theo loại tài liệu và loại truy vấn

Candidate package đã có query strata cho exact term, paraphrase, multi-chunk, cross-section, compare, overview, ambiguous, insufficient evidence và contradictory evidence. Các strata này hỗ trợ kiểm tra liệu một representation có lợi cho loại truy vấn nào thay vì chỉ báo cáo mean toàn bộ. Phân tích theo miền cũng cần tách AI/RAG và an toàn thông tin vì proposed split hiện không cân bằng miền.

`[TODO/NEED DATA]` Cần final query labels, đủ số mẫu trong từng stratum và kết quả R0–R2. Với strata có rất ít mẫu, chương phải báo số quan sát và interval thay vì diễn giải chênh lệch nhỏ như xu hướng tổng quát.

`[TODO/NEED DATA — Bảng 4.4]` Bảng kết quả representation và retrieval chỉ được tạo sau khi có paired R0–R2 và E0–E5 runs trên frozen dataset.

## 4.4. Đánh giá truy hồi bằng chứng nhiều giai đoạn

### 4.4.1. BM25-only, FAISS-only và hybrid retrieval

Mục tiêu của E0–E2 là đo tính bổ sung giữa tín hiệu lexical và semantic. BM25 phù hợp với thuật ngữ chính xác và tên riêng [19], trong khi dense retrieval hỗ trợ paraphrase nhưng phụ thuộc representation và miền [20], [21]. E2 kết hợp hai ranking với cùng candidate budget để tránh lợi thế do lấy nhiều ứng viên hơn.

Evaluation adapter đã tách `bm25_candidates`, `faiss_candidates` và `fusion_candidates` trong trace. Điều này giải quyết giới hạn của runtime graph, nơi weighted ensemble không luôn bảo toàn đầy đủ score của từng kênh. Adapter dùng production retriever thay vì viết một retrieval policy mới.

`[TODO/NEED DATA]` Chưa có E0, E1 hoặc E2 run trên frozen test set. Cần báo Recall@k, Precision@k, MRR, nDCG@k và per-stratum errors trên cùng R2 index. Không thể kết luận hybrid tốt hơn BM25 hoặc FAISS từ lý thuyết hay implementation.

### 4.4.2. Ảnh hưởng của rank fusion và cross-encoder reranking

Mục tiêu dự kiến của E2–E3 là xác định thay đổi thứ hạng sau cross-encoder. Tuy nhiên, cấu hình hiện tại đồng thời đổi `retrieval.top_k` từ 6 ở E2 lên 20 ở E3 rồi mới giữ 6 kết quả sau rerank; vì vậy, so sánh aggregate E2–E3 trực tiếp chưa cô lập duy nhất tác động của reranker. Cần bổ sung một đối chứng hybrid top-20 không rerank hoặc tính trước–sau rerank trên cùng candidate pool E3. Reranker BAAI/bge-reranker-v2-m3 nhận tối đa 20 candidate và giữ 6 kết quả trong cấu hình nghiên cứu. Vì reranker không thể phục hồi evidence đã bị candidate generation bỏ sót, cần báo cả candidate recall trước rerank và ranking metrics sau rerank [24].

Trace schema giữ raw score, normalized score và rank sau rerank. Source tags được đặt trước rerank trong FULL METHOD v1; cặp `source_tags_on/off` được thiết kế để đo liệu metadata này làm thay đổi score hoặc NLI probability hay không.

`[TODO/NEED CODE + DATA]` Cần chốt đối chứng cô lập reranker, nối tường minh các tham số fusion từ config vào adapter, rồi mới chạy paired outputs và source-tag sensitivity. Cần báo delta theo query, confidence interval, timeout/fallback của reranker và các trường hợp relevant evidence bị hạ hạng. Sigmoid trên raw score không được mô tả như probability đã calibration nếu chưa có calibration evidence.

### 4.4.3. Hiệu quả phát hiện mâu thuẫn của NLI

Mục tiêu của E3–E4 là đánh giá tầng NLI trên các cặp evidence có nhãn contradiction. Runtime kiểm tra tối đa ba cặp ưu tiên, đánh giá hai chiều bằng checkpoint đa ngôn ngữ và loại passage có hạng thấp hơn khi score vượt ngưỡng 0,6. Chính sách này phát hiện mâu thuẫn tiềm năng giữa đoạn; nó không xác minh sự thật, thẩm quyền nguồn hoặc quan hệ thời gian. XNLI cung cấp cơ sở cho bài toán đa ngôn ngữ [26]–[28] nhưng không tự chứng minh checkpoint cụ thể hoạt động tốt trên corpus này.

Ba contradiction pairs đã được review và import vào final annotations. Tuy nhiên, chúng chưa được ánh xạ qua R2/chạy E3–E4, và ba cặp là quy mô quá nhỏ để hỗ trợ kết luận rộng về NLI.

`[TODO/NEED DATA]` Ba contradiction labels đã được import, nhưng cần ánh xạ chúng qua R2, tạo thêm hoặc xác nhận đủ cặp test, chạy E3/E4 và lập confusion matrix ở cấp cặp. Cần báo false removal, retained contradiction, timeout/fallback và ảnh hưởng sau NLI tới retrieval/QA. Không được dùng ba reviewed pairs như một metric hiệu quả.

### 4.4.4. Hiệu quả của CRAG heuristic adaptation và query rewriting

Mục tiêu của E4–E5 là đo liệu grader heuristic và tối đa hai lần query rewrite có cải thiện evidence cho truy vấn mơ hồ hoặc thiếu bằng chứng. Grader dùng lexical/retrieval signals để trả `correct`, `ambiguous` hoặc `wrong`; nó không tái hiện evaluator, web search và knowledge refinement của CRAG gốc [7]. Khi hết ngân sách, `wrong` dẫn tới câu từ chối cố định, còn `ambiguous` vẫn sinh best-effort từ evidence hiện có.

Evaluation trace lưu từng round, effective query, evidence IDs, grade, best score, threshold và hành động cuối. Generation vẫn dùng original query, trong khi rewritten query chỉ phục vụ các vòng retrieval. Cấu trúc này cho phép kiểm tra query drift thay vì giả định rewrite luôn giữ nguyên ý định.

`[TODO/NEED DATA]` Chưa có E4/E5 run, calibration trên development split hoặc test result. Cần calibration decision theo protocol, sau đó freeze threshold dưới tên cấu hình mới nếu thay đổi; không được tune trên test. Cần báo grade distribution, rewrite count, evidence delta, refusal/fallback rate và các trường hợp rewrite làm lệch ý định.

### 4.4.5. Memory Tree fast path và full retrieval path

Mục tiêu của E5–E6 là so sánh đường full retrieval với cấu hình cho phép Memory Tree trả lời trực tiếp. Memory Tree hiện xây node document/section và có thể trả answer kèm evidence chunk IDs; truy vấn `locate`, miss, timeout hoặc lỗi quay về full retrieval. Direct-answer path bỏ qua BM25–FAISS, rerank, NLI và CRAG, nhưng vẫn đi qua ReviewGate khi HITL bật.

So sánh phải tách ba kết quả: Memory Tree hit và trả answer, Memory Tree miss/fallback, và full retrieval. Latency thấp hơn trên fast path, nếu quan sát được, không đủ để kết luận chất lượng tương đương. Cần chấm answer/evidence của từng path bằng cùng rubric.

`[TODO/NEED DATA]` Chưa có frozen Memory Tree R2 index hoặc E5/E6 outputs. Cần báo routing distribution, direct-answer rate, fallback reason, latency, QA quality và provenance completeness theo path. Evidence payload của direct-answer path cũng cần được xác minh end-to-end trên index nghiên cứu.

### 4.4.6. Phân tích lỗi truy hồi và fallback

Implementation đã định nghĩa các fallback có trạng thái: reranker lỗi giữ hybrid rank; NLI lỗi giữ tập sau rerank; Memory Tree lỗi chuyển sang full retrieval; grader lỗi fail-open theo việc evidence có rỗng hay không; rewrite lỗi dùng lại query hiện tại nhưng vẫn tiêu ngân sách. Node logs và evaluation trace cho phép phân biệt full, degraded và error paths.

`[TODO/NEED DATA]` Cần run traces để đếm từng fallback, xác định query/document liên quan và đánh giá chất lượng sau suy giảm. Việc fallback giúp request hoàn tất không đồng nghĩa output vẫn đúng hoặc faithful.

## 4.5. Đánh giá grounded QA và provenance

### 4.5.1. Độ đúng và faithfulness của câu trả lời

Mục tiêu là tách answer correctness khỏi faithfulness và context relevance. Một câu trả lời có thể đúng theo kiến thức ngoài nhưng không được evidence truy hồi hỗ trợ; ngược lại, một câu trả lời có thể bám context nhưng bỏ sót ý quan trọng. Protocol do đó giữ riêng gold answer, canonical evidence và system answer, đồng thời không dùng một điểm LLM judge duy nhất như ground truth tuyệt đối [13], [14], [35], [36].

Evaluation harness có thể xuất system answer và final evidence IDs cho từng query. Candidate review đã chuẩn bị answer/evidence aids, nhưng final `queries.jsonl` và canonical spans hiện rỗng.

`[TODO/NEED DATA]` Cần import gold answers/evidence, chạy E0–E7, xuất QA records và có human labels cho correctness, faithfulness, context relevance. Chưa có dữ liệu để báo bất kỳ điểm grounded QA nào.

### 4.5.2. Citation precision, citation recall và unsupported claims

Mục tiêu là kiểm tra quan hệ semantic giữa claim và evidence, không chỉ kiểm tra ID có tồn tại. Citation precision đo tỷ lệ citation thực sự hỗ trợ claim; citation recall/completeness đo mức các claim cần bằng chứng đã được dẫn đủ; unsupported claim rate đo claim cần kiểm chứng nhưng không được hỗ trợ [8], [9]. `quality_metrics.py` chỉ tổng hợp các human claim labels đã có, không tự phát minh hoặc tự phán evidence.

Runtime có source/chunk tags và frontend biến marker thành citation chip. Đây là implementation support cho truy vết, nhưng không phải kết quả citation correctness.

`[TODO/NEED DATA]` Cần system answers, claim segmentation, cited chunk IDs và human support labels trên frozen test set. Candidate citation review hiện là nhãn cho gói dữ liệu chuẩn bị, không phải citation do hệ thống sinh trong E0–E7.

### 4.5.3. So sánh provenance giữa cache, Memory Tree và full path

Ba answer path tạo provenance theo cơ chế khác nhau. Cache tái sử dụng payload và evaluation provenance của kết quả trước trong cùng namespace; Memory Tree xuất các chunk tham chiếu từ node phân cấp; full path gắn các chunk còn lại sau retrieval/refinement. Việc so sánh cần kiểm tra cả completeness của ID và semantic support của evidence.

`[TODO/NEED DATA]` Cần kích hoạt có kiểm soát từng path trên cùng query/source scope, xuất provenance records, kiểm tra chunk resolution và chấm claim support. Chưa có paired path outputs để so sánh.

### 4.5.4. Phân tích câu trả lời khi bằng chứng không đầy đủ

Protocol có ba nhóm liên quan: insufficient evidence, ambiguous và contradictory evidence. Runtime có thể từ chối khi hybrid không tìm thấy chunk hoặc khi CRAG heuristic adaptation kết thúc ở `wrong`; trường hợp `ambiguous` hết ngân sách vẫn sinh best-effort. Phân tích cần đánh giá refusal appropriateness, unsupported claims và mức giữ nguyên ý định sau rewrite.

`[TODO/NEED DATA]` Cần final labels cho ba strata, system outputs và human judgments về answerability/refusal. Không thể suy ra độ an toàn của fallback chỉ từ việc nhánh code tồn tại.

`[TODO/NEED DATA — Bảng 4.5]` Bảng grounded QA và provenance cần system outputs cùng human claim-level labels; hiện chưa có dữ liệu để lập bảng.

## 4.6. Đánh giá tóm tắt và mind map

### 4.6.1. Độ phủ, tính trung thành và dư thừa của tóm tắt

Summary pipeline đã hiện thực luồng section-first: thu thập input, xây section, tóm tắt từng section, tổng hợp toàn tài liệu, gắn pointer và lưu record. Rubric dự kiến chấm coverage, faithfulness, redundancy, section organization và provenance validity, phù hợp với yêu cầu tách chất lượng nội dung khỏi cấu trúc và nguồn [30]. Chế độ study có thể tạo key concepts, definitions, formulas, examples, common mistakes và self-check khi dữ liệu trung gian hỗ trợ.

Two-pass summary được nhắc trong một số thiết kế nhưng chưa nằm trên runtime baseline; nhánh tương ứng vẫn chưa được hiện thực. Vì vậy, Chương 4 chỉ đánh giá section-first baseline hiện có.

`[TODO/NEED DATA]` Chưa có system summaries trên frozen corpus hoặc rubric annotations cho chúng. Cần sinh summary với cấu hình cố định, chấm từng dimension, ghi degraded stages và kiểm tra pointer support. Ba candidate artifact records không phải kết quả summary runtime.

### 4.6.2. Độ đúng của cấu trúc phân cấp và quan hệ trong mind map

Mind-map pipeline đã hiện thực skeleton-first: tạo skeleton từ heading/Memory Tree/clusters, enrich theo nhánh, sinh relations, sanitize schema và persist. Rubric tách concept coverage, hierarchy correctness và relation correctness vì việc nhận diện concept không tự bảo đảm quan hệ cha–con hoặc liên kết chéo đúng [33]. Pipeline ghi `degraded` và `missing` khi một giai đoạn không hoàn thành.

Các utility CMGN/three-critic còn tồn tại trong repository nhưng không nằm trên runtime graph hiện tại, nên không được mô tả như baseline được đánh giá.

`[TODO/NEED DATA]` Chưa có mind maps được sinh từ frozen corpus và được reviewer chấm. Cần lưu output, model/config, node/edge provenance, degraded state và rubric scores; nếu đo stability, cần nhiều lần chạy với cùng input.

### 4.6.3. Khả năng truy vết từ artifact về chunk nguồn

Summary pointers và mind-map `chunk_refs` được xây từ metadata/chunk store thật. Frontend có thể mở Evidence Drawer bằng chunk ID. Điều này xác nhận đường truy vết kỹ thuật đã được hiện thực.

`[TODO/NEED DATA]` Cần kiểm tra tỷ lệ pointer resolve được và chấm liệu chunk đã trỏ có hỗ trợ summary sentence, node hoặc relation tương ứng. Pointer hợp lệ về ID không đồng nghĩa artifact được hỗ trợ về nội dung.

### 4.6.4. Phân tích trường hợp suy giảm của pipeline

Hai pipeline đều có cancel/error routing và có thể persist trạng thái degraded. Mind map có thể giữ skeleton khi enrich/relations thất bại; summary coverage judge, khi bật, chỉ chấm và không tự sửa nội dung. Đây là thiết kế quan sát được từ code.

`[TODO/NEED DATA]` Cần run logs và artifact outputs cho các trường hợp timeout, invalid JSON, missing stage, cancel và fallback. Phân tích phải so sánh artifact degraded với artifact đầy đủ thay vì xem việc tạo được file là thành công về chất lượng.

`[TODO/NEED DATA — Bảng 4.6]` Bảng summary và mind-map results cần rubric annotations trên artifacts do hệ thống sinh.

## 4.7. Đánh giá Human-in-the-Loop

### 4.7.1. Thiết kế nghiên cứu người duyệt

Runtime HITL của ứng dụng đặt ReviewGate sau mọi answer-producing path khi cờ được bật và checkpointer khả dụng. Graph có thể tạm dừng, giữ system draft và resume bằng một trong ba hành động approve, edit hoặc reject. Tuy nhiên, evaluation runner E7 hiện không gọi backend ReviewGate/resume; adapter chỉ gắn trạng thái `awaiting_real_human_review`, sau đó `evaluation.hitl` thu hành động bằng CLI ngoại tuyến. Fake reviewer bị cấm trong protocol, nhưng E7 hiện chưa phải phép đo end-to-end của runtime ReviewGate.

Nghiên cứu cần lưu cặp system draft/final answer, evidence hiển thị cho reviewer, hành động, nội dung chỉnh sửa, thời điểm bắt đầu/kết thúc và reviewer ID. Người chấm chất lượng trước–sau nên được tách khỏi người thực hiện edit khi có thể để giảm thiên lệch.

`[TODO/NEED CODE + DATA]` Cần quyết định E7 đánh giá chính runtime ReviewGate hay một quy trình post-edit ngoại tuyến. Nếu mục tiêu là runtime HITL như RQ5, cần nối runner với interrupt/resume, hiển thị evidence, lưu final answer và log reviewer theo protocol trước khi thu paired labels. Chưa có E7 drafts, runtime reviewer logs hoặc paired pre/post labels. Review export R1 là quy trình duyệt candidate dataset và không được thay thế dữ liệu này.

### 4.7.2. Tỷ lệ approve, edit và reject

Metric được định nghĩa trên các query đã đi qua runtime ReviewGate. Mẫu số phải là số draft hợp lệ được giao cho reviewer, không phải số candidate query trong quy trình tạo dataset.

`[TODO/NEED DATA]` Cần chạy E7 trên frozen test set và thu review actions. Không báo cáo 46 approve, 9 edit và 5 reject của review R1 ở đây vì chúng thuộc data curation.

### 4.7.3. Chất lượng trước và sau kiểm duyệt

So sánh trước–sau phải dùng cùng rubric QA/citation cho system draft và final answer. Các đại lượng phù hợp gồm change in correctness/faithfulness, unsupported claim rate và citation support. Edit magnitude chỉ cho biết mức thay đổi văn bản, không tự chứng minh chất lượng tăng.

`[TODO/NEED DATA]` Cần paired draft/final outputs và blind quality labels. Chưa có evidence để kết luận HITL làm tăng chất lượng hoặc giảm unsupported claims.

### 4.7.4. Thời gian, mức độ chỉnh sửa và độ nhất quán giữa người duyệt

Review time phải được tách khỏi machine latency. Agreement cần ít nhất một tập con được nhiều reviewer chấm cùng protocol; có thể báo raw agreement và một hệ số phù hợp với loại nhãn nếu protocol chốt trước [10], [11].

`[TODO/NEED DATA]` Chưa có timestamp runtime, edit distance, reviewer overlap hoặc adjudication logs. Cũng chưa có dữ liệu để đánh giá giới hạn hiện tại của resume qua reload/restart trên một nghiên cứu người dùng thực tế.

`[TODO/NEED DATA — Bảng 4.7]` Bảng chất lượng trước–sau HITL cần paired E7 drafts/final answers, actions, review time và blind quality labels.

## 4.8. Đánh giá hiệu năng và chi phí

### 4.8.1. Độ trễ theo từng giai đoạn

Evaluation trace đã định nghĩa các trường timing cho BM25, FAISS, fusion, rerank, NLI, từng corrective round, context building, generation, Memory Tree và tổng thời gian. Node logger trong runtime cũng lưu thời gian theo graph node. Hai nguồn này tạo cơ sở để phân rã latency trên benchmark cuối, nhưng chưa có research run để tổng hợp.

Repository có các phép đo vận hành lịch sử ngày 07/07/2026 trên một triển khai Ollama dùng CPU. Các báo cáo Phase 2–4 được tạo trong quá trình kiểm tra concurrency control, semantic cache, single-flight và overload protection. Chúng dùng một index nhỏ với một tài liệu và sáu chunk trong các baseline cuối; model khả dụng gồm qwen3.5:9b và một số model khác. Những phép đo này không dùng frozen research dataset, không phải E0–E7 và không được dùng để trả lời RQ1–RQ5.

**Bảng tham khảo 4.8-O. Một số phép đo vận hành lịch sử, không phải research benchmark**

| Báo cáo/ngữ cảnh | Workload | Kết quả quan sát trong báo cáo | Phạm vi diễn giải |
|---|---|---|---|
| Phase 2, cap=2 | 10 truy vấn distinct, cold | 6/10 hoàn tất; p50 256 giây; 10 generation | Phép đo giới hạn concurrency trên máy CPU cụ thể |
| Phase 2, cap=1 | 10 truy vấn distinct, cold | 9/10 hoàn tất; p50 76 giây; 6 generation, 4 truy vấn được semantic-coalesced | Không phải so sánh chất lượng retrieval |
| Phase 3, cap=1 + single-flight | 10 truy vấn identical, cold | 10/10 hoàn tất; 1 generation; p50 84 giây; p95 85 giây | Kiểm tra coalescing request trùng trong cấu hình lịch sử |
| Phase 4, cap=1 + single-flight | 50 truy vấn identical, cold | 50/50 hoàn tất; 1 generation; p50 xấp xỉ 3,0 giây; p95 xấp xỉ 70 giây | Client retry HTTP 429; không đại diện truy vấn đa dạng |

Nguồn: `phase2-gateway-semaphore.md`, `phase3-single-flight.md`, `phase4-overload-protection.md` và baseline `20260707-143610`. Các số trong bảng là kết quả được ghi tại thời điểm chạy lịch sử; chúng chưa được tái chạy trên working tree hiện tại.

Quan sát hẹp được phép rút ra là các cơ chế concurrency control và single-flight đã được đo trong những workload vận hành cụ thể, và báo cáo lịch sử ghi nhận một generation phục vụ nhiều truy vấn identical ở Phase 3–4. Không thể từ đó suy ra latency của benchmark nghiên cứu, lợi ích cho truy vấn distinct hoặc cải thiện chất lượng câu trả lời.

`[TODO/NEED DATA]` Cần chạy benchmark cuối trên frozen dataset và commit/config đã khóa; báo p50, p95, p99 theo query stratum và theo runtime path; tách machine latency khỏi review wait time; kèm hardware specification và error/fallback counts.

### 4.8.2. Số lần gọi mô hình, token và tài nguyên tính toán

Runtime có LLM-call counter theo node và gateway có structured logs cho thời gian chờ, acquire, release, timeout và generation. Evaluation trace có trường model calls và token khi provider trả về. Historical Phase 3–4 reports dùng node logs để đếm một `GenerateAnswer` execution trong các workload identical.

Các nguồn hiện tại không cung cấp token input/output đầy đủ cho mọi stage, mức dùng CPU/RAM/GPU chuẩn hóa hoặc chi phí tiền tệ theo query. Model chạy local qua Ollama cũng không có đơn giá API mặc định để suy ra chi phí tiền tệ.

`[TODO/NEED DATA]` Cần thu model calls và token theo stage cho từng research run, đo peak/mean CPU, RAM và GPU nếu có, rồi định nghĩa cách quy đổi chi phí. Nếu không có đơn giá phù hợp, chương chỉ nên báo tài nguyên và thời gian thay vì tạo chi phí tiền tệ giả định.

### 4.8.3. Cache hit, corrective rounds và fallback rate

Semantic cache, Memory Tree và full retrieval là ba đường loại trừ theo điều kiện, do đó tỷ lệ đường chạy phải được báo riêng. Trace cũng cần đếm exact/no-diacritic/semantic cache hit, Memory Tree direct answer, corrective rounds, CRAG refusal, rerank/NLI fallback và degraded artifact stages.

Historical load reports tập trung vào identical-query storms và không đại diện distribution của frozen test set. Số cache hit hoặc single-flight follower trong các run này chỉ mô tả workload vận hành đã chọn.

`[TODO/NEED DATA]` Cần aggregate path/fallback statistics từ E0–E7 trên cùng test set. Cache phải được tắt hoặc kiểm soát theo config khi mục tiêu là so sánh phương pháp, sau đó mới có một thí nghiệm riêng để đo lợi ích cache.

### 4.8.4. Sự đánh đổi giữa chất lượng và chi phí

Phân tích trade-off cần ghép metric chất lượng với latency, model calls, token, fallback và human effort trên cùng query. Một cấu hình nhanh hơn nhưng có nhiều unsupported claims không thể được mô tả là tốt hơn; tương tự, một cấu hình có điểm cao hơn nhưng chi phí tăng mạnh cần được báo đầy đủ.

`[TODO/NEED DATA]` Chưa có cặp quality–cost từ frozen runs và chưa có dữ liệu reviewer effort. Hình chất lượng–chi phí và mọi kết luận Pareto phải chờ E0–E7 cùng E7 review hoàn tất.

`[TODO/NEED DATA — Bảng 4.8]` Bảng latency, model calls, token và fallback rate chính thức cần frozen run traces; Bảng tham khảo 4.8-O không thay thế bảng này.

## 4.9. Thảo luận và trả lời câu hỏi nghiên cứu

### 4.9.1. Tổng hợp kết quả theo RQ1–RQ5

Tại thời điểm soạn thảo, không RQ nào có đủ benchmark để kết luận. Trạng thái chính xác như sau:

- **RQ1 — pending environment/data:** coordinate bridge và corpus freeze đã hoàn tất; R0–R2 indexes/qrels chưa có vì exact embedding checkpoint chưa load được trong môi trường khóa, và chưa có paired retrieval results.
- **RQ2 — pending data:** E0–E3 và production-aware evaluation adapter đã có, nhưng chưa có aggregate metrics hoặc error analysis.
- **RQ3 — pending data:** NLI, CRAG heuristic adaptation, query rewriting và trace schema đã có; ba contradiction pairs đã import nhưng chưa ánh xạ qua R2, và E4–E5 chưa chạy.
- **RQ4 — pending data:** QA/source tags, summary pointers và mind-map chunk refs đã hiện thực; chưa có claim/artifact support labels trên system outputs.
- **RQ5 — pending data:** runtime HITL, concurrency controls và historical operational measurements đã có; chưa có paired quality–cost–human-effort data từ E6/E7.

Do đó, Bảng tổng hợp RQ cuối chỉ được điền sau Phase 4C. Chương hiện không gán hướng tác động, mức cải thiện hoặc significance cho bất kỳ RQ nào.

`[TODO/NEED DATA — Bảng 4.9]` Bảng trả lời RQ1–RQ5 chỉ được tạo sau khi các evidence tương ứng ở 4.3–4.8 hoàn tất.

### 4.9.2. Ý nghĩa phương pháp luận của bằng chứng hiện có

Bằng chứng hiện tại cho thấy một phần thiết kế đánh giá đã được đưa xuống mức executable contracts. Candidate→final import, canonical coordinate bridge, corpus hash gate và targeted validation đã chạy; manifest và hash gates tiếp tục ngăn benchmark chạy trước khi dataset freeze. Tuy vậy, blocker môi trường embedding cùng các blocker về cô lập E2–E3, đánh giá artifact, quality annotation và E7 phải được giải quyết trước khi coi workflow hoàn chỉnh là executable.

Một ý nghĩa khác là provenance cần được đánh giá ở hai tầng. Tầng kỹ thuật xác nhận ID có thể resolve về chunk; tầng semantic xác nhận chunk có hỗ trợ claim, summary unit, node hoặc relation. Repository đã hỗ trợ tầng thứ nhất nhưng chưa có kết quả cho tầng thứ hai.

### 4.9.3. Phân tích trường hợp thành công và thất bại

Chưa có research outputs để lựa chọn success/failure cases đại diện. Implementation đã xác định các nhóm cần phân tích: relevant evidence bị bỏ trước rerank; NLI loại nhầm passage; query rewrite lệch ý định; CRAG heuristic adaptation hết ngân sách; Memory Tree trả answer thiếu support; cache tái sử dụng answer sai scope; summary bỏ sót section; mind map sai hierarchy/relation; và reviewer sửa hoặc reject draft.

`[TODO/NEED DATA]` Sau khi chạy benchmark, cần chọn case theo tiêu chí định trước, kèm original query, source scope, candidates qua từng stage, final evidence, answer/artifact, labels và fallback state. Không chọn chỉ các ví dụ thuận lợi.

### 4.9.4. Giới hạn hệ thống và giới hạn nghiên cứu

Giới hạn dữ liệu là ràng buộc lớn nhất. Candidate corpus chỉ có ba tài liệu eligible sơ bộ và phân bố miền không cân bằng; final ground truth và representation qrels chưa tồn tại. Điều này giới hạn statistical power và khả năng khái quát hóa ngay cả khi Phase 4C hoàn thành.

Giới hạn phương pháp gồm late chunking có điều kiện; Memory Tree chỉ dùng node document/section chứ không phải topic hierarchy đệ quy; weighted ensemble không luôn giữ đủ score từng kênh trên runtime path; NLI chỉ kiểm tra số cặp hữu hạn và không xét thẩm quyền/thời gian; CRAG heuristic adaptation chưa calibration; corrective loop giới hạn hai rewrite; và nhánh ambiguous có thể sinh best-effort. Các giới hạn này phải được giữ khi diễn giải kết quả sau này.

Giới hạn đầu ra gồm chưa có post-generation claim validator, pointer hợp lệ không chứng minh semantic support, two-pass summary chưa hiện thực và CMGN/three-critic không nằm trên mind-map runtime. HITL còn phụ thuộc metadata process-local, nên pending review không bền qua mọi reload/restart/multi-worker scenario.

Giới hạn triển khai gồm working tree chưa sạch, benchmark hardware chưa khóa và chưa có end-to-end research run qua toàn bộ Compose topology. Historical operational reports phản ánh các trạng thái code/cấu hình trước và không thể thay thế phép đo cuối.

### 4.9.5. Nguy cơ ảnh hưởng tính hợp lệ

**Internal validity** có thể bị ảnh hưởng nếu nhiều biến thay đổi cùng lúc, cache làm nhiễu latency/chất lượng, representation dùng corpus khác nhau hoặc threshold được tune trên test. Thiết kế namespaced index, fixed configs và development-only calibration nhằm giảm các nguy cơ này, nhưng cần được thực thi và lưu manifest.

**Construct validity** có thể bị ảnh hưởng nếu provenance ID được dùng thay citation support, success status được dùng thay quality hoặc LLM judge được xem là ground truth. Protocol đã tách các khái niệm này, nhưng human labels vẫn là dữ liệu bắt buộc.

**External validity** bị giới hạn bởi corpus nhỏ, một ngôn ngữ chính, miền hẹp và deployment CPU local. Kết quả, khi có, chỉ nên khái quát trong phạm vi corpus và cấu hình đã báo cáo.

**Conclusion validity** bị ảnh hưởng bởi strata ít mẫu và nhiều phép so sánh. Cần báo sample count, paired difference, confidence interval và tránh suy diễn significance từ mean đơn lẻ.

### 4.9.6. Khả năng khái quát hóa

Chưa có bằng chứng để kết luận phương pháp khái quát sang miền, ngôn ngữ, độ dài tài liệu hoặc hạ tầng khác. Proposed split có tài liệu AI/RAG ở cả development và test nhưng an toàn thông tin chỉ ở test, nên phân tích miền sẽ khó tách domain shift khỏi document-specific effects. Mọi phát biểu khái quát hóa cần chờ corpus lớn hơn hoặc một benchmark ngoài miền.

`[TODO/NEED DATA]` Cần bổ sung tài liệu thực, duy trì document-level split, tăng số query mỗi stratum và, nếu phạm vi nghiên cứu cho phép, chạy external hoặc out-of-domain evaluation.

## 4.10. Tổng kết chương

Chương 4 đã xác lập khung giao thức đánh giá cho năm câu hỏi nghiên cứu. Repository hiện có FULL METHOD v1, ma trận R0–R2 và E0–E7, annotation protocol, review export, evaluation harness, metric functions, reproducibility gates và trace schema; tuy nhiên, audit trước thực nghiệm xác định workflow chưa thể chạy end-to-end nếu chưa sửa các blocker đã nêu. Implementation của ứng dụng đã hỗ trợ các đường semantic cache, Memory Tree, full retrieval, summary, mind map và runtime HITL, nhưng evaluation harness chưa bao phủ đầy đủ mọi đường này.

Phần bằng chứng nghiên cứu chưa hoàn tất. Review R1 đã được import và corpus đã freeze, nhưng dataset chưa freeze cuối vì R0–R2/qrels chưa tồn tại; E0–E7 chưa chạy; system QA/artifact/HITL outputs chưa được chấm. Vì vậy, chương chưa đưa ra kết luận cho RQ1–RQ5 và giữ toàn bộ vị trí kết quả dưới nhãn `[TODO/NEED ...]` phù hợp với từng blocker.

Các phép đo concurrency ngày 07/07/2026 chỉ được trình bày như evidence vận hành lịch sử. Chúng cho biết một số cơ chế kiểm soát tải đã được đo trong workload cụ thể, nhưng không cung cấp bằng chứng về chất lượng retrieval, citation, artifact hoặc HITL. Bước tiếp theo để hoàn thiện chương là sửa các blocker được ghi trong audit, import và freeze dữ liệu, build representation indexes, chạy workflow Phase 4C đã cập nhật, thu human labels và thay các placeholder bằng kết quả có manifest.

# B. SỔ ĐĂNG KÝ CLAIM–EVIDENCE CỦA CHƯƠNG 4

| Claim trong chương | Evidence/source | Trạng thái |
|---|---|---|
| Repository đã có bốn graph ingest/query/summary/mind map | `BE/app/wiring.py`; `BE/app/graphs/*.py` | Supported by implementation |
| Evaluation harness dùng production retrieval components | `BE/evaluation/adapters.py` | Supported by implementation |
| FULL METHOD v1 và R0–R2/E0–E7 đã được cấu hình | `reports/evaluation/baseline_manifest.json`; `reports/evaluation/configs/*.yaml` | Supported by config |
| FULL METHOD v1 ghi model, threshold, budget và software versions được dùng làm protocol | `baseline_manifest.json` | Supported by manifest; hardware còn thiếu |
| Candidate corpus có 12 inventory/3 eligible và 60 candidate queries | `dataset_manifest.json`; `query_candidates.jsonl` | Supported; candidate status only |
| Review export R1 có 46 approve, 9 edit, 5 reject | `reviews/R1/export/human_review_summary.json` | Supported; data-curation review only |
| Review export đã complete và import gate đã materialize explicit approve/edit records | `human_review_summary.json`; `review_import_manifest.json`; final JSONL | Supported as data-curation state only |
| Final query/evidence/citation/contradiction/artifact files đã có record; qrels vẫn 0 | Final JSONL files trong `corpus_v1` | Supported by validation output; không phải system result |
| Corpus đã freeze nhưng dataset/final benchmark chưa authorized | `dataset_manifest.json`; `study_manifest.json`; coordinate/import manifests | Supported; còn thiếu R0–R2/qrels và dataset hash cuối |
| Không có R0–R2 index hợp lệ, `runs` hoặc `results` cho research evaluation | `reports/evaluation/` directory inventory; failed embedding preflight | Supported by repository inspection |
| Retrieval metrics dùng binary qrels và có bootstrap utilities | `BE/evaluation/metrics.py` | Supported by implementation |
| QA/citation/artifact metric functions cần human labels thay vì tự tạo evidence | `BE/evaluation/quality_metrics.py`; annotation protocols | Supported by implementation/protocol |
| Summary baseline là section-first; two-pass chưa hiện thực | `BE/app/graphs/summary_graph.py`; `BE/services/summary/pipeline/`; Chapter 3 runtime audit | Supported by implementation |
| Mind-map baseline là skeleton-first; CMGN/three-critic không ở runtime graph | `BE/app/graphs/mindmap_graph.py`; `BE/services/mindmap/pipeline/`; Chapter 3 runtime audit | Supported by implementation |
| Runtime HITL có ReviewGate và approve/edit/reject resume contract | `BE/app/graphs/query_graph.py`; `BE/app/main.py`; `HITL_PROTOCOL.md` | Supported by implementation/protocol; quality unmeasured |
| Runtime giữ provenance kỹ thuật bằng source/chunk pointers | Query attach-evidence, summary pointers, mind-map `chunk_refs`, frontend Evidence Drawer | Supported by implementation; semantic correctness unmeasured |
| Chương 3 ghi nhận một lần chạy mục tiêu 34/34 ngày 11/08/2026 | Chương 3, Bảng sự thật runtime và tự rà soát | Supported as historical software verification only |
| Historical Phase 2–4 measurements có các số ở Bảng tham khảo 4.8-O | `reports/performance/phase2-*.md`, `phase3-*.md`, `phase4-*.md`, baseline JSON/MD | Supported as historical operational evidence only |
| Chưa có metric RQ1–RQ5, QA/citation/artifact quality hoặc runtime HITL quality | Không có frozen run outputs/human system-output labels | Supported absence; marked TODO |

# C. DANH SÁCH [TODO/NEED DATA/CODE]

| Vị trí | Dữ liệu hoặc hành động còn thiếu |
|---|---|
| 4.2.2 | Import, coordinate validation và corpus freeze đã xong; giải quyết exact embedding environment, build R0–R2/qrels rồi freeze dataset để tạo hash cuối. |
| 4.2.4 | Ghi CPU, RAM, GPU, OS, Ollama, worker/concurrency và commit/content hash sạch của benchmark cuối. |
| 4.3.1 | Coordinate bridge đã xong; giải quyết exact embedding environment, build R0/R1, tạo qrels riêng, rồi mới chạy E3 và báo paired retrieval metrics. |
| 4.3.2 | Build R2, ghi per-document `late_chunking_applied`, chạy R1–R2 và báo metric/fallback theo cặp. |
| 4.3.3 | Hoàn tất query-stratum labels; bảo đảm hoặc công khai số mẫu mỗi stratum; phân tích R0–R2 theo stratum. |
| Bảng 4.4 | Lập bảng representation/retrieval sau khi paired R0–R2 và E0–E5 runs hoàn tất. |
| 4.4.1 | Chạy E0–E2 trên frozen test set; báo Recall@k, Precision@k, MRR, nDCG@k và lỗi theo stratum. |
| 4.4.2 | Wire fusion config vào adapter; thêm hybrid top-20 không rerank hoặc within-trace comparator để cô lập reranker; sau đó chạy paired comparison và source-tag sensitivity. |
| 4.4.3 | Import contradiction labels; xác nhận đủ cặp; chạy E3/E4; lập confusion matrix và phân tích false removal/retained contradiction. |
| 4.4.4 | Calibration CRAG heuristic adaptation trên development split; freeze config; chạy E4/E5; báo grade, rewrite, evidence delta, refusal/fallback và query drift. |
| 4.4.5 | Build Memory Tree trên frozen R2; chạy E5/E6; báo routing, direct-answer, fallback, latency, QA quality và provenance completeness. |
| 4.4.6 | Thu run traces cho mọi fallback; đếm theo query/document và chấm chất lượng sau suy giảm. |
| 4.5.1 | Import gold answers/evidence; xây system-output annotation export/import; chạy các cấu hình; chấm correctness, faithfulness và context relevance. |
| 4.5.2 | Segment system claims; lưu cited chunk IDs; lấy human claim–evidence support labels; tính citation metrics. |
| 4.5.3 | Kích hoạt có kiểm soát cache, Memory Tree và full path trên cùng scope; xuất và chấm paired provenance records. |
| 4.5.4 | Hoàn tất labels cho insufficient/ambiguous/contradictory strata; chấm answerability và refusal appropriateness. |
| Bảng 4.5 | Lập bảng grounded QA/provenance từ system outputs và human claim-level labels. |
| 4.6.1 | Xây artifact experiment runner/manifest và annotation workflow; sinh system summaries trên frozen corpus; chấm summary rubric, degraded stages và pointer support. |
| 4.6.2 | Xây artifact experiment runner/manifest và annotation workflow; sinh system mind maps; lưu model/config, node/edge provenance và degraded state; chấm rubric; lặp run nếu đo stability. |
| 4.6.3 | Đo pointer resolution và semantic support cho summary sentence, mind-map node và relation. |
| 4.6.4 | Thu logs/artifacts cho timeout, invalid JSON, missing stage, cancel và fallback; so sánh degraded/full outputs. |
| Bảng 4.6 | Lập bảng summary/mind-map từ rubric annotations trên system artifacts. |
| 4.7.1 | Chốt runtime ReviewGate hay offline post-edit; nếu đánh giá runtime HITL, xây E7 driver qua interrupt/resume rồi lưu system draft, final answer, evidence, action, reviewer và paired labels. |
| 4.7.2 | Tính approve/edit/reject trên runtime ReviewGate drafts, không dùng data-curation review counts. |
| 4.7.3 | Chấm blind paired draft/final outputs; tính quality delta và unsupported-claim change. |
| 4.7.4 | Thu review timestamps, edit magnitude, reviewer overlap, agreement và adjudication logs. |
| Bảng 4.7 | Lập bảng chất lượng trước–sau HITL từ paired E7 data. |
| 4.8.1 | Chạy performance measurement trên frozen dataset/locked commit; báo percentile theo stratum/path và tách review wait. |
| 4.8.2 | Thu model calls, tokens và CPU/RAM/GPU theo stage; chỉ quy đổi tiền khi có đơn giá xác định. |
| 4.8.3 | Aggregate cache/path/corrective/fallback statistics từ cùng test set; tách thí nghiệm cache khỏi method comparison. |
| 4.8.4 | Ghép quality với latency/model calls/tokens/fallback/human effort trên từng query; tạo quality–cost analysis. |
| Bảng 4.8 | Lập bảng latency/model-call/token/fallback chính thức từ frozen run traces. |
| 4.9.3 | Chọn success/failure cases theo tiêu chí định trước và lưu toàn bộ trace/evidence/label liên quan. |
| Bảng 4.9 | Tổng hợp câu trả lời RQ1–RQ5 sau khi evidence 4.3–4.8 hoàn tất. |
| 4.9.6 | Bổ sung tài liệu thực và query strata; chạy external/out-of-domain evaluation nếu muốn claim khái quát hóa. |
| Toàn chương | Chạy lại test suite trên working tree dùng cho benchmark và lưu test report; không dùng test như kết quả phương pháp. |

# D. KIỂM TRA NHẤT QUÁN VÀ TỰ RÀ SOÁT

## D.1. Claim–evidence và terminology

- [x] Không có số Recall@k, MRR, nDCG, QA, citation, artifact hoặc HITL quality được tạo khi chưa có run.
- [x] Candidate dataset review được tách khỏi runtime HITL evaluation.
- [x] Software tests và implementation existence không được dùng làm bằng chứng phương pháp tốt hơn.
- [x] Historical load measurements được ghi rõ không phải frozen research benchmark.
- [x] `source_id`/`chunk_id` được gọi là provenance kỹ thuật, không phải citation correctness.
- [x] Memory Tree không bị gọi là RAPTOR.
- [x] Runtime grader được gọi là CRAG heuristic adaptation hoặc bộ chấm lấy cảm hứng từ CRAG.
- [x] RQ1–RQ5 đều được ghi `pending data`, không có conclusion vượt evidence.
- [x] Citation học thuật chỉ tái sử dụng hệ thống nguồn [7]–[36] đã có ở Chương 2–3; không tạo nguồn mới.

## D.2. Reverse outline

- **4.1:** xác định câu hỏi, giả thuyết và ranh giới giữa verification với evaluation.
- **4.2:** mô tả candidate data, annotation, ablation, environment và metrics; chỉ rõ freeze gate.
- **4.3–4.7:** nêu mục tiêu, implementation support và dữ liệu còn thiếu cho từng nhóm đánh giá.
- **4.8:** tách operational evidence lịch sử khỏi research performance cần thu.
- **4.9:** tổng hợp observation được phép, giữ toàn bộ RQ ở trạng thái pending và nêu threats to validity.
- **4.10:** kết luận về trạng thái sẵn sàng của giao thức, không kết luận hiệu quả phương pháp.

## D.3. Năm câu hỏi tự rà soát

1. **Contribution:** Chương chỉ tuyên bố repository đã hiện thực phương pháp và protocol; chưa tuyên bố hiệu quả. Đạt.
2. **Writing clarity:** Mỗi phần tách mục tiêu, evidence hiện có, ý nghĩa và TODO. Đạt.
3. **Experimental strength:** Thiết kế có baseline, ablation, metrics, trace và freeze gates; dữ liệu chạy còn thiếu và đã nêu rõ. Chưa hoàn tất về thực nghiệm.
4. **Evaluation completeness:** RQ1–RQ5, QA, citation, artifact, HITL và cost đều đã có kế hoạch đo; chưa có frozen outputs. Chưa hoàn tất về dữ liệu.
5. **Method design soundness:** R0–R2 giữ biến kiểm soát ở mức protocol, nhưng E2–E3 hiện còn confound về candidate depth và một số fusion parameter chưa được wire từ config. Cần sửa trước Phase 4C; toàn bộ kết luận vẫn pending execution.
