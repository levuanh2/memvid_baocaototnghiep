# Track B independent re-review — Round 2
Reviewer: Codex2; not an author of these fixes. I authored `BE/scripts/run_e2e_server.py`, which remains outside my independent verdict.
Reviewed branch head: `1f3d82a840c56871a00a44067466249e38b11cd2`.

1. **FIXED** — revision is now explicitly a trusted deploy label, not image proof, with bake-in follow-up: `runtime-version-verification.md:74-82`.
2. **NOT FIXED (LOW, non-blocking)** — the evidence now admits hex-shaped secrets can pass (`runtime-version-verification.md:22-25`), but `_build_revision` still claims a mis-set variable “cannot leak anything”: `BE/app/main.py:863-866`.
3. **FIXED** — external live focus and pending Escape are exercised at `CollectionSidebar.focusRestore.test.jsx:123-151`; the former directly bites the `<body>` guard at `CollectionSidebar.jsx:139`.
4. **FIXED** — 570/570 is labelled pre-touch, while the final 10-spec run is separate: `fixture-ci-coverage.md:80-82`; GitHub run `41426653589` independently verified successful, including Fixture Smoke and `CI / required`.
5. **FIXED** — wording is narrowed to EC2 and Render coupling is explicit: `fixture-audit.yml:5-8`, `fixture-ci-coverage.md:44-52`.

Test: `npx vitest run src/components/study/CollectionSidebar.focusRestore.test.jsx` — **PASS, 6/6**.
Verdict: **APPROVE**. The remaining inaccurate docstring should be corrected, but it does not change runtime behavior or the now-accurate evidence contract.
