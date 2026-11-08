// @vitest-environment jsdom
// W1-4 (item 2): when the user has NO documents at all (not just none
// selected), the centre Chat empty state shows one primary "Tải tài liệu
// lên" button, reusing SidebarLeft's own upload trigger (no duplicate
// upload POST logic in ChatArea itself).
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

describe("ChatArea empty-state, no documents at all (W1-4 item 2)", () => {
  it("shows one primary 'Tải tài liệu lên' button and no mode-switch hint/drawer button when the library is truly empty", async () => {
    const onUploadDocument = vi.fn();
    await renderChatArea({ onUploadDocument });

    const upload = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Tải tài liệu lên");
    expect(upload).toBeTruthy();
    expect(upload.className).toMatch(/btn-primary/);
    await act(async () => { upload.click(); });
    expect(onUploadDocument).toHaveBeenCalledTimes(1);

    // Neither item 1's drawer button nor the "bên trái" hints belong here --
    // there's nothing to open a drawer to or navigate to yet.
    expect(container.textContent).not.toContain("Mở thư mục nguồn");
    expect(container.textContent).not.toContain("bên trái");
  });

  it("a non-empty selection is itself proof the library isn't empty, even if `sources` hasn't caught up yet", async () => {
    // Defends the exact MainLayout regression this fix caused and fixed
    // (MainLayout.guidedReveal/guidedClose tests drive `selectedSources`
    // directly while stubbing SidebarLeft, so `sources` never populates).
    await renderChatArea({ sources: [], selectedSources: ["a"] });
    expect(container.textContent).not.toContain("Tải tài liệu lên");
  });
});
