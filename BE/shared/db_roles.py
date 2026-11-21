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

# Never granted to the app or the read-only role, on any table.
FORBIDDEN_TABLE_PRIVILEGES = ("TRUNCATE", "TRIGGER", "REFERENCES")

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


_TABLE_PRIVS = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES")


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
    for api in present_api:
        for table in sorted(set(tables) & set(APP_TABLE_PRIVILEGES)):
            if conn.execute(sa.text(
                    "SELECT has_table_privilege(:r, :t, 'SELECT') OR has_table_privilege(:r, :t, 'INSERT') "
                    "OR has_table_privilege(:r, :t, 'UPDATE') OR has_table_privilege(:r, :t, 'DELETE') "
                    "OR has_table_privilege(:r, :t, 'TRUNCATE') OR has_any_column_privilege(:r, :t, 'UPDATE')"),
                    {"r": api, "t": f"public.{_q(table)}"}).scalar():
                problems.append(f"Supabase API role {api} has privileges on {table}")

    for table, (rls, _owner) in sorted(tables.items()):
        if table not in APP_TABLE_PRIVILEGES:
            continue
        want_app = {}
        for p in APP_TABLE_PRIVILEGES[table]:
            name, cols = _split(p)
            want_app[name] = cols
        for role, want in ((app, want_app), (readonly, {"SELECT": ""})):
            for priv in _TABLE_PRIVS:
                has = conn.execute(sa.text("SELECT has_table_privilege(:r, :t, :p)"),
                                   {"r": role, "t": f"public.{_q(table)}", "p": priv}).scalar()
                if priv in want and not want[priv] and not has:
                    problems.append(f"{role} lacks {priv} on {table}")
                elif priv not in want and has:
                    problems.append(f"{role} has {priv} on {table} (not in the contract)")
                elif priv in want and want[priv] and has:
                    problems.append(f"{role} has table-wide {priv} on {table}; "
                                    f"contract allows columns ({want[priv]}) only")
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
