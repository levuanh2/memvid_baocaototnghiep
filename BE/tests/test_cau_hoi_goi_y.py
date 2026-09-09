from app.domains.documents.cau_hoi_goi_y import DANH_MUC, _la_moc_thoi_gian, sinh_cau_hoi


TOPICS = [
    {"name": "Định thời", "weight": 4, "mastery": 0.2, "status": "weak"},
    {"name": "Kiến trúc", "weight": 2, "mastery": 0.8, "status": "strong"},
]
ENTITIES = ["Carbon Footprint", "Lifecycle Assessment"]
SECTIONS = [
    {"title": "Phần 1: Mở đầu", "order_index": 1, "summary": "Có tóm tắt"},
    {"title": "Chương 2", "order_index": 2, "summary": None},
]


def by_category(**kwargs):
    return {item["category"]: item for item in sinh_cau_hoi(**kwargs)}


def test_empty_inputs_emit_an_empty_computed_list():
    assert sinh_cau_hoi() == []


def test_every_fixed_category_can_be_emitted():
    broad = sinh_cau_hoi(topic_list=TOPICS, entity_list=ENTITIES, section_list=SECTIONS,
                          relation_types={"contrasts", "supports"})
    assert set(item["category"] for item in broad).issubset(DANH_MUC)
    assert len(broad) == 6
    cases = {
        "Explain": dict(topic_list=TOPICS[:1]),
        "Definitions": dict(entity_list=ENTITIES[:1]),
        "Summarize": dict(section_list=SECTIONS[:1]),
        "QuizMe": dict(topic_list=TOPICS[:1]),
        "Compare": dict(entity_list=ENTITIES),
        "Timeline": dict(section_list=SECTIONS[:1]),
        "Architecture": dict(topic_list=TOPICS[:1], relation_types={"supports"}),
        "Implementation": dict(entity_list=ENTITIES[:1]),
        "ProsCons": dict(topic_list=TOPICS[:1], relation_types={"contrasts"}),
    }
    for category, kwargs in cases.items():
        assert category in by_category(**kwargs)


def test_weak_mastery_ranks_before_other_topics_and_drives_quiz():
    result = sinh_cau_hoi(topic_list=TOPICS)
    assert result[0]["reason"]["value"] == "Định thời"
    quiz = by_category(topic_list=TOPICS)["QuizMe"]
    assert quiz["reason"] == {"source": "weak_mastery", "value": "Định thời"}
    assert quiz["confidence"] == 0.8


def test_compare_prefers_entity_pairing_before_topic_pairing():
    question = by_category(topic_list=TOPICS, entity_list=ENTITIES)["Compare"]
    assert question["reason"] == {"source": "entity", "value": "Carbon Footprint | Lifecycle Assessment"}


def test_timeline_markers_are_accent_and_case_insensitive():
    assert _la_moc_thoi_gian("GIAI ĐOẠN triển khai")
    assert _la_moc_thoi_gian("IV. Kết quả")
    assert not _la_moc_thoi_gian("Kết quả")


def test_confidence_formulas_are_bounded_and_exact():
    entity_questions = sinh_cau_hoi(entity_list=ENTITIES)
    definitions = next(item for item in entity_questions
                       if item["category"] == "Definitions" and item["reason"]["value"] == ENTITIES[0])
    implementation = next(item for item in entity_questions
                          if item["category"] == "Implementation" and item["reason"]["value"] == ENTITIES[0])
    assert definitions["confidence"] == 0.7
    assert implementation["confidence"] == 0.7
    section_questions = sinh_cau_hoi(section_list=SECTIONS)
    summarize = next(item for item in section_questions
                     if item["category"] == "Summarize" and item["reason"]["value"] == SECTIONS[0]["title"])
    assert summarize["confidence"] == 0.8
    timeline = next(item for item in section_questions if item["category"] == "Timeline")
    assert timeline["confidence"] == 0.7
    assert all(0.0 <= item["confidence"] <= 1.0 for item in sinh_cau_hoi(
        topic_list=TOPICS, entity_list=ENTITIES, section_list=SECTIONS,
        relation_types={"contrasts"},
    ))


def test_cap_breadth_stability_and_reason_shape():
    kwargs = dict(topic_list=TOPICS, entity_list=ENTITIES, section_list=SECTIONS,
                  relation_types={"contrasts", "supports"}, recent_ai=[{"event": "summary", "at": "x"}])
    first = sinh_cau_hoi(**kwargs)
    assert first == sinh_cau_hoi(**kwargs)
    assert len(first) == 6
    assert len({item["category"] for item in first}) >= 3
    assert len({item["id"] for item in first}) == len(first)
    assert all(set(item["reason"]) == {"source", "value"} and item["reason"]["value"] for item in first)


def test_duplicate_subjects_cannot_create_duplicate_ids():
    result = sinh_cau_hoi(entity_list=["Entity", "Entity"])
    assert len({item["id"] for item in result}) == len(result)


def test_missing_requirements_emit_no_placeholder():
    result = sinh_cau_hoi(topic_list=[{"name": "Only", "weight": 1, "mastery": 0.9, "status": "ok"}])
    assert {item["category"] for item in result} == {"Explain"}


def test_no_input_list_is_mutated_and_rewrite_seam_is_not_called():
    topics, entities, sections = list(TOPICS), list(ENTITIES), list(SECTIONS)
    before = (repr(topics), repr(entities), repr(sections))
    called = []
    sinh_cau_hoi(topic_list=topics, entity_list=entities, section_list=sections,
                  relation_types={"supports"}, viet_lai=lambda value: called.append(value))
    assert (repr(topics), repr(entities), repr(sections)) == before
    assert called == []
