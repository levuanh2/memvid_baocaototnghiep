import { Link, useLocation } from "react-router-dom";
import { Icon } from "../ui/Icon";

// V9.3 bottom nav (docs/StudyMap-V9.3/01 "Điều hướng"), shown at <=700px only.
// Owner-approved five items after P3b gave "Tổng quan" a real route (/app/study/dashboard).
// "Luyện tập" stays; the spec's "Ôn tập" has no route of its own yet (review lives under a
// quiz attempt), so it is not invented. Each `match` claims disjoint paths: one current item.
// eslint-disable-next-line react-refresh/only-export-components
export const APP_NAV_ITEMS = [
  { label: "Tổng quan", to: "/app/study/dashboard", icon: "LayoutDashboard",
    match: (p) => p === "/app/study/dashboard" },
  { label: "Thư viện", to: "/app/study", icon: "Library",
    match: (p) => p === "/app/study" || p.startsWith("/app/study/map/") },
  { label: "Học tập", to: "/app", icon: "MessagesSquare", match: (p) => p === "/app" },
  { label: "Luyện tập", to: "/app/study/quiz/new", icon: "Target",
    match: (p) => /^\/app\/study\/(quiz|result|review|practice)\//.test(p) },
  { label: "Tiến độ", to: "/app/study/progress", icon: "Activity",
    match: (p) => p === "/app/study/progress" },
];

/** Pure bar. `inflow`: part of a flex-column shell (the workspace) instead of fixed over
 * the page, so it never covers the chat composer. */
export function AppNavBar({ pathname, inflow = false }) {
  // React Router also serves /app/, /app/study/ … (Codex P2): match without the slash.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (
    <nav className={inflow ? "app-bottom-nav app-bottom-nav--inflow" : "app-bottom-nav"}
      aria-label="Điều hướng chính">
      {APP_NAV_ITEMS.map((item) => {
        const current = item.match(path);
        return (
          <Link key={item.to} to={item.to} className="app-bottom-nav__link"
            aria-current={current ? "page" : undefined}>
            <Icon name={item.icon} size={20} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default function AppNav() {
  const { pathname } = useLocation();
  return <AppNavBar pathname={pathname} />;
}
