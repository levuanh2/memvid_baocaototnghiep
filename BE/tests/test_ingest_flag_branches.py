"""Hai nhánh cấu hình của ingest chưa từng chạy lần nào — chạy thử cả hai.

Audit vòng 1 (S7) và vòng 5 (E0/E3): `USE_LC_INGEST` và `ENRICH_METADATA` đều mặc định
BẬT, và **không test nào từng đặt chúng về tắt**. Đây đúng lớp lỗi đã làm Study Map vỡ
100% ở chế độ mở: 20 test đều mở đầu bằng `_protect(...)`, nhánh còn lại chưa chạy lần
nào và nó hỏng hoàn toàn. Coverage đẹp vì đếm theo SỐ CA, không theo NHÁNH CẤU HÌNH.

Test này không khẳng định nhánh tắt "tốt hơn" — chỉ khẳng định nó CHẠY ĐƯỢC và vẫn sinh
ra chunk. Mọi dependency nặng đều được inject qua `build_ingest_graph(...)`, nên không
đụng model, FAISS hay Postgres.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.graphs.ingest_graph import build_ingest_graph


@pytest.fixture()
def chay_ingest(tmp_path, monkeypatch):
    """Trả hàm chạy graph với env cho trước; thu lại chunk đã được index."""

    def chay(**env):
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        # Tắt setdefault của env_loader để env truyền vào là thứ DUY NHẤT có hiệu lực.
        monkeypatch.setenv("MEMVID_DISABLE_LC_DEFAULTS", "1")
        monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
        import shared.config as sc
        sc.reload()

        f = tmp_path / "tai_lieu.txt"
        f.write_text("# Tieu de\n\nDoan mot noi dung.\n\n## Muc hai\n\nDoan hai noi dung.\n",
                     encoding="utf-8")

        da_index: list[dict] = []
        trang_thai: list[tuple] = []

        graph = build_ingest_graph(
            update_source_status=lambda sid, status=None, **kw: trang_thai.append((sid, status)),
            data_dir=tmp_path,
            extract_text=lambda p: Path(p).read_text(encoding="utf-8"),
            split_text=lambda t: [x for x in t.split("\n\n") if x.strip()],
            append_to_index=lambda **kw: da_index.append(kw),
            build_memory_tree_for_sources=lambda stems: None,
            jobs_update=None,
        )
        jid = f"test-{env.get('USE_LC_INGEST','x')}-{env.get('ENRICH_METADATA','x')}"
        # Graph có checkpointer sqlite -> bắt buộc truyền thread_id.
        out = graph.invoke(
            {"job_id": jid, "source_id": "src-1", "file_path": str(f),
             "filename": "tai_lieu.txt"},
            config={"configurable": {"thread_id": jid}},
        )
        return out, da_index, trang_thai

    return chay


@pytest.mark.parametrize("use_lc", ["1", "0"])
def test_ca_hai_nhanh_USE_LC_INGEST_deu_sinh_duoc_chunk(chay_ingest, use_lc):
    out, da_index, _ = chay_ingest(USE_LC_INGEST=use_lc)
    assert not out.get("error"), f"USE_LC_INGEST={use_lc} nổ: {out.get('error')}"
    assert out.get("chunks"), f"USE_LC_INGEST={use_lc} không sinh chunk nào"


@pytest.mark.parametrize("enrich", ["1", "0"])
def test_ca_hai_nhanh_ENRICH_METADATA_deu_chay(chay_ingest, enrich):
    out, _, _ = chay_ingest(ENRICH_METADATA=enrich)
    assert not out.get("error"), f"ENRICH_METADATA={enrich} nổ: {out.get('error')}"
    assert out.get("chunks"), f"ENRICH_METADATA={enrich} không sinh chunk nào"


def test_co_ENRICH_METADATA_thuc_su_doi_hanh_vi(chay_ingest):
    """Cờ phải ĐỔI được thứ gì đó, nếu không nó là cờ chết chứ không phải cờ.

    Bản đầu của test này đọc `out["chunk_metadatas"]` — KHÔNG PHẢI khoá thật (khoá là
    `doc_meta`, `ingest_graph.py:186`). Cả hai phía đều ra `{}` và khẳng định
    `m_bat != m_tat or not m_bat` vẫn xanh nhờ vế `or`. Test xanh mà không đo gì.
    Đã bỏ vế thoát và đọc đúng khoá.
    """
    bat, _, _ = chay_ingest(ENRICH_METADATA="1")
    tat, _, _ = chay_ingest(ENRICH_METADATA="0")
    meta_bat = bat.get("doc_meta") or {}
    meta_tat = tat.get("doc_meta") or {}
    assert meta_bat, f"bật ENRICH_METADATA mà doc_meta rỗng: {bat.keys()}"
    assert meta_tat == {}, f"tắt ENRICH_METADATA mà vẫn gắn metadata: {meta_tat}"
