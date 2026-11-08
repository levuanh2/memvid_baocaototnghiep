# Thử nghiệm map-fit Option B và Option A trên thiết bị thật

Mục tiêu là so sánh **Option B trước, sau đó Option A**, trên đúng cùng dữ liệu, cùng thiết bị và cùng hướng màn hình. Đây là thử nghiệm người thật trên điện thoại thật; ảnh fixture, Playwright, DevTools Device Mode và giả lập **không được tính là kết quả**.

## 1. Đầu vào chạy thử

Nguồn: branch `trial/map-fit-options`, HEAD cuối đã push `106eb17a0dfb8315671c45c07207fe9d064d8a7a`. Branch này chỉ dùng để thử nghiệm; không merge hoặc deploy.

Các lựa chọn `fit=main|a|b` chỉ tồn tại trong `fixture-harness.html`; route production không nhận tùy chọn trial. Tester phải dùng đúng URL bên dưới, không thử bật Option A/B trên production.

Release Owner khởi chạy trên máy chứa worktree:

```powershell
cd E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\v41-map-fit-trial\FE
npx vite --config vite.trial.config.js --host --port 5250 --strictPort
```

Sau khi Vite chạy, người vận hành làm đúng các bước sau:

1. Chạy `ipconfig` trên máy host. Tìm adapter **Wireless LAN adapter Wi-Fi** đang hoạt động và chép đúng dòng **IPv4 Address**. Không lấy địa chỉ của adapter đang ngắt, VPN, WSL, Docker hoặc một lần thử cũ.
2. Xác nhận điện thoại và máy host đang ở **cùng mạng Wi-Fi**. Ghi tên mạng theo cách không lộ mật khẩu; không đoán chỉ từ việc hai địa chỉ trông giống nhau.
3. Thay `<active-ip>` trong ba URL `fit=main|b|a` bên dưới bằng IPv4 vừa đọc, ví dụ dạng `192.168.x.x` hoặc `10.x.x.x`.
4. Kiểm tra từng URL trả HTTP 200, rồi mở trên điện thoại và xác nhận trang thật sự tải được, có canvas/map và đúng nhãn build. HTTP 200 một mình chưa đủ nếu điện thoại chỉ hiện trang trắng hoặc lỗi tải tài nguyên.
5. Nếu điện thoại không truy cập được, ghi **BLOCKED** kèm IPv4, thời điểm, URL và hiện tượng; kết quả thiết bị vẫn **NOT VERIFIED**. Không mở port ra Internet, không đổi DNS và không tự deploy để né lỗi LAN.

Địa chỉ `10.10.10.249`, nếu xuất hiện trong bằng chứng cũ, chỉ là ví dụ lịch sử và **không được bảo đảm còn đúng**. Luôn đọc lại bằng `ipconfig` trong ngày chạy.

| Đầu vào | Option B | Option A |
|---|---|---|
| URL local | `http://localhost:5250/fixture-harness.html?fit=b` | `http://localhost:5250/fixture-harness.html?fit=a` |
| URL LAN cho điện thoại thật | `http://<active-ip>:5250/fixture-harness.html?fit=b` | `http://<active-ip>:5250/fixture-harness.html?fit=a` |
| Lệnh khởi chạy | Lệnh Vite phía trên | Lệnh Vite phía trên |
| FE SHA / nhãn build | `106eb17a0dfb` / Option B | `106eb17a0dfb` / Option A |
| Dữ liệu map dùng chung |  |  |

| Kiểm tra kết nối trong ngày chạy | Giá trị |
|---|---|
| IPv4 của Wi-Fi đang hoạt động |  |
| Điện thoại và host cùng Wi-Fi | ☐ Đã xác nhận |
| `fit=main` — HTTP 200 / tải được trên điện thoại | NOT VERIFIED / NOT VERIFIED |
| `fit=b` — HTTP 200 / tải được trên điện thoại | NOT VERIFIED / NOT VERIFIED |
| `fit=a` — HTTP 200 / tải được trên điện thoại | NOT VERIFIED / NOT VERIFIED |
| Blocker nếu không truy cập được |  |

URL đối chứng main là `http://localhost:5250/fixture-harness.html?fit=main` trên máy host hoặc `http://<active-ip>:5250/fixture-harness.html?fit=main` trên điện thoại. Báo cáo trial chỉ xác minh một địa chỉ LAN của máy host tại thời điểm chạy; địa chỉ đó có thể thay đổi nên không được hardcode vào hướng dẫn. Không truy cập được thì ghi NOT VERIFIED, không tự deploy và không thay đổi production.

Các số đo fixture ở 320/390 và kết quả Playwright 13/13 PASS chỉ giúp xác minh build, **không phải kết quả thiết bị thật**. Không có điện thoại thật thì giữ **NOT VERIFIED**. Không được thay đổi hoặc merge #130 chỉ từ kết quả mô phỏng.

### Trạng thái panel viewport — đã push và qua cổng tự động

Panel ở HEAD sạch `106eb17a0dfb8315671c45c07207fe9d064d8a7a` hiển thị ngay trên màn hình: chiều rộng CSS, chiều cao CSS, DPR, Option A/B và SHA `106eb17a0dfb`. Tải lại trang làm panel xuất hiện lại. Nút **Bắt đầu thử** xóa panel khỏi DOM và cú chạm không truyền xuống canvas. Tester chỉ đọc panel này, không mở DevTools và không chạy JavaScript.

Các cổng hình học chính xác tại 320 px và 390 px cho cả Option A và Option B đều xanh; các số đo #147 không thay đổi. Toàn bộ Playwright `map-fit-trial.spec.js` PASS **13/13**. RED proof xác nhận regression có ý nghĩa: khi bỏ panel khỏi source, test panel thất bại.

Kết quả Playwright trên chỉ xác minh build và hình học tự động; không thay thế thử nghiệm người thật trên điện thoại thật. Các biểu mẫu Android/iPhone bên dưới vẫn **NOT VERIFIED** cho đến khi có người và thiết bị thật.

## 2. Quy trình chung

1. Release Owner chuẩn bị một mind map QA không có dữ liệu cá nhân. Dùng chính map đó cho cả B và A.
2. Trên cùng điện thoại, cùng trình duyệt và cùng hướng màn hình, mở Option B. Tải lại trang, không zoom trước, rồi hoàn tất toàn bộ biểu mẫu của thiết bị.
3. Mở Option A với đúng dữ liệu và điều kiện trên, tải lại trang rồi hoàn tất cùng biểu mẫu.
4. Đọc viewport từ panel hiển thị ngay trên màn hình trial; tester không mở DevTools và không chạy JavaScript. Ghi số **CSS px** nhìn thấy. Chỉ ghi `320` hoặc khoảng `390` khi panel thực sự hiện giá trị đó; nếu không đọc được, ghi **NOT VERIFIED**.
5. Đọc chữ ở khoảng cách cầm điện thoại bình thường (xấp xỉ một cánh tay). Ghi riêng độ đọc được của node gốc và các node cấp 1; tìm mọi nhánh bị khuất và mô tả cách phát hiện chúng.
6. Thử pan một ngón tay, pinch zoom, từng nút zoom/fit, một lần chạm đơn, chọn node và chọn marker. Ghi connector có nuốt chạm hay marker có che chữ/node khác không.
7. Nếu chính sách và người tham gia cho phép, quay một video ngắn đủ để nhận biết build B/A, thao tác tay và phản hồi. Nếu không được phép quay, ghi lý do và loại bằng chứng thay thế; không dùng ảnh tự động làm kết luận.

Panel viewport và SHA của trial build: **READY FOR REAL-DEVICE TRIAL — HEAD `106eb17a0dfb8315671c45c07207fe9d064d8a7a`, nhãn sạch `106eb17a0dfb`; mở `fit=b` trước rồi `fit=a` trên cùng thiết bị**.

## 3. Biểu mẫu Android thật

| Trường | Option B | Option A |
|---|---|---|
| Tester / ngày UTC |  |  |
| Model / Android / Chrome |  |  |
| `window.innerWidth` thực (CSS px) | NOT VERIFIED | NOT VERIFIED |
| Node gốc: cỡ chữ/độ đọc được ở khoảng cách một cánh tay | NOT VERIFIED | NOT VERIFIED |
| Node cấp 1: cỡ chữ/độ đọc được ở khoảng cách một cánh tay | NOT VERIFIED | NOT VERIFIED |
| Nhánh bị khuất; cách tìm thấy nhánh | NOT VERIFIED | NOT VERIFIED |
| Pan một ngón tay | NOT VERIFIED | NOT VERIFIED |
| Pinch zoom | NOT VERIFIED | NOT VERIFIED |
| Nút zoom `+` / `−` / fit (nếu có) | NOT VERIFIED | NOT VERIFIED |
| Một lần chạm đơn trên canvas | NOT VERIFIED | NOT VERIFIED |
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
| Node gốc: cỡ chữ/độ đọc được ở khoảng cách một cánh tay | NOT VERIFIED | NOT VERIFIED |
| Node cấp 1: cỡ chữ/độ đọc được ở khoảng cách một cánh tay | NOT VERIFIED | NOT VERIFIED |
| Nhánh bị khuất; cách tìm thấy nhánh | NOT VERIFIED | NOT VERIFIED |
| Pan một ngón tay | NOT VERIFIED | NOT VERIFIED |
| Pinch zoom | NOT VERIFIED | NOT VERIFIED |
| Nút zoom `+` / `−` / fit (nếu có) | NOT VERIFIED | NOT VERIFIED |
| Một lần chạm đơn trên canvas | NOT VERIFIED | NOT VERIFIED |
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
