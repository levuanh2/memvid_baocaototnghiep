from __future__ import annotations

import os
from pathlib import Path


def load_project_env(*, override: bool = False) -> None:
    """
    Load environment variables from BE/.env (same dir as this file) first,
    then fall back to project root ../.env.

    Priority with override=False (the default): os.environ > BE/.env > ../.env.
    A variable already in the process environment WINS; dotenv only fills in what is
    missing. The two .env files are ranked between themselves (BE/.env loads first, so
    it beats root .env), but neither can override a variable the OS already set.

    That ordering is deliberate — docker-compose passes config as real environment
    variables and must win over any .env baked into the image — but it also means a
    stray user-level variable silently beats this project's own config. Seen for real:
    a `GEMINI_API_KEY` holding a Google OAuth access token (`AQ....`, set by another
    tool) beat the empty value in BE/.env, so the Gemini provider registered and every
    call died with 401 ACCESS_TOKEN_TYPE_UNSUPPORTED. Unset the OS variable; setting it
    in BE/.env is not enough.

    This makes BE self-contained where the OS is silent, while preserving root .env for
    docker-compose.
    """
    if (os.getenv("SKIP_DOTENV") or "").strip() in {"1", "true", "True", "yes", "on"}:
        return

    try:
        from dotenv import load_dotenv
    except Exception:
        return

    from shared.paths import BE_ROOT

    # 1. Load BE/.env first — higher priority (neo theo BE_ROOT, không theo __file__)
    be_env = BE_ROOT / ".env"
    if be_env.exists():
        load_dotenv(dotenv_path=be_env, override=override)

    # 2. Fall back to project root ../.env (for docker-compose compatibility)
    root_env = BE_ROOT.parent / ".env"
    if root_env.exists() and root_env.resolve() != be_env.resolve():
        load_dotenv(dotenv_path=root_env, override=override)

    _apply_memvid_langchain_defaults()


def _apply_memvid_langchain_defaults() -> None:
    """
    Mặc định bật pipeline LangChain/LangGraph (có thể ghi đè trong .env).
    Đặt MEMVID_DISABLE_LC_DEFAULTS=1 để không set default.
    """
    if (os.getenv("MEMVID_DISABLE_LC_DEFAULTS") or "").strip().lower() in ("1", "true", "yes", "on"):
        return
    os.environ.setdefault("USE_LC_VECTOR_STORE", "1")
    os.environ.setdefault("USE_LC_QA_CHAIN", "1")
    os.environ.setdefault("USE_LC_ENSEMBLE", "1")
    os.environ.setdefault("USE_LC_INGEST", "1")

