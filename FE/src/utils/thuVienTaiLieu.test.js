import { describe, it, expect } from "vitest";
import {
  boDau, tim, chuoiTim, sapXep, loc, chiaMuc, thoiGianDoc, nhanThoiGianDoc,
  tenHienThi, CHE_DO_SAP, BO_LOC, nhomThoiGian, dauNgay, KHONG_PHAN_LOAI,
  locTheoBoSuuTap, locTheoThe,
} from "./thuVienTaiLieu";

const doc = (over = {}) => ({
  document_id: "d1", title: "bai giang.pdf", display_name: null,
  file_type: "pdf", language: "vi", tags: [],
  status: "completed", ingest_status: "ready",
  char_count: 4000, page_count: 4, chunk_count: 12,
  created_at: "2026-09-01T00:00:00Z", last_opened_at: null, last_workspace: null,
  favorite: false, pinned: false, archived_at: null,
  collection_id: null, open_count: 0, recency_score: 0,
  ai: {
    index: "ready", extraction: "ready", embedding: "ready", chat_ready: "ready",
    summary: { state: "not_generated", preview: null, ai_overview: null, entities: [] },
    mindmap: { state: "not_generated" }, studymap: { state: "not_generated" },
    quiz: { ready: false, count: 0, graded_attempts: 0 },
    review: { ready: false, count: 0 },
  },
  ...over,
});

describe("boDau — chuẩn hoá tiếng Việt", () => {
  it("bỏ dấu thanh và dấu mũ", () => {
    expect(boDau("Định thời")).toBe("dinh thoi");
    expect(boDau("Hệ điều hành")).toBe("he dieu hanh");
    expect(boDau("Tiếng Việt có dấu")).toBe("tieng viet co dau");
  });

  it("đổi đ/Đ thành d — NFD KHÔNG tách chữ này", () => {
    // Ca hỏng thật: 'đ' là một chữ cái riêng trong Unicode, không phải d + dấu.
    // Thiếu bước này thì gõ "dinh thoi" không bao giờ ra "định thời".
    expect(boDau("đ")).toBe("d");
    expect(boDau("Đ")).toBe("d");
    expect(boDau("Đại học Đà Nẵng")).toBe("dai hoc da nang");
    expect(boDau("đường")).toBe("duong");
  });

  it("về chữ thường và cắt trắng", () => {
    expect(boDau("  MixedCase  ")).toBe("mixedcase");
  });

  it("chịu được null/undefined/số", () => {
    expect(boDau(null)).toBe("");
    expect(boDau(undefined)).toBe("");
    expect(boDau(42)).toBe("42");
  });
});

describe("tim", () => {
  const ds = [
    doc({ document_id: "a", title: "he dieu hanh.pdf", display_name: "Hệ điều hành",
          tags: ["Bài giảng"] }),
    doc({ document_id: "b", title: "giai tich.docx", file_type: "docx",
          ai: { ...doc().ai,
                summary: { state: "ready", preview: "Chương về đạo hàm riêng.",
                           ai_overview: ["Định lý Fubini"], entities: ["Fubini"] } } }),
    doc({ document_id: "c", title: "notes.txt", file_type: "txt", language: "en" }),
  ];

  it("truy vấn rỗng trả về tất cả", () => {
    expect(tim(ds, "")).toHaveLength(3);
    expect(tim(ds, "   ")).toHaveLength(3);
  });

  it("tìm theo tên hiển thị, không dấu", () => {
    expect(tim(ds, "he dieu hanh").map((d) => d.document_id)).toEqual(["a"]);
    expect(tim(ds, "HỆ ĐIỀU HÀNH").map((d) => d.document_id)).toEqual(["a"]);
  });

  it("tìm theo tên file gốc", () => {
    expect(tim(ds, "giai tich").map((d) => d.document_id)).toEqual(["b"]);
  });

  it("tìm theo thẻ", () => {
    expect(tim(ds, "bai giang").map((d) => d.document_id)).toEqual(["a"]);
  });

  it("tìm theo tóm tắt xem trước", () => {
    expect(tim(ds, "dao ham").map((d) => d.document_id)).toEqual(["b"]);
  });

  it("tìm theo AI Overview", () => {
    expect(tim(ds, "fubini").map((d) => d.document_id)).toEqual(["b"]);
  });

  it("tìm theo entities — trường chính xác nhất mà pipeline đã trích sẵn", () => {
    const chi = [doc({ document_id: "x", title: "z.pdf",
                       ai: { ...doc().ai,
                             summary: { state: "ready", preview: null, ai_overview: null,
                                        entities: ["Round Robin"] } } })];
    expect(tim(chi, "round robin")).toHaveLength(1);
  });

  it("tìm theo loại tệp và ngôn ngữ", () => {
    expect(tim(ds, "docx").map((d) => d.document_id)).toEqual(["b"]);
    // Ngôn ngữ tìm được. Đây là khớp CHUỖI CON, nên "en" cũng trúng "rieng" trong
    // phần tóm tắt — đúng hành vi mong muốn khi người dùng gõ dần từng ký tự, và
    // ghi lại ở đây để lần sau không ai tưởng đó là lỗi.
    expect(tim(ds, "en").map((d) => d.document_id)).toContain("c");
    expect(tim(ds, "txt").map((d) => d.document_id)).toEqual(["c"]);
  });

  it("nhiều từ là AND, không phải OR", () => {
    expect(tim(ds, "he dieu hanh giai tich")).toHaveLength(0);
  });

  it("không khớp thì trả mảng rỗng, không phải tất cả", () => {
    expect(tim(ds, "khong-he-ton-tai")).toEqual([]);
  });

  it("chuoiTim không nổ khi thiếu khối ai", () => {
    expect(() => chuoiTim({ title: "x" })).not.toThrow();
    expect(() => chuoiTim(null)).not.toThrow();
  });
});

describe("sapXep — Ghim → Yêu thích → chế độ", () => {
  const ghim = doc({ document_id: "ghim", pinned: true, title: "zzz.pdf",
                     created_at: "2020-01-01T00:00:00Z" });
  const thich = doc({ document_id: "thich", favorite: true, title: "yyy.pdf",
                      created_at: "2021-01-01T00:00:00Z" });
  const thuong = doc({ document_id: "thuong", title: "aaa.pdf",
                       created_at: "2026-01-01T00:00:00Z" });
  const ds = [thuong, thich, ghim];

  it.each(CHE_DO_SAP)("chế độ %s vẫn giữ Ghim trước Yêu thích trước Thường", (cheDo) => {
    // Đây là điểm mấu chốt: người dùng ghim là để nó Ở TRÊN. Một chế độ sắp xoá
    // được điều đó thì cái ghim vô nghĩa — kể cả A-Z, kể cả "cũ nhất".
    expect(sapXep(ds, cheDo).map((d) => d.document_id))
      .toEqual(["ghim", "thich", "thuong"]);
  });

  it("mới nhất / cũ nhất trong cùng một nhóm", () => {
    const a = doc({ document_id: "a", created_at: "2026-01-01T00:00:00Z" });
    const b = doc({ document_id: "b", created_at: "2020-01-01T00:00:00Z" });
    expect(sapXep([b, a], "newest").map((d) => d.document_id)).toEqual(["a", "b"]);
    expect(sapXep([a, b], "oldest").map((d) => d.document_id)).toEqual(["b", "a"]);
  });

  it("A-Z và Z-A dùng tên hiển thị, không dấu", () => {
    const a = doc({ document_id: "a", display_name: "Ánh sáng" });
    const b = doc({ document_id: "b", display_name: "Bình thường" });
    expect(sapXep([b, a], "az").map((d) => d.document_id)).toEqual(["a", "b"]);
    expect(sapXep([a, b], "za").map((d) => d.document_id)).toEqual(["b", "a"]);
  });

  it("mở gần đây: chưa mở bao giờ xuống cuối", () => {
    const cu = doc({ document_id: "cu", last_opened_at: "2026-01-01T00:00:00Z" });
    const moi = doc({ document_id: "moi", last_opened_at: "2026-09-01T00:00:00Z" });
    const chua = doc({ document_id: "chua", last_opened_at: null });
    expect(sapXep([chua, cu, moi], "recently_opened").map((d) => d.document_id))
      .toEqual(["moi", "cu", "chua"]);
  });

  it("thời gian đọc: dài trước, và 'không biết' xuống cuối chứ không lên đầu", () => {
    const dai = doc({ document_id: "dai", char_count: 90000 });
    const ngan = doc({ document_id: "ngan", char_count: 1000 });
    const khong = doc({ document_id: "khong", char_count: null, reading_minutes: null });
    expect(sapXep([khong, ngan, dai], "reading_time").map((d) => d.document_id))
      .toEqual(["dai", "ngan", "khong"]);
  });

  it("không sửa mảng gốc", () => {
    const goc = [thuong, thich, ghim];
    const ban = [...goc];
    sapXep(goc, "az");
    expect(goc).toEqual(ban);
  });

  it("chế độ lạ lùi về mới nhất thay vì nổ", () => {
    expect(() => sapXep(ds, "khong-ton-tai")).not.toThrow();
    expect(sapXep(ds, "khong-ton-tai")).toHaveLength(3);
  });

  it("hoà thì ổn định theo document_id — danh sách không nhảy giữa hai lần render", () => {
    const x = doc({ document_id: "x", created_at: "2026-01-01T00:00:00Z" });
    const y = doc({ document_id: "y", created_at: "2026-01-01T00:00:00Z" });
    expect(sapXep([y, x], "newest").map((d) => d.document_id)).toEqual(["x", "y"]);
  });
});

describe("loc", () => {
  const ds = [
    doc({ document_id: "pdf", file_type: "pdf", favorite: true }),
    doc({ document_id: "docx", file_type: "docx", pinned: true }),
    doc({ document_id: "txt", file_type: "txt" }),
    doc({ document_id: "anh", file_type: "png" }),
    doc({ document_id: "luu", archived_at: "2026-09-01T00:00:00Z" }),
    doc({ document_id: "chay", ingest_status: "processing", status: "processing" }),
    doc({ document_id: "hong", ingest_status: "error", status: "failed" }),
    doc({ document_id: "co_tt",
          ai: { ...doc().ai, summary: { state: "ready", preview: "x", ai_overview: [],
                                        entities: [] } } }),
    doc({ document_id: "co_quiz",
          ai: { ...doc().ai, quiz: { ready: true, count: 2, graded_attempts: 1 } } }),
  ];

  it("mặc định giấu tài liệu đã lưu trữ", () => {
    expect(loc(ds, []).map((d) => d.document_id)).not.toContain("luu");
  });

  it("hienLuuTru đưa chúng trở lại", () => {
    expect(loc(ds, [], { hienLuuTru: true }).map((d) => d.document_id)).toContain("luu");
  });

  it("bộ lọc archived tự nó cũng hiện chúng — nếu không mục đó luôn rỗng", () => {
    expect(loc(ds, ["archived"]).map((d) => d.document_id)).toEqual(["luu"]);
  });

  it.each([
    ["pdf", "pdf"], ["docx", "docx"], ["txt", "txt"], ["image", "anh"],
    ["favorite", "pdf"], ["pinned", "docx"],
    ["processing", "chay"], ["failed", "hong"],
    ["summary_ready", "co_tt"], ["quiz_ready", "co_quiz"],
  ])("bộ lọc %s chọn đúng %s", (khoa, mongDoi) => {
    expect(loc(ds, [khoa]).map((d) => d.document_id)).toContain(mongDoi);
  });

  it("nhiều bộ lọc là AND", () => {
    expect(loc(ds, ["pdf", "favorite"]).map((d) => d.document_id)).toEqual(["pdf"]);
    expect(loc(ds, ["pdf", "pinned"])).toEqual([]);
  });

  it("khoá lạ bị bỏ qua thay vì lọc sạch danh sách", () => {
    expect(loc(ds, ["khong-ton-tai"]).length).toBe(ds.length - 1);   // trừ tài liệu đã lưu trữ
  });

  it("mọi khoá BO_LOC đều là hàm gọi được, không nổ với tài liệu thiếu trường", () => {
    for (const f of Object.values(BO_LOC)) expect(() => f({})).not.toThrow();
  });
});

describe("thoiGianDoc", () => {
  it("dùng reading_minutes của máy chủ khi có", () => {
    expect(thoiGianDoc({ reading_minutes: 46, char_count: 1 })).toBe(46);
  });

  it("suy từ char_count khi thiếu", () => {
    expect(thoiGianDoc({ char_count: 4000 })).toBe(4);
    expect(thoiGianDoc({ char_count: 1 })).toBe(1);
  });

  it("không biết thì null, không phải 0", () => {
    expect(thoiGianDoc({ char_count: 0 })).toBeNull();
    expect(thoiGianDoc({})).toBeNull();
    expect(thoiGianDoc(null)).toBeNull();
  });

  it("nhãn theo giờ khi dài", () => {
    expect(nhanThoiGianDoc(46)).toBe("46 phút đọc");
    expect(nhanThoiGianDoc(60)).toBe("1 giờ đọc");
    expect(nhanThoiGianDoc(95)).toBe("1 giờ 35 phút đọc");
    expect(nhanThoiGianDoc(null)).toBeNull();
  });
});

describe("tenHienThi", () => {
  it("display_name thắng, lùi về title", () => {
    expect(tenHienThi({ display_name: "Tên đặt", title: "goc.pdf" })).toBe("Tên đặt");
    expect(tenHienThi({ display_name: null, title: "goc.pdf" })).toBe("goc.pdf");
    expect(tenHienThi({})).toBe("");
  });
});

describe("chiaMuc", () => {
  const dsGoc = [
    doc({ document_id: "ghim", pinned: true }),
    doc({ document_id: "thich", favorite: true }),
    doc({ document_id: "mo1", last_opened_at: "2026-09-08T00:00:00Z",
          last_workspace: "mindmap" }),
    doc({ document_id: "mo2", last_opened_at: "2026-09-07T00:00:00Z" }),
    doc({ document_id: "chua_mo" }),
    doc({ document_id: "luu", archived_at: "2026-09-01T00:00:00Z" }),
  ];

  it("Tiếp tục học là tài liệu mở gần nhất", () => {
    expect(chiaMuc(dsGoc).tiepTucHoc.document_id).toBe("mo1");
  });

  it("chưa mở gì thì Tiếp tục học là null — mục phải biến mất, không phải rỗng", () => {
    expect(chiaMuc([doc({ last_opened_at: null })]).tiepTucHoc).toBeNull();
  });

  it("Mở gần đây không lặp lại thẻ Tiếp tục học", () => {
    const m = chiaMuc(dsGoc);
    expect(m.hocGanDay.map((d) => d.document_id)).not.toContain("mo1");
    expect(m.hocGanDay.map((d) => d.document_id)).toContain("mo2");
  });

  it("Yêu thích không lặp lại tài liệu đã ghim", () => {
    const m = chiaMuc([doc({ document_id: "ca_hai", pinned: true, favorite: true })]);
    expect(m.daGhim.map((d) => d.document_id)).toEqual(["ca_hai"]);
    expect(m.yeuThich).toEqual([]);
  });

  it("Chưa mở bao giờ chỉ gồm tài liệu đã lập chỉ mục", () => {
    const chuaIndex = doc({ document_id: "chua_index",
                            ai: { ...doc().ai, index: "not_generated" } });
    const m = chiaMuc([chuaIndex, doc({ document_id: "san_sang" })]);
    expect(m.chuaMoBaoGio.map((d) => d.document_id)).toEqual(["san_sang"]);
  });

  it("Cần tóm tắt / sơ đồ / quiz chỉ gồm tài liệu đã lập chỉ mục", () => {
    // Mời tạo tóm tắt cho tài liệu chưa có đoạn nào thì máy chủ trả 400 và người
    // dùng không làm gì được — đó là một ngõ cụt, không phải một gợi ý.
    const chuaIndex = doc({ document_id: "chua_index",
                            ai: { ...doc().ai, index: "not_generated" } });
    const m = chiaMuc([chuaIndex]);
    expect(m.canTomTat).toEqual([]);
    expect(m.canSoDo).toEqual([]);
    expect(m.canQuiz).toEqual([]);
  });

  it("Cần sơ đồ bỏ qua tài liệu đã có sơ đồ tư duy HOẶC bản đồ học tập", () => {
    const coStudyMap = doc({ document_id: "co_sm",
                             ai: { ...doc().ai, studymap: { state: "ready" } } });
    expect(chiaMuc([coStudyMap]).canSoDo).toEqual([]);
  });

  it("Cần ôn tập CHỈ khi đã có bài chấm", () => {
    // Hướng dẫn ôn tập dựng TỪ một bài đã chấm. Mời tạo khi chưa ai làm bài nào là
    // mời vào một ngõ cụt.
    const chuaLam = doc({ document_id: "chua_lam" });
    const daCham = doc({ document_id: "da_cham",
                         ai: { ...doc().ai,
                               quiz: { ready: true, count: 1, graded_attempts: 2 } } });
    const m = chiaMuc([chuaLam, daCham]);
    expect(m.canOnTap.map((d) => d.document_id)).toEqual(["da_cham"]);
  });

  it("Cần ôn tập bỏ qua tài liệu đã có hướng dẫn", () => {
    const daCo = doc({ document_id: "da_co",
                       ai: { ...doc().ai,
                             quiz: { ready: true, count: 1, graded_attempts: 2 },
                             review: { ready: true, count: 1 } } });
    expect(chiaMuc([daCo]).canOnTap).toEqual([]);
  });

  it("Tải lên gần đây là các tài liệu mới nhất, tối đa 6", () => {
    const nhieu = Array.from({ length: 9 }, (_, i) =>
      doc({ document_id: `d${i}`, created_at: `2026-09-0${(i % 9) + 1}T00:00:00Z` }));
    const m = chiaMuc(nhieu);
    expect(m.taiLenGanDay).toHaveLength(6);
    expect(m.taiLenGanDay[0].created_at > m.taiLenGanDay[5].created_at).toBe(true);
  });

  it("tài liệu đã lưu trữ chỉ nằm ở mục Đã lưu trữ", () => {
    const m = chiaMuc(dsGoc);
    expect(m.daLuuTru.map((d) => d.document_id)).toEqual(["luu"]);
    expect(m.tatCa.map((d) => d.document_id)).not.toContain("luu");
    expect(m.canTomTat.map((d) => d.document_id)).not.toContain("luu");
  });

  it("hienLuuTru đưa chúng vào mọi mục", () => {
    const m = chiaMuc(dsGoc, { hienLuuTru: true });
    expect(m.tatCa.map((d) => d.document_id)).toContain("luu");
  });

  it("danh sách rỗng cho mọi mục rỗng, không nổ", () => {
    const m = chiaMuc([]);
    expect(m.tiepTucHoc).toBeNull();
    expect(m.daGhim).toEqual([]);
    expect(m.tatCa).toEqual([]);
    expect(() => chiaMuc(null)).not.toThrow();
  });

  it("mọi mục đều tuân quy tắc Ghim → Yêu thích", () => {
    const ds = [
      doc({ document_id: "thuong", last_opened_at: "2026-09-09T00:00:00Z" }),
      doc({ document_id: "ghim", pinned: true, last_opened_at: "2026-01-01T00:00:00Z" }),
    ];
    expect(chiaMuc(ds).tatCa[0].document_id).toBe("thuong");   // tatCa giữ thứ tự đầu vào
    expect(sapXep(chiaMuc(ds).tatCa, "newest")[0].document_id).toBe("ghim");
  });
});


// ── Phase 1B ────────────────────────────────────────────────────────────────

describe("nhomThoiGian — theo lịch địa phương, không phải 24 giờ", () => {
  const now = new Date("2026-09-09T12:00:00").getTime();
  const dau = dauNgay(now);

  it("hôm nay", () => {
    expect(nhomThoiGian(new Date(dau + 3600000).toISOString(), now)).toBe("today");
  });

  it("23:00 hôm qua là 'hôm qua', dù mới cách 13 tiếng", () => {
    // Trừ 24 giờ sẽ gọi nó là "hôm nay" — sai với cách người dùng nghĩ về ngày.
    expect(nhomThoiGian(new Date(dau - 3600000).toISOString(), now)).toBe("yesterday");
  });

  it("trong tuần", () => {
    expect(nhomThoiGian(new Date(dau - 3 * 86400000).toISOString(), now)).toBe("this_week");
  });

  it("cũ hơn", () => {
    expect(nhomThoiGian(new Date(dau - 30 * 86400000).toISOString(), now)).toBe("older");
  });

  it("mốc hỏng hoặc thiếu trả null", () => {
    expect(nhomThoiGian(null, now)).toBeNull();
    expect(nhomThoiGian("rác", now)).toBeNull();
    expect(nhomThoiGian(undefined, now)).toBeNull();
  });
});

describe("lọc theo bộ sưu tập và thẻ", () => {
  const ds = [
    doc({ document_id: "a", collection_id: "c1", tags: ["AI", "Exam"] }),
    doc({ document_id: "b", collection_id: "c2", tags: ["AI"] }),
    doc({ document_id: "c", collection_id: null, tags: [] }),
  ];

  it("lọc theo một bộ sưu tập", () => {
    expect(loc(ds, [], { collectionId: "c1" }).map((d) => d.document_id)).toEqual(["a"]);
  });

  it("KHONG_PHAN_LOAI chọn đúng tài liệu chưa có bộ sưu tập", () => {
    expect(loc(ds, [], { collectionId: KHONG_PHAN_LOAI }).map((d) => d.document_id))
      .toEqual(["c"]);
  });

  it("nhiều thẻ là AND, không phải OR", () => {
    // OR thì chọn càng nhiều thẻ càng ra nhiều kết quả — đúng ngược ý người lọc.
    expect(loc(ds, [], { tags: ["AI"] }).map((d) => d.document_id)).toEqual(["a", "b"]);
    expect(loc(ds, [], { tags: ["AI", "Exam"] }).map((d) => d.document_id)).toEqual(["a"]);
  });

  it("thẻ không phân biệt hoa thường", () => {
    expect(loc(ds, [], { tags: ["ai"] })).toHaveLength(2);
  });

  it("bộ sưu tập kết hợp với thẻ và với BO_LOC", () => {
    expect(loc(ds, ["pdf"], { collectionId: "c1", tags: ["AI"] })
      .map((d) => d.document_id)).toEqual(["a"]);
  });

  it("bộ lọc uncategorized", () => {
    expect(loc(ds, ["uncategorized"]).map((d) => d.document_id)).toEqual(["c"]);
  });

  it("helper locTheoBoSuuTap / locTheoThe dùng độc lập được", () => {
    expect(ds.filter(locTheoBoSuuTap("c2")).map((d) => d.document_id)).toEqual(["b"]);
    expect(ds.filter(locTheoThe("exam")).map((d) => d.document_id)).toEqual(["a"]);
  });
});

describe("bộ lọc recent", () => {
  it("chỉ nhận tài liệu mở trong 7 ngày", () => {
    const moi = doc({ document_id: "moi", last_opened_at: new Date().toISOString() });
    const cu = doc({ document_id: "cu",
      last_opened_at: new Date(Date.now() - 30 * 86400000).toISOString() });
    const chua = doc({ document_id: "chua" });
    expect(loc([moi, cu, chua], ["recent"]).map((d) => d.document_id)).toEqual(["moi"]);
  });
});

describe("tìm theo tên bộ sưu tập", () => {
  const idx = new Map([["c1", { collection_id: "c1", name: "Hệ điều hành" }]]);
  const ds = [
    doc({ document_id: "a", title: "chuong4.pdf", collection_id: "c1" }),
    doc({ document_id: "b", title: "khac.pdf" }),
  ];

  it("gõ tên bộ sưu tập tìm ra tài liệu bên trong", () => {
    expect(tim(ds, "he dieu hanh", idx).map((d) => d.document_id)).toEqual(["a"]);
  });

  it("không dấu vẫn khớp", () => {
    expect(tim(ds, "HỆ ĐIỀU", idx)).toHaveLength(1);
  });

  it("không truyền chỉ mục thì chỉ mất khả năng tìm theo bộ sưu tập, không nổ", () => {
    expect(tim(ds, "he dieu hanh")).toHaveLength(0);
    expect(() => tim(ds, "x")).not.toThrow();
  });

  it("chuoiTim nhận tên bộ sưu tập truyền vào, không lấy từ tài liệu", () => {
    // Tài liệu chỉ mang `collection_id`; không có bản sao tên nào để lệch.
    expect(chuoiTim(ds[0], "Hệ điều hành")).toContain("he dieu hanh");
    expect(chuoiTim(ds[0])).not.toContain("he dieu hanh");
  });
});

describe("sắp theo recently_studied", () => {
  it("dùng recency_score của máy chủ", () => {
    const cao = doc({ document_id: "cao", recency_score: 0.9,
      last_opened_at: "2026-09-01T00:00:00Z" });
    const thap = doc({ document_id: "thap", recency_score: 0.2,
      last_opened_at: "2026-09-08T00:00:00Z" });
    expect(sapXep([thap, cao], "recently_studied").map((d) => d.document_id))
      .toEqual(["cao", "thap"]);
  });

  it("thiếu điểm thì lùi về mốc mở cuối", () => {
    const a = doc({ document_id: "a", last_opened_at: "2026-09-08T00:00:00Z",
      recency_score: undefined });
    const b = doc({ document_id: "b", last_opened_at: "2026-09-01T00:00:00Z",
      recency_score: undefined });
    expect(sapXep([b, a], "recently_studied").map((d) => d.document_id)).toEqual(["a", "b"]);
  });

  it("vẫn tuân Ghim → Yêu thích", () => {
    const ghim = doc({ document_id: "ghim", pinned: true, recency_score: 0 });
    const diem = doc({ document_id: "diem", recency_score: 0.99 });
    expect(sapXep([diem, ghim], "recently_studied").map((d) => d.document_id))
      .toEqual(["ghim", "diem"]);
  });

  it("có mặt trong CHE_DO_SAP", () => {
    expect(CHE_DO_SAP).toContain("recently_studied");
  });
});

describe("mục theo lịch trong chiaMuc", () => {
  const now = new Date("2026-09-09T12:00:00").getTime();
  const dau = dauNgay(now);
  const ds = [
    doc({ document_id: "homnay", last_opened_at: new Date(dau + 3600000).toISOString() }),
    doc({ document_id: "homqua", last_opened_at: new Date(dau - 3600000).toISOString() }),
    doc({ document_id: "tuannay",
      last_opened_at: new Date(dau - 3 * 86400000).toISOString() }),
    doc({ document_id: "cu", last_opened_at: new Date(dau - 60 * 86400000).toISOString() }),
  ];

  it("chia đúng ba nhóm và không nhóm nào nuốt tài liệu cũ", () => {
    const m = chiaMuc(ds, { now });
    expect(m.homNay.map((d) => d.document_id)).toEqual(["homnay"]);
    expect(m.homQua.map((d) => d.document_id)).toEqual(["homqua"]);
    expect(m.tuanNay.map((d) => d.document_id)).toEqual(["tuannay"]);
    expect(m.homNay.concat(m.homQua, m.tuanNay).map((d) => d.document_id))
      .not.toContain("cu");
  });

  it("chưa mở bao giờ không vào mục lịch nào", () => {
    const m = chiaMuc([doc({ document_id: "chua" })], { now });
    expect(m.homNay.concat(m.homQua, m.tuanNay)).toEqual([]);
  });

  it("mục lịch rỗng là mảng rỗng, không phải undefined", () => {
    const m = chiaMuc([], { now });
    expect(m.homNay).toEqual([]);
    expect(m.homQua).toEqual([]);
    expect(m.tuanNay).toEqual([]);
  });
});
