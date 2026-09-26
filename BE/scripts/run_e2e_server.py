#!/usr/bin/env python3
"""Deterministic backend for Playwright E2E (FE/e2e/**).

Boots the REAL Flask app (real routes, real DB models, real auth, real job
polling loop, real ingest pipeline) but swaps the two things that would
otherwise call a live model provider — QUERY_GRAPH and MINDMAP_GRAPH — for
mock objects mirroring the ones `BE/tests/conftest.py` uses for the pytest
`client` fixture. Ingest is NOT bypassed (unlike that fixture): a real
browser flow selects sources via SidebarLeft, which needs real chunks in
the retrieval index, not just a `documents.status` flag — see the comment
in `main()` below for the full reasoning.

This is deliberately NOT `app.main:app` run directly under gunicorn (that
would use the real graphs and try to reach FPT/Ollama). It is the one place
CI runs a real, network-bound HTTP server against a browser, so it must be
100% offline and 100% deterministic — no live provider, no live Supabase, no
production credentials.

ponytail: duplicates conftest.py's mock classes instead of importing pytest
fixtures into a non-test runtime (importing pytest machinery here would be
backwards — fixtures are pytest-only by design). If the two ever drift, the
Playwright suite and the pytest `client`-fixture suite would test different
mock behavior; keep them in sync by hand until that actually bites.

Env knobs (all optional, sane CI defaults applied here so this also runs
locally with just `python BE/scripts/run_e2e_server.py`):
  PORT                              default 8080
  E2E_FORCE_FAIL_MARKER             default "__E2E_FORCE_FAIL__" — any
                                     generate-mindmap/-summary request whose
                                     prompt/instruction contains this string
                                     is deterministically failed, to exercise
                                     FE/src/utils/jobPoller.js's "failed"
                                     terminal-state handling (see PR #36).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

BE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BE_ROOT))

# ---------------------------------------------------------------------------
# Env MUST be set before `app.main` (and anything it imports) runs, exactly
# like conftest.py's `client` fixture does — llm_factory.PROVIDERS and
# guided_store.use_postgres() are both computed at import/call time from env.
# ---------------------------------------------------------------------------
os.environ.setdefault("SKIP_MODEL_LOAD", "1")
os.environ.setdefault("MEMVID_DISABLE_LC_DEFAULTS", "1")
os.environ.setdefault("USE_SQLITE_JOBS", "0")
os.environ.setdefault("AUTH_PROTECT_APP_APIS", "false")
os.environ.setdefault("CONVERSATION_CONTEXT_ENABLED", "false")
os.environ.setdefault("OLLAMA_HOST", "http://127.0.0.1:11434")
# Guided Mind Map V3: scoped ON for this ephemeral E2E process only — this
# script never writes a real .env file, so the project-wide default (false,
# per CLAUDE.md constraints) is untouched. `sqlite` backend routes Guided
# jobs through the same MINDMAP_GRAPH mock below instead of requiring a
# separate Postgres-backed worker + heartbeat.
os.environ.setdefault("GUIDED_MINDMAP_V3_ENABLED", "true")
os.environ.setdefault("GUIDED_JOB_STORE_BACKEND", "sqlite")
# Same ephemeral Postgres the rest of CI already uses (backend-integration-and-smoke).
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/studymap_test")
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("GROQ_API_KEY", None)
os.environ.pop("FPT_AI_API_KEY", None)
os.environ.setdefault("QUEUE_ENABLED", "")

import tempfile
data_dir = os.environ.get("DATA_DIR") or tempfile.mkdtemp(prefix="memvid_e2e_")
os.environ["DATA_DIR"] = data_dir

FORCE_FAIL_MARKER = os.environ.get("E2E_FORCE_FAIL_MARKER", "__E2E_FORCE_FAIL__")


class MockQueryGraph:
    def invoke(self, state, config=None, **_kwargs):
        return {"payload": {"answer": "mock answer"}, "status_code": 200}


class MockMindmapGraph:
    """Deterministic stand-in for the real LangGraph mindmap pipeline.

    Mirrors conftest.py's `_MockMindmapGraph`, plus one addition: a request
    whose text contains FORCE_FAIL_MARKER is failed on purpose, so the E2E
    suite can drive the poller's "failed" terminal state (protects PR #36 —
    FE/src/utils/jobPoller.js recognizing "failed" and stopping polling)
    without needing a real model to actually fail.
    """

    def invoke(self, state, config=None, **_kwargs):
        from app.domains.jobs.jobs_store import update_job

        job_id = state.get("job_id")
        text_blob = " ".join(str(state.get(k) or "") for k in ("q", "instruction", "generation_intent"))
        if FORCE_FAIL_MARKER in text_blob:
            if job_id:
                try:
                    update_job(job_id, status="failed", progress=40,
                               error="E2E deterministic forced failure")
                except Exception:
                    pass
            return {"result": None, "status_code": 500, "error": "E2E deterministic forced failure"}

        import time as _time
        record = {
            "id": f"e2e-map-{job_id or 'sync'}-{_time.time_ns()}",
            "schema_version": 2,
            # Suffixed with the job id so distinct submissions in the same
            # E2E run produce visibly distinct titles (A/B map-switching spec
            # asserts on this text — a fixed title would make A and B
            # indistinguishable in the library list).
            "title": f"E2E mock mindmap {(job_id or 'sync')[-8:]}",
            "nodes": [{"id": "root", "parent": None, "kind": "root", "title": "E2E mock mindmap"}],
            "relations": [],
            "sources": state.get("source_names") or [],
            "content_hash": state.get("content_hash") or "",
            "created_at": "2026-01-01T00:00:00Z",
            "generator": {"pipeline": "mock", "model": "mock", "elapsed_sec": 0.0,
                          "degraded": False, "missing": []},
        }
        # A real graph's AssemblePersist node writes the record to
        # mindmap_store (SQLite) before marking the job done — GET /mindmaps
        # (SidebarRight's library list) reads from THAT store, not from the
        # job row. Skipping this made the FE's post-done `fetchMindMaps()`
        # silently drop the just-created map back out of the list.
        try:
            from app.domains.mindmap import store as mindmap_store
            mindmap_store.save_record(record, user_id=state.get("user_id"))
        except Exception as exc:
            print(f"[run_e2e_server] mindmap_store.save_record failed: {exc}", flush=True)
        if job_id:
            try:
                update_job(job_id, status="done", progress=100,
                           current_node="AssemblePersist", result=record)
            except Exception:
                pass
        return {"result": record, "status_code": 200}


def main() -> None:
    import app.main as be_main  # noqa: E402  (env must be set first, see above)

    be_main.QUERY_GRAPH = MockQueryGraph()
    be_main.MINDMAP_GRAPH = MockMindmapGraph()

    # Deliberately NOT patching _trigger_background_ingest (unlike
    # conftest.py's `client` fixture, which bypasses ingest entirely for
    # pytest tests that call the API directly). A real browser flow selects
    # sources through SidebarLeft, which reads GET /list-indexed — that
    # endpoint reads REAL chunks from the retrieval index (INDEX_META_JSON_PATH),
    # not documents.status. A source with status=index_ready but no real
    # chunks is invisible there, so mind map/chat generation could never be
    # exercised through the actual UI. Since the FE fixture only uploads a
    # tiny plain-text file, the REAL ingest pipeline (extract -> chunk ->
    # FakeEmbeddings, same SKIP_MODEL_LOAD=1 fake used everywhere else in CI)
    # completes in well under a second — no OCR, no real model, no network.
    Path(be_main.INPUT_DIR).mkdir(parents=True, exist_ok=True)

    port = int(os.environ.get("PORT", "8080"))
    print(f"[run_e2e_server] listening on 0.0.0.0:{port} (SKIP_MODEL_LOAD=1, mocked graphs)", flush=True)
    be_main.app.run(host="0.0.0.0", port=port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
