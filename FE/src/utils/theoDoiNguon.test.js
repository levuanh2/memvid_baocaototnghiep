import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  taoBoTheoDoiNguon,
  laLoiTamThoi,
  khoangChoMs,
  laTrangThaiKetThuc,
  NHIP_MS,
  TRAN_CHO_MS,
  NGUONG_CANH_BAO,
  MAX_CONSECUTIVE_FETCH_FAILURES,
} from "./theoDoiNguon";

/** Lỗi đúng hình dạng `_appError` của utils/api: message + `.status`. */
const loiHttp = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
/** fetch ném — không có `.status` (mất mạng, DNS, preflight chết). */
const loiMang = () => new TypeError("Failed to fetch");

describe("laLoiTamThoi", () => {
  it("502/503/504 là tạm thời — đúng cái Render/proxy trả lẻ tẻ", () => {
    for (const ma of [502, 503, 504]) expect(laLoiTamThoi(loiHttp(ma))).toBe(true);
  });

  it("408/429 cũng tạm thời (hết giờ / bị bóp)", () => {
    expect(laLoiTamThoi(loiHttp(408))).toBe(true);
    expect(laLoiTamThoi(loiHttp(429))).toBe(true);
  });

  it("lỗi mạng (không có status) là tạm thời", () => {
    expect(laLoiTamThoi(loiMang())).toBe(true);
    expect(laLoiTamThoi(undefined)).toBe(true);
  });

  it("500/404/401/403 KHÔNG tạm thời — thử lại chỉ ra đúng câu trả lời đó", () => {
    for (const ma of [400, 401, 403, 404, 500]) expect(laLoiTamThoi(loiHttp(ma))).toBe(false);
  });
});

describe("khoangChoMs", () => {
  it("chưa hỏng thì giữ nhịp thường", () => {
    expect(khoangChoMs(0)).toBe(NHIP_MS);
  });

  it("giãn dần rồi ĐỤNG TRẦN — không có vòng lặp quay tít, không giãn vô hạn", () => {
    expect(khoangChoMs(1)).toBe(3000);
    expect(khoangChoMs(2)).toBe(6000);
    expect(khoangChoMs(3)).toBe(TRAN_CHO_MS);
    expect(khoangChoMs(50)).toBe(TRAN_CHO_MS);
  });
});

describe("laTrangThaiKetThuc", () => {
  it("chỉ ready/error mới là hết chuyện", () => {
    expect(laTrangThaiKetThuc("ready")).toBe(true);
    expect(laTrangThaiKetThuc("error")).toBe(true);
    expect(laTrangThaiKetThuc("processing")).toBe(false);
    expect(laTrangThaiKetThuc("index_ready")).toBe(false);
    expect(laTrangThaiKetThuc(undefined)).toBe(false);
  });
});

describe("taoBoTheoDoiNguon", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * `ketQua` là danh sách việc xảy ra ở mỗi lượt: object = trả về, Error = ném.
   * Hết danh sách thì lặp lại phần tử cuối (job thật poll mãi tới khi xong).
   */
  const mk = (ketQua) => {
    let i = 0;
    const layTrangThai = vi.fn(async () => {
      const x = ketQua[Math.min(i++, ketQua.length - 1)];
      if (x instanceof Error) throw x;
      return x;
    });
    const su = { trangThai: [], ketThuc: [], trucTrac: [], matKetNoi: [] };
    const bo = taoBoTheoDoiNguon({
      layTrangThai,
      onTrangThai: (d) => su.trangThai.push(d),
      onKetThuc: (d) => su.ketThuc.push(d),
      onTrucTrac: (n) => su.trucTrac.push(n),
      onMatKetNoi: (n, e) => su.matKetNoi.push([n, e]),
    });
    return { bo, su, layTrangThai };
  };

  const chay = async (lan = 1) => {
    for (let i = 0; i < lan; i++) {
      await vi.advanceTimersByTimeAsync(TRAN_CHO_MS + 100);
    }
  };

  // ── 1. Đường thường ────────────────────────────────────────────────────────
  it("200 liên tục → báo trạng thái mỗi lượt, chạy tới ready rồi dừng", async () => {
    const { bo, su, layTrangThai } = mk([
      { status: "processing", progress: 0.3 },
      { status: "processing", progress: 0.7 },
      { status: "ready", progress: 1 },
    ]);
    bo.start("s1");
    await chay(4);

    expect(su.trangThai.map((d) => d.status)).toEqual(["processing", "processing", "ready"]);
    expect(su.ketThuc).toHaveLength(1);
    expect(su.ketThuc[0].status).toBe("ready");
    expect(su.matKetNoi).toHaveLength(0);
    expect(su.trucTrac).toHaveLength(0);

    // Đã dừng: chạy thêm bao lâu cũng không hỏi nữa.
    const soLan = layTrangThai.mock.calls.length;
    await chay(3);
    expect(layTrangThai.mock.calls.length).toBe(soLan);
  });

  // ── 2. Một 502 lẻ ──────────────────────────────────────────────────────────
  it("MỘT cú 502 → thử lại, KHÔNG đánh dấu hỏng, KHÔNG cảnh báo gì", async () => {
    const { bo, su } = mk([
      { status: "processing", progress: 0.2 },
      loiHttp(502),
      { status: "processing", progress: 0.5 },
    ]);
    bo.start("s1");
    await chay(3);

    expect(su.matKetNoi).toHaveLength(0);          // không phải ingest hỏng
    expect(su.trucTrac).toHaveLength(0);           // một cú lẻ phải VÔ HÌNH
    expect(su.ketThuc).toHaveLength(0);
    expect(su.trangThai.length).toBeGreaterThanOrEqual(2);
    expect(su.trangThai.at(-1).status).toBe("processing");
  });

  // ── 3. Phục hồi ────────────────────────────────────────────────────────────
  it("502 → 502 → 200: theo dõi bình thường trở lại, bộ đếm hỏng về 0", async () => {
    const { bo, su } = mk([
      loiHttp(502),
      loiHttp(502),
      { status: "processing", progress: 0.6 },
      { status: "ready", progress: 1 },
    ]);
    bo.start("s1");
    await chay(5);

    expect(su.matKetNoi).toHaveLength(0);
    expect(su.trangThai.map((d) => d.status)).toContain("processing");
    expect(su.ketThuc).toHaveLength(1);
    expect(su.ketThuc[0].status).toBe("ready");
    expect(bo.soLanHongLienTiep).toBe(0);          // 200 xoá sạch đếm
  });

  it("hỏng gần chạm ngưỡng rồi 200 → lần hỏng sau lại đếm từ đầu", async () => {
    const { bo, su } = mk([
      loiHttp(503), loiHttp(503), loiHttp(503),    // chạm ngưỡng cảnh báo
      { status: "processing" },                    // phục hồi
      loiHttp(503), loiHttp(503),                  // hỏng lại, mới 2 lần
      { status: "ready" },
    ]);
    bo.start("s1");
    await chay(8);

    // Nếu bộ đếm không reset thì 3+2 = 5 = MAX → sẽ mất kết nối. Nó phải KHÔNG mất.
    expect(su.matKetNoi).toHaveLength(0);
    expect(su.ketThuc.at(-1).status).toBe("ready");
  });

  // ── 4. Hỏng liên tục ───────────────────────────────────────────────────────
  it("hỏng mạng liên tục → cảnh báo tạm thời trước, chỉ MẤT KẾT NỐI sau khi hết ngân sách", async () => {
    const { bo, su, layTrangThai } = mk([loiMang()]);
    bo.start("s1");
    await chay(10);

    // Cảnh báo xuất hiện từ lần thứ NGUONG_CANH_BAO, KHÔNG phải lần đầu.
    expect(su.trucTrac[0]).toBe(NGUONG_CANH_BAO);
    expect(su.matKetNoi).toHaveLength(1);
    expect(su.matKetNoi[0][0]).toBe(MAX_CONSECUTIVE_FETCH_FAILURES);

    // Không phải ingest hỏng: không có lượt kết thúc nào.
    expect(su.ketThuc).toHaveLength(0);

    // Ngân sách CÓ TRẦN: đã dừng hẳn, không quay tít.
    expect(layTrangThai.mock.calls.length).toBe(MAX_CONSECUTIVE_FETCH_FAILURES);
    const soLan = layTrangThai.mock.calls.length;
    await chay(5);
    expect(layTrangThai.mock.calls.length).toBe(soLan);
  });

  it("lỗi KHÔNG tạm thời (404) dừng ngay, không đốt hết 5 lượt", async () => {
    const { bo, su, layTrangThai } = mk([loiHttp(404)]);
    bo.start("s1");
    await chay(3);

    expect(su.matKetNoi).toHaveLength(1);
    expect(layTrangThai).toHaveBeenCalledTimes(1);
    expect(su.ketThuc).toHaveLength(0);
  });

  // ── 5. Hỏng THẬT ở backend ─────────────────────────────────────────────────
  it("status = error từ backend VẪN là hỏng thật — trục trặc mạng không được nuốt mất nó", async () => {
    const { bo, su } = mk([
      { status: "processing" },
      { status: "error", error: "ingest thất bại: hết bộ nhớ" },
    ]);
    bo.start("s1");
    await chay(3);

    expect(su.ketThuc).toHaveLength(1);
    expect(su.ketThuc[0].status).toBe("error");
    expect(su.ketThuc[0].error).toContain("ingest thất bại");
    expect(su.matKetNoi).toHaveLength(0);          // khác hẳn lỗi đường truyền
  });

  it("502 xen giữa rồi backend báo error → vẫn ra hỏng thật, không thành mất-kết-nối", async () => {
    const { bo, su } = mk([
      loiHttp(502),
      { status: "error", error: "provider từ chối" },
    ]);
    bo.start("s1");
    await chay(3);

    expect(su.matKetNoi).toHaveLength(0);
    expect(su.ketThuc[0].status).toBe("error");
  });

  // ── 6. Dọn dẹp ─────────────────────────────────────────────────────────────
  it("stop() cắt hẳn lượt sau — rời trang là hết hỏi", async () => {
    const { bo, layTrangThai } = mk([{ status: "processing" }]);
    bo.start("s1");
    await vi.advanceTimersByTimeAsync(NHIP_MS + 50);
    const soLan = layTrangThai.mock.calls.length;
    expect(soLan).toBeGreaterThan(0);

    bo.stop();
    await chay(5);
    expect(layTrangThai.mock.calls.length).toBe(soLan);
  });

  it("stop() giữa lúc request đang bay: kết quả về sau KHÔNG được hẹn giờ tiếp", async () => {
    let thaChot;
    const layTrangThai = vi.fn(() => new Promise((res) => { thaChot = () => res({ status: "processing" }); }));
    const su = { trangThai: [], ketThuc: [] };
    const bo = taoBoTheoDoiNguon({
      layTrangThai,
      onTrangThai: (d) => su.trangThai.push(d),
      onKetThuc: (d) => su.ketThuc.push(d),
    });
    bo.start("s1");
    bo.stop();                 // dừng trong lúc request chưa về
    thaChot();
    await chay(3);

    expect(su.trangThai).toHaveLength(0);
    expect(layTrangThai).toHaveBeenCalledTimes(1);
  });

  it("KHÔNG chồng request: lượt sau chỉ hẹn khi lượt trước đã xong", async () => {
    let dangBay = 0;
    let toiDaCungLuc = 0;
    const layTrangThai = vi.fn(async () => {
      dangBay += 1;
      toiDaCungLuc = Math.max(toiDaCungLuc, dangBay);
      // Lượt chậm hơn cả nhịp poll — đúng ca `setInterval` cũ bắn chồng.
      await new Promise((r) => setTimeout(r, NHIP_MS * 3));
      dangBay -= 1;
      return { status: "processing" };
    });
    const bo = taoBoTheoDoiNguon({ layTrangThai });
    bo.start("s1");
    await chay(6);
    bo.stop();

    expect(toiDaCungLuc).toBe(1);
  });

  it("start() hai lần trên cùng một bộ không nhân đôi vòng lặp", async () => {
    const { bo, layTrangThai } = mk([{ status: "processing" }]);
    bo.start("s1");
    await vi.advanceTimersByTimeAsync(NHIP_MS * 2 + 50);
    const mocDon = layTrangThai.mock.calls.length;

    bo.stop();
    const { bo: bo2, layTrangThai: lay2 } = mk([{ status: "processing" }]);
    bo2.start("s1");
    bo2.start("s1");   // gọi lặp
    await vi.advanceTimersByTimeAsync(NHIP_MS * 2 + 50);
    bo2.stop();

    // Hai lần start không được cho ra gấp đôi số request của một vòng lặp.
    expect(lay2.mock.calls.length).toBeLessThanOrEqual(mocDon + 1);
  });
});
