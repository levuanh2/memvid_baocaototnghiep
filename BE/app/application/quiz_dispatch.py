"""Điều phối sinh quiz — chẩn đoán (FR-06) và luyện tập (FR-11).

Hai route dùng CHUNG một đường sinh: cùng cấu hình, cùng `job_type="quiz_generation"`,
cùng callable, cùng hàng đợi. Practice không phải một pipeline riêng — nó là quiz lấy
ngữ liệu từ review item thay vì theo section. Vì thế hai use case nằm chung một module,
và chỗ chúng thật sự dùng chung là `cau_hinh_quiz` + tham số `day_job` được tiêm.

Cố ý KHÔNG dựng một trừu tượng sinh-nội-dung chung. Summary và Mindmap trông giống hai
hàm dưới đây ở tầng route, nhưng khác schema, khác pipeline, khác kho, khác hàng đợi và
khác công thức hash — gộp chúng lại là đặt một cái tên chung cho những thứ khác nhau.

Ba thứ được TIÊM, mỗi thứ một lý do cụ thể, không phải để "dễ test":

- `day_job`: RQ serialize hàm theo `module.qualname`. Job đã nằm trong hàng đợi mang
  đường dẫn `app.main.run_quiz_generation_job`; nếu tầng này import thẳng runner ở
  `app.application.quiz_generation`, đường dẫn đổi và job cũ chết ở worker — im lặng,
  vì chế độ thread không dùng đường dẫn nên test vẫn xanh.
- `giu_cho` / `nha_cho`: sổ dedupe là `OrderedDict` + `Lock` sống TRONG TIẾN TRÌNH ở
  `main.py`. Nó không sống sót restart và không chia sẻ giữa worker — hạ tầng, không
  phải luật nghiệp vụ. Luật ("cùng người + cùng tài liệu + cùng cấu hình") thì ở đây,
  trong `khoa_trung`.

Tầng này không biết HTTP: không `request`, không `jsonify`, không một con số status nào.
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple

from app.application import attempts as attempts_uc

# Trần số câu, đọc một lần lúc import. `main.QUIZ_MAX_QUESTIONS` trỏ vào đây để giữ
# một nguồn sự thật; `test_generate_characterization` đọc tên ở `main`.
SO_CAU_TOI_DA = int(os.getenv("QUIZ_MAX_QUESTIONS", "50"))

_DO_KHO = ("easy", "medium", "hard", "mixed")


# ── Lỗi ngữ nghĩa ──────────────────────────────────────────────────────────
class TaiLieuChuaIndex(attempts_uc.AttemptError):
    loi = "Tài liệu chưa index xong"


class SectionLac(attempts_uc.AttemptError):
    """`section_ids` không thuộc tài liệu — chặn ở đây, đừng để job chạy xong mới ra
    quiz rỗng."""


class SoCauKhongPhaiSo(attempts_uc.AttemptError):
    loi = "question_count phải là số nguyên"


class SoCauNgoaiKhoang(attempts_uc.AttemptError):
    pass


class DoKhoSai(attempts_uc.AttemptError):
    loi = "difficulty phải là easy|medium|hard|mixed"


class LoaiCauKhongPhaiList(attempts_uc.AttemptError):
    loi = "question_types phải là list"


class LoaiCauKhongHopLe(attempts_uc.AttemptError):
    pass


class ScopeKhongPhaiObject(attempts_uc.AttemptError):
    loi = "scope phải là object"


class ReviewItemKhongTonTai(attempts_uc.AttemptError):
    """Không có, hoặc của người khác — CỐ Ý cùng một thân lỗi."""
    loi = "Review item not found"


class ReviewItemKhongCoChunk(attempts_uc.AttemptError):
    loi = "Review item không có chunk nguồn để ra đề"


# ── Cấu hình dùng chung cho cả hai đường ───────────────────────────────────
def cau_hinh_quiz(data: dict) -> Dict[str, Any]:
    """Ép mọi giá trị về tập DB chấp nhận TRƯỚC khi chạy job.

    Để CHECK của Postgres bắt thì job đã tốn một lượt gọi LLM rồi mới hỏng — đắt và
    người dùng chỉ thấy "tạo quiz thất bại". Sáu lỗi dưới đây là sáu thân riêng biệt,
    mỗi cái nêu đúng trường sai; gộp chúng thành một "cấu hình không hợp lệ" là lấy
    mất thông tin người dùng cần để sửa.
    """
    from app.domains.ai_validation.rules import QUESTION_TYPES

    try:
        count = int(data.get("question_count", 10))
    except (TypeError, ValueError):
        raise SoCauKhongPhaiSo()
    if not 1 <= count <= SO_CAU_TOI_DA:
        raise SoCauNgoaiKhoang(f"question_count phải trong 1..{SO_CAU_TOI_DA}")

    difficulty = str(data.get("difficulty") or "mixed").strip().lower()
    if difficulty not in _DO_KHO:
        raise DoKhoSai()

    types = data.get("question_types") or list(QUESTION_TYPES)
    if not isinstance(types, list):
        raise LoaiCauKhongPhaiList()
    types = [str(t).strip().lower() for t in types if str(t or "").strip()]
    bad = [t for t in types if t not in QUESTION_TYPES]
    if bad or not types:
        raise LoaiCauKhongHopLe(f"question_types không hợp lệ: {bad or 'rỗng'}")

    scope = data.get("scope") or {}
    if not isinstance(scope, dict):
        raise ScopeKhongPhaiObject()
    section_ids = [str(x) for x in (scope.get("section_ids") or []) if str(x or "").strip()]
    scope_type = "sections" if section_ids else "full_document"

    return {
        "question_count": count,
        "difficulty": difficulty,
        "question_types": types,
        "scope": {"type": scope_type, "section_ids": section_ids},
    }


def khoa_trung(user_id: Optional[str], document_id: str, config: dict) -> str:
    """Hai yêu cầu chỉ là 'trùng' khi CÙNG người, CÙNG tài liệu, CÙNG cấu hình.

    Đổi số câu hay đổi phạm vi là một yêu cầu khác và phải được chạy. `sort_keys` để
    thứ tự khoá trong JSON của client không đổi kết quả.
    """
    return json.dumps([user_id, document_id, config], sort_keys=True, ensure_ascii=False)


# ── Use case ───────────────────────────────────────────────────────────────
def sinh_quiz(document_id: str, data: dict, user_id: Optional[str], *,
              source_stem: Optional[str],
              giu_cho: Callable[[str, str], Optional[str]],
              nha_cho: Callable[[str, str], None],
              day_job: Callable[..., dict]) -> Tuple[Dict[str, Any], bool]:
    """(payload, da_dedupe). Quiz chẩn đoán từ MỘT tài liệu.

    Quyền sở hữu tài liệu đã được kiểm ở tầng route (`_owned_document`, còn 13 caller
    khác) — hàm này nhận `source_stem` của bản ghi đã qua cổng.
    """
    from app.domains.jobs.jobs_store import create_job
    from app.domains.quiz import repository as _quiz_repo

    if not source_stem:
        raise TaiLieuChuaIndex()

    config = cau_hinh_quiz(data)
    wanted: List[str] = config["scope"]["section_ids"]
    if wanted:
        known = set(_quiz_repo.section_ids_of(document_id))
        unknown = [x for x in wanted if x not in known]
        if unknown:
            raise SectionLac(f"section_ids không thuộc tài liệu: {unknown}")

    job_id = str(uuid.uuid4())
    khoa = khoa_trung(user_id, document_id, config)
    dang_chay = giu_cho(khoa, job_id)
    if dang_chay:
        # Không phải lỗi: người dùng bấm lại đúng cái họ đã xin. Trả về job ĐANG chạy
        # để giao diện bám tiếp vào nó thay vì mở thêm một job nữa tranh slot LLM.
        print(f"quiz_enqueue_deduped job_id={dang_chay}", flush=True)
        return {"job_id": dang_chay, "status": "started", "deduped": True}, True

    try:
        create_job(job_id, job_type="quiz_generation", status="pending", progress=0,
                   current_node="Queued", user_id=user_id)
        res = day_job(job_id, document_id, config, user_id)
    except Exception:
        # Chỗ đã giữ mà job không bao giờ chạy = cửa khoá vĩnh viễn: mọi lần bấm sau
        # đều bị dedupe trả về đúng job chết này. Trả chỗ lại rồi mới báo lỗi.
        nha_cho(khoa, job_id)
        raise
    print(f"quiz_enqueue_{res.get('mode')} job_id={job_id}", flush=True)
    return {"job_id": job_id, "status": "started"}, False


def sinh_practice(review_item_id: str, data: dict, user_id: Optional[str], *,
                  bat_buoc_chu_so_huu: bool,
                  day_job: Callable[..., dict]) -> Dict[str, Any]:
    """Quiz luyện tập từ một review item yếu (FR-11.1–FR-11.3).

    Dùng CHUNG `day_job` với quiz chẩn đoán — cùng `job_type`, cùng callable, cùng hàng
    đợi. Khác biệt duy nhất là nguồn ngữ liệu: chunk lấy thẳng từ review item thay vì
    theo section (FR-11.2, FR-11.4).

    KHÔNG đi qua dedupe. Đó là hành vi đang có, và `test_generate_characterization`
    khoá nó lại — thêm dedupe ở đây là đổi hành vi, không phải dọn dẹp.
    """
    from app.domains.jobs.jobs_store import create_job
    from app.domains.review import service as _review

    item = _review.get_item(review_item_id)
    if not item or (bat_buoc_chu_so_huu and item.get("user_id") != user_id):
        raise ReviewItemKhongTonTai()
    if not item.get("chunk_ids"):
        raise ReviewItemKhongCoChunk()

    config = cau_hinh_quiz(data)
    config.update({
        "quiz_type": "practice",
        "chunk_ids": item["chunk_ids"],
        # FR-11.8 / FR-11.9: mất hai khoá này là mất cả chuỗi yếu → ôn → luyện.
        "source_review_item_id": review_item_id,
        "source_attempt_id": item["attempt_id"],
        "title": f"Luyện tập: {item['topic']}",
        "practice_topic": item["topic"],
    })

    job_id = str(uuid.uuid4())
    create_job(job_id, job_type="quiz_generation", status="pending", progress=0,
               current_node="Queued", user_id=user_id)
    res = day_job(job_id, item["document_id"], config, user_id)
    print(f"practice_enqueue_{res.get('mode')} job_id={job_id}", flush=True)
    return {"job_id": job_id, "status": "started"}
