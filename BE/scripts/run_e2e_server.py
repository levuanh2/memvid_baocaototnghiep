#!/usr/bin/env python3
"""Deterministic backend for Playwright E2E (FE/e2e/**).

Boots the REAL Flask app (real routes, real DB models, real auth, real job
polling loop) but swaps the two things that would otherwise call a live
model provider — QUERY_GRAPH and MINDMAP_GRAPH — for mock objects mirroring
the ones `BE/tests/conftest.py` uses for the pytest `client` fixture. Ingest
is ALSO faked, but not the way conftest.py fakes it (see `_fast_ingest`'s
own docstring in `main()` below for why a real-browser flow needs a
different fake than a pytest-fixture flow does here).

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

    def _fast_ingest(source_id: str, file_path: str, filename: str):
        """Deterministic stand-in for the real INGEST_GRAPH.

        First attempt here just flipped documents.status to index_ready —
        that made the source appear in DocumentList (Postgres-backed) but
        stay permanently invisible in SidebarLeft, because SidebarLeft's
        fetchSourcesFromBackend calls GET /list-indexed, which reads the
        RETRIEVAL index (chunks in INDEX_META_JSON_PATH / chunk_text_store),
        never documents.status.

        Second attempt let the REAL INGEST_GRAPH run — but
        vectorstore/store.py's own `_skip_faiss_in_ci()` intentionally makes
        `append_to_index(..., embeddings=None)` a no-op whenever
        SKIP_MODEL_LOAD=1 and no FPT key is set (exactly this job's env):
        "embedding qua HTTP không nạp gì... nếu áp thì... index vẫn không
        bao giờ được ghi ở đúng nơi cần nó nhất" — i.e. this CI-mode skip is
        deliberate for the pytest suite (which never needs a real index —
        it drives the API directly, not the SidebarLeft UI), and it silently
        made every E2E upload permanently unselectable in the real browser.

        Fix: call `append_to_index` directly with EXPLICIT fake embeddings
        (not None) — that one condition (`embeddings is None`) is exactly
        what the CI-skip checks, so passing a real (if fake) vector bypasses
        it and writes a genuine FAISS index + index.json + chunk_text_store,
        deterministically and near-instantly (no model, no network).
        """
        from shared.source_id import canonical_source_stem
        stem = canonical_source_stem(filename)
        try:
            text = Path(file_path).read_text(encoding="utf-8", errors="ignore")
        except Exception:
            text = filename
        chunks = [p.strip() for p in text.split("\n\n") if p.strip()] or [text or filename]

        import numpy as np
        from app.domains.vectorstore import store as vector_store
        vector_store.append_to_index(
            chunks, source_name=stem,
            custom_metadata=[{"source_stem": stem, "heading_path": stem} for _ in chunks],
            embeddings=np.zeros((len(chunks), 8), dtype="float32"),
        )
        be_main._update_source_status(
            source_id, "index_ready", progress=1.0,
            capabilities={"chunk_query": True},
        )

    be_main._trigger_background_ingest = lambda sid, fp, fn: _fast_ingest(sid, fp, fn)
    Path(be_main.INPUT_DIR).mkdir(parents=True, exist_ok=True)

    port = int(os.environ.get("PORT", "8080"))
    print(f"[run_e2e_server] listening on 0.0.0.0:{port} (SKIP_MODEL_LOAD=1, mocked graphs)", flush=True)
    be_main.app.run(host="0.0.0.0", port=port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
