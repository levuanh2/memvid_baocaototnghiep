"""One source of truth for detail_level structural budgets.

P2 fix (2026-09-22): detail_level used to compute a budget (guided_planner.py)
that nothing downstream enforced — enrich.py's _parse() hardcoded 5/3 child
caps regardless of detail_level, so depth was non-monotonic across compact/
balanced/detailed (live evidence: 24/33/29 nodes, depth 2/3/2). Both files now
read the same policy instead of each hardcoding their own numbers.

max_grandchildren=0 for compact is the actual depth lever: with zero allowed
grandchildren, compact structurally cannot exceed root->branch->idea (2
levels below root), while detailed's max_grandchildren=3 allows the 3rd
"detail" tier to appear when evidence supports it. This is a ceiling, not a
requirement — a sparse branch still emits however many children the model
found real evidence for, never padded to hit the cap.
"""
from __future__ import annotations

_POLICIES: dict[str, dict] = {
    "compact":  {"node_budget": 12, "chunk_budget": 12, "max_children_per_branch": 3, "max_grandchildren": 0, "branch_target": "3-5"},
    "balanced": {"node_budget": 24, "chunk_budget": 24, "max_children_per_branch": 5, "max_grandchildren": 2, "branch_target": "4-7"},
    "detailed": {"node_budget": 42, "chunk_budget": 42, "max_children_per_branch": 6, "max_grandchildren": 3, "branch_target": "5-8"},
}
_DEFAULT = "balanced"


def get_detail_policy(detail_level: str | None) -> dict:
    """Normalized budget for a detail_level. Unknown/missing -> balanced."""
    return dict(_POLICIES.get(detail_level or _DEFAULT, _POLICIES[_DEFAULT]))
