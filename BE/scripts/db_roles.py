"""Apply or verify the least-privilege role contract (shared.db_roles).

    python -m scripts.db_roles verify --moi-truong test          # read-only
    python -m scripts.db_roles apply  --moi-truong test          # grants + RLS policies
    ALEMBIC_ALLOW_PRODUCTION=1 python -m scripts.db_roles verify --moi-truong production

The target is the migration target (`scripts.run_migrations.xac_dinh_dich`: the table
owner's URL, with every production guard). `apply` must run as that owner: only the
owner may GRANT on its tables and CREATE POLICY. It never creates or alters roles; the
roles are created once by an administrator (docs/RUNBOOK_DB_ROLES.md). Exit 0 only when
the database matches the contract. Prints no credentials.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main(argv=None) -> int:
    from shared.db_roles import (API_ROLES, RLS_BYPASS, RLS_POLICIES, apply_statements,
                                 role_problems)

    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("action", choices=["apply", "verify"])
    p.add_argument("--moi-truong", choices=["test", "production"], default="test")
    p.add_argument("--rls-mode", choices=[RLS_POLICIES, RLS_BYPASS],
                   default=os.getenv("DB_RLS_MODE") or RLS_POLICIES)
    args = p.parse_args(argv)

    import sqlalchemy as sa

    from scripts.run_migrations import DichBiTuChoi, xac_dinh_dich
    from shared.migration_guard import sanitize
    try:
        url, _ = xac_dinh_dich(args.moi_truong)
    except DichBiTuChoi as exc:
        print(f"[db_roles] DỪNG: {exc}", file=sys.stderr)
        return 2
    print(f"[db_roles] đích: {sanitize(url)}  hành động: {args.action}  rls: {args.rls_mode}")
    engine = sa.create_engine(url, poolclass=sa.pool.NullPool)
    try:
        if args.action == "apply":
            with engine.begin() as conn:
                rls = {r[0] for r in conn.execute(sa.text(
                    "SELECT c.relname FROM pg_class c JOIN pg_namespace n "
                    "ON n.oid = c.relnamespace WHERE n.nspname = 'public' "
                    "AND c.relkind IN ('r', 'p') AND c.relrowsecurity"))}
                api = [r for (r,) in conn.execute(sa.text(
                    "SELECT rolname FROM pg_roles WHERE rolname = ANY(:n)"),
                    {"n": list(API_ROLES)})]
                for stmt in apply_statements(rls, args.rls_mode, api):
                    conn.execute(sa.text(stmt))
        with engine.connect() as conn:
            problems = role_problems(conn, args.rls_mode)
    finally:
        engine.dispose()
    for problem in problems:
        print(f"[db_roles] {problem}", file=sys.stderr)
    print(f"[db_roles] {'ok' if not problems else f'{len(problems)} problem(s)'}")
    return 0 if not problems else 1


if __name__ == "__main__":
    raise SystemExit(main())
