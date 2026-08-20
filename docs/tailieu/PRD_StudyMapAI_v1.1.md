# PRD — StudyMap AI

> **Ghi chú phiên bản.** Tài liệu này là tầng sản phẩm. Với mọi nội dung về module, lược đồ dữ liệu, API và ràng buộc, **SRS và Đặc tả Module & CSDL là tài liệu chuẩn**; PRD chỉ tóm tắt lại để giữ mạch sản phẩm. Nếu phát hiện lệch nhau, lấy SRS và Đặc tả làm gốc.

## 1. Tên sản phẩm

**StudyMap AI: Hệ thống tạo bản đồ học tập, quiz chẩn đoán và gợi ý ôn tập từ tài liệu**

---

## 2. Tóm tắt sản phẩm

StudyMap AI là hệ thống AI hỗ trợ học tập từ tài liệu do người dùng tải lên. Hệ thống phân tích tài liệu học tập như PDF, slide, giáo trình, ghi chú; sau đó tự động tạo quiz chẩn đoán theo từng chủ đề. Khi người học hoàn thành bài quiz, hệ thống chấm điểm, phát hiện các phần kiến thức còn yếu và gợi ý chính xác chương, mục hoặc đoạn tài liệu cần ôn lại.

Điểm khác biệt của StudyMap AI là mỗi câu hỏi trong quiz đều được liên kết với nguồn kiến thức trong tài liệu gốc thông qua `section_id`, `chunk_refs` và `concept_tags`. Nhờ đó, khi người học trả lời sai, hệ thống có thể truy ngược về đúng phần tài liệu cần ôn, thay vì chỉ báo điểm số chung chung.

## 3. Bối cảnh và vấn đề

Người học thường có nhiều tài liệu học tập nhưng gặp khó khăn trong việc xác định phần nào là trọng tâm, phần nào mình chưa hiểu và nên ôn lại ở đâu. Các công cụ AI hiện tại thường hỗ trợ tóm tắt hoặc hỏi đáp tài liệu, nhưng chưa giải quyết tốt quy trình học tập sau:

```
Tài liệu học tập → Tạo bài kiểm tra → Chẩn đoán lỗi sai → Xác định lỗ hổng kiến thức → Chỉ dẫn phần tài liệu cần ôn → Tạo lộ trình ôn tập cá nhân hóa
```

StudyMap AI giải quyết vấn đề này bằng cách biến tài liệu học tập thành một hệ thống tự kiểm tra và ôn tập có định hướng.

## 4. Mục tiêu sản phẩm

### 4.1. Mục tiêu chính

Xây dựng một hệ thống AI có khả năng:

1. Phân tích tài liệu học tập.
2. Tạo quiz chẩn đoán từ nội dung tài liệu.
3. Gắn mỗi câu hỏi với nguồn kiến thức tương ứng.
4. Chấm kết quả làm bài của người học.
5. Phát hiện các chủ đề người học còn yếu.
6. Gợi ý chính xác phần tài liệu cần ôn lại.
7. Tạo lộ trình ôn tập cá nhân hóa.

### 4.2. Mục tiêu MVP

Trong phiên bản MVP, sản phẩm cần demo được luồng:

```
Upload tài liệu → Xử lý tài liệu → Tạo bản đồ học tập → Tạo quiz → Người học làm quiz → Chấm điểm → Phân tích chủ đề yếu → Gợi ý phần tài liệu cần ôn → Tạo thêm câu luyện tập
```

Phạm vi MVP theo SRS mục 2.5 gồm 9 nhóm chức năng: upload tài liệu, phân tích tài liệu, tạo bản đồ học tập, tạo quiz chẩn đoán, làm quiz, chấm điểm, phân tích chủ đề yếu, gợi ý phần tài liệu cần ôn và tạo câu luyện tập bổ sung.

### 4.3. Mục tiêu không thuộc MVP

MVP chưa tập trung vào:

1. Xây dựng hệ thống LMS hoàn chỉnh.
2. Quản lý lớp học nhiều giáo viên, nhiều học sinh.
3. Huấn luyện mô hình AI riêng.
4. Chấm tự luận dài phức tạp như bài văn, bài luận.
5. Xử lý video bài giảng dài.
6. Adaptive learning nâng cao theo lịch sử học dài hạn.
7. Đồng bộ dữ liệu với Google Classroom, Moodle hoặc hệ thống trường học.

## 5. Đối tượng người dùng

### 5.1. Người học

Bao gồm học sinh, sinh viên hoặc người tự học.

Nhu cầu:

- Tải tài liệu học tập lên.
- Muốn biết phần nào mình chưa hiểu.
- Muốn được gợi ý nên ôn lại phần nào.
- Muốn luyện thêm câu hỏi ở phần còn yếu.

### 5.2. Giáo viên hoặc trợ giảng

Nhu cầu:

- Tạo quiz nhanh từ tài liệu dạy học.
- Biết học sinh thường sai ở chủ đề nào.
- Tạo tài liệu ôn tập hoặc bài luyện tập bổ sung.

### 5.3. Người ôn thi

Nhu cầu:

- Biến tài liệu dài thành bài kiểm tra nhanh.
- Xác định lỗ hổng kiến thức trước kỳ thi.
- Tạo kế hoạch ôn tập theo thời gian ngắn.

## 6. Giá trị cốt lõi

### 6.1. Với người học

StudyMap AI giúp người học trả lời 3 câu hỏi quan trọng:

1. Mình đang hiểu bài đến đâu?
2. Mình đang yếu ở phần nào?
3. Mình cần quay lại học phần nào trong tài liệu?

### 6.2. Với giáo viên

StudyMap AI giúp giáo viên:

1. Tạo quiz nhanh từ giáo trình hoặc slide.
2. Tạo bộ câu hỏi bám sát tài liệu.
3. Phân tích phần kiến thức học sinh dễ sai.
4. Tạo nội dung ôn tập có dẫn chứng từ tài liệu gốc.

### 6.3. Với sản phẩm

StudyMap AI không chỉ là chatbot hỏi đáp tài liệu. Sản phẩm tạo ra một vòng học tập hoàn chỉnh:

```
Đọc tài liệu → Kiểm tra hiểu bài → Phát hiện lỗi sai → Ôn lại đúng chỗ → Luyện tập thêm
```

## 7. Luồng người dùng chính

### 7.1. User Flow tổng quát

```
Người dùng đăng nhập → Upload tài liệu → Hệ thống xử lý tài liệu → Người dùng chọn tạo quiz → Hệ thống sinh quiz → Người dùng làm bài → Hệ thống chấm điểm → Hệ thống phân tích chủ đề yếu → Hệ thống gợi ý phần tài liệu cần ôn → Người dùng xem tài liệu gốc / tạo bài luyện thêm
```

### 7.2. Flow 1 — Upload và xử lý tài liệu

**Mục tiêu:** Người dùng tải tài liệu học tập lên hệ thống để hệ thống phân tích.

**Input:**

- File PDF
- File DOCX
- File TXT
- Slide xuất PDF
- Ảnh tài liệu, nếu hệ thống OCR hỗ trợ

**Xử lý:**

1. Trích xuất text từ tài liệu.
2. Chia tài liệu thành các chunk.
3. Gắn metadata cho từng chunk.
4. Tạo vector embedding.
5. Lưu vào vector index.
6. Tạo Memory Tree hoặc Knowledge Map.
7. Chuẩn bị dữ liệu cho quiz generator.

**Output:**

- `document_id`
- Danh sách section
- Danh sách chunk
- `memory_tree`
- Trạng thái xử lý tài liệu

**Acceptance Criteria:**

- Người dùng upload được tài liệu hợp lệ.
- Hệ thống hiển thị trạng thái xử lý.
- Sau khi xử lý xong, tài liệu xuất hiện trong danh sách tài liệu.
- Mỗi chunk phải có `document_id`, `chunk_id`, `section_id`.
- Tài liệu lỗi phải có thông báo rõ ràng.

### 7.3. Flow 2 — Tạo quiz chẩn đoán

**Mục tiêu:** Hệ thống tạo bài quiz từ tài liệu đã xử lý.

**Cấu hình quiz** — Người dùng có thể chọn:

- Tài liệu cần tạo quiz
- Phạm vi: toàn tài liệu hoặc từng chương/mục
- Số câu: 5, 10, 15, 20
- Độ khó: dễ, vừa, khó, hỗn hợp
- Dạng câu hỏi: trắc nghiệm, đúng/sai, tự luận ngắn

**Logic tạo quiz:**

1. Lấy các section/chunk liên quan từ tài liệu.
2. Xác định concept chính trong từng section.
3. Sinh câu hỏi theo concept.
4. Tạo đáp án đúng.
5. Tạo giải thích ngắn.
6. Gắn metadata nguồn: `section_id`, `chunk_refs`, `concept_tags`.
7. Validate JSON output.
8. Lưu quiz vào database.

**Output quiz question:**

```json
{
  "question_id": "q_001",
  "question_text": "Quy tắc đạo hàm hàm hợp được dùng trong trường hợp nào?",
  "question_type": "multiple_choice",
  "options": [
    "Khi hàm số là tổng của hai hàm",
    "Khi hàm số là tích của hai hàm",
    "Khi hàm số là hàm của một hàm khác",
    "Khi hàm số là hằng số"
  ],
  "correct_answer": "Khi hàm số là hàm của một hàm khác",
  "explanation": "Quy tắc đạo hàm hàm hợp áp dụng khi một hàm được tạo bởi sự lồng nhau của các hàm.",
  "difficulty": "medium",
  "concept_tags": ["đạo hàm", "hàm hợp", "quy tắc dây chuyền"],
  "section_id": "section_2_3",
  "chunk_refs": ["chunk_18", "chunk_21"]
}
```

**Acceptance Criteria:**

- Quiz được tạo từ tài liệu đã upload.
- Mỗi câu hỏi có đáp án đúng.
- Mỗi câu hỏi có explanation.
- Mỗi câu hỏi có ít nhất một `chunk_ref`.
- Mỗi câu hỏi có `concept_tags`.
- Không tạo câu hỏi ngoài nội dung tài liệu.
- Quiz có thể lưu và mở lại.

### 7.4. Flow 3 — Người học làm quiz

**Mục tiêu:** Người học hoàn thành quiz trên giao diện.

**UI cần có:**

- Tiêu đề quiz
- Số câu hỏi
- Câu hỏi hiện tại
- Các lựa chọn đáp án
- Nút chuyển câu
- Nút nộp bài
- Trạng thái câu đã làm / chưa làm

**Dữ liệu cần lưu:**

```json
{
  "attempt_id": "attempt_001",
  "quiz_id": "quiz_001",
  "user_id": "user_001",
  "answers": [
    {
      "question_id": "q_001",
      "user_answer": "Khi hàm số là tích của hai hàm"
    }
  ],
  "submitted_at": "2026-07-09T18:00:00+07:00"
}
```

**Acceptance Criteria:**

- Người học có thể chọn đáp án.
- Người học có thể đổi đáp án trước khi nộp.
- Hệ thống cảnh báo nếu còn câu chưa trả lời.
- Sau khi nộp, attempt được lưu.
- Người học được chuyển sang trang kết quả.

---

### 7.5. Flow 4 — Chấm điểm

**Mục tiêu:** Hệ thống chấm bài quiz và đưa ra kết quả.

**Logic chấm — Trắc nghiệm và đúng/sai:**

- So sánh `user_answer` với `correct_answer`.
- Đúng: 1 điểm. Sai: 0 điểm.

**Logic chấm — Tự luận ngắn:**

- Dùng LLM hoặc rule đơn giản để so sánh với đáp án mẫu.
- Trả về `verdict`: `correct` / `partial` / `incorrect`.
- Quy đổi điểm: `correct` = 1.0, `partial` = 0.5, `incorrect` = 0.0.
- Có feedback ngắn.

**Thang điểm attempt:**

```
score      = SUM(quiz_answers.score)
max_score  = total_questions × 1.0
percentage = score / max_score × 100
```

`score` là điểm thô, không quy đổi sang thang 10.

**Output:**

```json
{
  "attempt_id": "attempt_001",
  "quiz_id": "quiz_001",
  "score": 7.0,
  "max_score": 10.0,
  "percentage": 70.0,
  "total_questions": 10,
  "correct_count": 7,
  "incorrect_count": 3,
  "results": [
    {
      "question_id": "q_001",
      "verdict": "incorrect",
      "is_correct": false,
      "score": 0.0,
      "user_answer": "Khi hàm số là tích của hai hàm",
      "correct_answer": "Khi hàm số là hàm của một hàm khác",
      "feedback": "Bạn đang nhầm giữa quy tắc đạo hàm tích và quy tắc đạo hàm hàm hợp."
    }
  ]
}
```

---

### 7.6. Flow 5 — Phân tích lỗ hổng kiến thức

**Mục tiêu:** Dựa trên các câu sai, hệ thống xác định người học yếu ở chủ đề nào.

**Logic phân tích:**

1. Lấy danh sách câu sai.
2. Nhóm câu sai theo `concept_tags`.
3. Nhóm câu sai theo `section_id`.
4. Tính `mastery_score` cho từng concept.
5. Phân loại mức độ nắm bài.

**Công thức mastery score:**

```
earned_score  = SUM(quiz_answers.score) của các câu thuộc concept
total_count   = tổng số câu thuộc concept
mastery_score = earned_score / total_count
```

Câu `partial` đóng góp 0.5 điểm.

**Phân loại:**

| Mức | Trạng thái |
| --- | --- |
| >= 80% | Đã nắm tốt |
| 60–79% | Cần ôn nhẹ |
| 40–59% | Cần ôn lại |
| < 40% | Hổng kiến thức nghiêm trọng |

**Output:**

```json
{
  "weak_topics": [
    {
      "concept": "Quy tắc đạo hàm hàm hợp",
      "mastery_score": 0.25,
      "status": "Hổng kiến thức nghiêm trọng",
      "wrong_questions": ["q_001", "q_004", "q_009"],
      "section_id": "section_2_3",
      "chunk_refs": ["chunk_18", "chunk_21"]
    }
  ]
}
```

### 7.7. Flow 6 — Gợi ý ôn tập cá nhân hóa

**Mục tiêu:** Hệ thống tạo lộ trình ôn tập dựa trên lỗi sai.

**Logic tạo review guide:**

1. Lấy `weak_topics` từ kết quả phân tích.
2. Lấy lại section/chunk liên quan từ tài liệu.
3. Tạo gợi ý ôn tập cho từng chủ đề yếu.
4. Đề xuất thứ tự ôn.
5. Đề xuất nhiệm vụ luyện tập tiếp theo.

**Output review guide:**

```json
{
  "review_plan_id": "review_001",
  "attempt_id": "attempt_001",
  "summary": "Bạn cần ôn lại 3 chủ đề chính trước khi làm lại bài kiểm tra.",
  "review_items": [
    {
      "priority": 1,
      "topic": "Quy tắc đạo hàm hàm hợp",
      "status": "Hổng kiến thức nghiêm trọng",
      "reason": "Bạn sai 3/4 câu liên quan đến quy tắc đạo hàm hàm hợp.",
      "recommended_sections": [
        {
          "section_id": "section_2_3",
          "section_title": "Quy tắc đạo hàm hàm hợp",
          "chunk_refs": ["chunk_18", "chunk_21"]
        }
      ],
      "review_tasks": [
        "Đọc lại định nghĩa quy tắc hàm hợp.",
        "Xem lại ví dụ trong mục 2.3.",
        "Làm thêm 5 câu luyện tập mức dễ."
      ]
    }
  ]
}
```

---

### 7.8. Flow 7 — Tạo câu luyện tập bổ sung

**Mục tiêu:** Hệ thống tạo thêm câu hỏi cho các chủ đề người học còn yếu.

**Input:**

```json
{
  "attempt_id": "attempt_001",
  "topic": "Quy tắc đạo hàm hàm hợp",
  "question_count": 5,
  "difficulty": "easy"
}
```

**Acceptance Criteria:**

- Câu luyện tập phải thuộc topic yếu.
- Câu luyện tập phải bám vào section/chunk được gợi ý.
- Người học có thể làm quiz luyện tập.
- Kết quả luyện tập được lưu.

## 8. Tính năng sản phẩm

### 8.1. Tính năng bắt buộc trong MVP

**F1. Document Upload** — Hỗ trợ PDF, DOCX, TXT. Hiển thị trạng thái xử lý. Lưu `document_id`. Cho phép xem lại danh sách tài liệu.

**F2. Document Analysis** — Extract text, chunk tài liệu, tạo embedding, tạo vector index, tạo section tree hoặc memory tree, gắn metadata cho chunk.

**F3. Quiz Generator** — Cho phép chọn số câu, độ khó, loại câu hỏi. Câu hỏi có đáp án, giải thích và `citation/chunk_refs`.

**F4. Quiz Taking** — Hiển thị câu hỏi rõ ràng. Lưu câu trả lời. Cho phép nộp bài. Tạo `attempt_id`.

**F5. Auto Grading** — Chấm trắc nghiệm, đúng/sai. Hiển thị điểm tổng và đáp án đúng.

**F6. Weak Topic Detection** — Nhóm câu sai theo `concept_tags`. Tính `mastery_score`. Phân loại mức độ nắm bài. Liên kết topic yếu với section/chunk.

**F7. Review Guide** — Chỉ ra topic cần ôn, section/chunk cần đọc lại, lý do và gợi ý nhiệm vụ ôn tập.

**F8. Practice More** — Tạo thêm câu từ topic yếu, có đáp án, giải thích và `chunk_refs`. Practice quiz phải lưu `source_review_item_id` và `source_attempt_id` để so sánh được kết quả trước và sau luyện tập.

**F9. Study Map** — Tạo bản đồ học tập từ tài liệu: node kiến thức, quan hệ giữa các node, liên kết node với chunk nguồn. Tương ứng FR-04 trong SRS.

**F10. Semantic Search** — Tìm kiếm ngữ nghĩa trong tài liệu để lấy chunk liên quan phục vụ tạo quiz và gợi ý ôn tập. Tương ứng FR-05 trong SRS.

**F11. AI Validation** — Kiểm tra đầu ra của AI, loại câu hỏi thiếu nguồn hoặc trùng lặp, ghi log vào `ai_validation_logs`. Tương ứng FR-13 trong SRS.

### 8.2. Tính năng nên có sau MVP

1. Dashboard tiến độ học tập.
2. Lịch ôn tập theo ngày.
3. Xuất review guide ra PDF/Markdown.
4. Tạo flashcard từ topic yếu.
5. So sánh lần làm quiz trước và sau khi ôn.
6. Teacher mode để giáo viên tạo quiz cho lớp.
7. Thống kê câu hỏi học sinh sai nhiều nhất.
8. Adaptive difficulty theo năng lực người học.

## 9. Yêu cầu phi chức năng

### 9.1. Hiệu năng

- Upload tài liệu nhỏ dưới 10MB phải xử lý được ổn định.
- Quiz 10 câu nên tạo trong một job bất đồng bộ.
- Trang làm quiz phải phản hồi nhanh.
- Kết quả chấm trắc nghiệm/đúng sai trả về gần như tức thì.

### 9.2. Độ tin cậy

- Hệ thống không được tạo quiz khi tài liệu chưa xử lý xong.
- Nếu LLM trả JSON lỗi, hệ thống phải retry hoặc báo lỗi.
- Nếu thiếu `chunk_refs`, câu hỏi không được đưa vào quiz chính thức.
- Nếu tài liệu extract text quá ít, hệ thống phải cảnh báo.

### 9.3. Tính minh bạch

- Mỗi câu hỏi cần có nguồn từ tài liệu.
- Review guide phải nêu lý do vì sao đề xuất ôn phần đó.
- Người học có thể mở lại đoạn tài liệu liên quan.

### 9.4. Bảo mật

- Người dùng chỉ xem được tài liệu của mình.
- Quiz và attempt phải gắn với `user_id`.
- Không expose raw file path.
- Không lưu API key ở frontend.

### 9.5. Khả năng mở rộng

- Module quiz nên tách riêng với module summary/mindmap.
- Có thể thêm question type mới sau này.
- Có thể thay đổi model LLM mà không sửa toàn bộ hệ thống.

## 10. Màn hình UI

### 10.1. Document List Page

- Tên tài liệu, trạng thái xử lý, ngày upload
- Nút xem tài liệu, tạo quiz, tạo summary, tạo mindmap

### 10.2. Quiz Setup Page

- Chọn tài liệu, phạm vi, số câu, độ khó, dạng câu hỏi
- Nút Generate Quiz

### 10.3. Quiz Taking Page

- Tiêu đề quiz, tiến độ (câu 3/10)
- Nội dung câu hỏi, đáp án lựa chọn
- Nút Câu trước / Câu sau / Nộp bài
- Danh sách câu hỏi bên cạnh

### 10.4. Quiz Result Page

- Điểm tổng, số câu đúng/sai
- Danh sách câu hỏi với đáp án người học, đáp án đúng, giải thích, chủ đề liên quan

### 10.5. Review Guide Page

- Tóm tắt kết quả học tập
- Danh sách topic yếu, mastery score, chương/mục cần ôn
- Link mở đoạn tài liệu gốc, nhiệm vụ ôn tập
- Nút tạo thêm câu luyện tập

### 10.6. Practice Page

- Topic đang luyện, câu hỏi luyện tập, đáp án, giải thích
- Nút làm tiếp / quay lại review guide

## 11. API Design

Danh sách đầy đủ và có thẩm quyền nằm ở SRS mục 7 và Đặc tả Module & CSDL mục 12. Bảng dưới tóm tắt để tiện tra cứu.

| Nhóm | Endpoint |
| --- | --- |
| Xác thực | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Tài liệu | `POST /api/documents/upload`, `GET /api/documents`, `GET /api/documents/{document_id}`, `DELETE /api/documents/{document_id}`, `GET /api/documents/{document_id}/sections`, `GET /api/documents/{document_id}/chunks` |
| Tìm kiếm | `POST /api/documents/{document_id}/search`, `POST /api/search` |
| Study Map | `POST /api/study-maps/generate`, `GET /api/study-maps/jobs/{job_id}`, `GET /api/study-maps/{map_id}`, `GET /api/documents/{document_id}/study-maps` |
| Quiz | `POST /api/quizzes/generate`, `GET /api/quizzes/jobs/{job_id}`, `GET /api/quizzes/{quiz_id}`, `POST /api/quizzes/{quiz_id}/attempts`, `GET /api/quizzes/results/{attempt_id}` |
| Attempt | `GET /api/attempts/{attempt_id}`, `PATCH /api/attempts/{attempt_id}/answers`, `POST /api/attempts/{attempt_id}/submit` |
| Review Plan | `POST /api/review-plans/generate`, `GET /api/review-plans/{attempt_id}`, `GET /api/review-plans/{review_plan_id}/items` |
| Practice | `POST /api/practice/generate`, `GET /api/practice/{practice_quiz_id}`, `POST /api/practice/{practice_quiz_id}/submit`, `GET /api/practice/{practice_quiz_id}/comparison` |
| Tiến độ | `GET /api/progress/overview`, `GET /api/progress/concepts`, `GET /api/progress/attempts` |
| Job | `GET /api/jobs/{job_id}`, `POST /api/jobs/{job_id}/cancel` |

### 11.1. Generate Quiz

```
POST /api/quiz/generate
```

```json
{
  "document_id": "doc_123",
  "scope": { "type": "full_document", "section_ids": [] },
  "question_count": 10,
  "difficulty": "mixed",
  "question_types": ["multiple_choice", "true_false", "short_answer"]
}
```

### 11.2. Vòng đời làm bài

```
POST /api/quizzes/{quiz_id}/attempts       → tạo attempt, status = in_progress
PATCH /api/attempts/{attempt_id}/answers   → lưu nháp câu trả lời
POST /api/attempts/{attempt_id}/submit     → nộp bài, status = submitted
GET /api/quizzes/results/{attempt_id}      → xem kết quả sau khi chấm
```

> Ghi chú: `GET /api/quizzes/{quiz_id}` không trả `correct_answer` và `explanation` trước khi người dùng nộp bài.

---

## 12. Data Model

Lược đồ chuẩn gồm **19 bảng**, đặc tả chi tiết ở SRS mục 8 và Đặc tả Module & CSDL mục 5. PRD chỉ liệt kê để nắm tổng thể.

| Nhóm | Bảng |
| --- | --- |
| Người dùng | `users` |
| Tài liệu | `documents`, `sections`, `document_chunks` |
| Study Map | `knowledge_maps`, `knowledge_nodes`, `knowledge_edges`, `knowledge_node_chunks` |
| Quiz | `quizzes`, `quiz_questions`, `quiz_question_chunks` |
| Làm bài | `quiz_attempts`, `quiz_answers` |
| Chẩn đoán | `concept_masteries` |
| Ôn tập | `review_plans`, `review_plan_items`, `review_item_chunks` |
| Vận hành | `jobs`, `ai_validation_logs` |

Một số điểm cần nhớ ở tầng sản phẩm:

- Liên kết câu hỏi với nguồn tài liệu được **chuẩn hóa thành bảng nối** `quiz_question_chunks`, không lưu dạng `chunk_refs_json`.
- Review plan được **chuẩn hóa** thành `review_plans` → `review_plan_items` → `review_item_chunks`, không lưu dạng `review_items_json`.
- Practice quiz dùng chung bảng `quizzes` với `quiz_type = 'practice'`, kèm `source_review_item_id` và `source_attempt_id` để truy vết nguồn gốc.
- `concept_masteries` là snapshot theo từng attempt, không phải mastery tích lũy.

---

## 13. Prompt Design

### 13.1. Prompt tạo quiz

```
You are an educational diagnostic quiz generator.

Given the provided document sections and chunks, create a diagnostic quiz.

Requirements:
- Questions must be answerable only from the provided context.
- Each question must test one clear concept.
- Each question must include: question_text, question_type, options if multiple_choice, correct_answer, explanation, difficulty, concept_tags, section_id, chunk_refs
- Avoid vague or opinion-based questions.
- Do not create questions from outside knowledge.
- Use clear language suitable for learners.
- Return valid JSON only.

Context: {document_sections_and_chunks}
Quiz configuration: {quiz_config}
```

### 13.2. Prompt chấm tự luận ngắn

```
You are a strict but helpful educational grader.

Grade the user's short answer based only on the expected answer and source context.

Return:
- verdict: correct, partial, or incorrect
- score: 0, 0.5, or 1
- feedback: short explanation
- missing_points: list of missing key ideas

Question: {question}
Expected answer: {correct_answer}
Source context: {source_context}
User answer: {user_answer}
```

### 13.3. Prompt tạo review guide

```
You are an educational review planner.

Given the quiz result and source document references, create a personalized review guide.

Requirements:
- Identify weak concepts.
- Explain why each concept needs review.
- Recommend exact document sections and chunk references.
- Provide short review tasks.
- Suggest follow-up practice.
- Do not recommend unrelated sections.
- Keep the tone supportive and clear.
- Return valid JSON only.

Quiz result: {quiz_result}
Weak topic analysis: {weak_topics}
Source sections: {source_sections}
```

---

## 14. Rule-based Logic

### 14.1. Mastery Score

```
earned_score  = SUM(quiz_answers.score) của các câu thuộc concept
total_count   = tổng số câu thuộc concept
mastery_score = earned_score / total_count
```

Trong đó mỗi câu đóng góp 1.0 nếu `verdict = correct`, 0.5 nếu `partial` và 0.0 nếu `incorrect`. Cột `correct_count` vẫn được lưu riêng để báo cáo số câu đúng hoàn toàn.

### 14.2. Status Mapping

| Ngưỡng | Trạng thái |
| --- | --- |
| >= 0.80 | mastered |
| >= 0.60 | light_review |
| >= 0.40 | review_needed |
| < 0.40 | critical_gap |

### 14.3. Priority Ranking

Ưu tiên ôn tập dựa trên:

1. Mastery score thấp hơn.
2. Số câu sai nhiều hơn.
3. Topic có nhiều `chunk_refs` quan trọng hơn.
4. Topic là prerequisite của các topic khác, nếu Memory Tree hỗ trợ.

---

## 15. Thành công của MVP

MVP được xem là thành công khi:

1. Người dùng upload được tài liệu.
2. Hệ thống tạo được quiz từ tài liệu.
3. Mỗi câu quiz có liên kết nguồn tài liệu.
4. Người học làm và nộp quiz được.
5. Hệ thống chấm được kết quả.
6. Hệ thống phát hiện được ít nhất 1 topic yếu.
7. Hệ thống gợi ý đúng section/chunk cần ôn.
8. Người học có thể tạo thêm câu luyện tập cho topic yếu.
9. Practice quiz truy vết được về review item và attempt gốc.
10. Hệ thống so sánh được mastery score trước và sau khi luyện tập.

## 16. Metrics đánh giá

### 16.1. Product Metrics

- Số tài liệu được upload.
- Số quiz được tạo.
- Tỷ lệ quiz hoàn thành.
- Số review guide được xem.
- Số lần người học tạo practice quiz.

### 16.2. Quality Metrics

- Quiz relevance accuracy: câu hỏi có bám tài liệu không.
- Citation accuracy: `chunk_refs` có đúng nguồn không.
- Grading accuracy: chấm đúng/sai có chính xác không.
- Review recommendation accuracy: gợi ý ôn tập có đúng phần cần ôn không.

### 16.3. Learning Metrics

- Điểm quiz lần 1 so với lần 2.
- Tỷ lệ topic chuyển từ weak sang mastered.
- Số câu sai giảm sau khi ôn.

## 17. Rủi ro và cách xử lý

### 17.1. AI tạo câu hỏi ngoài tài liệu

- Prompt bắt buộc chỉ dùng context.
- Mỗi câu phải có `chunk_refs`.
- Câu không có `chunk_refs` bị loại.
- Có bước validate source coverage.
- Mọi câu bị loại được ghi vào `ai_validation_logs` kèm `rule_code`, phục vụ đo citation accuracy.

### 17.2. Gợi ý ôn tập sai section

- Review guide không tự đoán section mới.
- Chỉ dùng `section_id` và `chunk_refs` từ câu sai.
- Ưu tiên rule-based mapping trước, LLM chỉ dùng để diễn giải.

### 17.3. Chấm tự luận không ổn định

- MVP ưu tiên trắc nghiệm và đúng/sai.
- Tự luận ngắn chỉ dùng cho câu trả lời ngắn.
- Có trạng thái `partial` thay vì ép đúng/sai tuyệt đối.

### 17.4. Tài liệu dài khiến tạo quiz chậm

- Tạo quiz bằng async job.
- Cho phép tạo quiz theo section.
- Cache quiz theo `document_id + config_hash`.

### 17.5. Tài liệu extract text kém

- Kiểm tra số lượng text extract được.
- Cảnh báo người dùng nếu tài liệu không đủ nội dung.
- Cho phép OCR hoặc upload bản text khác.

## 18. Roadmap triển khai

### Phase 1 — Chuẩn hóa dữ liệu tài liệu *(~1 tuần)*

- Kiểm tra lại pipeline upload và ingest.
- Đảm bảo mỗi chunk có `document_id`, `section_id`, `chunk_id`.
- Tạo API lấy section/chunk theo tài liệu.
- Chuẩn hóa Memory Tree hoặc Section Tree.

### Phase 2 — Quiz Generator *(~1–2 tuần)*

- Tạo endpoint generate quiz.
- Viết prompt tạo quiz.
- Validate JSON output.
- Lưu quiz và questions.
- UI cấu hình quiz.

### Phase 3 — Quiz Taking và Grading *(~1 tuần)*

- UI làm quiz.
- API submit quiz.
- Chấm trắc nghiệm/đúng sai.
- Lưu attempt và answer.
- Hiển thị result page.

### Phase 4 — Weak Topic Detection *(~1 tuần)*

- Nhóm câu sai theo `concept_tags`.
- Tính `mastery_score`.
- Tạo danh sách `weak_topics`.
- Gắn `weak_topics` với section/chunk.

### Phase 5 — Review Guide *(~1 tuần)*

- Tạo review plan từ `weak_topics`.
- Lấy lại section/chunk liên quan.
- Sinh nhiệm vụ ôn tập.
- UI hiển thị review guide.

### Phase 6 — Practice More *(~1 tuần)*

- Tạo câu luyện tập cho topic yếu.
- Cho phép làm practice quiz.
- So sánh kết quả trước/sau.

---

## 19. Phiên bản MVP đề xuất

MVP nên giới hạn rõ:

- Chỉ hỗ trợ tài liệu text/PDF rõ chữ.
- Quiz tối đa 10 câu trong bản demo.
- Dạng câu hỏi chính: trắc nghiệm và đúng/sai.
- Tự luận ngắn là optional.
- Review guide dựa trên `section_id`, `chunk_refs` và `concept_tags`.
- Không làm dashboard lớp học.

**MVP demo tốt nhất:**

1. Upload tài liệu Toán.
2. Tạo quiz 10 câu.
3. Làm sai vài câu.
4. Hệ thống báo yếu ở "quy tắc hàm hợp".
5. Hệ thống chỉ về mục 2.3 trong tài liệu.
6. Bấm tạo thêm 5 câu luyện tập về "quy tắc hàm hợp".

## 20. Open Questions

### 20.1. Đã chốt

| Câu hỏi | Kết luận | Căn cứ |
| --- | --- | --- |
| Sản phẩm ưu tiên học sinh hay giáo viên? | Ưu tiên người học. Bảng `users` vẫn có `role` gồm learner, teacher, admin để mở rộng sau. | SRS FR-01, NFR-05.4 |
| Quiz cần bao nhiêu dạng câu hỏi ở bản đầu? | Ba dạng: `multiple_choice`, `true_false`, `short_answer`. Tự luận ngắn có `verdict` gồm correct / partial / incorrect. | SRS FR-06, FR-08 |
| Có cần lưu lịch sử nhiều lần làm quiz không? | Có. Mỗi lần làm là một `quiz_attempts` riêng, `concept_masteries` là snapshot theo attempt. | SRS mục 8.13, 8.15 |
| Review guide hiển thị đoạn tài liệu hay chỉ link section? | Trỏ tới cả section và chunk cụ thể qua `review_item_chunks`, giao diện mở được đúng đoạn. | SRS NFR-03.3, FR-10 |
| Có cần teacher mode trong bản demo không? | Không thuộc MVP, để sau. | SRS mục 2.5, NFR-05.4 |

### 20.2. Còn để mở

1. MVP chỉ hỗ trợ tiếng Việt hay cả tiếng Anh?
2. Có cần export review guide và kết quả ra PDF không?
3. Có cần giới hạn số câu hỏi hoặc số tài liệu theo tài khoản không?

## 21. Kết luận

StudyMap AI là hướng mở rộng phù hợp cho nền tảng HTMemvid vì tận dụng được các thành phần đã có như xử lý tài liệu, vector search, Memory Tree, mindmap và hỏi đáp theo tài liệu. Phần mở rộng mới tập trung vào giá trị giáo dục rõ ràng hơn: tạo quiz chẩn đoán, phát hiện lỗ hổng kiến thức và gợi ý chính xác phần tài liệu cần ôn lại.

Luồng sản phẩm cốt lõi cần giữ là:

```
Tài liệu → Quiz chẩn đoán → Lỗi sai → Chủ đề yếu → Phần tài liệu cần ôn → Luyện tập thêm
```

Đây là phạm vi đủ rõ, đủ thực tế và có thể phát triển thành MVP hoàn chỉnh mà không làm đề tài bị quá rộng.

[ĐẶC TẢ MODULE VÀ THIẾT KẾ CƠ SỞ DỮ LIỆU HỆ THỐNG STUDYMAP AI](https://app.notion.com/p/C-T-MODULE-V-THI-T-K-C-S-D-LI-U-H-TH-NG-STUDYMAP-AI-3b8ca208a99c8069ba75c60a128355da?pvs=21)

[](https://app.notion.com/p/3baca208a99c802692c9c19793a6cb51?pvs=21)