# Bàn giao kiểm thử người thật S1–S4

Tài liệu này dành cho người kiểm thử không chuyên lập trình. Mọi ô chưa có bằng chứng thật phải giữ là **NOT VERIFIED**. Playwright, ảnh fixture, giả lập thiết bị và cây trợ năng không phải kết quả nghiệm thu.

## 1. Phân công

Release Owner điền bảng trước khi bắt đầu. Không điền tên, thiết bị hoặc kết quả theo suy đoán.

| Sheet | Môi trường bắt buộc | Tên tester | Thiết bị | Hệ điều hành | Trình duyệt + phiên bản | FE SHA | BE SHA | Ngày (UTC) | Trạng thái |
|---|---|---|---|---|---|---|---|---|---|
| S1 | Máy Windows 11, NVDA, Chrome |  |  |  |  |  |  |  | NOT VERIFIED |
| S2 | Máy Windows 11, Narrator, Edge |  |  |  |  |  |  |  | NOT VERIFIED |
| S3 | Điện thoại Android thật, Chrome |  |  |  |  |  |  |  | NOT VERIFIED |
| S4 | iPhone thật, Safari |  |  |  |  |  |  |  | NOT VERIFIED |

Với S1 và S2, ghi thêm phiên bản NVDA hoặc Windows Narrator trong tệp kết quả chi tiết. Với hàng 4.6, ghi riêng URL và SHA của test build bật Library flag; không thay FE SHA/BE SHA production trong bảng trên bằng SHA test build.

## 2. Dữ liệu QA do Release Owner chuẩn bị

Chỉ chuẩn bị dữ liệu giả trên tài khoản QA do Release Owner cấp. Không tự tạo tài khoản production, không sao chép dữ liệu thật và không dùng thông tin cá nhân.

| Phần kiểm thử | Tài liệu hoặc trạng thái cần có trước khi chạy |
|---|---|
| §1 Quiz | Một quiz đang làm có nhiều lựa chọn, còn ít nhất một câu chưa trả lời; có thể tạm ngắt mạng để kiểm tra lỗi lưu và cảnh báo khi nộp thiếu. |
| §2 Result | Một lượt quiz khách quan đã nộp; một lượt có câu trả lời ngắn để quan sát trạng thái đang chấm rồi hoàn tất; có phần xem lại từng câu và nhãn “Nguồn: N đoạn”. |
| §3 ReviewGuide | Một lượt làm bài đã có trang hướng dẫn ôn tập, danh sách nhiệm vụ và nút “Luyện ngay (5 câu)”. |
| §4 Library | Ít nhất hai collection dùng tạm hoặc một collection cùng nút “Tạo bộ sưu tập”; có mục có thể đổi tên/xóa. Hàng 4.6 cần dữ liệu chọn hàng loạt trên test build bật Library flag. |
| §5 Export Studio | Một mind map dùng tạm có nhiều nhánh/node để mở “Xuất sơ đồ”, đổi phần/phạm vi và thử trạng thái xuất. |
| §6 và C1 | Collection, mind map, summary và chat có vài tin nhắn, tất cả đều là dữ liệu dùng tạm và được phép xóa. |
| S3–S4 | Cùng một mind map dùng tạm, có canvas đủ rộng và các chấm chọn nhánh để chạy 5 lần fast flick và 5 lần slow pan trên mỗi điện thoại. |

Release Owner cần khôi phục dữ liệu đã bị xóa trước khi giao cùng tài khoản cho lượt tester tiếp theo. Không chạy đồng thời trên một tài khoản nếu thao tác của người này có thể thay đổi dữ liệu của người kia.

## 3. Yêu cầu tài khoản kiểm thử

- Tối thiểu **1 tài khoản QA dùng một lần** nếu S1–S4 chạy tuần tự. Nếu chạy đồng thời, Release Owner cấp **1 tài khoản riêng cho mỗi tester đang chạy**.
- Tài khoản ở trạng thái đăng nhập như một người học thông thường và có quyền tạo, xem, đổi tên, xuất và xóa chính bộ dữ liệu QA của nó. Không cần và không được cấp quyền quản trị hoặc quyền truy cập dữ liệu người dùng khác.
- Chỉ Release Owner cấp thông tin đăng nhập, chuẩn bị dữ liệu và xác nhận phạm vi được phép xóa. Tester không tự đăng ký tài khoản production, không đổi email/mật khẩu, không thêm dữ liệu cá nhân, không chia sẻ thông tin đăng nhập ngoài nhóm được chỉ định và không giữ bản tải xuống sau khi kết thúc.
- Không bật Library flag trên production. Tài khoản dùng cho hàng 4.6 chỉ truy cập test build riêng do Release Owner cung cấp.

## 4. Ghi kết quả và gửi bằng chứng

1. Trước khi chạy, ghi tester, ngày UTC, thiết bị, phiên bản OS/trình duyệt, FE SHA từ thẻ meta và BE SHA từ `/health`. Không điền giá trị chưa trực tiếp kiểm tra.
2. Với S1/S2, tạo bản sao của [accessibility-manual-checklist.md](../round8-4-qa-evidence/accessibility-manual-checklist.md), điền từng hàng 1.1–6.4 và C1. Ghi nguyên văn lời trình đọc màn hình phát ra, trạng thái **PASS**, **FAIL** hoặc **N/A**, và lý do nếu FAIL/N/A.
3. Với S3/S4, ghi riêng từng lần thử: 5 fast flick và 5 slow pan. Video phải cho thấy thao tác chạm và phản hồi màn hình. Chỉ `5/5` ở cả hai nhóm mới thỏa tiêu chí; một lần hụt chạm đầu tiên là FAIL.
4. Ảnh chụp dùng để chỉ vị trí/focus; video dùng cho trình tự tương tác hoặc lỗi chạm. Không dùng ảnh fixture, Playwright, giả lập hoặc kết quả do agent tạo thay cho bằng chứng người thật.
5. Gửi tệp checklist đã điền và liên kết ảnh/video vào kênh dự án **do Release Owner chỉ định**, với tiêu đề `[S1-S4 QA] <sheet> - <PASS|FAIL> - <ngày UTC>`. Nếu FAIL, nêu mã hàng, hiện tượng/lời đọc nguyên văn, môi trường, FE SHA và BE SHA. Không tải bằng chứng có dữ liệu cá nhân lên nơi công khai.
6. Chỉ đánh dấu PASS sau khi bằng chứng từng hàng đã được đính kèm. Thiếu tester, thiết bị, SHA hoặc bằng chứng thì giữ **NOT VERIFIED**.

### Blocker của hàng 4.6

Hàng 4.6 chỉ được chạy trên test build có Library Action Matrix flag **ON**. Test build đó **chưa tồn tại**; Release Owner phải cung cấp URL và SHA riêng trước khi S1/S2 có thể hoàn tất. Cho đến lúc đó, hàng 4.6 và kết quả tổng S1/S2 phải giữ **NOT VERIFIED**, tuyệt đối không giả định PASS và không bật flag trên production.

Biểu mẫu kết quả gốc: [human-acceptance-sheets.md](human-acceptance-sheets.md).
