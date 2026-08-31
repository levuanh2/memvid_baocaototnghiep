// Audit vòng 8 V8-4 — người dùng báo thấy nguyên văn "Failed to fetch".
//
// Chuỗi đó do trình duyệt sinh khi fetch không tới được máy chủ. `getUserFriendlyApiError`
// trong utils/api.js xử lý đúng ca này từ lâu nhưng không trang StudyMap nào gọi.
import { describe, expect, it } from "vitest";
import { moTaLoi } from "./studyApi";

describe("moTaLoi", () => {
  it("lỗi mạng thì nói tiếng Việt, không để lọt 'Failed to fetch'", () => {
    const s = moTaLoi(new TypeError("Failed to fetch"), "Không tạo được quiz.");
    expect(s).not.toMatch(/failed to fetch/i);
    expect(s).toMatch(/máy chủ/i);
  });

  it("giữ nguyên lời BE đã viết bằng tiếng Việt", () => {
    const e = new Error("Phạm vi đã chọn không có chunk nào đã index.");
    e.status = 400;
    expect(moTaLoi(e, "x")).toBe("Phạm vi đã chọn không có chunk nào đã index.");
  });

  it("401/403/404 dùng lời chung, không lộ chi tiết backend", () => {
    const e403 = new Error("forbidden");
    e403.status = 403;
    expect(moTaLoi(e403, "x")).toMatch(/không có quyền/i);

    const e401 = new Error("unauthorized");
    e401.status = 401;
    expect(moTaLoi(e401, "x")).toMatch(/đăng nhập/i);
  });

  it("lỗi rỗng thì dùng câu dự phòng của trang", () => {
    expect(moTaLoi(null, "Không tải được kết quả.")).toBe("Không tải được kết quả.");
    expect(moTaLoi(undefined, "Không tải được kết quả.")).toBe("Không tải được kết quả.");
  });

  it("'HTTP nnn' trần không phải câu cho người đọc", () => {
    const e = new Error("HTTP 500");
    e.status = 500;
    expect(moTaLoi(e, "Nộp bài thất bại.")).toBe("Nộp bài thất bại.");
  });

  it("lỗi không có status coi như mất kết nối, không hiện chuỗi kỹ thuật", () => {
    expect(moTaLoi(new Error("NetworkError when attempting to fetch resource."), "x"))
      .toMatch(/máy chủ/i);
  });
});
