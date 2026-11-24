// @vitest-environment jsdom
// V9.3 P5b (owner brief C): logout from the workspace first writes pending browser notes.
// If the browser refuses, the learner is warned and the first click does not log out; a
// second click leaves (the draft is then dropped from memory by the session cleanup).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MainLayout from "./MainLayout";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import { setPendingNote, forgetPendingNotes, readNote, hasPendingNotes } from "../../utils/notesPreview";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

const spies = vi.hoisted(() => ({ logout: vi.fn(() => Promise.resolve()), toast: vi.fn(), onLogout: null }));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("../../auth/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", email: "a@example.test" }, logout: spies.logout }) }));
vi.mock("../../utils/api", async (original) => ({ ...(await original()), apiFetch: () => new Promise(() => {}) }));
vi.mock("./SidebarRight", () => ({ default: () => <div /> }));
vi.mock("./SidebarLeft", () => ({ default: () => <div /> }));
vi.mock("./WorkspaceContainer", () => ({ default: () => <div /> }));
vi.mock("../study/ResearchTimeline", () => ({ default: () => null }));
vi.mock("../shortcuts/ShortcutsOverlay", () => ({ default: () => null }));
vi.mock("../ui/Toaster", () => ({ default: () => null, toast: spies.toast }));
vi.mock("./AccountMenu", () => ({ default: ({ onLogout }) => { spies.onLogout = onLogout; return null; } }));

let container, root;
beforeEach(async () => {
  window.localStorage.clear();
  forgetPendingNotes();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<StudyContextProvider><MainLayout selectedSources={[]} setSelectedSources={() => {}} /></StudyContextProvider>);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  spies.logout.mockClear();
  spies.toast.mockClear();
});

describe("logout and browser notes", () => {
  it("writes pending notes, then logs out", async () => {
    setPendingNote("u1", "d1", "nháp chưa lưu");
    await act(async () => { await spies.onLogout(); });
    expect(readNote("u1", "d1").text).toBe("nháp chưa lưu");
    expect(spies.logout).toHaveBeenCalledTimes(1);
  });

  it("warns and stays when the browser refuses to save, and leaves on the second click", async () => {
    setPendingNote("u1", "d1", "nháp chưa lưu");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked"); });
    await act(async () => { await spies.onLogout(); });
    expect(spies.logout).not.toHaveBeenCalled();
    expect(spies.toast).toHaveBeenCalledTimes(1);
    expect(spies.toast.mock.calls[0][0]).toMatch(/Chưa lưu được ghi chú/);
    expect(hasPendingNotes()).toBe(true);
    await act(async () => { await spies.onLogout(); });
    expect(spies.logout).toHaveBeenCalledTimes(1);
  });
});
