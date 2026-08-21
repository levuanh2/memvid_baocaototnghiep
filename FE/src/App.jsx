import { Routes, Route, Navigate } from "react-router-dom";
import { useTheme } from "./hooks/useTheme";
import ProtectedRoute from "./auth/ProtectedRoute";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Workspace from "./pages/Workspace";
import DocumentList from "./pages/study/DocumentList";
import StudyMapView from "./pages/study/StudyMapView";
import QuizSetup from "./pages/study/QuizSetup";
import QuizTaking from "./pages/study/QuizTaking";
import QuizResult from "./pages/study/QuizResult";
import ReviewGuide from "./pages/study/ReviewGuide";
import Practice from "./pages/study/Practice";


export default function App() {
  // Apply the persisted light/dark preference app-wide (every route inherits it).
  // MainLayout and Landing also call useTheme() for their own toggles; the shared
  // truth is the `.dark` class on <html>, so the instances stay in sync.
  useTheme();

  return (
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
  );
}
