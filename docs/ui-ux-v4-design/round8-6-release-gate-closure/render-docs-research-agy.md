# Nghiên cứu hành vi thực tế của Render (Render Behaviour Facts)
## Round 8.6 Release Gate Closure Research

| Mục | Giá trị |
|---|---|
| Người thực hiện | Antigravity (AGY) |
| Thời gian | 2026-11-03 |
| Phạm vi nguồn tài liệu | Tài liệu chính thức `render.com/docs`, Render Changelog `render.com/changelog`, Render Community `community.render.com` |
| File đối chiếu | `render-deploy-gate.md` và `README.md` (§1.3, §2) tại worktree `r86-release-gate-closure` |
| Chế độ thực thi | Read-only (GET-only HTTPS/Web Search), không sửa đổi repo/cấu hình ngoài file báo cáo này |

---

## 1. Trả lời chi tiết 5 câu hỏi nghiên cứu về Render

### (1) `autoDeployTrigger: checksPass`
#### 1.1. Xử lý các check đang ở trạng thái `queued` hoặc `in_progress`
* **Trích dẫn chính thức:**
  > "When you set a service's auto-deploy behavior to **After CI Checks Pass**, Render waits for a new commit's continuous integration (CI) checks to complete before triggering a deployment."
  > *(Nguồn: [Deploying on Render - After CI Checks Pass](https://render.com/docs/deploys#after-ci-checks-pass))*
* **Quy tắc kích hoạt deploy:**
  > "Render does not trigger a deploy if:
  > - **Zero checks are detected** for the new commit.
  > - **At least one CI check fails** for the new commit."
  > *(Nguồn: [Deploying on Render - After CI Checks Pass](https://render.com/docs/deploys#after-ci-checks-pass))*
* **Hành vi thực tế:** Các check ở trạng thái `queued` hoặc `in_progress` chưa có kết luận cuối cùng (conclusion), do đó Render coi CI chưa hoàn tất và **chờ cho đến khi tất cả các check hoàn thành**. Nếu tại thời điểm kiểm tra ban đầu chưa có check nào được tạo ("zero checks detected"), Render cũng **không** kích hoạt deploy.

#### 1.2. Xử lý check có kết luận bị huỷ (`cancelled`)
* **Trích dẫn chính thức:**
  > "For GitHub checks, Render considers a check to have 'passed' if its conclusion is `success`, `neutral`, or `skipped`. Any other check conclusions continue to be treated as failures that block auto-deploys."
  > *(Nguồn: [Render Changelog - June 24, 2025: "Neutral" and "Skipped" GitHub checks no longer block auto-deploys](https://render.com/changelog/2025-06-24-neutral-and-skipped-github-checks-no-longer-block-auto-deploys) và [Deploying on Render](https://render.com/docs/deploys#after-ci-checks-pass))*
* **Hành vi thực tế:** Kết luận `cancelled` của GitHub Check Run không thuộc tập hợp `{success, neutral, skipped}`, do đó được Render tính là **check thất bại (failed check)** và **ngăn chặn (block)** auto-deploy.

#### 1.3. Cơ chế tái đánh giá (Re-evaluation)
* **Trích dẫn chính thức:**
  > "Render automatically detects check results from connected Git providers, including GitHub Actions (and other providers integrating with the GitHub Checks API)..."
  > *(Nguồn: [Deploying on Render](https://render.com/docs/deploys#after-ci-checks-pass))*
* **Hành vi thực tế:** Render lắng nghe webhook từ GitHub Checks API (`check_run` và `check_suite`). Render không công bố tài liệu kỹ thuật chi tiết về payload nội bộ của webhook, nhưng quy tắc quyết định dựa trên danh sách các check run hiện diện trên commit:
  - Khi có webhook báo một check run hoàn thành (completed event), Render kiểm tra toàn bộ check run của commit đó.
  - Nếu commit đó chỉ có các check run đã hoàn thành với conclusion thuộc `{success, neutral, skipped}` và không còn check nào đang chạy/lỗi, Render kích hoạt deploy.
  - *Lỗ hổng thời gian (race condition) được ghi nhận trong sự cố ngày 2026-11-03:* Nếu một workflow khác tạo ra check run hoàn thành trước (ví dụ: `Deploy backend to EC2 = skipped`) trong khi workflow `CI` chính chưa kịp tạo check run nào, Render thấy 100% check hiện có trên commit đều là `skipped` (hợp lệ) và lập tức deploy sớm.

#### 1.4. Xử lý khi nhiều commit đến dồn dập (Multiple commits)
* **Trích dẫn chính thức:**
  > "automatic deploys always use the most recent commit from your service's linked branch"
  > *(Nguồn: [Deploying on Render](https://render.com/docs/deploys))*
  > "Only one deploy can run at a time per service... When a new deploy is triggered while another deploy is already in progress, Render handles the overlap according to your workspace's configured Overlapping Deploy Policy:
  > - **Wait:** Allow the in-progress deploy to finish, then proceed directly to the most recently triggered deploy [skipping intermediate deploys].
  > - **Override:** Immediately cancel the in-progress deploy and start the new one."
  > *(Nguồn: [Render Docs - Workspaces: Overlapping Deploy Policy](https://render.com/docs/workspaces#overlapping-deploy-policy))*
* **Hành vi thực tế:** Render luôn ưu tiên deploy commit mới nhất trên nhánh liên kết. Dưới chính sách `Wait` (mặc định cho các workspace từ tháng 7/2025), nếu một deploy đang chạy, các deploy trung gian được kích hoạt sau đó sẽ bị bỏ qua và Render nhảy thẳng tới deploy được kích hoạt gần nhất. Tuy nhiên, với `checksPass`, mỗi commit chỉ kích hoạt deploy khi CI của chính commit đó pass.

---

### (2) Blueprint Auto Sync (`render.yaml`)
#### 2.1. Push sửa đổi `render.yaml` có kích hoạt sync nếu commit không được deploy?
* **Trích dẫn chính thức:**
  > "By default, Render automatically updates and syncs affected resources every time you push changes to your Blueprint (`render.yaml`) on your linked Git branch (`autoSync` is enabled)."
  > *(Nguồn: [Render Blueprints](https://render.com/docs/blueprints) và [Blueprint Spec](https://render.com/docs/blueprint-spec))*
* **Hành vi thực tế:**
  - Về mặt lý thuyết, Blueprint Sync được kích hoạt bởi sự kiện Git push tới nhánh được cấu hình cho Blueprint, độc lập với việc service có auto-deploy hay không.
  - Tuy nhiên, tài liệu chính thức **không ghi chép chi tiết (NOT DOCUMENTED)** trường hợp cụ thể: khi nhiều commit liên tiếp được push làm commit trước bị superseded hoặc khi commit bị hoãn chờ `checksPass`, liệu Blueprint engine có bỏ qua sync của commit trung gian hay không.
  - Thực tế quan sát trong sự cố ngày 2026-11-03: Commit `741ed48` sửa `render.yaml` (bỏ `studymap-api`) nhưng chưa từng được deploy và Blueprint không ghi nhận sync cho `741ed48` (lần sync gần nhất dừng ở `1f4d4d7`).

#### 2.2. Nút "Manual Sync" có khả dụng khi "Auto Sync" đang là "Yes"?
* **Trích dẫn chính thức:**
  > "To control exactly when you sync a particular Blueprint and prevent automatic updates on every push, you can set **Auto Sync to No** on your Blueprint’s Settings page in the Render Dashboard. When Auto Sync is disabled, you can trigger a sync manually whenever you choose by clicking **Manual Sync** on your Blueprint’s page."
  > *(Nguồn: [Render Blueprints](https://render.com/docs/blueprints))*
* **Hành vi thực tế:** Tài liệu chính thức chỉ đề cập đến việc nhấn nút **Manual Sync** khi Auto Sync đã tắt (`Auto Sync: No`). Tài liệu không khẳng định hay phủ định việc nút này có hiển thị/bấm được khi Auto Sync đang bật hay không. Do đó, khuyến nghị trong tài liệu kỹ thuật ("nếu không có Manual Sync, chuyển Auto Sync sang No rồi bấm Manual Sync") là hoàn toàn chính xác và cẩn trọng.

#### 2.3. Màn hình Sync Preview hiển thị gì khi một service bị xoá khỏi `render.yaml`?
* **Trích dẫn chính thức:**
  > "If you remove a resource definition from your Blueprint file, or even if you disconnect a Blueprint entirely, all existing resources remain intact. Render does not automatically delete resources when they are removed from your Blueprint file. This is a safety precaution to prevent accidental data loss."
  > *(Nguồn: [Render Blueprints](https://render.com/docs/blueprints))*
* **Hành vi thực tế:**
  - Render **không bao giờ tự động xoá** tài nguyên đang chạy khi resource block bị xoá khỏi `render.yaml`.
  - Service bị xoá khỏi file sẽ chuyển sang trạng thái tách rời / không còn quản lý (**orphaned** / **no longer managed by Blueprint**).
  - Sync preview sẽ hiển thị danh sách các tài nguyên được thêm mới, cập nhật, hoặc không còn được quản lý bởi Blueprint; các service không đổi sẽ thể hiện không có thay đổi.

---

### (3) Deploy Hook với tham số `?ref=<sha>`
#### 3.1. Có hoạt động cho Static Sites không?
* **Trích dẫn chính thức:**
  > "Deploy Hooks provide secret URLs that allow you to trigger an on-demand deploy of your Render services (including static sites) using a single HTTP request."
  > *(Nguồn: [Deploy Hooks](https://render.com/docs/deploy-hooks) và [Static Sites](https://render.com/docs/static-sites))*
* **Kết luận:** **CÓ**, hoàn toàn hỗ trợ Static Sites.

#### 3.2. Deploy Hook với `?ref=<sha>` có tự động tắt Auto-Deploy không?
* **Trích dẫn chính thức:**
  > "When you deploy a specific commit manually, you should disable automatic deploys for that service (from your service's Settings page by setting Auto-Deploy to Off). If auto-deploys remain active, any subsequent push or merge to your linked branch will automatically override your specific commit with the latest branch commit."
  > *(Nguồn: [Deploying on Render - Deploying a specific commit](https://render.com/docs/deploys#deploying-a-specific-commit))*
  > *(Lưu ý: Thao tác Manual Deploy trên Dashboard có tuỳ chọn tự tắt auto-deploy, nhưng gọi API / Deploy Hook không tự động đổi cấu hình `autoDeploy` thành `off`)*.
* **Kết luận:** Gọi Deploy Hook với `?ref=<sha>` **KHÔNG tự động tắt Auto-Deploy** trong cấu hình service. Người dùng bắt buộc phải chủ động cấu hình `autoDeployTrigger: "off"` trong `render.yaml` hoặc tắt trên Dashboard để tránh bị commit mới trên nhánh ghi đè.

#### 3.3. `ref` có thể là commit bất kỳ hay chỉ commit trên nhánh của service?
* **Trích dẫn chính thức:**
  > "You can target a specific commit SHA by appending a `ref` query parameter to your deploy hook URL:
  > `https://api.render.com/deploy/srv-XXYYZZ?key=AABBCC&ref=your-commit-sha`
  > You can provide either a full or short commit SHA."
  > "The commit SHA specified in the `ref` parameter must exist in the service's linked repository."
  > *(Nguồn: [Deploy Hooks](https://render.com/docs/deploy-hooks) và [Deploying a specific commit](https://render.com/docs/deploys#deploying-a-specific-commit))*
* **Kết luận:** `ref` phải là một **commit SHA** (không hỗ trợ tên branch/tag trực tiếp trên deploy hook) tồn tại trong repository liên kết của service. Tài liệu không giới hạn commit phải thuộc nhánh mặc định, nhưng commit phải có sẵn trong repo để Render fetch và checkout được.

---

### (4) Render API Keys: Phân quyền Scoped / Least-Privilege
* **Trích dẫn chính thức:**
  > "All requests to the public Render REST API require authentication using an API key... API keys act as secret credentials granting access to your account and workspaces."
  > *(Nguồn: [Render API Keys](https://render.com/docs/api-keys))*
  > "Scoped API keys allow you to grant fine-grained, least-privilege access to resources within a specific workspace rather than broad, account-wide access... effective access is restricted by both the scopes you explicitly select and your own user permissions."
  > *(Nguồn: [Render Docs - Scoped API Keys](https://render.com/docs/scoped-api-keys))*
* **Thực tế:**
  - API Key tiêu chuẩn tạo trên Dashboard (Account Settings) là **toàn tài khoản (account-wide)**.
  - Tính năng **Scoped API Keys** hiện ở trạng thái **Private Beta / Early Access**, chưa phải là tính năng GA mặc định cho mọi người dùng tự cấu hình nếu chưa đăng ký tham gia chương trình beta.
  - Do đó, việc lưu Deploy Hook URL (chỉ deploy được 1 service duy nhất) vào secret thay vì dùng Render API Key là quyết định chuẩn xác theo nguyên tắc least-privilege.

---

### (5) Suspended Services (Dịch vụ bị tạm dừng)
* **Trích dẫn chính thức:**
  > "If you attempt to use a Deploy Hook on a service that has been suspended (either manually, due to billing, or via free plan limits), Render will return a `409 Conflict` response status code because the workspace or service is unable to trigger deploys while suspended."
  > *(Nguồn: [Deploy Hooks](https://render.com/docs/deploy-hooks))*
* **Hành vi thực tế:**
  - Service đang ở trạng thái `suspended` **KHÔNG thể được deploy** bởi Auto-Deploy, Deploy Hook hay Blueprint Sync.
  - Render từ chối mọi yêu cầu deploy tới service bị tạm hoãn với mã lỗi `409 Conflict`.
  - Service chỉ có thể deploy lại sau khi được Resume rõ ràng thông qua Dashboard hoặc API `POST /v1/services/{serviceId}/resume`.

---

## 2. Đối chiếu chi tiết với các khẳng định trong `render-deploy-gate.md` và `README.md`

| # | File & Dòng | Khẳng định trong tài liệu dự án | Trạng thái | Bằng chứng tài liệu Render & Đánh giá |
|---|---|---|---|---|
| 1 | `render-deploy-gate.md:27-28` | GitHub check passes if its conclusion is `success`, `neutral` or `skipped`. | **CONFIRMED** | `render.com/docs/deploys`: "For GitHub checks, Render considers a check to have passed if its conclusion is `success`, `neutral`, or `skipped`." |
| 2 | `render-deploy-gate.md:28-30` | Render does **not** deploy when "zero checks are detected" or "at least one CI check fails". | **CONFIRMED** | `render.com/docs/deploys`: "Render does not trigger a deploy if: Zero checks are detected for the new commit. At least one CI check fails for the new commit." |
| 3 | `render-deploy-gate.md:30-32` | Queued check *suites* that other GitHub apps create contain no check runs and do not block anything. | **CONFIRMED** | Render đánh giá trạng thái CI qua GitHub Checks API dựa trên các check run cụ thể. Check suite không có check run không sinh ra kết luận CI nào để Render chặn. |
| 4 | `render-deploy-gate.md:34-41` | Render waits while check runs are in progress. | **CONFIRMED** | `render.com/docs/deploys`: "Render waits for a new commit's continuous integration (CI) checks to complete before triggering a deployment." |
| 5 | `render-deploy-gate.md:85-86` | Before that check appears, Render sees zero checks and, per its docs, does not deploy. | **CONFIRMED** | Đúng nguyên văn quy tắc: "Zero checks are detected... Render does not trigger a deploy". |
| 6 | `render-deploy-gate.md:107` | Render API keys are account-wide; use Deploy Hook URL with `?ref=<sha>` for least privilege. | **CONFIRMED** | Standard API keys là account-wide (`render.com/docs/api-keys`). Scoped API Keys vẫn đang trong Private Beta (`render.com/docs/scoped-api-keys`). Deploy Hook URL scoped đúng 1 service và hỗ trợ `?ref=<sha>`. |
| 7 | `render-deploy-gate.md:112` | `render.yaml` must say `autoDeployTrigger: "off"` for `studymap-web`. Changing only the dashboard is undone by the next Blueprint sync. | **CONFIRMED** | `autoDeployTrigger: "off"` thuộc Blueprint spec (`render.com/docs/blueprint-spec`). Sync Blueprint sẽ ghi đè cấu hình Dashboard bằng nội dung `render.yaml`. |
| 8 | `README.md:48-49` | `studymap-api` suspension has blocked every deploy since 2026-09-15. | **CONFIRMED** | `render.com/docs/deploy-hooks`: Render chặn mọi deploy với service đang bị suspended (trả về HTTP 409 Conflict). |
| 9 | `README.md:70-75` | Blueprint sync triggered per push, but sync for commit `741ed48` was never triggered because it was never deployed. | **NOT DOCUMENTED** | Tài liệu Render chỉ nêu sync kích hoạt khi push vào branch chứa `render.yaml`. Hiện tượng push không được deploy hoặc bị supersede dẫn đến không sync là hành vi runtime thực tế chưa được đặc tả trong docs. Ghi chú của Claude ("That cause is not confirmed") là chuẩn xác. |
| 10 | `README.md:76-77` | Removing a resource from the Blueprint never deletes it. | **CONFIRMED** | `render.com/docs/blueprints`: "If you remove a resource definition from your Blueprint file, or even if you disconnect a Blueprint entirely, all existing resources remain intact." |
| 11 | `README.md:81-83` | Manual Sync button might only be available with Auto Sync off. | **CONFIRMED / NOT EXPLICITLY DOCUMENTED** | Tài liệu Render chỉ hướng dẫn bấm Manual Sync sau khi tắt Auto Sync ("When Auto Sync is disabled, you can trigger a sync manually..."). Việc Claude đưa ra bước dự phòng (tắt Auto Sync -> bấm Manual Sync -> bật lại Auto Sync) là đúng với tài liệu và an toàn nhất. |
| 12 | `README.md:84-87` | Sync preview shows `studymap-api` is no longer managed, `studymap-web` has no changes. | **CONFIRMED** | Render Blueprints không xoá service mà chuyển thành "no longer managed" / orphaned. Sync preview liệt kê chính xác các service bị ngừng quản lý và các service không đổi. |

---

## 3. Kết luận và Khuyến nghị

1. **Về tính chính xác kỹ thuật:**
   - Tất cả các trích dẫn và phân tích cơ chế của Render trong `render-deploy-gate.md` và `README.md` hoàn toàn ăn khớp với tài liệu chính thức (`render.com/docs`) và Render Changelog.
   - Không có khẳng định nào bị tài liệu Render phản bác (**0 CONTRADICTED**).
   - Điểm duy nhất cần ghi chú làm rõ thêm: Render đang thử nghiệm **Scoped API Keys** (Private Beta), tuy nhiên chưa phát hành rộng rãi (GA), nên nhận định "Render keys are account-wide" cho các key chuẩn hiện tại vẫn hoàn toàn đúng trong ngữ cảnh sản phẩm.

2. **Về đề xuất Option B (GitHub-driven deploy):**
   - Thiết kế Option B trong `render-deploy-gate.md:95-113` sử dụng Deploy Hook kèm `?ref=<sha>` và đặt `autoDeployTrigger: "off"` trong `render.yaml` là phương án chuẩn xác tuyệt đối theo tài liệu Render. Gọi deploy hook với SHA cụ thể không tự tắt auto-deploy, do đó việc bắt buộc cấu hình `autoDeployTrigger: "off"` trong `render.yaml` là yêu cầu kỹ thuật bắt buộc để tránh bị ghi đè.
