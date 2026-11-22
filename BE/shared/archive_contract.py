"""Archive contract marker read by `scripts/rollback.sh` (issue #18, Codex task50).

A tree that contains this exact line promises: regenerating a review plan archives its
topics and never deletes the plan; readers filter `archived_at`; no new practice comes
from an archived topic. The promise is enforced by tests that run in CI on every SHA
that carries this file (`tests/test_review_plan_archive.py`,
`tests/test_review_item_archive_guard.py`, `tests/test_archive_contract.py`), and only
CI-green SHAs are deployed, so only those can be rollback targets.

`rollback.sh` reads this file from the TARGET tree (git show) and requires the line
`ARCHIVE_CONTRACT_VERSION = 1` exactly. Do not remove or lower it while archived topics
can exist; raise it only with a new rollback floor.
"""
ARCHIVE_CONTRACT_VERSION = 1
