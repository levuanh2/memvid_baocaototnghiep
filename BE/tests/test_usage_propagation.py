"""Route-to-provider proofs for explicit usage reservation propagation."""
from __future__ import annotations

import io
import time
from types import SimpleNamespace

from werkzeug.datastructures import FileStorage

from app.clients.llm_factory import _MeteredChatModel
from app.domains.usage import UsageReservationContext, get_summary, list_events


def test_query_route_propagates_context_to_provider_and_commits(
    client, monkeypatch, tmp_path,
):
    import app.main as main

    monkeypatch.setenv("USAGE_DB_PATH", str(tmp_path / "query-usage.sqlite"))
    monkeypatch.setattr(main, "_current_user_id", lambda: "route-user")
    monkeypatch.setattr(main, "_get_cached_query", lambda *_a, **_k: None)

    class Provider:
        model = "mock-provider-model"

        def invoke(self, *_args, **_kwargs):
            return SimpleNamespace(
                content="answer",
                usage_metadata={
                    "input_tokens": 9, "output_tokens": 3, "total_tokens": 12,
                },
            )

    class Graph:
        def invoke(self, state, config=None, **_kwargs):
            context = UsageReservationContext.from_dict(state["usage_context"])
            assert context is not None and context.user_id == "route-user"
            result = _MeteredChatModel(
                Provider(), context, "query-answer:0", "fpt",
            ).invoke([])
            return {"payload": {"answer": result.content}, "status_code": 200}

    monkeypatch.setattr(main, "QUERY_GRAPH", Graph())
    response = client.post(
        "/query",
        json={
            "q": "test", "sources": [], "use_memory_tree": False,
            "idempotency_key": "route-provider-1",
        },
    )
    assert response.status_code == 202
    job_id = response.get_json()["job_id"]
    body = None
    for _ in range(100):
        body = client.get(f"/query-status/{job_id}").get_json()
        if body.get("status") in {"done", "error"}:
            break
        time.sleep(0.02)

    assert body["status"] == "done"
    assert body["usage"]["total_tokens"] == 12
    assert body["usage"]["usage_source"] == "provider"
    assert get_summary("route-user")["used"] == 12
    events = list_events("route-user")
    assert len(events) == 1 and events[0]["attempt_id"] == "query-answer:0"


def test_upload_passes_serializable_context_and_releases_before_worker_failure(
    monkeypatch,
):
    import app.main as main

    context = UsageReservationContext(
        user_id="upload-user",
        reservation_id="upload-reservation",
        idempotency_key="upload-idempotency",
        job_id="upload-job",
    )
    captured = {}
    monkeypatch.setattr(main, "_current_user_id", lambda: "upload-user")
    monkeypatch.setattr(main, "_reserve_usage_context", lambda *a, **k: context)

    def fail_before_worker(file, *, source_id, uid, usage_context):
        captured.update({"uid": uid, "context": usage_context, "source_id": source_id})
        raise main.IngestQueueRequired("queue unavailable")

    monkeypatch.setattr(main, "_ingest_uploaded_file_reserved", fail_before_worker)
    monkeypatch.setattr(
        main,
        "_finish_usage_context",
        lambda ctx, *, status, job_id=None: captured.update({
            "finished_context": ctx, "status": status, "job_id": job_id,
        }),
    )
    upload = FileStorage(stream=io.BytesIO(b"document"), filename="doc.md")
    with main.app.test_request_context(
        "/upload-file", method="POST", headers={"X-Request-ID": "upload-request"},
    ):
        try:
            main._ingest_uploaded_file(upload)
        except main.IngestQueueRequired:
            pass
        else:  # pragma: no cover - explicit failure contract
            raise AssertionError("expected queue failure")

    assert captured["uid"] == "upload-user"
    assert captured["context"] is context
    assert captured["finished_context"] is context
    assert captured["status"] == "released"
    assert captured["job_id"] == captured["source_id"]
