"""Runs a mindmap document-export job to completion. Dispatched via
app.jobs.queue.enqueue_job — a daemon thread when QUEUE_ENABLED=false (the
production default everywhere today, see .playbook/known-issues.md's
Section 7 audit), matching every other job type in this codebase.

Re-fetches the mindmap record itself (owner-scoped) rather than trusting
anything captured at request time except the validated map_id/user_id —
node topics/notes/citations always come from this fetch, never from the
request body, so a served export can never contain fabricated content.

`format_options` arrives here ALREADY normalized by
services.mindmap.export.capabilities.normalize_options (the request route
does this before dispatch — see app/main.py's create_mindmap_export) — this
function only maps the normalized option keys onto each serializer's own
kwarg names, it never re-decides a default or re-validates a format's
allowed controls. That decision lives in exactly one place:
format_capabilities.json.
"""
from __future__ import annotations

from typing import Any, Optional

from app.domains.jobs import jobs_store
from app.domains.jobs import export_jobs
from app.domains.mindmap import store as mindmap_store
from services.mindmap.export.scope import resolve_export_scope, ExportScopeError, error_code_for, visible_snapshot_fingerprint
from services.mindmap.export.tree import build_export_tree
from services.mindmap.export.docx_serializer import serialize_docx
from services.mindmap.export.xlsx_serializer import serialize_xlsx
from services.mindmap.export.pdf_serializer import serialize_pdf_with_result


def _serialize(
    fmt: str, tree: dict, options: dict[str, Any], map_image_bytes: Optional[bytes],
    geometry_manifest: Optional[dict[str, Any]] = None,
) -> tuple[bytes, Optional[dict[str, Any]]]:
    """Returns (file_bytes, warning) -- warning is always None for docx/xlsx
    (and for a PDF request with no geometry_manifest, byte-for-byte PR #70).
    """
    content = options.get("content") or {}
    if fmt == "docx":
        return serialize_docx(
            tree, font=options.get("font", "sans"), heading_color_mode=options.get("headingColorMode", "keep"),
            orientation=options.get("orientation", "portrait"), margins=options.get("margins", "normal"),
            content=content, map_image_bytes=map_image_bytes,
        ), None
    if fmt == "xlsx":
        return serialize_xlsx(
            tree, font=options.get("font", "sans"), header_style_mode=options.get("headerStyleMode", "keep"),
            content=content,
        ), None
    if fmt == "pdf":
        result = serialize_pdf_with_result(
            tree, mode=options.get("mode", "outline"), page_size=options.get("pageSize", "A4"),
            orientation=options.get("orientation", "portrait"), single_page=bool(options.get("singlePage", False)),
            font=options.get("font", "sans"), background=options.get("background", "white"),
            branch_color_mode=options.get("branchColorMode", "keep"), margins=options.get("margins", "normal"),
            content=content, map_image_bytes=map_image_bytes, geometry_manifest=geometry_manifest,
        )
        return result.content, result.warning
    raise ValueError(f"unsupported format: {fmt}")


def run_export_job(
    job_id: str, map_id: str, user_id: Optional[str], fmt: str,
    scope_params: dict[str, Any], format_options: dict[str, Any],
    map_image_bytes: Optional[bytes] = None,
    expected_visible_fingerprint: Optional[str] = None,
    geometry_manifest: Optional[dict[str, Any]] = None,
    expected_geometry_fingerprint: Optional[str] = None,
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
            # Re-validated independently against THIS (second, worker-time)
            # fetch — classified the same way the route classifies it, not
            # collapsed into a generic "export_failed" just because it
            # surfaced here instead of at request time.
            jobs_store.update_job(job_id, status="error", error_text=str(e), error_code=error_code_for(e))
            return

        # Stale-snapshot defense (PR E, "visible" scope only) — see
        # services.mindmap.export.scope.visible_snapshot_fingerprint's own
        # docstring for exactly what this does and doesn't catch. Recomputes
        # against THIS fetch (never trusts the route's own computation) and
        # fails the job deterministically rather than silently pairing a
        # stale outline with whatever map_image_bytes the client captured.
        if scope_params.get("scope_type") == "visible" and expected_visible_fingerprint is not None:
            actual_fingerprint = visible_snapshot_fingerprint(nodes, relations, scope["included_ids"])
            if actual_fingerprint != expected_visible_fingerprint:
                jobs_store.update_job(
                    job_id, status="error",
                    error_text="Nội dung phần đang hiển thị đã thay đổi trước khi xuất hoàn tất, vui lòng thử lại",
                    error_code="stale_visible_snapshot",
                )
                return

        if jobs_store.is_cancel_requested(job_id):
            jobs_store.update_job(job_id, status="cancelled", current_node="Cancelled")
            return

        # PR H2 geometry defense. Two independent checks, same reason as the
        # visible-snapshot check above: never trust what the route already
        # validated once at request time, re-derive everything from THIS
        # fresh fetch.
        #
        # 1. Structural re-validation -- the route's own validate_manifest()
        # call only ran against the request-time scope/image. Re-running it
        # here against the worker's own fresh scope/image means a bypass of
        # route validation (or a scope that resolves differently by the time
        # the job runs) can't smuggle an out-of-bounds or wrong-id-set
        # manifest into the serializer.
        if geometry_manifest is not None:
            import fitz
            from services.mindmap.export.geometry_manifest import GeometryManifestError, validate_manifest
            rendered_ids = scope["included_ids"] | scope["context_ids"]
            try:
                decoded_pix = fitz.Pixmap(map_image_bytes) if map_image_bytes else None
            except Exception:
                decoded_pix = None
            if decoded_pix is None:
                jobs_store.update_job(
                    job_id, status="error", error_text="map_geometry_manifest cần kèm map_image_base64",
                    error_code="invalid_geometry_manifest",
                )
                return
            try:
                validate_manifest(
                    geometry_manifest, decoded_image_w=decoded_pix.width, decoded_image_h=decoded_pix.height,
                    expected_rendered_ids=rendered_ids,
                )
            except GeometryManifestError as e:
                jobs_store.update_job(job_id, status="error", error_text=str(e), error_code="invalid_geometry_manifest")
                return

        # 2. Stale-fingerprint defense -- a manifest can stay STRUCTURALLY
        # valid (ids still match) while its geometry is now describing
        # content that has since changed (topic/parent/order edited). The
        # structural check above can't catch that; this hash comparison can.
        if geometry_manifest is not None and expected_geometry_fingerprint is not None:
            from services.mindmap.export.geometry_manifest import geometry_source_fingerprint
            rendered_ids = scope["included_ids"] | scope["context_ids"]
            actual_geometry_fp = geometry_source_fingerprint(nodes, relations, rendered_ids)
            if actual_geometry_fp != expected_geometry_fingerprint:
                jobs_store.update_job(
                    job_id, status="error",
                    error_text="Cấu trúc sơ đồ đã thay đổi trước khi xuất hoàn tất, vui lòng thử lại",
                    error_code="stale_geometry_manifest",
                )
                return

        tree = build_export_tree(
            nodes, relations, scope["root_ids"], scope["included_ids"],
            map_id=map_id, title=record.get("title") or "",
            context_ids=scope["context_ids"],
            presentation_root_id=scope["presentation_root_id"],
        )
        jobs_store.update_job(job_id, progress=50, stage="serializing")

        try:
            file_bytes, warning = _serialize(fmt, tree, format_options, map_image_bytes, geometry_manifest)
        except ValueError as e:
            jobs_store.update_job(job_id, status="error", error_text=str(e), error_code="unsupported_format")
            return

        if jobs_store.is_cancel_requested(job_id):
            jobs_store.update_job(job_id, status="cancelled", current_node="Cancelled")
            return

        path = export_jobs.output_path_for(job_id, fmt)
        path.write_bytes(file_bytes)
        rendered_ids = scope["included_ids"] | scope["context_ids"]
        result = {"format": fmt, "size_bytes": len(file_bytes), "node_count": len(rendered_ids)}
        if warning is not None:
            result["warning"] = warning
        jobs_store.update_job(job_id, status="done", progress=100, stage="done", result=result)
    except Exception as exc:  # noqa: BLE001 — a job failure must land as a terminal status, never an unhandled thread crash
        jobs_store.update_job(job_id, status="error", error_text=str(exc)[:300], error_code="export_failed")
