// Cú pháp tìm nâng cao cho Command Palette — THUẦN. ~100 dòng như đặc tả yêu
// cầu: KHÔNG cần ngoặc đơn, AND ngầm định (khoảng trắng, giống `tim()` đã có),
// OR/NOT viết hoa rõ ràng. Không phải một ngôn ngữ truy vấn — một bộ tách chuỗi
// xác định, không ML, không "gần giống".
import { normalize, khopMotTuKhoa, DIEM } from "./universalSearch";

// field:"giá trị có khoảng trắng" hoặc field:mot_tu — bắt CẢ HAI trong một regex.
const RE_TRUONG = /^([a-z]+):(?:"([^"]*)"|(\S+))$/i;

const TRUONG_HOP_LE = new Set(["topic", "entity", "tag", "collection", "has", "favorite", "pinned", "archived"]);

/** Tách MỘT chuỗi thành mảng token, giữ cụm trong ngoặc kép làm MỘT token —
 * kể cả khi ngoặc kép đứng ngay sau `field:` (không có khoảng trắng ở giữa). */
function tachToken(raw) {
  const re = /[a-zA-Z]+:"[^"]*"|"[^"]*"|\S+/g;
  return String(raw || "").match(re) || [];
}

function dungTruong(tok) {
  const m = RE_TRUONG.exec(tok);
  if (!m) return null;
  const field = m[1].toLowerCase();
  if (!TRUONG_HOP_LE.has(field)) return null;
  return { field, value: (m[2] ?? m[3] ?? "").trim() };
}

/** Một điều khoản: chữ thường (AND ngầm định) HOẶC field:value, có thể phủ định
 * bằng tiền tố `NOT `/`-`. */
function dungMotDieuKhoan(tok) {
  let negate = false;
  let t = tok;
  if (/^-/.test(t)) { negate = true; t = t.slice(1); }
  // `RE_TRUONG` tự tách ngoặc kép ra khỏi field:"value" qua nhóm bắt — KHÔNG bóc
  // ngoặc trước khi thử khớp, nếu không chuỗi hỏng dở (mất một bên ngoặc) làm
  // chính regex đó khớp trật.
  const truong = dungTruong(t);
  if (truong) return { negate, field: truong.field, value: normalize(truong.value) };
  // Không phải field:value — có thể là một cụm trần trong ngoặc kép ("nhiều từ"),
  // bóc ngoặc CHO TRƯỜNG HỢP NÀY rồi mới coi là văn bản thường.
  return { negate, field: null, value: normalize(t.replace(/^"|"$/g, "")) };
}

/**
 * Phân tích một truy vấn thành các NHÓM OR, mỗi nhóm là mảng điều khoản AND.
 * "a AND b OR c" -> [[a,b],[c]]. Không có OR/AND/NOT nào thì kết quả là MỘT
 * nhóm — hành vi giống hệt tìm tự nhiên hiện có.
 */
export function parseQuery(raw) {
  const tokens = tachToken(raw).filter((t) => t.trim());
  const nhomOr = [[]];
  let truocLaNot = false;
  for (const tokTho of tokens) {
    const tok = tokTho;
    if (/^OR$/i.test(tok)) { nhomOr.push([]); truocLaNot = false; continue; }
    if (/^AND$/i.test(tok)) { truocLaNot = false; continue; }   // ngầm định, chỉ bỏ qua từ khoá
    if (/^NOT$/i.test(tok)) { truocLaNot = true; continue; }
    const dk = dungMotDieuKhoan(tok);
    if (truocLaNot) dk.negate = true;
    truocLaNot = false;
    if (dk.value) nhomOr[nhomOr.length - 1].push(dk);
  }
  return nhomOr.filter((nhom) => nhom.length);
}

/** Truy vấn có dùng cú pháp nâng cao không — quyết định `search()` đi đường nào. */
export function laTruyVanNangCao(raw) {
  return /\b(AND|OR|NOT)\b/i.test(raw) || RE_TRUONG.test(raw.trim().split(/\s+/)[0] || "");
}

const CO_ARTIFACT = {
  summary: (d) => d?.ai?.summary?.state === "ready",
  mindmap: (d) => d?.ai?.mindmap?.state === "ready",
  studymap: (d) => d?.ai?.studymap?.state === "ready",
  quiz: (d) => Boolean(d?.ai?.quiz?.ready),
  review: (d) => Boolean(d?.ai?.review?.ready),
};
const BOOL_TRUONG = {
  favorite: (d) => Boolean(d?.favorite),
  pinned: (d) => Boolean(d?.pinned),
  archived: (d) => Boolean(d?.archived_at),
};

/** Một điều khoản field:value khớp tài liệu hay không — KHÔNG áp dụng cho điều
 * khoản chữ thường (những cái đó dùng `khopMotTuKhoa`, cùng công thức tìm tự
 * nhiên, ở `danhGiaDieuKhoan`). */
function khopTruong(doc, field, value) {
  if (field === "topic") return (doc?.knowledge?.topics || []).some((t) => normalize(t?.name).includes(value));
  if (field === "entity") return (doc?.knowledge?.entities || []).some((e) => normalize(e).includes(value));
  if (field === "tag") return (doc?.tags || []).some((t) => normalize(t).includes(value));
  if (field === "collection") return false;   // cần tên bộ sưu tập — xử lý ở danhGiaDieuKhoan qua opts
  if (field === "has") return Boolean(CO_ARTIFACT[value]?.(doc));
  if (field in BOOL_TRUONG) return BOOL_TRUONG[field](doc) === (value !== "false");
  return false;
}

function danhGiaDieuKhoan(doc, dk, opts) {
  let ok;
  if (dk.field === "collection") {
    ok = Boolean(opts.tenBoSuuTap) && normalize(opts.tenBoSuuTap).includes(dk.value);
  } else if (dk.field) {
    ok = khopTruong(doc, dk.field, dk.value);
  } else {
    ok = Boolean(khopMotTuKhoa(doc, dk.value, opts));
  }
  return dk.negate ? !ok : ok;
}

/** Đánh giá một tài liệu trên cây [OR[AND]] đã phân tích — trả điểm (số dương =
 * khớp, dùng cho sắp xếp) hoặc `null` = không khớp nhóm OR nào. */
export function evalQuery(doc, nhomOr, opts = {}) {
  for (const nhom of nhomOr) {
    if (nhom.every((dk) => danhGiaDieuKhoan(doc, dk, opts))) {
      // Điểm: nếu CÓ điều khoản chữ thường, lấy hạng cao nhất trong số đó (vẫn
      // đúng thứ tự tiêu đề>chủ đề>...); toàn field:value thì dùng bậc DIEU_KIEN.
      const hangChu = nhom
        .filter((dk) => !dk.field && !dk.negate)
        .map((dk) => khopMotTuKhoa(doc, dk.value, opts))
        .filter(Boolean);
      if (hangChu.length) {
        const caoNhat = hangChu.reduce((a, b) => (DIEM[b] > DIEM[a] ? b : a));
        return { diem: DIEM[caoNhat], hang: caoNhat };
      }
      return { diem: DIEM.DIEU_KIEN, hang: "DIEU_KIEN" };
    }
  }
  return null;
}
