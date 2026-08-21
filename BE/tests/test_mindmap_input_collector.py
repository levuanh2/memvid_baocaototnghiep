import json
from app.domains.mindmap import input_collector as ic
from app.domains.vectorstore import chunk_text_store


def _write_meta(tmp_path, meta):
    p = tmp_path / "index.json"
    p.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return p


def test_collects_matching_source_with_store_text(tmp_path, monkeypatch):
    monkeypatch.setattr(chunk_text_store, "get_text", lambda cid: f"text-{cid}")
    meta = {
        "0": {"source_stem": "bao_cao_docx", "heading_path": "1. Mở đầu"},
        "1": {"source_stem": "khac_docx"},
    }
    out = ic.collect_mindmap_input(_write_meta(tmp_path, meta), ["bao_cao_docx"])
    assert out["sources"] == ["bao_cao_docx"]
    assert len(out["chunks"]) == 1
    c = out["chunks"][0]
    assert c["text"] == "text-0" and c["heading_path"] == "1. Mở đầu" and c["chunk_keys"] == ["0"]


def test_tree_sections_included(tmp_path, monkeypatch):
    monkeypatch.setattr(chunk_text_store, "get_text", lambda cid: "t")
    monkeypatch.setattr(ic, "_load_tree_sections", lambda stems: [{"title": "Tổng quan", "chunk_refs": ["0"]}])
    meta = {"0": {"source_stem": "a_docx"}}
    out = ic.collect_mindmap_input(_write_meta(tmp_path, meta), ["a_docx"])
    assert out["tree_sections"] == [{"title": "Tổng quan", "chunk_refs": ["0"]}]


def test_title_single_vs_multi(tmp_path, monkeypatch):
    monkeypatch.setattr(chunk_text_store, "get_text", lambda cid: "t")
    p = _write_meta(tmp_path, {"0": {"source_stem": "bao_cao_docx"}})
    assert ic.collect_mindmap_input(p, ["bao_cao.docx"])["title"] == "bao_cao"
    out = ic.collect_mindmap_input(p, ["a.docx", "b.docx", "c.docx", "d.docx"])
    assert out["title"].startswith("Tổng hợp:")


def test_collects_pointer_metadata_when_present_additive(tmp_path, monkeypatch):
    # Summary v3 Phase 2: page/source_id/chunk_index propagate KHI CÓ; vắng khi thiếu.
    # Field mindmap (heading_path/chunk_keys/text) KHÔNG đổi → skeleton vẫn build được.
    monkeypatch.setattr(chunk_text_store, "get_text", lambda cid: f"t{cid}")
    meta = {
        "0": {"source_stem": "a_docx", "heading_path": "1. A",
              "source_id": "src-a", "page": 3, "chunk_index": 12},
        "1": {"source_stem": "a_docx", "heading_path": "2. B"},   # thiếu page/source_id/chunk_index
    }
    out = ic.collect_mindmap_input(_write_meta(tmp_path, meta), ["a_docx"])
    by_key = {c["key"]: c for c in out["chunks"]}
    c0 = by_key["0"]
    assert c0["source_stem"] == "a_docx" and c0["source_id"] == "src-a"
    assert c0["page"] == 3 and c0["chunk_index"] == 12
    assert c0["heading_path"] == "1. A" and c0["chunk_keys"] == ["0"]   # mindmap fields intact
    c1 = by_key["1"]
    assert "page" not in c1 and "source_id" not in c1 and "chunk_index" not in c1  # additive
    assert c1["source_stem"] == "a_docx"


def test_skips_entries_without_source_stem(tmp_path, monkeypatch):
    monkeypatch.setattr(chunk_text_store, "get_text", lambda cid: f"t{cid}")
    meta = {
        "0": {"source_stem": "a_docx"},
        "1": {"heading_path": "không có source_stem"},
        "__meta__": {"num_chunks": 2},
    }
    out = ic.collect_mindmap_input(_write_meta(tmp_path, meta), ["a_docx"])
    assert [c["key"] for c in out["chunks"]] == ["0"]
