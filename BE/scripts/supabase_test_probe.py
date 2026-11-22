"""Task63: probes for the disposable Supabase TEST project (RUNBOOK_DB_ROLES section 5).

    python -m scripts.supabase_test_probe <phase>... --env-file F --expect-ref REF
        --deny-ref PROD_REF --out OUT.json
    python -m scripts.supabase_test_probe <phase>... --env-file F --local --out OUT.json

Fails closed (Codex task63 BLOCK):
- Before any connection, every URL is checked STRUCTURALLY. Each must be a Supavisor
  pooler host, port 5432 for *_SESSION or 6543 for *_TRANSACTION, database `postgres`,
  no query, user exactly `<role>.<expect-ref>` for the role its key names.
  `SUPABASE_URL` must be exactly `https://<expect-ref>.supabase.co`.
  The production ref may not appear anywhere.
- `--local` accepts only loopback hosts and `*_test` databases, and no Data API values.
- Every case has a verdict. Any failure, missing input or phase exception exits 1. A
  refused env exits 2.

Phases. Each one only reads, or rolls back every transaction it opens:
  preflight  G0b, owner: exact ACL entries of the API roles on `public` objects with
             their grantor. Any grant the owner cannot revoke fails, BEFORE G3 (P2).
  inspect    owner: version, roles, default ACLs, policies (informational).
  verify     owner: role_problems() must be empty (after G3).
  identity   each URL x 3 connections x 3 transactions: role, database, oid, server
             start and version must agree. In session mode the backend pid must be
             stable across transactions; in transaction mode it is recorded only.
  rls        row counts per contract table as owner, app and read-only must be equal.
  deny       as the app role, each forbidden statement must fail with 42501.
  restapi    Data API with the secret and the publishable key: only 401/403 with
             PostgREST code 42501 passes.

The JSON is sensitive operational metadata: role, object and database names, OIDs,
server start time, counts. It never contains a URL, password, key, response body or
server message. stdout names only the output file's basename.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit

URL_KEYS = ("OWNER_URL_SESSION", "OWNER_URL_TRANSACTION", "APP_URL_SESSION",
            "APP_URL_TRANSACTION", "READONLY_URL_SESSION", "READONLY_URL_TRANSACTION")
ROLE_FOR = {"OWNER": "postgres", "APP": "studymap_app", "READONLY": "studymap_readonly"}
PORT_FOR = {"SESSION": 5432, "TRANSACTION": 6543}
POOLER_HOST = re.compile(r"aws-\d+-[a-z]{2}-[a-z]+-\d+\.pooler\.supabase\.com")
REF = re.compile(r"[a-z]{20}")
API_ROLES = ("anon", "authenticated", "service_role")
LOOPBACK = {"localhost", "127.0.0.1", "::1"}


# ── pure checks (unit-tested, no network) ───────────────────────────────────────────
def env_problems(env: dict, expect_ref: str, deny_ref: str) -> list[str]:
    """Structural validation of the hosted test env. Messages name keys, never values."""
    if not REF.fullmatch(expect_ref or ""):
        return ["--expect-ref must be a 20-letter Supabase project ref"]
    if not REF.fullmatch(deny_ref or ""):
        return ["--deny-ref (the production ref) is required and must be a 20-letter ref"]
    if expect_ref == deny_ref:
        return ["--expect-ref and --deny-ref are the same project"]
    problems = []
    if not env.get("OWNER_URL_SESSION"):
        problems.append("OWNER_URL_SESSION is required")
    for key, value in env.items():
        if deny_ref in value:
            problems.append(f"{key} contains the production ref")
    for key in URL_KEYS:
        if env.get(key):
            problems += [f"{key}: {p}" for p in _pooler_url_problems(key, env[key], expect_ref)]
    if env.get("SUPABASE_URL") and env["SUPABASE_URL"].rstrip("/") != f"https://{expect_ref}.supabase.co":
        problems.append("SUPABASE_URL is not exactly https://<expect-ref>.supabase.co")
    return problems


def _pooler_url_problems(key: str, url: str, ref: str) -> list[str]:
    who, mode = key.split("_URL_")
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


def local_env_problems(env: dict) -> list[str]:
    """`--local`: loopback `*_test` databases only, nothing that reaches Supabase."""
    problems = []
    if not env.get("OWNER_URL_SESSION"):
        problems.append("OWNER_URL_SESSION is required")
    for key in env:
        if key.startswith("SUPABASE_"):
            problems.append(f"{key} is not allowed with --local")
    for key in URL_KEYS:
        if env.get(key):
            try:
                u = urlsplit(env[key])
                u.port
            except ValueError:
                problems.append(f"{key}: not a parseable URL")
                continue
            if u.hostname not in LOOPBACK or not u.path.lstrip("/").endswith("_test") or u.query:
                problems.append(f"{key}: --local needs a loopback *_test database")
    return problems


def unrevokable_api_grants(rows, revoker: str) -> list[str]:
    """rows: (kind, object, grantee, privilege, grantor). PostgreSQL revokes only the
    revoker's own grants, so an API-role grant made by anyone else survives `apply`."""
    return [f"{kind} {obj}: {grantee} {priv} granted by {grantor}, which {revoker} cannot revoke"
            for kind, obj, grantee, priv, grantor in rows
            if grantee in (*API_ROLES, "PUBLIC") and grantor != revoker]


def identity_problems(samples: dict, expected_role: dict) -> list[str]:
    """samples: key -> list of [role, database, oid, server_start, version] (or error str)."""
    problems, where = [], set()
    for key, rows in samples.items():
        for row in rows:
            if not isinstance(row, list):
                problems.append(f"{key}: connection failed ({row})")
                continue
            if row[0] != expected_role[key]:
                problems.append(f"{key}: logged in as {row[0]}, expected {expected_role[key]}")
            where.add(tuple(str(x) for x in row[1:5]))
    if len(where) > 1:
        problems.append("connections reached different databases or servers")
    return problems


def failures(out: dict) -> list[str]:
    bad = []
    for phase, res in out.items():
        if isinstance(res, str):
            bad.append(f"{phase}: {res}")
    deny = out.get("deny")
    if isinstance(deny, dict):
        bad += [f"deny {k}: {v}" for k, v in deny.items()
                if not (v.startswith("refused ") and v.endswith("sqlstate=42501"))]
    api = out.get("restapi")
    if isinstance(api, dict):
        for k, v in api.items():
            if not (isinstance(v, dict) and v.get("status") in (401, 403)
                    and v.get("postgrest_code") == "42501"):
                bad.append(f"restapi {k}: not a database permission denial")
    for phase in ("rls",):
        if isinstance(out.get(phase), dict) and out[phase].get("tables_that_differ"):
            bad.append(f"rls: counts differ on {', '.join(out[phase]['tables_that_differ'])}")
    for phase in ("identity", "preflight", "verify"):
        if isinstance(out.get(phase), dict) and out[phase].get("problems"):
            bad += [f"{phase}: {p}" for p in out[phase]["problems"]]
    return bad


def load_env(path: str) -> dict:
    env = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    return env


# ── phases (need a database) ────────────────────────────────────────────────────────
def _sa():
    import sqlalchemy as sa
    return sa


def _engine(url):
    sa = _sa()
    from shared.migration_guard import chuan_hoa_driver
    return sa.create_engine(chuan_hoa_driver(url), poolclass=sa.pool.NullPool,
                            connect_args={"connect_timeout": 10})


def _err(exc):
    orig = getattr(exc, "orig", None)
    return f"{type(orig or exc).__name__} sqlstate={getattr(orig, 'sqlstate', None)}"


def _ro(url, fn):
    sa = _sa()
    e = _engine(url)
    try:
        with e.connect() as c:
            c.execute(sa.text("SET TRANSACTION READ ONLY"))
            try:
                return fn(c)
            finally:
                c.rollback()
    finally:
        e.dispose()


def _rows(c, sql, **kw):
    return [list(r) for r in c.execute(_sa().text(sql), kw)]


ACL_SQL = """
SELECT CASE c.relkind WHEN 'S' THEN 'sequence' ELSE 'table' END, c.relname,
       coalesce(g.rolname, 'PUBLIC'), a.privilege_type, gr.rolname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
     aclexplode(c.relacl) a LEFT JOIN pg_roles g ON g.oid = a.grantee
     JOIN pg_roles gr ON gr.oid = a.grantor
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
UNION ALL
SELECT 'function', p.oid::regprocedure::text, coalesce(g.rolname, 'PUBLIC'), a.privilege_type,
       gr.rolname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
     aclexplode(p.proacl) a LEFT JOIN pg_roles g ON g.oid = a.grantee
     JOIN pg_roles gr ON gr.oid = a.grantor
WHERE n.nspname = 'public' AND p.prorettype <> 'trigger'::regtype
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
UNION ALL
SELECT 'schema', n.nspname, coalesce(g.rolname, 'PUBLIC'), a.privilege_type, gr.rolname
FROM pg_namespace n, aclexplode(n.nspacl) a LEFT JOIN pg_roles g ON g.oid = a.grantee
     JOIN pg_roles gr ON gr.oid = a.grantor
WHERE n.nspname = 'public' AND a.privilege_type = 'CREATE'
ORDER BY 1, 2, 3, 4, 5
"""

DEFAULT_ACL_SQL = """
SELECT pg_get_userbyid(d.defaclrole), coalesce(n.nspname, '<global>'), d.defaclobjtype,
       coalesce(g.rolname, 'PUBLIC'), a.privilege_type
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace,
     aclexplode(d.defaclacl) a LEFT JOIN pg_roles g ON g.oid = a.grantee
WHERE n.nspname IS NULL OR n.nspname = 'public' ORDER BY 1, 2, 3, 4, 5
"""


def preflight(env, out):
    def f(c):
        revoker = c.execute(_sa().text("SELECT current_user")).scalar()
        acl = _rows(c, ACL_SQL)
        api = [r for r in acl if r[2] in (*API_ROLES, "PUBLIC")]
        return {"revoker": revoker, "acl": acl, "default_acl": _rows(c, DEFAULT_ACL_SQL),
                "problems": unrevokable_api_grants([tuple(r) for r in api], revoker)}
    out["preflight"] = _ro(env["OWNER_URL_SESSION"], f)


def inspect(env, out):
    from shared.db_roles import APP_ROLE, APP_TABLE_PRIVILEGES, READONLY_ROLE
    names = [APP_ROLE, READONLY_ROLE, *API_ROLES, "postgres", "supabase_admin"]

    def f(c):
        sa = _sa()
        return {
            "server_version_num": c.execute(sa.text("SHOW server_version_num")).scalar(),
            "roles": _rows(c, "SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, "
                              "rolcanlogin, rolreplication, rolbypassrls FROM pg_roles "
                              "WHERE rolname = ANY(CAST(:n AS text[])) ORDER BY 1", n=names),
            "schema_public": _rows(c, "SELECT pg_get_userbyid(nspowner), nspacl::text "
                                      "FROM pg_namespace WHERE nspname = 'public'"),
            "owners": _rows(c, "SELECT c.relname, c.relkind::text, pg_get_userbyid(c.relowner) "
                               "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                               "WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m') "
                               "ORDER BY 1"),
            "policies": _rows(c, "SELECT tablename, policyname, roles::text, cmd FROM pg_policies "
                                 "WHERE schemaname = 'public' ORDER BY 1, 2"),
            "alembic_version": _rows(c, "SELECT version_num FROM alembic_version")
            if c.execute(sa.text("SELECT to_regclass('public.alembic_version')")).scalar() else [],
            "contract_tables_missing": _rows(
                c, "SELECT t FROM unnest(CAST(:t AS text[])) t "
                   "WHERE to_regclass('public.' || quote_ident(t)) IS NULL",
                t=sorted(APP_TABLE_PRIVILEGES)),
        }
    out["inspect"] = _ro(env["OWNER_URL_SESSION"], f)


def verify(env, out):
    from shared.db_roles import role_problems
    out["verify"] = {"problems": _ro(env["OWNER_URL_SESSION"],
                                     lambda c: role_problems(c, os.getenv("DB_RLS_MODE") or "policies"))}


IDENT = ("SELECT current_user, current_database(), (SELECT oid FROM pg_database WHERE "
         "datname = current_database()), pg_postmaster_start_time()::text, "
         "current_setting('server_version_num'), pg_backend_pid()")


def identity(env, out, connections=3, transactions=3):
    sa = _sa()
    samples, pids, problems = {}, {}, []
    for key in URL_KEYS:
        if not env.get(key):
            continue
        samples[key], pids[key] = [], []
        for _ in range(connections):
            e = _engine(env[key])
            try:
                with e.connect() as c:
                    seen = []
                    for _ in range(transactions):
                        row = list(c.execute(sa.text(IDENT)).first())
                        c.rollback()
                        samples[key].append([str(x) for x in row[:5]])
                        seen.append(row[5])
                    pids[key].append(len(set(seen)))
            except Exception as exc:
                samples[key].append(_err(exc))
            finally:
                e.dispose()
        if key.endswith("_SESSION") and any(n != 1 for n in pids[key]):
            problems.append(f"{key}: backend pid changed between transactions in session mode")
    expected = {k: (urlsplit(env[k]).username or "").split(".")[0] for k in samples}
    problems += identity_problems(samples, expected)
    from shared.db_roles import runtime_login_problems
    owner = _engine(env["OWNER_URL_SESSION"])
    try:
        with owner.connect() as oc:
            for key in ("APP_URL_SESSION", "APP_URL_TRANSACTION"):
                if env.get(key):
                    problems += [f"{key}: {p}" for p in runtime_login_problems(oc, env[key])]
    finally:
        owner.dispose()
    out["identity"] = {"distinct_pids_per_connection": pids, "problems": problems,
                       "connections": {k: len(v) for k, v in samples.items()}}


def rls(env, out):
    from shared.db_roles import APP_TABLE_PRIVILEGES
    tables = sorted(APP_TABLE_PRIVILEGES)

    def counts(c):
        got = {}
        for t in tables:
            sp = c.begin_nested()
            try:
                got[t] = c.execute(_sa().text(f'SELECT count(*) FROM public."{t}"')).scalar()
                sp.commit()
            except Exception as exc:
                sp.rollback()
                got[t] = _err(exc)
        return got
    by = {k: _ro(env[k], counts) for k in ("OWNER_URL_SESSION", "APP_URL_SESSION",
                                           "READONLY_URL_SESSION") if env.get(k)}
    if len(by) < 3:
        out["rls"] = "missing APP_URL_SESSION or READONLY_URL_SESSION"
        return
    out["rls"] = {"counts": by,
                  "tables_that_differ": [t for t in tables if len({str(v[t]) for v in by.values()}) != 1]}


DENY = {
    "truncate": 'TRUNCATE public."quiz_answers"',
    "disable_trigger": 'ALTER TABLE public."quiz_answers" DISABLE TRIGGER ALL',
    "lock_access_exclusive": 'LOCK TABLE public."quiz_questions" IN ACCESS EXCLUSIVE MODE',
    "reindex": 'REINDEX TABLE public."quiz_questions"',
    "create_table": "CREATE TABLE public.studymap_probe_t63 (x int)",
    "delete_quiz_answers": 'DELETE FROM public."quiz_answers" WHERE false',
    "update_quiz_answers_id": 'UPDATE public."quiz_answers" SET id = id WHERE false',
    "update_quiz_questions": 'UPDATE public."quiz_questions" SET id = id WHERE false',
    "set_role_owner": "SET ROLE postgres",
    "alter_role_bypassrls": "ALTER ROLE studymap_app BYPASSRLS",
}


def deny(env, out):
    if not env.get("APP_URL_SESSION"):
        out["deny"] = "missing APP_URL_SESSION"
        return
    res = {}
    e = _engine(env["APP_URL_SESSION"])
    try:
        for name, sql in DENY.items():
            with e.connect() as c:
                try:
                    c.execute(_sa().text(sql))
                    res[name] = "ALLOWED"
                except Exception as exc:
                    res[name] = f"refused {_err(exc)}"
                finally:
                    c.rollback()
    finally:
        e.dispose()
    out["deny"] = res


def restapi(env, out, table="quiz_answers"):
    res = {}
    for k in ("SUPABASE_SECRET_KEY", "SUPABASE_PUBLISHABLE_KEY"):
        if not env.get(k) or not env.get("SUPABASE_URL"):
            res[k] = "not given"
            continue
        req = urllib.request.Request(
            f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/{table}?select=id&limit=1",
            headers={"apikey": env[k], "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                body = json.loads(r.read() or b"null")
                res[k] = {"status": r.status, "rows_returned": len(body) if isinstance(body, list) else None}
        except urllib.error.HTTPError as exc:
            try:
                code = json.loads(exc.read() or b"{}").get("code")
            except Exception:
                code = None
            res[k] = {"status": exc.code, "postgrest_code": code}
        except Exception as exc:
            res[k] = {"error": type(exc).__name__}
    out["restapi"] = res


PHASES = {"preflight": preflight, "inspect": inspect, "verify": verify, "identity": identity,
          "rls": rls, "deny": deny, "restapi": restapi}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("phases", nargs="+", choices=list(PHASES))
    p.add_argument("--env-file", required=True)
    p.add_argument("--expect-ref", default="")
    p.add_argument("--deny-ref", default="")
    p.add_argument("--local", action="store_true",
                   help="disposable local PostgreSQL rehearsal: loopback *_test only")
    p.add_argument("--out", required=True)
    a = p.parse_args(argv)
    env = load_env(a.env_file)
    refused = local_env_problems(env) if a.local else env_problems(env, a.expect_ref, a.deny_ref)
    if a.local and "restapi" in a.phases:
        refused.append("restapi is not available with --local")
    if refused:
        for r in refused:
            print(f"DỪNG: {r}", file=sys.stderr)
        return 2
    out = {}
    for ph in a.phases:
        try:
            PHASES[ph](env, out)
        except Exception as exc:
            out[ph] = f"phase raised {_err(exc)}"
    bad = failures(out)
    out["verdict"] = {"pass": not bad, "failures": bad}
    fd = os.open(a.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1, default=str)
    print(f"{os.path.basename(a.out)}: {'PASS' if not bad else f'FAIL ({len(bad)})'}")
    for b in bad:
        print(f"  {b}", file=sys.stderr)
    return 0 if not bad else 1


if __name__ == "__main__":
    raise SystemExit(main())
