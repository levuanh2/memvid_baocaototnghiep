import io
import time

import os

import pytest


@pytest.fixture(scope="module", autouse=True)
def _need_db():
    """Mọi test trong file này upload tài liệu, tức GHI vào Postgres. Không có
    database test riêng thì skip — xem .playbook/known-issues.md."""
    if not (os.getenv("TEST_DATABASE_URL") or "").strip():
        pytest.skip("cần TEST_DATABASE_URL — xem `python -m scripts.setup_test_db --help`")


def test_upload_and_poll_status(client):
    data = {"file": (io.BytesIO(b"hello world"), "hello.txt")}
    r = client.post("/upload", data=data, content_type="multipart/form-data")
    assert r.status_code == 200
    payload = r.get_json()
    assert payload and payload.get("source_id")

    source_id = payload["source_id"]

    # Poll status: do conftest đã patch ingest nhanh nên phải ready gần như ngay
    for _ in range(20):
        s = client.get(f"/sources/{source_id}/status")
        assert s.status_code == 200
        st = s.get_json()
        if st.get("can_query") or st.get("status") in ("index_ready", "ready"):
            break
        time.sleep(0.05)

    assert st.get("status") in ("index_ready", "ready", "processing")

