# Đề không trả lời được, và trang kết quả

> **Cho người thực thi:** dùng `superpowers:executing-plans`. Mỗi bước có checkbox.

**Mục tiêu:** không còn câu hỏi mà bốn lựa chọn gần như y hệt nhau; và trang kết quả nói
đúng thứ người học cần biết sau khi làm bài.

**Nguồn:** attempt `01597551-7868-481a-8eff-1c1dd01b1689` do người dùng gửi, tra thẳng DB.

## Bằng chứng — kết quả KHÔNG sai, ĐỀ sai

```
status: graded · score 0.0/2.0 = 0.0% · đúng 0 / sai 2

--- multiple_choice · "RAG là gì?"
  opts : ['Retrieval-Augmented Generation là …',
          'RAG là một kỹ thuật sử dụng LLM để…',
          'RAG là một kỹ thuật sử dụng LLM để…',
          'RAG là một kỹ thuật sử dụng LLM để…']    <- 3/4 mở đầu y hệt

--- multiple_choice · "RAG có thể giúp giải quyết những vấn đề gì?"
  opts : ['RAG có thể giúp giải quyết những v…',
          'RAG có thể giúp giải quyết những v…',
          'RAG có thể giúp giải quyết những v…',
          'RAG có thể giúp giải quyết những v…']    <- CẢ BỐN y hệt
  ĐÚNG : '…liên quan đến dữ liệu'
  CHỌN : '…liên quan đến kiến thức'
```

Tầng chấm làm đúng: chuỗi người chọn khác chuỗi đáp án. Nhưng **câu hỏi không trả lời
được một cách công bằng** — bốn lựa chọn chỉ khác nhau vài từ ở đuôi, và người học phải
đoán chứ không phải hiểu.

Đây đúng là thứ người dùng báo từ đầu phiên (*"đáp án có trùng A B C D thì có thêm C hoặc
D"*). Luật V8-1 thêm hôm qua **chỉ bắt trùng KHÍT** (so bằng `norm_text`), nên cặp
gần-trùng lọt qua. Sửa nửa vời còn nguy hơn không sửa: nó tạo cảm giác đã xong.

## Ràng buộc chung

- Không hạ ngưỡng để "ra đủ số câu". Đề không trả lời được thì **loại**, thà 2 câu tốt.
- Không đổi palette/font. Bản sắc đang có: con dấu son `rgb(178 58 46)`, `Spectral` cho
  phần đọc, `.coord` mono cho nhãn kỹ thuật, ẩn dụ phòng đọc.
- Mốc: BE 1015+ passed, FE 234 passed, lint 70.

---

### Task 1 (CHẶN): loại câu có lựa chọn gần-trùng nhau

**Phải làm trước Task 2.** Một trang kết quả đẹp hiển thị một điểm số vô nghĩa thì tệ hơn
trang xấu hiển thị điểm đúng.

**Files:**
- Modify: `BE/app/domains/ai_validation/rules.py`
- Test: `BE/tests/test_quiz_lua_chon_trung.py` (mở rộng)

- [ ] **Bước 1: viết test đỏ, dùng ĐÚNG dữ liệu thật ở trên**

```python
def test_loai_cau_co_bon_lua_chon_gan_nhu_y_het():
    """Dữ liệu thật, attempt 01597551: cả 4 lựa chọn khác nhau vài từ ở đuôi."""
    q = {**BASE, "options": [
        "RAG có thể giúp giải quyết những vấn đề liên quan đến dữ liệu nội bộ",
        "RAG có thể giúp giải quyết những vấn đề liên quan đến kiến thức mới",
        "RAG có thể giúp giải quyết những vấn đề liên quan đến ngữ cảnh dài",
        "RAG có thể giúp giải quyết những vấn đề liên quan đến chi phí suy luận",
    ], "correct_answer": "RAG có thể giúp giải quyết những vấn đề liên quan đến dữ liệu nội bộ"}
    ok, bad = rules.validate_questions([q], allowed_chunk_refs=["c0"])
    assert not ok, "câu này người học phải ĐOÁN, không phải hiểu"
    assert bad[0]["rule_code"] == rules.RULE_JSON


def test_giu_cau_co_lua_chon_khac_nhau_that():
    q = {**BASE, "options": ["2x", "x", "x^2", "1"], "correct_answer": "2x"}
    ok, bad = rules.validate_questions([q], allowed_chunk_refs=["c0"])
    assert ok and not bad


def test_lua_chon_dai_nhung_KHAC nhau thi giu():
    q = {**BASE, "options": [
        "Truy hồi đoạn văn liên quan rồi đưa vào ngữ cảnh trước khi sinh",
        "Tinh chỉnh trọng số mô hình trên tập dữ liệu riêng",
        "Nén tài liệu thành vector rồi bỏ bản gốc đi",
        "Chạy nhiều mô hình song song rồi lấy phiếu bầu",
    ], "correct_answer": "Truy hồi đoạn văn liên quan rồi đưa vào ngữ cảnh trước khi sinh"}
    ok, bad = rules.validate_questions([q], allowed_chunk_refs=["c0"])
    assert ok and not bad, "khác nhau thật thì dài cũng được"
```

- [ ] **Bước 2: chạy, phải đỏ** — hiện tại cả ba đều "hợp lệ"

- [ ] **Bước 3: thêm phép đo giống nhau vào `rules.py`**

Dùng Jaccard trên tập token (đã có `_norm`; không thêm phụ thuộc):

```python
RULE_LUA_CHON_MO_HO = RULE_JSON   # cùng nhóm "câu hỏi không dùng được"
NGUONG_GIONG_NHAU = 0.72          # xem chú thích bên dưới


def _giong_nhau(a: str, b: str) -> float:
    ta, tb = set(_norm(a).split()), set(_norm(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)
```

Trong nhánh `multiple_choice`, sau khi gộp trùng khít:

```python
            # Trùng KHÍT đã gộp ở trên. Còn lại là cặp GẦN trùng — bốn lựa chọn chỉ khác
            # nhau vài từ ở đuôi thì người học phải đoán chứ không phải hiểu, và điểm số
            # thu được không nói lên điều gì. Dữ liệu thật (attempt 01597551): cả 4 lựa
            # chọn mở đầu bằng đúng chín từ giống nhau.
            mo_ho = [(i, j) for i in range(len(options)) for j in range(i + 1, len(options))
                     if _giong_nhau(options[i], options[j]) >= NGUONG_GIONG_NHAU]
            if mo_ho:
                rejected.append(_reject(
                    RULE_JSON,
                    f"Các lựa chọn gần như trùng nhau ({len(mo_ho)} cặp) — câu hỏi không "
                    "trả lời được một cách công bằng.", raw, index))
                continue
```

**Ngưỡng 0.72 phải ĐO, không đoán.** Bước 4 làm việc đó.

- [ ] **Bước 4: hiệu chỉnh ngưỡng trên dữ liệu THẬT**

Script tạm: duyệt mọi câu multiple_choice đã lưu trong DB, tính `_giong_nhau` lớn nhất
giữa các cặp lựa chọn, in phân bố. Chọn ngưỡng nằm trong khoảng trống giữa "đề tốt" và
"đề mù mờ" — cùng cách đã làm cho `NGUONG_CANH_NHAU` của `suc_khoe_index`. Ghi con số đo
được vào chú thích cạnh hằng số.

- [ ] **Bước 5: cập nhật `ly_do_loai`** — thêm câu cho mã này để giao diện nói đúng
      nguyên nhân (*"model ra các lựa chọn gần như giống nhau"*), thay vì gộp chung vào
      "sai định dạng".

- [ ] **Bước 6: chạy `pytest tests/test_quiz_lua_chon_trung.py tests/test_quiz_generation.py` + `python -m app.domains.ai_validation.rules`**

- [ ] **Bước 7: commit**

---

### Task 2: trang kết quả — nói cho người học biết PHẢI LÀM GÌ TIẾP

Dùng skill `frontend-design` của dự án. Nguyên tắc bắt buộc: **nắn cái đang có, không
thay bản sắc**. Tra Mobbin để lấy *pattern*, không lấy *phong cách*.

**Chẩn đoán trang hiện tại** (`QuizResult.jsx`) — không phải nó xấu, mà là nó **xếp sai
thứ tự ưu tiên**:

1. `ScoreBoard` mở đầu bằng `SealMeter` + điểm thô + bốn ô Đúng/Sai/Số câu/Thời gian.
   Với bài 2 câu ra 0%, cả khối này nói đúng một điều: *bạn sai hết* — rồi dừng. Không có
   câu nào nói **vì sao** hay **làm gì tiếp**.
2. "Mức nắm theo chủ đề" nằm giữa, nhưng nó mới là thứ hành động được.
3. Nút "Xem phần cần ôn" nằm tận `actions` của header — chỗ mắt tìm sau cùng.
4. Khối "Từng câu" đổ hết ra, không lọc. Người học muốn xem **câu sai** trước tiên.

**Files:**
- Modify: `FE/src/pages/study/QuizResult.jsx`
- Modify: `FE/src/index.css` (nếu cần một lớp tiện ích)

- [ ] **2a. Đảo trật tự: việc-cần-làm lên trước, thống kê lùi xuống.**
      Ngay dưới điểm số, thêm một dòng dẫn: nếu có chủ đề yếu → *"Yếu nhất: <chủ đề> —
      đúng x/y"* kèm nút `btn-seal` "Ôn phần này". Nếu đúng hết → một câu ghi nhận rồi
      mời làm quiz khó hơn. Đây là **signature** của trang: kết quả là một *chỉ dẫn*,
      không phải một tấm bảng điểm.

- [ ] **2b. Bộ lọc "Câu sai / Tất cả" cho mục Từng câu**, mặc định **Câu sai**.
      Bài 20 câu đúng 18 thì cuộn qua 18 câu đúng để tìm 2 câu sai là việc vô ích.
      Dùng `pill-tab` đã có, không dựng thành phần mới.

- [ ] **2c. `ScoreBoard` gọn lại một hàng.** Giữ `SealMeter` (nó là con dấu — đúng ẩn dụ)
      nhưng bỏ ô "Số câu" (đã có trong "đúng x/y") và gộp Đúng/Sai thành `3/5`. Ít số hơn,
      dễ đọc hơn.

- [ ] **2d. Trạng thái 0 điểm phải nói được nguyên nhân.** Khi `percentage === 0` và mọi
      câu đều `incorrect`, thêm một dòng: nếu `rejected_by_rule` của quiz cho thấy đề có
      vấn đề thì nói ra; nếu không thì mời xem lại phần cần ôn. **Không** an ủi suông.

- [ ] **2e. build + vitest + eslint, so mốc 234/70; commit từng mục.**

---

## Thứ tự và lý do không thể đảo

Task 1 trước. Nếu làm Task 2 trước, ta sẽ có một trang kết quả trình bày rất tử tế một
điểm số **0% sinh ra từ một đề không trả lời được** — tức là đánh bóng một lời nói dối.

## Điều cố ý KHÔNG làm

- Không đổi cách chấm để "cứu" câu trả lời gần đúng. Chấm đang đúng; đề mới là chỗ sai.
- Không thêm animation ăn mừng / chúc mừng. Người học vừa sai hết hai câu.
