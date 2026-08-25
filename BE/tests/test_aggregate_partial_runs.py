"""`aggregate` phải bỏ qua run dở dang, không được chết kéo theo run hoàn chỉnh.

Hồi quy cho lỗi nguy hiểm nhất gặp trong đợt chạy ablation: một thí nghiệm bị dừng
tay để lại thư mục run thiếu `retrieval.jsonl`. Bản cũ ném `FileNotFoundError` và
DỪNG, nên mọi run xếp sau nó không được gộp — bảng kết quả thiếu hai thí nghiệm
hoàn chỉnh mà KHÔNG BÁO GÌ. Số cụt trông y hệt số thật.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

from evaluation.aggregate import aggregate


def _run_du(goc: Path, ten: str, exp: str, n: int = 2) -> Path:
    d = goc / "runs" / ten
    d.mkdir(parents=True)
    (d / "manifest.json").write_text(json.dumps({"config": {"experiment_id": exp}}), encoding="utf-8")
    (d / "retrieval.jsonl").write_text(
        "".join(json.dumps({"query_id": f"Q{i}", "recall@6": 1.0}) + "\n" for i in range(n)), encoding="utf-8")
    (d / "qa.jsonl").write_text(
        "".join(json.dumps({"query_id": f"Q{i}", "answer": "x"}) + "\n" for i in range(n)), encoding="utf-8")
    return d


def _run_do_dang(goc: Path, ten: str, exp: str) -> Path:
    """Giống run bị giết giữa chừng: có manifest, chưa kịp ghi kết quả."""
    d = goc / "runs" / ten
    d.mkdir(parents=True)
    (d / "manifest.json").write_text(json.dumps({"config": {"experiment_id": exp}}), encoding="utf-8")
    return d


def _doc(p: Path) -> list[dict]:
    return list(csv.DictReader(p.read_text(encoding="utf-8").splitlines()))


def test_run_do_dang_khong_lam_chet_ca_bo(tmp_path: Path):
    _run_du(tmp_path, "aaa", "E0")
    _run_do_dang(tmp_path, "bbb", "E4")      # xen GIUA, dung thu tu sorted()
    _run_du(tmp_path, "ccc", "E3")

    out = aggregate(tmp_path)
    exps = {r["experiment_id"] for r in _doc(out / "retrieval_results.csv")}
    assert exps == {"E0", "E3"}, "run sau run do dang phai van duoc gop"


def test_run_do_dang_dung_dau_van_gop_duoc_phan_sau(tmp_path: Path):
    _run_do_dang(tmp_path, "aaa", "E4")
    _run_du(tmp_path, "bbb", "E0")
    out = aggregate(tmp_path)
    assert {r["experiment_id"] for r in _doc(out / "retrieval_results.csv")} == {"E0"}


def test_thieu_mot_trong_hai_file_cung_bi_bo_qua(tmp_path: Path):
    d = _run_du(tmp_path, "aaa", "E0")
    (d / "qa.jsonl").unlink()
    _run_du(tmp_path, "bbb", "E1")
    out = aggregate(tmp_path)
    assert {r["experiment_id"] for r in _doc(out / "retrieval_results.csv")} == {"E1"}


def test_bao_ra_khi_bo_qua(tmp_path: Path, capsys):
    """Bỏ qua im lặng chính là cái bẫy — phải in ra."""
    _run_du(tmp_path, "aaa", "E0")
    _run_do_dang(tmp_path, "zzz", "E4")
    aggregate(tmp_path)
    ra = capsys.readouterr().out
    assert "BỎ QUA" in ra and "zzz" in ra


def test_khong_co_run_do_dang_thi_khong_in_gi(tmp_path: Path, capsys):
    _run_du(tmp_path, "aaa", "E0")
    aggregate(tmp_path)
    assert "BỎ QUA" not in capsys.readouterr().out


def test_so_dong_giu_nguyen_day_du(tmp_path: Path):
    _run_du(tmp_path, "aaa", "E0", n=30)
    _run_do_dang(tmp_path, "bbb", "E4")
    out = aggregate(tmp_path)
    assert len(_doc(out / "retrieval_results.csv")) == 30, "khong duoc mat dong nao cua run du"
