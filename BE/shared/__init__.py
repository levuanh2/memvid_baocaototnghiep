"""
shared/ — code dùng chung cho cả monolith (app/) và các service (services/).

Gồm:
- interfaces/  : các Protocol (seam) để inject thay vì import cứng — "liên kết dẻo".
- config.py    : Settings tập trung, nạp env một lần.
- proto/       : hợp đồng gRPC (.proto) giữa monolith và service.
- env_loader   : (sẽ chuyển vào đây ở Phase 2) nạp .env.

Phase 1: các module hiện tại CHƯA bắt buộc dùng shared/; đây là lớp hợp đồng
được thêm vào song song, không phá vỡ hành vi cũ. Các impl cụ thể (LocalLLMProvider,
FaissVectorStore, HybridRetriever...) sẽ "khớp" các Protocol này một cách structural.
"""

# Console Windows mặc định cp1252: mọi print tiếng Việt (log của toàn dự án) ném
# UnicodeEncodeError và giết luôn luồng đang chạy. Docker/pytest dùng UTF-8 nên bẫy này
# chỉ lộ ra khi chạy script trực tiếp trên máy — đúng lúc đang gỡ lỗi. Đặt ở đây vì mọi
# module đều đi qua `shared.*`; errors="replace" để log xấu còn hơn tiến trình chết.
def _force_utf8_console() -> None:
    import sys

    for stream in (sys.stdout, sys.stderr):
        try:
            if stream is not None and (getattr(stream, "encoding", "") or "").lower() not in ("utf-8", "utf8"):
                stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


_force_utf8_console()
