# Cơ sở bằng chứng học thuật cho Chương 1 và Chương 2

Ngày kiểm tra: 2026-08-11. Phạm vi: tài liệu dài, truy hồi–sinh có căn cứ, tóm tắt có cấu trúc, sơ đồ khái niệm và HITL. Đây là cơ sở nguồn trước khi viết; chưa phải nội dung Chương 1 hoặc Chương 2.

## A. Literature Search Summary

- Đã sàng lọc theo sáu cụm: (i) tài liệu dài và phân đoạn; (ii) biểu diễn/embedding và truy hồi; (iii) RAG, reranking, NLI và corrective retrieval; (iv) grounding, citation và provenance; (v) tóm tắt/mind map; (vi) HITL và đánh giá.
- Cơ sở quản lý gồm **41 bản ghi**, trong đó **32 nguồn cốt lõi đã xác minh** qua ACL Anthology, ACM, IEEE, NeurIPS, OpenReview, publisher DOI hoặc arXiv gốc.
- Đã đọc sâu 8 công trình trực tiếp chi phối định vị phương pháp; đã kiểm tra 6 kho mã chính thức.
- Kết quả tổng hợp không hỗ trợ phát biểu “toàn bộ pipeline là một thuật toán mới”. Cách diễn đạt phù hợp là **sự tích hợp và thích nghi một quy trình trí tuệ tài liệu đa tầng, có nhận biết cấu trúc, truy hồi hiệu chỉnh và bảo toàn bằng chứng**.
- Không tìm thấy quy định kiểu trích dẫn của trường trong repository. Vì vậy dữ liệu được lưu ở dạng BibTeX trung lập; **chưa chọn IEEE/APA/Vancouver**.

## B. Verified Source List

### B.1. Truy hồi, biểu diễn và tài liệu dài

| ID | Nguồn đã xác minh | Loại | DOI/URL chính thức | Vai trò |
|---|---|---|---|---|
| S01 | Robertson & Zaragoza (2009), *The Probabilistic Relevance Framework: BM25 and Beyond* | Chuyên khảo học thuật | DOI 10.1561/1500000019 | BM25 và xác suất relevance. |
| S02 | Cormack, Clarke & Buettcher (2009), *Reciprocal Rank Fusion…* | SIGIR | DOI 10.1145/1571941.1572114 | Nguồn gốc RRF. |
| S03 | Järvelin & Kekäläinen (2002), *Cumulated Gain-Based Evaluation…* | ACM TOIS | DOI 10.1145/582415.582418 | CG/DCG/nDCG. |
| S04 | Johnson, Douze & Jégou (2019), *Billion-Scale Similarity Search with GPUs* | IEEE T-Big Data | DOI 10.1109/TBDATA.2019.2921572 | FAISS và ANN. |
| S05 | Reimers & Gurevych (2019), *Sentence-BERT* | EMNLP-IJCNLP | DOI 10.18653/v1/D19-1410 | Bi-encoder sentence embeddings. |
| S06 | Karpukhin et al. (2020), *Dense Passage Retrieval…* | EMNLP | DOI 10.18653/v1/2020.emnlp-main.550 | Dense retrieval hai encoder. |
| S07 | Thakur et al. (2021), *BEIR* | NeurIPS Datasets & Benchmarks | [Official proceedings](https://datasets-benchmarks-proceedings.neurips.cc/paper/2021/hash/65b9eea6e1cc6bb9f0cd2a47751a186f-Abstract-round2.html) | Benchmark zero-shot IR; không có retriever thắng phổ quát. |
| S08 | Nogueira & Cho (2019), *Passage Re-ranking with BERT* | Original arXiv preprint | DOI 10.48550/arXiv.1901.04085 | Joint query–passage cross-encoder reranking. |
| S09 | Chen et al. (2024), *M3-Embedding…* | Findings ACL | DOI 10.18653/v1/2024.findings-acl.137 | BGE-M3: đa ngôn ngữ, đa chức năng, đến 8192 tokens. |
| S10 | Günther et al. (2024), *Late Chunking…* | Original arXiv preprint | DOI 10.48550/arXiv.2409.04701 | Whole-context encoding rồi pooling theo chunk span. |
| S11 | Wang et al. (2025), *Document Segmentation Matters for RAG* | Findings ACL | DOI 10.18653/v1/2025.findings-acl.422 | Tác động của segmentation; PIC. |
| S12 | Liu et al. (2024), *Lost in the Middle* | TACL | DOI 10.1162/tacl_a_00638 | Suy giảm sử dụng thông tin theo vị trí trong context dài. |
| S13 | Bai et al. (2024), *LongBench* | ACL | DOI 10.18653/v1/2024.acl-long.172 | Benchmark song ngữ, đa tác vụ cho long context. |
| S14 | Sarthi et al. (2024), *RAPTOR* | ICLR | [OpenReview](https://openreview.net/forum?id=GN921JHCRw) | Biểu diễn/truy hồi cây đệ quy. |

### B.2. RAG, NLI, hiệu chỉnh và attribution

| ID | Nguồn đã xác minh | Loại | DOI/URL chính thức | Vai trò |
|---|---|---|---|---|
| S15 | Lewis et al. (2020), *Retrieval-Augmented Generation…* | NeurIPS | [Official proceedings](https://proceedings.neurips.cc/paper/2020/hash/6b493230-Abstract.html) | Nguồn gốc RAG. |
| S16 | Bowman et al. (2015), *A Large Annotated Corpus for Learning NLI* | EMNLP | DOI 10.18653/v1/D15-1075 | SNLI và bài toán entailment/neutral/contradiction. |
| S17 | Williams, Nangia & Bowman (2018), *A Broad-Coverage Challenge Corpus…* | NAACL | DOI 10.18653/v1/N18-1101 | MultiNLI đa thể loại. |
| S18 | Conneau et al. (2018), *XNLI* | EMNLP | DOI 10.18653/v1/D18-1269 | NLI đa ngôn ngữ. |
| S19 | Yan et al. (2024), *Corrective Retrieval Augmented Generation* | Original arXiv preprint | DOI 10.48550/arXiv.2401.15884 | Evaluator và Correct/Incorrect/Ambiguous actions. |
| S20 | Wang, Yang & Wei (2023), *Query2doc* | EMNLP | DOI 10.18653/v1/2023.emnlp-main.585 | Query expansion bằng pseudo-document. |
| S21 | Gao et al. (2023), *Enabling LLMs to Generate Text with Citations* | EMNLP | DOI 10.18653/v1/2023.emnlp-main.398 | Benchmark và metrics citation. |
| S22 | Niu et al. (2024), *RAGTruth* | ACL | DOI 10.18653/v1/2024.acl-long.585 | Hallucination vẫn tồn tại trong RAG; corpus gán nhãn. |

### B.3. Tóm tắt, bản đồ khái niệm, HITL và đánh giá

| ID | Nguồn đã xác minh | Loại | DOI/URL chính thức | Vai trò |
|---|---|---|---|---|
| S23 | Zhang et al. (2022), *SummN* | ACL | DOI 10.18653/v1/2022.acl-long.112 | Tóm tắt nhiều giai đoạn cho đầu vào dài. |
| S24 | Guo et al. (2022), *LongT5* | Findings NAACL | DOI 10.18653/v1/2022.findings-naacl.55 | Backbone text-to-text cho chuỗi dài. |
| S25 | Zubrinic, Kalpic & Milicevic (2012), *Automatic Creation of Concept Maps…* | Expert Systems with Applications | DOI 10.1016/j.eswa.2012.04.065 | Trích concept/relation và khó khăn của concept-map automation. |
| S26 | Wang et al. (2021), *Putting Humans in the NLP Loop* | HCINLP survey | [ACL Anthology](https://aclanthology.org/2021.hcinlp-1.8/) | Phân loại task, interaction và feedback trong HITL NLP. |
| S27 | Amershi et al. (2019), *Guidelines for Human-AI Interaction* | CHI | DOI 10.1145/3290605.3300233 | Nguyên tắc tương tác và sửa lỗi Human–AI. |
| S28 | Shneiderman (2020), *Human-Centered AI…* | IJHCI | DOI 10.1080/10447318.2020.1741118 | Độ tin cậy, an toàn, kiểm soát người dùng. |
| S29 | Es et al. (2024), *RAGAS* | EACL Demo | DOI 10.18653/v1/2024.eacl-demo.16 | Đánh giá RAG không/ít reference. |
| S30 | Saad-Falcon et al. (2024), *ARES* | NAACL | DOI 10.18653/v1/2024.naacl-long.20 | Context relevance, answer faithfulness, answer relevance. |
| S31 | Liu et al. (2023), *G-Eval* | EMNLP | DOI 10.18653/v1/2023.emnlp-main.153 | LLM judge cho NLG, kèm rủi ro bias. |
| S32 | Wang et al. (2024), *Large Language Models are not Fair Evaluators* | ACL | DOI 10.18653/v1/2024.acl-long.511 | Position bias trong LLM evaluation. |

## C. Chapter 1 Claim → Source Map

| Claim ID | Claim dự kiến | Mục | Nguồn | Nguồn thực sự hỗ trợ | Trạng thái |
|---|---|---|---|---|---|
| C1-01 | Cửa sổ ngữ cảnh dài không bảo đảm mô hình sử dụng đồng đều bằng chứng nằm ở mọi vị trí. | 1.1 | S12, S13 | Lost-in-the-middle và benchmark long-context; không trực tiếp đánh giá dự án. | VERIFIED |
| C1-02 | Phân đoạn quá nhỏ có thể làm mất tính liền mạch, còn đoạn quá lớn đưa thêm thông tin không liên quan. | 1.1–1.2 | S10, S11 | Lý do và kết quả thực nghiệm về chunk boundaries/context. | VERIFIED |
| C1-03 | Không có một retriever đơn lẻ thắng ổn định trên mọi miền; BM25 vẫn là baseline mạnh. | 1.1–1.2 | S07 | Kết quả benchmark BEIR trên nhiều dataset. | VERIFIED |
| C1-04 | RAG nối tri thức ngoài với bộ sinh nhưng chất lượng đầu ra phụ thuộc bằng chứng truy hồi. | 1.1–1.2 | S15, S19 | Cấu trúc RAG và động cơ corrective retrieval. | VERIFIED |
| C1-05 | Có retrieval không đồng nghĩa câu trả lời luôn được nguồn hỗ trợ hoặc không mâu thuẫn. | 1.1–1.2 | S22 | RAGTruth quan sát unsupported/contradictory claims trong nhiều phản hồi RAG. | VERIFIED |
| C1-06 | Citation cần được đánh giá riêng về tính đúng và mức bao phủ. | 1.1, 1.3 | S21 | ALCE phân tách correctness, completeness/citation quality. | VERIFIED |
| C1-07 | Human oversight phù hợp khi cần người xem xét, sửa hoặc từ chối đầu ra AI. | 1.1, 1.6 | S26–S28 | HITL/Human-AI guidance; không chứng minh UI dự án đạt usability. | VERIFIED |
| C1-08 | Nghiên cứu nên đánh giá riêng retrieval, faithfulness và answer relevance. | 1.3–1.7 | S29, S30 | Framework đánh giá RAG đa chiều. | VERIFIED |

## D. Chapter 2 Theory → Source Map

| Theory ID | Lý thuyết cần dùng | Nguồn nền tảng | Nguồn bổ trợ/gần đây | Nội dung được phép khẳng định | Trạng thái |
|---|---|---|---|---|---|
| T01 | Vấn đề xử lý tài liệu dài | S12 | S13 | Vị trí và độ dài context làm việc khai thác bằng chứng khó hơn. | VERIFIED |
| T02 | Chunking/segmentation | S11 | S10 | Biên, kích thước và tính liền mạch ảnh hưởng retrieval; không có optimum phổ quát. | VERIFIED |
| T03 | Structure-aware chunking | S11 | S10 | Cấu trúc/semantic guidance là hướng giảm split không phù hợp; thuật toán heading-first của dự án là implementation riêng. | PARTIAL-MAPPING |
| T04 | Recursive chunking | — | S11 | Chỉ có bằng chứng họ rule-based segmentation; không có paper gốc khớp chính xác `RecursiveCharacterTextSplitter`. | SOURCE GAP |
| T05 | Late chunking | S10 | Repo chính thức Jina | Encode trước, pool span sau; cần boundary ngoài; hiệu quả phụ thuộc dữ liệu/chunk size. | VERIFIED/PREPRINT |
| T06 | Text embedding/bi-encoder | S05 | S06 | Tách encode query/document để tìm kiếm hiệu quả. | VERIFIED |
| T07 | Multilingual/BGE-M3 | S09 | — | Hỗ trợ >100 ngôn ngữ, dense/sparse/multi-vector, tới 8192 tokens trong paper. | VERIFIED |
| T08 | BM25 | S01 | S07 | Sparse lexical relevance và vai trò baseline bền vững. | VERIFIED |
| T09 | Dense retrieval | S06 | S07 | Semantic dense matching; khả năng tổng quát zero-shot không phổ quát. | VERIFIED |
| T10 | FAISS | S04 | — | Thư viện/thuật toán ANN quy mô lớn; không phải một “vector database” đầy đủ theo nghĩa hệ quản trị. | VERIFIED |
| T11 | Hybrid retrieval | S07 | S02 | Tính bổ sung sparse/dense; fusion cần đánh giá theo miền. | VERIFIED |
| T12 | Reciprocal Rank Fusion | S02 | — | Hợp nhất dựa trên reciprocal rank; công thức literal phải theo paper/code tương ứng. | VERIFIED |
| T13 | Hierarchical retrieval | S14 | S23 | Biểu diễn/truy hồi nhiều mức; không đồng nhất RAPTOR với Memory Tree dự án. | VERIFIED |
| T14 | RAG | S15 | S22 | Tri thức ngoài hỗ trợ sinh nhưng không bảo đảm faithfulness. | VERIFIED |
| T15 | Cross-encoder reranking | S08 | S07 | Joint encoding hỗ trợ chấm relevance chính xác hơn với chi phí cao hơn; chưa chứng minh model dự án cải thiện nDCG. | VERIFIED |
| T16 | NLI/XNLI | S16, S17 | S18 | Ba quan hệ entailment/neutral/contradiction và mở rộng đa ngôn ngữ. | VERIFIED |
| T17 | Corrective RAG | S19 | — | Evaluator và các action theo chất lượng retrieval; dự án chỉ thích nghi một phần. | VERIFIED/PREPRINT |
| T18 | Query rewriting/expansion | S20 | S19 | Rewrite/expansion có thể cải thiện retrieval; cần kiểm soát drift và giữ query gốc. | VERIFIED |
| T19 | Grounding/citation/provenance | S21 | S22 | Claim support và citation completeness phải được đo trực tiếp. | VERIFIED |
| T20 | Long-document summarization | S23 | S24 | Phân rã nhiều stage và/hoặc long-context architectures; có rủi ro lỗi trung gian. | VERIFIED |
| T21 | Concept/mind-map generation | S25 | — | Cần trích concepts và relations; tự động đạt chất lượng người là khó. | VERIFIED, LIMITED |
| T22 | HITL/Human-centered AI | S26 | S27, S28 | Cơ chế interaction/feedback/oversight và nguyên tắc kiểm soát người dùng. | VERIFIED |
| T23 | Retrieval metrics | S03 | S07 | nDCG và benchmark retrieval; Recall/MRR cần định nghĩa bổ sung khi viết. | VERIFIED |
| T24 | RAG evaluation | S29, S30 | S21, S22 | Tách context relevance, faithfulness, relevance, citation và hallucination. | VERIFIED |
| T25 | LLM-as-a-judge limitations | S31 | S32 | Judge có thể hữu ích nhưng chịu bias, cần human calibration. | VERIFIED |

## E. Related Work Matrix

| Paper/method | Bài toán | Phương pháp lõi | Dữ liệu/metrics | Điểm mạnh | Giới hạn | Quan hệ với dự án |
|---|---|---|---|---|---|---|
| BM25 / BEIR (S01, S07) | Lexical IR, zero-shot IR | Term saturation/length normalization; benchmark đa miền | 18 datasets; nDCG@10, Recall@k | Baseline mạnh, dễ giải thích | Không khớp paraphrase tốt; không thắng mọi miền | Một nhánh retrieval và baseline bắt buộc. |
| DPR (S06) | Open-domain passage retrieval | Dual encoder, in-batch negatives | QA datasets; retrieval accuracy/EM | Khớp ngữ nghĩa và ANN hiệu quả | Nhạy domain; mất tương tác token chi tiết | Cơ sở dense/FAISS branch. |
| RRF (S02) | Kết hợp nhiều ranking | Tổng reciprocal ranks | TREC/SIGIR settings | Không cần calibration score trực tiếp | Bỏ qua độ lớn score; tham số cần cố định | Cơ sở fusion BM25–FAISS. |
| BERT reranker (S08) | Cải thiện ranking candidate | Joint query–passage encoding | Passage ranking; MRR | Tương tác sâu query–passage | Đắt hơn bi-encoder | Đối chiếu cross-encoder stage mặc định. |
| BGE-M3 (S09) | Embedding đa ngôn ngữ/chức năng/độ dài | Self-knowledge distillation; dense/sparse/multi-vector | Multilingual/cross-lingual/long-doc retrieval | Một model cho nhiều chế độ, long input | Kết quả paper không chuyển trực tiếp sang corpus dự án | Embedding model cấu hình triển khai. |
| Late Chunking (S10) | Mất ngữ cảnh qua biên chunk | Encode tài liệu dài rồi pool theo span | BEIR/LongEmbed; nDCG | Context-aware chunk embeddings | Preprint; cần boundary; không luôn tốt hơn | Tương ứng nhánh conditional trong ingest. |
| PIC/segmentation (S11) | Split quá lớn/nhỏ, thiếu coherence | Summary-guided semantic grouping | Open-domain QA; Hits@k, EM | Cho thấy segmentation là biến cần đánh giá | Không dùng heading/Markdown như dự án | Đối chứng học thuật cho structure-aware chunking. |
| RAPTOR (S14) | Câu hỏi cần tổng hợp nhiều mức | Recursive cluster–summarize tree | Long-document QA | Retrieval ở nhiều abstraction levels | Chi phí/lỗi summary; cây phức tạp | Cùng họ với Memory Tree nhưng thuật toán khác. |
| RAG (S15) | Sinh dựa trên tri thức ngoài | Dense retriever + seq2seq generator | Knowledge-intensive NLP | Modular non-parametric memory | Grounding/citation không tự bảo đảm | Nền tảng nhánh QA đầy đủ. |
| CRAG (S19) | Retrieval sai dẫn sinh sai | Learned evaluator; three actions; refine/web search | PopQA, Biography, PubHealth, Arc-C | Chủ động hiệu chỉnh trước sinh | Phụ thuộc evaluator; pipeline gốc nặng | Dự án thích nghi bằng heuristic grade + internal rewrite, không sao chép đầy đủ. |
| Query2doc (S20) | Query ngắn/mơ hồ | LLM pseudo-document expansion | MS MARCO/TREC DL; retrieval metrics | Hỗ trợ sparse và dense | Rủi ro hallucination/query drift, thêm call | Bổ trợ lý thuyết cho corrective rewrite; dự án giữ query gốc. |
| ALCE/RAGTruth (S21, S22) | Verifiability và hallucination trong RAG | Citation benchmark; corpus gán nhãn span | QA/summary/data-to-text; citation/hallucination metrics | Đánh giá claim–evidence trực tiếp | Chi phí nhãn; miền/LLM cụ thể | Nền cho evidence tags và grounded QA evaluation. |
| SummN (S23) | Đầu vào dài vượt context | Split–summarize nhiều stage | AMI, ICSI, QMSum, SummScreen, GovReport; ROUGE | Dùng backbone tiêu chuẩn | Lỗi stage trước truyền sang sau | Liên hệ section-first summary, không đồng nhất phương pháp. |
| Concept-map automation (S25) | Trích concepts và relations | NLP/pattern extraction thành graph | Đánh giá domain-specific | Nêu rõ hai mục tiêu concept/relation | Chất lượng cấp người khó; nghiên cứu cũ | Cơ sở cho rubric coverage/hierarchy/relation của mind map. |
| HITL (S26–S28) | AI cần feedback/oversight | Human feedback, review và correction loops | Taxonomy/guidelines, không một benchmark chung | Tăng kiểm soát và accountability | Tốn thời gian; dễ phụ thuộc reviewer | Cơ sở cho approve/edit/reject và đánh giá trước/sau duyệt. |
| RAGAS/ARES (S29, S30) | Đánh giá RAG tách tầng | LLM judges; synthetic data + PPI/human subset | Context relevance, faithfulness, answer relevance | Chẩn đoán từng tầng, giảm nhãn | Judge bias/domain shift | Khung metrics; phải hiệu chỉnh bằng người. |

### Khoảng trống nghiên cứu rút ra

Các công trình đã duyệt thường tập trung riêng vào segmentation/embedding, retrieval/reranking, corrective generation, attribution hoặc human review. Chúng cho thấy ít sự chú ý hơn tới việc **đồng thời** duy trì biểu diễn có cấu trúc, routing fast path/full path, hiệu chỉnh bằng chứng, nhiều artifact có provenance và duyệt người trong một pipeline tài liệu. Đây là cơ sở để nghiên cứu sự tích hợp của dự án, không phải bằng chứng rằng chưa từng có hệ thống tương tự.

## F. Sources Rejected

| Nguồn/nhóm | Lý do loại khỏi bằng chứng học thuật chính |
|---|---|
| Blog *Contextual Retrieval* của Anthropic | Có giá trị định hướng kỹ thuật nhưng là blog tổ chức, không phải paper peer-reviewed; không dùng thay nguồn segmentation/late chunking. |
| LangChain documentation về recursive/semantic splitters | Là tài liệu thư viện và bằng chứng triển khai, không phải nguồn lý thuyết gốc. |
| Hugging Face model cards | Chỉ dùng sau này để xác minh checkpoint/model implementation; không thay paper XNLI/BGE/NLI. |
| Wikipedia, Medium, SEO blogs và tutorials | Không đáp ứng yêu cầu kiểm duyệt học thuật/metadata. |
| ResearchGate/PapersWithCode/Semantic Scholar pages | Chỉ là discovery/aggregation; khi paper có publisher/ACL/OpenReview thì trích nguồn gốc. |
| GitHub README và số liệu benchmark trong README | Dùng kiểm tra reproducibility, không dùng làm kết quả nghiên cứu của dự án. |
| Các preprint 2025–2026 không phải nguồn gốc và không cần cho quyết định hiện tại | Tính ổn định/peer review chưa đủ; không bổ sung giá trị so với nguồn gốc đã xác minh. |
| “CMGN/three critics” liên quan code legacy | Không có caller trong runtime hiện hành; không phù hợp làm mô tả phương pháp chính của dự án. |

## G. Missing Literature Areas

1. Chưa xác định được một nguồn peer-reviewed duy nhất cho đúng thuật toán `RecursiveCharacterTextSplitter`; thuật ngữ “recursive chunking” phải trình bày như heuristic triển khai.
2. “Semantic chunking” bao gồm nhiều định nghĩa; cần chọn đúng biến thể nếu Chapter 2 so sánh chi tiết, tránh tạo một định nghĩa giả đồng nhất.
3. Late Chunking và CRAG nguyên gốc hiện chỉ được xác minh là preprint arXiv; phải ghi đúng loại nguồn.
4. Paper XNLI không chứng minh riêng chất lượng checkpoint `MoritzLaurer/mDeBERTa-v3-base-mnli-xnli`; model card chỉ là nguồn triển khai bổ sung.
5. Chưa có benchmark tiếng Việt, đa định dạng, tài liệu dài với qrels, gold answers, contradiction labels và claim–citation alignment phù hợp trực tiếp dự án.
6. Chưa có protocol chuẩn được xác minh cho mind map sinh từ tài liệu đồng thời đo coverage, hierarchy, relation correctness và provenance; cần rubric người dùng/chuyên gia.
7. Chưa có bằng chứng cho chính sách cụ thể “loại đoạn xếp hạng thấp hơn khi NLI báo mâu thuẫn” hoặc cho calibration các ngưỡng CRAG heuristic của dự án.
8. Chưa có nghiên cứu trực tiếp về tác động của source/chunk tags được prepended vào input cross-encoder và NLI; cần ablation.
9. Chưa có dữ liệu người dùng cho approve/edit/reject, reviewer time và quality delta trước/sau HITL trong miền dự án.
10. Chưa tìm thấy quy định trích dẫn chính thức của trường/đơn vị trong repository. Cần template hoặc xác nhận trước khi render tài liệu tham khảo.

## Kiểm soát bằng chứng trước khi viết

- Claim học thuật chỉ sử dụng các nguồn trong bảng C/D hoặc bổ sung sau khi xác minh metadata và nội dung.
- Claim triển khai tiếp tục trỏ tới repository, không dùng paper để suy ra code.
- Claim hiệu năng chỉ được viết sau khi có dữ liệu dự án; các con số trong paper ngoài chỉ được nêu như kết quả của chính paper đó và phải ghi rõ ngữ cảnh.
- Chương 1 chỉ dùng 1–3 nguồn mạnh cho mỗi cụm động cơ; Chương 2 dùng nguồn nền tảng + nghiên cứu bổ trợ theo bản đồ D.
