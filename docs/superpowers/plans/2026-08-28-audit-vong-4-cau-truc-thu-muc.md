# Audit vòng 4 — cấu trúc thư mục và tài liệu mô tả nó

**Vòng 2 (C4) chỉ làm được một phần:** gom 3 thư mục lạc ở gốc kho (`01_/03_/04_` → `docs/`)
và xoá `.agents/` rỗng. Chưa hề soát bên trong `BE/` và `FE/`, và **chưa hề kiểm tài liệu
mô tả cấu trúc có còn đúng không** — hoá ra đó mới là chỗ hỏng nặng nhất.

**Nguyên tắc vòng này:** cấu trúc thư mục không sai. `app/domains/` 20 sub-package là kiến
trúc thật, `FE/src/utils` 19 mã + 19 test cạnh nhau là quy ước hợp lệ. Cái sai là **rác
lẫn trong đó** và **tài liệu kể một dự án khác**. Không tái cấu trúc gì hết.

---

## D1 — Tài liệu mô tả cấu trúc: 75% trỏ vào chỗ không tồn tại

> **ĐÃ SỬA** — viết lại 2 mục README bằng dữ liệu SINH từ `git ls-files` và
> `grep @app.route`. Tự kiểm bằng đúng phép đếm đã phát hiện lỗi:
> **cây 29 mục / sai 0**, **api 80 endpoint / ma 0 / thiếu 0**.

Đây là mục nặng nhất vòng này, và nó nguy hiểm theo đúng kiểu vòng 2 đã đặt tên: **file
nói dối**. Người mới đọc `README.md` để hiểu kho mã sẽ đi sai 3/4 số đường.

### D1.1 Mục "Cấu trúc dự án" (README.md dòng 93–191)

Đếm máy, không đếm mắt: **54/72 mục liệt kê trỏ vào đường dẫn không tồn tại.**

```
72 mục liệt kê | 54 sai | 41 đã DI CHUYỂN, 13 KHÔNG CÒN
```

13 mục **không còn** đều là di sản thời MemVid (bộ nhớ mã hoá vào video QR):

```
core_modules/            video_utils.py           chunk_processor.py
rebuild_index_from_video.py   videos/             mindmap_utils.py
vector_store.py          memory_tree.py           summarize_advanced.py
ai_provider.py           ollama_utils.py          storage/
lc_memory_tree.py        mindmaps.json            summaries.json
```

41 mục **đã di chuyển**: `main.py` → `app/main.py`, `graphs/` → `app/graphs/`,
`retrieval/` → `app/domains/retrieval/`, `env_loader.py` → `shared/env_loader.py`…
Cây thư mục trong README là ảnh chụp trước đợt tái cấu trúc sang `app/domains/`.

Thêm ba chỗ sai ở cấp cao hơn:

- Dòng đầu README: **"MemVidX - Hệ thống Trí nhớ Thị giác & RAG"**. Dự án giờ là StudyMap
  AI, xử lý tài liệu, không còn thị giác/video.
- Cây bắt đầu bằng `MemVid_New/` — **tên của DỰ ÁN KHÁC**. `BE/.env` có comment ghi rõ
  `DATA_DIR` từng trỏ nhầm sang `MemVid_New/BE` suốt nhiều tháng.
- README nhắc "video" ở **18 dòng**, trỏ `BE/videos/` và `DATA_DIR/videos` — không tồn tại.

### D1.2 Mục "API Endpoints" (README.md dòng 290+)

```
README liệt kê 27 endpoint | main.py có 78 route
  - 5 endpoint README nói mà KHÔNG tồn tại
  - 56 route có thật mà README KHÔNG nhắc
```

5 endpoint ma:

```
POST /process-doc        POST /summarize-file      POST /summarize-documents
POST /rebuild-index      GET  /rebuild-status/<job_id>
```

56 route thiếu là toàn bộ bề mặt Phase 6–7: study map, quiz, attempt, progress, review,
gap analysis, auth. Tức README dừng lại ở trạng thái dự án của nhiều tháng trước.

### D1.3 `BE/ENV_SETUP.md` — kết luận ban đầu SAI, và chỗ sai giấu lỗi nặng nhất vòng này

> **Đính chính sau khi thi hành.** Mục này ban đầu kết luận `ENV_SETUP.md` là "nguồn sự
> thật thứ hai, rỗng 93%" (9/128 khoá) và đề xuất rút thành một con trỏ. SAI: nó không hề
> định làm danh sách khoá — nó là tài liệu **THAO TÁC** (rebuild index, thứ tự nạp env,
> troubleshooting), phần đó không có ở `.env.example`. Đếm khoá là **đo sai câu hỏi**,
> cùng họ với `BASE_URL` khớp trong `DATABASE_URL` (vòng 1) và `cmp` báo khác vì
> line-ending (vòng 3).
>
> **May mà đọc kỹ trước khi rút gọn.** Bên trong file có khối PowerShell hard-code
> `$base = "e:/memvid_NCKH/MemVid_New/BE"` — **dự án KHÁC, có thật trên máy** — kèm
> `Remove-Item -Recurse -Force`. Làm theo tài liệu là xoá index của dự án đó. Rút file
> thành con trỏ là xoá luôn bằng chứng mà không ai biết nó từng tồn tại.
>
> **ĐÃ SỬA:** lệnh chạy tương đối theo `BE/`, tên artifact cập nhật
> (`mindmaps.json` -> `mindmaps.sqlite`), bảng default model trỏ `DEFAULT_LOCAL_MODEL`,
> `ollama pull` đổi sang `qwen2.5:7b-instruct`, bỏ `videos/`, thêm mục "Quên rebuild thì
> sao?" trỏ guard dim của vòng 3. Giữ file, thêm một dòng đầu nói `.env.example` mới là
> nơi tra khoá.

### Phép đếm ban đầu (giữ lại để thấy nó đo sai chỗ nào)

```
BE/.env.example: 128 khoá
BE/ENV_SETUP.md nhắc tới:  9 khoá   -> thiếu 119
```

Điểm tốt: nó không nhắc khoá nào đã chết (0 khoá ma). Điểm xấu: `BE/.env.example` vốn đã
là tài liệu (comment dày, nêu cả lý do VRAM và bài học `.playbook`), nên `ENV_SETUP.md` là
**bản sao thứ hai chỉ chép 7% nội dung**. Đúng lớp lỗi C2 vòng 2: hai file cùng mô tả một
thứ, một bản thắng, một bản nói thiếu.

### Quyết định cần chốt: vá hay viết lại?

**Đề xuất: viết lại HAI MỤC, giữ nguyên phần còn lại.**

Vá từng dòng cho mục "Cấu trúc dự án" nghĩa là sửa 54/72 dòng — nhiều hơn viết lại. Mục
API thì tệ hơn: thiếu 56 route, vá là gõ lại từ đầu.

Nhưng README 687 dòng **không** phải viết lại hết. Các mục "Hướng dẫn cài đặt",
"Tính năng", "Kiến trúc" phần lớn còn đúng — đụng vào là tự tạo việc.

Cụ thể:

1. Đổi tiêu đề + mục "Tổng quan" cho khớp StudyMap AI (bỏ "Trí nhớ Thị giác").
2. **Sinh** cây thư mục bằng lệnh thay vì gõ tay — gõ tay là cách nó lệch lần nữa:
   ```bash
   git ls-files | awk -F/ 'NF>2{print $1"/"$2"/"} NF==2{print $1"/"$2} NF==1{print $1}' | sort -u
   ```
   Giữ ở mức 2 tầng kèm chú thích một dòng mỗi mục. Cây 4 tầng liệt kê từng file là thứ
   vừa lệch 54 chỗ.
3. Bảng API: **sinh từ `main.py`**, không chép tay.
   ```bash
   grep -oE "@app\.(route|get|post|put|delete)\(\s*['\"][^'\"]+" BE/app/main.py
   ```
4. `BE/ENV_SETUP.md`: rút còn một con trỏ tới `BE/.env.example` + khối "hai hồ sơ, BE thắng"
   (giống cách xử `requirements.txt` ở gốc vòng 2). KHÔNG chép 128 khoá sang file thứ hai.

**Là lỗi khi:** README trỏ vào đường dẫn hoặc endpoint không tồn tại.

---

## D2 — Rác đang được git theo dõi

> **ĐÃ SỬA** — xoá cả 4 file.

| file | bằng chứng | xử |
|---|---|---|
| `BE/scratch_cut.txt` | **0 dòng**, nội dung `1395 1594` | xoá |
| `BE/package-lock.json` | lockfile npm **rỗng** (`"packages": {}`), **không có `package.json`** cạnh nó, trong backend Python | xoá |
| `FE/db.json` | mock json-server, 3 hội thoại rỗng | xoá |
| `FE/src/db.json` | mock json-server khác, hội thoại giả `"Chat với GPT"` / `"Xin chào!"` | xoá |

Xác minh trước khi xoá (đã chạy, cả hai đều rỗng):

```bash
grep -rn "db.json" FE/src FE/vite.config.js FE/package.json   # rỗng
grep -rn "scratch_cut" .                                       # rỗng
```

`FE/db.json` và `FE/src/db.json` **khác md5** — hai bản mock khác nhau, cùng thời
prototype (Nov 2025), không cái nào được import. Không có `json-server` trong
`package.json`.

**Là lỗi khi:** file được git theo dõi mà không mã nào, build nào, tài liệu nào dùng tới.

---

## D3 — Rác không theo dõi nằm cạnh mã nguồn

> **ĐÃ SỬA** — thêm `_backup-*/` vào `BE/.gitignore`, xác nhận bằng `git check-ignore -v`. Thư mục giữ nguyên (sqlite thật).

`BE/_backup-20260824-173248/` — 1.3M, bản sao runtime state (`checkpoints.sqlite`,
`conversations.sqlite`, `jobs.sqlite`, `logs.sqlite`, `sessions.sqlite`, `index/`,
`memory/`) từ hôm chép dữ liệu về repo.

`.gitignore` **không che nó**: `BE/.gitignore:5` có `index_backup_*/`, không khớp
`_backup-*`. Nó không bị commit chỉ vì chưa ai `git add -A` đúng lúc — mà phiên này tao đã
chạy `git add -A` ba lần.

**Việc cần làm:** thêm `_backup-*/` vào `BE/.gitignore` TRƯỚC. Xoá thư mục là quyết định
của mày — nó chứa sqlite thật, không phải rác sinh ra được lại.

**Là lỗi khi:** thư mục backup nằm trong cây mã mà không có luật ignore.

---

## D4 — `docs/` nửa phẳng nửa phân nhóm

> **ĐÃ SỬA** — `git mv` file kế hoạch vào `plans/`. 8 spec để phẳng, `.docx` để nguyên.

Sau khi vòng 2 chuyển `01_/03_/04_` vào:

```
docs/superpowers/  10      docs/skills/     4      docs/playbooks/  4
docs/tailieu/       3      docs/decisions/  3
docs/*.md nằm rời:  9 file + 1 .docx
```

9 file rời gồm `ARCHITECTURE.md`, `SUMMARY_V2_SPEC.md`, `SEMANTIC_CACHE_SPEC.md`,
`FLOW_UPLOAD.md`, `MINDMAP_WORKFLOW.md`, `QUY_TRINH_TAO_SO_DO_TU_DUY.md`,
`KET_QUA_THUC_NGHIEM.md`, `PRODUCTION_SMOKE_CHECKLIST.md`,
`mindmap_generation_optimization_plan.md` + `memvid_speed_fix.docx`.

Hai thứ lệch rõ:

- `mindmap_generation_optimization_plan.md` là **kế hoạch**, mà mọi kế hoạch khác nằm ở
  `docs/superpowers/plans/`.
- `memvid_speed_fix.docx` — `.docx` nhị phân trong kho mã, tên còn mang thời MemVid.

**Việc cần làm — mức tối thiểu, không dựng cây phân loại mới:** chuyển đúng file kế hoạch
vào `plans/`, và quyết `.docx` (giữ hay bỏ). 8 file spec còn lại để phẳng là **được** —
`docs/` phẳng 8 file không phải vấn đề, dựng thêm `docs/specs/` chỉ để cho gọn là việc tự
tạo ra.

**Là lỗi khi:** file cùng loại nằm hai chỗ khác nhau.

---

## Không phải lỗi — CỐ Ý không đụng

- `BE/app/domains/` 20 sub-package: kiến trúc thật, mỗi domain có repository/service riêng.
- `FE/src/utils` 19 mã + 19 test cạnh nhau: quy ước hợp lệ, `vitest` đang xanh 212 test.
- `FE/src/components/Layout/` viết hoa lệch với `mindmap/ study/ ui/`: đổi tên thư mục kéo
  theo sửa import ở mọi file dùng nó, đổi lấy một chữ hoa. Không đáng.
- Bảy thư mục không theo dõi ở `BE/` (`data/ index/ memory/ input_docs/ cleaned_md/
  reports/`): đó là runtime state, `.gitignore` đã che đúng.
- `BE/app/main.py` 4737 dòng: vẫn chưa có bằng chứng nào nói kích thước file gây lỗi nào.

---

## Thứ tự chạy

| | mũi | vì sao ở đây | rủi ro |
|---|---|---|---|
| 1 | D3 `.gitignore` cho `_backup-*` | chặn nguy cơ commit 1.3M sqlite, 1 dòng | thấp |
| 2 | D2 xoá 4 file rác | đã chứng minh 0 người dùng | thấp |
| 3 | D4 chuyển 1 file kế hoạch | `git mv` | thấp |
| 4 | D1.3 `ENV_SETUP.md` thành con trỏ | cùng cách đã dùng cho `requirements.txt` gốc | thấp |
| 5 | D1.1 + D1.2 viết lại 2 mục README | **sinh bằng lệnh, không gõ tay** | trung bình |

**Điểm dừng bắt buộc:** BE suite ≥ **894 passed / 4 skipped**; FE `npm run build` + 212 test.
D2/D3/D4 không đụng mã nên chỉ cần chạy suite một lần ở cuối.

**Cách tự kiểm D1 sau khi viết lại** — chạy lại đúng phép đếm đã dùng để phát hiện:

```bash
# 0 đường dẫn sai, 0 endpoint ma
```

Không đạt 0 thì chưa xong.
