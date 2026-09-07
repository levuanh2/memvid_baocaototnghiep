import { useCallback, useState } from "react";
import { toast } from "../ui/Toaster";
import ProfileView from "./ProfileView";
import NksVerifyDialog from "./NksVerifyDialog";
import ProfileEditForm from "./ProfileEditForm";
import { coThayDoi, kiemTra, loiDeDoc, tuHoSo, veThayDoi } from "../../auth/hoSoForm";
import { layGrant, luuGrant, quenGrant } from "../../auth/grantNks";
import { capNhatHoSoNks, layHoSoNks, taoGrantNks } from "../../utils/api";

/**
 * Ngăn hồ sơ — đọc, và (với tài khoản NKS) sửa.
 *
 * Phần ĐỌC vẽ từ `hoSo` đã dựng sẵn ở `auth/hoSoNguoiDung.js`, không gọi mạng: mở
 * ngăn ra không được sinh một request nào.
 *
 * Phần SỬA mới gọi mạng, và chỉ khi người dùng bấm "Chỉnh sửa". Đường đi:
 *
 *   Chỉnh sửa → có chứng từ? → không: hỏi mật khẩu NKS → POST /auth/nks/grant
 *             → GET  /me/nks/profile   (giá trị hiện tại, nguồn sự thật)
 *             → PATCH /me/nks/profile  (máy chủ ghi rồi TỰ ĐỌC LẠI)
 *             → cập nhật hồ sơ trên màn hình
 *
 * Chứng từ hết hạn giữa chừng ⇒ máy chủ trả `grant_required` ⇒ mở lại hộp xác minh
 * và GIỮ NGUYÊN những gì đang gõ dở. Không bao giờ im lặng vứt phần đã sửa.
 */
export default function ProfileDrawer({ open, hoSo, onClose, onHoSoMoi }) {
  const [dangSua, setDangSua] = useState(false);
  const [form, setForm] = useState(null);
  const [goc, setGoc] = useState(null);
  const [loi, setLoi] = useState({});
  const [dangTai, setDangTai] = useState(false);
  const [dangLuu, setDangLuu] = useState(false);
  const [hoiMatKhau, setHoiMatKhau] = useState(false);
  const [dangXacMinh, setDangXacMinh] = useState(false);
  const [loiXacMinh, setLoiXacMinh] = useState("");
  //: Việc phải làm NGAY SAU khi có chứng từ: "mo" (mở form) hoặc "luu" (lưu tiếp).
  const [viecCho, setViecCho] = useState(null);

  const laNks = hoSo?.nhaCungCap === "NKS";

  const dongHet = useCallback(() => {
    setDangSua(false); setForm(null); setGoc(null); setLoi({});
    setHoiMatKhau(false); setLoiXacMinh(""); setViecCho(null);
    onClose?.();
  }, [onClose]);

  /** Tải giá trị hiện tại rồi mở form. Bản gốc để so là bản VỪA ĐỌC, không phải bản cũ. */
  const moForm = useCallback(async (grantId) => {
    setDangTai(true);
    try {
      const v = tuHoSo(await layHoSoNks(grantId));
      setGoc(v); setForm(v); setLoi({}); setDangSua(true);
      return true;
    } catch (err) {
      if (err?.code === "grant_required") { quenGrant(); setViecCho("mo"); setHoiMatKhau(true); return false; }
      toast(loiDeDoc(err?.code, err?.status), { type: "error" });
      return false;
    } finally {
      setDangTai(false);
    }
  }, []);

  const batDauSua = useCallback(async () => {
    if (dangTai || dangLuu) return;               // chặn bấm nhiều lần
    const g = layGrant();
    if (g) { await moForm(g); return; }
    setViecCho("mo"); setLoiXacMinh(""); setHoiMatKhau(true);
  }, [dangTai, dangLuu, moForm]);

  const luu = useCallback(async (grantId) => {
    if (!form || !goc) return false;
    const l = kiemTra(form);
    setLoi(l);
    if (Object.keys(l).length) return false;

    const thayDoi = veThayDoi(goc, form);
    if (!Object.keys(thayDoi).length) { setDangSua(false); return true; }

    setDangLuu(true);
    try {
      const moi = await capNhatHoSoNks(grantId, thayDoi);
      // Bản đi ra từ máy chủ là bản ĐỌC LẠI từ NKS — không phải thứ vừa gửi lên. Nên
      // đây mới là giá trị đáng tin để vẽ, kể cả khi NKS đã chuẩn hoá lại.
      onHoSoMoi?.(moi);
      setGoc(tuHoSo(moi));
      setDangSua(false);
      toast("Đã lưu hồ sơ.", { type: "success" });
      return true;
    } catch (err) {
      if (err?.code === "grant_required") {
        // Chứng từ chết. GIỮ NGUYÊN `form` — người dùng không mất chữ nào.
        quenGrant(); setViecCho("luu"); setLoiXacMinh(""); setHoiMatKhau(true);
        return false;
      }
      toast(loiDeDoc(err?.code, err?.status), { type: "error" });
      return false;
    } finally {
      setDangLuu(false);
    }
  }, [form, goc, onHoSoMoi]);

  const xacMinh = useCallback(async ({ identifier, password }) => {
    if (dangXacMinh) return;                      // chặn gửi trùng
    setDangXacMinh(true); setLoiXacMinh("");
    try {
      const { grant_id, expires_at } = await taoGrantNks({ identifier, password });
      luuGrant(grant_id, expires_at);
      setHoiMatKhau(false);
      if (viecCho === "luu") await luu(grant_id);
      else await moForm(grant_id);
      setViecCho(null);
    } catch (err) {
      setLoiXacMinh(loiDeDoc(err?.code, err?.status));
    } finally {
      setDangXacMinh(false);
    }
  }, [dangXacMinh, viecCho, luu, moForm]);

  if (!open || !hoSo) return null;

  const banDoi = form && goc && coThayDoi(goc, form);

  return (
    <>
      <ProfileView
        hoSo={hoSo}
        onClose={dangLuu ? undefined : dongHet}
        laNks={laNks}
        dangSua={dangSua}
        dangTai={dangTai}
        onSua={batDauSua}
        rongHon={dangSua}
      >
        {dangSua && form && (
          <ProfileEditForm
            form={form}
            loi={loi}
            dangLuu={dangLuu}
            coThayDoi={banDoi}
            onDoi={(k, v) => {
              setForm((f) => ({ ...f, [k]: v }));
              setLoi((l) => (l[k] ? { ...l, [k]: undefined } : l));
            }}
            onLuu={() => luu(layGrant())}
            onHuy={() => { setForm(goc); setLoi({}); setDangSua(false); }}
          />
        )}
      </ProfileView>

      <NksVerifyDialog
        open={hoiMatKhau}
        email={hoSo.email}
        dangGui={dangXacMinh}
        loi={loiXacMinh}
        onXacNhan={xacMinh}
        onClose={() => { setHoiMatKhau(false); setViecCho(null); setLoiXacMinh(""); }}
      />
    </>
  );
}
