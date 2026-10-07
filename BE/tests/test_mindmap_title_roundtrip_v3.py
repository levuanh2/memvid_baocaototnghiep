"""Diagnostic + regression guard for "Lưu sơ đồ cắt tiêu đề dài".

Traces the real path: canonical record -> FE canvas compaction (the frontend's own
algorithm is covered by its unit tests; this file mirrors it in Python to build a
faithful save payload) -> the exact PUT payload "Lưu sơ đồ" sends -> the real Flask
route (update_mindmap) -> the real SQLite store -> reload -> the field PR #59's
canonical export reads.

No mocks for the save path: uses the real `app.main.app.test_client()` and the real
`app.domains.mindmap.store` against a tmp_path SQLite file. Never touches production.
"""
import json

from services.mindmap.pipeline.schema import compact_topic


LONG_TITLE_NO_NOTE = (
    "Tiêu đề nhánh dài vượt quá giới hạn một trăm ký tự, có dấu tiếng Việt đầy đủ, "
    "dùng để kiểm tra hành vi lưu và tải lại trên nhánh không có ghi chú thật"
)
LONG_TITLE_WITH_REAL_NOTE = (
    "Một tiêu đề khác cũng rất dài, viết bằng tiếng Việt có dấu, dành riêng cho "
    "trường hợp nhánh đã có sẵn một ghi chú thật do người dùng tự viết"
)
REAL_USER_NOTE = "Đây là ghi chú thật do người dùng tự gõ, không liên quan gì tới tiêu đề node."


def _canonical_record():
    """The record as it exists BEFORE any user Save — e.g. right after generation,
    or right after a previous, correct write. Both long-titled nodes still carry
    their full title here."""
    return {
        "id": "m1", "schema_version": 2, "title": "Bản đồ kiểm thử",
        "sources": ["doc1"], "content_hash": "h" * 64, "created_at": "2026-07-04T00:00:00Z",
        "nodes": [
            {"id": "root", "parent": None, "kind": "root", "title": "Gốc", "note": "", "chunk_refs": [], "order": 0},
            {"id": "n1", "parent": "root", "kind": "section", "title": LONG_TITLE_NO_NOTE, "note": "", "chunk_refs": [], "order": 0},
            {"id": "n2", "parent": "root", "kind": "section", "title": LONG_TITLE_WITH_REAL_NOTE, "note": REAL_USER_NOTE, "chunk_refs": [], "order": 1},
        ],
        "relations": [], "generator": {"pipeline": "skeleton_v1", "degraded": False, "missing": []},
    }


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
    monkeypatch.setenv("MINDMAPS_DB_PATH", str(tmp_path / "mm.sqlite"))
    from app import main as be_main
    return be_main.app.test_client()


def _save_button_payload(canonical, *, fixed=True, renamed_ids=None):
    """What 'Lưu sơ đồ' sends.

    `fixed=False` mirrors the ORIGINAL (buggy) mindElixirAdapter.js: an untouched
    node sends `node.topic` — the compacted canvas display string — as its title.
    This is kept only to document/reproduce the historical bug (see the test named
    accordingly below), never as current behavior.

    `fixed=True` (default) mirrors the hotfixed mindElixirToRecord: an untouched
    node (its live topic still equals compact_topic(original title)) sends the
    ORIGINAL full title; a node listed in `renamed_ids` sends its new live text
    (already full, since live edits are never auto-compacted) as a genuine rename.

    `note` is the adapter's sidecar either way — unchanged by the fix: the full
    original title IF the node had no real note at load, else the real note
    (mirrors mindElixirAdapter.js's own line ~52).
    """
    renamed_ids = renamed_ids or {}
    out = {**canonical, "nodes": []}
    for n in canonical["nodes"]:
        canvas_topic = compact_topic(n["title"])
        sidecar_note = n["note"] or (n["title"] if canvas_topic != n["title"] else "")
        if n["id"] in renamed_ids:
            title = renamed_ids[n["id"]]
        elif fixed:
            title = n["title"]
        else:
            title = canvas_topic
        out["nodes"].append({
            "id": n["id"], "parent": n["parent"], "kind": n["kind"],
            "title": title, "note": sidecar_note, "chunk_refs": n["chunk_refs"], "order": n["order"],
        })
    return out


def recoverable_title(title: str, note: str) -> str | None:
    """The ONLY certain recovery rule for an already-legacy-damaged node: note must,
    after compaction, reproduce title exactly. An arbitrary real user note will not
    satisfy this by construction. Never a guess."""
    if not note or len(note) <= len(title):
        return None
    return note if compact_topic(note) == title else None


# --- Historical bug, kept only as documentation of what was reproduced before the fix.

def test_historical_bug_before_fix_lost_the_full_title_on_save(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    from app.domains.mindmap import store
    store.save_record(_canonical_record())
    payload = _save_button_payload(_canonical_record(), fixed=False)
    r = client.put("/mindmaps/m1", data=json.dumps(payload), content_type="application/json")
    assert r.status_code == 200
    saved = store.get_record("m1")
    n1 = next(n for n in saved["nodes"] if n["id"] == "n1")
    assert n1["title"] != LONG_TITLE_NO_NOTE
    assert len(n1["title"]) <= 100


# --- Fixed behavior (current code) — pass-after, and the permanent regression guard.

def test_full_title_survives_a_real_save_and_reload(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    from app.domains.mindmap import store
    store.save_record(_canonical_record())
    payload = _save_button_payload(_canonical_record())  # fixed=True
    r = client.put("/mindmaps/m1", data=json.dumps(payload), content_type="application/json")
    assert r.status_code == 200
    saved = store.get_record("m1")
    by_id = {n["id"]: n for n in saved["nodes"]}
    assert by_id["n1"]["title"] == LONG_TITLE_NO_NOTE
    assert by_id["n2"]["title"] == LONG_TITLE_WITH_REAL_NOTE


def test_canvas_display_stays_compact_while_the_saved_title_is_full(tmp_path, monkeypatch):
    # The canvas itself is unchanged by this fix: compactTopic()/MAX_TOPIC_LENGTH still
    # cap what is rendered. Only what gets PERSISTED changes.
    canvas_topic = compact_topic(LONG_TITLE_NO_NOTE)
    assert len(canvas_topic) <= 100
    assert canvas_topic.endswith("…")
    payload = _save_button_payload(_canonical_record())
    n1 = next(n for n in payload["nodes"] if n["id"] == "n1")
    assert n1["title"] == LONG_TITLE_NO_NOTE  # what gets sent/saved is the full title, not canvas_topic


def test_real_user_note_is_preserved_unchanged_and_was_never_the_title_backup(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    from app.domains.mindmap import store
    store.save_record(_canonical_record())
    r = client.put("/mindmaps/m1", data=json.dumps(_save_button_payload(_canonical_record())), content_type="application/json")
    assert r.status_code == 200
    saved = store.get_record("m1")
    n2 = next(n for n in saved["nodes"] if n["id"] == "n2")
    assert n2["note"] == REAL_USER_NOTE
    assert n2["title"] == LONG_TITLE_WITH_REAL_NOTE  # the fix means n2 never needed note as a backup


def test_export_after_reload_now_reads_the_full_title(tmp_path, monkeypatch):
    """PR #59's canonical export reads `record.nodes[].title` with no further
    compaction. With the fix, that field is the full title after reload, so the
    export pipeline (already proven correct in PR #59's own tests) now gets full
    titles for nodes the old bug would have already damaged."""
    client = _client(tmp_path, monkeypatch)
    from app.domains.mindmap import store
    store.save_record(_canonical_record())
    client.put("/mindmaps/m1", data=json.dumps(_save_button_payload(_canonical_record())), content_type="application/json")
    saved = store.get_record("m1")
    by_id = {n["id"]: n for n in saved["nodes"]}
    assert by_id["n1"]["title"] == LONG_TITLE_NO_NOTE
    assert by_id["n2"]["title"] == LONG_TITLE_WITH_REAL_NOTE


def test_user_rename_is_saved_not_reverted(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    from app.domains.mindmap import store
    store.save_record(_canonical_record())
    payload = _save_button_payload(_canonical_record(), renamed_ids={"n1": "Tên mới do người dùng tự gõ"})
    r = client.put("/mindmaps/m1", data=json.dumps(payload), content_type="application/json")
    assert r.status_code == 200
    saved_n1 = next(n for n in store.get_record("m1")["nodes"] if n["id"] == "n1")
    assert saved_n1["title"] == "Tên mới do người dùng tự gõ"


def test_deliberate_short_title_is_not_restored_to_the_old_long_one(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    from app.domains.mindmap import store
    store.save_record(_canonical_record())
    payload = _save_button_payload(_canonical_record(), renamed_ids={"n1": "Ngắn"})
    r = client.put("/mindmaps/m1", data=json.dumps(payload), content_type="application/json")
    assert r.status_code == 200
    saved_n1 = next(n for n in store.get_record("m1")["nodes"] if n["id"] == "n1")
    assert saved_n1["title"] == "Ngắn"  # no "helpful" restore of the old long title


def test_parent_child_mapping_is_preserved_across_save_and_reload(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    from app.domains.mindmap import store
    store.save_record(_canonical_record())
    client.put("/mindmaps/m1", data=json.dumps(_save_button_payload(_canonical_record())), content_type="application/json")
    saved = {n["id"]: n["parent"] for n in store.get_record("m1")["nodes"]}
    assert saved == {"root": None, "n1": "root", "n2": "root"}


# --- Legacy-data diagnostic: detecting nodes ALREADY damaged by the historical bug
# (constructed directly, not via a save cycle — the fix prevents new damage, it does
# not retroactively repair old records; the production audit found none of these in
# the real database, so this is a decoder test only).

def test_legacy_recoverable_case_decodes_the_original_title_from_note(tmp_path, monkeypatch):
    damaged_title = compact_topic(LONG_TITLE_NO_NOTE)
    note_from_old_buggy_save = LONG_TITLE_NO_NOTE  # what the old sidecar would have carried
    recovered = recoverable_title(damaged_title, note_from_old_buggy_save)
    assert recovered == LONG_TITLE_NO_NOTE  # RECOVERABLE=yes


def test_legacy_unrecoverable_case_is_not_guessed_from_a_real_note(tmp_path, monkeypatch):
    damaged_title = compact_topic(LONG_TITLE_WITH_REAL_NOTE)
    recovered = recoverable_title(damaged_title, REAL_USER_NOTE)
    assert recovered is None  # RECOVERABLE=no — must not be guessed from an unrelated real note
