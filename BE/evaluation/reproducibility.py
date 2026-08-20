from __future__ import annotations

import hashlib
import json
import platform
import subprocess
from pathlib import Path


def sha256_path(path: Path) -> str | None:
    if not path.exists():
        return None
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def content_hash(paths: list[Path]) -> str:
    h = hashlib.sha256()
    for path in sorted(paths, key=lambda p: str(p)):
        h.update(str(path.name).encode())
        digest = sha256_path(path)
        h.update((digest or "MISSING").encode())
    return h.hexdigest()


def git_snapshot() -> dict:
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        status = subprocess.check_output(["git", "status", "--porcelain"], text=True)
        return {
            "git_commit": commit,
            "working_tree_dirty": bool(status.strip()),
            "git_status_sha256": hashlib.sha256(status.encode("utf-8")).hexdigest(),
        }
    except Exception:
        return {"git_commit": None, "working_tree_dirty": None, "git_status_sha256": None}


def code_config_snapshot(paths: list[Path]) -> dict:
    resolved = [Path(path) for path in paths]
    return {
        **git_snapshot(),
        "files": {str(path).replace("\\", "/"): sha256_path(path) for path in sorted(resolved, key=lambda p: str(p))},
        "content_hash": content_hash(resolved),
    }


def index_manifest(index_dir: Path, *, corpus_version: str, representation: dict, per_document: list[dict] | None = None) -> dict:
    index_dir = Path(index_dir)
    files = [p for p in index_dir.iterdir() if p.is_file()] if index_dir.exists() else []
    applied = sum(bool(x.get("late_chunking_applied")) for x in (per_document or []))
    snapshot_paths = [
        Path(__file__), Path(__file__).with_name("index_builder.py"),
        Path(__file__).with_name("evidence.py"),
        Path(__file__).parents[1] / "app" / "domains" / "ingest" / "document_loader.py",
    ]
    return {
        "schema_version": "memvid-index-manifest-v1", "corpus_version": corpus_version,
        "representation": representation, "index_hash": content_hash(files),
        "files": {p.name: sha256_path(p) for p in files}, "per_document": per_document or [],
        "late_chunking_actual_use_rate": applied / len(per_document) if per_document else None,
        "code_config_snapshot": code_config_snapshot(snapshot_paths),
    }


def run_manifest(*, config: dict, dataset_dir: Path, index_dir: Path) -> dict:
    return {
        "schema_version": "memvid-run-manifest-v1", **git_snapshot(), "python": platform.python_version(),
        "config": config, "dataset_hash": content_hash(list(Path(dataset_dir).glob("*.json*"))),
        "index_hash": content_hash(list(Path(index_dir).glob("*"))),
    }
