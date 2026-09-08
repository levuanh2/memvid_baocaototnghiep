import { useCallback, useState } from "react";
import { toast } from "../ui/Toaster";
import ProfileView from "./ProfileView";
import NksVerifyDialog from "./NksVerifyDialog";
import ProfileEditForm from "./ProfileEditForm";
import AvatarPicker from "./AvatarPicker";
import { coThayDoi, kiemTra, loiDeDoc, tuHoSo, veThayDoi } from "../../auth/hoSoForm";
import { kiemTraFile, thuNhoAnh, AnhKhongHopLe } from "../../auth/anhDaiDienFile";
import { layGrant, luuGrant, quenGrant } from "../../auth/grantNks";
import { capNhatHoSoNks, doiAnhDaiDienNks, layHoSoNks, taoGrantNks } from "../../utils/api";

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
  //: Việc phải làm NGAY SAU khi có chứng từ: "mo" (mở form), "luu" (lưu hồ sơ),
  //: hoặc "anh" (tải ảnh đang chờ). Nhờ nó, chứng từ hết hạn giữa chừng KHÔNG làm
  //: mất phần người dùng đang dở — kể cả tấm ảnh họ vừa chọn.
  const [viecCho, setViecCho] = useState(null);

  // Ảnh đang chờ lưu. `blob` là ảnh đã thu nhỏ; `url` là object URL để xem trước.
  // Cả hai chỉ sống trong bộ nhớ trang — ảnh chưa lưu không rời khỏi máy người dùng.
  const [anhCho, setAnhCho] = useState(null);
  const [dangTaiAnh, setDangTaiAnh] = useState(false);
  const [loiAnh, setLoiAnh] = useState("");

  const laNks = hoSo?.nhaCungCap === "NKS";

  /** Trả object URL về hệ thống — không làm thì mỗi lần chọn ảnh rò một khối bộ nhớ. */
  const boAnhCho = useCallback(() => {
    setAnhCho((cu) => {
      if (cu?.url) URL.revokeObjectURL(cu.url);
      return null;
    });
    setLoiAnh("");
  }, []);

  const dongHet = useCallback(() => {
    setDangSua(false); setForm(null); setGoc(null); setLoi({});
    setHoiMatKhau(false); setLoiXacMinh(""); setViecCho(null);
    boAnhCho();
    onClose?.();
  }, [onClose, boAnhCho]);

  /** Chọn ảnh: kiểm, thu nhỏ, xem trước. CHƯA gửi đi đâu cả. */
  const chonAnh = useCallback(async (file) => {
    const loiFile = kiemTraFile(file);
    if (loiFile) { setLoiAnh(loiFile); return; }
    setLoiAnh("");
    try {
      const blob = await thuNhoAnh(file);
      setAnhCho((cu) => {
        if (cu?.url) URL.revokeObjectURL(cu.url);
        return { blob, url: URL.createObjectURL(blob) };
      });
    } catch (err) {
      setLoiAnh(err instanceof AnhKhongHopLe ? err.message : "Không xử lý được ảnh.");
    }
  }, []);

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

  const luuAnh = useCallback(async (grantId) => {
    if (!anhCho || dangTaiAnh) return false;      // chặn gửi trùng
    setDangTaiAnh(true); setLoiAnh("");
    try {
      const moi = await doiAnhDaiDienNks(grantId, anhCho.blob);
      // URL đi ra từ máy chủ là URL ĐỌC LẠI từ provider — provider tự đặt tên file.
      onHoSoMoi?.(moi);
      boAnhCho();
      toast("Đã đổi ảnh đại diện.", { type: "success" });
      return true;
    } catch (err) {
      if (err?.code === "grant_required") {
        // GIỮ NGUYÊN `anhCho` — người dùng không phải chọn lại ảnh.
        quenGrant(); setViecCho("anh"); setLoiXacMinh(""); setHoiMatKhau(true);
        return false;
      }
      // Thất bại ⇒ ảnh cũ vẫn hiện, vì `hoSo.avatar` chưa hề bị đụng tới.
      setLoiAnh(loiDeDoc(err?.code, err?.status));
      return false;
    } finally {
      setDangTaiAnh(false);
    }
  }, [anhCho, dangTaiAnh, onHoSoMoi, boAnhCho]);

  const batDauLuuAnh = useCallback(async () => {
    const g = layGrant();
    if (g) { await luuAnh(g); return; }
    setViecCho("anh"); setLoiXacMinh(""); setHoiMatKhau(true);
  }, [luuAnh]);

  const xacMinh = useCallback(async ({ identifier, password }) => {
    if (dangXacMinh) return;                      // chặn gửi trùng
    setDangXacMinh(true); setLoiXacMinh("");
    try {
      const { grant_id, expires_at } = await taoGrantNks({ identifier, password });
      luuGrant(grant_id, expires_at);
      setHoiMatKhau(false);
      if (viecCho === "anh") await luuAnh(grant_id);
      else if (viecCho === "luu") await luu(grant_id);
      else await moForm(grant_id);
      setViecCho(null);
    } catch (err) {
      setLoiXacMinh(loiDeDoc(err?.code, err?.status));
    } finally {
      setDangXacMinh(false);
    }
  }, [dangXacMinh, viecCho, luu, moForm, luuAnh]);

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
        khoiAnh={laNks ? (
          <AvatarPicker
            avatar={hoSo.avatar}
            chuCai={hoSo.chuCai}
            xemTruoc={anhCho?.url}
            dangLuu={dangTaiAnh}
            loi={loiAnh}
            onChon={chonAnh}
            onLuu={batDauLuuAnh}
            onHuy={boAnhCho}
          />
        ) : null}
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
