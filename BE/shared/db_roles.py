"""Least-privilege database roles: the contract (owner decision 2026-11-19, after task59).

Three roles:

- ``studymap_owner`` (on Supabase: the existing ``postgres`` role) owns the schema, the
  tables and the guard functions. Only the migration step uses it, through
  ``MIGRATION_DATABASE_URL``.
- ``studymap_app`` is the backend runtime (``DATABASE_URL``). Plain DML only, per table
  below; never TRUNCATE, TRIGGER, REFERENCES, DDL, ownership, superuser or replication.
- ``studymap_readonly`` reads (``SELECT``) for ``verify_db_schema``, ``rollback_preflight``,
  backups and support queries.

A table missing here fails verification: a new table is not reachable by the app until
its row is written on purpose.

History tables (runbook R1) get only what current code does. A foreign-key cascade from
a deleted parent (document, account, attempt) runs as the table owner, so the app needs
no DELETE on them for that.
"""
from __future__ import annotations

from typing import Dict, Tuple

APP_ROLE = "studymap_app"
READONLY_ROLE = "studymap_readonly"

# Value: table-level privileges; ``UPDATE(<cols>)`` grants UPDATE on those columns only.
#
# Derived 2026-11-21 from the live schema and an audit of every INSERT/UPDATE/DELETE the
# backend issued during the full test suite (PostgreSQL log_statement='mod', statements
# tagged app/test), cross-checked by reading the code:
# - INSERT where the app inserts (every table but alembic_version);
# - UPDATE only on non-identity columns: never `id`, a foreign key naming the owner or
#   the parent, or `created_at` (runbook R2), with the exceptions commented below;
# - DELETE only where current code deletes: masteries (gap analysis), sections and chunks
#   (re-ingest), documents (hard delete) and collections. Plans, quizzes, attempts and
#   accounts are never deleted by the app; their FK cascades run as the owner.
APP_TABLE_PRIVILEGES: Dict[str, Tuple[str, ...]] = {
    # validation log: append-only
    "ai_validation_logs": (
        "SELECT",
        "INSERT",
    ),
    # read by the backend; written by migrations only
    "alembic_version": (
        "SELECT",
    ),
    "collections": (
        "SELECT",
        "INSERT",
        "UPDATE(name, color, icon, sort_order, archived_at, updated_at)",
        "DELETE",
    ),
    # history (R1): gap analysis deletes and re-inserts an attempt's rows; never updates
    "concept_masteries": (
        "SELECT",
        "INSERT",
        "DELETE",
    ),
    "document_chunks": (
        "SELECT",
        "INSERT",
        "UPDATE(chunk_index, text, heading, page_number, token_count, checksum, embedding_id, embedding_model, embedding_dim, metadata_json)",
        "DELETE",
    ),
    # collection_id is a move between collections, not ownership
    "documents": (
        "SELECT",
        "INSERT",
        "UPDATE(title, file_type, file_path, status, file_size, page_count, char_count, chunk_count, error_message, updated_at, metadata_json, display_name, favorite, pinned, archived_at, tags, last_opened_at, last_workspace, collection_id, open_count)",
        "DELETE",
    ),
    # user_id and idempotency identity are read-only
    "guided_mindmap_jobs": (
        "SELECT",
        "INSERT",
        "UPDATE(map_id, result_map_id, source_ids_json, guided_config_json, status, stage, attempts, progress, current_node, lease_owner, lease_expires_at, heartbeat_at, not_before, updated_at, started_at, completed_at, error_code, error_message, result_json, force, usage_reservation_id, usage_summary_json)",
    ),
    "guided_mindmap_worker_heartbeats": (
        "SELECT",
        "INSERT",
        "UPDATE(heartbeat_at, ttl_seconds)",
    ),
    "identities": (
        "SELECT",
        "INSERT",
        "UPDATE(provider, provider_user_id, last_login_at)",
    ),
    "jobs": (
        "SELECT",
        "INSERT",
        "UPDATE(job_type, status, progress, current_step, input_json, result_type, result_id, error_message, cancel_requested, updated_at)",
    ),
    "knowledge_edges": (
        "SELECT",
        "INSERT",
        "UPDATE(relation_type, description)",
    ),
    "knowledge_maps": (
        "SELECT",
        "INSERT",
        "UPDATE(title, status, generator_json, updated_at)",
    ),
    "knowledge_node_chunks": (
        "SELECT",
        "INSERT",
    ),
    "knowledge_nodes": (
        "SELECT",
        "INSERT",
        "UPDATE(title, summary, node_type, level, order_index, metadata_json)",
    ),
    # history (R1): saved, graded, regraded; identity read-only
    "quiz_answers": (
        "SELECT",
        "INSERT",
        "UPDATE(user_answer, verdict, is_correct, score, feedback, graded_at, updated_at)",
    ),
    "quiz_attempts": (
        "SELECT",
        "INSERT",
        "UPDATE(score, correct_count, incorrect_count, total_questions, max_score, percentage, duration_seconds, status, started_at, submitted_at, graded_at, metadata_json, submit_key, submit_fingerprint, grading_claimed_at)",
    ),
    # history: citations written once
    "quiz_question_chunks": (
        "SELECT",
        "INSERT",
    ),
    # history (R1): written once with the quiz
    "quiz_questions": (
        "SELECT",
        "INSERT",
    ),
    "quizzes": (
        "SELECT",
        "INSERT",
        "UPDATE(title, quiz_type, scope_json, question_count, difficulty, status, updated_at)",
    ),
    # history (R1): written once with the topic
    "review_item_chunks": (
        "SELECT",
        "INSERT",
    ),
    "review_plan_items": (
        "SELECT",
        "INSERT",
        "UPDATE(topic, priority, reason, status, mastery_score, review_tasks_json, archived_at)",
    ),
    # regeneration moves created_at (issue #18 option B)
    "review_plans": (
        "SELECT",
        "INSERT",
        "UPDATE(summary, created_at, updated_at)",
    ),
    "sections": (
        "SELECT",
        "INSERT",
        "UPDATE(title, level, order_index, page_start, page_end, summary, metadata_json)",
        "DELETE",
    ),
    "usage_entitlements": (
        "SELECT",
        "INSERT",
        "UPDATE(plan_code, monthly_token_limit, per_request_token_limit, period_start, period_end, reset_at, enabled, version, updated_at)",
    ),
    # usage ledger: append-only
    "usage_events": (
        "SELECT",
        "INSERT",
    ),
    # user_id and idempotency identity are read-only
    "usage_reservations": (
        "SELECT",
        "INSERT",
        "UPDATE(feature, operation, provider, model, job_id, reserved_tokens, monthly_token_limit, per_request_token_limit, status, expires_at, lease_owner, committed_at, released_at, expired_at, failed_at, terminal_at, period_start, period_end)",
    ),
    "users": (
        "SELECT",
        "INSERT",
        "UPDATE(full_name, email, password_hash, role, token_version, updated_at, avatar_url)",
    ),
}

# Columns that are NOT identity (not `id`, not a foreign key, not `created_at`) and that
# the app still may not UPDATE, by design. Every such column is either here or in the
# table's UPDATE list: a new column fails `tests/test_db_roles.py` (CI role step) until
# someone decides, in the migration's pull request.
READ_ONLY_BY_DESIGN: Dict[str, Tuple[str, ...]] = {
    "quiz_questions": ("question_text", "question_type", "options_json", "correct_answer",
                       "explanation", "difficulty", "concept_tags_json", "order_index"),
    "concept_masteries": ("concept_name", "correct_count", "earned_score", "total_count",
                          "mastery_score", "status"),
    "usage_events": ("attempt_id", "user_id", "account_id", "feature", "operation", "provider",
                     "model", "request_id", "job_id", "idempotency_key", "input_tokens",
                     "output_tokens", "embedding_tokens", "cached_input_tokens",
                     "total_tokens", "usage_source", "status", "metadata_json",
                     "period_start", "period_end"),
    "ai_validation_logs": ("target_type", "target_ref", "rule_code", "severity", "message",
                           "payload_json"),
    "guided_mindmap_jobs": ("user_id", "idempotency_key", "request_fingerprint"),
    "usage_reservations": ("user_id", "idempotency_key", "request_id"),
}

# Sequences: none today (every id is a UUID). A sequence a migration adds (serial,
# identity column) fails verification until it has a row here, e.g. {"x_id_seq": ("USAGE",)}.
APP_SEQUENCE_PRIVILEGES: Dict[str, Tuple[str, ...]] = {}

# Never granted to the app or the read-only role, on any table.
FORBIDDEN_TABLE_PRIVILEGES = ("TRUNCATE", "TRIGGER", "REFERENCES", "MAINTAIN")

# Supabase's Data API roles. `service_role` (the SUPABASE_SECRET_KEY) has BYPASSRLS and,
# by Supabase default, table grants in `public`: through the API it could rewrite any
# table and skip this contract. The app reaches the tables only through DATABASE_URL and
# uses the key for Storage only (another schema), so these roles get nothing here.
# Revoked when they exist; absent on plain PostgreSQL.
API_ROLES = ("anon", "authenticated", "service_role")

APP_POLICY = "studymap_app_access"
READONLY_POLICY = "studymap_readonly_access"

RLS_POLICIES = "policies"     # recommended: explicit per-role policies, no role attribute
RLS_BYPASS = "bypassrls"      # alternative: BYPASSRLS on the app and read-only roles


def _split(privilege: str) -> Tuple[str, str]:
    """``"UPDATE(a, b)"`` -> ``("UPDATE", "a, b")``; ``"SELECT"`` -> ``("SELECT", "")``."""
    if "(" in privilege:
        name, cols = privilege.split("(", 1)
        return name.strip(), cols.rstrip(")").strip()
    return privilege.strip(), ""


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def apply_statements(tables_with_rls, rls_mode: str = RLS_POLICIES, api_roles=()):
    """SQL, in order, that makes the grants and policies match the contract.

    Run by the table owner (it alone may GRANT on its tables and CREATE POLICY).
    Idempotent: revokes first, then grants; drops then creates the named policies.
    """
    if rls_mode not in (RLS_POLICIES, RLS_BYPASS):
        raise ValueError(f"unknown rls_mode {rls_mode!r}")
    out = [f"REVOKE CREATE ON SCHEMA public FROM {APP_ROLE}, {READONLY_ROLE}",
           f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}, {READONLY_ROLE}"]
    for seq, privileges in sorted(APP_SEQUENCE_PRIVILEGES.items()):
        q = f"public.{_q(seq)}"
        out.append(f"REVOKE ALL ON SEQUENCE {q} FROM {APP_ROLE}, {READONLY_ROLE}")
        if privileges:
            out.append(f"GRANT {', '.join(privileges)} ON SEQUENCE {q} TO {APP_ROLE}")
        # pg_dump as the read-only role reads every sequence's state (Codex task62).
        out.append(f"GRANT SELECT ON SEQUENCE {q} TO {READONLY_ROLE}")
    for table, privileges in sorted(APP_TABLE_PRIVILEGES.items()):
        t = f"public.{_q(table)}"
        out.append(f"REVOKE ALL ON {t} FROM {APP_ROLE}, {READONLY_ROLE}")
        if api_roles:
            out.append(f"REVOKE ALL ON {t} FROM {', '.join(api_roles)}")
        for p in privileges:
            name, cols = _split(p)
            target = f"{name} ({cols})" if cols else name
            out.append(f"GRANT {target} ON {t} TO {APP_ROLE}")
        out.append(f"GRANT SELECT ON {t} TO {READONLY_ROLE}")
        out.append(f"DROP POLICY IF EXISTS {APP_POLICY} ON {t}")
        out.append(f"DROP POLICY IF EXISTS {READONLY_POLICY} ON {t}")
        if rls_mode == RLS_POLICIES and table in tables_with_rls:
            out.append(f"CREATE POLICY {APP_POLICY} ON {t} AS PERMISSIVE FOR ALL "
                       f"TO {APP_ROLE} USING (true) WITH CHECK (true)")
            out.append(f"CREATE POLICY {READONLY_POLICY} ON {t} AS PERMISSIVE FOR SELECT "
                       f"TO {READONLY_ROLE} USING (true)")
    if api_roles:
        # Supabase grants new `public` objects to the API roles by default (Codex task62):
        # close the defaults of the role running this (the owner) and what exists now.
        # EXECUTE through PUBLIC is not revoked here; verify fails on it per function.
        api = ", ".join(api_roles)
        out += [f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {api}",
                f"REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM {api}",
                f"REVOKE CREATE ON SCHEMA public FROM {api}"]
        for kind in ("TABLES", "SEQUENCES", "FUNCTIONS"):
            out += [f"ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON {kind} FROM {api}",
                    f"ALTER DEFAULT PRIVILEGES REVOKE ALL ON {kind} FROM {api}"]
    return out


ROLES_RUNBOOK = "docs/RUNBOOK_DB_ROLES.md"


def separation_enabled(env=None) -> bool:
    import os
    env = os.environ if env is None else env
    return (env.get("DB_ROLE_SEPARATION") or "").strip().lower() in ("1", "true", "yes", "on")


def runtime_url_problems(env=None):
    """The runtime URL must log in as the app role, and never as the migration user.

    On the Supabase shared pooler the user is `<role>.<project_ref>`. Reads names only.
    """
    import os
    from urllib.parse import urlsplit
    env = os.environ if env is None else env
    runtime = (env.get("DATABASE_URL") or "").strip()
    mig = (env.get("MIGRATION_DATABASE_URL") or "").strip()
    user = (urlsplit(runtime).username or "") if runtime else ""
    problems = []
    if not runtime:
        problems.append("DATABASE_URL is empty")
    elif user.split(".", 1)[0] != APP_ROLE:
        problems.append(f"DATABASE_URL does not log in as {APP_ROLE} (role separation on)")
    if not mig:
        problems.append("MIGRATION_DATABASE_URL is empty (role separation on)")
    elif runtime and (urlsplit(mig).username or "") == user:
        problems.append("MIGRATION_DATABASE_URL logs in as the runtime user")
    return problems


def runtime_login_problems(owner_conn, runtime_url: str):
    """Log in through the runtime URL before the new backend starts (Codex task62).

    The name in the URL proves nothing: a wrong password, a role without LOGIN, or the
    same role name in another project on the shared pooler all passed. It must log in as
    the app role, reach the very database `owner_conn` verifies (same server, same
    database), and read a contract table. Reports no URL, user input or server message.
    """
    import sqlalchemy as sa

    from shared.migration_guard import chuan_hoa_driver

    if not runtime_url:
        return []   # runtime_url_problems reports the empty URL
    ident = sa.text("SELECT current_database(), (SELECT oid FROM pg_database "
                    "WHERE datname = current_database()), pg_postmaster_start_time()")
    want = tuple(owner_conn.execute(ident).first())
    probe = next(t for t, privs in sorted(APP_TABLE_PRIVILEGES.items()) if "SELECT" in privs)
    try:
        engine = sa.create_engine(chuan_hoa_driver(runtime_url), poolclass=sa.pool.NullPool,
                                  connect_args={"connect_timeout": 10})
        try:
            with engine.connect() as conn:
                who = conn.execute(sa.text("SELECT current_user")).scalar()
                got = tuple(conn.execute(ident).first())
                if who != APP_ROLE:
                    return [f"DATABASE_URL logs in as {who}, not {APP_ROLE}"]
                if got != want:
                    return [f"DATABASE_URL reaches database {got[0]}, not the database the "
                            f"migration verified ({want[0]}, same server)"]
                conn.execute(sa.text(f"SELECT 1 FROM public.{_q(probe)} LIMIT 0"))
        finally:
            engine.dispose()
    except Exception as exc:   # never echo the URL or the server's message
        orig = getattr(exc, "orig", None)
        return [f"DATABASE_URL cannot log in or read {probe} as {APP_ROLE} "
                f"({type(orig or exc).__name__}, sqlstate {getattr(orig, 'sqlstate', None)})"]
    return []


_COLUMN_PRIVS = ("SELECT", "INSERT", "UPDATE", "REFERENCES")
_TABLE_PRIVS = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES")
_DEFAULT_ACL_KINDS = {"r": "tables", "S": "sequences", "f": "functions"}


def role_problems(conn, rls_mode: str = RLS_POLICIES, roles=(APP_ROLE, READONLY_ROLE)):
    """Read-only check of the live database against the contract. [] when it matches.

    `conn` is a SQLAlchemy connection (any role that can read the catalogs).
    """
    import sqlalchemy as sa

    problems = []
    app, readonly = roles
    rows = {r[0]: r for r in conn.execute(sa.text(
        "SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication "
        "FROM pg_roles WHERE rolname = ANY(:n)"), {"n": list(roles)})}
    for role in roles:
        r = rows.get(role)
        if r is None:
            problems.append(f"role {role} does not exist")
            continue
        _, sup, bypass, createrole, createdb, repl = r
        if sup or createrole or createdb or repl:
            problems.append(f"role {role} has SUPERUSER/CREATEROLE/CREATEDB/REPLICATION")
        if bypass and rls_mode != RLS_BYPASS:
            problems.append(f"role {role} has BYPASSRLS (mode {rls_mode})")
        if not bypass and rls_mode == RLS_BYPASS:
            problems.append(f"role {role} lacks BYPASSRLS (mode {rls_mode})")
    if problems and any("does not exist" in p for p in problems):
        return problems

    # PostgreSQL 17 adds MAINTAIN (VACUUM, REINDEX, LOCK TABLE, ...; Codex task62).
    table_privs = _TABLE_PRIVS + (
        ("MAINTAIN",) if int(conn.execute(sa.text("SHOW server_version_num")).scalar()) >= 170000
        else ())
    tables = {r[0]: (r[1], r[2]) for r in conn.execute(sa.text(
        "SELECT c.relname, c.relrowsecurity, pg_get_userbyid(c.relowner) FROM pg_class c "
        "JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')"))}
    for table in sorted(set(tables) - set(APP_TABLE_PRIVILEGES)):
        problems.append(f"table {table} has no entry in shared.db_roles.APP_TABLE_PRIVILEGES")
    for table in sorted(set(APP_TABLE_PRIVILEGES) - set(tables)):
        problems.append(f"contract names table {table}, which does not exist")

    for role in roles:
        owns = conn.execute(sa.text(
            "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = :r"),
            {"r": role}).scalar()
        if owns:
            problems.append(f"role {role} owns {owns} object(s) in schema public")
        # Members of nothing (Codex task60): `pg_has_role(.., 'USAGE')` misses a NOINHERIT
        # membership, which still allows `SET ROLE` to the owner; predefined roles such as
        # pg_write_all_data bypass table grants altogether. Any membership is a problem.
        groups = [g for (g,) in conn.execute(sa.text(
            "SELECT pg_get_userbyid(m.roleid) FROM pg_auth_members m "
            "WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = :r) ORDER BY 1"),
            {"r": role})]
        if groups:
            problems.append(f"role {role} is a member of {', '.join(groups)} "
                            "(it could SET ROLE or inherit their rights)")
        if conn.execute(sa.text("SELECT has_schema_privilege(:r, 'public', 'CREATE')"),
                        {"r": role}).scalar():
            problems.append(f"role {role} may CREATE in schema public")

    present_api = [r for (r,) in conn.execute(sa.text(
        "SELECT rolname FROM pg_roles WHERE rolname = ANY(:n)"), {"n": list(API_ROLES)})]
    api_table_sql = sa.text("SELECT " + " OR ".join(
        [f"has_any_column_privilege(:r, :t, '{p}')" for p in _COLUMN_PRIVS]
        + [f"has_table_privilege(:r, :t, '{p}')" for p in table_privs
           if p not in _COLUMN_PRIVS]))
    for api in present_api:
        for table in sorted(set(tables) & set(APP_TABLE_PRIVILEGES)):
            if conn.execute(api_table_sql, {"r": api, "t": f"public.{_q(table)}"}).scalar():
                problems.append(f"Supabase API role {api} has privileges on {table}")
    if present_api:
        # Codex task62: the next table, sequence or function the owner creates, and every
        # function through PUBLIC, would reach the Data API without these checks.
        owners = sorted({owner for (_rls, owner) in tables.values()})
        for grantor, nsp, kind, grantee in conn.execute(sa.text(
                "SELECT pg_get_userbyid(d.defaclrole), COALESCE(n.nspname, 'every schema'), "
                "d.defaclobjtype::text, pg_get_userbyid(a.grantee) FROM pg_default_acl d "
                "LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace "
                "CROSS JOIN LATERAL aclexplode(d.defaclacl) a "
                "WHERE (d.defaclnamespace = 0 OR n.nspname = 'public') "
                "AND d.defaclobjtype IN ('r', 'S', 'f') "
                "AND pg_get_userbyid(d.defaclrole) = ANY(:owners) "
                "AND pg_get_userbyid(a.grantee) = ANY(:api) ORDER BY 1, 2, 3, 4"),
                {"owners": owners, "api": present_api}).fetchall():
            problems.append(f"default privileges of {grantor} in {nsp} grant new "
                            f"{_DEFAULT_ACL_KINDS[kind]} to Supabase API role {grantee}")
        seqs = [q for (q,) in conn.execute(sa.text(
            "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace "
            "AND relkind = 'S' ORDER BY 1"))]
        funcs = [f for (f,) in conn.execute(sa.text(
            "SELECT p.oid::regprocedure::text FROM pg_proc p "
            "WHERE p.pronamespace = 'public'::regnamespace "
            "AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype) "
            "AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass "
            "AND d.objid = p.oid AND d.deptype = 'e') ORDER BY 1"))]
        for api in present_api:
            for seq in seqs:
                if conn.execute(sa.text(
                        "SELECT has_sequence_privilege(:r, :s, 'USAGE') "
                        "OR has_sequence_privilege(:r, :s, 'SELECT') "
                        "OR has_sequence_privilege(:r, :s, 'UPDATE')"),
                        {"r": api, "s": f"public.{_q(seq)}"}).scalar():
                    problems.append(f"Supabase API role {api} has privileges on sequence {seq}")
            for fn in funcs:
                if conn.execute(sa.text("SELECT has_function_privilege(:r, :f, 'EXECUTE')"),
                                {"r": api, "f": fn}).scalar():
                    problems.append(f"Supabase API role {api} may EXECUTE function {fn} "
                                    "(revoke EXECUTE from PUBLIC and the API roles in its "
                                    "migration)")
            if conn.execute(sa.text("SELECT has_schema_privilege(:r, 'public', 'CREATE')"),
                            {"r": api}).scalar():
                problems.append(f"Supabase API role {api} may CREATE in schema public")

    for (seq,) in conn.execute(sa.text(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = 'S' ORDER BY 1")):
        want = set(APP_SEQUENCE_PRIVILEGES.get(seq, ()))
        if seq not in APP_SEQUENCE_PRIVILEGES:
            problems.append(f"sequence {seq} has no entry in APP_SEQUENCE_PRIVILEGES")
        for role, allowed in ((app, want), (readonly, {"SELECT"})):
            for priv in ("USAGE", "SELECT", "UPDATE"):
                if conn.execute(sa.text("SELECT has_sequence_privilege(:r, :s, :p)"),
                                {"r": role, "s": f"public.{_q(seq)}", "p": priv}).scalar()                         != (priv in allowed):
                    problems.append(f"{role} {priv} on sequence {seq} differs from the contract")

    for table, (rls, _owner) in sorted(tables.items()):
        if table not in APP_TABLE_PRIVILEGES:
            continue
        want_app = {}
        for p in APP_TABLE_PRIVILEGES[table]:
            name, cols = _split(p)
            want_app[name] = cols
        for role, want in ((app, want_app), (readonly, {"SELECT": ""})):
            for priv in table_privs:
                has = conn.execute(sa.text("SELECT has_table_privilege(:r, :t, :p)"),
                                   {"r": role, "t": f"public.{_q(table)}", "p": priv}).scalar()
                if priv in want and not want[priv] and not has:
                    problems.append(f"{role} lacks {priv} on {table}")
                elif priv not in want and has:
                    problems.append(f"{role} has {priv} on {table} (not in the contract)")
                elif priv in want and want[priv] and has:
                    problems.append(f"{role} has table-wide {priv} on {table}; "
                                    f"contract allows columns ({want[priv]}) only")
                elif (priv not in want and priv in _COLUMN_PRIVS
                      and conn.execute(sa.text("SELECT has_any_column_privilege(:r, :t, :p)"),
                                       {"r": role, "t": f"public.{_q(table)}",
                                        "p": priv}).scalar()):
                    # A column-level grant is invisible to has_table_privilege.
                    problems.append(f"{role} has column-level {priv} on {table} "
                                    "(not in the contract)")
            for priv, cols in want.items():
                if not cols:
                    continue
                allowed = {c.strip() for c in cols.split(",")}
                granted = {r[0] for r in conn.execute(sa.text(
                    "SELECT a.attname FROM pg_attribute a WHERE a.attrelid = CAST(:t AS regclass) "
                    "AND a.attnum > 0 AND NOT a.attisdropped "
                    "AND has_column_privilege(:r, :t, a.attname, :p)"),
                    {"r": role, "t": f"public.{_q(table)}", "p": priv})}
                if granted != allowed:
                    problems.append(f"{role} {priv} columns on {table}: {sorted(granted)} != "
                                    f"{sorted(allowed)}")
        if rls and rls_mode == RLS_POLICIES:
            pols = {r[0]: r for r in conn.execute(sa.text(
                "SELECT policyname, roles::text[], cmd, qual, with_check, permissive "
                "FROM pg_policies WHERE schemaname = 'public' AND tablename = :t"),
                {"t": table})}
            for name, role, cmd, check in ((APP_POLICY, app, "ALL", "true"),
                                          (READONLY_POLICY, readonly, "SELECT", None)):
                p = pols.get(name)
                if p is None:
                    problems.append(f"policy {name} missing on {table}")
                elif (list(p[1]) != [role] or p[2] != cmd or p[3] != "true"
                      or p[4] != check or p[5] != "PERMISSIVE"):
                    problems.append(f"policy {name} on {table} differs from the contract")
            for name in sorted(set(pols) - {APP_POLICY, READONLY_POLICY}):
                problems.append(f"unexpected policy {name} on {table}")
    return problems
