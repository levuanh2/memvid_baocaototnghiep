# Khoảng trống, giới hạn và câu hỏi mở

## Khoảng trống từ tài liệu đã duyệt

1. Tài liệu hiện có thường tối ưu từng phần: phân đoạn/embedding, retriever, reranker, corrective retrieval, citation hoặc human review. Bằng chứng về việc phối hợp tất cả các tầng trong một pipeline tài liệu dài, đa đầu ra và giữ provenance còn hạn chế. Không đủ cơ sở để nói “chưa từng có nghiên cứu nào”.
2. Phần lớn benchmark RAG/truy hồi phổ biến là tiếng Anh; thiếu một bộ qrels và grounded QA tiếng Việt, đa định dạng, có câu hỏi tổng quan lẫn chi tiết phù hợp với dự án.
3. Chưa có giao thức chuẩn chung để đánh giá mind map sinh từ tài liệu đồng thời theo coverage, hierarchy, relation correctness và provenance.
4. Tác động của việc đưa source tags trực tiếp vào input của reranker/NLI ít được tài liệu lõi khảo sát và cần ablation riêng.
5. Calibration của heuristic CRAG grade từ lexical coverage và sigmoid rerank scores chưa có bằng chứng học thuật hoặc dữ liệu hiệu chỉnh trong dự án.
6. Việc NLI tự động loại đoạn xung đột theo thứ hạng thấp hơn chưa giải quyết độ tin cậy nguồn, thời gian hoặc mâu thuẫn thực sự trong tài liệu.
7. Tác động của HITL approve/edit/reject đối với unsupported claims và chi phí reviewer chưa được đo trên ứng dụng này.

## Giới hạn của cơ sở tài liệu

- Late Chunking và CRAG nguyên gốc hiện được xác minh dưới dạng arXiv preprint; cần ghi đúng loại nguồn, không gọi là peer-reviewed.
- “Recursive character chunking” và “semantic chunking” không có một paper gốc duy nhất tương ứng chính xác với cách thư viện triển khai; cần trình bày như họ heuristic và trích nguồn thực nghiệm về segmentation thay vì gán sai nguồn khai sinh.
- Paper XNLI hỗ trợ benchmark multilingual NLI, nhưng không xác nhận riêng checkpoint `MoritzLaurer/mDeBERTa-v3-base-mnli-xnli`; checkpoint cần model card như bằng chứng triển khai, không phải bằng chứng lý thuyết.
- Chưa thực hiện systematic review có protocol/PRISMA; tập nguồn hiện tại là curated evidence base cho luận văn, không cho phép khẳng định exhaustive novelty.

## Dữ liệu còn thiếu trước khi viết kết quả nghiên cứu

- Corpus phiên bản cố định, query set và relevance judgments.
- Gold answer/claim–evidence và nhãn citation.
- Nhãn contradiction phù hợp miền tài liệu.
- Rubric và nhãn người cho summary/mind map.
- Log latency/tokens/model calls theo từng cấu hình ablation.
- Log HITL gồm draft, hành động, nội dung edit, thời gian và đánh giá trước/sau.
- Quy chuẩn trích dẫn chính thức của trường/đơn vị; chưa tìm thấy template quy định trong repository.
