"""`ask_ai` / `ProviderPool.ask`: a `timeout` is a real deadline for the whole operation.

Found by a read-only audit (Codex task28, 2026-11-17), reproduced here with fake providers
only: no network, no model, no `.env`.

  - `_invoke_chat` used `with ThreadPoolExecutor(...)`: after `fut.result(timeout)` raised,
    `__exit__` waited for the provider thread, so the caller got control back only when
    the provider finished (forever for a stalled Ollama).
  - Ollama got no HTTP timeout: `ask_ai` never passed one, and the builder's top-level
    `timeout=` is not a `ChatOllama` field in langchain-ollama 0.3.x (silently ignored;
    the httpx client kept `Timeout(None)`).
  - Gemini / Groq got no timeout at all and their SDK retries (6 / 2) ran inside the call.
  - Each provider in the fallback chain got a fresh full `timeout`.

What a deadline here can and cannot do: the caller gets control back at the deadline and
no further provider is started. A request already sent is NOT cancelled at the provider:
the worker thread keeps running until the HTTP client's own timeout (now set) ends it,
and the provider may still finish and bill the call. Python cannot abort that thread.
"""
from __future__ import annotations

import threading
import time

import pytest

import app.clients.llm_factory as lf

SLOW = 3.0  # how long a "hanging" fake provider holds the thread before giving up


class _Hanging:
    """A chat model whose `invoke` blocks until released or SLOW seconds pass."""

    def __init__(self, name, log):
        self.name, self.log = name, log
        self.release = threading.Event()

    def invoke(self, msgs, stream=False):
        self.log.append(("start", self.name, time.monotonic()))
        self.release.wait(SLOW)
        self.log.append(("end", self.name, time.monotonic()))
        raise RuntimeError(f"{self.name} gave up")


class _Answer:
    def __init__(self, text="ok"):
        self.content = text

    def invoke(self, msgs, stream=False):
        return self


@pytest.fixture()
def chain(monkeypatch):
    """PROVIDERS = fpt, ollama, gemini, groq; every builder records the timeout it got."""
    built, log = [], []
    hanging = {}

    def _builder(name):
        def _b(*args, **kwargs):
            built.append((name, kwargs.get("timeout")))
            hanging[name] = _Hanging(name, log)
            return hanging[name]
        return _b

    monkeypatch.setattr(lf, "PROVIDERS", ["fpt", "ollama", "gemini", "groq"])
    monkeypatch.setattr(lf, "_fpt_chat_llm", _builder("fpt"))
    monkeypatch.setattr(lf, "_ollama_chat_llm", _builder("ollama"))
    monkeypatch.setattr(lf, "_gemini_chat_llm", _builder("gemini"))
    monkeypatch.setattr(lf, "_groq_chat_llm", _builder("groq"))
    monkeypatch.setattr(lf, "_gateway_addr", lambda: "")
    yield built, log
    for h in hanging.values():
        h.release.set()


def test_invoke_chat_returns_at_its_deadline_even_if_the_provider_hangs():
    log = []
    llm = _Hanging("stuck", log)
    started = time.monotonic()
    try:
        with pytest.raises(TimeoutError):
            lf._invoke_chat(llm, "hi", None, timeout=0.3)
        assert time.monotonic() - started < 1.0, "the caller waited for the provider thread"
    finally:
        llm.release.set()


def test_the_fallback_chain_shares_one_deadline(chain):
    built, _log = chain
    started = time.monotonic()
    with pytest.raises(Exception):
        lf.ask_ai("hi", timeout=1.0, total_timeout=1.0)
    elapsed = time.monotonic() - started
    assert elapsed < 1.6, f"4 providers took {elapsed:.1f}s for a 1s deadline"
    timeouts = [t for _name, t in built]
    assert all(t is not None and t <= 1.0 for t in timeouts), timeouts


def test_no_provider_is_started_after_the_deadline(chain):
    built, log = chain
    with pytest.raises(Exception) as e:
        lf.ask_ai("hi", timeout=0.5, total_timeout=0.5)
    assert len(built) == 1, f"providers started after the deadline: {built}"
    assert "deadline" in str(e.value).lower()


def test_a_fast_fallback_still_answers_within_the_deadline(monkeypatch, chain):
    built, _log = chain
    monkeypatch.setattr(lf, "PROVIDERS", ["fpt", "ollama"])
    monkeypatch.setattr(lf, "_fpt_chat_llm", lambda *a, **k: (_ for _ in ()).throw(
        RuntimeError("fpt down at once")))
    monkeypatch.setattr(lf, "_ollama_chat_llm", lambda *a, **k: _Answer("from ollama"))
    assert lf.ask_ai("hi", timeout=2.0, total_timeout=2.0) == "from ollama"


def test_without_a_timeout_nothing_changes(monkeypatch):
    """Callers that pass no timeout keep today's behaviour exactly (no executor)."""
    monkeypatch.setattr(lf, "PROVIDERS", ["ollama"])
    monkeypatch.setattr(lf, "_gateway_addr", lambda: "")
    seen = []
    monkeypatch.setattr(lf, "_ollama_chat_llm",
                        lambda *a, **k: (seen.append(k.get("timeout")), _Answer("x"))[1])
    created = []
    import concurrent.futures as cf
    original = cf.ThreadPoolExecutor

    class _Spy(original):
        def __init__(self, *a, **k):
            created.append(1)
            super().__init__(*a, **k)

    monkeypatch.setattr(cf, "ThreadPoolExecutor", _Spy)
    assert lf.ask_ai("hi") == "x"
    assert seen == [None] and created == []


def test_ollama_gets_a_real_http_timeout():
    llm = lf._ollama_chat_llm("m", "chat", None, timeout=7.0)
    t = llm._client._client.timeout
    assert t.read == 7.0 and t.connect is not None and t.connect <= 7.0


def test_gemini_and_groq_get_a_timeout_and_bounded_retries(monkeypatch):
    """Constructed offline with fake keys; nothing is sent."""
    monkeypatch.setenv("GEMINI_API_KEY", "fake-key")
    monkeypatch.setenv("GROQ_API_KEY", "fake-key")
    gem = lf._gemini_chat_llm("chat", None, timeout=9.0)
    assert gem.timeout == 9.0 and gem.max_retries == 1
    groq = lf._groq_chat_llm("chat", None, timeout=9.0)
    assert groq.request_timeout == 9.0 and groq.max_retries == 0
    # Without a deadline the SDK defaults stay (no behaviour change for those callers).
    assert lf._groq_chat_llm("chat", None).max_retries == 2


def test_fpt_uses_connect_and_read_timeouts(monkeypatch):
    import requests

    seen = {}

    def _post(url, **kw):
        seen.update(kw)
        raise requests.ConnectionError("offline test")

    monkeypatch.setattr(requests, "post", _post)
    llm = lf._FptChatLLM(api_key="k", base_url="http://fpt.invalid/v1", model="m",
                         temperature=0, max_tokens=8, timeout=40.0)
    with pytest.raises(RuntimeError):
        llm.invoke("hi")
    connect, read = seen["timeout"]
    assert connect <= 10.0 and read == 40.0


def test_the_gateway_pool_shares_one_deadline_too(chain):
    from app.clients.local_providers import ProviderPool

    built, _log = chain
    pool = ProviderPool(providers=["fpt", "ollama", "gemini", "groq"])
    started = time.monotonic()
    with pytest.raises(Exception):
        pool.ask("hi", timeout=1.0, total_timeout=1.0)
    assert time.monotonic() - started < 1.6


def test_a_plain_timeout_stays_per_provider_but_is_now_real(chain):
    """Unrelated callers (quiz with 900 s for a slow Ollama, ...) keep their meaning:
    every provider gets its own `timeout`, so a fallback is still tried after the first
    one times out. What changed: each wait really ends at `timeout`."""
    built, _log = chain
    started = time.monotonic()
    with pytest.raises(Exception):
        lf.ask_ai("hi", timeout=0.4)
    elapsed = time.monotonic() - started
    assert [name for name, _t in built] == ["fpt", "ollama", "gemini", "groq"]
    assert all(t == 0.4 for _name, t in built), built
    assert elapsed < 0.4 * 4 + 0.8, f"{elapsed:.1f}s: a wait outlived its timeout"


def test_grading_asks_for_one_deadline_for_the_whole_chain():
    from app.domains.attempts import grading

    seen = {}

    def _ask(*a, **k):
        seen.update(k)
        return '{"verdict": "correct", "feedback": "", "missing_points": []}'

    grading.grade_short_answer(question="q", correct_answer="a", user_answer="x",
                               ask=_ask, timeout_sec=42.0)
    assert seen["timeout"] == 42.0 and seen["total_timeout"] == 42.0
