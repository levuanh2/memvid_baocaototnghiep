import { useRef } from "react";
import Avatar from "../ui/Avatar";
import { Icon } from "../ui/Icon";
import { LOAI_CHO_PHEP } from "../../auth/anhDaiDienFile";

/**
 * Chọn và xác nhận ảnh đại diện — thuần hiển thị, không state, không mạng.
 *
 * `xemTruoc` là một object URL sống trong bộ nhớ của trình duyệt: ảnh chưa lưu KHÔNG
 * rời khỏi máy người dùng cho tới khi họ bấm "Lưu ảnh". Huỷ ⇒ ảnh cũ hiện lại nguyên vẹn.
 */
export default function AvatarPicker({
  avatar, chuCai, xemTruoc, dangLuu, loi, onChon, onLuu, onHuy,
}) {
  const oFile = useRef(null);

  return (
    <div className="flex items-center gap-4">
      <Avatar src={xemTruoc || avatar} chuCai={chuCai} size={72} />

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
              onClick={() => oFile.current?.click()}
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
                className="btn-seal !py-1.5 !text-[13px] inline-flex items-center gap-1.5"
              >
                {dangLuu && <Icon name="Clock" size={14} />}
                {dangLuu ? "Đang tải lên…" : "Lưu ảnh"}
              </button>
              <button
                type="button"
                onClick={onHuy}
                disabled={dangLuu}
                className="btn-secondary !py-1.5 !text-[13px]"
              >
                Huỷ
              </button>
            </>
          )}
        </div>

        <p className="mt-1.5 text-[11.5px] text-text-muted">
          {xemTruoc ? "Ảnh chưa được lưu." : "JPG, PNG hoặc WEBP. Ảnh sẽ được thu nhỏ về 512px."}
        </p>

        {loi && (
          <p role="alert" className="mt-1 text-[11.5px]" style={{ color: "var(--err)" }}>
            {loi}
          </p>
        )}
      </div>
    </div>
  );
}
