"""Ba danh sách provider trong kho phải nói CÙNG một điều.

Kho này từng có ba nơi tự trả lời câu hỏi "provider nào":

    llm_factory.PROVIDERS              <- đường production thật (ask_ai, get_llm)
    shared.config._compute_providers   <- chỉ ProviderPool đọc
    local_providers.ProviderPool.ask   <- chỉ services/llm_gateway đọc

Khi thêm FPT, chỉ cái ĐẦU được cập nhật. Hai cái sau vẫn chỉ biết ollama/gemini/groq.
Cả hai là mã chết ở production (`LLM_GATEWAY_ADDR` rỗng, gateway chưa deploy) nên
không có gì hỏng — hôm nay. Nhưng đó đúng là hình dạng của bug đã xảy ra thật một lần
rồi: `get_llm()` hardcode Ollama trong khi `ask_ai` đi qua `PROVIDERS`, và hậu quả là
quiz chạy được ở production còn `/query` thì không, suốt nhiều tuần, không một dòng
log nào.

Nên file này không kiểm "FPT có hoạt động không" — ba file test khác làm việc đó. Nó
kiểm rằng ba danh sách KHÔNG LỆCH NHAU nữa, và sẽ đỏ ngay khi ai đó thêm provider thứ
năm vào một chỗ rồi quên hai chỗ kia.
"""

from __future__ import annotations

import ast
import importlib
import pathlib

import pytest

GOC = pathlib.Path(__file__).resolve().parents[1]
KHOA_GIA = "sk-khoa-gia-chi-dung-trong-test"


def _nap_lai(monkeypatch, **env):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    import shared.config as cfg
    import app.clients.llm_factory as lf
    cfg.reload()
    return importlib.reload(lf), cfg


@pytest.fixture()
def sach(monkeypatch):
    for k in ("FPT_AI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "OLLAMA_HOST"):
        monkeypatch.setenv(k, "")
    yield
    import shared.config as cfg
    import app.clients.llm_factory as lf
    cfg.reload()
    importlib.reload(lf)


@pytest.mark.parametrize("env", [
    {},
    {"FPT_AI_API_KEY": KHOA_GIA},
    {"OLLAMA_HOST": "http://localhost:11434"},
    {"FPT_AI_API_KEY": KHOA_GIA, "OLLAMA_HOST": "http://localhost:11434"},
    {"FPT_AI_API_KEY": KHOA_GIA, "GEMINI_API_KEY": "g", "GROQ_API_KEY": "q"},
    {"GEMINI_API_KEY": "g"},
])
def test_hai_danh_sach_provider_khop_TUNG_CHU(sach, monkeypatch, env):
    """Không chỉ 'cùng tập hợp' — cùng THỨ TỰ. Thứ tự là thứ tự fallback: đảo nó là
    đổi provider nào được gọi trước, tức đổi cả chi phí lẫn chất lượng."""
    lf, cfg = _nap_lai(monkeypatch, **env)
    assert lf.PROVIDERS == cfg.get_settings().providers, (
        f"env={env}: llm_factory={lf.PROVIDERS} != shared.config={cfg.get_settings().providers}")


def test_ProviderPool_xu_ly_MOI_provider_trong_danh_sach(sach, monkeypatch):
    """`ProviderPool.ask` có `else: continue` — provider lạ bị bỏ qua IM LẶNG rồi báo
    'All AI providers failed'. Thiếu một nhánh ở đây trông y hệt như provider chết."""
    lf, _ = _nap_lai(monkeypatch, FPT_AI_API_KEY=KHOA_GIA,
                     OLLAMA_HOST="http://localhost:11434",
                     GEMINI_API_KEY="g", GROQ_API_KEY="q")
    src = (GOC / "app" / "clients" / "local_providers.py").read_text(encoding="utf-8")
    than = src.split("def ask(", 1)[1]
    thieu = [p for p in lf.PROVIDERS if f'provider == "{p}"' not in than]
    assert not thieu, f"ProviderPool.ask không có nhánh cho: {thieu}"


def test_thong_bao_thieu_provider_nhac_du_bon_bien(sach):
    """Người đọc thông báo lỗi phải biết đặt biến nào. Thiếu tên biến trong đó nghĩa
    là họ đi tìm trong mã."""
    src = (GOC / "app" / "clients" / "local_providers.py").read_text(encoding="utf-8")
    i = src.find("No AI provider configured")
    assert i > 0
    doan = src[i:i + 300]
    for bien in ("OLLAMA_HOST", "FPT_AI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY"):
        assert bien in doan, f"thông báo thiếu {bien}"


def test_khong_con_nguon_su_that_thu_tu_cho_thu_tu_provider(sach):
    """Đếm số nơi tự dựng danh sách provider. Ba là con số hiện tại và đã có test
    ràng chúng với nhau; cái thứ tư xuất hiện thì không ai ràng nó nữa."""
    dem = []
    for f in list((GOC / "app").rglob("*.py")) + list((GOC / "shared").rglob("*.py")):
        if "__pycache__" in str(f):
            continue
        src = f.read_text(encoding="utf-8", errors="ignore")
        try:
            cay = ast.parse(src)
        except SyntaxError:
            continue
        for n in ast.walk(cay):
            # `x.append("ollama")` — dấu hiệu của một danh sách provider tự dựng.
            if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                    and n.func.attr == "append" and len(n.args) == 1
                    and isinstance(n.args[0], ast.Constant) and n.args[0].value == "ollama"):
                # `as_posix()` chứ không phải `str()`: trên Windows `str()` cho dấu `\`
                # và so sánh với hằng viết bằng `/` sẽ đỏ trên một máy, xanh trên máy kia.
                dem.append(f.relative_to(GOC).as_posix())
    assert sorted(set(dem)) == ["app/clients/llm_factory.py", "shared/config.py"], (
        f"danh sách provider tự dựng ở: {sorted(set(dem))}")
