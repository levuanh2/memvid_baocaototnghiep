# Bàn giao kiểm thử người thật S1–S4

Tài liệu này dành cho người kiểm thử không chuyên lập trình. Mọi ô chưa có bằng chứng thật phải giữ là **NOT VERIFIED**. Playwright, ảnh fixture, giả lập thiết bị và cây trợ năng không phải kết quả nghiệm thu.

## 1. Phân công

Release Owner điền bảng trước khi bắt đầu. Không điền tên, thiết bị hoặc kết quả theo suy đoán.

| Sheet | Môi trường bắt buộc | Tên tester | Thiết bị | Hệ điều hành | Trình duyệt + phiên bản | FE SHA | BE SHA | Ngày (UTC) | Trạng thái |
|---|---|---|---|---|---|---|---|---|---|
| S1 | Máy Windows 11, NVDA, Chrome | UNASSIGNED |  |  |  |  |  |  | NOT VERIFIED |
| S2 | Máy Windows 11, Narrator, Edge | UNASSIGNED |  |  |  |  |  |  | NOT VERIFIED |
| S3 | Điện thoại Android thật, Chrome | UNASSIGNED |  |  |  |  |  |  | NOT VERIFIED |
| S4 | iPhone thật, Safari | UNASSIGNED |  |  |  |  |  |  | NOT VERIFIED |

Với S1 và S2, ghi thêm phiên bản NVDA hoặc Windows Narrator trong tệp kết quả chi tiết. Với hàng 4.6, ghi riêng URL và SHA của test build bật Library flag; không thay FE SHA/BE SHA production trong bảng trên bằng SHA test build.

## 2. Checklist tài khoản và dữ liệu QA do Release Owner chuẩn bị

Release Owner duyệt phạm vi trước, tạo tài khoản QA dùng một lần và gửi thông tin đăng nhập qua kênh bảo mật do owner chỉ định. Không dùng tài khoản production hoặc seed dữ liệu production nếu chưa có phê duyệt riêng, không sao chép dữ liệu thật và không dùng thông tin cá nhân.

Trước khi giao tài khoản, Release Owner đánh dấu từng dòng dưới đây. Dòng nào chưa sẵn sàng thì sheet liên quan vẫn là **NOT VERIFIED**.

| Dữ liệu mẫu bắt buộc | Phạm vi dùng | Owner xác nhận |
|---|---|---|
| Collection mẫu có thể đổi tên và xóa; có thêm nút “Tạo bộ sưu tập” hoặc collection kế bên để kiểm tra focus sau khi xóa | §4, §6.1 | ☐ |
| Mind Map mẫu có nhiều nhánh/node, đủ rộng để chọn node, xuất và chạy fast flick/slow pan | §5, §6.2, S3–S4 | ☐ |
| Summary mẫu được phép xóa | §6.3 | ☐ |
| Chat history có vài tin nhắn và được phép xóa | §6.4, C1 | ☐ |
| Quiz đang làm, còn ít nhất một câu chưa trả lời | §1 | ☐ |
| Quiz đã hoàn thành với trạng thái chấm phù hợp: một lượt khách quan và một lượt có câu trả lời ngắn để quan sát đang chấm rồi hoàn tất; có review từng câu và “Nguồn: N đoạn” | §2, §3 | ☐ |
| Dữ liệu riêng để thử các hộp thoại xác nhận xóa; owner xác nhận rõ từng mục được phép xóa | §4.3–4.5, §6.1–6.4, C1 | ☐ |
| Dữ liệu chọn hàng loạt trên test build Library flag ON | §4.6 | ☐ |

Release Owner cần khôi phục dữ liệu đã bị xóa trước khi giao cùng tài khoản cho lượt tester tiếp theo. Không chạy đồng thời trên một tài khoản nếu thao tác của người này có thể thay đổi dữ liệu của người kia.

## 3. Yêu cầu tài khoản kiểm thử

- Tối thiểu **1 tài khoản QA dùng một lần** nếu S1–S4 chạy tuần tự. Nếu chạy đồng thời, Release Owner cấp **1 tài khoản riêng cho mỗi tester đang chạy**, sau khi owner duyệt và gửi qua kênh bảo mật.
- Tài khoản ở trạng thái đăng nhập như một người học thông thường và có quyền tạo, xem, đổi tên, xuất và xóa chính bộ dữ liệu QA của nó. Không cần và không được cấp quyền quản trị hoặc quyền truy cập dữ liệu người dùng khác.
- Chỉ Release Owner cấp thông tin đăng nhập, chuẩn bị dữ liệu và xác nhận phạm vi được phép xóa. Tester không tự đăng ký tài khoản production, không đổi email/mật khẩu, không thêm dữ liệu cá nhân, không chia sẻ thông tin đăng nhập ngoài nhóm được chỉ định và không giữ bản tải xuống sau khi kết thúc.
- Không bật Library flag trên production. Tài khoản dùng cho hàng 4.6 chỉ truy cập test build riêng do Release Owner cung cấp.

## 4. Ghi kết quả và gửi bằng chứng

1. Trước khi chạy, ghi tester, ngày UTC, thiết bị, phiên bản OS/trình duyệt, FE SHA từ thẻ meta và BE SHA từ `/health`. Không điền giá trị chưa trực tiếp kiểm tra.
2. Với S1/S2, tạo bản sao của [accessibility-manual-checklist.md](../round8-4-qa-evidence/accessibility-manual-checklist.md), điền từng hàng 1.1–6.4 và C1. Với **mỗi dòng**, ghi nguyên văn lời trình đọc màn hình phát ra, trạng thái **PASS**, **FAIL** hoặc **N/A**, bằng chứng và lý do nếu FAIL/N/A.
3. Với S3/S4, ghi riêng từng lần thử: 5 fast flick và 5 slow pan. Video phải cho thấy thao tác chạm và phản hồi màn hình. Chỉ `5/5` ở cả hai nhóm mới thỏa tiêu chí; một lần hụt chạm đầu tiên là FAIL.
4. Ảnh chụp dùng để chỉ vị trí/focus; video dùng cho trình tự tương tác hoặc lỗi chạm. Không dùng ảnh fixture, Playwright, giả lập hoặc kết quả do agent tạo thay cho bằng chứng người thật.
5. Gửi tệp checklist đã điền và liên kết ảnh/video vào kênh dự án **do Release Owner chỉ định**, với tiêu đề `[S1-S4 QA] <sheet> - <PASS|FAIL> - <ngày UTC>`. Nếu FAIL, nêu mã hàng, hiện tượng/lời đọc nguyên văn, môi trường, FE SHA và BE SHA. Không tải bằng chứng có dữ liệu cá nhân lên nơi công khai.
6. Chỉ đánh dấu PASS sau khi bằng chứng từng hàng đã được đính kèm. Thiếu tester, thiết bị, SHA hoặc bằng chứng thì giữ **NOT VERIFIED**.

### Test build cho hàng 4.6

Hàng 4.6 chỉ được chạy trên test build có Library Action Matrix flag **ON**. Release Owner phải ghi URL, SHA, trạng thái flag và cách rollback của build riêng tại đây trước khi S1/S2 bắt đầu:

| Trường | Giá trị |
|---|---|
| URL test build | **BLOCKED — chưa có build đang chạy.** URL dự kiến sau khi xác minh: `http://<IPv4-từ-ipconfig>:5251/`; loopback: `http://localhost:5251/`. |
| SHA | Source cố định dự kiến: `973fd2c19b4d8985008212d9cfb6c116b63426af`; **chưa có output build SHA đã xác minh**. |
| Library flag | Build chưa được tạo. Khi chạy: `VITE_LIBRARY_ACTION_MATRIX=true` ở build time; production vẫn OFF. |
| Rollback | Dừng Vite preview/backend bằng `Ctrl+C`, chỉ dừng container DB do task tạo, rồi gỡ detached worktree sau khi xác nhận không còn process dùng nó. Không có rollback production vì flag chưa từng bật ở đó. |
| Kế hoạch gỡ blocker | Tạo detached worktree đúng source SHA; xác minh local test Postgres; chạy backend với DB test cô lập và graph mock; build FE với flag ON; chạy preview port 5251; tạo tài khoản/dữ liệu QA dùng một lần qua local API; kiểm tra Matrix hiện, chọn hàng và số lượng đã chọn; sau đó mới ghi URL, backend port, seed command và output SHA thật. |

Hàng 4.6 **không bao giờ là PASS nếu chưa có một người thật chạy và ghi bằng chứng từng dòng**. Build tự động, Playwright hoặc agent chỉ chuẩn bị môi trường, không phải kết quả nghiệm thu.

Biểu mẫu kết quả gốc: [human-acceptance-sheets.md](human-acceptance-sheets.md).
