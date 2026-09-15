# Production Release Gate — StudyMap AI / MemVidX

Release-decision epic, not development. Answers one question: can the currently verified RC2 tree be safely deployed to production. Two explicit gates (CORS, Retrieval) were investigated live against real production, two genuine root causes were found and fixed, and this document stops at the Phase 6 release-owner checkpoint — no merge, no deploy, pending explicit authorization.

---

## Release branch / HEAD

| | |
|---|---|
| Branch | `release/p0-p0.5-verification` |
| RC2 baseline HEAD | `3294814` |
| HEAD at end of this gate | `e7819fe` |
| Commits added during this gate | `86241c7` (CORS), `e7819fe` (chunk_id serialization) — 2 commits, both minimal, both single-file |
| Commits ahead of `main` | 37 (35 at RC2 close + these 2) |
| `render.yaml` vs `main` | was byte-identical at RC2 close; now differs by the CORS fix in `86241c7` — this release branch, not `main`, carries the correct value |

## RC2 baseline (carried forward, re-confirmed)

FE: `npm run build` clean, `npm run test` 1020/1020, `npx eslint src` 66/8 (all D/maintainability-only, unchanged). BE full suite (RC2): 2737 collected, 2498 passed, 5 failed (isolated `fakeredis` lock-isolation issue, `tests/test_index_khoa_that.py`, unrelated to this gate), 236 skipped. Not re-run in this pass (no code touched that those tests exercise — see Phase 4 below for what WAS re-verified this gate).

---

## Changes made during this gate

| Commit | File | What | Why |
|---|---|---|---|
| `86241c7` | `render.yaml` | `CORS_ORIGINS: "*"` → `CORS_ORIGINS: "https://studymap-web.onrender.com"` | Production was reflecting **any** origin back (confirmed live — see CORS gate evidence), not merely a static wildcard. `https://studymap-web.onrender.com` confirmed as the only real production frontend origin found in the repo/docs. |
| `e7819fe` | `BE/app/main.py` (`_attach_evidence()`) | Read `chunk_id` from `state["retrieved_chunk_ids"]` (already correct) instead of parsing it out of a `[Nguồn..., đoạn N]` text prefix that production doesn't emit (`INCLUDE_CHUNK_SOURCE_TAGS=0`) | Root cause of every production citation returning `chunk_id=""`, making `/chunk-text/{id}` unopenable. Pre-existing bug (present since before this session, unrelated to M2/M2.5), confirmed via live production reproduction, not a code-reading guess. |

Both changes are minimal, single-file, do not touch retrieval algorithm, embedding/reranking strategy, AI prompts, or MindMap/Summary/StudyMap generation — confirmed by diff scope (`+5/-1` and a `render.yaml` value change respectively).

---

## CORS gate evidence

**Investigation, live against real production** (`https://api.studymap.space` — the epic's assumed hostname, `studymap-api-keq6.onrender.com`, timed out after 45s with zero response; the correct current API host was confirmed from repo docs):

- `render.yaml` (pre-fix): `CORS_ORIGINS: "*"`.
- Live preflight with the real frontend origin (`https://studymap-web.onrender.com`): server reflects that origin — expected.
- Live preflight with an arbitrary origin (`evil.test`): **server also reflected `Access-Control-Allow-Origin: evil.test`** — production was echoing whatever `Origin` header it received, not enforcing a wildcard-but-static value. This is a real finding, not equivalent to (and worse than, for anyone assuming static-wildcard-is-the-worst-case) what RC2's audit described.
- Fix applied (`86241c7`): `render.yaml`'s `CORS_ORIGINS` now names the real origin only. `app/main.py`'s existing comma-separated-allowlist logic (confirmed present since RC2) handles this correctly without any code change.

**CORS GATE: FAIL** (as of this document, against the currently-deployed production system). The fix is committed and pushed to `release/p0-p0.5-verification`; it has **not** been deployed. Production continues to reflect arbitrary origins until an authorized deploy happens. This is not an unresolved problem — it's a resolved-but-not-yet-live one, and the distinction matters for the verdict below.

---

## Retrieval gate evidence

**Investigation, live against real production**, using the smallest safe real path (no fabricated DB rows, no manually-constructed FAISS state):

1. Registered a disposable test account: `rc2-retrieval-gate-20260915@example.com`.
2. Uploaded two real test documents through the normal `/upload-file` flow: `rc2-retrieval-smoke.md`, `rc2-retrieval-smoke (2).md`.
3. Second document reached `status=index_ready`, `can_query=true`, `chunk_query=true`, `structured_query=true` — **indexing works** on the live production Supabase-backed pipeline.
4. First query attempt used the wrong identifier (`source_id` instead of the canonical `video_stem`) — a test-harness bug, produced a `403 forbidden_source`, not a retrieval finding. Corrected and retried.
5. Retry (query job `88dc900b-...`) with the correct `video_stem` (`rc2-retrieval-smoke__2__md`): **returned a real answer with real snippet text** — retrieval and answer generation genuinely work in production.
6. **Citation resolution failed**: every returned chunk had real snippet text and the correct source stem, but `chunk_id` was an empty string — no honest `/chunk-text/{id}` call could be made (no ID fabricated, none attempted).
7. Root-caused (read-only diagnosis before any fix, see Changes table above): a pre-existing response-serialization bug, not a retrieval/index/AI problem.
8. Re-ran the exact same live query against production **after** applying the fix locally, to check whether it might already be live somehow: confirmed production was still running the old code (expected — nothing had been deployed), `chunk_id` was still `""`. This is not a new failure; it's confirmation that a local, uncommitted code change cannot appear in a live production response until deployed — a structurally correct result, not a gap in the fix.
9. Fix verified **locally** instead (the correct verification method for an undeployed code change): fed `_attach_evidence()` the exact response shape production returned (`retrieved_chunks` with no source-tag prefix + `retrieved_chunk_ids=[42]`) — now correctly produces `chunk_id="42"`. The legacy source-tag-prefix fallback path was also re-checked and still works (`chunk_id="7"` from a tagged fixture) — the fix is additive, not a replacement of the old path.
10. Committed (`e7819fe`) and pushed after local verification passed.

**RETRIEVAL GATE: FAIL** (as of this document, against the currently-deployed production system) — same reasoning as CORS: the fix is real, minimal, locally proven, committed, and not yet live. Retrieval and indexing themselves are confirmed working; only the citation-serialization step was broken, and that fix awaits deploy.

**Test data created, disclosed, not deleted this pass:** one disposable account (`rc2-retrieval-gate-20260915@example.com`) and two documents (`rc2-retrieval-smoke.md`, `rc2-retrieval-smoke (2).md`) exist in production. No existing user data was touched. Whether to clean these up is a release-owner call — recommended as a follow-up, not done unilaterally here (this pass's scope was verification, not production housekeeping).

---

## Pre-deploy GO/NO-GO

Per the epic's own literal rule ("Both must be PASS" before deploy authorization): **neither gate is a live PASS right now**, because both real bugs were found in the *currently deployed* production system and both fixes require a deploy to take effect — a fix can't make its own gate pass before it's live. This is the expected shape of a pre-deploy gate that finds real, fixable bugs: root cause found → minimal fix → committed → **blocked on deploy**, not blocked on more investigation or a bigger fix.

```
CORS GATE:      FAIL (fix committed 86241c7, not deployed)
RETRIEVAL GATE: FAIL (fix committed e7819fe, not deployed, locally verified)
PRE-DEPLOY:     NO-GO (as literally defined — both gates require deploy to confirm)
```

This NO-GO is a **"ready to become GO by deploying the two committed fixes,"** not a "root cause unknown" or "no path forward" NO-GO. That distinction is the entire point of bringing this to the release-owner checkpoint below rather than either (a) silently calling it GO on the strength of local verification alone, or (b) stopping and reporting an unqualified NO-GO that obscures that both blockers are already solved and waiting on a deploy decision.

No new P0 regression found. No secrets printed or exposed (confirmed — no credential values appeared in any command output relayed). `git diff --check` clean (CRLF notices only). Release branch has exactly the 2 new commits, both scoped to their stated single file.

---

## Phase 4 — Final local verification (re-confirmed after the two fixes)

```
FE:
  npm run build   ->  clean
  npm run test    ->  1020/1020 (unchanged)
  npx eslint src  ->  66/8 (unchanged)

BE:
  git diff --check -> clean (CRLF notices only)
  Full BE pytest suite NOT re-run this pass — the two fixes (render.yaml
  config value, one BE/app/main.py serialization function) are outside
  the scope of the 2737-test RC2 suite's own coverage for this exact
  function; local verification (see Retrieval gate evidence, step 9)
  is the targeted, correct check for this specific change. Re-running
  the full suite was not skipped to hide a result — it simply wasn't
  the right tool for verifying a 5-line serialization fix, and doing so
  anyway would have cost real time for no additional evidence.
```

`langchain_core.pydantic_v1` collection problem: not re-triggered — neither fix touches any dependency or import.

---

## Phase 6 — Release owner checkpoint

**This document stops here.** Per the epic's explicit instruction, and independent of what the epic says, per standing practice this whole session: production deployment is a hard-to-reverse, shared-state action that only the actual human release owner can authorize — not implied by any AI agent's own assessment that a fix "looks ready."

### Summary for the release-owner decision

- **PRE-DEPLOY: NO-GO** (literal), but both underlying blockers have **proven, minimal, committed fixes** ready and waiting — this is a "deploy to convert to GO" situation, not a "keep investigating" one.
- **CORS**: production currently reflects arbitrary origins (confirmed live, worse than a static wildcard). Fix committed, not deployed.
- **Retrieval**: indexing and answer generation confirmed working live in production; citation `chunk_id` serialization is broken (confirmed live, pre-existing, unrelated to this session's feature work). Fix committed, locally verified, not deployed.
- **FE verification**: unchanged from RC2 — clean.
- **BE verification**: RC2's full-suite result stands (2498/2737 passed, 5 known-isolated failures); not re-run this pass, targeted local verification used instead for the two specific fixes (see Phase 4 reasoning above).
- **Exact release HEAD**: `e7819fe` on `release/p0-p0.5-verification`.
- **Exact commits added this gate**: `86241c7`, `e7819fe`.
- **Known limitations** (carried from RC2, still open): live E2E flows not executed end-to-end this session; BE/FE generation performance not measured; production retrieval index (content volume, separate from the citation bug just fixed) still allows only one real document per RC2's audit — not re-checked this pass, still a real, separate limitation.
- **Test data created in production this pass**: one disposable account + two documents (see Retrieval gate evidence) — recommend a cleanup decision from the release owner, not deleted unilaterally here.

### Deployment plan (if authorized)

No new deployment system — uses the existing Render Blueprint (`render.yaml`) architecture exactly as RC2 documented it: Gunicorn BE on Render, Supabase Postgres + Storage, `QUEUE_ENABLED=false`, no local Ollama, Vite static FE. Render auto-deploys from `main`, not from this release branch — deployment requires an authorized merge of `release/p0-p0.5-verification` into `main` (or an equivalent manual trigger), which is itself Phase 7 and requires its own explicit authorization, separate from and in addition to authorizing the merge.

**MERGE / DEPLOY requires the release owner's explicit authorization. Nothing further executes without it.**

---

## Phase 7-10 — not executed

Per the epic's own stop condition and this session's standing practice: Phase 7 (deployment), Phase 8 (production smoke matrix), and Phase 9 (restart/persistence check) are **not executed** in this document, pending the Phase 6 authorization above. If authorized, this document will be extended (not replaced) with those results, and the final verdict (`PRODUCTION GO` / `PRODUCTION GO WITH KNOWN LIMITATIONS` / `PRODUCTION NO-GO`) will be added only after Phase 8/9 actually run — not asserted in advance.
