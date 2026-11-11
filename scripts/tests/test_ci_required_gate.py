#!/usr/bin/env python3
"""Regression matrix + drift check for scripts/ci_required_gate.py (stdlib only).

Run: python3 scripts/tests/test_ci_required_gate.py   (also run by ci.yml `ci-success`)
"""
import json
import os
import re
import subprocess
import sys
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import ci_required_gate as gate  # noqa: E402

CI_YML = os.path.join(ROOT, ".github", "workflows", "ci.yml")
MAIN, PR = "refs/heads/main", "refs/pull/148/merge"
# Order of ci-success.needs at PR #148 time: only for replaying those real "Pipeline job results" lines.
NEEDS_ORDER = ["detect-changes", "security-and-static", "frontend-tests", "frontend-build",
               "backend-contracts-and-unit", "backend-integration-and-smoke", "e2e-critical",
               "deploy-script-tests", "docker-build-test", "docker-compose-run-test", "fixture-smoke"]


def healthy(ref, frontend=False, backend=False, shared=False, **override):
    """A run where exactly the jobs the workflow `if:`s select ran and succeeded."""
    out = {"frontend": str(frontend).lower(), "backend": str(backend).lower(), "shared": str(shared).lower()}
    changed = {k for k, v in out.items() if v == "true"}
    needs = {}
    for job in list(gate.ALWAYS) + list(gate.REQUIRED_WHEN):
        runs = job in gate.ALWAYS or ref == MAIN or bool(changed & set(gate.REQUIRED_WHEN[job]))
        needs[job] = {"result": "success" if runs else "skipped", "outputs": {}}
    needs["detect-changes"]["outputs"] = out
    for job, result in override.items():
        job = job.replace("_", "-")
        if result is None:
            needs.pop(job, None)
        else:
            needs[job] = {**needs.get(job, {"outputs": {}}), "result": result}
    return needs


def replay(results_line, outputs):
    """Rebuild `needs` from a real `Pipeline job results:` log line (same order as NEEDS_ORDER)."""
    needs = {job: {"result": r, "outputs": {}} for job, r in zip(NEEDS_ORDER, results_line.split())}
    needs["detect-changes"]["outputs"] = outputs
    # A job added to the workflow after that run did not exist then: give it the result a
    # healthy run would, so old log lines keep testing exactly the jobs they recorded.
    flags = {k: v == "true" for k, v in outputs.items()}
    for job, entry in healthy(PR, **flags).items():
        needs.setdefault(job, entry)
    return needs


FE_ONLY = {"frontend": "true", "backend": "false", "shared": "false"}
# (name, ref, needs, expected): True = the gate passes; a string = the gate fails AND reports
# exactly that problem (so a broken fixture cannot fail for the wrong reason and still pass).
# Shared with the A/B harness that replays the old gate.
ABANDONED_LINE = "abandoned success skipped skipped skipped skipped skipped success skipped skipped skipped"
NOT_TF = "detect-changes: outputs not 'true'/'false'"


def detect_outputs(outputs):
    return {**healthy(PR), "detect-changes": {"result": "success", "outputs": outputs}}


SCENARIOS = [
    ("all required jobs successful (push to main)", MAIN, healthy(MAIN), True),
    ("FE-only PR, intentional backend/docker skips", PR, healthy(PR, frontend=True), True),
    ("BE-only PR, intentional frontend/docker skips", PR, healthy(PR, backend=True), True),
    ("shared-infrastructure PR, everything required", PR, healthy(PR, shared=True), True),
    ("documentation-only PR, only always-on jobs", PR, healthy(PR), True),
    ("FE+BE PR, docker intentionally skipped", PR, healthy(PR, frontend=True, backend=True), True),
    ("healthy FE PR where an optional job still ran green", PR,
     healthy(PR, frontend=True, docker_build_test="success"), True),
    ("replay PR #148 attempt 3 (real log line)", PR, replay(
        "success success success success skipped skipped success success skipped skipped success", FE_ONLY), True),
    # --- must fail, with the reason the gate has to report
    ("replay PR #148 attempt 2: detect-changes abandoned (real log line)", PR, replay(ABANDONED_LINE, {}),
     "detect-changes: abandoned (must be success)"),
    ("detect-changes skipped", PR, healthy(PR, frontend=True, detect_changes="skipped"),
     "detect-changes: skipped (must be success)"),
    ("detect-changes failure", PR, healthy(PR, frontend=True, detect_changes="failure"),
     "detect-changes: failure (must be success)"),
    ("detect-changes cancelled", PR, healthy(PR, frontend=True, detect_changes="cancelled"),
     "detect-changes: cancelled (must be success)"),
    ("detect-changes success but outputs missing", PR, detect_outputs({}), NOT_TF),
    ("detect-changes output empty string", PR,
     detect_outputs({"frontend": "", "backend": "false", "shared": "false"}), NOT_TF),
    ("detect-changes outputs as JSON booleans", PR,
     detect_outputs({"frontend": True, "backend": False, "shared": False}), NOT_TF),
    ("detect-changes output 'True' (wrong case)", PR,
     detect_outputs({"frontend": "True", "backend": "false", "shared": "false"}), NOT_TF),
    ("push to main with docker unexpectedly skipped", MAIN,
     healthy(MAIN, docker_build_test="skipped", docker_compose_run_test="skipped"),
     "docker-build-test: required but skipped"),
    ("FE PR, fixture-smoke unexpectedly skipped", PR, healthy(PR, frontend=True, fixture_smoke="skipped"),
     "fixture-smoke: required but skipped"),
    ("FE PR, frontend-build skipped by cascade", PR, healthy(PR, frontend=True, frontend_build="skipped"),
     "frontend-build: required but skipped"),
    ("BE PR, backend-integration unexpectedly skipped", PR,
     healthy(PR, backend=True, backend_integration_and_smoke="skipped"),
     "backend-integration-and-smoke: required but skipped"),
    ("FE PR, e2e-critical skipped (the PR #39 cascade)", PR, healthy(PR, frontend=True, e2e_critical="skipped"),
     "e2e-critical: required but skipped"),
    ("shared PR, docker-compose-run-test skipped", PR,
     healthy(PR, shared=True, docker_compose_run_test="skipped"),
     "docker-compose-run-test: required but skipped"),
    ("docs PR, security check skipped", PR, healthy(PR, security_and_static="skipped"),
     "security-and-static: required but skipped"),
    ("docs PR, deploy-script-tests failure", PR, healthy(PR, deploy_script_tests="failure"),
     "deploy-script-tests: failure"),
    ("missing result (job absent from needs)", PR, healthy(PR, frontend=True, fixture_smoke=None),
     "fixture-smoke: missing"),
    ("empty needs object", PR, {}, "detect-changes: missing"),
    ("required job cancelled", PR, healthy(PR, frontend=True, frontend_tests="cancelled"),
     "frontend-tests: cancelled"),
    ("required job failure", PR, healthy(PR, backend=True, backend_contracts_and_unit="failure"),
     "backend-contracts-and-unit: failure"),
    ("required job abandoned", PR, healthy(PR, frontend=True, e2e_critical="abandoned"),
     "e2e-critical: unknown result 'abandoned'"),
    ("optional job with unknown status", PR, healthy(PR, frontend=True, docker_build_test="neutral"),
     "docker-build-test: unknown result 'neutral'"),
    ("optional job failure", PR, healthy(PR, frontend=True, docker_build_test="failure"),
     "docker-build-test: failure"),
    ("optional job cancelled", PR, healthy(PR, frontend=True, docker_build_test="cancelled"),
     "docker-build-test: cancelled"),
    ("job in needs that the gate does not model", PR, {**healthy(PR), "new-job": {"result": "success"}},
     "new-job: listed in needs but not modelled"),
    ("needs context is not an object", PR, None, "needs context is not an object"),
]


class Matrix(unittest.TestCase):
    def test_matrix(self):
        for name, ref, needs, expected in SCENARIOS:
            with self.subTest(name):
                ok, lines = gate.evaluate(needs, ref)
                report = "\n".join(lines)
                self.assertEqual(ok, expected is True, report)
                if expected is not True:
                    self.assertTrue(any(l.startswith(f"FAIL {expected}") for l in lines),
                                    f"expected problem {expected!r} not reported:\n{report}")

    def test_cli_reads_env_and_sets_exit_code(self):
        script = os.path.join(ROOT, "scripts", "ci_required_gate.py")
        for needs, code in ((healthy(PR, frontend=True), 0), (replay(
                "abandoned success skipped skipped skipped skipped skipped success skipped skipped skipped", {}), 1)):
            env = {**os.environ, "NEEDS_JSON": json.dumps(needs), "GATE_REF": PR}
            run = subprocess.run([sys.executable, script], env=env, capture_output=True, text=True)
            self.assertEqual(run.returncode, code, run.stdout + run.stderr)
        env = {**os.environ, "NEEDS_JSON": json.dumps(healthy(MAIN)), "GATE_REF": MAIN}
        run = subprocess.run([sys.executable, script], env=env, capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stdout)
        env = {**os.environ, "NEEDS_JSON": json.dumps(replay(ABANDONED_LINE, {})), "GATE_REF": PR}
        run = subprocess.run([sys.executable, script], env=env, capture_output=True, text=True)
        self.assertIn("::error::FAIL detect-changes: abandoned", run.stdout)  # annotation on the run page
        for bad in ({"NEEDS_JSON": "{not json"}, {}):  # invalid JSON, variable unset
            env = {k: v for k, v in os.environ.items() if k != "NEEDS_JSON"} | bad
            run = subprocess.run([sys.executable, script], env=env, capture_output=True, text=True)
            self.assertEqual(run.returncode, 1, run.stdout)


# GitHub job ids: start with a letter or "_", then letters, digits, "-" or "_" (Codex review:
# the first version only matched [a-z0-9-], so a `new_job:` was invisible to the drift check).
JOB_ID = r"[A-Za-z_][A-Za-z0-9_-]*"
JOB_HEADER = rf"^  ({JOB_ID}):[ \t]*(?:#.*)?$"


def jobs_of(text):
    """Top-level jobs of ci.yml -> {job: block text}. Stdlib only (the workflow is regular).

    Fails closed: a line at the job indent that is not a recognised job header raises, so
    an id this parser cannot read never silently drops out of the drift check."""
    body = text.split("\njobs:\n", 1)[1]
    for line in body.splitlines():
        if re.match(r"^  [^ #]", line) and not re.match(JOB_HEADER, line):
            raise AssertionError(f"unparsed job-level line in ci.yml: {line!r}")
    parts = re.split(JOB_HEADER + r"\n", body, flags=re.M)
    return dict(zip(parts[1::2], parts[2::2]))


def if_expr(block):
    m = re.search(r"^    if: >\n((?:      .*\n)+)|^    if: (.*)$", block, flags=re.M)
    return (m.group(1) or m.group(2)) if m else None


def needs_of(block):
    m = re.search(r"^    needs:(.*)$((?:\n      .*)*)", block, flags=re.M)
    if not m:
        return []
    inline = m.group(1).strip()
    if inline:
        return [n.strip() for n in inline.strip("[]").split(",") if n.strip()]
    return re.findall(rf"^      - ({JOB_ID})", m.group(2), flags=re.M)


FIX = ("ci.yml and the gate model disagree: update ALWAYS / REQUIRED_WHEN in "
       "scripts/ci_required_gate.py in the same PR (docs/ci/CI_ARCHITECTURE.md section 8)")


class WorkflowDrift(unittest.TestCase):
    """The gate's model must match ci.yml; adding a job or changing an `if:` fails here first."""

    @classmethod
    def setUpClass(cls):
        with open(CI_YML, encoding="utf-8") as fh:
            cls.text = fh.read()
        cls.jobs = jobs_of(cls.text)

    def test_ci_success_needs_every_other_job_and_matches_model(self):
        needs = needs_of(self.jobs["ci-success"])
        self.assertEqual(len(needs), len(set(needs)), "duplicate entry in ci-success.needs")
        self.assertEqual(set(needs), set(self.jobs) - {"ci-success"}, FIX)
        self.assertEqual(set(needs), set(gate.ALWAYS) | set(gate.REQUIRED_WHEN), FIX)

    def test_ci_success_always_runs_and_feeds_the_script(self):
        block = self.jobs["ci-success"]
        self.assertEqual((if_expr(block) or "").strip(), "always()", FIX)
        self.assertIn("NEEDS_JSON: ${{ toJSON(needs) }}", block, FIX)
        self.assertIn("GATE_REF: ${{ github.ref }}", block, FIX)
        self.assertIn("python3 scripts/ci_required_gate.py", block, FIX)

    def test_always_jobs_have_no_condition_and_no_needs(self):
        for job in gate.ALWAYS:
            with self.subTest(job):
                self.assertIsNone(if_expr(self.jobs[job]), FIX)
                self.assertEqual(needs_of(self.jobs[job]), [], FIX)

    def test_conditional_jobs_match_their_if(self):
        for job, outputs in gate.REQUIRED_WHEN.items():
            with self.subTest(job):
                expr = if_expr(self.jobs[job])
                if expr is None:  # e.g. docker-compose-run-test: runs when its one parent ran
                    parents = needs_of(self.jobs[job])
                    self.assertEqual(len(parents), 1, f"{job}: no if: and not exactly one parent")
                    self.assertEqual(outputs, gate.REQUIRED_WHEN[parents[0]], FIX)
                    continue
                # Exact set of `||` operands (agy audit: a blacklist let an extra
                # `|| github.actor == ...` through, so the job ran where the model says optional).
                clauses = {re.sub(r"\s+", " ", c).strip() for c in expr.split("||")}
                want = {"github.ref == 'refs/heads/main'"} | {
                    f"needs.detect-changes.outputs.{o} == 'true'" for o in outputs}
                self.assertEqual(clauses, want, FIX)

    def test_no_needs_cascade_skips_a_required_job(self):
        # PR #39: a job must not `needs:` a job whose own condition is narrower.
        for job, outputs in gate.REQUIRED_WHEN.items():
            for parent in needs_of(self.jobs[job]):
                # An always-on parent has no `if:` (test_always_jobs_have_no_condition_...), so it
                # never cascade-skips its dependants (Codex review 5: only detect-changes was exempt,
                # a false FAIL for e.g. `needs: [detect-changes, security-and-static]`).
                if parent in gate.ALWAYS:
                    continue
                with self.subTest(f"{job} needs {parent}"):
                    self.assertTrue(set(outputs) <= set(gate.REQUIRED_WHEN.get(parent, ())),
                                    f"{job} can be cascade-skipped by {parent}")


if __name__ == "__main__":
    unittest.main(verbosity=1)
