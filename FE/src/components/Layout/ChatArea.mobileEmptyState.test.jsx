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

  it("renders a mobile-only hint that names no position (no left column on a phone), and a desktop-only hint that points to the source panel", async () => {
    await renderChatArea({ sources: SOURCES });
    const paragraphs = [...container.querySelectorAll("p.font-display.text-body-lg")];
    const mobile = paragraphs.find((p) => p.className.includes("md:hidden"));
    const desktop = paragraphs.find((p) => p.className.includes("hidden") && p.className.includes("md:block"));
    expect(mobile).toBeTruthy();
    expect(desktop).toBeTruthy();
    expect(mobile.textContent).not.toContain("bên trái");
    expect(mobile.textContent).not.toContain("ở lề phải");
    expect(mobile.textContent).toBe("Chọn tài liệu, rồi đặt câu hỏi. Câu trả lời sẽ kèm nguồn dẫn chứng.");
    // V6: the desktop copy changed on purpose. It now points to the pick list first and no
    // longer describes where citations appear ("ở lề phải").
    expect(desktop.textContent).toBe(
      "Chọn tài liệu ở đây hoặc trong thư mục nguồn bên trái, rồi đặt câu hỏi. Câu trả lời sẽ kèm nguồn dẫn chứng.",
    );
  });

  // V6: the start screen offers the next step directly instead of only describing it.
  it("lists up to four documents that can be asked, and picking one reports its key", async () => {
    const onPickSource = vi.fn();
    const many = ["a", "b", "c", "d", "e"].map((k) => ({ video_stem: k, filename: `${k.toUpperCase()}.pdf`, can_query: true }));
    await renderChatArea({ sources: [...many, { video_stem: "p", filename: "P.pdf", status: "processing", can_query: false }], onPickSource });
    const rows = [...container.querySelectorAll("[data-chat-start] .chat-start__row")];
    expect(rows.map((r) => r.textContent.trim())).toEqual(["A.pdf", "B.pdf", "C.pdf", "D.pdf"]);
    expect(container.querySelector("[data-chat-start]").textContent).toContain("Còn 1 tài liệu khác trong thư mục nguồn.");
    await act(async () => { rows[1].click(); });
    expect(onPickSource).toHaveBeenCalledWith("b");
  });

  it("without a pick handler, or with nothing ready to ask, the pick list is not rendered", async () => {
    await renderChatArea({ sources: [{ video_stem: "a", filename: "A.pdf", can_query: true }] });
    expect(container.querySelectorAll(".chat-start__row").length).toBe(0);
  });

  it("with a document selected, starter questions are rows that fill the composer", async () => {
    await renderChatArea({ sources: [{ video_stem: "a", filename: "A.pdf", can_query: true }], selectedSources: ["a"], onPickSource: vi.fn() });
    const rows = [...container.querySelectorAll("[data-chat-start] .chat-start__row")];
    expect(rows.map((r) => r.textContent.trim())).toEqual(["Tóm tắt A.", "Ý chính của A là gì?", "Khái niệm nào trong A khó hiểu nhất?"]);
    await act(async () => { rows[1].click(); });
    expect(container.querySelector("textarea").value).toBe("Ý chính của A là gì?");
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

  // Review of #161: a selection the list has not confirmed is not a reason to offer questions.
  it("a selected key that is not a queryable document shows the pick list, not questions", async () => {
    await renderChatArea({ sources: [{ video_stem: "a", filename: "A.pdf", can_query: true }], selectedSources: ["missing"], onPickSource: vi.fn() });
    const start = container.querySelector("[data-chat-start]");
    expect(start.textContent).not.toContain("Bắt đầu bằng một câu hỏi");
    expect([...start.querySelectorAll(".chat-start__row")].map((r) => r.textContent.trim())).toEqual(["A.pdf"]);
  });

  it("while the list is still loading, an unconfirmed selection shows the loading line", async () => {
    await renderChatArea({ sources: [], selectedSources: ["from-deep-link"], sourcesState: "loading", onPickSource: vi.fn() });
    const start = container.querySelector("[data-chat-start]");
    expect(start.textContent).toContain("Đang tải danh sách tài liệu");
    expect(start.querySelectorAll(".chat-start__row").length).toBe(0);
  });
});
