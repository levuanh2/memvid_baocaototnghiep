import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useTheme } from "./hooks/useTheme";
import ProtectedRoute from "./auth/ProtectedRoute";
import Spinner from "./components/ui/Spinner";
// Landing tải NGAY: nó là trang KHÔNG cần đăng nhập gặp nhiều nhất (mọi khách
// vào "/" đều thấy nó trước tiên) — bọc lazy chỉ thêm một vòng chờ cho đúng
// trang muốn hiện NGAY LẬP TỨC. Mọi trang còn lại đều nằm sau một cú bấm (đăng
// nhập, hoặc đã ở trong /app) nên tải khi cần không mất gì, và tách chúng khỏi
// bundle chính là phần lớn 565KB của `index-*.js` (Phase 6, Step 1 — xem báo
// cáo cuối phase để có số đo trước/sau thật).
import Landing from "./pages/Landing";
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const Workspace = lazy(() => import("./pages/Workspace"));
const DocumentList = lazy(() => import("./pages/study/DocumentList"));
const StudyMapView = lazy(() => import("./pages/study/StudyMapView"));
const QuizSetup = lazy(() => import("./pages/study/QuizSetup"));
const QuizTaking = lazy(() => import("./pages/study/QuizTaking"));
const QuizResult = lazy(() => import("./pages/study/QuizResult"));
const ReviewGuide = lazy(() => import("./pages/study/ReviewGuide"));
const Practice = lazy(() => import("./pages/study/Practice"));

/** Cùng một khung tải cho mọi lần đổi route lazy — một dòng, không layout
 * shift lớn vì các trang này đều tự vẽ khung xương/tiêu đề riêng ngay khi mount;
 * đây chỉ che khoảng chờ TẢI CHUNK (thường dưới một khung hình trên mạng nội bộ). */
function DangTaiTrang() {
  return (
    <div className="h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
      <Spinner size={20} />
    </div>
  );
}

export default function App() {
  // Apply the persisted light/dark preference app-wide (every route inherits it).
  // MainLayout and Landing also call useTheme() for their own toggles; the shared
  // truth is the `.dark` class on <html>, so the instances stay in sync.
  useTheme();

  return (
    <Suspense fallback={<DangTaiTrang />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <Workspace />
            </ProtectedRoute>
          }
        />
        <Route path="/app/chat" element={<Navigate to="/app" replace />} />
        {/* StudyMap — dữ liệu học tập là dữ liệu cá nhân, mọi trang đều sau ProtectedRoute. */}
        <Route path="/app/study" element={<ProtectedRoute><DocumentList /></ProtectedRoute>} />
        <Route path="/app/study/map/:documentId" element={<ProtectedRoute><StudyMapView /></ProtectedRoute>} />
        <Route path="/app/study/quiz/new" element={<ProtectedRoute><QuizSetup /></ProtectedRoute>} />
        <Route path="/app/study/quiz/:quizId" element={<ProtectedRoute><QuizTaking /></ProtectedRoute>} />
        <Route path="/app/study/result/:attemptId" element={<ProtectedRoute><QuizResult /></ProtectedRoute>} />
        <Route path="/app/study/review/:attemptId" element={<ProtectedRoute><ReviewGuide /></ProtectedRoute>} />
        <Route path="/app/study/practice/:quizId" element={<ProtectedRoute><Practice /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
