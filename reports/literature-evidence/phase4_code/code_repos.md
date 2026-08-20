# Đối chiếu kho mã nguồn chính thức

Thông tin được kiểm tra ngày 2026-08-11. Số sao là tín hiệu phổ biến có tính thời điểm, không được sử dụng như bằng chứng chất lượng nghiên cứu.

| Công trình | Kho mã chính thức | Ngôn ngữ/chất liệu chính | Mức tài liệu và khả năng tái lập | Sao tại thời điểm kiểm tra | Liên hệ với dự án |
|---|---|---|---|---:|---|
| Late Chunking | https://github.com/jina-ai/late-chunking | Python, notebook | Có package, tests, notebook và script `run_chunked_eval.py`; Apache-2.0 | 534 | Hữu ích để đối chiếu pooling theo span và thiết kế ablation late/naive chunking. |
| RAPTOR | https://github.com/parthsarthi03/raptor | Python, notebook | Có module dựng/lưu/tải cây, demo và điểm mở rộng model; tài liệu nâng cao còn ghi WIP; MIT | 1.7k | Dùng để phân biệt cây recursive clustering với Memory Tree hai mức của dự án. |
| CRAG | https://github.com/HuskyInSalt/CRAG | Python/scripts | Kho chính thức kèm paper; mức tái lập phụ thuộc checkpoint/dataset và pipeline web search | 468 | Chứng minh cách CRAG gốc dùng learned evaluator và external search; dự án chỉ thích nghi ba trạng thái và vòng hiệu chỉnh nội bộ. |
| ALCE | https://github.com/princeton-nlp/ALCE | Python/scripts | Có mã dữ liệu, baseline và evaluation cho citation; MIT | 525 | Nguồn khả thi để thiết kế citation correctness/completeness, không thay thế gán nhãn dự án. |
| RAGAS | https://github.com/vibrantlabsai/ragas | Python package/docs | Package đang được duy trì, tài liệu và API đánh giá; Apache-2.0 | 15.3k | Có thể hỗ trợ đánh giá RAG tự động, nhưng paper EACL và hạn chế judge phải là nguồn học thuật chính. |
| BEIR | https://github.com/beir-cellar/beir | Python | Framework benchmark zero-shot IR và nhiều datasets; giấy phép Apache-2.0 | Không ghi cố định do trang chuyển kho | Cung cấp cấu trúc corpus/query/qrels và metrics cho retrieval benchmark; cần tạo dữ liệu Việt riêng hoặc ánh xạ dữ liệu dự án. |

## Kết luận đối chiếu mã

Các kho mã xác nhận rằng phần lớn phương pháp nền có công cụ tái lập. Tuy nhiên, không có kho nào là drop-in implementation của toàn bộ pipeline dự án. Mọi thí nghiệm phải cố định model, phiên bản, dữ liệu và chỉ mục; không được lấy số liệu README của các kho bên ngoài làm kết quả của dự án.
