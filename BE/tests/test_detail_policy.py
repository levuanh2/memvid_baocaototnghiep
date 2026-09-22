"""P2 fix: detail_level must have one source of truth, and its structural
budgets must be monotonic (compact <= balanced <= detailed), with compact
structurally forbidding the 3rd "detail" tier via max_grandchildren=0."""
from services.mindmap.pipeline.detail_policy import get_detail_policy


def test_budgets_monotonic_across_tiers():
    low, med, high = get_detail_policy("compact"), get_detail_policy("balanced"), get_detail_policy("detailed")
    for key in ("node_budget", "chunk_budget", "max_children_per_branch", "max_grandchildren"):
        assert low[key] <= med[key] <= high[key], key


def test_compact_forbids_third_tier():
    assert get_detail_policy("compact")["max_grandchildren"] == 0


def test_detailed_allows_third_tier():
    assert get_detail_policy("detailed")["max_grandchildren"] > 0


def test_unknown_or_missing_detail_level_defaults_to_balanced():
    assert get_detail_policy(None) == get_detail_policy("balanced")
    assert get_detail_policy("nonsense") == get_detail_policy("balanced")


def test_enrich_no_longer_has_hardcoded_child_caps():
    """Regression guard: enrich.py's _parse must read caps from the policy,
    not from a hardcoded 5/3 (or any other literal) independent of
    detail_level — this was the actual P2 root cause."""
    import inspect
    from services.mindmap.pipeline import enrich
    source = inspect.getsource(enrich._enrich_one)
    assert "get_detail_policy" in source
    assert "[:5]" not in source and "[:3]" not in source
