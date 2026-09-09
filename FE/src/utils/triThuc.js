// Phép chiếu tri thức cho thẻ học tập.  Giữ phần chọn dữ liệu ở đây để thẻ không
// tự tạo placeholder khi một payload cũ chưa có khối `knowledge`.
import { boDau } from "./thuVienTaiLieu";

const NHAN_TRANG_THAI = {
  untouched: "Chưa mở",
  indexed: "Đã lập chỉ mục",
  explored: "Đã xem",
  in_progress: "Đang học",
  mastered: "Đã nắm vững",
};

const NHAN_ARTIFACT = {
  summary: "Tóm tắt",
  mindmap: "Sơ đồ tư duy",
  studymap: "Bản đồ học tập",
  quiz: "Quiz",
  review: "Ôn tập",
  index: "Lập chỉ mục",
};

const mang = (value) => (Array.isArray(value) ? value : []);
const chuoi = (value) => (typeof value === "string" ? value.trim() : "");
const triThuc = (doc) => (doc?.knowledge && typeof doc.knowledge === "object" ? doc.knowledge : null);

export function coTriThuc(doc) {
  const knowledge = triThuc(doc);
  if (!knowledge) return false;
  return mang(knowledge.takeaways).length > 0
    || mang(knowledge.topics).length > 0
    || mang(knowledge.keywords).length > 0
    || mang(knowledge.entities).length > 0
    || (knowledge.readiness && typeof knowledge.readiness === "object"
      && Object.hasOwn(knowledge.readiness, "total"))
    || Boolean(chuoi(knowledge.learning_status));
}

export function yChinh(doc, { gioiHan = 3 } = {}) {
  const limit = Math.max(0, Number(gioiHan) || 0);
  return mang(triThuc(doc)?.takeaways)
    .map(chuoi)
    .filter(Boolean)
    .slice(0, limit);
}

export function chuDeNoiBat(doc, { gioiHan = 6 } = {}) {
  const limit = Math.max(0, Number(gioiHan) || 0);
  return mang(triThuc(doc)?.topics)
    .filter((topic) => topic && chuoi(topic.name))
    .map((topic) => {
      const mastery = Number.isFinite(Number(topic.mastery)) ? Number(topic.mastery) : null;
      const status = chuoi(topic.status) || null;
      return {
        name: chuoi(topic.name),
        weight: Number(topic.weight) || 0,
        mastery,
        status,
        yeu: status === "weak" || (mastery != null && mastery < 0.5),
      };
    })
    .sort((left, right) => Number(right.yeu) - Number(left.yeu)
      || right.weight - left.weight
      || boDau(left.name).localeCompare(boDau(right.name)))
    .slice(0, limit);
}

export function nhanTrangThaiHoc(status) {
  return NHAN_TRANG_THAI[status] || (status == null ? "" : String(status));
}

export function nhanSanSang(readiness) {
  const source = readiness && typeof readiness === "object" ? readiness : {};
  const phanTram = Math.max(0, Math.min(100, Number(source.total) || 0));
  let nhan = phanTram >= 80 ? "Sẵn sàng học" : phanTram >= 50 ? "Đang chuẩn bị" : "Chưa sẵn sàng";
  if (source.mastery_available === false) nhan += "; chưa đánh giá mức độ nắm vững";
  return {
    phanTram,
    nhan,
    thieu: mang(source.missing).map((item) => NHAN_ARTIFACT[item] || String(item)).filter(Boolean),
  };
}

export function mucTrongThe(doc) {
  const sections = [];
  const ai = doc?.ai && typeof doc.ai === "object" ? doc.ai : null;
  const coSieuDuLieu = [doc?.reading_minutes, doc?.page_count, doc?.chunk_count, doc?.language]
    .some((value) => value != null && value !== "");

  if (yChinh(doc).length) sections.push("yChinh");
  if (chuoi(ai?.summary?.preview)) sections.push("tomTat");
  if (chuDeNoiBat(doc).length) sections.push("chuDe");
  if (ai && Object.keys(ai).length) sections.push("chip");
  if (coSieuDuLieu) sections.push("sieuDuLieu");
  if (doc?.document_id) sections.push("hanhDong");
  return sections;
}

export function timTheoTriThuc(doc, truyVan) {
  const query = boDau(truyVan);
  if (!query) return true;
  const knowledge = triThuc(doc);
  if (!knowledge) return false;
  const values = [
    ...mang(knowledge.topics).map((topic) => topic?.name),
    ...mang(knowledge.keywords),
    ...mang(knowledge.entities),
  ].map(chuoi).filter(Boolean);
  return boDau(values.join(" ")).includes(query);
}
