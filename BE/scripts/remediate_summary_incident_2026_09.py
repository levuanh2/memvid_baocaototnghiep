"""One-time remediation for the 3 confirmed-bad Summary records from the
SKIP_MODEL_LOAD incident (diagnosed and fixed 2026-09-23). Narrowly scoped
to this exact incident's target set -- not general-purpose tooling, and
refuses to touch anything outside TARGET_IDS.

Uses the same server-side application function the real /generate-summary
route calls (app.application.summary_generation.run_summary_job), passing
the original record's own user_id explicitly. No token, no session, no
auth bypass, no impersonation -- this is the same "explicit user_id"
parameter the route already accepts internally.

Run inside the backend container (has real DB access + fully-wired
app.main import):
    python3 -m scripts.remediate_summary_incident_2026_09 backup   <id>
    python3 -m scripts.remediate_summary_incident_2026_09 generate <id>
    python3 -m scripts.remediate_summary_incident_2026_09 delete   <id>
    python3 -m scripts.remediate_summary_incident_2026_09 status

One record at a time. `generate` never deletes anything. `delete` only
removes the frozen old id, and only after `generate` wrote a validated
replacement into the audit file for that same id.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
import time
import uuid
from pathlib import Path

TARGET_IDS = {
    "e7af7ee3-9d34-4d97-88e6-7ac26066a283",
    "56380afa-a64b-42e2-a21d-1cc20db94aed",
    "a5fa4dd1-24b9-4d12-bbae-751d4c484171",
}
AUDIT_DIR = Path("/opt/memvid/incident-2026-09-23")
AUDIT_FILE = AUDIT_DIR / "summary_remediation_audit.json"


def _load_audit() -> dict:
    if AUDIT_FILE.exists():
        return json.loads(AUDIT_FILE.read_text(encoding="utf-8"))
    return {}


def _save_audit(data: dict) -> None:
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    AUDIT_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _sha(obj) -> str:
    blob = json.dumps(obj, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _all_sections_empty(rec: dict) -> bool:
    secs = rec.get("sections") or []
    return bool(secs) and all(not (s.get("summary") or "").strip() for s in secs)


def _owner_of(old_id: str) -> str | None:
    from app.domains.summary import store as summary_store
    conn = sqlite3.connect(str(summary_store.db_path()))
    try:
        row = conn.execute("SELECT user_id FROM summaries WHERE id=?", (old_id,)).fetchone()
    finally:
        conn.close()
    return row[0] if row else None


def cmd_backup(old_id: str) -> None:
    if old_id not in TARGET_IDS:
        print("REFUSED: not in frozen target set")
        sys.exit(1)
    from app.domains.summary import store as summary_store
    row = summary_store.get_record(old_id)
    if row is None:
        print("REFUSED: record not found")
        sys.exit(1)
    if not _all_sections_empty(row):
        print("REFUSED: record no longer matches confirmed-bad signature")
        sys.exit(1)
    audit = _load_audit()
    entry = audit.setdefault(old_id, {})
    entry["old_record_backup"] = row
    entry["old_record_sha256"] = _sha(row)
    entry["source"] = row.get("sources")
    entry["length_mode"] = row.get("length_mode")
    entry["mode"] = row.get("mode")
    _save_audit(audit)
    print("BACKED_UP", old_id, "sha256", entry["old_record_sha256"])


def cmd_generate(old_id: str) -> None:
    if old_id not in TARGET_IDS:
        print("REFUSED: not in frozen target set")
        sys.exit(1)
    audit = _load_audit()
    entry = audit.get(old_id)
    if not entry or "old_record_backup" not in entry:
        print("REFUSED: run backup first")
        sys.exit(1)

    owner_uid = _owner_of(old_id)
    if not owner_uid:
        print("REFUSED: could not resolve original owner (record already gone?)")
        sys.exit(1)

    old = entry["old_record_backup"]
    sources = old.get("sources") or []
    length_mode = old.get("length_mode") or "medium"
    mode = old.get("mode") or "standard"

    import app.main as be
    mm_input, content_hash = be._summary_input_and_hash(sources, length_mode, mode)
    if not mm_input.get("chunks"):
        print("REFUSED: source has no indexed chunks anymore")
        sys.exit(1)

    job_id = str(uuid.uuid4())
    from app.domains.jobs.jobs_store import create_job
    create_job(job_id, job_type="summary", status="pending", progress=0,
              current_node="Queued", user_id=owner_uid)

    from app.application.summary_generation import run_summary_job as _impl
    t0 = time.time()
    _impl(job_id, sources, mm_input, content_hash, length_mode, owner_uid,
         mode, graph=be.SUMMARY_GRAPH)
    elapsed = time.time() - t0

    from app.domains.summary import store as summary_store
    new_row = summary_store.get_by_hash(content_hash, user_id=owner_uid, enforce_owner=True)
    if new_row is None:
        print("FAILED: no record persisted -- old record untouched, nothing to roll back")
        entry["generation_result"] = "failed_no_record"
        _save_audit(audit)
        sys.exit(1)

    new_id = new_row.get("id")
    degraded = (new_row.get("generator") or {}).get("degraded")
    ok = (new_id != old_id and degraded is False
          and not _all_sections_empty(new_row)
          and (new_row.get("sources") or []) == sources)

    entry["generation_job_id"] = job_id
    entry["elapsed_sec"] = elapsed
    entry["new_summary_id"] = new_id
    entry["new_record_sha256"] = _sha(new_row)
    entry["new_record_degraded"] = degraded
    secs = new_row.get("sections") or []
    entry["new_record_section_count"] = len(secs)
    entry["new_record_empty_sections"] = sum(1 for s in secs if not (s.get("summary") or "").strip())
    entry["validation_passed"] = ok
    _save_audit(audit)

    print("NEW_ID", new_id, "elapsed_sec", round(elapsed, 1),
          "degraded", degraded, "empty_sections",
          entry["new_record_empty_sections"], "/", entry["new_record_section_count"],
          "VALIDATION", "PASS" if ok else "FAIL")


def cmd_delete(old_id: str) -> None:
    if old_id not in TARGET_IDS:
        print("REFUSED: not in frozen target set")
        sys.exit(1)
    audit = _load_audit()
    entry = audit.get(old_id)
    if not entry or not entry.get("validation_passed"):
        print("REFUSED: no passing validated replacement on file -- run generate first")
        sys.exit(1)

    owner_uid = _owner_of(old_id)
    if owner_uid is None:
        print("ALREADY_GONE", old_id)
        sys.exit(0)

    from app.domains.summary import store as summary_store
    deleted = summary_store.delete_record(old_id, user_id=owner_uid, enforce_owner=True)
    entry["old_deleted"] = bool(deleted)
    _save_audit(audit)

    still_new = summary_store.get_record(entry["new_summary_id"], user_id=owner_uid, enforce_owner=True)
    print("DELETED", old_id, "->", deleted,
          "| new_still_present:", still_new is not None)


def cmd_status(*_args: str) -> None:
    audit = _load_audit()
    for tid in sorted(TARGET_IDS):
        e = audit.get(tid, {})
        print(tid,
              "backed_up:", "old_record_sha256" in e,
              "new_id:", e.get("new_summary_id"),
              "validated:", e.get("validation_passed"),
              "deleted:", e.get("old_deleted"))


if __name__ == "__main__":
    handlers = {"backup": cmd_backup, "generate": cmd_generate,
               "delete": cmd_delete, "status": cmd_status}
    if len(sys.argv) < 2 or sys.argv[1] not in handlers:
        print("usage: remediate_summary_incident_2026_09 backup|generate|delete|status [id]")
        sys.exit(2)
    handlers[sys.argv[1]](*sys.argv[2:])
