"""Adapter pipeline Summary v2 — local monolith (mirror mindmap_factory, không gRPC)."""
from __future__ import annotations

import os


class LocalSummaryPipeline:
    def _timeout(self) -> float:
        return float(os.getenv("SUMMARY_LLM_TIMEOUT_SEC", "120"))

    def sections(self, mm_input, *, usage_context=None):
        from services.mindmap.pipeline.outline import build_outline
        from services.summary.pipeline.sections import build_sections

        def _outline(mi):
            # model=None → ask_ai tự resolve theo feature; timeout dùng chung summary
            return build_outline(
                mi, model=None, timeout_sec=self._timeout(),
                usage_context=usage_context,
                usage_attempt_id="summary-outline",
            )

        return build_sections(mm_input, outline_fn=_outline)

    def _parallel(self) -> int:
        """Số mục chạy song song — KHÔNG bao giờ vượt số slot của cổng LLM.

        `SUMMARY_PARALLEL` mặc định 2, nhưng cổng in-process
        (`MAX_CONCURRENT_LLM_CALLS`, mặc định 1 trên máy này) chỉ cho 1 lời gọi chạy
        một lúc. Mục thứ hai không chạy nhanh hơn — nó ĐỢI, và khi chờ quá
        `LLM_QUEUE_WAIT_TIMEOUT_SECONDS` (180s) thì ném "LLM busy (in-process)",
        mục đó rơi vào `missing` và bản tóm tắt ra degraded.

        Lấy trần từ chính cổng LLM thay vì bắt hai biến env phải khớp tay — y hệt
        `mindmap_factory._enrich_parallel`, cùng một lỗi, cùng một cách chặn.
        """
        from app.clients.llm_factory import inproc_slots
        muon = max(1, int(os.getenv("SUMMARY_PARALLEL", "2") or 2))
        return max(1, min(muon, inproc_slots()))

    def summarize(self, mm_input, sections, *, length_mode="medium",
                  progress_cb=None, cancel_cb=None, diagnostics_sink=None,
                  usage_context=None):
        from shared.config import get_settings
        from services.summary.pipeline.summarize import summarize_sections
        return summarize_sections(
            mm_input, sections, model=None, length_mode=length_mode,
            timeout_sec=self._timeout(),
            max_workers=self._parallel(),
            with_facts=get_settings().summary_facts,
            progress_cb=progress_cb, cancel_cb=cancel_cb,
            diagnostics_sink=diagnostics_sink, usage_context=usage_context)

    def synthesize(self, sections, *, doc_title, length_mode="medium", usage_context=None):
        from services.summary.pipeline.synthesize import synthesize
        return synthesize(sections, doc_title=doc_title, model=None,
                          length_mode=length_mode, timeout_sec=self._timeout(),
                          usage_context=usage_context)

    def coverage(self, record, *, usage_context=None):
        """Phase 5 judge-only. Tắt (SUMMARY_COVERAGE=0) → None (không judge, không LLM).
        Bật → 1 LLM judge chấm coverage → dict chẩn đoán; lỗi/JSON hỏng → None (không
        làm hỏng job). KHÔNG viết lại summary, KHÔNG auto-repair."""
        from shared.config import get_settings
        if not get_settings().summary_coverage:
            return None
        from concurrent.futures import ThreadPoolExecutor
        from app.clients.llm_factory import ask_ai
        from services.summary.pipeline.coverage import COVERAGE_SYSTEM, judge_coverage
        timeout = self._timeout()

        def _ask(prompt):
            from app.graphs.logger import ctx_submit  # Phase 0: propagate LLM counter
            ex = ThreadPoolExecutor(max_workers=1)
            try:
                fut = ctx_submit(ex, ask_ai, prompt, system_prompt=COVERAGE_SYSTEM,
                                 model=None, feature="summary", options={"temperature": 0},
                                 usage_context=usage_context,
                                 usage_attempt_id="summary-coverage")
                return fut.result(timeout=timeout)
            finally:
                ex.shutdown(wait=False)     # timeout phải trả ngay (bài học warmup)

        return judge_coverage(record, ask_fn=_ask, enabled=True)


def get_summary_pipeline():
    return LocalSummaryPipeline()
