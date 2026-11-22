"""Task63 item 7: an offline fake model at the llm_factory seam (E2E_FAKE_LLM=1).

Each case runs in a fresh interpreter: PROVIDERS is decided at import time.
The sockets are disabled inside the child, so a real provider call would raise.
"""
import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

BE = Path(__file__).resolve().parents[1]
KEYS = ("GEMINI_API_KEY", "GROQ_API_KEY", "FPT_AI_API_KEY", "COHERE_API_KEY",
        "OLLAMA_HOST", "LLM_GATEWAY_ADDR", "RERANK_BACKEND", "E2E_PROCESS")


def _child(code, **env_over):
    env = {k: v for k, v in os.environ.items() if k not in KEYS}
    env.update({"SKIP_DOTENV": "1", "SKIP_MODEL_LOAD": "1", "PYTHONIOENCODING": "utf-8",
                "E2E_FAKE_LLM": "1", "E2E_PROCESS": "run_e2e_server",
                "RERANK_BACKEND": "identity"}, **env_over)
    for k in KEYS:
        env.setdefault(k, "")
    prelude = textwrap.dedent("""
        import socket
        class _NoNet(socket.socket):
            def connect(self, *a, **k): raise OSError("network disabled in test")
        socket.socket = _NoNet
        socket.create_connection = lambda *a, **k: (_ for _ in ()).throw(OSError("network disabled"))
    """)
    return subprocess.run([sys.executable, "-c", prelude + textwrap.dedent(code)], cwd=BE,
                          env=env, capture_output=True, text=True, encoding="utf-8", timeout=120)


def test_fake_replaces_every_provider_and_needs_no_network():
    r = _child("""
        from app.clients import llm_factory as lf
        assert lf.PROVIDERS == ["fake"], lf.PROVIDERS
        text = lf.ask_ai("Giải thích context switch", feature="chat")
        assert "E2E_FAKE_LLM" in text, text
        msg = lf.get_llm("chat").invoke("Giải thích context switch")
        assert "E2E_FAKE_LLM" in msg.content, msg.content
        print("ok")
    """)
    assert r.returncode == 0 and "ok" in r.stdout, r.stdout + r.stderr


def test_fake_streams_through_get_llm():
    r = _child("""
        from app.clients import llm_factory as lf
        parts = [c.content for c in lf.get_llm("chat").stream("hỏi")]
        assert "".join(parts).strip(), parts
        print("ok")
    """)
    assert r.returncode == 0 and "ok" in r.stdout, r.stdout + r.stderr


def test_a_json_prompt_gets_parseable_json():
    r = _child("""
        import json
        from app.clients import llm_factory as lf
        out = lf.ask_ai("Trả về JSON với khoá items", system_prompt="Chỉ trả JSON.", feature="mindmap")
        json.loads(out)
        print("ok")
    """)
    assert r.returncode == 0 and "ok" in r.stdout, r.stdout + r.stderr


def test_the_fake_wins_over_the_llm_gateway():
    r = _child("""
        from app.clients import llm_factory as lf
        assert "E2E_FAKE_LLM" in lf.ask_ai("x")
        print("ok")
    """, LLM_GATEWAY_ADDR="127.0.0.1:50051")
    assert r.returncode == 0 and "ok" in r.stdout, r.stdout + r.stderr


def test_the_fake_refuses_to_start_beside_a_real_provider_key():
    r = _child("from app.clients import llm_factory", FPT_AI_API_KEY="real-looking-key")
    assert r.returncode != 0
    assert "E2E_FAKE_LLM" in r.stderr and "real-looking-key" not in r.stdout + r.stderr


def test_without_the_flag_nothing_changes():
    r = _child("""
        from app.clients import llm_factory as lf
        assert "fake" not in lf.PROVIDERS, lf.PROVIDERS
        print("ok")
    """, E2E_FAKE_LLM="")
    assert r.returncode == 0 and "ok" in r.stdout, r.stdout + r.stderr


# Codex task63 recheck P1: every remote path is refused, and only the E2E harness may enable it.
def test_the_fake_refuses_beside_a_cohere_key():
    r = _child("from app.clients import llm_factory", COHERE_API_KEY="real-looking-key")
    assert r.returncode != 0 and "E2E_FAKE_LLM" in r.stderr and "real-looking-key" not in r.stderr


def test_the_fake_refuses_a_remote_reranker():
    r = _child("from app.clients import llm_factory", RERANK_BACKEND="cohere")
    assert r.returncode != 0 and "E2E_FAKE_LLM" in r.stderr


def test_the_fake_refuses_outside_the_e2e_harness():
    r = _child("from app.clients import llm_factory", E2E_PROCESS="")
    assert r.returncode != 0 and "E2E_FAKE_LLM" in r.stderr
