from __future__ import annotations

import os

from services.mindmap.pipeline.modelcfg import resolve_mindmap_model
from shared.config import get_settings


class LocalMindmapPipeline:
    def _model(self) -> str:
        return resolve_mindmap_model()

    def _timeout(self) -> float:
        return float(os.getenv("MINDMAP_LLM_TIMEOUT_SEC", "120"))

    def skeleton(self, mm_input, *, usage_context=None):
        from services.mindmap.pipeline.skeleton import build_skeleton
        nodes, method = build_skeleton(mm_input)
        if method == "single":
            # Deterministic bó tay → 1 LLM call dựng mục lục; lỗi thì giữ single
            # (graph đánh dấu degraded "skeleton").
            from services.mindmap.pipeline.outline import build_outline
            outlined = build_outline(mm_input, model=self._model(), timeout_sec=self._timeout(),
                                     usage_context=usage_context)
            if outlined:
                return outlined, "llm_outline"
        return nodes, method

    def guided_plan(self, mm_input, job_id: str = "", *, usage_context=None):
        from services.mindmap.pipeline.guided_planner import plan_guided
        return plan_guided(mm_input, model=self._model(), timeout_sec=self._timeout(), job_id=job_id,
                           usage_context=usage_context)

    def _enrich_parallel(self) -> int:
        """Số nhánh chạy song song — KHÔNG bao giờ vượt số slot của cổng LLM.

        `MINDMAP_ENRICH_PARALLEL` mặc định 2, nhưng cổng in-process
        (`MAX_CONCURRENT_LLM_CALLS`, mặc định 1 trên máy này) chỉ cho 1 lời gọi chạy
        một lúc. Nhánh thứ hai không chạy nhanh hơn — nó ĐỢI, và khi chờ quá
        `LLM_QUEUE_WAIT_TIMEOUT_SECONDS` (180s) thì ném "LLM busy (in-process)".
        Đo thật: cả 3 nhánh + bước quan hệ đều chết kiểu này, sơ đồ ra đúng 4 node
        khung xương sau 544 giây.

        Lấy trần từ chính cổng LLM thay vì bắt hai biến env phải khớp tay: chỉnh một
        chỗ là đủ, và không có cấu hình nào tự mâu thuẫn được nữa.
        """
        from app.clients.llm_factory import inproc_slots
        muon = max(1, int(os.getenv("MINDMAP_ENRICH_PARALLEL", "2") or 2))
        return max(1, min(muon, inproc_slots()))

    def enrich(self, mm_input, skeleton_nodes, progress_cb=None, cancel_cb=None, job_id: str = "",
               *, usage_context=None):
        from services.mindmap.pipeline.enrich import enrich_branches
        return enrich_branches(mm_input, skeleton_nodes, model=self._model(),
                               timeout_sec=self._timeout(),
                               max_workers=self._enrich_parallel(),
                               progress_cb=progress_cb, cancel_cb=cancel_cb, job_id=job_id,
                               usage_context=usage_context)

    def relations(self, nodes, cancel_cb=None, job_id: str = "", *, usage_context=None):
        from services.mindmap.pipeline.relations import extract_relations
        return extract_relations(nodes, model=self._model(),
                                 timeout_sec=self._timeout(), cancel_cb=cancel_cb, job_id=job_id,
                                 usage_context=usage_context)


def get_mindmap_pipeline():
    settings = get_settings()
    if settings.mindmap_service_addr:
        try:
            from app.clients.mindmap_client import GrpcMindmapPipeline  # Task 15
            return GrpcMindmapPipeline(settings.mindmap_service_addr)
        except Exception:
            pass
    return LocalMindmapPipeline()
