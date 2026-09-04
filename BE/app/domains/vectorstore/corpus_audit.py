"""Đếm ngữ liệu thật và ước lượng khối lượng embedding TRƯỚC khi dựng lại index.

Vì sao cần: dựng lại là thao tác một chiều về mặt chi phí — chạy xong mới biết tốn
bao nhiêu thì đã tốn rồi. Module này trả lời "bao nhiêu chunk, bao nhiêu token, bao
nhiêu lượt gọi" mà KHÔNG gọi API embedding lần nào.

Nó dùng LẠI đúng luật lọc của `rebuild.doc_chunks_tu_db` (tài liệu `status != deleted`,
mọi chunk của chúng). Viết một luật lọc thứ hai ở đây là cách để con số kiểm kê và con
số thực tế lệch nhau mà không ai đối chiếu.

Ước lượng token là ƯỚC LƯỢNG, và được gắn nhãn như vậy: `Vietnamese_Embedding` không
công bố tokenizer, nên không có cách tính chính xác từ phía client. Hai đường được
tính song song để thấy khoảng dao động thay vì một con số giả vờ chắc chắn.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional, Sequence

# Đo thật 2026-09-04 từ `GET /v1/models`: `Vietnamese_Embedding` có
# `context_length: 8000`. Đây là trần cho MỘT đầu vào, không phải cho cả lô.
CTX_TOI_DA = 8000

# Tỉ lệ ký tự trên một token. Tiếng Việt có dấu tốn token hơn tiếng Anh vì phần lớn
# tokenizer BPE tách dấu ra; 2.5–4.0 là khoảng thường gặp cho văn bản tiếng Việt.
# Dùng CẢ HAI đầu để ra khoảng, không ra một con số giả vờ chính xác.
KY_TU_MOI_TOKEN_THAP = 2.5      # ước lượng BI QUAN (nhiều token hơn)
KY_TU_MOI_TOKEN_CAO = 4.0       # ước lượng LẠC QUAN (ít token hơn)


def thong_ke_ngu_lieu(
    *,
    ban_ghi: Optional[List[Dict[str, Any]]] = None,
    liet_ke_tai_lieu: Optional[Callable[[], Dict[str, Dict[str, Any]]]] = None,
    liet_ke_chunk: Optional[Callable[..., List[Dict[str, Any]]]] = None,
) -> Dict[str, Any]:
    """Đếm chunk ĐỦ ĐIỀU KIỆN embedding, theo đúng luật của rebuild.

    `ban_ghi` cho phép truyền sẵn kết quả `doc_chunks_tu_db` để không đọc DB hai lần.
    """
    from app.domains.vectorstore.rebuild import doc_chunks_tu_db

    if ban_ghi is None:
        ban_ghi = doc_chunks_tu_db(liet_ke_tai_lieu=liet_ke_tai_lieu,
                                   liet_ke_chunk=liet_ke_chunk)

    theo_doc: Dict[str, int] = {}
    do_dai: List[int] = []
    for b in ban_ghi:
        theo_doc[b["document_id"]] = theo_doc.get(b["document_id"], 0) + 1
        do_dai.append(len(b["text"]))

    tong_ky_tu = sum(do_dai)
    so_chunk = len(ban_ghi)
    dem = sorted(theo_doc.values())
    return {
        "chunks": so_chunk,
        "documents": len(theo_doc),
        "tong_ky_tu": tong_ky_tu,
        "ky_tu_trung_binh": round(tong_ky_tu / so_chunk, 1) if so_chunk else 0,
        "ky_tu_ngan_nhat": min(do_dai) if do_dai else 0,
        "ky_tu_dai_nhat": max(do_dai) if do_dai else 0,
        "chunk_moi_doc_trung_binh": round(so_chunk / len(theo_doc), 2) if theo_doc else 0,
        "chunk_moi_doc_it_nhat": dem[0] if dem else 0,
        "chunk_moi_doc_nhieu_nhat": dem[-1] if dem else 0,
        # Chunk dài hơn trần ngữ cảnh sẽ bị model tự cắt — vector chỉ phản ánh phần
        # đầu. Không phải lỗi, nhưng phải biết là có bao nhiêu cái như thế.
        "chunk_vuot_ctx_uoc_luong": sum(
            1 for d in do_dai if d / KY_TU_MOI_TOKEN_THAP > CTX_TOI_DA),
    }


def uoc_luong_token(tong_ky_tu: int) -> Dict[str, int]:
    """Khoảng token, KHÔNG phải con số chính xác.

    `Vietnamese_Embedding` không công bố tokenizer, nên phía client không tính đúng
    được. Trả về khoảng để người đọc thấy độ bất định thay vì tin một con số.
    """
    if tong_ky_tu <= 0:
        return {"thap": 0, "cao": 0}
    return {
        "thap": math.ceil(tong_ky_tu / KY_TU_MOI_TOKEN_CAO),
        "cao": math.ceil(tong_ky_tu / KY_TU_MOI_TOKEN_THAP),
    }


def ke_hoach_request(so_chunk: int, batch_size: int) -> Dict[str, int]:
    """Số lượt gọi API cho một kích thước lô."""
    if so_chunk < 0:
        raise ValueError("số chunk không thể âm")
    b = int(batch_size)
    if b <= 0:
        raise ValueError("batch_size phải > 0")
    so_lo = math.ceil(so_chunk / b) if so_chunk else 0
    return {
        "batch_size": b,
        "so_request": so_lo,
        "lo_cuoi": (so_chunk % b) or (b if so_chunk else 0),
    }


def uoc_luong_thoi_gian(so_request: int, giay_moi_request: float,
                        *, ti_le_thu_lai: float = 0.0) -> Dict[str, float]:
    """PHÓNG CHIẾU, không phải đo.

    `giay_moi_request` nên lấy từ một lượt smoke thật, và một lượt smoke KHÔNG đủ để
    nói về phân phối — độ trễ API thay đổi theo tải, theo giờ, theo kích thước lô.
    Con số ở đây để quyết định "có nên chạy không", không phải để hứa hẹn.
    """
    if so_request < 0 or giay_moi_request < 0 or ti_le_thu_lai < 0:
        raise ValueError("tham số không được âm")
    co_ban = so_request * giay_moi_request
    return {
        "giay_khong_thu_lai": round(co_ban, 1),
        "giay_co_thu_lai": round(co_ban * (1.0 + ti_le_thu_lai), 1),
        "phut_co_thu_lai": round(co_ban * (1.0 + ti_le_thu_lai) / 60.0, 1),
    }


def gia_tu_marketplace(model: Optional[str] = None, *, timeout: float = 30.0,
                       ) -> Optional[float]:
    """Đơn giá / 1 triệu token PROMPT, đọc từ `GET /v1/models` của chính FPT.

    Đây là nguồn CHÍNH THỨC và là nguồn duy nhất dùng được: trang marketplace công
    khai không hiện giá (đã kiểm 2026-09-04), còn API thì trả trường `pricing` cho
    từng model. Không có nó thì trả None và phần chi phí ghi "chưa xác minh" — bịa
    một con số trông giống hệt một con số thật.

    CẢNH BÁO: API trả giá theo TOKEN nhưng KHÔNG nói đơn vị tiền tệ. Con số nhân ra
    là "đơn vị tiền của FPT", không phải chắc chắn USD.
    """
    import requests

    from app.clients.llm_factory import fpt_api_key, fpt_base_url, fpt_embedding_model, fpt_headers

    if not fpt_api_key():
        return None
    ten = model or fpt_embedding_model()
    if not ten:
        return None
    try:
        r = requests.get(fpt_base_url() + "/models", headers=fpt_headers(), timeout=timeout)
        if r.status_code >= 400:
            return None
        for m in (r.json().get("data") or []):
            if isinstance(m, dict) and m.get("id") == ten:
                gia = (m.get("pricing") or {}).get("prompt")
                return float(gia) * 1_000_000 if gia is not None else None
    except Exception:
        return None
    return None


def uoc_luong_chi_phi(so_token: int, gia_moi_trieu_token: Optional[float]) -> Dict[str, Any]:
    """Chi phí, hoặc lời thú nhận là chưa biết giá.

    KHÔNG bịa giá. Chưa xác minh được biểu giá chính thức thì trả về
    `pricing_verified=False` và để phần tiền trống — một con số bịa ra trông giống hệt
    một con số thật, và người đọc không có cách nào phân biệt.
    """
    if gia_moi_trieu_token is None:
        return {"pricing_verified": False, "chi_phi": None,
                "ghi_chu": "chưa xác minh được biểu giá chính thức của FPT AI Marketplace"}
    if gia_moi_trieu_token < 0 or so_token < 0:
        raise ValueError("giá và số token không được âm")
    return {"pricing_verified": True,
            "chi_phi": round(so_token / 1_000_000 * gia_moi_trieu_token, 4)}


def bao_cao(ban_ghi: Optional[List[Dict[str, Any]]] = None,
            *, batch_sizes: Sequence[int] = (16, 32, 64, 128),
            gia_moi_trieu_token: Optional[float] = None,
            giay_moi_request: Optional[float] = None,
            **kw: Any) -> Dict[str, Any]:
    """Gộp mọi con số vào một dict để in ra hoặc so sánh trong test."""
    tk = thong_ke_ngu_lieu(ban_ghi=ban_ghi, **kw)
    token = uoc_luong_token(tk["tong_ky_tu"])
    ke_hoach = [ke_hoach_request(tk["chunks"], b) for b in batch_sizes]
    ra: Dict[str, Any] = {"ngu_lieu": tk, "token_uoc_luong": token,
                          "ke_hoach_request": ke_hoach,
                          "chi_phi_thap": uoc_luong_chi_phi(token["thap"], gia_moi_trieu_token),
                          "chi_phi_cao": uoc_luong_chi_phi(token["cao"], gia_moi_trieu_token)}
    if giay_moi_request is not None:
        ra["thoi_gian"] = {
            k["batch_size"]: uoc_luong_thoi_gian(k["so_request"], giay_moi_request,
                                                 ti_le_thu_lai=0.1)
            for k in ke_hoach}
    return ra
