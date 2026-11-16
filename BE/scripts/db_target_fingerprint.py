"""Print a fingerprint of each database/storage target, never the target itself.

Answers one question for the owner: does this machine point at the same Supabase project
as that one? Run it on both and compare the fingerprints; record only "same" or
"different". No URL, host, user, password, key or project ref is printed.

    # developer machine (reads the env files the backend would read, in its order)
    python BE/scripts/db_target_fingerprint.py BE/.env .env

    # EC2, inside the running backend container (works before this file is deployed)
    docker compose -f docker-compose.prod.yml exec -T backend python - < BE/scripts/db_target_fingerprint.py

Identity = the Supabase project ref when there is one (user `postgres.<ref>` on the
pooler, host `db.<ref>.supabase.co`, or `https://<ref>.supabase.co`), otherwise host and
database name. The fingerprint is the first 12 hex of SHA-256 over that identity, so the
same project gives the same fingerprint at port 5432 or 6543. Standard library only.
"""
from __future__ import annotations

import hashlib
import os
import sys
from urllib.parse import parse_qsl, urlsplit

NAMES = ("DATABASE_URL", "JOBS_DATABASE_URL", "TEST_DATABASE_URL", "SUPABASE_URL")


def identity(value: str) -> str:
    """The EFFECTIVE target: libpq/psycopg let `host`, `hostaddr`, `dbname`, `user` in the
    query replace the authority and path, so read those first (Codex review of #187)."""
    p = urlsplit(value.strip())
    q = {k.lower(): v for k, v in parse_qsl(p.query, keep_blank_values=True)}
    host = (q.get("host") or q.get("hostaddr") or p.hostname or "").split(",")[0].lower()
    user = q.get("user") or p.username or ""
    p = p._replace(path="/" + q["dbname"]) if q.get("dbname") else p
    if user.startswith("postgres.") and host.endswith(".supabase.com"):
        return "supabase:" + user.split(".", 1)[1].lower()
    labels = host.split(".")
    if host.endswith(".supabase.co"):
        return "supabase:" + (labels[1] if labels[0] == "db" and len(labels) > 3 else labels[0])
    return f"host:{host}/{(p.path or '').strip('/').lower()}"


def fingerprint(value: str) -> str:
    return hashlib.sha256(identity(value).encode("utf-8")).hexdigest()[:12]


def read_env_file(path: str) -> dict:
    out = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("export "):
                    line = line[7:]
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return out


def resolve(files, environ) -> dict:
    """Same precedence as `shared.env_loader` (`load_dotenv`, override=False): a variable
    already present wins, even when empty; then each file in the order given."""
    values = {}
    for path in reversed(files):
        values.update(read_env_file(path))
    values.update({k: v for k, v in environ.items() if k in NAMES})
    return values


def main(argv) -> int:
    values = resolve(argv, os.environ)
    for name in NAMES:
        v = (values.get(name) or "").strip()
        if not v:
            print(f"{name:<18} (not set)")
            continue
        p = urlsplit(v)
        print(f"{name:<18} {fingerprint(v)}  port={p.port or '-'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
