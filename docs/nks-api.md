# NKS Account API — hợp đồng đã đo

Bản **đã làm sạch** của tài liệu nhà cung cấp, dùng làm tài liệu tham chiếu trong kho.

> **Không có credential nào trong file này**, và không được thêm vào.
> Tài khoản test, mật khẩu, access token, bearer token → hỏi người phụ trách tích hợp.
> Bản gốc của nhà cung cấp (có credential, có ảnh chụp Postman kèm token) **không nằm
> trong kho**: nó bị chặn ở `.gitignore` và chỉ tồn tại trên máy cá nhân.

Tài liệu gốc **sai ở vài chỗ quan trọng**. Khi ba nguồn dưới đây lệch nhau thì thứ tự
tin cậy là: **đo thật > ảnh chụp > bảng mô tả**.

### Ký hiệu nguồn — đọc trước khi tin bất cứ dòng nào

| Ký hiệu | Nghĩa | Độ tin |
| :------ | :---- | :----- |
| **ĐO THẬT** | Gọi endpoint thật ngày 2026-09-07 bằng tài khoản test của NKS, đọc phản hồi. | Cao nhất |
| **ẢNH CHỤP** | Lấy từ ảnh chụp Postman nhúng trong tài liệu gốc — máy chủ trả ra, người viết không gõ tay. | Cao |
| **BẢNG TÀI LIỆU** | Bảng mô tả người viết gõ trong tài liệu gốc. **Đã sai ít nhất 5 lần.** | Thấp |
| **CHƯA XÁC MINH** | Không có nguồn nào đủ; đừng đoán. | — |

Chỉ có **hai** endpoint được đo thật: `nks/user/login` và `nks/user`. Bốn endpoint GHI
(`updateInfo`, `updatePass`, `updateAvatar`, `updateCccd`) **chưa từng được gọi** từ
phía StudyMap — hợp đồng của chúng dựng từ ảnh chụp + bảng tài liệu. Lý do: mọi tài
khoản test đều dùng chung, và một lần ghi thử là sửa dữ liệu thật của người khác.

Base URL: `https://account.nks.vn/api` (chỉnh bằng `NKS_AUTH_BASE_URL`)

---

## Nguyên tắc phân loại lỗi

**NKS trả HTTP 500 cho cả trường hợp sai tài khoản.** Đọc mã HTTP mà kết luận
"provider chết" sẽ biến mọi lần gõ sai mật khẩu thành "NKS đang bảo trì". Tín hiệu
thật nằm trong envelope:

```json
{ "success": false, "code": 500, "error": "<tiếng Việt cho người đọc>", "message": "Unauthorized" }
```

Phân loại theo `success` + `message` (`unauthorized` / `token`), không theo status.
Xem `BE/app/clients/auth_nks/errors.py`.

502 / 503 / 504 mới là hạ tầng trước NKS — khác hẳn 500 của chính NKS.

---

## 1. Đăng nhập

```
POST /nks/user/login          ← ĐO THẬT
Content-Type: application/x-www-form-urlencoded
```

> **Tài liệu ghi sai đường dẫn.** Tài liệu ghi `/api/user/login`; đường đó trả **404**.
> Đường sống là `/api/nks/user/login`. Vì vậy `NKS_LOGIN_PATH` chỉnh được bằng env.

| Body param   | Bắt buộc | Ghi chú                        |
| :----------- | :------- | :----------------------------- |
| `username`   | có       | thực tế là địa chỉ email        |
| `password`   | có       |                                |
| `system`     | có       | `NKS`                          |
| `device`     | có       | tên thiết bị / trình duyệt      |
| `fbtoken`    | không    | Firebase                       |
| `ip_address` | không    |                                |
| `location`   | không    |                                |

Phản hồi:

```json
{ "success": true, "option": null,
  "data": { "access_token": "<JWT>", "expires_at": "YYYY-MM-DD HH:MM:SS", "user": { … } } }
```

`data.user` có **đúng cùng bộ khoá** với `/nks/user`.

### Vòng đời token — ĐO THẬT, và đây là điều quan trọng nhất trong tài liệu này

| Thuộc tính            | Giá trị                                              |
| :-------------------- | :--------------------------------------------------- |
| Định dạng             | JWT, `alg: RS256` (Laravel Passport)                  |
| Claim                 | `aud`, `jti`, `iat`, `nbf`, `exp`, `sub`, `scopes`    |
| `sub`                 | bằng `user.id`                                        |
| `scopes`              | **`[]` — không giới hạn phạm vi**                     |
| **Thời hạn**          | **`exp − iat` = 31 536 000 giây = đúng 365 ngày**      |
| `expires_at`          | cùng mốc thời gian với `exp`, dạng chuỗi UTC+7         |
| Làm mới               | **không có endpoint refresh nào**                     |
| Đăng nhập lại         | sinh token MỚI, `jti` khác; **token cũ VẪN sống**      |
| Thu hồi               | **không có endpoint thu hồi**                         |

Hệ quả cho thiết kế: một access token NKS là **chìa khoá vạn năng, sống một năm,
không thu hồi được**. Vì vậy StudyMap không lưu nó ở bất kỳ đâu — chỉ giữ trong RAM
tối đa 10 phút dưới một chứng từ ghi (`BE/app/domains/auth/grants.py`), và mỗi lần
đăng nhập hộ người dùng là thêm một token vĩnh viễn vào tài khoản của họ, nên phải
đăng nhập **càng ít lần càng tốt**.

---

## 2. Lấy thông tin thành viên

```
POST /nks/user                ← cần xác thực
Content-Type: application/x-www-form-urlencoded
body: access_token=<JWT>
```

> **Token đi trong THÂN yêu cầu, không phải header.** ĐO THẬT: gửi
> `Authorization: Bearer <token>` trả về `{"error": "Token not found"}`.
> Chỉ có POST; gửi không body sẽ thành GET và nhận 405.

Phản hồi: `{ "success": true, "data": { …user… } }` — `data` **chính là** object user
(không có `access_token`, không có `expires_at` ở đây).

> **Không có kênh làm mới token.** `/nks/user` KHÔNG trả token thay thế. Gọi lại nhiều
> lần không đổi gì và không đẩy hạn ra xa.

### Trường trong `data` — 56 trường, và phần lớn KHÔNG được ra khỏi máy chủ

Nhóm dùng được:

| Trường                  | Kiểu    | Ghi chú                                          |
| :---------------------- | :------ | :----------------------------------------------- |
| `id`                    | số      | định danh; bằng `sub` của JWT                     |
| `email`                 | chuỗi   |                                                  |
| `name`                  | chuỗi   | tên hiển thị — **độc lập** với firstname/lastname |
| `firstname`, `lastname` | chuỗi   |                                                  |
| `phone`                 | chuỗi   |                                                  |
| `gender`                | 0 \| 1  |                                                  |
| `dob`                   | chuỗi   | `yyyy-mm-dd`                                     |
| `pob`, `province`       | chuỗi   |                                                  |
| `website`, `intro`      | chuỗi   |                                                  |
| `avatar`                | chuỗi   | **URL https trực tiếp**, không phải base64        |
| `role`                  | object  | `{ "id": <số>, "name": "<chuỗi>" }` — **hoặc `null`** |
| `role_id`               | số      | số nội bộ của NKS                                 |

**Trường nhạy cảm — tuyệt đối không chuyển tiếp ra trình duyệt:**
`activation_token`, `sms_token`, `zalo_key`, `zalo_id`, `face_id`, `nopass`,
`cccd_front`, `cccd_back`, `id_number`, `id_date`, `id_place`, `qrcode`, `vcard`,
`settings`, `geolocation`.

Vì vậy `BE/app/clients/auth_nks/profile_mapper.py` lọc theo **danh sách trắng**: 56
trường vào, 15 trường ra. Chuyển tiếp cả object là rò một nắm bí mật và ảnh giấy tờ
tuỳ thân chỉ để vẽ một cái form chín ô.

### Ánh xạ vai trò — ĐO THẬT

Nhãn trong tài liệu **không phải** giá trị API trả về:

| Nhãn tài liệu | `role_id` | `role.name` thật | StudyMap  |
| :------------ | :-------- | :--------------- | :-------- |
| Manager       | 11        | `"Manager"`      | `admin`   |
| Faculty       | 8         | `"teacher"`      | `teacher` |
| Driver        | 2         | `"user"`         | `learner` |
| Student       | 2         | `"user"`         | `learner` |
| Member        | `null`    | (vắng)           | `learner` |

Chỉ dùng `role.name`. **Không dùng `role_id`**: đổi một hàng trong bảng roles bên NKS
sẽ khiến StudyMap cấp nhầm quyền mà không ai biết. Giá trị lạ ⇒ `learner` (quyền thấp
nhất). Xem `BE/app/clients/auth_nks/roles.py`.

---

## 3. Cập nhật thông tin

```
POST /nks/user/updateInfo     ← cần xác thực
Content-Type: application/x-www-form-urlencoded
```

> **Nguồn: ẢNH CHỤP + BẢNG TÀI LIỆU. Chưa đo thật** — xem ký hiệu nguồn ở đầu file.

Body: `firstname`, `lastname`, `intro`, `phone`, `gender` (0/1), `website`,
`dob` (`yyyy-mm-dd`), `pob`, `id_number`, `id_date`, `id_place`, `province`,
`access_token`.

> **Bảng "Output" của tài liệu SAI ở cả ba endpoint ghi** (nguồn: ẢNH CHỤP). Tài liệu ghi trả về
> "User Info". Ảnh chụp Postman trong CHÍNH tài liệu đó cho thấy:
>
> ```json
> { "success": true, "option": null, "data": true, "message": "User retrieved successfully." }
> ```
>
> `data` là một **boolean trần**. Viết client theo bảng Output rồi đọc `data.avatar`
> sẽ nhận `undefined`. **Mỗi lần ghi phải gọi lại `/nks/user`** mới biết kết quả.

**`name` không sửa được.** Không có tham số nào đặt nó, và nó độc lập với
`firstname`/`lastname`. Cho người dùng gõ vào một ô rồi lặng lẽ không lưu là đúng lỗi
"nút bấm không gọi gì cả" trong `.playbook/lessons-learned.md`.

CCCD (`id_number`/`id_date`/`id_place`) ghi được ở phía NKS nhưng **ngoài phạm vi
StudyMap** và không nằm trong danh sách trắng, nên không có đường nào tới.

---

## 4. Đổi mật khẩu

```
POST /nks/user/updatePass     ← cần xác thực
body: old_password, password, access_token
```

> **Nguồn: BẢNG TÀI LIỆU. Chưa đo thật, cũng chưa có ảnh chụp.** Đây là endpoint ít
> bằng chứng nhất trong cả tài liệu.

Phản hồi cùng khuôn `data: true` (suy từ hai endpoint ghi kia, **chưa xác minh**).

CHƯA XÁC MINH: `updatePass` có vô hiệu các token đang phát hay không. Phải coi như
"có thể có" — không được giả định là không.

---

## 5. Cập nhật ảnh đại diện

```
POST /nks/user/updateAvatar   ← cần xác thực
Content-Type: multipart/form-data
body: avatar, access_token
```

> **Nguồn: ẢNH CHỤP + BẢNG TÀI LIỆU. Chưa đo thật.**

> ẢNH CHỤP cho thấy `avatar` là **data-URI đầy đủ**, không phải base64 trần:
> `data:image/jpeg;base64,/9j/4AAQSkZJRg…`
> Bảng của tài liệu chỉ ghi "Base64"; gửi base64 trần theo đúng bảng đó nhiều khả
> năng hỏng.

Phản hồi `data: true` ⇒ phải gọi lại `/nks/user` để lấy URL ảnh mới.

CHƯA XÁC MINH: giới hạn kích thước, và các mime type được chấp nhận. Tài liệu không
nêu. Chỉ quan sát được JPEG.

Ảnh trả về ở `user.avatar` là URL https **công khai, không cần xác thực**
(`Content-Type: image/jpeg`).

---

## 6. Cập nhật CCCD — NGOÀI PHẠM VI

```
POST /nks/user/updateCccd     ← cần xác thực
body: front, back (data-URI), number, date, place, access_token
```

> **Nguồn: BẢNG TÀI LIỆU.**

Ảnh giấy tờ tuỳ thân. StudyMap **không** proxy dữ liệu này; người dùng sửa tại cổng
tài khoản NKS.

---

## Danh sách endpoint là ĐẦY ĐỦ

`user/login`, `user/loginSocial`, `nks/user`, `nks/user/updateInfo`,
`nks/user/updatePass`, `nks/user/updateAvatar`, `nks/user/updateCccd`.

Không có: client-credentials, tài khoản máy, API key, endpoint quản trị, refresh,
thu hồi. Nghĩa là **mọi thao tác thay mặt người dùng đều cần token của chính họ**, và
token đó chỉ lấy được bằng một lần đăng nhập có mật khẩu.

---

## Còn chưa xác minh

| # | Câu hỏi                                                  | Chặn việc gì                    |
| :-| :------------------------------------------------------- | :------------------------------ |
| 1 | `updatePass` có vô hiệu token đang phát không?            | luồng đổi mật khẩu               |
| 2 | Giới hạn kích thước / mime của `updateAvatar`             | luồng đổi ảnh đại diện           |
| 3 | Ghi `firstname`/`lastname` có sinh lại `name` không?      | có cho sửa tên hiển thị không    |
| 4 | Token có bị NKS giới hạn phạm vi ở đâu đó không?          | đánh giá bán kính rủi ro         |
| 5 | NKS có khoá tài khoản sau nhiều lần sai mật khẩu không?   | mức trần của hàng rào phía ta    |

Cách gỡ (1), (2) và (5) rẻ nhất: **xin NKS một tài khoản dùng-một-lần**, hoặc hỏi
thẳng họ `post_max_size` và ngữ nghĩa của `updatePass`. Không dò trên tài khoản thật
đang dùng chung.

---

## Mã liên quan

| Việc                    | File                                          |
| :---------------------- | :-------------------------------------------- |
| URL + cờ bật/tắt        | `BE/app/clients/auth_nks/config.py`            |
| Gọi HTTP (chỗ DUY NHẤT) | `BE/app/clients/auth_nks/client.py`            |
| Phân loại lỗi           | `BE/app/clients/auth_nks/errors.py`            |
| Danh tính + vai trò     | `BE/app/clients/auth_nks/mapper.py`, `roles.py`|
| Hồ sơ (danh sách trắng) | `BE/app/clients/auth_nks/profile_mapper.py`    |
| Chứng từ ghi 10 phút    | `BE/app/domains/auth/grants.py`                |
