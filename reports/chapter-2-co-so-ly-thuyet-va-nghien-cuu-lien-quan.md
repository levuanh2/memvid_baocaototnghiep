# A. TOÀN VĂN CHƯƠNG 2 VỚI TRÍCH DẪN SỐ TOÀN CỤC

# CHƯƠNG 2. CƠ SỞ LÝ THUYẾT VÀ CÁC NGHIÊN CỨU LIÊN QUAN

## 2.1. Biểu diễn và khai thác tài liệu dài

### 2.1.1. Đặc trưng của tài liệu dài và dị thể

Tài liệu dài khác một tập các câu độc lập ở chỗ ý nghĩa thường được phân bố trên nhiều đơn vị và nhiều mức cấu trúc. Một thuật ngữ có thể được định nghĩa ở đầu tài liệu nhưng được dùng ở các mục sau; một kết luận có thể phụ thuộc vào lập luận, bảng số liệu hoặc ngoại lệ xuất hiện cách xa nhau; tiêu đề và thứ bậc mục có thể quyết định phạm vi diễn giải của một đoạn. Vì vậy, khai thác tài liệu dài đòi hỏi đồng thời hai khả năng: định vị bằng chứng cục bộ và tổng hợp thông tin trải rộng trên toàn văn bản.

Độ dài ngữ cảnh không chỉ làm tăng chi phí tính toán mà còn làm nảy sinh khó khăn lựa chọn thông tin. *Lost in the Middle* cho thấy khả năng sử dụng bằng chứng của mô hình có thể thay đổi theo vị trí của bằng chứng trong chuỗi đầu vào [1]. LongBench mở rộng quan sát này trên một benchmark song ngữ và đa tác vụ, qua đó cho thấy việc xử lý đầu vào dài vẫn chưa được giải quyết chỉ bằng cách tăng cửa sổ ngữ cảnh [2]. Hai kết quả này cung cấp cơ sở cho việc tách quá trình khai thác tài liệu thành các bước biểu diễn, truy hồi và tổng hợp thay vì giả định toàn bộ tài liệu có thể được xử lý đồng đều trong một lần suy luận.

Tính dị thể làm bài toán phức tạp hơn vì các định dạng khác nhau mã hóa cấu trúc theo cách khác nhau. PDF thường ưu tiên bố cục hiển thị; DOCX và HTML có thể lưu cấu trúc logic rõ hơn; Markdown biểu diễn tiêu đề trực tiếp; bảng và ảnh lại đòi hỏi cơ chế trích xuất riêng. Sau khi chuyển đổi sang văn bản, một phần thông tin bố cục có thể mất đi hoặc bị biến thành các dấu hiệu không đồng nhất. Vì vậy, biểu diễn trung gian cần ưu tiên những thuộc tính phục vụ nghiên cứu—nội dung, thứ bậc mục, vị trí và provenance—thay vì cố tái tạo mọi đặc điểm trình bày của tài liệu gốc.

### 2.1.2. Mất mát cấu trúc và ngữ cảnh khi xử lý tài liệu

Mất mát cấu trúc xảy ra khi quá trình trích xuất biến một tài liệu có tiêu đề, mục và vùng nội dung thành một chuỗi phẳng. Khi đó, hai đoạn ở các mục khác nhau có thể trở nên khó phân biệt, còn quan hệ giữa tiêu đề và nội dung bị ẩn khỏi bước phân đoạn. Nghiên cứu về tách tiêu đề mục khỏi văn xuôi trong tài liệu web cho thấy nhận diện thành phần cấu trúc là một bài toán riêng, cần khai thác cả dấu hiệu hình thức và nội dung [15]. Điều này không trực tiếp định nghĩa một thuật toán chunking, nhưng chứng minh rằng cấu trúc tài liệu không phải thuộc tính có thể mặc nhiên giả định đã được bảo toàn sau trích xuất.

Mất mát ngữ cảnh xuất hiện khi biên đoạn cắt qua một quan hệ ngữ nghĩa. Một đại từ có thể nằm ở đoạn sau trong khi thực thể được nhắc tới ở đoạn trước; một kết luận có thể bị tách khỏi điều kiện; một mục con có thể mất tiêu đề cha. Nghiên cứu về document segmentation cho RAG chỉ ra rằng đoạn quá lớn có thể mang thêm nội dung không liên quan, trong khi đoạn quá nhỏ làm giảm tính liền mạch ngữ nghĩa [4]. Do đó, kích thước đoạn không phải tham số thuần túy về hiệu năng mà là một quyết định ảnh hưởng trực tiếp tới đơn vị bằng chứng.

Hai dạng mất mát này có quan hệ nhưng không đồng nhất. Khôi phục tiêu đề không tự bảo đảm rằng mọi quan hệ xa được giữ lại; ngược lại, tăng kích thước đoạn để giữ ngữ cảnh có thể đưa nhiều nhiễu vào retrieval và generation. Một phương pháp xử lý tài liệu dài cần vì vậy phối hợp ba lớp: bảo toàn dấu hiệu cấu trúc, xác định biên đoạn có ý nghĩa và bổ sung ngữ cảnh rộng cho biểu diễn khi điều kiện cho phép.

### 2.1.3. Yêu cầu biểu diễn đa mức

Biểu diễn đa mức xuất phát từ sự khác nhau giữa các loại nhu cầu thông tin. Câu hỏi về một con số hoặc định nghĩa thường cần đoạn chi tiết; câu hỏi về luận điểm chính cần thông tin ở mức mục hoặc tài liệu; câu hỏi so sánh có thể cần bằng chứng từ nhiều nhánh. Nếu chỉ lập chỉ mục ở một độ phân giải, đoạn nhỏ có thể thiếu khả năng tổng hợp, trong khi đoạn lớn làm giảm độ chính xác định vị.

Một mô hình khái niệm có thể biểu diễn tài liệu \(d\) bằng ba lớp: tài liệu \(v_d\), các mục \(V_s(d)=\{v_{s_1},\ldots,v_{s_r}\}\), và các đoạn \(C(d)=\{c_1,\ldots,c_m\}\). Các cạnh cha–con liên kết tài liệu với mục và mục với đoạn; mỗi node có thể mang văn bản, embedding, tóm tắt và con trỏ về nguồn. Khi truy vấn \(q\) đến, hệ thống có thể chọn độ phân giải phù hợp hoặc kết hợp bằng chứng từ nhiều lớp.

RAPTOR hiện thực một hướng biểu diễn phân cấp bằng cách lặp lại các bước embedding, phân cụm và tóm tắt để tạo cây từ đoạn gốc tới các node trừu tượng [16]. Điểm mạnh của hướng này là hỗ trợ câu hỏi cần tổng hợp thông tin ở nhiều mức; hạn chế là chi phí dựng cây và khả năng lỗi tóm tắt truyền lên các node cao hơn. RAPTOR là một ví dụ học thuật cho retrieval đa độ phân giải, không phải tên gọi chung của mọi Memory Tree và không nên được dùng để suy ra rằng một cấu trúc document/section đơn giản có cùng thuật toán.

## 2.2. Phân đoạn và biểu diễn đoạn tài liệu

### 2.2.1. Phân đoạn cố định, đệ quy và ngữ nghĩa

Phân đoạn cố định chia chuỗi theo số ký tự hoặc token gần như không phụ thuộc nội dung. Ưu điểm của cách này là đơn giản, tái lập và dễ kiểm soát ngân sách ngữ cảnh; nhược điểm là biên đoạn có thể cắt câu, mục hoặc quan hệ ngữ nghĩa. Overlap thường được dùng để giảm mất mát ở biên, nhưng làm tăng số đoạn, dung lượng chỉ mục và khả năng truy hồi nội dung trùng lặp.

Phân đoạn đệ quy áp dụng một thứ tự separator, chẳng hạn đoạn văn, dòng, câu, từ rồi ký tự, cho tới khi mỗi đơn vị thỏa giới hạn kích thước. So với cắt cố định, phương pháp này ưu tiên biên ngôn ngữ tự nhiên hơn nhưng vẫn là một heuristic phụ thuộc bộ separator, thứ tự và ngôn ngữ. Không có một paper gốc duy nhất trong cơ sở tài liệu đã duyệt định nghĩa chính xác `RecursiveCharacterTextSplitter`; vì thế báo cáo xem đây là họ chiến lược rule-based, không trình bày nó như một thuật toán học thuật chuẩn hóa.

Phân đoạn ngữ nghĩa dùng thay đổi về embedding, chủ đề hoặc độ tương đồng giữa các câu để tìm điểm chuyển nội dung. Cách tiếp cận này có thể tạo đoạn liền mạch hơn nhưng đòi hỏi thêm tính toán và phụ thuộc mạnh vào mô hình embedding, ngưỡng cũng như miền dữ liệu. Thuật ngữ “semantic chunking” hiện bao gồm nhiều biến thể chứ không có một công thức thống nhất. Nghiên cứu về segmentation cho RAG xác nhận rằng lựa chọn biên đoạn ảnh hưởng retrieval và QA, đồng thời cho thấy các phương pháp rule-based và semantic đều có các trường hợp bất lợi [4].

Ba họ chiến lược giải quyết các mục tiêu khác nhau: cố định ưu tiên kiểm soát độ dài, đệ quy ưu tiên biên hình thức, còn ngữ nghĩa ưu tiên tính liên tục nội dung. Do không có chiến lược chiếm ưu thế trong mọi loại tài liệu, đánh giá cần giữ nguyên dữ liệu và downstream retriever khi so sánh để tách tác động của chunking khỏi tác động của model.

### 2.2.2. Phân đoạn nhận biết cấu trúc

Phân đoạn nhận biết cấu trúc sử dụng những đơn vị đã tồn tại trong tài liệu—tiêu đề, mục, đoạn, trang hoặc phần tử HTML—làm tín hiệu trước khi áp dụng giới hạn kích thước. Nguyên tắc cốt lõi là không cắt qua ranh giới logic nếu vẫn có thể tạo đoạn đáp ứng ngân sách. Khi một mục quá dài, bộ chia thứ cấp mới tiếp tục phân nhỏ và giữ đường dẫn tiêu đề làm metadata.

Cách tiếp cận này mang lại hai lợi ích. Thứ nhất, heading path giúp phân biệt những đoạn có nội dung từ vựng tương tự nhưng thuộc bối cảnh khác nhau. Thứ hai, metadata cấu trúc cho phép nhóm lại đoạn theo mục khi tóm tắt hoặc xây biểu diễn phân cấp. Công trình về nhận diện tiêu đề và prose cho thấy tín hiệu section có thể được trích xuất như một lớp cấu trúc độc lập [15], còn nghiên cứu segmentation cho RAG cho thấy chất lượng biên đoạn có hệ quả downstream [4].

Hạn chế của structure-aware chunking là phụ thuộc chất lượng trích xuất. Tiêu đề sai, tài liệu không có cấu trúc hoặc các quy ước định dạng không nhất quán có thể làm ranh giới kém tin cậy. Vì vậy, phương pháp cần fallback sang chiến lược đệ quy hoặc ngữ nghĩa và phải ghi lại phương pháp đã dùng để hỗ trợ phân tích lỗi.

### 2.2.3. Late chunking và biểu diễn đoạn trong ngữ cảnh rộng

Late chunking chuyển thời điểm phân đoạn từ trước bước mã hóa sang sau khi mô hình đã xử lý ngữ cảnh rộng. Với cách thông thường, mỗi đoạn \(c_i\) được encode độc lập thành \(\mathbf{e}_i=f(c_i)\). Với late chunking, toàn bộ văn bản hoặc một cửa sổ dài \(d\) được encode thành chuỗi token embedding \(\mathbf{H}=f_{tok}(d)\); embedding đoạn được pooling trên các token thuộc span \([a_i,b_i]\):

\[
\mathbf{e}_i=\frac{1}{b_i-a_i+1}\sum_{t=a_i}^{b_i}\mathbf{H}_t.
\tag{2.1}
\]

Trong biểu thức (2.1), \(\mathbf{H}_t\) là embedding của token thứ \(t\) sau khi đã tiếp nhận ngữ cảnh rộng, còn \(a_i\) và \(b_i\) là biên token của đoạn thứ \(i\). Nhờ đó, biểu diễn của đại từ hoặc thuật ngữ trong đoạn có thể mang thông tin từ phần văn bản lân cận. Công trình gốc về late chunking báo cáo lợi ích trên một số benchmark retrieval nhưng cũng ghi nhận kết quả phụ thuộc kích thước đoạn và ngữ cảnh [3]. Nguồn này hiện là preprint arXiv, không được trình bày như công trình đã qua phản biện.

Late chunking không tự xác định biên đoạn; nó vẫn cần một segmentation strategy để ánh xạ span ký tự sang span token. Nó cũng bị giới hạn bởi độ dài tối đa của encoder và có thể đưa ngữ cảnh không liên quan vào embedding khi cửa sổ quá rộng. Vì vậy, late chunking phù hợp nhất khi span đáng tin cậy, encoder hỗ trợ context dài và chi phí lập chỉ mục được chấp nhận; nó phải được so sánh với embedding độc lập thay vì mặc định xem là tốt hơn.

### 2.2.4. Embedding văn bản và biểu diễn vector

Embedding ánh xạ một đoạn văn bản vào vector \(\mathbf{e}\in\mathbb{R}^d\), sao cho các văn bản có quan hệ ngữ nghĩa có xu hướng gần nhau trong không gian biểu diễn. Sentence-BERT sử dụng kiến trúc Siamese/triplet để tạo sentence embeddings có thể so sánh trực tiếp, giảm chi phí so với việc joint-encode mọi cặp câu [17]. Đây là nền tảng quan trọng của bi-encoder retrieval: tài liệu được encode trước, còn truy vấn chỉ cần encode tại thời điểm tìm kiếm.

Độ tương đồng cosine giữa query embedding \(\mathbf{e}_q\) và đoạn \(\mathbf{e}_i\) được xác định bởi:

\[
\operatorname{cos}(\mathbf{e}_q,\mathbf{e}_i)=
\frac{\mathbf{e}_q^{\top}\mathbf{e}_i}
{\lVert\mathbf{e}_q\rVert_2\lVert\mathbf{e}_i\rVert_2}.
\tag{2.2}
\]

Nếu vector đã được chuẩn hóa L2, cosine similarity bằng tích vô hướng. Phép đo này cho phép xếp hạng theo mức gần ngữ nghĩa nhưng không bảo đảm calibration giữa các model hoặc miền dữ liệu. Embedding có thể nhạy với ngôn ngữ, độ dài, thuật ngữ chuyên ngành và cách phân đoạn.

BGE-M3 mở rộng embedding theo ba chiều: đa ngôn ngữ, đa chức năng và đa độ hạt; paper mô tả hỗ trợ dense, sparse và multi-vector retrieval trên hơn 100 ngôn ngữ, với đầu vào tới 8.192 token [18]. Khả năng này làm BGE-M3 phù hợp về mặt lý thuyết với tài liệu đa ngôn ngữ và context dài. Tuy nhiên, kết quả của paper không thay thế đánh giá trên corpus của đề tài; model có thể cần kiểm tra riêng về tiếng Việt, miền dữ liệu và chi phí.

## 2.3. Các phương pháp truy hồi thông tin

### 2.3.1. Truy hồi thưa và BM25

Truy hồi thưa biểu diễn truy vấn và tài liệu qua các chiều từ vựng. BM25 thuộc họ probabilistic relevance framework, kết hợp tần suất từ với cơ chế bão hòa và chuẩn hóa độ dài tài liệu [19]. Với truy vấn \(q\) và tài liệu \(d\), một dạng phổ biến của hàm điểm là:

\[
\operatorname{BM25}(q,d)=
\sum_{t\in q}\operatorname{IDF}(t)
\frac{f(t,d)(k_1+1)}
{f(t,d)+k_1\left(1-b+b\frac{|d|}{\operatorname{avgdl}}\right)}.
\tag{2.3}
\]

Trong đó, \(f(t,d)\) là số lần thuật ngữ \(t\) xuất hiện trong \(d\); \(|d|\) là độ dài tài liệu; \(\operatorname{avgdl}\) là độ dài trung bình; \(k_1>0\) điều khiển độ bão hòa của term frequency; và \(b\in[0,1]\) điều khiển mức chuẩn hóa độ dài. \(\operatorname{IDF}(t)\) tăng trọng số cho thuật ngữ hiếm. Khi \(f(t,d)\) tăng, đóng góp của thuật ngữ tăng chậm dần thay vì tuyến tính.

BM25 có ưu thế ở các truy vấn chứa tên riêng, mã, thuật ngữ và cụm từ xuất hiện trực tiếp. Nó không cần huấn luyện embedding và có thể giải thích qua contribution của từ. Hạn chế chính là phụ thuộc overlap từ vựng: hai câu đồng nghĩa nhưng dùng từ khác nhau có thể không khớp. Trên BEIR, BM25 vẫn là baseline mạnh và ổn định, trong khi các mô hình dense không chiếm ưu thế tuyệt đối trên mọi miền [5]. Vì vậy, BM25 vừa là thành phần thực dụng vừa là đối chứng bắt buộc khi đánh giá retrieval.

### 2.3.2. Truy hồi dày và tìm kiếm vector

Truy hồi dày encode truy vấn và đoạn thành các vector thấp chiều rồi xếp hạng theo độ tương đồng. Dense Passage Retrieval huấn luyện hai encoder cho query và passage bằng các cặp dương/âm, qua đó cho phép tìm kiếm semantic matching mà không cần tính joint attention với toàn bộ corpus [20]. So với BM25, dense retrieval có thể tìm được paraphrase và quan hệ ngữ nghĩa không có overlap trực tiếp; đổi lại, hiệu quả phụ thuộc dữ liệu huấn luyện, miền và chất lượng negative sampling.

Với corpus có ma trận embedding \(\mathbf{E}\in\mathbb{R}^{m\times d}\), bài toán retrieval là tìm tập chỉ số có điểm lớn nhất:

\[
R_k(q)=\operatorname{TopK}_{i\in\{1,\ldots,m\}}
s(\mathbf{e}_q,\mathbf{e}_i),
\tag{2.4}
\]

trong đó \(s\) có thể là cosine similarity, inner product hoặc âm khoảng cách. Khi \(m\) lớn, exhaustive search tốn chi phí; FAISS cung cấp các cấu trúc và thuật toán approximate nearest-neighbor, đồng thời hỗ trợ tăng tốc GPU cho tìm kiếm vector quy mô lớn [21]. FAISS là thư viện lập chỉ mục/tìm kiếm vector, không tự cung cấp đầy đủ các chức năng quản trị, phân quyền hay vòng đời dữ liệu của một hệ quản trị cơ sở dữ liệu.

Approximate search tạo sự đánh đổi giữa recall, độ trễ và bộ nhớ. Tham số index cần được giữ cố định khi so sánh model embedding; nếu không, thay đổi retrieval quality có thể đến từ cấu trúc ANN thay vì biểu diễn. Dense retrieval cũng cần cơ chế kiểm tra version và dimension của vector để tránh trộn các embedding không tương thích.

### 2.3.3. Truy hồi lai lexical–semantic

Truy hồi lai kết hợp tín hiệu lexical của BM25 với tín hiệu semantic của dense retrieval. Động cơ của cách tiếp cận này là hai kênh thường thất bại ở những trường hợp khác nhau: lexical mạnh với từ khóa chính xác, dense mạnh với diễn đạt tương đương. Kết quả trên BEIR cho thấy tính không đồng nhất giữa miền dữ liệu, qua đó củng cố nhu cầu đánh giá sự bổ sung thay vì chọn một retriever duy nhất [5]. BGE-M3 cũng cho thấy sparse và dense có thể được hỗ trợ trong một khung biểu diễn đa chức năng [18].

Có hai nhóm cách kết hợp. Score-level fusion chuẩn hóa các score rồi cộng theo trọng số; ưu điểm là tận dụng độ lớn score, nhưng calibration giữa BM25 và cosine không tự nhiên. Rank-level fusion chỉ dùng vị trí trong từng danh sách; cách này ít phụ thuộc thang điểm nhưng bỏ qua khoảng cách score. Một hệ thống có thể lấy candidate pool rộng từ mỗi kênh rồi fusion, sau đó dùng reranker đắt hơn trên tập nhỏ.

Điểm mạnh của hybrid retrieval là tăng độ bao phủ các kiểu truy vấn. Hạn chế là độ phức tạp cấu hình tăng: top-k từng kênh, trọng số, phương pháp loại trùng và tiêu chí hợp nhất đều ảnh hưởng kết quả. Vì vậy, “hybrid” không phải một thuật toán duy nhất; báo cáo thực nghiệm phải nêu rõ cách fusion và candidate budget.

### 2.3.4. Hợp nhất thứ hạng bằng Reciprocal Rank Fusion

Reciprocal Rank Fusion (RRF) hợp nhất nhiều danh sách bằng tổng nghịch đảo thứ hạng [22]. Với tập các ranking \(\mathcal{R}=\{r_1,\ldots,r_L\}\), điểm của tài liệu \(d\) được tính:

\[
\operatorname{RRF}(d)=
\sum_{\ell=1}^{L}
\frac{w_\ell}{k_0+\operatorname{rank}_{r_\ell}(d)}.
\tag{2.5}
\]

Ở đây, \(\operatorname{rank}_{r_\ell}(d)\) là vị trí của \(d\) trong danh sách \(r_\ell\); \(k_0>0\) làm giảm tác động quá lớn của các vị trí đầu; \(w_\ell\) là trọng số tùy chọn của kênh. Phiên bản gốc có thể dùng trọng số bằng nhau, còn weighted rank fusion là biến thể cần được mô tả riêng.

RRF có ưu điểm không cần đưa score từ các retriever về cùng thang đo và có khả năng nâng các tài liệu xuất hiện tốt ở nhiều danh sách. Tuy nhiên, nó chỉ nhìn thứ hạng, không phân biệt hai tài liệu có score sát nhau hay chênh lệch lớn. RRF cũng không joint-model query–passage; do đó nó thường đóng vai trò hợp nhất candidate trước cross-encoder reranking.

## 2.4. Truy hồi phân cấp và Retrieval-Augmented Generation

### 2.4.1. Biểu diễn và truy hồi ở nhiều độ phân giải

Truy hồi phân cấp giải quyết sự khác biệt giữa câu hỏi chi tiết và câu hỏi tổng hợp bằng cách lập chỉ mục ở nhiều mức. Các node lá thường giữ đoạn gốc; node cao hơn có thể giữ nhóm chủ đề, mục hoặc tóm tắt. Retrieval có thể tìm trên toàn bộ cây, đi từ tổng quan xuống chi tiết hoặc chọn node theo loại truy vấn.

RAPTOR là một phương pháp tiêu biểu: các đoạn được embedding và phân cụm, mỗi cụm được tóm tắt, rồi quy trình lặp để tạo cây trừu tượng [16]. So với flat retrieval, cây cung cấp bằng chứng tổng hợp cho câu hỏi cần kết nối nhiều đoạn. Tuy nhiên, summary node là nội dung sinh nên có thể mất chi tiết hoặc đưa sai lệch; việc xây cây cũng tốn model calls và cần chiến lược cập nhật khi corpus thay đổi.

Không phải mọi cấu trúc nhiều mức đều là RAPTOR. Cây dựa trên heading, document/section index hoặc router heuristic có giả định và chi phí khác với recursive clustering. Khi so sánh, cần phân biệt cấu trúc node, cách tạo summary, retrieval policy và liệu node cao trả lời trực tiếp hay chỉ định tuyến tới bằng chứng gốc.

### 2.4.2. Retrieval-Augmented Generation

Retrieval-Augmented Generation kết hợp mô hình truy hồi với mô hình sinh nhằm cung cấp tri thức ngoài tham số mô hình. Trong RAG gốc, tài liệu được xem như biến tiềm ẩn và bộ sinh điều kiện hóa trên truy vấn cùng các tài liệu truy hồi [6]. Ở mức khái quát, với query \(q\), corpus \(D\), tập bằng chứng \(R_k(q)\) và câu trả lời \(a\), quy trình có thể biểu diễn:

\[
R_k(q)=\operatorname{Retrieve}(q,D),\qquad
a=G(q,R_k(q)).
\tag{2.6}
\]

RAG cho phép cập nhật kho tri thức mà không nhất thiết huấn luyện lại toàn bộ generator và cung cấp một đường dẫn tiềm năng từ câu trả lời tới nguồn. Tuy nhiên, biểu thức (2.6) cho thấy generator phụ thuộc trực tiếp vào \(R_k(q)\): nếu tập này thiếu, nhiễu hoặc sai, generation có thể vẫn tạo câu trả lời thuyết phục nhưng không chính xác.

RAG hiện đại thường tách thành ingestion, retrieval, context construction và generation. Cách phân rã này tạo điều kiện đánh giá từng tầng nhưng cũng làm sai số có thể lan truyền. Do đó, kết quả end-to-end cần được phân tích cùng retrieval metrics và grounding metrics, không chỉ answer correctness.

### 2.4.3. Các nguồn sai số trong pipeline RAG

Sai số RAG có thể xuất hiện trước, trong và sau retrieval. Ở ingestion, extraction hoặc chunking có thể làm mất bằng chứng. Ở retrieval, query mơ hồ, domain shift, index mismatch hoặc candidate budget nhỏ có thể bỏ sót đoạn liên quan. Ở context construction, cắt context có thể loại bỏ bằng chứng hoặc giữ quá nhiều nhiễu. Ở generation, mô hình có thể diễn giải sai, hợp nhất các nguồn không tương thích hoặc thêm claim không có trong context.

RAGTruth cung cấp bằng chứng thực nghiệm rằng phản hồi RAG vẫn có thể chứa khẳng định không được nguồn hỗ trợ hoặc mâu thuẫn với nội dung truy hồi [8]. CRAG tập trung vào trường hợp retrieval sai, dùng evaluator để phân loại chất lượng và chọn hành động hiệu chỉnh trước generation [7]. Hai hướng này bổ sung nhau: RAGTruth mô tả và gán nhãn lỗi đầu ra, còn CRAG can thiệp vào bằng chứng đầu vào.

Một nguồn sai số khác là đánh đồng relevance với truth. Đoạn có liên quan về chủ đề vẫn có thể lỗi thời, mâu thuẫn hoặc không đủ để hỗ trợ kết luận. Vì vậy, pipeline evidence-aware cần tách retrieval relevance, contradiction, completeness và provenance thay vì gói chúng trong một điểm duy nhất.

### 2.4.4. Semantic cache và cơ chế trả lời nhanh

Semantic cache lưu cặp truy vấn–kết quả và dùng độ tương đồng ngữ nghĩa thay cho exact string match để quyết định tái sử dụng. GPTCache mô tả kiến trúc trong đó query được kiểm tra ở cache trước khi gọi LLM; khi tìm được entry phù hợp, hệ thống trả kết quả đã lưu để giảm số lần gọi và độ trễ [23]. Khác với KV cache ở tầng suy luận Transformer, semantic cache hoạt động ở tầng ứng dụng và tái sử dụng output giữa các yêu cầu khác nhau.

Về hình thức, với tập cache \(\mathcal{K}=\{(\mathbf{e}_{q_i},a_i,m_i)\}\), query mới \(q\) tạo embedding \(\mathbf{e}_q\) và tìm entry gần nhất. Cache hit xảy ra nếu:

\[
\max_i \operatorname{cos}(\mathbf{e}_q,\mathbf{e}_{q_i})\ge \tau
\quad\text{và}\quad
\operatorname{Compatible}(m_q,m_i)=1,
\tag{2.7}
\]

trong đó \(\tau\) là ngưỡng tương đồng và \(m_i\) chứa scope như nguồn, bộ lọc, model hoặc phiên bản index. Điều kiện compatibility cần thiết vì hai câu hỏi gần nghĩa nhưng áp dụng lên nguồn khác nhau không thể dùng chung câu trả lời.

Semantic cache tạo một sự đánh đổi rủi ro. Ngưỡng quá cao làm giảm hit rate; ngưỡng quá thấp có thể trả câu trả lời sai ngữ cảnh. Cache còn có thể giữ kết quả cũ sau khi nguồn thay đổi hoặc tái sử dụng một câu trả lời đã bị người duyệt từ chối. Vì vậy, cache key, scope, TTL, invalidation và chính sách chỉ ghi kết quả hợp lệ là phần của phương pháp, không chỉ là tối ưu hạ tầng. Trong kiến trúc nghiên cứu, cache phải được đánh giá như một fast path với quality–latency trade-off riêng.

## 2.5. Tinh lọc và hiệu chỉnh bằng chứng

### 2.5.1. Cross-encoder reranking

Các bộ truy hồi bước đầu phải chấm điểm trên toàn bộ hoặc một phần lớn kho dữ liệu nên thường tách việc mã hóa truy vấn và tài liệu để tái sử dụng vector. Cách tách này phù hợp với tìm kiếm quy mô lớn, nhưng tương tác chi tiết giữa từng từ trong truy vấn và từng đoạn chỉ được biểu diễn gián tiếp. Cross-encoder giải quyết hạn chế đó bằng cách đưa cặp truy vấn–đoạn vào cùng một mô hình, cho phép self-attention mô hình hóa trực tiếp các tương tác giữa hai chuỗi. Nghiên cứu về passage reranking bằng BERT cho thấy mô hình kiểu này thích hợp với tầng tái xếp hạng trên một tập ứng viên nhỏ do retriever nhanh tạo ra [24].

Với tập ứng viên \(C(q)=\{c_1,\ldots,c_m\}\), cross-encoder tính:

\[
s_i=f_{\theta}([q;c_i]),\qquad
R_k^{\mathrm{ce}}(q)=\operatorname{TopK}_{c_i\in C(q)}s_i,
\tag{2.8}
\]

trong đó \(f_{\theta}\) là mô hình mã hóa chung và \(s_i\) là điểm liên quan của cặp. Khác với cosine similarity, \(s_i\) không nhất thiết là xác suất và có thể chưa được hiệu chỉnh giữa các mô hình. Vì vậy, ngưỡng sử dụng score trong một tầng đánh giá kế tiếp phải được kiểm định, không nên mặc nhiên coi mọi score cross-encoder nằm trên cùng thang đo.

Cross-encoder thường cải thiện khả năng phân biệt trong candidate pool, nhưng chi phí suy luận tăng gần tuyến tính theo số cặp. Nó cũng không sửa được lỗi recall nếu bằng chứng đúng không xuất hiện trong tập ứng viên ban đầu. Ngoài ra, các biến thể BERT-based có thể nhạy với nhiễu bề mặt như lỗi chính tả; nghiên cứu về passage retrieval và ranking trong điều kiện typo cho thấy độ bền của mô hình cần được đánh giá riêng thay vì suy ra từ kết quả trên dữ liệu sạch [25]. Do đó, reranking phù hợp ở giữa retrieval và evidence grading, với candidate budget, độ trễ và cơ chế fallback được kiểm soát.

### 2.5.2. Natural Language Inference và phát hiện mâu thuẫn

Natural Language Inference (NLI) xét quan hệ giữa một tiền đề \(p\) và một giả thuyết \(h\), thường theo ba nhãn: entailment, neutral và contradiction. SNLI đặt nền tảng dữ liệu quy mô lớn cho bài toán này [26]; MultiNLI mở rộng sang nhiều thể loại ngôn ngữ [27]; XNLI cung cấp bộ đánh giá xuyên ngôn ngữ cho các biểu diễn câu đa ngữ [28]. Với mô hình \(g_{\phi}\), phân phối nhãn có thể viết:

\[
\mathbf{p}(y\mid p,h)=\operatorname{softmax}(g_{\phi}(p,h)),
\quad y\in\{E,N,C\}.
\tag{2.9}
\]

Trong pipeline bằng chứng, hai đoạn có thể được kiểm tra theo một hoặc cả hai chiều vì contradiction không nhất thiết đối xứng về mặt xác suất mô hình. Khi xác suất nhãn \(C\) vượt ngưỡng, hệ thống có thể gắn cờ cặp mâu thuẫn, giảm trọng số hoặc loại một đoạn theo chính sách đã định. Gắn cờ bảo toàn thông tin cho kiểm toán; loại bỏ tự động giảm nhiễu context nhưng có nguy cơ xóa bằng chứng đúng nếu mô hình sai hoặc hai đoạn chỉ khác điều kiện, thời điểm hay phạm vi.

Việc chuyển NLI từ câu sang đoạn dài tạo thêm giới hạn: một đoạn có thể chứa nhiều mệnh đề, trong đó chỉ một phần mâu thuẫn; cắt ngắn đầu vào cũng có thể bỏ mất điều kiện phủ định. XNLI hỗ trợ cơ sở lý thuyết cho đánh giá NLI đa ngữ, nhưng không tự xác nhận chất lượng của mọi checkpoint đa ngữ cụ thể. Vì vậy, NLI trong RAG nên được xem là tầng phát hiện rủi ro có ngưỡng và phạm vi cặp hữu hạn; hiệu quả phải được đo bằng dữ liệu mâu thuẫn có nhãn, đồng thời ghi lại các đoạn bị tác động và quyết định sau kiểm tra.

### 2.5.3. Đánh giá chất lượng bằng chứng và Corrective RAG

Reranking trả lời câu hỏi “đoạn nào phù hợp hơn trong tập ứng viên”, nhưng không bảo đảm tập bằng chứng đủ để sinh câu trả lời. Corrective Retrieval-Augmented Generation (CRAG) bổ sung một evaluator để ước lượng chất lượng retrieval và chọn hành động hiệu chỉnh trước generation. Trong phương pháp gốc, evaluator phân loại retrieval theo các trạng thái đúng, sai hoặc không rõ ràng; tùy trạng thái, quy trình có thể lọc–tinh lọc tri thức, sử dụng nguồn ngoài hoặc tiếp tục sinh [7]. Nguồn CRAG được dùng ở đây là bản tiền công bố arXiv, do đó không được mô tả như một công trình đã phản biện nếu chưa có bằng chứng xuất bản khác.

Gọi \(E_q\) là tập bằng chứng và \(G(E_q,q)\) là hàm đánh giá, quyết định có thể biểu diễn:

\[
z=G(E_q,q)\in\{\text{correct},\text{ambiguous},\text{wrong}\}.
\tag{2.10}
\]

Ba trạng thái tạo ra chính sách khác nhau: correct cho phép chuyển sang dựng context; ambiguous chỉ ra tín hiệu chưa đủ chắc chắn; wrong cho thấy bằng chứng hiện tại không phù hợp. Điểm mạnh của cách phân loại là tách quyết định “có nên sinh” khỏi generator. Tuy nhiên, hiệu quả phụ thuộc vào độ tin cậy và calibration của grader. Grader học máy cần dữ liệu hoặc mô hình bổ sung; grader heuristic dễ tái lập hơn nhưng các ngưỡng phải được hiệu chỉnh thực nghiệm.

Khái niệm CRAG trong cơ sở lý thuyết không đồng nhất với mọi hệ thống dùng ba nhãn nói trên. Phương pháp của dự án, được trình bày ở Chương 3, là một sự điều chỉnh heuristic của ý tưởng corrective retrieval chứ không phải bản tái hiện đầy đủ kiến trúc CRAG gốc. Phân biệt này cần được duy trì khi thiết kế đối chứng và diễn giải kết quả.

### 2.5.4. Query rewriting và truy hồi hiệu chỉnh hữu hạn

Khi bằng chứng bị đánh giá là thiếu hoặc không rõ, chỉ chạy lại retriever với cùng truy vấn thường tạo cùng kết quả. Query rewriting tạo một biểu diễn truy hồi mới nhằm bổ sung thuật ngữ, làm rõ thực thể hoặc diễn đạt lại nhu cầu thông tin. Query2doc cho thấy mô hình ngôn ngữ có thể sinh pseudo-document để mở rộng truy vấn, nhờ đó thu hẹp khoảng cách từ vựng giữa query và tài liệu [29]. Trong corrective RAG, rewrite đóng vai trò hành động sau đánh giá retrieval [7].

Cần phân biệt truy vấn gốc \(q_0\), phản ánh ý định người dùng, với truy vấn hiệu chỉnh \(q_t\), phục vụ retrieval ở vòng \(t\):

\[
q_{t+1}=W(q_t,E_t,z_t),\qquad
E_{t+1}=\operatorname{Retrieve}(q_{t+1},D),
\quad 0\le t<T.
\tag{2.11}
\]

Trong đó \(W\) là bộ rewrite, \(z_t\) là đánh giá chất lượng và \(T\) là ngân sách vòng hữu hạn. Generator cuối nên tiếp tục nhận \(q_0\), còn \(q_t\) chỉ tối ưu hóa truy hồi; nếu ghi đè vĩnh viễn truy vấn gốc, hệ thống có thể trả lời một câu hỏi đã bị dịch chuyển ý định. Vòng lặp hữu hạn ngăn chi phí và độ trễ tăng không kiểm soát. Khi rewrite thất bại hoặc không làm thay đổi truy vấn, chính sách an toàn là tái sử dụng truy vấn trước, ghi nhận trạng thái suy giảm và dừng khi hết ngân sách.

Query rewriting có thể tăng recall nhưng cũng có thể thêm khái niệm không tồn tại trong yêu cầu ban đầu. Vì vậy, cần đánh giá riêng tỷ lệ rewrite thành công, chất lượng bằng chứng trước–sau rewrite, số vòng trung bình và tỷ lệ query drift. Nó không thay thế reranker hay grader mà nối hai thành phần thành một cơ chế phản hồi có điều kiện.

## 2.6. Sinh nội dung có căn cứ và sự tham gia của con người

### 2.6.1. Grounded generation

Grounded generation yêu cầu nội dung sinh được điều kiện hóa trên một tập bằng chứng xác định và các khẳng định quan trọng phải phù hợp với bằng chứng đó. RAG cung cấp cơ chế đưa tri thức ngoài tham số vào generator [6], nhưng việc có context không đồng nghĩa generator luôn tuân thủ context. RAGTruth cho thấy đầu ra RAG vẫn có thể chứa thông tin không được hỗ trợ hoặc mâu thuẫn với nguồn [8]. Vì vậy, groundedness là thuộc tính phải đánh giá ở đầu ra, không phải thuộc tính tự động có chỉ vì pipeline đã thực hiện retrieval.

Với tập claim \(\mathcal{A}=\{a_1,\ldots,a_n\}\) của câu trả lời và tập bằng chứng \(E\), một yêu cầu lý tưởng là:

\[
\forall a_i\in\mathcal{A}_{\mathrm{verifiable}},
\quad \exists e_j\in E:\ e_j\models a_i,
\tag{2.12}
\]

trong đó \(e_j\models a_i\) biểu thị bằng chứng hỗ trợ claim. Điều kiện này làm rõ hai nguồn lỗi: claim không có bằng chứng và bằng chứng được dẫn nhưng không hỗ trợ claim. Trong thực tế, việc xác định entailment có thể cần con người hoặc bộ đánh giá tự động; cả hai đều có sai số.

Grounded generation còn phụ thuộc vào cách xây context. Context quá ngắn làm giảm coverage; context quá dài có thể đưa nhiễu và làm mô hình bỏ qua vị trí quan trọng [1]. Vì thế, generation phải được xem là giai đoạn cuối của chuỗi chọn lọc bằng chứng, với cơ chế từ chối hoặc nêu thiếu bằng chứng khi điều kiện hỗ trợ không đạt.

### 2.6.2. Provenance, citation và khả năng truy vết

Provenance mô tả nguồn gốc và đường đi của thông tin từ tài liệu, đoạn, quá trình biến đổi tới sản phẩm sinh. Citation là biểu hiện hướng người đọc của provenance: một chỉ dẫn từ claim hoặc đơn vị nội dung tới nguồn có thể kiểm tra. ALCE chỉ ra rằng chất lượng câu trả lời có dẫn nguồn cần đánh giá riêng tính đúng của citation và mức độ đầy đủ của citation, thay vì chỉ chấm chất lượng văn bản [9].

Một liên kết citation có thể được mô hình hóa là \(L\subseteq\mathcal{A}\times E\). Citation correctness hỏi mỗi cặp \((a_i,e_j)\in L\) có thực sự hỗ trợ nhau hay không; citation completeness hỏi các claim cần kiểm chứng đã có ít nhất một liên kết phù hợp hay chưa. Định danh bền vững của tài liệu và đoạn, metadata về trang/mục, cùng khả năng lấy lại văn bản nguồn là điều kiện kỹ thuật để liên kết này có thể kiểm toán.

Provenance ở mức sản phẩm không nhất thiết là citation verification ở mức claim. Một hệ thống có thể bảo toàn chunk ID trong tóm tắt hoặc sơ đồ tư duy nhưng vẫn chưa chứng minh từng mệnh đề được đoạn đó hỗ trợ. Do đó, báo cáo phải tách “định danh nguồn còn tồn tại” khỏi “citation đúng về ngữ nghĩa”; hai thuộc tính này cần chỉ số và dữ liệu đánh giá khác nhau.

### 2.6.3. Human-in-the-Loop trong hệ thống sinh nội dung

Human-in-the-Loop (HITL) đặt con người vào một hoặc nhiều điểm quyết định của quy trình NLP để cung cấp nhãn, phản hồi, sửa nội dung hoặc kiểm soát hành động [10]. Trong hệ thống sinh nội dung, một review gate sau generation có thể cung cấp ba quyết định cơ bản: phê duyệt bản nháp, chỉnh sửa rồi tiếp tục, hoặc từ chối. Thiết kế này phân biệt rõ *system-generated draft* với *human-reviewed final answer*.

HITL không tự bảo đảm chất lượng nếu giao diện thiếu bằng chứng, quyết định không được lưu hoặc mặc định im lặng thành “đã duyệt”. Các hướng dẫn tương tác người–AI nhấn mạnh việc làm rõ trạng thái, cho phép sửa sai và hỗ trợ người dùng kiểm soát đầu ra [11]. Quan điểm AI lấy con người làm trung tâm cũng đặt độ tin cậy, an toàn và khả năng kiểm soát cạnh năng lực tự động [12]. Vì vậy, review gate cần bảo toàn bản nháp, bằng chứng, hành động, nội dung chỉnh sửa và trạng thái tiếp tục.

Chi phí của HITL là thời gian chờ và công sức người duyệt; chất lượng còn phụ thuộc chuyên môn và mức nhất quán giữa reviewer. Đánh giá HITL phải đo riêng tỷ lệ approve/edit/reject, thời gian duyệt, mức thay đổi, chất lượng trước–sau duyệt và tỷ lệ claim không được hỗ trợ. Không thể dùng Recall@k của retriever để kết luận về hiệu quả của giai đoạn con người.

## 2.7. Sinh sản phẩm tri thức có cấu trúc

### 2.7.1. Tóm tắt tài liệu dài và tóm tắt phân cấp

Tóm tắt tài liệu dài gặp giới hạn đầu vào, phân bố thông tin không đều và nhu cầu kết nối nội dung ở nhiều phần xa nhau. Các phương pháp đa giai đoạn chia đầu vào, tóm tắt cục bộ rồi hợp nhất. SummN là một khung đa giai đoạn cho hội thoại và tài liệu dài, trong đó đầu ra của một tầng được nén để trở thành đầu vào tầng sau [30]. LongT5 tiếp cận từ kiến trúc mô hình, mở rộng khả năng text-to-text trên chuỗi dài bằng attention hiệu quả [31]. Hai hướng phản ánh hai lựa chọn: tổ chức pipeline phân cấp hoặc tăng dung lượng xử lý ngữ cảnh của mô hình.

Tóm tắt phân cấp giảm số token trong mỗi lời gọi và cho phép gắn kết quả trung gian với phần nguồn. Hạn chế là lỗi hoặc thiếu sót ở summary cục bộ có thể lan truyền sang bản tổng hợp; việc nén lặp lại có thể xóa chi tiết hiếm nhưng quan trọng. Mặt khác, đưa toàn bộ tài liệu vào mô hình long-context không loại bỏ hiện tượng sử dụng bằng chứng không đồng đều theo vị trí [1]. Vì vậy, lựa chọn phải được đánh giá đồng thời về coverage, faithfulness, redundancy và chi phí.

### 2.7.2. Tóm tắt theo cấu trúc section-first

Section-first coi cấu trúc mục của tài liệu là đơn vị tổ chức trước khi sinh tóm tắt. Thay vì chia chỉ theo độ dài, quy trình xác định các section, thu thập các đoạn thuộc từng section, tạo summary cục bộ, rồi tổng hợp thành overview. Các mô hình tóm tắt có nhận biết diễn ngôn cho thấy cấu trúc phân cấp giữa từ, câu và đơn vị diễn ngôn có thể được đưa vào cơ chế chọn nội dung [32]; các khung đa giai đoạn như SummN cung cấp nền tảng cho việc tổng hợp từ các kết quả trung gian [30].

Ưu điểm của section-first là giữ quan hệ giữa nội dung và bố cục gốc, tạo điểm kiểm tra coverage theo mục và thuận lợi cho provenance. Tuy nhiên, tiêu đề không phải lúc nào cũng phản ánh chủ đề tốt; tài liệu không có cấu trúc rõ có thể buộc hệ thống dùng outline suy ra hoặc một section dự phòng. “Section-first” trong báo cáo này nên được hiểu là một mẫu thiết kế tổng hợp dựa trên cấu trúc, không phải một thuật toán đã được chuẩn hóa thống nhất trong tài liệu học thuật.

### 2.7.3. Biểu diễn tri thức dạng cây và sơ đồ tư duy

Sơ đồ khái niệm hoặc mind map biểu diễn tri thức bằng node khái niệm và edge quan hệ, giúp chuyển nội dung tuyến tính thành cấu trúc có thể duyệt. Nghiên cứu về tự động tạo concept map từ tài liệu cho thấy quy trình thường phải nhận diện khái niệm, xác lập quan hệ và tổ chức cấu trúc, đặc biệt khó trong ngôn ngữ có hình thái phong phú [33].

Chất lượng một sản phẩm dạng cây không thể đánh giá chỉ bằng độ trôi chảy của nhãn node. Các chiều quan trọng gồm độ phủ khái niệm, tính đúng của quan hệ cha–con, tính đúng của liên kết chéo, mức trùng lặp và khả năng truy về nguồn. Một cấu trúc quá nông làm mất phân cấp; quá sâu hoặc quá nhiều nhánh làm giảm khả năng đọc. Nếu LLM tự do sinh cả cây trong một lượt, node ID, evidence link và độ ổn định giữa các lần chạy cũng khó kiểm soát.

### 2.7.4. Sinh cấu trúc skeleton-first và làm giàu có ràng buộc

Skeleton-first là mẫu thiết kế trong đó hệ thống dựng trước một bộ khung node bằng tín hiệu cấu trúc hoặc phương pháp xác định, sau đó dùng mô hình sinh để bổ sung mô tả, ví dụ và quan hệ trong phạm vi bộ khung. Cách tổ chức này kế thừa trực giác của xử lý cấu trúc tài liệu [15] và các bước nhận diện khái niệm–quan hệ trong tạo concept map [33], nhưng không nên được trình bày như một thuật toán chuẩn hóa đã có một định nghĩa duy nhất trong văn liệu.

Bộ khung tạo ràng buộc về số nhánh, ID và quan hệ phân cấp; bước làm giàu chỉ được tham chiếu các evidence ID hợp lệ. Thiết kế này tạo điều kiện cho suy giảm có kiểm soát: nếu bước sinh quan hệ thất bại, cây cơ sở vẫn tồn tại; nếu bằng chứng không hợp lệ, phần làm giàu có thể bị loại mà không phá schema. Đổi lại, sai sót ở skeleton giới hạn không gian mà LLM có thể bổ sung, và một outline quá cứng có thể bỏ qua quan hệ liên mục. Vì vậy, đánh giá cần tách chất lượng skeleton, chất lượng enrichment và tính đúng provenance.

## 2.8. Cơ sở đánh giá phương pháp

### 2.8.1. Đánh giá chất lượng truy hồi

Đánh giá retrieval cần một tập truy vấn \(Q\), tập bằng chứng liên quan chuẩn \(G(q)\) cho từng truy vấn và ranking do hệ thống trả về. Recall@k đo tỷ lệ bằng chứng chuẩn xuất hiện trong top-k:

\[
\operatorname{Recall@k}(q)=
\frac{|R_k(q)\cap G(q)|}{|G(q)|}.
\tag{2.13}
\]

Precision@k đo tỷ lệ kết quả top-k là liên quan. Mean Reciprocal Rank (MRR) nhấn mạnh vị trí của kết quả liên quan đầu tiên:

\[
\operatorname{MRR}=
\frac{1}{|Q|}\sum_{q\in Q}\frac{1}{\operatorname{rank}_q},
\tag{2.14}
\]

trong đó \(\operatorname{rank}_q\) là vị trí của bằng chứng liên quan đầu tiên. Khi nhãn có nhiều mức liên quan, normalized Discounted Cumulative Gain phản ánh cả mức độ và vị trí [34]:

\[
\operatorname{DCG@k}=\sum_{i=1}^{k}
\frac{2^{\mathrm{rel}_i}-1}{\log_2(i+1)},\qquad
\operatorname{nDCG@k}=\frac{\operatorname{DCG@k}}{\operatorname{IDCG@k}}.
\tag{2.15}
\]

BEIR cho thấy kết quả retriever thay đổi đáng kể giữa các miền và tác vụ [5]. Vì vậy, bộ đánh giá của nghiên cứu cần có truy vấn fact, overview, paraphrase, thuật ngữ chính xác, truy vấn mơ hồ và truy vấn đa đoạn; đồng thời giữ cố định candidate budget và index khi so sánh. Recall@k phù hợp kiểm tra candidate generation, còn MRR/nDCG phù hợp đánh giá thứ hạng sau fusion và reranking.

### 2.8.2. Đánh giá grounded QA và citation

Grounded QA cần tách ít nhất ba chiều: tính đúng của câu trả lời, mức được bằng chứng hỗ trợ và mức liên quan của context. RAGAS đề xuất đánh giá tự động nhiều thành phần của RAG thay vì một điểm duy nhất [13]; ARES kết hợp các bộ đánh giá thích nghi với dữ liệu và hiệu chỉnh bằng một lượng nhãn người hạn chế [14]. Hai hướng này hữu ích cho thiết kế giao thức, nhưng điểm tự động không thay thế hoàn toàn nhãn chuyên gia.

Đối với citation, ALCE phân biệt chất lượng nội dung với chất lượng dẫn nguồn [9]. Với \(N_c\) citation được tạo, \(N_s\) citation thực sự hỗ trợ claim và \(N_r\) claim cần dẫn nguồn, có thể dùng:

\[
P_{\mathrm{cite}}=\frac{N_s}{N_c},\qquad
R_{\mathrm{cite}}=
\frac{N_{\mathrm{claim\ có\ hỗ\ trợ\ và\ citation}}}{N_r}.
\tag{2.16}
\]

Citation precision trả lời “citation đã nêu có đúng không”, còn citation recall/completeness trả lời “các claim cần kiểm chứng đã được dẫn đủ chưa”. Unsupported claim rate bổ sung bằng tỷ lệ claim kiểm chứng được nhưng không có bằng chứng hỗ trợ. RAGTruth cung cấp taxonomy và dữ liệu cho việc nhận diện claim không được hỗ trợ hoặc mâu thuẫn trong đầu ra RAG [8].

### 2.8.3. Đánh giá tóm tắt và sơ đồ tư duy

Tóm tắt có thể được đánh giá tự động bằng mức chồng lấp với reference, nhưng với tài liệu dài, coverage và faithfulness cần được chấm riêng. Các phương pháp đa giai đoạn như SummN thường báo cáo metric tóm tắt chuẩn, song cấu trúc pipeline còn đòi hỏi kiểm tra liệu thông tin quan trọng ở mỗi phần có sống sót qua các tầng hay không [30]. Một rubric phù hợp nên gồm độ phủ ý chính, tính có căn cứ, redundancy, tổ chức theo mục và citation validity.

Sơ đồ tư duy khó có một reference duy nhất vì nhiều cây có thể hợp lý cho cùng tài liệu. Cần kết hợp so khớp khái niệm, đánh giá quan hệ cha–con/liên kết chéo và chấm của con người. Nghiên cứu tạo concept map tự động cung cấp cơ sở để xem nhận diện khái niệm và quan hệ là hai nhiệm vụ tách biệt [33]. Đối với skeleton-first, nên đo thêm độ ổn định cấu trúc qua nhiều lần chạy và tỷ lệ node/edge có provenance hợp lệ.

### 2.8.4. Đánh giá HITL, hiệu năng và chi phí

Đánh giá HITL phải so sánh bản nháp tự động và bản cuối sau duyệt. Các chỉ số gồm approve/edit/reject rate, tỷ lệ claim được sửa, mức giảm unsupported claim, thời gian duyệt và độ nhất quán giữa reviewer. Các nghiên cứu về human-in-the-loop và tương tác người–AI nhấn mạnh rằng hiệu quả không chỉ phụ thuộc model mà còn phụ thuộc cách trình bày thông tin và quyền kiểm soát của người dùng [10], [11].

Hiệu năng cần được phân rã theo ingestion, retrieval, reranking, NLI, corrective rounds, generation và review wait time. Các đại lượng cần ghi gồm latency percentile, số lời gọi mô hình, số token, cache hit rate, fallback rate và chi phí trên truy vấn. HITL bổ sung một thành phần thời gian con người, do đó latency máy và thời gian hoàn tất nghiệp vụ phải được báo cáo riêng.

LLM-as-a-judge có thể hỗ trợ đánh giá quy mô lớn; G-Eval cho thấy khả năng dùng mô hình ngôn ngữ với tiêu chí và chuỗi suy luận để tăng tương quan với đánh giá người trên một số tác vụ NLG [35]. Tuy nhiên, các LLM evaluator có thể mang thiên lệch và không công bằng giữa các đầu ra hoặc hệ mô hình [36]. Vì vậy, Chapter 4 cần dùng đánh giá tự động như một nguồn bằng chứng, hiệu chỉnh bằng mẫu người chấm và báo cáo độ đồng thuận, không coi điểm judge là ground truth tuyệt đối.

## 2.9. Tổng hợp nghiên cứu liên quan và khoảng trống nghiên cứu

### 2.9.1. Các hướng biểu diễn và truy hồi tài liệu dài

Nhóm thứ nhất tập trung vào ranh giới biểu diễn. Chunking đơn giản dễ triển khai nhưng có thể cắt rời cấu trúc; structure-aware segmentation giữ dấu hiệu mục; late chunking trì hoãn pooling để đoạn nhận ngữ cảnh rộng [3], [4], [15]. Nhóm thứ hai tập trung vào không gian truy hồi: BM25 giữ tín hiệu lexical [19], dense retrieval hỗ trợ tương đồng ngữ nghĩa [20], còn hybrid và RRF khai thác tính bổ sung của ranking [5], [22]. Nhóm thứ ba đưa vào nhiều độ phân giải, điển hình như RAPTOR với cây tóm tắt đệ quy [16].

Các hướng này giải quyết những điểm nghẽn khác nhau nhưng không thay thế nhau. Cải thiện embedding không phục hồi một section đã bị extraction làm mất; hierarchical retrieval không bảo đảm ranking chi tiết; hybrid fusion không joint-model relevance. Khoảng trống thực nghiệm vì thế không chỉ là chọn một retriever, mà là xác định đóng góp và tương tác giữa biểu diễn, candidate generation, fusion và reranking trên cùng dữ liệu.

### 2.9.2. Các hướng evidence-aware và corrective RAG

Reranking cải thiện thứ tự trong candidate pool [24]; NLI cung cấp mô hình quan hệ entailment–contradiction [26]–[28]; CRAG đánh giá retrieval để chọn hành động sửa [7]; query expansion/rewrite làm thay đổi biểu diễn truy hồi [29]. Các kỹ thuật này tạo một chuỗi evidence refinement hợp lý, nhưng mỗi tầng có failure mode riêng: reranker thiếu recall, NLI có thể nhầm điều kiện, grader cần calibration và rewrite có thể làm lệch ý định.

Văn liệu đã chứng minh RAG không tự loại bỏ hallucination hoặc contradiction [8], đồng thời đề xuất các cơ chế sửa ở những vị trí khác nhau. Tuy nhiên, bằng chứng về từng module không đủ để suy ra rằng tích hợp toàn bộ luôn tốt hơn. Cần ablation theo tầng, ghi lại fallback và corrective rounds, và đánh giá cả chất lượng lẫn chi phí.

### 2.9.3. Các hướng sinh sản phẩm tri thức có provenance

RAG có citation tập trung vào liên kết claim–nguồn và đánh giá correctness/completeness [9]. Tóm tắt dài nghiên cứu phân cấp xử lý hoặc kiến trúc long-context [30], [31]. Concept-map generation tập trung vào trích khái niệm và quan hệ [33]. HITL bổ sung kiểm soát con người đối với nội dung sinh [10]–[12]. Các hướng này đều liên quan provenance nhưng ở đơn vị khác nhau: claim, section summary, node/edge hoặc quyết định review.

Một hạn chế chung là chất lượng nội dung và tính còn tồn tại của source ID đôi khi bị nhập làm một. Provenance kỹ thuật là điều kiện để kiểm tra, không tự chứng minh citation đúng. Ngược lại, một bản tóm tắt tốt về nội dung nhưng không giữ con trỏ nguồn sẽ khó kiểm toán hoặc sửa có mục tiêu. Vì vậy, đánh giá sản phẩm cấu trúc cần đồng thời xem coverage, faithfulness, cấu trúc và provenance validity.

### 2.9.4. Hạn chế của các cách tiếp cận hiện có

Tổng hợp văn liệu cho thấy các nghiên cứu thường tối ưu một lát cắt: segmentation, retriever, corrective generation, citation, tóm tắt, biểu diễn cây hoặc tương tác người–AI. Điều này tạo bốn hạn chế khi chuyển sang bài toán tài liệu dài dị thể. Thứ nhất, lỗi ingestion và representation có thể lan đến mọi đầu ra nhưng ít được đo cùng retrieval. Thứ hai, chất lượng evidence và chất lượng generation thường được báo cáo bằng metric riêng nhưng chưa luôn được truy vết qua cùng chunk ID. Thứ ba, fast path như semantic cache hoặc trả lời phân cấp có thể giảm độ trễ nhưng bỏ qua các tầng kiểm tra bằng chứng. Thứ tư, lợi ích của chuỗi rerank–NLI–corrective retrieval–HITL phải được cân bằng với latency, số model calls và công sức người duyệt.

Không có cơ sở để kết luận “chưa từng có nghiên cứu nào” kết hợp các thành phần này. Diễn giải thận trọng hơn là các công trình được rà soát có xu hướng xem xét riêng từng nhóm vấn đề, còn bằng chứng về sự tích hợp đồng thời biểu diễn cấu trúc, truy hồi đa giai đoạn, sản phẩm tri thức có provenance và review con người vẫn cần được kiểm chứng trong một giao thức thống nhất.

### 2.9.5. Vị trí của phương pháp được đề xuất

Phương pháp của đề tài được định vị như một pipeline document intelligence đa giai đoạn và nhận biết bằng chứng. Nó liên kết biểu diễn cấu trúc và late chunking có điều kiện với truy hồi lexical–semantic, tinh lọc và hiệu chỉnh bằng chứng, grounded generation, provenance và review con người; đồng thời tạo tóm tắt section-first và mind map skeleton-first. Đây là sự tích hợp và điều chỉnh các nguyên lý đã có, không được tuyên bố là phát minh một thuật toán nền tảng mới.

Ba ranh giới khái niệm cần được giữ rõ. Thứ nhất, biểu diễn Memory Tree của dự án không mặc nhiên là RAPTOR chỉ vì cùng dùng cấu trúc phân cấp. Thứ hai, grader heuristic của dự án không phải bản tái tạo đầy đủ CRAG gốc. Thứ ba, bảo toàn chunk/source tag không tương đương claim-level citation validation. Các khác biệt này là cơ sở để Chương 3 mô tả đúng phương pháp hiện thực và Chương 4 thiết kế đánh giá không vượt quá bằng chứng.

## 2.10. Tổng kết chương

Chương này đã xây dựng nền tảng lý thuyết theo dòng xử lý từ tài liệu đến sản phẩm tri thức. Ở phía biểu diễn, cấu trúc tài liệu, chunking, late chunking, embedding và chỉ mục đa mức quyết định đơn vị bằng chứng có thể truy hồi. Ở phía truy hồi, BM25 và dense retrieval cung cấp tín hiệu bổ sung; fusion, cross-encoder, NLI, grading và rewrite tạo thành các tầng chọn lọc–hiệu chỉnh. Ở phía sinh, groundedness, provenance và HITL đặt ra yêu cầu kiểm chứng vượt ra ngoài độ trôi chảy của văn bản.

Phần tổng hợp nghiên cứu liên quan cho thấy giá trị nghiên cứu không nằm ở việc liệt kê nhiều mô-đun, mà ở giả thuyết rằng một chuỗi tích hợp có thể xử lý đồng thời mất mát cấu trúc, thiếu bằng chứng, mâu thuẫn, truy vết và kiểm soát đầu ra. Giả thuyết này chưa được coi là kết quả; Chương 3 sẽ trình bày cách tích hợp thực tế, còn Chương 4 sẽ xác định bằng dữ liệu và ablation liệu từng quyết định có đóng góp hay chỉ làm tăng chi phí.

# B. BẢNG 2.1. SO SÁNH CÁC CHIẾN LƯỢC PHÂN ĐOẠN VÀ BIỂU DIỄN

| Chiến lược | Nguyên tắc | Ưu điểm | Hạn chế | Vai trò đánh giá |
|---|---|---|---|---|
| Phân đoạn cố định | Chia theo số ký tự/token cố định, có thể có overlap | Đơn giản, tái lập, kiểm soát kích thước | Có thể cắt giữa câu, mục hoặc bảng; không dùng cấu trúc | Baseline tối giản để đo tác động của cấu trúc |
| Phân đoạn đệ quy | Thử lần lượt các ranh giới tự nhiên rồi mới cắt nhỏ | Giữ được đoạn/câu tốt hơn fixed-size | Vẫn là heuristic; không hiểu ngữ nghĩa tài liệu | Baseline triển khai thực tế cho RQ1 |
| Phân đoạn ngữ nghĩa | Dùng thay đổi độ tương đồng/chủ đề để đặt ranh giới | Có khả năng gom nội dung cùng chủ đề | Không có một thuật toán chuẩn duy nhất; phụ thuộc embedding/ngưỡng | Chỉ so sánh khi định nghĩa và cấu hình được cố định |
| Phân đoạn nhận biết cấu trúc | Dùng heading, section và metadata để neo ranh giới | Bảo toàn bố cục và provenance theo mục | Phụ thuộc chất lượng extraction/heading | Thành phần chính cần đối chứng trong RQ1 [4], [15] |
| Embedding từng đoạn độc lập | Mã hóa mỗi chunk riêng | Dễ lập chỉ mục, cập nhật và truy hồi | Mất ngữ cảnh ngoài chunk | Baseline biểu diễn cho RQ1 [17] |
| Late chunking | Mã hóa trong cửa sổ ngữ cảnh rộng rồi pooling theo span | Đưa ngữ cảnh toàn cục hơn vào vector đoạn | Conditional theo model/độ dài/span; chi phí và bộ nhớ cao hơn | Biến can thiệp cần rebuild index và đánh giá riêng [3] |
| Biểu diễn đa mức | Lưu chunk cùng node section/document hoặc summary node | Hỗ trợ câu hỏi chi tiết và tổng quan | Chi phí xây/cập nhật; summary node có thể làm mất chi tiết | So sánh routing/fast path với flat retrieval [16] |

# C. BẢNG 2.2. SO SÁNH CÁC HỌ PHƯƠNG PHÁP TRUY HỒI

| Họ phương pháp | Tín hiệu chính | Điểm mạnh | Hạn chế | Chỉ số ưu tiên |
|---|---|---|---|---|
| Sparse/BM25 | Khớp thuật ngữ, TF saturation, length normalization | Mạnh với tên riêng, mã, cụm từ chính xác; dễ giải thích | Yếu với paraphrase và đồng nghĩa không trùng từ | Recall@k, MRR, nDCG [19] |
| Dense/vector | Tương đồng trong không gian embedding | Hỗ trợ tương đồng ngữ nghĩa và diễn đạt khác từ | Phụ thuộc domain/model; ANN tạo trade-off recall–latency | Recall@k, latency, memory [20], [21] |
| Hybrid lexical–semantic | Kết hợp sparse và dense | Bù trừ failure mode của hai kênh | Cần định nghĩa candidate budget, score/rank fusion | Recall@k, nDCG, robustness theo miền [5], [18] |
| Rank fusion/RRF | Tổng nghịch đảo thứ hạng | Không cần chuẩn hóa score; ổn định giữa nhiều ranking | Bỏ qua khoảng cách score; không joint-model query–passage | MRR, nDCG và phân tích đóng góp kênh [22] |
| Cross-encoder reranking | Tương tác chung query–passage | Phân biệt tốt hơn trong candidate pool | Chi phí theo số cặp; không phục hồi ứng viên bị bỏ sót | MRR/nDCG, latency, fallback [24] |
| Hierarchical retrieval | Truy hồi node ở nhiều độ phân giải | Phù hợp câu hỏi tổng quan và đa đoạn | Xây/cập nhật phức tạp; summary node có thể sai | Chất lượng theo query type, provenance [16] |

# D. BẢNG 2.3. VAI TRÒ CỦA RERANKER, NLI, CRAG VÀ QUERY REWRITING

| Thành phần | Câu hỏi phương pháp | Đầu vào | Đầu ra/quyết định | Rủi ro và fallback cần xem xét |
|---|---|---|---|---|
| Cross-encoder reranker | Trong candidate pool, đoạn nào liên quan nhất với query? | Query và các ứng viên từ retrieval/fusion | Ranking và score mới | Timeout/model failure → giữ ranking trước; score cần calibration [24], [25] |
| NLI | Các đoạn bằng chứng có quan hệ mâu thuẫn đáng kể không? | Cặp đoạn sau rerank | Nhãn/xác suất contradiction; tập đoạn được gắn cờ hoặc lọc | Sai do đoạn dài/điều kiện ngữ cảnh → giữ evidence và ghi trạng thái khi model lỗi [26]–[28] |
| Evidence grader/CRAG | Tập bằng chứng hiện tại đủ đúng để sinh chưa? | Query, evidence và các tín hiệu relevance | correct/ambiguous/wrong | Grader sai hoặc chưa hiệu chỉnh → fail-open có kiểm soát; không đồng nhất heuristic với CRAG gốc [7] |
| Query rewriting | Có thể cải thiện retrieval khi evidence thiếu/mơ hồ bằng cách nào? | Truy vấn hiện tại, grade và evidence | Truy vấn retrieval mới | Query drift, tăng model calls → giữ original query, giới hạn số vòng [7], [29] |

# E. BẢNG 2.4. TỔNG HỢP NGHIÊN CỨU LIÊN QUAN VÀ KHOẢNG TRỐNG

| Họ cách tiếp cận | Vấn đề chính | Cơ chế tiêu biểu | Điểm mạnh | Hạn chế còn lại | Quan hệ với đề tài |
|---|---|---|---|---|---|
| Long-context và segmentation | Mất ngữ cảnh, ranh giới đoạn | Long-context benchmark, structure-aware segmentation, late chunking | Làm rõ ảnh hưởng của vị trí/rìa đoạn | Chưa tự giải quyết ranking, grounding hoặc review | Cơ sở cho biểu diễn có cấu trúc và RQ1 [1]–[4] |
| Sparse, dense và hybrid retrieval | Tìm bằng chứng phù hợp trong miền dị thể | BM25, DPR, BGE-M3, RRF | Tín hiệu lexical và semantic bổ sung nhau | Không retriever nào thống trị mọi miền; fusion chưa joint-model | Cơ sở cho candidate generation và RQ2 [5], [18]–[22] |
| Hierarchical retrieval | Câu hỏi cần nhiều độ phân giải | Cây đoạn–summary như RAPTOR | Hỗ trợ truy vấn tổng quan/đa đoạn | Chi phí tạo node; summary có thể mất chi tiết | Tham chiếu so sánh, không đồng nhất với Memory Tree [16] |
| Evidence refinement/correction | Candidate nhiễu, thiếu hoặc mâu thuẫn | Reranking, NLI, CRAG, rewrite | Cho phép chọn lọc và sửa trước generation | Calibration, query drift, chi phí tích lũy | Cơ sở cho RQ2–RQ3 [7], [24]–[29] |
| Grounding và citation | Đầu ra có thể không được hỗ trợ | Claim–evidence attribution, citation metrics | Tăng khả năng kiểm tra | Provenance ID không đồng nghĩa semantic correctness | Cơ sở cho RQ4 [8], [9], [13], [14] |
| Tóm tắt và tri thức cấu trúc | Nén và tổ chức tài liệu dài | Multi-stage summary, long-context model, concept map | Tạo sản phẩm tổng hợp/điều hướng | Lỗi tầng trước lan truyền; nhiều cấu trúc hợp lệ | Cơ sở cho section-first, skeleton-first và RQ4 [30]–[33] |
| Human review | Kiểm soát quyết định đầu ra | Review, sửa, từ chối | Bổ sung phán đoán và trách nhiệm con người | Tốn thời gian; phụ thuộc reviewer và giao diện | Cơ sở cho RQ5 [10]–[12] |
| Khoảng trống tích hợp | Các chiều trên thường được nghiên cứu tách biệt | Pipeline thống nhất và ablation | Cho phép quan sát tương tác giữa tầng | Chưa có bằng chứng rằng tích hợp luôn tốt hơn | Đề tài kiểm chứng sự tích hợp, không tuyên bố chưa từng có tiền lệ |

# F. CÁC HÌNH VÀ PHƯƠNG TRÌNH CẦN THIẾT

## F.1. Kế hoạch hình

**Hình 2.1. Các mức biểu diễn của tài liệu dài.** Hình nên minh họa tài liệu gốc → section → chunk → vector, đồng thời phân biệt embedding từng đoạn với late chunking. Mục tiêu là làm rõ nơi cấu trúc/ngữ cảnh có thể bị mất. Vị trí: sau mục 2.2.3. Nguồn: tác giả tổng hợp từ [3], [4], [15]–[18].

**Hình 2.2. Quan hệ giữa sparse, dense, fusion và reranking.** Hai nhánh BM25/dense tạo candidate list, RRF hợp nhất và cross-encoder tinh lọc. Đây là hình lý thuyết, không phải sơ đồ runtime dự án. Vị trí: sau mục 2.3.4. Nguồn: tác giả tổng hợp từ [19]–[24].

**Hình 2.3. Vòng lặp corrective retrieval ở mức khái niệm.** Retrieval → reranking → NLI → evidence grading; correct đi tiếp, ambiguous/wrong kích hoạt rewrite và lặp trong ngân sách hữu hạn. Hình phải ghi rõ CRAG gốc và query rewriting là cơ sở lý thuyết, còn hiện thực heuristic sẽ trình bày ở Chương 3. Vị trí: sau mục 2.5.4. Nguồn: tác giả tổng hợp từ [7], [26]–[29].

**Hình 2.4. Phân biệt provenance kỹ thuật và citation correctness.** Một artifact giữ chunk ID nhưng cần bước kiểm tra quan hệ claim–evidence mới chứng minh citation đúng. Vị trí: sau mục 2.6.2. Nguồn: tác giả tổng hợp từ [8], [9].

**Hình 2.5. Không gian đánh giá đa chiều.** Các trục representation/retrieval, grounding/citation, artifact structure, HITL và cost; mỗi trục liên kết với RQ tương ứng. Vị trí: đầu mục 2.8. Nguồn: tác giả tổng hợp từ [5], [9], [13], [14], [34]–[36].

## F.2. Danh mục phương trình

| Số | Nội dung | Vai trò |
|---:|---|---|
| (2.1) | Pooling late chunk theo token span | Làm rõ khác biệt với embedding độc lập |
| (2.2) | Cosine similarity | Định nghĩa tín hiệu dense retrieval |
| (2.3) | BM25 | Giải thích TF saturation và length normalization |
| (2.4) | Top-k dense retrieval | Xác định đầu ra truy hồi vector |
| (2.5) | RRF có trọng số | Mô tả rank-level fusion |
| (2.6) | RAG ở dạng Retrieve–Generate | Nêu phụ thuộc của generation vào evidence |
| (2.7) | Điều kiện semantic-cache hit | Thể hiện similarity cùng scope compatibility |
| (2.8) | Cross-encoder reranking | Tách candidate generation và ranking tinh |
| (2.9) | Phân phối nhãn NLI | Định nghĩa entailment/neutral/contradiction |
| (2.10) | Ba trạng thái evidence grading | Mô hình hóa quyết định corrective retrieval |
| (2.11) | Vòng rewrite–retrieve hữu hạn | Giữ original intent và giới hạn số vòng |
| (2.12) | Điều kiện claim được evidence hỗ trợ | Chính xác hóa groundedness |
| (2.13)–(2.15) | Recall@k, MRR, nDCG | Đánh giá candidate coverage và ranking |
| (2.16) | Citation precision/recall | Tách correctness và completeness |

# G. DANH MỤC TÀI LIỆU THAM KHẢO TOÀN CỤC ĐÃ CẬP NHẬT

Danh mục sử dụng thứ tự xuất hiện đầu tiên trên toàn báo cáo. Các số [1]–[14] được giữ nguyên từ Chương 1; nguồn mới của Chương 2 bắt đầu từ [15]. Metadata lấy từ `reports/literature-evidence/phase6_report/references.bib`; định dạng số hiện là quy ước tạm thời cho đến khi có mẫu chính thức của cơ sở đào tạo.

[1] N. F. Liu et al., “Lost in the Middle: How Language Models Use Long Contexts,” *Transactions of the Association for Computational Linguistics*, 2024, doi: 10.1162/tacl_a_00638.

[2] Y. Bai et al., “LongBench: A Bilingual, Multitask Benchmark for Long Context Understanding,” in *ACL*, 2024, doi: 10.18653/v1/2024.acl-long.172.

[3] M. Günther, I. Mohr, D. J. Williams, B. Wang, and H. Xiao, “Late Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models,” *arXiv preprint arXiv:2409.04701*, 2024, doi: 10.48550/arXiv.2409.04701.

[4] Z. Wang et al., “Document Segmentation Matters for Retrieval-Augmented Generation,” in *Findings of ACL*, 2025, doi: 10.18653/v1/2025.findings-acl.422.

[5] N. Thakur et al., “BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models,” in *NeurIPS Datasets and Benchmarks*, 2021. [Online]. Available: https://datasets-benchmarks-proceedings.neurips.cc/paper/2021/hash/65b9eea6e1cc6bb9f0cd2a47751a186f-Abstract-round2.html

[6] P. Lewis et al., “Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks,” in *Advances in Neural Information Processing Systems*, 2020. [Online]. Available: https://proceedings.neurips.cc/paper/2020/hash/6b493230-Abstract.html

[7] S.-Q. Yan, J.-C. Gu, Y. Zhu, and Z.-H. Ling, “Corrective Retrieval Augmented Generation,” *arXiv preprint arXiv:2401.15884*, 2024, doi: 10.48550/arXiv.2401.15884.

[8] C. Niu et al., “RAGTruth: A Hallucination Corpus for Developing Trustworthy Retrieval-Augmented Language Models,” in *ACL*, 2024, doi: 10.18653/v1/2024.acl-long.585.

[9] T. Gao, H. Yen, J. Yu, and D. Chen, “Enabling Large Language Models to Generate Text with Citations,” in *EMNLP*, 2023, doi: 10.18653/v1/2023.emnlp-main.398.

[10] Z. J. Wang, D. Choi, S. Xu, and D. Yang, “Putting Humans in the Natural Language Processing Loop: A Survey,” in *Proceedings of HCINLP*, 2021. [Online]. Available: https://aclanthology.org/2021.hcinlp-1.8/

[11] S. Amershi et al., “Guidelines for Human-AI Interaction,” in *CHI Conference on Human Factors in Computing Systems*, 2019, doi: 10.1145/3290605.3300233.

[12] B. Shneiderman, “Human-Centered Artificial Intelligence: Reliable, Safe and Trustworthy,” *International Journal of Human-Computer Interaction*, vol. 36, no. 6, 2020, doi: 10.1080/10447318.2020.1741118.

[13] S. Es, J. James, L. Espinosa-Anke, and S. Schockaert, “RAGAS: Automated Evaluation of Retrieval Augmented Generation,” in *EACL System Demonstrations*, 2024, doi: 10.18653/v1/2024.eacl-demo.16.

[14] J. Saad-Falcon, O. Khattab, C. Potts, and M. Zaharia, “ARES: An Automated Evaluation Framework for Retrieval-Augmented Generation Systems,” in *NAACL-HLT*, 2024, doi: 10.18653/v1/2024.naacl-long.20.

[15] A. A. M. Gopinath, S. Wilson, and N. Sadeh, “Supervised and Unsupervised Methods for Robust Separation of Section Titles and Prose Text in Web Documents,” in *Proceedings of EMNLP*, 2018, doi: 10.18653/v1/D18-1099.

[16] P. Sarthi et al., “RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval,” in *International Conference on Learning Representations*, 2024. [Online]. Available: https://openreview.net/forum?id=GN921JHCRw

[17] N. Reimers and I. Gurevych, “Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks,” in *EMNLP-IJCNLP*, 2019, doi: 10.18653/v1/D19-1410.

[18] J. Chen, S. Xiao, P. Zhang, K. Luo, D. Lian, and Z. Liu, “M3-Embedding: Multi-Linguality, Multi-Functionality, Multi-Granularity Text Embeddings Through Self-Knowledge Distillation,” in *Findings of ACL*, 2024, doi: 10.18653/v1/2024.findings-acl.137.

[19] S. Robertson and H. Zaragoza, “The Probabilistic Relevance Framework: BM25 and Beyond,” *Foundations and Trends in Information Retrieval*, vol. 3, no. 4, 2009, doi: 10.1561/1500000019.

[20] V. Karpukhin et al., “Dense Passage Retrieval for Open-Domain Question Answering,” in *EMNLP*, 2020, doi: 10.18653/v1/2020.emnlp-main.550.

[21] J. Johnson, M. Douze, and H. Jégou, “Billion-Scale Similarity Search with GPUs,” *IEEE Transactions on Big Data*, 2019, doi: 10.1109/TBDATA.2019.2921572.

[22] G. V. Cormack, C. L. A. Clarke, and S. Buettcher, “Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods,” in *Proceedings of SIGIR*, 2009, doi: 10.1145/1571941.1572114.

[23] F. Bang, “GPTCache: An Open-Source Semantic Cache for LLM Applications Enabling Faster Answers and Cost Savings,” in *Proceedings of the 3rd Workshop for Natural Language Processing Open Source Software (NLP-OSS 2023)*, pp. 212–218, 2023, doi: 10.18653/v1/2023.nlposs-1.24.

[24] R. Nogueira and K. Cho, “Passage Re-ranking with BERT,” *arXiv preprint arXiv:1901.04085*, 2019, doi: 10.48550/arXiv.1901.04085.

[25] S. Zhuang and G. Zuccon, “Dealing with Typos for BERT-based Passage Retrieval and Ranking,” in *Proceedings of EMNLP*, 2021, doi: 10.18653/v1/2021.emnlp-main.225.

[26] S. R. Bowman, G. Angeli, C. Potts, and C. D. Manning, “A Large Annotated Corpus for Learning Natural Language Inference,” in *EMNLP*, 2015, doi: 10.18653/v1/D15-1075.

[27] A. Williams, N. Nangia, and S. R. Bowman, “A Broad-Coverage Challenge Corpus for Sentence Understanding through Inference,” in *NAACL-HLT*, 2018, doi: 10.18653/v1/N18-1101.

[28] A. Conneau et al., “XNLI: Evaluating Cross-lingual Sentence Representations,” in *EMNLP*, 2018, doi: 10.18653/v1/D18-1269.

[29] L. Wang, N. Yang, and F. Wei, “Query2doc: Query Expansion with Large Language Models,” in *EMNLP*, 2023, doi: 10.18653/v1/2023.emnlp-main.585.

[30] Y. Zhang et al., “SummN: A Multi-Stage Summarization Framework for Long Input Dialogues and Documents,” in *ACL*, 2022, doi: 10.18653/v1/2022.acl-long.112.

[31] M. Guo et al., “LongT5: Efficient Text-To-Text Transformer for Long Sequences,” in *Findings of NAACL*, 2022, doi: 10.18653/v1/2022.findings-naacl.55.

[32] T. Ishigaki, H. Kamigaito, H. Takamura, and M. Okumura, “Discourse-Aware Hierarchical Attention Network for Extractive Single-Document Summarization,” in *Proceedings of RANLP*, 2019, doi: 10.26615/978-954-452-056-4_059.

[33] K. Zubrinic, D. Kalpic, and M. Milicevic, “The Automatic Creation of Concept Maps from Documents Written Using Morphologically Rich Languages,” *Expert Systems with Applications*, vol. 39, no. 16, 2012, doi: 10.1016/j.eswa.2012.04.065.

[34] K. Järvelin and J. Kekäläinen, “Cumulated Gain-Based Evaluation of IR Techniques,” *ACM Transactions on Information Systems*, vol. 20, no. 4, 2002, doi: 10.1145/582415.582418.

[35] Y. Liu et al., “G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment,” in *EMNLP*, 2023, doi: 10.18653/v1/2023.emnlp-main.153.

[36] P. Wang et al., “Large Language Models are not Fair Evaluators,” in *ACL*, 2024, doi: 10.18653/v1/2024.acl-long.511.

# H. ÁNH XẠ SỐ TRÍCH DẪN TOÀN CỤC ↔ BIBTEX KEY

| Số | BibTeX key | Lần xuất hiện đầu tiên trong báo cáo |
|---:|---|---|
| [1] | `liu2024lost` | 1.1.1 |
| [2] | `bai2024longbench` | 1.1.1 |
| [3] | `gunther2024late` | 1.1.2 |
| [4] | `wang2025segmentation` | 1.1.2 |
| [5] | `thakur2021beir` | 1.1.2 |
| [6] | `lewis2020rag` | 1.1.2 |
| [7] | `yan2024crag` | 1.1.2 |
| [8] | `niu2024ragtruth` | 1.1.3 |
| [9] | `gao2023alce` | 1.1.3 |
| [10] | `wang2021hitl` | 1.1.3 |
| [11] | `amershi2019guidelines` | 1.1.3 |
| [12] | `shneiderman2020hcai` | 1.1.3 |
| [13] | `es2024ragas` | 1.6.4 |
| [14] | `saadfalcon2024ares` | 1.6.4 |
| [15] | `gopinath2018structure` | 2.1.2 |
| [16] | `sarthi2024raptor` | 2.1.3 |
| [17] | `reimers2019sbert` | 2.2.4 |
| [18] | `chen2024m3` | 2.2.4 |
| [19] | `robertson2009bm25` | 2.3.1 |
| [20] | `karpukhin2020dpr` | 2.3.2 |
| [21] | `johnson2019faiss` | 2.3.2 |
| [22] | `cormack2009rrf` | 2.3.4 |
| [23] | `bang2023gptcache` | 2.4.4 |
| [24] | `nogueira2019bert` | 2.5.1 |
| [25] | `zhuang2021typos` | 2.5.1 |
| [26] | `bowman2015snli` | 2.5.2 |
| [27] | `williams2018multinli` | 2.5.2 |
| [28] | `conneau2018xnli` | 2.5.2 |
| [29] | `wang2023query2doc` | 2.5.4 |
| [30] | `zhang2022summn` | 2.7.1 |
| [31] | `guo2022longt5` | 2.7.1 |
| [32] | `ishigaki2019discourse` | 2.7.2 |
| [33] | `zubrinic2012concept` | 2.7.3 |
| [34] | `jarvelin2002ndcg` | 2.8.1 |
| [35] | `liu2023geval` | 2.8.4 |
| [36] | `wang2024fair` | 2.8.4 |

# I. TRUY VẾT LUẬN ĐIỂM → NGUỒN HỌC THUẬT

| Nhóm luận điểm | Mục | Nguồn hỗ trợ | Ranh giới diễn giải |
|---|---|---|---|
| Mô hình long-context dùng thông tin không đều; đầu vào dài còn khó | 2.1.1 | [1], [2] | Không suy ra model cụ thể của dự án có cùng mức lỗi |
| Segmentation/structure ảnh hưởng retrieval và bảo toàn ngữ cảnh | 2.1.2; 2.2.1–2.2.2 | [4], [15] | Không có một định nghĩa học thuật duy nhất cho RecursiveCharacterTextSplitter |
| Late chunking đưa ngữ cảnh rộng vào embedding span | 2.2.3 | [3] | [3] là arXiv preprint; không chứng minh hiệu quả trong dự án |
| Bi-encoder, embedding đa ngữ/đa chức năng | 2.2.4 | [17], [18] | Paper BGE-M3 không chứng minh mọi cấu hình embedding dự án |
| BM25, dense retrieval, FAISS, hybrid và RRF | 2.3 | [5], [19]–[22] | FAISS là công cụ vector search, không phải DB đầy đủ; hybrid phải nêu fusion cụ thể |
| Hierarchical retrieval nhiều độ phân giải | 2.1.3; 2.4.1 | [16] | Không đồng nhất Memory Tree với RAPTOR |
| RAG phụ thuộc evidence và vẫn có unsupported claim | 2.4.2–2.4.3; 2.6.1 | [6], [8] | RAGTruth không chứng minh pipeline dự án mắc/giảm lỗi ở tỷ lệ nào |
| Semantic cache tái sử dụng kết quả theo similarity | 2.4.4 | [23] | Equation compatibility/scope là tổng hợp thiết kế, không phải nguyên văn paper |
| Cross-encoder reranking và độ bền với typo | 2.5.1 | [24], [25] | Không suy ra reranker luôn tăng nDCG trên dữ liệu nghiên cứu |
| NLI ba nhãn và đa ngữ | 2.5.2 | [26]–[28] | XNLI không xác nhận checkpoint mDeBERTa cụ thể |
| Corrective RAG và evidence grading | 2.5.3 | [7] | [7] là arXiv preprint; grader dự án là heuristic adaptation |
| Query expansion/rewrite | 2.5.4 | [7], [29] | Query2doc không định nghĩa toàn bộ corrective loop của dự án |
| Citation correctness/completeness | 2.6.2; 2.8.2 | [9] | Provenance ID không đồng nghĩa citation đúng ở mức claim |
| Human review và quyền kiểm soát | 2.6.3; 2.8.4 | [10]–[12] | Không chứng minh approve/edit/reject của dự án đã cải thiện chất lượng |
| Tóm tắt dài, phân cấp và section-aware | 2.7.1–2.7.2 | [30]–[32] | “Section-first” là mẫu thiết kế tổng hợp, không phải tên thuật toán chuẩn |
| Concept map và skeleton-first | 2.7.3–2.7.4 | [15], [33] | “Skeleton-first” là tổng hợp của tác giả; chưa có nguồn định nghĩa đồng nhất |
| Retrieval/grounding evaluation | 2.8.1–2.8.2 | [5], [9], [13], [14], [34] | Metric tự động cần qrels/nhãn người và không tự chứng minh chất lượng |
| LLM-as-a-judge và giới hạn | 2.8.4 | [35], [36] | Judge không được coi là ground truth tuyệt đối |

# J. TỰ RÀ SOÁT

1. **Cấu trúc:** Bản thảo chỉ chứa Chương 2 và giữ đủ các mục 2.1–2.10 theo cấu trúc được phê duyệt; không viết nội dung Chương 3 hoặc Chương 4.
2. **Đánh số trích dẫn:** [1]–[14] được tái sử dụng đúng ánh xạ Chương 1; nguồn mới bắt đầu tại [15] và tăng theo lần xuất hiện đầu tiên đến [36]. Không có BibTeX key hiển thị trong văn xuôi báo cáo; key chỉ xuất hiện ở bảng ánh xạ kỹ thuật theo yêu cầu.
3. **Kỷ luật bằng chứng:** Chương 2 chỉ mô tả lý thuyết và tổng hợp nghiên cứu liên quan; không dùng paper để chứng minh trạng thái runtime của dự án và không biến software test thành kết quả nghiên cứu.
4. **Công thức:** Mỗi phương trình (2.1)–(2.16) đều được giới thiệu và định nghĩa ký hiệu trong phần văn xuôi; các công thức phục vụ trực tiếp cho quyết định phương pháp hoặc đánh giá.
5. **Ranh giới nguồn:** Late Chunking [3] và CRAG [7] được ghi đúng là preprint arXiv. XNLI [28] không được dùng để xác nhận checkpoint cụ thể. Không gán một thuật toán chuẩn duy nhất cho semantic chunking hoặc recursive splitting.
6. **Ranh giới với dự án:** RAPTOR không bị đồng nhất với Memory Tree; CRAG gốc không bị đồng nhất với grader heuristic; provenance không bị đồng nhất với claim-level citation validation; section-first và skeleton-first được ghi là mẫu thiết kế tổng hợp.
7. **Không có tuyên bố hiệu năng:** Không có số liệu Recall, nDCG, faithfulness, latency, chi phí hay mức cải thiện được gán cho dự án. Tất cả metric chỉ là cơ sở cho thiết kế thực nghiệm sau này.
8. **Related work:** Mục 2.9 tổng hợp theo họ phương pháp, nêu strength–limitation–gap và dùng phát biểu khoảng trống thận trọng; không tuyên bố “chưa từng có nghiên cứu nào”.
9. **Điểm cần tác giả xác nhận:** Kiểu trích dẫn chính thức của cơ sở đào tạo vẫn chưa biết; danh mục hiện dùng numeric style tạm thời. Khi có template, nên sinh lại trình bày từ BibTeX nhưng giữ mapping toàn cục. Ngoài ra, thuật ngữ tiếng Anh như *late chunking*, *section-first*, *skeleton-first*, *grounded generation* và *Human-in-the-Loop* cần được thống nhất với quy định Việt hóa của đơn vị trước bản cuối.
