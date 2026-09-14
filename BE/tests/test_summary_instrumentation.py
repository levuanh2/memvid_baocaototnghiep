# BE/tests/test_summary_instrumentation.py — P0.5 Blocker #1: Summary per-section
# diagnostics. `diagnostics_sink` is purely additive — these tests exist specifically
# to prove that (a) each real code path populates honest diagnostics, and (b) omitting
# `diagnostics_sink` (every pre-existing call site) leaves `summarize_sections`'s
# primary return value byte-identical to before this change.
import json

import pytest

from services.summary.pipeline import summarize as sz


_MM = {"title": "Doc", "sources": ["a_docx"],
       "chunks": [{"key": "0", "text": "nội dung 0", "heading_path": "1. A", "chunk_keys": ["0"]},
                  {"key": "1", "text": "nội dung 1", "heading_path": "2. B", "chunk_keys": ["1"]}]}
_SECTIONS = [{"id": "s1", "title": "A", "chunk_refs": ["0"], "order": 0},
             {"id": "s2", "title": "B", "chunk_refs": ["1"], "order": 1}]


@pytest.fixture(autouse=True)
def _no_skip(monkeypatch):
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)


def _ok_payload(refs, summary="tóm tắt"):
    return json.dumps({"summary": summary, "key_points": ["ý 1"], "chunk_keys": refs})


def test_success_path_records_status_provider_timing(monkeypatch):
    monkeypatch.setattr(sz, "ask_ai", lambda *a, **k: _ok_payload(["0"]))
    sink: list[dict] = []
    out, missing = sz.summarize_sections(_MM, _SECTIONS[:1], timeout_sec=5, max_workers=1,
                                         diagnostics_sink=sink)
    assert missing == []
    assert len(sink) == 1
    d = sink[0]
    assert d["section_id"] == "s1"
    assert d["status"] == "ok"
    assert d["provider"] is not None
    assert isinstance(d["elapsed_ms"], int) and d["elapsed_ms"] >= 0
    assert d["retry_count"] == 0
    assert d["empty_output"] is False
    assert d["fallback_used"] is False
    assert d["token_usage"] is None  # honest safe default — ask_ai doesn't expose it


def test_empty_output_marks_empty_and_fallback(monkeypatch):
    monkeypatch.setattr(sz, "ask_ai", lambda *a, **k: _ok_payload(["0"], summary=""))
    sink: list[dict] = []
    sz.summarize_sections(_MM, _SECTIONS[:1], timeout_sec=5, max_workers=1, diagnostics_sink=sink)
    d = sink[0]
    assert d["status"] == "ok"          # the call itself succeeded
    assert d["empty_output"] is True    # but produced nothing usable
    assert d["fallback_used"] is True   # pipeline kept the skeleton's empty summary


def test_retry_path_records_retry_count_one(monkeypatch):
    calls = {"n": 0}

    def flaky(*a, **k):
        calls["n"] += 1
        return "{broken" if calls["n"] == 1 else _ok_payload(["0"])

    monkeypatch.setattr(sz, "ask_ai", flaky)
    sink: list[dict] = []
    sz.summarize_sections(_MM, _SECTIONS[:1], timeout_sec=5, max_workers=1, diagnostics_sink=sink)
    assert sink[0]["retry_count"] == 1
    assert sink[0]["status"] == "ok"


def test_exception_path_records_failure_reason(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("llm down")

    monkeypatch.setattr(sz, "ask_ai", boom)
    sink: list[dict] = []
    out, missing = sz.summarize_sections(_MM, _SECTIONS, timeout_sec=5, max_workers=1,
                                         diagnostics_sink=sink)
    assert set(missing) == {"section:A", "section:B"}
    assert len(sink) == 2
    for d in sink:
        assert d["status"] == "failed"
        assert "llm down" in d["failure_reason"]
        assert d["fallback_used"] is True
        assert d["empty_output"] is True


def test_cancel_before_start_records_cancelled_for_every_section(monkeypatch):
    monkeypatch.setattr(sz, "ask_ai", lambda *a, **k: _ok_payload(["0"]))
    sink: list[dict] = []
    sz.summarize_sections(_MM, _SECTIONS, timeout_sec=5, cancel_cb=lambda: True,
                          diagnostics_sink=sink)
    assert len(sink) == 2
    assert all(d["status"] == "cancelled" for d in sink)
    assert all(d["fallback_used"] is True for d in sink)


def test_skip_model_load_records_skipped_for_every_section(monkeypatch):
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
    sink: list[dict] = []
    sz.summarize_sections(_MM, _SECTIONS, diagnostics_sink=sink)
    assert len(sink) == 2
    assert all(d["status"] == "skipped_model_load" for d in sink)


def test_diagnostics_sink_omitted_is_byte_identical_to_before(monkeypatch):
    """The core additive-only guarantee: the exact same scenario, run once
    with diagnostics_sink and once without, must produce an identical
    (out, missing) result — the sink is a pure side-channel, never read by
    control flow that affects the primary return value."""
    def flaky_factory():
        calls = {"n": 0}

        def flaky(*a, **k):
            calls["n"] += 1
            return "{broken" if calls["n"] == 1 else _ok_payload(["0"])
        return flaky

    monkeypatch.setattr(sz, "ask_ai", flaky_factory())
    out_without, missing_without = sz.summarize_sections(
        _MM, _SECTIONS[:1], timeout_sec=5, max_workers=1)

    monkeypatch.setattr(sz, "ask_ai", flaky_factory())
    sink: list[dict] = []
    out_with, missing_with = sz.summarize_sections(
        _MM, _SECTIONS[:1], timeout_sec=5, max_workers=1, diagnostics_sink=sink)

    assert out_without == out_with
    assert missing_without == missing_with
    assert len(sink) == 1  # the sink itself IS populated when passed — proving it's not a no-op
