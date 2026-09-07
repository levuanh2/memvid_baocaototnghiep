// Logic thuần của biểu mẫu sửa hồ sơ — không React, không mạng, không DOM.
//
// Tách ra vì hai lý do. Một: kho này chạy test ở env node, không có DOM, nên logic
// nằm trong component là logic không đo được. Hai: "trường nào gửi đi" là một quyết
// định về ĐÚNG/SAI, không phải về giao diện — nó xứng đáng có test riêng.

/** Trường sửa được, đúng thứ tự hiển thị. Phải khớp `TRUONG_SUA_DUOC` ở backend. */
export const TRUONG = [
  { khoa: "firstname", nhan: "Tên", loai: "text", toiDa: 100 },
  { khoa: "lastname", nhan: "Họ", loai: "text", toiDa: 100 },
  { khoa: "phone", nhan: "Điện thoại", loai: "tel", toiDa: 20 },
  { khoa: "gender", nhan: "Giới tính", loai: "gender" },
  { khoa: "dob", nhan: "Ngày sinh", loai: "date" },
  { khoa: "pob", nhan: "Nơi sinh", loai: "text", toiDa: 150 },
  { khoa: "province", nhan: "Tỉnh/Thành phố", loai: "text", toiDa: 150 },
  { khoa: "website", nhan: "Website", loai: "url", toiDa: 200 },
  { khoa: "intro", nhan: "Giới thiệu", loai: "textarea", toiDa: 500 },
];

export const KHOA_SUA_DUOC = TRUONG.map((t) => t.khoa);

export const GIOI_TINH = [
  { gia_tri: "", nhan: "Không nêu" },
  { gia_tri: "0", nhan: "Nữ" },
  { gia_tri: "1", nhan: "Nam" },
];

/** `yyyy-mm-dd` — định dạng của NKS, và cũng là định dạng `<input type="date">` trả về. */
const NGAY_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ngày hợp lệ chưa?
 *
 * Kiểm bằng `Date.UTC` rồi so lại từng phần, KHÔNG dùng `new Date(chuoi)`: bộ phân
 * tích của trình duyệt chấp nhận đủ thứ theo locale ("03/05/2020" là ngày nào tuỳ
 * nơi) và tự cuộn ngày tràn ("2024-02-31" thành 02-03). Ở đây chỉ có một định dạng.
 */
export function ngayHopLe(s) {
  if (!NGAY_ISO.test(String(s || ""))) return false;
  const [n, t, ng] = String(s).split("-").map(Number);
  if (t < 1 || t > 12 || ng < 1 || ng > 31) return false;
  const d = new Date(Date.UTC(n, t - 1, ng));
  return d.getUTCFullYear() === n && d.getUTCMonth() === t - 1 && d.getUTCDate() === ng;
}

/** Ngày ISO để đọc: `2004-08-18` → `18/08/2004`. Chỉ để HIỂN THỊ, không quay ngược. */
export function ngayDeDoc(iso) {
  if (!ngayHopLe(iso)) return "";
  const [n, t, ng] = String(iso).split("-");
  return `${ng}/${t}/${n}`;
}

/** Hồ sơ từ máy chủ → giá trị biểu mẫu. Mọi ô đều là CHUỖI — input không nhận null. */
export function tuHoSo(hoSo) {
  const ra = {};
  for (const { khoa } of TRUONG) {
    const v = hoSo?.[khoa];
    ra[khoa] = v === null || v === undefined ? "" : String(v);
  }
  return ra;
}

/** Biểu mẫu có khác bản gốc không? */
export function coThayDoi(goc, hienTai) {
  return KHOA_SUA_DUOC.some((k) => (goc?.[k] ?? "") !== (hienTai?.[k] ?? ""));
}

/**
 * Chỉ những ô ĐÃ ĐỔI, đã ép về kiểu của API.
 *
 * Gửi cả biểu mẫu cũng chạy, nhưng gửi thừa nghĩa là ghi đè những ô người dùng không
 * đụng tới bằng giá trị mình vừa đọc — và nếu ai đó sửa hồ sơ ở NKS trong lúc form
 * đang mở thì thay đổi của họ bị nuốt mất.
 *
 * Ô trống ⇒ `null` ⇒ backend gửi chuỗi rỗng ⇒ xoá trắng được thật.
 */
export function veThayDoi(goc, hienTai) {
  const ra = {};
  for (const k of KHOA_SUA_DUOC) {
    const cu = goc?.[k] ?? "";
    const moi = hienTai?.[k] ?? "";
    if (cu === moi) continue;
    if (moi === "") ra[k] = null;
    else if (k === "gender") ra[k] = Number(moi);
    else ra[k] = String(moi).trim();
  }
  return ra;
}

/**
 * Lỗi nhập liệu, `{ khoa: "câu tiếng Việt" }`. Rỗng = hợp lệ.
 *
 * Cố ý DỄ TÍNH: NKS là nơi kiểm cuối cùng, và chặn ở đây quá tay sẽ khiến người dùng
 * không sửa nổi một giá trị mà NKS vốn chấp nhận. Chỉ chặn những gì chắc chắn sai.
 */
export function kiemTra(form) {
  const loi = {};
  for (const { khoa, nhan, toiDa } of TRUONG) {
    const v = String(form?.[khoa] ?? "");
    if (toiDa && v.length > toiDa) loi[khoa] = `${nhan} tối đa ${toiDa} ký tự.`;
  }

  const dob = String(form?.dob ?? "");
  if (dob && !ngayHopLe(dob)) {
    loi.dob = "Ngày sinh chưa hợp lệ (yyyy-mm-dd).";
  } else if (dob && dob > new Date().toISOString().slice(0, 10)) {
    loi.dob = "Ngày sinh không thể ở tương lai.";
  }

  const phone = String(form?.phone ?? "").trim();
  if (phone && !/^[\d\s+().-]{6,20}$/.test(phone)) {
    loi.phone = "Điện thoại chỉ gồm chữ số và các ký tự + ( ) - . khoảng trắng.";
  }

  const web = String(form?.website ?? "").trim();
  if (web && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(web)) {
    loi.website = "Website phải bắt đầu bằng http:// hoặc https://";
  }

  const gt = String(form?.gender ?? "");
  if (gt !== "" && gt !== "0" && gt !== "1") loi.gender = "Giới tính không hợp lệ.";

  return loi;
}

/** Thông điệp cho từng mã lỗi của máy chủ. `grant_required` KHÔNG có ở đây — nó không
 *  phải lỗi để đọc, mà là tín hiệu để mở lại hộp xác minh. */
export function loiDeDoc(code, status) {
  if (code === "invalid_field") return "Có trường không hợp lệ. Vui lòng kiểm tra lại.";
  if (code === "provider_unavailable") return "NKS đang không phản hồi. Vui lòng thử lại sau.";
  if (code === "provider_protocol_error") return "NKS trả về dữ liệu không đọc được.";
  if (code === "provider_not_enabled") return "Đăng nhập NKS chưa được bật.";
  if (code === "rate_limited") return "Bạn thử quá nhiều lần. Vui lòng đợi một chút.";
  if (code === "invalid_credentials") return "Tài khoản hoặc mật khẩu NKS không đúng.";
  if (status === 0) return "Không kết nối được máy chủ.";
  return "Không lưu được thay đổi. Vui lòng thử lại.";
}
