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
# Order of ci-success.needs in ci.yml (used to replay a real "Pipeline job results" line).
NEEDS_ORDER = ["detect-changes", "security-and-static", "frontend-tests", "frontend-build",
               "backend-contracts-and-unit", "backend-integration-and-smoke", "e2e-critical",
               "deploy-script-tests", "docker-build-test", "docker-compose-run-test", "fixture-smoke"]


def healthy(ref, frontend=False, backend=False, shared=False, **override):
    """A run where exactly the jobs the workflow `if:`s select ran and succeeded."""
    out = {"frontend": str(frontend).lower(), "backend": str(backend).lower(), "shared": str(shared).lower()}
    changed = {k for k, v in out.items() if v == "true"}
    needs = {}
    for job in NEEDS_ORDER:
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
    return needs


FE_ONLY = {"frontend": "true", "backend": "false", "shared": "false"}
# (name, ref, needs, expected_ok). Shared with the A/B harness that replays the old gate.
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
    # --- must fail
    ("replay PR #148 attempt 2: detect-changes abandoned (real log line)", PR, replay(
        "abandoned success skipped skipped skipped skipped skipped success skipped skipped skipped", {}), False),
    ("detect-changes skipped", PR, healthy(PR, frontend=True, detect_changes="skipped"), False),
    ("detect-changes success but outputs missing", PR,
     {**healthy(PR, frontend=True), "detect-changes": {"result": "success", "outputs": {}}}, False),
    ("detect-changes output not true/false", PR,
     {**healthy(PR), "detect-changes": {"result": "success",
                                        "outputs": {"frontend": "", "backend": "false", "shared": "false"}}}, False),
    ("push to main with docker unexpectedly skipped", MAIN, healthy(MAIN, docker_build_test="skipped",
                                                                    docker_compose_run_test="skipped"), False),
    ("FE PR, fixture-smoke unexpectedly skipped", PR, healthy(PR, frontend=True, fixture_smoke="skipped"), False),
    ("FE PR, frontend-build skipped by cascade", PR, healthy(PR, frontend=True, frontend_build="skipped"), False),
    ("BE PR, backend-integration unexpectedly skipped", PR,
     healthy(PR, backend=True, backend_integration_and_smoke="skipped"), False),
    ("FE PR, e2e-critical skipped (the PR #39 cascade)", PR, healthy(PR, frontend=True, e2e_critical="skipped"), False),
    ("shared PR, docker-compose-run-test skipped", PR, healthy(PR, shared=True, docker_compose_run_test="skipped"), False),
    ("docs PR, security check skipped", PR, healthy(PR, security_and_static="skipped"), False),
    ("docs PR, deploy-script-tests failure", PR, healthy(PR, deploy_script_tests="failure"), False),
    ("missing result (job absent from needs)", PR, healthy(PR, frontend=True, fixture_smoke=None), False),
    ("required job cancelled", PR, healthy(PR, frontend=True, frontend_tests="cancelled"), False),
    ("required job failure", PR, healthy(PR, backend=True, backend_contracts_and_unit="failure"), False),
    ("required job abandoned", PR, healthy(PR, frontend=True, e2e_critical="abandoned"), False),
    ("optional job with unknown status", PR, healthy(PR, frontend=True, docker_build_test="neutral"), False),
    ("optional job failure", PR, healthy(PR, frontend=True, docker_build_test="failure"), False),
    ("job in needs that the gate does not model", PR, {**healthy(PR), "new-job": {"result": "success"}}, False),
    ("needs context is not an object", PR, None, False),
]


class Matrix(unittest.TestCase):
    def test_matrix(self):
        for name, ref, needs, expected in SCENARIOS:
            with self.subTest(name):
                ok, lines = gate.evaluate(needs, ref)
                self.assertEqual(ok, expected, "\n".join(lines))

    def test_cli_reads_env_and_sets_exit_code(self):
        script = os.path.join(ROOT, "scripts", "ci_required_gate.py")
        for needs, code in ((healthy(PR, frontend=True), 0), (replay(
                "abandoned success skipped skipped skipped skipped skipped success skipped skipped skipped", {}), 1)):
            env = {**os.environ, "NEEDS_JSON": json.dumps(needs), "GATE_REF": PR}
            run = subprocess.run([sys.executable, script], env=env, capture_output=True, text=True)
            self.assertEqual(run.returncode, code, run.stdout + run.stderr)
        run = subprocess.run([sys.executable, script], env={**os.environ, "NEEDS_JSON": "{not json"},
                             capture_output=True, text=True)
        self.assertEqual(run.returncode, 1)


def jobs_of(text):
    """Top-level jobs of ci.yml -> {job: block text}. Stdlib only (the workflow is regular)."""
    body = text.split("\njobs:\n", 1)[1]
    parts = re.split(r"^  ([a-z0-9-]+):\n", body, flags=re.M)
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
    return re.findall(r"^      - ([a-z0-9-]+)", m.group(2), flags=re.M)


class WorkflowDrift(unittest.TestCase):
    """The gate's model must match ci.yml; adding a job or changing an `if:` fails here first."""

    @classmethod
    def setUpClass(cls):
        with open(CI_YML, encoding="utf-8") as fh:
            cls.text = fh.read()
        cls.jobs = jobs_of(cls.text)

    def test_ci_success_needs_every_other_job_and_matches_model(self):
        needs = needs_of(self.jobs["ci-success"])
        self.assertEqual(needs, NEEDS_ORDER)
        self.assertEqual(set(needs), set(self.jobs) - {"ci-success"})
        self.assertEqual(set(needs), set(gate.ALWAYS) | set(gate.REQUIRED_WHEN))

    def test_ci_success_always_runs_and_feeds_the_script(self):
        block = self.jobs["ci-success"]
        self.assertEqual((if_expr(block) or "").strip(), "always()")
        self.assertIn("NEEDS_JSON: ${{ toJSON(needs) }}", block)
        self.assertIn("GATE_REF: ${{ github.ref }}", block)
        self.assertIn("python3 scripts/ci_required_gate.py", block)

    def test_always_jobs_have_no_condition_and_no_needs(self):
        for job in gate.ALWAYS:
            with self.subTest(job):
                self.assertIsNone(if_expr(self.jobs[job]))
                self.assertEqual(needs_of(self.jobs[job]), [])

    def test_conditional_jobs_match_their_if(self):
        for job, outputs in gate.REQUIRED_WHEN.items():
            with self.subTest(job):
                expr = if_expr(self.jobs[job])
                if expr is None:  # e.g. docker-compose-run-test: runs when its one parent ran
                    parents = needs_of(self.jobs[job])
                    self.assertEqual(len(parents), 1, f"{job}: no if: and not exactly one parent")
                    self.assertEqual(outputs, gate.REQUIRED_WHEN[parents[0]])
                    continue
                self.assertIn("github.ref == 'refs/heads/main'", expr)
                found = set(re.findall(r"needs\.detect-changes\.outputs\.(\w+) == 'true'", expr))
                self.assertEqual(found, set(outputs))
                self.assertNotRegex(expr, r"&&|!|success\(|failure\(|always\(")

    def test_no_needs_cascade_skips_a_required_job(self):
        # PR #39: a job must not `needs:` a job whose own condition is narrower.
        for job, outputs in gate.REQUIRED_WHEN.items():
            for parent in needs_of(self.jobs[job]):
                if parent == "detect-changes":
                    continue
                with self.subTest(f"{job} needs {parent}"):
                    self.assertTrue(set(outputs) <= set(gate.REQUIRED_WHEN.get(parent, ())),
                                    f"{job} can be cascade-skipped by {parent}")


if __name__ == "__main__":
    unittest.main(verbosity=1)
