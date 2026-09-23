"""Guard-rail tests for the one-time Summary incident remediation script.
Does not exercise `generate` (needs a real LLM) -- only the refusal
conditions that keep it from ever touching anything outside the frozen
target set or acting without a validated replacement on file.
"""
import json

import pytest

import scripts.remediate_summary_incident_2026_09 as rem


def test_backup_refuses_id_outside_target_set(capsys):
    with pytest.raises(SystemExit) as exc:
        rem.cmd_backup("not-a-target-id")
    assert exc.value.code == 1
    assert "REFUSED" in capsys.readouterr().out


def test_generate_refuses_without_prior_backup(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(rem, "AUDIT_FILE", tmp_path / "audit.json")
    with pytest.raises(SystemExit) as exc:
        rem.cmd_generate("e7af7ee3-9d34-4d97-88e6-7ac26066a283")
    assert exc.value.code == 1
    assert "run backup first" in capsys.readouterr().out


def test_delete_refuses_without_passing_validation(monkeypatch, tmp_path, capsys):
    audit_file = tmp_path / "audit.json"
    audit_file.write_text(json.dumps({
        "e7af7ee3-9d34-4d97-88e6-7ac26066a283": {"validation_passed": False},
    }), encoding="utf-8")
    monkeypatch.setattr(rem, "AUDIT_FILE", audit_file)
    with pytest.raises(SystemExit) as exc:
        rem.cmd_delete("e7af7ee3-9d34-4d97-88e6-7ac26066a283")
    assert exc.value.code == 1
    assert "REFUSED" in capsys.readouterr().out


def test_all_sections_empty_signature():
    assert rem._all_sections_empty({"sections": [{"summary": ""}, {"summary": "  "}]})
    assert not rem._all_sections_empty({"sections": [{"summary": "real text"}]})
    assert not rem._all_sections_empty({"sections": []})


def test_sha_is_stable_regardless_of_key_order():
    a = rem._sha({"x": 1, "y": 2})
    b = rem._sha({"y": 2, "x": 1})
    assert a == b
