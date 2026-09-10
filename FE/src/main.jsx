import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { StudyContextProvider } from "./study/StudyContextProvider";
import App from "./App";
import ErrorBoundary from "./components/ui/ErrorBoundary";
import "./index.css";

// Phase 6, Step 8 — Promise bị reject mà không ai `.catch()` trước đây biến
// mất hoàn toàn (chỉ có dòng cảnh báo mặc định của trình duyệt trong DevTools,
// dễ lẫn vào các cảnh báo khác). Không có dịch vụ theo dõi lỗi nào để gửi tới
// (cấm thêm hạ tầng mới) — ghi console rõ ràng, tìm được bằng cách lọc theo
// tiền tố, là cải thiện thật trong giới hạn đã có.
window.addEventListener("unhandledrejection", (e) => {
  console.error("[unhandledrejection]", e.reason);
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          {/* Trên <Routes>, không trong một trang cụ thể — đổi route không được xoá
              lựa chọn đang xem (xem StudyContextProvider.jsx). */}
          <StudyContextProvider>
            <App />
          </StudyContextProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
