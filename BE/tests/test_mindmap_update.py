import json

from app.domains.mindmap import store


def _rec(i="m1"):
    return {
        "id": i,
        "schema_version": 2,
        "title": "Gốc",
        "sources": ["a_docx"],
        "content_hash": "h" * 64,
        "created_at": "2026-07-04T00:00:00Z",
        "nodes": [
            {"id": "n0", "parent": None, "kind": "root", "title": "Gốc", "note": "", "chunk_refs": [], "order": 0},
            {"id": "n1", "parent": "n0", "kind": "section", "title": "A", "note": "x", "chunk_refs": ["1"], "order": 0},
        ],
        "relations": [],
        "generator": {"pipeline": "skeleton_v1", "degraded": False, "missing": []},
    }


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
    monkeypatch.setenv("MINDMAPS_DB_PATH", str(tmp_path / "mm.sqlite"))
    from app import main as be_main

    return be_main.app.test_client()


def test_get_record_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("MINDMAPS_DB_PATH", str(tmp_path / "mm.sqlite"))
    store.save_record(_rec())
    assert store.get_record("m1")["title"] == "Gốc"
    assert store.get_record("khong_co") is None


def test_put_updates_and_protects_fields(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    store.save_record(_rec())
    body = _rec()
    body["id"] = "HACK"
    body["content_hash"] = "x" * 64
    body["sources"] = ["khac"]
    body["title"] = "Đã sửa"
    body["nodes"].append({"id": "n2", "parent": "n1", "kind": "idea", "title": "Ý mới", "note": "", "chunk_refs": [], "order": 0})
    body["relations"] = [
        # n1->n2 is a real tree edge (n2.parent=n1), but "leads_to" is a
        # meaningful type, not a generic hierarchy-restating one — must
        # survive (P2 fix, 2026-09-22; is_redundant_with_hierarchy).
        {"source": "n1", "target": "n2", "type": "leads_to", "label": "dẫn"},
        {"source": "n2", "target": "XX", "type": "relates_to", "label": ""},
    ]
    r = client.put("/mindmaps/m1", data=json.dumps(body), content_type="application/json")
    assert r.status_code == 200
    saved = store.get_record("m1")
    assert saved["title"] == "Đã sửa"
    assert saved["content_hash"] == "h" * 64
    assert saved["sources"] == ["a_docx"]
    assert saved["created_at"] == "2026-07-04T00:00:00Z"
    assert any(n["id"] == "n2" for n in saved["nodes"])
    assert saved["relations"] == [{"source": "n1", "target": "n2", "type": "leads_to", "label": "dẫn"}]
    assert saved["generator"]["edited"] is True
    assert saved["updated_at"].endswith("Z")


def test_put_preserves_appearance_set_by_a_separate_patch(tmp_path, monkeypatch):
    """PR C2: PATCH /mindmaps/<id>/appearance and PUT /mindmaps/<id> (node/
    title save) are two independent concerns on the same record — neither
    may clobber the other. A plain node/title PUT must never touch an
    `appearance` field a prior PATCH already set."""
    client = _client(tmp_path, monkeypatch)
    rec = _rec()
    rec["appearance"] = {"version": 2, "preset": "pastel", "overrides": {}}
    store.save_record(rec)
    body = _rec()
    body["title"] = "Đã sửa, không đụng appearance"
    r = client.put("/mindmaps/m1", data=json.dumps(body), content_type="application/json")
    assert r.status_code == 200
    saved = store.get_record("m1")
    assert saved["title"] == "Đã sửa, không đụng appearance"
    assert saved["appearance"]["preset"] == "pastel"


def test_patch_appearance_preserves_nodes_set_by_a_separate_put(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    store.save_record(_rec())
    body = _rec()
    body["title"] = "Đã sửa trước"
    client.put("/mindmaps/m1", data=json.dumps(body), content_type="application/json")

    r = client.patch("/mindmaps/m1/appearance", data=json.dumps({"appearance": {"version": 2, "preset": "study", "overrides": {}}}), content_type="application/json")
    assert r.status_code == 200
    saved = store.get_record("m1")
    assert saved["title"] == "Đã sửa trước"
    assert saved["appearance"]["preset"] == "study"


def test_put_404_unknown_id(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    r = client.put("/mindmaps/khong_co", data=json.dumps(_rec()), content_type="application/json")
    assert r.status_code == 404


def test_put_400_empty_nodes(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    store.save_record(_rec())
    r = client.put("/mindmaps/m1", data=json.dumps({"nodes": []}), content_type="application/json")
    assert r.status_code == 400
