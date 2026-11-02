// @vitest-environment jsdom
//
// R84-A11Y-02: "Xóa lịch sử chat" lives in the conversation menu, which unmounts
// before the confirm dialog opens. Cancelling (Escape or "Hủy") must return focus
// to the menu button, never <body>; confirming deletes exactly once; a failed
// delete keeps the dialog recoverable.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import ChatArea from "./ChatArea";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import { deleteConversation } from "../../utils/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

let container, root;

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove(); container = null; root = null;
  deleteConversation.mockReset();
});

const menuTrigger = () => container.querySelector('button[aria-label="Tùy chọn cuộc trò chuyện"]');
const dialog = () => document.body.querySelector('[role="dialog"]');
const buttonIn = (scope, text) => [...scope.querySelectorAll("button")].find((b) => b.textContent.trim() === text);

async function openDeleteDialog() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(
    <StudyContextProvider>
      <ChatArea selectedSources={[]} sources={[]} onOpenLeft={() => {}} />
    </StudyContextProvider>,
  ));
  await act(async () => { await Promise.resolve(); });
  const trigger = menuTrigger();
  trigger.focus();
  await act(async () => trigger.click());
  const item = buttonIn(container, "Xóa lịch sử chat");
  item.focus();
  await act(async () => item.click());
  expect(dialog()).not.toBeNull();
  return trigger;
}

async function tickAndConfirm() {
  await act(async () => dialog().querySelector('input[type="checkbox"]').click());
  await act(async () => buttonIn(dialog(), "Xóa lịch sử chat").click());
}

describe("ChatArea delete-history dialog focus (R84-A11Y-02)", () => {
  it("Escape cancels without deleting and returns focus to the conversation menu button", async () => {
    const trigger = await openDeleteDialog();

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(dialog()).toBeNull();
    expect(deleteConversation).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("the Huỷ button also returns focus to the menu button", async () => {
    const trigger = await openDeleteDialog();

    await act(async () => buttonIn(dialog(), "Huỷ").click());

    expect(dialog()).toBeNull();
    expect(deleteConversation).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("confirm deletes exactly once (double click included) and focuses the composer", async () => {
    deleteConversation.mockResolvedValue(undefined);
    await openDeleteDialog();
    await act(async () => dialog().querySelector('input[type="checkbox"]').click());
    const confirm = buttonIn(dialog(), "Xóa lịch sử chat");

    await act(async () => { confirm.click(); confirm.click(); });

    expect(deleteConversation).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
  });

  it("a failed delete keeps the dialog open with the error, then Escape still returns focus to the menu button", async () => {
    deleteConversation.mockRejectedValue(new Error("network"));
    const trigger = await openDeleteDialog();

    await tickAndConfirm();

    expect(deleteConversation).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toBeNull();
    expect(dialog().textContent).toContain("Không xóa được lịch sử chat");

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(dialog()).toBeNull();
    expect(deleteConversation).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });
});
