# Audit vòng 7 — đường tạo quiz, từ nút bấm tới câu hỏi lưu DB

Vòng 6 trace đường đi của một FILE. Vòng này trace một HÀNH ĐỘNG: bấm "Tạo quiz" một lần
thì hệ thống làm những gì. Khởi điểm là một lỗi thật người dùng gặp:

```
Tạo quiz thất bại
Gọi model thất bại: LLM busy (in-process): all 1 slots in use, waited 180.0s
```

## Đường đi thật (đã trace, không suy đoán)

```
QuizSetup.jsx:78  onSubmit         -> generateQuiz()  (KHÔNG có cờ chặn bấm lặp)
studyApi.js:56    POST /api/quizzes/generate
main.py:2609      api_quizzes_generate  -> create_job + enqueue_job -> 202 {job_id}
main.py:2500+     run_quiz_generation_job  (thread, vì Redis không chạy)
  generator.build_context   18000 ký tự ngữ liệu
  generator.generate_questions  -> ask_ai(feature="quiz")
  llm_factory._inproc_gate     BoundedSemaphore(MAX_CONCURRENT_LLM_CALLS=1)
  ai_validation.rules.validate_questions -> accepted / rejected
  quiz_repo.save_questions
```

## Bằng chứng của lần hỏng

Log server, 5 POST trong **2 giây**:

```
00:24:40 POST /api/quizzes/generate 202   x3
00:24:41 POST /api/quizzes/generate 202   x2
quiz_job_done   f97dc5d6 kept=3 rejected=2
quiz_job_failed 43e873d3 err=... LLM busy (in-process): all 1 slots in use, waited 180.0s
quiz_job_failed 8ebf370b err=... (như trên)
quiz_job_failed 488b300d err=... (như trên)
```

Một lần muốn ra đề -> **năm** job. Một job thắng slot, ba job xếp hàng rồi chết. Người dùng
thấy "Tạo quiz thất bại" dù thực ra có một quiz đã tạo xong.

---

## Q1 — FE không chặn bấm lặp (nguyên nhân trực tiếp)

> **ĐÃ SỬA** — cờ `submitting` đặt trước `await`, nút `disabled` + nhãn "Đang gửi yêu cầu…". Mượn khuôn `submitting` có sẵn ở `QuizTaking.jsx`.

`QuizSetup.onSubmit` không có cờ đang-gửi; `<button type="submit">` không bao giờ
`disabled`. Giữa lúc bấm và lúc 202 về, giao diện **không đổi gì** — không spinner, không
khoá nút — nên bấm thêm là phản xạ đúng của người dùng.

`job.jobId` chỉ được đặt SAU `await`, mà chính nó mới là thứ thay form bằng `JobProgress`.

**Việc cần làm:** cờ `submitting` đặt TRƯỚC `await`, nút `disabled` + đổi nhãn.

## Q2 — BE nhận job trùng vô điều kiện

> **ĐÃ SỬA** — `_quiz_job_giu_cho()`, kiểm-và-giữ trong MỘT lần khoá. 6 test ở `tests/test_quiz_job_dedupe.py`, gồm ca đua `threading.Barrier(2)` và ca `get_job` trả `None` không được khoá vĩnh viễn.

Route không nhìn xem người này đã có job quiz nào đang chạy cho đúng tài liệu + đúng cấu
hình chưa. Nên cờ ở FE là **chưa đủ**: F5, hai tab, hoặc app mobile bấm lại đều nhân bản.

Trên máy 1 slot LLM, mỗi job trùng không chỉ vô ích — nó **đẩy job thật ra khỏi hàng đợi**.

**Việc cần làm:** dedupe theo `(user_id, document_id, config)`; job cũ còn sống thì trả
lại đúng `job_id` đó kèm `deduped: true`, không tạo job mới.

## Q3 — `num_ctx` NHỎ HƠN ngữ liệu nhồi vào

> **ĐÃ SỬA** — chọn hướng "cho ba con số khớp nhau": `QUIZ_CONTEXT_CHARS` 18000 -> 12000, `QUIZ_LLM_CTX=8192` (trần của gemma2:2b), `QUIZ_LLM_MAX_OUT=3000`, và truyền `num_ctx`/`num_predict` xuống lời gọi quiz thay vì để `LLM_CTX_SIZE=4096` toàn cục. `build_context` in `quiz_context_cat_bot` khi bỏ đoạn. Test khoá bất đẳng thức giữa ba số, không khoá từng số.

| | giá trị | ở đâu |
|---|---|---|
| cửa sổ ngữ cảnh | `num_ctx=4096` | `LLM_CTX_SIZE`, `llm_factory.py:223` |
| token sinh tối đa | `num_predict=8192` | `LLM_MAX_TOKENS`, `llm_factory.py:46` |
| ngữ liệu quiz | 18000 **ký tự** ≈ 5000–7000 token | `QUIZ_CONTEXT_CHARS`, `generator.py:19` |

`num_predict` gấp đôi `num_ctx` là vô nghĩa với Ollama — cửa sổ chứa cả prompt lẫn phần
sinh. Ngữ liệu một mình đã vượt cửa sổ nên Ollama **cắt prompt trong im lặng**.
`build_context` cắt theo KÝ TỰ, không biết gì về cửa sổ token của model đang dùng.

**Cần quyết, không tự sửa:** nâng `LLM_CTX_SIZE` (chậm hơn, gemma2:2b trần 8192) hay hạ
`QUIZ_CONTEXT_CHARS` (ít ngữ liệu, nhưng thật thà). Cả hai đổi chất lượng đề.

## Q4 — Xin 5 câu, nhận 3, không ai nói gì

> **ĐÃ SỬA** — `QuizSetup` gửi `{asked, kept, rejected}` qua router state; `QuizTaking` hiện một dòng khi `rejected > 0`.

`result` của job có `rejected_count` (`main.py:2590`) nhưng **FE không đọc khoá đó**. Ở lần
hỏng thật: `kept=3 rejected=2` — người dùng chọn 5 câu và nhận 3, im lặng.

Cùng họ với "fail-open đúng nhưng báo cáo sai" của vòng 6 (P2).

**Việc cần làm:** khi `rejected_count > 0`, nói ra ở trang làm bài.

## Q5 — Chờ hàng đợi và model hỏng nói cùng một câu

> **ĐÃ SỬA** — `_job_error_text` (bộ định dạng lỗi DÙNG CHUNG của mọi job) dịch `LLM busy` / `LLM gateway busy` / `timed out` sang việc người dùng làm được, giữ nguyên văn kỹ thuật trong ngoặc.

`LLM busy (in-process)` và `LLM call timed out` đều tới người dùng dưới dạng
`Gọi model thất bại: ...`. Hai thứ khác hẳn nhau: một cái bảo "thử lại sau", một cái bảo
"máy không kham nổi". **Chỉ ghi lại, chưa sửa** — sửa Q1+Q2 thì hàng đợi hết dài, và
đổi phân loại lỗi là đụng vào đường lỗi chung của mọi feature.

---

## Thứ tự chạy

| | mũi | vì sao ở đây | rủi ro |
|---|---|---|---|
| 1 | Q1 cờ chặn bấm lặp | nguyên nhân trực tiếp của lỗi đã báo | thấp |
| 2 | Q2 dedupe job ở BE | cờ FE không cứu được F5 / hai tab | thấp |
| 3 | Q4 nói ra số câu bị loại | trạng thái đang nói dối | thấp |
| 4 | Q3 num_ctx | ba con số không khớp -> cắt prompt im lặng | trung bình |
| 5 | Q5 phân loại lỗi | hai lỗi khác nhau nói cùng một câu | thấp |

**Điểm dừng:** BE ≥ 925 passed / 4 skipped, FE build + 212 test.

## Cố ý KHÔNG làm

- **Không nâng `MAX_CONCURRENT_LLM_CALLS`.** 1 slot là đúng cho CPU không GPU: hai lời gọi
  song song trên cùng một CPU không nhanh hơn, chỉ chia đôi tốc độ và gấp đôi bộ nhớ.
- **Không thêm framework test React.** FE chưa có `@testing-library`; cờ `submitting` là
  ba dòng trạng thái giao diện. Logic đáng khoá bằng test là dedupe ở BE — và nó test được.
- **Không đổi `MAX_ATTEMPTS`, không đổi luật `ai_validation`.** Câu bị loại là kiểm chất
  lượng làm đúng việc; vấn đề là không ai nói ra.
