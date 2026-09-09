import { createContext } from "react";

// Giữ riêng module này để StudyContextProvider.jsx chỉ export component (react-refresh)
// — cùng lý do và cùng khuôn với auth/context.js.
export const StudyContext = createContext(null);
