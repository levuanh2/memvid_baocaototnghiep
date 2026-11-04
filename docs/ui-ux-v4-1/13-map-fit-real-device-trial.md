# Thử nghiệm map-fit Option B và Option A trên thiết bị thật

Mục tiêu là so sánh **Option B trước, sau đó Option A**, trên đúng cùng dữ liệu, cùng thiết bị và cùng hướng màn hình. Đây là thử nghiệm người thật trên điện thoại thật; ảnh fixture, Playwright, DevTools Device Mode và giả lập **không được tính là kết quả**.

## 1. Đầu vào chạy thử

> **PLACEHOLDER — NOT VERIFIED:** Chưa có `DONE-R5-trial.md`. Khi báo cáo đó xuất hiện, Release Owner chép nguyên văn URL, lệnh khởi chạy và SHA của Option B/Option A vào bảng dưới; không tự đoán lệnh hoặc URL.

| Đầu vào | Option B | Option A |
|---|---|---|
| URL | CHỜ `DONE-R5-trial.md` | CHỜ `DONE-R5-trial.md` |
| Lệnh khởi chạy | CHỜ `DONE-R5-trial.md` | CHỜ `DONE-R5-trial.md` |
| FE SHA / nhãn build | NOT VERIFIED | NOT VERIFIED |
| Dữ liệu map dùng chung |  |  |

Không có URL/build thật thì không chạy và không ghi PASS. Nếu trial build chỉ truy cập được trong mạng nội bộ, Release Owner hướng dẫn cách kết nối; tester không tự deploy và không thay đổi production.

## 2. Quy trình chung

1. Release Owner chuẩn bị một mind map QA không có dữ liệu cá nhân. Dùng chính map đó cho cả B và A.
2. Trên cùng điện thoại, cùng trình duyệt và cùng hướng màn hình, mở Option B. Tải lại trang, không zoom trước, rồi hoàn tất toàn bộ biểu mẫu của thiết bị.
3. Mở Option A với đúng dữ liệu và điều kiện trên, tải lại trang rồi hoàn tất cùng biểu mẫu.
4. Đo `window.innerWidth` thật bằng cách do trial build/Release Owner cung cấp và ghi số **CSS px** nhìn thấy. Chỉ ghi `320` hoặc khoảng `390` khi thiết bị thực sự trả về giá trị đó; nếu không đo được, ghi **NOT VERIFIED**.
5. Đọc chữ ở khoảng cách cầm điện thoại bình thường (xấp xỉ một cánh tay), tìm mọi nhánh bị khuất, rồi thử pan, pinch, nút zoom, chạm node, marker và connector.
6. Quay video liên tục đủ để nhận biết build B/A, thao tác tay và phản hồi. Không dùng ảnh tự động làm kết luận.

## 3. Biểu mẫu Android thật

| Trường | Option B | Option A |
|---|---|---|
| Tester / ngày UTC |  |  |
| Model / Android / Chrome |  |  |
| `window.innerWidth` thực (CSS px) | NOT VERIFIED | NOT VERIFIED |
| Cỡ chữ quan sát được; đọc ở khoảng cách một cánh tay | NOT VERIFIED | NOT VERIFIED |
| Nhánh bị khuất; cách tìm thấy nhánh | NOT VERIFIED | NOT VERIFIED |
| Pan một ngón tay | NOT VERIFIED | NOT VERIFIED |
| Pinch zoom | NOT VERIFIED | NOT VERIFIED |
| Nút zoom `+` / `−` / fit (nếu có) | NOT VERIFIED | NOT VERIFIED |
| Chạm một node để chọn | NOT VERIFIED | NOT VERIFIED |
| Marker chọn có che chữ/node khác không | NOT VERIFIED | NOT VERIFIED |
| Chạm gần/trên connector có bị connector “nuốt” tap không | NOT VERIFIED | NOT VERIFIED |
| Liên kết video/ảnh thật |  |  |
| Ghi chú lỗi và bước lặp lại |  |  |

**Kết luận Android (chọn sau khi có bằng chứng):** ☐ B tốt hơn ☐ A tốt hơn ☐ tương đương ☐ chưa thể kết luận — **NOT VERIFIED**

Lý do:

## 4. Biểu mẫu iPhone thật

| Trường | Option B | Option A |
|---|---|---|
| Tester / ngày UTC |  |  |
| Model / iOS / Safari |  |  |
| `window.innerWidth` thực (CSS px) | NOT VERIFIED | NOT VERIFIED |
| Cỡ chữ quan sát được; đọc ở khoảng cách một cánh tay | NOT VERIFIED | NOT VERIFIED |
| Nhánh bị khuất; cách tìm thấy nhánh | NOT VERIFIED | NOT VERIFIED |
| Pan một ngón tay | NOT VERIFIED | NOT VERIFIED |
| Pinch zoom | NOT VERIFIED | NOT VERIFIED |
| Nút zoom `+` / `−` / fit (nếu có) | NOT VERIFIED | NOT VERIFIED |
| Chạm một node để chọn | NOT VERIFIED | NOT VERIFIED |
| Marker chọn có che chữ/node khác không | NOT VERIFIED | NOT VERIFIED |
| Chạm gần/trên connector có bị connector “nuốt” tap không | NOT VERIFIED | NOT VERIFIED |
| Liên kết video/ảnh thật |  |  |
| Ghi chú lỗi và bước lặp lại |  |  |

**Kết luận iPhone (chọn sau khi có bằng chứng):** ☐ B tốt hơn ☐ A tốt hơn ☐ tương đương ☐ chưa thể kết luận — **NOT VERIFIED**

Lý do:

## 5. Quy tắc kết luận chung

- Chỉ đưa ra lựa chọn A/B khi **cả hai option đã chạy trên cùng dữ liệu trên từng thiết bị thật** và có bằng chứng kèm theo.
- Không suy rộng kết quả Android sang iPhone hoặc ngược lại.
- Nếu thiếu một option, không đo được viewport, thiếu video hoặc không có đúng loại thiết bị, ghi **NOT VERIFIED**.
- Kết luận cuối cùng phải nêu khác biệt về độ đọc được, khả năng tìm nhánh, điều khiển viewport và độ chính xác của tap; không chỉ ghi “cảm giác tốt hơn”.
