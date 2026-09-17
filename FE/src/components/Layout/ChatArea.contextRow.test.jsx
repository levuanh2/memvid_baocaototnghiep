// @vitest-environment jsdom
//
// Round 12 (compact Chat context row, Part A). Regressions covered:
// - exactly one visible "Chọn nguồn" action in the empty Chat state (the old
//   blue goal banner + its own "Chọn tài liệu"/"Sửa" button, and the mobile
//   "Mở thư mục nguồn" fallback that called the same onOpenLeft, are gone);
// - the new compact context row's layout contract (h-12 = 48px, inside the
//   44-48px target the spec names, every real control >=40x40px);
// - the conversation title is a real, locally-editable label (not static
//   decoration) via its rename/edit icon.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import ChatArea from "./ChatArea";
import { StudyContextProvider } from "../../study/StudyContextProvider";

beforeAll(() => {
  window.matchMedia = window.matchMedia || function () {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  };
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
});

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  apiUrl: (p) => p,
  clearConversationContext: vi.fn(), deleteConversation: vi.fn(), resumeQuery: vi.fn(),
  _appError: vi.fn(), isNotFoundOrForbiddenError: vi.fn(() => false), isUnauthorizedError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((e) => String(e)),
}));

let container;

afterEach(() => {
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

async function renderChatArea(props = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <StudyContextProvider>
        <ChatArea selectedSources={[]} sources={[]} onOpenLeft={() => {}} {...props} />
      </StudyContextProvider>
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function findByText(root, text) {
  return Array.from(root.querySelectorAll("button")).filter((b) => b.textContent.includes(text));
}

describe("ChatArea compact context row", () => {
  it("shows exactly one visible 'Chọn nguồn' action in the empty state, and no duplicate 'Chọn tài liệu'/'Sửa' banner button", async () => {
    await renderChatArea();
    const matches = findByText(container, "Chọn nguồn");
    expect(matches.length).toBe(1);
    // the old blue goal banner's own action button (removed this round).
    expect(findByText(container, "Chọn tài liệu").length).toBe(0);
    expect(findByText(container, "Sửa").length).toBe(0);
  });

  it("context row is a single flex-shrink-0 h-12 (48px) row directly under mount, with real >=40px controls", async () => {
    await renderChatArea();
    const row = container.querySelector(".h-12.border-b");
    expect(row).toBeTruthy();
    expect(row.className).toMatch(/flex-shrink-0/);
    // it must be the FIRST child of ChatArea's root (pinned above the
    // scrollable message area, not scrolled-away in-flow chrome).
    expect(row.parentElement.firstElementChild).toBe(row);

    const chonNguon = findByText(row, "Chọn nguồn")[0];
    expect(chonNguon.className).toMatch(/(^|\s)!?h-10(\s|$)/);
    const newChatBtn = row.querySelector('button[aria-label="Cuộc trò chuyện mới"]');
    expect(newChatBtn.className).toMatch(/(^|\s)w-10(\s|$)/);
    expect(newChatBtn.className).toMatch(/(^|\s)h-10(\s|$)/);
    const overflowBtn = row.querySelector('button[aria-label="Tùy chọn cuộc trò chuyện"]');
    expect(overflowBtn.className).toMatch(/(^|\s)w-10(\s|$)/);
    expect(overflowBtn.className).toMatch(/(^|\s)h-10(\s|$)/);
  });

  it("shows real selected-source count once sources are selected, not just 'Chưa chọn nguồn'", async () => {
    await renderChatArea({ selectedSources: ["a", "b"], sources: [{ video_stem: "a", filename: "A.pdf" }, { video_stem: "b", filename: "B.pdf" }] });
    expect(container.textContent).toContain("2 nguồn đã chọn");
    expect(container.textContent).not.toContain("Chưa chọn nguồn");
  });

  it("the conversation title is really editable via its rename icon", async () => {
    await renderChatArea();
    expect(container.textContent).toContain("Cuộc trò chuyện mới");
    const editBtn = container.querySelector('button[aria-label="Đổi tên cuộc trò chuyện"]');
    await act(async () => { editBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const input = container.querySelector('input[aria-label="Tên cuộc trò chuyện"]');
    expect(input).toBeTruthy();
    // React tracks controlled-input values via its own property descriptor;
    // setting `.value` directly (without going through the native setter)
    // is invisible to its change-detection, so the "input" event fires with
    // the OLD value still in place. Same native-setter workaround React's
    // own testing docs describe for jsdom.
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      nativeSetter.call(input, "Ôn tập chương 3");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // React implements the (non-bubbling) `onBlur` via delegated "focusout"
    // listening at the root — a raw "blur" Event never reaches it in jsdom.
    await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(container.textContent).toContain("Ôn tập chương 3");
  });
});
