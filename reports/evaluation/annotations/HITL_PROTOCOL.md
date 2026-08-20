# HITL protocol

This protocol requires real human review. Automated or simulated reviewer actions are forbidden.

For each assigned query, show the system draft and its evidence, start a review timer, then record: pseudonymous `reviewer_id`, `query_id`, `system_draft`, `action` (`approve`, `edit`, or `reject`), `edited_answer` when applicable, `review_time_ms`, human `quality_before`, human `quality_after`, and optional notes. Never place names, emails, credentials, or other identifying data in the record.

Use at least two independent reviewers on the agreement subset. Preserve the original draft and edit. Report approve/edit/reject rates, edit distance, unsupported-claim reduction, review time, and an appropriate inter-rater agreement statistic. Machine latency excludes review/wait time. If participants are unavailable, report the HITL evaluation as proposed, not completed.

Store records in `reports/evaluation/annotations/<dataset_version>/hitl_reviews.jsonl`.
