from types import SimpleNamespace

import pytest

from app.clients.llm_factory import _FptChatLLM, _MeteredChatModel
from app.domains.usage.context import UsageReservationContext


def test_fpt_response_preserves_official_usage(monkeypatch):
    class Response:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": "ok"}}], "usage": {"prompt_tokens": 12, "completion_tokens": 7, "total_tokens": 19}}

    monkeypatch.setattr("requests.post", lambda *args, **kwargs: Response())
    client = _FptChatLLM(api_key="test", base_url="http://provider.test", model="model", temperature=0, max_tokens=100, timeout=2)
    result = client.invoke("hello")
    assert result.content == "ok"
    assert result.usage_metadata == {"input_tokens": 12, "output_tokens": 7, "total_tokens": 19}


def _context():
    return UsageReservationContext(
        user_id="user", reservation_id="reservation", idempotency_key="request",
    )


def test_stream_records_only_final_cumulative_usage(monkeypatch):
    recorded = []
    monkeypatch.setattr(
        "app.domains.usage.accounting.record_provider_response",
        lambda context, response, **kwargs: recorded.append((response.usage_metadata, kwargs)),
    )

    class Provider:
        model = "provider-model"

        def stream(self, *_args, **_kwargs):
            yield SimpleNamespace(content="a", usage_metadata={"input_tokens": 4, "output_tokens": 1})
            yield SimpleNamespace(content="b", usage_metadata={"input_tokens": 4, "output_tokens": 2})

    assert [chunk.content for chunk in _MeteredChatModel(
        Provider(), _context(), "stream-1", "fpt",
    ).stream([])] == ["a", "b"]
    assert len(recorded) == 1
    assert recorded[0][0]["output_tokens"] == 2
    assert recorded[0][1]["status"] == "committed"
    assert recorded[0][1]["usage_source"] == "provider"


def test_stream_failure_records_only_evidenced_partial_usage(monkeypatch):
    recorded = []
    monkeypatch.setattr(
        "app.domains.usage.accounting.record_provider_response",
        lambda context, response, **kwargs: recorded.append((response.usage_metadata, kwargs)),
    )

    class Provider:
        model = "provider-model"

        def stream(self, *_args, **_kwargs):
            yield SimpleNamespace(content="partial", usage_metadata={"input_tokens": 5, "output_tokens": 1})
            raise RuntimeError("provider disconnected")

    with pytest.raises(RuntimeError, match="provider disconnected"):
        list(_MeteredChatModel(Provider(), _context(), "stream-2", "fpt").stream([]))
    assert len(recorded) == 1
    assert recorded[0][1]["status"] == "partial"


def test_provider_error_before_usage_creates_no_event(monkeypatch):
    recorded = []
    monkeypatch.setattr(
        "app.domains.usage.accounting.record_provider_response",
        lambda *args, **kwargs: recorded.append((args, kwargs)),
    )

    class Provider:
        def stream(self, *_args, **_kwargs):
            raise RuntimeError("failed before first chunk")
            yield  # pragma: no cover

    with pytest.raises(RuntimeError, match="before first chunk"):
        list(_MeteredChatModel(Provider(), _context(), "stream-3", "fpt").stream([]))
    assert recorded == []


def test_local_ollama_counters_are_labeled_estimated(monkeypatch):
    recorded = []
    monkeypatch.setattr(
        "app.domains.usage.accounting.record_provider_response",
        lambda context, response, **kwargs: recorded.append(kwargs),
    )

    class Provider:
        model = "local-model"

        def invoke(self, *_args, **_kwargs):
            return SimpleNamespace(content="ok", usage_metadata={"input_tokens": 2, "output_tokens": 1})

    _MeteredChatModel(Provider(), _context(), "local-1", "ollama").invoke([])
    assert recorded[0]["usage_source"] == "estimated"
