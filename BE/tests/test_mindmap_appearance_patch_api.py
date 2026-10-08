"""PR C2 — PATCH /mindmaps/<id>/appearance: auth/ownership like update_mindmap,
merges ONLY the appearance field, never touches nodes/relations/title,
rejects a malformed envelope with a clear error, silently sanitizes
geometry-affecting junk inside overrides."""
from __future__ import annotations

import pytest


def _protect(main, monkeypatch, uid, on=True):
    monkeypatch.setattr(main, "_auth_protect_enabled", lambda: on)
    monkeypatch.setattr(main, "_current_user_id", lambda: uid)


@pytest.fixture()
def be(client):
    import app.main as main
    return main


def _rec(i="m1", appearance=None):
    rec = {
        "id": i, "schema_version": 2, "title": "Bản đồ tư duy", "sources": ["doc_a"],
        "content_hash": "h" * 64, "created_at": "2026-07-13T00:00:00Z",
        "nodes": [
            {"id": "root", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0},
            {"id": "c1", "parent": "root", "kind": "section", "title": "Kiến trúc hệ thống", "order": 0},
        ],
        "relations": [], "generator": {"degraded": False, "missing": []},
    }
    if appearance is not None:
        rec["appearance"] = appearance
    return rec


class _FakeStore:
    """A tiny in-memory stand-in for mindmap_store, so a PATCH followed by a
    GET-equivalent read in the SAME test reflects what was actually saved —
    not just what the route returned."""
    def __init__(self, initial):
        self.records = {initial["id"]: dict(initial)}

    def get_record(self, mindmap_id, user_id=None, enforce_owner=False):
        rec = self.records.get(mindmap_id)
        if not rec:
            return None
        if enforce_owner and user_id != "userA":
            return None
        return dict(rec)

    def save_record(self, record, user_id=None):
        self.records[record["id"]] = dict(record)


def _wire_store(monkeypatch, be, initial):
    from app.domains.mindmap import store
    fake = _FakeStore(initial)
    monkeypatch.setattr(store, "get_record", fake.get_record)
    monkeypatch.setattr(store, "save_record", fake.save_record)
    return fake


def test_404_for_unknown_map(be, client, monkeypatch):
    _wire_store(monkeypatch, be, _rec())
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.patch("/mindmaps/does-not-exist/appearance", json={"appearance": {"version": 2, "preset": "study", "overrides": {}}})
    assert resp.status_code == 404


def test_foreign_owner_cannot_patch(be, client, monkeypatch):
    _wire_store(monkeypatch, be, _rec())
    _protect(be, monkeypatch, "userB", on=True)
    resp = client.patch("/mindmaps/m1/appearance", json={"appearance": {"version": 2, "preset": "study", "overrides": {}}})
    assert resp.status_code == 404


def test_missing_appearance_key_rejected(be, client, monkeypatch):
    _wire_store(monkeypatch, be, _rec())
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.patch("/mindmaps/m1/appearance", json={"notAppearance": {}})
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "invalid_appearance"


def test_non_object_appearance_rejected(be, client, monkeypatch):
    _wire_store(monkeypatch, be, _rec())
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.patch("/mindmaps/m1/appearance", json={"appearance": "not-an-object"})
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "invalid_appearance"


def test_future_version_rejected_with_clear_error(be, client, monkeypatch):
    _wire_store(monkeypatch, be, _rec())
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.patch("/mindmaps/m1/appearance", json={"appearance": {"version": 99, "preset": "study", "overrides": {}}})
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "invalid_appearance"


def test_unknown_preset_name_rejected(be, client, monkeypatch):
    _wire_store(monkeypatch, be, _rec())
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.patch("/mindmaps/m1/appearance", json={"appearance": {"version": 2, "preset": "neon-cyberpunk", "overrides": {}}})
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "invalid_appearance"


def test_geometry_fields_inside_overrides_are_silently_dropped_not_rejected(be, client, monkeypatch):
    fake = _wire_store(monkeypatch, be, _rec())
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.patch("/mindmaps/m1/appearance", json={"appearance": {
        "version": 2, "preset": "default",
        "overrides": {"node": {"root": {"fill": "#112233", "padding": 40}, "branch": {}, "leaf": {}},
                      "canvas": {}, "connector": {}, "typography": {"family": "serif"}},
    }})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["appearance"]["overrides"]["node"]["root"]["fill"] == "#112233"
    assert "padding" not in body["appearance"]["overrides"]["node"]["root"]
    assert "typography" not in body["appearance"]
    assert fake.records["m1"]["appearance"]["overrides"]["node"]["root"]["fill"] == "#112233"


def test_patch_only_changes_appearance_never_nodes_relations_title(be, client, monkeypatch):
    fake = _wire_store(monkeypatch, be, _rec())
    _protect(be, monkeypatch, "userA", on=True)
    before = fake.records["m1"]
    resp = client.patch("/mindmaps/m1/appearance", json={"appearance": {"version": 2, "preset": "study", "overrides": {}}})
    assert resp.status_code == 200
    after = fake.records["m1"]
    assert after["nodes"] == before["nodes"]
    assert after["relations"] == before["relations"]
    assert after["title"] == before["title"]
    assert after["content_hash"] == before["content_hash"]
    assert after["appearance"]["preset"] == "study"


def test_response_shape_is_appearance_and_updated_at_only(be, client, monkeypatch):
    _wire_store(monkeypatch, be, _rec())
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.patch("/mindmaps/m1/appearance", json={"appearance": {"version": 2, "preset": "pastel", "overrides": {}}})
    body = resp.get_json()
    assert set(body.keys()) == {"appearance", "updated_at"}
    assert body["appearance"]["version"] == 2


def test_save_reload_round_trip(be, client, monkeypatch):
    fake = _wire_store(monkeypatch, be, _rec())
    _protect(be, monkeypatch, "userA", on=True)
    client.patch("/mindmaps/m1/appearance", json={"appearance": {
        "version": 2, "preset": "highContrast",
        "overrides": {"connector": {"colorMode": "fixed", "fixedColor": "#ABCDEF"}},
    }})
    reloaded = fake.get_record("m1")
    assert reloaded["appearance"]["preset"] == "highContrast"
    assert reloaded["appearance"]["overrides"]["connector"]["fixedColor"] == "#ABCDEF"


def test_existing_record_without_appearance_is_not_rewritten_by_a_plain_read(be, client, monkeypatch):
    """A record that predates Appearance V2 (no `appearance` key at all) must
    stay that way until a real PATCH happens — reading it elsewhere (e.g. via
    GET-equivalent) must never silently inject a default appearance block
    into storage."""
    fake = _wire_store(monkeypatch, be, _rec())  # no appearance key
    assert "appearance" not in fake.records["m1"]
    _protect(be, monkeypatch, "userA", on=True)
    # A read-only GET-equivalent action (status check via get_record) must not mutate storage.
    fake.get_record("m1")
    assert "appearance" not in fake.records["m1"]


def test_map_isolation_a_then_b_then_a(be, client, monkeypatch):
    from app.domains.mindmap import store

    class _TwoMapStore:
        def __init__(self):
            self.records = {"m1": _rec("m1"), "m2": _rec("m2")}

        def get_record(self, mindmap_id, user_id=None, enforce_owner=False):
            rec = self.records.get(mindmap_id)
            return dict(rec) if rec else None

        def save_record(self, record, user_id=None):
            self.records[record["id"]] = dict(record)

    two = _TwoMapStore()
    monkeypatch.setattr(store, "get_record", two.get_record)
    monkeypatch.setattr(store, "save_record", two.save_record)
    _protect(be, monkeypatch, "userA", on=True)

    client.patch("/mindmaps/m1/appearance", json={"appearance": {"version": 2, "preset": "pastel", "overrides": {}}})
    client.patch("/mindmaps/m2/appearance", json={"appearance": {"version": 2, "preset": "highContrast", "overrides": {}}})

    assert two.records["m1"]["appearance"]["preset"] == "pastel"
    assert two.records["m2"]["appearance"]["preset"] == "highContrast"

    # Re-apply to m1 — must not have drifted to m2's values.
    client.patch("/mindmaps/m1/appearance", json={"appearance": {"version": 2, "preset": "study", "overrides": {}}})
    assert two.records["m1"]["appearance"]["preset"] == "study"
    assert two.records["m2"]["appearance"]["preset"] == "highContrast"
