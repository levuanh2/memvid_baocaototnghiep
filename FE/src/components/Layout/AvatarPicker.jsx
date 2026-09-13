import { useRef } from "react";
import Avatar from "../ui/Avatar";
import { Icon } from "../ui/Icon";
import { LOAI_CHO_PHEP } from "../../auth/anhDaiDienFile";

/**
 * Chọn và xác nhận ảnh đại diện — thuần hiển thị, không state, không mạng.
 *
 * `xemTruoc` là một object URL sống trong bộ nhớ của trình duyệt: ảnh chưa lưu KHÔNG
 * rời khỏi máy người dùng cho tới khi họ bấm "Lưu ảnh". Huỷ ⇒ ảnh cũ hiện lại nguyên vẹn.
 *
 * Chính tấm ảnh là nút bấm — đó là chỗ người ta thử bấm đầu tiên. Nút "Đổi ảnh" bên
 * cạnh vẫn giữ nguyên: một vùng bấm hình tròn không có nhãn thì trình đọc màn hình
 * lẫn người mới dùng đều không đoán ra, nên nhãn chữ là đường đi được bảo đảm còn
 * ảnh là đường đi nhanh.
 *
 * Dùng `<button>` thật chứ không phải `<div onClick>`: Enter và Space, thứ tự tab,
 * vòng focus và `disabled` đều có sẵn từ trình duyệt. Tự dựng lại bằng `onKeyDown`
 * là viết lại thứ nền tảng đã làm đúng, và thường quên mất một nửa.
 */
export default function AvatarPicker({
  avatar, chuCai, xemTruoc, dangLuu, loi, onChon, onLuu, onHuy,
}) {
  const oFile = useRef(null);

  const moChonAnh = () => oFile.current?.click();

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={moChonAnh}
        disabled={dangLuu}
        aria-label={xemTruoc ? "Chọn ảnh đại diện khác" : "Đổi ảnh đại diện"}
        title="Đổi ảnh đại diện"
        className="group relative rounded-full flex-shrink-0 transition-theme
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
                   disabled:cursor-not-allowed enabled:cursor-pointer"
        style={{ "--tw-ring-color": "var(--accent)", "--tw-ring-offset-color": "var(--bg-card)" }}
      >
        <Avatar src={xemTruoc || avatar} chuCai={chuCai} size={72} />
        {/* Lớp phủ chỉ là gợi ý: hiện khi rê chuột hoặc khi focus bằng bàn phím, để
            người đi bằng Tab cũng thấy đúng thứ người đi bằng chuột thấy. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full flex items-center
                     justify-center opacity-0 transition-opacity duration-150
                     group-hover:opacity-100 group-focus-visible:opacity-100"
          style={{ background: "rgba(0,0,0,0.45)", color: "#fff" }}
        >
          <Icon name="ImagePlus" size={20} />
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <input
          ref={oFile}
          type="file"
          accept={LOAI_CHO_PHEP.join(",")}
          className="hidden"
          disabled={dangLuu}
          onChange={(e) => {
            const f = e.target.files?.[0];
            // Xoá value để chọn LẠI đúng file vừa chọn vẫn kích hoạt `change`.
            e.target.value = "";
            if (f) onChon(f);
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          {!xemTruoc ? (
            <button
              type="button"
              onClick={moChonAnh}
              disabled={dangLuu}
              className="pill-action"
            >
              <Icon name="ImagePlus" size={14} /> Đổi ảnh
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onLuu}
                disabled={dangLuu}
                className="btn-seal !py-1.5 !text-small inline-flex items-center gap-1.5"
              >
                {dangLuu && <Icon name="Clock" size={14} />}
                {dangLuu ? "Đang tải lên…" : "Lưu ảnh"}
              </button>
              <button
                type="button"
                onClick={onHuy}
                disabled={dangLuu}
                className="btn-secondary !py-1.5 !text-small"
              >
                Huỷ
              </button>
            </>
          )}
        </div>

        <p className="mt-1.5 text-caption text-text-muted">
          {xemTruoc ? "Ảnh chưa được lưu." : "JPG, PNG hoặc WEBP. Ảnh sẽ được thu nhỏ về 512px."}
        </p>

        {loi && (
          <p role="alert" className="mt-1 text-caption" style={{ color: "var(--err)" }}>
            {loi}
          </p>
        )}
      </div>
    </div>
  );
}
