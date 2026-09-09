import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { StudyContextProvider } from "./study/StudyContextProvider";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        {/* Trên <Routes>, không trong một trang cụ thể — đổi route không được xoá
            lựa chọn đang xem (xem StudyContextProvider.jsx). */}
        <StudyContextProvider>
          <App />
        </StudyContextProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
