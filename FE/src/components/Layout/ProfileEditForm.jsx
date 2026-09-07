import { Icon } from "../ui/Icon";
import { TRUONG, GIOI_TINH } from "../../auth/hoSoForm";

/**
 * Biểu mẫu sửa hồ sơ — thuần hiển thị. Không state, không mạng, không hook.
 *
 * Mọi quyết định (giá trị nào đổi, ô nào sai, có gửi được không) đã tính xong ở
 * `hoSoForm.js` và ở `ProfileDrawer`. Ở đây chỉ vẽ.
 *
 * KHÔNG có ô "Tên hiển thị": đo thật cho thấy `name` của NKS độc lập với
 * firstname/lastname, và endpoint ghi không có tham số nào đặt được nó. Một ô sửa
 * được rồi lặng lẽ không lưu là đúng lỗi "nút bấm không gọi gì cả" trong `.playbook`.
 */
export default function ProfileEditForm({ form, loi, dangLuu, onDoi, onLuu, onHuy, coThayDoi }) {
  const o = (t) => {
    const idLoi = `loi-${t.khoa}`;
    const chung = {
      id: `hs-${t.khoa}`,
      value: form[t.khoa] ?? "",
      disabled: dangLuu,
      onChange: (e) => onDoi(t.khoa, e.target.value),
      "aria-invalid": loi[t.khoa] ? true : undefined,
      "aria-describedby": loi[t.khoa] ? idLoi : undefined,
      className: "input-surface text-[14px] mt-1.5",
    };
    if (t.loai === "gender") {
      return (
        <select {...chung}>
          {GIOI_TINH.map((g) => <option key={g.gia_tri} value={g.gia_tri}>{g.nhan}</option>)}
        </select>
      );
    }
    if (t.loai === "textarea") {
      return <textarea {...chung} rows={3} maxLength={t.toiDa} className={`${chung.className} resize-y`} />;
    }
    // `type="date"` là bộ chọn ngày của chính trình duyệt, và giá trị nó trả về LUÔN
    // là `yyyy-mm-dd` — đúng định dạng NKS. Không có phép phân tích theo locale nào ở
    // giữa, nên không có ca "03/05" là tháng Ba hay tháng Năm.
    return <input {...chung} type={t.loai} maxLength={t.toiDa} />;
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onLuu(); }}
      className="mt-6 pt-5 border-t"
      style={{ borderColor: "var(--border-color)" }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
        {TRUONG.map((t) => (
          <div key={t.khoa} className={t.loai === "textarea" ? "sm:col-span-2" : ""}>
            <label htmlFor={`hs-${t.khoa}`}
              className="font-mono text-[10.5px] tracking-[0.14em] uppercase text-text-muted">
              {t.nhan}
            </label>
            {o(t)}
            {loi[t.khoa] && (
              <p id={`loi-${t.khoa}`} role="alert" className="mt-1 text-[11.5px]"
                style={{ color: "var(--err)" }}>
                {loi[t.khoa]}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 justify-end mt-5">
        <button type="button" onClick={onHuy} disabled={dangLuu}
          className="btn-secondary !py-1.5 !text-[13px]">
          Huỷ
        </button>
        <button type="submit" disabled={dangLuu || !coThayDoi}
          className="btn-seal !py-1.5 !text-[13px] inline-flex items-center gap-1.5">
          {dangLuu && <Icon name="Clock" size={14} />}
          {dangLuu ? "Đang lưu…" : "Lưu thay đổi"}
        </button>
      </div>
    </form>
  );
}
