"""Use case: sinh Study Map (sơ đồ kiến thức) cho MỘT tài liệu (FR-04.2).

Chuyển từ `app/main.py` ở Phase 1 — **di chuyển nguyên trạng**, không refactor logic,
không đổi thứ tự xử lý, không đổi cách bắt lỗi, không đổi mốc trạng thái.

`app.main.run_study_map_job` vẫn còn dưới dạng wrapper mỏng: RQ serialize hàm theo
`module.qualname`, nên job ĐANG NẰM TRONG HÀNG ĐỢI vẫn resolve được sau khi deploy.

Ràng buộc tầng: file này KHÔNG import flask, faiss, ollama.
"""

from __future__ import annotations

from typing import Optional

from app.application.shared import _JobCancelled, _job_error_text
from app.clients.mindmap_factory import get_mindmap_pipeline as _get_mindmap_pipeline
from app.domains.mindmap.input_collector import collect_mindmap_input
from app.domains.vectorstore.store import INDEX_DIR
from services.mindmap.pipeline import schema as mindmap_schema

# Cùng giá trị với `main.INDEX_META_JSON_PATH`, dẫn từ CÙNG một `INDEX_DIR`.
INDEX_META_JSON_PATH = INDEX_DIR / "index.json"

def run_study_map_job(job_id: str, document_id: str, user_id: Optional[str] = None) -> None:
    """Sinh Study Map cho MỘT tài liệu (FR-04.2).

    Gọi thẳng pipeline mindmap thay vì đi qua MINDMAP_GRAPH: graph tự ghi
    `status=done` kèm result là artifact mindmap, mà job này phải trả `map_id` —
    để graph đóng job trước rồi mới ghi map_id là dựng lại đúng race
    done-trước-result đã có trong known-issues. Ở đây job chỉ done sau khi map
    đã nằm trong DB.
    """
    from app.domains.documents import repository as _docs
    from app.domains.jobs.jobs_store import is_cancel_requested, update_job
    from app.domains.studymap import generator as _sm_gen
    from app.domains.studymap import repository as _sm_repo

    print(f"study_map_job_running job_id={job_id}", flush=True)
    map_id = None
    try:
        row = _docs.get(document_id) or {}
        stem = row.get("source_stem")
        if not stem:
            raise ValueError("Tài liệu chưa có dữ liệu đã index.")
        map_id = _sm_repo.create_map(document_id=document_id, user_id=user_id,
                                     title=row.get("filename") or "Study Map")
        update_job(job_id, status="running", progress=5, current_node="CollectInput",
                   result={"map_id": map_id, "status": "processing"})

        mm = collect_mindmap_input(INDEX_META_JSON_PATH, [stem])
        if not mm.get("chunks"):
            raise ValueError("Tài liệu chưa có chunk nào đã index.")

        def _cancelled() -> bool:
            return bool(is_cancel_requested(job_id))

        pipeline = _get_mindmap_pipeline()
        update_job(job_id, progress=15, current_node="Skeleton")
        skeleton, method = pipeline.skeleton(mm)
        if _cancelled():
            raise _JobCancelled()

        update_job(job_id, progress=30, current_node="Enrich")
        nodes, deg_enrich = pipeline.enrich(
            mm, skeleton,
            progress_cb=lambda p, msg: update_job(job_id, progress=p, current_node=msg),
            cancel_cb=_cancelled,
        )
        if _cancelled():
            raise _JobCancelled()

        # Nhãn nêu SỐ khái niệm chứ không chỉ tên bước: `relations()` là MỘT lời gọi
        # LLM, không chia nhỏ được, và nó chiếm 106 giây đo được trong job 487s. Chia
        # nhỏ một lời gọi LLM chỉ để thanh chạy mượt là làm đẹp bằng cách làm chậm —
        # nói thật cho người dùng biết đang chờ gì thì rẻ hơn và đúng hơn.
        update_job(job_id, progress=75,
                   current_node=f"Đang tìm quan hệ giữa {len(nodes)} khái niệm...")
        relations, deg_rel = pipeline.relations(nodes, cancel_cb=_cancelled)
        if _cancelled():
            raise _JobCancelled()

        update_job(job_id, progress=85, current_node="Persist")
        clean = mindmap_schema.sanitize_nodes(nodes)
        rels = mindmap_schema.validate_relations(relations, clean)
        node_rows, edge_rows = _sm_gen.build_graph(
            clean, rels, _docs.chunks_by_embedding(document_id),
            source_stems=[stem],
        )
        if not node_rows:
            raise ValueError("Pipeline không dựng được node nào.")
        counts = _sm_repo.save_graph(map_id, document_id, node_rows, edge_rows)
        _sm_repo.finish(map_id, "completed", generator={
            "pipeline": mindmap_schema.PIPELINE_VERSION,
            "skeleton_method": method,
            "degraded": bool(deg_enrich or deg_rel),
            **counts,
        })
        update_job(job_id, status="done", progress=100, current_node="Persist",
                   result={"map_id": map_id, "status": "completed", **counts})
        print(f"study_map_job_done job_id={job_id} map_id={map_id}", flush=True)
    except _JobCancelled:
        if map_id:
            _sm_repo.finish(map_id, "failed", generator={"cancelled": True})
        update_job(job_id, status="cancelled", progress=0, current_node="Cancelled")
        print(f"study_map_job_cancelled job_id={job_id}", flush=True)
    except Exception as e:
        if map_id:
            _sm_repo.finish(map_id, "failed", generator={"error": str(e)[:500]})
        update_job(job_id, status="error", error_text=_job_error_text(e))
        print(f"study_map_job_failed job_id={job_id} err={str(e)[:80]}", flush=True)
