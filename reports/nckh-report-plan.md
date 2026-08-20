# KẾ HOẠCH CẤU TRÚC BÁO CÁO NCKH — BẢN HIỆU CHỈNH ĐÃ DUYỆT

> Phạm vi: cấu trúc báo cáo, mục đích từng phần, ánh xạ câu hỏi nghiên cứu và kế hoạch hình/bảng.  
> Trạng thái: chưa viết nội dung dài của các chương.  
> Báo cáo có đúng bốn chương; **Kết luận và hướng phát triển** nằm ngoài bốn chương.

## 1. Mục lục bốn chương chính thức

# CHƯƠNG 1. TỔNG QUAN ĐỀ TÀI

## 1.1. Bối cảnh và lý do chọn đề tài

### 1.1.1. Nhu cầu khai thác tài liệu dài và dị thể
### 1.1.2. Giới hạn của biểu diễn tài liệu phẳng và truy hồi đơn giai đoạn
### 1.1.3. Yêu cầu về tính có căn cứ, khả năng truy vết và kiểm soát đầu ra

## 1.2. Phát biểu bài toán nghiên cứu

### 1.2.1. Đầu vào và không gian tài liệu
### 1.2.2. Các yêu cầu xử lý
### 1.2.3. Các đầu ra cần tạo lập và kiểm chứng

## 1.3. Mục tiêu nghiên cứu

### 1.3.1. Mục tiêu tổng quát
### 1.3.2. Mục tiêu cụ thể

## 1.4. Câu hỏi nghiên cứu

### 1.4.1. RQ1 — Ảnh hưởng của biểu diễn cấu trúc và late chunking

Biểu diễn nhận biết cấu trúc và late chunking có điều kiện ảnh hưởng như thế nào đến chất lượng truy hồi bằng chứng so với phân đoạn đệ quy và embedding từng đoạn độc lập?

### 1.4.2. RQ2 — Đóng góp của truy hồi lai, hợp nhất thứ hạng và reranking

Việc kết hợp BM25, FAISS, hợp nhất thứ hạng và cross-encoder reranking cải thiện chất lượng xếp hạng bằng chứng đến mức nào so với các cấu hình truy hồi đơn lẻ hoặc truy hồi lai chưa rerank?

### 1.4.3. RQ3 — Hiệu quả của NLI và corrective retrieval

NLI kết hợp CRAG và query rewriting có làm tăng mức đầy đủ, liên quan và nhất quán của bằng chứng đối với truy vấn mơ hồ, thiếu bằng chứng hoặc có nguồn mâu thuẫn hay không?

### 1.4.4. RQ4 — Khả năng bảo toàn provenance của các sản phẩm sinh

Các pipeline QA, tóm tắt section-first và mind map skeleton-first bảo toàn khả năng truy vết từ nội dung sinh về đoạn tài liệu nguồn ở mức nào?

### 1.4.5. RQ5 — Sự đánh đổi giữa chất lượng, chi phí và HITL

Full pipeline và HITL tạo ra sự đánh đổi như thế nào giữa chất lượng đầu ra, tỷ lệ khẳng định không được hỗ trợ, độ trễ, chi phí mô hình và công sức người duyệt?

## 1.5. Đối tượng, phạm vi và giới hạn nghiên cứu

### 1.5.1. Đối tượng nghiên cứu
### 1.5.2. Phạm vi dữ liệu và chức năng
### 1.5.3. Phạm vi phương pháp và triển khai
### 1.5.4. Các giới hạn của nghiên cứu hiện tại

## 1.6. Phương pháp nghiên cứu

### 1.6.1. Nghiên cứu tài liệu và tổng hợp cơ sở lý thuyết
### 1.6.2. Phân tích, thiết kế và hiện thực phương pháp
### 1.6.3. Thiết kế thực nghiệm, so sánh và ablation
### 1.6.4. Đánh giá định lượng, định tính và đánh giá người dùng

## 1.7. Đóng góp của đề tài

### 1.7.1. Đóng góp về phương pháp
### 1.7.2. Đóng góp về kỹ thuật
### 1.7.3. Ranh giới của tuyên bố đóng góp

## 1.8. Cấu trúc báo cáo

# CHƯƠNG 2. CƠ SỞ LÝ THUYẾT VÀ CÁC NGHIÊN CỨU LIÊN QUAN

## 2.1. Biểu diễn và khai thác tài liệu dài

### 2.1.1. Đặc trưng của tài liệu dài và dị thể
### 2.1.2. Mất mát cấu trúc và ngữ cảnh khi xử lý tài liệu
### 2.1.3. Yêu cầu biểu diễn đa mức

## 2.2. Phân đoạn và biểu diễn đoạn tài liệu

### 2.2.1. Phân đoạn cố định, đệ quy và ngữ nghĩa
### 2.2.2. Phân đoạn nhận biết cấu trúc
### 2.2.3. Late chunking và biểu diễn đoạn trong ngữ cảnh rộng
### 2.2.4. Embedding văn bản và biểu diễn vector

## 2.3. Các phương pháp truy hồi thông tin

### 2.3.1. Truy hồi thưa và BM25
### 2.3.2. Truy hồi dày và tìm kiếm vector
### 2.3.3. Truy hồi lai lexical–semantic
### 2.3.4. Hợp nhất thứ hạng bằng Reciprocal Rank Fusion

## 2.4. Truy hồi phân cấp và Retrieval-Augmented Generation

### 2.4.1. Biểu diễn và truy hồi ở nhiều độ phân giải
### 2.4.2. Retrieval-Augmented Generation
### 2.4.3. Các nguồn sai số trong pipeline RAG
### 2.4.4. Semantic cache và cơ chế trả lời nhanh

## 2.5. Tinh lọc và hiệu chỉnh bằng chứng

### 2.5.1. Cross-encoder reranking
### 2.5.2. Natural Language Inference và phát hiện mâu thuẫn
### 2.5.3. Đánh giá chất lượng bằng chứng và Corrective RAG
### 2.5.4. Query rewriting và truy hồi hiệu chỉnh hữu hạn

## 2.6. Sinh nội dung có căn cứ và sự tham gia của con người

### 2.6.1. Grounded generation
### 2.6.2. Provenance, citation và khả năng truy vết
### 2.6.3. Human-in-the-Loop trong hệ thống sinh nội dung

## 2.7. Sinh sản phẩm tri thức có cấu trúc

### 2.7.1. Tóm tắt tài liệu dài và tóm tắt phân cấp
### 2.7.2. Tóm tắt theo cấu trúc section-first
### 2.7.3. Biểu diễn tri thức dạng cây và sơ đồ tư duy
### 2.7.4. Sinh cấu trúc skeleton-first và làm giàu có ràng buộc

## 2.8. Cơ sở đánh giá phương pháp

### 2.8.1. Đánh giá chất lượng truy hồi
### 2.8.2. Đánh giá grounded QA và citation
### 2.8.3. Đánh giá tóm tắt và sơ đồ tư duy
### 2.8.4. Đánh giá HITL, hiệu năng và chi phí

## 2.9. Tổng hợp nghiên cứu liên quan và khoảng trống nghiên cứu

### 2.9.1. Các hướng biểu diễn và truy hồi tài liệu dài
### 2.9.2. Các hướng evidence-aware và corrective RAG
### 2.9.3. Các hướng sinh sản phẩm tri thức có provenance
### 2.9.4. Hạn chế của các cách tiếp cận hiện có
### 2.9.5. Vị trí của phương pháp được đề xuất

## 2.10. Tổng kết chương

# CHƯƠNG 3. PHƯƠNG PHÁP ĐỀ XUẤT VÀ XÂY DỰNG HỆ THỐNG

## 3.1. Tổng quan phương pháp đề xuất

### 3.1.1. Phát biểu hình thức của bài toán
### 3.1.2. Quy trình trí tuệ tài liệu đa tầng
### 3.1.3. Ba đường xử lý truy vấn

- Semantic-cache fast path.
- Memory Tree direct-answer fast path.
- Full evidence-retrieval path.

### 3.1.4. Nguyên tắc bảo toàn bằng chứng và suy giảm có kiểm soát

## 3.2. Tiếp nhận và biểu diễn tài liệu

### 3.2.1. Trích xuất và chuẩn hóa tài liệu dị thể
### 3.2.2. Phân đoạn nhận biết cấu trúc
### 3.2.3. Metadata và định danh nguồn–đoạn
### 3.2.4. Late chunking có điều kiện
### 3.2.5. Embedding và xây dựng chỉ mục đoạn

## 3.3. Biểu diễn phân cấp và Memory Tree

### 3.3.1. Biểu diễn ở mức tài liệu, mục và đoạn
### 3.3.2. Xây dựng chỉ mục Memory Tree
### 3.3.3. Phân loại truy vấn và truy hồi node
### 3.3.4. Cơ chế trả lời trực tiếp và điều kiện chuyển sang full retrieval
### 3.3.5. Giới hạn của biểu diễn phân cấp hiện tại

## 3.4. Phương pháp truy hồi bằng chứng nhiều giai đoạn

### 3.4.1. Truy hồi lai BM25–FAISS
### 3.4.2. Hợp nhất thứ hạng
### 3.4.3. Tái xếp hạng bằng cross-encoder
### 3.4.4. Kiểm tra mâu thuẫn bằng NLI
### 3.4.5. Đánh giá chất lượng bằng chứng bằng CRAG heuristic
### 3.4.6. Query rewriting và corrective retrieval
### 3.4.7. Ngân sách hiệu chỉnh và điều kiện dừng
### 3.4.8. Fallback và suy giảm có kiểm soát

## 3.5. Xây dựng ngữ cảnh và sinh câu trả lời có căn cứ

### 3.5.1. Lựa chọn và ghép tập bằng chứng
### 3.5.2. Bảo toàn truy vấn gốc sau quá trình hiệu chỉnh
### 3.5.3. Grounded answer generation
### 3.5.4. Gắn nguồn, chunk và provenance
### 3.5.5. Semantic cache và vòng đời kết quả
### 3.5.6. Giới hạn của cơ chế kiểm chứng citation hiện tại

## 3.6. Human-in-the-Loop

### 3.6.1. Phân biệt câu trả lời hệ thống và câu trả lời cuối
### 3.6.2. ReviewGate và trạng thái tạm dừng
### 3.6.3. Các hành động approve, edit và reject
### 3.6.4. Resume và lưu trạng thái kiểm duyệt
### 3.6.5. Giới hạn của HITL khi reload, restart và nhiều worker

## 3.7. Sinh sản phẩm tri thức có cấu trúc

### 3.7.1. Phương pháp tóm tắt section-first
### 3.7.2. Tổng hợp cấp tài liệu và bảo toàn con trỏ bằng chứng
### 3.7.3. Phương pháp sinh mind map skeleton-first
### 3.7.4. Làm giàu nhánh và xây dựng quan hệ có kiểm soát
### 3.7.5. Cơ chế fallback và giới hạn của các pipeline sinh artifact

## 3.8. Kiến trúc và hiện thực hệ thống

### 3.8.1. Kiến trúc logic và điều phối bằng graph
### 3.8.2. Giao tiếp frontend, backend và dịch vụ mô hình
### 3.8.3. Thiết kế lưu trữ và vòng đời dữ liệu
### 3.8.4. Xử lý bất đồng bộ, checkpoint, SSE và polling
### 3.8.5. Cấu hình full pipeline và cấu hình ablation
### 3.8.6. Kiến trúc triển khai, khả năng quan sát và giới hạn vận hành

## 3.9. Tổng kết chương

# CHƯƠNG 4. THỰC NGHIỆM, ĐÁNH GIÁ VÀ THẢO LUẬN

> Nếu chưa thu thập đủ dữ liệu nghiên cứu, chương này phải được ghi rõ là **giao thức đánh giá đề xuất**, không trình bày số liệu giả định như kết quả thực nghiệm.

## 4.1. Mục tiêu thực nghiệm và giả thuyết nghiên cứu

### 4.1.1. Mục tiêu đánh giá theo năm câu hỏi nghiên cứu
### 4.1.2. Các giả thuyết cần kiểm chứng
### 4.1.3. Phân biệt xác minh phần mềm và đánh giá phương pháp

## 4.2. Thiết kế thực nghiệm

### 4.2.1. Bộ tài liệu và phân tầng loại truy vấn
### 4.2.2. Gán nhãn relevance, evidence, answer và artifact
### 4.2.3. Baseline và cấu hình ablation
### 4.2.4. Môi trường, mô hình và tham số
### 4.2.5. Metrics, quy trình đo và khả năng tái lập

## 4.3. Đánh giá biểu diễn và phân đoạn tài liệu

### 4.3.1. Recursive chunking và structure-aware chunking
### 4.3.2. Ảnh hưởng của late chunking
### 4.3.3. Phân tích theo loại tài liệu và loại truy vấn

## 4.4. Đánh giá truy hồi bằng chứng nhiều giai đoạn

### 4.4.1. BM25-only, FAISS-only và hybrid retrieval
### 4.4.2. Ảnh hưởng của rank fusion và cross-encoder reranking
### 4.4.3. Hiệu quả phát hiện mâu thuẫn của NLI
### 4.4.4. Hiệu quả của CRAG và query rewriting
### 4.4.5. Memory Tree fast path và full retrieval path
### 4.4.6. Phân tích lỗi truy hồi và fallback

## 4.5. Đánh giá grounded QA và provenance

### 4.5.1. Độ đúng và faithfulness của câu trả lời
### 4.5.2. Citation precision, citation recall và unsupported claims
### 4.5.3. So sánh provenance giữa cache, Memory Tree và full path
### 4.5.4. Phân tích câu trả lời khi bằng chứng không đầy đủ

## 4.6. Đánh giá tóm tắt và sơ đồ tư duy

### 4.6.1. Độ phủ, tính trung thành và dư thừa của tóm tắt
### 4.6.2. Độ đúng của cấu trúc phân cấp và quan hệ trong mind map
### 4.6.3. Khả năng truy vết từ artifact về chunk nguồn
### 4.6.4. Phân tích trường hợp suy giảm của pipeline

## 4.7. Đánh giá Human-in-the-Loop

### 4.7.1. Thiết kế nghiên cứu người duyệt
### 4.7.2. Tỷ lệ approve, edit và reject
### 4.7.3. Chất lượng trước và sau kiểm duyệt
### 4.7.4. Thời gian, mức độ chỉnh sửa và độ nhất quán giữa người duyệt

## 4.8. Đánh giá hiệu năng và chi phí

### 4.8.1. Độ trễ theo từng giai đoạn
### 4.8.2. Số lần gọi mô hình, token và tài nguyên tính toán
### 4.8.3. Cache hit, corrective rounds và fallback rate
### 4.8.4. Sự đánh đổi giữa chất lượng và chi phí

## 4.9. Thảo luận và trả lời câu hỏi nghiên cứu

### 4.9.1. Tổng hợp kết quả theo RQ1–RQ5
### 4.9.2. Ý nghĩa phương pháp luận của kết quả
### 4.9.3. Phân tích trường hợp thành công và thất bại
### 4.9.4. Giới hạn hệ thống và giới hạn nghiên cứu
### 4.9.5. Nguy cơ ảnh hưởng tính hợp lệ
### 4.9.6. Khả năng khái quát hóa

## 4.10. Tổng kết chương

# KẾT LUẬN VÀ HƯỚNG PHÁT TRIỂN

Phần này nằm ngoài bốn chương, không đánh số thành Chương 5.

---

## 2. Mục đích của từng mục lớn

### Chương 1

| Mục | Mục đích |
|---|---|
| 1.1 | Xác lập nhu cầu nghiên cứu từ khó khăn của tài liệu dài, retrieval errors và đầu ra thiếu kiểm soát. |
| 1.2 | Xác định input, yêu cầu xử lý và output thay vì mô tả sản phẩm chung chung. |
| 1.3 | Chuyển vấn đề thành các mục tiêu có thể kiểm chứng. |
| 1.4 | Thiết lập năm câu hỏi xuyên suốt Chương 3 và Chương 4. |
| 1.5 | Giới hạn đối tượng, dữ liệu, phương pháp và các tuyên bố có thể đưa ra. |
| 1.6 | Trình bày cách nghiên cứu được tiến hành từ khảo cứu đến thực nghiệm. |
| 1.7 | Phân biệt đóng góp tích hợp phương pháp với đóng góp kỹ thuật và tuyên bố tính mới. |
| 1.8 | Giải thích logic Problem → Theory → Method → Evaluation. |

### Chương 2

| Mục | Mục đích |
|---|---|
| 2.1 | Giải thích vì sao tài liệu dài cần biểu diễn đa mức. |
| 2.2 | Cung cấp cơ sở cho structure-aware chunking, late chunking và embedding. |
| 2.3 | Làm rõ ưu, nhược điểm của sparse, dense và hybrid retrieval. |
| 2.4 | Cung cấp cơ sở cho Memory Tree, RAG và các fast path. |
| 2.5 | Giải thích vai trò khác nhau của reranker, NLI, CRAG và query rewriting. |
| 2.6 | Cung cấp nền tảng cho grounded generation, provenance và HITL. |
| 2.7 | Làm cơ sở cho section-first summary và skeleton-first mind map. |
| 2.8 | Xác định metrics và nguyên tắc đánh giá dùng trong Chương 4. |
| 2.9 | Tổng hợp các họ phương pháp và xác định khoảng trống nghiên cứu. |
| 2.10 | Kết nối lý thuyết với phương pháp đề xuất. |

### Chương 3

| Mục | Mục đích |
|---|---|
| 3.1 | Định nghĩa phương pháp và ba nhánh query, tránh mô tả sai mọi query đều qua full pipeline. |
| 3.2 | Giải thích cách tài liệu được chuyển thành chunk có cấu trúc và truy vết được. |
| 3.3 | Trình bày representation phân cấp và direct-answer fast path của Memory Tree. |
| 3.4 | Trình bày lõi retrieval, refinement, contradiction checking và corrective loop. |
| 3.5 | Nối evidence retrieval với context, generation và provenance. |
| 3.6 | Mô hình hóa quá trình từ system draft đến human-reviewed final answer. |
| 3.7 | Trình bày summary/mind map ở vai trò hỗ trợ lõi nghiên cứu. |
| 3.8 | Chứng minh phương pháp đã được hiện thực; gom architecture, storage, async và deployment. |
| 3.9 | Tổng hợp quyết định phương pháp và chuẩn bị cho evaluation. |

### Chương 4

| Mục | Mục đích |
|---|---|
| 4.1 | Xác định mục tiêu và tách software verification khỏi research evaluation. |
| 4.2 | Cố định dataset, annotation, baseline, metrics và điều kiện tái lập. |
| 4.3 | Kiểm định đóng góp của representation và chunking. |
| 4.4 | Kiểm định retrieval stages, corrective loop và fast-path routing. |
| 4.5 | Đánh giá correctness, faithfulness và provenance của QA. |
| 4.6 | Đánh giá summary và mind map bằng tiêu chí phù hợp từng artifact. |
| 4.7 | Đo tác động HITL thay vì dùng retrieval metrics thay thế. |
| 4.8 | Đo chi phí tính toán và đánh đổi quality–performance. |
| 4.9 | Tổng hợp bằng chứng, trả lời RQ và trình bày threats to validity. |
| 4.10 | Tóm lược mức độ các mục tiêu đã được kiểm chứng. |

## 3. Ánh xạ RQ → Chương 4

| RQ | Nội dung | Mục đánh giá chính | Mục bổ trợ |
|---|---|---|---|
| RQ1 | Structure-aware representation và late chunking | 4.3 | 4.5.2, 4.8 |
| RQ2 | BM25, FAISS, fusion và reranker | 4.4.1–4.4.2 | 4.5, 4.8 |
| RQ3 | NLI, CRAG và query rewriting | 4.4.3–4.4.4 | 4.5.4, 4.8.3 |
| RQ4 | Provenance của QA, summary và mind map | 4.5.2–4.5.3, 4.6.3 | 4.4.5 |
| RQ5 | Chất lượng, chi phí và HITL | 4.7–4.8 | 4.9.1, 4.9.4 |

Mỗi RQ được kết luận tập trung tại Mục 4.9.1 sau khi tổng hợp bằng chứng từ các thí nghiệm tương ứng.

## 4. Kế hoạch hình chính thức

| Hình | Tiêu đề đề xuất | Mục đích | Vị trí |
|---|---|---|---|
| Hình 1.1 | Bài toán khai thác tài liệu dài có kiểm soát bằng chứng | Diễn tả vấn đề nghiên cứu | 1.2 |
| Hình 3.1 | Tổng quan quy trình trí tuệ tài liệu đa tầng | Ba lớp representation, evidence processing và generation/review | 3.1 |
| Hình 3.2 | Quy trình tiếp nhận và biểu diễn tài liệu | Extract → normalize → chunks → embedding → index | 3.2 |
| Hình 3.3 | Biểu diễn phân cấp chunk–section–document | Chunk index và Memory Tree | 3.3 |
| Hình 3.4 | Kiến trúc truy hồi bằng chứng nhiều giai đoạn | Hybrid → fusion → rerank → NLI → CRAG → rewrite loop | 3.4 |
| Hình 3.5 | Định tuyến semantic cache, Memory Tree và full retrieval | Thể hiện đúng ba runtime paths | 3.1.3 hoặc 3.3.4 |
| Hình 3.6 | Vòng đời Human-in-the-Loop | Draft → interrupt → decision → resume → final | 3.6 |
| Hình 3.7 | Pipeline sinh sản phẩm tri thức có cấu trúc | Section-first summary và skeleton-first mind map | 3.7 |
| Hình 3.8 | Kiến trúc hiện thực và triển khai | Frontend, backend, graphs, services, Redis và stores | 3.8 |
| Hình 4.1 | Thiết kế đánh giá | Dataset → configurations → metrics → analysis | 4.2 |
| Hình 4.2 | Ma trận ablation | Representation, retrieval và HITL groups | 4.2.3 |
| Hình 4.3 | Sự đánh đổi chất lượng–chi phí | Chỉ tạo sau khi có dữ liệu | 4.8–4.9 |

Hình 3.4 chỉ mô tả full retrieval path; Hình 3.5 chịu trách nhiệm thể hiện toàn bộ routing và các fast path.

## 5. Kế hoạch bảng chính thức

| Bảng | Tiêu đề đề xuất | Vị trí |
|---|---|---|
| Bảng 1.1 | Mục tiêu, RQ và loại bằng chứng cần thu thập | 1.3–1.4 |
| Bảng 1.2 | Đối tượng, phạm vi và out-of-scope | 1.5 |
| Bảng 2.1 | So sánh chiến lược chunking và representation | 2.2 |
| Bảng 2.2 | Sparse, dense, hybrid và hierarchical retrieval | 2.3–2.4 |
| Bảng 2.3 | Vai trò của reranker, NLI, CRAG và query rewriting | 2.5 |
| Bảng 2.4 | Tổng hợp related work và research gap | 2.9 |
| Bảng 3.1 | Research challenge, design decision và mechanism | 3.1 |
| Bảng 3.2 | Representation layer, purpose, storage và retrieval role | 3.2–3.3 |
| Bảng 3.3 | Retrieval stage, input, output, status và fallback | 3.4 |
| Bảng 3.4 | Semantic cache, Memory Tree và full retrieval path | 3.1.3 |
| Bảng 3.5 | System draft, HITL decision và final answer | 3.6 |
| Bảng 3.6 | Implementation components và storage | 3.8 |
| Bảng 4.1 | Dataset và query strata | 4.2.1 |
| Bảng 4.2 | Baseline và ablation configurations | 4.2.3 |
| Bảng 4.3 | Metrics, definitions và RQ mapping | 4.2.5 |
| Bảng 4.4 | Representation và retrieval results | 4.3–4.4 |
| Bảng 4.5 | Grounded QA và provenance results | 4.5 |
| Bảng 4.6 | Summary và mind-map results | 4.6 |
| Bảng 4.7 | Chất lượng trước và sau HITL | 4.7 |
| Bảng 4.8 | Latency, model calls, token và fallback rate | 4.8 |
| Bảng 4.9 | Tổng hợp câu trả lời RQ1–RQ5 | 4.9 |

Các bảng kết quả 4.4–4.9 chỉ được tạo sau khi có dữ liệu thực nghiệm thật.

## 6. Các xung đột cần kiểm soát trong cấu trúc đã sửa

1. **Fast path và full method:** Memory Tree và semantic cache là các nhánh thay thế, không phải hai stage luôn đứng trước hybrid retrieval.
2. **Memory Tree trong ablation:** không được mô tả “full retrieval + Memory Tree” như phép cộng tuần tự; phải đánh giá theo routing rate, answer quality và latency.
3. **RRF và ensemble:** runtime mặc định dùng weighted `EnsembleRetriever`; manual RRF là nhánh thay thế. Không dùng một công thức để tuyên bố hai đường hoàn toàn giống nhau.
4. **CRAG:** grader hiện tại là heuristic với ngưỡng chưa được tối ưu thực nghiệm; cần gọi là cách điều chỉnh CRAG.
5. **NLI:** chính sách chỉ xét số cặp hữu hạn và giữ evidence có rank cao hơn; không phải cơ chế đánh giá độ tin cậy nguồn.
6. **Provenance và citation:** hệ thống gắn source/chunk nhưng chưa có post-generation claim-level citation validator.
7. **Source tags:** tag được đưa vào chuỗi trước rerank/NLI; ảnh hưởng đến scoring chưa được đánh giá.
8. **HITL:** system answer và human-reviewed final answer phải được đánh giá riêng; approve/edit/reject không tự chứng minh cải thiện.
9. **Resume:** checkpoint có lưu nhưng metadata vẫn một phần process-local; reload, restart và multi-worker còn hạn chế.
10. **Artifact pipelines:** summary/mind map quan trọng nhưng không được làm lu mờ lõi representation–retrieval–correction.
11. **Chương 4 chưa có kết quả:** hiện chỉ có thể viết evaluation protocol cho đến khi có dataset, annotations và measurements.
12. **Software tests không thay research evaluation:** backend/frontend tests, model smoke và build chỉ xác nhận kỹ thuật.
13. **Late chunking có điều kiện:** bật cấu hình không có nghĩa mọi tài liệu đều đi qua late chunking; RQ1 cần reindex từng cấu hình.
14. **Giới hạn triển khai:** Docker E2E, reverse-proxy SSE, restart-resume, production citation và multi-worker HITL chưa được xác minh.
15. **Memory Tree provenance:** direct-answer payload và API evidence attachment chưa đồng nhất hoàn toàn, cần kiểm chứng E2E trên index thực.
16. **Semantic cache:** cache hit bỏ qua retrieval stages nhưng vẫn qua HITL; policy cache đối với reject answer cần được kiểm tra.
17. **CRAG calibration:** grader dùng điểm lexical và rerank score biến đổi sigmoid; thresholds chưa được học hoặc hiệu chuẩn.
18. **Summary/mind-map limitations:** summary two-pass chưa hiện thực; coverage judge tùy chọn; CMGN/three-critic không thuộc runtime mind-map pipeline.
19. **Document limitations:** OCR ảnh có hiện thực nhưng chưa đủ bằng chứng OCR chuyên biệt cho PDF scan; Memory Tree hiện chỉ có document/section.
20. **Deployment configuration:** frontend Compose API base, nginx proxy và Node/Vite version còn dấu hiệu chưa nhất quán; không tuyên bố production deployment đã được xác minh.

