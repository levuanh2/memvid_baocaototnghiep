def test_usage_routes_require_authenticated_owner(client, monkeypatch):
    assert client.get("/usage/me").status_code == 401
    import app.main as main
    monkeypatch.setattr(main, "_current_user_id", lambda: "usage-user")
    response = client.get("/usage/me")
    assert response.status_code == 200
    body = response.get_json()
    assert body["plan"] == "free"
    assert {"used", "reserved", "limit", "remaining", "percentage", "reset_at"}.issubset(body)
    assert client.get("/usage/me/events").status_code == 200
    assert client.get("/usage/me/breakdown").status_code == 200
    assert client.get("/billing/capability").status_code == 200
