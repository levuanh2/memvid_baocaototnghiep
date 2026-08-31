# Audit vòng 8 — đường tạo quiz: đáp án trùng, thiếu câu, lỗi mạng nói tiếng Anh

> **Cho người thực thi:** dùng `superpowers:executing-plans`. Mỗi bước có checkbox.

**Trạng thái:** ĐÃ LÀM XONG 2026-09-01 — Task 1-5.

**Mục tiêu:** trắc nghiệm không còn hai lựa chọn giống nhau; xin 10 câu thì nhận 10 câu
hoặc được nói rõ thiếu bao nhiêu; lỗi mất kết nối hiện bằng tiếng Việt và nói được phải
làm gì.

**Cách tiếp cận:** sửa ở nơi mọi lời gọi đi qua — luật kiểm chất lượng (`rules.py`),
prompt hệ thống (`generator.py`), một vòng bù trong job, và một helper mô tả lỗi dùng
chung cho FE. Không vá riêng từng trang.

**Ngăn xếp:** Flask + SQLAlchemy + Ollama (gemma2:2b, CPU) / React 19 + Vite + Vitest.

**Nguồn:** log `bv25uw8td.output`, `b3bgckp47.output`; bảng `ai_validation_logs` (3 job
thật, 2026-08-30). Bằng chứng nguyên văn ở mục dưới.

## Ràng buộc chung

- Máy chỉ có **1 slot LLM** (`MAX_CONCURRENT_LLM_CALLS=1`), gemma2:2b ~30 tok/s trên
  CPU. Mỗi lượt gọi thêm là ~1 phút người dùng ngồi chờ. Tối đa **một** lượt bù.
- Ngân sách token đã cân ở vòng 7, không được phá:
  `12000 ký tự (~4400 tok) + chỉ dẫn (~300) + sinh ra (3000) < 8192 = num_ctx`.
- `QUESTION_TYPES` là hợp đồng với CHECK constraint của Postgres — không thêm dạng mới.
- Doctrine `.playbook`: thà nói thật là thiếu còn hơn im lặng trả ít.

---

## Bằng chứng

```
quiz_job_done job_id=7ae6eb87 kept=5 rejected=5   -> 5x FR-13.3 "Thiếu explanation"
quiz_job_done job_id=a16c1454 kept=2 rejected=8   -> 7x FR-13.1 "question_type
                                                    'short_answer' không nằm trong
                                                    dạng đã yêu cầu" + 1x FR-13.2
quiz_job_done job_id=f97dc5d6 kept=3 rejected=2   -> 2x FR-13.1 (short_answer)
```

Một câu bị loại của job a16c1454, nguyên văn từ `ai_validation_logs`:

```
type: true_false
opts: ['Không có hạn chế', 'Hạn chế về độ chính xác', 'Hạn chế về hiệu suất']
```

`true_false` mà ba lựa chọn — hình dạng output của model rất lỏng. Luật hiện tại không
soi mảng `options` của trắc nghiệm một dòng nào.

---

### Task 1: Lựa chọn trắc nghiệm phải phân biệt được

**Vấn đề:** `validate_questions` không có luật nào về mảng `options`. Model trả
`['A','B','C','C']` thì nhận nguyên xi — người học thấy C và D giống hệt nhau, và nếu
đáp án đúng là C thì câu đó không chấm công bằng được.

**Nguyên nhân gốc:** thiếu luật, không phải model tệ. Model yếu là điều kiện vận hành
đã biết (gemma2:2b, chọn ở vòng 7 để đổi lấy tốc độ); tầng luật sinh ra chính là để đỡ
cho nó.

**Files:**
- Modify: `BE/app/domains/ai_validation/rules.py` (nhánh `qtype == "multiple_choice"`)
- Test: `BE/tests/test_quiz_lua_chon_trung.py` (tạo mới)

**Interfaces:**
- Consumes: `rules.validate_questions(raw, allowed_chunk_refs=...)` — chữ ký không đổi.
- Produces: `options` trong câu đã nhận luôn phân biệt theo `shared.text_norm.norm_text`.

- [x] **Bước 1: viết test đỏ**

```python
from app.domains.ai_validation import rules

BASE = {
    "question_text": "Đạo hàm của x^2 là gì?",
    "question_type": "multiple_choice",
    "options": ["2x", "x", "x^2", "1"],
    "correct_answer": "2x",
    "explanation": "Quy tắc luỹ thừa.",
    "concept_tags": ["đạo hàm"],
    "chunk_refs": ["c0"],
}


def test_lua_chon_trung_bi_go_bot():
    ok, bad = rules.validate_questions(
        [{**BASE, "options": ["2x", "x", "x^2", "x^2"]}], allowed_chunk_refs=["c0"])
    assert not bad
    assert ok[0]["options"] == ["2x", "x", "x^2"], "lựa chọn trùng phải bị gộp"


def test_trung_chi_khac_dau_va_hoa_thuong_cung_la_trung():
    ok, _ = rules.validate_questions(
        [{**BASE, "options": ["2x", "X^2", "x^2", "1"]}], allowed_chunk_refs=["c0"])
    assert ok[0]["options"] == ["2x", "X^2", "1"], "giữ bản xuất hiện trước"


def test_go_trung_xong_con_mot_lua_chon_thi_loai_ca_cau():
    ok, bad = rules.validate_questions(
        [{**BASE, "options": ["2x", "2x", "2x", "2x"]}], allowed_chunk_refs=["c0"])
    assert not ok and bad[0]["rule_code"] == rules.RULE_JSON


def test_dap_an_dung_song_sot_sau_khi_go_trung():
    ok, _ = rules.validate_questions(
        [{**BASE, "options": ["x", "2x", "2x", "1"], "correct_answer": "2x"}],
        allowed_chunk_refs=["c0"])
    assert ok[0]["correct_answer"] in ok[0]["options"]
```

- [x] **Bước 2: chạy, phải đỏ**

Chạy: `./.venv/Scripts/python.exe -m pytest tests/test_quiz_lua_chon_trung.py -q`
Kỳ vọng: FAIL — hiện `options` trả về nguyên `['2x','x','x^2','x^2']`.

- [x] **Bước 3: sửa `rules.py` — thay khối `if len(options) < 2` cũ**

```python
        if qtype == "multiple_choice":
            # Gộp lựa chọn trùng TRƯỚC khi đếm: model yếu hay trả "C" hai lần, và hai
            # lựa chọn giống nhau thì câu hỏi không chấm công bằng được. Gộp chứ không
            # loại — câu vẫn dùng được với 3 lựa chọn phân biệt.
            deduped: List[str] = []
            for o in options:
                if not any(_norm(o) == _norm(k) for k in deduped):
                    deduped.append(o)
            options = deduped
            if len(options) < 2:
                rejected.append(_reject(
                    RULE_JSON, "multiple_choice cần ít nhất 2 lựa chọn phân biệt.",
                    raw, index))
                continue
```

- [x] **Bước 4: chạy lại, phải xanh**

```
./.venv/Scripts/python.exe -m pytest tests/test_quiz_lua_chon_trung.py tests/test_ai_validation.py -q
./.venv/Scripts/python.exe -m app.domains.ai_validation.rules
```

- [x] **Bước 5: commit**

---

### Task 2: Prompt hệ thống chỉ được dạy dạng câu hỏi đã cho phép

**Vấn đề:** người dùng chọn `[multiple_choice, true_false]`, model trả 7 câu
`short_answer`, cả 7 bị loại. Xin 10 nhận 2.

**Nguyên nhân gốc:** `_SYSTEM` là hằng số, **luôn** mô tả đủ ba dạng kèm định dạng riêng
cho `short_answer`. Cấu hình thật chỉ xuất hiện một dòng trong prompt người dùng. Model
2B ưu tiên system prompt. Tầng luật bắt đúng, nhưng bắt xong thì câu đã mất.

**Files:**
- Modify: `BE/app/domains/quiz/generator.py`
- Test: `BE/tests/test_quiz_prompt_dung_dang.py` (tạo mới)

**Interfaces:**
- Produces: `generator.build_system(allowed_types: Sequence[str]) -> str`.
- `generate_questions` gọi `build_system(config.get("question_types") or [])`.

- [x] **Bước 1: viết test đỏ**

```python
from app.domains.quiz import generator as gen


def test_system_prompt_khong_day_dang_khong_duoc_phep():
    s = gen.build_system(["multiple_choice", "true_false"])
    assert "short_answer" not in s
    assert "multiple_choice" in s and "true_false" in s


def test_chi_mot_dang_thi_chi_ta_mot_dang():
    s = gen.build_system(["true_false"])
    assert "multiple_choice" not in s and "short_answer" not in s


def test_dang_la_thi_quay_ve_du_ba_dang():
    s = gen.build_system([])
    for t in ("multiple_choice", "true_false", "short_answer"):
        assert t in s


def test_generate_questions_truyen_dung_dang_xuong_system():
    thay = {}

    def _ask(prompt, **kw):
        thay["system"] = kw["system_prompt"]
        return '{"questions": []}'

    gen.generate_questions("ngữ liệu", {"question_types": ["true_false"]}, ask=_ask)
    assert "short_answer" not in thay["system"]
```

- [x] **Bước 2: chạy, phải đỏ** (`module ... has no attribute 'build_system'`)

- [x] **Bước 3: sửa `generator.py`**

Tách phần tả dạng ra khỏi hằng số; `{{TYPES}}` là chỗ điền danh sách dạng vào khối JSON
mẫu:

```python
_TA_DANG = {
    "multiple_choice": "- multiple_choice: 4 lựa chọn KHÁC NHAU, `correct_answer` trùng nguyên văn một lựa chọn.",
    "true_false": '- true_false: `correct_answer` là "true" hoặc "false", không cần options.',
    "short_answer": "- short_answer: đáp án ngắn gọn 1-2 câu.",
}


def build_system(allowed_types: Sequence[str]) -> str:
    """System prompt chỉ tả những dạng ĐANG được phép.

    Hằng số cũ luôn tả đủ ba dạng: người dùng tắt short_answer mà model vẫn được dạy
    cách viết short_answer, rồi 7/10 câu bị tầng luật loại (log 2026-08-30, job
    a16c1454). Dạng nào không được phép thì không xuất hiện trong chỉ dẫn.
    """
    types = [t for t in (allowed_types or []) if t in _TA_DANG] or list(_TA_DANG)
    return (_SYSTEM_DAU.replace("{{TYPES}}", "|".join(types))
            + "\n".join(_TA_DANG[t] for t in types) + _SYSTEM_DUOI)
```

Trong `generate_questions`: `base = build_system(config.get("question_types") or [])`,
rồi `system = base if attempt == 1 else base + _RETRY_HINT`.

- [x] **Bước 4: chạy test + `./.venv/Scripts/python.exe -m app.domains.quiz.generator`**

- [x] **Bước 5: commit**

---

### Task 3: Xin N câu thì bù cho đủ N, hoặc nói rõ thiếu bao nhiêu

**Vấn đề:** `kept=5` khi xin 10. Sau khi lọc không có gì bù lại — `accepted[:count]`
chỉ cắt xuống, không bao giờ bù lên.

**Nguyên nhân gốc:** không có vòng bù. Task 2 chữa ca "sai dạng", nhưng ca "thiếu
explanation" (job 7ae6eb87, 5/10) thì model sẽ còn tái phạm — model 2B bỏ trường bắt
buộc là chuyện thường.

**Quyết định:** **một** lượt bù, không hơn. 1 slot LLM, lượt thứ hai đã tốn thêm ~1
phút. Bù xong vẫn thiếu thì trả đúng số có được và nói ra.

**Files:**
- Modify: `BE/app/domains/quiz/generator.py` (`build_prompt`, `generate_questions`)
- Modify: `BE/app/main.py` (`run_quiz_generation_job`)
- Test: `BE/tests/test_quiz_bu_cau_thieu.py` (tạo mới)

**Interfaces:**
- Produces: `build_prompt(context, config, *, da_co=None)`,
  `generate_questions(context, config, *, ask=None, timeout_sec=None, da_co=None)`.
- `result` của job thêm khoá `asked_count: int`.

- [x] **Bước 1: viết test đỏ**

```python
from app.domains.quiz import generator as gen


def test_prompt_bu_noi_ro_con_thieu_may_cau_va_da_co_gi():
    p = gen.build_prompt("ngữ liệu", {"question_count": 4},
                         da_co=["Đạo hàm x^2?", "Đạo hàm hằng số?"])
    assert "Số câu: 4" in p, "phải xin đúng phần còn thiếu"
    assert "Đạo hàm x^2?" in p, "phải liệt kê câu đã có để model khỏi lặp"


def test_khong_co_da_co_thi_prompt_nhu_cu():
    p = gen.build_prompt("ngữ liệu", {"question_count": 4})
    assert "Số câu: 4" in p and "Đã có sẵn" not in p


def test_generate_questions_chuyen_da_co_xuong_prompt():
    thay = {}

    def _ask(prompt, **kw):
        thay["prompt"] = prompt
        return '{"questions": []}'

    gen.generate_questions("ngữ liệu", {"question_count": 2},
                           ask=_ask, da_co=["Câu đã có?"])
    assert "Câu đã có?" in thay["prompt"]
```

- [x] **Bước 2: chạy, phải đỏ** (`unexpected keyword argument 'da_co'`)

- [x] **Bước 3: sửa `build_prompt`**

```python
def build_prompt(context: str, config: Dict[str, Any], *,
                 da_co: Optional[Sequence[str]] = None) -> str:
    types = ", ".join(config.get("question_types") or ["multiple_choice"])
    difficulty = config.get("difficulty") or "mixed"
    count = int(config.get("question_count") or 10)
    p = (
        f"Ngữ liệu:\n{context}\n\n"
        f"Cấu hình đề:\n"
        f"- Số câu: {count}\n"
        f"- Độ khó: {difficulty}\n"
        f"- Dạng câu hỏi được phép: {types}\n"
    )
    if da_co:
        # Lượt bù: liệt kê câu đã nhận, nếu không model ra lại y hệt rồi tầng luật loại
        # vì trùng (FR-13.7) — tốn một phút CPU cho không.
        ds = "\n".join(f"- {t}" for t in da_co)
        p += (f"\nĐã có sẵn {len(da_co)} câu dưới đây. Ra thêm {count} câu KHÁC HẲN, "
              f"không lặp ý:\n{ds}\n")
    return p
```

`generate_questions` nhận `da_co` và chuyển thẳng: `prompt = build_prompt(context, config, da_co=da_co)`.

- [x] **Bước 4: sửa `main.py`, ngay sau dòng `accepted = [q for q in accepted if q["chunk_ids"]][: config["question_count"]]`**

```python
        # Một lượt bù, không hơn: máy chỉ 1 slot LLM nên mỗi lượt là ~1 phút người dùng
        # ngồi chờ. Xin 10 nhận 5 (log 2026-08-30 job 7ae6eb87) là do model bỏ trường
        # bắt buộc rồi bị luật loại — không ép được model, nhưng hỏi lại phần thiếu thì
        # được.
        thieu = config["question_count"] - len(accepted)
        if thieu > 0 and not _cancelled():
            update_job(job_id, progress=80, current_node="BuSoCauThieu")
            print(f"quiz_bu_cau job_id={job_id} co={len(accepted)} thieu={thieu}", flush=True)
            them_raw, them_err, _ = _quiz_gen.generate_questions(
                context, {**config, "question_count": thieu},
                da_co=[q["question_text"] for q in accepted])
            if them_err:
                print(f"quiz_bu_cau_that_bai job_id={job_id} err={them_err[:80]}", flush=True)
            else:
                them_ok, them_bad = _rules.validate_questions(
                    them_raw, allowed_chunk_refs=ref_map.keys(),
                    allowed_section_ids=_quiz_repo.section_ids_of(document_id),
                    allowed_types=config["question_types"])
                _val_store.log_rejections(them_bad, job_id=log_job_id)
                rejected = rejected + them_bad
                da_co_norm = {_norm_text(q["question_text"]) for q in accepted}
                for q in them_ok:
                    if _norm_text(q["question_text"]) in da_co_norm:
                        continue
                    q["chunk_ids"] = _quiz_gen.resolve_chunk_refs(q["chunk_refs"], ref_map)
                    if not q["chunk_ids"]:
                        continue
                    if not q.get("section_id"):
                        secs = [section_by_chunk.get(c) for c in q["chunk_ids"]]
                        secs = [x for x in secs if x]
                        q["section_id"] = max(set(secs), key=secs.count) if secs else None
                    accepted.append(q)
                    da_co_norm.add(_norm_text(q["question_text"]))
                    if len(accepted) >= config["question_count"]:
                        break
```

`_norm_text` = `from shared.text_norm import norm_text as _norm_text` (đã dùng trong
`rules.py`, không thêm phụ thuộc mới).

- [x] **Bước 5: `result` phải nói thật số câu xin và số câu ra**

```python
        result = {"quiz_id": quiz_id, "status": "ready", "question_count": len(accepted),
                  "asked_count": config["question_count"],
                  "rejected_count": len(rejected), "llm_attempts": attempts}
```

- [x] **Bước 6: chạy toàn bộ test BE, so mốc 942 passed / 4 skipped**

- [x] **Bước 7: commit**

---

### Task 4: Mất kết nối phải nói tiếng Việt

**Vấn đề:** người dùng thấy nguyên văn `Failed to fetch` — chuỗi trình duyệt sinh ra khi
`fetch` ném `TypeError`, tiếng Anh, không nói được phải làm gì.

**Nguyên nhân gốc:** 14 chỗ trong `FE/src/pages/study/*` bắt lỗi rồi hiện thẳng
`e?.message`. `getUserFriendlyApiError` trong `FE/src/utils/api.js` đã xử lý đúng ca
`TypeError` từ lâu — **không trang StudyMap nào gọi nó**. Không phải thiếu code; code có
sẵn không ai nối vào.

Không dùng thẳng `getUserFriendlyApiError`: hàm đó nuốt luôn thông báo tiếng Việt do BE
trả về ("Phạm vi đã chọn không có chunk nào đã index") và đổi thành "Đã có lỗi xảy ra".
Cần helper giữ lại lời của BE.

**Files:**
- Modify: `FE/src/utils/studyApi.js`
- Modify: `FE/src/pages/study/{QuizSetup,QuizTaking,QuizResult,Practice,ReviewGuide,StudyMapView,DocumentList}.jsx`
- Test: `FE/src/utils/__tests__/moTaLoi.test.js` (tạo mới)

**Interfaces:**
- Produces: `moTaLoi(e: unknown, duPhong?: string) -> string`, export từ `studyApi.js`.

- [x] **Bước 1: viết test đỏ**

```js
import { describe, expect, it } from "vitest";
import { moTaLoi } from "../studyApi";

describe("moTaLoi", () => {
  it("lỗi mạng thì nói tiếng Việt, không để lọt 'Failed to fetch'", () => {
    const s = moTaLoi(new TypeError("Failed to fetch"), "Không tạo được quiz.");
    expect(s).not.toMatch(/failed to fetch/i);
    expect(s).toMatch(/máy chủ/i);
  });

  it("giữ nguyên lời BE đã viết bằng tiếng Việt", () => {
    const e = new Error("Phạm vi đã chọn không có chunk nào đã index.");
    e.status = 400;
    expect(moTaLoi(e, "x")).toBe("Phạm vi đã chọn không có chunk nào đã index.");
  });

  it("401/403/404 dùng lời chung, không lộ chi tiết backend", () => {
    const e = new Error("forbidden");
    e.status = 403;
    expect(moTaLoi(e, "x")).toMatch(/không có quyền/i);
  });

  it("lỗi rỗng thì dùng câu dự phòng của trang", () => {
    expect(moTaLoi(null, "Không tải được kết quả.")).toBe("Không tải được kết quả.");
  });

  it("'HTTP nnn' trần không phải câu cho người đọc", () => {
    const e = new Error("HTTP 500");
    e.status = 500;
    expect(moTaLoi(e, "Nộp bài thất bại.")).toBe("Nộp bài thất bại.");
  });
});
```

- [x] **Bước 2: chạy, phải đỏ** — `npm test -- moTaLoi`

- [x] **Bước 3: thêm `moTaLoi` vào `studyApi.js`**

```js
// Lỗi cho người đọc, không phải cho console.
//
// `fetch` mất mạng ném TypeError("Failed to fetch") — chuỗi tiếng Anh do trình duyệt
// sinh, người học không hiểu và cũng không biết phải làm gì. Nhưng KHÔNG nuốt hết: BE
// trả nhiều thông báo tiếng Việt viết sẵn cho người dùng ("Phạm vi đã chọn không có
// chunk nào đã index") — mất chúng thì người dùng hết đường tự sửa.
export function moTaLoi(e, duPhong = "Đã có lỗi xảy ra. Vui lòng thử lại.") {
  if (!e) return duPhong;
  if (e.name === "TypeError" || e.status === 0 || !e.status) {
    return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  }
  if (e.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (e.status === 403) return "Bạn không có quyền truy cập tài liệu này.";
  if (e.status === 404) return "Tài nguyên không tồn tại hoặc bạn không có quyền truy cập.";
  const msg = String(e.message || "").trim();
  return msg && !/^HTTP \d+$/.test(msg) ? msg : duPhong;
}
```

- [x] **Bước 4: nối vào từng trang** — thay `e?.message || "X"` thành `moTaLoi(e, "X")`,
  thêm `moTaLoi` vào import từ `../../utils/studyApi`. Bảy file, 14 chỗ: QuizSetup:71,109
  QuizTaking:53,82,108 QuizResult:38 Practice:42,66 ReviewGuide:33,47,64
  StudyMapView:70,110 DocumentList:45,63.

- [x] **Bước 5: `npm test` + `npm run build`, so mốc 212 passed**

- [x] **Bước 6: commit**

---

### Task 5: Ghi lại vào .playbook

- [x] `.playbook/known-issues.md`: bốn mục V8-1..V8-4, mỗi mục kèm nguyên văn log hoặc
      dòng `ai_validation_logs` làm bằng chứng.
- [x] `.playbook/lessons-learned.md`: hai bài học —
      (1) "Hằng số prompt tả nhiều hơn cấu hình cho phép thì tầng luật phía sau chỉ còn
      việc đếm xác" — prompt và luật phải sinh từ cùng một danh sách;
      (2) "Hàm tử tế viết xong mà không ai gọi thì bằng không" — `getUserFriendlyApiError`
      nằm trong repo từ lâu, 14 chỗ vẫn hiện `Failed to fetch`.
- [x] Commit.
