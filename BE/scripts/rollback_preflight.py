"""Read-only archive facts for `scripts/rollback.sh` (issue #18, owner decision 2026-11-19).

Prints exactly one line on success:

    archive_schema=<0|1> archived_topics=<n> guard=<0|1>

`archive_schema` = `review_plan_items.archived_at` exists; `archived_topics` = rows with
`archived_at` set; `guard` = the 20261119 guard triggers are present and enabled.
`rollback.sh` refuses a target SHA that predates the archive while `archived_topics > 0`,
and refuses on any non-zero exit or any other output: unknown is never safe.

Read-only by construction (`SET TRANSACTION READ ONLY`). The database URL is never
printed except sanitised (no password). Same target rules as `verify_db_schema`.

    python -m scripts.rollback_preflight --moi-truong production
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

EXIT_OK, EXIT_TARGET_REFUSED, EXIT_UNREACHABLE = 0, 2, 3


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--moi-truong", choices=["test", "production"], default="test")
    args = p.parse_args(argv)

    from shared.env_loader import load_project_env
    load_project_env()
    from scripts.run_migrations import DichBiTuChoi, xac_dinh_dich
    from shared.db_schema_checks import archive_guard_problems, archived_at_column_exists
    from shared.migration_guard import sanitize

    try:
        url, _ = xac_dinh_dich(args.moi_truong)
    except DichBiTuChoi as exc:
        print(f"STOP: {exc}", file=sys.stderr)
        return EXIT_TARGET_REFUSED

    import sqlalchemy as sa
    try:
        engine = sa.create_engine(url, poolclass=sa.pool.NullPool,
                                  connect_args={"connect_timeout": 10})
        with engine.connect() as conn:
            conn.exec_driver_sql("SET TRANSACTION READ ONLY")
            schema = archived_at_column_exists(conn)
            archived = (conn.execute(sa.text(
                "SELECT count(*) FROM review_plan_items WHERE archived_at IS NOT NULL")
            ).scalar() or 0) if schema else 0
            guard = bool(schema) and not archive_guard_problems(conn)
    except Exception as exc:  # unreachable or unreadable: the rollback must not proceed
        print(f"STOP: cannot read the archive facts from {sanitize(url)}: "
              f"{type(exc).__name__}", file=sys.stderr)
        return EXIT_UNREACHABLE
    print(f"archive_schema={int(bool(schema))} archived_topics={int(archived)} "
          f"guard={int(guard)}")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
