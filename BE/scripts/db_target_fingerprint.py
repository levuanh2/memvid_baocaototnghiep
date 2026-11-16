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
database name, of the EFFECTIVE target (query `host`/`dbname`/`user`, every failover host,
percent-decoded user). The fingerprint is the first 12 hex of SHA-256 over that identity,
so the same project gives the same fingerprint at port 5432 or 6543. If a libpq variable
that can move the target is set (`PGHOSTADDR`, `PGSERVICE`, ...), it prints UNRELIABLE and
exits 3 instead. Standard library only.
"""
from __future__ import annotations

import hashlib
import os
import sys
from urllib.parse import parse_qsl, unquote, urlsplit

NAMES = ("DATABASE_URL", "JOBS_DATABASE_URL", "TEST_DATABASE_URL", "SUPABASE_URL")
#: Same list as `shared.migration_guard.LIBPQ_TARGET_VARS` (this file is stdlib-only
#: so it can be piped into a container).
LIBPQ_TARGET_VARS = ("PGHOSTADDR", "PGHOST", "PGPORT", "PGDATABASE", "PGSERVICE",
                     "PGSERVICEFILE")


def _one(host: str, user: str, db: str) -> str:
    if user.startswith("postgres.") and host.endswith(".supabase.com"):
        return "supabase:" + user.split(".", 1)[1].lower()
    labels = host.split(".")
    if host.endswith(".supabase.co"):
        return "supabase:" + (labels[1] if labels[0] == "db" and len(labels) > 3 else labels[0])
    return f"host:{host}/{db.lower()}"


def identity(value: str) -> str:
    """The EFFECTIVE target, as libpq sees it (Codex reviews of #187):
    - `host`/`hostaddr`/`dbname`/`user` in the query replace the authority and path;
    - every failover host counts (comma lists, repeated keys), sorted;
    - the user is percent-decoded (`postgres%2E<ref>` is `postgres.<ref>`)."""
    p = urlsplit(value.strip())
    q = parse_qsl(p.query, keep_blank_values=True)
    last = {k.lower(): v for k, v in q}
    hosts = [h for k, v in q if k.lower() in ("host", "hostaddr") for h in v.split(",") if h]
    if not hosts:
        hosts = [h for h in p.netloc.rsplit("@", 1)[-1].split(",") if h]
    # Strip a port from every candidate, query or authority alike (Codex re-check 2).
    hosts = [h.split("]")[0] + "]" if h.startswith("[") else h.rsplit(":", 1)[0]
             for h in hosts]
    userinfo = p.netloc.rsplit("@", 1)[0] if "@" in p.netloc else ""
    user = unquote(last.get("user") or userinfo.split(":", 1)[0])
    db = unquote(last.get("dbname") or p.path.strip("/"))
    return "|".join(sorted({_one(unquote(h).lower().strip("[]"), user, db) for h in hosts}))


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
    files = {}
    for path in reversed(argv):
        files.update(read_env_file(path))
    pg = [n for n in LIBPQ_TARGET_VARS
          if (os.environ.get(n, files.get(n, "")) or "").strip()]
    if pg:
        # They can move the real target away from what the URLs say; a fingerprint of
        # the URLs would then be false reassurance. Names only, never values.
        print(f"UNRELIABLE: libpq variables set {pg}; unset them and run again.")
        return 3
    values = resolve(argv, os.environ)
    named = [n for n in NAMES if any(k.lower() == "service" for k, _ in
                                     parse_qsl(urlsplit(values.get(n) or "").query))]
    if named:
        # `?service=` pulls host/hostaddr/failover from an external service file.
        print(f"UNRELIABLE: {named} name a libpq service; use a plain URL and run again.")
        return 3
    for name in NAMES:
        v = (values.get(name) or "").strip()
        if not v:
            print(f"{name:<18} (not set)")
            continue
        try:
            port = urlsplit(v).port or "-"
        except ValueError:
            port = "several"
        print(f"{name:<18} {fingerprint(v)}  port={port}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
