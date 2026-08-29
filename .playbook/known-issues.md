# Known Issues

## (ĐÃ SỬA 2026-08-29) Xoá tài liệu xong, bản gốc vẫn nằm trong bucket private

Audit vòng 6 — trace đường đi của một file từ lúc nhận tới lúc nằm yên.

Có **hai** route xoá, làm khác nhau:

```
POST   /delete-source     main.py:4064  -> CÓ gọi _storage.delete(obj)
DELETE /sources/<id>      main.py:4576  -> 6 bước dọn, KHÔNG bước nào chạm Storage
```

6 bước của route v2: backup -> xoá `input_docs` -> xoá chunk index -> xoá memory tree ->
xoá registry row -> xoá mindmap. Bản gốc trong bucket **không có trong danh sách**.

Tệ hơn: docstring của chính route đó ghi *"Xóa: 1. File gốc trong input_docs/ **và object
trên Supabase Storage**"*. Tài liệu hứa, mã không làm.

FE dùng route nào? `SidebarLeft.jsx:126` gọi `DELETE /sources/<id>` **trước**, chỉ rơi về
`POST /delete-source` khi cái kia hỏng. **Đường mặc định là đường không dọn.**

- **Hậu quả:** người dùng bấm xoá, giao diện sạch, file gốc nằm lại **vĩnh viễn** trong
  bucket private. Không đường nào dọn về sau. Với tài liệu học tập cá nhân thì "đã xoá"
  mà còn lưu là một lời hứa bị phá, không chỉ là tốn dung lượng.
- **Fix:** helper `_delete_storage_object(source_info)` dùng chung, gọi ở bước 2 của route
  v2. Guard `obj != input_path` **giống hệt `_don_file_tam`**: khi Storage chưa cấu hình
  hoặc upload lỗi thì `documents.file_path` chính là đường local, và bước xoá file local đã
  lo — gọi `storage.delete` với một đường dẫn đĩa là vô nghĩa.
- **Không nuốt im:** xoá hỏng thì in cảnh báo (bài học C5 vòng 2 — rác tồn kho có tính tiền).
  Response thêm `deleted_items.storage_object`: `None` = không có gì để xoá, `True/False` =
  đã thử và kết quả.
- **KHÔNG đụng route cũ.** `POST /delete-source` đang làm ĐÚNG HƠN route mới; việc cần làm
  là kéo route mới lên bằng nó.
- **Regression:** `tests/test_upload_pipeline_holes.py` — 5 test cho P1, gồm một khẳng định
  cấu trúc rằng route v2 có gọi bước này.

---

## (ĐÃ SỬA 2026-08-29) Ghi chunk vào Postgres hỏng thì im, tài liệu vẫn báo "xong"

`ingest_graph._persist_sections_and_chunks` bọc toàn bộ trong `try/except` với lý do đúng:

> "Lỗi ở đây KHÔNG chặn pipeline — index đã ghi xong, chat vẫn chạy."

Fail-open đó **đúng cho chat**. Nhưng trạng thái tài liệu không phản ánh gì:

- FAISS đã có chunk -> hỏi đáp chạy ngon.
- `document_chunks` **rỗng** -> quiz (`chunks_for_scope`), study map, review, gap analysis
  đều mất nguồn. Chúng đọc Postgres, không đọc FAISS.
- `set_counts(chunk_count=n)` nằm TRONG `try` -> hỏng thì `chunk_count` giữ `None`.
- Tài liệu vẫn đi tiếp tới `Finalize` -> `status = ready`.

Người dùng thấy "xử lý xong", chat chạy tốt, rồi tạo quiz thì gặp lỗi vô nghĩa. Chỉ có một
dòng `print` ở server. So sánh: mindmap/summary có `degraded_missing` để nói "xong nhưng
thiếu phần nào"; ingest không có gì tương đương.

- **Fix:** `_persist_sections_and_chunks` trả `bool`; kết quả đi vào
  `capabilities.structured_query`. Fail-open **giữ nguyên** — chỉ sửa phần BÁO CÁO.
- `chunk_count = 0` khi hỏng, thay vì để `None`: `None` là "chưa đo", `0` là "đã đo, rỗng".
- **Bẫy đã dính khi sửa:** `update_status` ghi `meta["capabilities"] = capabilities` —
  **THAY, không gộp**. Node `BuildMemoryTree` ghi capabilities sau nên xoá mất cờ. Không
  gộp ở tầng repository (gộp thì không caller nào tắt được một capability nữa) mà truyền cờ
  qua state.
- **Bẫy thứ hai:** `state.py` có sẵn comment *"LangGraph merge state chỉ giữ field có trong
  TypedDict"*. Thiếu dòng khai `structured_query: NotRequired[bool]` là cờ bị loại giữa hai
  node. Comment đó cứu đúng một lần.
- **Regression:** 3 test — hỏng thì `structured_query=False` + `chunk_count=0`, chạy tốt thì
  `True`, và một test khoá rằng field có trong `IngestState`.

---

## (ĐÃ SỬA 2026-08-29) `_safe_save_path` chỉ KIỂM tên, không giành tên

Audit vòng 6 — P4. Vòng trước ghi "chưa tái hiện được ca đua, chưa vá". Tái hiện được, và
khe không hẹp như tưởng:

```python
while os.path.exists(path):      # chỉ kiểm
    path = f"{root}_{n}{ext}"
return path                      # KHÔNG tạo gì -> file mãi tới file.save() mới ra đời
```

Hai luồng gọi cùng lúc **luôn** nhận cùng một đường dẫn — không phải "cửa sổ rất hẹp", mà
là toàn bộ khoảng từ lúc trả chuỗi tới lúc `file.save()`. Test dùng `threading.Barrier(2)`,
không cần sleep giả, hỏng ngay lần đầu:

```
AssertionError: hai luồng chọn cùng một đường dẫn: ['...ao_cao.pdf', '...ao_cao.pdf']
```

- **Hậu quả:** hai upload trùng tên cùng lúc, bản lưu sau đè bản trước. Người thứ nhất
  thấy tài liệu "xong" nhưng nội dung là file của người thứ hai. Gunicorn nhiều worker
  dùng chung `input_docs/` nên là nhiều **tiến trình**, khoá trong tiến trình vô dụng.
- **Fix:** `os.open(path, O_CREAT|O_EXCL|O_WRONLY)` trong vòng lặp — giành tên atomic ở
  tầng hệ điều hành, đúng ranh giới nhiều tiến trình. `FileExistsError` -> thử `_2`, `_3`.
- **KHÔNG dùng `tempfile.mkstemp`** như plan gốc đề xuất: nó phá hình dạng tên
  (`bao_cao_2.pdf` -> `tmp8f2x.pdf`), mà tên đọc được là thứ `_unique_display_filename` và
  cả FE đang dựa vào. `O_EXCL` giữ nguyên tên, cùng stdlib, ít dòng hơn.
- **Kéo theo:** `os.makedirs(INPUT_DIR)` phải chuyển VÀO trong hàm — hàm giờ ghi đĩa thật,
  gọi nó trước khi thư mục tồn tại sẽ chết.
- **Đánh đổi đã cân:** `save` ném thì còn file 0 byte. Giống hệt hành vi cũ (file ghi dở),
  `_don_file_tam` trong `finally` của job ingest dọn.
- **Regression:** `tests/test_upload_pipeline_holes.py::test_hai_upload_trung_ten_cung_luc_*`

---

## (ĐÃ SỬA 2026-08-29) Chế độ mở: `sources` rỗng = quét toàn kho, gồm cả tài liệu đã xoá

Audit vòng 6 — P3. `soft_delete` chỉ đổi `documents.status`, chunk trong FAISS nằm nguyên
(đúng đặc tả 8.10 "giữ dữ liệu con"). `_resolve_owned_query_sources` với
`AUTH_PROTECT_APP_APIS=false` trả thẳng `[]`, và `[]` xuống tầng truy hồi nghĩa là **tìm
toàn bộ kho** — không tầng nào lọc `deleted`.

Cùng lớp lỗi "nhánh chế độ mở" của vòng 1 (Study Map vỡ 100% ở đúng nhánh này).

- **Fix một dòng:** rỗng -> `sorted(owned_stems(user_id))`. Chế độ mở `owned_stems` bỏ qua
  chủ sở hữu nhưng vẫn lấy từ `all_rows()`, mà `all_rows()` **đã** lọc `status != deleted`.
  Không thêm tầng lọc mới, chỉ dùng cái đã có.
- **Registry rỗng vẫn trả `[]`** (= toàn kho) như cũ: cài mới hoặc kho chưa đăng ký không
  được biến thành "không tìm gì cả".
- **Mặt trái đã cân:** stem có trong index mà KHÔNG có trong registry (index nhập từ
  ngoài, registry mất) sẽ không được tìm ở chế độ mở nữa. Đo được từ mã thì không, nhưng
  cấu hình thật đang bật auth nên bán kính nổ nhỏ.
- **Test cũ phải sửa theo:** `test_source_ownership.py` khẳng định `flag off + [] -> []`.
  Đó chính là hành vi vừa đổi; sửa khẳng định, không phải sửa mã.
- **Regression:** `test_upload_pipeline_holes.py::test_che_do_mo_*` (3 test: liệt kê,
  registry rỗng, có chọn nguồn).

---

## (2026-08-29) ĐÃ ĐO: tài liệu ingest hỏng tồn đọng — 1 dòng, 8.7 MB

Audit vòng 6 — P6. Ingest lỗi thì object trên Storage và dòng `documents` giữ nguyên. Giữ
là **đúng** (ingest lại thì phải còn file), nhưng không có gì đo được đống đó lớn cỡ nào.

`BE/scripts/dem_tai_lieu_loi.py` — chỉ đọc, không xoá. Chạy thật trên DB:

```
1 tài liệu hỏng cũ hơn 0 ngày (8.7 MB, cũ nhất 2026-08-25).
lý do hỏng thường gặp:  1  disk I/O error
```

**Quy mô nhỏ -> chưa cần cơ chế dọn.** Đo trước, quyết sau; đó là toàn bộ mục đích.

**Bẫy chữ `status`, suýt trả lời sai:** `ck_documents_status` chỉ nhận
`uploaded|processing|completed|failed|deleted`. Pipeline gọi trạng thái này là `error`, cột
DB lưu `failed` (`repository._STATUS_TO_DB`). Truy vấn `status = 'error'` trả **0 hàng** và
kết luận "không có gì tồn đọng" — sai theo cách im lặng nhất. Plan vòng 6 viết `status=error`
đúng theo từ vựng pipeline; script phải dịch sang từ vựng DB.

---

## (2026-08-29) Pipeline upload — những chỗ ĐÃ ĐÚNG, đừng "sửa"

Trace đầy đủ rồi mới kết luận. Ghi lại để vòng sau khỏi đụng nhầm:

| | bằng chứng |
|---|---|
| Chặn đuôi file TRƯỚC khi ghi bất cứ gì | `_ingest_uploaded_file` gọi `is_supported()` dòng đầu -> 415 kèm danh sách đuôi hợp lệ |
| Giới hạn dung lượng | `main.py:56` `MAX_UPLOAD_MB=100` -> `MAX_CONTENT_LENGTH`, có handler 413 riêng |
| Chống path traversal | **hai lớp**: `_safe_save_path` (`os.path.basename` + fold `[<>:"/\|?*\x00-\x1f]`) và `storage.object_path` (`PurePosixPath(...).name`) |
| Khoá Storage hợp lệ | `_safe_key_part` NFKD -> ASCII -> fold (Supabase từ chối khoảng trắng/dấu tiếng Việt) |
| KHÔNG lộ storage path | `_doc_public` không có `file_path`; mở file phải qua `/api/documents/<id>/file` -> signed URL, ttl kẹp 60–3600s (NFR-04.3) |
| Xoá bản tạm an toàn | `_don_file_tam` so `file_path` với đường local, **bằng nhau thì không xoá** |
| Gắn chủ sở hữu | `uid = _current_user_id()` lúc `create`; `_owned_document` trả **404** chứ không 403 (không tạo oracle đoán id) |
| Tài liệu xoá mềm | `all_rows()` lọc `status != "deleted"` + `invalidate_cache()` trong `soft_delete` |

**Một nghi ngờ đã RÚT LẠI:** `_load_source_registry()` nghe như đọc file JSON và tao đã
định ghi nó là "nguồn sự thật thứ hai cho quyền sở hữu". Đọc kỹ thì nó là
`_docs.all_rows()` (Postgres); tên cũ giữ cho back-compat. **Không có hai nguồn sự thật.**

**Bảy nơi dữ liệu nằm lại, phân vai đúng:** Storage = bản gốc, Postgres = dữ liệu nghiệp
vụ, FAISS + `chunks.sqlite` = chỉ mục, `memory/` = cây nhớ, `input_docs/` = tạm.

---

## (2026-08-29) CHƯA SỬA, đã xét: 1 điểm còn lại của pipeline upload

(Hai điểm kia — chế độ mở thấy tài liệu đã xoá, và khe TOCTOU của `_safe_save_path` — đã
sửa cùng ngày, xem hai mục ĐÃ SỬA ở trên.)

- **Chỉ kiểm ĐUÔI file, không kiểm nội dung.** Đổi tên `a.exe` -> `a.pdf` là qua cổng.
  Mức độ **thấp**: bucket private, file không bao giờ phục vụ trực tiếp (chỉ signed URL),
  không đường nào thực thi nội dung. Hậu quả thật là thông báo lỗi tệ, không phải lỗ bảo
  mật. Không thêm dep sniff MIME.

## (ĐÃ SỬA 2026-08-29) `USE_LC_VECTOR_STORE`: ba tầng, ba default, một tầng nói ngược

Tìm ra khi soạn plan vòng 5, không phải do ai báo lỗi. Cùng một cờ, ba nơi định nghĩa
mặc định:

```
shared/config.py:98        use_lc_vector_store: bool = True
shared/env_loader.py:45    os.environ.setdefault("USE_LC_VECTOR_STORE", "1")
vectorstore/store.py:65    os.getenv("USE_LC_VECTOR_STORE", "0")      <-- NGƯỢC
```

`tests/conftest.py` đặt `MEMVID_DISABLE_LC_DEFAULTS=1` nên tầng giữa im lặng. Khi đó
`config` trả **True** còn `store` trả **False** cho cùng một câu hỏi.

Ai thắng: `store`, vì `hybrid.py:252,338` và 5 chỗ trong `store.py` gọi
`_use_lc_vector_store()`. Còn trường trong config:

```
settings.use_lc_vector_store -> 0 người đọc
settings.use_lc_ensemble     -> 0 người đọc
settings.use_lc_qa_chain     -> 0 người đọc
settings.use_lc_ingest       -> 0 người đọc
```

**Cả bốn trường `use_lc_*` không ai đọc.** Mã thật vẫn `os.getenv()` rải rác — đúng thứ mà
docstring của chính `shared/config.py` tuyên bố đã dẹp: *"Settings tập trung — nạp env MỘT
lần thay vì os.getenv() rải rác lúc import."* Ví dụ minh hoạ trong docstring đó còn dùng
`s.use_lc_vector_store` — dạy người đọc dùng đúng trường không ai đọc.

- **Root cause:** trường được thêm vào config như một "sẽ chuyển sang dùng sau", nhưng bước
  chuyển không bao giờ xảy ra. Không ai xoá, nên nó thành nguồn sự thật giả.
- **Fix:** gỡ 4 trường + 4 kwarg khỏi `Settings`, đổi ví dụ docstring sang `s.crag_enabled`
  (trường có người đọc thật), và dán khối giải thích tại `store._use_lc_vector_store()` nêu
  rõ nó là ĐIỂM ĐỌC DUY NHẤT + vì sao default "0" là cố ý.
- **KHÔNG đổi default "0" thành "1".** Đó là đường LEGACY mà toàn bộ test retrieval đang
  chạy, và cũng là đường có guard dim của `hybrid._load_faiss_index` (vòng 3). Đổi default
  là đổi đường mà cả bộ test đi qua — sửa một cái lệch trên giấy, tạo một cái lệch thật.
- **Kèm:** hai cờ anh em ở `query_graph.py` đọc theo hai ngữ nghĩa ngược nhau —
  `USE_LC_ENSEMBLE` dùng `not in (falsy)` nên `"maybe"` ra **True**, `USE_LC_QA_CHAIN` dùng
  `in (truthy)` nên `"maybe"` ra **False**. Thống nhất về một hàm `_truthy` dùng chung;
  `"1"/"0"` không đổi kết quả, chỉ giá trị rác đổi và đổi theo hướng an toàn (TẮT).
- **Regression:** `tests/test_lc_flag_mot_nguon.py` (13 test): config không còn trường
  `use_lc_*`, bảng truthy đầy đủ 10 ca, default không-env về legacy, và khẳng định cấu trúc
  rằng hai cờ anh em cùng đi qua `_truthy`.
- **Prevention:** đây là **lần thứ ba** gặp "trừu tượng dựng xong rồi bị bỏ qua", sau
  `shared/paths.default_data_dir()` (0 caller, 3 module tự viết lại) và
  `__meta__["embedding_dim"]` (ghi 6 lần, đọc 0 lần). Luật: thêm một trường vào `config`
  thì **cùng commit đó** phải có ít nhất một chỗ đọc nó; nếu không thì đừng thêm.

---

## (ĐÃ SỬA 2026-08-29) Hai nhánh cấu hình của ingest chưa từng chạy

`USE_LC_INGEST` và `ENRICH_METADATA` đều mặc định BẬT và **không test nào từng đặt về
tắt**. Đúng lớp lỗi đã làm Study Map vỡ 100% ở chế độ mở.

- **Fix:** `tests/test_ingest_flag_branches.py` (5 test) chạy `build_ingest_graph` thật với
  cả hai giá trị của cả hai cờ. Mọi dependency nặng đã là seam inject sẵn
  (`extract_text`, `split_text`, `append_to_index`, `build_memory_tree_for_sources`) nên
  không đụng model, FAISS hay Postgres.
- **Kết quả:** cả bốn nhánh đều chạy được, không nhánh nào hỏng. Khác Study Map — lần đó
  nhánh chưa chạy vỡ 100%.
- **Bẫy khi viết:** graph có checkpointer sqlite nên `invoke()` bắt buộc
  `config={"configurable": {"thread_id": ...}}`, thiếu là
  `ValueError: Checkpointer requires one or more of the following 'configurable' keys`.

**Một test của chính đợt này từng XANH mà không đo gì.** Bản đầu khẳng định
`assert m_bat != m_tat or not m_bat` trên `out["chunk_metadatas"]` — **khoá không tồn tại**
(khoá thật là `doc_meta`, `ingest_graph.py:186`). Cả hai phía ra `{}`, vế `or not m_bat`
nuốt trọn, test xanh. Đã đọc đúng khoá và **bỏ vế thoát**: giờ khẳng định `doc_meta` có nội
dung khi bật và rỗng khi tắt.

**Prevention:** khẳng định dạng `assert A != B or not A` là mùi — vế `or` biến test thành
hằng đúng khi cả hai phía rỗng. Và khoá state phải đối chiếu với mã, đừng đoán theo tên.

---

## (2026-08-29) Dep BE: `pip show Required-by` trả lời, không cần thí nghiệm

Plan vòng 3 (R4.3) đề xuất "gỡ trong venv rồi chạy suite, đỏ thì trả lại" cho 5 gói nghi
thừa. Thừa công — một lệnh là xong:

```
pandas       Required-by: (rỗng)                                  -> GỠ
pdfplumber   Required-by: (rỗng)                                  -> GỠ
scipy        Required-by: scikit-learn, sentence-transformers     -> GIỮ
psutil       Required-by: pymupdf4llm                             -> GIỮ
tqdm         Required-by: huggingface_hub, sentence-transformers  -> GIỮ
```

`pdfplumber` không phải bộ đọc PDF của dự án — `fitz` (PyMuPDF) và `pymupdf4llm` mới là
(`ingest_utils.py:2`, `markdown_convert.py:9`).

- **Fix:** gỡ 2 dòng khỏi `BE/requirements.txt`, kèm comment nêu lý do giữ `psutil` (không
  có dòng import nào nhưng `pymupdf4llm` cần).
- **Prevention:** "không có dòng `import`" KHÔNG đủ để kết luận thừa — `gunicorn`,
  `grpcio-tools`, `psycopg`, `psutil` đều sống mà không có import. Hỏi `pip show`, đừng
  hỏi `grep`.

---

## (2026-08-29) CHƯA ĐO ĐƯỢC: cổng LLM 1 -> 2, vì GPU đang bị chiếm

Plan vòng 5 (E4) đặt điều kiện tiên quyết "máy phải RẢNH". Kiểm lúc chạy:

```
nvidia-smi   5331 MiB / 6141 MiB đã dùng, GPU 40%
/api/ps      {"models":[]}          <- Ollama KHÔNG giữ gì
```

Tức 5.3 GB đang bị tiến trình khác giữ (explorer.exe, msedgewebview2.exe, các
SystemApps), còn trống ~810 MiB — không đủ nạp model 4.68 GB. Đo lúc này chỉ đo tốc độ
CPU offload, không đo được điều cần biết.

**Gần y hệt lần trước:** sự cố Study Map 487 giây truy ra là do GPU bị chiếm
5378/6141 MiB. Cùng ngưỡng, cùng kiểu.

**Chưa đổi gì.** `MAX_CONCURRENT_LLM_CALLS` giữ `1`. Đo lại khi `nvidia-smi` báo dưới
~1 GB đang dùng, theo giao thức trong plan vòng 5.

**Ghi thêm — example lệch thực tế:** `BE/.env.example:295` ghi
`MAX_CONCURRENT_LLM_CALLS=2` trong khi giá trị đang chạy là `1` (từ `.env:40`, vì `BE/.env`
không khai báo khoá này nên rơi xuống root). Cùng họ với `SLM_MODEL` ở vòng 2: file mẫu
mô tả một cấu hình không ai chạy.

## (ĐÃ SỬA 2026-08-28) `BE/ENV_SETUP.md` chứa lệnh xoá NHẦM DỰ ÁN KHÁC

Nặng nhất vòng 4, và không phải lỗi mã — lỗi **tài liệu hướng dẫn thao tác phá huỷ**.

Mục "Rebuild FAISS Index khi đổi Embedding Model" có khối PowerShell mở đầu bằng:

```powershell
$base = "e:/memvid_NCKH/MemVid_New/BE"
Remove-Item -Recurse -Force "$base/index"
Remove-Item -Force "$base/memory/memory_index.faiss"
...
```

`MemVid_New` là **dự án KHÁC và CÓ THẬT trên máy này** (`ls -d /e/memvid_NCKH/MemVid_New`
trả về đường dẫn). Ai làm theo tài liệu là xoá `index/` cùng toàn bộ memory artifact của
dự án đó, còn dự án đang làm thì không đụng tới — vừa mất dữ liệu chỗ khác, vừa tưởng đã
rebuild xong.

Đây đúng là cái bẫy đã cắn một lần rồi: `BE/.env` có comment ghi `DATA_DIR` từng trỏ sang
`MemVid_New/BE` suốt nhiều tháng, toàn bộ trạng thái chạy rơi ra ngoài repo. Cùng một
đường dẫn tuyệt đối, cùng một dự án nhầm, ở hai file khác nhau.

Tên artifact trong khối lệnh cũng đã lỗi thời: `mindmaps.json` -> `mindmaps.sqlite`,
`summaries.json` -> `summaries.sqlite`, `mindmap_content_cache.json` không còn. Nên kể cả
sửa đúng `$base` thì lệnh vẫn không xoá được thứ cần xoá.

- **Fix:** khối lệnh chạy **tương đối theo `BE/`**, không còn đường dẫn tuyệt đối nào để gõ
  nhầm; tên artifact cập nhật theo thực tế; thêm mục "Quên rebuild thì sao?" trỏ tới guard
  dim mới (vòng 3) — giờ có câu báo rõ thay vì `AssertionError` rỗng.
- **Prevention:** **KHÔNG đường dẫn tuyệt đối trong tài liệu**, nhất là tài liệu có
  `Remove-Item -Recurse -Force` / `rm -rf`. Lệnh phá huỷ phải neo vào thư mục hiện tại.
- Sửa kèm: bảng "Biến quan trọng nhất" ghi `SLM_MODEL_CHAT` mặc định `qwen3.5:9b` và
  `SLM_MODEL_SUMMARY` mặc định `qwen2.5:14b` — cả hai đã gom về `DEFAULT_LOCAL_MODEL` ở
  vòng 2; `ollama pull qwen3.5:9b` ở mục troubleshooting đổi thành `qwen2.5:7b-instruct`
  (6.59 GB không vừa card 6.14 GiB); `videos/` bỏ khỏi danh sách "file an toàn".

**Đính chính phương pháp — lần thứ BA cùng một họ sai.** Plan vòng 4 kết luận
`ENV_SETUP.md` là "nguồn sự thật thứ hai, rỗng 93%" vì nó chỉ nhắc 9/128 khoá env, và đề
xuất rút nó thành một con trỏ. SAI. Nó không hề định làm danh sách khoá — nó là tài liệu
**thao tác** (rebuild index, thứ tự nạp env, troubleshooting), và phần nội dung đó không
có ở `.env.example`. Rút thành con trỏ là xoá mất thứ duy nhất có giá trị, và sẽ bỏ luôn
cái lệnh xoá nhầm dự án mà không ai phát hiện.

Đếm khoá là **phép đo sai câu hỏi** — cùng họ với `cmp` báo khác vì line-ending, và với
`BASE_URL` khớp trong `DATABASE_URL`. Trước khi đo, hỏi: file này định làm gì? Đo đúng thứ
nó định làm.

---

## (ĐÃ SỬA 2026-08-28) `README.md` mô tả một dự án khác — 75% đường dẫn sai

Đếm máy, không đếm mắt.

**Mục "Cấu trúc dự án":**

```
72 mục liệt kê | 54 SAI  (41 đã DI CHUYỂN, 13 KHÔNG CÒN)
```

13 mục không còn đều thuộc thời MemVid mã hoá bộ nhớ vào video QR: `core_modules/`,
`video_utils.py`, `chunk_processor.py`, `rebuild_index_from_video.py`, `videos/`,
`mindmap_utils.py`, `vector_store.py`, `memory_tree.py`, `summarize_advanced.py`,
`ai_provider.py`, `ollama_utils.py`, `storage/`, `lc_memory_tree.py`.

41 mục đã di chuyển: `main.py` -> `app/main.py`, `graphs/` -> `app/graphs/`, `retrieval/`
-> `app/domains/retrieval/`, `env_loader.py` -> `shared/env_loader.py`. Cây trong README là
ảnh chụp TRƯỚC đợt tái cấu trúc sang `app/domains/`.

**Mục "API Endpoints":**

```
README 27 endpoint | main.py 78 route
  5 endpoint README nói mà KHÔNG tồn tại
 56 route có thật mà README KHÔNG nhắc
```

5 endpoint ma: `/process-doc`, `/summarize-file`, `/summarize-documents`, `/rebuild-index`,
`/rebuild-status/<job_id>`. 56 route thiếu là toàn bộ bề mặt Phase 6–7 (study map, quiz,
attempt, progress, review, gap analysis, auth).

Thêm: tiêu đề vẫn là "MemVidX - Hệ thống Trí nhớ Thị giác"; cây bắt đầu bằng `MemVid_New/`
— **tên dự án khác**, đúng thư mục mà `.env` từng trỏ nhầm; 18 dòng nói về "video".

- **Fix:** viết lại ĐÚNG HAI MỤC, giữ nguyên phần còn lại (Cài đặt / Tính năng / Kiến trúc
  phần lớn còn đúng — đụng vào là tự tạo việc). Đổi tiêu đề + Tổng quan sang StudyMap AI,
  kèm một ghi chú lịch sử nói rõ hướng video QR đã bỏ.
- **Cách chống lệch lại: SINH, không gõ tay.** Cây dừng ở **2 tầng** sinh từ `git ls-files`;
  bảng API sinh từ `grep @app.route BE/app/main.py`. Cây 4 tầng liệt kê từng file gõ tay
  chính là thứ vừa lệch 54 chỗ. Cả hai lệnh sinh được dán ngay trong README.
- **Tự kiểm sau khi viết** (chạy lại đúng phép đếm đã phát hiện lỗi):
  `cây 29 mục | sai 0` · `api: README 80 | ma 0 | thiếu 0`.

---

## (ĐÃ SỬA 2026-08-28) Rác được git theo dõi + `.gitignore` hụt tiền tố backup

| file | bằng chứng | xử |
|---|---|---|
| `BE/scratch_cut.txt` | **0 dòng**, nội dung `1395 1594` | xoá |
| `BE/package-lock.json` | lockfile npm **rỗng** (`"packages": {}`), KHÔNG có `package.json` cạnh nó, nằm trong backend Python | xoá |
| `FE/db.json` | mock json-server, 3 hội thoại rỗng | xoá |
| `FE/src/db.json` | mock json-server KHÁC (khác md5), hội thoại giả `"Chat với GPT"` | xoá |

Xác minh trước khi xoá: `grep -rn "db.json" FE/src FE/vite.config.js FE/package.json` rỗng;
không có `json-server` trong `package.json`; `grep -rn "scratch_cut"` chỉ trúng plan vòng 4 và một ghi chú cá
nhân KHÔNG được git theo dõi (`06_Resume_States/`) — không mã, build hay tài liệu nào dùng.

**`.gitignore` hụt:** `BE/.gitignore:5` có `index_backup_*/` nhưng thư mục thật tên
`_backup-20260824-173248/` (1.3M sqlite runtime thật). Tiền tố không khớp, nên nó nằm trần
trong cây mã — thoát commit chỉ vì may, trong khi phiên này đã chạy `git add -A` ba lần.
Thêm `_backup-*/`. KHÔNG xoá thư mục: nó chứa sqlite thật, không sinh lại được.

**Prevention:** luật ignore phải khớp tên THẬT đang có trên đĩa. Viết luật xong thì
`git check-ignore -v <đường dẫn thật>` để xác nhận, đừng tin mẫu nhìn có vẻ đúng.

---

## (ĐÃ SỬA 2026-08-28) `docs/` — file kế hoạch nằm ngoài `plans/`

`docs/mindmap_generation_optimization_plan.md` là kế hoạch, trong khi mọi kế hoạch khác ở
`docs/superpowers/plans/`. `git mv` vào đó.

**CỐ Ý không làm:** 8 file spec còn lại để phẳng trong `docs/`. Dựng thêm `docs/specs/` chỉ
để cho gọn là việc tự tạo ra. `docs/memvid_speed_fix.docx` (nhị phân, tên thời MemVid) để
nguyên — xoá tài liệu không đọc được nội dung là quyết định của người dùng.

## (ĐÃ SỬA 2026-08-28) Index FAISS lệch dim: `AssertionError` RỖNG, truy hồi âm thầm tụt về BM25

**Chính xác hoá phạm vi.** Plan vòng 3 viết "index tài liệu không kiểm dim". Không đủ
chính xác — đường **GHI** có guard: `store._load_index(dim)` so `idx.d` với dim model, lệch
thì xoá index và build lại. Đường **ĐỌC** mới là chỗ hở: `hybrid._load_faiss_index()` đọc
file rồi `idx.search(qv, k)` thẳng.

Cửa sổ hở: đổi `EMBEDDING_MODEL_NAME` rồi **truy vấn TRƯỚC khi ingest lại lần nào**. Ingest
lại là index tự rebuild và cửa sổ đóng.

**Tái hiện (chạy được, không cần model thật):**

```python
idx = faiss.IndexFlatIP(384); idx.add(np.random.rand(5, 384).astype('float32'))
faiss.read_index(path).search(np.random.rand(1, 1024).astype('float32'), 3)
# AssertionError :          <- message RỖNG
```

**Vì sao nặng hơn vẻ ngoài:** cả hai chỗ search trong `hybrid.py` đều bắt rồi log
`logger.warning("... legacy FAISS search failed: %s", exc)`. `exc` không có message, nên
dòng log ra cụt ngủn — và chỗ thứ nhất tiếp tục chạy với `faiss_ids` rỗng (truy hồi tụt về
**BM25-only**), chỗ thứ hai `return []`. Người dùng vẫn nhận được câu trả lời, dựng từ nửa
số nguồn, không có dấu hiệu gì. Đúng lớp "hỏng mà không kêu".

- **Bất đối xứng giữa hai anh em** — hình dạng lỗi lặp lại của dự án này. `memory/tree.py`
  làm ĐÚNG: `_tree_matches_current_embedding()` so cả `embedding_model_name` lẫn
  `embedding_dim`, in `Drop legacy tree for <stem>: model=… dim=… != current …`, và
  `_rebuild_memory_index` đếm `skipped_mismatched`. Module anh em không có gì.
- **`__meta__["embedding_dim"]` ghi 6 lần, đọc 0 lần** (`store.py` 410/481/663/882).
  Metadata có sẵn từ lâu, chưa ai dùng.
- **Fix:** guard trong `hybrid._load_faiss_index(expected_dim=...)`, ném `ValueError` nêu
  CẢ HAI số chiều + tên model + cách dựng lại. Đặt ở đó vì cả hai đường search đi qua nó,
  và nó có cache theo `(mtime_ns, size)` nên guard chạy một lần mỗi khi index đổi, KHÔNG
  phải mỗi query. `expected_dim` lấy từ `qv.shape[1]` — không phụ thuộc metadata có đúng
  hay không.
- **Tham số tuỳ chọn, không bắt buộc:** caller cũ không truyền gì thì hành vi y hệt.
- **Regression:** `tests/test_retrieval_dim_guard.py` (5 test). Trong đó có một test khoá
  lại chính LÝ DO guard tồn tại — `AssertionError` của faiss phải rỗng; faiss đổi hành vi
  thì test đỏ và bắt đọc lại lời giải thích.
- **Prevention:** metadata ghi ra mà không ai đọc là mã chết trá hình. `grep` chiều ghi
  và chiều đọc của mọi khoá `__meta__` trước khi thêm khoá mới.

**Bẫy Windows gặp lúc viết test:** đặt tên test có dấu tiếng Việt (`test_lech_dim_thi_ném…`)
làm `tmp_path` của pytest chứa ký tự non-ASCII, và `faiss.write_index` không mở được file
đó: `could not open ... for writing: No such file or directory`. Tên hàm test giữ ASCII;
docstring thì thoải mái.

---

## (ĐÃ SỬA 2026-08-28) Job chấm tự luận đứng im 20% tới khi xong

Vòng 2 đo và kết luận: tiêu chí "khoảng im ĐẦU TIÊN > 5 giây" không job nào vi phạm — mọi
job báo mốc đầu ngay lúc bắt đầu. Còn lại là biến thể nhẹ hơn: **thanh đứng yên giữa
chừng**. Bốn chỗ:

| job | cửa sổ đứng im | trong đó chạy gì | tổng thật |
|---|---|---|---|
| `short_answer_grading` | 20% → 100% | 1 LLM mỗi câu tự luận | — |
| `quiz_generation` | 30% → 70% | `generate_questions` + retry | 43–70s |
| `study_map_generation` | 75% → 85% | `pipeline.relations()` | 106s / job 487–633s |
| `ingest` | trong `BuildMemoryTree` | 1 LLM mỗi section | job tới 410s |

**Chỉ sửa MỘT.** `short_answer_grading` được chọn vì người học đang NGỒI CHỜ màn hình điểm
(khác `ingest` chạy nền), và vòng lặp theo câu hỏi đã có sẵn nên diff nhỏ nhất.

- **Fix:** `grade_attempt(..., progress_cb=...)` kêu **TRƯỚC** mỗi lời gọi LLM. Đặt sau thì
  dòng đầu chỉ xuất hiện khi câu đầu đã chấm xong — đúng lỗi đã mắc ở summary 2026-08-27.
- **Mẫu số chỉ đếm câu TỰ LUẬN.** Trắc nghiệm chấm bằng so chuỗi, xong tức thì; đưa vào
  mẫu số thì thanh nhảy vọt rồi đứng im — mô tả sai chỗ thời gian thật sự trôi.
- **`study_map` Relations chỉ đổi NHÃN**, không chia nhỏ: `pipeline.relations()` là MỘT lời
  gọi LLM đơn. Nhãn giờ là `Đang tìm quan hệ giữa {n} khái niệm...`. Chia nhỏ một lời gọi
  LLM để thanh chạy mượt là làm đẹp bằng cách làm chậm.
- **KHÔNG làm `ingest`:** chạy nền, không ai ngồi nhìn.
- **Regression:** `tests/test_grading_progress.py` (5 test). Test chính đo **số mốc progress
  đã kêu TẠI THỜI ĐIỂM lời gọi LLM đầu tiên bắt đầu**, không đếm tổng lúc xong — tổng vẫn
  đúng ngay cả khi dồn hết về cuối.

---

## (ĐÃ SỬA 2026-08-28) `.gitattributes`: line-ending trộn đã đẻ ra một kết luận sai

Kho không có `.gitattributes`, `core.autocrlf=true`, nên git tự đoán file nào là text.
Kết quả: `.claude/rules/*.mdc` là CRLF còn `.cursor/rules/*.mdc` là LF **dù nội dung y hệt**.

Hậu quả thật, không phải giả định: `cmp` báo cả 7 cặp "khác nội dung", tao viết kết luận đó
vào plan vòng 2 và vào `README.md`. Phải đính chính cả hai. `diff --strip-trailing-cr` ra
0 dòng khác.

- **Fix:** `.gitattributes` với `* text=auto`, đánh dấu `binary` cho docx/faiss/pkl/ảnh, và
  `-diff` cho `FE/package-lock.json`.
- **CỐ Ý không chạy `git add --renormalize .`:** nó đụng ~470 file và tạo một diff che mất
  mọi thay đổi mã khác. Từng file tự chuẩn hoá khi có người sửa nó.
- **Prevention:** khi hai file "giống hệt mà công cụ báo khác", nghi line-ending TRƯỚC khi
  nghi nội dung. `diff --strip-trailing-cr` là câu hỏi đúng.

## (ĐÃ SỬA 2026-08-28) Audit vòng 2 — file cấu hình trùng tên nhưng nói khác nhau

Ba cặp file "trùng" mà mỗi cặp có một bản THẮNG và một bản NÓI DỐI. Không phải rác — là
bẫy, vì người đọc bản thua tin rằng mình đang chỉnh thứ có hiệu lực.

### 1. `requirements.txt` ở gốc vs `BE/requirements.txt`

Gốc 64 dòng KHÔNG pin gì (`langchain`, `langgraph`); BE pin `langchain>=0.3.27,<0.4`,
`langgraph>=0.2.57,<0.3` kèm lý do: langgraph 1.x kéo `ormsgpack`, binary đó bị Windows
Application Control chặn.

- **Hậu quả:** `pip install -r requirements.txt` ở thư mục gốc cài đúng bản đang cấm.
  CI chưa dính vì `.github/workflows/ci.yml:32` ưu tiên `BE/requirements.txt`; người mới
  clone thì dính.
- **Fix:** file gốc còn ĐÚNG MỘT dòng `-r BE/requirements.txt` + comment nêu lý do.

### 2. `.env.example` gốc vs `BE/.env.example`

**Chỉnh lại phán đoán ban đầu:** lúc quét tao đếm "12 khoá khác giá trị" rồi kết luận cả
12 đều là lỗi. Đọc kỹ thì 11/12 là CỐ Ý — hai file là hai HỒ SƠ khác nhau, không phải hai
bản sao: gốc = docker/prod (docker-compose thay thế 102 chỗ `${VAR}` từ đó, nên
`OLLAMA_HOST=host.docker.internal`, `REDIS_URL=redis://redis:6379/0`, `QUEUE_ENABLED=true`
đều đúng), BE = dev trên máy.

Chỉ MỘT khoá là lỗi thật, và nó đúng là khoá đã hành dự án hai lần:

```
SLM_MODEL   gốc: qwen2.5:7b-instruct   BE: qwen3.5:9b   <- BE THẮNG, 6.59 GB / card 6.14 GiB
```

Nguyên nhân gốc tìm ra ở đây: `BE/.env.example` **lặp key `SLM_MODEL` hai lần**, dòng thứ
hai chú thích "Alias backward-compatible" — người viết định đặt `SLM_MODEL_CHAT` nhưng gõ
lại `SLM_MODEL`. Vì vậy `SLM_MODEL_CHAT` KHÔNG BAO GIỜ có trong `BE/.env.example`, kéo
theo không có trong `BE/.env`, nên giá trị an toàn chỉ tồn tại ở `.env` gốc — file ưu tiên
THẤP hơn. Đây là toàn bộ cơ chế của "biến an toàn nằm ở file thua" mà vòng 1 phát hiện.

- **Fix:** `BE/.env` và `BE/.env.example` đặt `SLM_MODEL_CHAT=qwen2.5:7b-instruct` và
  `SLM_MODEL=qwen2.5:7b-instruct` (hết lặp key). Cả hai file example thêm khối đầu nói rõ
  **hai hồ sơ, và BE/.env thắng khi trùng khoá**.
- **Prevention:** khác giá trị giữa hai file KHÔNG mặc nhiên là lỗi. Phân loại theo HỒ SƠ
  trước; chỉ khoá nào cùng hồ sơ mà lệch mới là lỗi.

### 3. `frontend-design/SKILL.md` có hai bản y hệt (cùng md5)

`.claude/rules/frontend-design/` và `.claude/rules/skills/frontend-design/`. Cả hai được
nạp vào context mỗi phiên nên trả gấp đôi token cho cùng một nội dung. `README.md` lại ghi
vị trí chuẩn là `.agents/rules/skills/...` mà thư mục `.agents/` **rỗng**; README cũng
viện dẫn `CLAUDE.md` (không tồn tại) và `.cursor/rules/project-rules.mdc` (file đó nằm ở
`.claude/rules/`). Ba nguồn sự thật, không cái nào đúng.

- **Fix:** giữ bản trong `skills/`, xoá bản kia, viết lại README theo bố cục thật.

**Đính chính 2026-08-28 (kèm):** README cũ ghi 7 file `.mdc` trùng tên giữa `.claude/rules/`
và `.cursor/rules/` là "cả 7 đều khác nội dung". SAI — `cmp` báo khác vì **line-ending**:
`.claude/rules/*.mdc` là CRLF, `.cursor/rules/*.mdc` là LF. So bằng
`diff --strip-trailing-cr` thì cả 7 cặp ra **0 dòng khác**.

Chúng là bản sao y hệt. Bài học giống hệt lần `BASE_URL` khớp trong `DATABASE_URL`: công cụ
trả lời đúng câu hỏi mình HỎI, không phải câu hỏi mình NGHĨ. `cmp` so byte, mà byte khác
không có nghĩa nội dung khác. Chuẩn hoá trước khi so.

Chưa gộp vì mỗi công cụ đọc thư mục riêng của nó — trùng lặp ở đây là do tooling ép, không
phải do ai đó quên. Cần `.gitattributes` để hai bên hết lệch CRLF/LF.

---

## (ĐÃ SỬA 2026-08-28) Mã chết: 1460 dòng, 0 người gọi

Quét bằng một lượt đọc `git ls-files '*.py'` rồi tìm tên module/hàm không xuất hiện ở file
nào khác (bỏ `scripts/` và `alembic/versions/` — dương tính giả: entry point và revision id).

| xoá | dòng | ghi chú |
|---|---|---|
| `services/mindmap/utils.py` | 1414 | pipeline iterative-prompting CŨ, 40 `def`, 0 importer |
| `app/clients/provider_factory.py` | 19 | factory 2 hàm, 0 caller |
| `app/domains/memory/lc_memory_tree.py` | 9 | re-export "cho thống nhất roadmap" |
| `FE/src/components/ui/Button.jsx` | 18 | 0 import |
| 9 hàm chết trong file còn sống | ~70 | xem danh sách trong plan vòng 2 |
| 5 import chết ở `main.py` | 5 | `Callable`, `ask_ai`, `fcntl`, `send_from_directory`, `unicodedata` — đã chết TRƯỚC đợt này |
| 4 dep FE | — | `@heroicons/react`, `axios`, `react-icons`, `uuid` — 0 hit toàn `src/` |

Hai thứ đáng chú ý hơn phần còn lại:

- `accept_attribute()` có docstring nói "test `test_upload_formats.py` khoá chuỗi này khớp
  với FE". Test đó CÓ THẬT và vẫn chạy — nhưng nó đọc thẳng `DocumentList.jsx` rồi so với
  `SUPPORTED_EXTENSIONS`, không hề gọi hàm này. Docstring nói sai về chính người dùng nó.
- `shared/paths.py` sinh ra để gom đường dẫn về một chỗ, nhưng helper `default_data_dir()`
  0 caller: ba module (`cache/llm_cache.py:180`, `conversation/store.py:31`,
  `jobs/jobs_store.py:21`) tự viết lại `Path(os.environ.get("DATA_DIR", str(BE_ROOT)))`
  tại chỗ. Trừu tượng dựng xong rồi không ai dùng.

**Còn hở, CHƯA sửa:** `validate_vector_index_compatibility()` bị xoá vì 0 caller. Nghĩa là
**không có chỗ nào kiểm dim của FAISS index lúc load**, dù `.env` cảnh báo "đổi
EMBEDDING_MODEL_NAME thì PHẢI rebuild index". Đổi model xong query sẽ ném AssertionError
khó hiểu từ faiss thay vì một câu báo rõ ràng. Có 5+ chỗ `faiss.read_index`, nối guard vào
chỗ nào là một quyết định riêng, không phải việc của đợt dọn.

---

## (ĐÃ SỬA 2026-08-28) Default model viết cứng 12 chỗ — gom về một hằng

Vòng 1 đếm 7 chỗ. Quét lại kỹ ra **12**: `qwen2.5:14b` x8, `qwen3.5:9b` x3,
`qwen3.6:35b-a3b` x2 (`memory/tree.py:23` và `main.py:37` — cùng một dòng copy sang nhau,
và tag 35B **chưa bao giờ được pull về máy** nên gọi vào là 404, không phải chậm).

- **Fix:** `shared/config.DEFAULT_LOCAL_MODEL = "qwen2.5:7b-instruct"`, mọi chỗ tham chiếu
  hằng đó. Xác minh: bỏ hết env thì `chat/summary/mindmap/quiz` và memory tree đều ra
  `qwen2.5:7b-instruct`.
- **Regression:** `tests/test_default_model_khong_hardcode.py` — quét mã (bỏ dòng comment)
  tìm ba tên model nặng; `test_mindmap_modelcfg.py` đổi từ so chuỗi cứng sang so hằng.
- **Vì sao cần test chứ không phải comment:** `main.py:1255` ĐÃ có comment "một nguồn sự
  thật `_model_map` — hết stale default kiểu qwen3.5:9b hardcode". Comment không chặn được
  lần tái phát nào.
- **Miễn trừ có chủ ý:** `vision/transcribe.py:27` giữ `DEFAULT_MODEL="qwen3.5:9b"` — tác vụ
  đọc ảnh cần model có khả năng thị giác, không dùng chung `DEFAULT_LOCAL_MODEL` (7b-instruct
  KHÔNG có vision).

  **Đính chính 2026-08-28:** lúc đầu tao kết luận "chức năng ảnh gần như chắc chắn đang
  hỏng vì máy chưa pull model VL nào". SAI. Hỏi `/api/show` cho biết:

  ```
  qwen3.5:9b          ['completion', 'vision', 'tools', 'thinking']
  gemma4:e4b          ['completion', 'vision', 'audio', 'tools', 'thinking']
  qwen2.5:7b-instruct ['completion', 'tools']          <- không có vision
  ```

  Default đang dùng ĐÚNG là model có vision, và `is_available()` còn probe `capabilities`
  rồi fail-closed nên FE ẩn nút ảnh khi không dùng được. Không có lỗi ở đây.

  Bài học: suy ra "không có model VL" từ việc nhìn TÊN model trong `/api/tags` là đoán.
  `/api/show` trả thẳng `capabilities` — hỏi cái đó, đừng đoán theo tên.

  Còn lại đúng một điều: 6.59 GB trên card 6.14 GiB nên lượt đọc ảnh tràn xuống CPU và
  chậm. Chậm, không phải hỏng.

---

## (ĐÃ SỬA 2026-08-28) `/api/jobs/<id>/cancel` hứa suông với 3 loại job

Route nhận MỌI `job_id` và luôn trả `cancel_requested: true`. Nhưng
`grep -rn is_cancel_requested BE/app BE/services` chỉ trúng mindmap, summary, quiz,
study map. `ingest`, `query`, `short_answer_grading` không đọc cờ ở đâu cả.

Đo thật (tạo job running rồi `request_cancel`):

```
ingest                 status=running    cancel_requested=True
short_answer_grading   status=running    cancel_requested=True
query                  status=running    cancel_requested=True
summary                status=running    cancel_requested=True   <- chỉ cái này có ai ack
```

`sweep_stuck_jobs` không cứu được: nó chỉ đụng job ngừng heartbeat quá
`JOB_STUCK_AFTER_SECONDS`, mà job đang chạy vẫn `update_job` đều.

- **Chưa nổ vì:** FE chỉ gọi `cancelJob` từ hook `useStudyJob`, và hook đó chỉ dùng ở
  QuizSetup / ReviewGuide / StudyMapView — cả ba đều là loại CÓ ack. `QuizTaking` nộp bài
  xong không theo dõi job chấm. Nối nút huỷ cho ingest là kẹt "Đang huỷ…" ngay.
- **Fix:** KHÔNG dựng đường huỷ mới cho ingest (chưa ai gọi = việc suy đoán). Sửa chỗ nói
  dối: route trả **409** cho `job_type` không nằm trong `_CANCELLABLE_JOB_TYPES`, và
  **không bật cờ**. Bật cờ rồi bỏ đó chính là cách sinh ra "Đang huỷ…" kẹt.
- **Regression:** `tests/test_job_cancel_contract.py` (8 test, parametrize cả hai phía).
- **Prevention:** thêm `job_type` vào `_CANCELLABLE_JOB_TYPES` CHỈ SAU KHI executor của nó
  thật sự gọi `is_cancel_requested`.

---

## (ĐÃ SỬA 2026-08-28) Nuốt lỗi im lặng: 81 chỗ, chỉ 3 chỗ đáng sửa

`grep -rn -A1 "except Exception" | grep -c "pass$"` ra 81 (40 trong `main.py`). Phân loại
theo NỘI DUNG khối `try` thay vì sửa đồng loạt:

| nhóm | số chỗ | xử lý |
|---|---|---|
| import động (đường dự phòng thật) | 24 | giữ nguyên |
| log / telemetry / cache | 5 | giữ nguyên |
| có ghi DB/file trong khối | 12 | soi từng chỗ |
| còn lại | 36 | giữ nguyên |

Trong 12 chỗ "có ghi", chỉ 3 chỗ là vấn đề:

1. **`mindmap_graph._set_job` và `summary_graph._set_job`** — MỌI trạng thái của hai graph
   đi qua đây, kể cả `status="done"` kèm `result`. Ghi hỏng thì job không bao giờ tới done,
   FE poll tới hết TTL, không log nào giải thích. Đúng lớp lỗi known-issues 2026-07-06.
   **Fix:** in ra `set_job_failed job_id=... keys=... err=...`, KHÔNG ném (ném ở đây làm
   hỏng cả pipeline vì một lần ghi SQLite bị khoá).
2. **`store.py:469`** — `emb_dim` giữ 0 rồi ghi thẳng vào `__meta__`. Đọc lại không phân
   biệt được "chưa đo" với "model 0 chiều". **Fix:** in cảnh báo.

Chỗ thứ ba (`store.py:143`, `_save_meta` lúc migrate `__meta__`) fail-open là **đúng** —
dict trong bộ nhớ đã có `__meta__`, lần load sau thử lại, không mất dữ liệu. Đã thêm
comment `ponytail:` nói rõ để lần sau không ai "sửa" nó.

**Prevention:** đừng sửa gộp cả 81 chỗ. Fail-open quanh log/cache/import là thiết kế đúng;
sửa mù là cách nhanh nhất tạo sự cố tiếp theo.

## (ĐÃ SỬA 2026-08-28) Memory tree — bản sao THỨ BA của lỗi song song không kẹp theo cổng LLM

Tìm ra khi soạn kế hoạch audit toàn dự án, quét theo LỚP LỖI chứ không theo thư mục.
Sau `mindmap_factory._enrich_parallel` (2026-08-26) và `summary_factory._parallel`
(2026-08-27), chỗ thứ ba là `BE/app/domains/memory/tree.py:481`:

```python
max_workers = min(4, int(os.environ.get("MAX_SUMMARIZE_WORKERS", "3")))
with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
    for result in executor.map(_summarize_section, section_raw_data):
```

`_summarize_section` gọi `_llm_summarize_for_memory`, tức 3 lời gọi LLM song song đâm vào
`MAX_CONCURRENT_LLM_CALLS=1`. Hai luồng sau xếp hàng, chờ quá
`LLM_QUEUE_WAIT_TIMEOUT_SECONDS=180` thì ném `LLM busy (in-process): all 1 slots in use`.

- **Root cause:** giống hệt hai lần trước — số worker đoán từ một biến env riêng thay vì
  hỏi tầng đang giới hạn thật sự (cổng LLM in-process).
- **Vì sao NẶNG hơn hai lần trước:** `executor.map` ném lại lỗi lúc duyệt kết quả, không
  bắt riêng từng worker. `ingest_graph.BuildMemoryTree` bắt exception rồi đánh dấu CẢ tài
  liệu `memory_tree_failed` + `memory_query: False`, và để lại cây dở dang
  `status="building"` trong `memory_trees.json`. Summary chỉ mất một mục; đây mất cả cây.
- **Tái hiện rẻ:** hạ `LLM_QUEUE_WAIT_TIMEOUT_SECONDS` xuống 5 — 2/3 worker chết trong 40
  giây thay vì phải chờ 180s. Cùng mẹo đã dùng cho summary.
- **Fix:** hàm public `so_worker_tom_tat()` kẹp `min(4, MAX_SUMMARIZE_WORKERS, inproc_slots())`,
  sàn 1. Public để test gọi thẳng, không phải dựng cả pipeline ingest.
- **Hệ quả chấp nhận:** cổng đang là 1 slot nên cây ký ức giờ dựng TUẦN TỰ — chậm hơn,
  nhưng trước đó không phải nhanh hơn mà là hỏng.
- **Regression:** `BE/tests/test_memory_tree_parallel.py` (4 test: kẹp theo cổng, tôn trọng
  cổng rộng, giữ trần cứng 4, sàn 1).
- **Prevention:** mọi `max_workers=` mới trong `BE/app`, `BE/services`, `BE/shared` mà hàm
  worker có gọi `ask_ai` PHẢI lấy trần từ `llm_factory.inproc_slots()`. Quét bằng
  `grep -rn "max_workers=" BE/app BE/services BE/shared --include=*.py | grep -v test`.

## (ĐÃ SỬA 2026-08-28) Quiz / attempt / progress cũng vỡ ở chế độ mở — cùng bẫy `str(None)`

Phần còn lại của mục Study Map ngay dưới. Quét cả `BE/app` tìm `str(user_id)` rồi GỌI THẬT
từng hàm với `None` (không đọc mã suy đoán) — 6 chỗ vỡ, tất cả cùng một thông báo
`invalid input syntax for type uuid: "None"`:

| file:dòng | kiểu | hàm | hậu quả |
|---|---|---|---|
| `quiz/repository.py:25` | GHI | `create_quiz` | job tạo quiz chết |
| `attempts/repository.py:45` | GHI | `open_attempt` | mở quiz để làm bài chết |
| `attempts/repository.py:33` | LỌC | `open_attempt` | cùng hàm, vỡ trước dòng 45 |
| `progress/service.py:73,76,82,88,93` | LỌC | `overview` | `/api/progress/overview` 500 |
| `progress/service.py:124` | LỌC | `concept_progress` | `/api/progress/concepts` 500 |
| `progress/service.py:170` | LỌC | `attempt_history` | `/api/progress/attempts` 500 |
| `progress/service.py:198` | LỌC | `latest_graded_attempt` | so mastery trước/sau chết |

**Không dính:** `review/service.py:223` và `gap_analysis/service.py:129` lấy user_id từ
hàng DB đã có (`attempt.user_id`, `row.user_id`) nên không bao giờ None.
`documents`, `quiz.list_by_document`, `attempts.list_by_quiz`, `studymap.list_by_document`
đều đã có sẵn `if user_id is not None`.

**Fix — ba loại, KHÔNG sửa đồng loạt.** Codebase có sẵn hai quy ước cho uid None, chọn sai
là rò dữ liệu:

- *Loại A — GHI vào cột NOT NULL uuid:* quy về user ẩn danh (`ensure_anonymous_user()`).
  `quiz.create_quiz`, `attempts.open_attempt`. Riêng `open_attempt` giải MỘT lần rồi dùng
  cho cả truy vấn tra attempt đang mở lẫn hàng ghi — hai chỗ hai giá trị thì mỗi lần F5
  đẻ một attempt mới.
- *Loại B — LỌC đã có phạm vi tài liệu:* bỏ lọc chủ sở hữu (quy ước `list_by_document`).
  Đã dùng cho `studymap.latest_completed`.
- *Loại C — LỌC theo TÀI KHOẢN, không phạm vi nào khác:* quy None về user ẩn danh rồi lọc
  theo đó (`progress._chu_so_huu`). **Bê loại B sang đây là rò dữ liệu** —
  `/api/progress/overview` sẽ trả gộp số liệu của cả 12 user trong DB cho một người gọi
  ẩn danh. Đo trước khi sửa: 12 tài liệu trong DB; sau khi sửa đúng: `document_count: 0`.

**Regression:** `test_practice_and_progress.py::test_che_do_mo_chay_het_chuoi_quiz_attempt_progress`
(chạy nguyên chuỗi upload → quiz → attempt → review plan → 3 endpoint progress với uid None)
và `::test_che_do_mo_khong_thay_du_lieu_cua_user_dang_nhap` (chốt đúng điểm loại C: dựng cả
một bộ dữ liệu cho user CÓ đăng nhập rồi khẳng định overview ẩn danh KHÔNG đổi). 14 passed.

Khẳng định trong hai test đó là **độ lệch so với mốc đo**, không phải số tuyệt đối: user ẩn
danh dùng chung giữa các test và `pytest-randomly` đổi thứ tự chạy mỗi lần.

## (ĐÃ SỬA 2026-08-27) Study Map vỡ HOÀN TOÀN ở chế độ mở — `str(None)` thành chuỗi `"None"`

- **Triệu chứng:** `AUTH_PROTECT_APP_APIS` tắt (chế độ mở, `_require_app_user` trả
  `(None, None)`) thì `/api/study-maps/generate` **500 ngay**, hoặc job chết với nguyên
  văn lỗi psycopg lọt ra tận UI:
  `(psycopg.errors.InvalidTextRepresentation) invalid input syntax for type uuid: "None"`
- **Root cause:** `knowledge_maps.user_id` là `NOT NULL uuid` (`fk()` mặc định
  `nullable=False`). Hai chỗ ép thẳng `str(user_id)`, mà `str(None)` ra CHUỖI `"None"` —
  không phải NULL, nên Postgres không báo "thiếu giá trị" mà báo "uuid sai cú pháp":
  1. `studymap/repository.latest_completed` — chạy TRONG route (`if not force:` tra cache),
     nên đây là chỗ vỡ TRƯỚC, job còn chưa kịp tạo.
  2. `studymap/repository.create_map` — chỗ vỡ thứ hai, job chết sau ~25s.
  `documents/repository.create` đã quy `user_id=None` về user ẩn danh
  (`ensure_anonymous_user()`) từ Phase 2; studymap không làm theo.
- **Fix:** `create_map` quy None về user ẩn danh (cột NOT NULL nên phải có uuid thật);
  `latest_completed` KHÔNG lọc theo chủ sở hữu khi `user_id is None` — đúng quy ước
  `list_by_document` vốn đã có sẵn ngay trong cùng file đó.
- **Vì sao 8 test cũ không bắt được:** cả 8 đều gọi `_protect(be, monkeypatch, owner)`,
  tức chỉ chạy nhánh CÓ đăng nhập. Nhánh `_require_app_user` trả None chưa test bao giờ.
- **Regression:** `test_studymap_generate.py::test_che_do_mo_van_tao_duoc_map` và
  `::test_che_do_mo_van_dung_cache_va_force` (10 passed).
- **Cùng lỗi, CHƯA sửa (ngoài phạm vi lần này, cùng chuỗi màn hình):**
  `quiz/repository.py:25` (`create_quiz`) và `attempts/repository.py:33,45`
  (`open_attempt`) cũng ép `str(user_id)` trên uid có thể None. Chế độ mở đi qua được
  Study Map rồi vẫn chết ở màn tạo quiz. Cách sửa y hệt.
- **Prevention:** cột `NOT NULL uuid` + `str()` là cái bẫy im lặng — `str(None)` KHÔNG
  thành NULL. Chỗ nào nhận uid từ `_require_app_user()` thì phải xử lý None tường minh,
  vì hàm đó trả None là hành vi ĐÚNG theo tài liệu, không phải lỗi.

## (KHÔNG PHẢI LỖI 2026-08-27) Study Map chạy 487 giây — GPU đang bị game chiếm

Đo trên `Day08- RAG Pipeline.docx` (18 chunk): job `done`, 19 node, 7 cạnh, 37 chunk link,
**487,3 giây**. Cùng tài liệu đó chạy mindmap hôm 26 chỉ mất 833s cho 20 node, và tóm tắt
mất 60,9s — nên 487s cho một job 3 nhánh là chậm bất thường.

Nguyên nhân không nằm trong mã. `curl /api/ps` lúc đó:

```
qwen2.5:7b-instruct 5.12 GB, vram 0.19
```

Model 7b (vốn vừa VRAM) chỉ được cấp **0,19 GB VRAM** — phần còn lại chạy CPU.
`nvidia-smi` cho thấy 5378/6141 MiB đã bị chiếm và tiến trình
`TheIsleClient-Win64-Shipping.exe` (game trên Steam) đang giữ GPU ở 100%.

Trước khi kết luận "pipeline chậm", kiểm tra `nvidia-smi --query-compute-apps` và
`curl -s localhost:11434/api/ps`. `size_vram` thấp hơn `size` nhiều = model đang chạy CPU,
và không có bản vá mã nguồn nào chữa được điều đó.

## (ĐÃ SỬA 2026-08-27) Tóm tắt chậm gấp 4 và im lặng 82 giây — cùng bộ lỗi đã sửa cho mindmap

- **Triệu chứng:** tạo tóm tắt tài liệu 18 chunk mất **241,6 giây**; chip tiến trình đứng
  im ở 30% suốt **82,5 giây đầu** rồi mới nhích. Không có lỗi nào, `missing=[]`, bản tóm
  tắt vẫn đúng — nên không ai gọi đây là bug, chỉ thấy "nó chậm".
- **Root cause (3 cái, độc lập):**
  1. `BE/.env` để `SLM_MODEL_SUMMARY=qwen2.5:14b`. Model nặng 9,95 GB, card 6 GiB → Ollama
     chỉ nhét 4,07 GB vào VRAM, phần còn lại chạy CPU, tụt còn ~2,6 tok/s. Root `.env` đã
     là `qwen2.5:7b-instruct`, nhưng `shared/env_loader.load_project_env` nạp `BE/.env`
     TRƯỚC với `override=False` nên BE/.env thắng. **Đúng y hệt lỗi mindmap ngày 2026-08-26.**
  2. `summarize_sections` chỉ gọi `progress_cb` BÊN TRONG vòng `as_completed` — dòng
     progress đầu tiên chỉ đến khi một mục CHẠY XONG.
  3. `summary_factory.summarize` truyền `max_workers=int(os.getenv("SUMMARY_PARALLEL","2"))`
     mà không kẹp theo cổng LLM in-process (`MAX_CONCURRENT_LLM_CALLS=1`). Mục thứ hai
     không chạy song song mà xếp hàng; chờ quá `LLM_QUEUE_WAIT_TIMEOUT_SECONDS` (180s) thì
     ném "LLM busy (in-process)". **Trên tài liệu 18 chunk lỗi này KHÔNG nổ** (mục đầu chỉ
     mất 82s < 180s) — nó là bom hẹn giờ theo kích thước tài liệu.
     Tái hiện được cơ chế mà không cần tài liệu to: hạ `LLM_QUEUE_WAIT_TIMEOUT_SECONDS`
     xuống 5s rồi chạy cùng 3 mục đó —
     `max_workers=2` → 2/3 mục chết (`LLM busy (in-process): all 1 slots in use, waited
     5.0s`), job "xong" sau **14,7s** với bản tóm tắt thiếu 2 mục;
     `max_workers=1` (đã kẹp) → 35,5s, `missing=[]`. Job nhanh hơn ở đây là job HỎNG.
     Hệ quả phụ cùng gốc: `budget = timeout_sec * ceil(n/max_workers) + 15` tính theo số
     worker DANH NGHĨA. Với 3 mục, `max_workers=2` cho budget 615s trong khi thực tế chạy
     tuần tự cần tới 3×300 = 900s → mục cuối có thể degraded dù chưa hề vượt timeout riêng.
- **Fix:** (1) `SLM_MODEL_SUMMARY=qwen2.5:7b-instruct` trong `BE/.env` + `BE/.env.example`,
  kèm comment nói rõ vì sao không phải 14b. (2) `progress_cb` gọi TRƯỚC `ctx_submit`.
  (3) `LocalSummaryPipeline._parallel()` lấy trần từ `llm_factory.inproc_slots()` — cùng
  cách đã dùng cho `mindmap_factory._enrich_parallel`.
- **Đo lại (cùng tài liệu `day08-_rag_pipeline_docx`, 18 chunk, 3 mục):**

  |                   | trước  | sau   |
  |-------------------|--------|-------|
  | tổng              | 241,6s | 60,9s |
  | riêng summarize   | 211,1s | 51,8s |
  | riêng synthesize  | 30,5s  | 9,1s  |
  | progress đầu tiên | 82,5s  | 0,03s |
  | mục degraded      | 0      | 0     |
  | overview          | 335 ký tự | 581 ký tự |

  7b không hề tóm tắt tệ hơn 14b ở đây — chunk_refs mục 3 tăng 7→13, entities 8→10.
- **Regression:** `tests/test_summary_factory.py` (3 test kẹp song song),
  `tests/test_summary_summarize.py::test_bao_progress_TRUOC_khi_muc_dau_chay_xong` (đếm số
  lần progress ĐÃ kêu tại thời điểm lời gọi LLM đầu tiên, không đếm tổng lúc xong).
- **Prevention:** đừng để hai biến env phải khớp tay nhau — lấy trần từ chính cái cổng.
  Và khi sửa một pipeline, grep pipeline anh em ngay: `summarize.py` vốn ghi rõ trong
  docstring là "clone shape enrich.py", nên nó clone luôn cả ba lỗi.

## (2026-08-27) Bật `SUMMARY_FACTS` làm study mode TỆ HƠN trên qwen2.5:7b — đừng bật

Có hai vấn đề tách bạch ở đây.

**(a) Đã sửa — cờ không nằm trong khoá cache.** `content_hash` gồm `PIPELINE_VERSION`,
`length_mode`, `mode`, cờ `coverage`, nhưng KHÔNG gồm cờ `facts`. Phase 5 đã chặn đúng lỗi
này cho `coverage` mà không ai làm cho `facts`. Hậu quả: bật `SUMMARY_FACTS=1` lên thì bản
đã cache lúc cờ tắt vẫn khớp hash và được trả về — `mode=study` âm thầm rơi về fallback
key_points, không có dấu hiệu gì. Đã thêm tham số `facts` vào `content_hash`; cả
`main._summary_input_and_hash` LẪN `summary_graph.collect_node` đều mirror (bài học Phase 5:
thiếu một trong hai là cache lệch).

**(b) CHƯA sửa và không định sửa — cờ vẫn nên để TẮT.** Đo thật trên
`day08-_rag_pipeline_docx` với `qwen2.5:7b-instruct`:

|                        | FACTS=0 | FACTS=1 |
|------------------------|---------|---------|
| thời gian summarize    | 40,7s   | 59,0s   |
| mục trả được facts     | 0/3     | **1/3** |
| study.key_concepts     | 13      | 7       |
| study.self_check       | 10      | 7       |
| definitions/formulas/examples/common_mistakes | 0 | 0 |

7b không kham nổi JSON 7 khoá facts — 2/3 mục trả về không có facts, và study block dựng từ
đó NGHÈO HƠN đường fallback key_points. Chậm hơn 45% để nhận kết quả tệ hơn.

Ghi chú cho người đọc sau: 4 mục `definitions/formulas/examples/common_mistakes` trong
modal tóm tắt hiện đang LUÔN rỗng ở chế độ study. Đó là hệ quả của cờ tắt, không phải lỗi
render. Muốn lấp thì cần model mạnh hơn cho riêng bước này, không phải bật cờ lên.

## (ĐÃ SỬA 2026-08-21) `QUERY_GRAPH chưa khởi tạo` — site-packages global trôi khỏi MỌI pin

- **Triệu chứng:** `/health` trả `query_graph_ready: false` +
  `ModuleNotFoundError("No module named 'langchain_core.pydantic_v1')`. Ingest và toàn bộ
  StudyMap chạy bình thường, riêng `/query` (chat) chết. FE hiện "QUERY_GRAPH chưa khởi tạo".
- **Root cause:** Python global không còn khớp `requirements.txt` ở BẤT KỲ dòng nào —
  langchain 0.2.17 (pin >=0.3.27), langchain-core 1.4.8 (pin <0.4), langchain-community
  0.2.19, langchain-text-splitters 0.2.4, langgraph 1.0.1 (pin <0.3), pydantic 2.12.5
  (pin <2.11). langchain 0.2.x gọi `langchain_core.pydantic_v1`, thứ langchain-core 1.x
  đã bỏ. Đây chính là mục "Global python site-packages trôi khỏi requirements.txt pin"
  bên dưới, lần này đủ nặng để làm chết một pipeline.
- **Fix:** venv riêng `BE/.venv` + `pip install -r requirements.txt`. KHÔNG cài đè lên
  Python global: hạ langgraph 1.x xuống 0.2.x ở phạm vi máy sẽ đụng mọi project khác, và
  langgraph 1.x kéo ormsgpack vốn bị Windows Application Control chặn.
  Chạy BE: `BE/.venv/Scripts/python.exe -m app.main`.
- **Prevention:** `/health` đã phơi `query_graph_error` — nhưng không ai đọc /health trước
  khi kết luận "chat hỏng". Kiểm tra /health TRƯỚC khi đọc log. Và đừng chạy BE bằng Python
  global nữa; global sẽ trôi tiếp.

## (KHÔNG PHẢI LỖI 2026-08-21) `/query-stream/<job_id>` trả 401 khi bật AUTH_PROTECT_APP_APIS

`EventSource` của trình duyệt KHÔNG gửi được header `Authorization` — đây là giới hạn của
Web API, không phải bug. Nên khi bật bảo vệ app API, SSE luôn 401.

FE đã xử lý: `es.onerror` gắn cờ `sseConnectionLost`, `shouldPollFallback` cho qua, rồi
`pollQueryStatus` gọi `/query-status` qua `apiFetch` (có Bearer). Có comment "Phase F.1"
tại `ChatArea.jsx`. Thấy 401 này trong Network tab thì BỎ QUA — chữa nó (nhét token vào
query string) là tự tạo lỗ hổng rò token qua log server.

## (KHÔNG PHẢI LỖI 2026-08-21) Study map 44 node nhưng `knowledge_edges` chỉ có 2 hàng

Đọc `edges: 2` rồi kết luận "bước Relations rớt cạnh" là SAI. Cây cha-con nằm ở cột
`knowledge_nodes.parent_node_id`, KHÔNG nằm ở `knowledge_edges`. Đo thật trên map
686f8481: 43/44 node có `parent_node_id` (chỉ root không có), phân tầng 1 root → 6 section
→ 27 concept → 10 example. `knowledge_edges` chỉ giữ liên kết NGANG (ngoài cây) — 2 cạnh
đó đều là quan hệ thật.

Muốn biết graph có đầy đủ không thì đếm `parent_node_id`, đừng đếm `knowledge_edges`.

## (2026-08-21) `PATCH /api/attempts/<id>/answers` nuốt im lặng khoá lạ

Route nhận `answers` dạng list và đọc `a.get("user_answer")`. Gửi nhầm tên trường (ví dụ
`answer_text`) thì mọi đáp án lưu thành `None`, route vẫn trả **200**, bài chấm ra 0 điểm
và không có lỗi nào ở đâu cả. Mất hai vòng thử ~5 phút mới tìm ra khi viết script seed.

CHƯA SỬA. Hướng sửa: dict item không có khoá `user_answer` thì trả 400 kèm tên khoá lạ,
thay vì mặc định None.


## (ĐÃ SỬA 2026-08-21) Smoke end-to-end với LLM thật — 3 lỗi mà 696 unit test không bắt được

Chạy đúng kịch bản demo PRD mục 19 (upload tài liệu Toán → quiz 10 câu → làm sai phần
"quy tắc hàm hợp" → báo yếu → chỉ về mục 2.3 → luyện 5 câu) trên **Ollama thật + bge-m3
thật + Postgres thật**. Toàn bộ unit test đều dùng LLM giả nên cả ba lỗi dưới đây lọt lưới.

### 1. `/api/documents/*` trả status NGOÀI tập đặc tả

- **Triệu chứng:** ingest xong hoàn toàn (4 chunk, progress 1.0) nhưng
  `GET /api/documents/{id}` trả `status="ready"`. Client chờ `completed` theo đúng tài
  liệu thì chờ vĩnh viễn — smoke treo 600s rồi bỏ cuộc.
- **Root cause:** `repository._row()` trả trạng thái PIPELINE (`processing/index_ready/
  ready/error`) ở khoá `status` để call site cũ (`/list-indexed`, `/sources/<id>/status`)
  không phải sửa. API mới `/api/documents/*` dùng lại nguyên dict đó, nên nó phát ra
  `ready` — giá trị không có trong `uploaded|processing|completed|failed|deleted` (đặc tả
  3.2.4 / 8.3). Cột DB thì vẫn đúng.
- **Fix:** `_row()` thêm khoá `spec_status` (cột `documents.status`); `_doc_public()` trả
  `status = spec_status` và đưa trạng thái pipeline sang `ingest_status`. Route cũ không đổi.
- **Prevention:** API mới KHÔNG được tái dùng nguyên dict của tầng cũ chỉ vì tiện — hai
  API có hai hợp đồng khác nhau. Test `test_documents_api.py` giờ khẳng định `status` luôn
  nằm trong tập đặc tả, không chỉ khẳng định nó "không rỗng".

### 2. Lỗi provider LLM đầu tiên bị nuốt, báo nhầm hoàn toàn

- **Triệu chứng:** tạo quiz hỏng với thông báo `All AI providers failed (tried ['ollama',
  'gemini']): 401 ... ACCESS_TOKEN_TYPE_UNSUPPORTED`. Đọc xong đi kiểm tra key Gemini —
  sai hướng. Nguyên nhân thật là **Ollama timeout** (model 14B sinh 10 câu vượt 180s mặc
  định của `QUIZ_LLM_TIMEOUT_SEC`), rồi mới rơi sang Gemini vốn không có key hợp lệ.
- **Root cause:** vòng fallback trong `ask_ai` chỉ giữ `last_error`, nên lỗi của provider
  ĐẦU biến mất hoàn toàn khỏi thông báo lẫn log.
- **Fix:** log từng provider ngay khi nó hỏng (kèm `feature` + `model`) và gộp TẤT CẢ lỗi
  vào exception cuối.
- **Prevention:** chuỗi fallback nào cũng phải báo cáo mọi mắt xích. "Thông báo lỗi cuối"
  của một chuỗi fallback gần như luôn là mắt xích ÍT liên quan nhất tới nguyên nhân thật.

### 3. So sánh trước/sau luyện tập im lặng không đo được (FR-11.10)

- **Triệu chứng:** làm bài luyện đúng 100% mà màn hình tiến bộ hiện
  `hàm hợp: 0.0 -> None (delta None)` — tức "chưa đo". Tiêu chí MVP #10 và #12 hỏng.
- **Root cause:** `concept_tags` do LLM tự đặt. Bài chẩn đoán ra tag `"hàm hợp"`, bài
  luyện sinh sau đó ra `"quy tắc hàm hợp"`. `compare_masteries` lọc theo topic của review
  item nên hai bên không bao giờ khớp. Không có ngoại lệ nào được ném — chỉ là số liệu rỗng.
- **Fix:** khi sinh practice quiz, **rule ép** tag chủ đề của review item vào mọi câu hỏi
  (`config["practice_topic"]`). Chủ đề đã biết chắc từ review item, không có lý do để model
  quyết định lại — cùng nguyên tắc "rule quyết định liên kết, LLM chỉ viết lời" ở Phase 6.
- **Regression:** `test_practice_and_progress.py::test_practice_tags_are_forced_to_the_
  review_topic` — LLM giả cố tình trả tag `"ten khac hoan toan"`, test khẳng định tag chủ
  đề bị ép vào đầu VÀ comparison có số ở cả hai phía.
- **Prevention:** hai phía của một phép so sánh không được lấy khoá từ hai nguồn tự do
  khác nhau. Và **kiểm tra im lặng là kiểm tra vô dụng**: script smoke ban đầu vẫn in
  "SMOKE PASS" trong khi cột "sau" toàn rỗng — giờ nó fail nếu mọi `delta` đều None.

### Số liệu đo được (Ollama qwen2.5:7b-instruct, máy local)

| Bước | Thời gian | Kết quả |
| --- | --- | --- |
| Ingest (chunk + bge-m3 + FAISS + memory tree) | ~70s | 4 chunk, 6 section đúng cây |
| Tạo quiz 10 câu | ~55s | 10/10 giữ, 0 câu bị FR-13 loại, 1 lần gọi model |
| Chấm 10 câu trắc nghiệm | <1s | đúng 8, sai 2 |
| Review plan | ~11s | chỉ đúng "mục 2.3 Quy tắc hàm hợp" |
| Tạo 5 câu luyện | ~42s | 5/5 giữ, 0 loại |

Phát hiện chất lượng còn để mở: tài liệu 1300 ký tự chỉ chia được **4 chunk**, nên
`/api/search` với truy vấn "quy tắc đạo hàm hàm hợp" trả top-1 là đoạn Chương 1 (không
chứa "hàm hợp"). Chunk quá thô làm truy hồi kém — chưa sửa, cần đo thêm trên tài liệu dài.


## (ĐÃ SỬA 2026-07-17) Huỷ tóm tắt kẹt "Đang huỷ… (36%)" mãi — cancel job không còn executor + FE poller không biết "interrupted"

- **Triệu chứng:** Đang tạo tóm tắt, bấm Huỷ → chip kẹt "Đang huỷ… (36%)" vĩnh viễn, %
  đứng yên, không bao giờ thoát trạng thái huỷ. (Huỷ khi executor còn sống hoạt động đúng —
  đã chứng minh bằng repro graph thật.)
- **Root cause (2 tầng, đo bằng repro trực tiếp):**
  1. BE: `jobs_store.request_cancel` CHỈ set cờ `cancel_requested=1` và trông chờ executor
     đang sống ack giữa các node. Job KHÔNG còn executor — `pending` trong queue, hoặc
     `interrupted` (BE restart → `mark_interrupted_jobs` đánh dấu job mồ côi, GIỮ progress 36)
     — thì không ai ack cờ → status không bao giờ terminal.
  2. FE: `jobPoller.js` chỉ coi done/error/timeout/cancelled là terminal — "interrupted"
     KHÔNG có trong tập (queryPolling.js CÓ, jobPoller quên) → poll vô hạn, label bị khoá
     "Đang huỷ…" (cancelRequestedRef) + progress đóng băng đúng như user thấy.
- **Fix:** (1) `request_cancel` chuyển THẲNG `pending`/`interrupted` → `cancelled` trong cùng
  UPDATE (running/processing giữ cooperative; terminal giữ nguyên → idempotent). Sửa MỘT chỗ
  ở store → summary LẪN mindmap cancel hưởng chung. (2) `/summary-cancel` 404 job lạ (cùng
  contract `/summary-status`), trả `status` sau cancel. (3) `summary_graph.assemble_node`
  thêm 2 cancel checkpoint: trước coverage judge (LLM dài) + trước persist — cancel đến sau
  entry-guard vẫn KHÔNG persist/done (done-with-result vẫn atomic). (4) FE `jobPoller` coi
  "interrupted" là terminal (onError, message riêng qua `messages.interrupted`).
- **Regression:** BE `test_jobs_cancel.py` (running cooperative / pending+interrupted →
  cancelled ngay / terminal idempotent), `test_summary_graph.py::test_cancel_mid_summarize_
  reaches_terminal_cancelled` + `test_cancel_during_coverage_judge_does_not_persist_or_done`,
  `test_summary_routes.py` (cancel 404 job lạ/khác type, interrupted → "cancelled", done →
  safe no-op). FE `summaryJob.test.js` (cancelled → onCancelled dừng hẳn; interrupted →
  onError, không poll vô hạn).
- **Prevention:** Cancel theo cờ cooperative PHẢI có đường terminal cho job không còn
  executor — endpoint cancel không được chỉ "ghi cờ rồi hy vọng". FE poller: tập status
  terminal phải khớp ĐỦ tập status BE có thể ghi (interrupted sinh ra ở startup-reconcile,
  không chỉ trong flow chạy bình thường); thêm status mới phía BE → rà mọi poller.
- **Tái điều tra 2026-07-17 (user báo "vẫn kẹt" SAU commit fix):** code fix ĐÚNG — nguyên nhân
  còn lại là DEPLOYMENT STALE: stack thật user mở (compose project `memvid_auth_smoke`,
  FE :3000 / BE :8080, `QUEUE_ENABLED=true` + rq-worker) build từ image 2026-07-14, TRƯỚC
  commit `0bd4624` 3 ngày. Verify trực tiếp: `docker exec <backend|rq-worker> grep
  "pending','interrupted'" jobs_store.py` → FIX_ABSENT; FE bundle không có message
  "gián đoạn trên server". Sau `docker compose -p memvid_auth_smoke --profile worker up -d
  --build backend rq-worker frontend`: smoke Playwright trên UI thật PASS — cancel lúc
  running (45%, mục 3/8) → `/summary-cancel` 200 `{ok,status:"running"}` → 8s sau
  `/summary-status` trả `cancelled`, chip thoát "Đang huỷ…", notice "Đã huỷ tạo tóm tắt.",
  `summary_active_job` localStorage cleared, không summary nào bị lưu, tạo lại ngay OK.
  RQ path đã rà: queued-rồi-worker-nhặt được entry-guard chặn (không persist), cancel_cb
  check sau MỖI section LLM call → trễ tối đa 1 call. Bẫy phụ khi rebuild: root `.env`
  KHÔNG có `COMPOSE_PROJECT_NAME` → `docker compose` trần build/chạy project `memvid_new`
  KHÁC stack user đang mở và đụng port 8080 — phải `-p memvid_auth_smoke` (hoặc set
  COMPOSE_PROJECT_NAME vào .env như .env.example).
- **Prevention (ops):** "fix rồi mà user vẫn thấy bug" → bước 1 LUÔN so runtime user mở
  với code: `docker ps` xem project/created-time, `docker exec grep <chuỗi đặc trưng fix>`
  trong container + FE bundle. Đừng đọc lại code trước khi chứng minh code đó ĐANG chạy.

## (ĐÃ SỬA 2026-07-06) Cache hit trả "Không có phản hồi." — race job done-trước-result + 4 lỗ contract

- **Triệu chứng:** Câu hỏi bị cache HIT (nhanh <1s) → FE hiện "Không có phản hồi." dù Redis
  có answer đầy đủ; câu MISS (chậm 30s+) trả lời bình thường. User thấy: "noi dung la gi"
  OK nhưng "nội dung là gì"/"nọi dung là gì" rỗng. Reproduce 3/3 bằng smoke script.
- **Root cause (đo trực tiếp, không đoán):** `finalize_node` set `status="done"` vào jobs_store
  NGAY TRONG graph; `result` được `_finalize_query_job` (main.py) gắn SAU khi `graph.invoke`
  trả về — giữa 2 bước còn `_detect_query_interrupt` đọc checkpoint sqlite (chậm, state to).
  Job nhanh → FE poll trúng cửa sổ `status=done, result=None` → answer rỗng. Job chậm không
  bao giờ trúng → asymmetry đánh lừa chẩn đoán về phía diacritics/cache-logic.
- **Fix:** finalize_node KHÔNG set status nữa (chỉ progress); "done" đi CÙNG result trong một
  update duy nhất ở `_finalize_query_job`. + Bịt 4 lỗ contract (codex audit xác nhận):
  1. cache_lookup_node: hit phải có answer non-empty mới `done=True`; lookup exception →
     đi tiếp pipeline (trước đây → ErrorHandler, chặn đường trả lời).
  2. Mọi hit path trong llm_cache (`_answer_ok`): entry answer rỗng = không tồn tại.
  3. Mọi write path (semantic_store, _set_cached_query L1, finalize): answer rỗng/whitespace
     không được ghi (`cache_write_skipped_empty_answer`).
  4. `gen_fallback` flag: message chẩn đoán "Không nhận được phản hồi từ model..." KHÔNG
     được cache (trước đây cache như answer thật → poisoning mọi câu tương đương).
- **Regression:** `test_llm_cache.py` — empty_cached_answer_treated_as_miss_all_paths,
  store_skips_empty_answer, vn_variant_flow_same_document, graph_cache_hit_empty_answer_falls_through,
  graph_cache_lookup_exception_falls_back_to_llm, graph_finalize_skips_store_when_answer_empty
  (31 test). Smoke: `python BE/scripts/smoke_semantic_cache.py` — 6/6 PASS.
- **Prevention:** (1) Trạng thái terminal của job PHẢI được ghi atomically cùng payload kết quả
  — không bao giờ set "done" ở một tầng rồi gắn result ở tầng khác. (2) Bug "lúc có lúc không"
  tương quan với TỐC ĐỘ response = nghĩ ngay đến race polling, đừng chỉ soi logic nghiệp vụ.
  (3) Cache lookup exception không bao giờ được route sang error-terminal — cache là tối ưu.

## (2026-07-06) bge-m3: câu Việt CÓ dấu vs KHÔNG dấu embed rất khác nhau (cosine 0.558) — đừng gác diacritics bằng cosine

- **Triệu chứng:** Nâng cấp semantic cache, thiết kế đầu: alias không-dấu hit phải verify
  cosine ≥ threshold (chống đồng tự "bán"/"bàn"). Smoke Docker thật: "noi dung chinh cua
  tai lieu la gi" KHÔNG hit entry "Nội dung chính của tài liệu là gì?" — đo trực tiếp
  trong container: cosine 2 form = **0.558** (threshold 0.85).
- **Nguyên nhân:** bge-m3 mean-pool tokenize 2 form khác hẳn nhau → cặp CÙNG nghĩa
  có/không dấu sim thấp; ngược lại cặp homograph KHÁC nghĩa (lệch 1 ký tự) sim rất cao
  → cosine verify gác NGƯỢC chiều đe doạ: chặn true-positive, cho qua false-positive.
- **Cách xử lý (đã làm):** bỏ cosine verify ở alias path; gác bằng **LLM judge** (so intent
  2 câu dạng chữ — judge thấy dấu, phân biệt được nghĩa). Judge tắt → alias hit thẳng
  (toàn câu normalized trùng modulo dấu = tín hiệu mạnh, đánh đổi ghi rõ trong DR-2).
  Regression: `test_nodia_variant_hits_via_alias`, `test_nodia_reverse_direction_hits`,
  `test_nodia_alias_homograph_judge_denies`. Smoke live: hit `kind=exact_nodia` 5.1s vs cold 39.7s.
- **Prevention:** guard dựa trên embedding phải CALIBRATE bằng số đo thật trên đúng encoder
  + đúng loại text trước khi tin — trực giác "cùng nghĩa thì sim cao" sai với cross-form
  (có dấu/không dấu, viết tắt, ngôn ngữ trộn). Unit test vector giả không thay được số đo thật.
- **Quan sát phụ (chưa sửa, ghi nhận):** finalize re-store answer vào cache MỖI lần hit
  (3 dòng cache_write cho 3 hit trong smoke) — idempotent, chỉ tốn 1 SETEX + refresh TTL,
  hành vi có từ v1. Muốn tối ưu: skip set_cached khi payload lấy từ cache.

## (ĐÃ SỬA 2026-07-06) 'LateChunkEmbeddings' object is not callable — LC FAISS path chết mỗi query

- **Triệu chứng:** Mỗi query log 2 dòng: langchain warning "`embedding_function` is expected
  to be an Embeddings object, support for passing in a function will soon be removed" +
  `HybridRetriever.retrieve_faiss_only: LC path failed: 'LateChunkEmbeddings' object is not
  callable`. Retrieval VẪN ra kết quả (rơi về legacy FAISS im lặng) nên dễ bỏ qua.
- **Nguyên nhân:** `llm_factory.py::LateChunkEmbeddings` là plain class, KHÔNG kế thừa
  `langchain_core.embeddings.Embeddings`. LangChain FAISS check
  `isinstance(embedding_function, Embeddings)` — fail → coi nó là callable (đường deprecated),
  gọi `obj(text)` → TypeError not callable → LC path fail mọi `similarity_search_with_score`.
  Cả 2 dòng log cùng MỘT gốc. Duck-typing (có đủ embed_query/embed_documents) KHÔNG đủ —
  langchain phân nhánh bằng isinstance.
- **Cách xử lý (đã làm):** 1 dòng — `class LateChunkEmbeddings(_LCEmbeddings)` (import
  `Embeddings` module-level). 2 method abstract đã có sẵn.
- **Regression:** `test_embedding_late_chunk.py::test_late_chunk_embeddings_is_langchain_embeddings`
  (assert isinstance). Đã chạy kèm `test_store_precomputed.py` + `test_llm_cache.py` — xanh.
- **Prevention:** Viết adapter cho interface langchain → PHẢI subclass base class thật
  (`Embeddings`, `BaseRetriever`…), đừng duck-type; langchain rẽ nhánh isinstance ở nhiều chỗ.
  Test wiring assert `isinstance(..., Embeddings)` chứ không chỉ `hasattr`.
- **Lưu ý liên quan (ĐÃ XỬ LÝ cùng ngày):** hiện tượng "hỏi lại y hệt vẫn soạn mới" trong CÙNG
  phiên chat không phải bug này — trước đây `cache_lookup_node` bypass MỌI câu khi có
  `conversation_history`. Đã đổi: chỉ bypass câu FOLLOW-UP; câu STANDALONE
  (`llm_cache.is_standalone_question` — heuristic conservative: câu <4 từ, anaphora
  nó/này/đó/that/it..., mở đầu còn/thế/vậy/what about... → follow-up) vẫn cache.
  Điều kiện an toàn: `generate_answer_node` BỎ history khỏi prompt khi `cache_key` được set
  → answer context-free → store không poisoning (lookup/store nhất quán). Metric mới
  `standalone_with_history`. Regression: `test_llm_cache.py::test_is_standalone_question_heuristic`
  + `test_standalone_question_with_history_uses_cache`. Heuristic nghiêng về bypass —
  sai hướng đó chỉ mất cache, sai hướng ngược lại mới sinh answer thiếu ngữ cảnh.

## (ĐÃ SỬA 2026-07-05) Mindmap viewer + PNG export vỡ hoàn toàn — thiếu import MindElixir.css

- **Triệu chứng:** Mở sơ đồ tư duy: toàn bộ text node dồn thành MỘT dòng góc trên-trái
  ("Tổng quan tài liệuPhát hiện xâm phạm…"), root lơ lửng, 2 đường bezier bay lạc, canvas
  trống khổng lồ. PNG export y hệt (snapdom chụp trung thực DOM đang vỡ).
- **Nguyên nhân (3 lớp):**
  1. `mind-elixir/style` (dist/MindElixir.css) KHÔNG được import ở đâu cả — mind-elixir v5
     layout HOÀN TOÀN bằng CSS (`me-nodes` flex, `me-tpc` block...). Thiếu nó, custom elements
     rơi về `display:inline` → sụp toàn bộ. Bundle build cũng không có (verified grep dist).
  2. THEME custom chỉ set 4/22 cssVar; MindElixir.css dùng `var(--map-padding)`,
     `--main-gap-x/y`, `--node-gap-x/y`, `--root-radius`… KHÔNG có fallback → declaration
     invalid, spacing sụp dù đã import CSS.
  3. Export chụp `mind.nodes` (element `me-nodes`) TÁCH khỏi `.map-canvas` — rule then chốt
     là descendant selector `.map-canvas me-nodes{display:flex}` không match trong clone
     snapdom → PNG vỡ kể cả khi viewer đúng. Không có `scale` → ảnh mờ.
- **Cách xử lý (đã làm):** import `"mind-elixir/style"` trong `MindElixirView.jsx`; THEME
  PhongDoc set đủ 22 var (guard bằng `theme.test.js` — thiếu var nào test đỏ); export chụp
  `mind.map` (`.map-canvas`) + `scale: 2`.
- **Prevention:** dùng thư viện render bằng CSS-file riêng → kiểm tra CSS có vào bundle
  (`grep <rule đặc trưng> dist/assets/*.css`). Chụp DOM bằng snapdom/html2canvas → target
  phải CHỨA đủ tổ tiên mà CSS selector cần. Theme override một thư viện → set đủ TOÀN BỘ
  bộ var nó tiêu thụ, đừng set một phần.

## (ĐÃ SỬA 2026-07-05) Mindmap docx nông: heading_path rỗng → skeleton filler "Tổng quan tài liệu"

- **Triệu chứng:** Tạo sơ đồ cho docx → cây chỉ có root → 1 section "Tổng quan tài liệu"
  → vài idea; không sâu hơn, relations luôn rỗng (skip khi <2 section).
- **Nguyên nhân (chuỗi 4 khâu):**
  1. mammoth chỉ sinh `#`/`##`/`###` cho Word Heading styles thật — docx sinh viên dùng
     bold/đánh số tay → markdown 0 heading → mọi chunk `heading_path=""`.
  2. Chỉ `_from_headings` tạo được chiều sâu; tree_sections/clusters đều FLAT. Fallback
     tree_sections với ≤18 chunk trả đúng 1 section size-based tên "Tổng quan tài liệu".
  3. Kể cả khi có heading: `embed_index_node` cũ yêu cầu `len(headings)==len(entries)` —
     QR sub-split 1 chunk là lệch → rớt TOÀN BỘ heading_path của doc.
  4. `content_hash` không hash heading metadata → re-ingest phục hồi heading (text không đổi)
     vẫn trúng cache cũ, trả mãi map nông.
- **Cách xử lý (đã làm, PIPELINE_VERSION → skeleton_v2):**
  - `clean.py::promote_headings`: promote heuristic (dòng bold đứng một mình ≤90 ký tự không
    kết thúc ".", `Chương/Phần/Bài/Mục`, `1.`→##, `1.1`→###, La Mã→#) — CHỈ khi doc chưa có
    heading nào; item list sát nhau không bị promote (yêu cầu blank 2 phía).
  - `ingest_graph.py`: map heading qua `entry["chunk_index"]` (đã có sẵn cho late chunking)
    thay vì alignment 1:1 — sub-split không rớt heading nữa.
  - `skeleton.py::_from_tree_sections` yêu cầu ≥2 section (1 section = filler, bỏ).
  - MỚI `outline.py::build_outline`: skeleton "single" → 1 LLM call sinh mục lục 2 tầng
    (chunk_keys validate theo id thật); thành công → method "llm_outline", lỗi → root-only
    + degraded_missing "skeleton".
  - `content_hash(..., chunk_headings)` hash cả heading (prefix `\x02`); `generator.skeleton_method`
    được persist để chẩn đoán record đã lưu.
  - SKIP_MODEL_LOAD giờ khai `degraded=True` ở enrich/relations (trước im lặng trả skeleton
    như bản hoàn chỉnh).
- **Regression:** `test_promote_headings.py`, `test_mindmap_outline.py`, `test_mindmap_skeleton.py::
  test_single_tree_section_is_rejected_as_filler`, `test_late_chunk_ingest.py::test_heading_path_
  survives_subsplit`, `test_mindmap_schema_v2.py` (hash headings + skeleton_method).
- **Lưu ý:** dữ liệu đã index TRƯỚC fix vẫn heading_path rỗng — muốn map sâu phải re-upload
  (re-ingest) tài liệu; hash mới sẽ tự bypass cache cũ.
- **Regression cùng ngày (đã vá, skeleton_v3):** bản đầu của `promote_headings` chỉ match
  `**bold**` — mammoth THẬT sinh `__bold__` VÀ escape punctuation (`1\.` chứ không phải `1.`)
  → doc Q&A re-upload vẫn trượt promote. Vá: `_BOLD_LINE_RE` nhận cả `__`/`**` (backreference
  `(\*\*|__)...\1`), thêm `unescape_mammoth` (bỏ `\` trước bộ punctuation AN TOÀN `. ( ) ! ? , : ; … " '`
  — KHÔNG đụng `# * - [ ]` tránh tạo markdown giả) chạy TRƯỚC promote trong `clean_markdown`.
  Bài học: viết heuristic parse markdown phải kiểm bằng OUTPUT THẬT của converter (đọc chunk
  từ sqlite), đừng viết theo markdown "chuẩn" trong đầu. Test: `test_promote_headings.py`
  (case mammoth dialect), FE mirror `evidence.js::unescapeMd` cho data cũ.
- **Regression vòng 2 cùng ngày (đo qua smoke Docker thật, đã vá):**
  1. Cap heading 90 ký tự chặn câu hỏi Q&A tiếng Việt bold (đo thật: 203 ký tự) → tách cap:
     bold đứng một mình (tín hiệu mạnh) = 250, dòng đánh số trần = 90.
  2. `MINDMAP_LLM_TIMEOUT_SEC` mặc định 120s không đủ cho enrich prompt nested-detail trên
     qwen3.5:9b CPU (3/4 nhánh degraded) → compose set 240s (cả backend + mindmap-service;
     lưu ý pipeline chạy trong mindmap-service khi `MINDMAP_SERVICE_ADDR` bật — set env đúng container).
  3. qwen thi thoảng trả JSON hỏng delimiter (~1/4 nhánh) → `enrich._ask_json` retry đúng 1 lần
     trước khi degraded. Regression: `test_enrich_retries_once_on_malformed_json`.

## Late chunking + EMBEDDING_MODEL_NAME chưa set → tách không gian embedding (MiniLM vs bge-m3)

- **Triệu chứng:** Bật late chunking nhưng query/memory/một số path lại embed bằng
  all-MiniLM (384) trong khi chunk index là bge-m3 (1024) → cosine vô nghĩa, retrieve trật.
  Trong Docker: log `model=sentence-transformers/all-MiniLM-L6-v2 dim=384`.
- **Nguyên nhân:** `get_embedding_model(model_name)` tôn trọng tên caller truyền; nhiều nơi
  truyền `store.MODEL_NAME` (đóng băng lúc import = default all-MiniLM khi env chưa set).
  Late chunking là scheme TOÀN CỤC nhưng lại nhận model ngắn-context → vỡ.
- **Cách xử lý (đã làm):** dưới late chunking, `get_embedding_model` BỎ QUA `model_name`
  caller, luôn resolve `get_late_chunk_encoder(os.getenv("EMBEDDING_MODEL_NAME") or None)`
  (env hoặc bge-m3) — đồng nhất với `get_embeddings`. ⇒ memory tree / mindmap /
  `_optional_prefix_embedding_list` / query đều dùng MỘT encoder. Regression:
  `test_embedding_late_chunk::test_get_embedding_model_ignores_caller_minilm_default`.
- **Prevention:** Docker vẫn nên set `EMBEDDING_MODEL_NAME=BAAI/bge-m3` (đã thêm vào compose)
  cho rõ ràng. Đổi model → rebuild index. (Phát hiện qua **codex audit** + Docker log thật.)

## Video QR ghi 0 frame trong container headless (opencv-python-headless)

- **Triệu chứng:** `Completed: 0/N frames written successfully` / `Failed to write frame`;
  file .mp4 tạo ra rỗng/hỏng. Local Windows cũng từng in 0/N dù video vẫn tạo.
- **Nguyên nhân:** `writer.isOpened()` chỉ chứng minh writer mở được, KHÔNG chứng minh
  codec↔container encode được; `cv2.VideoWriter.write()` trả None (không tin được làm
  tín hiệu thành công). Code cũ thử XVID/DIVX/MJPG nhưng ghi vào `.mp4` (sai cặp).
- **Cách xử lý (đã làm):** `video_utils.save_qr_frames_to_video` ghép codec↔đuôi (mp4v/avc1→.mp4,
  MJPG/XVID→.avi), ghi xong rồi `_video_is_valid()` (tồn tại + size + `VideoCapture.read()`
  đọc được ≥1 frame) mới chấp nhận; không thì thử codec/đuôi khác. Và video là LƯU TRỮ PHỤ →
  `chunk_processor` nuốt lỗi save (video_path="") để KHÔNG chặn indexing (text đã ở FAISS).
  Regression: `test_video_codec.py`, `test_chunk_processor_index::test_video_failure_is_non_fatal`.

## UnboundLocalError 'get_embeddings' ở append_chunks_to_lc_index (LangChain FAISS path)

- **Triệu chứng:** Khi `USE_LC_VECTOR_STORE=1`, append chunk in `[vector_store] LangChain
  vector store failed, fallback legacy FAISS: cannot access local variable 'get_embeddings'`
  → âm thầm rơi về raw FAISS (vẫn chạy nhưng sai backend dự kiến). Phát hiện qua WORKFLOW
  SMOKE THẬT, không phải unit (unit raw-path không chạm nhánh LC).
- **Nguyên nhân:** Trong `append_chunks_to_lc_index` có `from app.clients.llm_factory import
  get_embeddings` Ở GIỮA hàm (khối __meta__) → Python coi `get_embeddings` là biến CỤC BỘ cho
  CẢ hàm → `emb = get_embeddings()` ở đầu hàm ném UnboundLocalError.
- **Cách xử lý (đã làm):** bỏ import lồng trong hàm; dùng lại `emb` (đã gán từ get_embeddings
  module-level ở đầu hàm) để lấy `emb_dim`. Regression: `test_store_precomputed.py::
  test_lc_path_precomputed_no_get_embeddings_shadow` (ép USE_LC_VECTOR_STORE=1 + embeddings).
- **Prevention:** KHÔNG `from x import y` giữa hàm nếu `y` đã dùng như tên module-level trong
  cùng hàm — sẽ shadow toàn hàm. Có test chạm nhánh LC FAISS (không chỉ raw).

## AutoModel.from_pretrained nạp .bin bị chặn với torch 2.5.x (late chunking) → dùng safetensors

- **Triệu chứng:** `LateChunkEncoder` nạp bge-m3 qua `AutoModel.from_pretrained` ném
  `ValueError: Due to a serious vulnerability issue in torch.load ... require torch >= v2.6`
  (CVE-2025-32434). Late chunking không tạo được vector → ingest rơi về fallback naive.
- **Nguyên nhân:** transformers chặn `torch.load` file `pytorch_model.bin` khi torch < 2.6.
  Repo PIN `torch==2.5.1+cpu` (xem lý do CUDA/Docker) → không nâng. Cache bge-m3 có CẢ
  `model.safetensors` lẫn `pytorch_model.bin`; mặc định transformers thử .bin → bị chặn.
- **Cách xử lý (đã làm):** `AutoModel.from_pretrained(name, use_safetensors=True)` trong
  `late_chunk.py::_ensure_backend` → buộc nạp .safetensors (không dính torch.load guard).
- **Verify:** smoke thật `scratchpad/smoke_late_chunk.py` (hoặc bất kỳ ingest có model) phải
  nạp bge-m3 OK, trả vector (n,1024). Model mới thêm vào hệ PHẢI có .safetensors trên HF.

## ormsgpack DLL bị Windows Application Control chặn (langgraph 1.x không import được)

- **Triệu chứng:** `import langgraph.graph` → `ImportError: DLL load failed while importing ormsgpack: An Application Control policy has blocked this file.` Toàn bộ tầng graph (query/ingest/mindmap) không import được → app không chạy.
- **Nguyên nhân:** langgraph 1.x phụ thuộc cứng `langgraph-checkpoint>=3` → `ormsgpack`. Binary `ormsgpack.cp311-win_amd64.pyd` bị Windows Application Control (Smart App Control/WDAC) chặn trên máy dev này. (pydantic-core Rust load OK → policy chỉ chặn riêng binary ormsgpack.)
- **Cách xử lý (đã chốt):** Pin về stack 0.3.x/0.2.x dùng `msgpack` thuần:
  - `langgraph>=0.2.57,<0.3` (0.2.57+ có `interrupt()` động cho HITL; dùng 0.2.76)
  - `langgraph-checkpoint==2.0.21` — **bản msgpack cuối cùng**. Lưu ý: checkpoint ≤2.0.21 dùng `msgpack`; **≥2.0.22 chuyển sang `ormsgpack`** (đã verify qua PyPI `requires_dist`).
  - `langgraph-checkpoint-sqlite==2.0.10` cần `checkpoint>=2.0.21` → giao điểm duy nhất msgpack-thuần là **đúng 2.0.21**.
  - *(Quan sát:* trên máy này ormsgpack 1.12.1 có lúc lại load được — policy có thể chuyển audit→allow. Nhưng vẫn pin msgpack-thuần để miễn nhiễm nếu bị tái chặn.)
  - `langchain*` về 0.3.x (core>=0.3.66 để thỏa community 0.3.27).
- **Verify sau mọi thay đổi dependency:** `python -c "import app.graphs.query_graph"` phải thành công. `import ormsgpack` vẫn fail là bình thường (msgpack không chạm tới nó).

## Rerank/NLI lazy-load NẰM TRONG timeout → query đầu âm thầm fallback (no-op)

- **Triệu chứng:** Bật `RERANK_ENABLED=1`/`NLI_ENABLED=1`, query ĐẦU TIÊN sau khi
  khởi động process: rerank không đổi thứ tự (như chưa bật), NLI trả
  `context_conflicts=[]` dù có cặp chunk mâu thuẫn rõ ràng. Query #2+ lại đúng.
  Test suite KHÔNG bắt được (graph-test monkeypatch `rerank_texts`/`detect_conflicts`
  → không có model load thật — đúng bài học "conftest mock che lỗi").
- **Nguyên nhân:** `RerankDocuments`/`VerifyContext` bọc lời gọi engine trong
  `ThreadPoolExecutor(...).result(timeout=RERANK_TIMEOUT/NLI_TIMEOUT)` (mặc định 10s).
  Engine load model **lazy** (`_ensure_model`) nên LẦN ĐẦU việc tải model chạy NGAY
  TRONG block timeout. Trên CPU/cache nguội, **chỉ riêng load weights mDeBERTa đã ~12.7s > 10s**
  → `TimeoutError` → nuốt im lặng thành identity/[] ở query đầu. Singleton cache model
  nên query sau (cùng process) mới đúng.
- **Cách xử lý (đã làm):** thêm `warmup()` ở `rerank.py`/`nli.py` — nạp weights **và**
  chạy 1 forward mồi (warm JIT/trace), gọi trong node **TRƯỚC** block timeout. Có timeout
  riêng rộng (120s) để model lỗi không treo vô hạn; `SKIP_MODEL_LOAD`/identity/null/lỗi → no-op.
  Timeout của node giờ chỉ bao inference thực. Regression: `test_*_warmup_loads_model_outside_timeout`
  (mô phỏng load chậm deterministic). `base_env` test set `SKIP_MODEL_LOAD=1` để warmup
  không kéo model thật trong unit test.
- **Verify:** smoke build graph THẬT với cờ bật + timeout MẶC ĐỊNH → rerank đảo thứ tự đúng
  ở query đầu (chunk vô quan bị loại).

## NLI (mDeBERTa) trên CPU ~7s/cặp → `NLI_TIMEOUT_SEC=10` mặc định KHÔNG đủ

- **Triệu chứng:** Sau khi đã fix warmup ở trên, rerank chạy tốt trong 10s nhưng NLI vẫn
  `context_conflicts=[]` ở timeout mặc định. Đo trực tiếp trên CPU máy dev (đã warm):
  `predict 6 cặp ≈ 42.8s` (~7s/cặp). `NLI_MAX_PAIRS=10` (mặc định) → tới 20 forward ≈ ~140s.
- **Nguyên nhân:** Đây là **giới hạn hiệu năng phần cứng**, không phải bug. mDeBERTa-v3-base
  inference rất chậm trên CPU; `detect_conflicts` chấm cả 2 chiều mỗi cặp nên số forward = 2×pairs.
- **Cách xử lý (đã chốt):** đổi default cho CPU chạy được: `NLI_MAX_PAIRS=3` + `NLI_TIMEOUT_SEC=90`.
  Đo THỰC trên CPU máy dev: 3 cặp chunk DÀI (6 forward) ≈ **66s** (câu ngắn ~42s nên ban đầu ước
  lượng thấp) → để 90s có đệm. Có GPU/model nhanh hơn thì hạ cả hai xuống qua env. Passthrough an
  toàn khi quá hạn vẫn giữ nguyên (không vỡ).
- **Lưu ý:** rerank (`bge-reranker-v2-m3`) trên cùng CPU lại kịp trong 10s với pool ~4–10 ứng viên
  → mặc định rerank giữ nguyên; chỉ NLI cần cân nhắc.

## Query-theo-file trả rỗng với tên file có space/dấu/ký tự đặc biệt (stem phân mảnh)

- **Triệu chứng:** chọn file để hỏi → "Không tìm thấy dữ liệu phù hợp", dù file đã index. Đặc biệt
  với tên có KHOẢNG TRẮNG (rất phổ biến), dấu tiếng Việt, hoặc ký tự đặc biệt.
- **Nguyên nhân:** định danh "stem" được suy ra ở ~6 nơi với quy tắc KHÁC NHAU. Mấu chốt: upload
  lưu `source_stem` GIỮ khoảng trắng (`Path(filename.replace('.','_')).stem.lower()` → "my report_pdf"),
  còn chunk `index.json["video"]` = video_path đã SANITIZE (space→'_' → "my_report_pdf") + timestamp.
  Retrieval `hybrid._filter_by_sources` so khớp 2 phía qua `_norm_stem` (NFKD, GIỮ space) → "my report_pdf"
  (selected) ≠ "my_report_pdf" (chunk) → `allowed_idx=[]` → retrieve [] . (NFKD KHÔNG bỏ dấu kết hợp.)
- **Cách xử lý (đã chốt):** MỘT canonicalizer dùng chung `shared/source_id.py::canonical_source_stem`,
  MIRROR đúng cách ingest đặt tên video_path (bỏ '.mp4' container có timestamp → fold '.'→'_' qua
  sanitize → bỏ timestamp → NFC + lower). Áp vào: `hybrid._norm_stem`, `memory/tree._normalize_video_stem`,
  `upload_file`/`ingest_graph` (source_stem), `/list-indexed` (trả `video_stem` canonical + `filename`).
  Ghi thêm `source_stem`/`source_id` canonical vào chunk metadata (ingest_graph) để retrieval khớp CHÍNH
  XÁC (ưu tiên field này, fallback suy từ `video` cho data cũ → không cần re-ingest).
- **Verify:** `python -m pytest tests/test_source_id.py tests/test_retrieval_filter.py tests/test_source_stem_sync.py
  tests/test_upload_query_e2e.py` — test space/dấu/ký-tự-đặc-biệt khớp đúng.
- **Hardening kèm theo:** lưu file vật lý an toàn (`_safe_save_path`: chặn ký tự cấm Windows + path
  traversal); chống trùng tên (`_unique_display_filename` gắn " (n)"); `/delete-source` khớp canonical +
  BỎ glob `{stem}*` nguy hiểm (xóa nhầm), dọn registry + file input; `/upload-multiple` đi cùng luồng
  async với `/upload-file` (source_id + registry + background ingest → FE poll được).

## pydantic 2.11+ làm vỡ StateGraph(QueryState) (langgraph 0.2.x)

- **Triệu chứng:** `build_query_graph` ném `pydantic.errors.PydanticForbiddenQualifier: ... 'NotRequired[Union[str, NoneType]]' contains the 'typing.NotRequired' type qualifier`. (Test cũ KHÔNG bắt được vì `conftest.py` mock `QUERY_GRAPH` → không bao giờ gọi `StateGraph(QueryState)` thật.)
- **Nguyên nhân:** pydantic ≥2.11 kéo `typing_inspection`, raise `ForbiddenQualifier('not_required')` khi `langchain_core.utils.pydantic.create_model_v2` build model từ `QueryState` TypedDict (có nhiều field `NotRequired[Optional[...]]`). langgraph 0.2.x truyền nguyên annotation kèm `NotRequired`.
- **Cách xử lý:** pin `pydantic>=2.7.4,<2.11` (dùng 2.10.6, không có typing_inspection).
- **Verify:** build graph thật (không mock) với cả 3 cờ CRAG/Supervisor/HITL bật phải compile được.

## Global python site-packages trôi khỏi requirements.txt pin (langchain/langgraph/pydantic)

- **Triệu chứng:** `pytest tests/` báo lỗi collection ở các file dùng `ensemble_retriever`
  (`test_crag_graph.py`, `test_hitl_graph.py`, `test_nli_graph.py`, `test_rerank_graph.py`,
  `test_supervisor_graph.py`, và trực tiếp `python -c "import app.graphs.query_graph"`):
  `ModuleNotFoundError: No module named 'langchain_core.pydantic_v1'`.
- **Nguyên nhân:** Global Python (dùng chung cho nhiều project trên máy dev — thấy cả
  `day08-langgraph-agent-lab` trong `pip list`) đã bị một lần `pip install` KHÔNG pin cài đè
  lên site-packages: `langchain==0.2.17` + `langchain-core==1.4.8` (lệch pha nặng — 0.2.x code
  gọi API chỉ có ở core cũ `pydantic_v1` shim, core 1.4.8 đã bỏ) + `langgraph==1.0.1` +
  `pydantic==2.13.4`, đều NGOÀI pin của `requirements.txt`
  (`langchain>=0.3.27,<0.4`, `langgraph>=0.2.57,<0.3`, ngụ ý pydantic<2.11 qua known-issue khác).
  Đã verify bằng `git stash` — lỗi tồn tại TRƯỚC bất kỳ thay đổi nào trong task hiện tại → môi
  trường trôi độc lập với code.
- **Quan sát phụ:** dù `langgraph` đã lên 1.0.1 (khác pin 0.2.x) và `pydantic` lên 2.13.4 (khác
  pin <2.11), `StateGraph(MindmapState)` với nhiều field `NotRequired[...]` VẪN build và chạy
  được (xem `tests/test_mindmap_graph.py`) — có thể lỗi `PydanticForbiddenQualifier` cũ (xem
  known-issue "pydantic 2.11+ làm vỡ StateGraph") đã được vá ở nhánh mới hơn của
  langchain_core/langgraph. KHÔNG coi đây là "đã an toàn để nâng pin" — chỉ là quan sát, chưa
  test đủ rộng (rerank/NLI/ensemble vẫn vỡ vì lý do khác — thiếu `pydantic_v1` shim ở core mới).
- **Cách xử lý:** CHƯA sửa (ngoài phạm vi task mindmap) — sửa bằng cách nào cũng đụng vào global
  site-packages dùng chung, rủi ro phá project khác trên máy. Test suite chạy OK khi loại 5 file
  trên: `pytest tests/ --ignore=tests/test_crag_graph.py --ignore=tests/test_hitl_graph.py
  --ignore=tests/test_nli_graph.py --ignore=tests/test_rerank_graph.py
  --ignore=tests/test_supervisor_graph.py`.
- **Prevention:** Trước khi bắt đầu 1 session dài, `pip show langchain langchain-core langgraph
  pydantic` đối chiếu `requirements.txt`; nếu lệch, cân nhắc venv riêng cho repo này thay vì
  global python (đánh đổi với lesson "dùng global python" cũ — lesson đó giả định global site-
  packages KHỚP pin; giờ không còn đúng). Nếu phải sửa global site-packages: `pip install -r
  BE/requirements.txt` rồi chạy lại toàn bộ suite của MỌI project dùng chung global python đó,
  không chỉ repo này.

## chunks.sqlite bị mất hoặc hỏng dữ liệu

- **Triệu chứng:** Không thể thực hiện tìm kiếm lexical (BM25 trả kết quả kém) hoặc tìm kiếm/tóm tắt thất bại khi đọc text của chunk, mặc dù các vector search qua FAISS vẫn trả về các ID tương ứng.
- **Nguyên nhân:** File cơ sở dữ liệu runtime `chunks.sqlite` (lưu trữ text của các chunk) bị xóa nhầm, lỗi quyền ghi, hoặc bị hỏng. `index.json` nay chỉ chứa pointer `(video, frame_index)` và metadata, không còn lưu trữ text inline mặc định nữa.
- **Cách xử lý:** Chạy công cụ dòng lệnh khôi phục để tự động quét `index.json`, giải mã lại các frame video QR tương ứng để tái cấu trúc lại database SQLite:
  ```bash
  cd BE
  python -m app.scripts.rebuild_sqlite_from_videos
  ```

## (ĐÃ SỬA 2026-07-04) Xoá nguồn khi index lớn → re-embed toàn bộ bằng bge-m3, block toàn bộ API vài phút

> **Resolved 2026-07-04:** Delete flow giờ ưu tiên remove-by-id trên index hiện có:
> `remove_chunks_from_lc_index` map `chunk_id -> docstore_id` rồi gọi `FAISS.delete(ids=...)`,
> `remove_chunks_from_raw_index` gọi `IndexIDMap.remove_ids(...)`. `rebuild_chunk_index(...)`
> chỉ còn là fallback khi delete-by-id lỗi, để ưu tiên toàn vẹn index/meta hơn hiệu năng.
> Giữ mục này làm lịch sử; phần dưới mô tả trạng thái TRƯỚC khi sửa.

- **Triệu chứng:** Bấm xoá nguồn khi index còn nhiều chunk → mọi endpoint (kể cả `/health`, `/list-indexed`) timeout vài phút; log in `[vector_store] rebuilt LC FAISS vectors=N (model=BAAI/bge-m3)` sau mỗi lần xoá. Quan sát thật ngày 2026-07-04 trên Docker: xoá lần lượt các nguồn khi index còn `245 → 240 → 237` vectors, mỗi lần đều block; xoá khi chỉ còn `2` chunks thì mất `0.35s`.
- **Nguyên nhân:** Flow xoá (`BE/app/domains/vectorstore/store.py::delete_chunks_by_source` / `delete_source_from_index`) gọi `rebuild_chunk_index(meta)`; nhánh LangChain gọi tiếp `rebuild_lc_index_from_meta` (`store.py:385`) = `FAISS.from_documents` trên TOÀN BỘ docs còn lại → re-embed tất cả bằng `BAAI/bge-m3` trên CPU. Cộng thêm gunicorn mặc định chỉ có `1` sync worker (`BE/Dockerfile:65`, `WEB_CONCURRENCY` mặc định `1`) nên 1 request nặng chặn cả app. Đây là nợ thiết kế cũ: trước còn rẻ với MiniLM 384, nay đắt vì late-chunking `bge-m3`.
- **Cách xử lý tạm:** Đặt `WEB_CONCURRENCY=2+` trong compose để app còn thở khi rebuild; xoá nguồn lúc rảnh.
- **Prevention:** Fix thật là bỏ re-embed khi xoá, chuyển sang delete-by-id trên index hiện có và chỉ rebuild ở nhánh fallback an toàn; xem plan `docs/superpowers/plans/2026-07-04-delete-source-no-reembed.md`.

## (ĐÃ SỬA 2026-07-04) `/generate-mindmap` cache-hit không có `job_id` → FE ném lỗi "Server không trả job_id"

> **Resolved 2026-07-04 (Task 16, commit aec6017):** FE `SidebarRight.jsx::runMindmapGeneration`
> giờ nhánh theo `startData.status === "done" && startData.result` TRƯỚC khi kiểm `job_id`
> (SidebarRight.jsx ~dòng 222-226) — cache-hit dùng thẳng `result`, bỏ polling. Phía BE trả
> `{"status":"done","result",...}` không có job_id là THIẾT KẾ của cache thật, không phải bug.
> Giữ mục này làm lịch sử; phần dưới mô tả trạng thái TRƯỚC khi sửa.

- **Triệu chứng:** Bấm "Tạo sơ đồ" (KHÔNG force) cho nguồn đã có mindmap cache theo `content_hash`
  → thay vì hiện lại map cũ ngay, FE alert lỗi "Không tạo được sơ đồ: Server không trả job_id."
- **Nguyên nhân:** `POST /generate-mindmap` khi cache hit (`force=False` + `mindmap_store.get_by_hash`
  trúng) trả THẲNG `{"status":"done","result":cached,"cached":true}` (200, KHÔNG có `job_id`) —
  xem `BE/app/main.py` quanh dòng 1742-1745. FE (`SidebarRight.jsx::runMindmapGeneration`, trước đây
  `handleGenerateMindMap`) luôn giả định response có `job_id` rồi mới poll: `if (!startData.job_id)
  throw new Error("Server không trả job_id.")` — không có nhánh xử lý response cache-hit.
- **Phát hiện:** đọc code khi làm Task 14 (tách MindMapModal.jsx), KHÔNG phải qua test/smoke thật —
  chưa xác nhận tần suất trúng cache trên dữ liệu thật (phụ thuộc `content_hash` có trùng không).
- **Cách xử lý:** CHƯA sửa — ngoài phạm vi Task 14 (tách file + render v2 relations). Hướng sửa gợi ý:
  FE nhánh theo `startData.status === "done"` (dùng `startData.result` thẳng, bỏ qua polling) TRƯỚC khi
  kiểm `job_id`, y hệt cách `onDone` xử lý kết quả job thường.

## (ĐÃ SỬA 2026-07-04) FE mindmap poll có hard-timeout 180s+10s → job thật chạy vài phút bị FE bỏ cuộc giữa chừng

- **Triệu chứng:** Tạo sơ đồ cho tài liệu lớn/nhiều nhánh (enrich+relations thật ~100s–vài phút, xem
  lessons-learned "skeleton-first") → FE tự báo lỗi "Quá thời gian chờ tạo Sơ đồ (frontend timeout)."
  dù job BE vẫn đang chạy và sẽ xong bình thường. User phải F5 rồi mở lại từ danh sách mới thấy map.
- **Nguyên nhân:** `SidebarRight.jsx::startPolling` (cũ) tự đặt `maxElapsedMs = jobTimeoutMs (180s) +
  maxExtraMs (10s)` và chủ động bắn `onError` khi vượt — một giá trị đoán, không theo thời gian chạy
  thật của pipeline (đo thật: enrich 3 nhánh ≈86s, nhưng tài liệu lớn/nhiều nhánh hơn dễ vượt 190s).
  Ngoài ra khi đang chờ, FE mở overlay fullscreen sớm với skeleton `partial` preview — trải nghiệm rối
  (overlay bật tắt nhiều lần) và không có cách nào phục hồi theo dõi job nếu user lỡ F5 (không có gì
  lưu `job_id` để resume).
- **Cách xử lý (đã làm, Task 1-4 nhánh mindmap-ux-v3):** thay `startPolling`/`stopPolling` (poller cũ,
  hard-timeout) bằng `utils/mindmapJob.js::createMindmapPoller` — KHÔNG hard-timeout (chỉ có stall-flag
  hiển thị UI sau `STALL_MS=5 phút` không đổi tiến độ, không tự huỷ). Bỏ overlay fullscreen sớm với
  skeleton preview; thay bằng progress chip nhỏ trong sidebar (`mindmapJobUi` state: running/label/
  progress/stalled). Thêm resume-after-reload: `utils/activeMindmapJob.js` lưu `{jobId, sources,
  startedAt}` vào localStorage khi job bắt đầu, `SidebarRight` mount-effect đọc lại và tự start poller
  mới (cờ `resumed=true` → done chỉ toast, không tự mở overlay, tránh giật user vào fullscreen cho job
  họ có thể không nhớ đã bấm). `clearActiveMindmapJob()` gọi ở mọi nhánh terminal (done/error/cancelled).
- **Prevention:** KHÔNG đặt hard-timeout FE cho job chạy nền dựa trên số đo TRUNG BÌNH — nếu cần phát
  hiện "kẹt", dùng stall-detection (không đổi tiến độ trong N phút, chỉ cảnh báo UI, không tự huỷ) thay
  vì tự ý coi là lỗi. Mọi job chạy nền dài (mindmap và tương lai các job tương tự) nên lưu định danh job
  vào localStorage ngay khi có `job_id` để F5 giữa chừng vẫn resume được, không bắt user "tưởng lỗi".
  `createMindmapPoller` là instance-per-run KHÔNG tự guard double-start — caller (`SidebarRight`) phải
  `pollerRef.current?.stop()` trước khi gán poller mới vào ref, nếu không sẽ rò rỉ vòng lặp polling cũ
  khi user bấm tạo/tạo lại liên tiếp.
- **Verify:** `cd FE && npm run build && npx vitest run` xanh (23 test, unit `mindmapJob.test.js`/
  `activeMindmapJob.test.js` cover poller + localStorage helper thuần, không cần BE thật). Manual smoke
  cần BE chạy thật (F5 giữa chừng lúc đang sinh → chip tự hiện lại) — dời qua đợt smoke thủ công riêng,
  chưa chạy trong phiên sửa này.

## Tạo lại xong ghi đè chỉnh sửa chưa lưu trong viewer

- **Triệu chứng:** Đang mở sơ đồ, sửa tay (đổi tên node, kéo, vẽ arrow — chưa bấm Lưu) rồi bấm "Tạo
  lại" (force=true, banner degraded) cho CÙNG map đang mở → khi job nền xong, bản chỉnh sửa tay biến
  mất, viewer hiện bản mới do LLM sinh lại thay vì hỏi trước.
- **Nguyên nhân:** `SidebarRight.jsx::handleMindmapDone` (được gọi khi poller báo `done`, kể cả với
  `isRegenerate: true`) build lại `record` từ kết quả job rồi gọi `setShowModalMap(record)` — thay
  thẳng object `data` mà `MindElixirView.jsx` đang render. `MindElixirView` re-init mind-elixir mỗi
  khi `data.id` đổi (`useEffect(..., [data?.id])`) — vì record mới có `id` mới (mindmap record UUID
  khác, xem mục 5 pipeline: force luôn tạo bản ghi mới) nên effect này chạy lại, gọi
  `recordToMindElixir(data)` mới và ghi đè toàn bộ instance, kể cả state `dirty`/nội dung chưa lưu
  của phiên sửa trước đó. `dirty` chỉ sống trong state của `MindElixirView`, không được đẩy lên
  `SidebarRight` nên `handleMindmapDone` không có cách nào biết viewer đang có thay đổi chưa lưu để
  chặn lại.
- **Cách xử lý (đã làm, mitigation không phải fix thật):** `MindElixirView.jsx` banner "Đang tạo lại
  sơ đồ…" hiện thêm dòng cảnh báo khi `dirty === true`: "— thay đổi chưa lưu sẽ bị thay thế khi bản
  mới sẵn sàng." (xem comment tại banner generating, ngay trước JSX `{dirty ? "..." : ""}`). Không
  chặn hành vi, chỉ báo trước để user tự bấm Lưu trước khi tạo lại nếu muốn giữ bản sửa.
- **Fix thật (chưa làm):** thread trạng thái `dirty` từ `MindElixirView` lên `SidebarRight` (ví dụ
  qua callback `onDirtyChange` giống `onSaved`/`onCancel` hiện có), rồi trong
  `SidebarRight.jsx::handleMindmapDone` (nhánh `isRegenerate`) kiểm cờ đó TRƯỚC khi
  `setShowModalMap(record)` — nếu đang dirty, hỏi xác nhận (hoặc giữ nguyên bản đang mở + chỉ toast
  "Có bản mới, xem?") thay vì tự động swap.
- **Tham chiếu code:** `FE/src/components/mindmap/MindElixirView.jsx` (banner generating, dòng có
  comment "Honest mitigation"), `FE/src/components/Layout/SidebarRight.jsx::handleMindmapDone`.


## (ĐÃ SỬA 2026-08-24) 17 test evaluation-review fail vì đường dẫn dataset tương đối sai gốc

- **Triệu chứng:** `cd BE && pytest tests/test_evaluation_review.py tests/test_evaluation_review_app.py`
  → 17 failed, đều chết ở `shutil.copytree(SOURCE_DATASET, root)` với `FileNotFoundError`. Nằm im
  trong nhóm "29 test BE fail sẵn" nên không ai truy.
- **Nguyên nhân:** hai file khai báo `Path("reports/evaluation/datasets/corpus_v1")` — đường dẫn
  TƯƠNG ĐỐI theo CWD. Nhưng `evaluation.review_app` chỉ import được khi CWD = `BE/`, còn `reports/`
  lại nằm ở gốc repo (`BE/../reports`). Hai ràng buộc mâu thuẫn: CWD nào cũng hỏng một nửa. Không có
  CWD nào từng chạy được cả hai.
- **Cách xử lý:** thêm guard module-level ngay sau chỗ khai báo hằng — `if not SOURCE.exists():
  pytest.skip(..., allow_module_level=True)`. Cùng lúc `reports/` đã gỡ khỏi git (báo cáo NCKH là dự
  án riêng, xem `.gitignore`), nên bản clone sạch cũng không có dataset và guard này là đường sống
  duy nhất. 17 failed → 17 skipped.
- **Prevention:** đường dẫn dữ liệu trong test KHÔNG dùng chuỗi tương đối trần. Neo theo file test:
  `Path(__file__).resolve().parents[2] / "reports" / ...` — không phụ thuộc CWD. Nếu dữ liệu nằm
  ngoài git (dataset nặng, tài sản dự án khác), test phải skip có thông báo chứ đừng fail: fail giả
  làm loãng danh sách fail thật, đúng như trường hợp này (ẩn 4 tháng trong 29 fail).
- **Verify:** `cd BE && .venv/Scripts/python.exe -m pytest tests/test_evaluation_review.py
  tests/test_evaluation_review_app.py -q` → `2 skipped`.

## (ĐÃ SỬA 2026-08-24) Upload .html luôn hỏng — gọi thư viện không có trong requirements

- **Triệu chứng:** tải file `.html` lên → tài liệu chuyển sang `failed`, log ingest ghi
  `Cannot read file content`. Không có dòng lỗi nào nói vì sao.
- **Nguyên nhân:** `document_loader.load_document` (bản cũ) gọi `UnstructuredHTMLLoader`, mà gói
  `unstructured` **chưa bao giờ có trong `BE/requirements.txt`**. `ModuleNotFoundError` rơi vào
  `except Exception: pass` ở cuối hàm, tụt xuống `ingest_utils.extract_text` — hàm này chỉ biết
  pdf/docx/doc/txt/ảnh nên trả `''`. Rỗng → `extract_text_node` ném `ValueError`. Chua ở chỗ
  `markdown_convert.py` đã dùng `markdownify` (đã cài) cho đúng việc đó, chỉ là hai file không dùng
  chung đường.
- **Cách xử lý:** `_load_html()` dùng `markdownify`, bỏ hẳn `UnstructuredHTMLLoader`.
- **Prevention:** `except Exception: pass` bao quanh một chuỗi loader là chỗ trốn hoàn hảo cho lỗi
  thiếu dependency. Mọi thư viện được gọi trong nhánh loader phải có test đọc file thật của định
  dạng đó (`test_upload_formats.py`), nếu không "hỗ trợ định dạng X" chỉ là một dòng `if` chứ không
  phải khả năng thật.
- **Verify:** `cd BE && .venv/Scripts/python.exe -m pytest tests/test_upload_formats.py -q` → 11 passed.

## (ĐÃ SỬA 2026-08-24) `/upload-file` nhận mọi loại file và không giới hạn dung lượng

- **Triệu chứng:** tải `.exe`/`.zip`/`.mp4` lên vẫn được nhận. File được lưu đĩa, đẩy lên Supabase
  Storage, tạo dòng trong `documents`, rồi vài phút sau ingest mới chết. Người dùng không thấy lỗi
  lúc bấm — chỉ thấy một tài liệu hỏng trong danh sách. Ngoài ra không có `MAX_CONTENT_LENGTH` ở
  bất kỳ đâu nên Flask nhận file lớn tuỳ ý.
- **Nguyên nhân:** ba route upload (`/upload-file`, `/upload-multiple`, `/api/documents/upload`) chỉ
  kiểm `file` có tồn tại và tên khác rỗng. Việc lọc định dạng bị phó mặc cho thuộc tính `accept` của
  FE — thứ chỉ là gợi ý hộp thoại chọn file, gọi thẳng API là qua mặt được.
- **Cách xử lý:** `app/domains/ingest/formats.py` giữ `SUPPORTED_EXTENSIONS` dùng chung.
  `_ingest_uploaded_file` kiểm đuôi **trước khi ghi bất cứ thứ gì** và ném `UnsupportedFileType`;
  ba route trả 415 kèm `supported_extensions`. Thêm `MAX_CONTENT_LENGTH` đọc từ `MAX_UPLOAD_MB`
  (mặc định 100) và handler 413 trả JSON.
- **Prevention:** thuộc tính `accept` của FE KHÔNG phải kiểm tra. Mọi ràng buộc đầu vào phải nằm ở
  backend; FE chỉ là tiện ích chọn file. Đặt cổng chặn trong hàm dùng chung
  (`_ingest_uploaded_file`) chứ không phải ở từng route — ba route cùng đi qua đó nên một guard
  che hết, thêm route thứ tư cũng tự có.
- **Verify:** `test_upload_tu_choi_duoi_la_va_khong_ghi_dia` khẳng định 415 VÀ thư mục lưu vẫn rỗng.

## (ĐÃ SỬA 2026-08-24) Trạng thái bố cục tự xoá chính nó — đọc localStorage trong useEffect + StrictMode

- **Triệu chứng:** thu gọn cột bên, `localStorage` ghi đúng `{"collapsed":{"left":true}}`, tải lại
  trang thì cột mở lại và giá trị đã lưu bị thay bằng mặc định. Đo bằng playwright: đặt sẵn
  `{left:true,right:true}` rồi vào `/app` → `.panel-spine` đếm được **0**, và giá trị trong
  localStorage đổi thành `{left:false,right:false}`.
- **Nguyên nhân:** hook nạp trạng thái trong `useEffect` (đọc) và ghi trong một `useEffect` khác.
  React chạy effect theo thứ tự khai báo trong CÙNG một commit: effect-đọc gọi `setState` (mới xếp
  hàng, chưa có hiệu lực) rồi bật cờ `hydrated`, ngay sau đó effect-ghi thấy cờ đã bật nên ghi
  **giá trị mặc định của lần render đầu** đè lên. Với `StrictMode` (dev gọi effect hai lượt), lượt
  đọc thứ hai đọc đúng cái mặc định vừa bị ghi đè — dữ liệu mất hẳn, không phải chỉ nhấp nháy.
- **Cách xử lý:** đọc `localStorage` NGAY trong initializer của `useState` (qua một `useRef` giữ
  kết quả để không đọc lại mỗi lần render), bỏ hẳn effect-đọc, và bỏ qua lượt ghi đầu tiên bằng
  `firstWrite` ref. Không còn lần render nào tồn tại trước khi trạng thái được nạp, nên không còn
  gì để ghi đè.
- **Prevention:** trong SPA thuần (không render phía máy chủ) thì đọc storage trong initializer của
  `useState` là cách ĐÚNG, không phải cách tắt. Chỉ dùng effect khi thật sự có SSR và phải khớp
  HTML lần đầu. Nếu buộc phải nạp bằng effect thì effect-ghi phải bỏ qua mọi lượt chạy lúc gắn, và
  phải thử với StrictMode bật — bug này vô hình nếu chỉ nhìn một lượt mount.
- **Verify:** kịch bản playwright đặt sẵn trạng thái, vào `/app`, đếm `.panel-spine` = 2 và
  localStorage giữ nguyên; thêm vòng thu gọn → tải lại → vẫn 1 gáy sách.

## (KHÔNG PHẢI LỖI) `status: interrupted` của /query-status là HITL đang chờ duyệt, không phải job chết

- **Nhầm lẫn:** thấy `/query-status/<id>` trả `{"status": "interrupted"}` sau vài giây rồi kết luận
  pipeline truy vấn hỏng. Sai.
- **Sự thật:** `main.py:1421 _mark_query_interrupted()` — "HITL: đánh dấu job chờ người duyệt (SSE
  coi 'interrupted' là terminal)". Với `HITL_ENABLED=1`, graph dừng ở cổng duyệt và job mang đúng
  trạng thái đó, kèm `result.payload.review = {answer, job_id, type: "review"}`. Câu trả lời đã có
  sẵn trong payload, chỉ chờ người bấm duyệt qua `/query-resume/<job_id>`.
- **Cách phân biệt:** job chết thật thì `result` rỗng hoặc `error` khác None. Job chờ duyệt thì
  `result.payload.review` tồn tại. Đừng coi `interrupted` là mã lỗi — nó nằm trong `TERMINAL_STATUSES`
  của `jobs_store` nhưng CỐ Ý không bị xoá `token_buffer` vì còn resume được.
- **Lưu ý khi viết script kiểm thử:** vòng lặp poll mà dừng ở `interrupted` rồi báo "thất bại" sẽ
  báo động giả mỗi lần HITL bật. Phải đọc `result.payload.review` trước khi kết luận.
- **Trạng thái hiện tại:** `HITL_ENABLED=0` trong `BE/.env` và trong `render.yaml` (mặc định của
  `shared/config.py` là `1`, nên phải đặt tường minh). Query đi thẳng `running` → `done`.

## (ĐÃ SỬA 2026-08-24) Không có chữ chảy dần trong chat — EventSource không gửi được Bearer

- **Triệu chứng:** hỏi xong ngồi im vài phút rồi câu trả lời hiện MỘT CỤC. Console báo
  `GET /query-stream/<job_id> 401 UNAUTHORIZED`.
- **Nguyên nhân:** `ChatArea.jsx` dùng `new EventSource(...)`. Đặc tả EventSource KHÔNG cho đặt
  header, nên không có cách nào đính `Authorization: Bearer`. Backend `/query-stream` gọi
  `_require_app_user()` ngay dòng đầu → 401 → `onerror` → cờ `sseConnectionLost` → tụt về
  `pollQueryStatus`. Polling chỉ lấy kết quả cuối nên mất sạch token chảy dần. Đường ống backend
  luôn đúng: `query_graph.py:595` gọi `_append_token` từng mẩu, `/query-stream` đọc `token_buffer`
  mỗi `SSE_POLL_INTERVAL_SEC=0.4` rồi đẩy `{"type":"token"}`.
- **Cách xử lý:** `utils/sseStream.js` — `fetch()` + `ReadableStream`, tự tách khung SSE
  (`parseSseChunk`, hàm thuần, 9 ca test). `fetch` gửi được header và huỷ được bằng
  `AbortController`. Endpoint backend KHÔNG đổi một dòng. Đường polling giữ nguyên làm lưới an toàn.
- **Hai cách đã cân nhắc và bỏ:** nhét token vào query string (`?token=`) làm rò bearer vào log máy
  chủ và referrer; cấp vé dùng-một-lần thì đúng nhưng phải thêm route + bảng + hạn dùng.
- **Cửa gác thứ hai cần biết:** `query_graph.py:89` ép `QUERY_STREAM_TOKENS = False` khi
  `HITL_ENABLED` — "tắt stream token để không lộ bản nháp chưa duyệt". Bật HITL thì dù sửa vận
  chuyển vẫn KHÔNG có token. Hai chỗ chặn độc lập nhau.
- **Verify:** gọi thẳng SSE có Bearer → HTTP 200 `text/event-stream`, nhận 14 sự kiện token / 525
  ký tự; không Bearer → 401. `npx vitest run` 27 file, 212 passed.

## (KHÔNG PHẢI LỖI) Truy vấn mặc định KHÔNG đi đường RAG — `use_memory_tree` mặc định True

- **Nhầm lẫn:** thấy chuỗi node `RetrieveMemory -> Finalize` (13–20s, không có `GenerateAnswer`,
  `sources: 0`) rồi tưởng pipeline bị cắt hoặc streaming hỏng.
- **Sự thật:** `main.py` route `/query` đọc `use_memory_tree = data.get('use_memory_tree', True)`.
  Mặc định BẬT, nên câu hỏi đi đường cây-nhớ và trả lời từ tóm tắt cây, payload có
  `query_type` + `memory_nodes`, KHÔNG có `sources`. Đường RAG đầy đủ
  (`RerankDocuments -> VerifyContext -> GenerateAnswer -> Finalize`) chỉ chạy khi gửi
  `use_memory_tree: false`. `_append_token` nằm trong `GenerateAnswer`, nên đường cây-nhớ
  KHÔNG BAO GIỜ stream token — đúng thiết kế, không phải lỗi.
- **Ba đường đo được cho cùng một câu hỏi:**
  | Đường | Chuỗi node | Thời gian | Token |
  |---|---|---|---|
  | Cache trúng (Redis) | `CheckSources -> RetrieveMemory -> Finalize` | 40s | 0 |
  | Cây nhớ (mặc định) | `RetrieveMemory -> Finalize` | 13–20s | 0 |
  | RAG đầy đủ | `RerankDocuments -> VerifyContext -> GenerateAnswer -> Finalize` | 225s | 14 |
- **Prevention:** khi đo hay so sánh chất lượng truy hồi, PHẢI ghi rõ đường nào — ba đường cho ba
  câu trả lời khác nhau với cùng một câu hỏi. Kịch bản benchmark quên `use_memory_tree: false` sẽ
  đo nhầm cây nhớ mà tưởng đang đo RAG.

## (ĐÃ SỬA 2026-08-24) `DATA_DIR` trỏ sang DỰ ÁN KHÁC — toàn bộ trạng thái chạy nằm ngoài repo

- **Triệu chứng:** đi tìm timeline node của một truy vấn vừa chạy, `BE/logs.sqlite` đứng im từ
  2026-08-11. Tưởng instrumentation không tồn tại, suýt viết lại từ đầu.
- **Nguyên nhân:** `BE/.env` đặt `DATA_DIR=e:/memvid_NCKH/MemVid_New/BE` — thư mục của một dự án
  KHÁC. `logger.log_db_path()`, index FAISS, cây nhớ, `checkpoints.sqlite`, `conversations.sqlite`,
  `jobs.sqlite`, `sessions.sqlite` đều neo theo `DATA_DIR`, nên mọi thứ sinh ra lúc chạy rơi vào
  `MemVid_New/BE`. Kiểm chứng bằng dấu thời gian: các file bên đó mang giờ 17:21 hôm nay trong khi
  bản trong repo dừng ở tháng 7.
- **Vì sao ẩn được lâu:** trỏ sai KHÔNG gây lỗi nào. App chạy bình thường, upload được, hỏi được,
  trả lời đúng — chỉ là đọc và ghi ở một cây thư mục khác. Không có exception, không có log đỏ.
  Chỉ lộ ra khi đi tìm một file cụ thể và thấy nó cũ.
- **Cách xử lý:** dừng BE, sao lưu bản trong repo sang `BE/_backup-<timestamp>/`, chép
  `index/ memory/ input_docs/` và các `*.sqlite` (KÈM `-wal` và `-shm`, nếu không mất phần ghi chưa
  checkpoint) từ thư mục cũ về, rồi đặt
  `DATA_DIR=e:/memvid_NCKH/MemVid_BaoCaoTotNghiep/BE`.
- **Phòng ngừa (đã thêm):** `main.py` in `DATA_DIR` mỗi lần khởi động và kêu to khi nó nằm ngoài
  `BE_ROOT`. Một dòng in rẻ hơn nhiều so với vài tháng đo nhầm chỗ.
- **Verify:** `BE/logs.sqlite` 185 bản ghi, mới nhất trùng giờ truy vấn vừa chạy; log bên
  `MemVid_New` dừng hẳn ở thời điểm chuyển. Truy vấn RAG sau khi chuyển vẫn chạy trọn (index còn
  nguyên, 19 sự kiện token).
- **Còn lại:** `BE/_backup-<timestamp>/` chứa bản CŨ tháng 7 (đã bị thay). Thư mục
  `e:/memvid_NCKH/MemVid_New/BE` vẫn nguyên vẹn làm bản gốc. Xoá được khi đã yên tâm.

## (ĐÃ SỬA 2026-08-24) MỌI timeout trong query_graph đều vô hiệu — `with ThreadPoolExecutor` chặn lúc thoát

- **Triệu chứng:** `NLI_TIMEOUT_SEC=90` nhưng node `VerifyContext` chạy 197 giây. Kiểm log node
  thấy đây là số thật, lặp lại: 5 lần chạy, trung vị 197 691 ms, max 226 979 ms.
- **Nguyên nhân:** khuôn `with ThreadPoolExecutor(max_workers=1) as ex: ex.submit(fn).result(timeout=T)`.
  `result()` ném `TimeoutError` đúng hạn, NHƯNG `__exit__` của executor gọi `shutdown(wait=True)`
  nên nó chặn tới khi worker chạy xong, rồi ngoại lệ mới tới được `except`. Đo tách bạch: việc 8
  giây với `timeout=2` thì khối `with` thoát ở giây **8.0**, không phải 2.0; bỏ `with` và
  `shutdown(wait=False)` thì thoát đúng giây **2.0**.
- **Phạm vi:** 5 chỗ trong `query_graph.py`, tức TOÀN BỘ hạn giờ của pipeline truy vấn —
  `MEMORY_TREE_TIMEOUT`, `RERANK_TIMEOUT`, `NLI_TIMEOUT`, `AI_TIMEOUT` (hạn gọi LLM), và một chỗ
  chạy hai việc song song.
- **Cách xử lý:** thêm `run_with_timeout(fn, timeout, propagate_ctx=)` — tạo executor, submit,
  `result(timeout=)`, rồi `shutdown(wait=False)` trong `finally`. Thay 4 chỗ một-việc. Chỗ thứ 5
  (hai việc song song) để lại kèm comment `ponytail:` nêu rõ trần và đường nâng cấp — thiệt hại nhỏ
  vì truy hồi đo được 727ms so với hạn 60s.
- **Prevention:** `shutdown(wait=False)` KHÔNG giết được thread (Python không cho) — công việc bỏ
  lại vẫn chạy tới hết rồi thread mới tự thu. Đó đúng là ý nghĩa của timeout ở đây: thôi chờ, đi
  tiếp bằng đường dự phòng. Đừng bao giờ đặt `.result(timeout=)` bên trong `with ThreadPoolExecutor`
  và mong hạn giờ có tác dụng.
- **Verify:** `BE/tests/test_query_timeout.py` — ca `test_bo_cho_dung_han_chu_khong_doi_viec_xong`
  khẳng định việc 6 giây với hạn 0.5s phải trả quyền dưới 3 giây (bản cũ trả ở ~6s). 5 passed;
  `test_crag_graph` + `test_hitl_graph` + ca mới: 22 passed.

## (CHƯA SỬA) NLI mDeBERTa chậm gấp ~250 lần dự toán FLOP và chưa từng bắt được mâu thuẫn nào

- **Số đo (máy để yên, lặp 3 lần đều nhau):** một lượt forward `mDeBERTa-v3-base-mnli-xnli`,
  batch 2 × 512 token → **94 giây**. Theo độ dài: 128 token 28.2s, 256 token 47.7s.
  `detect_conflicts` với `max_pairs=1` (đúng 2 chiều) → **91.3s**. Nạp model một lần → 17.9s.
- **Không phải do torch:** matmul thuần trên cùng máy đạt **400 GFLOPS**, MKL 2024.2 + oneDNN đủ,
  8 luồng. Dự toán FLOP cho một forward là ~0.1s. Lệch ~250 lần.
- **Nút thắt là công việc ĐƠN LUỒNG, không phải tính toán** — hai phép đo cùng chỉ một hướng:
  1. Scale theo luồng gần như PHẲNG (512 token, batch 2): 1 luồng 96.5s · 4 luồng 94.8s ·
     8 luồng 86.7s · 16 luồng 88.7s. Gấp 16 lần luồng chỉ nhanh hơn 10%. Việc nghẽn ở matmul
     thì phải scale 6–8 lần (matmul thuần trên chính máy này scale đúng như vậy).
  2. Thời gian TUYẾN TÍNH theo độ dài: 128 token 28.2s · 256 token 47.7s · 512 token 92.8s
     (gấp đôi token = gấp 1.9 lần thời gian). Không phải bậc hai, nên KHÔNG phải ma trận
     attention O(n²).
  Kết luận: thời gian nằm ở các phép gather/index tuần tự của attention tách rời DeBERTa-v3
  trong `transformers`. Hệ quả thực dụng: **thêm luồng hay gom lô đều không cứu được**.
- **Hiệu quả thực tế:** `VerifyContext` chạy 5 lần trong các truy vấn thật, **0 lần** phát hiện mâu
  thuẫn, tiêu tổng 1008 giây.
- **Cảnh báo về dữ liệu lịch sử:** `logs.sqlite` có 46 bản ghi `VerifyContext` cũ với trung vị 1ms
  và 16 lần "bắt được mâu thuẫn" — TOÀN BỘ có `job_id='j1'`, tức là của unit test với engine giả
  (có cả ca `{"error": "nli down"}`). ĐỪNG dùng chúng làm số liệu vận hành.
- **Hệ quả sau khi sửa timeout:** hạn 90s nay cắn thật, nên NLI sẽ hết giờ ở gần như mọi truy vấn
  và trả `[]` — tức là vẫn mất 90 giây mà không đóng góp gì. Trạng thái đó tệ hơn tắt hẳn.
- **Lựa chọn, chưa quyết:** (a) `NLI_ENABLED=0` cho chạy thường, giữ cờ cho ablation E4_nli của
  luận văn; (b) đổi sang model NLI nhỏ hơn nhiều (họ MiniLM đa ngữ) rồi đo lại; (c) giữ nguyên và
  chấp nhận NLI luôn hết giờ.

## (ĐÃ SỬA 2026-08-24) Ablation E0–E7 rò `.env` — E4_nli âm thầm biến thành E3_rerank

- **Triệu chứng (chưa xảy ra, bắt được lúc rà):** chạy `E4_nli` trên máy có `NLI_ENABLED=0` trong
  `BE/.env` sẽ ra kết quả TRÙNG KHÍT `E3_rerank`, và hiệu số "đóng góp của NLI" bằng 0 — vì lý do
  sai. Không có lỗi nào nổ ra.
- **Nguyên nhân:** `evaluation/adapters.py:178` gác đúng bằng `cfg["nli"]["enabled"]` từ YAML, cổng
  mở nên `nli_filter` vẫn chạy. Nhưng bên trong nó gọi `nli.get_nli()`, và hàm đó (nli.py:120)
  đọc `NLI_ENABLED` từ MÔI TRƯỜNG rồi trả `NullNli` khi cờ tắt. `NullNli` chấm mọi cặp là neutral
  → không bao giờ có xung đột → không chunk nào bị loại. Cùng cái bẫy với `rerank.get_reranker()`
  (rerank.py:193 → `_IDENTITY` khi `RERANK_ENABLED=0`).
- **Vì sao nguy hiểm:** đây là số liệu đi thẳng vào chương 4 luận văn. Một biến môi trường trên máy
  chạy thí nghiệm có thể vô hiệu hoá một thành phần mà bảng kết quả vẫn trông hoàn toàn hợp lệ.
- **Cách xử lý:** `evaluation/runner.py` đặt `NLI_ENABLED` / `RERANK_ENABLED` (và `NLI_MODEL` /
  `RERANK_MODEL` nếu cfg có) từ YAML, ngay cạnh `INDEX_DIR`/`MEMORY_DIR` và **trước** dòng import
  production — đặt sau khi import thì vô tác dụng vì settings đã đọc env rồi.
- **Prevention:** trong một bộ chạy ablation, YAML phải là nguồn quyết định DUY NHẤT cho mọi cờ
  thành phần. Cổng ở tầng điều phối (`if cfg[...]["enabled"]`) là CHƯA ĐỦ khi hàm bên dưới còn tự
  đọc env — phải ép env khớp cfg trước khi import. Quy tắc chung: mỗi cờ mà production đọc từ env
  thì runner phải ghi đè tường minh, không dựa vào máy chạy sạch.
- **Verify:** `tests/test_evaluation_env_isolation.py` — khoá cả hành vi bẫy (`NLI_ENABLED=0` →
  `NullNli`, `RERANK_ENABLED=0` → `_IDENTITY`) lẫn việc runner đặt cờ TRƯỚC import production.
  6 passed; harness + timeout + crag-config: 23 passed.

## (ĐÃ SỬA 2026-08-24) Câu hỏi ĐẦU TIÊN trả giá nạp model rerank — 13 giây không ai thấy

- **Triệu chứng:** node `RerankDocuments` chiếm 50% thời gian truy vấn (18–22 giây), trông như
  cross-encoder chậm.
- **Sự thật:** phần lớn là NẠP MODEL, không phải suy luận. Đo trong cùng một tiến trình:
  | | câu 1 (nguội) | câu 2 (ấm) |
  |---|---|---|
  | RerankDocuments | 21 958 ms | 8 844 ms |
  | tổng truy vấn | 62.6s | 26.1s |
  `rerank.warmup()` được gọi trong node và cố ý nằm NGOÀI vùng timeout (đúng — nếu không, lần
  nạp đầu vượt hạn 10s làm rerank âm thầm fallback ở câu đầu). Nhưng thế nghĩa là người dùng đầu
  tiên sau mỗi lần khởi động trả trọn giá nạp.
- **Suy luận thì bình thường:** tuyến tính 0.65–0.69s mỗi ứng viên (5 ứng viên 3.39s · 10 ứng viên
  6.85s · 20 ứng viên 12.95s). Khác hẳn NLI — bge-reranker chạy đúng như dự toán cho một model
  568M tham số trên CPU. Và nó THẬT SỰ đổi thứ hạng: `[0,1,2,3,4,5]` thành `[17,16,13,19,14,7]`.
- **Cách xử lý:** thêm `RETRIEVAL_WARMUP_ENABLED` (mặc định 0, opt-in như `EMBEDDING_WARMUP_ENABLED`
  và cùng lý do RAM: mỗi worker gunicorn giữ một bản ~2.2GB). Bật thì luồng warm nền lúc khởi động
  gọi `rerank.warmup()` và `nli.warmup()`, tôn trọng `RERANK_ENABLED`/`NLI_ENABLED`.
- **Verify:** bật cờ, khởi động lại, câu ĐẦU TIÊN cho `RerankDocuments 9519 ms` (số ấm) thay vì
  21 958 ms; tổng 40.7s thay vì 62.6s. Log có `[warmup] rerank model ready`.
- **Bẫy khi kiểm:** dòng print của luồng warm nằm trong bộ đệm stdout nên `grep` ngay sau đó KHÔNG
  thấy, dù nó đã chạy. Suýt kết luận nhầm là cờ không ăn. Bằng chứng đáng tin là SỐ ĐO của câu đầu,
  không phải dòng log.
- **Còn lại:** log node của `RerankDocuments` trước đây không ghi `rerank_status`, nên nhìn log
  không phân biệt được một lượt rerank thành công với một lượt chạm hạn rồi giữ nguyên thứ tự. Đã
  thêm `status` và `timeout_sec` vào metadata.

## (CẦN ĐỂ Ý) Hạn rerank 10s sát mép — chunk dài hơn là chạm

- Đo với chunk tổng hợp 979 ký tự: 20 ứng viên mất **12.95s**, vượt `RERANK_TIMEOUT_SEC=10` → rơi
  về thứ tự gốc, tốn trọn 10 giây mà không đổi gì.
- Chunk THẬT hiện tại ngắn hơn (~316 ký tự/đoạn, đo từ `ContextBuilder chars=1896` cho 6 đoạn) nên
  còn lọt: log thật cho `status: "applied"`.
- Nghĩa là biên an toàn mỏng. Tài liệu có đoạn dài hơn, hoặc `RERANK_CANDIDATE_K` tăng, là chạm hạn
  ngay — và trước khi sửa lỗi `with ThreadPoolExecutor` thì hạn này còn không cắn nên chưa ai thấy.
- Ba đường khi cần: giảm `RERANK_CANDIDATE_K` (20 xuống 10 = 6.85s), nâng `RERANK_TIMEOUT_SEC`, hoặc
  cắt ngắn text đưa vào cross-encoder. Chưa quyết.

## (ĐÃ SỬA 2026-08-24) bge-m3 không nạp được qua sentence-transformers — torch.load bị chặn

- **Triệu chứng:** `python -m evaluation.index_builder` chết ngay ở `get_embeddings()`:
  `ValueError: Due to a serious vulnerability issue in torch.load ... require torch >= 2.6
  (CVE-2025-32434). This version restriction does not apply when loading files with safetensors.`
- **Nguyên nhân:** `transformers` bản mới từ chối `torch.load` mọi checkpoint `.bin` khi torch < 2.6
  (ở đây torch 2.5.1+cpu). Kho bge-m3 có CẢ HAI định dạng nhưng sentence-transformers chọn `.bin`.
- **Vì sao app vẫn chạy được mà chỉ bộ dựng index chết:** đường ingest của app dùng LATE_CHUNKING=1,
  đi qua `late_chunk.py` với loader riêng. Chỉ nhánh nào gọi `get_embeddings()` với
  `LATE_CHUNKING=0` mới dính — và đó đúng là cách config R0/R1 chạy. Một lỗi ẩn sau cờ.
- **Cách xử lý:** `llm_factory.get_embeddings()` truyền
  `model_kwargs={"device": "cpu", "model_kwargs": {"use_safetensors": True}}`. Kiểm riêng: nạp
  được, dim 1024, 20.3s.
- **Prevention:** đừng nâng torch để chữa (kéo theo cả stack langchain). Ép safetensors là đúng
  hướng và rẻ. Khi thêm model mới, kiểm nó có `model.safetensors` trước khi ghim vào config.

## (CHẶN — CẦN NGƯỜI QUYẾT) Ablation E0–E7 không chạy được: canonical extraction đã lệch

- **Trạng thái:** `reports/evaluation/runs/` KHÔNG TỒN TẠI. Bộ ablation chưa chạy lần nào, nên chưa
  có một con số recall/precision nào cho chương 4.
- **Ba cửa đã qua:** (1) lỗi safetensors ở trên — đã sửa; (2) builder giải đường dẫn nguồn theo CWD
  nên phải chạy TỪ GỐC REPO với `PYTHONPATH=BE`, không phải từ `BE/`; (3) `corpus_version:
  REPLACE_BEFORE_BUILD` — thực ra builder tự lấy từ manifest khi dùng `--dataset`.
- **Cửa còn lại:** `ValueError: canonical extraction changed after coordinate bridge:
  cv1_ragas_guardrails`. Dataset ghi bản trích xuất chuẩn kèm hash, người gán nhãn đánh dấu span
  bằng chứng TRÊN ĐÚNG bản đó. Trích lại bây giờ ra text khác nên toạ độ span không còn bảo đảm.
- **Đo mức lệch:** độ dài Y HỆT (41619 = 41619), `SequenceMatcher.ratio()` = **1.0000**, khác biệt
  duy nhất là VỊ TRÍ của dấu tổ hợp `U+0338`. Không bằng nhau kể cả sau NFC lẫn NFD
  (`normalize_evidence_text` vốn đã áp NFC), nên đây là đổi thứ tự ký tự thật, không phải đổi dạng
  chuẩn. Nghi PyMuPDF đổi cách phát dấu tổ hợp giữa các phiên bản. 1/3 tài liệu có canonical bị lệch.
- **KHÔNG được phá hàng rào này.** Nó tồn tại đúng để chặn việc tính số liệu luận văn trên annotation
  không còn khớp text. Độ dài giống hệt nên span "gần như chắc chắn" vẫn đúng — nhưng "gần như" không
  phải tiêu chuẩn cho ground truth.
- **Ba đường, cần người quyết:** (a) chạy lại coordinate bridge cho tài liệu đó theo
  `PHASE_4C_COMMANDS.md` mục 3 rồi phân xử thủ công các span lệch; (b) loại tài liệu đó khỏi corpus;
  (c) ghim đúng phiên bản PyMuPDF đã tạo bản gốc — nhưng không biết là bản nào.
- **ĐÃ XÁC MINH (2026-08-24), tác động NHỎ HƠN NHIỀU so với dự đoán ban đầu:**
  - 3/12 tài liệu là ĐÚNG VÀ ĐỦ: 9 tài liệu còn lại `eligible_for_study=False` (smoke-test
    payload, demo sản phẩm, tài liệu thiết kế nội bộ). Cả 3/3 tài liệu đủ điều kiện đều có
    canonical. Coordinate bridge KHÔNG dở dang.
  - Kiểm từng span bằng `locator.char_start/char_end` (hệ `canonical-document-v1`, 89/89 span
    dùng chung hệ này) và so text đã gộp khoảng trắng:
    | | bản CŨ (đóng băng) | bản MỚI |
    |---|---|---|
    | cv1_ragas_guardrails (canonical ĐỔI) | 44/44 | **43/44** |
    | cv1_social_engineering | 28/28 | 28/28 |
    | cv1_vector_feature_store | 17/17 | 17/17 |
    | **tổng** | **89/89** | **88/89** |
  - Dataset gốc NHẤT QUÁN HOÀN TOÀN (89/89). Toàn bộ thiệt hại là **ĐÚNG MỘT span**: `R17_s01`.
  - Span đó: mong `'Eval ̸= optional. RAGAS 4 metrics + LLM-Judge là baseline.'`, lấy được
    `'Eval̸ = optional. RAGAS 4 metrics + LLM-Judge là baseline.'` — chữ Y HỆT, dấu gạch chéo
    tổ hợp dịch một vị trí. Cả hai đều hiển thị 'Eval ≠ optional'. Khác biệt RỖNG về ngữ nghĩa.
  - Nên việc cần người làm thu về: phân xử ĐÚNG MỘT span, không phải gán nhãn lại.

- **BỐN LẦN ĐO SAI LIÊN TIẾP trước khi ra được bảng trên — ghi lại để lần sau khỏi lặp:**
  1. Kiểm chồng lấn bằng `char_start`/`char_end` ở cấp span → field đó KHÔNG tồn tại ở cấp đó,
     `.get()` trả None nên mọi so sánh ra False. Kết luận '0 span bị chạm' hoàn toàn vô nghĩa.
  2. Hash `canonical_text[start_offset:end_offset]` → `start_offset` là offset TRONG TRANG,
     không phải trong tài liệu. Toạ độ tài liệu nằm ở `locator.char_start/char_end`.
  3. Hash thô đoạn text → `evidence_text` lưu ở dạng ĐÃ GỘP khoảng trắng, còn canonical giữ
     nguyên xuống dòng. Ra '6/17 khớp' và suýt báo dataset hỏng — thực ra 17/17.
  4. Chỉ khi đọc TRỌN một bản ghi span (thay vì đoán tên field) mới thấy đủ `locator`,
     `coordinate_system`, và quan hệ giữa `start_offset` với `locator.char_start`.
  **Bài học:** với dữ liệu nghiên cứu có lược đồ lạ, ĐỌC TRỌN một bản ghi TRƯỚC khi viết phép
  kiểm. Mỗi lần đoán tên field đều cho một con số trông hợp lý mà sai — và con số sai kiểu đó
  nguy hiểm hơn lỗi ném ra, vì nó không kêu.

## (ĐÃ SỬA 2026-08-25) qrel của R1/R2 không sinh được: chunk Markdown không định vị được trong canonical

- **Trạng thái sau khi đã phá 4 hàng rào provenance:** 3 index dựng xong.
  | index | chunk | tb ký tự | trung vị | chunk có toạ độ canonical |
  |---|---|---|---|---|
  | R0_recursive | 171 | 300 | 310 | **167 / 171** |
  | R1_structure | 142 | 388 | 450 | **1 / 142** |
  | R2_late | 142 | 388 | 450 | **1 / 142** |
  R0 sinh được **91 qrel**. R1 và R2 chết ở `span V01_s01 has unresolved chunk alignment`.
- **Nguyên nhân THẬT (không phải span khó phân xử):** `map_span_to_chunks` trả `relevant: None`
  khi CHUNK thiếu `canonical_char_start/end`, chứ không phải khi span không chồng lấn. Mà
  `locate_chunks` dùng TÌM CHUỖI CON CHÍNH XÁC trong canonical text. R0 cắt trên text thô nên chunk
  là chuỗi con thật → khớp. R1/R2 cắt trên bản Markdown do `pymupdf4llm` sinh, ví dụ:
  `'#### <mark>Sau buổi học này, bạn sẽ:</mark>\n**1.** Hiểu vector embeddings...'`
  Có thẻ HTML `<mark>`, đánh số thành `**1.**`, heading `####`. Đó là VIẾT LẠI CẤU TRÚC, không phải
  thêm dấu.
- **Đã thử và KHÔNG đủ:** `locate_chunks` vốn đã bóc dấu heading `^#{1,6}\s+`. Bóc thêm nhấn mạnh
  (`**đậm**`, `_nghiêng_`, `*nghiêng*`) chỉ nâng từ **1/142 lên 6/142**. Bóc dấu không phải hướng đúng.
- **Mức lan: TOÀN BỘ.** Cả 8 config E0–E7 đều `index_dir: reports/evaluation/indexes/R2_late`. Nên
  cả thang ablation chặn ở đúng chỗ này.
- **Ba đường, cần người quyết:**
  - (a) Đổi 8 config E sang `R0_recursive` — chạy được NGAY (qrel đã có). Đổi lại: E0–E7 sẽ đo biểu
    diễn cắt-đệ-quy chứ không phải late chunking. Trục so sánh R0/R1/R2 vốn là trục riêng.
  - (b) Sửa đúng gốc: `chunk_markdown_spans` ĐÃ trả `start`/`end` trong hệ toạ độ Markdown. Thay vì
    tìm chuỗi con từng chunk sau khi cắt, hãy căn Markdown↔canonical MỘT LẦN cho mỗi tài liệu rồi
    quy đổi offset. Đúng hơn nhiều nhưng là việc lớn và đổi `MAPPING_RULE_VERSION`.
  - (c) Phân xử tay 141 chunk — không khả thi.
- **ĐÃ SỬA — chọn đường (b), sửa gốc:** `evaluation/evidence.py` thêm `project_offsets(source,
  target)` (bảng quy đổi offset: vùng giống ánh xạ 1-1, vùng khác nội suy tuyến tính giữa hai
  mốc, đơn điệu không giảm) và `locate_chunks_by_spans(canonical, doc_text, spans)`.
  `index_builder` dùng đường mới khi có span hợp lệ, GIỮ `locate_chunks` cho chế độ đệ quy — ở
  đó chunk LÀ chuỗi con thật của text thô nên tìm chuỗi vẫn đúng.
- **Vì sao hướng này đúng:** `chunk_markdown_spans` đã bảo đảm `doc_text[start:end] == text`,
  nên thông tin luôn có sẵn. Harness cũ vứt nó đi rồi đi tìm lại bằng chuỗi trong MỘT HỆ TOẠ ĐỘ
  KHÁC. Giờ chỉ căn hai văn bản một lần mỗi tài liệu rồi quy đổi.
- **Kết quả đo được:** R1_structure từ **1/142** lên **141/142** chunk có toạ độ canonical
  (`span_projection` 141, `unresolved` 1). qrel R1 sinh ra **91**, bằng R0.
- **Chi phí:** căn văn bản tốn 32.9s cho tài liệu lớn nhất (48k ký tự md ↔ 41.6k canonical,
  5317 opcode, 81.4% giống), dưới 1s cho hai tài liệu còn lại. Một lần lúc dựng index.
- **Đánh dấu provenance:** chunk chiếu bằng span mang `canonical_alignment: "span_projection"`,
  phân biệt được với `exact_normalized` của đường tìm chuỗi. Không trộn hai cách trong dữ liệu.
- **Verify:** `BE/tests/test_evidence_span_projection.py` 12 passed — gồm một ca dựng đúng tình
  huống thật: cùng dữ liệu thì `locate_chunks` trả `unresolved` còn `locate_chunks_by_spans`
  chiếu được, và hai hàm trả CÙNG bộ khoá (builder ghi chung một chỗ).
- **Lưu ý:** R0 cũng có 4/171 chunk `unresolved` (chunk có khối code, ví dụ `RAGAS Code Setup — Quick
  Start\nfrom ragas import evaluate...`). Ít nhưng không phải không có.

## (CHẶN — PHÁT HIỆN LỚN) Late chunking mean-pool trong khi bge-m3 dùng CLS — không gian vector sụp, E1–E7 vô hiệu

- **Triệu chứng:** chạy ablation lần đầu ra kết quả khó tin — BM25 THUẦN thắng mọi thứ:
  | thí nghiệm | recall@6 | MRR | nDCG@6 |
  |---|---|---|---|
  | E0_bm25 | **0.8371** | 0.7467 | 0.7331 |
  | E1_faiss | 0.2286 | 0.1213 | 0.1460 |
  | E2_hybrid | 0.4686 | 0.3313 | 0.3638 |
  | E3_rerank | 0.6229 | 0.6080 | 0.5963 |
  (25 truy vấn có chunk vàng, index R2_late)
- **Nguyên nhân gốc — đo được, không suy đoán:**
  1. Độ tương đồng cosine TRONG cùng một tài liệu, cùng bộ 142 chunk, chỉ khác cách nhúng:
     | index | sim TB trong tài liệu | sim chéo tài liệu |
     |---|---|---|
     | R0_recursive (nhúng thường) | 0.53–0.68 | 0.447 |
     | R1_structure (nhúng thường) | 0.53–0.64 | 0.470 |
     | **R2_late (late chunking)** | **0.967–0.995** | **0.805** |
     Hai chunk CẠNH NHAU trong R2 giống nhau tới **0.9999**. Không gian vector SỤP — FAISS không
     phân biệt nổi chunk nào với chunk nào, kể cả giữa các tài liệu khác nhau.
  2. `~/.cache/huggingface/.../bge-m3/1_Pooling/config.json` ghi rõ:
     `"pooling_mode_cls_token": true`, `"pooling_mode_mean_tokens": false`.
     bge-m3 sinh vector câu từ token **CLS**. Còn `late_chunk.embed_document` **mean-pool
     `last_hidden_state`**. Đó là HAI KHÔNG GIAN KHÁC NHAU.
  3. Hệ quả: vector TÀI LIỆU (mean-pool, dị hướng) và vector TRUY VẤN (CLS, chuẩn hoá qua
     sentence-transformers) không so sánh được. Truy hồi dense đang đo nhiễu.
- **KHÔNG phải do cắt cửa sổ:** có cảnh báo `14550 > 8192` lúc dựng, nhưng
  `accumulate_token_embeddings` có cửa sổ trượt + overlap nên xử lý đúng. Và tài liệu NHỎ NHẤT
  (4722 ký tự ≈ 1500 token, dưới xa 8192) vẫn sụp 0.995.
- **Mức lan: TOÀN BỘ THANG.** Cả 8 config E0–E7 đều `index_dir: R2_late`. Nên E1–E7 đo trên một
  nền hỏng. E0 không dính vì BM25 thuần từ vựng — và đó CHÍNH LÀ lý do nó "thắng".
  **Kết luận "BM25 thắng dense retrieval" là SAI.** Sự thật là dense retrieval đang hỏng.
- **Đã suýt mất 15 giờ:** thang đang chạy tiếp E4–E7 (NLI 298 giây/truy vấn) thì dừng lại kiểm.
  Chạy hết sẽ cho một kết luận luận văn hoàn toàn sai.
- **Ba đường, cần người quyết:**
  - (a) Chạy thang E trên `R1_structure` (nhúng thường, cùng chunk với R2) — số hợp lệ ngay, và
    trục R0/R1/R2 vốn là trục riêng.
  - (b) Sửa late chunking cho khớp không gian: hoặc pool tài liệu bằng CLS theo từng span (khó —
    CLS là một token cho cả chuỗi), hoặc nhúng TRUY VẤN cũng bằng mean-pool (nhất quán nội bộ
    nhưng lệch đường production), hoặc đổi sang model có pooling mặc định là mean (họ e5).
  - (c) Giữ nguyên và báo cáo "late chunking làm sụp không gian vector" như một kết quả âm — nó LÀ
    một phát hiện thật, miễn là nói rõ nguyên nhân là lệch pooling chứ không phải late chunking
    về nguyên lý.

## (ĐÃ SỬA 2026-08-25) `aggregate` chết vì một run dở dang — bảng kết quả THIẾU SỐ mà không báo gì

- **Triệu chứng:** bảng đối chiếu R1/R2 hiện `n=0` cho `E2_hybrid_R1` và `E3_rerank_R1`, dù cả hai
  đã chạy xong và có đủ 30 dòng `per_query.jsonl`. `E1_faiss_R1` chỉ có 23/30 dòng.
- **Nguyên nhân:** `aggregate()` duyệt `runs/*` và gọi thẳng `load_jsonl(run_dir / "retrieval.jsonl")`.
  Một thí nghiệm bị DỪNG TAY (E4 lúc dừng thang) để lại thư mục có `manifest.json` nhưng chưa kịp
  ghi `retrieval.jsonl`/`qa.jsonl`. Hàm ném `FileNotFoundError` và dừng hẳn — kéo theo MỌI run xếp
  sau nó (theo `sorted()`) không được gộp.
- **Vì sao đây là lỗi nguy hiểm nhất trong cả đợt:** nó không làm chương trình chết trước mắt người
  đọc — nó làm **bảng kết quả thiếu số một cách im lặng**. Số cụt trông y hệt số thật. Tao đã đọc
  bảng thiếu và báo cáo nó như bảng đầy đủ. Chỉ tình cờ thấy `n=0` mới lần ra.
- **Cách xử lý:** kiểm `retrieval.jsonl`/`qa.jsonl` có tồn tại trước khi đọc; thiếu thì bỏ qua run
  đó VÀ IN RA: `[aggregate] BỎ QUA 1 run dở dang: 75793f7f94d0 (thiếu retrieval.jsonl, qa.jsonl)`.
- **Prevention:** công cụ gộp số liệu KHÔNG được dừng vì một mục hỏng — nhưng cũng không được bỏ
  qua im lặng. Hai nửa đều bắt buộc: bỏ qua để phần còn lại dùng được, và kêu ra để người đọc biết
  bảng không đầy đủ. Dừng-tay giữa chừng là chuyện bình thường khi chạy thí nghiệm dài.
- **Verify:** `BE/tests/test_aggregate_partial_runs.py` 6 passed — gồm ca run dở dang nằm GIỮA (đúng
  thứ tự `sorted()` gây lỗi thật), ca nằm đầu, ca thiếu một trong hai file, và ca khẳng định có in
  cảnh báo.
- **Số liệu ĐÚNG sau khi sửa (25 truy vấn có chunk vàng):**
  | nấc | R2_late recall/MRR/nDCG | R1_structure recall/MRR/nDCG |
  |---|---|---|
  | E0 bm25 | 0.8371 / 0.7467 / 0.7331 | 0.8371 / 0.7467 / 0.7331 |
  | E1 faiss | 0.2286 / 0.1213 / 0.1460 | 0.6971 / 0.6727 / 0.6379 |
  | E2 hybrid | 0.4686 / 0.3313 / 0.3638 | 0.7829 / 0.8213 / 0.7654 |
  | E3 rerank | 0.6229 / 0.6080 / 0.5963 | **0.9029 / 0.9200 / 0.8917** |
  Trên nền nhúng ĐÚNG, thang tăng đơn điệu như thiết kế và rerank vượt BM25 thuần 6.6 điểm recall.
  Trên nền hỏng, thang đi xuống rồi bò lên và BM25 "thắng" — kết luận ngược hoàn toàn.

## (ĐÃ SỬA 2026-08-25) Pooler transaction 6543 + psycopg3 → `DuplicatePreparedStatement`

- **Triệu chứng:** `sqlalchemy.exc.ProgrammingError: (psycopg.errors.DuplicatePreparedStatement)
  prepared statement "_pg3_0" already exists`. Test đậu khi chạy RIÊNG, rớt khi chạy CHUNG với test
  khác — dấu hiệu kinh điển của trạng thái phía server bị chia sẻ.
- **Nguyên nhân:** Supavisor ở chế độ TRANSACTION (cổng 6543) tái dùng connection backend giữa các
  client. psycopg3 tự chuyển sang prepared statement phía server sau vài lần lặp cùng một câu lệnh,
  và tên `_pg3_N` đụng nhau giữa các client dùng chung backend.
- **Vì sao nguy hiểm:** lỗi chỉ nổ khi CÙNG một câu lệnh chạy đủ nhiều lần, tức là khi tải tăng.
  Smoke test một vài request sẽ qua sạch, rồi chết ở môi trường thật. Và `.env.example` của chính
  dự án khuyến nghị 6543 cho runtime.
- **Cách xử lý:** `app/db/__init__.py` truyền `connect_args={"prepare_threshold": None}` khi DSN có
  `:6543/`. Chỉ cho cổng đó — session pooler (5432) và kết nối trực tiếp giữ một connection riêng
  cho mỗi client nên không đụng, và giữ được lợi ích của prepared statement.
- **Prevention:** dùng pooler transaction-mode với psycopg3 thì PHẢI tắt prepared statement. Đây là
  ràng buộc của Supavisor/PgBouncer, không phải tuỳ chọn hiệu năng.
- **Verify:** `pytest tests/test_ingest_temp_cleanup.py tests/test_documents_api.py` — trước khi sửa
  2 failed, sau khi sửa 19 passed. Bộ rộng hơn (upload + documents + delete + schema): 42 passed.

## (GHI NHỚ) Đường tới Supabase đổi hai lần trong một ngày — pooler rồi trực tiếp rồi lại pooler

- **Sáng:** pooler `aws-0` trả `{:error, :nxdomain}` ở cả 5432 lẫn 6543 → tạm chuyển sang kết nối
  trực tiếp `db.<ref>.supabase.co:5432`, chạy được.
- **Chiều:** kết nối trực tiếp CHẾT — `ping -6` mất 100% gói. Đường trực tiếp của Supabase chỉ có
  **IPv6**, và IPv6 trên máy này mất. Cùng lúc đó pooler đã sống lại.
- **Đã chuyển về pooler** `aws-0-ap-northeast-2.pooler.supabase.com:6543`, kèm bản sửa
  `prepare_threshold` ở trên.
- **Hai điều cần nhớ khi dò lại:**
  1. Pooler cần username dạng `postgres.<project_ref>`; kết nối trực tiếp dùng `postgres` trơn.
     Đưa nhầm dạng nào cũng cho lỗi gây hiểu lầm: `ENOIDENTIFIER: no tenant identifier provided`
     (đưa user trơn cho pooler) hoặc `ENOTFOUND: tenant/user not found` (đưa nhầm vùng).
     Tao đã tưởng Supabase hỏng vì đúng lỗi này, thực ra là probe của mình sai.
  2. Kết nối trực tiếp phụ thuộc IPv6 → **không dùng được trên Render** và không bền ở mạng gia
     đình. Pooler có IPv4, bền hơn cho cả hai.

## (ĐÃ SỬA 2026-08-26) Trung bình gộp cả truy vấn KHÔNG có nhãn vàng — mọi chỉ số truy hồi bị hạ ~14 điểm phần trăm

- **Triệu chứng:** `aggregate_metrics.json` của mọi run báo recall thấp hơn con số tính
  tay. Cụ thể `E0_bm25_R1`: file ghi **0.6976**, tính lại đúng ra **0.8371**. Không có
  lỗi, không có cảnh báo — chỉ là một con số nhỏ hơn sự thật.
- **Root cause:** `retrieval_metrics(ranked, relevant_ids, k)` trả `recall = 0.0` khi
  `relevant_ids` rỗng, và `runner.py` gộp thẳng 30/30 hàng vào trung bình. Bộ dữ liệu
  cố ý cài 5 câu (**V11–V15**) KHÔNG trả lời được: `gold_status` là
  `insufficient_evidence` (V11, V12, V13, V15) hoặc `ambiguous` (V14). Tài liệu không
  chứa đáp án, hành vi đúng là từ chối, nên không có chunk vàng để gán. Năm số 0 đó là
  **đo sai thước** — chấm điểm truy hồi cho câu không có gì để truy hồi.
- **Fix:** `retrieval_metrics` trả thêm `n_relevant`; `runner.py` chỉ trung bình trên
  hàng `n_relevant > 0` và ghi kèm `n_queries` / `n_scored` / `n_no_gold` /
  `no_gold_query_ids` để việc loại trừ **nhìn thấy được**, không phải quy ước ngầm.
  Run cũ không phải chạy lại: `BE/scripts/tinh_lai_aggregate.py` bù cột `n_relevant`
  vào `retrieval.jsonl` rồi tính lại file gộp (14 run, khớp từng chữ số với bảng trong
  `docs/KET_QUA_THUC_NGHIEM.md`).
- **Còn thiếu:** 5 câu này cần thước riêng — **tỷ lệ từ chối** — chứ không phải bị bỏ
  im lặng. Chưa đo (xem `docs/KET_QUA_THUC_NGHIEM.md`).
- **Prevention:** chỉ số truy hồi phải đi kèm **mẫu số**. Một `mean` trần trụi không nói
  được nó trung bình trên bao nhiêu câu và bỏ câu nào — và cái bị bỏ thầm lặng luôn là
  cái làm sai kết luận. Đã có test: `tests/test_evaluation_harness.py` chốt
  `n_relevant == 0` cho truy vấn không nhãn.

## (GHI NHỚ 2026-08-26) `temperature=0` + `seed` KHÔNG đủ để Ollama tất định

Bộ chấm `evaluation/judge.py` đặt `temperature: 0` và `seed` cố định. Chấm lại cùng một
run hai lần liên tiếp ra **giống hệt 50/50 điểm**. Nhưng giữa hai lần chạy cách nhau
(máy đã dùng GPU cho việc khác giữa chừng) thì **1/50 điểm đổi** — `faithfulness` trung
bình 1.720 xuống 1.680.

Nguyên nhân: Ollama quyết định số layer đẩy lên GPU **lúc nạp model**, theo VRAM còn
trống tại thời điểm đó. Phân bổ layer khác nhau thì thứ tự cộng dồn dấu phẩy động trong
llama.cpp khác nhau, và ở một câu sát ngưỡng quyết định thì logit lật.

Hệ quả khi báo cáo số: nói "tái lập được" thì phải nói kèm **cùng một lần nạp model**.
Muốn chặt hơn thì `ollama stop <model>` trước khi chạy và đừng dùng GPU cho việc khác
trong lúc chấm — vẫn không đảm bảo tuyệt đối.

Không sửa được từ phía mình. Ghi lại để đừng mất thời gian đi tìm bug trong code chấm.

## (ĐÃ SỬA 2026-08-26) Sơ đồ tư duy ra 4 node khung xương sau 9 phút — hai lỗi chồng nhau

- **Triệu chứng:** Bấm tạo sơ đồ, đợi 9 phút, job báo **`done`** nhưng sơ đồ chỉ có
  root + 3 section, không ý nào, không quan hệ nào. Không có lỗi đỏ ở đâu cả.

- **Root cause 1 — model không vừa VRAM.** `BE/.env` đặt `MINDMAP_MODEL=qwen2.5:14b`
  (9.95 GB) trong khi GPU chỉ 6 GiB: Ollama giữ được 4.07 GB, phần còn lại rơi xuống
  CPU, tốc độ tụt còn **2.6 tok/s**. Mỗi nhánh enrich xin JSON ~5 ý × 3 chi tiết
  (800–1500 token) nên cần 300–580 giây, chạm `MINDMAP_LLM_TIMEOUT_SEC=300` và rơi về
  skeleton. Đáng chú ý: `.env` ở gốc repo vốn ghi `qwen2.5:7b-instruct` — `BE/.env`
  trôi khỏi nó lúc nào không rõ, và `BE/.env` được nạp ĐÈ lên.

- **Root cause 2 — hai cấu hình song song đá nhau.** `MINDMAP_ENRICH_PARALLEL` mặc
  định **2**, còn cổng LLM in-process `MAX_CONCURRENT_LLM_CALLS` là **1**. Nhánh thứ
  hai không chạy nhanh hơn, nó XẾP HÀNG; chờ quá `LLM_QUEUE_WAIT_TIMEOUT_SECONDS`
  (180s) thì ném `LLM busy (in-process): all 1 slots in use, waited 180.0s`. Đo thật:
  cả 3 nhánh **và** bước quan hệ đều chết đúng kiểu đó.

  Lỗi này **lúc được lúc không**, nên rất khó bắt: chạy enrich riêng lẻ, nhánh 2 chờ
  **179 giây** rồi lọt — sát mép 180 giây đúng 1 giây. Máy bận hơn một chút là hỏng.

- **Vì sao job vẫn báo `done`:** enrich nuốt lỗi từng nhánh và chỉ bật cờ `degraded`;
  graph vẫn ghi bản ghi và đóng job thành công. "Xong" ở đây nghĩa là "chạy hết
  đường", không phải "ra được sơ đồ".

- **Fix:**
  1. `MINDMAP_MODEL=qwen2.5:7b-instruct` (4.68 GB, vừa VRAM, 27 tok/s) ở cả `.env`,
     `BE/.env` và hai file `.env.example`.
  2. `LocalMindmapPipeline._enrich_parallel()` **kẹp** số nhánh song song theo
     `llm_factory.inproc_slots()`. Lấy trần từ chính cổng LLM thay vì bắt hai biến
     env khớp tay — chỉnh một chỗ là đủ, không cấu hình nào tự mâu thuẫn được nữa.
  3. Enrich báo progress NGAY khi nhánh đầu bắt đầu (trước đó im 166 giây, FE hiện
     chip đứng yên và người dùng đọc là treo).

- **Prevention:** cấu hình song song KHÔNG được đoán — phải hỏi tầng đang giới hạn.
  Và khi một `.env` con đè `.env` cha, giá trị thật phải in ra lúc khởi động, nếu
  không thì hai file lệch nhau âm thầm hàng tháng.

## (ĐÃ SỬA 2026-08-26) 14 biến `MINDMAP_*` trong `.env` không có dòng code nào đọc

`MINDMAP_TIMEOUT_SEC`, `MINDMAP_MODEL_FAST/BALANCED/QUALITY/FALLBACK`,
`MINDMAP_SCHEMA_STRICT`, `MINDMAP_MAX_NODES`, `MINDMAP_JOB_TTL_MINUTES`,
`MINDMAP_LLM_TIMEOUT_FAST/BALANCED/QUALITY`, `MINDMAP_JOB_TIMEOUT_FAST/BALANCED/QUALITY`
— grep toàn bộ `app/`, `services/`, `shared/` ra **rỗng**.

Chỉ 4 biến sống: `MINDMAP_MODEL` (`services/mindmap/pipeline/modelcfg.py`),
`MINDMAP_LLM_TIMEOUT_SEC` và `MINDMAP_ENRICH_PARALLEL` (`app/clients/mindmap_factory.py`),
`MINDMAP_SERVICE_ADDR` (`shared/config.py`).

Nguy hiểm ở chỗ chúng trông rất hợp lý. Ai gặp sơ đồ chạy chậm sẽ mở `.env`, thấy
`MINDMAP_TIMEOUT_SEC=240` và `MINDMAP_MODEL_QUALITY`, chỉnh hai cái đó, rồi kết luận
"chỉnh rồi mà vẫn chậm" — trong khi chưa hề chạm vào biến thật.

Đã gỡ hết khỏi `.env` và `.env.example`, thay bằng một khối chú thích liệt kê đúng
4 biến sống kèm file đọc chúng.
