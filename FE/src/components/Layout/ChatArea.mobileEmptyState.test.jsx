// @vitest-environment jsdom
// W1-4: below `md` there is no left column, so the empty-Chat hint must not
// say "bên trái" there, and must offer a real button to open the sources
// drawer instead. jsdom never applies CSS media queries (same limitation as
// Modal.jsx's focus-trap tests, see Round 7.1) -- this file proves the right
// markup/classes/handler exist; actual viewport-conditional visibility is
// proven by the Playwright fixture (quiz-result-style real-component check).
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

describe("ChatArea empty-state, mobile hint + drawer button (W1-4)", () => {
  // A non-empty `sources` library: this file is about item 1 (the
  // mobile hint/drawer-button split), not item 2 (the separate "no
  // documents at all" upload CTA, covered by ChatArea.noDocumentsEmptyState.test.jsx).
  const SOURCES = [{ video_stem: "a", filename: "A.pdf" }];

  it("renders a mobile-only hint without 'bên trái' or 'ở lề phải' (no left column or right margin on a phone), and a desktop-only hint that keeps both", async () => {
    await renderChatArea({ sources: SOURCES });
    const paragraphs = [...container.querySelectorAll("p.font-display.text-body-lg")];
    const mobile = paragraphs.find((p) => p.className.includes("md:hidden"));
    const desktop = paragraphs.find((p) => p.className.includes("hidden") && p.className.includes("md:block"));
    expect(mobile).toBeTruthy();
    expect(desktop).toBeTruthy();
    expect(mobile.textContent).not.toContain("bên trái");
    expect(mobile.textContent).not.toContain("ở lề phải");
    expect(mobile.textContent).toBe(
      "Mỗi câu trả lời được truy hồi từ tài liệu đã chọn, kèm nguồn dẫn chứng. Chọn tài liệu, rồi đặt câu hỏi.",
    );
    // Desktop copy is byte-for-byte unchanged.
    expect(desktop.textContent).toBe(
      "Mỗi câu trả lời được truy hồi từ tài liệu đã chọn và gắn nguồn ở lề phải. Chọn tài liệu bên trái, rồi đặt câu hỏi.",
    );
  });

  it("the mobile 'Mở thư mục nguồn' button is md:hidden and opens the sources drawer via the same onOpenLeft", async () => {
    const onOpenLeft = vi.fn();
    await renderChatArea({ sources: SOURCES, onOpenLeft });
    const buttons = [...container.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Mở thư mục nguồn");
    // Exactly one TEXT button with this label in the empty state (the header's
    // icon-only equivalent carries an aria-label, not this visible text, so
    // it is never counted here).
    expect(buttons.length).toBe(1);
    const [button] = buttons;
    expect(button.className).toMatch(/(^|\s)md:hidden(\s|$)/);
    await act(async () => { button.click(); });
    expect(onOpenLeft).toHaveBeenCalledTimes(1);
  });
});
