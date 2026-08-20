# Auth test-fixture resolution

## Cause

The root development `.env` intentionally has `AUTH_PROTECT_APP_APIS=true`. The session-scoped legacy Flask client inherited that value, while 37 endpoint tests expected anonymous access. `CONVERSATION_CONTEXT_ENABLED` was similarly implicit. This made results depend on the developer’s runtime environment rather than the test contract.

## Resolution

`BE/tests/conftest.py` now sets `AUTH_PROTECT_APP_APIS=false` and `CONVERSATION_CONTEXT_ENABLED=false` before importing/reloading the application and shared settings. Tests that exercise protected behavior continue to opt in by monkeypatching the production gate. Production `.env`, route authentication, and defaults were not weakened.

One remaining failure after the environment fix was unrelated: `test_owner_generate_cache_hit` mocked `_summary_input_and_hash` with its obsolete two-argument signature. The fixture now accepts the current `(sources, length_mode, mode)` signature.

## Validation

- Focused auth/conversation/summary ownership suite: 32 passed.
- Complete backend suite: 663 passed, 1 skipped.
- Remaining failures: none.
- Warnings: existing package deprecations, CPU-core discovery, and a synthetic clustering convergence warning.
