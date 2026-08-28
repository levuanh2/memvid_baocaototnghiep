"""Một nguồn sự thật cho model mindmap: MINDMAP_MODEL > SLM_MODEL > default."""
from __future__ import annotations
import os

from shared.config import DEFAULT_LOCAL_MODEL


def resolve_mindmap_model() -> str:
    for var in ("MINDMAP_MODEL", "SLM_MODEL"):
        v = (os.getenv(var) or "").strip()
        if v:
            return v
    return DEFAULT_LOCAL_MODEL
