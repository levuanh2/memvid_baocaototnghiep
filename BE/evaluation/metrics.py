from __future__ import annotations

import math
import random
import statistics
from typing import Callable, Iterable


def retrieval_metrics(ranked_ids: list[int], relevant_ids: set[int], k: int) -> dict[str, float]:
    """Đo một truy vấn. `n_relevant` đi kèm để tầng gộp biết câu nào CÓ nhãn.

    Truy vấn không có chunk vàng nào (người duyệt chưa định vị được bằng chứng —
    ví dụ nội dung nằm trong hình) rơi vào nhánh `relevant_ids` rỗng và nhận
    recall/MRR/nDCG = 0. Con số 0 đó KHÔNG phải "hệ thống truy hồi trượt", nó là
    "chưa có đáp án để đối chiếu". Gộp chung vào trung bình là tự hạ điểm mình
    bằng một lỗ hổng gán nhãn. Nên `n_relevant` phải theo hàng ra tới bảng gộp.
    """
    ranked = ranked_ids[:k]
    hits = [1 if cid in relevant_ids else 0 for cid in ranked]
    recall = sum(hits) / len(relevant_ids) if relevant_ids else 0.0
    precision = sum(hits) / k if k > 0 else 0.0
    rr = next((1.0 / rank for rank, hit in enumerate(hits, 1) if hit), 0.0)
    dcg = sum(hit / math.log2(rank + 1) for rank, hit in enumerate(hits, 1))
    ideal_hits = min(len(relevant_ids), k)
    idcg = sum(1.0 / math.log2(rank + 1) for rank in range(1, ideal_hits + 1))
    return {f"recall@{k}": recall, f"precision@{k}": precision, "mrr": rr,
            f"ndcg@{k}": dcg / idcg if idcg else 0.0, "n_relevant": len(relevant_ids)}


def summarize(values: Iterable[float]) -> dict[str, float | int | None]:
    xs = [float(x) for x in values]
    if not xs:
        return {"n": 0, "mean": None, "median": None, "std": None, "iqr": None}
    q = statistics.quantiles(xs, n=4, method="inclusive") if len(xs) > 1 else [xs[0]] * 3
    return {
        "n": len(xs), "mean": statistics.fmean(xs), "median": statistics.median(xs),
        "std": statistics.stdev(xs) if len(xs) > 1 else 0.0, "iqr": q[2] - q[0],
    }


def bootstrap_ci(values: Iterable[float], *, seed: int = 20260811, samples: int = 2000, alpha: float = 0.05) -> tuple[float, float] | None:
    xs = [float(x) for x in values]
    if not xs:
        return None
    rng = random.Random(seed)
    means = sorted(statistics.fmean(rng.choices(xs, k=len(xs))) for _ in range(samples))
    lo = means[int((alpha / 2) * (samples - 1))]
    hi = means[int((1 - alpha / 2) * (samples - 1))]
    return lo, hi


def paired_bootstrap(a: list[float], b: list[float], *, seed: int = 20260811, samples: int = 5000) -> dict:
    if len(a) != len(b) or not a:
        raise ValueError("paired samples must be non-empty and equal length")
    diffs = [float(x) - float(y) for x, y in zip(a, b)]
    ci = bootstrap_ci(diffs, seed=seed, samples=samples)
    return {"n": len(diffs), "mean_difference": statistics.fmean(diffs), "ci95": list(ci) if ci else None,
            "interpretation": "Report the interval; do not claim significance automatically."}

