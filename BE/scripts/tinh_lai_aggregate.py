"""Tính lại `aggregate_metrics.json` của các run CŨ — loại truy vấn không có nhãn vàng.

Vì sao cần: `retrieval_metrics` chấm câu không có chunk vàng nào thành recall = 0,
và bản `runner` cũ gộp luôn số 0 đó vào trung bình. Câu chưa gán nhãn được (bằng
chứng nằm trong hình, người duyệt không định vị nổi) KHÔNG phải một lần truy hồi
trượt. Trên E0_bm25_R1 sai số này là 0.6976 so với 0.8371 — 14 điểm phần trăm.

Bản `runner` mới đã ghi `n_relevant` theo từng hàng. Script này bù cột đó cho các
run đã chạy xong TRƯỚC thay đổi (E0–E3 trên R1 mất nhiều giờ, chạy lại chỉ để đổi
phép trung bình là phí), rồi tính lại file gộp.

    BE/.venv/Scripts/python.exe -m scripts.tinh_lai_aggregate            # chỉ xem
    BE/.venv/Scripts/python.exe -m scripts.tinh_lai_aggregate --ghi      # ghi đè

`retrieval.jsonl` được bù thêm khoá `n_relevant` (thêm khoá, không sửa số cũ).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def nhan_vang_theo_query(dataset_dir: Path, representation_id: str | None) -> dict[str, int]:
    """query_id -> số chunk vàng, theo ĐÚNG cách `runner.py` dựng `relevant_ids`."""
    def doc(p: Path):
        if not p.exists():
            return []
        return [json.loads(d) for d in p.read_text(encoding="utf-8").splitlines() if d.strip()]

    qrels: dict[str, set[int]] = {}
    for r in doc(dataset_dir / "representation_qrels.jsonl"):
        if r.get("representation_id") == representation_id:
            qrels.setdefault(r["query_id"], set()).add(int(r["chunk_id"]))

    out: dict[str, int] = {}
    for q in doc(dataset_dir / "queries.jsonl"):
        qid = q["query_id"]
        # Cùng thứ tự ưu tiên với runner: qrel theo representation TRƯỚC, không có
        # thì rơi về gold_evidence_chunk_ids của canonical.
        ids = qrels.get(qid) or set(map(int, q.get("gold_evidence_chunk_ids") or []))
        out[qid] = len(ids)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--reports-root", type=Path, default=Path("reports/evaluation"))
    ap.add_argument("--dataset", type=Path, default=Path("reports/evaluation/datasets/corpus_v1"))
    ap.add_argument("--ghi", action="store_true", help="thực sự ghi đè (mặc định chỉ xem)")
    args = ap.parse_args(argv)

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from evaluation.metrics import bootstrap_ci, summarize

    runs = sorted((args.reports_root / "runs").glob("*"))
    for run_dir in runs:
        ret = run_dir / "retrieval.jsonl"
        man = run_dir / "manifest.json"
        if not (ret.is_file() and man.is_file()):
            continue
        cfg = json.loads(man.read_text(encoding="utf-8"))["config"]
        seed = int(cfg.get("seed") or 20260811)
        so_nhan = nhan_vang_theo_query(args.dataset, cfg.get("representation_id"))

        rows = [json.loads(d) for d in ret.read_text(encoding="utf-8").splitlines() if d.strip()]
        for r in rows:
            r["n_relevant"] = int(r.get("n_relevant", so_nhan.get(r["query_id"], 0)))
        cham = [r for r in rows if r["n_relevant"] > 0]
        bo = [r["query_id"] for r in rows if r["n_relevant"] == 0]

        agg = {"n_queries": len(rows), "n_scored": len(cham), "n_no_gold": len(bo),
               "no_gold_query_ids": bo}
        for key in (cham[0].keys() - {"query_id", "n_relevant"}) if cham else []:
            vals = [r[key] for r in cham]
            agg[key] = {**summarize(vals), "ci95_bootstrap": bootstrap_ci(vals, seed=seed)}

        cu = run_dir / "aggregate_metrics.json"
        truoc = None
        if cu.is_file():
            j = json.loads(cu.read_text(encoding="utf-8"))
            k = next((x for x in j if x.startswith("recall@")), None)
            truoc = (j.get(k) or {}).get("mean") if k else None
        k2 = next((x for x in agg if x.startswith("recall@")), None)
        sau = (agg.get(k2) or {}).get("mean") if k2 else None
        print(f"{run_dir.name}  {cfg['experiment_id']:20s} n={len(rows)} chấm={len(cham)} "
              f"bỏ={len(bo)}  recall {truoc if truoc is None else round(truoc, 4)} "
              f"-> {sau if sau is None else round(sau, 4)}")

        if args.ghi:
            ret.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows),
                           encoding="utf-8")
            cu.write_text(json.dumps(agg, indent=2, ensure_ascii=False), encoding="utf-8")
    if not args.ghi:
        print("\nChạy lại với --ghi để ghi đè.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
