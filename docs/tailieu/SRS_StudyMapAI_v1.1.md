# SRS — ĐẶC TẢ YÊU CẦU PHẦN MỀM

# SRS — ĐẶC TẢ YÊU CẦU PHẦN MỀM

## StudyMap AI: Hệ thống tạo bản đồ học tập, quiz chẩn đoán và gợi ý ôn tập từ tài liệu

---

# 1. Giới thiệu

## 1.1. Mục đích tài liệu

Tài liệu SRS này mô tả các yêu cầu phần mềm của hệ thống **StudyMap AI**. Tài liệu được sử dụng làm cơ sở cho quá trình phân tích, thiết kế, phát triển, kiểm thử và đánh giá sản phẩm.

SRS tập trung làm rõ:

- Mục tiêu của hệ thống.
- Phạm vi chức năng.
- Đối tượng người dùng.
- Yêu cầu chức năng.
- Yêu cầu phi chức năng.
- Giao diện hệ thống.
- Dữ liệu cần lưu trữ.
- Các ràng buộc và giả định.
- Tiêu chí nghiệm thu.

---

## 1.2. Phạm vi hệ thống

**StudyMap AI** là hệ thống AI hỗ trợ học tập từ tài liệu do người dùng tải lên. Hệ thống có khả năng phân tích tài liệu học tập như PDF, slide, giáo trình hoặc ghi chú; sau đó tự động tạo bản đồ học tập, quiz chẩn đoán theo từng chủ đề, chấm kết quả làm bài, phát hiện phần kiến thức còn yếu và gợi ý chính xác chương, mục hoặc đoạn tài liệu cần ôn lại.

Phạm vi chính của hệ thống gồm:

```
Upload tài liệu
→ Phân tích tài liệu
→ Tạo bản đồ học tập
→ Tạo quiz chẩn đoán
→ Người học làm quiz
→ Chấm điểm
→ Phân tích chủ đề yếu
→ Gợi ý phần tài liệu cần ôn
→ Tạo câu luyện tập bổ sung
```

Trong phiên bản MVP, hệ thống cần demo được luồng: **upload tài liệu → tạo quiz → người học làm quiz → chấm điểm → phân tích chủ đề yếu → gợi ý phần tài liệu cần ôn → tạo thêm câu luyện tập**.

---

## 1.3. Định nghĩa, thuật ngữ và viết tắt

| Thuật ngữ | Giải thích |
| --- | --- |
| SRS | Software Requirements Specification — Đặc tả yêu cầu phần mềm |
| StudyMap AI | Tên hệ thống được xây dựng |
| User | Người dùng hệ thống |
| Learner | Người học, sinh viên hoặc người tự học |
| Teacher | Giáo viên hoặc trợ giảng |
| Document | Tài liệu học tập do người dùng tải lên |
| Section | Chương, mục hoặc tiểu mục trong tài liệu |
| Chunk | Đoạn nội dung nhỏ được tách ra từ tài liệu |
| Study Map | Bản đồ học tập biểu diễn cấu trúc kiến thức |
| Quiz | Bài kiểm tra được tạo từ tài liệu |
| Diagnostic Quiz | Quiz chẩn đoán dùng để phát hiện phần kiến thức yếu |
| Practice Quiz | Quiz luyện tập bổ sung cho phần kiến thức yếu |
| Attempt | Một lượt làm quiz của người học |
| Concept Tag | Nhãn khái niệm của câu hỏi hoặc nội dung |
| Mastery Score | Điểm thể hiện mức độ nắm kiến thức theo từng chủ đề |
| Review Plan | Kế hoạch/gợi ý ôn tập cá nhân hóa |
| Review Item | Một mục ôn tập cụ thể trong Review Plan |
| AI | Trí tuệ nhân tạo |
| LLM | Large Language Model — mô hình ngôn ngữ lớn |
| Embedding | Vector biểu diễn ngữ nghĩa của văn bản |
| Vector Search | Tìm kiếm ngữ nghĩa bằng vector |
| JSONB | Kiểu dữ liệu JSON trong PostgreSQL |

---

## 1.4. Tài liệu tham khảo

- PRD của StudyMap AI.
- Đề cương báo cáo tốt nghiệp.
- Đặc tả module và cơ sở dữ liệu của StudyMap AI.
- Các yêu cầu pitching: tập trung vào công nghệ sử dụng, giải pháp đề xuất và sản phẩm dự kiến.

---

# 2. Mô tả tổng quan hệ thống

## 2.1. Bối cảnh

Người học thường có nhiều tài liệu học tập như PDF, slide, giáo trình hoặc ghi chú, nhưng gặp khó khăn trong việc xác định phần nào là trọng tâm, phần nào mình chưa hiểu và nên ôn lại ở đâu. Các công cụ AI hiện tại có thể hỗ trợ tóm tắt hoặc hỏi đáp tài liệu, nhưng chưa giải quyết tốt quy trình: **tài liệu học tập → tạo bài kiểm tra → chẩn đoán lỗi sai → xác định lỗ hổng kiến thức → chỉ dẫn phần tài liệu cần ôn → tạo lộ trình ôn tập cá nhân hóa**.

StudyMap AI giải quyết vấn đề này bằng cách biến tài liệu học tập thành một hệ thống học tập có định hướng, giúp người học biết rõ mình sai ở đâu và cần quay lại ôn phần nào.

---

## 2.2. Mục tiêu hệ thống

Hệ thống StudyMap AI có các mục tiêu chính sau:

1. Phân tích tài liệu học tập.
2. Tạo quiz chẩn đoán từ nội dung tài liệu.
3. Gắn mỗi câu hỏi với nguồn kiến thức tương ứng.
4. Chấm kết quả làm bài của người học.
5. Phát hiện các chủ đề người học còn yếu.
6. Gợi ý chính xác phần tài liệu cần ôn lại.
7. Tạo lộ trình ôn tập cá nhân hóa.

---

## 2.3. Đối tượng người dùng

### 2.3.1. Người học

Bao gồm học sinh, sinh viên hoặc người tự học. Nhu cầu chính:

- Tải tài liệu học tập lên.
- Biết phần nào mình chưa hiểu.
- Được gợi ý phần cần ôn lại.
- Luyện thêm câu hỏi ở phần còn yếu.

### 2.3.2. Giáo viên hoặc trợ giảng

Nhu cầu chính:

- Tạo quiz nhanh từ tài liệu dạy học.
- Biết học sinh thường sai ở chủ đề nào.
- Tạo tài liệu ôn tập hoặc bài luyện tập bổ sung.

### 2.3.3. Người ôn thi

Nhu cầu chính:

- Biến tài liệu dài thành bài kiểm tra nhanh.
- Xác định lỗ hổng kiến thức trước kỳ thi.
- Tạo kế hoạch ôn tập theo thời gian ngắn.

---

## 2.4. Giá trị cốt lõi

StudyMap AI giúp người học trả lời ba câu hỏi:

```
1. Mình đang hiểu bài đến đâu?
2. Mình đang yếu ở phần nào?
3. Mình cần quay lại học phần nào trong tài liệu?
```

Với giáo viên, hệ thống giúp tạo quiz nhanh, tạo bộ câu hỏi bám sát tài liệu, phân tích phần kiến thức học sinh dễ sai và tạo nội dung ôn tập có dẫn chứng từ tài liệu gốc.

---

## 2.5. Phạm vi MVP

MVP của hệ thống gồm các chức năng chính:

- Upload tài liệu học tập.
- Phân tích tài liệu.
- Tạo bản đồ học tập.
- Tạo quiz chẩn đoán.
- Làm quiz.
- Chấm điểm.
- Phân tích chủ đề yếu.
- Gợi ý phần tài liệu cần ôn.
- Tạo câu luyện tập bổ sung.

MVP chưa tập trung vào:

- Xây dựng hệ thống LMS hoàn chỉnh.
- Quản lý lớp học nhiều giáo viên, nhiều học sinh.
- Huấn luyện mô hình AI riêng.
- Chấm tự luận dài phức tạp.
- Xử lý video bài giảng dài.
- Adaptive learning nâng cao theo lịch sử học dài hạn.
- Đồng bộ với Google Classroom, Moodle hoặc hệ thống trường học.

---

# 3. Kiến trúc chức năng tổng quát

## 3.1. Các module chính

| STT | Module | Mô tả |
| --- | --- | --- |
| 1 | User & Authentication Module | Quản lý người dùng, đăng nhập, phân quyền |
| 2 | Document Management Module | Upload và quản lý tài liệu |
| 3 | Document Processing Module | Trích xuất, làm sạch, chia chunk, tạo metadata |
| 4 | Study Map Module | Tạo bản đồ học tập từ tài liệu |
| 5 | Semantic Search Module | Tìm kiếm ngữ nghĩa trong tài liệu |
| 6 | Quiz Generation Module | Tạo quiz chẩn đoán từ tài liệu |
| 7 | Quiz Taking Module | Cho phép người học làm quiz |
| 8 | Grading Module | Chấm điểm và phản hồi |
| 9 | Knowledge Gap Analysis Module | Phân tích lỗ hổng kiến thức |
| 10 | Review Recommendation Module | Gợi ý phần tài liệu cần ôn |
| 11 | Practice Generation Module | Tạo câu luyện tập bổ sung |
| 12 | Progress & Report Module | Theo dõi kết quả và tiến độ |
| 13 | AI Validation Module | Kiểm soát chất lượng đầu ra của AI |
| 14 | Background Job Module | Quản lý tác vụ chạy nền, cập nhật và hiển thị trạng thái xử lý |

> Ghi chú: chức năng thông báo và hiển thị trạng thái xử lý cho người dùng do Background Job Module đảm nhiệm thông qua bảng `jobs`, không tách thành module riêng.

---

## 3.2. Luồng hoạt động tổng quát

```
Người dùng đăng nhập
→ Upload tài liệu
→ Hệ thống xử lý tài liệu
→ Người dùng chọn tạo quiz
→ Hệ thống sinh quiz
→ Người dùng làm bài
→ Hệ thống chấm điểm
→ Hệ thống phân tích chủ đề yếu
→ Hệ thống gợi ý phần tài liệu cần ôn
→ Người dùng xem tài liệu gốc hoặc tạo bài luyện thêm
```

Luồng này tương ứng với user flow tổng quát được xác định trong PRD.

---

# 4. Yêu cầu chức năng

## 4.1. FR-01 — Quản lý người dùng

### Mô tả

Hệ thống phải cho phép người dùng đăng ký, đăng nhập, đăng xuất và quản lý phiên sử dụng.

### Actor

- Learner.
- Teacher.
- Admin.

### Input

- Email.
- Mật khẩu.
- Họ tên.
- Vai trò người dùng.

### Output

- Thông tin người dùng.
- Token đăng nhập.
- Thông báo lỗi nếu đăng nhập thất bại.

### Yêu cầu chi tiết

| Mã yêu cầu | Nội dung |
| --- | --- |
| FR-01.1 | Người dùng có thể đăng ký tài khoản bằng email và mật khẩu |
| FR-01.2 | Người dùng có thể đăng nhập bằng email và mật khẩu |
| FR-01.3 | Người dùng có thể đăng xuất |
| FR-01.4 | Hệ thống phải mã hóa mật khẩu trước khi lưu |
| FR-01.5 | Hệ thống phải kiểm tra quyền truy cập theo `user_id` |
| FR-01.6 | Người dùng chỉ được xem tài liệu, quiz, attempt và review plan của mình |

### Acceptance Criteria

- Đăng ký thành công với email chưa tồn tại.
- Không cho phép đăng ký email trùng.
- Đăng nhập thành công với thông tin hợp lệ.
- Không cho phép truy cập dữ liệu của người dùng khác.

---

## 4.2. FR-02 — Upload và quản lý tài liệu

### Mô tả

Hệ thống cho phép người dùng upload tài liệu học tập và quản lý danh sách tài liệu đã upload.

### Actor

- Learner.
- Teacher.

### Input

- File PDF, DOCX, TXT, Markdown hoặc slide xuất PDF.
- Tên tài liệu.

### Output

- `document_id`.
- Trạng thái upload.
- Trạng thái xử lý tài liệu.

### Yêu cầu chi tiết

| Mã yêu cầu | Nội dung |
| --- | --- |
| FR-02.1 | Người dùng có thể upload tài liệu |
| FR-02.2 | Hệ thống kiểm tra định dạng file |
| FR-02.3 | Hệ thống kiểm tra dung lượng file |
| FR-02.4 | Hệ thống tạo bản ghi tài liệu trong database |
| FR-02.5 | Hệ thống hiển thị danh sách tài liệu đã upload |
| FR-02.6 | Hệ thống hiển thị trạng thái xử lý tài liệu |
| FR-02.7 | Người dùng có thể xóa tài liệu |
| FR-02.8 | Không cho phép tạo quiz khi tài liệu chưa xử lý xong |

### Trạng thái tài liệu

| Trạng thái | Ý nghĩa |
| --- | --- |
| uploaded | Đã upload |
| processing | Đang xử lý |
| completed | Đã xử lý xong |
| failed | Xử lý thất bại |
| deleted | Đã xóa mềm |

### Acceptance Criteria

- Upload được file hợp lệ.
- File sai định dạng bị từ chối.
- Tài liệu xử lý xong có trạng thái `completed`.
- Nếu xử lý thất bại, hệ thống hiển thị lỗi rõ ràng.

---

## 4.3. FR-03 — Xử lý tài liệu

### Mô tả

Hệ thống xử lý tài liệu sau khi upload bằng cách trích xuất text, phát hiện heading, chia section, chia chunk, tạo embedding và lưu dữ liệu có cấu trúc.

### Actor

- System.

### Input

- `document_id`.
- File tài liệu gốc.

### Output

- Danh sách section.
- Danh sách chunk.
- Embedding/vector reference.
- Trạng thái xử lý.

### Yêu cầu chi tiết

| Mã yêu cầu | Nội dung |
| --- | --- |
| FR-03.1 | Hệ thống trích xuất text từ tài liệu |
| FR-03.2 | Hệ thống chuẩn hóa text |
| FR-03.3 | Hệ thống phát hiện heading/chương/mục |
| FR-03.4 | Hệ thống tạo sections |
| FR-03.5 | Hệ thống chia nội dung thành chunks |
| FR-03.6 | Mỗi chunk phải có `document_id`, `chunk_id`, `chunk_index` |
| FR-03.7 | Mỗi chunk nên có `section_id` nếu xác định được |
| FR-03.8 | Hệ thống tạo embedding cho chunk |
| FR-03.9 | Hệ thống lưu dữ liệu vào database có cấu trúc |
| FR-03.10 | Hệ thống cảnh báo nếu text trích xuất quá ít |

### Quy trình xử lý

```
File tài liệu
→ Extract text
→ Normalize text
→ Detect heading
→ Create sections
→ Chunking
→ Attach metadata
→ Generate embeddings
→ Store structured data
→ Mark document as completed
```

### Acceptance Criteria

- Tài liệu hợp lệ được xử lý thành section và chunk.
- Chunk không được rỗng.
- Có thể truy xuất chunk theo document hoặc section.
- Tài liệu xử lý lỗi có trạng thái `failed`.

---

## 4.4. FR-04 — Tạo bản đồ học tập

### Mô tả

Hệ thống tạo bản đồ học tập từ nội dung tài liệu, giúp người học thấy cấu trúc kiến thức theo chủ đề.

### Actor

- Learner.
- Teacher.
- System.

### Input

- `document_id`.
- Danh sách sections/chunks.

### Output

- `map_id`.
- Danh sách nodes.
- Danh sách edges.

### Yêu cầu chi tiết

| Mã yêu cầu | Nội dung |
| --- | --- |
| FR-04.1 | Hệ thống tạo Study Map từ tài liệu |
| FR-04.2 | Mỗi Study Map gắn với một document |
| FR-04.3 | Study Map gồm các knowledge nodes |
| FR-04.4 | Node có thể có quan hệ cha — con |
| FR-04.5 | Node có thể có quan hệ chéo như prerequisite, supports, related |
| FR-04.6 | Mỗi node phải có title |
| FR-04.7 | Mỗi node nên liên kết với section hoặc chunk |
| FR-04.8 | Sau khi làm quiz, node yếu có thể được đánh dấu |

### Acceptance Criteria

- Tạo được bản đồ học tập từ tài liệu.
- Node không bị thiếu title.
- Node không tự trỏ parent về chính nó.
- Người dùng xem được bản đồ học tập trên giao diện.

---

## 4.5. FR-05 — Tìm kiếm ngữ nghĩa

### Mô tả

Hệ thống hỗ trợ tìm kiếm các chunk liên quan dựa trên truy vấn ngữ nghĩa.

### Actor

- System.
- Learner.
- Teacher.

### Input

```json
{
  "document_id": "doc_001",
  "query": "quy tắc đạo hàm hàm hợp",
  "top_k": 5
}
```

### Output

```json
{
  "results": [
    {
      "chunk_id": "chunk_018",
      "section_id": "section_2_3",
      "score": 0.87,
      "text": "Nội dung liên quan..."
    }
  ]
}
```

### Yêu cầu chi tiết

| Mã yêu cầu | Nội dung |
| --- | --- |
| FR-05.1 | Hệ thống tạo embedding cho chunk |
| FR-05.2 | Hệ thống lưu vector reference |
| FR-05.3 | Hệ thống tìm chunk liên quan theo query |
| FR-05.4 | Kết quả tìm kiếm phải trả về `chunk_id` |
| FR-05.5 | Kết quả tìm kiếm phải giới hạn trong tài liệu của user |

---

## 4.6. FR-06 — Tạo quiz chẩn đoán

### Mô tả

Hệ thống tạo quiz chẩn đoán từ tài liệu đã xử lý. Mỗi câu hỏi phải bám sát nội dung tài liệu và liên kết với nguồn kiến thức.

### Actor

- Learner.
- Teacher.
- System.

### Input

```json
{
  "document_id": "doc_001",
  "scope": {
    "type": "full_document",
    "section_ids": []
  },
  "question_count": 10,
  "difficulty": "mixed",
  "question_types": ["multiple_choice", "true_false", "short_answer"]
}
```

### Output

- `quiz_id`.
- Danh sách câu hỏi.
- Trạng thái tạo quiz.

### Yêu cầu chi tiết

| Mã yêu cầu | Nội dung |
| --- | --- |
| FR-06.1 | Người dùng có thể chọn tài liệu để tạo quiz |
| FR-06.2 | Người dùng có thể chọn phạm vi: toàn tài liệu hoặc section |
| FR-06.3 | Người dùng có thể chọn số câu |
| FR-06.4 | Người dùng có thể chọn độ khó |
| FR-06.5 | Người dùng có thể chọn dạng câu hỏi |
| FR-06.6 | Hệ thống tạo câu hỏi từ section/chunk |
| FR-06.7 | Mỗi câu hỏi phải có đáp án đúng |
| FR-06.8 | Mỗi câu hỏi phải có explanation |
| FR-06.9 | Mỗi câu hỏi phải có `concept_tags` |
| FR-06.10 | Mỗi câu hỏi phải liên kết với section, node hoặc chunk |
| FR-06.11 | Hệ thống không tạo câu hỏi ngoài tài liệu |
| FR-06.12 | Hệ thống không trả `correct_answer` trước khi người học nộp bài |

Cấu hình quiz gồm tài liệu, phạm vi, số câu, độ khó và dạng câu hỏi đã được xác định trong PRD.

### Acceptance Criteria

- Quiz được tạo từ tài liệu đã xử lý.
- Quiz có đủ số câu theo cấu hình.
- Câu hỏi có đáp án, giải thích và nguồn.
- Câu hỏi thiếu nguồn bị loại hoặc sinh lại.

---

## 4.7. FR-07 — Làm quiz

### Mô tả

Hệ thống cho phép người học làm quiz trên giao diện.

### Actor

- Learner.

### Input

- `quiz_id`.
- Câu trả lời của người học.

### Output

- `attempt_id`.
- Trạng thái attempt (`in_progress`, `submitted`).
- Trạng thái nộp bài.

### Yêu cầu chi tiết

| Mã yêu cầu | Nội dung |
| --- | --- |
| FR-07.1 | Người học có thể mở quiz |
| FR-07.2 | Hệ thống hiển thị câu hỏi |
| FR-07.3 | Hệ thống hiển thị đáp án lựa chọn |
| FR-07.4 | Người học có thể chọn đáp án |
| FR-07.5 | Người học có thể đổi đáp án trước khi nộp |
| FR-07.6 | Hệ thống cảnh báo nếu còn câu chưa trả lời |
| FR-07.7 | Người học có thể nộp bài |
| FR-07.8 | Hệ thống lưu attempt |
| FR-07.9 | Hệ thống lưu từng answer |
| FR-07.10 | Hệ thống tạo attempt với trạng thái `in_progress` khi người học mở quiz |
| FR-07.11 | Hệ thống cho phép lưu nháp câu trả lời khi attempt còn `in_progress` |
| FR-07.12 | Khi nộp bài, attempt chuyển sang trạng thái `submitted` |
| FR-07.13 | Hệ thống ghi nhận thời lượng làm bài vào `duration_seconds` |

Vòng đời attempt:

```
Người học mở quiz
→ POST /api/quizzes/{quiz_id}/attempts    → attempt.status = in_progress, started_at
→ PATCH /api/attempts/{attempt_id}/answers → lưu nháp từng câu (có thể gọi nhiều lần)
→ POST /api/attempts/{attempt_id}/submit   → attempt.status = submitted, submitted_at
→ Grading Module chấm bài                  → attempt.status = graded, graded_at
```

Giao diện làm quiz cần hiển thị tiêu đề quiz, số câu hỏi, câu hỏi hiện tại, đáp án, nút chuyển câu, nút nộp bài và trạng thái câu đã làm/chưa làm.

### Acceptance Criteria

- Người học làm và nộp quiz thành công.
- Mỗi câu trả lời được lưu.
- Sau khi nộp, người học được chuyển sang trang kết quả.

---

## 4.8. FR-08 — Chấm điểm

### Mô tả

Hệ thống chấm điểm bài quiz, tính điểm tổng và tạo feedback.

### Actor

- System.

### Input

- `attempt_id`.
- Danh sách answers.
- Danh sách correct answers.

### Output

- Điểm tổng (`score`) và điểm tối đa (`max_score`).
- Tỷ lệ phần trăm (`percentage`).
- Số câu đúng.
- Số câu sai.
- `verdict` từng câu.
- Feedback từng câu.

### Yêu cầu chi tiết

| Mã yêu cầu | Nội dung |
| --- | --- |
| FR-08.1 | Hệ thống chấm câu trắc nghiệm |
| FR-08.2 | Hệ thống chấm câu đúng/sai |
| FR-08.3 | Hệ thống hỗ trợ chấm tự luận ngắn ở mức cơ bản |
| FR-08.4 | Hệ thống tính điểm tổng |
| FR-08.5 | Hệ thống tính số câu đúng/sai |
| FR-08.6 | Hệ thống tạo feedback cho câu sai |
| FR-08.7 | Hệ thống cập nhật trạng thái attempt thành `graded` |
| FR-08.8 | Hệ thống hiển thị đáp án đúng sau khi nộp |
| FR-08.9 | Hệ thống lưu `verdict` cho từng câu trả lời |
| FR-08.10 | Hệ thống tính `max_score` và `percentage` cho attempt |

### Quy tắc tính điểm

Với trắc nghiệm và đúng/sai, hệ thống so sánh `user_answer` với `correct_answer`:

```
Trùng khớp    → verdict = correct,   is_correct = true,  score = 1.0
Không trùng   → verdict = incorrect, is_correct = false, score = 0.0
```

Với tự luận ngắn, hệ thống dùng LLM hoặc rule đơn giản để so sánh với đáp án mẫu và source context:

```
verdict = correct    → is_correct = true,  score = 1.0
verdict = partial    → is_correct = false, score = 0.5
verdict = incorrect  → is_correct = false, score = 0.0
```

Điểm của attempt:

```
score       = SUM(quiz_answers.score)
max_score   = total_questions × 1.0
percentage  = score / max_score × 100
```

`score` là điểm thô, không quy đổi sang thang 10. Giao diện hiển thị điểm theo dạng `score / max_score` và `percentage` để so sánh được giữa các quiz có số câu khác nhau.

### Acceptance Criteria

- Chấm đúng quiz trắc nghiệm và đúng/sai.
- Kết quả có score, correct_count, incorrect_count.
- Người học xem được đáp án đúng và giải thích sau khi nộp.

---

## 4.9. FR-09 — Phân tích lỗ hổng kiến thức

### Mô tả

Hệ thống phân tích kết quả quiz để xác định người học yếu ở chủ đề nào.

### Actor

- System.

### Input

- `attempt_id`.
- Danh sách quiz_answers.
- Danh sách quiz_questions.
- Concept tags.
- Section/node/chunk nguồn.

### Output

- Danh sách concept mastery.
- Danh sách weak topics.

### Yêu cầu chi tiết

| Mã yêu cầu | Nội dung |
| --- | --- |
| FR-09.1 | Hệ thống lấy danh sách câu đúng/sai |
| FR-09.2 | Hệ thống nhóm câu hỏi theo `concept_tags` |
| FR-09.3 | Hệ thống nhóm câu hỏi theo `section_id` |
| FR-09.4 | Hệ thống nhóm câu hỏi theo `knowledge_node_id` |
| FR-09.5 | Hệ thống tính mastery score |
| FR-09.6 | Hệ thống phân loại mức độ nắm bài |
| FR-09.7 | Hệ thống lưu concept mastery |
| FR-09.8 | Hệ thống trả danh sách weak topics |
| FR-09.9 | Câu có `verdict = partial` được tính 0.5 điểm khi tính mastery score |
| FR-09.10 | Mỗi cặp (`attempt_id`, `concept_name`) chỉ sinh đúng một bản ghi `concept_masteries` |

### Công thức mastery score

```
earned_score  = SUM(quiz_answers.score) của các câu thuộc concept
total_count   = tổng số câu thuộc concept
mastery_score = earned_score / total_count
```

Trong đó `correct_count` vẫn được lưu riêng để báo cáo số câu đúng hoàn toàn, còn `earned_score` mới là cơ sở tính `mastery_score`. Các mức phân loại gồm: đã nắm tốt, cần ôn nhẹ, cần ôn lại và hổng kiến thức nghiêm trọng.

### Bảng phân loại

| Mastery Score | Trạng thái | Ý nghĩa |
| --- | --- | --- |
| >= 0.80 | mastered | Đã nắm tốt |
| 0.60 - 0.79 | light_review | Cần ôn nhẹ |
| 0.40 - 0.59 | review_needed | Cần ôn lại |
| < 0.40 | critical_gap | Hổng kiến thức nghiêm trọng |

### Acceptance Criteria

- Xác định được ít nhất một topic yếu nếu người học làm sai.
- Topic yếu có liên kết với section/node/chunk.
- Kết quả phân tích được dùng để tạo review plan.

---

## 4.10. FR-10 — Gợi ý ôn tập cá nhân hóa

### Mô tả

Hệ thống tạo review plan dựa trên các concept yếu sau khi người học làm quiz.

### Actor

- System.
- Learner.

### Input

- `attempt_id`.
- Danh sách concept_masteries.
- Section/chunk liên quan.

### Output

- `review_plan_id`.
- Danh sách review items.
- Section/chunk cần ôn.
- Nhiệm vụ ôn tập.

### Yêu cầu chi tiết

| Mã yêu cầu | Nội dung |
| --- | --- |
| FR-10.1 | Hệ thống tạo review plan từ attempt |
| FR-10.2 | Hệ thống chỉ lấy concept yếu để tạo review item |
| FR-10.3 | Mỗi review item có topic |
| FR-10.4 | Mỗi review item có reason |
| FR-10.5 | Mỗi review item có priority |
| FR-10.6 | Mỗi review item có section/chunk cần ôn |
| FR-10.7 | Mỗi review item có review tasks |
| FR-10.8 | Người học có thể mở lại tài liệu được gợi ý |

Review guide cần lấy weak topics, lấy lại section/chunk liên quan, tạo gợi ý ôn tập, đề xuất thứ tự ôn và nhiệm vụ luyện tập tiếp theo.

### Acceptance Criteria

- Review plan được tạo sau khi quiz được chấm.
- Review plan không gợi ý phần không liên quan.
- Người học xem được lý do cần ôn từng topic.
- Người học mở được section/chunk cần đọc lại.

---

## 4.11. FR-11 — Tạo câu luyện tập bổ sung

### Mô tả

Hệ thống tạo practice quiz cho các chủ đề người học còn yếu.

### Actor

- Learner.
- System.

### Input

```json
{
  "review_item_id": "review_item_001",
  "question_count": 5,
  "difficulty": "easy"
}
```

### Output

- `practice_quiz_id`.
- Danh sách câu hỏi luyện tập.

### Yêu cầu chi tiết

| Mã yêu cầu | Nội dung |
| --- | --- |
| FR-11.1 | Người học có thể chọn topic yếu để luyện thêm |
| FR-11.2 | Hệ thống lấy chunk liên quan từ review item |
| FR-11.3 | Hệ thống tạo quiz với `quiz_type = practice` |
| FR-11.4 | Câu luyện tập phải bám vào chunk được gợi ý |
| FR-11.5 | Câu luyện tập phải có đáp án và giải thích |
| FR-11.6 | Người học có thể làm practice quiz |
| FR-11.7 | Kết quả practice quiz được lưu |
| FR-11.8 | Practice quiz phải lưu `source_review_item_id` trỏ về review item nguồn |
| FR-11.9 | Practice quiz phải lưu `source_attempt_id` trỏ về attempt chẩn đoán gốc |
| FR-11.10 | Hệ thống so sánh mastery score trước và sau khi làm practice quiz |

PRD xác định câu luyện tập phải thuộc topic yếu, bám vào section/chunk được gợi ý và kết quả luyện tập phải được lưu.

---

## 4.12. FR-12 — Theo dõi tiến độ và báo cáo

### Mô tả

Hệ thống hiển thị kết quả học tập và tiến độ của người học.

### Actor

- Learner.
- Teacher.

### Yêu cầu chi tiết

| Mã yêu cầu | Nội dung |
| --- | --- |
| FR-12.1 | Hiển thị danh sách quiz đã làm |
| FR-12.2 | Hiển thị điểm từng quiz |
| FR-12.3 | Hiển thị topic yếu |
| FR-12.4 | Hiển thị mastery score theo topic |
| FR-12.5 | Hiển thị review plan |
| FR-12.6 | Hiển thị lịch sử practice quiz |
| FR-12.7 | So sánh kết quả trước và sau luyện tập nếu có |

### Chỉ số hiển thị

- Số tài liệu đã upload.
- Số quiz đã tạo.
- Tỷ lệ quiz hoàn thành.
- Điểm trung bình.
- Danh sách topic yếu.
- Mastery score.
- Mức cải thiện sau luyện tập.

Các chỉ số đánh giá sản phẩm, chất lượng và học tập đã được xác định gồm số tài liệu upload, số quiz tạo, tỷ lệ hoàn thành, độ bám tài liệu, độ chính xác citation, độ chính xác chấm điểm và mức cải thiện sau luyện tập.

---

## 4.13. FR-13 — Kiểm soát chất lượng AI

### Mô tả

Hệ thống phải kiểm soát đầu ra do AI tạo ra nhằm giảm lỗi như câu hỏi ngoài tài liệu, thiếu nguồn, thiếu đáp án hoặc JSON sai định dạng.

### Yêu cầu chi tiết

| Mã yêu cầu | Nội dung |
| --- | --- |
| FR-13.1 | Validate JSON output |
| FR-13.2 | Kiểm tra câu hỏi có đáp án đúng |
| FR-13.3 | Kiểm tra câu hỏi có explanation |
| FR-13.4 | Kiểm tra câu hỏi có concept tags |
| FR-13.5 | Kiểm tra câu hỏi có chunk nguồn |
| FR-13.6 | Loại câu hỏi không có chunk nguồn |
| FR-13.7 | Loại câu hỏi trùng lặp |
| FR-13.8 | Retry khi AI trả output lỗi |
| FR-13.9 | Review plan không được gợi ý section/chunk không liên quan |
| FR-13.10 | Mọi item bị loại phải được ghi vào bảng `ai_validation_logs` |
| FR-13.11 | Log validation phải ghi rõ `rule_code` và nội dung item bị loại |

Các rủi ro chính gồm AI tạo câu hỏi ngoài tài liệu, gợi ý ôn tập sai section, chấm tự luận không ổn định, tài liệu dài khiến tạo quiz chậm và tài liệu extract text kém. PRD cũng nêu cách xử lý tương ứng như bắt buộc chunk_refs, ưu tiên rule-based mapping, tạo quiz bằng async job và cảnh báo tài liệu không đủ nội dung.

---

## 4.14. FR-14 — Background jobs

### Mô tả

Hệ thống quản lý các tác vụ xử lý lâu bằng background jobs.

### Job types

| Job type | Mục đích |
| --- | --- |
| document_processing | Xử lý tài liệu |
| study_map_generation | Tạo Study Map |
| quiz_generation | Tạo quiz |
| short_answer_grading | Chấm tự luận ngắn |
| gap_analysis | Phân tích lỗ hổng kiến thức |
| review_plan_generation | Tạo review plan |
| practice_generation | Tạo practice quiz |

### Job status

| Status | Ý nghĩa |
| --- | --- |
| pending | Đang chờ |
| running | Đang chạy |
| completed | Hoàn tất |
| failed | Thất bại |
| cancelled | Đã hủy |
| timeout | Quá thời gian |

### Yêu cầu chi tiết

| Mã yêu cầu | Nội dung |
| --- | --- |
| FR-14.1 | Hệ thống tạo job cho tác vụ xử lý lâu |
| FR-14.2 | Hệ thống cập nhật trạng thái job |
| FR-14.3 | Hệ thống cập nhật progress |
| FR-14.4 | Hệ thống lưu lỗi nếu job thất bại |
| FR-14.5 | Người dùng có thể kiểm tra trạng thái job |
| FR-14.6 | Người dùng có thể hủy job nếu được hỗ trợ |

---

# 5. Yêu cầu phi chức năng

## 5.1. NFR-01 — Hiệu năng

| Mã yêu cầu | Nội dung |
| --- | --- |
| NFR-01.1 | Tài liệu nhỏ dưới 10MB phải xử lý ổn định |
| NFR-01.2 | Quiz 10 câu nên được tạo bằng job bất đồng bộ |
| NFR-01.3 | Trang làm quiz phải phản hồi nhanh |
| NFR-01.4 | Kết quả chấm trắc nghiệm/đúng sai phải trả về gần như tức thì |
| NFR-01.5 | Hệ thống phải tránh chặn giao diện khi xử lý tài liệu hoặc tạo quiz |

Các yêu cầu hiệu năng này phù hợp với PRD: upload tài liệu nhỏ dưới 10MB ổn định, quiz 10 câu tạo bằng async job, trang làm quiz phản hồi nhanh và kết quả chấm trắc nghiệm trả về gần như tức thì.

---

## 5.2. NFR-02 — Độ tin cậy

| Mã yêu cầu | Nội dung |
| --- | --- |
| NFR-02.1 | Không tạo quiz khi tài liệu chưa xử lý xong |
| NFR-02.2 | Nếu AI trả JSON lỗi, hệ thống phải retry hoặc báo lỗi |
| NFR-02.3 | Câu hỏi thiếu chunk_refs không được đưa vào quiz |
| NFR-02.4 | Nếu tài liệu extract text quá ít, hệ thống phải cảnh báo |
| NFR-02.5 | Dữ liệu attempt và answer không được mất sau khi nộp bài |

Các yêu cầu này tương ứng với nhóm yêu cầu độ tin cậy trong PRD.

---

## 5.3. NFR-03 — Tính minh bạch

| Mã yêu cầu | Nội dung |
| --- | --- |
| NFR-03.1 | Mỗi câu hỏi cần có nguồn từ tài liệu |
| NFR-03.2 | Review guide phải nêu lý do vì sao đề xuất ôn phần đó |
| NFR-03.3 | Người học có thể mở lại đoạn tài liệu liên quan |
| NFR-03.4 | Hệ thống phải phân biệt rõ đáp án đúng, đáp án người học và feedback |

Tính minh bạch là yêu cầu quan trọng vì hệ thống cần giúp người học biết chính xác mình cần ôn lại phần nào trong tài liệu.

---

## 5.4. NFR-04 — Bảo mật

| Mã yêu cầu | Nội dung |
| --- | --- |
| NFR-04.1 | Người dùng chỉ xem được tài liệu của mình |
| NFR-04.2 | Quiz và attempt phải gắn với user_id |
| NFR-04.3 | Không expose raw file path |
| NFR-04.4 | Không lưu API key ở frontend |
| NFR-04.5 | Mật khẩu phải được mã hóa |
| NFR-04.6 | API cần xác thực trước khi truy cập dữ liệu cá nhân |

Các yêu cầu bảo mật này phù hợp với PRD, trong đó nêu rõ người dùng chỉ xem tài liệu của mình, quiz/attempt phải gắn với user_id, không expose raw file path và không lưu API key ở frontend.

---

## 5.5. NFR-05 — Khả năng mở rộng

| Mã yêu cầu | Nội dung |
| --- | --- |
| NFR-05.1 | Module quiz phải tách riêng với module Study Map |
| NFR-05.2 | Có thể thêm question type mới |
| NFR-05.3 | Có thể thay đổi LLM mà không sửa toàn bộ hệ thống |
| NFR-05.4 | Có thể mở rộng Teacher Mode sau MVP |
| NFR-05.5 | Có thể mở rộng flashcard, dashboard và lịch ôn tập |

PRD xác định module quiz nên tách riêng với summary/mindmap, có thể thêm question type mới và có thể thay đổi model LLM mà không sửa toàn bộ hệ thống.

---

## 5.6. NFR-06 — Khả dụng và trải nghiệm người dùng

| Mã yêu cầu | Nội dung |
| --- | --- |
| NFR-06.1 | Giao diện phải dễ hiểu với người học |
| NFR-06.2 | Các trạng thái xử lý phải hiển thị rõ |
| NFR-06.3 | Lỗi phải có thông báo dễ hiểu |
| NFR-06.4 | Người học phải thấy được bước tiếp theo sau khi làm quiz |
| NFR-06.5 | Review plan phải trình bày rõ ràng, có thứ tự ưu tiên |

---

# 6. Yêu cầu giao diện người dùng

## 6.1. Document List Page

Chức năng:

- Hiển thị tên tài liệu.
- Hiển thị trạng thái xử lý.
- Hiển thị ngày upload.
- Nút xem tài liệu.
- Nút tạo quiz.
- Nút tạo Study Map.
- Nút xóa tài liệu.

---

## 6.2. Quiz Setup Page

Chức năng:

- Chọn tài liệu.
- Chọn phạm vi.
- Chọn số câu.
- Chọn độ khó.
- Chọn dạng câu hỏi.
- Nút Generate Quiz.

---

## 6.3. Quiz Taking Page

Chức năng:

- Hiển thị tiêu đề quiz.
- Hiển thị tiến độ câu hỏi.
- Hiển thị nội dung câu hỏi.
- Hiển thị đáp án lựa chọn.
- Nút câu trước.
- Nút câu sau.
- Nút nộp bài.
- Danh sách câu đã làm/chưa làm.

---

## 6.4. Quiz Result Page

Chức năng:

- Hiển thị điểm tổng.
- Hiển thị số câu đúng/sai.
- Hiển thị đáp án người học.
- Hiển thị đáp án đúng.
- Hiển thị explanation.
- Hiển thị chủ đề liên quan.
- Nút xem review plan.

---

## 6.5. Review Guide Page

Chức năng:

- Hiển thị tóm tắt kết quả học tập.
- Hiển thị danh sách topic yếu.
- Hiển thị mastery score từng topic.
- Hiển thị chương/mục cần ôn.
- Hiển thị link mở đoạn tài liệu gốc.
- Hiển thị nhiệm vụ ôn tập.
- Nút tạo thêm câu luyện tập.

---

## 6.6. Practice Page

Chức năng:

- Hiển thị topic đang luyện.
- Hiển thị câu hỏi luyện tập.
- Hiển thị đáp án.
- Hiển thị giải thích.
- Nút làm tiếp.
- Nút quay lại review guide.

Các màn hình này tương ứng với phần UI trong PRD gồm Document List, Quiz Setup, Quiz Taking, Quiz Result, Review Guide và Practice Page.

---

# 7. Yêu cầu API

## 7.1. API xác thực

```
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET /api/auth/me
```

---

## 7.2. API tài liệu

```
POST /api/documents/upload
GET /api/documents
GET /api/documents/{document_id}
DELETE /api/documents/{document_id}
GET /api/documents/{document_id}/sections
GET /api/documents/{document_id}/chunks
```

---

## 7.3. API tìm kiếm ngữ nghĩa

```
POST /api/documents/{document_id}/search
POST /api/search
```

---

## 7.4. API Study Map

```
POST /api/study-maps/generate
GET /api/study-maps/jobs/{job_id}
GET /api/study-maps/{map_id}
GET /api/documents/{document_id}/study-maps
```

---

## 7.5. API Quiz

```
POST /api/quizzes/generate
GET /api/quizzes/jobs/{job_id}
GET /api/quizzes/{quiz_id}
POST /api/quizzes/{quiz_id}/attempts
GET /api/quizzes/results/{attempt_id}
```

> Ghi chú: `GET /api/quizzes/{quiz_id}` không trả `correct_answer` và `explanation` trước khi người học nộp bài.

---

## 7.6. API Attempt

```
GET /api/attempts/{attempt_id}
PATCH /api/attempts/{attempt_id}/answers
POST /api/attempts/{attempt_id}/submit
```

`PATCH /api/attempts/{attempt_id}/answers` dùng để lưu nháp câu trả lời khi attempt còn `in_progress`. `POST /api/attempts/{attempt_id}/submit` chốt bài và kích hoạt Grading Module.

---

## 7.7. API Review Plan

```
POST /api/review-plans/generate
GET /api/review-plans/{attempt_id}
GET /api/review-plans/{review_plan_id}/items
```

---

## 7.8. API Practice

```
POST /api/practice/generate
GET /api/practice/{practice_quiz_id}
POST /api/practice/{practice_quiz_id}/submit
GET /api/practice/{practice_quiz_id}/comparison
```

`GET /api/practice/{practice_quiz_id}/comparison` trả về so sánh mastery score trước và sau luyện tập, dựa trên `source_attempt_id` của practice quiz.

---

## 7.9. API tiến độ và báo cáo

```
GET /api/progress/overview
GET /api/progress/concepts
GET /api/progress/attempts
```

---

## 7.10. API Job

```
GET /api/jobs/{job_id}
POST /api/jobs/{job_id}/cancel
```

---

# 8. Thiết kế dữ liệu

## 8.1. Danh sách bảng chính

Hệ thống sử dụng các bảng:

```
users
documents
sections
document_chunks
knowledge_maps
knowledge_nodes
knowledge_edges
knowledge_node_chunks
quizzes
quiz_questions
quiz_question_chunks
quiz_attempts
quiz_answers
concept_masteries
review_plans
review_plan_items
review_item_chunks
jobs
ai_validation_logs
```

Các bảng dữ liệu cốt lõi trong PRD gồm documents, document_chunks, sections, quizzes, quiz_questions, quiz_attempts, quiz_answers và review_plans.

---

## 8.2. Bảng users

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã người dùng |
| full_name | VARCHAR(255) | NOT NULL | Họ tên |
| email | VARCHAR(255) | UNIQUE, NOT NULL | Email |
| password_hash | TEXT | NOT NULL | Mật khẩu đã mã hóa |
| role | VARCHAR(50) | NOT NULL | learner, teacher, admin |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |
| updated_at | TIMESTAMP | NOT NULL | Ngày cập nhật |

---

## 8.3. Bảng documents

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã tài liệu |
| user_id | UUID | FK → users.id | Người sở hữu |
| title | VARCHAR(255) | NOT NULL | Tên tài liệu |
| file_type | VARCHAR(50) | NOT NULL | pdf, docx, txt, md |
| file_path | TEXT | NOT NULL | Đường dẫn file |
| status | VARCHAR(50) | NOT NULL | uploaded, processing, completed, failed, deleted |
| file_size | BIGINT | NULL | Kích thước file tính bằng byte |
| page_count | INT | NULL | Số trang |
| char_count | INT | NULL | Số ký tự trích xuất được |
| chunk_count | INT | NULL | Số chunk sinh ra |
| error_message | TEXT | NULL | Thông báo lỗi |
| created_at | TIMESTAMP | NOT NULL | Ngày upload |
| updated_at | TIMESTAMP | NOT NULL | Ngày cập nhật |

---

## 8.4. Bảng sections

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã section |
| document_id | UUID | FK → documents.id | Tài liệu chứa section |
| parent_section_id | UUID | FK → sections.id, NULL | Section cha |
| title | VARCHAR(500) | NOT NULL | Tiêu đề |
| level | INT | NOT NULL | Cấp heading |
| order_index | INT | NOT NULL | Thứ tự |
| page_start | INT | NULL | Trang bắt đầu |
| page_end | INT | NULL | Trang kết thúc |
| summary | TEXT | NULL | Tóm tắt |
| metadata_json | JSONB | NULL | Metadata |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |

---

## 8.5. Bảng document_chunks

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã chunk |
| document_id | UUID | FK → documents.id | Tài liệu chứa chunk |
| section_id | UUID | FK → sections.id, NULL | Section chứa chunk |
| chunk_index | INT | NOT NULL | Thứ tự chunk |
| text | TEXT | NOT NULL | Nội dung |
| heading | VARCHAR(500) | NULL | Heading gần nhất |
| page_number | INT | NULL | Số trang |
| token_count | INT | NULL | Số token |
| checksum | VARCHAR(255) | NULL | Kiểm tra thay đổi |
| embedding_id | VARCHAR(255) | NULL | ID vector |
| embedding_model | VARCHAR(100) | NULL | Model dùng để tạo embedding |
| embedding_dim | INT | NULL | Số chiều vector |
| metadata_json | JSONB | NULL | Metadata |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |

---

## 8.6. Bảng knowledge_maps

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã bản đồ |
| document_id | UUID | FK → documents.id | Tài liệu nguồn |
| user_id | UUID | FK → users.id | Người tạo |
| title | VARCHAR(500) | NOT NULL | Tên bản đồ |
| status | VARCHAR(50) | NOT NULL | processing, completed, failed |
| generator_json | JSONB | NULL | Thông tin generator |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |
| updated_at | TIMESTAMP | NOT NULL | Ngày cập nhật |

---

## 8.7. Bảng knowledge_nodes

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã node |
| map_id | UUID | FK → knowledge_maps.id | Bản đồ |
| document_id | UUID | FK → documents.id | Tài liệu |
| section_id | UUID | FK → sections.id, NULL | Section liên quan |
| parent_node_id | UUID | FK → knowledge_nodes.id, NULL | Node cha |
| title | VARCHAR(500) | NOT NULL | Tên node |
| summary | TEXT | NULL | Tóm tắt |
| node_type | VARCHAR(50) | NOT NULL | root, section, concept, example |
| level | INT | NOT NULL | Cấp độ |
| order_index | INT | NOT NULL | Thứ tự |
| metadata_json | JSONB | NULL | Metadata |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |

---

## 8.8. Bảng knowledge_edges

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã edge |
| map_id | UUID | FK → knowledge_maps.id | Bản đồ |
| source_node_id | UUID | FK → knowledge_nodes.id | Node nguồn |
| target_node_id | UUID | FK → knowledge_nodes.id | Node đích |
| relation_type | VARCHAR(50) | NOT NULL | parent_child, supports, prerequisite, contrasts, related |
| description | TEXT | NULL | Mô tả |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |

---

## 8.9. Bảng knowledge_node_chunks

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã bản ghi |
| node_id | UUID | FK → knowledge_nodes.id | Node kiến thức |
| chunk_id | UUID | FK → document_chunks.id | Chunk nguồn |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |

---

## 8.10. Bảng quizzes

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã quiz |
| user_id | UUID | FK → users.id | Người tạo |
| document_id | UUID | FK → documents.id | Tài liệu nguồn |
| map_id | UUID | FK → knowledge_maps.id, NULL | Bản đồ liên quan |
| source_review_item_id | UUID | FK → review_plan_items.id, NULL | Review item sinh ra practice quiz |
| source_attempt_id | UUID | FK → quiz_attempts.id, NULL | Attempt chẩn đoán gốc |
| title | VARCHAR(500) | NOT NULL | Tên quiz |
| quiz_type | VARCHAR(50) | NOT NULL | diagnostic, practice |
| scope_json | JSONB | NULL | Phạm vi |
| question_count | INT | NOT NULL | Số câu |
| difficulty | VARCHAR(50) | NOT NULL | easy, medium, hard, mixed |
| status | VARCHAR(50) | NOT NULL | processing, ready, failed |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |
| updated_at | TIMESTAMP | NOT NULL | Ngày cập nhật |

---

## 8.11. Bảng quiz_questions

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã câu hỏi |
| quiz_id | UUID | FK → quizzes.id | Quiz |
| section_id | UUID | FK → sections.id, NULL | Section nguồn |
| knowledge_node_id | UUID | FK → knowledge_nodes.id, NULL | Node liên quan |
| question_text | TEXT | NOT NULL | Nội dung câu hỏi |
| question_type | VARCHAR(50) | NOT NULL | multiple_choice, true_false, short_answer |
| options_json | JSONB | NULL | Danh sách lựa chọn |
| correct_answer | TEXT | NOT NULL | Đáp án đúng |
| explanation | TEXT | NOT NULL | Giải thích |
| difficulty | VARCHAR(50) | NOT NULL | easy, medium, hard |
| concept_tags_json | JSONB | NOT NULL | Danh sách concept |
| order_index | INT | NOT NULL | Thứ tự câu |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |

---

## 8.12. Bảng quiz_question_chunks

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã bản ghi |
| question_id | UUID | FK → quiz_questions.id | Câu hỏi |
| chunk_id | UUID | FK → document_chunks.id | Chunk nguồn |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |

---

## 8.13. Bảng quiz_attempts

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã lượt làm |
| quiz_id | UUID | FK → quizzes.id | Quiz |
| user_id | UUID | FK → users.id | Người làm |
| score | DECIMAL(5,2) | NULL | Điểm tổng |
| correct_count | INT | NULL | Số câu đúng |
| incorrect_count | INT | NULL | Số câu sai |
| total_questions | INT | NOT NULL | Tổng số câu |
| max_score | DECIMAL(5,2) | NOT NULL | Điểm tối đa của attempt |
| percentage | DECIMAL(5,2) | NULL | score / max_score × 100 |
| duration_seconds | INT | NULL | Thời lượng làm bài |
| status | VARCHAR(50) | NOT NULL | in_progress, submitted, graded, cancelled |
| started_at | TIMESTAMP | NOT NULL | Bắt đầu |
| submitted_at | TIMESTAMP | NULL | Nộp bài |
| graded_at | TIMESTAMP | NULL | Chấm xong |
| metadata_json | JSONB | NULL | Metadata |

---

## 8.14. Bảng quiz_answers

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã câu trả lời |
| attempt_id | UUID | FK → quiz_attempts.id | Lượt làm |
| question_id | UUID | FK → quiz_questions.id | Câu hỏi |
| user_answer | TEXT | NULL | Câu trả lời |
| verdict | VARCHAR(20) | NULL | correct, partial, incorrect |
| is_correct | BOOLEAN | NULL | Đúng/sai |
| score | DECIMAL(4,2) | NULL | Điểm câu: 1.0, 0.5 hoặc 0.0 |
| feedback | TEXT | NULL | Phản hồi |
| graded_at | TIMESTAMP | NULL | Thời điểm chấm |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |
| updated_at | TIMESTAMP | NULL | Lần sửa đáp án gần nhất khi còn nháp |

---

## 8.15. Bảng concept_masteries

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã mastery |
| user_id | UUID | FK → users.id | Người học |
| document_id | UUID | FK → documents.id | Tài liệu |
| attempt_id | UUID | FK → quiz_attempts.id | Lượt làm |
| section_id | UUID | FK → sections.id, NULL | Section |
| knowledge_node_id | UUID | FK → knowledge_nodes.id, NULL | Node |
| concept_name | VARCHAR(255) | NOT NULL | Tên concept |
| correct_count | INT | NOT NULL | Số câu đúng hoàn toàn |
| earned_score | DECIMAL(5,2) | NOT NULL | Tổng điểm đạt được, tính cả câu partial |
| total_count | INT | NOT NULL | Tổng số câu |
| mastery_score | DECIMAL(4,2) | NOT NULL | Điểm mastery |
| status | VARCHAR(50) | NOT NULL | mastered, light_review, review_needed, critical_gap |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |

> Ghi chú: mỗi bản ghi là một snapshot mastery theo một attempt cụ thể, không phải mastery tích lũy của người học. Mastery tổng hợp theo thời gian (FR-12.4) được tính bằng cách aggregate nhiều attempt.

---

## 8.16. Bảng review_plans

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã review plan |
| attempt_id | UUID | FK → quiz_attempts.id, UNIQUE | Lượt làm tạo plan |
| user_id | UUID | FK → users.id | Người học |
| document_id | UUID | FK → documents.id | Tài liệu |
| summary | TEXT | NOT NULL | Tóm tắt gợi ý |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |
| updated_at | TIMESTAMP | NOT NULL | Ngày cập nhật |

---

## 8.17. Bảng review_plan_items

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã item |
| review_plan_id | UUID | FK → review_plans.id | Review plan |
| concept_mastery_id | UUID | FK → concept_masteries.id, NULL | Concept yếu |
| section_id | UUID | FK → sections.id, NULL | Section cần ôn |
| knowledge_node_id | UUID | FK → knowledge_nodes.id, NULL | Node cần ôn |
| topic | VARCHAR(255) | NOT NULL | Chủ đề |
| priority | INT | NOT NULL | Thứ tự ưu tiên |
| reason | TEXT | NOT NULL | Lý do |
| status | VARCHAR(50) | NOT NULL | light_review, review_needed, critical_gap |
| mastery_score | DECIMAL(4,2) | NOT NULL | Điểm mastery |
| review_tasks_json | JSONB | NOT NULL | Nhiệm vụ ôn |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |

---

## 8.18. Bảng review_item_chunks

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã bản ghi |
| review_item_id | UUID | FK → review_plan_items.id | Mục ôn |
| chunk_id | UUID | FK → document_chunks.id | Chunk cần ôn |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |

---

## 8.19. Bảng jobs

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã job |
| user_id | UUID | FK → users.id | Người tạo |
| job_type | VARCHAR(100) | NOT NULL | Loại job |
| status | VARCHAR(50) | NOT NULL | pending, running, completed, failed, cancelled, timeout |
| progress | INT | NOT NULL | Tiến độ |
| current_step | VARCHAR(255) | NULL | Bước hiện tại |
| input_json | JSONB | NULL | Input |
| result_type | VARCHAR(100) | NULL | Loại kết quả |
| result_id | UUID | NULL | ID kết quả |
| error_message | TEXT | NULL | Lỗi |
| cancel_requested | BOOLEAN | NOT NULL DEFAULT false | Yêu cầu hủy |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |
| updated_at | TIMESTAMP | NOT NULL | Ngày cập nhật |

---

## 8.20. Bảng ai_validation_logs

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
| --- | --- | --- | --- |
| id | UUID | PK | Mã log |
| job_id | UUID | FK → jobs.id, NULL | Job sinh ra output |
| target_type | VARCHAR(50) | NOT NULL | quiz_question, review_item |
| target_ref | VARCHAR(255) | NULL | Mã tạm của item bị loại |
| rule_code | VARCHAR(50) | NOT NULL | Mã quy tắc vi phạm, ví dụ FR-13.5 |
| severity | VARCHAR(20) | NOT NULL | rejected, warning |
| message | TEXT | NULL | Mô tả lỗi |
| payload_json | JSONB | NULL | Nội dung item bị loại |
| created_at | TIMESTAMP | NOT NULL | Ngày tạo |

Bảng này phục vụ FR-13.10 và FR-13.11, đồng thời cung cấp dữ liệu cho các chỉ số chất lượng như citation accuracy và quiz relevance accuracy.

---

# 9. Quan hệ giữa các bảng

## 9.1. Quan hệ tổng quát

| Quan hệ | Kiểu | Ý nghĩa |
| --- | --- | --- |
| users → documents | 1 - N | Một user có nhiều tài liệu |
| users → quizzes | 1 - N | Một user tạo nhiều quiz |
| users → quiz_attempts | 1 - N | Một user có nhiều lượt làm bài |
| users → review_plans | 1 - N | Một user có nhiều kế hoạch ôn tập |
| users → jobs | 1 - N | Một user có nhiều job |
| documents → sections | 1 - N | Một tài liệu có nhiều section |
| documents → document_chunks | 1 - N | Một tài liệu có nhiều chunk |
| documents → knowledge_maps | 1 - N | Một tài liệu có nhiều bản đồ học tập |
| documents → quizzes | 1 - N | Một tài liệu có thể tạo nhiều quiz |
| sections → sections | 1 - N | Section cha có nhiều section con |
| sections → document_chunks | 1 - N | Một section có nhiều chunk |
| knowledge_maps → knowledge_nodes | 1 - N | Một map có nhiều node |
| knowledge_maps → knowledge_edges | 1 - N | Một map có nhiều edge |
| knowledge_nodes → knowledge_nodes | 1 - N | Node cha có nhiều node con |
| knowledge_nodes ↔︎ document_chunks | N - N | Node liên kết nhiều chunk |
| quizzes → quiz_questions | 1 - N | Một quiz có nhiều câu hỏi |
| quiz_questions ↔︎ document_chunks | N - N | Câu hỏi dựa trên nhiều chunk |
| quizzes → quiz_attempts | 1 - N | Một quiz có nhiều lượt làm |
| quiz_attempts → quiz_answers | 1 - N | Một attempt có nhiều câu trả lời |
| quiz_questions → quiz_answers | 1 - N | Một câu hỏi có nhiều answer |
| quiz_attempts → concept_masteries | 1 - N | Một attempt sinh nhiều mastery |
| quiz_attempts → review_plans | 1 - 0..1 | Một attempt có thể sinh tối đa một review plan |
| review_plans → review_plan_items | 1 - N | Một review plan có nhiều item |
| review_plan_items ↔︎ document_chunks | N - N | Một item gợi ý nhiều chunk cần ôn |
| documents → review_plans | 1 - N | Một tài liệu có nhiều kế hoạch ôn tập |
| users → concept_masteries | 1 - N | Một user có nhiều bản ghi mastery |
| documents → concept_masteries | 1 - N | Một tài liệu có nhiều bản ghi mastery |
| review_plan_items → quizzes | 1 - N | Một review item có thể sinh nhiều practice quiz |
| quiz_attempts → quizzes | 1 - N | Một attempt chẩn đoán có thể sinh nhiều practice quiz |
| jobs → ai_validation_logs | 1 - N | Một job sinh nhiều log validation |

---

## 9.2. ERD dạng văn bản

```
users
 ├── documents
 │    ├── sections
 │    │    ├── sections self-reference
 │    │    └── document_chunks
 │    ├── document_chunks
 │    ├── knowledge_maps
 │    │    ├── knowledge_nodes
 │    │    │    ├── knowledge_nodes self-reference
 │    │    │    └── knowledge_node_chunks ── document_chunks
 │    │    └── knowledge_edges ── knowledge_nodes
 │    └── quizzes
 │         ├── quiz_questions
 │         │    └── quiz_question_chunks ── document_chunks
 │         └── quiz_attempts
 │              ├── quiz_answers ── quiz_questions
 │              ├── concept_masteries
 │              └── review_plans
 │                   └── review_plan_items
 │                        └── review_item_chunks ── document_chunks
 └── jobs
      └── ai_validation_logs
```

---

# 10. Yêu cầu ràng buộc dữ liệu

## 10.1. Người dùng

- `users.email` phải unique.
- `users.password_hash` không được null.
- Không lưu mật khẩu dạng plain text.
- `users.role` chỉ nhận giá trị hợp lệ.

## 10.2. Tài liệu

- `documents.user_id` không được null.
- `documents.status` chỉ nhận trạng thái hợp lệ.
- Chỉ xử lý tài liệu có định dạng được hỗ trợ.
- Không tạo quiz khi document chưa `completed`.

## 10.3. Section và chunk

- `sections.document_id` không được null.
- `document_chunks.document_id` không được null.
- `document_chunks.text` không được rỗng.
- `document_chunks.chunk_index` phải có thứ tự.
- Mỗi chunk nên có `section_id` nếu xác định được.

## 10.4. Study Map

- `knowledge_maps.document_id` không được null.
- `knowledge_nodes.map_id` không được null.
- `knowledge_nodes.title` không được rỗng.
- `knowledge_nodes.parent_node_id` không được trỏ về chính node đó.
- `knowledge_edges.source_node_id` và `target_node_id` không được giống nhau.

## 10.5. Quiz

- `quizzes.document_id` không được null.
- `quiz_questions.quiz_id` không được null.
- `quiz_questions.question_text` không được rỗng.
- `quiz_questions.correct_answer` không được rỗng.
- `quiz_questions.explanation` không được rỗng.
- Mỗi câu hỏi phải có ít nhất một chunk nguồn trong `quiz_question_chunks`.

## 10.6. Attempt và answer

- `quiz_attempts.quiz_id` không được null.
- `quiz_attempts.user_id` không được null.
- `quiz_answers.attempt_id` không được null.
- `quiz_answers.question_id` không được null.
- Một attempt không nên có hai answer cho cùng một question.

## 10.7. Mastery và review

- `concept_masteries.mastery_score` nằm trong khoảng 0 đến 1.
- `concept_masteries.total_count` phải lớn hơn 0.
- `review_plans.attempt_id` nên unique.
- `review_plan_items.priority` không được null.
- Mỗi review item nên có section, knowledge node hoặc chunk liên quan.

## 10.8. Ràng buộc UNIQUE

| Bảng | Ràng buộc UNIQUE | Lý do |
| --- | --- | --- |
| users | (email) | Email là định danh đăng nhập |
| document_chunks | (document_id, chunk_index) | Thứ tự chunk không được trùng trong một tài liệu |
| quiz_question_chunks | (question_id, chunk_id) | Bảng nối, tránh trùng bản ghi |
| knowledge_node_chunks | (node_id, chunk_id) | Bảng nối, tránh trùng bản ghi |
| review_item_chunks | (review_item_id, chunk_id) | Bảng nối, tránh trùng bản ghi |
| quiz_answers | (attempt_id, question_id) | Một attempt chỉ có một answer cho mỗi câu hỏi |
| concept_masteries | (attempt_id, concept_name) | Một attempt chỉ có một mastery cho mỗi concept |
| review_plans | (attempt_id) | Một attempt chỉ có một review plan |
| review_plan_items | (review_plan_id, priority) | Không có hai item cùng thứ tự ưu tiên |

---

## 10.9. Ràng buộc CHECK

| Bảng | Ràng buộc CHECK |
| --- | --- |
| users | `role IN ('learner','teacher','admin')` |
| documents | `status IN ('uploaded','processing','completed','failed','deleted')` |
| documents | `file_size > 0` |
| sections | `id <> parent_section_id` |
| sections | `level >= 1` |
| document_chunks | `length(trim(text)) > 0` |
| knowledge_nodes | `id <> parent_node_id` |
| knowledge_edges | `source_node_id <> target_node_id` |
| quizzes | `quiz_type IN ('diagnostic','practice')` |
| quizzes | `difficulty IN ('easy','medium','hard','mixed')` |
| quizzes | `status IN ('processing','ready','failed')` |
| quizzes | `quiz_type <> 'practice' OR source_review_item_id IS NOT NULL` |
| quiz_questions | `question_type IN ('multiple_choice','true_false','short_answer')` |
| quiz_questions | `difficulty IN ('easy','medium','hard')` |
| quiz_attempts | `status IN ('in_progress','submitted','graded','cancelled')` |
| quiz_attempts | `correct_count + incorrect_count <= total_questions` |
| quiz_attempts | `score <= max_score` |
| quiz_attempts | `percentage BETWEEN 0 AND 100` |
| quiz_answers | `verdict IN ('correct','partial','incorrect')` |
| quiz_answers | `score IN (0, 0.5, 1)` |
| concept_masteries | `mastery_score BETWEEN 0 AND 1` |
| concept_masteries | `total_count > 0` |
| concept_masteries | `correct_count <= total_count` |
| concept_masteries | `earned_score <= total_count` |
| concept_masteries | `status IN ('mastered','light_review','review_needed','critical_gap')` |
| review_plan_items | `priority >= 1` |
| review_plan_items | `status IN ('light_review','review_needed','critical_gap')` |
| jobs | `progress BETWEEN 0 AND 100` |
| jobs | `status IN ('pending','running','completed','failed','cancelled','timeout')` |
| ai_validation_logs | `severity IN ('rejected','warning')` |

---

## 10.10. Quy tắc xóa dữ liệu

- Xóa tài liệu ở mức người dùng là soft delete: `documents.status = 'deleted'`, dữ liệu con giữ nguyên và bị ẩn ở tầng truy vấn.
- Hard delete tài liệu áp dụng `ON DELETE CASCADE` theo cây quan hệ ở mục 9.2.
- `jobs.result_id` là khóa đa hình, không đặt FK. Ứng dụng kiểm tra tính hợp lệ dựa trên `result_type` với các giá trị hợp lệ: `document`, `knowledge_map`, `quiz`, `review_plan`.

---

# 11. Use Case chính

## 11.1. UC-01 — Upload tài liệu

| Thành phần | Mô tả |
| --- | --- |
| Actor | Learner |
| Mục tiêu | Tải tài liệu học tập lên hệ thống |
| Tiền điều kiện | Người dùng đã đăng nhập |
| Hậu điều kiện | Tài liệu được lưu và chờ xử lý |

### Luồng chính

1. Người dùng chọn file tài liệu.
2. Người dùng nhập tên tài liệu.
3. Người dùng bấm upload.
4. Hệ thống kiểm tra định dạng.
5. Hệ thống lưu file và tạo bản ghi document.
6. Hệ thống tạo job xử lý tài liệu.
7. Hệ thống hiển thị trạng thái xử lý.

---

## 11.2. UC-02 — Tạo quiz chẩn đoán

| Thành phần | Mô tả |
| --- | --- |
| Actor | Learner |
| Mục tiêu | Tạo quiz từ tài liệu |
| Tiền điều kiện | Tài liệu đã xử lý xong |
| Hậu điều kiện | Quiz được tạo và sẵn sàng làm bài |

### Luồng chính

1. Người dùng chọn tài liệu.
2. Người dùng chọn số câu, độ khó và loại câu hỏi.
3. Người dùng bấm tạo quiz.
4. Hệ thống lấy section/chunk liên quan.
5. Hệ thống tạo câu hỏi.
6. Hệ thống validate câu hỏi.
7. Hệ thống lưu quiz.
8. Hệ thống hiển thị quiz cho người học.

---

## 11.3. UC-03 — Làm quiz

| Thành phần | Mô tả |
| --- | --- |
| Actor | Learner |
| Mục tiêu | Hoàn thành quiz |
| Tiền điều kiện | Quiz đã sẵn sàng |
| Hậu điều kiện | Attempt được lưu |

### Luồng chính

1. Người dùng mở quiz.
2. Hệ thống hiển thị câu hỏi.
3. Người dùng chọn đáp án.
4. Người dùng chuyển câu.
5. Người dùng nộp bài.
6. Hệ thống lưu attempt và answers.
7. Hệ thống chuyển sang bước chấm điểm.

---

## 11.4. UC-04 — Xem kết quả và chủ đề yếu

| Thành phần | Mô tả |
| --- | --- |
| Actor | Learner |
| Mục tiêu | Xem kết quả quiz và biết phần yếu |
| Tiền điều kiện | Quiz đã được chấm |
| Hậu điều kiện | Người học thấy topic yếu và review plan |

### Luồng chính

1. Hệ thống chấm bài.
2. Hệ thống hiển thị điểm.
3. Hệ thống hiển thị đáp án đúng.
4. Hệ thống phân tích concept yếu.
5. Hệ thống tạo review plan.
6. Người học xem phần cần ôn.

---

## 11.5. UC-05 — Tạo câu luyện tập bổ sung

| Thành phần | Mô tả |
| --- | --- |
| Actor | Learner |
| Mục tiêu | Luyện thêm phần yếu |
| Tiền điều kiện | Review plan đã được tạo |
| Hậu điều kiện | Practice quiz được tạo |

### Luồng chính

1. Người học chọn một topic yếu.
2. Người học bấm tạo câu luyện tập.
3. Hệ thống lấy chunk liên quan.
4. Hệ thống tạo practice quiz.
5. Người học làm practice quiz.
6. Hệ thống lưu kết quả luyện tập.

---

# 12. Tiêu chí nghiệm thu tổng thể

MVP được xem là đạt yêu cầu khi:

1. Người dùng upload được tài liệu.
2. Hệ thống xử lý được tài liệu thành section và chunk.
3. Hệ thống tạo được Study Map.
4. Hệ thống tạo được quiz từ tài liệu.
5. Mỗi câu quiz có liên kết nguồn tài liệu.
6. Người học làm và nộp quiz được.
7. Hệ thống chấm được kết quả.
8. Hệ thống phát hiện được ít nhất một topic yếu.
9. Hệ thống gợi ý đúng section/chunk cần ôn.
10. Người học có thể tạo thêm câu luyện tập cho topic yếu.
11. Practice quiz truy vết được về review item và attempt gốc.
12. Hệ thống so sánh được mastery score trước và sau khi luyện tập.
13. Câu hỏi bị AI Validation loại bỏ đều có bản ghi trong `ai_validation_logs`.

Các tiêu chí này phù hợp với định nghĩa thành công của MVP trong PRD.

---

# 13. Giả định và phụ thuộc

## 13.1. Giả định

- Người dùng có tài liệu học tập ở định dạng hỗ trợ.
- Tài liệu có nội dung text đủ để trích xuất.
- Tài liệu có cấu trúc chương/mục hoặc có thể chia chunk tương đối rõ.
- Người dùng có kết nối internet khi sử dụng hệ thống.
- Hệ thống có quyền sử dụng AI model hoặc API tương ứng.

## 13.2. Phụ thuộc

- Dịch vụ lưu file.
- Database quan hệ.
- Vector search hoặc FAISS.
- AI model/LLM.
- Embedding model.
- Background job queue.

---

# 14. Giới hạn hệ thống

Trong phạm vi MVP, hệ thống chưa hỗ trợ:

- LMS hoàn chỉnh.
- Quản lý lớp học phức tạp.
- Chấm tự luận dài.
- Huấn luyện model riêng.
- Xử lý video bài giảng dài.
- Adaptive learning dài hạn.
- Đồng bộ với hệ thống trường học.
- Xuất báo cáo PDF nâng cao.

---

# 15. Kết luận

SRS này đặc tả các yêu cầu chính cho hệ thống **StudyMap AI**, một hệ thống hỗ trợ học tập dựa trên tài liệu. Hệ thống tập trung vào luồng học tập có định hướng:

```
Tài liệu
→ Bản đồ học tập
→ Quiz chẩn đoán
→ Kết quả làm bài
→ Chủ đề yếu
→ Phần tài liệu cần ôn
→ Câu luyện tập bổ sung
```

Điểm quan trọng nhất của StudyMap AI là mọi câu hỏi và mọi gợi ý ôn tập đều phải truy ngược được về dữ liệu học tập gốc thông qua `section_id`, `knowledge_node_id` và `chunk_id`. Nhờ đó, hệ thống không chỉ tạo quiz và chấm điểm, mà còn giúp người học biết chính xác mình yếu ở đâu và cần ôn lại phần nào trong tài liệu.