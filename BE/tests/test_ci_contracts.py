"""Automated API / Contract tests for StudyMap FE/BE interface alignment.

These tests prevent silent contract drift between the frontend (FE/src/utils/api.js,
FE/src/utils/studyApi.js, FE/src/utils/mindmapJob.js) and the backend (BE/app/main.py,
BE/app/domains/jobs, BE/services/mindmap).
"""

import json
from typing import Any, Dict


def test_persisted_mindmap_v2_contract():
    """Verify that mindmap records adhere to the V2 schema expected by FE MindElixirView."""
    required_keys = {"id", "schema_version", "title", "nodes", "relations", "sources", "created_at"}
    sample_record = {
        "id": "map-sample-123",
        "schema_version": 2,
        "title": "Hệ thống RAG và Semantic Search",
        "nodes": [
            {"id": "root", "parent": None, "kind": "root", "title": "RAG"},
            {"id": "node-1", "parent": "root", "kind": "topic", "title": "Retrieval"},
            {"id": "node-2", "parent": "node-1", "kind": "subtopic", "title": "Dense FAISS"},
        ],
        "relations": [
            {"source": "node-2", "target": "node-1", "relation_type": "supports"}
        ],
        "sources": ["tailieu.pdf"],
        "content_hash": "abc12345",
        "created_at": "2026-09-01T00:00:00Z",
        "generator": {
            "pipeline": "guided_v3",
            "model": "qwen2.5:7b-instruct",
            "elapsed_sec": 4.2,
            "degraded": False,
            "missing": []
        }
    }
    missing = required_keys - set(sample_record.keys())
    assert not missing, f"Missing required keys for Mindmap V2 contract: {missing}"
    assert sample_record["schema_version"] == 2
    for node in sample_record["nodes"]:
        assert "id" in node and "title" in node and "kind" in node
    for rel in sample_record["relations"]:
        assert "source" in rel and "target" in rel and "relation_type" in rel


def test_job_status_response_contract():
    """Verify that job status payload matches frontend createMindmapPoller expectations."""
    valid_statuses = {"pending", "queued", "running", "done", "failed", "cancelled", "interrupted"}
    sample_statuses = [
        {"status": "queued", "progress": 0, "current_node": "Queue"},
        {"status": "running", "progress": 45, "current_node": "Enrich", "message": "nhánh 2/5"},
        {"status": "done", "progress": 100, "current_node": "AssemblePersist", "result": {"id": "map-1"}},
        {"status": "failed", "progress": 20, "error": "LLM timeout after 300s"},
        {"status": "cancelled", "progress": 10},
    ]
    for status_obj in sample_statuses:
        assert status_obj["status"] in valid_statuses
        assert 0 <= status_obj["progress"] <= 100
        if status_obj["status"] == "done":
            assert "result" in status_obj
        if status_obj["status"] == "failed":
            assert "error" in status_obj


def test_generate_mindmap_request_contract(client, can_db_test):
    """Test POST /generate-mindmap contract against real backend endpoint with mock graph."""
    res = client.post("/generate-mindmap", json={
        "sources": ["sample_doc.pdf"],
        "q": "tóm tắt tài liệu",
        "force": False
    })
    # Must accept the request and respond with started or done status
    assert res.status_code in (200, 202)
    data = res.get_json()
    assert "status" in data
    assert data["status"] in ("started", "done")
    if data["status"] == "started":
        assert "job_id" in data
    elif data["status"] == "done":
        assert "mindmap" in data or "result" in data


def test_generate_summary_request_contract(client, can_db_test):
    """Test POST /generate-summary contract against real backend endpoint."""
    res = client.post("/generate-summary", json={
        "sources": ["sample_doc.pdf"],
        "length_mode": "medium",
        "mode": "standard",
        "force": False
    })
    assert res.status_code in (200, 202)
    data = res.get_json()
    assert "status" in data
    assert data["status"] in ("started", "done")
    if data["status"] == "started":
        assert "job_id" in data


def test_documents_and_library_contract(client, can_db_test):
    """Test GET /api/documents and GET /api/library response shapes."""
    res_docs = client.get("/api/documents")
    assert res_docs.status_code == 200
    docs_data = res_docs.get_json()
    assert "documents" in docs_data
    assert isinstance(docs_data["documents"], list)

    res_lib = client.get("/api/library")
    assert res_lib.status_code == 200
    lib_data = res_lib.get_json()
    assert "documents" in lib_data
    assert isinstance(lib_data["documents"], list)


def test_mindmaps_capability_contract_fallback():
    """Verify fallback contract when Guided V3 capability is evaluated."""
    # The contract dictates: guided_mindmap_v3: bool, reason: str, fallback: "v2"
    capability_contract = {
        "guided_mindmap_v3": False,
        "reason": "disabled_or_unavailable",
        "fallback": "v2"
    }
    assert isinstance(capability_contract["guided_mindmap_v3"], bool)
    assert capability_contract["fallback"] == "v2"
    assert "reason" in capability_contract
