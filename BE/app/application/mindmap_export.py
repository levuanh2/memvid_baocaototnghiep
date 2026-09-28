"""Runs a mindmap document-export job to completion. Dispatched via
app.jobs.queue.enqueue_job — a daemon thread when QUEUE_ENABLED=false (the
production default everywhere today, see .playbook/known-issues.md's
Section 7 audit), matching every other job type in this codebase.

Re-fetches the mindmap record itself (owner-scoped) rather than trusting
anything captured at request time except the validated map_id/user_id —
node topics/notes/citations always come from this fetch, never from the
request body, so a served export can never contain fabricated content.
"""
from __future__ import annotations

from typing import Any, Optional

from app.domains.jobs import jobs_store
from app.domains.jobs import export_jobs
from app.domains.mindmap import store as mindmap_store
from services.mindmap.export.scope import resolve_export_scope, ExportScopeError
from services.mindmap.export.tree import build_export_tree
from services.mindmap.export.docx_serializer import serialize_docx
from services.mindmap.export.xlsx_serializer import serialize_xlsx
from services.mindmap.export.pdf_serializer import serialize_pdf


def run_export_job(
    job_id: str, map_id: str, user_id: Optional[str], fmt: str,
    scope_params: dict[str, Any], format_options: dict[str, Any],
    map_image_bytes: Optional[bytes] = None,
) -> None:
    jobs_store.update_job(job_id, status="running", stage="building", progress=10)
    try:
        record = (mindmap_store.get_record(map_id, user_id=user_id, enforce_owner=True)
                  if user_id else mindmap_store.get_record(map_id))
        if not record:
            jobs_store.update_job(job_id, status="error", error_text="Mind map not found", error_code="map_not_found")
            return

        nodes = record.get("nodes") or []
        relations = record.get("relations") or []
        try:
            scope = resolve_export_scope(nodes, **scope_params)
        except ExportScopeError as e:
            jobs_store.update_job(job_id, status="error", error_text=str(e), error_code="invalid_scope")
            return

        if jobs_store.is_cancel_requested(job_id):
            jobs_store.update_job(job_id, status="cancelled", current_node="Cancelled")
            return

        tree = build_export_tree(
            nodes, relations, scope["root_ids"], scope["included_ids"],
            map_id=map_id, title=record.get("title") or "",
        )
        jobs_store.update_job(job_id, progress=50, stage="serializing")

        if fmt == "docx":
            file_bytes = serialize_docx(
                tree, include_citations=format_options.get("include_citations", True),
                map_image_bytes=map_image_bytes,
            )
        elif fmt == "xlsx":
            file_bytes = serialize_xlsx(
                tree, include_citations=format_options.get("include_citations", True),
                include_relations=format_options.get("include_relations", True),
            )
        elif fmt == "pdf":
            file_bytes = serialize_pdf(
                tree, mode=format_options.get("mode", "outline"),
                page_size=format_options.get("page_size", "A4"),
                orientation=format_options.get("orientation", "portrait"),
                single_page=bool(format_options.get("single_page", False)),
                map_image_bytes=map_image_bytes,
            )
        else:
            jobs_store.update_job(job_id, status="error", error_text=f"unsupported format: {fmt}", error_code="unsupported_format")
            return

        if jobs_store.is_cancel_requested(job_id):
            jobs_store.update_job(job_id, status="cancelled", current_node="Cancelled")
            return

        path = export_jobs.output_path_for(job_id, fmt)
        path.write_bytes(file_bytes)
        jobs_store.update_job(
            job_id, status="done", progress=100, stage="done",
            result={"format": fmt, "size_bytes": len(file_bytes), "node_count": len(scope["included_ids"])},
        )
    except Exception as exc:  # noqa: BLE001 — a job failure must land as a terminal status, never an unhandled thread crash
        jobs_store.update_job(job_id, status="error", error_text=str(exc)[:300], error_code="export_failed")
