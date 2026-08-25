"""Chiếu toạ độ chunk sang canonical bằng span của bộ cắt.

Vì sao cần: biểu diễn structure/late cắt trên bản Markdown do `pymupdf4llm` sinh,
mà bản đó VIẾT LẠI cấu trúc (thẻ `<mark>`, đánh số thành `**1.**`, heading `####`).
`locate_chunks` tìm chuỗi con chính xác nên chỉ định vị được **1/142** chunk — đo
trên corpus_v1 — và bóc dấu nhấn mạnh chỉ nâng lên 6/142. Bộ cắt vốn đã biết
`doc_text[start:end] == text`, nên chỉ cần căn hai văn bản một lần rồi quy đổi.
"""

from __future__ import annotations

import pytest

from evaluation.evidence import locate_chunks, locate_chunks_by_spans, project_offsets


# ── project_offsets ─────────────────────────────────────────────────────────

def test_hai_van_ban_giong_het_thi_anh_xa_dong_nhat():
    t = "abcdef"
    assert project_offsets(t, t) == [0, 1, 2, 3, 4, 5, 6]


def test_dai_hon_do_dai_nguon_mot_phan_tu():
    """`map[end]` của span cuối phải tra được."""
    assert len(project_offsets("abc", "abc")) == 4


def test_nguon_co_ky_tu_thua_van_anh_xa_duoc():
    # Markdown thêm dấu: '**abc**' so với 'abc'
    m = project_offsets("**abc**", "abc")
    assert m[2] == 0          # 'a' trong nguồn -> 'a' trong đích
    assert m[5] == 3          # sau 'abc'
    assert m[len("**abc**")] == 3


def test_anh_xa_don_dieu_khong_giam():
    nguon = "## Tiêu đề\n**một** hai _ba_ bốn"
    dich = "Tiêu đề\nmột hai ba bốn"
    m = project_offsets(nguon, dich)
    assert all(m[i] <= m[i + 1] for i in range(len(m) - 1)), "anh xa phai khong giam"
    assert 0 <= min(m) and max(m) <= len(dich)


def test_van_ban_rong():
    assert project_offsets("", "") == [0]
    assert project_offsets("", "abc") == [3]


# ── locate_chunks_by_spans ──────────────────────────────────────────────────

DOC_MD = "## Phần một\n**Đạo hàm** là giới hạn.\n## Phần hai\nQuy tắc _chuỗi_ dùng cho hàm hợp."
CANON = "Phần một\nĐạo hàm là giới hạn.\nPhần hai\nQuy tắc chuỗi dùng cho hàm hợp."


def test_chiếu_được_span_ma_tim_chuoi_con_that_bai():
    """Cùng dữ liệu: tìm chuỗi con hỏng, chiếu span thì được."""
    chunk1 = DOC_MD[0:37]
    chunk2 = DOC_MD[37:]
    spans = [(0, 37), (37, len(DOC_MD))]

    cu = locate_chunks(CANON, [chunk1, chunk2])
    assert all(x["canonical_alignment"] == "unresolved" for x in cu), \
        "tim chuoi con dang le phai hong voi text Markdown"

    moi = locate_chunks_by_spans(CANON, DOC_MD, spans)
    assert [x["canonical_alignment"] for x in moi] == ["span_projection"] * 2
    for x in moi:
        assert 0 <= x["canonical_char_start"] < x["canonical_char_end"] <= len(CANON)


def test_cac_span_khong_chong_lan_va_dung_thu_tu():
    spans = [(0, 37), (37, len(DOC_MD))]
    out = locate_chunks_by_spans(CANON, DOC_MD, spans)
    assert out[0]["canonical_char_end"] <= out[1]["canonical_char_start"] + 1


def test_span_khong_hop_le_tra_unresolved():
    xau = [(-1, 5), (10, 10), (5, 3), (0, 10_000)]
    out = locate_chunks_by_spans(CANON, DOC_MD, xau)
    assert [x["canonical_alignment"] for x in out] == ["unresolved"] * 4
    assert all(x["canonical_char_start"] is None for x in out)


@pytest.mark.parametrize("canon,doc,spans", [
    ("", "abc", [(0, 3)]),
    ("abc", "", [(0, 3)]),
    ("abc", "abc", []),
])
def test_dau_vao_rong_khong_no(canon, doc, spans):
    out = locate_chunks_by_spans(canon, doc, spans)
    assert len(out) == len(spans)
    assert all(x["canonical_alignment"] == "unresolved" for x in out)


def test_giu_dung_hinh_dang_ban_ghi_nhu_locate_chunks():
    """Builder dùng chung một chỗ ghi — hai hàm phải trả cùng bộ khoá."""
    a = locate_chunks(CANON, ["Phần một"])[0]
    b = locate_chunks_by_spans(CANON, DOC_MD, [(0, 37)])[0]
    assert set(a) == set(b)
