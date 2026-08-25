from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from evaluation.dataset import load_jsonl


def aggregate(reports_root: Path) -> Path:
    root = Path(reports_root)
    result_dir = root / "results"
    result_dir.mkdir(parents=True, exist_ok=True)
    retrieval, qa, ablations, aggregate_metrics = [], [], [], {}
    bo_qua: list[str] = []
    for run_dir in sorted((root / "runs").glob("*")):
        if not run_dir.is_dir() or not (run_dir / "manifest.json").exists():
            continue
        # Run DỞ DANG (bị giết giữa chừng, hết pin, Ctrl+C) thiếu retrieval.jsonl/qa.jsonl.
        # Bản cũ ném FileNotFoundError và CHẾT — kéo theo mọi run phía sau không được gộp,
        # nên báo cáo ra thiếu số mà KHÔNG BÁO GÌ. Đã thực sự xảy ra: một thí nghiệm bị
        # dừng tay làm hai thí nghiệm hoàn chỉnh sau nó biến mất khỏi bảng kết quả.
        thieu = [t for t in ("retrieval.jsonl", "qa.jsonl") if not (run_dir / t).exists()]
        if thieu:
            bo_qua.append(f"{run_dir.name} (thiếu {', '.join(thieu)})")
            continue
        manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
        experiment = manifest["config"]["experiment_id"]
        for row in load_jsonl(run_dir / "retrieval.jsonl"):
            retrieval.append({"run_id": run_dir.name, "experiment_id": experiment, **row})
        for row in load_jsonl(run_dir / "qa.jsonl"):
            qa.append({"run_id": run_dir.name, "experiment_id": experiment, **row})
        agg_path = run_dir / "aggregate_metrics.json"
        if agg_path.exists():
            aggregate_metrics[run_dir.name] = {"experiment_id": experiment, "metrics": json.loads(agg_path.read_text(encoding="utf-8"))}
            ablations.append({"run_id": run_dir.name, "experiment_id": experiment, "representation_id": manifest["config"].get("representation_id")})
    def write_csv(name, rows):
        path = result_dir / name
        fields = sorted({k for row in rows for k in row})
        with path.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader(); writer.writerows(rows)
    write_csv("retrieval_results.csv", retrieval)
    write_csv("qa_results.csv", qa)
    write_csv("ablation_results.csv", ablations)
    (result_dir / "aggregate_metrics.json").write_text(json.dumps(aggregate_metrics, indent=2), encoding="utf-8")
    # Kêu ra thay vì bỏ qua im lặng: người đọc bảng phải biết có run nào không được tính.
    if bo_qua:
        print("[aggregate] BỎ QUA %d run dở dang: %s" % (len(bo_qua), "; ".join(bo_qua)))
    return result_dir


if __name__ == "__main__":
    p = argparse.ArgumentParser(); p.add_argument("reports_root", type=Path, nargs="?", default=Path("reports/evaluation"))
    print(aggregate(p.parse_args().reports_root))
