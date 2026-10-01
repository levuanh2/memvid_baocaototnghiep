from app.clients.llm_factory import _FptChatLLM


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
