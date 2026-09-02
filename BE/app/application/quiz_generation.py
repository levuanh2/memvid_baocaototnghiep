"""Use case: sinh quiz chẩn đoán (FR-06) + kiểm chất lượng (FR-13).

Chuyển từ `app/main.py` ở Phase 1 — **di chuyển nguyên trạng**, không refactor logic,
không đổi thứ tự xử lý, không đổi cách bắt lỗi, không đổi mốc trạng thái.

`app.main.run_quiz_generation_job` vẫn còn dưới dạng wrapper mỏng: RQ serialize hàm theo
`module.qualname`, nên job ĐANG NẰM TRONG HÀNG ĐỢI vẫn resolve được sau khi deploy.

Ràng buộc tầng: file này KHÔNG import flask, faiss, ollama.
"""

from __future__ import annotations

import os
from typing import Optional

from app.application.shared import _JobCancelled, _job_error_text, _nhip_tim_job

# Cùng biến môi trường, cùng mặc định như bản trong `main.py`.
QUIZ_MAX_CONTEXT_CHUNKS = int(os.getenv("QUIZ_MAX_CONTEXT_CHUNKS", "200"))

def run_quiz_generation_job(job_id: str, document_id: str, config: dict,
                            user_id: Optional[str] = None) -> None:
    """Sinh quiz chẩn đoán (FR-06) + kiểm chất lượng (FR-13).

    Không dùng LangGraph: luồng thẳng một mạch, và graph tự ghi `status=done` là dựng
    lại race done-trước-result trong known-issues (xem `run_study_map_job`). Ở đây job
    chỉ `done` sau khi câu hỏi đã nằm trong DB.
    """
    from app.domains.ai_validation import rules as _rules
    from app.domains.ai_validation import store as _val_store
    from app.domains.jobs import ledger as _ledger
    from app.domains.jobs.jobs_store import is_cancel_requested, update_job
    from app.domains.quiz import generator as _quiz_gen
    from app.domains.quiz import repository as _quiz_repo

    print(f"quiz_job_running job_id={job_id}", flush=True)
    quiz_id = None
    # Log validation có FK tới `jobs` (Postgres). Sổ cái mở được thì mới gắn job_id,
    # không thì vẫn ghi log nhưng để trống — FR-13.10 không kèm điều kiện.
    ledger_ok = _ledger.open_job(job_id, job_type="quiz_generation", user_id=user_id,
                                 input_json={"document_id": document_id, **config})
    log_job_id = job_id if ledger_ok else None

    def _cancelled() -> bool:
        return bool(is_cancel_requested(job_id))

    try:
        scope = config["scope"]
        # Practice (FR-11.2) chỉ định thẳng chunk từ review item; quiz chẩn đoán lấy
        # theo section. Dùng CHUNG job này để hai đường sinh quiz không lệch nhau.
        if config.get("chunk_ids"):
            chunks = _quiz_repo.chunks_by_ids(document_id, config["chunk_ids"],
                                              limit=QUIZ_MAX_CONTEXT_CHUNKS)
            if not chunks:
                raise ValueError("Review item không còn chunk nguồn nào.")
        else:
            chunks = _quiz_repo.chunks_for_scope(document_id, scope.get("section_ids"),
                                                 limit=QUIZ_MAX_CONTEXT_CHUNKS)
            if not chunks:
                raise ValueError("Phạm vi đã chọn không có chunk nào đã index.")

        quiz_id = _quiz_repo.create_quiz(
            user_id=user_id, document_id=document_id,
            title=config.get("title") or _quiz_repo.document_title(document_id),
            scope=scope, question_count=config["question_count"],
            difficulty=config["difficulty"],
            quiz_type=config.get("quiz_type") or "diagnostic",
            source_review_item_id=config.get("source_review_item_id"),
            source_attempt_id=config.get("source_attempt_id"),
        )
        update_job(job_id, status="running", progress=10, current_node="BuildContext",
                   result={"quiz_id": quiz_id, "status": "processing"})

        context, ref_map = _quiz_gen.build_context(chunks)
        if _cancelled():
            raise _JobCancelled()

        update_job(job_id, progress=30, current_node="GenerateQuestions")
        with _nhip_tim_job(job_id):
            raw_questions, err, attempts = _quiz_gen.generate_questions(
                context, config, da_huy=_cancelled)
        # Huỷ phải được đọc TRƯỚC `err`: `generate_questions` trả lỗi "Đã huỷ..." khi
        # thấy cờ, và nó là huỷ chứ không phải hỏng — vào nhánh `err` thì job hiện
        # "Tạo quiz thất bại" cho một việc chính người dùng bấm dừng.
        if _cancelled():
            raise _JobCancelled()
        if err:
            _val_store.log_rejections([_rules.json_failure(err)], job_id=log_job_id)
            raise ValueError(err)

        update_job(job_id, progress=70, current_node="Validate")
        accepted, rejected = _rules.validate_questions(
            raw_questions,
            allowed_chunk_refs=ref_map.keys(),
            allowed_section_ids=_quiz_repo.section_ids_of(document_id),
            allowed_types=config["question_types"],
        )
        _val_store.log_rejections(rejected, job_id=log_job_id)

        # Nhãn `c0` sang chunk_id thật + suy ra section từ chunk nguồn (FR-06.10):
        # model không được cấp section_id nên tự nó không gắn được.
        # Practice: ÉP tag chủ đề của review item vào mọi câu (FR-11.10).
        # Tag do LLM tự đặt nên bài chẩn đoán ra "hàm hợp" còn bài luyện ra "quy tắc
        # hàm hợp" — hai tên khác nhau thì so sánh trước/sau không bao giờ khớp và
        # màn hình tiến bộ im lặng báo "chưa đo". Chủ đề đã biết chắc từ review item,
        # không có lý do để model quyết định lại.
        practice_topic = (config.get("practice_topic") or "").strip()
        if practice_topic:
            for q in accepted:
                tags = [t for t in (q.get("concept_tags") or []) if t != practice_topic]
                q["concept_tags"] = [practice_topic] + tags

        section_by_chunk = {c["chunk_id"]: c.get("section_id") for c in chunks}
        for q in accepted:
            q["chunk_ids"] = _quiz_gen.resolve_chunk_refs(q["chunk_refs"], ref_map)
            if not q.get("section_id"):
                sections = [section_by_chunk.get(cid) for cid in q["chunk_ids"]]
                sections = [x for x in sections if x]
                q["section_id"] = max(set(sections), key=sections.count) if sections else None
        accepted = [q for q in accepted if q["chunk_ids"]][: config["question_count"]]

        # MỘT lượt bù, không hơn. Xin 10 nhận 5 (log 2026-08-30 job 7ae6eb87: 5/10 câu
        # bị loại vì model bỏ `explanation`) — không ép được model viết đủ, nhưng hỏi
        # lại đúng phần thiếu thì được. Máy chỉ có 1 slot LLM nên mỗi lượt là ~1 phút
        # người dùng ngồi chờ: bù xong vẫn thiếu thì trả đúng số có được, `asked_count`
        # trong result nói ra phần chênh.
        thieu = config["question_count"] - len(accepted)
        if thieu > 0 and not _cancelled():
            from shared.text_norm import norm_text as _norm_text

            update_job(job_id, progress=80, current_node="BuSoCauThieu")
            print(f"quiz_bu_cau job_id={job_id} co={len(accepted)} thieu={thieu}",
                  flush=True)
            with _nhip_tim_job(job_id):
                them_raw, them_err, _ = _quiz_gen.generate_questions(
                    context, {**config, "question_count": thieu},
                    # GỒM CẢ câu bị loại: chúng là thứ model vừa viết và sẽ viết lại
                    # nếu không được nhắc. Chỉ liệt kê câu được nhận là giấu đi phần
                    # lớn thông tin cần cho việc "đừng lặp".
                    da_co=_quiz_gen.gom_da_co(accepted, raw_questions),
                    da_huy=_cancelled)
            if them_err:
                # Bù hỏng KHÔNG làm hỏng cả job: quiz với 5 câu vẫn dùng được, còn hơn
                # ném đi cả 5 câu đã qua kiểm chất lượng.
                print(f"quiz_bu_cau_that_bai job_id={job_id} err={them_err[:80]}",
                      flush=True)
            else:
                them_ok, them_bad = _rules.validate_questions(
                    them_raw,
                    allowed_chunk_refs=ref_map.keys(),
                    allowed_section_ids=_quiz_repo.section_ids_of(document_id),
                    allowed_types=config["question_types"],
                )
                _val_store.log_rejections(them_bad, job_id=log_job_id)
                rejected = rejected + them_bad
                da_co_norm = {_norm_text(q["question_text"]) for q in accepted}
                for q in them_ok:
                    if _norm_text(q["question_text"]) in da_co_norm:
                        continue
                    q["chunk_ids"] = _quiz_gen.resolve_chunk_refs(q["chunk_refs"], ref_map)
                    if not q["chunk_ids"]:
                        continue
                    if practice_topic:
                        tags = [t for t in (q.get("concept_tags") or []) if t != practice_topic]
                        q["concept_tags"] = [practice_topic] + tags
                    if not q.get("section_id"):
                        secs = [section_by_chunk.get(c) for c in q["chunk_ids"]]
                        secs = [x for x in secs if x]
                        q["section_id"] = max(set(secs), key=secs.count) if secs else None
                    accepted.append(q)
                    da_co_norm.add(_norm_text(q["question_text"]))
                    if len(accepted) >= config["question_count"]:
                        break
                print(f"quiz_bu_cau_xong job_id={job_id} tong={len(accepted)}", flush=True)

        if not accepted:
            raise ValueError(
                f"Không câu hỏi nào qua kiểm chất lượng ({len(rejected)} câu bị loại).")

        update_job(job_id, progress=90, current_node="Persist")
        _quiz_repo.save_questions(quiz_id, accepted)
        _quiz_repo.finish(quiz_id, "ready", question_count=len(accepted))
        dem_loai, ly_do = _rules.ly_do_loai(rejected)
        result = {"quiz_id": quiz_id, "status": "ready", "question_count": len(accepted),
                  "asked_count": config["question_count"],
                  "rejected_count": len(rejected), "llm_attempts": attempts,
                  # Nguyên nhân ĐO ĐƯỢC, không đoán. Giao diện từng tự bịa "đoạn tài
                  # liệu quá ngắn" trong khi log cho thấy 9/12 câu mất vì model không
                  # trích nhãn nguồn.
                  "rejected_reason": ly_do, "rejected_by_rule": dem_loai}
        update_job(job_id, status="done", progress=100, current_node="Persist", result=result)
        _ledger.close_job(job_id, "done", result_type="quiz", result_id=quiz_id)
        print(f"quiz_job_done job_id={job_id} quiz_id={quiz_id} "
              f"kept={len(accepted)} rejected={len(rejected)}", flush=True)
    except _JobCancelled:
        if quiz_id:
            _quiz_repo.finish(quiz_id, "failed")
        update_job(job_id, status="cancelled", progress=0, current_node="Cancelled")
        _ledger.close_job(job_id, "cancelled")
        print(f"quiz_job_cancelled job_id={job_id}", flush=True)
    except Exception as e:
        if quiz_id:
            _quiz_repo.finish(quiz_id, "failed")
        update_job(job_id, status="error", error_text=_job_error_text(e))
        _ledger.close_job(job_id, "error", error_message=str(e))
        print(f"quiz_job_failed job_id={job_id} err={str(e)[:80]}", flush=True)
