# Ghi chú đọc sâu

## 1. Retrieval-Augmented Generation (Lewis et al., 2020)

- **Bài toán:** kết hợp trí nhớ tham số của mô hình sinh với kho tri thức ngoài có thể truy xuất và cập nhật.
- **Phương pháp:** truy hồi các đoạn bằng dense retriever rồi điều kiện hóa bộ sinh seq2seq trên truy vấn và tài liệu; paper khảo sát hai cách giữ cố định hoặc thay đổi tài liệu tiềm ẩn theo token đầu ra.
- **Đánh giá:** các tác vụ hỏi–đáp mở và sinh tri thức; so sánh với mô hình chỉ dùng tham số và các phương pháp truy hồi–sinh đương thời.
- **Kết luận có thể sử dụng:** RAG tạo một cơ chế nối truy hồi với sinh và cho phép kiểm tra nguồn tri thức ngoài. Paper không chứng minh rằng mọi triển khai RAG đều trung thực hoặc có citation chính xác.
- **Liên hệ dự án:** cung cấp mô hình khái niệm cho nhánh truy hồi đầy đủ; dự án bổ sung phân đoạn có cấu trúc, hợp nhất, tái xếp hạng, kiểm tra mâu thuẫn, hiệu chỉnh và HITL.

## 2. Late Chunking (Günther et al., 2024)

- **Bài toán:** embedding từng đoạn độc lập làm mất thông tin nằm ngoài biên đoạn, đặc biệt với đại từ, thực thể hoặc quan hệ được giới thiệu trước đó.
- **Phương pháp:** mã hóa chuỗi dài trước, sau đó pooling các token embedding theo span của từng đoạn. Phương pháp vẫn cần ranh giới đoạn từ một chiến lược phân đoạn bên ngoài.
- **Đánh giá:** các tác vụ truy hồi trên BEIR/LongEmbed và nhiều kích thước đoạn; kết quả nhìn chung thuận lợi nhưng không đồng nhất, và đoạn lớn hoặc ngữ cảnh xung quanh không liên quan có thể làm cách đơn giản tốt hơn.
- **Kết luận có thể sử dụng:** late chunking là một cách đưa ngữ cảnh rộng vào biểu diễn đoạn, không phải bằng chứng rằng nó luôn cải thiện truy hồi.
- **Liên hệ dự án:** mã nguồn chỉ dùng late chunking khi Markdown spans căn chỉnh được và encoder khả dụng; do đó cần đánh giá theo điều kiện và tái lập chỉ mục cho ablation.

## 3. RAPTOR (Sarthi et al., 2024)

- **Bài toán:** truy hồi đoạn phẳng có thể bỏ lỡ bằng chứng tổng hợp ở nhiều phần của tài liệu dài.
- **Phương pháp:** lặp lại embedding, phân cụm và tóm tắt để tạo cây từ lá văn bản đến các nút trừu tượng; truy hồi có thể lựa chọn thông tin ở nhiều mức.
- **Đánh giá:** hỏi–đáp trên các tập có tài liệu dài và truyện; so sánh các chiến lược truy hồi cây và baseline.
- **Kết luận có thể sử dụng:** biểu diễn phân cấp hỗ trợ câu hỏi cần tổng hợp đa mức; chi phí và lỗi tóm tắt có thể tích lũy theo cây.
- **Liên hệ dự án:** Memory Tree của dự án chỉ có mức document/section, section được nhóm đơn giản và có fast path sinh đáp án. Không được gọi nó là bản sao RAPTOR hoặc cây chủ đề ngữ nghĩa đệ quy.

## 4. Corrective RAG (Yan et al., 2024)

- **Bài toán:** RAG phụ thuộc mạnh vào chất lượng tài liệu truy hồi; bằng chứng sai có thể dẫn mô hình sinh tới kết luận sai.
- **Phương pháp:** một evaluator đã huấn luyện chấm từng cặp truy vấn–tài liệu và kích hoạt ba trạng thái Correct/Incorrect/Ambiguous; hệ thống tinh lọc knowledge strips và dùng web search sau query rewrite cho các trường hợp cần hiệu chỉnh.
- **Đánh giá:** PopQA, Biography, PubHealth và Arc-Challenge; paper ghép CRAG với RAG và Self-RAG.
- **Kết luận có thể sử dụng:** đánh giá bằng chứng trước sinh và hành động hiệu chỉnh là một họ thiết kế có cơ sở; hiệu quả phụ thuộc vào độ chính xác của evaluator.
- **Liên hệ dự án:** dự án giữ ba trạng thái và vòng rewrite–retrieve hữu hạn, nhưng grader là heuristic dựa trên lexical/rerank score, không phải T5 evaluator; không dùng web search hay decompose–recompose. Vì vậy đây là **thích nghi theo tư tưởng corrective retrieval**, không phải tái hiện đầy đủ CRAG gốc.

## 5. ALCE (Gao et al., 2023)

- **Bài toán:** câu trả lời dài của LLM khó kiểm chứng nếu thiếu nguồn và liên kết claim–evidence.
- **Phương pháp:** benchmark và quy trình đánh giá sinh văn bản có citation; phân tách chất lượng câu trả lời, mức đầy đủ và tính chính xác/entailment của citation.
- **Đánh giá:** các tác vụ hỏi–đáp dài và tổng hợp; đo fluency, correctness và citation quality bằng đánh giá tự động kết hợp kiểm tra người.
- **Kết luận có thể sử dụng:** citation cần được đánh giá như một đối tượng riêng, không suy ra từ độ trôi chảy hay đúng câu trả lời.
- **Liên hệ dự án:** source/chunk tags và payload evidence tạo điều kiện đo citation precision/recall, nhưng fast path Memory Tree chưa bảo đảm payload evidence đồng nhất; cần kiểm thử trên chỉ mục thật.

## 6. RAGTruth (Niu et al., 2024)

- **Bài toán:** ngay cả khi có ngữ cảnh truy hồi, LLM vẫn có thể sinh claim không được hỗ trợ hoặc mâu thuẫn với nguồn.
- **Phương pháp:** corpus khoảng 18.000 phản hồi RAG được gán nhãn thủ công ở cấp độ trường hợp và span, bao phủ QA, data-to-text và tóm tắt.
- **Đánh giá:** phân tích tần suất/kiểu hallucination và huấn luyện bộ phát hiện trên nhiều LLM và tác vụ.
- **Kết luận có thể sử dụng:** RAG không tự động loại bỏ hallucination; cần đo unsupported/contradictory claims trực tiếp.
- **Liên hệ dự án:** biện minh cho đánh giá grounded QA và NLI/HITL, nhưng không chứng minh NLI cặp-chunk của dự án cải thiện câu trả lời cuối.

## 7. SummN (Zhang et al., 2022)

- **Bài toán:** đầu vào dài vượt giới hạn mô hình và chứa thông tin phân tán.
- **Phương pháp:** split–summarize lặp nhiều stage; đầu ra stage trước trở thành đầu vào ngắn hơn cho stage sau, cho phép dùng backbone tiêu chuẩn.
- **Đánh giá:** AMI, ICSI, QMSum, SummScreen và GovReport; chủ yếu dùng ROUGE và so sánh với các mô hình dài/ngắn.
- **Kết luận có thể sử dụng:** phân rã tóm tắt theo nhiều bước là một chiến lược xử lý giới hạn ngữ cảnh, nhưng lỗi tóm tắt trung gian có thể truyền sang bước sau.
- **Liên hệ dự án:** summary graph của dự án là section-first rồi synthesize với schema/provenance xác định; không phải SummN và chế độ two-pass trong mã chưa được triển khai.

## 8. ARES (Saad-Falcon et al., 2024)

- **Bài toán:** đánh giá RAG cần tách lỗi truy hồi khỏi lỗi sinh và giảm chi phí gán nhãn toàn bộ.
- **Phương pháp:** huấn luyện judges bằng dữ liệu tổng hợp, hiệu chỉnh với một tập nhỏ nhãn người và dùng prediction-powered inference; ba chiều chính là context relevance, answer faithfulness và answer relevance.
- **Đánh giá:** nhiều cấu hình RAG và tập dữ liệu với đối chiếu nhãn người; khảo sát khả năng xếp hạng hệ thống.
- **Kết luận có thể sử dụng:** đánh giá tách chiều giúp chẩn đoán pipeline, nhưng judge tự động vẫn cần dữ liệu người để hiệu chỉnh.
- **Liên hệ dự án:** cung cấp khung cho Chapter 4; không nên dùng duy nhất LLM-as-a-judge và không được thay unit tests bằng số đo nghiên cứu.

## Tổng hợp ranh giới bằng chứng

Các công trình trên hỗ trợ lý do thiết kế và phương pháp đánh giá. Chúng không chứng minh cấu hình tích hợp của dự án tốt hơn baseline. Mọi phát biểu cải thiện Recall@k, nDCG, faithfulness, citation quality, latency hoặc chi phí phải chờ thực nghiệm riêng trên dữ liệu và chỉ mục của dự án.
