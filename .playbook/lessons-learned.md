# Lessons Learned

## 2026-09-09 - Trạng thái AI phải phân biệt kho BỀN VỮNG với kho PHÙ DU

- **Đọc chỗ trống thành "đang tạo" là một lời nói dối có lịch chạy.** Thư viện học tập
  cần trạng thái tóm tắt / sơ đồ tư duy, nhưng hai kho ấy là SQLite dưới `DATA_DIR`, và
  trên Render Free `DATA_DIR` bị xoá mỗi lần deploy lẫn mỗi lần dịch vụ ngủ (~15 phút).
  Thiết kế đầu tiên định hiện "Đang tạo tóm tắt…" khi không tìm thấy bản ghi — nghĩa là
  màn hình sẽ nói dối PHẦN LỚN thời gian, và người dùng ngồi chờ một việc chưa từng bắt
  đầu. Quy tắc rút ra: `GENERATING` chỉ được sinh từ **bằng chứng dương** (một job đang
  chạy có thật), không bao giờ từ sự vắng mặt.

- **Bằng chứng dương đó thường đã nằm sẵn ở đâu đó — tìm trước khi thêm cột.** Bảng
  `jobs` không lưu nguồn của job nên máy chủ không gắn được job tóm tắt với tài liệu.
  Nhưng `utils/activeJob.js` đã lưu `{jobId, sources, startedAt}` từ lâu, và `sources`
  chính là stem. Trạng thái "đang tạo" giải được HOÀN TOÀN ở client, không thêm cột, không
  sửa dispatch của summary/mindmap. Chi phí duy nhất là nó theo từng máy — và như thế thì
  sai lệch luôn nghiêng về phía an toàn (hiện "chưa có" thay vì "đang tạo" giả).

## 2026-09-09 - Trước khi thêm cột, hỏi dữ liệu đã có suy ra được không

- **Sáu cột bị loại vì suy ra được.** `reading_time` ← `char_count`; `language` ← metadata
  chunk (ingest đã chạy langdetect từ trước); `ai_overview` ← `sections[].key_points` của
  bản ghi tóm tắt; `summary_preview` ← `overview`; `mindmap_layout` ← `knowledge_nodes`
  (`parent_node_id`, `level`, `order_index`) + `knowledge_edges.relation_type` đã đủ cho
  9/10 layout; `last_workspace_ref` ← quiz/attempt mới nhất tra được bằng `array_agg(...
  ORDER BY ...)[1]` trong chính truy vấn đếm. Một giá trị vừa lưu vừa suy ra được là hai
  nguồn sự thật, và bản lưu sẽ lệch ngay lần tạo lại đầu tiên.

- **Ngược lại, `last_opened_at` KHÔNG suy ra được, và lý do đáng ghi.** Mọi mốc thời gian
  đang có (`quiz_attempts.started_at`, `review_plans.created_at`,
  `knowledge_maps.created_at`, `created_at` của bản ghi tóm tắt) ghi lúc TẠO artifact,
  không ghi lúc người dùng MỞ nó. Mở một bản tóm tắt ba lần không sinh dòng nào ở đâu cả.
  Đó là bài kiểm tra thật: "có bảng nào ghi lại đúng sự kiện này chưa?", không phải "có
  bảng nào chứa thông tin gần giống không?".

## 2026-09-09 - Cột trạng thái mới không được mượn cột `status` đang có

- **`archived_at` là cột riêng, không phải một giá trị của `documents.status`.** Nhét
  "đã lưu trữ" vào `status` thì `all_rows()` (lọc `status != 'deleted'`) và `owned_stems()`
  loại nó ra, và tài liệu đã lưu trữ âm thầm biến mất khỏi RAG — người dùng chỉ muốn dọn
  giao diện, không muốn tài liệu ngừng trả lời câu hỏi. Ba khẳng định khoá điều này nằm ở
  `test_study_library_api.py::test_db_luu_tru_khong_lam_tai_lieu_bien_mat_khoi_rag`: sau
  khi lưu trữ, tài liệu vẫn `completed`, vẫn trong `all_rows()`, vẫn trong `owned_stems()`.

## 2026-09-09 - Ký tự tổ hợp Unicode viết trần trong mã nguồn là bom hẹn giờ

- Regex bỏ dấu tiếng Việt viết là `/[<dấu tổ hợp trần>]/g` thì bản thân dấu dính vào ký tự
  liền trước khi hiển thị, và một lần đổi encoding là nó im lặng biến mất — lúc đó bỏ dấu
  hết chạy mà không test nào lộ ra ngay. Viết `/[̀-ͯ]/g`.

- **`đ` KHÔNG phải `d` + dấu.** NFD tách được `ế` nhưng không tách `đ` — nó là một chữ cái
  riêng trong Unicode. Thiếu bước `.replace(/đ/g, "d")` thì gõ "dinh thoi" không bao giờ
  ra "định thời", đúng cái người dùng gõ nhiều nhất.

## 2026-09-01 - Nút bấm không gọi gì cả vẫn có thể trông như đang hoạt động

- **Nút "Huỷ" của chat chưa bao giờ huỷ gì trên máy chủ.** Nó `abort()` request phía
  trình duyệt rồi ghi "Đã huỷ truy vấn." — trong khi BE không có route huỷ cho job
  `query` và `query_graph` không đọc cờ huỷ ở đâu cả. Job chạy tới xong, giữ nguyên slot
  LLM duy nhất, và người dùng hỏi câu tiếp theo rồi không hiểu vì sao chờ lâu. Khi review
  một nút "Huỷ/Dừng/Xoá", câu hỏi đầu tiên là **nó gọi đường nào ở máy chủ**; không gọi
  gì thì lời thông báo phải nói đúng phạm vi của nó.

- **`catch {}` rồi vẫn báo thành công là hình thức nói dối rẻ nhất và hay gặp nhất.** Ba
  chỗ trong một file: xoá ngữ cảnh, xoá lịch sử, và xoá lịch sử còn dọn sạch khung chat
  trước khi biết máy chủ có làm được không. Người dùng tin đã xoá; lượt sau model vẫn
  nhớ.

- **`Promise.all` biến mọi endpoint phụ thành endpoint bắt buộc.** Trang danh sách tài
  liệu gọi 4 endpoint và mất sạch nội dung khi `/api/progress/overview` trả 500 — thứ
  người dùng đến để xem bị xoá bởi một khối thống kê trang trí. Có một thứ chính và vài
  thứ phụ thì `allSettled`, và chỉ ném khi thứ chính hỏng.

- **Một `catch` bọc hai lời gọi sẽ nói dối về một trong hai.** "Nộp bài luyện tập thất
  bại" hiện ngay trên điểm số vừa chấm xong, vì `getPracticeComparison` mới là cái hỏng.
  Cùng khuôn: upload thành công rồi `load()` hỏng thì thông báo mang tên "Tải tài liệu
  lên thất bại". Bọc riêng từng hành động có tên riêng.

- **"Hỏng" và "rỗng" phải là hai màn hình khác nhau.** `setMindMaps([])` trong `catch`
  làm người có đủ sơ đồ đọc "Chưa có sơ đồ nào được lưu" rồi dựng lại từ đầu. Và trạng
  thái rỗng không có cờ tải sẽ nói dối ngay trong lúc đang tải lần đầu. Ba trạng thái
  tối thiểu cho mọi danh sách: đang tải, hỏng (kèm Thử lại), rỗng thật.

- **Trần đếm-lỗi không cứu được vòng lặp mà mọi lần gọi đều thành công.** Job chấm chết ở
  BE thì attempt kẹt `submitted` vĩnh viễn: poll trả 200 mãi mãi, `failStreak` luôn bằng
  0. Vòng chờ một trạng thái thay đổi cần thêm **trần thời gian**, không chỉ trần số lần
  hỏng.

- **Trạng thái sống chỉ nằm trong bộ nhớ của một component là trạng thái sẽ mất.**
  `SidebarLeft` unmount thật khi thu cột trái, và `/list-indexed` chỉ biết những tài liệu
  đã xong — nên thẻ "đang xử lý" bốc hơi và trông như upload hỏng. Cùng bài học với job
  mindmap: lưu id ngay khi nhận được, khôi phục lúc mount, xoá khi tới trạng thái cuối,
  kèm hạn để máy tắt giữa chừng không để lại thẻ ma.

## 2026-09-01 - Cột chỉ có đường ghi mà không có đường đọc thì tính năng đó chưa tồn tại

- **`deleted_at` là ca mẫu.** Ghi ở đúng một chỗ, đọc ở không chỗ nào. Cột có, migration
  có, hàm `soft_delete` có, nút trên giao diện có — và bấm nút xong thì model vẫn nhớ
  nguyên những gì vừa được yêu cầu xoá. Với mọi cột trạng thái (`deleted_at`,
  `archived_at`, `disabled_at`, `revoked_at`), grep **cả hai chiều**: một chiều thiếu
  nghĩa là nút bấm đang nói dối.

- **Sửa ở đường ĐỌC trước, đường ghi sau.** Cám dỗ là chữa `ensure_conversation` cho hàng
  sống lại rồi coi như xong. Nhưng hàng bị xoá mà không ai đụng tới nữa thì vẫn phải
  sạch — đường đọc không được phụ thuộc vào việc một đường ghi khác đã chạy hay chưa.
  Làm cả hai, và đường đọc là đường bắt buộc.

- **Mã chết trộn hai thang đo là bẫy, không phải rác.** `vector_score` là khoảng cách L2
  (nhỏ = tốt) chảy vào một hàm gộp bằng `max` (lớn = tốt), kèm `min(1.0, …)` biến mọi
  khoảng cách > 1 thành "liên quan tuyệt đối". Hôm nay 0 caller nên vô hại; ngày ai đó
  nối lại thì mọi chunk đều `correct` và không có gì kêu. "Không ai gọi" chỉ đúng tới lần
  refactor sau — gỡ hẳn, hoặc sửa cho đúng, đừng để lại.

- **Giữ mã 0 caller thì phải viết ra LÝ DO, không viết ra thì nó thành nợ.**
  `require_auth` được giữ vì `_require_app_user` trả `(uid, error_response)` nên route
  chọn được 404 thay vì 403 ở chỗ không được lộ sự tồn tại của tài nguyên — decorator
  không làm được. Đó là lý do kỹ thuật. Không ghi lại thì lần audit sau nó lại xuất hiện
  trong danh sách "trừu tượng dựng xong rồi bỏ".

- **Docstring đầu file là thứ người sửa đọc đầu tiên, nên nó sai là sai đắt nhất.**
  "the app APIs stay open" đúng ở giai đoạn viết ra và sai từ lâu. Khi đổi mô hình gác
  quyền, sửa câu mô tả cùng lúc với sửa route — nếu không, người sau đọc nó rồi kết luận
  sai về toàn bộ mô hình bảo mật.

- **Test khẳng định-cấu-trúc: bắt tham số, đừng đọc mã nguồn.** Ca "đường đọc phải chặn
  từ mốc xoá" viết bằng `inspect.getsource` là đỏ giả mỗi khi file dịch dòng. Monkeypatch
  hàm bị gọi rồi bắt `after_ts` vừa đúng ý hơn (đo hành vi, không đo cách viết) vừa không
  dính bẫy `linecache`.

## 2026-09-01 - Biến dựng ra rồi không ai đọc là một lỗi, không phải rác vô hại

- **`filtered_indices` là ca mẫu.** Nó được tính đúng — kể cả nhánh nới lỏng khi không có
  node đúng type — rồi bị bỏ, và `idx.search` vẫn quét toàn index với một hằng số
  `top_k*3`. Thứ cần để chặn lỗi đã nằm sẵn trong hàm. Comment "Build mask" còn làm người
  đọc sau tin rằng mask đã được dùng. Khi review, grep biến vừa dựng: không có chỗ đọc
  thì hoặc là mã chết, hoặc là một bước bị quên — và bước bị quên thường im lặng.

- **Lọc sau khi xếp hạng thì bề rộng phải tính theo tỉ lệ, không phải hằng số.** FAISS xếp
  trên toàn index, quyền sở hữu lọc sau: cần `k` node của người sở hữu `p/n` thì trung
  bình phải quét `k*n/p`. Giữ hằng số cũ làm sàn, chặn trên bằng `n`. Nguyên tắc chung:
  mọi chỗ "lấy top-N rồi lọc" đều hỏng dần khi tỉ lệ được-phép giảm, và hỏng theo kiểu
  trả về rỗng chứ không theo kiểu báo lỗi.

- **`return None` im lặng là cách một lỗi sống qua nhiều vòng audit.** Tụt về đường dự
  phòng là fail-open hợp lệ; không để lại một dòng log nào thì không ai truy được. Mỗi
  nhánh "không tìm thấy gì nên đi đường khác" cần in ra đủ số để đọc ngược: bao nhiêu ứng
  viên được phép, tổng bao nhiêu, đã quét bao nhiêu.

- **Hai nơi giữ trạng thái thì cần một đường ĐỒNG BỘ, không chỉ đường ghi.** `jobs_store`
  (SQLite, runtime) và `jobs` (Postgres, kiểm toán) tách nhau có lý do và có ghi trong
  docstring. Nhưng chỉ đường "chạy xong bình thường" nhớ ghi cả hai; bốn đường kết thúc
  khác (sweep, mark_interrupted, reconcile, cancel) chỉ ghi một nơi. Đếm số đường KẾT
  THÚC, đừng đếm số chỗ gọi hàm đóng.

- **Số đo ở lại vĩnh viễn thì lý do của nó cũng phải ở lại vĩnh viễn.**
  `QuizAttempt.percentage` sống mãi và chảy vào thống kê tiến bộ; `ungraded_count` giải
  thích cho nó thì chết sau 7 ngày cùng job. Hai thứ giải thích cho nhau mà tuổi thọ khác
  nhau thì phần giải thích luôn là phần mất trước — và cái còn lại thành một con số không
  ai cãi được.

- **Hai dòng cạnh nhau, một dòng cẩn thận một dòng không.** `s.get(QuizAttempt, ...)` có
  guard `None`, `s.get(Quiz, ...)` ngay dưới thì lấy thuộc tính thẳng. Khi đã viết một
  guard cho một lần `get`, quét nốt các lần `get` còn lại trong cùng hàm — chúng có cùng
  lý do để trả `None`.

## 2026-09-01 - Đừng chấm điểm trên chuỗi mình vừa thêm chữ vào

- **Thước đo tự cộng điểm cho chính nó.** `RetrieveFAISS` dán `[Nguồn: …, đoạn …]` lên
  đầu mỗi chunk cho prompt; `grade_documents` nhận đúng chuỗi đó và tokenize cả nhãn.
  Chunk lạc đề đạt 0.25 — vừa đúng `CRAG_RELEVANCE_THRESHOLD` — chỉ nhờ hai từ "nguồn"
  và "đoạn" mà chính hệ thống vừa thêm vào. Cả tầng CRAG thành trang trí trong im lặng:
  không lỗi, không log, chỉ là nhánh sửa sai không bao giờ chạy.

- **Câu hỏi phải hỏi mỗi khi một tầng làm đẹp dữ liệu cho tầng sau:** còn ai khác đọc
  chuỗi này để ĐO cái gì không? Nhãn trích dẫn, tiền tố vai trò, header markdown, dấu
  phân đoạn — tất cả đều vô hại cho tầng đọc, và đều là nhiễu cho tầng đo. Tầng đo phải
  nhận bản gốc.

- **Dán và gỡ phải nằm cùng một chỗ.** Trước khi sửa, chiều dán ở `query_graph` còn chiều
  gỡ **không tồn tại** — nên không ai nhìn thấy sự bất đối xứng. Đặt cả hai vào một module
  (`retrieval/citation.py`) làm cho việc thiếu một chiều trở nên hiển nhiên, và đổi hình
  dạng nhãn chỉ còn một chỗ để đổi.

- **Test dùng chuỗi trần trong khi production luôn có tiền tố = bộ test đang đo một hệ
  thống khác.** `tests/test_grading.py` phủ khá kỹ ngưỡng, sàn, rerank — và mọi ca đều
  truyền chuỗi sạch. Lưới giăng ở chỗ không ai đi qua. Khi viết test cho một hàm chấm
  điểm, lấy đúng thứ mà caller thật sự truyền vào, đừng lấy thứ dễ gõ.

- **Sửa cái đo, đừng tắt cái bị đo.** Phản xạ nhanh là tắt `INCLUDE_CHUNK_SOURCE_TAGS`.
  Nhưng nhãn có ích thật: nó là thứ cho model trích nguồn. Vấn đề chưa bao giờ là cái
  nhãn.

## 2026-09-01 - Nuốt lỗi không phải là fail-open, đó là nói dối có chủ đích

- **Fail-open là chạy tiếp; nuốt lỗi là chạy tiếp RỒI khẳng định mọi thứ ổn.** Bảy lỗi
  frontend vòng 8 đều nằm ở khoảng cách đó: `catch` xong vẫn hiện "N/M đã trả lời", vẫn
  điều hướng sang trang kết quả, vẫn báo "Chưa có tài liệu nào". Doctrine `.playbook`
  cho phép fail-open, nhưng phần "báo cáo phải nói thật" là phần hay bị bỏ.

- **Ba câu hỏi trước khi viết một `catch`:** (1) người dùng có mất dữ liệu gì không — nếu
  có thì phải trả lại chứ không được nuốt; (2) màn hình sau `catch` có đang khẳng định
  điều gì không còn đúng không; (3) vòng lặp hay timer nào vừa chết theo, và ai bật lại.

- **`res.json()` sau `fetch` không đảm bảo request thành công.** `fetch` chỉ ném khi mạng
  hỏng; 4xx/5xx là "thành công" với body lỗi, và body lỗi cũng là JSON hợp lệ. Thiếu
  `res.ok` là cách phổ biến nhất để một lỗi máy chủ hoá trang thành "không có dữ liệu" —
  đúng họ với `None` khác `0` ở backend.

- **Dọn buffer trước `await` là mất dữ liệu, không phải "tránh gửi trùng".** Mẫu
  `const b = ref.current; ref.current = {}; await gui(b)` đọc rất gọn và ăn trắng lô dữ
  liệu mỗi lần request hỏng. Cần cả hai chiều: lấy ra để gửi, và **trả lại** khi hỏng —
  trả lại mà không đè lên thứ người dùng vừa đổi trong lúc request còn bay.

- **Một thao tác ghi hỏng thì đừng cho thao tác kế tiếp đi tiếp.** Lưu nháp hỏng rồi vẫn
  cho nộp bài là biến một lỗi mạng thành một điểm số sai — thứ ở lại trong DB và chảy vào
  mọi thống kê tiến bộ về sau.

- **Effect poll phụ thuộc vào dữ liệu thì lần hỏi hỏng sẽ giết luôn vòng hỏi.** Lỗi không
  đổi `result`, `result` không đổi thì effect không chạy lại, và trang đứng im mãi. Vòng
  lặp cần một nhịp riêng để tự lên lịch, cộng một trần số lần trượt để không nện mãi.

- **Cờ khoá nút phải là cờ đặt TRƯỚC `await`, không phải cờ suy ra từ kết quả `await`.**
  `disabled={job.running}` trông đúng nhưng `job.jobId` chỉ có sau khi 202 về — cửa sổ ở
  giữa là chỗ người dùng bấm thêm ba lần. Đây là lần thứ hai cùng một lỗi ở hai trang
  khác nhau (Q1 vòng 7 ở `QuizSetup`, FE#4 ở `ReviewGuide`): vá một chỗ thì grep các chỗ
  còn lại ngay, đừng đợi vòng audit sau.

- **Khoá thì phải có đường mở.** `practiceFor` khoá nút, `onDone` điều hướng đi nên không
  ai nghĩ tới việc mở lại — job hỏng thì `onDone` không chạy, trang khoá vĩnh viễn tới
  khi F5. Mỗi cờ khoá cần một câu trả lời cho "ai gỡ nó khi đường thành công không xảy
  ra".

## 2026-09-01 - Comment hứa một cơ chế thì phải grep xem cơ chế đó có thật không

- **Ba nguồn trong cùng một kho, hai nói thật, một nói dối — và nguồn nói dối là nguồn
  người sửa sau đọc.** Comment vòng 7 ghi *"enqueue hỏng thì job nằm 'pending' và
  `sweep_stuck_jobs` dọn"*. Docstring của chính `sweep_stuck_jobs` ghi *"Pending KHÔNG bị
  đụng"*, và `test_fresh_running_and_old_pending_untouched` khoá đúng hành vi ngược đó.
  Comment ấy không mô tả mã, nó mô tả **mong muốn** của người viết. Khi một comment hứa
  "chỗ khác lo rồi", grep chỗ khác trước khi tin.

- **Bước dài không có tiến trình để báo vẫn phải báo là mình còn sống.** Phép đếm rất
  ngắn: thời lượng tối đa của bước × số lần thử, so với `JOB_STUCK_AFTER_SECONDS`. Quiz
  ra 900×2 = 1800 so với 900 — job đang chạy tử tế tự bị quét thành `interrupted`, và
  chính cú poll của người dùng là thứ quét nó (`_run_jobs_maintenance` nằm trong route
  poll). Study map có `progress_cb` từng item nên thoát; quiz là ngoại lệ duy nhất, và
  ngoại lệ duy nhất là chỗ đáng soi nhất.

- **Nhịp tim đừng giả làm tiến trình.** Cách dễ nhất để giữ job sống là
  `update_job(job_id, progress=...)`, và nó sai: báo một con số không có thật đúng chỗ
  người dùng đang nhìn. `touch_job()` chỉ chạm `updated_at` — làm đúng một việc, không
  nói thêm gì.

- **Huỷ chỉ tới được nơi có người đọc nó.** `quiz_generation` nằm trong
  `_CANCELLABLE_JOB_TYPES`, executor có gọi `is_cancel_requested` — nhưng chỉ ở hai điểm
  kẹp NGOÀI lời gọi model. Đăng ký "huỷ được" không làm cho nó huỷ được. Và trần thật thì
  phải nói ra: một request HTTP đang chạy tới Ollama thì Python không cắt ngang được, nên
  worst case đi từ hai lượt xuống một, không xuống không.

- **"Đã huỷ" mà đi vào nhánh lỗi thì thành "Thất bại".** `generate_questions` báo huỷ qua
  kênh `err`, còn job đọc `err` trước khi đọc cờ huỷ — kết quả là màn hình đổ lỗi cho hệ
  thống về hành động chính người dùng vừa bấm. Khi một hàm dùng chung một kênh trả về cho
  hai ý nghĩa khác nhau, thứ tự đọc ở caller trở thành một phần của hợp đồng; hoặc đọc
  đúng thứ tự, hoặc tách kênh.

- **Nhả tài nguyên đã giữ phải kiểm còn là của mình không.** `_quiz_job_nha_cho` xoá chỗ
  chỉ khi chỗ vẫn mang job_id của mình. Xoá vô điều kiện thì mở lại đúng cửa sổ đua mà
  dedupe sinh ra để đóng — sửa một lỗi kẹt bằng cách trả lại một lỗi trùng lặp.


## 2026-09-01 - Chốt bảo mật nằm sau một cờ tính năng thì không phải chốt

- **Cờ tắt là đường mặc định, và đường mặc định phải là đường an toàn.** Kiểm chủ sở hữu
  phiên chat có thật trong `main.py`, viết đúng, nhưng nằm trong khối
  `if _conversation_enabled()`. Cờ đó mặc định `False` và `BE/.env` không khai — tức
  **cấu hình đang chạy là cấu hình rò**. Một chốt chỉ hoạt động khi bật cờ không phải
  chốt, nó là hiệu ứng phụ của một tính năng khác.

- **Bật cờ lên cũng không phải là an toàn, nếu cái chặn không phải luật quyền sở hữu.**
  Bật `CONVERSATION_CONTEXT_ENABLED` thì rò bị chặn — nhưng bởi chốt chống
  cache-poisoning (`if hist and cache_key`), hoàn toàn tình cờ. Rò mở lại mỗi khi
  `cache_key` rơi về `None` (nguồn còn `processing`, hoặc Redis chết). Khi truy nguyên vì
  sao một lỗ "không tái hiện được", phải hỏi *cái gì đang chặn nó* — nếu câu trả lời
  không phải luật đang nói về quyền, thì lỗ vẫn còn, chỉ là chưa gặp điều kiện.

- **Tầng dưới không được ghi đè quyết định của tầng đang giữ phạm vi.**
  `RetrieveFAISS` đọc lại store rồi ghi đè `conversation_history`, kể cả khi route vừa
  quyết định để rỗng. State của graph không mang `user_id` nên node đó **không thể** tự
  giới hạn phạm vi — nó không có dữ liệu để quyết. Mang không đủ ngữ cảnh để tự quyết thì
  đừng ghi đè quyết định của người có đủ.

- **Một guard trong hàm dùng chung nhỏ hơn năm guard ở năm caller.** `sessions_store` có
  đúng hai hàm và năm điểm gọi. Thêm cột `user_id` + kiểm ở hai hàm đó phủ cả chiều đọc
  lẫn chiều ghi, gồm cả những đường chưa ai nghĩ tới. Vá ở từng route thì diff to hơn mà
  vẫn sót.

- **`CREATE TABLE IF NOT EXISTS` bỏ qua cả cột mới.** Thêm cột vào câu CREATE trông như đã
  xong, nhưng với mọi máy đã có DB thì nó là no-op. Phải `PRAGMA table_info` rồi `ALTER
  TABLE` kèm theo — và test phải dựng sẵn một DB kiểu cũ để chứng minh đường migration
  chạy, chứ không chỉ test trên thư mục rỗng.

- **Hàng cũ không có chủ: đừng coi là "của mọi người".** Cột `user_id` thêm sau thì hàng
  cũ là `NULL`. Cho `NULL` khớp mọi người dùng nghe có vẻ tương thích ngược, nhưng nó giữ
  nguyên lỗ với đúng những hàng đang tồn tại — tức đúng những hàng có dữ liệu thật.
  `NULL` chỉ khớp lời gọi cũng không có chủ (chế độ mở). TTL 24h dọn nốt phần còn lại.

- **`inspect.getsource` đọc đĩa, `inspect.signature` đọc RAM.** Test khẳng định-cấu-trúc
  bằng `getsource` đỏ giả khi file bị sửa giữa lúc suite chạy: `co_firstlineno` lấy từ
  module đã nạp, còn nội dung lấy từ `linecache` đọc dòng hiện tại. Suite 22 phút thì cửa
  sổ đó rất rộng. Khoá "thiếu tham số chủ sở hữu" bằng `signature` vừa đúng ý hơn vừa
  không dính bẫy.


## 2026-09-01 - Audit vòng 8: prompt và luật kiểm phải sinh từ cùng một danh sách

- **Hằng số prompt tả nhiều hơn cấu hình cho phép thì tầng luật phía sau chỉ còn việc đếm
  xác.** `_SYSTEM` là hằng số, luôn dạy đủ ba dạng câu hỏi kèm định dạng riêng cho
  `short_answer`; cấu hình thật của người dùng chỉ nằm một dòng trong prompt người dùng.
  Model 2B nghe system prompt: 7/10 câu trả về là dạng đã bị tắt, `validate_questions` loại
  đúng cả 7, người dùng xin 10 nhận 2. Tầng luật **không sai một chỗ nào** — nó chỉ đang
  dọn hậu quả của một chỉ dẫn tự mâu thuẫn. Sau này: bất cứ giá trị nào người dùng chọn
  được thì prompt và luật phải **cùng đọc từ nó**, đừng để một bên là hằng số.

- **Tầng luật sinh ra để đỡ cho model yếu, nên chỗ nó không soi mới là chỗ hổng.**
  `validate_questions` kiểm rất kỹ `correct_answer`, `chunk_refs`, `explanation`,
  `concept_tags` — và **không có một dòng nào** về việc các lựa chọn trắc nghiệm có khác
  nhau không. `['A','B','C','C']` đi thẳng vào DB. Đọc một tầng kiểm tra thì đừng chỉ đọc
  những luật nó *có*; liệt kê những trường nó *chạm* rồi hỏi trường nào bị bỏ qua hoàn
  toàn.

- **Cắt xuống không phải là tôn trọng con số người dùng chọn.** `accepted[:count]` trông
  như đang giữ đúng cấu hình, thật ra nó chỉ chặn trên. Xin 10 nhận 5 vẫn qua được dòng
  đó mà không kêu một tiếng. Con số người dùng chọn là **mục tiêu**, không phải trần: đạt
  thì thôi, không đạt thì bù một lượt, bù vẫn không đạt thì **nói ra phần chênh**
  (`asked_count` trong result), đừng để họ tự đếm.

- **Hàm tử tế viết xong mà không ai gọi thì bằng không.** `getUserFriendlyApiError` nằm
  trong `utils/api.js` từ lâu, xử lý đúng ca `TypeError` của `fetch`, có cả câu tiếng Việt
  sẵn. Grep ra 0 caller trong `pages/study/`, còn 14 chỗ vẫn hiện thẳng `e?.message` —
  người học đọc được nguyên văn `Failed to fetch`. Lần thứ n của họ "trừu tượng dựng xong
  rồi bị bỏ qua" (xem cả `require_auth` 0 caller, `_numeric_score` 0 caller). Viết helper
  xong thì việc chưa xong: phải grep lại xem còn chỗ nào đang làm bằng tay.

- **Và đừng dùng thẳng helper cũ chỉ vì nó tồn tại.** `getUserFriendlyApiError` đổi **mọi**
  lỗi lạ thành "Đã có lỗi xảy ra" — nối nó vào sẽ nuốt luôn những câu tiếng Việt BE đã viết
  sẵn cho người dùng ("Phạm vi đã chọn không có chunk nào đã index"), tức là sửa một lỗi
  hiển thị bằng cách tạo ra một lỗi hiển thị nặng hơn. Bản mới chỉ thay ba nhóm nói bằng
  ngôn ngữ máy: lỗi mạng, lỗi quyền, và `HTTP nnn` trần.

- **Bằng chứng nằm trong bảng log, không nằm trong phỏng đoán.** Ba giả thuyết ban đầu cho
  "xin 10 nhận 5" (model sinh ít, JSON bị cắt vì `num_predict`, luật loại) đều hợp lý.
  `ai_validation_logs` trả lời trong một truy vấn: `count_by_rule` cho từng job nói rõ
  7 câu chết vì FR-13.1 và 5 câu chết vì FR-13.3. FR-13.11 (log giữ **nguyên văn item bị
  loại**) là thứ biến một buổi đoán thành một buổi đọc.


## 2026-08-30 - Audit vòng 7: trace một HÀNH ĐỘNG, và đọc số lần lặp trong log

- **Cùng một thông báo lỗi, ba lần là ba nguyên nhân khác nhau.** "Tạo quiz thất bại" lần
  một là timeout CPU, lần hai là gemini 401, lần ba là tranh slot vì 5 job trùng. Nếu vòng
  ba mà vẫn sửa theo phản xạ của vòng một (nâng timeout) thì hỏng thêm một vòng nữa.
  **Đọc lại log từ đầu mỗi lần**, đừng tin rằng triệu chứng giống nghĩa là nguyên nhân giống.

- **Đếm số dòng lặp trong log trước khi phân tích nội dung dòng.** Năm `POST` trong hai
  giây nói toàn bộ câu chuyện, và nó nằm ở CHỖ KHÁC với dòng lỗi. Dòng lỗi nói "hết slot";
  chỉ có số lần lặp mới nói "vì có năm job cho một lần muốn".

- **Một job XONG mà giao diện vẫn báo thất bại là lỗi nặng hơn cả job hỏng.** `quiz_job_done
  kept=3` nằm ngay giữa ba dòng `quiz_job_failed`. Người dùng mất niềm tin vào thứ thực ra
  đã chạy đúng. Khi một hành động sinh nhiều job, phải hỏi: **giao diện bám vào job nào?**

- **Cờ chặn ở client không bao giờ đủ.** F5, hai tab, app khác, người dùng dùng curl — tất
  cả đi vòng qua nó. Cờ FE sửa TRẢI NGHIỆM (nút hết bấm được), dedupe BE sửa LỖI (không
  còn job trùng). Làm cả hai, và đừng nhầm cái nào là bản vá thật.

- **"Kiểm rồi làm" là cùng một bẫy với `_safe_save_path` của vòng 6, ở một tầng khác.** Ở
  đó là `os.path.exists()` rồi `save()`; ở đây là "tra dict" rồi "ghi dict". Cả hai đều
  phải nằm trong MỘT thao tác nguyên tử. Cùng một test dựng bằng `threading.Barrier(2)`
  bắt được cả hai. **Thấy hai bước kiểm-rồi-làm trên tài nguyên dùng chung: dừng lại.**

- **Khi ba tham số phải khớp nhau, hãy test QUAN HỆ giữa chúng, đừng test từng cái.**
  `QUIZ_CONTEXT_CHARS`, `num_ctx`, `num_predict`: không con số nào tự nó sai, cái sai là
  chúng rời nhau. Test khoá bất đẳng thức `ngữ_liệu + chỉ_dẫn + sinh_ra < cửa_sổ` cho phép
  chỉnh cả ba mà vẫn xanh, và đỏ đúng lúc ai đó chỉ chỉnh một. Khoá từng số thì test cản
  người sửa đúng và vẫn để lọt người sửa sai.

- **Đặt hằng ở module KHÔNG có nghĩa là nó tới được nơi cần.** `QUIZ_NUM_CTX` nằm trong
  `generator.py` là vô nghĩa nếu không truyền vào `options` của lời gọi — Ollama vẫn dùng
  `LLM_CTX_SIZE=4096` toàn cục. Cùng họ với cờ `structured_query` bị LangGraph loại giữa
  hai node ở vòng 6: **đi theo giá trị tới tận nơi tiêu thụ, đừng dừng ở chỗ khai báo.**

- **Sửa ở bộ định dạng DÙNG CHUNG rẻ hơn sửa ở từng feature.** Phân loại lỗi AI đặt trong
  `_job_error_text` (mọi job đi qua) nên mindmap/summary/study-map được luôn, diff nhỏ hơn
  hẳn so với vá ở mỗi chỗ bắt lỗi. Đúng phản xạ "một guard ở hàm chung, không phải một
  guard ở mỗi caller".

- **`get_job` trả `None` phải mở khoá, không được khoá.** Job bị dọn khỏi store mà dedupe
  vẫn coi là "đang chạy" thì người dùng không bao giờ tạo được quiz nữa cho tới khi restart.
  Cùng họ với `None` vs `0`: **thiếu dữ liệu không được mặc định thành "cấm".**

## 2026-08-29 - Quiz chết vì hai lý do rời nhau, và cả hai đều ở NGOÀI mã

- **Đo tốc độ trước khi bàn về timeout.** "180s không đủ" là phỏng đoán cho tới khi có
  `eval_count 260 / eval_duration 71.1s` = 3.66 token/giây. Có con số đó thì mọi thứ khác
  suy ra được: 10 câu ≈ 2000 token ≈ 9 phút, hụt 4 lần, và 900s là con số có lý do chứ
  không phải "cho to lên cho chắc". Một lời gọi `/api/generate` mất 80 giây trả lời được
  câu hỏi mà đọc mã cả buổi không trả lời được.

- **Biến môi trường của MÁY có thể phá cấu hình của DỰ ÁN, và `.env` không cứu được.**
  `GEMINI_API_KEY` rỗng trong `BE/.env` nhưng Windows User environment có một OAuth token
  do tool khác đặt. `override=False` nghĩa là os.environ thắng. Khi cấu hình "rõ ràng là
  đúng" mà hành vi vẫn sai, **in giá trị thật ra khỏi tiến trình** (`os.getenv`, độ dài,
  vài ký tự đầu) trước khi nghi mã — chỗ này `len=53` và tiền tố `AQ.` nói ngay nó không
  phải API key (`AIza`, 39 ký tự).

- **Docstring sai còn tốn thời gian hơn không có docstring.** `load_project_env` ghi
  "BE/.env > ../.env > os.environ" trong khi `override=False` cho kết quả ngược hẳn. Câu
  đó khiến giả thuyết đúng bị loại sớm. Cùng họ với "route v2 hứa xoá Storage" của vòng 6.
  **Docstring nói về THỨ TỰ ƯU TIÊN phải đối chiếu với tham số quyết định thứ tự đó.**

- **Retry cho lỗi 401 là 62 giây ném đi.** langchain_google_genai retry 5 lần
  (2+4+8+16+32) trên `Unauthenticated`. Xác thực sai không bao giờ tự đúng lại. Ghi lại để
  lần sau chạm tới tầng provider thì phân loại lỗi retry được / không retry được.

- **Khoá trùng trong file `.env` là lỗi im lặng nhất trong họ "file cấu hình nói dối".**
  `AI_TIMEOUT_SEC` hai dòng, dòng sau thắng, dòng trước không báo gì. Test không quét được
  `.env` thật (gitignore) nhưng quét được `.env.example` — chặn tại **nguồn sao chép**,
  vì mọi `.env` trên máy dev đều copy từ đó.

## 2026-08-29 - Audit vòng 6 (phần sau): "chưa tái hiện được" thường là chưa dựng đúng chỗ

- **"Cửa sổ đua rất hẹp" là một giả định, không phải một phép đo.** Vòng trước hoãn P4 vì
  không dựng nổi ca đua. Đọc lại thì `_safe_save_path` **không tạo file nào** — chỉ trả
  chuỗi. Nên khe không phải vài micro giây giữa `exists()` và `save()`, mà là TOÀN BỘ
  quãng giữa hai lời gọi đó. `threading.Barrier(2)` hỏng ngay lần chạy đầu, không cần
  sleep giả. Trước khi ghi "chưa tái hiện được", hỏi **cái gì tạo ra tài nguyên tranh
  chấp** — nếu câu trả lời là "không có gì", đua chắc chắn xảy ra chứ không phải hiếm.

- **Hoãn vá vì chưa chứng minh được là ĐÚNG; nhưng phải quay lại chứng minh.** Vòng 6 hoãn
  P4 là quyết định đúng theo thông tin lúc đó. Cái sai duy nhất là để nguyên chữ "chưa tái
  hiện" mà không ai thử lại. Ghi "chưa tái hiện" kèm **cách tái hiện định thử**, để lần sau
  chạy được ngay.

- **Bản vá plan đề xuất không nhất thiết là bản vá đúng.** Plan ghi `tempfile.mkstemp`.
  Nó atomic thật, nhưng phá hình dạng tên file (`bao_cao_2.pdf` -> `tmp8f2x.pdf`) mà
  `_unique_display_filename` và FE đang dựa vào. `os.open(..., O_CREAT|O_EXCL)` cũng
  atomic, cùng stdlib, giữ nguyên tên, ít dòng hơn. **Đọc plan như đề xuất, không như lệnh.**

- **Sửa hành vi thì test cũ PHẢI đỏ — đó là bằng chứng, không phải phiền toái.**
  `test_source_ownership.py` khẳng định `flag off + [] -> []`. Bản vá P3 làm nó đỏ, đúng
  chỗ nó phải đỏ. Test cũ xanh sau khi đổi hành vi mới là điều đáng lo: nghĩa là nó không
  đo cái nó tưởng đang đo.

- **Từ vựng pipeline và từ vựng DB lệch nhau, và chỗ lệch nằm ngay trong plan.** Plan viết
  "đếm tài liệu `status=error`". Cột `documents.status` không nhận giá trị đó —
  `ck_documents_status` chỉ cho `uploaded|processing|completed|failed|deleted`, và
  `_STATUS_TO_DB` dịch `error -> failed`. Viết đúng chữ trong plan thì query trả 0 hàng và
  kết luận "sạch". **Cùng họ lỗi với `None` vs `0`: một câu trả lời rỗng trông giống hệt
  một câu trả lời tốt.** Đọc ràng buộc CHECK trước khi viết bất cứ `WHERE status = ...` nào.

- **Đo trước, cơ chế sau.** P6 chỉ cần một script đọc để biết quy mô: 1 dòng, 8.7 MB. Với
  con số đó thì mọi bàn luận về cron dọn dẹp, chính sách giữ N ngày, thông báo cho người
  dùng đều là xây cho một vấn đề chưa tồn tại. Script đọc rẻ hơn nhiều so với cái quyết
  định mà nó chặn lại.

## 2026-08-29 - Audit vòng 6: trace một đường đi đầy đủ tìm ra thứ mà quét theo lớp lỗi bỏ sót

- **Hai đường làm cùng một việc thì đường MỚI hay thiếu bước, không phải đường cũ.**
  `POST /delete-source` (legacy) xoá object trên Storage; `DELETE /sources/<id>` (v2, FE
  dùng mặc định) thì không, dù docstring của nó hứa có. Phản xạ "cái cũ chắc tệ hơn" sai ở
  đây. Khi có hai đường, **so danh sách việc chúng làm**, đừng giả định cái mới đầy đủ hơn.

- **Docstring hứa mà mã không làm là lỗi, không phải tài liệu lỗi thời.** Route v2 ghi
  "Xóa: 1. File gốc trong input_docs/ VÀ object trên Supabase Storage" — câu đó là ý định
  ban đầu, bước thứ hai không bao giờ được viết. Đọc docstring rồi ĐỐI CHIẾU từng gạch đầu
  dòng với thân hàm; ở đây nó chỉ ra ngay chỗ thiếu.

- **Fail-open đúng vẫn có thể sai ở phần BÁO CÁO.** Ghi `document_chunks` hỏng mà không
  chặn pipeline là quyết định đúng (chat vẫn chạy). Cái sai là trạng thái vẫn nói `ready`
  và `capabilities` vẫn báo đủ. Khi chấp nhận chạy-một-phần, phải có chỗ nói ra là phần
  nào — mindmap/summary có `degraded_missing`, ingest thì không có gì. **Sửa phần báo cáo,
  đừng bỏ phần chịu lỗi.**

- **`None` và `0` không được lẫn.** `chunk_count` để `None` khi ghi hỏng nghĩa là "chưa
  đo"; đặt `0` mới là "đã đo, rỗng". Cùng bài học với `emb_dim` giữ 0 lúc probe hỏng
  (vòng 2) và `delta=None` vs `0` ở `compare_masteries`.

- **Hàm cập nhật THAY hay GỘP là chi tiết quyết định bản vá.** `update_status` ghi
  `meta["capabilities"] = capabilities` — thay. Node sau ghi capabilities là xoá mất cờ vừa
  đặt. Không sửa thành gộp (gộp thì không caller nào tắt được một capability nữa) mà truyền
  cờ qua state. Đọc hàm ghi trước khi tin rằng đặt một khoá là xong.

- **Comment cứu được một lần.** `state.py` có sẵn dòng *"LangGraph merge state chỉ giữ field
  có trong TypedDict"*. Thêm field vào state mà không khai báo thì nó bị loại giữa hai node,
  im lặng. Đây là loại comment đáng viết: nó nói một luật KHÔNG suy ra được từ mã xung quanh.

- **Bẫy khi viết test cho graph có seam inject.** `update_source_status` được gọi với
  `status` ở **vị trí** (`update_source_status(sid, "processing", progress=...)`) chứ không
  phải kwarg. Lambda giả `lambda sid, **kw` chết ngay node đầu, và triệu chứng hiện ra là
  "không có lần ghi capabilities nào" — trông như bản vá không chạy, thật ra là fixture
  sai. Khi test graph báo "không thấy gì xảy ra", **in `out["error"]` trước khi nghi mã**.

- **Trace một đường đi đầy đủ bắt được thứ mà quét theo lớp lỗi bỏ sót.** Năm vòng trước
  quét theo lớp (song song LLM, `str(None)`, file trùng, mã chết, cờ cấu hình) và không
  vòng nào chạm tới "xoá xong file vẫn còn". Hai cách quét bổ sung nhau, không thay nhau.

## 2026-08-29 - Audit vòng 5: phép quét phủ định phải có ca kiểm chứng, và test xanh phải chứng minh nó đo được gì

- **LẦN THỨ TƯ đo sai câu hỏi trong bốn vòng.** Vòng 1 kết luận "9 cờ chưa test nhánh
  không mặc định". Quét lại thì **4 trong 9 đã có test** — regex cũ chỉ khớp
  `monkeypatch.setenv("K", "v")` và mù hoàn toàn với `base_env(monkeypatch, HITL_ENABLED="0")`,
  đúng dạng bộ test dùng nhiều nhất. Chuỗi bốn lần:
  1. `BASE_URL` khớp bên trong `DATABASE_URL` (thiếu ranh giới từ).
  2. `cmp` báo 7 file y hệt là "khác toàn bộ" (line-ending).
  3. Đếm 9/128 khoá rồi gọi `ENV_SETUP.md` là bản sao rỗng (nó là tài liệu thao tác).
  4. Regex một dạng gán, bỏ sót dạng kwarg.

  **Luật từ đây:** trước khi tin một phép quét PHỦ ĐỊNH ("không có X", "0 người dùng",
  "chưa test"), tự tìm một **ví dụ dương tính đã biết** rồi kiểm phép quét có bắt được nó
  không. Không có ca kiểm chứng thì con số 0 là vô nghĩa. Phép quét dương tính (grep ra
  một danh sách) tự kiểm được bằng mắt; phép quét phủ định thì không.

- **Test xanh chưa chắc đo được gì.** Test `ENRICH_METADATA` của chính đợt này XANH ngay
  lần đầu, nhưng nó đọc `out["chunk_metadatas"]` — khoá KHÔNG tồn tại (khoá thật là
  `doc_meta`). Cả hai phía ra `{}`, và vế `or not m_bat` trong khẳng định nuốt trọn.
  Hai mùi cần nhớ:
  - `assert A != B or not A` — vế `or` biến test thành hằng đúng khi cả hai phía rỗng.
  - Khoá state đoán theo tên. Đối chiếu với mã (`grep` khoá đó trong graph) trước khi tin.

  Cách kiểm rẻ: làm test ĐỎ một lần có chủ ý (đổi giá trị mong đợi) xem nó có đỏ thật không.

- **`assert f(x) == f(x)` là hằng đúng, không phải test.** Bản đầu của
  `test_lc_flag_mot_nguon.py` có đúng dòng đó. Nếu không dựng được điều kiện thật thì viết
  **khẳng định CẤU TRÚC** trên mã nguồn (`inspect.getsource`) và nói rõ trong docstring vì
  sao chọn cấu trúc thay vì hành vi — thà thế còn hơn một dòng trông như test.

- **"Không có dòng import" KHÔNG kết luận được gói thừa.** `gunicorn`, `grpcio-tools`,
  `psycopg`, `psutil` đều sống mà không có import nào. `pip show` -> `Required-by` trả lời
  dứt điểm trong một lệnh, và nó cũng bác bỏ luôn kế hoạch "gỡ thử rồi chạy suite" mà
  chính tao viết ở vòng 3 — chọn phép đo nặng khi có phép đo nhẹ và chính xác hơn.

- **Trừu tượng dựng rồi bị bỏ qua: lần thứ BA.** `shared/config` có 4 trường `use_lc_*`
  với 0 người đọc, trong khi mã thật `os.getenv()` rải rác — đúng thứ docstring của file
  đó tuyên bố đã dẹp, và ví dụ trong docstring còn dùng chính trường không ai đọc. Trước
  đó: `paths.default_data_dir()` (0 caller) và `__meta__["embedding_dim"]` (ghi 6, đọc 0).
  **Luật:** thêm trường vào `config` thì CÙNG COMMIT phải có ít nhất một chỗ đọc nó.

- **Sửa cái lệch trên giấy, đừng tạo cái lệch thật.** `store._use_lc_vector_store()` default
  `"0"` khác `config` default `True` — cám dỗ là đổi `"0"` thành `"1"` cho "nhất quán".
  Nhưng `"0"` chính là đường LEGACY mà toàn bộ test retrieval đang chạy và là nơi guard dim
  của vòng 3 nằm. Cách đúng: **xoá bên không ai đọc**, giữ nguyên bên đang chạy.

- **Điều kiện tiên quyết của phép đo phải được KIỂM, không phải giả định.** Plan vòng 5 ghi
  "máy phải rảnh" mới đo được cổng LLM. Kiểm lúc chạy: `nvidia-smi` báo 5331/6141 MiB đã
  dùng còn `/api/ps` báo Ollama giữ **0** — tức tiến trình khác chiếm. Gần y hệt lần Study
  Map 487 giây (5378/6141 MiB). Không đo, không đoán, ghi lại điều kiện để đo sau. Một phép
  đo chạy sai điều kiện tệ hơn không đo: nó tạo ra một con số mà lần sau có người tin.

## 2026-08-28 - Audit vòng 4: tài liệu cũng là bề mặt tấn công, và "đo sai câu hỏi" là họ lỗi của tao

- **Tài liệu hướng dẫn thao tác phá huỷ phải bị soát như mã.** `BE/ENV_SETUP.md` chứa
  `Remove-Item -Recurse -Force` với `$base` hard-code trỏ sang **dự án KHÁC có thật trên
  máy**. Không test nào bắt được, không lint nào bắt được, và làm theo là mất dữ liệu ở
  chỗ khác. Luật: **không đường dẫn tuyệt đối trong tài liệu**, đặc biệt quanh `rm -rf` /
  `Remove-Item`; neo vào thư mục hiện tại.

- **Cùng một đường dẫn nhầm xuất hiện ở hai file khác nhau.** `MemVid_New/BE` vừa là
  `$base` trong ENV_SETUP vừa là `DATA_DIR` cũ trong `.env` (đã sửa 2026-08-24). Sửa một
  chỗ không diệt được nó. Khi tìm thấy một đường dẫn sai, grep TOÀN KHO đúng chuỗi đó.

- **"Đo sai câu hỏi" — lần thứ BA trong ba vòng, cùng một họ.**
  1. Vòng 1: `BASE_URL` khớp bên trong `DATABASE_URL` (thiếu ranh giới từ).
  2. Vòng 3: `cmp` báo 7 file y hệt là "khác toàn bộ" (line-ending, không phải nội dung).
  3. Vòng 4: đếm 9/128 khoá env rồi kết luận `ENV_SETUP.md` là bản sao rỗng — nhưng nó
     không định làm danh sách khoá, nó là tài liệu THAO TÁC.

  Cả ba lần công cụ đều trả lời đúng câu tao hỏi. Sai ở chỗ câu hỏi không đo thứ cần đo.
  **Trước khi đo, hỏi: thứ này định làm gì?** Rồi mới chọn phép đo.

- **May mà chưa rút gọn.** Nếu làm theo plan (rút `ENV_SETUP.md` thành một con trỏ) thì
  cái lệnh xoá nhầm dự án bị xoá đi cùng — không ai biết nó từng tồn tại, và bản sao của
  nó trong đầu người dùng vẫn còn. Đọc kỹ trước khi rút gọn: file "thừa" có thể đang giấu
  thứ duy nhất đáng tìm.

- **Tài liệu lệch thì SINH lại, đừng vá.** README có 54/72 đường dẫn sai và thiếu 56 route.
  Vá từng dòng tốn hơn viết lại, và bản vá tay sẽ lệch tiếp. Cây thư mục dừng ở **2 tầng**
  sinh từ `git ls-files`, bảng API sinh từ `grep @app.route` — và dán luôn lệnh sinh vào
  README để lần sau dựng lại trong một dòng. Cây 4 tầng gõ tay chính là thứ vừa lệch.

- **Tự kiểm bằng ĐÚNG phép đếm đã phát hiện lỗi.** Viết xong chạy lại script đếm:
  `cây 29 mục | sai 0`, `api: 80 endpoint | ma 0 | thiếu 0`. Không có con số này thì
  "đã cập nhật README" chỉ là lời hứa.

- **Luật `.gitignore` phải khớp tên THẬT trên đĩa.** `index_backup_*/` nhìn rất hợp lý và
  không khớp `_backup-20260824-173248/`. Viết luật xong thì `git check-ignore -v <đường dẫn
  thật>` để xác nhận.

- **Cấu trúc thư mục hoá ra không sai.** Câu hỏi ban đầu là "dọn cấu trúc thư mục chưa".
  Quét xong: `app/domains/` 20 package là kiến trúc thật, test đặt cạnh mã ở FE là quy ước
  hợp lệ. Sai là **rác lẫn trong đó** và **tài liệu mô tả nó**. Đừng tái cấu trúc thứ chỉ
  cần dọn.

## 2026-08-28 - Audit vòng 3: chọn MỘT chỗ để sửa, và tin công cụ đúng mức

- **"Không có guard" thường là "guard chỉ có ở một nửa".** Tao viết vào plan là index tài
  liệu không kiểm dim. Thực tế đường GHI có kiểm (`store._load_index` xoá index khi lệch);
  chỉ đường ĐỌC là hở. Phạm vi sai làm bản vá sai chỗ. Trước khi kết luận "thiếu X", hỏi
  riêng từng chiều: ghi có không, đọc có không.

- **Lỗi im lặng tệ nhất là lỗi có `except` bắt được nhưng message rỗng.** faiss ném
  `AssertionError` KHÔNG có nội dung khi dim lệch. Hai chỗ trong `hybrid.py` bắt rồi log
  `"legacy FAISS search failed: %s"` — ra một dòng cụt, rồi truy hồi âm thầm tụt về
  BM25-only. Có try/except + có log mà vẫn vô hình. Kiểm tra `str(exc)` có nội dung không,
  đừng cho rằng cứ bắt được là quan sát được.

- **Metadata ghi mà không ai đọc là mã chết trá hình.** `__meta__["embedding_dim"]` được
  ghi 6 chỗ trong `store.py`, đọc 0 chỗ. Nhìn vào thì tưởng hệ thống đang theo dõi dim.
  Grep CẢ HAI chiều (ghi và đọc) trước khi tin một khoá metadata đang làm việc gì đó.

- **Guard phải đặt ở chỗ có sẵn cache, không phải chỗ gần lỗi nhất.** Đặt trong
  `_load_faiss_index()` thì cả hai đường search dùng chung, và vì hàm đó cache theo
  `(mtime_ns, size)` nên guard chạy một lần mỗi khi index đổi. Đặt ở caller thì hai bản
  sao và chạy mỗi query — biến bản vá đúng thành hồi quy hot path. Đã viết hẳn một test
  đếm số lần `read_index` để khoá điều đó lại.

- **Bốn chỗ cùng một triệu chứng thì sửa một, không sửa bốn.** Thanh tiến trình đứng im ở
  4 job. Chọn `short_answer_grading` vì người học đang NGỒI CHỜ (khác `ingest` chạy nền) và
  vòng lặp đã có sẵn. `study_map` Relations là MỘT lời gọi LLM đơn — chỉ đổi được nhãn.
  Chia nhỏ một lời gọi LLM để thanh chạy mượt là làm đẹp bằng cách làm chậm.

- **Mẫu số của thanh tiến trình phải là thứ TỐN THỜI GIAN.** Đếm cả câu trắc nghiệm (chấm
  bằng so chuỗi, xong tức thì) vào mẫu số thì thanh nhảy vọt rồi đứng im — vẫn nói dối, chỉ
  là nói dối kiểu khác.

- **Tên hàm test giữ ASCII.** Dấu tiếng Việt trong tên test làm `tmp_path` của pytest chứa
  ký tự non-ASCII và `faiss.write_index` không mở được file:
  `could not open ... for writing: No such file or directory`. Docstring thì thoải mái.

- **Sửa nguồn gây hiểu sai, không chỉ sửa hiểu sai.** Kết luận sai về 7 file `.mdc` đến từ
  việc kho trộn CRLF/LF. Đính chính tài liệu là chưa đủ — thêm `.gitattributes` để lần sau
  công cụ không nói dối nữa. Nhưng KHÔNG renormalize toàn kho cùng lúc: diff ~470 file che
  mất mọi thay đổi mã khác.

## 2026-08-28 - Audit vòng 2: dọn mã. Bài học nằm ở chỗ "trùng nhau" chứ không ở chỗ "thừa"

- **Hai file trùng tên khác giá trị KHÔNG mặc nhiên là lỗi.** Tao đếm 12 khoá lệch giữa
  `.env.example` gốc và `BE/.env.example` rồi viết vào plan là "12 chỗ nói dối". Sai:
  11/12 là hai HỒ SƠ khác nhau (docker/prod vs dev), lệch là đúng. Chỉ 1 khoá là lỗi thật.
  Phân loại theo HỒ SƠ trước khi gọi cái gì là drift — nếu không thì bản vá "cho hai file
  giống nhau" sẽ phá cấu hình docker.

- **Lỗi thật thường nhỏ hơn và nằm sâu hơn con số thống kê.** Cái duy nhất sai
  (`SLM_MODEL`) truy ra được nguyên nhân gốc: `BE/.env.example` **lặp key hai lần**, dòng
  thứ hai chú thích "alias" nhưng gõ lại đúng tên cũ thay vì `SLM_MODEL_CHAT`. Vì vậy
  `SLM_MODEL_CHAT` chưa bao giờ tồn tại ở file THẮNG. Đây là toàn bộ cơ chế của triệu
  chứng "giá trị an toàn nằm ở file thua" mà vòng 1 chỉ mô tả được chứ chưa giải thích.

- **Comment không chặn được tái phát, test thì có.** `main.py:1255` đã có sẵn comment "một
  nguồn sự thật `_model_map` — hết stale default kiểu qwen3.5:9b hardcode". Comment đó viết
  xong, default vẫn quay lại, và lần quét này đếm được **12 chỗ** viết cứng. Muốn một luật
  sống thì phải có test quét mã, không phải một dòng chú thích.

- **Xoá mã chết làm lộ ra lời nói dối trong tài liệu.** `accept_attribute()` có docstring
  khẳng định một test đang khoá nó — test đó tồn tại và vẫn xanh, nhưng nó so trực tiếp
  `DocumentList.jsx` với `SUPPORTED_EXTENSIONS`, không gọi hàm đó lần nào. Đọc docstring mà
  không kiểm là cách hiểu sai ai đang bảo vệ cái gì.

- **Trừu tượng dựng rồi bỏ còn tệ hơn không dựng.** `shared/paths.default_data_dir()` sinh
  ra để gom đường dẫn về một chỗ; 0 caller, trong khi ba module tự viết lại đúng biểu thức
  đó tại chỗ. Người sau đọc `paths.py` sẽ tưởng đường dẫn đã được gom.

- **Sửa chỗ NÓI DỐI rẻ hơn dựng chức năng còn thiếu.** `ingest`/`query`/`grading` không ack
  cờ huỷ. Lựa chọn A: thêm điểm kiểm huỷ vào ingest graph (thêm node, đổi hình graph, rủi
  ro đụng test ingest) cho một nút bấm FE **chưa nối**. Lựa chọn B: route trả 409 và không
  bật cờ. B đúng vì lỗi thật là "API hứa thứ nó không làm được", không phải "thiếu tính
  năng huỷ". Dựng A là làm việc suy đoán rồi vẫn phải sửa B.

- **Đừng sửa gộp một lớp lỗi chỉ vì đếm được nhiều.** 81 chỗ `except Exception: pass`, sửa
  hết là hấp dẫn. Phân loại theo nội dung khối `try` cho thấy 24 chỗ là import dự phòng,
  5 chỗ là log/cache, và chỉ **3 chỗ** thật sự giấu mất dữ liệu. Cùng bài học loại C ở
  `progress` hôm nay: một triệu chứng, nhiều cách sửa khác nhau.

- **`git mv` là công cụ dọn thư mục, không phải viết lại.** 11 file `.md` ở
  `01_/03_/04_` chuyển vào `docs/` giữ nguyên nội dung; kiểm trước bằng grep toàn kho thấy
  0 chỗ viện dẫn đường dẫn cũ nên di chuyển an toàn.

## 2026-08-28 - Audit toàn dự án: quét theo LỚP LỖI, và đừng tin chính cái grep của mình

- **Quét theo lớp lỗi bắt được bản sao thứ ba; quét theo thư mục thì không.** Ba đợt sửa
  (mindmap 26/8, summary 27/8, studymap+quiz+progress 28/8) đều là CÙNG một khiếm khuyết
  nhân bản sang module anh em. Lấy đúng lớp lỗi đó đi quét cả repo thì tìm ra ngay bản sao
  thứ ba ở `memory/tree.py` — chỗ chưa ai báo lỗi vì nó chỉ nổ khi tài liệu đủ nhiều mục.

- **Test xanh không thấy lớp lỗi này.** Cả ba lần đều xanh 100% suốt thời gian lỗi tồn tại:
  test giả LLM (nên cổng LLM không bao giờ nghẽn) và chỉ chạy MỘT nhánh cấu hình. Coverage
  đếm theo SỐ CA, không theo NHÁNH CẤU HÌNH.

- **Regex `os.getenv("X")` bỏ sót biến đọc gián tiếp.** Quét biến chết bằng mẫu literal báo
  nhầm `AUTH_REQUIRE_SECRET` là chết — nó sống, đọc qua `_truthy(name)` ở
  `auth/tokens.py:33` và ném `RuntimeError` khi thiếu `AUTH_SECRET`. Suýt gỡ một control
  bảo mật đang chạy. Trước khi kết luận "biến chết", grep TÊN TRẦN chứ không grep lời gọi.

- **Khớp chuỗi con tạo báo động giả.** `BASE_URL` khớp bên trong `DATABASE_URL`. Dùng ranh
  giới từ (`\bX\b`) cho mọi so khớp tên biến.

- **Đừng in giá trị env ra terminal khi so sánh drift.** Một lệnh chẩn đoán đã echo cả
  `DATABASE_URL` kèm mật khẩu DB. So sánh bằng hash/`diff <(cut -d= -f1)` là đủ để biết
  khoá nào trôi — không cần thấy giá trị.

## 2026-08-28 - Sửa lan cùng một bẫy: quét bằng cách GỌI, không bằng cách đọc

- **Cùng một triệu chứng không có nghĩa là cùng một cách sửa.** Sáu chỗ vỡ đều ném
  `invalid input syntax for type uuid: "None"`, nhưng sửa giống nhau cả sáu là sai. Chỗ
  lọc ĐÃ có phạm vi tài liệu thì bỏ lọc chủ sở hữu là đúng; chỗ lọc theo TÀI KHOẢN mà bỏ
  lọc là trả số liệu của mọi user cho người gọi ẩn danh. Phân loại theo NGỮ CẢNH TRUY VẤN
  trước khi viết dòng sửa đầu tiên.

- **Quét bằng cách gọi thật, đừng quét bằng mắt.** `grep str(user_id)` ra 21 chỗ; gọi từng
  hàm với `None` cho biết đúng 6 chỗ vỡ và 15 chỗ đã có guard. Đọc mã 21 chỗ vừa lâu vừa
  dễ bỏ sót một `if user_id is not None` nằm cách đó vài dòng.

- **Thay chuỗi hàng loạt cắn cả vào chính hàm helper.** Sau khi thêm
  `_chu_so_huu(user_id)`, lệnh `s.replace("str(user_id)", "uid")` biến luôn
  `return str(user_id)` BÊN TRONG helper thành `return uid` — biến chưa tồn tại. Cú pháp
  vẫn hợp lệ nên không có lỗi lúc import; chỉ `NameError` khi chạy. Thay hàng loạt xong
  phải đọc lại đúng hàm vừa thêm.

- **Khẳng định số tuyệt đối trên tài nguyên DÙNG CHUNG là test nhấp nháy.** User ẩn danh
  dùng chung giữa mọi test chế độ mở, và `pytest-randomly` đổi thứ tự mỗi lần chạy. Mọi
  khẳng định về số lượng phải là ĐỘ LỆCH so với mốc đo ngay trước đó.

- **Test rò dữ liệu phải dựng dữ liệu của người khác thật.** Khẳng định "ẩn danh thấy 0
  tài liệu" trên DB rỗng thì luôn xanh kể cả khi bỏ lọc. Test đúng là: đo mốc ở chế độ mở
  → dựng nguyên một bộ tài liệu/quiz/attempt cho user CÓ đăng nhập → đo lại và bắt buộc
  bằng mốc cũ.

## 2026-08-27 - Audit Study Map: nhánh chưa test là nhánh vỡ

- **`str(None)` không phải NULL — nó là chuỗi bốn ký tự `"None"`.** Với cột
  `NOT NULL uuid`, Postgres không báo "thiếu giá trị" mà báo
  `invalid input syntax for type uuid: "None"`, nên thông báo lỗi chỉ về phía "dữ liệu
  hỏng" chứ không về phía "chưa xử lý người dùng ẩn danh". Chỗ nào nhận uid từ
  `_require_app_user()` cũng phải xử lý None TƯỜNG MINH: trả None là hành vi đúng theo
  tài liệu của hàm đó (chế độ mở), không phải trường hợp bất thường.

- **Test hết 8 ca của MỘT nhánh không nói gì về nhánh kia.** Cả 8 test Study Map đều mở
  đầu bằng `_protect(be, monkeypatch, owner)`. Coverage nhìn đẹp, mà toàn bộ chế độ mở
  chưa từng chạy một lần — và nó vỡ 100%. Khi một hàm có nhánh theo cờ cấu hình, đếm test
  theo NHÁNH CẤU HÌNH, đừng đếm theo số ca.

- **Chỗ vỡ đầu tiên không phải chỗ dễ thấy nhất.** `create_map` là chỗ trực giác nghĩ tới,
  nhưng `latest_completed` chạy TRƯỚC nó, ngay trong route khi tra cache — nên thực tế
  route trả 500 trước khi job kịp sinh ra. Đi lần theo thứ tự THỰC THI, đừng dừng ở lỗi
  đầu tiên tìm thấy trong mã.

- **Đo trước khi tin rằng tính năng hỏng.** Giả thuyết vào việc là "Study Map không sinh
  được". Chạy thật với uid hợp lệ thì nó XONG: 19 node, 7 cạnh, 37 chunk link. Bản vá
  mindmap hôm 26 (`7b` vừa VRAM, kẹp song song theo cổng LLM, progress kêu ngay) đã theo
  sang đây miễn phí vì `run_study_map_job` gọi chung `_get_mindmap_pipeline()`. Cái thật
  sự hỏng là một nhánh cấu hình khác hẳn với cái mình đoán.

- **Kiểm tra máy trước khi đổ cho mã.** 487 giây trông như hồi quy hiệu năng. Thật ra
  `ollama /api/ps` báo model 7b chỉ được cấp 0,19 GB VRAM, và `nvidia-smi` cho thấy một
  game Steam đang giữ 5,4/6,1 GiB ở 100%. Hai lệnh đó nên là bước ĐẦU của mọi lần điều
  tra "sao dạo này chậm", không phải bước cuối.

- **Sửa đúng phạm vi được hỏi, nhưng nói rõ chỗ còn lại.** `quiz/repository.py:25` và
  `attempts/repository.py:33,45` mắc y hệt lỗi `str(user_id)`. Chúng nằm ngay sau Study
  Map trong cùng luồng người dùng, nhưng là domain khác và người dùng không hỏi tới —
  ghi lại kèm file:dòng và cách sửa, không tự lặng lẽ mở rộng phạm vi.

## 2026-08-27 - Audit chức năng tóm tắt: pipeline anh em clone luôn cả lỗi

- **File nào ghi "clone shape của X" thì đi kiểm X trước.** `summarize.py` mở đầu bằng
  "Clone shape services/mindmap/pipeline/enrich.py — cùng các bài học". Nó clone thật:
  cùng cách kẹp `max_workers` từ env không qua cổng LLM, cùng chỗ đặt `progress_cb` sau
  submit, cùng model 14b lệch trong `BE/.env`. Sửa xong mindmap hôm 26 mà không grep sang
  summary là để nguyên ba lỗi y hệt sống thêm một ngày. Lần sau: vừa sửa một pipeline thì
  `grep -rn` ngay cái tên hàm/biến vừa sửa ra toàn repo, trước khi commit.

- **Đừng bắt hai biến env phải khớp tay nhau.** `SUMMARY_PARALLEL=2` và
  `MAX_CONCURRENT_LLM_CALLS=1` là một cấu hình TỰ MÂU THUẪN mà không chỗ nào phát hiện —
  hệ quả là mục thứ hai xếp hàng rồi chết vì timeout hàng đợi. Cách chặn không phải là
  viết tài liệu bảo người ta chỉnh cả hai, mà là **lấy trần từ chính cái cổng**:
  `min(muốn, inproc_slots())`. Một chỗ chỉnh, không cấu hình nào tự mâu thuẫn được nữa.

- **Song song danh nghĩa còn nói dối cả ngân sách timeout.**
  `budget = timeout_sec * ceil(n/max_workers)` tính theo số worker KHAI BÁO. Khi cổng ép
  chạy tuần tự, ngân sách nhỏ hơn thời gian thật cần → mục cuối bị đánh degraded dù chưa
  hề vượt timeout riêng của nó. Sửa đúng chỗ (`max_workers` phản ánh thực tế) thì ngân
  sách tự đúng theo. Nếu chỉ vá triệu chứng bằng cách nới `budget` thì lỗi gốc vẫn còn.

- **Test xanh hết mà tính năng vẫn hỏng — vì test giả LLM.** 132 test summary pass cả
  trước lẫn sau khi phát hiện lỗi. Cả ba lỗi đều nằm ở cấu hình runtime và ở tương tác với
  cổng LLM thật, thứ mà `monkeypatch ask_ai` không chạm tới. Bộ test đơn vị KHÔNG phải
  bằng chứng tính năng chạy được; phải có một lần chạy thật, có bấm giờ.

- **Đo trước khi kết luận "tính năng này hỏng".** Giả thuyết ban đầu của tao là
  `SUMMARY_PARALLEL=2` đang làm chết mục thứ hai như bên mindmap. Chạy thật thì nó KHÔNG
  chết: mục đầu chỉ mất 82s, dưới ngưỡng 180s. Lỗi có thật nhưng là bom hẹn giờ theo kích
  thước tài liệu, không phải lỗi đang nổ. Báo cáo phải nói đúng như vậy — nói nó "đang làm
  hỏng tóm tắt" là bịa cho khớp giả thuyết.

- **Bật một cờ tính năng lên phải ĐO, không suy luận.** `SUMMARY_FACTS` để tắt trông như
  di sản của một đợt rollout theo phase đã đi hết tới Phase 5, và study mode thiếu 4/7 mục
  vì nó. Suy luận hợp lý là "bật lên thì đầy đủ". Đo thật thì ngược: qwen2.5:7b chỉ trả
  được facts cho 1/3 mục, study block ra NGHÈO HƠN đường fallback, mà chậm hơn 45%. Sửa
  cái làm cho việc bật/tắt AN TOÀN (đưa cờ vào khoá cache), rồi để cờ nguyên trạng.

- **Model mặc định hard-code trong code là mìn.** `qwen2.5:14b` xuất hiện làm giá trị mặc
  định ở `llm_factory._model_map` (2 chỗ) và `summary_graph.assemble_node`. Hôm nay chúng
  không nổ vì cả 4 file env đều đặt biến. Nhưng một lần clone repo thiếu env là chạy thẳng
  vào model 9,95 GB trên card 6 GiB — đúng cái đã tốn của dự án này hai buổi. CHƯA sửa
  (đổi mặc định đụng cả chat/quiz), chỉ ghi lại ở đây.

## 2026-08-21 - Trang sơ đồ kiến thức (/app/study/map) + chạy app thật lần đầu

### Về việc dựng graph viewer

- **Cây thì dùng thư viện vẽ cây.** 43/44 quan hệ là cha-con thật → `react-d3-tree`,
  không phải `mind-elixir`. mind-elixir tự sở hữu canvas lẫn model node và không giữ
  field lạ (bài học 2026-07-16), trong khi trang này cần `node_id` ổn định để tra ngược
  chunk nguồn. Chọn thư viện theo HÌNH DẠNG dữ liệu, không theo "cái nào đã có sẵn".
- **`react-d3-tree` tô đen đặc mọi `<path>` mặc định.** Không đặt `fill: none` cho link
  thì nhánh gấp khúc thành mảng đen che hết chữ. Đây là mặc định của thư viện, không
  phải lỗi CSS của mình.
- **Nhãn đặt ngang tâm node sẽ bị chính đường nối gạch xuyên qua** khi
  `pathFunc="step"` + `orientation="horizontal"`: link chạy ngang đúng tầm tâm node. Đặt
  nhãn TRÊN node, cộng quầng `paintOrder: stroke` màu nền cho nhánh vẫn cắt qua.
- **Mở sẵn một tầng thì cú bấm phải làm HAI việc.** `initialDepth={1}` mà node chỉ
  `setSelected` là không nhánh nào bung ra được — phải gọi cả `toggleNode`. Đổi chế độ
  hiển thị mặc định luôn kéo theo đổi hợp đồng tương tác.
- **Lá và nhánh đã thu phải nhìn khác nhau**, nếu không người đọc tưởng cây chỉ có 7 node.

### Về chống vòng lặp trong cấu trúc cây

- **`seen` chặn lượt duyệt KHÔNG chặn dữ liệu.** Bản `buildMapTree` đầu dùng set `seen`
  khi walk, nên hàm không treo — nhưng cấu trúc TRẢ VỀ vẫn có vòng (b.children=[c],
  c.children=[b]) và react-d3-tree sẽ treo trình duyệt. Muốn cây không vòng thì phải gắn
  mỗi node ĐÚNG MỘT LẦN lúc dựng, kiểm `attached` ngay tại thời điểm gắn — không lọc
  trước rồi map (lọc chạy hết mảng trước khi nhánh đầu kịp hút node vào).
- Test bắt được đúng lỗi này trước khi lên trang. Logic mồ côi/vòng lặp là chỗ RẤT đáng
  viết test: hỏng thì ra trang trắng hoặc treo tab, không ra exception.

### Về chạy app thật

- **Chạy thật bắt được thứ test không bắt.** 696 test BE + 168 test FE đều xanh trong khi
  `/query` chết hoàn toàn vì môi trường, và FR-04 không có đường nào vào từ UI. Không test
  nào phát hiện được cả hai.
- **Script kiểm thử sai còn tốn thời gian hơn không có.** Hai vòng seed ra 0/10 điểm đều
  là lỗi script tao (đọc `correct_answer` từ API vốn cố tình không trả nó; gửi `answer_text`
  trong khi route đọc `user_answer`), không phải lỗi app. Đọc hợp đồng route TRƯỚC khi
  viết client, đừng suy tên trường.
- **Đừng đọc số liệu từ ảnh thu nhỏ.** Đọc "38" trong ảnh downscale 0.53x, thật ra là
  "80" — suýt báo một bug không tồn tại. Số liệu thì hỏi API, ảnh chỉ để xem bố cục.
- **Job chưa xong không phải job hỏng.** Poll study map 300s rồi kết luận "treo"; nó xong
  ở 335s. Chọn hạn chờ theo thời gian chạy thật đã đo, không theo cảm giác.


## 2026-08-21 - Phase 8 StudyMap: Frontend (6 trang /app/study)

### Bài học

- **Sản phẩm đã có bản sắc thị giác thì ĐỪNG dựng bản sắc thứ hai.** "Phòng đọc"
  (giấy dó + mực + con dấu son, Spectral/Inter/IBM Plex Mono) đã hoàn chỉnh. StudyMap là
  một GIAN khác của cùng toà nhà, không phải sản phẩm thứ hai - dùng nguyên token, chỉ
  thêm 2 lớp component thật sự thiếu.
- **Chữ ký mới phải mang thông tin, không phải trang trí.** `SealMeter`: mực đỏ dâng lên
  đúng bằng mastery score - hình vẽ CHÍNH LÀ con số. Con dấu son vốn đã là ngôn ngữ
  "provenance" của dự án, nên nó nối tiếp `cite-chip` chứ không cạnh tranh.
- **Số thứ tự chỉ được đánh khi thứ tự có nghĩa.** Review item đánh "Ưu tiên 1/2/3" vì
  đó là thứ tự ôn thật (mastery thấp trước); danh sách tài liệu thì không đánh số.
- **Màu không bao giờ là kênh thông tin duy nhất.** Đúng/sai/partial luôn kèm CHỮ; ô đáp
  án đổi cả viền lẫn nền; `StatusTag` là chữ có màu, không phải chấm màu.
- **`Number(null)` là 0 - và test bắt được.** `formatDuration(null)` trả "0 giây", tức
  bịa số liệu cho bài chưa nộp. Mọi hàm format nhận giá trị có thể null phải chặn null
  TRƯỚC khi ép kiểu.
- **Lưu nháp phải gộp lô, không bắn mỗi lần bấm.** Bấm nhanh 10 câu là 10 request chồng
  nhau và request về trễ ghi đè lựa chọn mới hơn. Debounce 600ms + FLUSH nốt lô đang treo
  ngay trước khi nộp, nếu không câu vừa chọn biến mất.
- **Dùng lại `createJobPoller`, đừng viết poller thứ hai.** Nó đã xử lý `interrupted`,
  404 job bị dọn, mất mạng kéo dài - ba thứ từng làm chip kẹt "đang tạo" vĩnh viễn
  (known-issues 2026-07-17). API mới trả `current_step` còn poller đọc `current_node` →
  ánh xạ MỘT dòng trong `studyApi` thay vì sửa poller hoặc chép bản mới.
- **Trang kết quả phải tự chờ chấm nền.** Bài có câu tự luận dừng ở `submitted` một lúc;
  không hỏi lại theo nhịp thì người học phải tự F5 mới thấy điểm.
- **404 không phải lúc nào cũng là lỗi.** Chưa có review plan thì `GET` trả 404 - trang
  hiển thị nút "Lập kế hoạch" chứ không phải thông báo lỗi đỏ.
- **"Chưa đo" khác "0 điểm" - kể cả trên UI.** Ô so sánh thiếu số liệu ghi chữ "chưa đo",
  không vẽ con dấu 0%. Vẽ 0% là nói người học đã làm và được 0.


## 2026-08-21 - Phase 7 StudyMap: Practice + Progress

Practice quiz sinh từ review item, so mastery trước/sau, ba endpoint tiến độ.

### Bài học

- **Thêm tham số vào job có sẵn, đừng chép job thứ hai.** Practice và quiz chẩn đoán khác
  đúng MỘT thứ: nguồn ngữ liệu (chunk từ review item so với chunk theo section). Chép
  `run_quiz_generation_job` ra bản thứ hai thì hai đường sinh quiz sẽ lệch nhau ngay lần
  sửa prompt kế tiếp. Thêm `chunk_ids` / `quiz_type` / `source_*` vào config là đủ.
- **"Chưa có số liệu" KHÁC "0 điểm".** Concept chỉ xuất hiện ở một phía của so sánh thì
  `delta` phải là `None`, không phải 0 - và không được đếm vào improved/declined. Gộp hai
  thứ đó lại là báo cáo sai tiến bộ, đúng thứ FR-12.7 dùng để đánh giá sản phẩm.
- **So sánh phải hẹp về đúng chủ đề đã luyện.** Practice quiz chỉ luyện một topic; so cả
  bài là so hai thứ khác nhau, và mọi concept không luyện sẽ hiện `delta=None` làm loãng
  kết quả. `compare_masteries(topics=[...])`.
- **Mastery tổng hợp lấy snapshot MỚI NHẤT, không cộng dồn.** `concept_masteries` là
  snapshot theo attempt (đặc tả 8.15). Cộng dồn earned/total qua nhiều attempt thì một bài
  tệ hồi đầu kéo điểm xuống mãi mãi dù người học đã nắm được - trái hẳn mục đích FR-12.4.
  Giữ thêm `first_mastery_score` + `improvement` để thấy tiến bộ.
- **Practice gộp mở-nháp-nộp làm một call, quiz chẩn đoán thì không.** Bài chẩn đoán dài,
  người học cần lưu nháp và đổi đáp án; bài luyện ngắn nên `POST /submit` làm hết. Nhưng
  vẫn đi qua đúng `attempts.repository` để lịch sử và thống kê thống nhất - khác API, không
  khác dữ liệu.
- **Quiz chẩn đoán vào route practice phải 404.** Hai luồng có ràng buộc khác nhau
  (`source_review_item_id` bắt buộc cho practice); để lọt là mời gọi trạng thái lai.
- **Một job route dùng chung tiết kiệm cả FE.** `/api/jobs/{id}` tra được mọi loại job nên
  FE chỉ cần một poller thay vì một cái cho mỗi tính năng - và theo bài học known-issues
  2026-07-17, càng ít poller thì càng ít chỗ quên cập nhật tập trạng thái terminal.
- **Lọc lại `document_id` khi nhận id chunk từ tầng trên.** `chunks_by_ids` vẫn ràng buộc
  theo tài liệu dù id đến từ review item của chính người dùng: một id lạc sang tài liệu
  khác thì không thể lọt vào ngữ liệu ra đề.


## 2026-08-20 - Phase 6 StudyMap: Gap Analysis + Review Plan

Tính mastery theo concept sau khi chấm, sinh review plan rule-based với LLM chỉ viết lời.

### Bài học

- **Rule quyết định NGUỒN, LLM chỉ viết lời** (PRD 17.2). `section_id` và `chunk_ids` của
  review item lấy từ chính câu người học làm sai; model chỉ viết `reason` +
  `review_tasks`. Cho model chọn mục tài liệu là cách chắc chắn nhất để sinh ra "gợi ý ôn
  phần không liên quan" — thứ FR-10 cấm.
- **Section của câu SAI, không phải của cả concept.** Concept có thể trải nhiều mục;
  người học chỉ cần đọc lại đúng chỗ mình hụt, không phải cả chương.
- **Câu chưa chấm được phải bị LOẠI khỏi mastery, không tính 0.** LLM bó tay không phải
  lỗi người học. Concept mà mọi câu đều chưa chấm thì không sinh bản ghi — `total_count > 0`
  là CHECK ở DB, tính 0/0 sẽ nổ.
- **`correct_count` và `earned_score` là hai thứ khác nhau.** `correct_count` đếm câu ĐÚNG
  HOÀN TOÀN để báo cáo; `earned_score` (partial = 0.5) mới là cơ sở tính mastery. Gộp lại
  thành một là mất thông tin, và sai công thức FR-09.9.
- **Snapshot theo attempt thì chạy lại phải GHI ĐÈ.** `concept_masteries` có UNIQUE
  `(attempt_id, concept_name)`; `analyze_attempt` xoá bản cũ của attempt rồi ghi lại. Chấm
  lại mà cộng dồn thì snapshot không còn là snapshot.
- **Phân tích chạy ngay sau khi chấm, và fail-open.** Bắt người dùng bấm thêm một nút để
  hệ thống tự tính là vô nghĩa. Nhưng điểm đã ghi xong rồi, nên lỗi phân tích chỉ được log
  chứ không được biến bài đã chấm thành hỏng. Route đọc mastery tính bù nếu thiếu.
- **LLM hỏng vẫn phải ra review plan.** `fallback_text` sinh `reason` + `review_tasks` từ
  số câu sai. Người học vừa làm bài xong mà nhận được trang trắng là hỏng sản phẩm, không
  phải hỏng model.
- **Patch chồng patch lại dính lần hai.** Test gọi `_fake_guide` hai lần trong một test:
  lần thứ hai đọc `review_mod.generate` thì bắt phải chính bản đã patch lần đầu, nên
  payload mới không bao giờ có tác dụng và test "force tạo lại" xanh giả. Giữ hàm gốc ở
  cấp module. Cùng lớp lỗi với `grade_short_answer` ở Phase 5 - dấu hiệu là test dựng lại
  cùng một helper nhiều lần trong một test.


## 2026-08-20 - Phase 5 StudyMap: Quiz Taking + Grading

Vòng đời attempt (mở → nháp → nộp → chấm), chấm khách quan đồng bộ, tự luận chấm nền.

### Bài học

- **Console Windows cp1252 giết tiến trình vì một dòng log tiếng Việt.** `print` có dấu
  ném `UnicodeEncodeError` và làm chết luôn luồng đang chạy. Docker/pytest dùng UTF-8 nên
  bẫy chỉ lộ khi chạy script trực tiếp - đúng lúc đang gỡ lỗi. Sửa MỘT chỗ:
  `shared/__init__.py` reconfigure stdout/stderr sang UTF-8 với `errors="replace"`, vì mọi
  module đều đi qua `shared.*`. Log xấu còn hơn tiến trình chết.
- **Mở quiz lần hai phải trả lại attempt đang dở.** Tạo attempt mới mỗi lần mở (đúng chữ
  FR-07.10) thì mỗi lần F5 đẻ một bài dở, và thống kê tiến bộ ở Phase 7 đếm toàn rác.
  `open_attempt` tìm `in_progress` trước, có thì trả lại.
- **Chấm hai đợt là mở lại race done-trước-result.** Bài có tự luận: cám dỗ là chấm trắc
  nghiệm ngay lúc nộp rồi vá phần tự luận sau. Làm thế thì có cửa sổ FE đọc trúng bảng
  điểm mới một nửa. Chấm CẢ attempt một lần, ghi một lần, trong một transaction.
- **Model không chấm được thì để trống, đừng cho 0.** `grade_short_answer` trả `None` khi
  JSON hỏng hoặc verdict lạ; câu đó giữ `verdict=NULL` và attempt vẫn `graded` để người
  học xem phần còn lại. Cho 0 oan tệ hơn nhiều so với chờ chấm lại.
- **`max_score` tính trên TỔNG số câu, không phải số câu đã chấm.** Bỏ trống 3 câu mà hiện
  100% thì con số vô nghĩa. Câu chưa chấm được cũng vẫn nằm ở mẫu số.
- **Chuẩn hoá đáp án phải dùng CHUNG với chỗ bắt câu trùng.** Người học bấm "Đúng" còn DB
  lưu "true" thì vẫn phải tính đúng. Tách `shared/text_norm.py` để AI Validation (bắt
  trùng) và Grading (so đáp án) dùng một hàm - hai bản riêng chắc chắn lệch nhau.
- **Kết quả chỉ lộ đáp án SAU khi nộp.** `/api/quizzes/results/{id}` trả 409 khi attempt
  còn `in_progress` - trả đáp án lúc đó là đưa bài giải cho người đang làm. Đây là chỗ
  duy nhất `include_answers=True`.
- **Sửa đáp án sau khi nộp phải 409, không phải 200 im lặng.** PATCH khi attempt không còn
  `in_progress` bị từ chối; nộp lần hai cũng 409 để không ghi đè `submitted_at` (làm sai
  `duration_seconds`).
- **Monkeypatch hàm có tham số inject thì phải pop tham số đó.** Test thay
  `grade_short_answer` bằng wrapper truyền `ask=...`, nhưng service đã truyền `ask=None`
  → "got multiple values for keyword". `kw.pop("ask", None)` trước khi gọi hàm gốc.
- **Kế hoạch bảo mở rộng `test_grading.py` - sai file.** File đó là CRAG retrieval
  grading (chấm độ liên quan của chunk), không liên quan chấm quiz. Trùng tên khái niệm
  không có nghĩa là trùng module; đọc file trước khi "mở rộng".


## 2026-08-20 - Phase 4 StudyMap: Quiz Generation + AI Validation

Sinh quiz chẩn đoán bằng LLM, 8 luật kiểm chất lượng FR-13, sổ cái job trong Postgres.

### Bài học

- **`đ` KHÔNG phân rã qua NFKD.** Chuẩn hoá tiếng Việt kiểu "NFKD rồi bỏ ký tự combining"
  biến "đúng" thành "ung" (U+0111 là chữ cái riêng, không phải d + dấu), nên đáp án
  true_false "Đúng" bị loại oan. Phải `replace("đ", "d")` TRƯỚC khi normalize. Bẫy này
  áp cho mọi chỗ so trùng không dấu, không riêng quiz.
- **Đừng loại câu hỏi vì trường trang trí.** Độ khó ghi "sieu kho", `section_id` lạ - đó
  là lỗi hình thức, chuẩn hoá được. Loại cả câu thì người dùng mất câu hỏi vốn dùng được.
  Chỉ loại khi câu **vô dụng cho người học** (thiếu đáp án/giải thích) hoặc **không kiểm
  chứng được từ tài liệu** (không có chunk nguồn).
- **Đưa nhãn ngắn cho model, đừng đưa UUID.** Chunk vào prompt là `c0`, `c1`; model trích
  lại nhãn nên nhãn lạ = bịa nguồn, thấy ngay. UUID vừa tốn token vừa dễ bị model chép
  sai một ký tự rồi trông y như thật.
- **Mặc định của cờ phải là bản an toàn.** `get_quiz(include_answers=False)` mặc định ẩn
  đáp án. Quên truyền cờ thì lộ đáp án (FR-06.12), nên cờ phải là thứ người gọi BẬT LÊN
  chứ không phải thứ họ tắt đi.
- **Validate config ở route, đừng để CHECK của DB bắt.** `difficulty`, `question_types`,
  `section_ids` kiểm ngay khi nhận request. Để DB bắt thì job đã tốn một lượt gọi LLM
  (hàng chục giây) rồi mới hỏng, mà lỗi trả ra là thông báo constraint không ai đọc được.
- **Sổ cái Postgres KHÔNG thay `jobs_store` SQLite.** `ai_validation_logs.job_id` là FK
  sang `jobs` nên phải có hàng thật trong Postgres. Nhưng `jobs_store` giữ progress từng %
  và **token buffer của chat** (ghi mỗi token) - đẩy thứ đó sang pooler ap-northeast-2 là
  tự sát về độ trễ. Giải: Postgres chỉ ghi 2 lần mỗi job (mở + đóng), `progress` để 0 và
  ghi rõ nó không phải nguồn sự thật.
- **Sổ kiểm toán hỏng không được làm hỏng job.** `ledger.open_job/close_job` nuốt lỗi và
  trả cờ; mở thất bại thì log validation vẫn ghi với `job_id=None` - FR-13.10 đòi bản ghi
  cho MỌI item bị loại, không kèm điều kiện.
- **Monkeypatch một hàm rồi gọi lại nó qua module là đệ quy vô hạn.** Test thay
  `gen.generate_questions` bằng lambda gọi `gen.generate_questions` - sau khi patch thì
  tên đó trỏ chính lambda. Phải giữ tham chiếu hàm gốc TRƯỚC khi patch.
- **Không dùng LangGraph cho luồng thẳng.** Kế hoạch ghi `quiz/graph.py` với LangGraph,
  nhưng luồng LoadContext-Generate-Validate-Persist là một mạch thẳng; graph tự ghi
  `status=done` lại dựng đúng race done-trước-result trong known-issues. Hàm thường,
  ~90 dòng, tự quản status - giống `run_study_map_job`.


## 2026-08-20 - Phase 3 StudyMap: Study Map + API tìm kiếm ngữ nghĩa

Adapter mindmap sang `knowledge_maps/nodes/edges/node_chunks`, 6 endpoint Study Map,
2 endpoint search dùng lại `HybridRetriever`.

### Bài học

- **Không chạy Study Map qua `MINDMAP_GRAPH` dù nó làm đúng các bước đó.** Graph tự ghi
  `status=done` kèm result là artifact mindmap; job Study Map phải trả `map_id`, nên đi
  qua graph là dựng lại đúng race "done trước result" trong known-issues 2026-07-06. Gọi
  thẳng `pipeline.skeleton/enrich/relations` (~40 dòng) và tự quản lý status: job chỉ
  `done` SAU khi map đã nằm trong DB.
- **Validate ràng buộc CHECK ở tầng app, đừng để DB bắt.** `ck_knowledge_nodes_not_self_parent`
  và `ck_knowledge_edges_no_self_loop` nếu để Postgres bắt thì cả transaction hỏng và
  người dùng chỉ thấy 500. `generator.build_graph` lọc sẵn: node không title bị bỏ
  (FR-04.6), node mồ côi / tự trỏ về root, edge self-loop và edge trỏ tới node lạ bị bỏ.
- **Map enum khác tập thì PHẢI có giá trị mặc định.** mindmap có 6 `REL_TYPES`, đặc tả chỉ
  cho 5 `relation_type`. Không map hết thì một `type` lạ làm vỡ CHECK giữa chừng. Bảng ánh
  xạ + `DEFAULT_RELATION_TYPE = "related"`; tương tự `kind` sang `node_type` mặc định
  `concept`.
- **Score bị vứt ở `_rrf_merge` — FR-05 cần nó.** `retrieve()` trả `list[RetrievedChunk]`,
  điểm RRF bị bỏ giữa chừng. Sửa bằng cách tách `retrieve_scored()` trả
  `list[(chunk, score)]` và `retrieve()` thành wrapper một dòng: chỉ 1 call site
  (`query_graph`) nên không phá gì, và không phải chép lại 60 dòng logic hybrid sang
  module search.
- **Score trả ra API phải gọi đúng tên nó là gì.** Điểm RRF (~0.03) không phải similarity
  0..1 như ví dụ trong đặc tả. Không chuẩn hoá giả thành 0..1 cho đẹp — trả raw và ghi rõ
  trong docstring là "chỉ so sánh được trong cùng một lần gọi".
- **Chunk có trong FAISS mà không có trong Postgres thì BỎ, không bịa.** Index dựng từ
  trước Phase 2 còn chunk chưa có hàng DB; trả `chunk_id` bịa còn tệ hơn trả thiếu.
- **Lọc quyền sở hữu bằng SQL, không lọc sau ở Python.** `lookup_by_embedding_ids` join
  `documents` và lọc `user_id` + `status != 'deleted'` ngay trong query (FR-05.5). Index
  FAISS dùng chung giữa các user, nên đây là chỗ duy nhất chặn được.
- **Xoá mềm là `status='deleted'`, KHÔNG có cột `deleted_at`.** Viết nhầm
  `Document.deleted_at.is_(None)` theo quán tính; bảng `documents` không có cột đó. Đọc
  lại model trước khi viết điều kiện lọc.
- **Mỗi lần tạo là một map mới, không ghi đè.** `questions.knowledge_node_id` và
  `review_plan_items.knowledge_node_id` trỏ vào node; ghi đè map cũ là mất dấu vết bài đã
  làm. `force=true` tạo map mới, không `force` thì trả map `completed` gần nhất.
- **Test viết theo trực giác về thứ tự thì sai.** Tôi kỳ vọng node ra theo `order` phẳng,
  thực tế `build_graph` duyệt DFS (con đứng ngay sau cha) — và đó mới là thứ tự đúng để
  insert FK. Tương tự, `validate_relations` bỏ cạnh chéo TRÙNG cạnh cây (cả chiều ngược),
  nên pipeline giả trong test phải nối hai node ANH EM, không phải cha-con.


## 2026-08-20 - Phase 2 StudyMap: documents/sections/chunks + Supabase Storage

Bỏ hẳn `index/source_registry.json`, chuyển nguồn sự thật về bảng `documents`;
ingest ghi `sections` + `document_chunks`; file gốc lên Supabase Storage; thêm 7
endpoint `/api/documents/*`.

### Bài học

- **Đổi tầng lưu trữ thì GIỮ chữ ký hàm, đừng sửa 20 call site.** `_load_source_registry`,
  `_update_source_status`, `_get_source_status*` được viết lại để đọc Postgres nhưng
  giữ nguyên tên + shape dict trả về. Diff gọn, và mọi test đang `monkeypatch`
  `_load_source_registry` vẫn chạy nguyên. Đổi tên hàm thì phải sửa cả chục file test.
- **Test dùng chung DB từ xa thì mất tính cô lập của tmp dir.** Registry cũ nằm trong
  `DATA_DIR` tạm nên mỗi phiên test bắt đầu sạch. Bảng `documents` dùng chung và tích
  luỹ, nên `_unique_display_filename` thấy "own.md" đã tồn tại từ lần chạy trước rồi đổi
  thành "own (4).md", làm test canonical stem sai. Fixture phải purge TRƯỚC và SAU phiên.
- **FK làm lộ id giả trong test.** `documents.user_id` có FK tới `users`; test cũ
  monkeypatch `_current_user_id` trả `"userA"` - id bịa - nên upload 500. Test phải tạo
  user thật. Đây là FK làm đúng việc của nó, không phải phiền toái.
- **Đừng để hai trường cùng mô tả một sự thật.** Bản đầu tôi lưu owner ở CẢ
  `documents.user_id` (FK, NOT NULL) lẫn `metadata_json.owner_user_id` (cho phép None ẩn
  danh) - hai nguồn sẽ drift. Sửa: một cột `user_id`, upload ẩn danh trỏ vào user hệ thống
  `anonymous@studymap.local`, tầng đọc quy đổi ngược thành None.
- **Supabase Storage từ chối key có khoảng trắng/ngoặc/dấu tiếng Việt** (`InvalidKey`).
  "Báo cáo tài chính 2025 (2).pdf" phải fold về ASCII an toàn. Tên hiển thị giữ nguyên ở
  `documents.title`; sanitize CHỈ áp cho khoá lưu trữ. Tiện thể chặn luôn path traversal.
- **Khoá API mới của Supabase (`sb_secret_...`) không phải JWT** - Storage trả
  `Invalid Compact JWS` nếu key sai. Bẫy thật lại là `BE/.env` vẫn giữ `CHANGE_ME_...`
  trong khi `.env` root đã có key thật: `load_project_env` ưu tiên `BE/.env`. Lần thứ hai
  trong một ngày dính cùng cái bẫy - mọi khoá Supabase giờ đồng bộ cả hai file.
- **Hot path đọc DB xa cần cache rất ngắn.** `owned_stems()` chạy mỗi request, trước đây
  đọc file local. Postgres ở ap-northeast-2 (~50-100ms) nên thêm cache 2s + xoá tường minh
  ở MỌI đường ghi. Không cache thì mỗi query cõng thêm một round trip.
- **Từ chối tái dùng `memory.tree._simple_section_group` cho bảng `sections`**: nó chia
  theo KÍCH THƯỚC với tiêu đề vị trí ("Section 1"). Review guide phải nói được "ôn lại mục
  2.3 Quy tắc hàm hợp" - tiêu đề vị trí làm gợi ý ôn tập vô nghĩa. Dùng heading thật; tài
  liệu không có heading thì MỘT section mặc định (đặc tả 3.3.7) trung thực hơn sáu tên rỗng.
- **Ghi DB trong ingest phải fail-open.** `_persist_sections_and_chunks` bọc try/except:
  FAISS đã ghi xong, chat vẫn chạy được; lỗi DB không được biến tài liệu đã index thành
  `failed`. Nhưng vẫn log `PersistDocument error` để không im lặng.


## 2026-08-20 — Phase 1 StudyMap: nền PostgreSQL trên Supabase

Dựng 19 bảng đặc tả bằng SQLAlchemy + Alembic, bật RLS deny-all, chuyển
`users_store` từ `users.sqlite` sang Postgres, thêm `POST /auth/refresh`.

### Bài học

- **Percent-encode mật khẩu trong DATABASE_URL, và encode ĐÚNG MỘT LẦN.** Mật khẩu
  có `#` để nguyên trong URL thì mọi thứ sau nó bị coi là fragment → URL cụt.
  Nhưng chạy script encode hai lần thì `%23` thành `%2523`, decode ra `%23` — DB
  báo `password authentication failed for user "postgres"` (Supabase pooler nuốt
  luôn phần tenant sau dấu chấm trong thông báo lỗi, càng dễ chẩn đoán nhầm là sai
  username). Script encode PHẢI idempotent: `unquote` tới khi ổn định rồi mới
  `quote` một lần. Bẫy nhân đôi: `.env` và `BE/.env` có thể lệch nhau, mà
  `load_project_env` ưu tiên `BE/.env` — sửa một file rồi test file kia là chẩn
  đoán mù.
- **`FORCE ROW LEVEL SECURITY` tự khoá chính mình.** BE kết nối bằng role `postgres`
  (owner bảng). `ENABLE` RLS + không policy = deny-all cho anon/publishable key,
  owner vẫn đọc được — đúng ý đồ. Thêm `FORCE` thì RLS áp cả owner → BE mất quyền
  đọc mọi bảng. Chỉ `ENABLE`, không `FORCE`, khi FE không gọi thẳng DB.
- **Vòng FK cần `use_alter=True`.** `quizzes → review_plan_items → review_plans →
  quiz_attempts → quizzes` là chu trình; không đánh dấu thì DDL không có thứ tự tạo
  bảng hợp lệ. Đặt `use_alter` trên hai FK của `quizzes` (`source_review_item_id`,
  `source_attempt_id`) để constraint tạo sau bằng ALTER.
- **Test schema phải chạy trên DB THẬT, không phải trên model.** CHECK khai trong
  model mà migration quên sinh thì test model-only vẫn xanh. `test_db_schema.py`
  insert dữ liệu sai và assert `IntegrityError` — bắt được cả trường hợp DB lệch model.
- **`pytest.mark.skipif` ở module level đọc env QUÁ SỚM.** Lúc pytest collect thì
  `app.main` chưa import nên `load_project_env()` chưa chạy → `DATABASE_URL` vắng →
  skip toàn bộ dù .env có. Đưa việc nạp env + `pytest.skip` vào fixture autouse.
- **Test ghi vào DB thật thì phải tự dọn.** Auth test tạo user mỗi lần chạy; không
  có fixture xoá `%@example.com` thì DB phình dần và test sau nhiễu test trước.
- `s.refresh()` sau `s.flush()` mới lấy được `created_at` do `server_default` sinh —
  không refresh thì cột đó là None trong dict trả về.


## 2026-08-20 — Phase 0 StudyMap: gỡ lớp lưu trữ QR/video

Bối cảnh: chuyển sang StudyMap AI (xem `00_Active_Plans/StudyMap AI - Migration Plan.md`).
Video QR không có trong đặc tả và đã là lưu trữ PHỤ từ trước (chunk_processor tự nuốt lỗi
ghi video, text chunk nằm ở FAISS + chunks.sqlite). Gỡ sạch: `video_utils.py`,
`chunk_processor.py`, 2 script rebuild-from-video, route `/videos/<name>`, `/rebuild-index`,
`/rebuild-status`, `/process-doc`, dep `qrcode[pil]` + `opencv-python-headless`.

### Bài học

- **Gỡ một lớp lưu trữ thì gỡ luôn cái nó đẻ ra.** QR giới hạn 2953 byte/frame là lý do DUY
  NHẤT của sub-chunk (`parent_id`/`sub_order`/`total_parts`/`is_subchunk`). Bỏ QR mà giữ
  sub-chunk là giữ 4 field chết + logic merge ở `input_collector` + mapping `chunk_index`
  vòng vèo ở `EmbedAndIndex`. Gỡ cả cụm thì node `ProcessChunks` không còn việc → xoá node,
  entry == chunk, heading và late-vector map thẳng theo index. Diff to hơn nhưng hệ thống nhỏ đi.
- **Định danh nghiệp vụ không được ký sinh vào tên file lưu trữ.** `meta["video"]` vừa là
  đường dẫn mp4 vừa là khoá nhận diện source: `delete_source_from_index`, `hybrid._norm_stem`,
  `memory/tree`, `input_collector`, `/list-indexed`, `/stats` đều fallback về nó. Đổi hết sang
  `source_stem` (canonical, ingest ghi sẵn) là fix đúng chỗ — nếu chỉ xoá file mp4 mà giữ khoá
  `video` thì mọi consumer vẫn phụ thuộc tên file của một lớp đã chết.
- **Giữ contract API dù đổi tầng lưu trữ.** `/list-indexed` vẫn trả key `video` (FE đọc
  `s.video_stem || s.video`) — chỉ đổi nguồn suy ra nó. Đổi tên field response chỉ vì tên
  xấu là tự tạo việc ở FE mà không được gì.
- **Bug ẩn lộ ra khi gỡ:** `chunk_index` được `chunk_processor` gắn vào entry nhưng
  `EmbedAndIndex` KHÔNG copy vào metadata index.json → `summary/pointers.py` đọc `chunk_index`
  luôn nhận None từ trước tới nay. Viết lại metadata thì thêm luôn `chunk_index: i`.
- **Nhánh `has_video` bỏ inline text để tiết kiệm chỗ là bẫy dữ liệu.** Chunk chỉ có
  `(video, frame_index)` mà không có `text` thì gỡ decode = mất text vĩnh viễn. Chốt xoá sạch
  dữ liệu cũ nên không cần backfill; nếu phải giữ dữ liệu thì PHẢI backfill decode trước khi gỡ.
- **Đo regression bằng baseline, không bằng cảm giác.** Suite này có 29 fail + 6 collection
  error pre-existing (`langchain_core.pydantic_v1` thiếu ở env local; auth env leak giữa test).
  Cách làm đúng: `git stash` → chạy suite → lưu danh sách fail → pop → chạy lại → `comm` hai
  danh sách. Kết quả Phase 0: 0 fail mới, 588 passed. Không có bước này thì 60 dòng FAILED
  trông như thảm hoạ do mình gây ra.
- **Test isolation đánh lừa:** `test_queue.py::test_stats_has_queue_block` fail 401 khi chạy
  RIÊNG file (env `AUTH_PROTECT_APP_APIS=true` từ `.env`), pass khi chạy cả suite. Xác nhận
  pre-existing bằng cách stash rồi chạy đúng file đó — đừng kết luận từ một lần chạy.


## 2026-07-18 — Optimization wave PR#1–PR#8/#9 lessons

Đợt tối ưu 8 PR (observability → SQLite reliability → FE delivery → LLM lanes →
warmup → ingest/index → retrieval hot-path → UX recovery). Toàn bộ merged,
smoke-verified trên stack `memvid_auth_smoke` rebuild từ code mới.

### Observability trước, tối ưu sau

- PR#1 đi đầu có chủ đích: timeline per-job, đếm LLM call, cache hit/miss metrics
  và smoke số đo thật PHẢI có trước khi tối ưu — không đo thì "tối ưu" là đoán.
- Metric per-process đánh lừa dưới nhiều gunicorn worker — phải mirror/aggregate
  (Redis INCRBY, `/stats["aggregate"]`); `llm_calls_local=0` trên worker này trong
  khi worker kia đếm là hành vi bình thường, đọc aggregate.
- Mọi instrumentation fail-open tuyệt đối: Redis chết thì đếm local vẫn chạy,
  đường sản phẩm không bao giờ hỏng vì đo đạc.

### SQLite/job reliability

- Retention + stuck-job sweep chỉ đụng status TERMINAL và phải idempotent;
  pending không bao giờ bị sweep (queue backlog chờ lâu là hợp lệ).
- `token_buffer` chỉ được xoá TRONG CÙNG UPDATE với terminal status + result
  (atomic — không bao giờ mất buffer trước khi result an toàn).
- `interrupted` là ngoại lệ: HITL/query-resume còn cần buffer → không xoá,
  để retention dọn record cũ.

### FE delivery

- `import * as Lucide` + lookup động giết tree-shaking → cả ~600 icon (~550KB)
  vào bundle chính. Registry tường minh + guard-test quét source là fix đúng.
- Lazy modal + manualChunks cắt 60% initial payload (374→148KB gzip) mà không
  đụng backend — quick win rẻ nhất của cả đợt.
- Streaming markdown re-parse TOÀN BỘ text mỗi token = O(n²); throttle flush
  (150ms) giữ preview mượt mà chi phí phẳng.

### LLM throughput

- Gateway lanes chặn batch chiếm hết slot; lane suy được từ `AskRequest.feature`
  CÓ SẴN — không cần proto change, mindmap-service ngoài process hưởng free.
- **Phát hiện kiến trúc quan trọng:** đường answer chính của `/query` (LC qa_chain
  → `get_llm` → ChatOllama trực tiếp) KHÔNG đi qua gateway — lanes chỉ bảo vệ
  gián tiếp qua hàng đợi Ollama. Đưa qa_chain qua gateway = PR tương lai.
- Single-flight follower ngủ chờ leader không được giữ admission slot; kế toán
  release phải qua MỘT cờ (`holds_admission`) — `threading.Semaphore` thường
  double-release là phình capacity VĨNH VIỄN, không có exception nào báo.

### Warmup + môi trường Docker

- Warmup phải lấy model từ chính `_model_map` runtime — default hardcode riêng
  ở warmup ("qwen3.5:9b") trôi khỏi config thật mà không test nào bắt.
- Bake SAI model vào image tệ hơn không bake: MiniLM ~90MB nằm chết trong image
  trong khi bge-m3 vẫn tải lúc boot. Model to (bge-m3 ~2.3GB) → HF cache volume,
  không nhét image.
- Trong container, `OLLAMA_HOST=http://localhost:11434` trỏ vào CHÍNH container
  → connection refused; compose stack phải dùng `http://host.docker.internal:11434`.
  Warmup fail-open che lỗi này khỏi health — phải đọc log `[warmup]` khi smoke.

### Ingest/index

- Full-dir backup mỗi append là chi phí lớn nhất của ingest mà KHÔNG có đường
  restore tự động — backup chỉ giữ cho thao tác phá huỷ (delete/rebuild),
  append dựa vào atomic write (tmp+replace) là đủ.
- Prefix-embedding legacy (embed lần 2 mỗi chunk vào index.json) không consumer
  thật nào đọc → gate flag OFF; kiểm consumer bằng grep TRƯỚC khi tin comment.

### Retrieval hot path

- Cache state đã load theo freshness key `(mtime_ns, size)` — mọi write path đều
  ghi lại file nên staleness window = 0, per-process là đủ.
- Writer PHẢI load fresh (mặc định), chỉ read-only path opt-in cache — writer
  mutate instance trước save, mutate bản cache query đang search là race.
- `chunk_id -> chunk` dict build một lần thay next()-scan O(n) mỗi hit —
  cùng kết quả, đo được bằng test equivalence.

### UX recovery + release readiness

- Regenerate phá huỷ phải confirm khi dirty; dirty state phải THREAD lên parent
  (`onDirtyChange`) — parent không tự biết viewer đang sửa dở.
- Retry phải dùng params ĐÃ CHỤP của lần chạy hỏng (ref), không phải selection
  hiện tại của UI — user đã đổi selection thì retry sai tài liệu.
- Stall UX: chỉ cảnh báo + Chờ tiếp/Huỷ, KHÔNG BAO GIỜ auto-cancel hay
  hard-timeout phía client (bài học cũ FE 180s bỏ cuộc giữa chừng vẫn đúng).
- Smoke checklist phải có bước "chứng minh container chạy code MỚI" (grep chuỗi
  đặc trưng commit trong container) — smoke này bắt được stack 11h stale thật;
  và cấm `down -v` mặc định để không mất hf_cache/data user.

## Summary v3 Phase 5 (2026-07-16): coverage judge — JUDGE-ONLY, flag-gated, cache key gồm chế độ coverage

- **Root cause / bối cảnh:** bản tóm tắt không có chẩn đoán chất lượng có cấu trúc cho nội dung
  thiếu (missing) / không được nguồn hậu thuẫn (unsupported) / mơ hồ (vague). Cần một tầng CHẤM
  điểm mà KHÔNG viết lại, KHÔNG auto-repair.
- **Thiết kế (đã làm):** cờ `SUMMARY_COVERAGE` (mặc định OFF). Module thuần
  `services/summary/pipeline/coverage.py`: `build_coverage_payload` (trích artifact source-backed:
  overview + section title/summary/key_points/facts + study.key_concepts — KHÔNG gửi raw chunk,
  KHÔNG gửi pointer/id để model không bịa trang/nguồn), `build_coverage_prompt` (luật JSON keys +
  "do not rewrite"), `sanitize_coverage` (list ép str + cap, vague ép bool, chỉ giữ COVERAGE_KEYS,
  non-dict→None), `judge_coverage(record, *, ask_fn, enabled)` (inject ask_fn → test được bằng fake
  LLM; nuốt MỌI lỗi/JSON hỏng → None). Adapter `LocalSummaryPipeline.coverage` resolve cờ + bọc
  ask_ai (threadpool+timeout, temp 0). Graph `assemble_node` gọi `getattr(pipeline,"coverage",None)`
  SAU dedupe_record, TRƯỚC persist — pipeline không có method thì bỏ qua (back-compat stub cũ).
- **Prevention / bài học:**
  1. Coverage đổi output khi bật → **PHẢI vào content_hash** (thêm param `coverage`), KHÔNG chỉ bump
     PIPELINE_VERSION. Bump v5→v6 vô hiệu cache cũ chung; nhưng cùng version, coverage ON vs OFF là
     HAI output khác nhau → nếu không hash cờ coverage, bản cache lúc OFF bị trả về khi bật ON
     (stale no-coverage). Cả route (`_summary_input_and_hash`) LẪN `collect_node` phải mirror cờ.
  2. Judge phải là JUDGE-ONLY tuyệt đối: 2 lớp guard (judge tự nuốt lỗi + graph bọc try) để judge
     lỗi KHÔNG BAO GIỜ chặn job tóm tắt. Test chứng minh: fake LLM raise / JSON hỏng → record vẫn
     done, chỉ thiếu key `coverage`.
  3. Inject `ask_fn` (không gọi thẳng ask_ai trong hàm judge) → test pure với fake LLM, không cần
     model/monkeypatch. Adapter mới lo model/timeout/threadpool.
  4. Coverage ADDITIVE: OFF → record omit key `coverage` byte-for-byte như cũ. Không đụng
     overview/sections/study — test chứng minh text không đổi sau judge.
- **Regression:** `test_summary_coverage.py` (17: sanitize valid/coerce/cap/vague/non-dict/unknown-
  keys/item-len, payload source-backed + no pointer leak, prompt JSON keys + no-rewrite, judge
  disabled/valid/malformed/raises/no-mutate), `test_summary_schema.py` (v6, content_hash gồm coverage,
  build_record omit/include coverage), `test_summary_graph.py` (skip khi None, include khi judge trả
  diag + overview/sections/study không đổi + persist atomic, judge failure không fail job). 107 non-route
  summary pass. KHÔNG đụng FE.

## Summary v3 Phase 4 (2026-07-16): dedup THUẦN sau assembly — khớp CHÍNH XÁC chuẩn hoá, không gộp mờ

- **Root cause / bối cảnh:** tóm tắt nhiều mục có thể lặp cùng fact/key_point (mục con nhắc lại mục
  cha; study gom facts các section). Cần tỉa lặp mà KHÔNG viết lại, KHÔNG bịa, KHÔNG mất fact duy nhất.
- **Thiết kế (đã làm):** module thuần `services/summary/pipeline/dedup.py` — `normalize_text` (lower +
  strip + gộp khoảng trắng + bỏ dấu câu nhẹ, GIỮ diacritics), `dedupe_strings` (khớp CHÍNH XÁC theo
  normalize; trùng → giữ bản DÀI hơn, bằng → giữ bản đầu; giữ thứ tự), `dedupe_facts/sections/study/
  record`. Gọi 1 chỗ: `summary_graph.assemble_node` SAU `build_record`, TRƯỚC persist (không node mới,
  không đổi cancel/error/done-atomic). Dedup: section.key_points + facts.*; study.* lists; self_check
  theo câu hỏi chuẩn hoá; recommended_review theo key `(chunk_id, section_title, reason)`. KHÔNG đụng
  summary/overview/chunk_refs/pointers.
- **Prevention / bài học:**
  1. Dedup văn bản người dùng thấy → CHỈ khớp CHÍNH XÁC bản chuẩn hoá (case/space/dấu câu). KHÔNG
     containment/fuzzy: "Đệ quy" là substring của "Đệ quy tuyến tính" nhưng KHÁC nghĩa — gộp = mất
     fact/gộp ý không liên quan. Bảo thủ thắng thông minh ở đây.
  2. GIỮ diacritics khi chuẩn hoá (đừng NFKD bỏ dấu): "bàn" ≠ "bán". Bỏ dấu = gộp nhầm homograph.
  3. Tie-break "giữ bản dài hơn" CHỈ kích hoạt khi normalize BẰNG nhau (khác dấu câu/hoa-thường);
     biến thể thêm TỪ mới normalize KHÁC → giữ cả hai (đúng: không mất chi tiết). (Test ban đầu sai kỳ
     vọng — tưởng "Đệ quy" gộp vào "Đệ quy: hàm gọi..." nhưng chúng normalize khác nên đều giữ.)
  4. Đổi NỘI DUNG output (dù thuần, deterministic) → bump PIPELINE_VERSION v4→v5, cache cũ chưa-dedup
     miss + tái sinh. schema_version GIỮ 2 (shape không đổi).
- **Regression:** `test_summary_dedup.py` (13: normalize, exact-dup, keep-longest, giữ thứ tự,
  conservative-không-gộp-na-ná, giữ-fact-thêm-từ, facts/sections/study/self_check/review dedup, pointer
  không mất, record null-safe), `test_summary_graph.py::test_dedup_removes_repeated_keypoints_and_facts`,
  `test_summary_schema.py` version v5. 85 non-route summary pass. KHÔNG đụng FE.

## Summary v3 Phase 3 (2026-07-16): study là trục `mode` (mục đích), KHÔNG phải length_mode (độ dài)

- **Root cause / bối cảnh:** "study/ôn tập" từng dễ bị mô hình hoá như một giá trị length_mode thứ 4.
  Sai: độ dài (short/medium/detailed) và mục đích (standard/study) là HAI trục độc lập — gộp thì mất
  tổ hợp short+study, medium+study...
- **Thiết kế (đã làm):** thêm trục `mode = standard|study` TRỰC GIAO length_mode. Thread qua route
  `/generate-summary` (thiếu→standard; sai→400 rõ ràng, KHÁC length_mode âm thầm rơi về medium) →
  content_hash (mode trong hash, standard/study khác cache) → job state → graph → record `mode` +
  block `study`. Block `study` DETERMINISTIC (0 LLM) `services/summary/pipeline/study.py::build_study`:
  gom facts (Phase 1) + pointers (Phase 2) các section → key_concepts/definitions/formulas/examples/
  common_mistakes + self_check (suy từ open_questions/important_terms, fallback key_points) +
  recommended_review (CHỈ từ pointer thật). FE: picker standard/study + render block study null-safe.
- **Prevention / bài học:**
  1. Phân biệt "độ dài" vs "mục đích/định dạng" = trục riêng. Đừng nhồi option mới vào enum sẵn có
     chỉ vì rẻ — mất tính tổ hợp + ngữ nghĩa lẫn lộn.
  2. mode SAI → 400 (người dùng gửi rác cần biết); length_mode sai → rơi default (độ dài chỉ là gợi ý).
     Hai policy validate khác nhau CÓ CHỦ ĐÍCH — ghi rõ.
  3. study block THUẦN từ facts/pointers đã có → 0 LLM, 0 bịa, test được. self_check suy từ facts
     (không hỏi model sinh câu ngoài tài liệu). recommended_review chỉ từ pointer thật (không bịa trang).
  4. mode ĐỘC LẬP cờ SUMMARY_FACTS: facts vắng (flag OFF) → study degrade an toàn (key_concepts/
     self_check fallback key_points, block facts rỗng, review vẫn có từ pointers). Không ép facts.
  5. Đổi shape output (thêm mode/study) → bump PIPELINE_VERSION v3→v4. schema_version GIỮ 2 (additive);
     record cũ thiếu mode → FE default standard, thiếu study → không render.
- **Regression:** `test_summary_study.py` (7: aggregate+dedupe, self_check open_q→terms→fallback,
  không bịa quá facts, review chỉ từ pointer thật, degrade rỗng), `test_summary_schema.py` (mode trong
  hash, build_record default/invalid/study/none, version v4), `test_summary_graph.py` (standard→no study,
  study→block từ facts+pointers). FE `summaryJob.test.js` (SUMMARY_MODES, normalize mode/study),
  `api.test.js` (generateSummary gửi mode). BE 72 non-route pass; FE 129 pass + build.
- **Lưu ý env:** `test_summary_routes.py` giờ 11 fail — TẤT CẢ là `401 UNAUTHORIZED` (test client không
  auth; AUTH_PROTECT bật). Pre-existing (baseline cũng 401), gồm cả test invalid-mode-400 (401 chặn
  trước khi tới handler). Không sửa auth env (ngoài phạm vi). Mock route đã cập nhật đúng chữ ký mới
  (`_summary_input_and_hash(sources, length_mode, mode)`, `_start_summary_job(..., length_mode, mode)`).

## Summary v3 Phase 2 (2026-07-16): source pointer suy DETERMINISTIC từ metadata chunk, KHÔNG từ LLM

- **Root cause / bối cảnh:** summary section chỉ có `chunk_refs` (id) — không đủ metadata để FE
  "quay lại đúng trang/mục" review. page/source/heading ĐÃ có ở ingest nhưng
  `collect_mindmap_input` DROP (chỉ giữ key/text/heading_path/chunk_keys).
- **Thiết kế (đã làm):** (1) `input_collector` propagate ADDITIVE `source_stem/source_id/page/
  chunk_index` per chunk (chỉ khi có; mindmap bỏ qua field lạ — guard test). (2) module thuần
  `services/summary/pipeline/pointers.py::build_pointers(mm_input, chunk_ids)` map id→pointer
  {chunk_id, source_id, source_stem, page, section_title, heading_path, chunk_index} — theo thứ tự
  chunk_ids, dedupe, BỎ id lạ (không bịa). (3) `attach_pointers` gắn `section["pointers"]` từ
  chunk_refs, gọi trong `summary_graph.assemble_node` TRƯỚC `sanitize_sections`. (4) schema
  `sanitize_pointers` chuẩn hoá (giữ POINTER_KEYS, cần chunk_id, dedupe, field lạ bỏ).
- **Prevention / bài học:**
  1. Metadata điều hướng nguồn (page/section) phải suy DETERMINISTIC từ chunk metadata, TUYỆT ĐỐI
     không nhờ LLM sinh (LLM bịa số trang/tên mục). Pointer 0 LLM, thuần, test được.
  2. `heading_path` trong mm_input là CHUỖI (' > ' join) — mindmap skeleton còn `.split(' > ')`.
     KHÔNG đổi sang list ở mm_input (vỡ mindmap); pointer tách list Ở TẦNG POINTER, giữ chuỗi ở mm.
  3. Field đi qua collector DÙNG CHUNG (mindmap+summary) → ADDITIVE, guard test "mindmap fields
     intact + build được" (bài học input_collector chung).
  4. Output shape đổi (thêm `pointers`) → vẫn **bump PIPELINE_VERSION** (v2→v3) dù pointers là suy
     diễn deterministic: cache cũ thiếu pointers phải miss + tái sinh. schema_version GIỮ 2 (additive).
  5. Pointer ĐỘC LẬP cờ SUMMARY_FACTS — suy từ chunk_refs, chạy cả summary chuẩn (facts OFF).
- **Regression:** `test_summary_pointers.py` (9: map metadata, section_title=mục cuối heading, sub-key→
  parent meta, missing→None, unknown id bỏ, dedupe giữ thứ tự, no-heading→None, attach per-section);
  `test_summary_schema.py` (sanitize_pointers keep/dedupe/drop-no-id, missing safe, non-list, sanitize_sections
  giữ pointers + chunk_refs không đổi, omit khi rỗng, version=v3); `test_mindmap_input_collector.py`
  (metadata additive + mindmap fields intact). 58 non-route summary + 14 mindmap pass.

## Summary v3 Phase 1 (2026-07-16): facts ledger là IR chuẩn, flag-gated, cache vô hiệu qua PIPELINE_VERSION

- **Root cause / bối cảnh:** tóm tắt v2 sinh `summary` thẳng từ chunk, KHÔNG có tầng trung gian có
  cấu trúc → khó suy ra study-mode/pointer/coverage sau này, và summary dễ trôi khỏi nội dung nguồn.
- **Thiết kế (đã làm):** thêm `facts` ledger per-section (7 key: key_points/definitions/formulas/
  examples/important_terms/common_mistakes/open_questions) sau cờ `SUMMARY_FACTS` (mặc định OFF).
  MỘT LLM call/section trả cả facts LẪN summary; prompt bắt "trích facts trước, viết summary CHỈ từ
  facts". `_summarize_one(..., with_facts=False, two_pass=False)` — `two_pass=True` raise
  NotImplementedError (seam tương lai, KHÔNG cài). `summarize_sections(with_facts=None)` resolve từ
  `get_settings().summary_facts`. Nguồn sự thật FACTS_KEYS + `sanitize_facts` ở `schema.py`, import
  vào summarize (DRY, một hành vi coerce/cap). `sanitize_sections` giữ facts khi có, BỎ key nếu rỗng.
- **Prevention / bài học:**
  1. Thêm field output ảnh hưởng cache → **bump `PIPELINE_VERSION`** (`summary_sections_v1`→`v2`);
     content_hash tự vô hiệu cache cũ, không migrate.
  2. Cờ tính năng OFF phải bảo toàn shape cũ BYTE-FOR-BYTE (trừ version): section không facts → KHÔNG
     có key `facts` (không sinh key rỗng). Test `test_with_facts_false_omits_facts_and_keeps_old_shape`.
  3. facts là free-text → chỉ coerce str + strip + drop-empty + cap (MAX_FACT_ITEMS), KHÔNG lọc theo
     allowed_set như `chunk_keys` (id). `chunk_keys` vẫn lọc id thật (chống bịa, bài học enrich).
  4. Lỗi LLM/degraded → KHÔNG bịa facts (section giữ skeleton, không key facts). Trung thực degraded.
- **Regression:** `test_summary_schema.py` (version bump, sanitize_facts coerce/drop/cap, sanitize_sections
  giữ/bỏ facts, build_record pass-through), `test_summary_summarize.py` (parse 7 key, coerce, hallucinated
  chunk_keys lọc, retry-once, degraded không bịa, two_pass raise, prompt chứa 7 key + length rule).
  44 passed (schema/summarize/sections/synthesize/graph-THẬT/store).
- **Lưu ý env:** `test_summary_routes.py` có 8 fail TỪ TRƯỚC (xác nhận bằng stash: fail y hệt trên
  origin/main sạch) — do redis/ollama warmup trong route test, KHÔNG liên quan facts.

## Container mind-elixir (2026-07-16): `absolute inset-0` bị chính thư viện ghi đè → canvas sụp chiều cao

- **Bối cảnh:** phần tử truyền vào `new MindElixir({ el })` trong `MindElixirView.jsx` mang class
  Tailwind `absolute inset-0`. mind-elixir constructor set `el.style.position = "relative"` INLINE
  (verified dist: `C.style.position = "relative"` với `C = this.el`). Inline THẮNG class → `absolute`
  vô hiệu, `inset-0` không còn tác dụng (inset chỉ áp cho positioned-absolute/fixed). `el` rơi về
  normal-flow không chiều cao rõ ràng.
- **Root cause (đo trực tiếp qua Playwright A/B trên bundle thật):** `.map-container{height:100%}`
  (CSS của mind-elixir) resolve theo chiều cao của `el`; `el` sụp về chiều cao NỘI DUNG → cả canvas
  sụp. Đo: `el`/`.map-container`/`me-nodes` = **363px** trong slot **800px** (khớp triệu chứng báo
  cáo ~307/747). Hệ quả: vùng dưới là dead space (kéo/click không ăn), `scaleFit()` tính theo container
  nhỏ nên "Vừa khung" căn sai khung nhìn.
- **Cách xử lý:** `el` sang normal-flow lấp đầy cha đã-định-cỡ: wrapper giữ `relative flex-1 min-h-0
  overflow-hidden`, ref target đổi `absolute inset-0` → `h-full w-full min-h-0`; thêm backstop CSS
  `.me-container{ width:100%; height:100%; min-height:0 }` (không phụ thuộc Tailwind class sống sót
  qua purge). Sau fix đo lại: `el`/`.map-container` = **800px** = slot, `elementFromPoint` ở đáy =
  `.map-container` (live canvas, hết dead space). Không đụng pan/zoom (unchanged PR #8).
- **Prevention:**
  1. Phần tử giao cho thư viện render (mind-elixir, và mọi lib tự set inline style) → ĐỪNG dựa vào
     positioning class (`absolute inset-0`) mà lib có thể ghi đè bằng inline `position`. Cho nó
     normal-flow `w/h-full` dưới một cha đã định-cỡ, hoặc set width/height 100% trực tiếp.
  2. Verify layout bằng SỐ ĐO thật (Playwright đo `getBoundingClientRect` A/B before/after trên
     CHÍNH bundle đã build + lib thật), đừng tin "build xanh" — cùng họ bài học mind-elixir/style.
  3. `elementFromPoint(x, đáy)` là cách rẻ + trung thực để chứng minh "hết dead space" mà không phải
     tổng hợp sự kiện pointer (pan của mind-elixir bám pointer-capture, khó tái tạo bằng synthetic
     event ngoài app thật → dùng làm tín hiệu phụ, đừng gate).

## Viewport sơ đồ (2026-07-15): pan/zoom ĐÃ CÓ SẴN — thiếu là chrome, không phải tính năng

- **Bối cảnh:** user báo "sơ đồ lớn khó di chuyển". Đọc `node_modules/mind-elixir/dist/MindElixir.js`
  TRƯỚC khi viết code: thư viện đã tự lo TOÀN BỘ pan/zoom — wheel = pan, shift+wheel = pan ngang,
  ctrl/cmd+wheel = zoom bám con trỏ, kéo-trái nền = pan (nhờ `mouseSelectionButton: 2` viewer đã set),
  touch/pointer pan, Space+kéo, và cả keymap `Ctrl/Cmd + =/-/0`. Không thiếu một gesture nào.
  Thiếu là **khả năng khám phá**: không có readout, không fit, không reset, nền không có con trỏ grab
  (thư viện chỉ đặt grab khi `.space-pressed`), dòng gợi ý "kéo nền" lại bị `display:none` dưới 640px —
  tức là ẩn đúng chỗ cảm ứng cần nhất. Viết pan/zoom custom sẽ là đập đi làm lại thứ đã chạy tốt,
  và còn phải đánh nhau với chính transform thư viện ghi lên `.map-canvas`.
- **Bug thật tìm ra khi đọc dist (không phải từ report):** `zoomBy` cũ kẹp `Math.min(2, Math.max(0.4, …))`
  trong khi mặc định thư viện là `scaleMin = 0.2` / `scaleMax = 1.4`, VÀ guard trong `scale()` là
  **REJECT chứ không phải clamp**: `if (e < this.scaleMin && e < this.scaleVal || e > this.scaleMax && e > this.scaleVal) return`.
  ⇒ Nút "Phóng to" **chết im lặng ở 1.4** (bấm tiếp không làm gì, không lỗi, không log). Sửa: đọc
  `mind.scaleMin`/`mind.scaleMax` từ CHÍNH instance rồi kẹp trước khi gọi — scale() luôn nhận.
- **Prevention:**
  1. Trước khi xây tính năng viewport/tương tác trên một thư viện render: **grep dist của nó** tìm
     `wheel`/`scale`/`move`/keymap handler. Ở đây `scaleFit()`, bus event `scale`, `scaleMin/Max` đều
     có sẵn và không hề dùng — build custom là thêm nợ, không thêm giá trị.
  2. Hằng số giới hạn của thư viện phải ĐỌC TỪ INSTANCE, đừng hardcode ở FE. Hardcode lệch với thật =
     control chết im lặng (loại lỗi không có exception, không test nào bắt, chỉ user thấy).
  3. Đọc kỹ guard là *reject* hay *clamp*. Reject + giá trị ngoài range = no-op câm; clamp thì tự sửa.
  4. `scaleFit()` gọi `Ce(this, !0)` — tham số `true` ÉP nhánh căn-theo-nodes **bất kể** option
     `alignment`. Nên KHÔNG cần truyền `alignment: "nodes"` (doc thư viện gợi ý "better with") →
     tránh được rủi ro đổi `transformOrigin` của `toCenter()` mặc định. Đọc code thắng đọc doc.
  5. `toCenter()` GIỮ NGUYÊN `scaleVal` (`pn` vẽ lại transform với `scale(${this.scaleVal})`) → "đặt lại
     khung nhìn" phải gọi CẢ `scale(1)` LẪN `toCenter()`; chỉ một cái là nửa vời.
- **Regression:** `FE/src/utils/mindmapViewport.test.js` (17 test, THUẦN — không import React/mind-elixir,
  chạy được ở env `node` mặc định vì repo chưa có jsdom). Cover: clamp min/max, `nextScale` kẹp trần/sàn,
  `formatZoom` làm tròn, keymap `+ = - _ 0 f/F`, null khi đang gõ, null khi có ctrl/meta/alt
  (nhường keymap `Ctrl/Cmd +/-/0` sẵn có của thư viện — kiểm tra bảng keymap trong dist trước khi
  bind phím mới, đừng đoán). Suite FE: 104 passed (19 file).
- **Guard non-finite (không phải phòng xa vu vơ):** `scaleFit()` tính
  `this.nodes.offsetHeight / this.container.offsetHeight` — container ẩn/chưa layout cho `0/0 = NaN` →
  `scaleVal = NaN` → `transform: scale(NaN)` vỡ map + readout in "NaN%". `clampScale`/`formatZoom` chặn
  tại tầng thuần.
- **CSS:** đặc tả cố ý — `.me-container{cursor:grab}` = (0,1,0) THUA `.map-container me-parent{cursor:pointer}`
  = (0,1,1) của thư viện nên node giữ pointer, chỉ nền grab; thêm `me-parent:active` (0,2,1) để bấm node
  không nháy grabbing. Verify rule vào bundle bằng `grep` `dist/assets/*.css` (đúng bài học
  "đừng tin build xanh" của mind-elixir/style) — lưu ý grep class arbitrary Tailwind phải tính ký tự
  escape (`min-w-\[46px\]`), grep thô sẽ tưởng nhầm là bị rớt.

## Summary v2 (2026-07-06): thay pipeline 6-technique bằng section-first mirror mindmap

- **Bối cảnh:** tóm tắt cũ (`summarize_advanced.py` FROST/CoD/DANCER/extract/fact-check)
  sync (block request doc dài), không cache, không citation, lưu JSON, không dùng heading
  từ ingest. Thay HẲN (đã xóa file + endpoint `/summarize-documents`, `/summarize-file`,
  `POST /summaries`) bằng pipeline section-first — spec `docs/SUMMARY_V2_SPEC.md`.
- **Thiết kế:** copy nguyên pattern mindmap đã trưởng thành thay vì phát minh mới:
  `services/summary/pipeline/` (schema/sections/summarize/synthesize) import trực tiếp
  `skeleton.py`/`outline.py` của mindmap (plain Python, monolith); `summary_graph.py`
  5 node clone mindmap_graph (guard/cancel/done-atomic-với-result); store sqlite +
  `content_hash` (CÓ length_mode trong hash — đổi độ dài = record khác);
  FE generalize `createMindmapPoller` → `jobPoller.js` + `makeActiveJobStore` —
  wrapper mindmap giữ nguyên API, test cũ pass không sửa.
- **Bài học:** feature mới cùng shape (job nền dài + LLM + cache + poll) → generalize
  hạ tầng CŨ thành module chung với wrapper backward-compatible, đừng copy-paste body.
  Toàn bộ ràng buộc playbook (done atomic, degraded honest, no FE hard-timeout,
  cache-hit không job_id, chunk_refs lọc id thật) được thừa hưởng miễn phí từ template.
- **Regression:** `test_summary_{schema,sections,summarize,synthesize,graph,store,routes}.py`
  (38 test, graph THẬT + route contract cache-hit-no-job_id + old endpoint 404);
  FE `summaryJob.test.js`/`activeJob.test.js`. Suite: BE 289 passed, FE 43 passed.
- **Lưu ý vận hành:** đổi prompt/logic summary → bump `PIPELINE_VERSION`
  (`services/summary/pipeline/schema.py`). `summaries.json` cũ migrate 1 lần khi startup
  → `.migrated`; record legacy render qua `summary_md` fallback trong SummaryModal.

## Cache 3 tầng (Redis): bucket-key encode mọi điều kiện match = chống poisoning theo cấu trúc

- **Bối cảnh (2026-07-06):** thêm semantic response cache + retrieval cache (Redis, fail-open)
  cho pipeline query — spec đầy đủ `docs/SEMANTIC_CACHE_SPEC.md`, module
  `app/domains/cache/llm_cache.py` + `app/clients/redis_client.py`. Điểm cắm: L2 trong
  `main._get_cached_query`/`_set_cached_query` (graph không đổi cho Tier 2, thừa hưởng guard
  history/processing/empty-answer sẵn có) + wrap `_do_hybrid_retrieve` cho Tier 3.
- **Bài học thiết kế:**
  1. Semantic cache KHÔNG so cosine tự do — bucket key sha256(namespace|env|PROMPT_VERSION|
     embedding model|LATE_CHUNKING|index_version|sources|language|category|use_memory_tree);
     chỉ so cosine TRONG bucket. Khác điều kiện = khác bucket = không thể false-hit chéo.
     Đây là dạng tổng quát của bài học "cache key phải hash MỌI input ảnh hưởng output"
     (mindmap content_hash).
  2. index_version = `os.stat(index.json).st_mtime_ns-size` — KHÔNG import store (kéo
     faiss/langchain), KHÔNG đọc nội dung file (nặng). `_save_meta` atomic-replace đảm bảo
     mtime đổi mỗi ingest/delete → mọi cache liên quan tài liệu tự vô hiệu, không cần event bus.
  3. Fail-open phải có "cửa sổ unavailable" (60s) — không thì Redis chết = mỗi request ăn
     0.5s timeout. `mark_unavailable()` khi op lỗi giữa chừng, không chỉ lúc connect.
  4. Risk-classifier deny-regex (personal/realtime) chạy TRƯỚC khi ghi cache. Regex bảo thủ
     có false-positive chấp nhận được (deny nhầm = chỉ mất 1 cơ hội cache) — test semantic
     phải dùng câu hỏi trung tính, đừng dùng câu chứa "password"/"giá"/"hôm nay".
  5. Threshold có sàn cứng 0.80 (clamp + warning; override phải bật cờ riêng) — hạ threshold
     để tăng hit-rate là công thức cache poisoning.
- **Regression:** `tests/test_llm_cache.py` (14 case: exact/semantic hit, bucket miss,
  index_version miss, expired+SREM, fail-open window, floor clamp, risk deny, retrieval
  round-trip, real-graph history bypass). Đổi system prompt qa_chain → bump
  `llm_cache.PROMPT_VERSION`; đổi format `_make_query_cache_key` → sửa
  `llm_cache._parse_cache_key` (lệch = miss im lặng, hướng fail-safe).

## Thư viện render bằng CSS riêng (mind-elixir): import style là PHẦN CỦA API, không phải trang trí

- **Root cause (2026-07-05):** mind-elixir v5 layout hoàn toàn bằng `dist/MindElixir.css`
  (custom elements `me-nodes`/`me-tpc` mặc định inline). Viewer mới (thay ReactFlow) chỉ
  import JS, không import CSS → sơ đồ vỡ hoàn toàn ở CẢ viewer lẫn PNG export, mà build/test
  vẫn xanh (không lớp nào kiểm "CSS có vào bundle"). Kèm 2 bẫy cùng họ: theme override chỉ
  set 4/22 cssVar (var thiếu = declaration invalid vì CSS không có fallback), và snapdom chụp
  `mind.nodes` tách khỏi `.map-canvas` làm descendant selector không match trong clone.
- **Prevention:**
  1. Thêm thư viện render mới → đọc package.json exports tìm `"./style"`; smoke DOM thật
     (mở viewer nhìn bằng mắt/screenshot) chứ đừng tin build xanh.
  2. Override theme → set đủ TOÀN BỘ bộ var thư viện tiêu thụ; guard bằng test liệt kê
     (`FE/src/components/mindmap/theme.test.js`) để version sau thêm var là test đỏ.
  3. snapdom/html2canvas: target chụp phải CHỨA mọi tổ tiên mà CSS selector cần
     (`.map-canvas me-nodes{...}` → chụp `.map-canvas`, không chụp `me-nodes`). Thêm `scale: 2`.
- **Chẩn đoán nhanh loại lỗi này:** mọi text dồn 1 dòng + element không có kích thước
  = layout CSS không được nạp, đừng đi tìm bug data/adapter.

## Text hiển thị cho user phải đi qua MỘT đường render, không phải `<p>{raw}</p>`

- **Root cause (2026-07-05):** chunk text lưu sqlite là markdown mammoth thô (`__bold__`,
  `\(escape\)`). ChatArea render qua react-markdown nên đẹp; 2 surface bằng chứng
  (EvidenceDrawer, lề bằng chứng SidebarRight) lại `<p>{text}</p>` raw → user thấy
  `__Triển khai...\(IDS/IPS\)__`. Cùng một loại data, hai số phận — vì mỗi chỗ tự quyết
  cách hiển thị.
- **Prevention:**
  1. Data có thể chứa markup → dùng chung MỘT component render (`ui/Markdown.jsx::MdSnippet`
     cho trích đoạn; ChatArea giữ map riêng vì có citation-chip). Chỗ mới hiển thị chunk/note
     → dùng lại MdSnippet, đừng tự `<p>`.
  2. Escape-cleanup 2 phía phải MIRROR nhau và ghi chú chéo: BE `clean.py::unescape_mammoth`
     (data mới, tận gốc) ↔ FE `evidence.js::unescapeMd` (data cũ đã lưu). Đổi set ký tự một
     bên phải đổi bên kia.
  3. Set unescape phải BẢO THỦ (chỉ punctuation `. ( ) ! ? , : ; … " '`) — unescape `\# \* \- \[`
     là tự tạo heading/list/link markdown giả từ text vốn được escape có chủ đích.

## Cấu trúc mindmap đến từ INGEST, không phải từ pipeline mindmap

- **Root cause (2026-07-05):** map nông không phải lỗi skeleton/enrich — tài liệu docx không
  mang heading nào tới pipeline (mammoth cần Word Heading styles; sinh viên dùng bold/số tay).
  Sửa prompt/pipeline bao nhiêu cũng không thêm được chiều sâu mà nguồn không mang theo.
  Fix đúng tầng: promote heading heuristic ở `clean.py` (ingest) + map heading qua
  `chunk_index` sống sót sub-split + LLM outline fallback CHỈ khi deterministic bó tay.
- **Prevention:**
  1. Chẩn đoán "output nghèo" → truy NGƯỢC pipeline tới tận nguồn dữ liệu (chunk metadata
     thật trong index.json) trước khi sửa prompt/LLM.
  2. Metadata dẫn xuất đi kèm chunk (heading, span, page) phải map qua ID/index bám theo
     entry (như `chunk_index`), KHÔNG qua alignment `len(a)==len(b)` — mọi bước sub-split/
    lọc sẽ phá alignment và rớt metadata im lặng.
  3. Cache key phải hash MỌI input ảnh hưởng output (cả metadata), không chỉ text — không thì
     fix ingest xong cache vẫn trả kết quả cũ và tưởng fix hỏng. `generator.skeleton_method`
     được persist để chẩn đoán nhanh record đã lưu sinh từ đường nào.
  4. Degraded phải TRUNG THỰC: mọi nhánh no-op (SKIP_MODEL_LOAD, LLM lỗi, outline fail) phải
     khai `degraded/missing`, đừng trả kết quả thiếu như bản hoàn chỉnh.

## Xoá source trên FAISS: LangChain dùng docstore id, legacy raw-FAISS dùng `chunk_id`

- **Root cause:** Hai backend lưu id khác nhau. LangChain FAISS giữ vector theo `docstore_id`
  nội bộ (uuid trong `docstore._dict`), nên `FAISS.delete(ids=...)` KHÔNG nhận trực tiếp
  `chunk_id`. Legacy raw-FAISS (`IndexIDMap`) thì id trong index chính là `chunk_id`.
- **Prevention:**
  1. Nhánh LangChain phải map `chunk_id -> docstore_id` từ metadata trước khi delete; không
     được giả định `chunk_id` là key xoá dùng chung cho cả hai backend.
  2. Mọi lỗi delete-by-id phải rơi về `rebuild_chunk_index(...)` để ưu tiên toàn vẹn
     index/meta. Sai một bước xoá có thể để meta và vector lệch nhau; rebuild là đường lui an toàn.
  3. Regression cần có ở cả hai backend: LC chứng minh map đúng sang `docstore_id`, raw-FAISS
     chứng minh vẫn xoá theo `chunk_id` như cũ.

## Late Chunking (bge-m3): embed toàn văn → mean-pool theo span (mặc định ON)

- **Bối cảnh / root cause:** naive chunking (cắt chunk rồi embed từng chunk độc lập, pooling
  CLS của bge-m3) khiến mỗi vector "mù" ngữ cảnh xung quanh → mất thông tin ở tài liệu dài,
  nhiều tham chiếu ngược ("như đã trình bày ở trên", đại từ "thành phố này"). Late chunking
  embed token TOÀN VĂN trước (`AutoModel.last_hidden_state`) rồi mean-pool theo ranh giới chunk
  → mỗi vector "thấm" ngữ cảnh toàn cục.
- **Thiết kế (đã làm):** module `app/domains/ingest/late_chunk.py::LateChunkEncoder` (lazy singleton,
  cache theo model-name, `warmup()`, sliding-window token cho doc > context, mean-pool + L2-norm).
  `chunk_markdown_spans()` trả `(doc_text, pieces)` với `doc_text[start:end]==text` (hệ toạ độ char).
  Vector tính ở **chunk_node** rồi carry `late_embeddings` xuống `embed_index_node` →
  `append_to_index(embeddings=...)` (store ghi precomputed, `__meta__.pooling="mean_late"`).
- **2 bẫy then chốt (đã xử lý):**
  1. **Pooling phải NHẤT QUÁN query↔chunk.** bge-m3 mặc định CLS, late chunking mean → cosine chỉ
     có nghĩa khi cả hai cùng mean. ⇒ `llm_factory.get_embeddings/get_embedding_model` đổi sang
     `LateChunkEncoder`/`LateChunkEmbeddings` (mean-pool) cho MỌI single-text embedding (query,
     memory-tree, mindmap). Late chunking **bypass gateway Embed** (model/pooling gateway khác → sai).
  2. **Span vỡ ở embed_index_node.** Tại đó text đã enrich + sub-split (QR) → KHÔNG khớp char-span.
     Phải tính vector ở chunk_node (còn `doc_text`+spans); `chunk_processor` gắn `chunk_index` lên mọi
     entry để sub-chunk dùng chung vector chunk cha. (Smoke thật: best-match đúng đoạn dùng đại từ;
     cosine(in-context, standalone)≈0.80<1 ⇒ đã thấm ngữ cảnh.)
- **Prevention / regression:**
  1. Đổi scheme (LATE_CHUNKING bật/tắt) hay đổi model → **PHẢI rebuild FAISS index** (pooling/dim
     đổi). Giữ cờ `LATE_CHUNKING=0` (đường CLS cũ) cho tình huống khẩn — mặc định ON.
  2. EMBEDDING_MODEL_NAME PHẢI là long-context encoder (bge-m3/jina-v3/nomic). KHÔNG all-MiniLM
     (max 512 → vỡ window 8192). Đã bỏ fallback all-MiniLM ở đường late; default encoder = bge-m3.
  3. Tests: `test_late_chunk*` (pure fns + fake model, KHÔNG tải bge-m3), `test_chunking` (span),
     `test_chunk_processor_index` (chunk_index), `test_store_precomputed`, `test_late_chunk_ingest`
     (e2e graph với fake encoder), `test_embedding_late_chunk` (wiring). Smoke THẬT (bge-m3) chỉ chạy
     thủ công (cần model) — đúng bài học "real-engine smoke test bắt lỗi mà unit-với-fake bỏ sót".

## Per-feature temperature: factual→0, chat→0.3 (chống ảo giác đúng tầng)

- **Bối cảnh:** temperature thấp giảm bịa đặt ở tác vụ factual, NHƯNG không phải "viên đạn bạc"
  (vẫn cần prompt ràng buộc "thiếu thì nói thiếu" + RAG/CRAG/NLI — đã có sẵn). Trước đây cả
  chat/summary/sinh-đáp-án dùng CHUNG một `LLM_TEMPERATURE=0.3`.
- **Thiết kế (đã làm):** `_resolve_temperature(feature, options)` trong `llm_factory.py`, ưu tiên
  `options['temperature']` (override per-call, vd mindmap 0.15) > factual (`_FACTUAL_FEATURES`:
  answer/summary/mindmap/grade/classify/extract → `LLM_TEMPERATURE_FACTUAL=0`) > chat (`LLM_TEMPERATURE=0.3`).
  Sinh đáp án RAG dùng `feature="answer"` (cùng model chat, temp 0): `summarize_results`,
  LC QA chain (`answer_with_document_context*` qua query_graph), VÀ memory-tree answer (`tree.py`).
  LLMReranker scoring → `feature="grade"`. (Quét đủ path nhờ codex: GenerateAnswer + memory-tree.)
- **Bẫy gateway (proto3) — codex review bắt được:** `common_pb2.LlmOptions.temperature` là `double`
  proto3 → KHÔNG phân biệt "0.0 đặt rõ" vs "mặc định"; `server._options_to_dict` lại dùng truthy
  `if options.temperature:` → rớt 0.0. ⇒ KHÔNG inject temp client-side. Để **server tự resolve theo
  `feature`** (đồng nhất cả ollama/gemini/groq). Phải truyền `feature, options` vào CẢ
  `_gemini_chat_llm`/`_groq_chat_llm` (trước chỉ ollama nhận) — `local_providers.ProviderPool.ask`.
- **Prevention:** thêm feature factual mới → bỏ vào `_FACTUAL_FEATURES`. Tác vụ scoring/classify/extract
  PHẢI factual (tất định). Còn chừa: query_rewrite + structured_extraction/fact_check (domain summary)
  vẫn `feature="chat"` — chấp nhận (sinh ngôn ngữ), siết sau nếu cần policy khép kín.

## Định danh file phải có MỘT nguồn sự thật (đừng suy stem rải rác mỗi nơi mỗi kiểu)

- **Root cause:** stem của source được tính lại ở nhiều tầng (upload/ingest/retrieval/memory-tree/
  list-indexed) với quy tắc lệch nhau (giữ vs sanitize khoảng trắng, NFC vs NFKD, có/không bỏ timestamp).
  Tên file có space → query-theo-file trượt khớp, trả rỗng.
- **Prevention:**
  1. MỘT hàm canonical duy nhất (`shared/source_id.py`), MIRROR đúng cách tạo artifact đích (ở đây là
     video_path); mọi nơi so khớp PHẢI gọi nó. Khi thêm tầng mới đụng tên file → dùng lại, đừng tự chế.
  2. Ghi định danh canonical (`source_stem`/`source_id`) THẲNG vào metadata để hạ nguồn khớp chính xác,
     thay vì tái dựng từ tên đã biến đổi (sanitize/timestamp).
  3. NFKD KHÔNG bỏ dấu kết hợp — đừng tưởng `normalize("NFKD")` biến "Hướng" → "Huong". Muốn ổn định
     thì ép NFC + sanitize, đừng so khớp chuỗi thô.
- **Bài học test:** bug này KHÔNG bị bắt vì `conftest` mock `_trigger_background_ingest` + `QUERY_GRAPH`,
  và `hybrid.retrieve` return [] khi `SKIP_MODEL_LOAD=1`. Lớp bắt được là UNIT trực tiếp `_filter_by_sources`
  với metadata giả (video_path đã sanitize) — không cần model. Luôn có test ở tầng logic thuần khi tầng
  tích hợp bị mock (đúng tinh thần "conftest mock che mất lỗi" bên dưới).

## Mindmap: timeout TEMP, normalize nguồn lệch, mode bị bỏ qua

> **(Lịch sử — pipeline mô tả dưới đây đã bị THAY THẾ hoàn toàn ngày 2026-07-04 bởi skeleton-first;
> xem mục "Mindmap: skeleton-first thay pipeline 3-mode/7-strategy" phía trên. `worker.py`
> mode/strategy/`generation_mode`/`multilevel_fast` không còn tồn tại trong code. Giữ mục này làm
> lịch sử vì các bài học chung (đừng để giá trị debug lọt vào nhánh chính, JSON repair phải
> string-aware, conftest mock che gap test) vẫn còn giá trị.)**

- **Timeout "TEMP TESTING":** `worker.py` từng để `LLM_TIMEOUT_BALANCED=30`, `JOB_TIMEOUT_BALANCED=60`
  (comment "was 90/180") → balanced hay timeout → rơi deterministic nghèo. Đã khôi phục 90/180 và cho
  override qua env `MINDMAP_LLM_TIMEOUT_*`/`MINDMAP_JOB_TIMEOUT_*`. **Bài học:** đừng để giá trị debug
  "TEMP" lọt vào nhánh chính; nếu cần thử nghiệm → dùng env, đừng sửa hằng số.
- **Normalize nguồn lệch chuẩn:** worker dùng `normalize_video_name` riêng (NFKD, khớp `m['video']`) thay
  vì `canonical_source_stem`. Đã hợp nhất: helper module-level `collect_chunks_for_sources` ưu tiên
  `m['source_stem']` (ingest ghi) → fallback `video`, canonical hoá. Khớp file giống retrieval (space/dấu).
- **Mode bị bỏ qua (bug ẩn):** `run_mindmap_job` nhét `generation_mode` vào field `strategy` và KHÔNG set
  `generation_mode` → `generate_node` luôn đọc mode = "balanced" (fast/quality bị mất). Đã thêm
  `generation_mode` + `strategy_requested` vào `MindmapState` và set đúng; endpoint propagate strategy.
  Test `test_mindmap_graph::test_mode_and_strategy_propagated_to_worker` chốt.
- **JSON repair phải string-aware:** bỏ dấu phẩy thừa bằng regex mù làm hỏng comma trong chuỗi
  (codex bắt). `_repair_json_text` quét ký tự, chỉ bỏ `,` trước `}`/`]` khi NGOÀI chuỗi.
- **Gap test mindmap:** conftest mock `MINDMAP_GRAPH` → graph thật không được dựng. Đã thêm
  `test_mindmap_graph.py` dựng `build_mindmap_graph` THẬT (callable stub) — bắt lỗi pydantic/langgraph.
- **Giới hạn đã biết — Huỷ mindmap (FE):** nút Huỷ chỉ dừng polling FE; job BE vẫn chạy xong và
  `append_mindmap` đã lưu map trong lúc sinh → map có thể hiện ở lần fetch sau. Huỷ thật cần
  cooperative-abort (cờ cancel + worker/TimeoutTracker kiểm) — chưa làm (codex review). Chấp nhận.
  **[ĐÃ GIẢI QUYẾT 2026-07-04]** `POST /mindmap-cancel/<job_id>` set cờ thật trong `jobs.sqlite`
  (`request_cancel`); mọi node của graph mới (`_guard()` trong `app/graphs/mindmap_graph.py`) và cả
  vòng lặp theo batch trong `enrich_branches`/trước lời gọi LLM trong `extract_relations` đều kiểm
  tra cờ này — huỷ giữa chừng dừng đúng lúc và KHÔNG persist record.
- **FE `record` sau generate rebuild field-by-field → rớt field v2 (schema_version/relations/generator):**
  `SidebarRight.jsx::handleGenerateMindMap` (nay là `runMindmapGeneration`) dựng lại `record` từ `data`
  (kết quả job) bằng cách liệt kê từng field (`id/title/nodes/diagram/sources/createdAt/strategy/...`)
  thay vì giữ nguyên `data` — mọi field KHÔNG có trong danh sách bị rớt âm thầm. V2 record có thêm
  `schema_version`/`relations`/`generator` (BE `services/mindmap/pipeline/schema.py::build_record`)
  mà danh sách cũ không liệt kê → sơ đồ vừa tạo xong (chưa reload) không hiện quan hệ/banner degraded,
  dù `normalizeMindmapRecord` (Task 13) đã hỗ trợ đủ. Chỉ lộ ra khi F5 lại (list `/mindmaps` trả full
  record đã lưu, không đi qua đường rebuild field-by-field này).
  **Sửa (Task 14):** `record = { ...data, id: ..., title: ..., ... }` — spread `data` TRƯỚC, các field
  tường minh sau chỉ để backfill default (key sau đè key trước trong object literal, không mất field
  nào của `data`). **Prevention:** khi FE "đóng gói lại" một response BE thành state cục bộ, ưu tiên
  `{ ...response, ...overrides }` thay vì liệt kê thủ công từng field — liệt kê thủ công là nợ kỹ thuật
  âm thầm mỗi khi BE thêm field mới (không lỗi build/test nào bắt được, chỉ lộ qua so sánh dữ liệu thực).

## Mindmap: skeleton-first thay pipeline 3-mode/7-strategy (2026-07-04)

- **Bối cảnh / root cause:** pipeline mindmap cũ ~2113 dòng: 3 mode (fast/balanced/quality) × 7
  strategy (`single_call_schema`/`mindmap_v2`/`cmgn_light`/`cmgn`/`multilevel_fast`/`iterative`/
  deterministic) × fallback chain × LLM call budget × một LLM-call riêng để build "visual diagram"
  (2 artifact trùng nhau: `nodes` + `diagram` cho cùng nội dung). "Cache mechanism §5" trong tài
  liệu cũ mô tả cache theo content hash + strategy + model NHƯNG code không hề có bước lookup —
  progress chỉ IN ra "Đang lưu cache" rồi ghi thẳng, không đọc lại (cache ma, chưa từng tồn tại
  trong code dù tài liệu khẳng định có). Ngoài ra: FE không có đường gửi `mode` xuống nên server
  luôn chạy nhánh mặc định; `worker.py` tự đọc `index.json`/`chunks.sqlite` trực tiếp xuyên ranh
  giới service (vi phạm tách monolith/service); nút Huỷ ở FE chỉ dừng polling, job BE vẫn chạy xong
  và lưu map (huỷ giả — xem known-issues cũ).
- **Thiết kế đã làm:** thay bằng skeleton-first — cấu trúc mục lục tài liệu (`heading_path`, fallback
  Memory Tree section, fallback TF-IDF cluster) làm KHUNG XƯƠNG tất định (0 LLM, deterministic,
  không bao giờ là rác) trước; LLM chỉ được gọi ở 2 chỗ hẹp: Enrich (mỗi nhánh 1 call, song song,
  `chunk_refs` do LLM trả về bị lọc lại theo tập id hợp lệ để chặn bịa) và Relations (1 call tìm
  quan hệ chéo, validate lại id/trùng cạnh/tự-trỏ, cap 20). Một LangGraph 5 node
  (`app/graphs/mindmap_graph.py`: CollectInput → Skeleton → Enrich → Relations → AssemblePersist)
  thay toàn bộ cây quyết định mode/strategy cũ — không còn rẽ nhánh theo kích thước dữ liệu. Cache
  THẬT: `content_hash` (sha256 của `PIPELINE_VERSION` + sources + chunk text) lookup trong
  `memory/mindmaps.sqlite` (`app/domains/mindmap/store.py::get_by_hash`) TRƯỚC khi tạo job — cache
  hit trả thẳng record, không tốn LLM call nào. LLM lỗi ở nhánh/relations nào → giữ nguyên khung
  xương phần đó, đánh dấu `generator.degraded=true` + `generator.missing=[...]` thay vì fallback
  im lặng hoặc bịa dữ liệu. Cancel THẬT: cờ trong `jobs.sqlite`, mọi node (`_guard()`) và cả vòng
  lặp batch trong enrich/relations đều kiểm tra trước khi tiếp tục — huỷ giữa chừng không persist.
- **Prevention / regression:**
  1. Đổi prompt hoặc logic bất kỳ node nào (skeleton/enrich/relations/schema) → PHẢI bump
     `PIPELINE_VERSION` trong `services/mindmap/pipeline/schema.py` để tự vô hiệu cache cũ (nếu
     không, kết quả sinh từ logic cũ tiếp tục được trả về do trùng `content_hash`).
  2. Mọi thay đổi `MindmapState` phải có test dựng graph THẬT (`build_mindmap_graph(...)` với
     pipeline/callback stub) — đúng bài học "conftest mock che mất lỗi build graph thật" ở mục
     dưới; không được chỉ test qua mock.
  3. Đặt timeout mặc định (`MINDMAP_LLM_TIMEOUT_SEC`) dựa trên số đo THẬT trên phần cứng đích, không
     đoán — xem số đo 2026-07-04 (Ollama CPU local): enrich 3 nhánh ≈ 86s, relations ≈ 14s, tổng
     ≈ 100s cho 4 chunk có heading; 57 chunk không heading (fallback cluster) ≈ 58s.
  4. Service (nếu bật `MINDMAP_SERVICE_ADDR`) KHÔNG được tự đọc `index.json`/`chunks.sqlite` — input
     phải được monolith gom sẵn (`input_collector.py`) rồi truyền qua wire (gRPC per-stage:
     Skeleton/EnrichBranches-stream/Relations), giữ đúng ranh giới service đã học ở lần trước.

## Đừng nâng langgraph/langchain lên 1.x trên máy dev này

- **Root cause:** Nâng env lên langgraph 1.x kéo `ormsgpack` — binary bị Windows Application Control chặn → app vỡ hoàn toàn ở import-time. Code lại vốn viết cho langchain 0.3.x / langgraph 0.2.x (API `langchain.retrievers.EnsembleRetriever`, `SqliteSaver(conn)`), nên việc nâng lên 1.x còn kéo theo cả migrate API (`langchain.retrievers` → `langchain_classic.retrievers`).
- **Prevention:**
  1. Pin chặt langgraph/langchain trong `requirements.txt` (đã làm). Đặc biệt pin `langgraph-checkpoint==2.0.23` để không nhảy sang bản ormsgpack.
  2. Sau mọi `pip install`/đổi dependency, chạy `python -c "import app.graphs.query_graph"` để bắt lỗi import-time ngay.
  3. Khi tra phiên bản tương thích, dùng PyPI JSON (`requires_dist`) để xác định cutover dependency thay vì đoán.
- **Test env:** dùng global `python` để chạy pytest; cả global lẫn `.venv` đều resolve về `.venv\Lib\site-packages` trên máy này.

## conftest mock che mất lỗi build graph thật

- **Root cause:** `tests/conftest.py` gán `be_main.QUERY_GRAPH = _MockQueryGraph()` → `StateGraph(QueryState)` thật KHÔNG bao giờ được dựng trong test. Suite xanh 100% nhưng app thật vỡ ở startup (pydantic 2.12 + NotRequired).
- **Prevention:** Có test dựng graph THẬT bằng `build_query_graph(...)` với callable stub (xem `tests/_qg_build.py` + `test_crag_graph.py`/`test_hitl_graph.py`). Mọi thay đổi schema `QueryState` hay dependency phải chạy nhóm test này.

## Rerank (Two-Stage Retrieval) cần candidate pool RỘNG ở Stage 1 mới có tác dụng

- **Root cause:** Rerank chỉ sắp xếp lại tài liệu mà Retriever đưa cho nó, KHÔNG tìm tài liệu mới. Nếu Stage 1 (RetrieveFAISS) chỉ lấy đúng `HYBRID_TOP_K` (=4) thì cross-encoder không có gì để lọc → vô dụng. Phải để Stage 1 lấy rộng (`RERANK_CANDIDATE_K`, mặc định 20) rồi Stage 2 lọc xuống `RERANK_TOP_N`.
- **Thiết kế (đã làm):** module `app/domains/retrieval/rerank.py` (backend cắm-rút: cross_encoder/cohere/llm/none), lazy-load + cache model, guard `SKIP_MODEL_LOAD`, MỌI lỗi → fallback `IdentityReranker` (giữ nguyên thứ tự). Node `RerankDocuments` chèn giữa `RetrieveFAISS` → `ContextBuilder`, **chỉ wire khi `RERANK_ENABLED=1`** (tắt → topology graph y hệt cũ). Có timeout riêng `RERANK_TIMEOUT_SEC` (quá hạn → giữ nguyên thứ tự).
- **Prevention:**
  1. Default OFF. Bật rerank PHẢI kèm `RERANK_CANDIDATE_K > RERANK_TOP_N` mới có lợi.
  2. `cross_encoder` dùng `sentence-transformers` (đã có dep) — KHÔNG thêm dependency mới (tránh bẫy pin ở known-issues). `cohere` là optional, phá tính offline.
  3. Sau khi đổi env rerank trong test: `cfg.reload()` + `rerank.reset_cache()` (model cache theo backend|model|batch).
  4. Verify: `python -c "import app.graphs.query_graph"` + build graph THẬT với `RERANK_ENABLED=1` (xem `tests/test_rerank_graph.py`) — bắt lỗi pydantic/langgraph khi thêm node, đúng bài học conftest-mock bên dưới.

## Tầng NLI (contradiction-check) — mirror rerank, KHÔNG bump dependency

- **Bối cảnh:** embedding (bi-encoder) có điểm mù — cosine cao nhưng nghĩa ngược (phủ định/đổi thực thể/thời gian/con số). Thêm node `VerifyContext` quét cặp chunk top-K bằng mDeBERTa NLI, loại chunk hạng thấp khi mâu thuẫn với chunk hạng cao.
- **Thiết kế (đã làm):** module `app/domains/retrieval/nli.py` mirror `rerank.py`: engine cắm-rút (`MDebertaNli`/`NullNli`), lazy-load + cache theo model-name, guard `SKIP_MODEL_LOAD`, **MỌI lỗi/timeout → passthrough (không loại chunk nào)**. Node `VerifyContext` chèn `RetrieveFAISS → [Rerank] → [VerifyContext] → ContextBuilder`, **chỉ wire khi `NLI_ENABLED=1`** (tắt → topology y hệt cũ). Dùng `transformers`/`torch` đã có — chỉ thêm leaf-dep `sentencepiece` (tokenizer DebertaV2, KHÔNG chạm langgraph).
- **Prevention:**
  1. Default OFF. Thêm `nli.reset_cache()` + `cfg.reload()` sau khi đổi env NLI trong test.
  2. Sau khi thêm dep (`sentencepiece`): verify `python -c "import app.graphs.query_graph"` vẫn OK (đừng để pip kéo theo bản transformers/torch mới làm vỡ pin).
  3. Phải có test build graph THẬT với `NLI_ENABLED=1` (xem `tests/test_nli_graph.py` qua `_qg_build.py`) — bắt lỗi pydantic/NotRequired khi thêm field `context_conflicts`/`rerank_scores` vào `QueryState` (đúng bài học conftest-mock).
  4. Khi nhiều node cùng sửa `retrieved_chunks` (Rerank đổi thành str + lưu `rerank_scores`; VerifyContext loại chunk), node sau PHẢI realign mọi list song song (`rerank_scores`, `retrieved_stems`) theo index giữ lại — lệch độ dài thì downstream (CRAG grade) phải tự bỏ qua an toàn.

## Timeout bọc lời gọi engine PHẢI loại trừ thời gian load/JIT (warm trước, ngoài timeout)

- **Root cause:** `RerankDocuments`/`VerifyContext` bọc engine trong `result(timeout=...)` 10s,
  nhưng engine lazy-load model NGAY trong block đó. Load weights mDeBERTa ~12.7s > 10s → query
  đầu âm thầm fallback identity/[] (rerank vô tác dụng, NLI không khử mâu thuẫn). Phát hiện CHỈ
  qua smoke-test engine THẬT — unit test monkeypatch engine fn nên không bao giờ load model thật.
- **Prevention:**
  1. Mọi node bọc model-call trong timeout PHẢI warm model (load + 1 forward mồi) NGOÀI vùng
     timeout trước. Đã thêm `rerank.warmup()`/`nli.warmup()` (timeout riêng 120s, mọi lỗi → no-op).
  2. Timeout của node chỉ nên bao **inference thực**, không bao chi phí một-lần (load/JIT/trace).
  3. Phải có smoke-test chạy ENGINE THẬT (không monkeypatch) với cờ bật + timeout mặc định —
     đây là lớp duy nhất bắt được loại lỗi "timeout nuốt lần load đầu" (mirror bài học conftest-mock).
  4. Khi đặt giá trị timeout mặc định: ĐO inference thực trên phần cứng đích trước
     (mDeBERTa CPU ~7s/cặp ⇒ 10s là phi thực tế cho NLI; xem known-issues). Đừng đoán.
- **Test env:** `base_env` (`tests/_qg_build.py`) set `SKIP_MODEL_LOAD=1` để `warmup()` không
  kéo model thật trong unit test; test cần engine thật tự bật lại `"0"` + monkeypatch `get_*`.
- **3 bẫy khi viết warmup (codex review bắt được — đã sửa):**
  1. **`with ThreadPoolExecutor` vô hiệu hoá timeout:** `__exit__` gọi `shutdown(wait=True)` →
     vẫn chặn tới khi load xong, dù `result(timeout=...)` đã ném. Phải tạo executor thủ công +
     `finally: ex.shutdown(wait=False)` mới TRẢ NGAY khi quá hạn (load tiếp ở nền). (Lưu ý: node
     `RerankDocuments`/`VerifyContext` cũng dùng `with ...` y hệt → timeout của node cũng KHÔNG
     bỏ được call treo; đây là pattern toàn codebase, residual chưa sửa.)
  2. **Double-load race:** warmup (wait=False) + node có thể cùng gọi `_ensure_model` → thêm
     `threading.Lock` + double-checked locking, gán `self._model` là bước CUỐI.
  3. **Forward mồi mỗi query:** `_load` chạy 1 forward để warm JIT — nếu không gắn cờ sẽ chạy
     LẠI mỗi query (NLI ~11s/query thừa). Gắn `engine._warmed=True` sau lần đầu → các lần sau no-op.
     Cold-path bọc thêm `_warmup_lock` (module) + double-check `_warmed` → warm đúng 1 lần cho mọi
     case thực tế (tuần tự + đồng thời thường). **Residual benign (chấp nhận):** nếu load > timeout
     (warmup nhả lock khi `_warmed` chưa set) + có query đồng thời → forward mồi có thể chạy 2 lần
     (double-LOAD vẫn bị instance `_lock` chặn). Trên CPU này load ~13s ≪ 90–120s nên gần như bất
     khả thi; cố đóng kín sẽ thêm máy móc concurrency không đáng. (codex review 2 vòng)

## langgraph 0.2.x: interrupt() KHÔNG đặt key `__interrupt__` trong kết quả invoke

- **Root cause:** Convention `out["__interrupt__"]` là của langgraph 1.x. Ở 0.2.x, `graph.invoke` khi gặp `interrupt()` trả về state đã commit (không có key đó) và graph tạm dừng. Phát hiện đúng: `graph.get_state(config).next` khác rỗng + đọc `state.tasks[].interrupts[0].value`.
- **Prevention:** Dùng helper `_detect_query_interrupt(graph, thread_id)` trong `main.py` (qua get_state) thay vì kiểm tra key `__interrupt__`. Resume bằng `graph.invoke(Command(resume=decision), config={thread_id})`.
- **Lưu ý review_gate:** logic áp dụng quyết định (edit/reject) phải nằm SAU khi lấy decision (từ `interrupt()` trả về khi resume), KHÔNG tách thành nhánh `if review_decision` riêng — vì khi resume node re-run và decision đến từ giá trị trả về của `interrupt()`.

## Provenance trong query payload cho "lề bằng chứng" (FE) — additive, KHÔNG suy lại stem

- **Bối cảnh:** redesign UI (Phòng đọc) cần hiện nguồn/chunk đã grounding câu trả lời ở
  cột phải. Dữ liệu ĐÃ có trong state graph (`retrieved_sources`/`retrieved_stems`/
  `retrieved_chunks`) nhưng `_finalize_query_job` chỉ copy `answer`/`error` vào payload → FE
  không thấy.
- **Thiết kế (đã làm):** thêm `_attach_evidence(payload, out)` (gọi trong `_finalize_query_job`
  CHỈ khi `has_ans`), set `payload["sources"]` (list stem) + `payload["chunks"]`
  (`[{stem, chunk_id, snippet}]`, cắt 12 chunk × 600 ký tự). Stem/chunk_id ưu tiên PARSE từ
  prefix `"[Nguồn: <stem>, đoạn <id>]"` mà node RetrieveFAISS đã gắn, fallback `retrieved_stems[i]`.
- **Prevention / regression:**
  1. ADDITIVE thuần — bọc `try/except`, không bao giờ làm hỏng đường answer/error. Không đổi
     `status_code`, không đổi history-persist.
  2. KHÔNG suy lại định danh source ở đây (đúng bài học "một nguồn sự thật cho source_stem"):
     chỉ tái dùng stem có sẵn trong state / prefix; FE so khớp bằng `normStem` (mirror `stemBaseLoose`).
  3. Prefix citation là hợp đồng ngầm giữa `query_graph` (RetrieveFAISS) và FE
      (`utils/evidence.js::processCitations`, regex `[Nguồn: …, đoạn N]`). Đổi format ở một phía
     PHẢI đổi phía kia.
  4. Verify: `python -m pytest BE/tests/test_query.py` (global python) — payload có `sources`/`chunks`
     khi có answer, vắng khi lỗi.

## Chunk Text Store: `chunks.sqlite` là nguồn văn bản DUY NHẤT

> **Sửa 2026-09-01.** Mục này trước đây mô tả một kiến trúc ba tầng
> "video QR = canonical, index.json slim, sqlite dẫn xuất". Lớp lưu trữ QR/video thuộc
> một dự án khác và **đã được gỡ khỏi kho này** — không còn `video_utils.py`,
> `chunk_processor.py`, hay bất kỳ tham chiếu `decode_video_qr`/`qrcode` nào. Giữ nguyên
> mô tả cũ là để lại một bản đồ dẫn tới nơi không tồn tại, và tệ hơn: nó hứa một đường
> recovery không có thật.

- **Vì sao tách text ra khỏi `index.json`:** sau khi thêm late chunking, `index.json` lưu
  cả `text` lẫn vector/metadata cho mỗi chunk (~13MB cho 245 chunk). BM25 nạp corpus hàng
  loạt lúc khởi động và nhiều nơi khác đọc text rất nhiều lần, nên text phải nằm ở một
  store đọc nhanh và tách khỏi metadata.
- **Hiện trạng (đã kiểm 2026-09-01):**
  1. `index/chunks.sqlite` giữ text thô — **nguồn duy nhất**.
  2. `chunk_text_store.py` là module truy cập duy nhất. `get_text` có **đúng hai** tầng:
     sqlite, rồi inline `text` trong `index.json` (chỉ index cũ mới còn).
  3. Ingest ghi text qua `chunk_text_store.put_many`.
  4. Mọi nơi đọc text (BM25, memory tree, mindmap input collector, endpoint trong
     `main.py`) đều đi qua module này — 23 điểm gọi trong `app/`.
- **Hệ quả phải nhớ:** **không có đường recovery nào sau `chunks.sqlite`.** Mất nó, và
  `index.json` không còn inline text, thì cách duy nhất là ingest lại tài liệu gốc. Xem
  known-issues "chunks.sqlite bị mất hoặc hỏng dữ liệu".
- **Regression:** `test_chunk_text_store.py`, `test_store_precomputed.py`,
  `test_late_chunk_ingest.py`.
- **Bài học chung:** khi gỡ một lớp lưu trữ, grep cả **tài liệu** chứ không chỉ mã. Mã đã
  sạch từ lâu (các comment còn lại đều ghi "QR đã gỡ"), nhưng `ARCHITECTURE.md`,
  `FLOW_UPLOAD.md`, `QUY_TRINH_TAO_SO_DO_TU_DUY.md`, `README.md` và RQ Worker Playbook vẫn
  vẽ nó như đang chạy — trong đó có một câu khẳng định sai về khả năng khôi phục dữ liệu.

## Job chạy nền dài (mindmap): KHÔNG đặt hard-timeout FE dựa trên thời lượng trung bình

- **Root cause:** `SidebarRight.jsx::startPolling` (bản round-1) tự đặt `maxElapsedMs =
  jobTimeout(180s) + 10s` rồi chủ động bắn `onError` khi vượt — một con số ĐOÁN theo thời lượng
  TRUNG BÌNH của pipeline lúc đo (enrich 3 nhánh ≈86s), không phải giới hạn thật của hệ thống. Tài
  liệu lớn hơn/nhiều nhánh hơn thì thời gian sinh tăng tuyến tính và vượt mốc đoán đó dễ dàng, dù BE
  vẫn đang chạy đúng và sẽ xong. Kết quả: FE tự báo lỗi "quá thời gian chờ" giữa chừng, job BE vẫn
  hoàn tất và lưu record, user phải F5 rồi mở lại từ danh sách mới thấy — tưởng nhầm là lỗi thật.
  Chi tiết triệu chứng/fix xem `.playbook/known-issues.md` (mục đã resolved 2026-07-04).
- **Prevention:**
  1. KHÔNG gắn hard-timeout ở tầng client cho bất kỳ job nào có thời lượng chạy PHỤ THUỘC vào kích
     thước dữ liệu đầu vào (mindmap, ingest lớn, mọi job tương lai tương tự) — thời lượng "đo được"
     hôm nay không phải giới hạn trên thật.
  2. Nếu cần phát hiện "job có vẻ kẹt" để cảnh báo UI, dùng **stall-detection theo fingerprint tiến
     độ** (progress/current_node/kích thước partial-result không đổi trong N phút) thay vì đếm tổng
     thời gian trôi qua — cảnh báo là ĐỦ, đừng tự ý huỷ/báo lỗi thay người dùng.
  3. Mọi job chạy nền đủ dài để user có thể rời trang (F5, đóng tab, chuyển tab) nên lưu định danh
     job (`job_id` + ngữ cảnh tối thiểu) vào `localStorage` NGAY khi nhận được, để lần mount sau có
     thể resume polling thay vì bắt user tưởng đã mất tiến trình. Poller không tự guard double-start
     — caller phải dừng instance cũ trước khi gán instance mới vào ref khi user bấm tạo/tạo lại liên
     tiếp, nếu không sẽ rò rỉ vòng lặp polling.

## mind-elixir (và mọi editor bên thứ ba khác): đừng tin nó bảo toàn field lạ — giữ provenance ở sidecar

- **Root cause:** Adapter 2 chiều record↔mind-elixir cần giữ field nghiệp vụ (`note`, `chunk_refs`,
  `kind`) qua các thao tác kéo/xoá/gõ/thêm node của thư viện. `mind-elixir` không có hợp đồng nào
  cam kết bảo toàn field ngoài shape riêng của nó (`id`, `topic`, `children`, ...) — `getData()` chỉ
  trả về đúng những gì thư viện tự quản lý. Nếu adapter đọc field nghiệp vụ trực tiếp từ dữ liệu
  mind-elixir trả về, một vòng edit bất kỳ có thể âm thầm làm rớt `chunk_refs`/`note` của node đó.
  Một lỗi liên quan đã bị **reviewer bắt trong quá trình implement** (không phải test tự động): node
  mồ côi (parent trỏ tới id không còn tồn tại) hoặc root thừa (nhiều node cùng tự nhận `kind: "root"`)
  bị cây `toTree()` bỏ rơi hoàn toàn — một vòng load→save sẽ xoá câm lặng cả nhánh con của node đó.
- **Prevention:**
  1. Giữ field nghiệp vụ trong **sidecar map riêng** ở tầng gọi (không phải trong instance của thư
     viện), key theo `id` node — `FE/src/utils/mindElixirAdapter.js` dùng `Map<id, {note, chunkRefs,
     kind}>`, sống trong `useRef` ở component, merge lại theo `id` khi save
     (`mindElixirToRecord(mindData, sidecar, baseRecord)`).
  2. Khi load dữ liệu vào editor bên thứ ba: RÀ SOÁT và **rescue** mọi node mồ côi/root-thừa trước
     khi build cây cho nó — gắn lại dưới root (giữ nguyên nhánh con) thay vì loại bỏ. Không giả định
     dữ liệu đầu vào luôn "sạch" (một cây đúng nghĩa, đúng 1 root).
  3. Node mới do user tạo trong editor sẽ không có trong sidecar — adapter phải có default hợp lý
     (`chunk_refs: []`, `kind` suy theo độ sâu trong cây) thay vì crash hoặc để `undefined` rò vào
     record đã lưu.
  4. Test round-trip PURE (không import thư viện thật) phải cover: giữ nguyên note/chunk_refs/kind
     của node sống qua vòng record→adapter→record; node mới → default đúng; node xoá không rò lại;
     node mồ côi/root-thừa được rescue chứ không mất tích.

## 2026-08-24 - Gỡ `reports/` khỏi git: tài sản của dự án khác đừng nằm trong repo mã nguồn

- **Bối cảnh:** `reports/` (112 file tracked, 1.6MB) chứa báo cáo NCKH — 5 chương luận văn, khảo sát
  paper, config thí nghiệm E0–E7/R0–R2, dataset `corpus_v1`, baseline benchmark. Đó là deliverable
  của một dự án báo cáo riêng, không phải mã nguồn StudyMap. Gỡ bằng `git rm -r --cached` + thêm
  `reports/` vào `.gitignore` (file giữ nguyên trên đĩa để bê sang repo báo cáo).
- **Root cause của cái bẫy:** trước khi gỡ phải hỏi "code có đọc nó không". Lần đầu tao `grep -rn
  "reports/"` chỉ trong `BE/app BE/scripts BE/tests scripts` — tự chọn tay danh sách thư mục vì
  `grep -rn` từ gốc treo quá 120s (`node_modules` + `.venv`). Cách đó **sót `BE/evaluation/`**: 4 file
  nữa (`aggregate.py`, `runner.py`, `review_app.py`, `candidate_package.py`) cũng nhắc `reports/`.
  Chỉ khi lệnh grep toàn cây chạy nền xong mới lòi ra. Tổng thật là 10 chỗ, không phải 6:
  2 script perf + 1 script playwright GHI ra `reports/` và đã tự `mkdir(parents=True, exist_ok=True)`;
  3 test ĐỌC `reports/evaluation/datasets/corpus_v1`; 4 file `BE/evaluation/` chỉ dùng đường dẫn làm
  **default của argparse / default parameter sau `if __name__ == "__main__"`** — không chạy lúc import,
  đè được bằng cờ `--dataset` / `--reports-root`, nên không phải ràng buộc. Chỉ nhóm ĐỌC-lúc-chạy mới
  là ràng buộc thật. May là lần sót này vô hại; lần sau có thể không.
- **Điều bất ngờ:** 3 test đọc đó vốn đã fail sẵn 17 ca vì đường dẫn tương đối sai gốc CWD (chi tiết
  ở `known-issues.md`). Nghĩa là ràng buộc tưởng chặn việc gỡ hoá ra là một lỗi có sẵn — gỡ file
  không làm gãy gì mới, mà còn ép phải sửa cái lỗi đã ẩn từ lâu.
- **Prevention:**
  1. Trước khi gỡ/xoá thư mục dữ liệu, quét **CẢ CÂY** — đừng tự chọn tay danh sách thư mục, đó là
     cách bỏ sót. Muốn nhanh thì loại thư mục rác chứ đừng thu hẹp phạm vi:
     `grep -rn "reports/" . --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=.git`
     (hoặc `git grep -n "reports/"` — chỉ quét file đã track, nhanh nhất và không cần cờ loại trừ).
     Rồi tách kết quả làm ba: "ghi ra" (an toàn nếu có `mkdir(parents=True, exist_ok=True)`),
     "default của CLI" (an toàn, đè được bằng cờ), và "đọc lúc chạy/lúc import" — chỉ nhóm cuối mới
     chặn được việc gỡ.
  2. `git rm --cached` (giữ file trên đĩa) là mặc định đúng khi gỡ tài sản còn dùng ở nơi khác. Chỉ
     `git rm -r` khi chắc chắn không cần bản làm việc. Cả hai đều lấy lại được từ lịch sử git.
  3. Dữ liệu bị gitignore mà test cần → guard `pytest.skip(..., allow_module_level=True)` ngay tại
     module, không để `FileNotFoundError` giữa fixture.

## 2026-08-24 - Ba danh sách định dạng lệch nhau: "hỗ trợ" là khả năng đọc được, không phải một dòng `if`

- **Bối cảnh:** thêm `.pptx .xlsx .rtf .odt .odp .epub .mobi .fb2 .xps` vào luồng upload, sửa `.html`,
  và mở `.csv/.json` (vốn đã chạy được) ra cho người dùng.
- **Root cause của mớ lộn xộn:** cùng một câu hỏi "đọc được đuôi nào" được trả lời ở BA nơi và không
  nơi nào biết nơi kia: `FE/.../DocumentList.jsx` (`accept`, 4 đuôi), `document_loader.
  SUPPORTED_LC_EXTENSIONS` (8 đuôi), `markdown_convert.to_markdown` (9 đuôi, tập khác). Hậu quả đo
  được: `.csv`/`.json` đọc tốt nhưng người dùng không chọn được; `.html` có nhánh `if` đàng hoàng
  nhưng gọi `unstructured` — gói chưa từng nằm trong `requirements.txt` — nên rỗng 100%. Một dòng
  `if ext == ".html"` trông y hệt như hỗ trợ thật.
- **Cách chữa:** `app/domains/ingest/formats.py` là nguồn sự thật duy nhất, chia nhóm theo BỘ ĐỌC
  (`TEXT`, `PYMUPDF`, `WORD`, `PPTX`, `XLSX`, `OPENDOCUMENT`, `WEB`, `DATA`, `RICH_TEXT`, `IMAGE`)
  chứ không phải một tập phẳng — thêm đuôi mới thì bỏ vào đúng nhóm, dispatch có sẵn. Module cố ý
  không import gì nặng để `main.py` nạp được. Test khoá cả ba mặt: chuỗi `accept` của FE phải bằng
  đúng `SUPPORTED_EXTENSIONS`, mỗi đuôi chỉ thuộc một nhóm, và mỗi bộ đọc phải đọc ra chữ từ file
  sinh tại chỗ.
- **Điều học được về việc mở rộng định dạng:** leo thang từ rẻ tới đắt trước khi thêm dependency.
  PyMuPDF đã cài **mở native cả EPUB/MOBI/FB2/XPS** — bốn định dạng miễn phí, chung một vòng lặp
  theo trang với PDF. `markdownify` đã cài, đủ cho HTML. Chỉ `.pptx/.xlsx/.rtf` mới đáng thêm gói
  (`python-pptx`, `openpyxl`, `striprtf` — đều thuần Python, phụ thuộc lxml/Pillow đã có).
  `.odt/.odp` nhờ `soffice` đổi sang OOXML rồi dùng lại loader có sẵn, 0 dep.
- **Prevention:**
  1. Một ràng buộc đầu vào chỉ được định nghĩa MỘT nơi. Nếu FE cần biết, hoặc gọi API lấy, hoặc
     hardcode kèm **test khoá hai bên bằng nhau** — đừng để hai danh sách tự sống.
  2. `accept` của `<input type="file">` không phải kiểm tra bảo mật. Cổng chặn thật đặt trong hàm
     dùng chung ở backend, TRƯỚC khi ghi đĩa/Storage/DB.
  3. Mỗi định dạng khai là "hỗ trợ" phải có test đọc file thật sinh tại chỗ. Không có test thì
     `except Exception: pass` sẽ giấu một dependency thiếu suốt nhiều tháng.
  4. Định dạng cần nhị phân ngoài (`soffice` cho `.doc/.odt/.odp`, `tesseract` cho ảnh) chỉ chạy
     khi máy có nó. Máy dev hiện tại KHÔNG có cả hai — chấp nhận rơi về `extract_text` chứ đừng
     tưởng là đã chạy.

## 2026-08-24 - Dán ảnh vào chat: để ảnh thành CHỮ trước cổng pipeline, đừng luồn ảnh qua graph

- **Bối cảnh:** cho phép dán ảnh đề bài vào khung chat để hỏi. Ba kiến trúc khả dĩ:
  (1) mô hình thị giác đọc ảnh ra chữ, chữ ghép vào câu hỏi, `/query` chạy y như cũ;
  (2) mô hình thị giác trả lời trực tiếp với chunk đã truy hồi, ảnh đi cùng state;
  (3) lai — đọc chữ để truy hồi, đưa ảnh lại ở node sinh câu trả lời.
  Chọn (1).
- **Vì sao (1) thắng:** ranh giới nằm TRƯỚC cổng QUERY_GRAPH. Retrieval, RRF, rerank, NLI,
  HITL, trích dẫn, cache, streaming đều không cần biết ảnh tồn tại — không một node nào đổi
  chữ ký. Cách (2) bắt `q` mang theo blob qua khoá cache, qua checkpoint của HITL, qua SSE:
  mọi chỗ đó đều giả định state tuần tự hoá được và nhỏ. Nâng lên (3) sau vẫn dễ vì chỉ chạm
  node cuối, còn đi (2) trước rồi lùi thì phải gỡ ngược khắp graph.
- **Ba cái bẫy đo được ở tầng model:**
  1. Model chỉ biết chữ KHÔNG luôn báo lỗi khi nhận `images`. `qwen2.5:7b-instruct` trả HTTP
     400 (tốt), nhưng `gemma4:e4b` khai `capabilities: [..., "vision", ...]` mà vẫn đáp "hãy
     gửi ảnh cho tôi" — nhận tham số, phớt lờ nội dung. Nghĩa là cờ capabilities chỉ đủ để ẨN
     nút trên giao diện, không đủ để tin. Chỉ gọi thật mới biết.
  2. Model có `thinking` mà không đặt `think: False` thì toàn bộ ngân sách token rơi vào
     trường `thinking` và `content` về RỖNG. Lúc dò đầu tiên tao tưởng model mù, hoá ra chỉ là
     đọc nhầm trường.
  3. `/api/generate` với `images` cho kết quả rỗng ở model mới; `/api/chat` với
     `messages[].images` thì chạy. Đường API cũng là một biến, không chỉ model.
- **Prevention:**
  1. Khả năng phụ thuộc mô hình phải có endpoint trạng thái riêng (`GET /api/vision/status`)
     để FE ẩn lối vào, VÀ mã lỗi phân biệt được: 503 cho "máy chưa có mô hình" khác hẳn 500
     cho "code hỏng". Trộn hai cái thì không ai biết nên pull model hay đọc traceback.
  2. Chữ mô hình đọc từ ảnh phải HIỆN cho người dùng xem lại được (khối gập trong bong bóng
     tin). Đọc sai là kiểu hỏng số một; giấu nó đi thì câu trả lời lệch trông như model dốt
     chứ không phải như ảnh mờ.
  3. Ảnh hỏi-một-lần và ảnh làm-tài-liệu là hai đường khác nhau. Đường chat KHÔNG tạo dòng
     `documents`, không ingest — có test khoá đúng điều đó (`test_khong_tao_tai_lieu`).

## 2026-08-24 - Bố cục ba cột: gáy sách thay cho nút nổi, và chụp màn hình bắt được thứ đọc code không thấy

- **Bối cảnh:** hai cột bên chỉ đóng mở được dưới breakpoint `md`. Từ 768px trở lên chúng đứng cứng
  ở 252px và 326px — trên laptop 1366px khung đọc chỉ còn ~700px và không nới được. Thêm: thu gọn
  trên màn rộng, kéo đổi bề rộng, và gập khối "Tạo từ tài liệu" trong cột phải.
- **Quyết định hình thức:** cột thu gọn KHÔNG biến mất sau một nút nổi mà trở thành **gáy sách** —
  dải dọc 34px mang tên panel đặt bằng `writing-mode: vertical-rl`. Lý do: đây là "phòng đọc", thứ
  bị đẩy sang bên của một bàn đọc vẫn phải nhìn thấy và đọc được, không phải đoán bằng biểu tượng.
  Tên đặt dọc nên dải hẹp mà vẫn mang chữ thật.
- **Ba thứ chỉ CHỤP MÀN HÌNH mới thấy, đọc code không thấy:**
  1. Thanh kéo tự vẽ vạch, cộng với `border-r` sẵn có của `<aside>` thành **đường đôi 2px**. Sửa:
     ở chế độ màn rộng bỏ border của aside, thanh chia CHÍNH LÀ đường kẻ.
  2. Chữ gợi ý trong ô nhập tao viết dài thêm ("…dán ảnh đề bài vào đây…") xuống dòng trong ô cao
     46px rồi **bị xén mất nửa dòng dưới** ở 390px và 320px. CSS không đổi được nội dung
     `placeholder`, nên phải nghe `matchMedia("(min-width: 640px)")` và đổi câu theo bề rộng.
  3. Hai gáy sách đọc ngược chiều nhau vì tao xoay 180° cái bên phải cho "giống gáy sách thật".
     Nhìn vào thì lệch chứ không tinh tế. Bỏ xoay.
- **Prevention:**
  1. Việc thiết kế phải NHÌN, không suy luận. Cài playwright rồi chụp ở 320/390/1024/1366/1920 tốn
     vài phút, rẻ hơn nhiều so với đẩy một bố cục xén chữ. Chụp riêng vùng cần soi (`clip=`) thay
     vì cả trang — ảnh nhỏ, nhìn rõ chi tiết hơn.
  2. Tương tác phải kiểm bằng kịch bản, không bằng mắt: kéo, kéo quá tay để thử kẹp biên, mũi tên
     bàn phím, Enter đặt lại, thu gọn, TẢI LẠI, bung ra. Chính bước "tải lại" mới lòi ra bug mất
     trạng thái (xem `known-issues.md`) — nếu chỉ chụp ảnh tĩnh thì không bao giờ thấy.
  3. Thanh chia kéo được phải là `role="separator"` + `aria-orientation="vertical"` +
     `aria-valuenow/min/max`, và phải dùng được bằng bàn phím. Kéo chuột là lối tắt, không phải lối
     duy nhất.
  4. Kéo phải gắn listener trên `window`, không phải trên tay cầm: con trỏ chạy nhanh hơn re-render
     nên nó rời khỏi tay cầm giữa chừng và thao tác "tuột".

## 2026-08-24 - Cấu hình trỏ sai không bao giờ nổ: nó chỉ làm mọi phép đo sai thầm lặng

- **Chuỗi sự việc:** đi tìm 198 giây "im lặng" trên đường RAG → mở `BE/logs.sqlite` → thấy bản ghi
  mới nhất là 2026-08-11 → kết luận hụt rằng "không có instrumentation, phải tự thêm". Đọc kỹ
  `logger.log_db_path()` mới thấy nó neo theo `DATA_DIR`, và `DATA_DIR` đang trỏ sang
  `MemVid_New/BE` — thư mục của dự án khác. File log thật nằm ở đó, đầy đủ, và trả lời câu hỏi
  trong một truy vấn SQL: `VerifyContext` chạy **197 691 ms**, chiếm 88% toàn bộ truy vấn.
- **Root cause của việc suýt làm sai:** hai lần liên tiếp tao định KẾT LUẬN từ chỗ vắng dữ liệu.
  Lần một: "log trống nghĩa là không có logging". Lần hai (trước đó): "job `interrupted` nghĩa là
  pipeline chết". Cả hai đều sai, và cả hai đều là suy diễn từ sự vắng mặt thay vì truy tới nguồn.
- **Prevention:**
  1. Dữ liệu vắng mặt KHÔNG phải bằng chứng. Trước khi kết luận "tính năng này không tồn tại", truy
     xem đường dẫn/khoá/cờ nào quyết định nơi nó xuất hiện. Ở đây chỉ cần đọc thêm 5 dòng
     `log_db_path()` là ra.
  2. Mọi biến cấu hình trỏ đường dẫn (`DATA_DIR`, `LOG_DB_PATH`, `MD_DIR`, `USERS_DB_PATH`) phải
     được IN RA lúc khởi động. Trỏ sai không gây exception — app vẫn upload được, hỏi được, trả lời
     đúng — nên không có tín hiệu nào khác ngoài việc tự in ra. Đã thêm cảnh báo khi `DATA_DIR` nằm
     ngoài `BE_ROOT`.
  3. Chép trạng thái SQLite phải kèm `-wal` và `-shm`. Chỉ chép `.sqlite` là mất phần ghi chưa
     checkpoint, và mất im lặng.
  4. Trước khi ghi đè thư mục dữ liệu: sao lưu bên đích, và KHÔNG xoá bên nguồn. Bên nguồn còn
     nguyên là bản lui thật sự, thư mục `_backup-*` chỉ là lớp đệm.
- **Số đo thu được nhờ tìm ra chỗ đúng (truy vấn RAG 225s):**
  | Node | ms | % |
  |---|---|---|
  | VerifyContext (NLI mDeBERTa) | 197 691 | 88% |
  | RerankDocuments (bge-reranker) | 18 327 | 8% |
  | GenerateAnswer (LLM sinh chữ) | 7 427 | 3% |
  | RetrieveFAISS | 727 | 0.3% |
  | CheckSources + CacheLookup + GradeDocuments + ContextBuilder | < 30 | ~0% |
  Khâu sinh câu trả lời chỉ chiếm 3%. `NLI_TIMEOUT_SEC=90` nhưng node chạy 197s — hạn đó rõ ràng
  không phải hạn cho cả node. Đây là chỗ mổ tiếp.

## 2026-08-25 - Chấp nhận trôi extraction: bốn tầng provenance đóng băng, mỗi tầng một hàng rào

- **Việc:** PyMuPDF phiên bản hiện tại đặt dấu tổ hợp `U+0338` lệch một vị trí so với lúc đóng băng
  dataset (`Eval ̸= optional` thành `Eval̸ = optional` — cùng hiển thị "Eval ≠ optional", khác biệt
  rỗng về ngữ nghĩa). Người dùng quyết định CHẤP NHẬN và cập nhật dữ liệu cho khớp.
- **Bốn hàng rào chặn lần lượt, mỗi cái ở một tầng khác nhau:**
  1. `index_builder`: `canonical extraction changed after coordinate bridge`
  2. `bridge_imported_spans`: `evidence source unit does not exist` — vì tao đưa span ở dạng ĐÃ
     bridge; nó cần dạng TRƯỚC bridge (dựng lại từ các trường `source_*` mà span vẫn giữ).
  3. `canonical/source-unit text mismatch` — `source_units.jsonl` cũng đóng băng text trang 71.
  4. `reviewed evidence does not match source-unit boundary` — `source_evidence_text` của span là
     text người duyệt đã đọc, cũng phải khớp.
- **Cách làm tối thiểu (KHÔNG dựng lại cả candidate package — làm thế sẽ phá
  `candidate_package_hash` mà `review.py` đang kiểm):**
  - vá đúng MỘT ký tự trong `source_units.jsonl` (unit trang 71) + hash lại;
  - vá `source_evidence_text` + hash của ĐÚNG span `R17_s01`;
  - rồi để `bridge_imported_spans` của chính dự án sinh lại `canonical_documents.jsonl` và toàn bộ
    89 span. Không tự tay sửa canonical hay `coordinate_bridge`.
  - Kết quả: bridge OK 89 span / 3 record, `validate_canonical_span` 89/89 đạt.
- **Prevention:**
  1. Sửa dữ liệu nghiên cứu thì SAO LƯU TRƯỚC (`_backup-<timestamp>/` trong chính thư mục dataset)
     và vá ở tầng NGUỒN nhất, rồi để công cụ của dự án sinh lại các tầng dẫn xuất. Tự tay sửa tầng
     dẫn xuất sẽ để lại hash không nhất quán mà không hàng rào nào bắt được.
  2. `coordinate_bridge.canonical_text_sha256` là hash CẤP TÀI LIỆU (chung cho mọi span của tài
     liệu đó), không phải cấp đơn vị — kiểm trước khi đoán phạm vi ảnh hưởng.
  3. Chuỗi hàng rào này là TÍNH NĂNG, không phải phiền hà. Nó ép mọi bản ghi text mà con người từng
     đọc phải khớp với text máy đang dùng. Đừng lách bằng cách sửa `status` thành `frozen`.

## 2026-08-25 - GPU nằm ngay đó mà torch không chạm được: hai lớp chặn, cả hai đều cố ý

- **Phát hiện:** máy có **RTX 4050 Laptop 6GB**, nhưng `torch 2.5.1+cpu` — bản CPU-only, `CUDA build
  None`. Toàn bộ ablation chạy CPU: NLI 298 giây/truy vấn, cả thang E4–E7 ước 12–15 giờ.
- **Hai lớp chặn, cả hai đều là quyết định ĐÚNG cho môi trường của nó:**
  1. `requirements.txt:54` ghim `torch==2.5.1+cpu` với comment "tránh kéo CUDA toolkit trong
     Docker". Đúng cho ảnh Docker và máy chủ không GPU.
  2. Thiết bị ghim cứng `"cpu"` ở `llm_factory.get_embeddings` và `late_chunk`; còn `nli.py` KHÔNG
     đặt gì — mà `transformers` không tự chuyển model sang GPU, nên nó luôn ở CPU dù có card.
- **Bài học chính:** một lựa chọn đúng cho triển khai có thể là cái giá đắt ở máy phát triển, và
  vì nó KHÔNG gây lỗi nào nên không ai để ý. Giống hệt `DATA_DIR` trỏ sai và `content_hash` nghẹn
  thư mục: hệ thống chạy đúng, chỉ là chậm gấp 30 lần hoặc đo nhầm chỗ.
- **Cách làm đã chọn:** `shared/device.py::torch_device()` là nguồn sự thật duy nhất, mặc định
  `cpu` (KHÔNG đổi hành vi ở đâu cả), đổi bằng `TORCH_DEVICE`. Bốn chỗ trước đây tự quyết nay đều
  hỏi hàm đó. `requirements.txt` GIỮ NGUYÊN `+cpu` — torch CUDA cài riêng vào venv của máy dev.
- **Prevention:**
  1. Xin `cuda` mà torch không thấy CUDA thì **kêu MỘT lần rồi lùi về CPU**, không ném. Im lặng
     lùi về CPU là cách nhanh nhất để một lần chạy chậm gấp 30 lần mà không ai biết vì sao — đúng
     cái bẫy đã mất nhiều giờ ở `DATA_DIR`.
  2. `transformers` KHÔNG tự `.to(device)`. Đặt biến môi trường mà quên dòng đó thì model vẫn nằm
     CPU và tưởng là GPU không giúp gì. Tensor đầu vào cũng phải cùng thiết bị với model.
  3. `sentence_transformers.CrossEncoder` thì NGƯỢC LẠI — nó TỰ dò CUDA. Không nói rõ `device=` thì
     nó có thể lên GPU trong khi các model khác ở CPU: tốn VRAM ngoài dự tính và số đo không tái
     lập được. Phải đặt tường minh cả khi muốn CPU.
  4. In thiết bị lúc khởi động (`TORCH_DEVICE: cpu (torch 2.5.1+cpu, CUDA build cpu-only, ...)`).
     Cùng lý do với `DATA_DIR`: cấu hình trỏ sai không bao giờ tự báo.
- **Ràng buộc VRAM đã tính trước:** bge-m3 ~2.3GB + bge-reranker ~2.2GB + mDeBERTa ~1.1GB ≈ 5.6GB
  trên card 6GB. Ollama (qwen 4.7GB) KHÔNG ở chung được — cách chia hợp lý là model HF lên GPU,
  Ollama giữ CPU, vì sinh chữ chỉ chiếm 3% thời gian còn NLI+rerank chiếm 96%.

## 2026-08-26 - Trung bình phải mang theo mẫu số: câu không có nhãn vàng KHÔNG phải câu trả lời sai

Bộ truy vấn có 30 câu nhưng chỉ 25 câu gán được chunk vàng. Năm câu còn lại (V11–V15)
là **bẫy cố ý**: `gold_status` của chúng là `insufficient_evidence` (4 câu) hoặc
`ambiguous` (1 câu) — tài liệu KHÔNG chứa câu trả lời, và hành vi đúng của hệ thống là
từ chối. Không có chunk vàng để gán, nên `retrieval_metrics` trả recall 0 và tầng gộp
cộng cả năm số 0 vào trung bình.

Kết quả: mọi chỉ số truy hồi trong `aggregate_metrics.json` thấp hơn sự thật ~14 điểm
phần trăm (`E0_bm25_R1` 0.6976 thay vì 0.8371). Không có exception, không có cảnh báo.
Đây là dạng sai nguy hiểm nhất trong đo đạc: **con số vẫn hợp lý**, chỉ là sai.

Ba điều rút ra:

1. **Không có gì để truy hồi thì không thể trượt.** Câu không trả lời được phải đo
   bằng thước khác — tỷ lệ TỪ CHỐI — chứ không phải recall. Nhét chúng vào mẫu số
   recall là chấm hệ thống điểm liệt cho đúng cái việc mình muốn nó làm. Loại khỏi
   mẫu số, và nói rõ đã loại câu nào.
2. **`mean` trần trụi là số nửa vời.** Ghi kèm `n_queries` / `n_scored` / `n_no_gold` /
   `no_gold_query_ids` để việc loại trừ nhìn thấy được từ chính file kết quả, không phải
   một quy ước ngầm nằm trong đầu người chạy. Người đọc luận văn sáu tháng sau (kể cả
   chính mình) không đọc được quy ước ngầm.
3. **Đừng chạy lại nhiều giờ chỉ để đổi phép trung bình.** Dữ liệu từng truy vấn đã nằm
   trong `retrieval.jsonl`; thứ sai là bước gộp. `BE/scripts/tinh_lai_aggregate.py` bù
   cột `n_relevant` rồi tính lại — 14 run trong vài giây, khớp từng chữ số với bảng đã
   công bố. Tách "đo" khỏi "gộp" để sửa được gộp mà không đụng đo.

Liên quan: [[chay-thang-E-tren-GPU]] — bảng số E0–E3 trong `docs/KET_QUA_THUC_NGHIEM.md`
vốn đã tính tay theo n=25, nên bảng KHÔNG đổi; thứ đổi là harness giờ tự làm đúng.

## 2026-08-26 - GPU 6 GiB không đủ cho cả torch lẫn Ollama: chọn bên nào được lợi 600 lần

RTX 4050 Laptop có 6.0 GiB. Ba model torch nạp cùng lúc đã ăn **5.21 GiB** đỉnh
(bge-m3 2.3 + reranker 2.1 + mDeBERTa 0.55, fp32). qwen2.5:7b-instruct cần 4.68 GiB.
Không thể cùng ở trên GPU — phải chọn.

Đo trước khi chọn, cả hai chiều:

| | CPU | GPU | lợi |
|---|---|---|---|
| NLI mDeBERTa | ~298 s/truy vấn | 0.50 s / 3 cặp | ~600× |
| rerank 20 cặp | 9.52 s | 1.49 s | 6.4× |
| sinh qwen2.5:7b | 9.1 tok/s | 27.3 tok/s | 3× |

Đưa torch lên GPU và đẩy Ollama xuống CPU: mất ~22 s mỗi truy vấn ở khâu sinh, đổi lại
bỏ được ~298 s mỗi truy vấn ở khâu NLI. Cho E4–E7 × 30 câu: **~10 giờ xuống ~1 giờ**.
Chiều ngược lại (giữ Ollama trên GPU) tiết kiệm 45 phút và trả giá 10 giờ.

Bài học không phải "GPU nhanh hơn" mà là: **tăng tốc thứ đang chiếm phần lớn thời gian,
không phải thứ dễ thấy nhất.** Sinh câu trả lời là thứ người dùng nhìn thấy chạy chậm,
nên bản năng là tăng tốc nó. NLI chạy im lặng trong nền và ăn 92% thời gian.

Thứ tự nạp tự lo phần còn lại: pipeline chạm rerank/NLI TRƯỚC khi chạm bộ sinh, nên
torch giành VRAM trước và bộ lập lịch của Ollama tự thấy hết chỗ rồi tự đẩy layer xuống
CPU. Không cần ép `num_gpu: 0`. Chỉ cần `ollama stop <model>` trước khi chạy để nó
không giữ chỗ sẵn từ phiên trước.

Giữ fp32 dù fp16 tiết kiệm ~1.4 GiB: E0–E3 trên R1 đã chạy fp32 (trên CPU), đổi dtype
giữa chừng là thêm một biến không kiểm soát vào đúng cái thang đang so sánh.

## 2026-08-26 - Đọc 170 ký tự đầu rồi gán nhãn: lời cải chính nằm ở câu CUỐI

Chấm tay 40 câu trả lời cho 5 truy vấn bẫy (không trả lời được). In 170 ký tự đầu mỗi
câu, đọc, gán nhãn "có từ chối / không từ chối". Kết luận rút ra: "V11, V12, V13 không
nấc nào từ chối".

Sai. Bộ chấm LLM đọc TOÀN VĂN cho ra số khác, và tao đã kết luận vội là **nó** hỏng —
"đếm nhầm câu rào giữa bài là từ chối". Đọc lại nguyên văn thì hoá ra ngược lại: câu
trả lời của E4/E5 dài 1000–1250 ký tự, trả lời đầy đủ, rồi **câu cuối cùng** mới viết
"Tuy nhiên, trong tài liệu cung cấp, không có thông tin cụ thể về...". Lời cải chính
nằm ngoài cửa sổ 170 ký tự. Bộ chấm đúng, tao sai — hai lần: sai nhãn, rồi sai cả khi
đổ lỗi cho bộ chấm.

Ba điều rút ra:

1. **Cắt ngắn để đọc là một phép đo, và phép đo đó có sai số.** Cắt ở đầu bài giả định
   thông tin quyết định nằm ở đầu bài. Với văn bản do LLM sinh, giả định đó SAI theo
   một hướng có hệ thống: model được huấn luyện để trả lời trước, dè dặt sau. Muốn xem
   nhanh thì in **cả đầu lẫn đuôi**, đừng chỉ đầu.
2. **Khi cách đo tự động lệch với cách đo tay, đừng mặc định cách tay đúng.** Trước đó
   trong cùng phiên, một regex đã chấm sai thật (bắt "không nhất quán" thành từ chối),
   nên khi bộ chấm LLM lệch tiếp, phản xạ là quy cho nó. Cách duy nhất phân xử: mở
   nguyên văn ra đọc. Mất 2 phút, đảo ngược một kết luận đã viết vào tài liệu.
3. **Nhị phân là sai khung.** Không phải "từ chối / không từ chối" mà ba nhóm: từ chối
   sạch · trả lời rồi rút lại · trả lời hẳn. Nhóm giữa mới là phát hiện đáng giá: các
   tầng trên E3 không dạy hệ thống im lặng, chúng dạy nó **nói xong rồi cải chính** —
   vô dụng với người đọc dừng ở đoạn đầu. Ép hai nhóm vào một nhãn là xoá mất kết quả.
   Số của hai cách chấm khớp tuyệt đối khi hiểu đúng: `tự động = sạch + rút lại`.

Liên quan: [[trung-binh-phai-mang-theo-mau-so]] — cùng một dạng lỗi, dùng sai thước rồi
đọc ra kết luận về hệ thống.

## 2026-08-26 - Hai mức song song phải hỏi nhau, đừng để hai biến env "tự khớp"

Mindmap enrich chạy 2 nhánh song song (`MINDMAP_ENRICH_PARALLEL=2`). Cổng LLM
in-process cho 1 lời gọi một lúc (`MAX_CONCURRENT_LLM_CALLS=1`). Hai con số này nằm ở
hai file khác nhau, do hai người khác nhau đặt, vì hai lý do khác nhau — và không ai
sai riêng lẻ. Ghép lại thì nhánh thứ hai xếp hàng, chờ quá 180 giây rồi ném
`LLM busy (in-process)`.

Ba điều rút ra:

1. **Song song nhiều hơn tầng dưới cho phép không nhanh hơn — nó HỎNG.** Không phải
   chậm hơn, không phải xếp hàng êm: bên thua chờ đủ timeout rồi ném lỗi, và lỗi đó
   bị nuốt thành cờ `degraded`. Kết quả là một sơ đồ rỗng kèm trạng thái `done`.
2. **Cách sửa đúng là DẪN XUẤT, không phải đồng bộ.** Đặt `MINDMAP_ENRICH_PARALLEL=1`
   cho khớp là sửa triệu chứng: ai đó chỉnh cổng LLM lên 4 tháng sau là lệch lại.
   `llm_factory.inproc_slots()` phơi số slot ra, `_enrich_parallel()` kẹp theo nó.
   Một nguồn sự thật, không cấu hình nào tự mâu thuẫn được nữa.
3. **Lỗi sát mép là loại tệ nhất.** Chạy enrich riêng lẻ, nhánh 2 chờ **179 giây**
   rồi lọt — thiếu đúng 1 giây là hỏng. Nên nó "lúc được lúc không" tuỳ máy bận, và
   người dùng báo "khi thì ra khi thì không" thay vì một lỗi tái hiện được. Thấy một
   con số đo được nằm trong vòng 5% của một ngưỡng timeout thì coi như đã hỏng, đừng
   coi là đã qua.

## 2026-08-26 - Config chết trông y hệt config sống

`.env` có 14 biến `MINDMAP_*` mà không dòng code nào đọc: `MINDMAP_TIMEOUT_SEC`,
`MINDMAP_MODEL_QUALITY`, `MINDMAP_MAX_NODES`, `MINDMAP_JOB_TIMEOUT_*`... Tên đúng
quy ước, giá trị hợp lý, có chú thích tiếng Việt tử tế phía trên. Không cách nào
phân biệt với 4 biến thật nếu không grep.

Tác hại không phải là thừa vài dòng. Là **hướng người sửa lỗi đi sai đường**: gặp
mindmap chậm, mở `.env`, thấy `MINDMAP_TIMEOUT_SEC=240`, chỉnh lên 600, chạy lại,
vẫn chậm — và giờ tin rằng "đã thử tăng timeout rồi, không phải do timeout".

Quy tắc từ nay: biến env chỉ được nằm trong `.env.example` khi có **một file mã
nguồn đọc nó**. Khi gỡ, để lại một khối chú thích nói rõ biến nào sống và file nào
đọc — người sau đọc `.env` sẽ tự định hướng được thay vì phải grep lại từ đầu.

Liên quan: [[cau-hinh-tro-sai-khong-bao-gio-no]] — cùng họ, cấu hình sai không gây
lỗi, chỉ làm mọi thứ lệch âm thầm.

## 2026-08-26 - `submit()` là "chạy ngay": báo tiến trình phải đặt TRƯỚC nó

Vá chỗ enrich im lặng 166 giây bằng một dòng `progress_cb(30, "nhánh 1/3...")`. Đặt
nó ngay **sau** `futs = {ctx_submit(ex, _run, b): b for b in branches}` — nhìn thì
hợp lý: "submit xong rồi báo là đang chạy".

Sai. `submit()` không xếp hàng chờ ai gọi; worker thread bắt đầu chạy **ngay trong
lúc** dict comprehension còn đang dựng. Với `max_workers=1` thì thread đó có thể vào
tới lời gọi LLM trước khi luồng chính kịp chạy dòng `progress_cb`. Kết quả: vẫn im
lặng, nhưng bây giờ im lặng **không tất định**.

Test bắt được, và cách nó bắt mới là điều đáng nhớ: chạy riêng thì XANH, chạy chung
với `llm_factory` thì ĐỎ, tỷ lệ 2/3. Phản xạ đầu tiên là đổ cho ô nhiễm giữa các test
(và có ô nhiễm thật — fixture ghi thẳng `os.environ`, đã sửa riêng). Nhưng dọn ô
nhiễm xong vẫn đỏ. Thứ `pytest-randomly` làm không phải là gây lỗi mà là **đổi thứ
tự chạy đủ nhiều để một cuộc đua lộ ra**.

Hai điều rút ra:

1. **Mốc thời gian phải đặt trước hành động, không phải sau.** "Bắt đầu X" báo trước
   khi khởi động X. Đặt sau là mở một cửa sổ đua đúng bằng thời gian giữa hai dòng.
2. **Test nhấp nháy không phải phiền toái — nó là kết quả đo.** Ở đây nó chỉ thẳng
   vào một lỗi thật trong chính bản vá vừa viết. Đánh dấu `flaky` rồi bỏ qua là vứt
   đi phát hiện duy nhất mình có.
## 2026-09-02 - Bản đồ nhúng nuốt con lăn: trang cuộn được mà người dùng không chạm tới được

- **Triệu chứng người dùng mô tả là "trang chết cứng", nhưng trang KHÔNG hỏng.**
  `StudyShell` có `overflow-y-auto`, DOM cuộn được bình thường. Thứ hỏng là **đường đi
  của sự kiện**: `react-d3-tree` gắn d3-zoom lên `<svg>`, d3-zoom nghe `wheel` rồi
  `preventDefault`, và canvas cao `min(70vh, 640px)` nên con trỏ gần như luôn nằm trên
  nó. Mọi cú lăn bị lấy mất để phóng cây.

- **Đừng tìm lỗi cuộn ở thuộc tính CSS trước.** Phản xạ đầu tiên là grep
  `overflow-hidden` / `h-screen` — và ở đây phản xạ đó dẫn sai đường: `MainLayout` có
  `h-screen overflow-hidden` trông rất đáng ngờ, nhưng trang StudyMap **không nằm trong**
  MainLayout (route độc lập trong `App.jsx`). Kiểm cây route trước khi kết tội bố cục.

- **Ba tầng phải phân biệt khi gỡ lỗi cuộn:** (1) DOM có vùng cuộn không; (2) vùng cuộn
  có cao hơn cha không; (3) **có ai nuốt sự kiện không**. Tầng ba là tầng hay bị bỏ qua
  nhất, và là tầng duy nhất mà DevTools "Elements" không cho thấy.

- **Cuộn thuộc về TRANG; phóng bản đồ phải là chủ ý.** Luật này có ở mọi bản đồ nhúng
  (Google Maps, Figma) vì nó giải đúng xung đột: một vùng tương tác lớn nằm giữa một
  trang dài. Cách chặn: nghe `wheel` ở **pha capture** của thẻ bọc — capture chạy TRƯỚC
  listener trên phần tử con, nên `stopPropagation()` là đủ. **Không** gọi
  `preventDefault`: đó chính là thứ phải trả lại cho trình duyệt.

- **Đổi luật tương tác thì phải nói ra.** "Ctrl + lăn để phóng" không ai đoán được. Một
  dòng nhãn cạnh bản đồ là phần bắt buộc của bản sửa, không phải phần thêm cho đẹp. Và
  chỉ hiện ở khổ rộng — máy cảm ứng không có con lăn, câu đó vô nghĩa ở đó. (Lần đầu tôi
  viết nhầm thành `lg:hidden`, tức ẩn đúng chỗ cần hiện.)

- **Kho đã có bản sắc thì việc của mình là nắn, không phải thay.** `--brand-rgb: 178 58 46`
  là màu con dấu son, chữ đọc là `Spectral`, và comment trong mã gọi các vùng là "phòng
  đọc" / "kệ trái" / "gáy sách". Khi được yêu cầu "học theo app khác cho đẹp", lấy
  **pattern tương tác** (bản đồ nhúng, thanh hành động dính đáy, dấu hiệu còn nội dung)
  chứ đừng lấy **phong cách** — thay palette/font bằng thứ vay mượn là cách nhanh nhất
  biến một sản phẩm có giọng riêng thành một sản phẩm giống mọi sản phẩm khác.

## 2026-09-02 - Giả thuyết hợp lý + có số hậu thuẫn vẫn có thể sai; ba dòng đo đổi cả hướng sửa

- **Ca mẫu:** quiz ra 2/10, JSON của model bị cắt. Giả thuyết "output vượt trần
  `num_predict=3000`" giải thích được MỌI triệu chứng, và còn có sẵn một khối comment
  ngân sách token trong `generator.py` để hậu thuẫn. Đo ba mức (3/5/8 câu) mất ba phút:
  một câu tốn ~230 token nên 10 câu ≈ 2400 — **trong** trần; và ca hỏng lại là ca **ngắn
  nhất** (920 token). Giả thuyết sai. Nếu tin nó, tôi đã nâng `num_predict` hoặc cắt ngữ
  liệu — đánh đổi ngân sách để chữa một thứ không hỏng, rồi vẫn ra 2/10.

- **Dấu hiệu nhận ra giả thuyết sai loại này:** nó dự đoán quan hệ ĐƠN ĐIỆU (càng dài
  càng dễ hỏng) mà dữ liệu lại không đơn điệu (3 OK, 5 hỏng, 8 OK). Khi ba điểm đo không
  xếp thành một đường, nguyên nhân không phải cái thang mình đang đo.

- **Tầng parse thất bại: hỏi "còn cứu được gì không" trước khi vứt.** `repair_json_text`
  đòi một khối `{...}` cân bằng cho CẢ tài liệu, nên 2485 ký tự output — trong đó có
  những câu hỏi đã viết xong đàng hoàng — bị ném đi sạch. Một lượt gọi LLM là một phút
  CPU và một lần chờ của người dùng; `json.loads` hỏng không có nghĩa là mọi thứ trong
  chuỗi đó đều hỏng.

- **Quét cấu trúc lồng nhau thì dùng NGĂN XẾP, đừng dùng bộ đếm mức ngoài cùng.** Bản
  đầu của tôi chỉ gom object ở mức 0 — và khi output bị cắt thì object ngoài cùng KHÔNG
  BAO GIỜ đóng, nên kết quả luôn rỗng. Đúng thứ cần cứu nằm lồng bên trong cái không đóng
  được đó.

- **Test xanh không chứng minh module chạy được.** `cat >>` đẩy hai hàm mới xuống dưới
  khối `if __name__ == "__main__": demo()`; pytest xanh (nó import module) còn
  `python -m ...` thì `NameError`. Kho này có lệ `demo()` self-check đúng để bắt lớp lỗi
  đó — phải chạy nó, không chỉ chạy pytest.

- **Bảo model "đừng lặp" thì phải cho nó thấy TẤT CẢ những gì nó đã viết.** Lượt bù chỉ
  liệt kê câu được nhận (2), giấu 12 câu vừa bị loại — rồi ngạc nhiên vì model viết lại
  đúng 12 câu đó. Đây là thông tin thiếu ở phía mình, không phải model bướng.

## Tài liệu của nhà cung cấp không phải là hợp đồng — đo cái endpoint thật (2026-09-03)

**Ca mẫu:** thêm provider FPT AI. Spec tôi nhận ghi rõ, kèm nhãn "ĐÃ XÁC MINH", rằng
FPT bọc kết quả trong `data`: `body["data"]["choices"][0]["message"]["content"]`. Viết
parser đúng theo đó. Lần gọi thật đầu tiên `gpt-oss-120b` trả **hình dạng OpenAI phẳng**,
không có `data`.

**Root cause của lỗi khó thấy:** parser ném `RuntimeError`, vòng fallback bắt được rồi
chuyển sang Ollama. Tôi nhận một câu trả lời dài 389 ký tự và suýt ghi "FPT PASS" —
câu đó là của Ollama. Vòng fallback biến một lỗi tích hợp thành **thành công giả**:
người dùng vẫn thấy câu trả lời, log vẫn sạch, không ai biết FPT chưa từng chạy.

**Cách bắt:** ép danh sách provider xuống đúng một phần tử trước khi tin kết quả smoke
test — `OLLAMA_HOST=''` + `GEMINI_API_KEY=''` cho `PROVIDERS == ['fpt']`. Không còn
đường lui thì kết quả nói thật.

**Phòng ngừa:**
- Mọi smoke test một provider MỚI phải chạy với fallback bị cắt. Xanh khi còn fallback
  không chứng minh gì.
- Parser đọc CẢ HAI hình dạng (`data.choices` lẫn `choices`), có test cho từng cái —
  vì bên cung cấp có thể đổi lại bất cứ lúc nào và không ai báo.
- Thông báo lỗi ghi rõ đã thử những đường nào (`"đã thử cả data.choices lẫn choices"`),
  để lần sau đọc log là biết ngay chứ không phải đọc mã.

## Một cổng không đủ: `RERANK_BACKEND=fpt` mà `RERANK_ENABLED=0` thì vẫn là Identity (2026-09-04)

Đặt xong `RERANK_BACKEND=fpt` + `FPT_AI_RERANK_MODEL` trên production, kiểm lại bằng
cách chạy `get_reranker()` với "đúng env production" trên máy — ra `FptReranker`, xanh.
Nhưng bản sao env đó **thiếu một biến**: production có `RERANK_ENABLED=0`, còn mặc
định trên máy là `1`. `get_reranker()` kiểm `rerank_enabled` TRƯỚC khi nhìn tới
backend, nên production vẫn là `IdentityReranker`.

- **Bài học:** "sao y env production" phải lấy TỪ production, không phải liệt kê những
  biến mình nhớ là có liên quan. Biến làm hỏng là biến không nghĩ tới.
- **Cách bắt rẻ nhất:** đọc cả bảng env của service rồi so, thay vì set từng biến theo
  trí nhớ. Một lệnh gọi API thay cho một giả định.
- **Đo hai chiều mới là đo:** `RERANK_ENABLED=0 -> IdentityReranker`,
  `RERANK_ENABLED=1 -> FptReranker`. Chỉ chạy chiều mong đợi thì không phân biệt được
  "cấu hình đúng" với "may mà mặc định đúng".

## Số chiều không phải danh tính của một không gian vector (2026-09-04)

`BAAI/bge-m3` và `Vietnamese_Embedding` (bản fine-tune từ chính nó trên FPT
Marketplace) **đều 1024 chiều**. Hàng rào duy nhất trong `store._load_index` là
`idx.d != dim`. Nghĩa là đổi sang model kia thì index cũ nạp trót lọt, truy vấn chạy
bình thường, và kết quả là rác — không một dòng log nào.

Cùng lý do, chiến lược pool cũng nằm trong danh tính: cùng bge-m3 nhưng `mean_late` và
`encode` cho hai không gian khác nhau (đã có một buổi debug về đúng chuyện đó,
2026-09-01).

- **Hàng rào phải so BỘ BA** provider + model + strategy, ghi vào `__meta__` v1.2.
- **Thiếu metadata KHÔNG được mặc nhiên là tương thích.** Index 1.0 không ghi gì để
  so, nhưng vẫn kết luận được: provider `fpt` chưa tồn tại trong mã cho tới hôm nay,
  nên index ấy không thể do nó dựng. Đây là suy luận, không phải phỏng đoán — khác hẳn
  với "không biết thì cho qua".
- **Khoá cache phải mang danh tính.** `_vs_cache_key()` chỉ gồm mtime/size của file
  nên một vectorstore đã cache sống sót qua việc đổi cấu hình embedding: cache trả lời
  trước, hàng rào không bao giờ chạy. Hàng rào đặt sau cache là hàng rào không tồn tại.
- **Lệch thì TỪ CHỐI, không xoá.** Truy hồi rỗng là kết quả trung thực; truy hồi bằng
  vector của model khác thì không. Index là dữ liệu, dựng lại là quyết định của người
  vận hành.

## `text/event-stream` không khai charset → requests giải mã UTF-8 bằng latin-1 (2026-09-04)

Stream của FPT trả `content-type: text/event-stream` KHÔNG kèm charset. Theo mặc định
của HTTP, `requests` đặt `r.encoding = "ISO-8859-1"`, và `iter_lines(decode_unicode=True)`
dùng đúng giá trị đó: "Quang hợp" thành "Quang há»£p".

- **Chỉ đường stream dính.** Đường non-stream dùng `r.json()`, tự lo UTF-8 — nên test
  và smoke test của bản đồng bộ đều xanh trong khi bản stream hỏng.
- **Hỏng theo kiểu tệ nhất:** chữ vẫn ra, độ dài vẫn đúng, chỉ mất sạch dấu. Trên một
  ứng dụng tiếng Việt. Không exception nào để bắt.
- **Sửa:** ép `r.encoding = "utf-8"` trước khi `iter_lines`. Test regression phải mô
  phỏng CẢ luật giải mã của `requests` (đối tượng giả khởi tạo `encoding` là
  ISO-8859-1 rồi tự decode), nếu không nó xanh cả khi chưa sửa — đã kiểm bằng cách gỡ
  dòng sửa và thấy test đỏ.

## Hai đường gọi LLM song song thì sửa một đường không sửa được đường kia (2026-09-04)

Thêm provider FPT vào `ask_ai` xong, tưởng đã xong. `get_llm()` là một hàm KHÁC, và nó
hardcode `_ollama_chat_llm` với docstring ghi thẳng "luôn dùng Ollama local". Năm đường
production đi qua nó — trong đó có bộ sinh câu trả lời RAG của `/query`.

Hậu quả nhìn từ ngoài: quiz chạy được ở production, `/query` thì không. Cùng một ứng
dụng, hai kết cục, và không có gì ở tầng cấu hình để nhìn ra vì `Active providers:
['fpt']` vẫn in ra đúng.

- **Đếm số nơi trả lời cùng một câu hỏi.** Ở đây là ba: `llm_factory.PROVIDERS`,
  `shared.config._compute_providers`, `local_providers.ProviderPool`. Chỉ cái đầu được
  cập nhật; hai cái sau là mã chết nên không hỏng — hôm nay.
- **Test ràng chúng với nhau** rẻ hơn nhiều so với việc phát hiện lệch qua triệu chứng.

## Thẩm định phải chạy ĐÚNG loader của production, không phải một loader gần giống (2026-09-04)

Hàm thẩm định artifact index bản đầu mở `index.faiss` bằng `faiss.read_index`, so số
chiều, so số vector, so danh tính — nghe đủ. Nó bỏ sót `index.pkl` hoàn toàn, vì
`read_index` không cần file ấy.

Nhưng production nạp index bằng `FAISS.load_local`, và pickle hỏng chỉ lộ ra lúc hàm
đó giải mã. Nên một `index.pkl` hỏng đi lọt qua thẩm định, được **thăng cấp**, đè lên
index đang phục vụ, rồi mới hỏng: `load_vectorstore()` trả None, truy hồi tụt xuống
nhánh dự phòng, và lần ingest kế tiếp đè mất luôn index.

- **Bài học:** "đã kiểm" chỉ có nghĩa nếu kiểm bằng chính đường mà production đi. Một
  kiểm tra gần giống cho cảm giác an toàn ở đúng chỗ nguy hiểm nhất — ngay trước bước
  không lùi được.
- **Cách bắt:** test phải phá đúng file mà kiểm tra kia không đọc, rồi khẳng định vẫn
  bị từ chối. Test "artifact hợp lệ thì nạp được" xanh trong cả hai bản.
- **Nạp thử ở STAGING**, trước khi thăng cấp — hỏng thì index đang phục vụ chưa bị
  đụng tới.

## Cùng một cờ, ba lần chặn nhầm (2026-09-04)

`SKIP_MODEL_LOAD=1` nghĩa là "đừng nạp weight vào tiến trình này" — nó tồn tại vì
Render free có 512MB. Ba chỗ đã dùng nó như công tắc TẮT HẲN năng lực:

    rerank.get_reranker          -> Identity, kể cả khi backend là API từ xa
    llm_factory.get_embeddings   -> FakeEmbeddings, kể cả khi provider là FPT
    hybrid.retrieve_faiss_only   -> trả [] ngay dòng đầu

Cái thứ ba tệ nhất vì nó nằm thẳng trong đường truy hồi: bật FPT embedding, có index
hợp lệ, mà nửa FAISS của truy hồi lai vẫn im lặng biến mất — chỉ còn BM25, không lỗi
nào, không log nào. Chất lượng kết quả tụt mà không có triệu chứng nào để lần ra.

- **Dấu hiệu chung:** một cờ nói về TÀI NGUYÊN (RAM, đĩa, thời gian nạp) bị đọc như
  một cờ nói về TÍNH NĂNG. Mỗi lần thêm một provider từ xa, mọi chỗ đọc cờ ấy lại sai
  thêm một lần.
- **Cách tìm hết:** `grep SKIP_MODEL_LOAD` rồi hỏi từng chỗ "cái này chặn việc nạp,
  hay chặn việc dùng?". Hai lần đầu tôi sửa từng chỗ khi gặp; lần thứ ba mới nhận ra
  phải quét cả kho.

## Hai URL khác nhau không có nghĩa là hai database khác nhau (2026-09-04)

`BE/.env` có `DATABASE_URL` cổng 6543; production có cổng 5432. Nhìn qua là hai thứ
khác nhau, nên suốt nhiều tuần không ai hỏi lại. Supabase mở **cùng một database** ở
cả hai cổng — 6543 là transaction pooler, 5432 là session pooler. Bộ test đã tạo và
**xoá cứng** dữ liệu production suốt thời gian đó.

- **So sánh phải chuẩn hoá về thứ định danh, không phải chuỗi.** Đích của một kết nối
  DB là (host, tên database). Cổng là cách vào; user/mật khẩu là ai vào. Hai cái sau
  không được nằm trong danh tính — bản đầu của tôi đưa user vào và test bắt ngay: hai
  tài khoản khác nhau trỏ cùng một database sẽ lọt qua hàng rào.
- **Dấu hiệu để nghi ngờ:** một cấu hình "test" và một cấu hình "production" khác nhau
  ở đúng MỘT trường. Trùng hợp thì hiếm; hai bản sao của cùng một thứ thì thường.
- **Chỗ đáng tìm:** conftest KHÔNG ghi đè biến kết nối. Nếu bộ test không tự nói nó
  nối vào đâu, nó đang nối vào bất cứ đâu môi trường bảo.

## Sửa một hàng rào thì phải hỏi nó chặn được đường vòng nào (2026-09-04)

Thêm hàng rào "TEST_DATABASE_URL không được trùng DATABASE_URL" xong, tôi đặt CI cấp
cả hai biến trỏ vào cùng container ephemeral — và hàng rào sẽ chặn chính CI.

Cách sửa đúng không phải nới hàng rào, mà là **bỏ hẳn thứ để rơi về**: CI không đặt
`DATABASE_URL` ở mức job nữa, chỉ đặt cho hai bước không phải pytest. Không có gì để
rơi về thì không cần hàng rào nào bắt được đường rơi.

Nới hàng rào bằng một cờ "cho phép trùng" cũng chạy, nhưng nó tạo ra đúng cái công tắc
mà một ngày nào đó ai đó bật ở máy mình cho tiện.

## Nguồn gốc dữ liệu nằm ở trường server tự ghi, không ở trường người dùng đặt (2026-09-04)

Ba vòng trước tôi phân loại 11 tài liệu production bằng email chủ sở hữu, tên file và hình
dạng hành vi — rồi tự ghi vào bằng chứng rằng những thứ đó "không phải bằng chứng". Đúng,
và vì thế 5/11 kẹt ở AMBIGUOUS.

Thứ gỡ được nút không phải suy luận kỹ hơn mà là tìm ra một trường **client không chạm
được**: `metadata_json->>'input_path'` do handler upload ghi từ filesystem của chính tiến
trình đang chạy. Một dòng SQL trả lời xong câu hỏi mà ba vòng suy luận không trả lời nổi.

Cách nhận ra trường như vậy: hỏi "ai ghi giá trị này". Email, tên file, nội dung — người
dùng ghi. `input_path`, `created_at`, `file_size` — server ghi. Chỉ nhóm sau mới dùng để
truy nguồn gốc được.

Bài học phụ, đắt hơn: kết quả là **không hàng nào do production nạp**. Suốt mấy phase tôi
gọi nó là "DB production" và đi tìm xem tài liệu nào trong đó là thật. Câu hỏi đúng lẽ ra
phải hỏi từ đầu là "database này đã bao giờ nhận một lượt upload từ production chưa".

## "Database production" là một cái tên, không phải một phép đo (2026-09-04)

Suốt sáu phase tôi gọi một database là production vì `BE/.env` gọi nó thế. Hai phép đo
lật ngược cả hai nửa của cái tên đó:

- `metadata_json.input_path` cho thấy **không tài liệu nào** trong đó do service
  production nạp — nó là kho dev.
- Log đăng ký của Render cho thấy production **không còn ghi vào nó** từ 2026-09-03
  17:17 UTC — nên nó cũng không còn là database của production.

Cái tên sai theo cả hai chiều cùng lúc, và không phép suy luận nào từ trong kho mã phát
hiện được: cả hai câu trả lời đều nằm ở dấu vết vận hành (một cột do server ghi, một dòng
log HTTP), không nằm trong mã.

Bài học thao tác: khi một môi trường được xác định bằng một biến bí mật mà công cụ không
đọc được, đừng suy luận nó — hãy tìm một **sự kiện có mặt ở cả hai bên** rồi khớp dấu thời
gian. Hai lượt `register` khớp đến 0,27 giây chứng minh được nhiều hơn mọi lập luận về tên
host. Và khi cùng phương pháp ấy cho kết quả ngược ở một mốc thời gian khác, câu trả lời
đúng là "đã đổi", không phải chọn nửa nào mình thích.

## Vắng mặt chỉ là bằng chứng khi kho dữ liệu không xoá (2026-09-04)

Tôi kết luận "production đã đổi database" vì sáu lượt `register` trả 201 mà không thấy
hàng `users` nào. Kết luận đó sai, và cái sai không nằm ở phép đo — phép đo đúng: không
có hàng nào thật.

Nó nằm ở giả định ngầm rằng thứ gì được tạo thì còn đó. Database này đã xoá cứng khoảng
1.397 tài liệu trong vòng đời của nó, vì bộ pytest chạy thẳng vào đó nhiều tuần. Trong một
kho như thế, "không tìm thấy" là trạng thái mặc định của mọi hàng tạm.

Cách kiểm giả định đó rẻ hơn cả suy luận ban đầu: đếm số `document_id` từng xuất hiện
trong `jobs` (1401) so với số tài liệu còn sống (11). Một truy vấn, và nó lật ngược kết
luận.

Đối xứng đáng nhớ: cùng một phiên, bằng chứng KHẲNG ĐỊNH của tôi (hai lượt đăng ký khớp
đến 0,27 giây) đúng, còn bằng chứng PHỦ ĐỊNH sai. Trong hệ thống có xoá, hai loại bằng
chứng đó không cùng độ tin cậy.

## Cái quyết định quyền thì đừng để nó là tham số của hàm (2026-09-04)

`ingest_origin` là nhãn quyết định một tài liệu có được vào index production hay không.
Cách viết hiển nhiên là cho `repository.create(..., ingest_origin=...)` rồi để route
truyền vào. Nó chạy, nó test được, và nó sai.

Sai vì tham số là một cái ống: hôm nay route tự tính giá trị, ngày mai ai đó thêm
`request.form.get("ingest_origin")` cho tiện, và nhãn quyết định quyền trở thành thứ
client đặt được. Không cần ai cố tình — chỉ cần một người thấy cái tham số ở đó và nghĩ
nó để dùng.

Cách viết đúng: hàm tự hỏi tiến trình của chính nó, và KHÔNG có tham số nào cho việc đó.
Test khoá lại bằng `inspect.signature` — không phải grep chuỗi, mà là khẳng định cấu trúc:
không tham số nào tên chứa "origin".

Quy tắc rút ra: giá trị nào quyết định quyền thì phải sinh ra ở nơi nó được tin, và đường
từ request tới nơi đó phải KHÔNG TỒN TẠI — chứ không phải tồn tại mà hiện chưa ai đi.

## Xem trước phải xem trước cái SẼ xảy ra, không phải cái vừa đọc được (2026-09-04)

`--dry-run` của rebuild in "Chunk đọc từ Postgres: 192". Con số đúng, câu hỏi sai. Thứ
người ta chạy dry-run để biết là "tôi sắp embed bao nhiêu, tốn bao nhiêu" — mà hàng rào
allowlist nằm sau đó, bên trong hàm rebuild, nên đáp án thật là 3.

Một xem trước lệch 64 lần theo hướng phóng đại thì vô hại về tiền nhưng độc về niềm tin:
lần sau người đọc thấy 192 rồi thấy hoá đơn 3, họ sẽ ngừng tin cả hai con số.

Quy tắc: nếu một bước lọc nằm giữa "đọc" và "làm", thì bản xem trước phải chạy qua đúng
bước lọc đó. Xem trước dùng chung đường với việc thật, hoặc nó không phải xem trước.

## Khoá chỉ có ở production nghĩa là mắt xích đó chỉ chứng minh được ở production (2026-09-04)

Kế hoạch của tôi là dựng index FPT từ máy dev, đọc ngữ liệu qua DB dùng chung. Đọc DB thì
được — khoá thì không: `FPT_AI_API_KEY` cố ý chỉ nằm trong Render.

Đáng lẽ phải phát hiện điều này ở bước lập kế hoạch chứ không phải sau khi đã upload xong
tài liệu production. Cách kiểm rẻ: trước khi dựng kế hoạch có bước gọi API trả tiền, liệt
kê từng bí mật mà bước ấy cần và hỏi "bí mật này có ở nơi tôi định chạy không".

Không có khoá thì lựa chọn đúng là DỪNG, không phải dựng một index `bge-m3` rồi gọi nó là
index production. Hàng rào đã nói thẳng ("index sẽ mang danh tính model cục bộ") — và cả
chuỗi phase vừa rồi tồn tại chính là để câu cảnh báo đó không bị bỏ qua.

## Nhãn phải hỏi vật, đừng hỏi cấu hình (2026-09-04)

`document_chunks.embedding_model` ghi tên model lấy từ `EMBEDDING_MODEL_NAME`. Hợp lý
khi viết: biến đó "là" model đang dùng. Nhưng nó chỉ là ý định, còn `get_embeddings()`
mới là thực tế — và khi FPT được bật, thực tế rẽ sang một nhánh không đọc biến đó.

Cùng một lớp lỗi với `ingest_origin`: thứ quyết định phải sinh ra ở nơi nó được tin.
Khác một chỗ: `ingest_origin` sai thì hàng rào chặn nhầm và ai đó sẽ kêu; nhãn model sai
thì không có ai kêu cả — nó chỉ nằm đó cho tới ngày có người dựa vào nó để quyết định
một index có tương thích hay không.

Cách nhận ra sớm: với mỗi cột "mô tả cách dữ liệu được tạo ra", hỏi "ai trả lời câu hỏi
này — hằng số cấu hình hay đối tượng đã làm việc đó". Chỉ nhóm sau mới đúng khi có nhiều
nhánh provider.

## Đọc kỹ tên trường trước khi sửa nó (2026-09-04)

Kế hoạch phase nói sửa `embedding_id`. Tra ra thì `embedding_id` là id hàng FAISS, khoá
tra ngược của cả đường truy hồi, có index Postgres riêng. Nhồi danh tính vào đó là phá
truy hồi và mồ côi 192 hàng.

Thứ hỏng là `embedding_model` — cột bên cạnh, tên gần giống, vai trò khác hẳn. Nếu tôi
làm theo đúng câu chữ thay vì tra `grep embedding_id` trước, thiệt hại sẽ lớn hơn nhiều
lần cái lỗi đang đi sửa.

Quy tắc rẻ: trước khi đổi format một trường bền vững, liệt kê ĐỦ nơi ghi và nơi ĐỌC nó.
Nếu có người đọc dùng nó làm khoá join, format đó không còn là chuyện nội bộ nữa.

## Khoá thật trong `.env` của một người làm đỏ 17 test của mọi người (2026-09-04)

Thêm `FPT_AI_API_KEY` + `FPT_AI_EMBEDDING_MODEL` vào `BE/.env` để dựng index production.
Index dựng xong; 17 test đỏ ngay lập tức. Không test nào liên quan tới index — chúng
khẳng định `get_embeddings()` trả `LateChunkEmbeddings`, mà giờ nó trả `FptEmbeddings`.

CI vẫn xanh, vì CI không có khoá. Đó là kiểu hỏng khó lần nhất: đỏ ở máy người này, xanh
ở máy người kia, xanh trên CI, và nguyên nhân không nằm trong diff nào cả.

Cùng lớp với lỗi `DATABASE_URL` hồi 3058272: **cấu hình trong `.env` của một người không
được quyết định kết quả test của mọi người.** Lần đó là database, lần này là provider.

Một chi tiết đắt hơn dự tính: `os.environ.pop(...)` trong conftest KHÔNG đủ. `load_dotenv`
chạy sau và nó chỉ bỏ qua biến đã CÓ trong môi trường — pop xong thì nó nạp lại giá trị
thật từ file. Phải đặt chuỗi RỖNG. Mọi chỗ đọc đều là `(os.getenv(x) or "").strip()` nên
rỗng đúng bằng tắt.

Quy tắc: khi dọn env cho test, hỏi "sau mình còn ai ghi vào env nữa không". Nếu có
dotenv, xoá không phải là dọn — ghi đè mới là.

## Dò chuỗi để phân loại lỗi là bịa ra nguyên nhân (2026-09-05)

`if "embedding" in err_str.lower()` đọc rất hợp lý lúc viết: lỗi về embedding thì báo là
lỗi index không tương thích. Nhưng chuỗi lỗi không phải hợp đồng. `"FPT embeddings HTTP
401"` cũng có chữ đó, và mọi lỗi của tầng embedding cũng vậy — nên nhánh ấy nuốt trọn
một lớp lỗi mà nó không hề định nói tới.

Thứ làm nó đắt là **thông điệp có kèm chỉ dẫn hành động**: "hãy rebuild index". Phân loại
sai + chỉ dẫn cụ thể = đẩy người đọc đi làm một việc tốn tiền, mất thời gian, và không
chữa gì cả. Một thông điệp mơ hồ ("lỗi khi truy hồi") mà đúng còn rẻ hơn nhiều.

Quy tắc: lỗi tự khai mã của nó (`MA_LOI` trên chính lớp ngoại lệ), người phân loại chỉ
đọc thuộc tính. Còn phải đọc chuỗi thì thu hẹp tới mức không thể trùm lên lớp khác được
nữa — ở đây là `ValueError` về số chiều, và chỉ sau khi mọi lỗi tự khai đã bị bắt trước.

Kèm theo: đọc thuộc tính thay vì so kiểu giữ được hướng import. `shared/interfaces` là
tầng port, không được import lên `app/`; nhờ đọc `MA_LOI` mà lớp lỗi phía chỉ mục vẫn nằm
ở nơi sở hữu khái niệm index, port vẫn nhận ra nó.

## Một lần hỏng chưa phải là hỏng (2026-09-05)

Poll trạng thái ingest dừng ngay ở lần fetch hỏng đầu tiên và báo "Mất liên lạc". Trên
Render, 502/503/504 lẻ tẻ là chuyện thường — cùng lúc đó log Gunicorn ghi `200` cho đúng
request ấy. Người dùng đọc thấy tài liệu chết, còn backend đang chạy bình thường.

Hai câu hỏi tách bạch cho mọi vòng poll:

1. **Lỗi này tự khỏi không?** 408/429/502/503/504 và fetch ném thì có; 401/403/404/500 thì
   không. Riêng 500 đáng nhắc: nó trông như "lỗi server, chắc thử lại được", nhưng đó là
   ứng dụng tự ném — thử lại chỉ tốn request cho một câu trả lời không đổi.
2. **Bao nhiêu lần thì mới NÓI RA?** Không phải một. Ngưỡng nói ra và ngưỡng bỏ cuộc là
   hai con số khác nhau: hỏng 1–2 lần thì im, ≥3 thì báo "đang thử lại" nhưng giữ nguyên
   trạng thái xử lý, vượt ngân sách chung mới nói là đã ngừng theo dõi.

Và câu chữ phải phân biệt "tôi không theo dõi được nữa" với "việc của bạn hỏng rồi" —
ingest vẫn có thể đang chạy ở server sau khi trình duyệt bỏ cuộc.

Ngưỡng bỏ cuộc lấy lại `MAX_CONSECUTIVE_FETCH_FAILURES` của `jobPoller` thay vì đặt số
mới: hai con số cùng nghĩa nằm hai chỗ thì sớm muộn cũng trôi khỏi nhau.

## `setInterval` với thân async là hai request cùng bay (2026-09-05)

`setInterval(poll, 1500)` với `poll` là async không phải "hỏi mỗi 1.5s" — nó là "bắn mỗi
1.5s bất kể lượt trước xong chưa". Một lượt chậm là hai request chồng nhau, và phản hồi
về trễ ghi đè phản hồi mới hơn: thanh tiến trình nhảy lùi, hoặc trạng thái `ready` bị một
phản hồi cũ đè thành `processing`.

Tự hẹn `setTimeout` SAU khi lượt trước kết thúc thì bất biến "chỉ một request đang bay"
đúng theo cấu trúc, không cần cờ nào canh. Đổi lại phải guard `start()` gọi hai lần —
chỉ giữ được một handle, dựng vòng thứ hai là mất cách dừng vòng thứ nhất.

## 502 không có log request là câu trả lời, không phải chỗ thiếu dữ liệu (2026-09-05)

Trình duyệt thấy 502 hàng loạt. Phản xạ đầu là đi tìm nhánh nào trong Flask trả 502.
Không có nhánh nào — và đó chính là dữ kiện.

Cách đọc rẻ nhất, dùng được cho mọi sự cố sau này:

| trình duyệt | log gunicorn | kết luận |
|---|---|---|
| 502 | **không có dòng nào** | proxy/hạ tầng — request chưa từng tới ứng dụng |
| 502 | có, ghi 502 | đường ứng dụng |
| 502 | có, ghi 200 | proxy/upstream/thời gian phản hồi |

Ở đây log im 61 giây, kể cả `/health` — thứ Render tự gọi mỗi 5 giây. Một endpoint mà
CHÍNH hạ tầng gọi cũng im nghĩa là không còn tiến trình nào sống. Chọn một đường mà bạn
biết chắc phải có nhịp đều (health check) làm mốc đối chiếu: chỗ nó biến mất là chỗ chết.

Và chết KHÔNG có traceback, không `SIGTERM`, không dòng shutdown nào là chữ ký riêng của
`SIGKILL` từ ngoài. Ứng dụng tự chết thì để lại vết; bị giết thì không kịp.

## Việc nặng chạy chung tiến trình với HTTP thì hạn mức bộ nhớ là hạn mức CHUNG (2026-09-05)

`threading.Thread(daemon=True)` trông như "chạy nền", nhưng nền ở đây vẫn là cùng một
tiến trình, cùng một cgroup, cùng một trần 512 MiB. Ingest phình lên không làm chậm web —
nó **giết** web. Hai thứ chẳng liên quan gì nhau về nghiệp vụ lại chết cùng nhau.

Cách nhận ra sớm mà không cần sự cố: lấy bộ nhớ NHÀN RỖI chia cho trần. Ở đây là
332/512 = 65% trước khi làm bất cứ việc gì. Còn 35% cho mọi việc nặng nhất — con số đó tự
nó đã là câu trả lời, không cần chờ OOM mới biết.

Bài học phụ về ưu tiên: khi đã biết trần bị chạm, đừng đi tối ưu bản sao trong pipeline
trước. Đo xem cái gì chiếm phần lớn. Ở đây phần lớn là import (torch/faiss/transformers)
chứ không phải dữ liệu tài liệu — tối ưu chỗ sau cho ra vài MB trên một vấn đề cỡ trăm MB.

## Fail-open đúng chỗ này là fail-open sai chỗ kia (2026-09-05)

`enqueue_job` có một fallback: đẩy vào hàng đợi hỏng thì chạy tại chỗ bằng thread. Viết
ra là hợp lý — "Redis chết thì upload vẫn phải chạy được".

Nhưng cùng một dòng mã ấy mang hai hậu quả khác hẳn nhau tuỳ việc nó chạy:

- summary/mindmap hỏng → mất một tính năng phụ, người dùng bấm lại
- ingest chạy tại chỗ → **tiến trình web bị OOM giết**, cả dịch vụ ngừng 61 giây

Nên cái sửa không phải bỏ fallback, mà là để NƠI GỌI nói ra nó chịu được gì:
`fail_closed=True` ở đường ingest, mặc định giữ nguyên cho phần còn lại. Chính sách thuộc
về chỗ biết hậu quả, không thuộc về hàm tiện ích ở giữa.

## Tách tiến trình không miễn phí: thứ gì đang ngầm dùng chung đĩa? (2026-09-05)

Đưa ingest sang worker riêng là sửa đúng gốc. Nhưng trước khi bật, phải hỏi: hai tiến
trình ấy đang ngầm dựa vào cái gì chung?

Ở đây là FAISS. `_VS_CACHE` khoá theo `mtime+size` của `index.faiss` trên đĩa **cục bộ**,
và `restore` chỉ chạy lúc khởi động. Worker ghi trên đĩa của nó, đĩa của web không đổi,
nên web sẽ phục vụ index cũ mà không có một lỗi nào — tài liệu vừa ingest xong đơn giản
là không tìm thấy.

Và `threading.Lock` bảo vệ index chỉ có nghĩa trong một tiến trình. Hai worker là hai
tiến trình: khoá còn đó, tác dụng thì không. Hiện tại an toàn vì cấu hình chỉ có một
worker — an toàn *do cấu hình*, không phải *do thiết kế*. Ghi rõ sự khác biệt đó ra, vì
người nâng lên 2 worker sẽ không đọc lại đoạn mã có khoá.

Quy tắc: trước khi tách tiến trình, liệt kê mọi trạng thái đang nằm trên đĩa cục bộ hoặc
trong bộ nhớ tiến trình. Cái nào có người ĐỌC ở tiến trình khác thì tách là phá, trừ khi
có đường đồng bộ.

## Cache khoá theo đĩa cục bộ trở thành cache VĨNH VIỄN khi người ghi ở tiến trình khác (2026-09-05)

`_VS_CACHE` khoá theo `mtime+size` của `index.faiss`. Đó là một khoá tốt — miễn là người
GHI và người ĐỌC dùng chung cái đĩa ấy. Tách ingest sang worker riêng làm giả định đó sai
mà không có dòng mã nào thay đổi: đĩa của web không ai chạm nữa, nên khoá không bao giờ
đổi, nên cache không bao giờ hết hạn.

Điều làm nó nguy hiểm là **im lặng**: không lỗi, không log, truy hồi vẫn trả kết quả —
chỉ là thiếu tài liệu vừa ingest. Một cache hết hạn sai thì ai cũng thấy; một cache không
bao giờ hết hạn thì phải đi tìm mới thấy.

Quy tắc: mỗi cache có một khoá, và mỗi khoá có một giả định về việc "ai làm thay đổi thứ
này". Viết giả định đó ra cạnh khoá. Khi thay đổi kiến trúc tiến trình, đọc lại đúng những
dòng ấy — chúng là danh sách những thứ vừa âm thầm sai.

## Đường ĐỌC và đường GHI chịu lỗi khác nhau, và phải viết thành hai hàm (2026-09-05)

Cùng một việc "kéo bản index mới nhất về", nhưng:

- đường đọc hỏng → phục vụ bản cũ. Mất tính mới. Chấp nhận được, và tốt hơn nhiều so với
  làm chết `/query` vì Supabase chập chờn.
- đường ghi hỏng mà vẫn đi tiếp → append lên bản cũ rồi publish đè → **xoá vector của
  lượt ingest khác**. Mất dữ liệu.

Một hàm với cờ `nghiem_ngat=True` cũng chạy đúng, nhưng hai tên hàm thì người đọc chỗ gọi
biết ngay mình đang ở phía nào của sự đánh đổi. `dong_bo` cho người đọc, `dong_bo_truoc_khi_ghi`
cho người ghi — và cái thứ hai NÉM.

Kèm một chi tiết đắt: "kho chưa có bản nào" phải khác "không hỏi được kho". Cái đầu là cài
mới và phải cho ingest chạy; cái sau phải chặn. Phân biệt bằng `exists()` chứ đừng đoán mã
lỗi của `download()` — 404 và timeout đi chung một `except` là cách biến một lần đứt mạng
thành một lần ghi đè.

## Khoá phải bao đúng thứ tạo ra xung đột, không phải thứ trông nguy hiểm nhất (2026-09-05)

Phản xạ là khoá quanh `append_to_index` — chỗ "ghi". Nhưng kịch bản mất dữ liệu là:

```
A: đọc V1 → append → publish V2
B: đọc V1 → append → publish V3      ← V3 không có A
```

Không lần append nào chạy cùng lúc với lần kia. Xung đột nằm ở khoảng ĐỌC→PUBLISH, nên
đoạn tới hạn phải bắt đầu từ lúc lấy bản mới nhất và kết thúc sau khi xuất bản xong. Khoá
hẹp hơn chạy nhanh hơn và bảo vệ đúng con số không.

Cách kiểm rẻ: viết ra dãy thao tác của hai bên xen kẽ nhau và tìm cặp cho ra kết quả sai.
Đoạn tới hạn là đoạn ngắn nhất bao trọn cặp đó — không phải đoạn quanh lời gọi trông đáng
sợ nhất.

## Khoá phân tán mà không có hạn là đổi một lỗi lấy một lỗi tệ hơn (2026-09-05)

Worker giữ khoá rồi bị OOM giết — đúng thứ vừa xảy ra trên production. Khoá không có hạn
thì mọi lượt ingest sau đó đứng vĩnh viễn, và triệu chứng ("upload không bao giờ xong")
giống hệt cái bug vừa đi dọn.

`timeout` là bắt buộc, không phải tuỳ chọn. Và `blocking_timeout` cũng vậy: chờ vô hạn để
lấy khoá thì một worker kẹt kéo theo cả hàng đợi.

Chi tiết cài đặt dễ trượt: redis-py chỉ mở kết nối ở lệnh ĐẦU TIÊN thật sự nói chuyện với
server. `from_url()` và `.lock()` không chạm mạng; `.acquire()` mới chạm. Bọc `try` quanh
hai cái đầu mà để `acquire` ra ngoài thì lỗi mạng thoát ra dạng thô và mất hết ngữ nghĩa
"thử lại được" mà mình vừa dựng.

## Bảng "Output" trong tài liệu NKS sai ở CẢ BA endpoint ghi (2026-09-07)

`docs/NKS API.md` ghi Output của `updateInfo` / `updateAvatar` / `updateCccd` đều là
"User Info". Ảnh chụp Postman trong CHÍNH tài liệu đó cho thấy thứ khác:

```json
{"success": true, "option": null, "data": true, "message": "User retrieved successfully."}
```

`data` là một boolean trần. Ai viết client theo bảng Output sẽ đọc `data.avatar` sau khi
đổi ảnh và nhận `undefined` — mỗi lần ghi phải gọi lại `/nks/user` mới thấy kết quả.

Lặp lại đúng bài học "Tài liệu của nhà cung cấp không phải là hợp đồng" (2026-09-03), với
một biến thể: **phần đáng tin nhất của tài liệu là ảnh chụp phản hồi thật, không phải bảng
mô tả bên cạnh nó.** Bảng do người viết gõ tay, ảnh do máy chủ trả. Khi hai thứ lệch nhau
thì tin ảnh.

Cùng tài liệu, hai thứ nữa cần nhớ:

- Endpoint đăng nhập ghi là `https://account.nks.vn/api/user/login`, nhưng đường sống là
  `/api/nks/user/login` — đã đo được từ trước, tài liệu vẫn chưa sửa.
- Token là **JWT** (`eyJ0eXA…`), và danh sách endpoint của tài liệu là ĐẦY ĐỦ: không có
  refresh, không có client-credentials, không có tài khoản máy. Nghĩa là mọi lần đọc hồ sơ
  đều cần token của chính người dùng, lấy từ một lần đăng nhập bằng mật khẩu. "Không lưu
  token" + "không sao chép dữ liệu" + "vẫn thấy hồ sơ sau khi tải lại trang" là ba điều
  KHÔNG cùng đúng được — phải bỏ một.

Còn một cạm bẫy về bí mật: tài liệu này chứa mật khẩu của 8 tài khoản NKS thật và một
bearer token của API `sdata.io.vn`. Nó đang nằm trong repo. Trước khi commit phải quyết
định: xoá phần credential, hay để tài liệu ngoài git.

## Lọc kiểu ngay tại chỗ gọi biến "đọc sai trường" thành "im lặng về quyền thấp nhất" (2026-09-07)

`mapper.to_identity` đọc nhóm NKS bằng `_lay(d, UNG_VIEN_NHOM)` rồi truyền đi qua:

```python
role=map_role(nhom if isinstance(nhom, (str, int)) else None),
```

`/nks/user` trả `role` là OBJECT `{"id": 11, "name": "Manager"}`. `_lay` lấy đúng
khoá và trả về dict; `isinstance` loại dict; `map_role(None)` trả `learner`. **Mọi
người dùng NKS trên production đều là `learner`, kể cả Manager** — và đã như thế từ
ngày tính năng lên.

Ba điều đáng nhớ:

- **Fail-closed che mất lỗi lâu hơn fail-open.** Rơi về quyền THẤP NHẤT là đúng
  hướng nên không có gì kêu: không exception, không log, không người dùng phàn nàn
  (bị thiếu quyền thì người ta tưởng mình vốn không có quyền). Một mặc định an toàn
  vẫn phải kèm cách biết là nó vừa được dùng. `metadata["nks_group"]` lẽ ra làm được
  việc đó, nhưng nó ghi `str(dict)` nên nhìn vào không ai thấy bất thường.
- **Lọc kiểu đặt ở chỗ GỌI thì nó không phải phép kiểm, nó là chỗ nuốt lỗi.**
  `x if isinstance(x, T) else None` ngay trên dòng gọi biến "giá trị sai hình dạng"
  thành "không có giá trị" mà không ai đọc lại. Việc rút một trường ra khỏi phản hồi
  ngoài phải là một HÀM CÓ TÊN, để chỗ đó có tài liệu, có test, và hình dạng lạ thì
  hiện ra chứ không biến mất.
- **Bảng ánh xạ khoá theo NHÃN TRONG TÀI LIỆU, không theo giá trị API.** Tài liệu ghi
  "Faculty"/"Student"/"Driver"; API trả `"teacher"`/`"user"`/`"user"`. Ngoài
  `"manager"` thì không khoá nào từng khớp. Nghĩa là kể cả khi sửa xong đường đọc,
  bảng cũ vẫn sai — hai lỗi độc lập chồng lên nhau, cùng cho ra một triệu chứng.

Phòng lần sau: với mọi trường lấy từ hệ thống ngoài mà QUYẾT ĐỊNH QUYỀN, viết một
test dùng đúng thân phản hồi thật đã đo, khẳng định giá trị cao nhất (`admin`) tới
được đích. Test "unknown → learner" luôn xanh kể cả khi đường đọc gãy hoàn toàn, nên
một mình nó không chứng minh được gì.

Hồi quy: `test_regression_manager_khong_con_thanh_learner` trong
`BE/tests/test_auth_nks.py` — thân `/nks/user` thật, tài khoản Manager, khẳng định
`admin`. Trước bản sửa: `learner`.

## Cột chỉ được ghi lúc INSERT là cột đóng băng ở lần đầu (2026-09-07)

`77ba7fa` sửa xong chỗ TÍNH vai trò NKS, nhưng người dùng quay lại vẫn giữ vai trò cũ.
`_gan_danh_tinh_ngoai` chỉ đọc `identity.role` ở nhánh TẠO MỚI:

```python
lien_ket = store.find(...)
if lien_ket is not None:
    user = users_store.get_by_id(lien_ket["user_id"])
    store.touch_last_login(...)
    return user            # identity.role bị bỏ đi ở đây
...
return store.link_new_user(..., role=identity.role or "learner")   # chỗ DUY NHẤT dùng
```

`grep` cả `BE/app` cho phép gán `role`: đúng ba chỗ, **cả ba đều là INSERT**, không có
một UPDATE nào. `users_store` không hề có `set_role`.

- **"Nguồn sự thật ở hệ thống ngoài" chỉ đúng nếu có đường ĐỌC LẠI.** Chép một lần lúc
  tạo tài khoản rồi thôi thì hệ thống ngoài là nguồn sự thật của đúng một khoảnh khắc
  trong quá khứ. Cùng họ với bài học `deleted_at`: một chiều thì tính năng đó chưa tồn
  tại.
- **Sửa chỗ TÍNH không tự động sửa chỗ DÙNG.** Bản sửa trước xanh hết test, đúng hoàn
  toàn, và không thay đổi gì cho người đã có tài khoản. Sau khi sửa một phép biến đổi,
  phải hỏi tiếp: giá trị mới này đi tới đâu, và có ai đang giữ một bản cũ không?
- **Hạ quyền mới là hướng nguy hiểm.** "Manager kẹt ở learner" chỉ phiền; "người bị hạ
  chức vẫn còn admin" mới là lỗ hổng. Một hàng rào chỉ đồng bộ theo chiều tăng sẽ trông
  như đang hoạt động rất lâu trước khi ai đó phát hiện.

Hai hàng rào của bản sửa: chỉ UPDATE khi KHÁC (đăng nhập thường ngày không sinh lệnh
ghi), và chỉ UPDATE khi giá trị NẰM TRONG `VAI_TRO_HOP_LE` — vai trò rỗng/lạ nghĩa là
mapper hỏng, ghi đè lúc đó biến một lỗi đọc thành một lần đổi quyền âm thầm.

Không bump `token_version`: token chỉ mang `{uid, tv}` và `current_user_from_request`
đọc lại hàng `users` ở MỖI request, nên vai trò mới có hiệu lực ngay ở request kế tiếp.

Còn một bẫy riêng đáng nhớ: `test_role_nks_map_dung_khi_luu` khẳng định
`("Faculty", "teacher")` — sai từ lúc `77ba7fa` đổi bảng ánh xạ, nhưng **xanh ở máy dev
vì thiếu `TEST_DATABASE_URL` nên nó SKIP**, trong khi CI có Postgres và sẽ chạy nó thật.
Test bị skip không phải test đang xanh. Sửa một bảng ánh xạ thì phải grep xem test nào
khoá theo giá trị cũ, đừng chỉ nhìn kết quả chạy ở máy mình.
