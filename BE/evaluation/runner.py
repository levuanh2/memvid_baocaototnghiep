from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import uuid
from pathlib import Path

import yaml

from evaluation.dataset import load_jsonl, validate_dataset
from evaluation.metrics import retrieval_metrics, summarize, bootstrap_ci
from evaluation.runtime import EvaluationControls, UNCONTROLLED_SOURCES


def load_config(path: Path) -> dict:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if data.get("schema_version") != "memvid-evaluation-config-v1":
        raise ValueError("unsupported evaluation config")
    return data


def run(config_path: Path, dataset_dir: Path, reports_root: Path, *, run_id: str | None = None,
        index_dir_override: Path | None = None, experiment_id_override: str | None = None,
        representation_id_override: str | None = None) -> Path:
    cfg = load_config(config_path)
    if index_dir_override is not None:
        cfg["index_dir"] = str(index_dir_override)
    if experiment_id_override:
        cfg["experiment_id"] = experiment_id_override
    if representation_id_override:
        cfg["representation_id"] = representation_id_override
    # Hàng rào không gian vector: thang E0–E7 đã từng chạy TRỌN trên `R2_late`, một
    # index mà mọi chunk gần như trùng nhau — không có gì kêu, bảng kết quả vẫn trông
    # hợp lệ, và suýt thành kết luận "BM25 thắng dense retrieval" trong luận văn.
    # Đo trước khi chạy thì rẻ; phát hiện sau 15 giờ máy thì không.
    try:
        from evaluation.suc_khoe_index import canh_bao
        canh_bao(Path(cfg["index_dir"]))
    except Exception:
        pass   # hàng rào hỏng không được chặn thang đo
    validate_dataset(dataset_dir)
    dataset_manifest = json.loads((Path(dataset_dir) / "dataset_manifest.json").read_text(encoding="utf-8"))
    software_fixture = dataset_manifest.get("purpose", "").startswith("SOFTWARE VALIDATION ONLY")
    if dataset_manifest.get("status") != "frozen" and not software_fixture:
        raise ValueError("research dataset is not frozen; E0-E7 execution is blocked")
    controls = EvaluationControls(seed=int(cfg.get("seed", 20260811)), semantic_cache=bool(cfg["cache"]["semantic_answer"]),
                                  retrieval_cache=bool(cfg["cache"].get("retrieval", False)), hitl=bool(cfg.get("hitl", {}).get("enabled", False)))
    controls.apply_before_production_imports()
    os.environ["INDEX_DIR"] = str(Path(cfg["index_dir"]).resolve())
    os.environ["MEMORY_DIR"] = str((Path(cfg["index_dir"]) / "memory").resolve())

    # Cờ thành phần phải theo YAML, KHÔNG theo .env của máy đang chạy.
    #
    # `adapters.py` đã gác đúng bằng `cfg["nli"]["enabled"]` / `cfg["rerank"]["enabled"]`,
    # nhưng bên trong nó gọi `nli.get_nli()` và `rerank.get_reranker()` — hai hàm này
    # đọc `NLI_ENABLED` / `RERANK_ENABLED` từ môi trường và trả về NullNli /
    # IdentityReranker khi cờ tắt. Hậu quả: chạy E4_nli trên một máy có
    # `NLI_ENABLED=0` thì cổng YAML vẫn mở, `nli_filter` vẫn được gọi, nhưng engine
    # là NullNli nên KHÔNG BAO GIỜ có xung đột — E4 âm thầm ra kết quả trùng khít
    # E3_rerank và hiệu số "đóng góp của NLI" bằng 0 vì lý do sai.
    # Không có lỗi nào nổ ra. Đặt tường minh ở đây trước khi import production.
    os.environ["NLI_ENABLED"] = "1" if cfg.get("nli", {}).get("enabled") else "0"
    os.environ["RERANK_ENABLED"] = "1" if cfg.get("rerank", {}).get("enabled") else "0"
    if cfg.get("nli", {}).get("model"):
        os.environ["NLI_MODEL"] = str(cfg["nli"]["model"])
    if cfg.get("rerank", {}).get("model"):
        os.environ["RERANK_MODEL"] = str(cfg["rerank"]["model"])
    # Production imports deliberately occur only after controls are applied.
    from evaluation.adapters import EvaluationPipeline, ProductionEvaluationAdapter
    from evaluation.reproducibility import run_manifest
    from evaluation.trace import QueryTrace, append_jsonl

    rid = run_id or uuid.uuid4().hex[:12]
    run_dir = Path(reports_root) / "runs" / rid
    run_dir.mkdir(parents=True, exist_ok=False)
    index_dir = Path(cfg["index_dir"])
    index_manifest_path = index_dir / "evaluation_index_manifest.json"
    if not software_fixture:
        if not index_manifest_path.exists():
            raise ValueError(f"missing frozen representation manifest: {index_manifest_path}")
        frozen_index = json.loads(index_manifest_path.read_text(encoding="utf-8"))
        rep = frozen_index.get("representation") or {}
        if rep.get("corpus_hash") != dataset_manifest.get("corpus_hash"):
            raise ValueError("representation index corpus hash does not match frozen dataset")
    manifest = run_manifest(config=cfg, dataset_dir=dataset_dir, index_dir=index_dir)
    manifest.update({"run_id": rid, "uncontrolled_determinism": UNCONTROLLED_SOURCES})
    (run_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    pipeline = EvaluationPipeline(ProductionEvaluationAdapter(index_dir))
    index_manifest_data = json.loads(index_manifest_path.read_text(encoding="utf-8")) if index_manifest_path.exists() else {}
    late_by_doc = {str(d.get("doc_id")): bool(d.get("late_chunking_applied")) for d in index_manifest_data.get("per_document", [])}
    rows = []
    qrel_path = Path(dataset_dir) / "representation_qrels.jsonl"
    representation_qrels = load_jsonl(qrel_path) if qrel_path.exists() else []
    qrels_by_query: dict[str, set[int]] = {}
    for qrel in representation_qrels:
        if qrel.get("representation_id") == cfg.get("representation_id"):
            qrels_by_query.setdefault(qrel["query_id"], set()).add(int(qrel["chunk_id"]))
    for q in load_jsonl(Path(dataset_dir) / "queries.jsonl"):
        if q.get("split") != cfg.get("split", "test"):
            continue
        trace = QueryTrace(cfg["experiment_id"], rid, q["query_id"], q["query"], chunking_mode=cfg.get("representation_id", "canonical"))
        selected_doc_ids = q.get("selected_sources") or []
        applicable = [late_by_doc[str(doc_id)] for doc_id in selected_doc_ids if str(doc_id) in late_by_doc]
        trace.late_chunking_applied = any(applicable) if applicable else None
        try:
            trace = pipeline.run(q, cfg, trace)
        except Exception as exc:
            trace.error = {"type": type(exc).__name__, "message": str(exc)}
        append_jsonl(run_dir / "per_query.jsonl", trace.as_dict())
        metric_k = int(cfg.get("rerank", {}).get("top_n", 0)) if cfg.get("rerank", {}).get("enabled") else int(cfg["retrieval"]["top_k"])
        relevant_ids = qrels_by_query.get(q["query_id"], set(map(int, q.get("gold_evidence_chunk_ids") or [])))
        metrics = retrieval_metrics(trace.final_evidence_ids, relevant_ids, metric_k)
        row = {"query_id": q["query_id"], **metrics}
        rows.append(row)
        append_jsonl(run_dir / "retrieval.jsonl", row)
        append_jsonl(run_dir / "timing.jsonl", {"query_id": q["query_id"], **trace.timing_ms})
        append_jsonl(run_dir / "qa.jsonl", {"query_id": q["query_id"], "answer": trace.system_answer,
                                             "human_labels": None, "judge_raw": None})
    # Chỉ trung bình trên truy vấn CÓ nhãn vàng. Bộ dữ liệu cố ý cài 5 câu không
    # trả lời được (`gold_status` insufficient_evidence/ambiguous) — tài liệu
    # không chứa đáp án, hành vi đúng là từ chối. Chúng không có chunk vàng nên
    # nhận recall = 0, và gộp số 0 đó vào là chấm điểm liệt cho việc làm đúng.
    # Đo trên E0_bm25_R1: gộp cả 30 câu ra 0.6976, gộp đúng 25 câu có nhãn ra
    # 0.8371 — lệch 14 điểm phần trăm, đủ để đảo kết luận.
    cham_duoc = [r for r in rows if int(r.get("n_relevant") or 0) > 0]
    aggregate = {
        "n_queries": len(rows),
        "n_scored": len(cham_duoc),
        "n_no_gold": len(rows) - len(cham_duoc),
        "no_gold_query_ids": [r["query_id"] for r in rows if int(r.get("n_relevant") or 0) == 0],
    }
    for key in (cham_duoc[0].keys() - {"query_id", "n_relevant"}) if cham_duoc else []:
        vals = [r[key] for r in cham_duoc]
        aggregate[key] = {**summarize(vals), "ci95_bootstrap": bootstrap_ci(vals, seed=controls.seed)}
    (run_dir / "aggregate_metrics.json").write_text(json.dumps(aggregate, indent=2), encoding="utf-8")
    return run_dir


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="MemVid controlled research evaluation")
    sub = p.add_subparsers(dest="command", required=True)
    val = sub.add_parser("validate-dataset")
    val.add_argument("dataset_dir", type=Path)
    exe = sub.add_parser("run")
    exe.add_argument("--config", required=True, type=Path)
    exe.add_argument("--dataset", required=True, type=Path)
    exe.add_argument("--reports-root", type=Path, default=Path("reports/evaluation"))
    exe.add_argument("--run-id")
    exe.add_argument("--index-dir", type=Path, help="Namespaced representation index override")
    exe.add_argument("--experiment-id")
    exe.add_argument("--representation-id")
    args = p.parse_args(argv)
    if args.command == "validate-dataset":
        print(json.dumps(validate_dataset(args.dataset_dir), indent=2))
    else:
        print(run(args.config, args.dataset, args.reports_root, run_id=args.run_id,
                  index_dir_override=args.index_dir, experiment_id_override=args.experiment_id,
                  representation_id_override=args.representation_id))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
