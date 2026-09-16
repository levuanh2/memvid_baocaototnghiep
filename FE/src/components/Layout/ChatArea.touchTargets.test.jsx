// @vitest-environment jsdom
//
// Regression for round 8, Part A: the conversation-toolbar's New Chat and
// kebab/more buttons were 32px hit targets — grown to a real 40px target
// (icon size only bumped from 13/16 to 18, per "grow the hit area, not the
// icon"). jsdom can't measure real rendered pixels (no layout engine), so
// this asserts the structural proxy that actually determines the rendered
// size: the Tailwind size utility classes, plus that both buttons carry a
// real accessible name (aria-label or visible text) and a tooltip (title) —
// the two other things this round's requirements name explicitly.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import ChatArea from "./ChatArea";
import { StudyContextProvider } from "../../study/StudyContextProvider";

beforeAll(() => {
  // jsdom has no matchMedia implementation — ChatArea reads it both in a
  // useState initializer and a mount effect (responsive composer sizing).
  window.matchMedia = window.matchMedia || function () {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  };
  // jsdom also doesn't implement scrollIntoView (ChatArea auto-scrolls to
  // the latest message on mount/update).
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
  if (container) {
    document.body.removeChild(container);
    container = null;
  }
  vi.restoreAllMocks();
});

async function renderChatArea() {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <StudyContextProvider>
        <ChatArea selectedSources={[]} sources={[]} onOpenLeft={() => {}} />
      </StudyContextProvider>
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("ChatArea conversation-toolbar touch targets", () => {
  it("New Chat button is a real >=40px hit target with an accessible name and tooltip", async () => {
    await renderChatArea();
    const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent.includes("Chat mới"));
    expect(btn).toBeTruthy();
    expect(btn.className).toMatch(/(^|\s)!?h-10(\s|$)/);
    expect(btn.getAttribute("title")).toBeTruthy();
    expect(btn.getAttribute("aria-label") || btn.textContent.trim()).toBeTruthy();
  });

  it("kebab/more button is a real 40x40px hit target with an accessible name and tooltip", async () => {
    await renderChatArea();
    const btn = container.querySelector('button[aria-label="Tùy chọn cuộc trò chuyện"]');
    expect(btn).toBeTruthy();
    expect(btn.className).toMatch(/(^|\s)w-10(\s|$)/);
    expect(btn.className).toMatch(/(^|\s)h-10(\s|$)/);
    expect(btn.getAttribute("title")).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toBeTruthy();
  });
});
