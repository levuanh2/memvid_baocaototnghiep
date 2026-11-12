// @vitest-environment jsdom
// HITL review-resume polling belongs to the same attempt lifecycle as a normal send.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import ChatArea from "./ChatArea";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import { pollQueryStatus } from "../../utils/queryPolling";

beforeAll(() => {
  window.matchMedia = window.matchMedia || function () {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  };
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
});

const resumeQuery = vi.fn(async () => ({}));
vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => {
    if (path === "/query") return { ok: true, json: async () => ({ job_id: "review-job" }) };
    return { ok: true, json: async () => ({}) };
  }),
  apiUrl: (path) => path,
  clearConversationContext: vi.fn(),
  deleteConversation: vi.fn(),
  resumeQuery: (...args) => resumeQuery(...args),
  _appError: vi.fn(async () => new Error("HTTP 500")),
  isNotFoundOrForbiddenError: vi.fn(() => false),
  isUnauthorizedError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((error) => String(error)),
}));

vi.mock("../../utils/sseStream", () => ({
  streamSse: vi.fn((_url, { onEvent }) => {
    queueMicrotask(() => onEvent(JSON.stringify({
      type: "status",
      status: "interrupted",
      result: { payload: { review: { type: "review", answer: "Bản nháp" } } },
    })));
    return new Promise(() => {});
  }),
}));

vi.mock("../../utils/queryPolling", () => ({
  shouldPollFallback: vi.fn(() => false),
  pollQueryStatus: vi.fn(() => new Promise(() => {})),
}));

vi.mock("../../utils/studyApi", async () => ({
  ...(await vi.importActual("../../utils/studyApi")),
  cancelJob: vi.fn(async () => ({})),
}));

let container;
let root;

const flush = () => act(async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

async function enterReview() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <StudyContextProvider>
        <ChatArea
          selectedSources={["source-a"]}
          sources={[{ video_stem: "source-a", filename: "A.pdf", can_query: true }]}
          onOpenLeft={() => {}}
        />
      </StudyContextProvider>,
    );
  });

  const textarea = container.querySelector('textarea[aria-label="Câu hỏi cho tài liệu đã chọn"]');
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  await act(async () => {
    setValue.call(textarea, "Câu hỏi cần duyệt");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector('button[aria-label="Gửi câu hỏi"]').click();
  });
  await flush();
  expect(container.textContent).toContain("Bản nháp");
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe("ChatArea review-resume attempt cancellation", () => {
  it("cancels the status poll when ChatArea unmounts", async () => {
    await enterReview();
    const approve = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Phê duyệt");
    await act(async () => { approve.click(); });
    await flush();

    expect(pollQueryStatus).toHaveBeenCalledTimes(1);
    const options = pollQueryStatus.mock.calls[0][1];
    expect(options.isCancelled()).toBe(false);

    await act(async () => { root.unmount(); });
    root = null;
    expect(options.isCancelled()).toBe(true);
  });

  it("does not start polling for a review continuation replaced in the same tick", async () => {
    await enterReview();
    const buttons = [...container.querySelectorAll("button")];
    const approve = buttons.find((button) => button.textContent === "Phê duyệt");
    const reject = buttons.find((button) => button.textContent === "Từ chối");

    await act(async () => {
      approve.click();
      reject.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(resumeQuery).toHaveBeenCalledTimes(2);
    expect(pollQueryStatus).toHaveBeenCalledTimes(1);
    expect(pollQueryStatus.mock.calls[0][1].isCancelled()).toBe(false);
  });
});
