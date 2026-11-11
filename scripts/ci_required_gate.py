#!/usr/bin/env python3
"""`CI / required` aggregate gate (ci.yml `ci-success`). Stdlib only.

Branch protection requires exactly this one check, so it must fail unless every
job that the path filter makes required actually RAN and succeeded.

The old inline gate only rejected `failure` / `cancelled`. During a GitHub
Actions outage (PR #148, run 42673104752 attempt 2) `detect-changes` came back
`abandoned`, every test job was skipped as a consequence, and the gate still
printed "All active CI checks succeeded." (Same class as the PR #39 cascade-skip
entry in .playbook/known-issues.md: a skip was treated as a pass.)

Rule per job, from `toJSON(needs)`:
  - `detect-changes` must be `success` and its outputs exactly 'true'/'false',
    otherwise nothing below can be decided -> fail closed;
  - a job that is required for this ref / these paths must be `success`;
  - a job that is not required may be `skipped` (intentional path skip) or
    `success`; anything else fails;
  - a missing job, an unknown result (`abandoned`, ...) or a job the model below
    does not know fails.

REQUIRED_WHEN mirrors each job's `if:` in .github/workflows/ci.yml;
scripts/tests/test_ci_required_gate.py fails if the two drift apart.
"""
import json
import os
import sys

# Always run (no `if:`), plus the job whose outputs drive every other job.
ALWAYS = ("detect-changes", "security-and-static", "deploy-script-tests")
# job -> path-filter outputs; any one 'true' makes the job required on a PR.
# On a push to main every job is required (each `if:` starts with
# `github.ref == 'refs/heads/main' ||`).
REQUIRED_WHEN = {
    "frontend-tests": ("frontend", "shared"),
    "frontend-build": ("frontend", "shared"),
    "fixture-smoke": ("frontend", "shared"),
    "backend-contracts-and-unit": ("backend", "shared"),
    "backend-integration-and-smoke": ("backend", "shared"),
    "e2e-critical": ("frontend", "backend", "shared"),
    "docker-build-test": ("shared",),
    # no `if:` of its own; runs exactly when docker-build-test succeeds
    "docker-compose-run-test": ("shared",),
}
OUTPUTS = ("frontend", "backend", "shared")
MAIN_REF = "refs/heads/main"


def evaluate(needs, ref):
    """Return (ok, lines). `needs` is the parsed `toJSON(needs)` object."""
    lines, problems = [], []
    if not isinstance(needs, dict):
        return False, ["FAIL needs context is not an object"]

    known = set(ALWAYS) | set(REQUIRED_WHEN)
    for job in sorted(set(needs) - known):
        problems.append(f"{job}: listed in needs but not modelled by the gate")

    detect = needs.get("detect-changes")
    detect_result = detect.get("result") if isinstance(detect, dict) else None
    outputs = (detect.get("outputs") or {}) if isinstance(detect, dict) else {}
    paths = None
    if detect_result != "success":
        problems.append(f"detect-changes: {detect_result or 'missing'} (must be success)")
    elif any(outputs.get(o) not in ("true", "false") for o in OUTPUTS):
        problems.append(f"detect-changes: outputs not 'true'/'false': {json.dumps(outputs, sort_keys=True)}")
    else:
        paths = {o for o in OUTPUTS if outputs[o] == "true"}

    on_main = ref == MAIN_REF
    lines.append(f"ref={ref or '?'} main={on_main} changed={sorted(paths) if paths is not None else 'unknown'}")
    for job in list(ALWAYS) + list(REQUIRED_WHEN):
        entry = needs.get(job)
        result = entry.get("result") if isinstance(entry, dict) else None
        if job in ALWAYS or on_main:
            required = True
        elif paths is None:
            required = None  # undecidable; detect-changes already failed
        else:
            required = bool(paths & set(REQUIRED_WHEN[job]))
        if result is None:
            verdict = "missing"
        elif result == "success":
            verdict = "ok"
        elif result == "skipped" and required is False:
            verdict = "ok (intentional skip)"
        elif result == "skipped" and required:
            verdict = "required but skipped"
        elif result in ("failure", "cancelled"):
            verdict = result
        elif result == "skipped":
            verdict = "skipped, requirement unknown"
        else:
            verdict = f"unknown result '{result}'"
        need = {True: "required", False: "optional", None: "unknown"}[required]
        lines.append(f"  {job:<31} {str(result):<10} {need:<9} {verdict}")
        if not verdict.startswith("ok"):
            problems.append(f"{job}: {verdict}")

    for p in problems:
        lines.append(f"FAIL {p}")
    lines.append("All required CI jobs ran and succeeded." if not problems else
                 f"{len(problems)} problem(s): CI / required is not satisfied.")
    return not problems, lines


def main():
    try:
        needs = json.loads(os.environ.get("NEEDS_JSON") or "null")
    except json.JSONDecodeError as exc:
        print(f"::error::NEEDS_JSON is not valid JSON: {exc}")
        return 1
    ok, lines = evaluate(needs, os.environ.get("GATE_REF", ""))
    for line in lines:
        print(f"::error::{line}" if line.startswith("FAIL") else line)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
