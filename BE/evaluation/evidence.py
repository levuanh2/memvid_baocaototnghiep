from __future__ import annotations

import hashlib
import re
import unicodedata
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

MAPPING_RULE_VERSION = "canonical-overlap-v1"
COORDINATE_BRIDGE_VERSION = "source-unit-to-canonical-v1"
DEFAULT_OVERLAP_THRESHOLD = 0.50


def normalize_evidence_text(text: str) -> str:
    """Stable source coordinate text: NFC, normalized newlines, collapsed inline space."""
    text = unicodedata.normalize("NFC", str(text or "")).replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(lines).strip()


def canonical_document(raw_docs: Iterable) -> tuple[str, list[dict]]:
    parts, segments, cursor = [], [], 0
    for ordinal, doc in enumerate(raw_docs):
        text = normalize_evidence_text(getattr(doc, "page_content", ""))
        if not text:
            continue
        if parts:
            cursor += 2
        start = cursor
        parts.append(text)
        cursor += len(text)
        md = getattr(doc, "metadata", {}) or {}
        page = md.get("page")
        segments.append({"ordinal": ordinal, "page": int(page) + 1 if isinstance(page, int) else None,
                         "char_start": start, "char_end": cursor})
    return "\n\n".join(parts), segments


def collapse_whitespace_with_offsets(text: str) -> tuple[str, list[int], list[int]]:
    """Collapse whitespace while retaining exact source character ranges.

    The returned start/end arrays map each output character to a half-open range
    in the original canonical string. Input must already be NFC so offsets remain
    coordinates in the persisted canonical document.
    """
    if unicodedata.normalize("NFC", text) != text:
        raise ValueError("canonical text must be NFC before coordinate mapping")
    output: list[str] = []
    starts: list[int] = []
    ends: list[int] = []
    index = 0
    while index < len(text):
        if text[index].isspace():
            run_start = index
            while index < len(text) and text[index].isspace():
                index += 1
            if output and index < len(text):
                output.append(" ")
                starts.append(run_start)
                ends.append(index)
            continue
        output.append(text[index])
        starts.append(index)
        ends.append(index + 1)
        index += 1
    return "".join(output), starts, ends


def _locator_key(locator: dict) -> str:
    return json.dumps(locator, ensure_ascii=False, sort_keys=True)


def canonical_record_for_document(document: dict) -> dict:
    """Rebuild the canonical text and auditable source-unit ranges for one document."""
    doc_id = str(document.get("doc_id") or "")
    source = Path(str(document.get("source") or ""))
    if not doc_id or not source.is_file():
        raise ValueError(f"invalid document identity/source: {doc_id!r} {source}")
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    if source_hash != document.get("sha256"):
        raise ValueError(f"source hash changed for {doc_id}")

    from app.domains.ingest.document_loader import load_document

    raw_docs = load_document(str(source))
    canonical_text, segments = canonical_document(raw_docs)
    if not canonical_text:
        raise ValueError(f"canonical extraction is empty for {doc_id}")
    units: list[dict] = []
    fmt = str(document.get("format") or source.suffix.lstrip(".")).lower()
    if fmt == "pdf":
        for segment in segments:
            page = segment.get("page")
            if not isinstance(page, int):
                raise ValueError(f"PDF canonical segment has no page identity for {doc_id}")
            units.append({
                "locator": {"type": "pdf_page", "page": page},
                "char_start": segment["char_start"],
                "char_end": segment["char_end"],
            })
    elif fmt == "docx":
        from app.domains.ingest.document_loader import extract_docx_blocks

        cursor = 0
        for block in extract_docx_blocks(source):
            block_text = normalize_evidence_text(block["text"])
            start = canonical_text.find(block_text, cursor)
            if start < 0:
                raise ValueError(f"DOCX block does not resolve in canonical text: {doc_id} {block['locator']}")
            end = start + len(block_text)
            units.append({"locator": block["locator"], "char_start": start, "char_end": end})
            cursor = end
    else:
        if len(segments) != 1:
            raise ValueError(f"unsupported multi-segment coordinate source for {doc_id}: {fmt}")
        units.append({
            "locator": {"type": "document"},
            "char_start": segments[0]["char_start"],
            "char_end": segments[0]["char_end"],
        })
    return {
        "schema_version": "memvid-canonical-document-v1",
        "doc_id": doc_id,
        "source": str(source),
        "source_sha256": source_hash,
        "canonical_text": canonical_text,
        "canonical_text_sha256": hashlib.sha256(canonical_text.encode("utf-8")).hexdigest(),
        "coordinate_system": "Unicode NFC canonical production extraction; half-open character offsets",
        "units": units,
    }


def bridge_span_to_canonical(span: dict, *, doc_id: str, source_unit: dict,
                             canonical_record: dict) -> dict:
    """Bridge a reviewed source-unit span to canonical half-open coordinates.

    Mapping is accepted only when document identity, source-unit text, reviewed
    offsets, evidence hash, and the complete normalized canonical unit all agree.
    """
    if source_unit.get("doc_id") != doc_id or canonical_record.get("doc_id") != doc_id:
        raise ValueError(f"document identity mismatch while bridging {doc_id}")
    source_locator = dict(span.get("locator") or {})
    if source_locator != source_unit.get("locator"):
        raise ValueError(f"source locator mismatch for {doc_id}: {source_locator}")
    unit_ranges = {_locator_key(u["locator"]): u for u in canonical_record.get("units") or []}
    unit_range = unit_ranges.get(_locator_key(source_locator))
    if unit_range is None:
        raise ValueError(f"unmappable source locator for {doc_id}: {source_locator}")

    source_text = str(source_unit.get("text") or "")
    if hashlib.sha256(source_text.encode("utf-8")).hexdigest() != source_unit.get("text_sha256"):
        raise ValueError(f"source-unit hash mismatch for {doc_id}: {source_locator}")
    if re.sub(r"\s+", " ", source_text).strip() != source_text:
        raise ValueError(f"source-unit text is not in the reviewed normalized coordinate system: {doc_id} {source_locator}")
    start, end = span.get("start_offset"), span.get("end_offset")
    if not isinstance(start, int) or not isinstance(end, int) or start < 0 or end <= start or end > len(source_text):
        raise ValueError(f"source offsets out of range for {doc_id}: {source_locator} [{start}, {end})")
    source_evidence_text = str(span.get("evidence_text") or "")
    if source_text[start:end] != source_evidence_text:
        raise ValueError(f"reviewed evidence does not match source-unit boundary for {doc_id}: {source_locator}")
    if hashlib.sha256(source_evidence_text.encode("utf-8")).hexdigest() != span.get("evidence_text_sha256"):
        raise ValueError(f"reviewed evidence hash mismatch for {doc_id}: {source_locator}")
    normalized_source_text = unicodedata.normalize("NFC", source_text)
    normalized_start = len(unicodedata.normalize("NFC", source_text[:start]))
    normalized_end = len(unicodedata.normalize("NFC", source_text[:end]))
    evidence_text = unicodedata.normalize("NFC", source_evidence_text)
    if normalized_source_text[normalized_start:normalized_end] != evidence_text:
        raise ValueError(f"NFC boundary is not stable for reviewed evidence: {doc_id} {source_locator}")

    canonical_text = str(canonical_record.get("canonical_text") or "")
    unit_start, unit_end = unit_range["char_start"], unit_range["char_end"]
    if not (0 <= unit_start < unit_end <= len(canonical_text)):
        raise ValueError(f"canonical unit boundary out of range for {doc_id}: {source_locator}")
    canonical_unit = canonical_text[unit_start:unit_end]
    flat_unit, starts, ends = collapse_whitespace_with_offsets(canonical_unit)
    if flat_unit != normalized_source_text:
        raise ValueError(f"canonical/source-unit text mismatch for {doc_id}: {source_locator}")
    canonical_start = unit_start + starts[normalized_start]
    canonical_end = unit_start + ends[normalized_end - 1]
    if not (0 <= canonical_start < canonical_end <= len(canonical_text)):
        raise ValueError(f"bridged canonical boundary out of range for {doc_id}: {source_locator}")
    bridged_slice, _, _ = collapse_whitespace_with_offsets(canonical_text[canonical_start:canonical_end])
    if bridged_slice != evidence_text:
        raise ValueError(f"bridged canonical text does not equal reviewed evidence for {doc_id}: {source_locator}")

    result = dict(span)
    result["source_evidence_text"] = source_evidence_text
    result["source_evidence_text_sha256"] = span.get("evidence_text_sha256")
    result["evidence_text"] = evidence_text
    result["evidence_text_sha256"] = hashlib.sha256(evidence_text.encode("utf-8")).hexdigest()
    result["source_locator"] = source_locator
    result["source_start_offset"] = start
    result["source_end_offset"] = end
    result["locator"] = {
        **source_locator,
        "char_start": canonical_start,
        "char_end": canonical_end,
        "coordinate_system": "canonical-document-v1",
    }
    result["coordinate_bridge"] = {
        "version": COORDINATE_BRIDGE_VERSION,
        "mapping": "exact_source_unit_to_exact_canonical_unit",
        "canonical_text_sha256": canonical_record["canonical_text_sha256"],
        "source_unit_text_sha256": source_unit["text_sha256"],
    }
    return result


def bridge_imported_spans(dataset_dir: Path, spans: list[dict], documents: list[dict] | None = None) -> tuple[list[dict], list[dict]]:
    """Bridge all imported spans, failing atomically on any unresolved mapping."""
    from evaluation.dataset import load_jsonl

    root = Path(dataset_dir)
    docs = documents if documents is not None else load_jsonl(root / "documents.jsonl")
    doc_by_id = {d["doc_id"]: d for d in docs}
    source_units = {
        (u["doc_id"], _locator_key(u["locator"])): u
        for u in load_jsonl(root / "source_units.jsonl")
    }
    records: dict[str, dict] = {}
    bridged: list[dict] = []
    for span in spans:
        doc_id = str(span.get("doc_id") or "")
        if doc_id not in doc_by_id:
            raise ValueError(f"unknown document ID in evidence span: {doc_id!r}")
        unit = source_units.get((doc_id, _locator_key(span.get("locator") or {})))
        if unit is None:
            raise ValueError(f"evidence source unit does not exist: {doc_id} {span.get('locator')}")
        if doc_id not in records:
            records[doc_id] = canonical_record_for_document(doc_by_id[doc_id])
        record = records[doc_id]
        bridged.append(bridge_span_to_canonical(span, doc_id=doc_id, source_unit=unit, canonical_record=record))
    return bridged, [records[key] for key in sorted(records)]


def validate_canonical_span(span: dict, canonical_record: dict) -> None:
    if span.get("doc_id") != canonical_record.get("doc_id"):
        raise ValueError(f"canonical span/document mismatch: {span.get('span_id')}")
    locator = span.get("locator") or {}
    start, end = locator.get("char_start"), locator.get("char_end")
    text = str(canonical_record.get("canonical_text") or "")
    if not isinstance(start, int) or not isinstance(end, int) or not (0 <= start < end <= len(text)):
        raise ValueError(f"canonical span boundary invalid: {span.get('span_id')}")
    flat, _, _ = collapse_whitespace_with_offsets(text[start:end])
    if flat != span.get("evidence_text"):
        raise ValueError(f"canonical span text mismatch: {span.get('span_id')}")
    bridge = span.get("coordinate_bridge") or {}
    if bridge.get("version") != COORDINATE_BRIDGE_VERSION or bridge.get("canonical_text_sha256") != canonical_record.get("canonical_text_sha256"):
        raise ValueError(f"canonical bridge provenance invalid: {span.get('span_id')}")


def locate_chunks(canonical_text: str, chunk_texts: list[str]) -> list[dict]:
    """Deterministic exact normalized matching; unresolved chunks are never guessed."""
    out, cursor = [], 0
    for text in chunk_texts:
        needle = normalize_evidence_text(text)
        # Structure-aware chunks may preserve Markdown heading markers that are not
        # present in the canonical plain-text extraction. Remove markers only for
        # alignment; the stored chunk text itself remains unchanged.
        needle = "\n".join(re.sub(r"^#{1,6}\s+", "", line) for line in needle.splitlines())
        pos = canonical_text.find(needle, max(0, cursor - 500)) if needle else -1
        if pos < 0 and needle:
            pos = canonical_text.find(needle)
        if pos < 0:
            out.append({"canonical_char_start": None, "canonical_char_end": None,
                        "canonical_alignment": "unresolved"})
            continue
        end = pos + len(needle)
        out.append({"canonical_char_start": pos, "canonical_char_end": end,
                    "canonical_alignment": "exact_normalized"})
        cursor = pos + 1
    return out


def project_offsets(source: str, target: str) -> list[int]:
    """Bảng quy đổi offset: `map[i]` là vị trí trong `target` ứng với offset `i` của `source`.

    Dùng để chiếu toạ độ chunk từ hệ văn bản đã cắt sang hệ canonical. Vùng giống
    nhau ánh xạ 1-1; vùng khác nhau nội suy tuyến tính giữa hai mốc, nên biên chunk
    luôn rơi vào một vị trí hợp lệ và đơn điệu không giảm.

    Dài `len(source) + 1` phần tử để `map[end]` của span cuối vẫn tra được.
    """
    import difflib

    out = [0] * (len(source) + 1)
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, source, target, autojunk=False).get_opcodes():
        rong_s, rong_t = i2 - i1, j2 - j1
        if tag == "equal":
            for k in range(rong_s):
                out[i1 + k] = j1 + k
        else:
            for k in range(rong_s):
                out[i1 + k] = j1 + (k * rong_t // rong_s if rong_s else 0)
    out[len(source)] = len(target)
    return out


def locate_chunks_by_spans(canonical_text: str, doc_text: str, spans: list[tuple[int, int]]) -> list[dict]:
    """Chiếu toạ độ chunk sang canonical bằng span mà bộ cắt ĐÃ trả về.

    Vì sao cần, thay vì `locate_chunks` tìm chuỗi con: biểu diễn structure/late cắt
    trên bản Markdown do `pymupdf4llm` sinh, mà bản đó VIẾT LẠI cấu trúc — thẻ HTML
    `<mark>`, đánh số thành `**1.**`, heading `####`. Tìm chuỗi con chính xác trong
    canonical (bản trích thô) không bao giờ khớp: đo được **1/142** chunk định vị
    được, và bóc dấu nhấn mạnh chỉ nâng lên 6/142.

    Bộ cắt vốn đã biết `doc_text[start:end] == text`, nên thông tin cần thiết luôn có
    sẵn — chỉ cần căn `doc_text` với `canonical_text` MỘT LẦN cho mỗi tài liệu rồi quy
    đổi, thay vì vứt đi rồi đi tìm lại bằng chuỗi.
    """
    if not canonical_text or not doc_text or not spans:
        return [{"canonical_char_start": None, "canonical_char_end": None,
                 "canonical_alignment": "unresolved"} for _ in spans]

    bang = project_offsets(doc_text, canonical_text)
    out: list[dict] = []
    for a, b in spans:
        if not (isinstance(a, int) and isinstance(b, int)) or a < 0 or b <= a or b > len(doc_text):
            out.append({"canonical_char_start": None, "canonical_char_end": None,
                        "canonical_alignment": "unresolved"})
            continue
        ca, cb = bang[a], bang[b]
        if cb <= ca:
            out.append({"canonical_char_start": None, "canonical_char_end": None,
                        "canonical_alignment": "unresolved"})
            continue
        out.append({"canonical_char_start": ca, "canonical_char_end": cb,
                    "canonical_alignment": "span_projection"})
    return out


def map_span_to_chunks(span: dict, chunks: list[dict], *, threshold: float = DEFAULT_OVERLAP_THRESHOLD) -> list[dict]:
    """Binary qrel mapping fixed before experiments: overlap/span_length >= 0.50.

    A chunk containing the complete normalized evidence text is also relevant. Any
    unresolved source coordinate is emitted for human resolution, not auto-labeled.
    """
    loc = span.get("locator") or {}
    a, b = loc.get("char_start"), loc.get("char_end")
    if not isinstance(a, int) or not isinstance(b, int) or b <= a:
        raise ValueError("canonical span requires valid char_start/char_end")
    span_text = normalize_evidence_text(span.get("evidence_text") or "")
    mapped = []
    for chunk in chunks:
        c, d = chunk.get("canonical_char_start"), chunk.get("canonical_char_end")
        if not isinstance(c, int) or not isinstance(d, int):
            mapped.append({"chunk_id": chunk.get("chunk_id"), "relevant": None,
                           "reason": "unresolved_chunk_alignment"})
            continue
        overlap = max(0, min(b, d) - max(a, c)) / (b - a)
        contains_fact = bool(span_text) and span_text in normalize_evidence_text(chunk.get("text") or "")
        relevant = overlap >= threshold or contains_fact
        mapped.append({"chunk_id": chunk.get("chunk_id"), "relevant": relevant,
                       "overlap_fraction_of_gold_span": overlap,
                       "reason": "complete_fact_containment" if contains_fact else "span_overlap",
                       "mapping_rule_version": MAPPING_RULE_VERSION})
    return mapped


def evidence_text_sha256(text: str) -> str:
    return hashlib.sha256(normalize_evidence_text(text).encode("utf-8")).hexdigest()


def derive_representation_qrels(dataset_dir: Path, index_dir: Path, representation_id: str) -> int:
    from evaluation.dataset import FINAL_STATUSES, load_jsonl
    from evaluation.reproducibility import code_config_snapshot, content_hash, sha256_path
    dataset_dir, index_dir = Path(dataset_dir), Path(index_dir)
    manifest = json.loads((dataset_dir / "dataset_manifest.json").read_text(encoding="utf-8"))
    if manifest.get("status") not in {"corpus_frozen_annotation_in_progress", "frozen"}:
        raise ValueError("corpus must be frozen before qrel mapping")
    index_manifest_path = index_dir / "evaluation_index_manifest.json"
    if not index_manifest_path.is_file():
        raise ValueError(f"missing immutable index manifest: {index_manifest_path}")
    index_manifest = json.loads(index_manifest_path.read_text(encoding="utf-8"))
    representation = index_manifest.get("representation") or {}
    if representation.get("representation_id") != representation_id:
        raise ValueError("representation ID does not match index manifest")
    if representation.get("corpus_hash") != manifest.get("corpus_hash"):
        raise ValueError("index corpus hash does not match dataset corpus hash")
    meta = json.loads((index_dir / "index.json").read_text(encoding="utf-8"))
    chunks = [{"chunk_id": int(cid), **row} for cid, row in meta.items() if str(cid).isdigit()]
    spans = [s for s in load_jsonl(dataset_dir / "canonical_evidence_spans.jsonl") if s.get("annotation_status") in FINAL_STATUSES]
    canonical_path = dataset_dir / "canonical_documents.jsonl"
    if not canonical_path.is_file():
        raise ValueError("canonical_documents.jsonl is required before qrel mapping")
    canonical_by_doc = {r["doc_id"]: r for r in load_jsonl(canonical_path)}
    output_path = dataset_dir / "representation_qrels.jsonl"
    existing = [r for r in load_jsonl(output_path) if r.get("representation_id") != representation_id]
    derived = []
    for span in spans:
        canonical_record = canonical_by_doc.get(span["doc_id"])
        if canonical_record is None:
            raise ValueError(f"span {span['span_id']} references missing canonical document")
        validate_canonical_span(span, canonical_record)
        doc_chunks = [c for c in chunks if c.get("doc_id") == span["doc_id"]]
        if not doc_chunks:
            raise ValueError(f"index has no chunks for span document {span['doc_id']}")
        mapped = map_span_to_chunks(span, doc_chunks)
        unresolved = [m for m in mapped if m["relevant"] is None]
        relevant = [m for m in mapped if m["relevant"] is True]
        if unresolved and not relevant:
            raise ValueError(f"span {span['span_id']} has unresolved chunk alignment and needs adjudication")
        if not relevant:
            raise ValueError(f"span {span['span_id']} maps to no relevant {representation_id} chunk")
        for m in relevant:
            chunk = next((c for c in doc_chunks if c.get("chunk_id") == m["chunk_id"]), None)
            if chunk is None or chunk.get("doc_id") != span["doc_id"]:
                raise ValueError(f"cross-document or missing chunk mapping for span {span['span_id']}")
            derived.append({"query_id": span["query_id"], "span_id": span["span_id"],
                            "doc_id": span["doc_id"], "representation_id": representation_id,
                            "chunk_id": m["chunk_id"],
                            "canonical_char_start": span["locator"]["char_start"],
                            "canonical_char_end": span["locator"]["char_end"],
                            "canonical_text_sha256": canonical_record["canonical_text_sha256"],
                            "overlap_fraction_of_gold_span": m["overlap_fraction_of_gold_span"],
                            "mapping_reason": m["reason"], "mapping_rule_version": MAPPING_RULE_VERSION,
                            "annotation_status": span["annotation_status"]})
    rows = existing + derived
    output_path.write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in rows), encoding="utf-8")
    qrel_manifest_path = dataset_dir / "qrel_manifest.json"
    old_manifest = json.loads(qrel_manifest_path.read_text(encoding="utf-8")) if qrel_manifest_path.exists() else {}
    representations = dict(old_manifest.get("representations") or {})
    representations[representation_id] = {
        "index_dir": str(index_dir),
        "index_manifest_sha256": sha256_path(index_manifest_path),
        "index_hash": index_manifest.get("index_hash"),
        "corpus_hash": manifest.get("corpus_hash"),
        "qrel_count": len(derived),
        "query_count": len({row["query_id"] for row in derived}),
        "span_count": len({row["span_id"] for row in derived}),
    }
    qrel_manifest = {
        "schema_version": "memvid-qrel-manifest-v1",
        "mapping_rule_version": MAPPING_RULE_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "corpus_hash": manifest.get("corpus_hash"),
        "canonical_documents_hash": content_hash([canonical_path]),
        "canonical_spans_hash": content_hash([dataset_dir / "canonical_evidence_spans.jsonl"]),
        "representation_qrels_sha256": sha256_path(output_path),
        "representations": representations,
        "code_config_snapshot": code_config_snapshot([
            Path(__file__), Path(__file__).with_name("index_builder.py"),
            Path(__file__).with_name("reproducibility.py"),
        ]),
    }
    qrel_manifest_path.write_text(json.dumps(qrel_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(derived)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", required=True, type=Path)
    p.add_argument("--index", required=True, type=Path)
    p.add_argument("--representation", required=True)
    args = p.parse_args()
    print(derive_representation_qrels(args.dataset, args.index, args.representation))
