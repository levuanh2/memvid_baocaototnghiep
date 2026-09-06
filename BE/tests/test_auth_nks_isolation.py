"""Khoá RANH GIỚI của adapter NKS — bằng chứng "gỡ ra được", không phải lời hứa.

Bốn khẳng định cấu trúc, đọc bằng AST/grep trên chính mã nguồn:
  1. `main.py` không import gì thuộc NKS.
  2. `application/auth.py` không import HTTP client cụ thể.
  3. Chuỗi "nks.vn" chỉ nằm trong `clients/auth_nks/` và trong test.
  4. Xoá gói adapter thì local auth vẫn import và chạy được.

Khẳng định cấu trúc chứ không phải hành vi là CỐ Ý: hành vi "không gọi mạng" có thể
đúng hôm nay rồi mai ai đó thêm một `import requests` vào lõi mà mọi test vẫn xanh.
"""

from __future__ import annotations

import ast
import pathlib

BE = pathlib.Path(__file__).resolve().parents[1]


def _imports(path: pathlib.Path) -> set[str]:
    cay = ast.parse(path.read_text(encoding="utf-8"))
    ten: set[str] = set()
    for node in ast.walk(cay):
        if isinstance(node, ast.Import):
            ten.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            ten.add(node.module)
    return ten


def test_main_khong_import_nks():
    """Route không được biết NKS tồn tại."""
    xau = [m for m in _imports(BE / "app" / "main.py") if "auth_nks" in m or "nks" in m.lower()]
    assert xau == [], f"main.py import NKS: {xau}"


def test_application_auth_khong_import_http_client():
    """Lõi không được tự gọi mạng — đó là việc của adapter."""
    mods = _imports(BE / "app" / "application" / "auth.py")
    assert "requests" not in mods
    assert not any(m.startswith("http") or m in ("httpx", "urllib", "urllib3") for m in mods)


def test_application_auth_khong_import_nks_o_cap_module():
    """`clients.auth_nks` chỉ được nạp LƯỜI trong hàm, để xoá gói đi vẫn import được."""
    cay = ast.parse((BE / "app" / "application" / "auth.py").read_text(encoding="utf-8"))
    cap_module = set()
    for node in cay.body:                      # chỉ duyệt tầng ngoài cùng
        if isinstance(node, ast.Import):
            cap_module.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            cap_module.add(node.module)
    assert not any("auth_nks" in m for m in cap_module), cap_module


def test_url_nks_chi_nam_trong_adapter():
    """Grep toàn bộ `app/` + `shared/`: 'nks.vn' chỉ được phép ở config của adapter."""
    cho_phep = {BE / "app" / "clients" / "auth_nks" / "config.py"}
    pham = []
    for goc in ("app", "shared"):
        for f in (BE / goc).rglob("*.py"):
            if f in cho_phep:
                continue
            if "nks.vn" in f.read_text(encoding="utf-8"):
                pham.append(str(f.relative_to(BE)))
    assert pham == [], f"URL NKS rò ra ngoài adapter: {pham}"


def test_ten_truong_nks_khong_ro_vao_loi():
    """`access_token`/`fbtoken` là từ vựng của NKS — lõi không được nhắc tới."""
    for rel in ("app/main.py", "app/application/auth.py", "shared/interfaces/auth.py",
                "app/clients/auth_local.py"):
        noi_dung = (BE / rel).read_text(encoding="utf-8")
        assert "access_token" not in noi_dung, rel
        assert "fbtoken" not in noi_dung, rel


def test_go_adapter_thi_local_auth_van_song(monkeypatch):
    """Mô phỏng việc XOÁ `clients/auth_nks/`: import gói đó ném ImportError.

    Local login phải không hề hấn, và chọn 'nks' chỉ ra 'chưa bật' — không phải sập.
    """
    import builtins

    from app.application import auth as app_auth

    that = builtins.__import__

    def chan(name, *a, **kw):
        if "auth_nks" in name:
            raise ImportError("mô phỏng đã xoá gói adapter")
        return that(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", chan)

    # Local: vẫn xác thực bình thường qua provider được inject.
    from shared.interfaces.auth import InternalIdentity

    class LocalGia:
        name = "local"

        def authenticate(self, credentials):
            return InternalIdentity(provider="local", provider_user_id="u1",
                                    email="a@b.c", display_name="A", role="learner")

    ident = app_auth.xac_thuc("a@b.c", "pw", "local",
                              deps={"local_provider": LocalGia()})
    assert ident.provider_user_id == "u1"

    # NKS: adapter không còn ⇒ "chưa bật", không phải crash.
    try:
        app_auth.xac_thuc("a@b.c", "pw", "nks")
    except app_auth.ProviderNotEnabled:
        pass
    else:
        raise AssertionError("phải là ProviderNotEnabled khi adapter biến mất")


def test_khong_co_credential_that_trong_ma_nguon():
    """Không hard-code username/password/token NKS ở bất kỳ đâu trong app/shared."""
    xau = []
    for goc in ("app", "shared"):
        for f in (BE / goc).rglob("*.py"):
            t = f.read_text(encoding="utf-8")
            for dau in ("NKS_TEST_PASSWORD=", "password=\"", "password='"):
                if dau in t and "auth_nks" in str(f):
                    xau.append(f"{f.relative_to(BE)}:{dau}")
    assert xau == [], xau
