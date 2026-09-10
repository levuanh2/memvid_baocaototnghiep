# MemVidX — Security Posture

Phase 6 (Production Readiness). Ghi lại đúng những gì đã đọc trong mã nguồn —
không có mục nào ở đây là dự đoán. Mỗi mục trỏ tới `file:line` để tự kiểm lại
được. Đây là báo cáo, không phải bản sửa: theo đúng ràng buộc "No feature work.
Only report or fix" của Phase 6, những phát hiện dưới đây chỉ được SỬA nếu an
toàn tuyệt đối (không đổi API, không đổi schema, không đổi hành vi đăng nhập).

## Mục lục
1. [Xác thực (Authentication)](#xác-thực-authentication)
2. [Phân quyền (Authorization)](#phân-quyền-authorization)
3. [CORS](#cors)
4. [Giới hạn tần suất (Rate limiting)](#giới-hạn-tần-suất-rate-limiting)
5. [Tải lên tệp (Upload)](#tải-lên-tệp-upload)
6. [Bí mật (Secrets)](#bí-mật-secrets)
7. [Lưu trữ phía trình duyệt (Client storage)](#lưu-trữ-phía-trình-duyệt-client-storage)
8. [Khoảng trống đã biết](#khoảng-trống-đã-biết)

---

## Xác thực (Authentication)

JWT, không phải session cookie. Mọi route cần đăng nhập đều gọi
`_require_app_user` (`BE/app/main.py`, 81 lượt gọi trong file này) — hàm đọc
header `Authorization: Bearer <token>`, xác minh chữ ký, trả 401 nếu thiếu/hỏng.
Frontend giữ token qua `FE/src/auth/tokenStore.js` và đính kèm ở `apiFetch`
(`FE/src/utils/api.js`) — một điểm gắn header duy nhất, không có nơi thứ hai tự
đính token.

## Phân quyền (Authorization)

Dữ liệu tài liệu/tiến độ khoá theo `user_id` ở tầng repository (ví dụ
`BE/app/domains/documents/repository.py::tri_thuc_tho` lọc theo `user_id` ngay
trong câu truy vấn, không lọc lại ở tầng trên) — đúng nguyên tắc "lọc ở nguồn,
không lọc ở client".

## CORS

`BE/app/main.py:128-135`:

```python
_cors_origins_raw = (os.environ.get("CORS_ORIGINS") or "*").strip()
```

Không đặt `CORS_ORIGINS` thì mặc định mở cho MỌI origin (`*`). Comment ngay
dòng 128 đã tự ghi chú "khi deploy nên set CORS_ORIGINS để allowlist domain" —
nghĩa là đây là một cấu hình CHỜ được set đúng lúc triển khai, không phải một
lỗ hổng bị bỏ sót. Việc cần làm ở môi trường production: **xác nhận
`CORS_ORIGINS` đã được set** (không đổi code ở đây — đây là biến môi trường,
`.env.example` đã có sẵn chỗ khai báo).

## Giới hạn tần suất (Rate limiting)

Hai lớp khác nhau, và một trong hai đang tắt ở production:

- **Lớp chung** (`_rate_limit_check`, dùng Redis) — production tier miễn phí
  đặt `REDIS_URL=""` nên lớp này **fail-open** (không chặn gì khi không có
  Redis), và `RATE_LIMIT_ENABLED` cũng chưa được bật trong `render.yaml`.
- **Lớp riêng cho route nhận mật khẩu** (`BE/app/domains/auth/gioi_han.py`) —
  đếm SỐ LẦN THẤT BẠI trong tiến trình (in-memory, cửa sổ cố định, có trần bộ
  nhớ), viết RIÊNG để không phụ thuộc Redis. Comment đầu file
  (`gioi_han.py:1-9`) tự nói rõ lý do: "một endpoint nhận mật khẩu NKS mà
  không có trần thì thành máy dò mật khẩu cho hệ thống của người khác."

Kết luận trung thực: các route nhận mật khẩu (đổi mật khẩu, xác minh NKS) có
hàng rào thật dù không có Redis. Các route KHÁC (API thường) hiện **không có**
giới hạn tần suất hiệu lực ở production free-tier, vì lớp chung fail-open.
Đây là khoảng trống thật, không phải suy đoán — bật `RATE_LIMIT_ENABLED` +
cấp một Redis instance là việc hạ tầng/triển khai, ngoài phạm vi "quality
polish" của phase này nên không tự làm ở đây.

## Tải lên tệp (Upload)

`app.config['MAX_CONTENT_LENGTH']` đặt ở `BE/app/main.py:66`, mặc định 100MB
(`MAX_UPLOAD_MB`, đổi được qua biến môi trường). Danh sách định dạng chấp nhận
khớp giữa BE và FE — `FE/src/pages/study/DocumentList.jsx`'s `accept` attribute
của input file được khoá bằng `BE/tests/test_upload_formats.py` (comment tại
chỗ khai báo `accept` trong DocumentList.jsx nói rõ điều này) để hai phía không
lệch nhau.

## Bí mật (Secrets)

`.env` không nằm trong kho — `.gitignore` dòng 4 chặn `*.env`, và
`git ls-files` không trả file nào khớp mẫu đó. `.env.example` có sẵn, đã điền
comment cho từng biến, không chứa giá trị thật. Không tìm thấy chuỗi giống
API key/token nào bị commit thẳng vào `BE/app/**/*.py` trong lượt rà soát này.

## Lưu trữ phía trình duyệt (Client storage)

Token đăng nhập qua `tokenStore.js` (không phải `localStorage` thô — xem file
đó để biết cơ chế cụ thể). Các artifact công khai trên trang Artifact
(`localStorage` trong `FE/src/study/`, ví dụ layout panel đã lưu ở
`hooks/panelLayout.js`) chỉ chứa tuỳ chọn hiển thị (bề rộng cột, trạng thái
gập/mở) — không chứa dữ liệu tài liệu hay token.

## Khoảng trống đã biết

Danh sách này KHÔNG được tự sửa trong Phase 6 (đổi cấu hình triển khai/hạ tầng
ngoài phạm vi "quality polish, no backend/infra change"):

1. **CORS mặc định mở** khi `CORS_ORIGINS` chưa set — cần xác nhận biến này đã
   được cấu hình đúng ở mỗi môi trường triển khai thật.
2. **Rate limiting chung fail-open** khi thiếu Redis ở production free-tier —
   chỉ các route nhận mật khẩu có hàng rào độc lập; các route API khác thì
   không. Cần một Redis instance + bật `RATE_LIMIT_ENABLED` để đóng khoảng
   trống này — việc hạ tầng, không phải một dòng code.
