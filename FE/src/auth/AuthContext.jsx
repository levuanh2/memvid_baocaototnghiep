import { useCallback, useEffect, useRef, useState } from "react";
import { registerUser, loginUser, logoutUser, getCurrentUser } from "../utils/api";
import { getToken, setToken, clearToken } from "./tokenStore";
import { installUnauthorizedHandler } from "./authEvents";
import { caiDatKiemTraKhoiPhuc } from "./khoiPhucBfcache";
import { xoaDuLieuPhienNguoiDung } from "./phienNguoiDung";
import { quenGrant } from "./grantNks";
import { AuthContext } from "./context";

// Map backend error codes → friendly Vietnamese messages for the forms.
function friendlyError(err) {
  const code = err?.code || "";
  if (code === "invalid_credentials") return "Email hoặc mật khẩu không đúng.";
  if (code === "email_exists") return "Email này đã được đăng ký.";
  if (code === "invalid_email") return "Email chưa hợp lệ.";
  if (code === "weak_password") return "Mật khẩu cần ít nhất 8 ký tự.";
  if (code === "rate_limited") return "Bạn thử quá nhiều lần. Vui lòng đợi một chút.";
  if (err?.status === 0 || err?.name === "TypeError") return "Không kết nối được máy chủ.";
  return "Đã có lỗi xảy ra. Vui lòng thử lại.";
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Listener `pageshow` đăng ký MỘT lần nhưng phải đọc được người dùng ở thời điểm
  // sự kiện xảy ra. Đọc qua ref, không đóng gói giá trị lúc đăng ký — nếu không nó
  // mãi mãi so với `null` của lần render đầu.
  const userRef = useRef(null);
  userRef.current = user;

  // Restore session on mount: if a token exists, validate it via /auth/me.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!getToken()) {
        // Không có phiên ⇒ không được còn state của phiên nào. Ca thật: token của A
        // hết hạn và bị `getCurrentUser` xoá ở một lần tải trước, nhưng tên tài liệu
        // của A vẫn nằm trong localStorage; B đăng nhập sau đó là thấy chúng.
        xoaDuLieuPhienNguoiDung();
        if (alive) setLoading(false);
        return;
      }
      try {
        const u = await getCurrentUser(); // null on 401 (clears token)
        // `/auth/me` khớp `AUTH_PATH_RE` nên 401 ở ĐÂY **không** phát
        // `auth:unauthorized` — cố ý, vì lượt thăm dò phiên không được kéo theo một
        // vòng đăng xuất toàn cục. Hệ quả là nhánh dọn kia không bao giờ chạy cho
        // token hết hạn, nên phải dọn tại chỗ.
        if (!u) xoaDuLieuPhienNguoiDung();
        if (alive) setUser(u || null);
      } catch {
        clearToken();
        xoaDuLieuPhienNguoiDung();
        if (alive) setUser(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Global sign-out signal: apiFetch fires `auth:unauthorized` when a protected app
  // API returns 401 (expired/invalid token) → clear the token and drop the user so
  // ProtectedRoute redirects to /login?next=<current>.
  // Hết phiên vì token hỏng/hết hạn cũng là ĐỔI NGƯỜI DÙNG dưới góc nhìn của trình
  // duyệt này — dọn y như đăng xuất chủ động, nếu không thì đường "token hết hạn"
  // vẫn để lại đúng những gì đường đăng xuất vừa được sửa để xoá.
  useEffect(() => installUnauthorizedHandler(() => {
    xoaDuLieuPhienNguoiDung();
    setUser(null);
  }), []);

  // Trang được khôi phục từ bfcache: React không mount lại nên KHÔNG hàng rào nào
  // ở trên chạy, và giao diện cũ của người dùng trước vẫn nằm nguyên trên màn hình.
  // Hỏi lại server một lần, và chỉ giữ màn hình đó nếu vẫn đúng người.
  //
  // Khác người ⇒ huỷ HẲN phiên (token + state + user) rồi để `ProtectedRoute` đá về
  // `/login`. Chỉ `setUser(người mới)` là KHÔNG đủ: `Workspace` vẫn đang mount với
  // dữ liệu của người cũ trong `useState`, đổi context không dọn được chỗ đó. Cái
  // giá là người mới phải đăng nhập lại trong tab đó — đắt hơn một chút so với việc
  // để lộ tài liệu của người khác.
  useEffect(() => caiDatKiemTraKhoiPhuc({
    layIdDangHienThi: () => userRef.current?.id,
    layUser: getCurrentUser,
    onHuy: () => {
      clearToken();
      xoaDuLieuPhienNguoiDung();
      setUser(null);
    },
  }), []);

  // `provider` là tham số THỨ BA, tuỳ chọn: `login(email, password)` giữ nguyên chữ
  // ký cũ nên trang Login hiện tại không phải sửa. Chọn provider là việc của giao
  // diện sau này; ở đây chỉ mở đường cho nó.
  // Tham số đầu là ĐỊNH DANH, không nhất thiết là email: local dùng email, NKS dùng
  // username. `login(email, password)` giữ nguyên chữ ký cũ nên mọi caller cũ không
  // phải sửa. Phiên sau khi đăng nhập giống hệt nhau bất kể provider nào — chỉ có
  // token StudyMap được lưu, không bao giờ có gì của provider ngoài.
  const login = useCallback(async (dinhDanh, password, provider) => {
    setError("");
    try {
      const laProviderNgoai = Boolean(provider) && provider !== "local";
      const { token, user: u } = await loginUser(
        laProviderNgoai
          ? { username: dinhDanh, password, provider }
          : { email: dinhDanh, password },
      );
      // Đăng nhập là ĐỔI NGƯỜI DÙNG. Chứng từ ghi của người trước — nếu tab này chưa
      // tải lại — thuộc về một user_id khác và máy chủ sẽ từ chối nó; quên ngay ở đây
      // để người mới được hỏi mật khẩu như bình thường, thay vì gặp một lỗi lạ.
      quenGrant();
      setToken(token);
      setUser(u);
      return u;
    } catch (err) {
      setError(friendlyError(err));
      throw err;
    }
  }, []);

  const register = useCallback(async ({ email, password, display_name }) => {
    setError("");
    try {
      const { token, user: u } = await registerUser({ email, password, display_name });
      setToken(token);
      setUser(u);
      return u;
    } catch (err) {
      setError(friendlyError(err));
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await logoutUser();       // best-effort server call
    clearToken();
    // State trong React mất theo component lúc `Workspace` unmount, nhưng
    // localStorage thì không: tên tài liệu và job đang chạy của người vừa đăng xuất
    // sẽ được người kế tiếp đọc lại trên cùng trình duyệt. Xoá TRƯỚC khi
    // `setUser(null)` đẩy đi redirect, để không có cửa sổ nào mount lại và đọc trúng.
    xoaDuLieuPhienNguoiDung();
    setUser(null);
    setError("");
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const u = await getCurrentUser();
      setUser(u || null);
      return u;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  const value = { user, loading, error, setError, login, register, logout, refreshUser };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
