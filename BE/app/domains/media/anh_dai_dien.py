"""Chuẩn hoá ảnh đại diện do người dùng tải lên — hàng rào TRƯỚC khi chạm provider.

Đây là bề mặt tấn công duy nhất trong tính năng hồ sơ nhận **byte tuỳ ý từ Internet**,
nên mọi hàng rào nằm hết ở đây và theo đúng thứ tự này:

  1. chặn theo SỐ BYTE, trước khi giải mã bất cứ thứ gì;
  2. đọc header để biết kích thước, KHÔNG dựng ảnh;
  3. chặn theo SỐ ĐIỂM ẢNH (bom giải nén);
  4. mới giải mã, thu nhỏ, và mã hoá lại.

Vì sao thứ tự đó quan trọng: một file PNG 40 KB có thể khai 50000×50000 và biến thành
10 GB RAM ngay khoảnh khắc ai đó gọi `.load()`. Hạn mức byte KHÔNG chặn được ca này —
chỉ hạn mức điểm ảnh, đọc từ header trước khi giải mã, mới chặn được. Máy chủ production
có 512 MB.

Mã hoá lại là hàng rào thứ hai, không phải để cho đẹp: nó vẽ pixel ra rồi ghi lại thành
JPEG mới, nên **mọi thứ không phải pixel đều bị bỏ** — EXIF (có toạ độ GPS), chunk lạ,
và cả payload nhét sau phần dữ liệu ảnh.

KHÔNG log nội dung ảnh, KHÔNG log base64. Ngoại lệ nêu ra chỉ mang con số.
"""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass

#: Trần byte cho dữ liệu tải lên. FE đã thu nhỏ về ~256 KB; đây là trần của MÁY CHỦ,
#: rộng hơn một chút để một ảnh hơi lớn không hỏng vô cớ, nhưng vẫn đủ nhỏ để tám
#: request cùng lúc không dọn sạch RAM của một instance 512 MB.
GIOI_HAN_BYTE = 2 * 1024 * 1024          # 2 MiB

#: Trần TỔNG SỐ ĐIỂM ẢNH — hàng rào chống bom giải nén thật sự. 40 triệu điểm ảnh
#: (~6300×6300) rộng hơn mọi ảnh chụp từ điện thoại, và chặn đứng ca 50000×50000.
GIOI_HAN_DIEM_ANH = 40_000_000

#: Cạnh dài nhất sau khi thu nhỏ.
CANH_TOI_DA = 512

#: Chất lượng JPEG khi ghi lại.
CHAT_LUONG = 85

#: Định dạng chấp nhận, theo thứ Pillow NHẬN RA, không theo phần mở rộng hay
#: `Content-Type` do client khai. Client nói gì không quan trọng.
DINH_DANG_CHO_PHEP = {"JPEG", "PNG", "WEBP", "GIF", "BMP"}


class AnhKhongHopLe(Exception):
    """Dữ liệu tải lên không dùng được. Thông điệp KHÔNG bao giờ chứa nội dung ảnh."""


class AnhQuaLon(AnhKhongHopLe):
    """Vượt trần byte hoặc trần điểm ảnh."""


@dataclass(frozen=True)
class AnhDaChuanHoa:
    data_uri: str
    so_byte: int
    rong: int
    cao: int


def _mo_pillow():
    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - Pillow nằm trong requirements.txt
        raise AnhKhongHopLe("máy chủ chưa có thư viện xử lý ảnh") from exc
    return Image


def chuan_hoa(raw: bytes) -> AnhDaChuanHoa:
    """Byte tuỳ ý → data-URI JPEG an toàn, đã thu nhỏ, đã bỏ metadata.

    Ném `AnhQuaLon` / `AnhKhongHopLe`; không bao giờ trả về dữ liệu chưa qua xử lý.
    """
    if not raw:
        raise AnhKhongHopLe("không có dữ liệu ảnh")

    # ── 1. Trần byte — TRƯỚC mọi thao tác giải mã ─────────────────────────────
    if len(raw) > GIOI_HAN_BYTE:
        raise AnhQuaLon(
            f"ảnh {len(raw) // 1024} KB vượt trần {GIOI_HAN_BYTE // 1024} KB")

    Image = _mo_pillow()

    # Pillow có trần điểm ảnh riêng và mặc định chỉ CẢNH BÁO. Hạ xuống ngưỡng của
    # mình và để nó NÉM, phòng khi một đường nào đó lọt qua hàng rào dưới.
    Image.MAX_IMAGE_PIXELS = GIOI_HAN_DIEM_ANH

    # ── 2. Đọc header, chưa dựng ảnh ──────────────────────────────────────────
    try:
        tham_do = Image.open(io.BytesIO(raw))
        dinh_dang = (tham_do.format or "").upper()
        rong, cao = tham_do.size
    except Image.DecompressionBombError:
        # Pillow tự chặn trước cả hàng rào điểm ảnh bên dưới — tốt, nhưng phải phân
        # loại cho đúng: đây là ảnh QUÁ LỚN (413), không phải ảnh HỎNG (400). Gộp vào
        # "không đọc được" sẽ bảo người dùng sửa file, trong khi thứ họ cần là ảnh nhỏ hơn.
        raise AnhQuaLon(f"ảnh vượt trần {GIOI_HAN_DIEM_ANH} điểm ảnh") from None
    except Exception as exc:  # noqa: BLE001 — mọi lỗi phân tích đều là "ảnh hỏng"
        # CHỈ tên lớp: thông điệp của Pillow có thể trích nội dung file.
        raise AnhKhongHopLe(f"không đọc được ảnh ({type(exc).__name__})") from None

    # ── 3. Loại định dạng, rồi trần điểm ảnh ──────────────────────────────────
    #
    # Đây là chỗ chặn "file không phải ảnh đội lốt ảnh": Pillow nhận dạng bằng nội
    # dung thật, nên một tệp thực thi đổi tên thành .jpg sẽ hỏng ngay ở bước mở, và
    # một định dạng lạ (SVG chứa script, TIFF nhiều tầng) rơi vào nhánh này.
    if dinh_dang not in DINH_DANG_CHO_PHEP:
        raise AnhKhongHopLe(f"định dạng {dinh_dang or 'không rõ'} không được hỗ trợ")

    if rong <= 0 or cao <= 0:
        raise AnhKhongHopLe("kích thước ảnh không hợp lệ")
    if rong * cao > GIOI_HAN_DIEM_ANH:
        # Ca bom giải nén: file rất nhỏ, khai kích thước khổng lồ. Chặn ở ĐÂY, trước
        # `.convert()`, vì `.convert()` mới là chỗ cấp phát bộ nhớ thật.
        raise AnhQuaLon(f"ảnh {rong}x{cao} vượt trần {GIOI_HAN_DIEM_ANH} điểm ảnh")

    # ── 4. Giải mã, thu nhỏ, ghi lại ──────────────────────────────────────────
    try:
        with Image.open(io.BytesIO(raw)) as im:
            # `convert("RGB")` bỏ kênh alpha (JPEG không có) và ép giải mã thật.
            im = im.convert("RGB")
            im.thumbnail((CANH_TOI_DA, CANH_TOI_DA), Image.LANCZOS)
            ra = io.BytesIO()
            # `exif`/`icc_profile` KHÔNG được truyền vào: ảnh mới chỉ có pixel. Đây là
            # chỗ toạ độ GPS trong ảnh chụp từ điện thoại biến mất.
            im.save(ra, format="JPEG", quality=CHAT_LUONG, optimize=True)
            byte_moi = ra.getvalue()
            rong_moi, cao_moi = im.size
    except AnhKhongHopLe:
        raise
    except Exception as exc:  # noqa: BLE001
        raise AnhKhongHopLe(f"không xử lý được ảnh ({type(exc).__name__})") from None

    return AnhDaChuanHoa(
        data_uri="data:image/jpeg;base64," + base64.b64encode(byte_moi).decode("ascii"),
        so_byte=len(byte_moi),
        rong=rong_moi,
        cao=cao_moi,
    )
