"""Audit vòng 8 BE#4 — nhãn nguồn dán vào chunk làm CRAG không bao giờ kích.

`INCLUDE_CHUNK_SOURCE_TAGS=1` (đang bật ở `.env`) khiến RetrieveFAISS dán
`[Nguồn: <stem>, đoạn <id>]` vào TRƯỚC mọi chunk. `state["retrieved_chunks"]` sau đó đi
thẳng vào `grade_documents`, và `_relevance` tokenize cả cái nhãn ấy.

"nguồn" và "đoạn" là hai từ cực phổ biến trong câu hỏi tiếng Việt. Chunk hoàn toàn lạc
đề vẫn ăn điểm chỉ vì nó mang cái nhãn do CHÍNH HỆ THỐNG dán vào — nên grade ra
"correct" và nhánh sửa sai (RewriteQuery / CRAGFallback) không bao giờ chạy.
"""

from app.domains.retrieval import citation, grading

NGUONG = 0.25   # CRAG_RELEVANCE_THRESHOLD mặc định


def test_nhan_nguon_dung_cho_prompt_va_go_duoc_khi_cham_diem():
    nhan = citation.nhan_nguon("bai_giang_toan", 17)
    assert "Nguồn" in nhan and "bai_giang_toan" in nhan and "17" in nhan
    assert citation.bo_nhan_nguon(f"{nhan}\nNội dung thật.") == "Nội dung thật."


def test_khong_co_nhan_thi_giu_nguyen():
    assert citation.bo_nhan_nguon("Nội dung thật.") == "Nội dung thật."
    assert citation.bo_nhan_nguon("") == ""
    assert citation.bo_nhan_nguon(None) == ""


def test_chi_go_nhan_o_DAU_chunk():
    """Nhãn nằm giữa thân bài là nội dung tài liệu, không phải thứ ta dán vào."""
    txt = f"Mở bài.\n{citation.nhan_nguon('x', 1)}\nThân bài."
    assert citation.bo_nhan_nguon(txt) == txt


def test_chunk_lac_de_khong_con_an_diem_nho_nhan_nguon():
    cau_hoi = "đoạn nào trong nguồn nói về tích phân"
    lac_de = "Công ty ABC thành lập năm 1998 tại Hải Phòng, chuyên vận tải biển."

    assert grading.grade_documents(cau_hoi, [lac_de],
                                   relevance_threshold=NGUONG) == "wrong"

    co_nhan = f"{citation.nhan_nguon('bao_cao_cong_ty', 3)}\n{lac_de}"
    assert grading.grade_documents(cau_hoi, [co_nhan],
                                   relevance_threshold=NGUONG) == "wrong", \
        "nhãn do hệ thống dán vào không được tính là bằng chứng liên quan"


def test_chunk_that_su_lien_quan_van_duoc_cham_correct():
    cau_hoi = "tích phân từng phần là gì"
    hop_de = f"{citation.nhan_nguon('giai_tich', 9)}\nTích phân từng phần dùng công thức udv."
    assert grading.grade_documents(cau_hoi, [hop_de],
                                   relevance_threshold=NGUONG) == "correct"


def test_go_nhan_khong_lam_mat_diem_cua_rerank():
    """rerank_scores là tín hiệu độc lập, gỡ nhãn không được đụng vào nó."""
    lac_de = f"{citation.nhan_nguon('x', 1)}\nHoàn toàn không liên quan."
    assert grading.grade_documents("tích phân", [lac_de], relevance_threshold=NGUONG,
                                   rerank_scores=[0.9]) == "correct"
