# Round 8.4B independent review — Draft PR #102

Reviewer: Codex2. Claude authored the reviewed changes except the touch spec, which Agy authored and Claude integrated. I authored `BE/scripts/run_e2e_server.py`; review of that file is **not independent**, and this verdict does not rely on approving it.

## Verdict: REQUEST CHANGES

The focus fix, focused tests, CI gate wiring, and emulated-touch assertions are sound. Before approval, narrow or strengthen the runtime-revision security claim and correct the evidence that attributes the pre-touch 9-spec run to the final 10-spec blocking job. The remaining findings are low-severity coverage/documentation issues.

## Findings

### 1. MEDIUM — backend revision is a mutable runtime label, not proof of the image's code

- Evidence: `BE/app/main.py:862-872`, `BE/app/main.py:875-884`, `docker-compose.prod.yml:49-50`, `docs/ui-ux-v4-design/round8-4-qa-evidence/runtime-version-verification.md:9-13,26-31,66-68`.
- Failure scenario: an old image can be started with `APP_BUILD_SHA` set to a newer commit; `/health` then reports the newer SHA although the executable code came from the old image. The normal Track A deploy path supplies the checked-out HEAD correctly, but the endpoint cannot independently establish “which commit was actually running.”
- Suggested fix: either describe this as a trusted, injected deployment label, or bake the revision into the backend artifact/image at build time and read that immutable value at runtime.

### 2. LOW — the “cannot leak” guarantee is broader than the validation

- Evidence: `BE/app/main.py:862-872`, `FE/vite.config.js:11-18`, `docs/ui-ux-v4-design/round8-4-qa-evidence/runtime-version-verification.md:19-23,35-42`.
- Failure scenario: any 7–40 character hexadecimal value is accepted, including a hex-shaped token accidentally assigned to one of these variables; it need not be a Git commit. Rejected non-hex values are safely replaced with `unknown`, and HTML injection is avoided by Vite's structured tag insertion.
- Suggested fix: reword the claim to say only validated hex from trusted revision variables is exposed. If stronger assurance is required, accept the repository's expected full SHA length and/or validate against a baked revision.

### 3. LOW — focus tests omit two advertised guards

- Evidence: `FE/src/components/study/CollectionSidebar.jsx:128-146`; `FE/src/components/study/CollectionSidebar.focusRestore.test.jsx:60-120`; `FE/src/components/common/Modal.jsx:40-50`.
- Failure scenario: removing the `document.activeElement === document.body` guard would not fail the suite, so the tests do not prove that successful deletion avoids stealing focus from another live control. They also prove ordinary cancel and post-failure Escape, but do not exercise Escape/cancel while the request is pending (the dialog currently disables those paths).
- Suggested fix: add one successful-delete case with focus deliberately moved to an external live control, and one pending-request case asserting Escape/cancel is unavailable and no delete/fallback side effect occurs.
- Assessment: no stale-closure defect was found. The effect reads the current list, and current production update/Modal cleanup ordering leaves focus on `body` before the fallback runs. Success next/previous/create, failure, and in-flight non-removal are meaningfully covered.

### 4. LOW — retained fixture evidence does not cover the exact final blocking set

- Evidence: `.github/workflows/ci.yml:218-230` runs 10 specs; `fixture-ci-coverage.md:41,70-77` calls the measured set 9 specs; `focus-and-touch-regressions.md:79-85` explicitly says the 570/570 smoke run occurred before the touch spec was added; `residual-release-gates.md:30-42,57` attributes 570/570 to the new blocking Fixture Smoke.
- Failure scenario: readers can infer that the exact final 10-spec required job passed three repeats, although the combined 570-test run excluded the touch spec. The touch spec has separate 5-pass evidence, and the documents correctly say the first GitHub run is pending, but those are not the same combined run.
- Suggested fix: label 570/570 as the pre-touch 9-spec run everywhere, list the separate touch 5/5 result, and record the final GitHub 10-spec result when available. Retain a CI URL/artifact or raw command log for negative-control and repeat claims that currently exist only as prose.

### 5. LOW — “Fixture Audit never gates a deploy” is only true for `deploy.yml`

- Evidence: `.github/workflows/fixture-audit.yml:1-20,47-48`; `.github/workflows/deploy.yml:18-21,43-46`; `.github/workflows/ci.yml:184-197,605-634`; `fixture-ci-coverage.md:44-46`.
- Failure scenario: workflow name and event filters ensure `Fixture Audit` cannot trigger the EC2 `deploy.yml`. However, an audit check attached to the current main SHA can be observed by Render's repository-wide `checksPass` policy and may delay/block that Render deploy, particularly if the audit is failed or cancelled by its static concurrency group.
- Suggested fix: narrow the comments/docs to “cannot trigger or gate `deploy.yml`,” and document or deliberately remove the possible Render coupling.

## Verified by running

- `cd FE && npx vitest run src/components/study/CollectionSidebar.focusRestore.test.jsx` — **PASS**, 1 file / 4 tests.
- `cd BE && python -m pytest tests/test_health.py -q` — **PASS**, 4 tests (4 warnings).

## Verified by reading

- Fixture Smoke is forced on main, included in `ci-success.needs`, and treats failure/cancellation as failure. On relevant PRs it follows `detect-changes`; skipped jobs are intentionally accepted by the aggregate.
- Playwright has one CI retry, while both fixture workflows use `--fail-on-flaky-tests`; a pass only on retry therefore fails the command.
- `Fixture Audit` cannot trigger `deploy.yml`: it is named `Fixture Audit`, uses only schedule/manual events, while deploy listens to successful `CI` push runs on main.
- The mobile spec is a real Chromium touch-emulation test: CDP sends touch start/move/end for the pan, and `locator.tap()` uses Playwright's touchscreen path. Transform change, hit-testing, exact selected IDs/ARIA state, viewport containment, and Export Studio scope are meaningful assertions. It is not physical-device evidence, which the document correctly marks NOT VERIFIED.
- The target worktree remained read-only.
