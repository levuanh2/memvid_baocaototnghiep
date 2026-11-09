# RELEASE ACCEPTANCE FREEZE

Trạng thái: **RELEASE ACCEPTANCE FREEZE**.

## Baseline và cách đọc phiên bản

- Baseline là **merge commit của PR #145**. Ngay sau khi merge, Release Owner ghi chính xác baseline SHA và các FE/BE SHA quan sát được, vừa trong comment của #145 vừa trong tin nhắn bàn giao cho tester. `main` không nhận thêm commit trong thời gian nghiệm thu.
- Tester đọc FE SHA từ thẻ meta `studymap-build` trên trang và BE SHA từ trường `revision` của `/health`. Hai SHA có thể khác nhau; ghi cả hai, không suy đoán từ tên branch hoặc thời gian deploy.
- Library flag giữ **OFF trên production**. Hàng 4.6 dùng test build riêng theo `s1-s4-handoff.md`.

## Quy tắc freeze

- Không merge bất kỳ PR nào, kể cả PR chỉ đổi tài liệu, trong thời gian nghiệm thu.
- Không thay branch protection, workflow CI hoặc required checks.
- Không manual deploy và không thay cấu hình production.
- Có thể tiếp tục làm bản nháp trên branch riêng, miễn là không merge vào `main`.
- Chỉ được phá freeze vì lỗi nghiêm trọng, sau khi có phê duyệt riêng của owner và kế hoạch chạy lại mọi sheet bị ảnh hưởng. Ghi rõ lỗi, PR/SHA sửa, các sheet phải chạy lại và người chịu trách nhiệm trước khi thay đổi baseline.

## Trạng thái các wave và PR

- Wave 1 (`#122 → #126 → #134 → #129 → #128`): **WAITING FOR HUMAN ACCEPTANCE**. Không PR nào trong wave được phép merge trong freeze.
- #146 giữ **Draft** đến khi freeze kết thúc. Sau đó cập nhật branch từ `main`, chạy lại `CI / required` và **Full Fixture Audit**, rồi mới được xin phép merge.
- Library vẫn OFF trên production.
- V4 vẫn **CONDITIONAL** cho đến khi các gate người thật và các blocker còn lại được owner xử lý.

Freeze kết thúc chỉ khi Release Owner ghi quyết định bằng văn bản và baseline/kết quả nghiệm thu đã được lưu đầy đủ.
