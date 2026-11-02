def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    data = r.get_json()
    assert isinstance(data, dict)
    assert data.get("status") == "ok"


def test_health_reports_build_revision(client, monkeypatch):
    sha = "2479a32a1c020c31be83fd2eacbaee7836b19fde"
    monkeypatch.delenv("RENDER_GIT_COMMIT", raising=False)
    monkeypatch.setenv("APP_BUILD_SHA", sha.upper())
    assert client.get("/health").get_json()["revision"] == sha

    monkeypatch.delenv("APP_BUILD_SHA")
    monkeypatch.setenv("RENDER_GIT_COMMIT", sha)
    assert client.get("/health").get_json()["revision"] == sha


def test_health_revision_never_echoes_non_sha_values(client, monkeypatch):
    monkeypatch.delenv("RENDER_GIT_COMMIT", raising=False)
    for bad in ("", "unknown", "/opt/memvid/app", "abc", "postgresql://user:pw@host/db", "g" * 40):
        monkeypatch.setenv("APP_BUILD_SHA", bad)
        assert client.get("/health").get_json()["revision"] == "unknown"


def test_stats(client):
    r = client.get("/stats")
    assert r.status_code == 200
    data = r.get_json()
    assert isinstance(data, dict)

