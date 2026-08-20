# CRAG calibration decision protocol

Default Option A preserves FULL METHOD v1: `correct >= 0.25`, `wrong <= 0.10`, rewrite budget 2. This remains the baseline unless a separate, documented calibration decision is approved.

Option B may search thresholds only on human-validated development queries. Predeclare the grid and objective before examining test results; retain per-query grade/action/error traces; select once using development data; save a new named configuration and its development-only decision record; then execute the frozen configuration exactly once on held-out test. Report original and calibrated variants separately.

Forbidden: selecting thresholds from test performance, editing test labels after inspecting system errors, or silently replacing FULL METHOD v1.
