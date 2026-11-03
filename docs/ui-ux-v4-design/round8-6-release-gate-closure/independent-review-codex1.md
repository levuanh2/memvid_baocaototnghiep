# Independent review — Codex1

**Verdict: REQUEST CHANGES**

PR #112 tự thân là một thay đổi hẹp và đúng hướng: diff chỉ đổi concurrency của `CI`; `deploy.yml`, `deploy_gate.sh`, `deploy_remote.sh` và `render.yaml` không đổi. Tuy nhiên báo cáo chưa đủ cơ sở để khuyến nghị Option A vì có một fail-stale Render chưa được phân tích, và có một claim lịch sử sai.

## Findings

### 1. HIGH — `render-deploy-gate.md:60-71,119,125-130`: bỏ sót khả năng Render deploy ngược về SHA cũ

**Claim:** rủi ro mới chỉ là EC2 stale, cần ba Deploy workflow chồng nhau; Option A có thể merge ngay.

**Evidence:** sau #112, CI của từng SHA chạy song song nên commit cũ có thể hoàn tất sau commit mới. Render mô tả `checksPass` theo từng commit và chỉ cho một deploy/service chạy; deploy được trigger sau cùng sẽ là deploy chờ mới nhất, không có tài liệu nào cam kết sắp xếp theo ancestry hoặc bỏ deploy của SHA cũ. Vì vậy chỉ cần hai CI hoàn tất ngược thứ tự là có thể trigger Render(B) rồi Render(A), khiến frontend quay về A đã verify nhưng stale. Nếu Render nội bộ luôn resolve latest branch SHA thay vì SHA của event, tài liệu cũng chưa chứng minh hành vi đó và phải loại trừ khả năng event cũ kích hoạt latest SHA chưa pass. Đây là rủi ro khác với EC2 edge.

Đối với **riêng EC2 edge** mô tả ở §2, lập luận là đúng: cần D1 đang chạy, D-new đang pending và D-old đến sau để hủy D-new; `cancel-in-progress: false` vẫn chỉ giữ một running + một pending. Gate EC2 không deploy SHA chưa verify: nó kiểm tra source run `success`/`push`/`main`/repo/workflow path, so SHA với remote `main`, rồi remote script checkout đúng SHA.

**Fix:** trước khi khuyến nghị A, phải xác minh bằng Render API/support hoặc một thử nghiệm an toàn rằng out-of-order check completion không thể rollback frontend. Nếu không chứng minh được, coi đây là release blocker và serialize/reconcile frontend deployment theo current verified `main` (Option B hoặc cơ chế tương đương). Ghi rõ overlapping-deploy policy hiện tại của workspace.

### 2. HIGH — `render-deploy-gate.md:46-48`: “frontend tree của 2d283aa đã được PR #111 test” là sai

**Claim:** exposure ngày 2026-11-03 bằng không vì tree frontend của `2d283aa` chính là tree PR #111 đã pass.

**Evidence:** log run PR #111 `41572369854` checkout merge-ref `bc41c0ad...`, merge `3b154f1` vào base `290d2ff`; hash cây `FE` của merge-ref này là `c2927614...`. Main `2d283aa` có hash cây `FE` là `90a6dc9a...`. PR #110 đã thêm ba file `FE/e2e-fixture/*` giữa hai tree; ba PR trước cũng chưa có trong merge-ref #111. Do đó combined main tree chưa được CI kiểm tra như một tree thống nhất trước khi Render deploy. Main CI chỉ chứng minh nó xanh về sau, lúc `CI / required` hoàn tất `04:10:29Z`.

**Fix:** thay bằng “không ghi nhận sự cố chức năng; main CI sau đó pass”. Không khẳng định zero exposure hoặc exact-tree equivalence cho incident này.

### 3. MEDIUM — `render-deploy-gate.md:88-92,127-130`: claim branch protection cần giới hạn theo thời điểm và điều kiện

**Claim:** strict protection bảo đảm mọi main tree là tree merge-ref đã test.

**Evidence:** cấu hình **hiện tại** đúng là `strict=true`, `enforce_admins=true`, required check `CI / required` gắn app `15368`, và PR requirement đang bật. PR #112 `CLEAN`; CI run `41575492585` checkout đúng merge-ref `531539e...` có parents `4c8486b` + `2d283aa`, rồi 12/12 checks pass. Vì vậy claim có cơ sở cho merge #112 nếu các protection này vẫn giữ nguyên.

Nhưng nó không đúng hồi tố cho incident: log các PR #106/#107/#110/#111 lần lượt test merge-ref trên cùng base `290d2ff`, trong khi chúng được merge nối tiếp trong 45 giây. API hiện tại không chứng minh protection đã ở trạng thái strict tại thời điểm đó.

**Fix:** ghi “prospectively, while strict protection + required PR + required GitHub-Actions check remain enabled”. Tách rõ bằng chứng hiện tại khỏi timeline cũ.

### 4. MEDIUM — `render-deploy-gate.md:102-111`: Option B vẫn còn bốn lỗ thiết kế

- **Provenance:** chỉ kiểm `name == CI / required`, `app.id == 15368`, `success` chưa bind check run với đúng source workflow run/attempt/check suite. Một workflow GitHub Actions khác có thể dùng cùng job name. Cần đối chiếu run ID/check-suite ID, event/path/repository/head SHA và đúng run đã phát `workflow_run`.
- **Superseded runs:** hai lần `ls-remote` chỉ phát hiện race, không sửa production đã deploy stale. Main có thể đổi sau lần đọc đầu hoặc trong lúc Render build/poll. Cần vòng reconcile dưới serialization: capture candidate, verify, trigger lấy deploy ID, poll đúng deploy/commit, rồi nếu main đổi thì deploy lại current verified main trước khi success.
- **Credentials:** Deploy Hook là bearer credential có quyền trigger service và `?ref=` cho phép chọn ref/SHA. Cần environment protection/allowed branches, masking (không echo URL), rotation/revocation, timeout/retry/idempotency và xử lý HTTP fail-closed. “Chỉ một service” không đồng nghĩa blast radius nhỏ nếu có thể replay SHA tùy ý.
- **Rollback:** rollback riêng frontend phá invariant backend/frontend cùng SHA; trigger hook tới SHA cũ cũng mâu thuẫn với gate “current main only”. Cần break-glass riêng, provenance/audit, kiểm tra compatibility migration/API, thứ tự rollback EC2/frontend, và tiêu chí roll-forward. Poll meta tag cũng cần cache-bust và bind với deploy ID/commit, không chỉ đọc một HTML có thể cache.

## Các claim đã xác nhận

- Timeline check-suite/check-run đúng: `741ed48` CI bắt đầu `03:56:01`; `f109484` bị cancel `03:56:37` và có 0 check runs; `e83f1f3` có Deploy check `skipped` `03:56:40`; `2d283aa` có Deploy check `skipped` `03:56:51-52` và `CI / required` success `04:10:29`.
- Control CI completion đúng: `56c7c35` `17:42:53`, `2eba83e` `18:05:33`, `ffbd1bf` `18:26:59`. Thời điểm Render lấy theo tài liệu như scope cho phép.
- Render docs xác nhận `success`/`neutral`/`skipped` đều pass, zero checks không deploy; dữ liệu incident xác nhận queued suites không có check runs không chặn.
- Năm thuộc tính PR #112 đều pass ở mức code/config. PR behavior giữ nguyên vì PR group vẫn là `CI-refs/pull/N/merge` và cancel-in-progress vẫn true. Câu “nothing is ever pending or cancelled” chỉ nên hiểu là không pending/cancel **do shared concurrency trên main**, không phải tuyệt đối (runner queue/manual cancellation vẫn tồn tại).
- `1f4d4d7` thực sự đổi `autoDeploy: true` thành `autoDeployTrigger: checksPass`; PR #112 giữ nguyên tên job `CI / required` và EC2 deploy pinning.

## Commands/evidence chính

`gh api repos/levuanh2/memvid_baocaototnghiep/commits/<sha>/check-suites`, `.../check-runs`, `gh run list --commit <full-sha>`, `gh run view <id> --log`, `gh api .../branches/main/protection`, `gh pr view/diff 112`, Git tree API cho `bc41c0ad`/`2d283aa`, và Render/GitHub official docs (GET only). Không có mutation GitHub/Render hoặc production.
