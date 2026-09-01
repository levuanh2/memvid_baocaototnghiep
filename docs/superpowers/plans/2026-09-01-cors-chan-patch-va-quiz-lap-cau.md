# CORS chặn PATCH/PUT, và quiz lặp câu ở vòng bù

> **Cho người thực thi:** dùng `superpowers:executing-plans`. Mỗi bước có checkbox.

**Mục tiêu:** chọn đáp án thì lưu được; và khi ngữ liệu không đủ để ra N câu thì nói
thật thay vì trả về 2 câu kèm một lời giải thích bịa.

**Nguồn:** log BE `bsad5hl2x` (01/09 21:39) + `ai_validation_logs` job `e31ace34`.

## Bằng chứng

```
# BE log — 4 lần preflight, 0 lần request thật
OPTIONS /api/attempts/<id>/answers  200   x4
PATCH   /api/attempts/<id>/answers        x0
```

```python
# BE/app/main.py:130
CORS(app, resources={r"/*": {"origins": _cors_origins}},
     methods=["GET", "POST", "DELETE", "OPTIONS"],     # <- thiếu PATCH và PUT
     allow_headers=["Content-Type", "Authorization"])
```

```
# ai_validation_logs job e31ace34 (kept=2 rejected=14)
FR-13.7  Trùng câu hỏi đã nhận   12 câu
FR-13.2  Đáp án không khớp lựa chọn nào   2 câu
```

```
quiz_bu_cau job_id=e31ace34 co=2 thieu=8
quiz_bu_cau_xong tong=2          <- vòng bù thêm được 0 câu
```

## Ràng buộc chung

- Không nới CORS rộng hơn mức cần: chỉ thêm đúng hai method đang bị chặn.
- Không hạ ngưỡng kiểm chất lượng để "ra đủ số câu" — 2 câu đúng vẫn hơn 10 câu rác.
- Mốc phải giữ: BE 1015+ passed, FE 230 passed, lint 70.

---

### Task 1: CORS cho phép PATCH và PUT

**Vấn đề:** preflight trả 200 nhưng `Access-Control-Allow-Methods` không có `PATCH`, nên
trình duyệt **chặn request thật trước khi gửi**. `fetch` ném `TypeError`, và
`moTaLoi` dịch thành "Không kết nối được máy chủ" — thông báo đúng theo thứ nó thấy,
nhưng máy chủ vẫn sống nguyên.

Hai route bị chặn hoàn toàn qua trình duyệt:

| route | tính năng | hậu quả |
|---|---|---|
| `PATCH /api/attempts/<id>/answers` | lưu nháp đáp án | **mọi lần chọn đáp án đều hỏng** |
| `PUT /mindmaps/<id>` | lưu mindmap đã sửa | nút Lưu không bao giờ tới được BE |

**Ghi nhận thẳng:** hôm nay tôi vừa "xác minh" mindmap-ux-v3 Task 8 là ĐÃ LÀM bằng cách
kiểm route có tồn tại (`main.py:4616`). Route có thật, nhưng trình duyệt chưa bao giờ gọi
được nó. Kiểm sự tồn tại của file/route KHÔNG phải là kiểm hành vi.

**Files:**
- Modify: `BE/app/main.py` (khối `CORS(...)`)
- Test: `BE/tests/test_cors_methods.py` (tạo mới)

- [ ] **Bước 1: viết test đỏ**

```python
"""Preflight phải cho phép đúng những method mà route thật sự dùng."""
import pytest

CAN_CO = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]


@pytest.mark.parametrize("method", ["PATCH", "PUT"])
def test_preflight_cho_phep_method_route_dang_dung(client, method):
    r = client.options("/api/attempts/x/answers", headers={
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": method,
    })
    cho_phep = r.headers.get("Access-Control-Allow-Methods", "")
    assert method in cho_phep, f"{method} bị chặn: {cho_phep!r}"


def test_moi_method_route_dung_deu_nam_trong_cors():
    """Khoá hợp đồng: thêm route PATCH/PUT mới mà quên CORS là chặn nó ở trình duyệt."""
    import app.main as be
    import re
    src = open(be.__file__, encoding="utf-8").read()
    dung = set(re.findall(r'@app\.(get|post|put|patch|delete)\(', src))
    dung |= {m.lower() for m in re.findall(r'methods=\["([A-Z]+)"\]', src)}
    thieu = [m.upper() for m in dung if m.upper() not in CAN_CO]
    assert not thieu, f"route dùng method chưa khai trong CORS: {thieu}"
```

- [ ] **Bước 2: chạy, phải đỏ** — `Access-Control-Allow-Methods` không chứa PATCH

- [ ] **Bước 3: sửa `main.py`**

```python
CORS(
    app,
    resources={r"/*": {"origins": _cors_origins}},
    # PATCH và PUT thiếu ở đây cho tới 2026-09-01. Preflight vẫn trả 200 nên nhìn log
    # BE thì thấy "OPTIONS ... 200" và tưởng ổn — nhưng trình duyệt chặn request THẬT
    # trước khi gửi, và `fetch` ném TypeError. Đo được: 4 OPTIONS, 0 PATCH.
    # PATCH = lưu nháp đáp án; PUT = lưu mindmap đã sửa.
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
```

- [ ] **Bước 4: chạy test, phải xanh**

- [ ] **Bước 5: khởi động lại BE rồi xác minh trên log THẬT**

```
# chọn một đáp án trong quiz, rồi:
grep -c "PATCH /api/attempts/.*answers" <log BE>    # phải > 0
```

- [ ] **Bước 6: commit**

---

### Task 2: Vòng bù đang xin thêm câu rồi nhận lại đúng câu cũ

**Vấn đề:** `co=2 thieu=8` → xin thêm 8 câu, nhận về 12 câu **trùng** (FR-13.7), thêm
được **0**. Vòng bù (V8-3) đang tốn một lượt gọi model ~1 phút cho không.

**Nguyên nhân cần phân biệt trước khi sửa** — chưa đo được cái nào đúng:
- (a) `temperature=0.2` quá thấp: model lặp lại chính nó khi được hỏi lại cùng ngữ liệu.
- (b) Ngữ liệu thật sự không đủ để ra 10 câu khác nhau (tài liệu ngắn / phạm vi hẹp).

Hai cái này đòi hai cách xử lý ngược nhau, nên **phải đo trước**.

**Files:**
- Modify: `BE/app/domains/quiz/generator.py`
- Modify: `BE/app/main.py` (vòng bù)
- Test: `BE/tests/test_quiz_prompt_va_bu_cau.py`

- [ ] **Bước 1: đo — chạy lại đúng ngữ liệu đó với hai nhiệt độ**

Script tạm trong scratchpad: gọi `generate_questions` hai lần với `temperature` 0.2 và
0.8 trên cùng context, đếm số câu hỏi **khác nhau** thu được. Nếu 0.8 cho nhiều câu phân
biệt hơn hẳn → nguyên nhân (a). Nếu cả hai đều lặp → nguyên nhân (b).

- [ ] **Bước 2 (nếu là (a)): vòng bù dùng nhiệt độ cao hơn**

```python
# generator.generate_questions
options={"temperature": 0.2 if not da_co else 0.7, ...}
```
kèm test khoá: lượt bù truyền temperature khác lượt đầu.

- [ ] **Bước 3 (dù là (a) hay (b)): nói thật khi ngữ liệu không đủ**

`ly_do_loai` đã có `RULE_DUPLICATE` → "câu hỏi trùng với câu đã nhận". Khi FR-13.7 chiếm
đa số, câu đó nên nói rõ hơn cho người học biết phải làm gì:

```python
RULE_DUPLICATE: ("model ra lại cùng một câu hỏi — ngữ liệu trong phạm vi đã chọn "
                 "có thể không đủ để ra bằng đó câu; thử chọn thêm mục hoặc giảm số câu"),
```

Đây là câu ĐO ĐƯỢC (đếm từ `rule_code`), khác hẳn câu đoán "đoạn tài liệu quá ngắn" đã gỡ.

- [ ] **Bước 4: chạy test quiz + commit**

---

### Task 3: Bản sửa phải tới được người dùng

**Vấn đề:** người dùng vẫn thấy câu cũ *"thường là do đoạn tài liệu tương ứng quá ngắn"*
dù nó đã bị gỡ ở commit `09fe11b`. Hai lý do chồng nhau:

1. **BE đang chạy mã cũ.** Tiến trình `bsad5hl2x` khởi động lúc ~20:14, commit `09fe11b`
   xong sau đó → BE không gửi `rejected_reason`, và prompt siết `chunk_refs` cũng chưa
   có hiệu lực trong lần chạy 2/10.
2. **Tab trình duyệt giữ bundle cũ.** Vite HMR không phải lúc nào cũng thay được component
   đang mounted; trang mở từ trước vẫn chạy mã cũ.

- [ ] **Bước 1: khởi động lại BE, xác nhận mã mới**

```
grep -c "rejected_reason" <log khởi động>   # hoặc tạo quiz rồi xem result JSON
```

- [ ] **Bước 2: tải lại cứng trang FE** (Ctrl+Shift+R)

- [ ] **Bước 3: tạo quiz lần nữa, đọc số**

Kỳ vọng: dòng thông báo nói nguyên nhân đo được (không còn chữ "quá ngắn"), và
`quiz_bu_cau` trong log cho biết vòng bù có thêm được câu nào không.

---

## Thứ tự

Task 1 trước — nó đang làm hỏng **mọi** lần chọn đáp án, và là lỗi mất dữ liệu người dùng
(may là bản vá `soNhap` ở vòng 8 giữ lại đáp án trong bộ nhớ nên chưa mất thật).
Task 3 ngay sau (khởi động lại BE là điều kiện để đo Task 2).
Task 2 cuối, và **phải đo trước khi sửa**.
