# Audit vòng 6 — pipeline upload: từ lúc nhận file tới lúc nằm yên ở đâu

Trace thật đường đi của một file, không đọc lướt. Câu hỏi: **lỗ hổng ở đâu**, và
**dữ liệu nằm ở chỗ nào có đúng không**.

---

## Đường đi thật (đã trace, không suy đoán)

```
POST /api/documents/upload   (FE gọi cái này — studyApi.js:38)
  │
  ├─ _require_app_user()                    quyền
  ├─ formats.is_supported(filename)         CHẶN TRƯỚC KHI GHI BẤT CỨ THỨ GÌ -> 415
  ├─ _unique_display_filename()             chống trùng stem (2 tài liệu cùng tên != trộn chunk)
  ├─ _safe_save_path()                      basename + fold ký tự cấm -> BE/input_docs/
  ├─ file.save(save_path)                   ghi đĩa TẠM
  ├─ storage.ensure_bucket() + upload()     bucket PRIVATE `documents`
  │     path = {user_id}/{document_id}/{filename}, mỗi phần qua _safe_key_part
  │     lỗi -> in cảnh báo, stored_path = bản local (KHÔNG chặn upload)
  ├─ _docs.create(...)                      Postgres `documents`
  └─ _trigger_background_ingest()           job_id = document_id
        │
        └─ ingest_graph: ExtractText -> Normalize -> Chunk -> EmbedAndIndex
                          -> BuildMemoryTree -> Finalize
             ├─ append_to_index()           FAISS  index/index.faiss + index/index.json
             ├─ chunk_text_store            index/chunks.sqlite
             ├─ _persist_sections_and_chunks()  Postgres `document_sections` + `document_chunks`
             ├─ build_memory_tree_for_sources() memory/memory_trees.json + memory_index.faiss
             └─ _don_file_tam()             xoá bản local CHỈ KHI Storage giữ bản gốc
```

**Bảy nơi dữ liệu nằm lại.** Trả lời câu "lưu ở chỗ nào có đúng không": phân vai rõ ràng
và đúng — Storage giữ **bản gốc**, Postgres giữ **dữ liệu nghiệp vụ**, FAISS + `chunks.sqlite`
là **chỉ mục tìm kiếm**, `memory/` là **cây nhớ**, `input_docs/` chỉ là chỗ **tạm**.

---

## Những chỗ ĐÃ ĐÚNG — kiểm rồi, đừng đụng

Ghi lại để vòng sau khỏi "sửa" nhầm:

| | bằng chứng |
|---|---|
| Chặn đuôi file TRƯỚC khi ghi | `_ingest_uploaded_file` gọi `is_supported()` ngay dòng đầu, trả 415 kèm danh sách đuôi hợp lệ |
| Giới hạn dung lượng | `main.py:56` `MAX_UPLOAD_MB=100` -> `app.config['MAX_CONTENT_LENGTH']`, có handler 413 riêng |
| Chống path traversal | **hai lớp**: `_safe_save_path` lấy `os.path.basename` + fold `[<>:"/\|?*\x00-\x1f]`; `storage.object_path` lấy `PurePosixPath(...).name` |
| Khoá Storage hợp lệ | `_safe_key_part` NFKD -> ASCII -> fold ký tự lạ (Supabase từ chối khoảng trắng/dấu tiếng Việt) |
| KHÔNG lộ storage path | `_doc_public` không có `file_path`; muốn mở file phải gọi `/api/documents/<id>/file` -> signed URL, ttl kẹp 60–3600s (NFR-04.3) |
| Xoá bản tạm an toàn | `_don_file_tam` so `documents.file_path` với đường local; **bằng nhau thì không xoá** — che đúng ca "Storage lỗi nên local là kho lưu duy nhất" |
| Gắn chủ sở hữu | `uid = _current_user_id()` lúc `create`; `_owned_document` trả **404** chứ không 403 (không tạo oracle đoán id) |
| Tài liệu đã xoá mềm | `all_rows()` lọc `status != "deleted"` + `invalidate_cache()` trong `soft_delete` |
| "Registry" KHÔNG phải file JSON | `_load_source_registry()` là `_docs.all_rows()` (Postgres). Tên cũ giữ cho back-compat — **không có hai nguồn sự thật về quyền sở hữu** |

---

## P1 — Đường xoá CHÍNH của FE không xoá file trên Storage (nặng nhất)

> **ĐÃ SỬA** — helper `_delete_storage_object` dùng chung, gọi ở bước 2 của route v2, guard `obj != input_path` giống `_don_file_tam`, xoá hỏng thì log chứ không nuốt. Response thêm `deleted_items.storage_object`. 5 test.

Có **hai** route xoá, và chúng làm khác nhau:

```
POST   /delete-source     (main.py:4064)  -> có gọi _storage.delete(obj)   (main.py:4131)
DELETE /sources/<id>      (main.py:4576)  -> 6 bước, KHÔNG có bước nào chạm Storage
```

6 bước của route v2: backup → xoá `input_docs` → xoá chunk index → xoá memory tree → xoá
registry row → xoá mindmap. Bản gốc trong bucket **không nằm trong danh sách**.

FE dùng route nào? `SidebarLeft.jsx:126` gọi `DELETE /sources/<id>` **trước**, chỉ rơi về
`POST /delete-source` khi cái kia hỏng. Tức **đường mặc định là đường không dọn Storage**.

**Hậu quả:** người dùng bấm xoá, mọi thứ biến mất khỏi giao diện, **file gốc vẫn nằm
nguyên trong bucket private** — vĩnh viễn, không đường nào dọn. Dung lượng chỉ tăng; và
với tài liệu học tập cá nhân thì "đã xoá" mà còn lưu là một lời hứa bị phá.

**Việc cần làm:**

1. Thêm bước xoá Storage vào route v2, dùng lại đúng đoạn đã có ở `main.py:4129-4131`
   (kiểm `obj != input_path` trước khi xoá — cùng cái guard của `_don_file_tam`).
2. Best-effort: Storage lỗi thì vẫn xoá phần còn lại, nhưng **phải log**, không nuốt im
   (bài học C5 vòng 2).
3. Test hồi quy: giả `storage.delete`, gọi route v2, khẳng định nó ĐƯỢC gọi đúng path.
4. Rà object mồ côi đang có: liệt kê bucket, đối chiếu `documents.file_path`. Chỉ **báo
   cáo**, không tự xoá.

**Là lỗi khi:** một đường xoá dọn ít nơi hơn đường xoá kia.

---

## P2 — Ghi chunk vào Postgres hỏng thì im lặng, tài liệu vẫn báo "xong"

> **ĐÃ SỬA** — `_persist_sections_and_chunks` trả bool vào `capabilities.structured_query`; `chunk_count=0` thay vì `None`. Fail-open GIỮ NGUYÊN. Hai bẫy dính khi sửa: `update_status` THAY chứ không gộp capabilities, và field mới phải khai trong `IngestState` nếu không LangGraph loại giữa hai node. 3 test.

`ingest_graph._persist_sections_and_chunks` bọc toàn bộ trong `try/except` với comment:

> "Lỗi ở đây KHÔNG chặn pipeline — index đã ghi xong, chat vẫn chạy; chỉ log lại để biết mà chữa."

Quyết định fail-open đó **đúng cho chat**. Nhưng trạng thái tài liệu không phản ánh gì:

- FAISS đã có chunk → chat trả lời được → `capabilities` báo dùng được.
- `document_chunks` **rỗng** → quiz (`chunks_for_scope`), study map, review, gap analysis
  đều không có nguồn.
- `set_counts(chunk_count=n)` nằm TRONG `try` → hỏng thì `chunk_count` giữ `None`.
- Tài liệu vẫn đi tiếp tới `Finalize` → `status = ready`.

Người dùng thấy "xử lý xong", hỏi đáp chạy ngon, rồi tạo quiz thì ra lỗi vô nghĩa. Không
log nào ở màn hình, chỉ một dòng `print` ở server.

So sánh: mindmap và summary có cờ `degraded_missing` để nói "chạy xong nhưng thiếu phần
nào". Ingest không có gì tương đương.

**Việc cần làm:**

1. Ghi thất bại này vào `documents.capabilities` (đã có sẵn trường) — ví dụ
   `{"chat": true, "quiz": false}` — thay vì để status nói dối.
2. `chunk_count = 0` thay vì `None` để phân biệt "chưa đo" với "đã đo, bằng 0".
3. Test: ép `replace_chunks` ném, khẳng định tài liệu KHÔNG báo đủ năng lực.

**Là lỗi khi:** một phần pipeline hỏng mà trạng thái vẫn nói thành công đầy đủ.

---

## P3 — Chế độ mở: kho chung vẫn còn chunk của tài liệu đã xoá mềm

> **ĐÃ SỬA** — chế độ mở + `sources` rỗng giờ trả `sorted(owned_stems(uid))` thay vì `[]`; `all_rows()` đã lọc `deleted` nên không thêm tầng lọc nào mới. Registry rỗng vẫn trả `[]` (= toàn kho) để không gãy cài mới. Test cũ ở `test_source_ownership.py` khẳng định hành vi cũ nên phải sửa theo.

`soft_delete` chỉ đổi `documents.status`; FAISS và `index.json` giữ nguyên chunk (đúng đặc
tả 8.10 "giữ dữ liệu con").

- `AUTH_PROTECT_APP_APIS=true` (giá trị đang chạy, `.env:49`): `owned_stems()` lấy từ
  `all_rows()` đã lọc `deleted` → **an toàn**.
- Chế độ mở: `_resolve_owned_query_sources` trả thẳng `raw_sources`, rỗng nghĩa là **tìm
  toàn bộ kho** — không có tầng nào lọc tài liệu đã xoá.

Đúng lớp lỗi "nhánh chế độ mở" của vòng 1 (Study Map vỡ 100% ở đúng nhánh này), nhưng lần
này **tiềm ẩn** vì cấu hình thật đang bật auth.

**Việc cần làm:** một test khoá hành vi — soft-delete rồi truy vấn ở chế độ mở, khẳng định
chunk của tài liệu đó không xuất hiện. Sửa hay chấp nhận là quyết định riêng; điều không
chấp nhận được là **không ai biết nó thế nào**.

---

## P4 — Hai upload trùng tên cùng lúc có thể ghi đè nhau (cần xác minh)

> **ĐÃ SỬA** — tái hiện được ngay bằng `threading.Barrier(2)`, không cần sleep giả: `_safe_save_path` không tạo file nào nên hai luồng LUÔN nhận cùng đường dẫn. Vá bằng `os.open(O_CREAT|O_EXCL)` chứ **không** phải `mkstemp` (mkstemp phá hình dạng tên file mà FE đang dựa vào).

`_safe_save_path` là vòng `while os.path.exists(path)` rồi mới `file.save(path)`. Giữa lúc
kiểm và lúc ghi có khe: hai request trùng tên cùng lúc chọn **cùng** một đường dẫn, bản sau
đè bản trước.

Cửa sổ rất hẹp trong một tiến trình, nhưng gunicorn chạy nhiều worker (`GUNICORN_TIMEOUT`
có trong Dockerfile) nên là **nhiều tiến trình dùng chung `input_docs/`**.

**Chưa xác minh:** chưa dựng được ca đua thật. Đừng sửa trước khi tái hiện —
`tempfile.mkstemp` trong cùng thư mục là bản vá đúng, nhưng vá một thứ chưa chứng minh
được là cách tạo lỗi mới.

**Việc cần làm:** thử tái hiện bằng 2 thread upload cùng tên; tái hiện được thì đổi sang
`mkstemp`, không thì ghi lại là đã xét và bỏ qua.

---

## P5 — Chỉ kiểm ĐUÔI file, không kiểm nội dung

`is_supported()` xét `os.path.splitext(...)`. Đổi tên `a.exe` thành `a.pdf` là qua cổng,
lên Storage, tạo dòng DB, rồi vài phút sau ingest mới chết.

**Mức độ: thấp.** Bucket private, file không bao giờ được phục vụ trực tiếp (chỉ signed
URL), và không có đường nào thực thi nội dung file. Hậu quả thật là **thông báo lỗi tệ**
chứ không phải lỗ bảo mật.

**Việc cần làm:** không thêm thư viện sniff MIME. Cùng lắm là đọc vài byte magic cho 3–4
định dạng phổ biến nhất, và chỉ để **thông báo sớm hơn**. Ưu tiên thấp nhất trong plan này.

---

## P6 — Ingest hỏng thì file trên Storage và dòng DB nằm lại mãi

> **ĐÃ ĐO, chưa cần cơ chế dọn** — `BE/scripts/dem_tai_lieu_loi.py`, chỉ đọc. Chạy thật: 1 tài liệu, 8.7 MB, lý do `disk I/O error`. Quy mô đó chưa đáng xây cron/chính sách giữ. **Chú ý:** cột DB là `status='failed'`, không phải `'error'` (`_STATUS_TO_DB`) — viết đúng chữ trong plan này thì query trả 0 hàng.

Ingest lỗi → `error_handler_node` đặt source `status="error"`. Object trên Storage và dòng
`documents` vẫn còn.

**Giữ lại là ĐÚNG** — muốn ingest lại thì phải còn file. Nhưng không có gì dọn những tài
liệu `error` bị bỏ quên, và cũng không có gì báo cho người dùng biết "cái này hỏng, xoá
hay thử lại".

**Việc cần làm:** không tự động xoá. Chỉ cần một câu truy vấn đếm tài liệu `status=error`
quá N ngày, để biết quy mô trước khi quyết định làm gì.

---

## Thứ tự chạy

| | mũi | vì sao ở đây | rủi ro |
|---|---|---|---|
| 1 | P1 xoá Storage ở route v2 | dữ liệu người dùng tưởng đã xoá vẫn còn | thấp — dùng lại mã đã có |
| 2 | P2 capabilities khi ghi chunk hỏng | trạng thái nói dối | thấp |
| 3 | P3 test chế độ mở + tài liệu đã xoá | khoá hành vi, chưa cần sửa | thấp |
| 4 | P4 thử tái hiện đua ghi file | **tái hiện trước, sửa sau** | — |
| 5 | P6 đếm tài liệu `error` tồn đọng | chỉ đo | — |
| — | P5 magic bytes | ưu tiên thấp nhất, có thể bỏ | — |

**Điểm dừng bắt buộc:** BE ≥ **894 passed / 4 skipped**, FE build + 212 test.

---

## Cố ý KHÔNG làm

- **Không đổi kiến trúc lưu trữ.** Bảy nơi nghe nhiều nhưng mỗi nơi một vai rõ ràng, và
  ranh giới đã được ghi bằng comment ở đúng chỗ. Gộp lại là viết lại, không phải sửa lỗi.
- **Không bỏ fail-open của `_persist_sections_and_chunks`.** Chat vẫn chạy được khi Postgres
  chập là hành vi đúng. Sửa phần **báo cáo trạng thái**, đừng sửa phần chịu lỗi.
- **Không đụng `POST /delete-source`** (legacy). Nó đang làm ĐÚNG hơn route mới; việc cần
  làm là kéo route mới lên bằng nó, không phải xoá cái cũ.
- **Không thêm dep sniff MIME** cho P5.
