"""Read-only database verification, run by the deploy AFTER migrations and BEFORE the new
backend starts. Exit 0 = schema proven from the catalogs; anything else = do not activate.

    python -m scripts.verify_db_schema                        # default: TEST target
    python -m scripts.verify_db_schema --moi-truong production

Why separate from the migration: once `alembic_version` says head, Alembic never runs the
revision again, so a check inside the migration cannot see an index that was later
dropped, replaced, or left INVALID. This script looks every time. It never writes: no
DROP, no REINDEX, no CREATE. Recovery is a manual, approved step:
`docs/RUNBOOK_SUBMIT_KEY_INDEX.md`.

Same target rules as `scripts.run_migrations` (it reuses `xac_dinh_dich`), so it can only
look at the database the migration just touched.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

BE_ROOT = Path(__file__).resolve().parents[1]
if str(BE_ROOT) not in sys.path:
    sys.path.insert(0, str(BE_ROOT))

EXIT_OK = 0
EXIT_TARGET_REFUSED = 2
EXIT_SCHEMA_INVALID = 3
EXIT_UNREACHABLE = 4


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--moi-truong", choices=["test", "production"], default="test")
    args = p.parse_args(argv)

    from shared.env_loader import load_project_env
    load_project_env()
    from scripts.run_migrations import DichBiTuChoi, xac_dinh_dich
    from shared.db_schema_checks import (ARCHIVE_RUNBOOK, RUNBOOK, archive_guard_problems,
                                         review_item_archive_problems,
                                         submit_key_index_problems)
    from shared.migration_guard import sanitize

    try:
        url, _ = xac_dinh_dich(args.moi_truong)
    except DichBiTuChoi as exc:
        print(f"DỪNG: {exc}", file=sys.stderr)
        return EXIT_TARGET_REFUSED

    import sqlalchemy as sa
    try:
        engine = sa.create_engine(url, poolclass=sa.pool.NullPool,
                                  connect_args={"connect_timeout": 10})
        with engine.connect() as conn:
            # Read-only by construction: any write in this session is an error.
            conn.exec_driver_sql("SET TRANSACTION READ ONLY")
            db = conn.execute(sa.text("SELECT current_database()")).scalar()
            # Each family keeps its own runbook: an archive failure must not send the
            # operator to the submit-key recovery SQL (Codex task46).
            families = [(RUNBOOK, submit_key_index_problems(conn)),
                        (ARCHIVE_RUNBOOK, review_item_archive_problems(conn)
                         + archive_guard_problems(conn))]
            from shared.db_roles import (ROLES_RUNBOOK, role_problems, runtime_login_problems,
                                         runtime_url_problems, separation_enabled)
            if separation_enabled():
                import os
                # The runtime URL the new backend will use: DATABASE_URL in production,
                # TEST_DATABASE_URL in test mode (DATABASE_URL is production's there).
                runtime = (os.getenv("DATABASE_URL" if args.moi_truong == "production"
                                     else "TEST_DATABASE_URL") or "").strip()
                env = {"DATABASE_URL": runtime, "MIGRATION_DATABASE_URL": url}
                found = runtime_url_problems(env)
                # Log in for real before activation (Codex task62): /health never
                # touches the database.
                found += [] if found else runtime_login_problems(conn, runtime)
                families.append((ROLES_RUNBOOK, found + role_problems(
                    conn, os.getenv("DB_RLS_MODE") or "policies")))
            problems = [pr for _, found in families for pr in found]
    except Exception as exc:  # unreachable DB is a failed verification, never a pass
        print(f"DỪNG: cannot verify {sanitize(url)}: {type(exc).__name__}: {exc}",
              file=sys.stderr)
        return EXIT_UNREACHABLE

    if problems:
        print(f"DỪNG: database {db} failed schema verification "
              f"({len(problems)} problem(s)); the new backend must NOT start.", file=sys.stderr)
        for pr in problems:
            print(f"  - {pr}", file=sys.stderr)
        for runbook, found in families:
            if found:
                print(f"  Nothing was changed. Recovery (manual, approved): {runbook}",
                      file=sys.stderr)
        return EXIT_SCHEMA_INVALID
    print(f"[verify-db] {db}: uq_quiz_attempts_user_submit_key valid, ready, unique, "
          "(user_id, submit_key) WHERE submit_key IS NOT NULL")
    print(f"[verify-db] {db}: review_plan_items.archived_at present; "
          "uq_review_plan_items_priority_active valid, unique, (review_plan_id, priority) "
          "WHERE archived_at IS NULL; old uq_review_plan_items_priority absent")
    print(f"[verify-db] {db}: archive guard triggers present and enabled "
          "(review_plans delete, review_plan_items delete/update, truncate)")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
