# Mind Map Workspace V2 — Clean Release Candidate

## Status

**Gate A passed — clean release candidate pushed; Gate B pending.**

The previous branch release/p0-p0.5-verification is not deployable for this
candidate because cbeb475 mixed Mind Map V2 work with pre-existing backend
WIP. It remains unchanged. This report belongs to the new clean branch and
does not claim live acceptance.

## Clean-base recovery

- CLEAN_BASE: 60bc15f (feat(ui): finish round 12 workspace chrome handoff)
- Previous FE candidate: 7f74d73
- Previous contaminated BE candidate: cbeb475
- Previous contaminated branch: release/p0-p0.5-verification
- Clean branch: release/p0-p0.5-verification-clean
- The clean branch was created in an isolated temporary worktree from 60bc15f.
- 7f74d73 was cherry-picked as 21b55af. Its diff contains only the eight
  intended FE Mind Map V2 files.
- cbeb475, 335f196, ca15abe, and 02d9b00 were not cherry-picked.

## Forensic hunk manifest for cbeb475

The manifest was produced by comparing the clean-base files, the complete
7f74d73..cbeb475 diff, the V2 tests/specification, and the surrounding
history. No uncertain hunk was carried into the clean candidate.

| File | V2_REQUIRED retained | PREEXISTING_UNRELATED_WIP excluded | UNCERTAIN |
|---|---|---|---|
| BE/app/graphs/mindmap_graph.py | Import/call to deterministic V2 hierarchy validation at assembly; merge validator issue codes into generator.missing. | Skeleton/enrich timing; reasons; enrichment metrics; adaptive allocation; recovery/self-healing; quality reports and analytics. | None |
| BE/services/mindmap/pipeline/outline.py | Explicit V2 prompt constraints; permit the V2 maximum of eight sections. | Adaptive branch-budget imports and environment caps; dynamic prompt generation; provenance helpers and per-document allocation behavior. | None |
| BE/services/mindmap/pipeline/schema.py | layout_version; generation_profile; topic compaction with full text retained in note. | Phase-2B environment caps, expanded node metadata, enrichment fields, allocation fields, and other pipeline telemetry. | None |
| BE/tests/test_mindmap_graph.py | Exact degraded-result assertion includes the two V2 structural flags, with a comment explaining the intentionally one-branch V2 fixture. | Collector/reason plumbing and large self-healing/analytics tests. | None |
| BE/tests/test_mindmap_schema_v2.py | Schema metadata and topic-compaction tests. | None in the retained test additions. | None |
| BE/services/mindmap/pipeline/v2_constraints.py | Entire file: pure deterministic V2 structural validator. | None; the file was new in cbeb475 and was reconstructed rather than cherry-picked. | None |
| BE/tests/test_mindmap_v2_constraints.py | Entire file: focused boundary tests for the V2 validator. | None; reconstructed from the required behavior, not cherry-picked. | None |

The clean candidate intentionally does not include the playbook addition from
cbeb475; that addition described the mixed candidate and is not a code
requirement for the reconstructed implementation.

## Implemented V2 contract

The backend changes are deliberately small:

- schema_version = 2
- layout_version = side-balanced-v2
- generation_profile = learning-map-v2
- Deterministic validation of 5–8 root branches, maximum depth 3, and 2–5
  children for every non-leaf node. Leaves with zero children remain valid.
- Rich inputs with at least ten chunks are marked incomplete when the result
  has fewer than 15 nodes.
- Topics are normalized and compacted to at most 100 characters. The original
  text is retained in note.
- Existing IDs, chunk_refs, citations, and semantic ordering are preserved.
- Invalid V2 output receives explicit V2_* entries in generator.missing; no
  siblings are invented and no legacy persisted record is revalidated on read.
- The outline prompt states the same constraints, while the deterministic
  validator remains authoritative.

## Intended-file allowlist

FE:

- FE/src/components/mindmap/MindElixirView.jsx
- FE/src/components/mindmap/MindElixirView.newControls.test.jsx
- FE/src/components/mindmap/mindmap.css
- FE/src/utils/mindElixirAdapter.js
- FE/src/utils/mindElixirAdapter.test.js
- FE/src/utils/mindmapLayout.js
- FE/src/utils/mindmapLayout.test.js
- FE/src/utils/mindmapNormalize.js

BE:

- BE/app/graphs/mindmap_graph.py
- BE/services/mindmap/pipeline/outline.py
- BE/services/mindmap/pipeline/schema.py
- BE/services/mindmap/pipeline/v2_constraints.py
- BE/tests/test_mindmap_graph.py
- BE/tests/test_mindmap_schema_v2.py
- BE/tests/test_mindmap_v2_constraints.py

Documentation:

- docs/MINDMAP_WORKSPACE_V2_REPORT.md

The four formerly contaminated files were compared directly with:

    git diff 60bc15f -- BE/app/graphs/mindmap_graph.py BE/services/mindmap/pipeline/outline.py BE/services/mindmap/pipeline/schema.py BE/tests/test_mindmap_graph.py

Only the allowlisted V2 hunks appear. No unrelated backend WIP is staged or
included.

## Gate A verification

Commands and results from the isolated clean worktree:

| Check | Result |
|---|---|
| python -m pytest -q tests/test_mindmap_v2_constraints.py tests/test_mindmap_schema_v2.py tests/test_mindmap_graph.py | exit 0, 18 passed |
| python scripts/build_proto.py | exit 0; generated artifacts are ignored and not committed |
| python -m pytest -q over all 17 Mind Map regression files | exit 0, 88 passed, 5 warnings |
| npm test -- --run | exit 0, 93 files / 1072 tests passed |
| npm run build | exit 0 |
| npm run lint | exit 1 with the established baseline: 66 findings, 60 errors, 6 warnings; candidate matches the original worktree baseline |
| git diff --check | exit 0; only normal LF/CRLF conversion notices were emitted |

The first backend regression collection attempt exposed the repository's
ignored generated-protobuf prerequisite (shared.proto.gen missing in a fresh
worktree). Running the repository's existing scripts/build_proto.py resolved
that environment prerequisite; no generated files were added to the candidate.

## Commits

- FE clean commit: 21b55af
- BE V2 constraints commit: 5a0f9c4
- This report commit: pending until the final report-only commit

## Gate B — pending

No deployment, live map generation, disposable QA account, browser screenshots,
or browser console/network evidence was performed in this recovery pass.

Gate B still requires deployment of this clean branch and a newly generated
schema-v2 map, followed by the real structural checks, responsive light/dark
screenshots, map switching/drawer/viewport checks, and console/network
verification. The contaminated branch must not be used for that acceptance.
