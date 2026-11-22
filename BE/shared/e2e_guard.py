"""Where the E2E harness and the offline fake model may run (task63, Codex recheck).

Shared by `scripts/supabase_test_probe.py`, `scripts/run_e2e_server.py` and
`app/clients/llm_factory.py`, so all three apply the same structural rules:
- a loopback `*_test` database;
- or the hosted Supabase TEST project as `studymap_app`, with E2E_HOSTED_TEST=1 and
  distinct E2E_EXPECT_REF / E2E_DENY_REF.

Messages name keys, never values.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

ROLE_FOR = {"OWNER": "postgres", "APP": "studymap_app", "READONLY": "studymap_readonly"}
PORT_FOR = {"SESSION": 5432, "TRANSACTION": 6543}
POOLER_HOST = re.compile(r"aws-\d+-[a-z]{2}-[a-z]+-\d+\.pooler\.supabase\.com")
REF = re.compile(r"[a-z]{20}")
LOOPBACK = {"localhost", "127.0.0.1", "::1"}


def pooler_url_problems(key: str, url: str, ref: str) -> list[str]:
    """`key` is `<WHO>_URL_<MODE>`, for example APP_URL_SESSION."""
    who, mode = key.split("_URL_")
    if not url:
        return ["empty value"]
    try:
        u = urlsplit(url)
        port = u.port
    except ValueError:
        return ["not a parseable URL"]
    out = []
    if u.scheme not in ("postgresql", "postgres", "postgresql+psycopg2"):
        out.append("scheme is not postgresql")
    if not POOLER_HOST.fullmatch((u.hostname or "").rstrip(".")):
        out.append("host is not a Supabase pooler (aws-N-<region>.pooler.supabase.com)")
    if port != PORT_FOR[mode]:
        out.append(f"{mode.lower()} mode needs port {PORT_FOR[mode]}")
    if u.path != "/postgres":
        out.append("database is not postgres")
    if u.query or u.fragment:
        out.append("query or fragment present")
    if (u.username or "") != f"{ROLE_FOR[who]}.{ref}":
        out.append(f"user is not {ROLE_FOR[who]}.<expect-ref>")
    return out


def e2e_database_problems(env) -> list[str]:
    url = env.get("DATABASE_URL") or ""
    if not url:
        return ["DATABASE_URL is required"]
    if env.get("E2E_HOSTED_TEST") == "1":
        expect, deny = env.get("E2E_EXPECT_REF") or "", env.get("E2E_DENY_REF") or ""
        if not (REF.fullmatch(expect) and REF.fullmatch(deny)) or expect == deny:
            return ["E2E_HOSTED_TEST=1 needs distinct 20-letter E2E_EXPECT_REF and E2E_DENY_REF"]
        if deny in url:
            return ["DATABASE_URL contains the production ref"]
        try:
            mode = "TRANSACTION" if urlsplit(url).port == 6543 else "SESSION"
        except ValueError:
            return ["DATABASE_URL is not a parseable URL"]
        return [f"DATABASE_URL: {p}" for p in pooler_url_problems(f"APP_URL_{mode}", url, expect)]
    try:
        u = urlsplit(url)
        u.port
    except ValueError:
        return ["DATABASE_URL is not a parseable URL"]
    if u.hostname not in LOOPBACK or not u.path.lstrip("/").endswith("_test") or u.query:
        return ["DATABASE_URL must be a loopback *_test database "
                "(or set E2E_HOSTED_TEST=1 with E2E_EXPECT_REF and E2E_DENY_REF)"]
    return []
