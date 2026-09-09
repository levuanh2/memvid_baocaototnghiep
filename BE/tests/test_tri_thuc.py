"""Đơn vị cho phép chiếu tri thức thuần của Phase 1C.1."""

from app.domains.documents.tri_thuc import (
    chieu_tri_thuc, diem_san_sang, dong_thoi_gian, hoat_dong_gan_day,
    key_takeaways, keywords, topics, trang_thai_hoc,
)


READY_AI = {
    "summary": {"state": "ready"}, "mindmap": {"state": "ready"},
    "studymap": {"state": "ready"}, "quiz": {"ready": True},
    "review": {"ready": True}, "index": "ready",
}


def test_key_takeaways_orders_trims_cuts_and_omits_empty():
    record = {"sections": [
        {"order": 2, "key_points": ["  second  ", ""]},
        {"order": 1, "key_points": [" first ", "x" * 140]},
    ]}
    result = key_takeaways(record)
    assert result[0] == "first"
    assert len(result[1]) <= 121
    assert result[-1] == "second"
    assert key_takeaways({"sections": []}) is None


def test_topics_deduplicate_vietnamese_accents_and_count_sources():
    result = topics(
        masteries=[{"name": "Định thời", "mastery_score": 0.2, "status": "weak"}],
        quiz_concept_tags=["dinh thoi"], review_topics=["ĐỊNH THỜI"],
        studymap_node_titles=["dinh thoi"],
    )
    assert result == [{"name": "Định thời", "sources": ["mastery", "quiz", "review", "studymap"],
                       "weight": 4, "mastery": 0.2, "status": "weak"}]


def test_topics_sort_mastery_only_as_weakest_tiebreaker():
    result = topics(masteries=[
        {"name": "strong", "mastery_score": 0.9, "status": "ok"},
        {"name": "weak", "mastery_score": 0.1, "status": "weak"},
    ])
    assert [item["name"] for item in result] == ["weak", "strong"]


def test_keywords_keep_priority_first_spelling_and_limit():
    assert keywords(topic_list=["Đồ thị"], entity_list=["do thi", "Alice"],
                    tag_list=["alice", "Tag"], gioi_han=3) == ["Đồ thị", "Alice", "Tag"]


def test_readiness_counts_artifacts_and_marks_unassessed_mastery():
    result = diem_san_sang(ai_block=READY_AI, open_count=10, recency_score=1.0)
    assert result == {"total": 70, "pipeline": 100, "engagement": 100, "mastery": 0,
                      "mastery_available": False, "missing": []}


def test_readiness_lists_missing_artifacts_in_stable_order():
    result = diem_san_sang(ai_block={"index": "ready"}, masteries=[{"mastery_score": 1}])
    assert result["missing"] == ["summary", "mindmap", "studymap", "quiz", "review"]
    assert result["mastery_available"] is True


def test_learning_status_ladder_every_rung():
    assert trang_thai_hoc(ai_block=READY_AI, masteries=[{"mastery_score": 0.8}]) == "mastered"
    assert trang_thai_hoc(ai_block=READY_AI, graded_attempts=1) == "in_progress"
    assert trang_thai_hoc(ai_block=READY_AI, last_opened_at="2026-01-01T00:00:00Z") == "explored"
    assert trang_thai_hoc(ai_block={"index": "ready"}) == "indexed"
    assert trang_thai_hoc(ai_block={}) == "untouched"


def test_timeline_omits_missing_and_garbage_without_inventing_time():
    moc = {"uploaded": "2026-01-02T00:00:00Z", "summary": None,
           "mindmap": "not-a-date", "last_opened": "2026-01-01T00:00:00Z"}
    assert dong_thoi_gian(moc=moc) == [
        {"event": "last_opened", "at": "2026-01-01T00:00:00Z"},
        {"event": "uploaded", "at": "2026-01-02T00:00:00Z"},
    ]


def test_recent_activity_is_newest_first_and_capped():
    moc = {"uploaded": "2026-01-01T00:00:00Z", "summary": "2026-01-02T00:00:00Z"}
    assert hoat_dong_gan_day(moc=moc, gioi_han=1) == [
        {"event": "summary", "at": "2026-01-02T00:00:00Z"}]


def test_projection_leaves_lazy_values_uncomputed():
    result = chieu_tri_thuc(ai_block=READY_AI, entity_list=["Entity"], tag_list=["tag"])
    assert result["suggested_questions"] is None
    assert result["related"] is None
    assert result["entities"] == ["Entity"]
    assert result["keywords"] == ["Entity", "tag"]


def test_all_public_functions_are_pure_for_same_input():
    record = {"sections": [{"order": 1, "key_points": ["one"]}]}
    moc = {"uploaded": "2026-01-01T00:00:00Z"}
    calls = [
        lambda: key_takeaways(record),
        lambda: topics(quiz_concept_tags=["one"]),
        lambda: keywords(topic_list=["one"]),
        lambda: diem_san_sang(ai_block=READY_AI),
        lambda: trang_thai_hoc(ai_block=READY_AI),
        lambda: dong_thoi_gian(moc=moc),
        lambda: hoat_dong_gan_day(moc=moc),
        lambda: chieu_tri_thuc(ai_block=READY_AI, summary_record=record, moc=moc),
    ]
    for call in calls:
        assert call() == call()
