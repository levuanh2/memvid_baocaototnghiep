from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from evaluation.dataset import load_jsonl
from evaluation.trace import append_jsonl


def review(run_dir: Path, reviewer_id: str) -> Path:
    if not reviewer_id or any(x in reviewer_id for x in ("@", " ")):
        raise ValueError("reviewer_id must be a non-identifying pseudonym")
    run_dir = Path(run_dir)
    out = run_dir / "hitl_reviews.jsonl"
    for trace in load_jsonl(run_dir / "per_query.jsonl"):
        if (trace.get("hitl") or {}).get("state") != "awaiting_real_human_review":
            continue
        print(f"\n[{trace['query_id']}] {trace['original_query']}\n\nDRAFT:\n{trace['system_answer']}\n")
        started = time.perf_counter()
        action = input("Action [approve/edit/reject]: ").strip().lower()
        if action not in {"approve", "edit", "reject"}:
            raise ValueError("invalid action; no record written")
        edited = input("Edited answer: ").strip() if action == "edit" else None
        before = input("Quality before (rubric value or blank): ").strip() or None
        after = input("Quality after (rubric value or blank): ").strip() or None
        append_jsonl(out, {"schema_version": "memvid-hitl-review-v1", "reviewer_id": reviewer_id,
                           "query_id": trace["query_id"], "system_draft": trace["system_answer"], "action": action,
                           "edited_answer": edited, "review_time_ms": (time.perf_counter() - started) * 1000,
                           "quality_before": before, "quality_after": after})
    return out


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Interactive real-human review; never simulates actions")
    p.add_argument("run_dir", type=Path); p.add_argument("--reviewer-id", required=True)
    args = p.parse_args()
    print(review(args.run_dir, args.reviewer_id))
