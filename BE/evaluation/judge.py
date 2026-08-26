"""Chấm chất lượng CÂU TRẢ LỜI bằng LLM — thước còn thiếu cho các nấc trên E3.

Vì sao cần: từ E3 trở lên, recall/MRR/nDCG **bão hoà** — E3, E4, E5, E6, E7 ra đúng
cùng một con số. Chỉ số truy hồi đo thứ hạng bằng chứng, mà NLI/CRAG/memory tree
không đụng vào thứ hạng. Không đo câu trả lời thì bốn nấc trên cùng không có gì để
hơn nhau, và chương 4 dừng ở "mọi thứ trên rerank đều vô ích" — một kết luận rút ra
từ việc dùng sai thước, không phải từ dữ liệu.

Hai chiều, mỗi chiều thang 0–1–2:

- `answer_correctness` — đối chiếu với `gold_answer` của bộ dữ liệu.
- `faithfulness` — đối chiếu với NGỮ CẢNH mà chính hệ thống đã lấy về.

Tách hai chiều là có chủ ý: hệ thống lấy nhầm đoạn rồi trả lời trung thành với đoạn
nhầm đó sẽ được `faithfulness=2, answer_correctness=0`. Gộp một điểm sẽ giấu mất
phân biệt giữa "truy hồi hỏng" và "sinh bịa" — đúng hai thứ mà thang E dựng ra để
tách nhau.

`context_relevance` trong `QA_DIMENSIONS` KHÔNG chấm ở đây: nó là thuộc tính của
truy hồi, đã có recall@6 đo rồi. Chấm lại bằng LLM chỉ thêm nhiễu.

Giới hạn phải nói rõ khi trích vào luận văn:
  - Đây là **chấm tự động**, không phải nhãn người. Nhãn người nằm ở cột
    `human_labels`, vẫn để trống. Đừng trộn hai cột.
  - Bộ chấm là một LLM khác bộ sinh (mặc định `qwen2.5:14b` chấm `qwen2.5:7b-instruct`)
    để tránh model tự chấm điểm cho chính mình, nhưng cùng họ model — vẫn còn thiên vị
    họ, chưa khử được.
  - `temperature=0` + `seed` cố định **gần** tất định, không tuyệt đối: chấm lại lần 2
    và lần 3 ra giống hệt 50/50 điểm, nhưng giữa hai lần Ollama nạp model với phân bổ
    layer GPU/CPU khác nhau thì đo được 1/50 điểm lệch. Và "tái lập được" dù sao cũng
    không có nghĩa là "đúng".

    PYTHONPATH=BE BE/.venv/Scripts/python.exe -m evaluation.judge \
      --dataset reports/evaluation/datasets/corpus_v1 \
      --index-dir reports/evaluation/indexes/R1_structure \
      --runs 2bac309b2b01 61bee0e15f0a
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
from pathlib import Path
from typing import Optional

import requests

DIMENSIONS = ["answer_correctness", "faithfulness"]
DEFAULT_MODEL = "qwen2.5:14b"
DEFAULT_SEED = 20260811
MAX_CONTEXT_CHARS = 6000
MAX_ANSWER_CHARS = 3000

HUONG_DAN = """Bạn là giám khảo chấm câu trả lời của một hệ thống hỏi đáp dựa trên tài liệu.
Chấm nghiêm. Chỉ trả về JSON, không giải thích ngoài JSON.

answer_correctness — so CÂU TRẢ LỜI với ĐÁP ÁN CHUẨN:
  2 = nêu đúng nội dung chính của đáp án chuẩn
  1 = đúng một phần: thiếu ý chính, hoặc đúng nhưng lẫn thông tin sai
  0 = sai, hoặc né không trả lời điều được hỏi

faithfulness — so CÂU TRẢ LỜI với NGỮ CẢNH được cung cấp (KHÔNG so với đáp án chuẩn):
  2 = mọi khẳng định đều truy được về ngữ cảnh
  1 = phần lớn truy được, nhưng có ít nhất một khẳng định không có trong ngữ cảnh
  0 = ý chính không có trong ngữ cảnh — hệ thống bịa

Hai chiều chấm ĐỘC LẬP. Trả lời trung thành với ngữ cảnh sai vẫn được faithfulness cao
và answer_correctness thấp.

Định dạng bắt buộc:
{"answer_correctness": <0|1|2>, "faithfulness": <0|1|2>, "ly_do": "<một câu ngắn>"}"""


class JudgeError(RuntimeError):
    """Bộ chấm không trả về điểm dùng được."""


def _host() -> str:
    return (os.getenv("OLLAMA_HOST") or "http://localhost:11434").rstrip("/")


def build_prompt(query: str, gold_answer: str, system_answer: str, context: str) -> str:
    return (
        f"CÂU HỎI:\n{query}\n\n"
        f"ĐÁP ÁN CHUẨN:\n{gold_answer}\n\n"
        f"NGỮ CẢNH HỆ THỐNG ĐÃ LẤY VỀ:\n{context[:MAX_CONTEXT_CHARS]}\n\n"
        f"CÂU TRẢ LỜI CỦA HỆ THỐNG:\n{system_answer[:MAX_ANSWER_CHARS]}"
    )


HUONG_DAN_TU_CHOI = """Bạn chấm xem một hệ thống hỏi đáp có TỪ CHỐI trả lời hay không.

Câu hỏi dưới đây là câu KHÔNG trả lời được: tài liệu nguồn không chứa đáp án, hoặc
câu hỏi quá mơ hồ. Hành vi ĐÚNG là nói rõ tài liệu không có thông tin, hoặc hỏi lại
cho rõ. Hành vi SAI là viết ra một câu trả lời như thể tài liệu có chứa đáp án.

abstained:
  1 = có từ chối: nói rõ tài liệu không chứa thông tin, hoặc yêu cầu làm rõ câu hỏi,
      và KHÔNG đưa ra kết luận nào thay thế
  0 = không từ chối: đưa ra một câu trả lời cho điều được hỏi

Rào trước rồi vẫn chốt một đáp án tính là 0, KHÔNG phải 1.
Nhắc đến chữ "không" ở giữa một câu trả lời khẳng định KHÔNG phải là từ chối.

Chỉ trả về JSON:
{"abstained": <0|1>, "ly_do": "<một câu ngắn>"}"""


def build_prompt_tu_choi(query: str, system_answer: str) -> str:
    return (f"CÂU HỎI (không trả lời được):\n{query}\n\n"
            f"CÂU TRẢ LỜI CỦA HỆ THỐNG:\n{system_answer[:MAX_ANSWER_CHARS]}")


def parse_scores(raw: str, dims: Optional[list[str]] = None,
                 thang: tuple[int, ...] = (0, 1, 2)) -> dict:
    """Đọc JSON của bộ chấm. Điểm ngoài thang là hỏng, KHÔNG kẹp về biên.

    Kẹp (`min(2, max(0, x))`) sẽ biến một câu trả lời hỏng của bộ chấm thành một điểm
    trông hợp lệ — đúng loại sai âm thầm mà cả bộ đo này dựng ra để tránh.
    """
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else text
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise JudgeError(f"không phải JSON: {text[:120]}") from exc
    if not isinstance(data, dict):
        raise JudgeError(f"JSON không phải object: {text[:120]}")
    out: dict = {}
    for dim in (dims or DIMENSIONS):
        if dim not in data:
            raise JudgeError(f"thiếu chiều '{dim}': {text[:120]}")
        try:
            v = int(data[dim])
        except (TypeError, ValueError) as exc:
            raise JudgeError(f"'{dim}' không phải số: {data[dim]!r}") from exc
        if v not in thang:
            raise JudgeError(f"'{dim}' ngoài thang {min(thang)}-{max(thang)}: {v}")
        out[dim] = v
    out["ly_do"] = str(data.get("ly_do") or "")[:300]
    return out


def cham_mot_cau(prompt: str, *, model: str, seed: int, timeout: int = 300,
                 he_thong: str = "", dims: Optional[list[str]] = None,
                 thang: tuple[int, ...] = (0, 1, 2)) -> dict:
    r = requests.post(
        f"{_host()}/api/chat",
        json={
            "model": model,
            "messages": [{"role": "system", "content": he_thong or HUONG_DAN},
                         {"role": "user", "content": prompt}],
            "stream": False,
            "format": "json",
            # num_ctx tường minh: mặc định của Ollama có thể ngắn hơn prompt, và khi
            # tràn nó CẮT ÂM THẦM phần đầu — tức là cắt mất hướng dẫn chấm.
            "options": {"temperature": 0, "seed": seed, "num_ctx": 8192},
        },
        timeout=timeout,
    )
    if r.status_code != 200:
        raise JudgeError(f"Ollama HTTP {r.status_code}: {r.text[:200]}")
    return parse_scores(((r.json() or {}).get("message") or {}).get("content") or "",
                        dims=dims, thang=thang)


def _nap_chunk_text(index_dir: Path) -> dict[int, str]:
    """chunk_id -> text. Đọc `index.json`, KHÔNG đọc `chunks.sqlite`.

    `chunks.sqlite` trong index nghiên cứu tồn tại nhưng bảng `chunks` RỖNG (0 hàng);
    text thật nằm ở `index.json`. Tra nhầm chỗ sẽ ra ngữ cảnh rỗng và mọi câu bị chấm
    faithfulness = 0 mà không có lỗi nào nổ ra.
    """
    data = json.loads((index_dir / "index.json").read_text(encoding="utf-8"))
    return {int(k): (v.get("text") or "") for k, v in data.items()}


def cham_mot_run(run_dir: Path, queries: dict[str, dict], chunk_text: dict[int, str],
                 *, model: str, seed: int) -> tuple[list[dict], list[str]]:
    ket_qua: list[dict] = []
    hong: list[str] = []
    for line in (run_dir / "per_query.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        trace = json.loads(line)
        q = queries.get(trace["query_id"])
        # Chỉ chấm câu TRẢ LỜI ĐƯỢC. Câu bẫy (insufficient_evidence/ambiguous) không có
        # đáp án chuẩn để đối chiếu — chúng đo bằng tỷ lệ từ chối, thước khác.
        if not q or not (q.get("gold_answer") or "").strip():
            continue
        context = "\n\n---\n\n".join(
            chunk_text.get(int(cid), "") for cid in (trace.get("final_evidence_ids") or [])
        )
        prompt = build_prompt(q["query"], q["gold_answer"],
                              trace.get("system_answer") or "", context)
        try:
            diem = cham_mot_cau(prompt, model=model, seed=seed)
        except JudgeError as exc:
            # Thử lại ĐÚNG một lần: lỗi hay gặp là model trả kèm chữ ngoài JSON, lần
            # sau thường sạch. Vẫn hỏng thì GHI NHẬN chứ không bịa điểm.
            try:
                diem = cham_mot_cau(prompt, model=model, seed=seed + 1)
            except JudgeError as exc2:
                hong.append(f"{trace['query_id']}: {exc2}")
                continue
        ket_qua.append({"query_id": trace["query_id"], **diem,
                        "judge_model": model, "judge_seed": seed})
    return ket_qua, hong


def cham_tu_choi_mot_run(run_dir: Path, queries: dict[str, dict],
                         *, model: str, seed: int) -> tuple[list[dict], list[str]]:
    """Chấm nhóm ngược lại: câu KHÔNG trả lời được, hệ thống có từ chối không.

    Nhóm này không có `gold_answer` nên `cham_mot_run` bỏ qua. Thước ở đây là nhị
    phân và không cần ngữ cảnh — chỉ cần biết câu trả lời có tự nhận là không biết.
    """
    ket_qua: list[dict] = []
    hong: list[str] = []
    for line in (run_dir / "per_query.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        trace = json.loads(line)
        q = queries.get(trace["query_id"])
        if not q or (q.get("gold_answer") or "").strip():
            continue  # câu có đáp án chuẩn → thuộc nhóm kia
        prompt = build_prompt_tu_choi(q["query"], trace.get("system_answer") or "")
        for lan, s in enumerate((seed, seed + 1)):
            try:
                diem = cham_mot_cau(prompt, model=model, seed=s, he_thong=HUONG_DAN_TU_CHOI,
                                    dims=["abstained"], thang=(0, 1))
            except JudgeError as exc:
                if lan:
                    hong.append(f"{trace['query_id']}: {exc}")
                continue
            ket_qua.append({"query_id": trace["query_id"], **diem,
                            "gold_status": q.get("gold_status"),
                            "judge_model": model, "judge_seed": s})
            break
    return ket_qua, hong


def _ghi_judge_raw(run_dir: Path, diem_theo_query: dict[str, dict]) -> None:
    """Bơm điểm vào cột `judge_raw` của qa.jsonl. `human_labels` KHÔNG đụng tới."""
    path = run_dir / "qa.jsonl"
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    for r in rows:
        d = diem_theo_query.get(r["query_id"])
        if d:
            r["judge_raw"] = {k: v for k, v in d.items() if k != "query_id"}
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows),
                    encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Chấm chất lượng câu trả lời bằng LLM")
    ap.add_argument("--dataset", type=Path, required=True)
    ap.add_argument("--index-dir", type=Path, required=True)
    ap.add_argument("--reports-root", type=Path, default=Path("reports/evaluation"))
    ap.add_argument("--runs", nargs="+", required=True, help="tên thư mục run")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--tu-choi", action="store_true",
                    help="chấm nhóm câu KHÔNG trả lời được (từ chối hay không) thay vì nhóm có đáp án")
    args = ap.parse_args(argv)

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from evaluation.metrics import bootstrap_ci

    queries = {}
    for line in (args.dataset / "queries.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            q = json.loads(line)
            queries[q["query_id"]] = q
    chunk_text = _nap_chunk_text(args.index_dir)

    for name in args.runs:
        run_dir = args.reports_root / "runs" / name
        exp = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))["config"]["experiment_id"]
        if args.tu_choi:
            ket_qua, hong = cham_tu_choi_mot_run(run_dir, queries, model=args.model, seed=args.seed)
            dims, ten = ["abstained"], "judge_negatives.jsonl"
        else:
            ket_qua, hong = cham_mot_run(run_dir, queries, chunk_text, model=args.model, seed=args.seed)
            dims, ten = DIMENSIONS, "judge.jsonl"
        (run_dir / ten).write_text(
            "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in ket_qua), encoding="utf-8")
        if not args.tu_choi:
            _ghi_judge_raw(run_dir, {r["query_id"]: r for r in ket_qua})

        phan = []
        for dim in dims:
            vals = [float(r[dim]) for r in ket_qua]
            ci = bootstrap_ci(vals, seed=args.seed) if vals else None
            tb = statistics.fmean(vals) if vals else float("nan")
            khoang = f"[{ci[0]:.2f}-{ci[1]:.2f}]" if ci else "[-]"
            phan.append(f"{dim} {tb:.3f} {khoang}")
        print(f"{exp:22s} n={len(ket_qua):2d}  " + "  ".join(phan))
        if hong:
            # Kêu ra: câu bị bỏ làm lệch mẫu số, im lặng bỏ là lặp lại đúng lỗi cũ
            # của `aggregate` (xem .playbook/known-issues.md).
            print(f"  !! {len(hong)} câu không chấm được: {'; '.join(hong[:3])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
