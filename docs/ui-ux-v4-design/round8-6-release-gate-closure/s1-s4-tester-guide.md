# Hướng dẫn kiểm thử chấp nhận người dùng thực tế: Bảng kiểm S1–S4 (StudyMap V4)

Tài liệu này hướng dẫn chi tiết quy trình kiểm thử thủ công dành cho kiểm thử viên (tester) thực hiện nghiệm thu các cổng phát hành (release gates) về trợ năng (E4) và tương tác chạm thực tế (E3) trên StudyMap V4.

Tài liệu được biên soạn bằng tiếng Việt với ngôn từ trực quan, dễ hiểu cho kiểm thử viên không chuyên lập trình.

---

## 1. Nguyên tắc nghiệm thu cốt lõi (Bắt buộc tuân thủ)

1. **Chỉ người thật trên thiết bị thật mới được tính là PASS**:
   - Kết quả chỉ hợp lệ khi được thực hiện bởi một kiểm thử viên có họ tên cụ thể (named tester) trên thiết bị thật và trình đọc màn hình thực tế.
   - Các công cụ kiểm thử tự động, giả lập như Playwright, Jest, axe-core, chế độ Touch Emulation trên Chrome DevTools hay cây trợ năng (Accessibility Tree) của trình duyệt **hoàn toàn không được tính** là bằng chứng nghiệm thu cho các cổng này.
2. **Thiếu người kiểm thử hoặc thiếu thiết bị thì giữ nguyên NOT VERIFIED**:
   - Nếu chưa có người chạy kiểm thử hoặc chưa có thiết bị thực tế tương ứng, trạng thái của cổng kiểm thử đó **bắt buộc phải giữ nguyên là NOT VERIFIED** (Chưa xác minh). Tuyệt đối không tự suy diễn hoặc đánh dấu đạt trước.
3. **Ghi lại trung thực những gì thực tế nghe thấy hoặc nhìn thấy**:
   - Khi chạy trình đọc màn hình, hãy ghi lại **chính xác từng từ ngữ mà giọng đọc phát ra** (spoken text) hoặc những gì thực tế hiển thị trên màn hình.
   - Không ghi nhận những gì bạn "nghĩ rằng hệ thống nên đọc" hoặc "kỳ vọng sẽ đọc".
4. **Không sao chép lại toàn bộ bảng kiểm, không tự tạo thêm hàng kiểm thử**:
   - Hãy tham khảo và liên kết trực tiếp tới các bảng kiểm gốc:
     - [human-acceptance-sheets.md](human-acceptance-sheets.md) (Bảng tổng hợp S1–S4)
     - [accessibility-manual-checklist.md](../round8-4-qa-evidence/accessibility-manual-checklist.md) (Bảng kiểm chi tiết trợ năng gồm 28 hàng 1.1–6.4; hàng C1 riêng trong [human-acceptance-sheets.md](human-acceptance-sheets.md) nâng tổng lên 29 hàng)
   - Không tự ý thêm bớt các hàng kiểm thử hoặc tự tạo kết quả giả định.

---

## 2. Chuẩn bị trước khi chạy bất kỳ bảng kiểm nào

Trước khi mở bất kỳ bảng kiểm nào (S1, S2, S3, S4), kiểm thử viên cần hoàn thành các bước chuẩn bị sau:

### 2.1. Tài khoản kiểm thử (Test Account)

- **Tuyệt đối KHÔNG tự tạo tài khoản production, dùng tài khoản người dùng thật hoặc dữ liệu cá nhân**: Việc kiểm thử bao gồm các thao tác xóa vĩnh viễn dữ liệu (destructive actions).
- **Chỉ sử dụng tài khoản QA dùng một lần do Release Owner cấp**:
  - Release Owner chịu trách nhiệm cấp tài khoản và chuẩn bị trước bộ dữ liệu mẫu dùng một lần. Kiểm thử viên không tự đăng ký tài khoản và không dùng dữ liệu của mình.
  - Trước mỗi lượt S1–S4, kiểm thử viên xác nhận tài khoản có sẵn:
    1. Một bộ sưu tập (Collection) mẫu.
    2. Một sơ đồ tư duy (Mind Map) có chứa nội dung tóm tắt (Summary).
    3. Một phiên trò chuyện (Chat) có vài tin nhắn trao đổi.
    4. Một bài thi trắc nghiệm đã hoàn thành (Finished Quiz), trong đó có ít nhất một câu hỏi dạng tự luận ngắn (short-answer question) để kiểm tra việc chấm điểm bất đồng bộ.

### 2.2. Cách đọc và ghi nhận phiên bản mã nguồn (SHA) trong ngày kiểm thử

Kiểm thử viên cần ghi nhận chính xác 2 mã phiên bản (SHA) trước khi bắt đầu kiểm thử: **Frontend SHA** và **Backend SHA**. Hai mã này có thể khác nhau và cần được ghi riêng biệt:

1. **Frontend SHA (Mã phiên bản giao diện)**:
   - Truy cập trang web chính: `https://studymap.space/`.
   - Nhấn chuột phải vào khoảng trống trên trang, chọn **Xem nguồn trang** (View Page Source) hoặc nhấn phím tắt `Ctrl + U`.
   - Nhấn `Ctrl + F` tìm kiếm chuỗi: `<meta name="studymap-build"`
   - Sao chép toàn bộ mã SHA trong thuộc tính `content="..."` (ví dụ: `2d283aa384f2...` hoặc SHA mới nhất).
   - *Giải thích*: Đây là phiên bản mã nguồn của giao diện người dùng đang được hiển thị. Hệ thống máy chủ Render chỉ tự động build lại Frontend khi có thay đổi trong thư mục `FE/`, do đó mã này có thể khác với Backend.
2. **Backend SHA (Mã phiên bản máy chủ)**:
   - Mở một thẻ trình duyệt mới và truy cập đường dẫn: `https://api.studymap.space/health`
   - Màn hình sẽ hiển thị thông tin dạng JSON. Tìm trường `revision`:
     ```json
     {"status": "ok", "revision": "d1cb795bd04a...", ...}
     ```
   - Sao chép toàn bộ chuỗi giá trị của `revision`.

Ghi nhận cả hai mã SHA này vào phần thông tin chung của bảng kiểm.

---

## 3. Hướng dẫn chi tiết cho từng bảng kiểm (S1 – S4)

### 3.1. Sheet S1: NVDA trên Windows với Google Chrome (Cổng E4)

- **Mục tiêu**: Kiểm tra trải nghiệm đọc màn hình bằng công cụ NVDA trên trình duyệt Chrome.
- **Chuẩn bị phần cứng và phần mềm**:
  - Máy tính chạy hệ điều hành Windows 11, đúng với môi trường trong bảng kiểm gốc.
  - Cài đặt trình duyệt Google Chrome bản mới nhất.
  - Tải và cài đặt phần mềm đọc màn hình miễn phí **NVDA** từ trang web chính thức của tổ chức phi lợi nhuận NV Access: [nvaccess.org](https://www.nvaccess.org/).
- **Cách khởi động và thao tác**:
  - Mở Google Chrome và truy cập StudyMap.
  - Nhấn tổ hợp phím `Ctrl + Alt + N` để khởi động NVDA.
  - Bật loa ngoài hoặc đeo tai nghe để nghe rõ tiếng đọc; giữ màn hình luôn mở để đối chiếu giữa âm thanh và hình ảnh.
  - **Phím điều hướng chính**:
    - Chế độ đọc duyệt (Browse mode - mặc định): Dùng mũi tên `Lên` / `Xuống` để nghe đọc từng khối văn bản.
    - Phím `Tab` và `Shift + Tab`: Di chuyển qua lại giữa các nút bấm (buttons), liên kết (links), ô nhập dữ liệu (inputs).
    - Phím `Space` (Dấu cách) hoặc `Enter`: Kích hoạt nút bấm hoặc chọn ô trắc nghiệm.
    - Phím `Escape`: Đóng các hộp thoại (dialogs) hoặc hủy thao tác.
- **Thực hiện các hàng kiểm thử**:
  - Mở bản sao của [accessibility-manual-checklist.md](../round8-4-qa-evidence/accessibility-manual-checklist.md).
  - Chạy tuần tự từ mục §1 đến mục §6, cộng thêm hàng bổ sung **C1**:
    - **Hàng bổ sung C1 (Hộp thoại lịch sử chat)**: Tại khung chat, mở menu "Tùy chọn cuộc trò chuyện", chọn mục "Xóa lịch sử chat", sau đó nhấn phím `Escape`. Kiểm tra xem hộp thoại có đóng lại ngay lập tức và NVDA có đọc thông báo tiêu điểm (focus) đã quay lại đúng nút "Tùy chọn cuộc trò chuyện" hay không.
- **Lưu ý đặc biệt cho hàng 4.6 (Bulk selection and actions)**:
  - Hàng 4.6 kiểm tra tính năng chọn hàng loạt trong thư viện (Library Action Matrix).
  - **Tính năng này đang TẮT trên môi trường production** và tuyệt đối không được bật trên production.
  - Hàng 4.6 bắt buộc phải thực hiện trên một **bản dựng kiểm thử riêng đã bật cờ (Flag-ON test build / preview build)** do Release Owner cung cấp URL và SHA.
  - Ghi nhận URL và SHA của bản dựng kiểm thử này vào ô riêng trong [human-acceptance-sheets.md](human-acceptance-sheets.md) (mục Sheet S1).

---

### 3.2. Sheet S2: Narrator trên Windows với Microsoft Edge (Cổng E4)

- **Mục tiêu**: Kiểm tra khả năng tương thích với trình đọc màn hình mặc định Windows Narrator trên trình duyệt Edge.
- **Chuẩn bị phần cứng và phần mềm**:
  - Máy tính chạy Windows 11 có sẵn công cụ Windows Narrator.
  - Trình duyệt Microsoft Edge.
- **Cách khởi động và thao tác**:
  - Mở Microsoft Edge và truy cập StudyMap.
  - Nhấn tổ hợp phím `Ctrl + Win + Enter` để bật hoặc tắt Windows Narrator.
  - Phím tắt quan trọng: Nhấn tổ hợp `Caps Lock + Space` (hoặc `Insert + Space`) để chuyển đổi qua lại giữa chế độ quét (Scan Mode) và chế độ tương tác khi cần di chuyển qua các thành phần trang web.
- **Thực hiện các hàng kiểm thử**:
  - Chạy cùng bộ 29 hàng kiểm thử giống như Sheet S1 (§1 đến §6 và hàng C1).
  - Hàng 4.6 cũng thực hiện trên bản dựng kiểm thử Flag-ON riêng giống như S1.
- **Tiêu chuẩn hoàn thành Cổng E4**:
  - Cổng E4 chỉ được đánh giá là ĐẠT (PASS) khi **cả S1 (NVDA) và S2 (Narrator) đều đạt tất cả các hàng**, hoặc từng hàng không PASS có ngoại lệ được theo dõi và Release Owner chấp nhận bằng văn bản.
  - Nếu mới chạy một trình đọc màn hình, kết quả của trình đọc còn lại vẫn là **NOT VERIFIED**. Chỉ Release Owner mới có thể quyết định phát hành có điều kiện và phải chấp nhận rủi ro đó bằng văn bản; kiểm thử viên không tự đổi thành PASS.

---

### 3.3. Sheet S3: Vuốt nhanh trên điện thoại Android thật với Chrome (Cổng E3)

- **Mục tiêu**: Xác thực tương tác cảm ứng sau khi lướt nhanh canvas trên màn hình cảm ứng di động, đảm bảo không xảy ra hiện tượng "nuốt cảm ứng" ở lần chạm đầu tiên.
- **Chuẩn bị thiết bị**:
  - **Điện thoại Android thật** (ghi rõ tên model máy, phiên bản Android và phiên bản Chrome).
  - Tuyệt đối không dùng chế độ giả lập thiết bị di động (Device Mode) trên máy tính hay phần mềm giả lập Android trên PC.
- **Các bước thực hiện**:
  1. Mở trang sơ đồ tư duy trên trình duyệt Chrome di động.
  2. Nhấn vào nút **Xuất sơ đồ**, chọn mục **Các node được chọn**, sau đó chọn **Chọn trên canvas**.
  3. Dùng một ngón tay vuốt thật nhanh trên vùng canvas (fast flick) sao cho canvas tiếp tục trượt tự do theo quán tính và nhấc hẳn ngón tay lên khi màn hình còn đang chuyển động.
  4. Chờ khoảng 1 giây sau khi canvas dừng trượt hẳn, chạm nhẹ **DUY NHẤT 1 LẦN** (single tap) vào một chấm tròn chọn nhánh (branch dot).
  5. Quan sát xem nhánh đó có đổi trạng thái (chọn hoặc bỏ chọn - toggled) ngay ở lần chạm đầu tiên hay không.
  6. Lặp lại bước 3–5 đủ **5 lần thử**. Ghi nhận số lần nhánh phản hồi thành công ở lần chạm đầu tiên (ví dụ: `5/5`).
  7. **Thao tác đối chứng (Control)**: Dùng ngón tay kéo canvas chậm rãi, dừng tay lại, nhấc ngón tay ra, sau đó chạm 1 lần vào chấm tròn nhánh. Lặp lại đủ **5 lần thử**. Ghi nhận kết quả (ví dụ: `5/5`).
- **Tiêu chuẩn ĐẠT của Cổng E3**:
  - Cả 5 lần vuốt nhanh và cả 5 lần kéo chậm đều phải phản hồi ngay lần chạm đầu tiên (`5/5` và `5/5`).
  - Nếu có bất kỳ lần thử vuốt nhanh nào bị hụt (chạm lần 1 không ăn, phải chạm lần 2 mới đổi trạng thái), kết quả tính là **FAIL**.

---

### 3.4. Sheet S4: Vuốt nhanh trên iPhone thật với Safari (Cổng E3)

- **Mục tiêu**: Kiểm tra độ nhạy cảm ứng sau khi vuốt nhanh canvas trên trình duyệt WebKit của hệ điều hành iOS.
- **Chuẩn bị thiết bị**:
  - **Điện thoại iPhone thật** (ghi rõ đời máy, phiên bản iOS).
  - Trình duyệt Safari gốc trên iOS. Không dùng giả lập.
- **Các bước thực hiện**:
  - Thực hiện hoàn toàn tương tự như Sheet S3: 5 lần thử vuốt nhanh (fast flick) và 5 lần thử kéo chậm (slow pan đối chứng).
- **Tiêu chuẩn ĐẠT**:
  - Phải đạt `5/5` ở cả hàng vuốt nhanh và hàng kéo chậm. Bất kỳ lần chạm nào bị bỏ sót đều là FAIL.

---

## 4. Thứ tự thực hiện các hàng kiểm thử (Order of Rows)

Để quy trình diễn ra thuận lợi và không làm mất dữ liệu trước khi hoàn tất các bài kiểm tra khác, kiểm thử viên nên tuân thủ trình tự sau:

1. **Phần 1: Điều hướng bài trắc nghiệm và lỗi (§1 Quiz navigation and errors - Hàng 1.1 đến 1.6)**
   - Mở bài trắc nghiệm mới `/app/study/quiz/:quizId`.
   - Kiểm tra thông báo tiêu đề, điều hướng bằng phím mũi tên qua các lựa chọn, chọn đáp án và nghe thông báo lưu tự động.
   - Thử ngắt mạng tạm thời (trong DevTools hoặc tắt kết nối) để kiểm tra thông báo lỗi lưu tự động (hàng 1.5).
   - Thử nộp bài khi còn câu chưa làm để kiểm tra thông báo cảnh báo (hàng 1.6).
2. **Phần 2: Trang kết quả bài trắc nghiệm (§2 Result page - Hàng 2.1 đến 2.4)**
   - Xem kết quả bài thi trắc nghiệm khách quan: điểm số được đọc dưới dạng chữ (ví dụ: "8/10, 80%").
   - Xem bài thi có câu tự luận ngắn: thông báo trạng thái đang chấm dở, thông báo hoàn tất chấm điểm bằng live region.
   - Kiểm tra nhãn nguồn trích dẫn: "Nguồn: N đoạn" được đọc là văn bản thuần túy, không được đọc nhầm thành liên kết (link).
3. **Phần 3: Hướng dẫn ôn tập (§3 ReviewGuide - Hàng 3.1 đến 3.3)**
   - Kiểm tra cấu trúc tiêu đề (Heading) khi điều hướng bằng phím `H`.
   - Nút "Luyện ngay (5 câu)" thông báo rõ hành động và trạng thái bận "Đang soạn…".
4. **Phần 4: Thao tác trong thư viện (§4 Library actions - Hàng 4.1 đến 4.6)**
   - Vùng mốc "Bộ lọc thư viện", trạng thái nút lọc bộ sưu tập (aria-pressed).
   - Đổi tên và kiểm tra hộp thoại xóa bộ sưu tập dùng thử.
   - **Hàng 4.6**: Chuyển sang bản dựng kiểm thử Flag-ON riêng để kiểm tra việc chọn hàng loạt.
5. **Phần 5: Studio xuất sơ đồ (§5 Export Studio - Hàng 5.1 đến 5.5)**
   - Mở cửa sổ "Xuất sơ đồ" từ thanh công cụ của sơ đồ tư duy.
   - Kiểm tra các thanh chuyển phần (aria-current), nút chọn phạm vi, thông báo "Đang xuất…" và "Đã xuất: <file>".
   - Nhấn phím Escape khi đang xuất: hộp thoại không bị đóng đột ngột.
6. **Phần 6: Các hộp thoại xác nhận xóa dữ liệu (§6 Destructive dialogs - Hàng 6.1 đến 6.4)**
   - *Lưu ý*: Chỉ thực hiện trên dữ liệu dùng tạm.
   - Thử mở hộp thoại xóa bộ sưu tập, xóa sơ đồ, xóa bản tóm tắt, xóa lịch sử chat: kiểm tra xem tiêu đề và lời cảnh báo có được đọc rõ ràng, nhấn Escape tiêu điểm có quay lại đúng nút bấm mở hộp thoại hay không.
7. **Hàng bổ sung C1**:
   - Kiểm tra mở hộp thoại xóa lịch sử chat trong menu cuộc trò chuyện và nhấn phím Escape.

---

## 5. Hướng dẫn ghi nhận bằng chứng (How to Record Evidence)

Bằng chứng kiểm thử là yếu tố quyết định để nghiệm thu phát hành. Kiểm thử viên cần tuân thủ cách ghi chép sau:

1. **Tạo bản sao danh mục kiểm tra**:
   - Sao chép tệp `docs/ui-ux-v4-design/round8-4-qa-evidence/accessibility-manual-checklist.md` (28 hàng 1.1–6.4) thành một tệp báo cáo mới (ví dụ: `accessibility-manual-checklist-run-YYYYMMDD.md`), sau đó sao chép và nối thêm hàng C1 từ [human-acceptance-sheets.md](human-acceptance-sheets.md) để báo cáo có đủ 29 hàng.
2. **Ghi lại chính xác âm thanh phát ra**:
   - Tại mỗi ô kiểm tra (cột Narrator hoặc cột NVDA), ghi lại từng từ ngữ thực tế phát ra.
   - *Ví dụ chuẩn*: `PASS - Đã đọc: "Nút, Nộp bài, 8 trên 10 câu đã trả lời"`.
   - *Ví dụ không hợp lệ*: `PASS - Đọc tốt` hoặc `OK` (những ghi chú này không có giá trị đối chiếu).
3. **Đánh dấu kết quả cho từng hàng**:
   - `PASS`: Trình đọc màn hình phát âm đúng vai trò (role), trạng thái (state), nhãn (label) và nội dung theo yêu cầu; tiêu điểm bàn phím di chuyển chính xác.
   - `FAIL`: Trình đọc bị im lặng, đọc sai nhãn, đọc nhầm vai trò (ví dụ: văn bản thường bị đọc thành liên kết), mất tiêu điểm (focus bị văng về đầu trang).
   - `N/A`: Chỉ dùng khi thành phần thật sự không áp dụng cho nền tảng đang kiểm thử; ghi rõ lý do. `N/A` không tự động được tính là PASS và cần Release Owner theo dõi/chấp nhận ngoại lệ nếu dùng để quyết định phát hành.
4. **Điền thông tin vào bảng tổng hợp**:
   - Sau khi hoàn thành bản kiểm tra chi tiết, điền số lượng tổng kết `PASS / N/A / FAIL` vào bảng Sheet S1 hoặc S2 trong tệp [human-acceptance-sheets.md](human-acceptance-sheets.md) và đính kèm đường dẫn tới tệp checklist chi tiết vừa điền.

---

## 6. Quy trình báo cáo lỗi chặn phát hành (Blocker)

Nếu trong quá trình kiểm thử, bạn phát hiện bất kỳ lỗi nào thuộc các trường hợp sau:
- Trình đọc màn hình bị im lặng hoàn toàn khi di chuyển vào các nút thao tác chính hoặc hộp thoại xác nhận xóa.
- Bị kẹt tiêu điểm bàn phím (keyboard trap), không thể dùng phím Tab hay Escape để thoát ra.
- Thao tác vuốt nhanh trên điện thoại thật (S3 hoặc S4) bị hụt lần chạm đầu tiên (miss 1st tap).
- Xảy ra lỗi làm sập giao diện hoặc mất dữ liệu ngoài ý muốn.

### Các bước báo cáo Blocker:

1. **Tạm dừng kiểm thử mục bị lỗi**: Đánh dấu `FAIL` vào hàng tương ứng trong bảng kiểm.
2. **Thu thập thông tin chi tiết**:
   - **Mã số hàng bị lỗi**: Ví dụ: `1.5`, `4.3`, hoặc `S3 Vuốt nhanh lần 2`.
   - **Câu phát ra thực tế hoặc hiện tượng**: Ghi lại nguyên văn những gì nghe thấy hoặc ghi nhận sự im lặng / hiện tượng kẹt.
   - **Ảnh chụp hoặc video quay màn hình**:
     - Với lỗi E4: Ảnh chụp vị trí con trỏ tiêu điểm trên màn hình.
     - Với lỗi E3 (chạm không ăn): Bắt buộc quay lại video màn hình có hiển thị chấm chạm cảm ứng (Show taps) để chứng minh ngón tay đã chạm nhưng màn hình không phản hồi.
   - **Thông tin thiết bị và phiên bản**:
     - Thiết bị, hệ điều hành (phiên bản Windows build, phiên bản Android, iOS).
     - Trình duyệt và phiên bản (Chrome, Edge, Safari).
     - Phiên bản trình đọc màn hình (NVDA version).
     - Frontend SHA và Backend SHA đang kiểm thử.
3. **Gửi báo cáo ngay cho Release Owner**:
   - Gửi báo cáo qua kênh liên lạc của dự án với tiêu đề: `[BLOCKER - S1-S4 QA] <Tên lỗi> - Hàng <Mã số hàng>`.
   - Chờ chỉ dẫn từ phụ trách phát hành trước khi tiếp tục các phần kiểm thử liên quan.

---

## 7. Tài liệu liên kết tham chiếu

- [human-acceptance-sheets.md](human-acceptance-sheets.md): Bảng biểu điền kết quả tổng hợp dành cho S1, S2, S3, S4.
- [accessibility-manual-checklist.md](../round8-4-qa-evidence/accessibility-manual-checklist.md): Danh mục 28 hàng kiểm tra chi tiết từ 1.1 đến 6.4; hàng C1 nằm riêng trong [human-acceptance-sheets.md](human-acceptance-sheets.md), nâng tổng báo cáo lên 29 hàng.
- [final-acceptance.md](final-acceptance.md): Ma trận 12 cổng phát hành và điều kiện nghiệm thu phiên bản StudyMap V4.
