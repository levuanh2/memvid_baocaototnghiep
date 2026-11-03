# Codex2 independent review — Round 8.6

## Verdict: REQUEST CHANGES

Các trạng thái kỹ thuật được ghi `PASS` là đúng theo bằng chứng tái lập ngày 2026-11-03. Tuy nhiên, cần sửa run sheet E4 và thứ tự thao tác Blueprint trước khi dùng tài liệu này làm release gate.

## Findings

### WARN-001 — `human-acceptance-sheets.md:18-23,33-44,55-64`

**Claim:** S1/S2 giữ nguyên tiêu chí E4 và tạo được bằng chứng human acceptance.

**Evidence:** Checklist gốc yêu cầu ghi chính xác nội dung được đọc và kết quả `PASS`, `FAIL` hoặc `N/A` cho từng dòng (`round8-4-qa-evidence/accessibility-manual-checklist.md:22-24`). S1/S2 chỉ có tổng số dòng và danh sách dòng FAIL; không có nơi ghi spoken output hoặc trạng thái từng dòng. Vì vậy một tổng `29/29` không đủ tái lập việc 29 tiêu chí đã thực sự được nghe và đánh giá.

**Fix:** Bắt buộc tester điền và đính kèm checklist gốc cho từng reader, hoặc thêm bảng 29 dòng có spoken output và `PASS/FAIL/N/A`; bảng S1/S2 chỉ tổng hợp từ bằng chứng đó.

### WARN-002 — `human-acceptance-sheets.md:18-23,33-34,55,66-69`

**Claim:** Có thể chạy toàn bộ E4 trên build production được ghi ở phần “Before every sheet”.

**Evidence:** Dòng 4.6 của checklist bắt buộc chạy thêm với Library Action Matrix **ON trong test build** (`accessibility-manual-checklist.md:65`), trong khi production cố ý không có flag (`README.md:65-66`) và sheet chỉ có một ô production SHA phải bằng `/health`. Operator không có chỗ ghi hoặc phân biệt build test của 4.6, nên không thể vừa làm đúng 4.6 vừa tuân thủ phần chuẩn bị.

**Fix:** Nêu rõ các dòng còn lại dùng production SHA; riêng 4.6 dùng test build bật flag, ghi SHA/URL riêng cho cả S1 và S2, và nhắc không bật flag production.

### WARN-003 — `README.md:82-87`

**Claim:** Trình tự Manual Sync bảo đảm operator duyệt preview trước mọi thay đổi.

**Evidence:** Bước 2 bảo operator bật Auto Sync lại thành `Yes` ngay sau khi bấm **Manual Sync**, nhưng bước 3 mới yêu cầu đọc preview và xác nhận. Theo đúng thứ tự văn bản, Auto Sync được bật lại trước khi preview được duyệt hoặc sync hoàn tất; điều này có thể làm mất kiểm soát commit/thay đổi đang được sync.

**Fix:** Chuyển thao tác bật Auto Sync lại thành `Yes` xuống sau khi preview đúng, Manual Sync hoàn tất và các post-check ở bước 4/5 đạt yêu cầu.

### SUGG-001 — `README.md:38`

**Claim:** PASS “Unauthenticated API call — 401” có bằng chứng đủ để người khác tái lập.

**Evidence:** Claim đúng: `GET https://api.studymap.space/api/documents` không token trả `401`. Tuy nhiên bảng không ghi method/path; một path API hợp lý khác như `/api/v1/collections` trả `404`, nên chỉ số `401` hiện tại không xác định phép thử nào đã chạy.

**Fix:** Ghi rõ `GET /api/documents` không `Authorization` → `401` (kèm thời điểm kiểm tra).

## Evidence reproduced

- CI run `41575181269`: `success`, head `2d283aa384f2cef1e88f2209032bbeefbe4f3e67`; job `CI / required` thành công. PR #108 có `detect-changes=failure` nhưng aggregate cũ thành công; PR #109 có aggregate thất bại; fix được merge ở `f109484`.
- Fix dialog ở `2d283aa` có layout-effect frame probe; frontend test job trong CI run trên cùng SHA thành công.
- Deploy run `41576552966`: `decision=deploy reason=verified_sha_is_current_main`, verified SHA bằng remote `main`, activation SHA được xác minh và log ghi đã record SHA vào `/opt/memvid/deployments.log`.
- `/health` trả `status=ok`, revision đầy đủ `2d283aa384f2cef1e88f2209032bbeefbe4f3e67`; cả `studymap.space` và `studymap-web.onrender.com` có cùng `studymap-build`.
- Render GET: `studymap-web` có đúng hai env key (`NODE_VERSION`, `VITE_API_BASE`), `VITE_API_BASE=https://api.studymap.space`, root/build/publish/rewrite/checksPass/previews khớp bảng. `studymap-api` vẫn `suspended` bởi `user`; deploy mới nhất là `fdc1c9d` ngày 2026-09-15.
- Branch protection `main`: required check `CI / required` app `15368`, strict, PR required, 0 approvals, admins enforced, conversation resolution, force-push/delete đều tắt.
- Human gates vẫn là `NOT VERIFIED`; không có human result nào bị nâng thành PASS. Fixture placeholders được bỏ qua theo yêu cầu.
- Checklist gốc có 28 dòng (`1.1`–`6.4`); cộng C1 mà E4 gốc yêu cầu là **29**, nên row count là đúng.
- Git scope đúng: Round 8.2–8.4 không đổi; Round 8.5 chỉ thêm pointer 6 dòng ở đầu README; phần còn lại chỉ là folder Round 8.6 mới (bao gồm report này).
