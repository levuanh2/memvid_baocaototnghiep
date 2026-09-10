// Tài liệu liên quan — suy diễn THUẦN từ payload `/api/library` đã có trong bộ nhớ.
// KHÔNG có điểm tương đồng vector: tầng này chưa có FAISS/embedding similarity, và
// bịa một con số "độ liên quan" từ việc đếm thẻ trùng sẽ đọc như một phép đo thật
// trong khi không phải — nên không có trường điểm số nào ở đây.
//
// Lý do trả về METADATA có cấu trúc {source, value} — cùng khuôn với câu hỏi gợi ý
// (`cauHoiGoiY.js`), không phải chuỗi đã dịch sẵn ("Cùng chủ đề"): tầng UI tự quyết
// định cách hiển thị, hàm này chỉ suy luận dữ kiện.
import { boDau } from "./thuVienTaiLieu";

const GIOI_HAN_LY_DO = 4;

const khoaChuDe = (name) => boDau(name);
const khoaThe = (tag) => boDau(tag);

const mang = (value) => (Array.isArray(value) ? value : []);

/**
 * `documents`: mảng tài liệu ĐÃ có trong bộ nhớ (payload `/api/library`), KHÔNG bị
 * đổi — không `sort`/`reverse`/`splice` trên nó, chỉ đọc.
 * `chiMucBst`: Map {collection_id: bộ sưu tập}, dùng để tra TÊN. Không truyền vào
 * thì tín hiệu "cùng bộ sưu tập" bị bỏ qua hẳn — trả về collection_id thô không
 * phải một `value` có nghĩa với người đọc.
 */
export function taiLieuLienQuan(doc, documents, { chiMucBst = null, toiDa = 3 } = {}) {
  if (!doc?.document_id || !Array.isArray(documents)) return [];

  const tapChuDe = new Set(
    mang(doc?.knowledge?.topics).map((t) => khoaChuDe(t?.name)).filter(Boolean));
  const tapThe = new Set(mang(doc?.tags).map(khoaThe).filter(Boolean));

  const ungVien = [];
  for (const other of documents) {
    if (!other?.document_id || other.document_id === doc.document_id) continue;

    const lyDo = [];
    let trongSo = 0;

    if (doc.collection_id && chiMucBst && other.collection_id === doc.collection_id) {
      const ten = chiMucBst.get(other.collection_id)?.name;
      if (ten) {
        lyDo.push({ source: "collection", value: ten });
        trongSo += 2;   // tín hiệu mạnh hơn một thẻ hay một chủ đề đơn lẻ
      }
    }

    for (const topic of mang(other?.knowledge?.topics)) {
      if (tapChuDe.has(khoaChuDe(topic?.name))) {
        lyDo.push({ source: "topic", value: topic.name });
        trongSo += 1;
      }
    }

    for (const tag of mang(other?.tags)) {
      if (tapThe.has(khoaThe(tag))) {
        lyDo.push({ source: "tag", value: tag });
        trongSo += 1;
      }
    }

    if (trongSo > 0) ungVien.push({ doc: other, lyDo, trongSo });
  }

  return ungVien
    .sort((a, b) => b.trongSo - a.trongSo
      || String(a.doc.document_id).localeCompare(String(b.doc.document_id)))
    .slice(0, Math.max(0, toiDa))
    .map(({ doc: taiLieu, lyDo }) => ({ doc: taiLieu, reason: lyDo.slice(0, GIOI_HAN_LY_DO) }));
}
