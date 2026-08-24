"""Ảnh dán vào khung chat: cổng chặn ở route, và phiên âm thật khi máy có model.

Ảnh ở đây là câu hỏi dùng một lần — KHÔNG tạo dòng `documents`, không đánh chỉ
mục. Test khoá đúng ranh giới đó cùng với auth, đuôi file và dung lượng.
"""

from __future__ import annotations

import io
import os

import pytest

from app.domains import vision


@pytest.fixture()
def authed(client, monkeypatch):
    import app.main as main

    monkeypatch.setattr(main, "_auth_protect_enabled", lambda: False)
    monkeypatch.setattr(main, "_current_user_id", lambda: None)
    return client


def _png(width: int = 240, height: int = 120, text: str = "7 + 5 = ?") -> bytes:
    Image = pytest.importorskip("PIL.Image", reason="can Pillow de sinh anh")
    from PIL import ImageDraw

    img = Image.new("RGB", (width, height), "white")
    ImageDraw.Draw(img).text((20, 40), text, fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ── Cổng chặn ───────────────────────────────────────────────────────────────

def test_can_dang_nhap(client, monkeypatch):
    import app.main as main

    monkeypatch.setattr(main, "_auth_protect_enabled", lambda: True)
    monkeypatch.setattr(main, "_current_user_id", lambda: None)
    resp = client.post("/api/vision/transcribe",
                       data={"image": (io.BytesIO(_png()), "a.png")},
                       content_type="multipart/form-data")
    assert resp.status_code == 401


def test_thieu_anh_tra_400(authed):
    resp = authed.post("/api/vision/transcribe", data={},
                       content_type="multipart/form-data")
    assert resp.status_code == 400


def test_khong_phai_anh_tra_415(authed):
    resp = authed.post("/api/vision/transcribe",
                       data={"image": (io.BytesIO(b"chu thuong"), "ghi-chu.txt")},
                       content_type="multipart/form-data")
    assert resp.status_code == 415
    body = resp.get_json()
    assert ".png" in body["supported_extensions"]
    # PDF doc duoc khi UPLOAD, nhung khong phai anh nen khong vao duong nay.
    assert ".pdf" not in body["supported_extensions"]


def test_anh_qua_co_tra_413(authed, monkeypatch):
    import app.main as main

    monkeypatch.setattr(main, "VISION_MAX_IMAGE_MB", 1)
    resp = authed.post("/api/vision/transcribe",
                       data={"image": (io.BytesIO(b"x" * (1024 * 1024 + 50)), "to.png")},
                       content_type="multipart/form-data")
    assert resp.status_code == 413
    assert resp.get_json()["max_image_mb"] == 1


def test_status_bao_model_va_moc(authed):
    body = authed.get("/api/vision/status").get_json()
    assert set(body) == {"available", "model", "max_image_mb"}
    assert isinstance(body["available"], bool)
    assert body["max_image_mb"] >= 1


def test_khong_co_model_thi_503_chu_khong_500(authed, monkeypatch):
    def _no_model(*_a, **_kw):
        raise vision.VisionUnavailable("khong co mo hinh thi giac")

    monkeypatch.setattr(vision, "transcribe_image", _no_model)
    resp = authed.post("/api/vision/transcribe",
                       data={"image": (io.BytesIO(_png()), "a.png")},
                       content_type="multipart/form-data")
    # 503 = thieu cau hinh (may chua pull model), khong phai loi lap trinh.
    assert resp.status_code == 503


def test_khong_tao_tai_lieu(authed, monkeypatch):
    """Ảnh hỏi một lần không được lọt vào kho tài liệu."""
    import app.main as main

    goi = []
    monkeypatch.setattr(main, "_trigger_background_ingest",
                        lambda *a, **kw: goi.append(a))
    monkeypatch.setattr(vision, "transcribe_image",
                        lambda blob, **kw: {"text": "7 + 5 = ?", "model": "gia-lap",
                                            "elapsed_ms": 1})
    resp = authed.post("/api/vision/transcribe",
                       data={"image": (io.BytesIO(_png()), "a.png")},
                       content_type="multipart/form-data")
    assert resp.status_code == 200
    assert resp.get_json()["text"] == "7 + 5 = ?"
    assert goi == [], "anh dan vao chat khong duoc kich hoat ingest"


# ── Lớp phiên âm ────────────────────────────────────────────────────────────

def test_anh_rong_bao_loi():
    with pytest.raises(ValueError):
        vision.transcribe_image(b"")


def test_cache_kha_dung_co_reset(monkeypatch):
    """`is_available` nhớ kết quả; reset phải xoá được, nếu không test sau dính
    kết quả của test trước."""
    goi = {"n": 0}

    def _fake_post(path, payload, timeout):
        goi["n"] += 1
        return {"capabilities": ["completion", "vision"]}

    monkeypatch.setattr(vision.transcribe, "_post", _fake_post)
    vision.reset_availability_cache()
    assert vision.is_available() is True
    assert vision.is_available() is True
    assert goi["n"] == 1, "lan hai phai lay tu cache"

    vision.reset_availability_cache()
    assert vision.is_available() is True
    assert goi["n"] == 2


def test_tat_bang_bien_moi_truong(monkeypatch):
    monkeypatch.setenv("VISION_ENABLED", "0")
    vision.reset_availability_cache()
    assert vision.is_available() is False


@pytest.mark.skipif(not os.getenv("VISION_LIVE"),
                    reason="dat VISION_LIVE=1 de goi mo hinh that (cham ~20s)")
def test_doc_anh_that():
    vision.reset_availability_cache()
    if not vision.is_available():
        pytest.skip("may nay khong co mo hinh thi giac")
    out = vision.transcribe_image(_png(760, 240, "Bai tap 3"))
    assert out["text"].strip()
    assert out["elapsed_ms"] > 0
