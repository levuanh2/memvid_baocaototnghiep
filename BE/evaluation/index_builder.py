from __future__ import annotations

import argparse
import json
import os
import statistics
from pathlib import Path

import yaml


def build(config_path: Path, documents_dir: Path | None = None, *, dataset_dir: Path | None = None,
          build_memory_tree: bool = False) -> Path:
    cfg = yaml.safe_load(Path(config_path).read_text(encoding="utf-8"))
    if cfg.get("schema_version") != "memvid-representation-config-v1":
        raise ValueError("unsupported representation config")
    file_specs = []
    canonical_by_doc: dict[str, dict] = {}
    if dataset_dir is not None:
        from evaluation.dataset import FINAL_STATUSES, load_jsonl
        manifest = json.loads((Path(dataset_dir) / "dataset_manifest.json").read_text(encoding="utf-8"))
        if manifest.get("status") not in {"corpus_frozen_annotation_in_progress", "frozen"} or not manifest.get("corpus_hash"):
            raise ValueError("dataset corpus must be frozen before building representation indexes")
        cfg["corpus_version"] = manifest["corpus_version"]
        cfg["corpus_hash"] = manifest["corpus_hash"]
        canonical_path = Path(dataset_dir) / "canonical_documents.jsonl"
        if not canonical_path.is_file():
            raise ValueError("canonical_documents.jsonl is required before index construction")
        canonical_by_doc = {row["doc_id"]: row for row in load_jsonl(canonical_path)}
        for d in load_jsonl(Path(dataset_dir) / "documents.jsonl"):
            if d.get("eligible_for_study") and d.get("annotation_status") in FINAL_STATUSES:
                if d["doc_id"] not in canonical_by_doc:
                    raise ValueError(f"missing canonical document record: {d['doc_id']}")
                file_specs.append((Path(d["source"]), d["doc_id"], d["sha256"]))
    elif documents_dir is not None:
        file_specs = [(p, p.stem, None) for p in sorted(x for x in Path(documents_dir).rglob("*") if x.is_file())]
    else:
        raise ValueError("provide documents_dir or dataset_dir")
    out = Path(cfg["index_dir"])
    if out.exists() and any(out.iterdir()):
        raise FileExistsError(f"refusing to overwrite non-empty index namespace: {out}")
    os.environ.update({
        "INDEX_DIR": str(out.resolve()), "EMBEDDING_MODEL_NAME": str(cfg["embedding_model"]),
        "MEMORY_DIR": str((out / "memory").resolve()),
        "CHUNK_SIZE": str(cfg["chunk_size"]), "CHUNK_OVERLAP": str(cfg["overlap"]),
        "LATE_CHUNKING": "1" if cfg["late_chunking"] else "0",
    })
    from langchain_community.vectorstores import FAISS
    from langchain_core.documents import Document
    from app.clients.llm_factory import get_embeddings
    from app.domains.ingest.document_loader import load_document, split_documents
    from app.domains.ingest.chunking import chunk_markdown_spans
    from evaluation.evidence import canonical_document, locate_chunks

    embeddings = get_embeddings()
    out.mkdir(parents=True, exist_ok=True)
    corpus = []
    per_doc = []
    cid = 0
    precomputed: list[tuple[str, list[float]]] = []
    metadatas = []
    for path, stable_doc_id, expected_hash in file_specs:
        if expected_hash and __import__("hashlib").sha256(path.read_bytes()).hexdigest() != expected_hash:
            raise ValueError(f"source hash changed after corpus freeze: {stable_doc_id}")
        raw_docs = load_document(str(path))
        canonical_text, page_segments = canonical_document(raw_docs)
        frozen_canonical = canonical_by_doc.get(stable_doc_id)
        canonical_hash = __import__("hashlib").sha256(canonical_text.encode("utf-8")).hexdigest()
        if frozen_canonical is not None:
            if canonical_hash != frozen_canonical.get("canonical_text_sha256") or canonical_text != frozen_canonical.get("canonical_text"):
                raise ValueError(f"canonical extraction changed after coordinate bridge: {stable_doc_id}")
        chunks, spans, headings, doc_text = [], [], [], ""
        eligible = False
        fallback = None
        if cfg["chunking_mode"] == "recursive":
            pieces = split_documents(raw_docs, int(cfg["chunk_size"]), int(cfg["overlap"]))
            chunks = [d.page_content.strip() for d in pieces if d.page_content.strip()]
            headings = ["" for _ in chunks]
            fallback = "representation_not_late_chunking"
        else:
            # Markdown files preserve headings directly. Other formats use the production
            # converter; conversion failure is recorded and falls back to recursive chunks.
            try:
                if path.suffix.lower() == ".md":
                    markdown = path.read_text(encoding="utf-8")
                else:
                    from app.domains.ingest.markdown_convert import convert_and_save
                    from app.domains.ingest.clean import clean_markdown
                    raw_md, _ = convert_and_save(str(path), md_dir=str(out / "normalized"))
                    markdown = clean_markdown(raw_md, source=path.name)
                doc_text, pieces = chunk_markdown_spans(markdown)
                chunks = [p["text"].strip() for p in pieces if p["text"].strip()]
                spans = [(p.get("start", -1), p.get("end", -1)) for p in pieces if p["text"].strip()]
                headings = [p.get("heading_path", "") for p in pieces if p["text"].strip()]
                eligible = bool(chunks) and len(spans) == len(chunks) and all(a >= 0 and b > a for a, b in spans)
            except Exception as exc:
                pieces = split_documents(raw_docs, int(cfg["chunk_size"]), int(cfg["overlap"]))
                chunks = [d.page_content.strip() for d in pieces if d.page_content.strip()]
                headings = ["" for _ in chunks]
                fallback = f"structure_conversion_failed:{type(exc).__name__}"
        applied = False
        vectors = None
        if cfg["late_chunking"] and eligible:
            try:
                from app.domains.ingest.late_chunk import get_late_chunk_encoder
                encoder = get_late_chunk_encoder(str(cfg["embedding_model"]))
                encoder.warmup()
                vectors = encoder.embed_document(doc_text, spans).tolist()
                applied = True
            except Exception as exc:
                fallback = f"late_chunking_failed:{type(exc).__name__}"
        elif cfg["late_chunking"] and not fallback:
            fallback = "not_structure_eligible"
        # Conditional late chunking is per document. Ineligible/failed documents use
        # the production embedding implementation independently; applied documents
        # retain their pooled late vectors in the same namespaced FAISS index.
        if cfg["late_chunking"] and vectors is None and chunks:
            vectors = embeddings.embed_documents(chunks)
        alignments = locate_chunks(canonical_text, chunks)
        for i, text in enumerate(chunks):
            md = {"chunk_id": cid, "source_stem": stable_doc_id, "doc_id": stable_doc_id, "source": path.name,
                  "video": path.name, "document_chunk_index": i,
                  "heading_path": headings[i] if i < len(headings) else "",
                  "canonical_source_sha256": __import__("hashlib").sha256(canonical_text.encode("utf-8")).hexdigest(),
                  **alignments[i]}
            corpus.append(Document(page_content=text, metadata=md))
            metadatas.append(md)
            if vectors is not None:
                precomputed.append((text, vectors[i]))
            cid += 1
        per_doc.append({"doc_id": stable_doc_id, "chunk_count": len(chunks),
                        "canonical_char_count": len(canonical_text), "canonical_text_sha256": canonical_hash,
                        "page_segments": page_segments,
                        "canonical_alignment_unresolved": sum(a["canonical_alignment"] == "unresolved" for a in alignments),
                        "late_chunking_eligible": eligible, "late_chunking_applied": applied,
                        "late_chunking_fallback_reason": fallback})
    if not corpus:
        raise ValueError("no indexable documents")
    store = FAISS.from_embeddings(precomputed, embeddings, metadatas=metadatas) if precomputed and len(precomputed) == len(corpus) else FAISS.from_documents(corpus, embeddings)
    store.save_local(str(out))
    meta = {str(d.metadata["chunk_id"]): {**d.metadata, "text": d.page_content} for d in corpus}
    (out / "index.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    from evaluation.reproducibility import index_manifest
    manifest = index_manifest(out, corpus_version=str(cfg["corpus_version"]), representation=cfg, per_document=per_doc)
    chunk_sizes = [len(d.page_content) for d in corpus]
    manifest["statistics"] = {"document_count": len(per_doc), "chunk_count": len(corpus),
                              "average_chunk_size_chars": statistics.fmean(chunk_sizes),
                              "median_chunk_size_chars": statistics.median(chunk_sizes),
                              "late_chunking_eligible_count": sum(d["late_chunking_eligible"] for d in per_doc),
                              "late_chunking_applied_count": sum(d["late_chunking_applied"] for d in per_doc),
                              "fallback_reasons": {reason: sum(d["late_chunking_fallback_reason"] == reason for d in per_doc)
                                                   for reason in sorted({d["late_chunking_fallback_reason"] for d in per_doc if d["late_chunking_fallback_reason"]})}}
    (out / "evaluation_index_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    if build_memory_tree:
        from app.domains.memory.tree import build_memory_tree_for_sources
        build_memory_tree_for_sources(sorted({d.metadata["source_stem"] for d in corpus}))
        from evaluation.reproducibility import content_hash
        memory_files = [p for p in (out / "memory").glob("*") if p.is_file()]
        manifest["memory_tree_hash"] = content_hash(memory_files)
        manifest["memory_tree_files"] = sorted(p.name for p in memory_files)
        (out / "evaluation_index_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--config", required=True, type=Path)
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--documents", type=Path, help="Development-only directory input")
    src.add_argument("--dataset", type=Path, help="Frozen corpus_v1 dataset directory")
    p.add_argument("--build-memory-tree", action="store_true", help="Build the production routing tree in this index namespace")
    args = p.parse_args(argv)
    print(build(args.config, args.documents, dataset_dir=args.dataset, build_memory_tree=args.build_memory_tree))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
