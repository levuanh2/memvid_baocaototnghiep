from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable

from filelock import FileLock
from langgraph.graph import END, StateGraph

from app.graphs.logger import _Timer, log_node_event
from app.graphs.sqlite_checkpointer import sqlite_saver_from_path
from app.graphs.state import IngestState
from shared.source_id import canonical_source_stem

def build_ingest_graph(
    *,
    update_source_status: Callable[..., None],
    data_dir: Path,
    extract_text: Callable[[str], str],
    split_text: Callable[[str], list[str]],
    append_to_index: Callable[..., None],
    build_memory_tree_for_sources: Callable[[list[str]], None],
    jobs_update: Callable[..., None] | None = None,
) -> Any:
    """
    Build LangGraph ingest pipeline.
    - Giữ nguyên hành vi status lifecycle: processing → index_ready → ready/error
    - Ghi logs local vào logs.sqlite
    """

    def _set_job(job_id: str, **kw: Any) -> None:
        if jobs_update is None:
            return
        try:
            jobs_update(job_id, **kw)
        except Exception:
            pass

    def extract_text_node(state: dict) -> dict:
        t = _Timer()
        try:
            update_source_status(state["source_id"], "processing", progress=0.1)
            _set_job(state["job_id"], status="running", progress=10, current_node="ExtractText")
            use_lc = (os.getenv("USE_LC_INGEST", "1") or "").strip().lower() not in ("0", "false", "no", "off")
            if use_lc:
                from app.domains.ingest.document_loader import load_document
                raw_docs = load_document(state["file_path"])
                if not raw_docs:
                    raise ValueError("Cannot read file content")
                stem = Path(state["file_path"]).stem
                for doc in raw_docs:
                    doc.metadata.setdefault("source", stem)
                    doc.metadata["file_path"] = state["file_path"]
                text = "\n\n".join(d.page_content for d in raw_docs)
                if not (text or "").strip():
                    raise ValueError("Cannot read file content")
                log_node_event(state["job_id"], "ExtractText", "ok", t.ms(), {"chars": len(text), "lc_docs": len(raw_docs)})
                return {
                    **state,
                    "text": text,
                    "raw_docs": raw_docs,
                    "progress": 10,
                    "current_node": "ExtractText",
                    "error": None,
                }
            text = extract_text(state["file_path"])
            if not (text or "").strip():
                raise ValueError("Cannot read file content")
            log_node_event(state["job_id"], "ExtractText", "ok", t.ms(), {"chars": len(text)})
            return {**state, "text": text, "progress": 10, "current_node": "ExtractText", "error": None}
        except Exception as e:
            log_node_event(state["job_id"], "ExtractText", "error", t.ms(), {"error": str(e)})
            return {**state, "error": str(e), "current_node": "ExtractText"}

    def normalize_node(state: dict) -> dict:
        """Raw -> Markdown (giữ heading/bảng) + làm sạch + lưu .md artifact.
        Lỗi ở đây KHÔNG chặn pipeline: để trống markdown -> chunk fallback text cũ."""
        t = _Timer()
        try:
            _set_job(state["job_id"], progress=20, current_node="Normalize")
            from shared.config import get_settings
            s = get_settings()
            markdown = ""
            md_path = ""
            if s.use_markdown_ingest:
                try:
                    from app.domains.ingest.markdown_convert import convert_and_save
                    from app.domains.ingest.clean import clean_markdown
                    raw_md, md_path = convert_and_save(state["file_path"], md_dir=s.md_dir or None)
                    markdown = clean_markdown(raw_md, source=state.get("filename"))
                except Exception as exc:
                    log_node_event(state["job_id"], "Normalize", "warn", t.ms(), {"fallback": str(exc)})
                    markdown = ""
            log_node_event(state["job_id"], "Normalize", "ok", t.ms(), {"md_chars": len(markdown)})
            return {**state, "markdown": markdown, "md_path": md_path, "progress": 20, "current_node": "Normalize", "error": None}
        except Exception:
            return {**state, "markdown": "", "progress": 20, "current_node": "Normalize", "error": None}

    def chunk_node(state: dict) -> dict:
        t = _Timer()
        try:
            update_source_status(state["source_id"], "processing", progress=0.3)
            _set_job(state["job_id"], progress=30, current_node="Chunk")
            from shared.config import get_settings
            s = get_settings()
            use_lc = (os.getenv("USE_LC_INGEST", "1") or "").strip().lower() not in ("0", "false", "no", "off")
            markdown = state.get("markdown") or ""
            chunk_headings: list[str] = []
            doc_text = ""           # hệ toạ độ char cho late chunking (chỉ nhánh markdown)
            spans: list = []        # span (start,end) trong doc_text, aligned với chunks

            if markdown and s.chunk_strategy == "markdown_header":
                # Structured: cắt theo heading; Enriched: contextual + hypo-QA (gate trong enrich)
                from app.domains.ingest.chunking import chunk_markdown_spans
                from app.domains.ingest import enrich
                doc_text, pieces = chunk_markdown_spans(markdown)
                doc_context = doc_text[:2000]
                chunks = []
                for p in pieces:
                    txt = enrich.contextualize(p["text"], doc_context)
                    qa = enrich.hypothetical_qa(p["text"])
                    if qa:
                        txt = txt + "\n\n" + qa
                    if txt.strip():
                        chunks.append(txt)
                        chunk_headings.append(p.get("heading_path", ""))
                        spans.append((p.get("start", -1), p.get("end", -1)))
            elif use_lc and state.get("raw_docs"):
                from app.domains.ingest.document_loader import split_documents
                chunk_size = int(os.getenv("CHUNK_SIZE", "500"))
                chunk_overlap = int(os.getenv("CHUNK_OVERLAP", "50"))
                lc_chunks = split_documents(state["raw_docs"], chunk_size, chunk_overlap)
                chunks = [c.page_content.strip() for c in lc_chunks if (c.page_content or "").strip()]
            else:
                chunks = split_text(state["text"])

            if not chunks:
                raise ValueError("No chunks generated")

            # Doc-level metadata (rẻ, không cần LLM): source/category/date/language — áp cho mọi chunk.
            doc_meta: dict[str, Any] = {}
            if s.enrich_metadata:
                from app.domains.ingest import enrich as _enrich
                dm = _enrich.attach_metadata(
                    state.get("text") or chunks[0],
                    source=state.get("filename") or "",
                    file_path=state.get("file_path"),
                )
                dm.pop("heading_path", None)
                dm.pop("page", None)
                doc_meta = dm

            # LATE CHUNKING: embed token TOÀN VĂN (doc_text) rồi mean-pool theo span →
            # mỗi vector "thấm" ngữ cảnh toàn cục. Chỉ nhánh markdown (có doc_text+spans).
            # CI/lỗi/encoder không sẵn → bỏ qua (late_embeddings=None) → EmbedAndIndex tự encode.
            late_embeddings = None
            late_chunking_eligible = bool(chunks and spans and len(spans) == len(chunks))
            late_chunking_fallback_reason = None
            if chunks and spans and len(spans) == len(chunks) and os.getenv("SKIP_MODEL_LOAD") != "1":
                try:
                    from app.domains.ingest.late_chunk import get_late_chunk_encoder
                    enc = get_late_chunk_encoder()
                    enc.warmup()  # nạp model NGOÀI mọi timeout (bài học playbook)
                    safe_spans = [(max(s0, 0), max(e0, 0)) for (s0, e0) in spans]
                    arr = enc.embed_document(doc_text, safe_spans)
                    # piece không định vị được (start<0) → fallback embed standalone (tránh vector 0)
                    for i, (s0, e0) in enumerate(spans):
                        if s0 < 0 or e0 <= s0:
                            arr[i] = enc.embed_query(chunks[i])[0]
                    late_embeddings = [row.tolist() for row in arr]
                    log_node_event(state["job_id"], "Chunk", "late_chunk_ok", t.ms(), {"vecs": len(late_embeddings)})
                except Exception as le:
                    log_node_event(state["job_id"], "Chunk", "late_chunk_skip", t.ms(), {"reason": str(le)})
                    late_embeddings = None
                    late_chunking_fallback_reason = f"encoder_error:{type(le).__name__}"
            elif not late_chunking_eligible:
                late_chunking_fallback_reason = "not_structure_eligible"
            elif os.getenv("SKIP_MODEL_LOAD") == "1":
                late_chunking_fallback_reason = "model_load_disabled"

            log_node_event(state["job_id"], "Chunk", "ok", t.ms(), {"chunks": len(chunks), "md": bool(markdown)})
            return {
                **state,
                "chunks": chunks,
                "chunk_headings": chunk_headings,
                "doc_meta": doc_meta,
                "late_embeddings": late_embeddings,
                "late_chunking_eligible": late_chunking_eligible,
                "late_chunking_applied": late_embeddings is not None,
                "late_chunking_fallback_reason": late_chunking_fallback_reason,
                "progress": 30,
                "current_node": "Chunk",
                "error": None,
            }
        except Exception as e:
            log_node_event(state["job_id"], "Chunk", "error", t.ms(), {"error": str(e)})
            return {**state, "error": str(e), "current_node": "Chunk"}

    def _persist_sections_and_chunks(state, chunks, headings, faiss_ids, t) -> None:
        """Ghi sections + document_chunks vào Postgres (FR-03.4 → FR-03.9).

        FAISS vẫn là chỉ mục tìm kiếm; Postgres giữ dữ liệu nghiệp vụ và là nơi
        quiz/review truy ngược về nguồn. Lỗi ở đây KHÔNG chặn pipeline — index đã
        ghi xong, chat vẫn chạy; chỉ log lại để biết mà chữa.
        """
        try:
            from app.domains.documents import repository as docs_repo
            from app.domains.documents.sections import build_sections
            from shared.config import get_settings

            sections, chunk_keys = build_sections(
                [(headings[i] if i < len(headings) else "") for i in range(len(chunks))]
            )
            key_to_id = docs_repo.replace_sections(state["source_id"], sections)

            s_cfg = get_settings()
            ids = list(faiss_ids or [])
            rows = []
            for i, text in enumerate(chunks):
                key = chunk_keys[i] if i < len(chunk_keys) else None
                rows.append({
                    "chunk_index": i,
                    "text": text,
                    "heading": (headings[i] if i < len(headings) else "") or None,
                    "token_count": len(text.split()),
                    "section_id": key_to_id.get(key) if key else None,
                    "embedding_id": ids[i] if i < len(ids) else None,
                    "embedding_model": s_cfg.embedding_model_name,
                    "embedding_dim": (len(state["late_embeddings"][0])
                                      if state.get("late_embeddings") else None),
                })
            n = docs_repo.replace_chunks(state["source_id"], rows)
            docs_repo.set_counts(
                state["source_id"],
                char_count=sum(len(c) for c in chunks),
                chunk_count=n,
            )
            log_node_event(state["job_id"], "PersistDocument", "ok", t.ms(),
                           {"sections": len(sections), "chunks": n})
        except Exception as exc:
            log_node_event(state["job_id"], "PersistDocument", "error", t.ms(),
                           {"error": str(exc)})
            print(f"⚠️ [ingest] Không ghi được sections/chunks vào DB: {exc}")

    def embed_index_node(state: dict) -> dict:
        t = _Timer()
        try:
            update_source_status(state["source_id"], "processing", progress=0.5)
            _set_job(state["job_id"], progress=75, current_node="EmbedAndIndex")

            all_chunks = state["chunks"]
            doc_meta = state.get("doc_meta") or {}
            headings = state.get("chunk_headings") or []
            # Định danh canonical ghi thẳng vào metadata để retrieval khớp CHÍNH XÁC.
            src_stem = canonical_source_stem(state["filename"])
            all_metadata = []
            for i, _chunk in enumerate(all_chunks):
                md = {
                    "source_stem": src_stem,
                    "source_id": state.get("source_id"),
                    "chunk_index": i,
                }
                if doc_meta:
                    md.update(doc_meta)  # source/category/date/language (doc-level)
                if i < len(headings) and headings[i]:
                    md["heading_path"] = headings[i]
                all_metadata.append(md)

            # LATE CHUNKING: vector mean-pool theo span, 1 vector / 1 chunk (cùng thứ tự).
            late = state.get("late_embeddings")
            embeddings = None
            if late:
                try:
                    import numpy as _np
                    if len(late) == len(all_chunks):
                        embeddings = _np.asarray(late, dtype="float32")
                except Exception as ee:
                    log_node_event(state["job_id"], "EmbedAndIndex", "late_map_skip", t.ms(), {"reason": str(ee)})
                    embeddings = None

            if embeddings is not None:
                faiss_ids = append_to_index(
                    chunks=all_chunks,
                    source_name=src_stem,
                    custom_metadata=all_metadata,
                    batch_size=32,
                    embeddings=embeddings,
                )
            else:
                # CI/không có late vector → tự encode trong append_to_index.
                faiss_ids = append_to_index(
                    chunks=all_chunks,
                    source_name=src_stem,
                    custom_metadata=all_metadata,
                    batch_size=32,
                )

            _persist_sections_and_chunks(state, all_chunks, headings, faiss_ids, t)

            source_stem = src_stem
            update_source_status(
                state["source_id"],
                status="index_ready",
                progress=0.7,
                substatus="faiss_ready",
                capabilities={"chunk_query": True, "memory_query": False},
            )

            log_node_event(state["job_id"], "EmbedAndIndex", "ok", t.ms(), {"chunks": len(all_chunks)})
            return {**state, "source_stem": source_stem, "progress": 75, "current_node": "EmbedAndIndex", "error": None}
        except Exception as e:
            log_node_event(state["job_id"], "EmbedAndIndex", "error", t.ms(), {"error": str(e)})
            return {**state, "error": str(e), "current_node": "EmbedAndIndex"}

    def memory_tree_node(state: dict) -> dict:
        t = _Timer()
        try:
            _set_job(state["job_id"], progress=90, current_node="BuildMemoryTree")
            update_source_status(
                state["source_id"],
                status="index_ready",
                progress=0.8,
                substatus="building_memory_tree",
            )

            lock_path = str(data_dir / "memory_tree.lock")
            with FileLock(lock_path):
                build_memory_tree_for_sources([state["source_stem"]])

            update_source_status(
                state["source_id"],
                status="ready",
                progress=1.0,
                substatus="memory_tree_ready",
                capabilities={"chunk_query": True, "memory_query": True},
            )

            log_node_event(state["job_id"], "BuildMemoryTree", "ok", t.ms())
            return {**state, "progress": 90, "current_node": "BuildMemoryTree", "error": None}
        except Exception as e:
            log_node_event(state["job_id"], "BuildMemoryTree", "error", t.ms(), {"error": str(e)})
            # Không revert status về processing; giữ index_ready và gắn lỗi
            try:
                update_source_status(
                    state["source_id"],
                    status="index_ready",
                    progress=0.8,
                    substatus="memory_tree_failed",
                    capabilities={"chunk_query": True, "memory_query": False},
                    error=str(e),
                )
            except Exception:
                pass
            return {**state, "error": str(e), "current_node": "BuildMemoryTree"}

    def finalize_node(state: dict) -> dict:
        _set_job(state["job_id"], status="done", progress=100, current_node="Finalize")
        log_node_event(state["job_id"], "Finalize", "ok", 0.0)
        return {**state, "progress": 100, "current_node": "Finalize"}

    def error_handler_node(state: dict) -> dict:
        raw = state.get("error")
        err = (str(raw).strip() if raw is not None else "") or "unknown error"
        _set_job(state["job_id"], status="error", progress=0, current_node="ErrorHandler", error_text=err)
        log_node_event(state["job_id"], "ErrorHandler", "error", 0.0, {"error": err})
        try:
            update_source_status(state["source_id"], status="error", progress=0.0, error=err)
        except Exception:
            pass
        return {**state, "current_node": "ErrorHandler"}

    # LangGraph không cho router trả về '' — key phải có trong mapping conditional_edges.
    def _route_err_or_continue(s: dict) -> str:
        return "ErrorHandler" if s.get("error") else "Continue"

    g = StateGraph(IngestState)
    g.add_node("ExtractText", extract_text_node)
    g.add_node("Normalize", normalize_node)
    g.add_node("Chunk", chunk_node)
    g.add_node("EmbedAndIndex", embed_index_node)
    g.add_node("BuildMemoryTree", memory_tree_node)
    g.add_node("Finalize", finalize_node)
    g.add_node("ErrorHandler", error_handler_node)

    g.set_entry_point("ExtractText")
    for node_name, next_name in (
        ("ExtractText", "Normalize"),
        ("Normalize", "Chunk"),
        ("Chunk", "EmbedAndIndex"),
        ("EmbedAndIndex", "BuildMemoryTree"),
        ("BuildMemoryTree", "Finalize"),
    ):
        g.add_conditional_edges(
            node_name,
            _route_err_or_continue,
            {"ErrorHandler": "ErrorHandler", "Continue": next_name},
        )
    g.add_edge("Finalize", END)
    g.add_edge("ErrorHandler", END)

    checkpointer = sqlite_saver_from_path(data_dir / "checkpoints.sqlite")
    return g.compile(checkpointer=checkpointer)

