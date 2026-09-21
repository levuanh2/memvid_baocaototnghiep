"""Part 18 — deterministic fixtures proving the staged pipeline actually
propagates reasoning through to the persisted structure, instead of
collapsing back to "chunk -> heading -> flat topic summary".

These fixtures cannot prove a REAL model reasons well on real documents (that
needs an eval against real provider output — out of scope here, named as a
remaining risk in the report). What they DO prove, mechanically and
deterministically: when knowledge_planner.plan_global returns a rich
conceptual plan (merged groups, typed cross-group relations, multi-source
synthesis), plan_guided actually uses it — group count collapses below raw
chunk count, relation types survive into the final relation list, and
multi-source chunks land under one shared concept group instead of one
sub-tree per source or per heading. Each fake LLM response below stands in
for "a model that reasoned correctly"; the test is about the plumbing, not
the model.
"""
import json

import services.mindmap.pipeline.knowledge_planner as kp
from services.mindmap.pipeline.guided_planner import plan_guided


def _chunk(key, heading, text, source="doc"):
    return {"chunk_keys": [key], "source_stem": source, "heading_path": heading, "text": text}


# knowledge_planner.plan_global references chunks by their 0-based POSITION
# in the list it's given (the "id=" prefix in its prompt lines) — the same
# protocol a real LLM is told to use, independent of the chunk's own
# chunk_keys (citation) value. Fixtures below build chunk_keys == position,
# so the fake LLM payload's chunk_ids and the resulting chunk_refs line up
# and stay readable.


def _fake_ask(payload):
    def _ask(user, **kwargs):
        return json.dumps(payload)
    return _ask


def _plan(monkeypatch, chunks, payload, intent=None):
    monkeypatch.setattr(kp, "ask_ai", _fake_ask(payload))
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    mm_input = {"chunks": chunks, "generation_intent": intent or {"preset": "overview", "detail_level": "balanced"}}
    return plan_guided(mm_input, model="fake-model", timeout_sec=5.0)


# --- Fixture A: process -----------------------------------------------------

def test_fixture_a_process_preserves_ordering_not_eight_unrelated_summaries(monkeypatch):
    chunks = [_chunk(str(i), "", step) for i, step in enumerate(
        ["Upload tài liệu", "Phân tích cú pháp", "Chia đoạn", "Tạo embedding",
         "Lập chỉ mục", "Truy hồi", "Xếp hạng lại", "Sinh câu trả lời"])]
    payload = {
        "central_subject": "Pipeline xử lý tài liệu",
        "groups": [
            {"name": "Chuẩn bị dữ liệu", "rationale": "upload/parse/chunk/embed đều là bước chuẩn bị",
             "chunk_ids": ["0", "1", "2", "3"]},
            {"name": "Truy hồi và sinh câu trả lời", "rationale": "index/retrieve/rerank/generate là luồng truy hồi",
             "chunk_ids": ["4", "5", "6", "7"]},
        ],
        "relations": [{"source_group": "Chuẩn bị dữ liệu", "target_group": "Truy hồi và sinh câu trả lời",
                       "type": "sequence", "label": "sau đó"}],
    }
    nodes, relations, config, missing = _plan(monkeypatch, chunks, payload,
                                              {"preset": "process", "detail_level": "balanced"})
    assert config["global_plan_used"] is True
    branches = [n for n in nodes if n["kind"] == "section"]
    # 8 raw steps collapsed into 2 conceptual groups, not 8 unrelated topics.
    assert len(branches) == 2
    assert any(r["type"] == "sequence" for r in relations)


# --- Fixture B: cause/effect -------------------------------------------------

def test_fixture_b_cause_effect_chain_preserved(monkeypatch):
    chunks = [
        _chunk("0", "", "A gây ra B."),
        _chunk("1", "", "B làm tăng C."),
        _chunk("2", "", "C dẫn đến D."),
    ]
    payload = {
        "central_subject": "Chuỗi nhân quả A-B-C-D",
        "groups": [
            {"name": "A", "rationale": "nguyên nhân gốc", "chunk_ids": ["0"]},
            {"name": "B", "rationale": "hệ quả của A, nguyên nhân của C", "chunk_ids": ["1"]},
            {"name": "C", "rationale": "hệ quả của B, nguyên nhân của D", "chunk_ids": ["2"]},
        ],
        "relations": [
            {"source_group": "A", "target_group": "B", "type": "cause_effect", "label": "gây ra"},
            {"source_group": "B", "target_group": "C", "type": "cause_effect", "label": "làm tăng"},
        ],
    }
    nodes, relations, config, missing = _plan(monkeypatch, chunks, payload)
    rel_types = {(r["type"]) for r in relations}
    assert "cause_effect" in rel_types
    # the chain survives as two distinct causal edges, not collapsed into one
    # generic "related" relation or dropped entirely.
    assert sum(1 for r in relations if r["type"] == "cause_effect") == 2


# --- Fixture C: comparison ----------------------------------------------------

def test_fixture_c_comparison_organized_by_dimension_not_per_method_summary(monkeypatch):
    chunks = [
        _chunk("0", "", "Phương pháp X có độ chính xác cao."),
        _chunk("1", "", "Phương pháp Y có độ chính xác thấp hơn."),
        _chunk("2", "", "X tốn chi phí nhiều hơn Y."),
        _chunk("3", "", "Y nhanh hơn X."),
    ]
    payload = {
        "central_subject": "So sánh phương pháp X và Y",
        "groups": [
            {"name": "Độ chính xác", "rationale": "cả hai đoạn 1,2 đều nói về accuracy", "chunk_ids": ["0", "1"]},
            {"name": "Chi phí và tốc độ", "rationale": "đoạn 3,4 nói về cost/latency", "chunk_ids": ["2", "3"]},
        ],
        "relations": [{"source_group": "Độ chính xác", "target_group": "Chi phí và tốc độ",
                       "type": "contrast", "label": "đánh đổi"}],
    }
    nodes, relations, config, missing = _plan(monkeypatch, chunks, payload,
                                              {"preset": "comparison", "detail_level": "balanced"})
    branches = [n for n in nodes if n["kind"] == "section"]
    # organized by comparison DIMENSION (2 groups), not one sub-tree per method
    # (which would need 2 groups too, but with each holding exactly the chunks
    # for its own method — assert the dimension grouping is what actually
    # happened, i.e. accuracy-related chunks 1 and 2 share a branch).
    accuracy_branch = next(n for n in nodes if n["title"] == "Độ chính xác")
    accuracy_children = [n for n in nodes if n.get("parent") == accuracy_branch["id"]]
    assert {ref for c in accuracy_children for ref in c["chunk_refs"]} == {"0", "1"}
    assert any(r["type"] == "contrast" for r in relations)


# --- Fixture D: definition + examples ----------------------------------------

def test_fixture_d_definition_and_examples_structure(monkeypatch):
    chunks = [
        _chunk("0", "", "Khái niệm được định nghĩa là..."),
        _chunk("1", "", "Ví dụ A minh hoạ khái niệm."),
        _chunk("2", "", "Ví dụ B minh hoạ khái niệm."),
    ]
    payload = {
        "central_subject": "Khái niệm chính",
        "groups": [
            {"name": "Định nghĩa", "rationale": "đoạn 1 định nghĩa khái niệm", "chunk_ids": ["0"]},
            {"name": "Ví dụ minh hoạ", "rationale": "đoạn 2,3 là ví dụ", "chunk_ids": ["1", "2"]},
        ],
        "relations": [{"source_group": "Định nghĩa", "target_group": "Ví dụ minh hoạ",
                       "type": "example", "label": "minh hoạ bằng"}],
    }
    nodes, relations, config, missing = _plan(monkeypatch, chunks, payload)
    branches = {n["title"]: n for n in nodes if n["kind"] == "section"}
    assert "Định nghĩa" in branches and "Ví dụ minh hoạ" in branches
    examples_children = [n for n in nodes if n.get("parent") == branches["Ví dụ minh hoạ"]["id"]]
    assert len(examples_children) == 2  # both examples kept under the shared examples group
    assert any(r["type"] == "example" for r in relations)


# --- Fixture E: poorly structured source (no headings) -----------------------

def test_fixture_e_poor_headings_still_produce_meaningful_branches(monkeypatch):
    # No heading_path at all on any chunk — proves grouping isn't mirroring
    # document headings, since there are none to mirror.
    chunks = [_chunk(str(i), "", text) for i, text in enumerate([
        "văn bản rời rạc một", "văn bản rời rạc hai", "văn bản rời rạc ba", "văn bản rời rạc bốn"])]
    assert all(not c["heading_path"] for c in chunks)
    payload = {
        "central_subject": "Chủ đề suy luận từ nội dung",
        "groups": [
            {"name": "Nhóm khái niệm 1", "rationale": "ngữ nghĩa liên quan", "chunk_ids": ["0", "1"]},
            {"name": "Nhóm khái niệm 2", "rationale": "ngữ nghĩa liên quan khác", "chunk_ids": ["2", "3"]},
        ],
        "relations": [],
    }
    nodes, relations, config, missing = _plan(monkeypatch, chunks, payload)
    branches = [n for n in nodes if n["kind"] == "section"]
    assert len(branches) == 2
    assert {b["title"] for b in branches} == {"Nhóm khái niệm 1", "Nhóm khái niệm 2"}
    assert "guided_global_plan_degraded" not in missing


# --- Fixture F: multi-source synthesis ---------------------------------------

def test_fixture_f_multi_source_synthesis_merges_by_concept_not_by_file(monkeypatch):
    chunks = [
        _chunk("0", "", "Vector retrieval trong paper A.", source="paper_A"),
        _chunk("1", "", "Dense retrieval trong paper B.", source="paper_B"),
        _chunk("2", "", "Embedding search trong notes.", source="notes"),
        _chunk("3", "", "Hạn chế của retrieval trong paper A.", source="paper_A"),
    ]
    payload = {
        "central_subject": "Retrieval-Augmented Generation",
        "groups": [
            {"name": "Chiến lược truy hồi", "rationale": "3 cách gọi khác nhau cùng một khái niệm truy hồi",
             "chunk_ids": ["0", "1", "2"]},
            {"name": "Hạn chế", "rationale": "đoạn 4 nói riêng về hạn chế", "chunk_ids": ["3"]},
        ],
        "relations": [],
    }
    nodes, relations, config, missing = _plan(monkeypatch, chunks, payload)
    retrieval_branch = next(n for n in nodes if n["title"] == "Chiến lược truy hồi")
    retrieval_children = [n for n in nodes if n.get("parent") == retrieval_branch["id"]]
    # merged group spans all three sources under ONE concept branch, not one
    # sub-tree per filename (paper_A / paper_B / notes).
    refs = {ref for c in retrieval_children for ref in c["chunk_refs"]}
    assert refs == {"0", "1", "2"}
    assert len(retrieval_children) == 3
    # source identity is still preserved on each child's own evidence, just
    # not used as the branch boundary.
    branches = [n for n in nodes if n["kind"] == "section"]
    assert not any(b["title"] in {"paper_A", "paper_B", "notes"} for b in branches)
