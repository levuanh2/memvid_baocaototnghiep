# Tổng hợp bằng chứng liên lĩnh vực

## 1. Các điểm đồng thuận

1. **Phân đoạn là một biến thiết kế của truy hồi.** Late Chunking và nghiên cứu về document segmentation đều cho thấy cách xác định biên và ngữ cảnh của đoạn ảnh hưởng trực tiếp tới biểu diễn và xếp hạng. Không có chiến lược duy nhất tốt cho mọi độ dài và miền dữ liệu.
2. **Truy hồi thưa và đặc có tính bổ sung.** BM25 là baseline bền vững trên BEIR; dense retrieval cải thiện khả năng khớp ngữ nghĩa nhưng không thắng phổ quát. Rank fusion và reranking là các tầng khác nhau: fusion kết hợp danh sách, cross-encoder chấm lại cặp truy vấn–đoạn với chi phí lớn hơn.
3. **RAG không tự bảo đảm groundedness.** RAG đưa tri thức ngoài vào quá trình sinh, nhưng RAGTruth và ALCE cho thấy câu trả lời vẫn có thể thiếu hỗ trợ, mâu thuẫn hoặc có citation không đầy đủ.
4. **Hiệu chỉnh phải phụ thuộc chất lượng bằng chứng.** CRAG nguyên gốc đưa evaluator trước generation và chọn hành động theo Correct/Incorrect/Ambiguous. Query expansion/rewrite có thể cải thiện recall, nhưng cũng có thể làm trôi ý định; vì vậy truy vấn gốc cần được bảo toàn.
5. **Đánh giá phải tách tầng.** BEIR/nDCG đánh giá truy hồi; ALCE đánh giá citation; ARES/RAGAS tách context relevance, answer faithfulness và answer relevance. Unit tests chỉ xác nhận hành vi phần mềm.
6. **Tóm tắt dài cần phân rã nhưng có rủi ro truyền lỗi.** SummN và các phương pháp phân cấp giảm áp lực giới hạn ngữ cảnh, song chất lượng kết quả cuối phụ thuộc các bản tóm tắt trung gian.
7. **Human-in-the-Loop là cơ chế quản trị, không phải bộ tăng điểm retrieval.** Nghiên cứu human-centered AI nhấn mạnh khả năng xem xét, sửa và từ chối; tác động phải được đo bằng chất lượng sau duyệt, thời gian và tỷ lệ can thiệp.

## 2. Các điểm cần phân biệt hoặc còn tranh luận

- **Long context so với retrieval:** LongBench/Lost in the Middle cho thấy mở rộng cửa sổ không tự giải quyết việc định vị bằng chứng. Late chunking tận dụng context dài cho embedding, nhưng vẫn cần ranh giới đoạn và có trường hợp không vượt naive chunking.
- **Hierarchical retrieval:** RAPTOR dùng cây đệ quy từ clustering và abstractive summaries; Memory Tree của dự án dùng document/section nodes và là answer fast path. Hai cơ chế cùng họ tư tưởng nhưng khác thuật toán.
- **CRAG:** paper gốc dùng learned evaluator, knowledge refinement và web search; dự án dùng heuristic grader, truy hồi lại kho nội bộ và bounded rewrite. Chỉ nên gọi là “cơ chế truy hồi hiệu chỉnh lấy cảm hứng từ CRAG”.
- **NLI:** SNLI/MultiNLI/XNLI thiết lập suy luận quan hệ câu; việc dùng NLI để loại bỏ đoạn xung đột trong RAG là một chính sách bổ sung. Chính sách dự án loại đoạn xếp hạng thấp hơn, chưa dựa trên uy tín nguồn hay thời gian.
- **LLM-as-a-judge:** G-Eval/MT-Bench cho thấy tiềm năng tương quan với người, nhưng các nghiên cứu sau ghi nhận position, verbosity và self-enhancement biases. Judge tự động cần hiệu chỉnh và kiểm tra người.

## 3. Vị trí nghiên cứu phù hợp cho dự án

Dự án nên được định vị là **sự tích hợp và thích nghi một quy trình trí tuệ tài liệu đa tầng, có nhận biết cấu trúc và bảo toàn bằng chứng**, gồm ba nhánh: QA có truy hồi hiệu chỉnh và duyệt người; tóm tắt section-first; mind map skeleton-first. Đóng góp phương pháp có thể nằm ở thiết kế tích hợp và chính sách routing/fallback/provenance trong cùng hệ thống. Chưa có bằng chứng để gọi đây là thuật toán hoàn toàn mới hoặc khẳng định ưu thế định lượng.

## 4. Hệ quả đối với thiết kế thực nghiệm

- Chia thí nghiệm thành retrieval, generation/grounding, artifacts, HITL và systems performance.
- So sánh representation cần tái lập chỉ mục và giữ nguyên corpus/query/qrels.
- Ablation retrieval phải phân biệt các cấu hình thực thi trực tiếp bằng flag với BM25-only/FAISS-only cần evaluation harness.
- Fast path cache và Memory Tree cần một nhóm câu hỏi/routing riêng; không gộp chúng như một tầng nối tiếp bắt buộc.
- Báo cáo cả chất lượng và chi phí: nDCG/Recall, faithfulness/citation, corrective success, latency/calls/tokens, reviewer time.

