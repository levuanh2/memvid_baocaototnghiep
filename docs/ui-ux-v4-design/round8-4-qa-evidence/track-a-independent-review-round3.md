# Track A Independent Review — Round 3

Reviewer: Codex2 — not an author of Track A or the Round 3 fixes.

Target: branch `fix/studymap-v4-round8-4-deploy-safety`, SHA `de88b8a0726c35b20315063ff8803521175a7056`.

1. **FIXED — wrapper lock.** `scripts/deploy_remote.sh:20-35,38-43` opens and locks fd 9 before reading HEAD/fetch/checkout, passes that descriptor to `deploy.sh`, and retains it through the status-75 restore. `_lib.sh:115-124` validates the inherited fd and lock path.
2. **FIXED — exact build inputs.** `_lib.sh:127-138` checks modified, untracked, and ignored inputs. It runs before build on pinned deploy (`deploy.sh:127-129`), unpinned deploy (`deploy.sh:135-138`), and rollback (`rollback.sh:43-50`).
3. **FIXED — ledger inheritance removed.** No `append_inherited`, `MEMVID_PREVIOUS_DEPLOY_SHA`, or rollback-eligible `inherited` action remains. `rollback.sh:27` accepts only `deploy`, `rollback`, or `break-glass`. `MEMVID_LOCK_INHERITED` at `_lib.sh:118-124` is only the verified fd-9 lock handoff.
4. **FIXED — tests and independent `head_sha` mutation.** The combined WSL command exited 0: all 13 pinning scenario groups passed and all 22 guard mutations were detected. The former escaping mutation is now explicit at `scripts/tests/test_deploy_guard_mutations.sh:50`; removing `head_sha=${DEPLOY_SHA}` made the main harness fail.
5. **NEW LOW — evidence report has stale pre-fix prose.** `docs/ui-ux-v4-design/round8-4-qa-evidence/codex1/R84A-REPORT.md:62-65,87-93` still says inheritance exists, while its Round 3 correction at `:188` says it was removed. Update the earlier sections to avoid contradictory evidence; runtime code is unaffected.

## Verdict: APPROVE

All four requested safety checks pass. No requested item remains unverified.
